import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getConfig } from "../utils/config.js";
import { createModuleLogger } from "../utils/logger.js";
import * as schema from "./schema.js";
import { eq, sql } from "drizzle-orm";

const logger = createModuleLogger("database");

let client: postgres.Sql | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!db) {
    const config = getConfig();
    client = postgres(config.db.url, {
      max: 5,
      idle_timeout: 30,
      connect_timeout: 10,
    });
    db = drizzle(client, { schema, logger: false });
    logger.info("Drizzle database client initialized");
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
  metadata?: unknown,
) {
  try {
    await getDb().insert(schema.auditLogs).values({
      level,
      category,
      message,
      metadata: metadata as any,
    });
  } catch (e) {
    logger.error({ error: e }, "Failed to write audit log");
  }
}

export async function loadOpenTrades() {
  return getDb()
    .select()
    .from(schema.trades)
    .where(eq(schema.trades.status, "OPEN"));
}

export async function sumRealizedPnl(): Promise<number> {
  const [row] = await getDb()
    .select({
      total: sql<string>`COALESCE(SUM(${schema.trades.realizedPnl}), 0)`,
    })
    .from(schema.trades)
    .where(eq(schema.trades.status, "SETTLED"));
  return parseFloat(row?.total ?? "0");
}

export async function wipeAllData(): Promise<void> {
  const db = getDb();
  await db.delete(schema.trades);
  await db.delete(schema.buckets);
  await db.delete(schema.campaigns);
  await db.delete(schema.auditLogs);
}

export async function createTrade(data: {
  campaignId: string;
  campaignSlug: string;
  campaignTitle: string;
  bucketId: string;
  bucketSlug: string | null;
  bucketGroupTitle: string;
  tokenId: string;
  entryTs: Date;
  entryPrice: string;
  entryShares: string;
  actualCost: string;
  entryFees: string;
  expectedNetProfit: string;
  modalBucketAtEntry: string;
  posFromModal: number;
  entryQuality: unknown;
}) {
  const result = await getDb()
    .insert(schema.trades)
    .values({ ...data, status: "OPEN" })
    .returning();
  return result[0];
}

export async function resolveTrade(
  id: string,
  outcome: "WIN" | "LOSS",
  realizedPnl: string,
  exitPrice: string,
  exitReason: "RESOLUTION" | "EARLY_EXIT",
  minNoPriceDuringPosition?: string | null,
) {
  const result = await getDb()
    .update(schema.trades)
    .set({
      exitOutcome: outcome,
      exitPrice,
      exitTs: new Date(),
      exitReason,
      realizedPnl,
      status: "SETTLED",
      updatedAt: new Date(),
      ...(minNoPriceDuringPosition !== undefined
        ? { minNoPriceDuringPosition }
        : {}),
    })
    .where(eq(schema.trades.id, id))
    .returning();
  return result[0];
}

export async function updateTradePositionSize(
  id: string,
  newShares: string,
  newActualCost: string,
  newFees: string,
) {
  const result = await getDb()
    .update(schema.trades)
    .set({
      entryShares: newShares,
      actualCost: newActualCost,
      entryFees: newFees,
      updatedAt: new Date(),
    })
    .where(eq(schema.trades.id, id))
    .returning();
  return result[0];
}
