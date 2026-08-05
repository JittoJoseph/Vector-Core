import { GammaMarketSchema, POLY_URLS, type GammaMarket } from "../src/types/index.js";

const HISTORY_URL = "https://vector-core.onrender.com/api/trades/history";
const PAGE_SIZE = 200;

type TradeHistoryRow = {
  id: string;
  bucketId: string;
  campaignTitle?: string | null;
  campaignSlug?: string | null;
  bucketSlug?: string | null;
  bucketGroupTitle?: string | null;
  tokenId: string;
  entryTs: string;
  exitTs?: string | null;
  exitReason?: string | null;
  exitOutcome?: string | null;
  realizedPnl?: string | number | null;
  status?: string | null;
};

type AuditedTrade = TradeHistoryRow & {
  actualOutcome: "YES" | "NO" | "UNKNOWN";
  resolved: boolean;
  marketClosed: boolean;
  marketQuestion: string;
};

function parseJsonArray(value: string | null | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeOutcome(value: unknown): "YES" | "NO" | "UNKNOWN" {
  if (typeof value !== "string") return "UNKNOWN";
  const upper = value.trim().toUpperCase();
  if (upper === "YES") return "YES";
  if (upper === "NO") return "NO";
  return "UNKNOWN";
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "VectorCore/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed ${response.status} ${response.statusText} for ${url}`);
  }

  return (await response.json()) as T;
}

async function fetchAllTrades(): Promise<TradeHistoryRow[]> {
  const trades: TradeHistoryRow[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await fetchJson<TradeHistoryRow[]>(
      `${HISTORY_URL}?limit=${PAGE_SIZE}&offset=${offset}`,
    );

    if (!page.length) break;

    trades.push(...page);

    if (page.length < PAGE_SIZE) break;
  }

  return trades;
}

async function fetchMarket(bucketId: string): Promise<GammaMarket> {
  const url = `${POLY_URLS.GAMMA_API_BASE}/markets/${encodeURIComponent(bucketId)}`;
  const data = await fetchJson<unknown>(url);
  return GammaMarketSchema.parse(data);
}

function determineActualOutcome(market: GammaMarket): {
  resolved: boolean;
  actualOutcome: "YES" | "NO" | "UNKNOWN";
} {
  if (!market.closed) {
    return { resolved: false, actualOutcome: "UNKNOWN" };
  }

  const outcomes = parseJsonArray(market.outcomes).map(normalizeOutcome);
  const prices = parseJsonArray(market.outcomePrices)
    .map(Number)
    .filter((value) => Number.isFinite(value));

  if (!outcomes.length || !prices.length) {
    return { resolved: false, actualOutcome: "UNKNOWN" };
  }

  let winnerIndex = 0;
  for (let i = 1; i < prices.length; i += 1) {
    if (prices[i]! > prices[winnerIndex]!) winnerIndex = i;
  }

  const maxPrice = prices[winnerIndex] ?? NaN;
  if (!Number.isFinite(maxPrice) || maxPrice < 0.99) {
    return { resolved: false, actualOutcome: "UNKNOWN" };
  }

  const actualOutcome = outcomes[winnerIndex] ?? "UNKNOWN";
  if (actualOutcome === "UNKNOWN") {
    return { resolved: false, actualOutcome: "UNKNOWN" };
  }

  return { resolved: true, actualOutcome };
}

function pct(part: number, total: number): string {
  if (!total) return "0.0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value.padEnd(width, " ");
}

async function main() {
  const trades = await fetchAllTrades();

  if (!trades.length) {
    console.log("No settled trades found.");
    return;
  }

  const marketCache = new Map<string, GammaMarket>();
  const audited: AuditedTrade[] = [];

  for (const trade of trades) {
    let market = marketCache.get(trade.bucketId);
    if (!market) {
      market = await fetchMarket(trade.bucketId);
      marketCache.set(trade.bucketId, market);
    }

    const result = determineActualOutcome(market);

    audited.push({
      ...trade,
      actualOutcome: result.actualOutcome,
      resolved: result.resolved,
      marketClosed: Boolean(market.closed),
      marketQuestion: market.question ?? trade.campaignTitle ?? trade.bucketSlug ?? trade.bucketId,
    });
  }

  const resolved = audited.filter((trade) => trade.resolved);
  const unresolved = audited.filter((trade) => !trade.resolved);
  const actualNoWins = resolved.filter((trade) => trade.actualOutcome === "NO");
  const actualYesLosses = resolved.filter((trade) => trade.actualOutcome === "YES");
  const stopLossTrades = resolved.filter((trade) => trade.exitReason === "EARLY_EXIT");
  const recoveredStopLosses = stopLossTrades.filter(
    (trade) => trade.actualOutcome === "NO",
  );
  const unrecoveredStopLosses = stopLossTrades.filter(
    (trade) => trade.actualOutcome === "YES",
  );

  console.log("TRADE OUTCOME AUDIT");
  console.log("===================");
  console.log(`Fetched trades            : ${audited.length}`);
  console.log(`Resolved markets          : ${resolved.length}`);
  console.log(`Unresolved markets        : ${unresolved.length}`);
  console.log(`Actual NO outcomes        : ${actualNoWins.length}`);
  console.log(`Actual YES outcomes       : ${actualYesLosses.length}`);
  console.log(`Stop-loss exits           : ${stopLossTrades.length}`);
  console.log(`Recovered stop-loss exits : ${recoveredStopLosses.length}`);
  console.log(
    `Recovered stop-loss rate  : ${pct(recoveredStopLosses.length, stopLossTrades.length)}`,
  );
  console.log(
    `Actual NO rate overall    : ${pct(actualNoWins.length, resolved.length)}`,
  );

  if (recoveredStopLosses.length) {
    console.log();
    console.log("RECOVERED STOP-LOSS TRADES");
    console.log("==========================");
    for (const trade of recoveredStopLosses) {
      console.log(
        [
          pad(trade.entryTs.slice(0, 19).replace("T", " "), 19),
          pad(trade.bucketId, 8),
          pad(trade.actualOutcome, 7),
          pad(trade.exitOutcome ?? "-", 6),
          pad(trade.exitReason ?? "-", 11),
          trade.campaignTitle ?? trade.bucketSlug ?? trade.marketQuestion,
        ].join(" | "),
      );
    }
  }

  if (unresolved.length) {
    console.log();
    console.log("UNRESOLVED MARKETS");
    console.log("===================");
    for (const trade of unresolved.slice(0, 25)) {
      console.log(
        [
          pad(trade.entryTs.slice(0, 19).replace("T", " "), 19),
          pad(trade.bucketId, 8),
          pad(trade.exitOutcome ?? "-", 6),
          pad(trade.exitReason ?? "-", 11),
          trade.campaignTitle ?? trade.bucketSlug ?? trade.marketQuestion,
        ].join(" | "),
      );
    }

    if (unresolved.length > 25) {
      console.log(`... and ${unresolved.length - 25} more unresolved markets`);
    }
  }

  console.log();
  console.log("BY RECORDED OUTCOME");
  console.log("===================");
  console.log(
    `Recorded LOSS -> actual NO : ${resolved.filter((trade) => trade.exitOutcome === "LOSS" && trade.actualOutcome === "NO").length}`,
  );
  console.log(
    `Recorded LOSS -> actual YES: ${resolved.filter((trade) => trade.exitOutcome === "LOSS" && trade.actualOutcome === "YES").length}`,
  );
  console.log(
    `Recorded WIN  -> actual NO : ${resolved.filter((trade) => trade.exitOutcome === "WIN" && trade.actualOutcome === "NO").length}`,
  );
  console.log(
    `Recorded WIN  -> actual YES: ${resolved.filter((trade) => trade.exitOutcome === "WIN" && trade.actualOutcome === "YES").length}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});