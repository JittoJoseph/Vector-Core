import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { createServer, type Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { desc, asc, eq, inArray, sql } from "drizzle-orm";
import { createModuleLogger } from "../utils/logger.js";
import { getConfig } from "../utils/config.js";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";
import { getMarketOrchestrator } from "./market-orchestrator.js";
import {
  calculatePerformance,
  type TimePeriod,
} from "./performance-calculator.js";
import {
  parseBucketMinMax,
  findModalBucket,
  isCandidateBucket,
  isRelevantBucket,
} from "../utils/weather-logic.js";

const logger = createModuleLogger("api-server");

export class ApiServer {
  private app: express.Application;
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private broadcastInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.app = express();
    this.app.use(express.json());
    this.app.use(this.corsMiddleware);
    this.setupRoutes();
  }

  async start(): Promise<void> {
    const config = getConfig();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server, path: "/ws" });
    this.wss.on("connection", (ws) => {
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as { type?: string };
          if (msg.type === "ping")
            ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
        } catch {
        }
      });
    });

    const orchestrator = getMarketOrchestrator();
    orchestrator.on("tradeOpened", (data) =>
      this.broadcast({ type: "tradeOpened", data }),
    );
    orchestrator.on("tradeResolved", (data) =>
      this.broadcast({ type: "tradeResolved", data }),
    );
    this.broadcastInterval = setInterval(() => {
      this.broadcast({
        type: "systemState",
        data: { ...this.buildSystemState(), timestamp: Date.now() },
      });
    }, 2000);

    return new Promise((resolve) => {
      this.server!.listen(config.server.port, config.server.host, () => {
        logger.info(
          { host: config.server.host, port: config.server.port },
          "API server started",
        );
        resolve();
      });
    });
  }

  stop(): void {
    if (this.broadcastInterval) clearInterval(this.broadcastInterval);
    this.broadcastInterval = null;
    this.wss?.close();
    this.wss = null;
    this.server?.close();
    this.server = null;
  }

  private buildSystemState() {
    const orchestrator = getMarketOrchestrator();
    const config = getConfig();
    return {
      orchestrator: orchestrator.getStats(),
      config: {
        minNoEntryPrice: config.strategy.minNoEntryPrice,
        maxNoEntryPrice: config.strategy.maxNoEntryPrice,
        minExpectedNetProfit: config.strategy.minExpectedNetProfit,
        startingCapital: config.portfolio.startingCapital,
        maxPositions: config.strategy.maxSimultaneousPositions,
        stopLossEnabled: config.strategy.stopLossEnabled,
        stopLossNoPrice: config.strategy.stopLossNoPrice,
      },
      portfolio: orchestrator.getPortfolioSnapshot(),
      positionsPnl: orchestrator.getOpenPositionsPnl(),
    };
  }

  private corsMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  }

  private adminAuth(req: Request, res: Response, next: NextFunction): void {
    const password = req.headers.authorization?.replace("Bearer ", "");
    if (!password || password !== getConfig().admin.password) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  }

  private setupRoutes(): void {
    this.app.get("/ping", (_req, res) => res.json("pong"));
    this.app.get("/health", (_req, res) => {
      res.json({
        status: "ok",
        uptime: process.uptime(),
        ...getMarketOrchestrator().getStats(),
      });
    });

    this.app.get(["/api/system/stats", "/api/stats"], (_req, res) => {
      res.json(this.buildSystemState());
    });

    this.app.get("/api/campaigns", async (req, res) => {
      try {
        const db = getDb();
        const orchestrator = getMarketOrchestrator();
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
        const status = (req.query.status as string) || "active";

        if (status === "history") {
          const campaigns = await db
            .select()
            .from(schema.campaigns)
            .where(eq(schema.campaigns.active, false))
            .orderBy(desc(schema.campaigns.updatedAt))
            .limit(limit);

          if (campaigns.length === 0) {
            res.json([]);
            return;
          }

          const statsRows = await db
            .select({
              campaignId: schema.trades.campaignId,
              tradeCount: sql<number>`count(*)`,
              realizedPnl: sql<string>`COALESCE(SUM(${schema.trades.realizedPnl}), 0)`,
            })
            .from(schema.trades)
            .where(
              inArray(
                schema.trades.campaignId,
                campaigns.map((c) => c.id),
              ),
            )
            .groupBy(schema.trades.campaignId);
          const statsMap = new Map(statsRows.map((r) => [r.campaignId, r]));

          res.json(
            campaigns.map((c) => {
              const stats = statsMap.get(c.id);
              return {
                ...c,
                historicalTrades: {
                  length: Number(stats?.tradeCount ?? 0),
                  totalPnl: parseFloat(stats?.realizedPnl ?? "0"),
                },
              };
            }),
          );
        } else {
          const campaigns = await db
            .select()
            .from(schema.campaigns)
            .where(eq(schema.campaigns.active, true))
            .orderBy(desc(schema.campaigns.updatedAt))
            .limit(limit);

          res.json(
            campaigns.map((c) => ({
              ...c,
              ...orchestrator.getActiveCampaignMetrics(c.id),
            })),
          );
        }
      } catch (error) {
        logger.error({ error }, "Campaigns list error");
        res.status(500).json({ error: "Failed to get campaigns" });
      }
    });

    this.app.get("/api/campaigns/:id", async (req, res) => {
      try {
        const db = getDb();
        const config = getConfig();
        const orchestrator = getMarketOrchestrator();
        const campaignId = req.params.id;

        const [campaign] = await db
          .select()
          .from(schema.campaigns)
          .where(eq(schema.campaigns.id, campaignId));
        if (!campaign) {
          res.status(404).json({ error: "Campaign not found" });
          return;
        }

        const buckets = campaign.active
          ? await db
              .select()
              .from(schema.buckets)
              .where(eq(schema.buckets.campaignId, campaignId))
          : [];

        const historicalTrades = !campaign.active
          ? await db
              .select()
              .from(schema.trades)
              .where(eq(schema.trades.campaignId, campaignId))
          : [];

        const modalBucket = findModalBucket(buckets);
        const openPositions = orchestrator.getOpenPositions();

        const relevantBuckets = [];
        let candidateCount = 0;
        let positionCount = 0;
        let trackedCount = 0;

        if (modalBucket) {
          const [modalMin] = parseBucketMinMax(modalBucket.groupItemTitle);
          for (const b of buckets) {
            const isCandidate = isCandidateBucket(b.groupItemTitle, modalMin);
            const noPrice = parseFloat(b.noPrice ?? "1");
            const isModal = b.id === modalBucket.id;
            const bucketPositions = openPositions.filter(
              (p) => p.bucketId === b.id,
            );
            const hasOpenPosition = bucketPositions.length > 0;

            if (isCandidate) candidateCount++;
            if (hasOpenPosition) positionCount++;

            if (
              isRelevantBucket(
                isCandidate,
                isModal,
                noPrice,
                config.strategy.maxNoEntryPrice,
                hasOpenPosition,
              )
            ) {
              trackedCount++;
              relevantBuckets.push({
                id: b.id,
                slug: b.slug,
                groupItemTitle: b.groupItemTitle,
                noPrice: b.noPrice,
                hasOpenPosition,
                positions: bucketPositions.map((p) => ({
                  id: p.tradeId,
                  entryPrice: p.entryPrice,
                  entryShares: p.entryShares,
                })),
              });
            }
          }
          relevantBuckets.sort(
            (a, b) =>
              parseBucketMinMax(a.groupItemTitle)[0] -
              parseBucketMinMax(b.groupItemTitle)[0],
          );
        }

        res.json({
          ...campaign,
          modalBucketTitle: modalBucket?.groupItemTitle ?? "N/A",
          candidateCount,
          trackedCount,
          positionCount,
          relevantBuckets,
          historicalTrades,
        });
      } catch (error) {
        logger.error({ error }, "Campaign detail error");
        res.status(500).json({ error: "Failed to get campaign details" });
      }
    });

    this.app.get("/api/positions", async (_req, res) => {
      try {
        const rows = await getDb()
          .select({
            trade: schema.trades,
            campaignEndDate: schema.campaigns.endDate,
          })
          .from(schema.trades)
          .leftJoin(
            schema.campaigns,
            eq(schema.trades.campaignId, schema.campaigns.id),
          )
          .where(eq(schema.trades.status, "OPEN"))
          .orderBy(asc(schema.campaigns.endDate));

        res.json(
          rows.map((r) => ({ ...r.trade, campaignEndDate: r.campaignEndDate })),
        );
      } catch (error) {
        logger.error({ error }, "Positions fetch error");
        res.status(500).json({ error: "Failed to fetch positions" });
      }
    });

    this.app.get("/api/trades/history", async (req, res) => {
      try {
        const limit = Math.min(parseInt(req.query.limit as string) || 25, 200);
        const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

        const rows = await getDb()
          .select({
            trade: schema.trades,
            campaignEndDate: schema.campaigns.endDate,
          })
          .from(schema.trades)
          .leftJoin(
            schema.campaigns,
            eq(schema.trades.campaignId, schema.campaigns.id),
          )
          .where(eq(schema.trades.status, "SETTLED"))
          .orderBy(desc(schema.trades.exitTs))
          .limit(limit)
          .offset(offset);

        res.json(
          rows.map((r) => ({ ...r.trade, campaignEndDate: r.campaignEndDate })),
        );
      } catch (error) {
        logger.error({ error }, "Trades error");
        res.status(500).json({ error: "Failed to get trades" });
      }
    });

    this.app.get("/api/performance", async (req, res) => {
      try {
        const period = (req.query.period as TimePeriod) || "ALL";
        res.json(await calculatePerformance(period));
      } catch (error) {
        logger.error({ error }, "Performance error");
        res.status(500).json({ error: "Failed to calculate performance" });
      }
    });

    this.app.get("/api/audit", async (req, res) => {
      try {
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
        const rows = await getDb()
          .select()
          .from(schema.auditLogs)
          .orderBy(desc(schema.auditLogs.createdAt))
          .limit(limit);
        res.json(rows);
      } catch {
        res.status(500).json({ error: "Failed to get audit logs" });
      }
    });

    this.app.post(
      "/api/admin/pause",
      (req, res, next) => this.adminAuth(req, res, next),
      (_req, res) => {
        getMarketOrchestrator().pause();
        res.json({ success: true, paused: true });
      },
    );

    this.app.post(
      "/api/admin/resume",
      (req, res, next) => this.adminAuth(req, res, next),
      async (_req, res) => {
        await getMarketOrchestrator().resume();
        res.json({ success: true, paused: false });
      },
    );

    this.app.delete(
      "/api/admin/wipe",
      (req, res, next) => this.adminAuth(req, res, next),
      async (_req, res) => {
        await getMarketOrchestrator().wipe();
        res.json({ success: true });
      },
    );
  }

  private broadcast(message: unknown): void {
    if (!this.wss) return;
    const data = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }
}

let instance: ApiServer | null = null;
export function getApiServer(): ApiServer {
  if (!instance) instance = new ApiServer();
  return instance;
}
