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
import { getMarketOrchestrator, STRATEGY } from "./market-orchestrator.js";
import {
  calculatePerformance,
  type TimePeriod,
} from "./performance-calculator.js";

const logger = createModuleLogger("api-server");
const BROADCAST_MS = 3000;

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;

const route =
  (label: string, handler: Handler) => async (req: Request, res: Response) => {
    try {
      const body = await handler(req, res);
      if (!res.headersSent) res.json(body);
    } catch (error) {
      logger.error({ error }, `${label} failed`);
      if (!res.headersSent) res.status(500).json({ error: `${label} failed` });
    }
  };

const intParam = (value: unknown, fallback: number, max: number) =>
  Math.min(Math.max(parseInt(String(value)) || fallback, 0), max);

export class ApiServer {
  private app = express();
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private broadcastTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.app.disable("x-powered-by");
    this.app.use(express.json());
    this.app.use(this.cors);
    this.routes();
  }

  async start(): Promise<void> {
    const config = getConfig();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server, path: "/ws" });
    this.wss.on("connection", (ws) => {
      ws.on("message", (raw) => {
        if (raw.toString().includes('"ping"'))
          ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
      });
    });

    const orchestrator = getMarketOrchestrator();
    orchestrator.on("tradeOpened", (data) =>
      this.broadcast({ type: "tradeOpened", data }),
    );
    orchestrator.on("tradeExit", (data) =>
      this.broadcast({ type: "tradeExit", data }),
    );
    orchestrator.on("tradeResolved", (data) =>
      this.broadcast({ type: "tradeResolved", data }),
    );
    this.broadcastTimer = setInterval(() => {
      if (this.wss?.clients.size)
        this.broadcast({
          type: "systemState",
          data: { ...this.systemState(), timestamp: Date.now() },
        });
    }, BROADCAST_MS);

    await new Promise<void>((resolve) =>
      this.server!.listen(config.server.port, config.server.host, resolve),
    );
    logger.info(
      { host: config.server.host, port: config.server.port },
      "API server started",
    );
  }

  stop(): void {
    if (this.broadcastTimer) clearInterval(this.broadcastTimer);
    this.wss?.close();
    this.server?.close();
  }

  private systemState() {
    const orchestrator = getMarketOrchestrator();
    const config = getConfig();
    return {
      orchestrator: orchestrator.getStats(),
      config: {
        startingCapital: config.portfolio.startingCapital,
        tradeBudget: STRATEGY.tradeBudget,
        minEdge: STRATEGY.edge,
        maxSpread: STRATEGY.maxSpread,
        minPrice: STRATEGY.minPrice,
        maxPrice: STRATEGY.maxPrice,
        minEntryLeadHours: STRATEGY.minEntryLeadHours,
        partialTakeProfitAt: STRATEGY.partialTakeProfitAt,
        stopLossDelta: config.strategy.stopLossDelta,
      },
      portfolio: orchestrator.getPortfolioSnapshot(),
      positionsPnl: orchestrator.getOpenPositionsPnl(),
    };
  }

  private cors(req: Request, res: Response, next: NextFunction): void {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  }

  private admin(req: Request, res: Response, next: NextFunction): void {
    if (
      req.headers.authorization?.replace("Bearer ", "") !==
      getConfig().admin.password
    ) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  }

  private async exitsFor(tradeIds: string[]) {
    const out = new Map<string, (typeof schema.tradeExits.$inferSelect)[]>();
    if (!tradeIds.length) return out;
    const rows = await getDb()
      .select()
      .from(schema.tradeExits)
      .where(inArray(schema.tradeExits.tradeId, [...new Set(tradeIds)]))
      .orderBy(asc(schema.tradeExits.ts));
    for (const r of rows)
      out.set(r.tradeId, [...(out.get(r.tradeId) ?? []), r]);
    return out;
  }

  private tradesWithDeadline(status: string) {
    return getDb()
      .select({
        trade: schema.trades,
        campaignEndDate: schema.campaigns.endDate,
      })
      .from(schema.trades)
      .leftJoin(
        schema.campaigns,
        eq(schema.trades.campaignId, schema.campaigns.id),
      )
      .where(eq(schema.trades.status, status));
  }

  private routes(): void {
    const app = this.app;
    const orchestrator = getMarketOrchestrator();
    const admin = this.admin.bind(this);

    app.get("/ping", (_req, res) => res.json("pong"));
    app.get(
      "/api/stats",
      route("Stats", () => this.systemState()),
    );

    app.get(
      "/api/campaigns",
      route("Campaigns", async (req) => {
        if (req.query.status !== "history")
          return orchestrator.getActiveCampaigns();
        const db = getDb();
        const campaigns = await db
          .select()
          .from(schema.campaigns)
          .where(eq(schema.campaigns.closed, true))
          .orderBy(desc(schema.campaigns.endDate))
          .limit(intParam(req.query.limit, 50, 200));
        if (!campaigns.length) return [];
        const stats = await db
          .select({
            campaignId: schema.trades.campaignId,
            count: sql<number>`count(*)`,
            pnl: sql<string>`COALESCE(SUM(${schema.trades.realizedPnl}), 0)`,
          })
          .from(schema.trades)
          .where(
            inArray(
              schema.trades.campaignId,
              campaigns.map((c) => c.id),
            ),
          )
          .groupBy(schema.trades.campaignId);
        const byId = new Map(stats.map((s) => [s.campaignId, s]));
        return campaigns.map((c) => ({
          ...c,
          tradeCount: Number(byId.get(c.id)?.count ?? 0),
          totalPnl: parseFloat(byId.get(c.id)?.pnl ?? "0"),
        }));
      }),
    );

    app.get(
      "/api/campaigns/:id",
      route("Campaign detail", async (req, res) => {
        const id = String(req.params.id);
        const live = await orchestrator.getCampaignDetail(id);
        if (live) return live;
        const [campaign] = await getDb()
          .select()
          .from(schema.campaigns)
          .where(eq(schema.campaigns.id, id));
        if (!campaign)
          return res.status(404).json({ error: "Campaign not found" });
        const trades = await getDb()
          .select()
          .from(schema.trades)
          .where(eq(schema.trades.campaignId, id));
        return { ...campaign, trades };
      }),
    );

    app.get(
      "/api/readiness",
      route("Readiness", () => getMarketOrchestrator().getReadiness()),
    );

    app.get(
      "/api/positions",
      route("Positions", async () => {
        const rows = await this.tradesWithDeadline("OPEN").orderBy(
          asc(schema.campaigns.endDate),
        );
        const exits = await this.exitsFor(rows.map((r) => r.trade.id));
        return rows.map((r) => ({
          ...r.trade,
          campaignEndDate: r.campaignEndDate,
          exits: exits.get(r.trade.id) ?? [],
        }));
      }),
    );

    app.get(
      "/api/trades/history",
      route("Trade history", async (req) => {
        const rows = await getDb()
          .select({
            exit: schema.tradeExits,
            trade: schema.trades,
            campaignEndDate: schema.campaigns.endDate,
          })
          .from(schema.tradeExits)
          .innerJoin(
            schema.trades,
            eq(schema.tradeExits.tradeId, schema.trades.id),
          )
          .leftJoin(
            schema.campaigns,
            eq(schema.trades.campaignId, schema.campaigns.id),
          )
          .orderBy(desc(schema.tradeExits.ts))
          .limit(intParam(req.query.limit, 25, 200))
          .offset(intParam(req.query.offset, 0, 1_000_000));
        const exits = await this.exitsFor(rows.map((r) => r.trade.id));
        return rows.map((r) => ({
          exit: r.exit,
          trade: {
            ...r.trade,
            campaignEndDate: r.campaignEndDate,
            exits: exits.get(r.trade.id) ?? [],
          },
        }));
      }),
    );

    app.get(
      "/api/performance",
      route("Performance", (req) =>
        calculatePerformance((req.query.period as TimePeriod) || "ALL"),
      ),
    );

    app.get(
      "/api/audit",
      route("Audit", (req) =>
        getDb()
          .select()
          .from(schema.auditLogs)
          .orderBy(desc(schema.auditLogs.createdAt))
          .limit(intParam(req.query.limit, 50, 200)),
      ),
    );

    app.post(
      "/api/admin/pause",
      admin,
      route("Pause", () => {
        orchestrator.pause();
        return { success: true, paused: true };
      }),
    );
    app.post(
      "/api/admin/resume",
      admin,
      route("Resume", () => {
        orchestrator.resume();
        return { success: true, paused: false };
      }),
    );
    app.delete(
      "/api/admin/wipe",
      admin,
      route("Wipe", async () => {
        await orchestrator.wipe();
        return { success: true };
      }),
    );
  }

  private broadcast(message: unknown): void {
    if (!this.wss?.clients.size) return;
    const data = JSON.stringify(message);
    for (const client of this.wss.clients)
      if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

let instance: ApiServer | null = null;
export function getApiServer(): ApiServer {
  if (!instance) instance = new ApiServer();
  return instance;
}
