import type { Orderbook } from "../types/index.js";

export const QUOTE_WINDOW_MS = 20 * 60 * 1000;
export const MAX_QUOTE_SAMPLES = 90;
const DEPTH_BAND = 0.05;

export interface QuoteSample {
  t: number;
  bid: number;
  ask: number;
}

export interface EntryQuality {
  samples: number;
  windowSec: number;
  updatesPerMin: number;
  staleSec: number;
  spreadMean: number;
  spreadMax: number;
  spreadP90: number;
  spreadOkFrac: number;
  bidChanges: number;
  askChanges: number;
  bidDepth: number;
  askDepth: number;
  imbalance: number;
  levels: number;
}

export function recordQuote(
  quotes: QuoteSample[],
  sample: QuoteSample,
): QuoteSample[] {
  quotes.push(sample);
  const cutoff = sample.t - QUOTE_WINDOW_MS;
  const from = quotes.findIndex((q) => q.t >= cutoff);
  const trimmed = from > 0 ? quotes.slice(from) : quotes;
  return trimmed.length > MAX_QUOTE_SAMPLES
    ? trimmed.slice(trimmed.length - MAX_QUOTE_SAMPLES)
    : trimmed;
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
  quotes: QuoteSample[],
  book: Orderbook,
  bestBid: number,
  bestAsk: number,
  spreadLimit: number,
  now: number,
): EntryQuality {
  const win = quotes.filter((q) => q.t >= now - QUOTE_WINDOW_MS);
  const spreads = win.map((q) => q.ask - q.bid).filter(Number.isFinite);
  const n = spreads.length;
  const sorted = [...spreads].sort((a, b) => a - b);
  const mean = n ? spreads.reduce((s, x) => s + x, 0) / n : 0;

  let bidChanges = 0;
  let askChanges = 0;
  for (let i = 1; i < win.length; i++) {
    if (win[i]!.bid !== win[i - 1]!.bid) bidChanges++;
    if (win[i]!.ask !== win[i - 1]!.ask) askChanges++;
  }

  const spanMs = win.length > 1 ? win[win.length - 1]!.t - win[0]!.t : 0;
  const bidDepth = depthWithin(book.bids, bestBid, "bid");
  const askDepth = depthWithin(book.asks, bestAsk, "ask");

  const r4 = (x: number) => Math.round(x * 10000) / 10000;
  return {
    samples: n,
    windowSec: Math.round(spanMs / 1000),
    updatesPerMin: spanMs > 0 ? r4((win.length / spanMs) * 60000) : 0,
    staleSec: win.length ? Math.round((now - win[win.length - 1]!.t) / 1000) : -1,
    spreadMean: r4(mean),
    spreadMax: n ? r4(sorted[n - 1]!) : 0,
    spreadP90: n ? r4(sorted[Math.min(n - 1, Math.floor(n * 0.9))]!) : 0,
    spreadOkFrac: n
      ? r4(spreads.filter((s) => s <= spreadLimit).length / n)
      : 0,
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
