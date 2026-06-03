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
import { getMarketOrchestrator } from "./market-orchestrator.js";
import {
  calculatePortfolioPerformance,
  type TimePeriod,
} from "./performance-calculator.js";
import { runMonteCarloAnalysis } from "./monte-carlo.js";

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

    this.app.get("/api/active-market", (_req, res) => {
      const live = getMarketOrchestrator().getLiveMarkets();
      if (live.length === 0) {
        res.status(204).end();
        return;
      }
      res.json(live[0]);
    });

    this.app.get("/api/live-markets", (_req, res) => {
      res.json(getMarketOrchestrator().getLiveMarkets());
    });

    this.app.get("/api/families", async (req, res) => {
      try {
        const db = getDb();
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
        const rows = await db
          .select()
          .from(schema.eventFamilies)
          .orderBy(desc(schema.eventFamilies.updatedAt))
          .limit(limit);
        res.json(rows);
      } catch (error) {
        logger.error({ error }, "Families list error");
        res.status(500).json({ error: "Failed to get families" });
      }
    });

    this.app.get("/api/markets", async (req, res) => {
      try {
        const db = getDb();
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
        const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
        const rows = await db
          .select()
          .from(schema.deadlineMarkets)
          .orderBy(schema.deadlineMarkets.deadline)
          .limit(limit)
          .offset(offset);
        res.json(rows);
      } catch (error) {
        logger.error({ error }, "Markets list error");
        res.status(500).json({ error: "Failed to get markets" });
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
          .select()
          .from(schema.simulatedTrades)
          .orderBy(desc(schema.simulatedTrades.entryTs))
          .limit(limit)
          .offset(offset);
        const rows =
          status === "OPEN" || status === "SETTLED"
            ? await base.where(eq(schema.simulatedTrades.status, status))
            : await base;
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

    this.app.get("/api/analysis", async (req, res) => {
      try {
        const simulations = parseInt(req.query.simulations as string) || 10_000;
        const tradesPerSim = parseInt(req.query.tradesPerSim as string) || 100;
        const result = await runMonteCarloAnalysis({
          simulations: Math.min(simulations, 50_000),
          tradesPerSim: Math.min(tradesPerSim, 500),
        });
        res.json(result);
      } catch (error: any) {
        const msg = error?.message || "Analysis failed";
        res.status(msg.includes("No settled") ? 400 : 500).json({ error: msg });
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
        getMarketOrchestrator().pause();
        await wipeAndResetPortfolio(getConfig().portfolio.startingCapital);
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
