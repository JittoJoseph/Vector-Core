import type { Orderbook } from "../types/index.js";

export const WINDOW_MINUTES = 20;
const DEPTH_BAND = 0.05;

interface MinuteBucket {
  minute: number;
  updates: number;
  spreadSum: number;
  spreadSqSum: number;
  spreadMax: number;
  tight: number;
  bidChanges: number;
  askChanges: number;
}

export interface QuoteStats {
  buckets: MinuteBucket[];
  lastBid: number;
  lastAsk: number;
  lastT: number;
}

export interface EntryQuality {
  activeMinutes: number;
  updates: number;
  staleSec: number;
  spreadMean: number;
  spreadStd: number;
  spreadMax: number;
  spreadWorstMin: number;
  spreadOkFrac: number;
  bidChanges: number;
  askChanges: number;
  bidDepth: number;
  askDepth: number;
  imbalance: number;
  levels: number;
}

export function createQuoteStats(): QuoteStats {
  return {
    buckets: Array.from({ length: WINDOW_MINUTES }, () => ({
      minute: -1,
      updates: 0,
      spreadSum: 0,
      spreadSqSum: 0,
      spreadMax: 0,
      tight: 0,
      bidChanges: 0,
      askChanges: 0,
    })),
    lastBid: 0,
    lastAsk: 0,
    lastT: 0,
  };
}

export function recordQuote(
  stats: QuoteStats,
  bid: number,
  ask: number,
  spreadLimit: number,
  now: number,
): void {
  const minute = Math.floor(now / 60000);
  const b = stats.buckets[minute % WINDOW_MINUTES]!;
  if (b.minute !== minute) {
    b.minute = minute;
    b.updates = 0;
    b.spreadSum = 0;
    b.spreadSqSum = 0;
    b.spreadMax = 0;
    b.tight = 0;
    b.bidChanges = 0;
    b.askChanges = 0;
  }

  const spread = Math.round((ask - bid) * 10000) / 10000;
  b.updates++;
  b.spreadSum += spread;
  b.spreadSqSum += spread * spread;
  if (spread > b.spreadMax) b.spreadMax = spread;
  if (spread <= spreadLimit) b.tight++;
  if (stats.lastT > 0) {
    if (bid !== stats.lastBid) b.bidChanges++;
    if (ask !== stats.lastAsk) b.askChanges++;
  }

  stats.lastBid = bid;
  stats.lastAsk = ask;
  stats.lastT = now;
}

function depthWithin(
  levels: { price: string; size: string }[],
  best: number,
  side: "bid" | "ask",
): number {
  let total = 0;
  for (const l of levels) {
    const p = parseFloat(l.price);
    const s = parseFloat(l.size);
    if (!Number.isFinite(p) || !Number.isFinite(s)) continue;
    const inBand =
      side === "bid" ? p >= best - DEPTH_BAND : p <= best + DEPTH_BAND;
    if (inBand) total += s;
  }
  return Math.round(total);
}

export function buildEntryQuality(
  stats: QuoteStats,
  book: Orderbook,
  bestBid: number,
  bestAsk: number,
  now: number,
): EntryQuality {
  const currentMinute = Math.floor(now / 60000);
  let activeMinutes = 0;
  let updates = 0;
  let sum = 0;
  let sqSum = 0;
  let max = 0;
  let tight = 0;
  let bidChanges = 0;
  let askChanges = 0;
  let worstMin = 0;

  for (const b of stats.buckets) {
    if (b.minute < 0 || currentMinute - b.minute >= WINDOW_MINUTES) continue;
    if (b.updates === 0) continue;
    activeMinutes++;
    updates += b.updates;
    sum += b.spreadSum;
    sqSum += b.spreadSqSum;
    tight += b.tight;
    bidChanges += b.bidChanges;
    askChanges += b.askChanges;
    if (b.spreadMax > max) max = b.spreadMax;
    const minuteMean = b.spreadSum / b.updates;
    if (minuteMean > worstMin) worstMin = minuteMean;
  }

  const mean = updates ? sum / updates : 0;
  const variance = updates ? Math.max(0, sqSum / updates - mean * mean) : 0;
  const bidDepth = depthWithin(book.bids, bestBid, "bid");
  const askDepth = depthWithin(book.asks, bestAsk, "ask");
  const r4 = (x: number) => Math.round(x * 10000) / 10000;

  return {
    activeMinutes,
    updates,
    staleSec: stats.lastT
      ? Math.max(0, Math.round((now - stats.lastT) / 1000))
      : -1,
    spreadMean: r4(mean),
    spreadStd: r4(Math.sqrt(variance)),
    spreadMax: r4(max),
    spreadWorstMin: r4(worstMin),
    spreadOkFrac: updates ? r4(tight / updates) : 0,
    bidChanges,
    askChanges,
    bidDepth,
    askDepth,
    imbalance:
      bidDepth + askDepth > 0
        ? r4((bidDepth - askDepth) / (bidDepth + askDepth))
        : 0,
    levels: book.bids.length + book.asks.length,
  };
}
