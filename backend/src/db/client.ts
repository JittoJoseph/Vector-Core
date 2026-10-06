import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, lt, notInArray, sql } from "drizzle-orm";
import { getConfig } from "../utils/config.js";
import { createModuleLogger } from "../utils/logger.js";
import * as schema from "./schema.js";

const logger = createModuleLogger("database");

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!db) {
    const client = postgres(getConfig().db.url, {
      max: 3,
      idle_timeout: 30,
      connect_timeout: 10,
    });
    db = drizzle(client, { schema });
  }
  return db;
}

export async function connectDatabase(): Promise<void> {
  await getDb().execute(sql`SELECT 1`);
  logger.info("Database connection established");
}

export async function logAudit(
  level: "info" | "warn" | "error",
  category: string,
  message: string,
  metadata?: Record<string, unknown>,
) {
  try {
    await getDb()
      .insert(schema.auditLogs)
      .values({ level, category, message, metadata });
  } catch (e) {
    logger.error({ error: e }, "Failed to write audit log");
  }
}

export async function sumRealizedPnl(): Promise<number> {
  const [row] = await getDb()
    .select({
      total: sql<string>`COALESCE(SUM(${schema.trades.realizedPnl}), 0)`,
    })
    .from(schema.trades);
  return parseFloat(row?.total ?? "0");
}

export async function wipeTrades(): Promise<void> {
  const db = getDb();
  await db.delete(schema.trades);
  await db.delete(schema.auditLogs);
}

export type ExitReason =
  | "RESOLUTION"
  | "TAKE_PROFIT"
  | "STOP_LOSS"
  | "MODEL_EXIT";

export async function settleTrade(
  id: string,
  fields: {
    outcome: "WIN" | "LOSS";
    realizedPnl: number;
    exitPrice: number;
    exitReason: ExitReason;
    minPrice: number | null;
  },
) {
  const [row] = await getDb()
    .update(schema.trades)
    .set({
      exitOutcome: fields.outcome,
      realizedPnl: fields.realizedPnl.toFixed(8),
      exitPrice: fields.exitPrice.toFixed(8),
      exitReason: fields.exitReason,
      exitTs: new Date(),
      minPriceDuringPosition: fields.minPrice?.toFixed(8) ?? null,
      status: "SETTLED",
    })
    .where(eq(schema.trades.id, id))
    .returning();
  return row;
}

export async function recordPartialSale(
  id: string,
  sharesSold: number,
  realized: number,
) {
  await getDb()
    .update(schema.trades)
    .set({
      sharesSold: sharesSold.toFixed(8),
      realizedPnl: realized.toFixed(8),
    })
    .where(eq(schema.trades.id, id));
}

export async function pruneHistory(): Promise<void> {
  const db = getDb();
  const cutoff = new Date(Date.now() - 30 * 86_400_000);
  const traded = db
    .select({ id: schema.trades.campaignId })
    .from(schema.trades);
  await db
    .delete(schema.campaigns)
    .where(
      and(
        eq(schema.campaigns.closed, true),
        lt(schema.campaigns.endDate, cutoff),
        notInArray(schema.campaigns.id, traded),
      ),
    );
  await db
    .delete(schema.auditLogs)
    .where(
      lt(schema.auditLogs.createdAt, new Date(Date.now() - 14 * 86_400_000)),
    );
  await db
    .delete(schema.forecastResiduals)
    .where(lt(schema.forecastResiduals.closedAt, cutoff));
}
