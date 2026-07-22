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
import { getDb, getPortfolio, wipeAndResetPortfolio } from "../db/client.js";
import * as schema from "../db/schema.js";
import { getMarketOrchestrator } from "./market-orchestrator.js";
import {
  calculatePortfolioPerformance,
  type TimePeriod,
} from "./performance-calculator.js";
import {
  calculateExpectedNetProfit,
  calculateLossAmount,
  calculateWinProfit,
} from "./execution-simulator.js";
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
    this.broadcastInterval = setInterval(() => this.broadcastState(), 2000);

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

  getExpressApp(): express.Application {
    return this.app;
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
      const orchestrator = getMarketOrchestrator();
      res.json({
        status: "ok",
        uptime: process.uptime(),
        ...orchestrator.getStats(),
      });
    });

    this.app.get(["/api/system/stats", "/api/stats"], (_req, res) => {
      const orchestrator = getMarketOrchestrator();
      const config = getConfig();
      const pm = orchestrator.portfolioManager;
      res.json({
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
        openPositionPrices: orchestrator.getOpenPositionPrices(),
        portfolio: {
          cashBalance: pm.getCashBalance(),
          initialCapital: pm.getInitialCapital(),
          openPositionsValue: orchestrator.computeOpenPositionsValue(),
        },
      });
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
            .from(schema.distributionCampaigns)
            .where(eq(schema.distributionCampaigns.active, false))
            .orderBy(desc(schema.distributionCampaigns.updatedAt))
            .limit(limit);

          if (campaigns.length === 0) {
            res.json([]);
            return;
          }

          const campaignIds = campaigns.map((c) => c.id);
          const tradeStatsRows = await db
            .select({
              campaignId: schema.simulatedTrades.campaignId,
              tradeCount: sql<number>`count(*)`,
              realizedPnl: sql<string>`sum(CAST(${schema.simulatedTrades.realizedPnl} AS NUMERIC))`,
            })
            .from(schema.simulatedTrades)
            .where(inArray(schema.simulatedTrades.campaignId, campaignIds))
            .groupBy(schema.simulatedTrades.campaignId);

          const statsMap = new Map(
            tradeStatsRows.map((r) => [r.campaignId, r]),
          );

          const results = campaigns.map((c) => {
            const stats = statsMap.get(c.id);
            return {
              ...c,
              historicalTrades: {
                length: Number(stats?.tradeCount || 0),
                totalPnl: parseFloat(stats?.realizedPnl || "0"),
              },
            };
          });
          res.json(results);
          return;
        } else {
          const campaigns = await db
            .select()
            .from(schema.distributionCampaigns)
            .where(eq(schema.distributionCampaigns.active, true))
            .orderBy(desc(schema.distributionCampaigns.updatedAt))
            .limit(limit);

          const results = campaigns.map((c) => {
            const metrics = orchestrator.getActiveCampaignMetrics(c.id);
            return {
              ...c,
              candidateCount: metrics.candidateCount,
              trackedCount: metrics.trackedCount,
              positionCount: metrics.positionCount,
            };
          });
          res.json(results);
          return;
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
          .from(schema.distributionCampaigns)
          .where(eq(schema.distributionCampaigns.id, campaignId));
        if (!campaign) {
          res.status(404).json({ error: "Campaign not found" });
          return;
        }

        const buckets = campaign.active
          ? await db
              .select()
              .from(schema.distributionBuckets)
              .where(eq(schema.distributionBuckets.campaignId, campaignId))
          : [];

        const historicalTrades = !campaign.active
          ? await db
              .select()
              .from(schema.simulatedTrades)
              .where(eq(schema.simulatedTrades.campaignId, campaignId))
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
            const noPrice = parseFloat(b.noPrice?.toString() ?? "1");
            const isModal = b.id === modalBucket.id;
            const bucketPositions = openPositions.filter(
              (p) => p.tokenId === b.yesTokenId || p.tokenId === b.noTokenId,
            );
            const hasOpenPosition = bucketPositions.length > 0;

            if (isCandidate) candidateCount++;
            if (hasOpenPosition) positionCount++;

            const isRelevant = isRelevantBucket(
              isCandidate,
              isModal,
              noPrice,
              config.strategy.maxNoEntryPrice,
              hasOpenPosition,
            );

            if (isRelevant) {
              trackedCount++;
              relevantBuckets.push({
                id: b.id,
                slug: b.slug,
                groupItemTitle: b.groupItemTitle,
                noPrice: b.noPrice,
                volume24h: b.volume24h,
                hasOpenPosition,
                positions: bucketPositions.map((p) => ({
                  id: p.tradeId,
                  tokenId: p.tokenId,
                  entryPrice: p.entryPrice.toString(),
                  entryShares: p.entryShares.toString(),
                  actualCost: p.actualCost.toString(),
                  entryFees: p.fees.toString(),
                })),
              });
            }
          }
          relevantBuckets.sort((a, b) => {
            const [aMin] = parseBucketMinMax(a.groupItemTitle);
            const [bMin] = parseBucketMinMax(b.groupItemTitle);
            return aMin - bMin;
          });
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

    this.app.get("/api/positions", async (req, res) => {
      try {
        const db = getDb();
        const orchestrator = getMarketOrchestrator();

        const rawRows = await db
          .select({
            trade: schema.simulatedTrades,
            campaign: schema.distributionCampaigns,
          })
          .from(schema.simulatedTrades)
          .leftJoin(
            schema.distributionCampaigns,
            eq(
              schema.simulatedTrades.campaignId,
              schema.distributionCampaigns.id,
            ),
          )
          .where(eq(schema.simulatedTrades.status, "OPEN"))
          .orderBy(asc(schema.distributionCampaigns.endDate));

        const openPositionsMap = new Map(
          orchestrator.getOpenPositions().map((p) => [p.tradeId, p]),
        );

        const rows = rawRows.map((r) => {
          let minPrice = r.trade.minNoPriceDuringPosition;
          const livePos = openPositionsMap.get(r.trade.id);
          if (livePos?.minNoPriceDuringPosition !== undefined) {
            minPrice =
              livePos.minNoPriceDuringPosition === null
                ? null
                : livePos.minNoPriceDuringPosition.toString();
          }

          return {
            ...r.trade,
            minNoPriceDuringPosition: minPrice,
            campaignEndDate: r.campaign?.endDate,
          };
        });

        res.json(rows);
      } catch (error) {
        logger.error({ error }, "Positions fetch error");
        res.status(500).json({ error: "Failed to fetch positions" });
      }
    });

    this.app.get("/api/trades/history", async (req, res) => {
      try {
        const db = getDb();
        const limit = Math.min(parseInt(req.query.limit as string) || 25, 200);
        const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

        const rawRows = await db
          .select({
            trade: schema.simulatedTrades,
            campaign: schema.distributionCampaigns,
          })
          .from(schema.simulatedTrades)
          .leftJoin(
            schema.distributionCampaigns,
            eq(
              schema.simulatedTrades.campaignId,
              schema.distributionCampaigns.id,
            ),
          )
          .where(eq(schema.simulatedTrades.status, "SETTLED"))
          .orderBy(desc(schema.simulatedTrades.exitTs))
          .limit(limit)
          .offset(offset);

        const rows = rawRows.map((r) => ({
          ...r.trade,
          campaignEndDate: r.campaign?.endDate,
        }));

        res.json(rows);
      } catch (error) {
        logger.error({ error }, "Trades error");
        res.status(500).json({ error: "Failed to get trades" });
      }
    });

    this.app.get("/api/performance", async (req, res) => {
      try {
        const period = (req.query.period as TimePeriod) || "ALL";
        const metrics = await calculatePortfolioPerformance(
          period,
          undefined,
          getMarketOrchestrator().computeOpenPositionsValue(),
        );
        res.json(metrics);
      } catch (error) {
        logger.error({ error }, "Performance error");
        res.status(500).json({ error: "Failed to calculate performance" });
      }
    });

    this.app.get("/api/audit", async (req, res) => {
      try {
        const db = getDb();
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
        const rows = await db
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
        const orchestrator = getMarketOrchestrator();
        await orchestrator.wipe();
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

  private broadcastState(): void {
    const orchestrator = getMarketOrchestrator();
    const config = getConfig();
    const pm = orchestrator.portfolioManager;
    this.broadcast({
      type: "systemState",
      data: {
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
        openPositionPrices: orchestrator.getOpenPositionPrices(),
        portfolio: {
          cashBalance: pm.getCashBalance(),
          initialCapital: pm.getInitialCapital(),
          openPositionsValue: orchestrator.computeOpenPositionsValue(),
        },
        timestamp: Date.now(),
      },
    });
  }
}

let instance: ApiServer | null = null;
export function getApiServer(): ApiServer {
  if (!instance) instance = new ApiServer();
  return instance;
}
