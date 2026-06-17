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
  const database = getDb();
  await database.execute(sql`SELECT 1`);
  logger.info("Database connection established");
}

export async function disconnectDatabase(): Promise<void> {
  if (client) {
    await client.end();
    client = null;
    db = null;
    logger.info("Database connection closed");
  }
}

export async function logAudit(
  level: "info" | "warn" | "error",
  category: string,
  message: string,
  metadata?: unknown,
) {
  const database = getDb();
  try {
    await database.insert(schema.auditLogs).values({
      level,
      category,
      message,
      metadata: metadata as any,
    });
  } catch (e) {
    logger.error({ error: e }, "Failed to write audit log");
  }
}

export async function getPortfolio() {
  const database = getDb();
  const rows = await database
    .select()
    .from(schema.portfolio)
    .where(eq(schema.portfolio.id, 1))
    .limit(1);
  return rows[0] ?? null;
}

export async function initPortfolio(startingCapital: number) {
  const database = getDb();
  const existing = await getPortfolio();
  if (existing) return existing;

  const result = await database
    .insert(schema.portfolio)
    .values({
      id: 1,
      initialCapital: startingCapital.toString(),
      cashBalance: startingCapital.toString(),
    })
    .returning();
  return result[0];
}

export async function updateCashBalance(newBalance: string) {
  const database = getDb();
  const result = await database
    .update(schema.portfolio)
    .set({ cashBalance: newBalance, updatedAt: new Date() })
    .where(eq(schema.portfolio.id, 1))
    .returning();
  return result[0];
}

export async function wipeAndResetPortfolio(startingCapital: number) {
  const database = getDb();
  await database.delete(schema.simulatedTrades);

  await database.delete(schema.distributionBuckets);
  await database.delete(schema.distributionCampaigns);
  await database.delete(schema.auditLogs);
  await database.delete(schema.portfolio);

  const result = await database
    .insert(schema.portfolio)
    .values({
      id: 1,
      initialCapital: startingCapital.toString(),
      cashBalance: startingCapital.toString(),
    })
    .returning();
  return result[0];
}

export async function loadOpenTradesWithBuckets() {
  const database = getDb();
  return database
    .select({
      trade: schema.simulatedTrades,
      bucket: schema.distributionBuckets,
    })
    .from(schema.simulatedTrades)
    .leftJoin(
      schema.distributionBuckets,
      eq(schema.simulatedTrades.bucketId, schema.distributionBuckets.id),
    )
    .where(eq(schema.simulatedTrades.status, "OPEN"));
}

export async function createSimulatedTrade(data: {
  campaignId?: string | null;
  campaignSlug?: string | null;
  campaignTitle?: string | null;
  bucketId?: string | null;
  bucketSlug?: string | null;
  bucketGroupTitle?: string | null;
  tokenId: string;
  entryTs: Date;
  entryPrice: string;
  entryShares: string;
  positionBudget: string;
  actualCost: string;
  entryFees?: string;
  fillStatus?: string;
  expectedNetProfit?: string;
  expectedReturnPercent?: string;
  noBestBidAtEntry?: string;
  noBestAskAtEntry?: string;
  depthAtLimit?: string;
  modalBucketAtEntry?: string | null;
}) {
  const database = getDb();
  const result = await database
    .insert(schema.simulatedTrades)
    .values({
      campaignId: data.campaignId ?? null,
      campaignSlug: data.campaignSlug ?? null,
      campaignTitle: data.campaignTitle ?? null,
      bucketId: data.bucketId ?? null,
      bucketSlug: data.bucketSlug ?? null,
      bucketGroupTitle: data.bucketGroupTitle ?? null,
      tokenId: data.tokenId,
      entryTs: data.entryTs,
      entryPrice: data.entryPrice,
      entryShares: data.entryShares,
      positionBudget: data.positionBudget,
      actualCost: data.actualCost,
      entryFees: data.entryFees ?? "0",
      fillStatus: data.fillStatus ?? "FULL",
      expectedNetProfit: data.expectedNetProfit ?? null,
      expectedReturnPercent: data.expectedReturnPercent ?? null,
      noBestBidAtEntry: data.noBestBidAtEntry ?? null,
      noBestAskAtEntry: data.noBestAskAtEntry ?? null,
      depthAtLimit: data.depthAtLimit ?? null,
      modalBucketAtEntry: data.modalBucketAtEntry ?? null,
      status: "OPEN",
    })
    .returning();
  return result[0];
}

export async function resolveTrade(
  id: string,
  outcome: "WIN" | "LOSS",
  realizedPnl: string,
  exitPrice?: string,
  extras?: {
    exitReason?: "RESOLUTION" | "EARLY_EXIT" | "MANUAL" | "FORCE_TIMEOUT";
    minNoPriceDuringPosition?: string | null;
  },
) {
  const database = getDb();
  const finalExitPrice = exitPrice ?? (outcome === "WIN" ? "1" : "0");
  const result = await database
    .update(schema.simulatedTrades)
    .set({
      exitOutcome: outcome,
      exitPrice: finalExitPrice,
      exitTs: new Date(),
      realizedPnl,
      status: "SETTLED",
      updatedAt: new Date(),
      ...(extras?.exitReason ? { exitReason: extras.exitReason } : {}),
      ...(extras?.minNoPriceDuringPosition !== undefined ? { minNoPriceDuringPosition: extras.minNoPriceDuringPosition } : {}),
    })
    .where(eq(schema.simulatedTrades.id, id))
    .returning();
  return result[0];
}
