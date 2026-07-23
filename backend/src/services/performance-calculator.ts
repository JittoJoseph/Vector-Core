import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";
import { and, eq, gte, sql } from "drizzle-orm";

export type TimePeriod = "1D" | "1W" | "1M" | "ALL";

export interface PerformanceMetrics {
  period: TimePeriod;
  totalPnl: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: string;
  avgWin: string;
  avgLoss: string;
  totalWin: string;
  totalLoss: string;
}

const PERIOD_MS: Record<Exclude<TimePeriod, "ALL">, number> = {
  "1D": 24 * 60 * 60 * 1000,
  "1W": 7 * 24 * 60 * 60 * 1000,
  "1M": 30 * 24 * 60 * 60 * 1000,
};

export async function calculatePerformance(
  period: TimePeriod,
): Promise<PerformanceMetrics> {
  const conditions = [eq(schema.trades.status, "SETTLED")];
  if (period !== "ALL") {
    conditions.push(
      gte(schema.trades.entryTs, new Date(Date.now() - PERIOD_MS[period])),
    );
  }

  const pnl = schema.trades.realizedPnl;
  const [row] = await getDb()
    .select({
      totalPnl: sql<string>`COALESCE(SUM(${pnl}), 0)`,
      totalTrades: sql<number>`COUNT(*)`,
      wins: sql<number>`COUNT(*) FILTER (WHERE ${pnl} > 0)`,
      losses: sql<number>`COUNT(*) FILTER (WHERE ${pnl} <= 0)`,
      totalWin: sql<string>`COALESCE(SUM(${pnl}) FILTER (WHERE ${pnl} > 0), 0)`,
      totalLoss: sql<string>`COALESCE(SUM(${pnl}) FILTER (WHERE ${pnl} <= 0), 0)`,
    })
    .from(schema.trades)
    .where(and(...conditions));

  const wins = Number(row?.wins ?? 0);
  const losses = Number(row?.losses ?? 0);
  const totalWin = parseFloat(row?.totalWin ?? "0");
  const totalLoss = parseFloat(row?.totalLoss ?? "0");
  const closed = wins + losses;

  return {
    period,
    totalPnl: parseFloat(row?.totalPnl ?? "0").toFixed(6),
    totalTrades: Number(row?.totalTrades ?? 0),
    wins,
    losses,
    winRate: closed > 0 ? ((wins / closed) * 100).toFixed(2) : "0.00",
    avgWin: wins > 0 ? (totalWin / wins).toFixed(6) : "0",
    avgLoss: losses > 0 ? (totalLoss / losses).toFixed(6) : "0",
    totalWin: totalWin.toFixed(6),
    totalLoss: totalLoss.toFixed(6),
  };
}
