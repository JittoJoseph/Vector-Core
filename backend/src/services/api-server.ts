import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { createServer, type Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { desc, eq } from "drizzle-orm";
import { createModuleLogger } from "../utils/logger.js";
import { getConfig } from "../utils/config.js";
import { getDb, getPortfolio, wipeAndResetPortfolio } from "../db/client.js";
import * as schema from "../db/schema.js";
import { getMarketOrchestrator, parseBucketMinMax } from "./market-orchestrator.js";
import {
  calculatePortfolioPerformance,
  type TimePeriod,
} from "./performance-calculator.js";


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
          // ignore
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
      res.json({
        orchestrator: orchestrator.getStats(),
        config: {
          deadlineLookaheadDays: config.strategy.deadlineLookaheadDays,
          minNoEntryPrice: config.strategy.minNoEntryPrice,
          maxNoEntryPrice: config.strategy.maxNoEntryPrice,
          maxSpread: config.strategy.maxSpread,
          minLiquidityNum: config.strategy.minLiquidityNum,
          minVolume24h: config.strategy.minVolume24h,
          minExpectedNetProfit: config.strategy.minExpectedNetProfit,
          startingCapital: config.portfolio.startingCapital,
          maxPositions: config.strategy.maxSimultaneousPositions,
        },
      });
    });

    this.app.get("/api/live-markets", (_req, res) => {
      res.json(getMarketOrchestrator().getLiveMarkets());
    });

    this.app.get("/api/campaigns", async (req, res) => {
      try {
        const db = getDb();
        const config = getConfig();
        const orchestrator = getMarketOrchestrator();
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
        const status = req.query.status as string || 'active';
        
        let campaigns;
        if (status === 'history') {
          campaigns = await db.select().from(schema.distributionCampaigns)
            .where(eq(schema.distributionCampaigns.active, false))
            .orderBy(desc(schema.distributionCampaigns.updatedAt))
            .limit(limit);
        } else {
          campaigns = await db.select().from(schema.distributionCampaigns)
            .where(eq(schema.distributionCampaigns.active, true))
            .orderBy(desc(schema.distributionCampaigns.updatedAt))
            .limit(limit);
        }

        const allBuckets = await db.select().from(schema.distributionBuckets);
        const allTrades = await db.select().from(schema.simulatedTrades);
        const openPositions = orchestrator.getOpenPositions();
        
        const results = [];

        for (const c of campaigns) {
           const buckets = allBuckets.filter(b => b.campaignId === c.id);
           
           let modalBucket = buckets[0];
           let maxYes = parseFloat(buckets[0]?.yesPrice?.toString() ?? "0");
           for (const b of buckets) {
             const y = parseFloat(b.yesPrice?.toString() ?? "0");
             if (y > maxYes) { maxYes = y; modalBucket = b; }
           }
           
           let candidateCount = 0;
           let positionCount = 0;
           let trackedCount = 0;
           const relevantBuckets = [];
           
           if (modalBucket) {
              const [modalMin] = parseBucketMinMax(modalBucket.groupItemTitle);
              
              for (const b of buckets) {
                 const [, bMax] = parseBucketMinMax(b.groupItemTitle);
                 const isCandidate = bMax < modalMin;
                 const noPrice = parseFloat(b.noPrice?.toString() ?? "1");
                 const isModal = b.id === modalBucket.id;
                 const hasOpenPosition = openPositions.some(p => p.tokenId === b.yesTokenId || p.tokenId === b.noTokenId);
                 
                 if (isCandidate) candidateCount++;
                 if (hasOpenPosition) positionCount++;
                 
                 const isRelevant = hasOpenPosition || isModal || (isCandidate && (noPrice <= config.strategy.maxNoEntryPrice + 0.10 || Number.isNaN(noPrice)));
                 if (isRelevant) {
                    trackedCount++;
                    relevantBuckets.push({
                      ...b,
                      hasOpenPosition
                    });
                 }
              }

              relevantBuckets.sort((a, b) => {
                const [aMin] = parseBucketMinMax(a.groupItemTitle);
                const [bMin] = parseBucketMinMax(b.groupItemTitle);
                return aMin - bMin;
              });
           }
           
           const historicalTrades = allTrades.filter(t => t.campaignId === c.id);

           results.push({
              ...c,
              modalBucketTitle: modalBucket?.groupItemTitle ?? "N/A",
              candidateCount,
              trackedCount,
              positionCount,
              relevantBuckets,
              historicalTrades
           });
        }

        res.json(results);
      } catch (error) {
        logger.error({ error }, "Campaigns list error");
        res.status(500).json({ error: "Failed to get campaigns" });
      }
    });

    this.app.get("/api/opportunities", async (req, res) => {
      try {
        const db = getDb();
        const limit = Math.min(parseInt(req.query.limit as string) || 100, 300);
        const rows = await db
          .select()
          .from(schema.opportunities)
          .orderBy(desc(schema.opportunities.createdAt))
          .limit(limit);
        res.json(rows);
      } catch (error) {
        logger.error({ error }, "Opportunities list error");
        res.status(500).json({ error: "Failed to get opportunities" });
      }
    });

    this.app.get("/api/trades", async (req, res) => {
      try {
        const db = getDb();
        const limit = Math.min(parseInt(req.query.limit as string) || 25, 200);
        const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
        const status = req.query.status as string | undefined;
        
        const base = db
          .select({
             trade: schema.simulatedTrades,
             campaign: schema.distributionCampaigns
          })
          .from(schema.simulatedTrades)
          .leftJoin(schema.distributionCampaigns, eq(schema.simulatedTrades.campaignId, schema.distributionCampaigns.id))
          .orderBy(desc(schema.simulatedTrades.entryTs))
          .limit(limit)
          .offset(offset);
          
        const rawRows =
          status === "OPEN" || status === "SETTLED"
            ? await base.where(eq(schema.simulatedTrades.status, status))
            : await base;
            
        const rows = rawRows.map(r => ({
           ...r.trade,
           campaignEndDate: r.campaign?.endDate
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

    this.app.get("/api/portfolio", async (_req, res) => {
      try {
        const portfolio = await getPortfolio();
        if (!portfolio) {
          res.status(404).json({ error: "Portfolio not initialised" });
          return;
        }
        const openPositionsValue =
          getMarketOrchestrator().computeOpenPositionsValue();
        const cashBalance = parseFloat(portfolio.cashBalance);
        const initialCapital = parseFloat(portfolio.initialCapital);
        const portfolioValue = cashBalance + openPositionsValue;
        res.json({
          initialCapital,
          cashBalance,
          openPositionsValue,
          portfolioValue,
          roi:
            initialCapital > 0
              ? ((portfolioValue - initialCapital) / initialCapital) * 100
              : 0,
          createdAt: portfolio.createdAt,
          updatedAt: portfolio.updatedAt,
        });
      } catch (error) {
        logger.error({ error }, "Portfolio error");
        res.status(500).json({ error: "Failed to get portfolio" });
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
    const pm = orchestrator.portfolioManager;
    this.broadcast({
      type: "systemState",
      data: {
        ...orchestrator.getStats(),
        liveMarkets: orchestrator.getLiveMarkets(),
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
