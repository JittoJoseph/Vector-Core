import {
  GammaMarketSchema,
  type GammaMarket,
} from "../src/types/index.js";

const HISTORY_URL = "https://vector-core.onrender.com/api/trades/history";
const PAGE_SIZE = 200;
const YES_LOSS_FACTOR = Math.min(
  1,
  Math.max(0, Number(process.env.YES_LOSS_FACTOR ?? "1")),
);

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
  entryPrice: string;
  entryShares: string;
  actualCost: string;
  entryFees: string;
  realizedPnl?: string | number | null;
  status?: string | null;
  campaignEndDate?: string | null;
};

type Outcome = "YES" | "NO" | "UNKNOWN";

type SimTrade = {
  trade: TradeHistoryRow;
  market: GammaMarket;
  outcome: Exclude<Outcome, "UNKNOWN">;
  actualPnl: number;
  roi: number;
  entryBudget: number;
  settlementTs: number;
};

type Event =
  | {
      kind: "ENTRY";
      time: number;
      trade: SimTrade;
    }
  | {
      kind: "SETTLEMENT";
      time: number;
      trade: SimTrade;
    };

type OpenPosition = {
  tradeId: string;
  budget: number;
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

function parseOutcome(value: unknown): Outcome {
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
  const url = `https://gamma-api.polymarket.com/markets/${encodeURIComponent(bucketId)}`;
  const data = await fetchJson<unknown>(url);
  return GammaMarketSchema.parse(data);
}

function determineResolvedOutcome(market: GammaMarket): Outcome {
  const outcomes = parseJsonArray(market.outcomes).map(parseOutcome);
  const prices = parseJsonArray(market.outcomePrices)
    .map(Number)
    .filter((value) => Number.isFinite(value));

  if (!outcomes.length || !prices.length) return "UNKNOWN";

  let winnerIndex = 0;
  for (let i = 1; i < prices.length; i += 1) {
    if (prices[i]! > prices[winnerIndex]!) winnerIndex = i;
  }

  const winnerPrice = prices[winnerIndex] ?? NaN;
  if (!Number.isFinite(winnerPrice) || winnerPrice < 0.99) return "UNKNOWN";

  return outcomes[winnerIndex] ?? "UNKNOWN";
}

function calculateActualPnl(
  trade: TradeHistoryRow,
  outcome: Exclude<Outcome, "UNKNOWN">,
): number {
  const entryPrice = Number(trade.entryPrice);
  const shares = Number(trade.entryShares);
  const fees = Number(trade.entryFees);

  if (!Number.isFinite(entryPrice) || !Number.isFinite(shares) || !Number.isFinite(fees)) {
    throw new Error(`Invalid trade economics for trade ${trade.id}`);
  }

  if (outcome === "NO") {
    return (1 - entryPrice) * shares - fees;
  }

  return -((entryPrice * shares + fees) * YES_LOSS_FACTOR);
}

function clampBudget(portfolioValue: number): number {
  return Math.min(20, Math.max(5, portfolioValue / 5));
}

function fmt(n: number, digits = 4): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "-";
}

function fmtTime(value: string): string {
  return value.slice(0, 19).replace("T", " ");
}

function classifyResult(trade: SimTrade): string {
  if (trade.trade.exitReason === "EARLY_EXIT") {
    return trade.outcome === "NO" ? "FAKE-OUT WIN" : "STOP-LOSS LOSS";
  }

  return trade.outcome === "NO" ? "WIN" : "LOSS";
}

async function main() {
  const trades = await fetchAllTrades();

  if (!trades.length) {
    console.log("No trades found.");
    return;
  }

  const marketCache = new Map<string, GammaMarket>();
  const simTrades: SimTrade[] = [];

  for (const trade of trades) {
    let market = marketCache.get(trade.bucketId);
    if (!market) {
      market = await fetchMarket(trade.bucketId);
      marketCache.set(trade.bucketId, market);
    }

    const outcome = determineResolvedOutcome(market);
    if (outcome === "UNKNOWN") continue;

    const actualPnl = calculateActualPnl(trade, outcome);
    const actualCost = Number(trade.actualCost);
    if (!Number.isFinite(actualCost) || actualCost <= 0) continue;

    const roi = actualPnl / actualCost;
    const settlementTs = Date.parse(trade.campaignEndDate ?? market.endDate ?? trade.exitTs ?? trade.entryTs);

    simTrades.push({
      trade,
      market,
      outcome,
      actualPnl,
      roi,
      entryBudget: 0,
      settlementTs: Number.isFinite(settlementTs) ? settlementTs : Date.parse(trade.entryTs),
    });
  }

  simTrades.sort((a, b) => {
    const left = Date.parse(a.trade.entryTs) - Date.parse(b.trade.entryTs);
    if (left !== 0) return left;
    return a.trade.id.localeCompare(b.trade.id);
  });

  const events: Event[] = [];
  for (const trade of simTrades) {
    events.push({ kind: "ENTRY", time: Date.parse(trade.trade.entryTs), trade });
    events.push({ kind: "SETTLEMENT", time: trade.settlementTs, trade });
  }

  events.sort((left, right) => {
    if (left.time !== right.time) return left.time - right.time;
    if (left.kind !== right.kind) return left.kind === "SETTLEMENT" ? -1 : 1;
    return left.trade.trade.id.localeCompare(right.trade.trade.id);
  });

  const initialCapital = 50;
  let cash = initialCapital;
  const openPositions = new Map<string, OpenPosition>();
  let minCash = cash;
  let minPortfolioValue = cash;
  let peakPortfolioValue = cash;
  let maxDrawdown = 0;
  let totalResolved = 0;
  let wins = 0;
  let losses = 0;
  let fakeOuts = 0;
  let stopLossExits = 0;
  let recoveredStopLosses = 0;

  console.log("NO-STOP-LOSS SIMULATION");
  console.log("=======================");
  console.log(`Initial capital : $${fmt(initialCapital, 2)}`);
  console.log(`Resolved trades  : ${simTrades.length}`);
  console.log(`YES loss factor  : ${fmt(YES_LOSS_FACTOR, 2)}`);
  console.log(`Start rule       : max(min(portfolio / 5, 20), 5)`);
  console.log(`Portfolio value  : cash + open positions at cost`);
  console.log();
  console.log(
    [
      "Time".padEnd(19),
      "Kind".padEnd(10),
      "Budget".padStart(8),
      "PnL".padStart(10),
      "Cash".padStart(10),
      "Equity".padStart(10),
      "Result".padEnd(14),
      "Market",
    ].join(" | "),
  );

  for (const event of events) {
    const timeLabel = fmtTime(event.trade.trade.entryTs);

    if (event.kind === "SETTLEMENT") {
      const open = openPositions.get(event.trade.trade.id);
      if (!open) continue;

      const simPnl = open.budget * event.trade.roi;
      cash += open.budget + simPnl;
      openPositions.delete(event.trade.trade.id);

      const equity = cash + [...openPositions.values()].reduce((sum, position) => sum + position.budget, 0);
      minCash = Math.min(minCash, cash);
      minPortfolioValue = Math.min(minPortfolioValue, equity);
      peakPortfolioValue = Math.max(peakPortfolioValue, equity);
      maxDrawdown = Math.max(maxDrawdown, peakPortfolioValue - equity);

      totalResolved += 1;
      if (event.trade.outcome === "NO") {
        wins += 1;
      } else {
        losses += 1;
      }
      if (event.trade.trade.exitReason === "EARLY_EXIT") {
        stopLossExits += 1;
        if (event.trade.outcome === "NO") recoveredStopLosses += 1;
      }
      if (event.trade.trade.exitReason === "EARLY_EXIT" && event.trade.outcome === "NO") {
        fakeOuts += 1;
      }

      console.log(
        [
          timeLabel.padEnd(19),
          "SETTLE".padEnd(10),
          fmt(open.budget, 2).padStart(8),
          fmt(simPnl, 4).padStart(10),
          fmt(cash, 4).padStart(10),
          fmt(equity, 4).padStart(10),
          classifyResult(event.trade).padEnd(14),
          event.trade.market.question ?? event.trade.trade.bucketSlug ?? event.trade.trade.bucketId,
        ].join(" | "),
      );
      continue;
    }

    const portfolioValue = cash + [...openPositions.values()].reduce((sum, position) => sum + position.budget, 0);
    const budget = clampBudget(portfolioValue);
    cash -= budget;
    openPositions.set(event.trade.trade.id, { tradeId: event.trade.trade.id, budget });

    const equity = cash + [...openPositions.values()].reduce((sum, position) => sum + position.budget, 0);
    minCash = Math.min(minCash, cash);
    minPortfolioValue = Math.min(minPortfolioValue, equity);
    peakPortfolioValue = Math.max(peakPortfolioValue, equity);
    maxDrawdown = Math.max(maxDrawdown, peakPortfolioValue - equity);

    console.log(
      [
        timeLabel.padEnd(19),
        "ENTRY".padEnd(10),
        fmt(budget, 2).padStart(8),
        "-".padStart(10),
        fmt(cash, 4).padStart(10),
        fmt(equity, 4).padStart(10),
        "OPEN".padEnd(14),
        event.trade.market.question ?? event.trade.trade.bucketSlug ?? event.trade.trade.bucketId,
      ].join(" | "),
    );

    event.trade.entryBudget = budget;
  }

  const unresolved = trades.length - simTrades.length;
  const finalPortfolioValue = cash + [...openPositions.values()].reduce((sum, position) => sum + position.budget, 0);

  console.log();
  console.log("SUMMARY");
  console.log("=======");
  console.log(`Simulated trades      : ${simTrades.length}`);
  console.log(`Ignored unresolved    : ${unresolved}`);
  console.log(`Wins                  : ${wins}`);
  console.log(`Losses                : ${losses}`);
  console.log(`Stop-loss exits       : ${stopLossExits}`);
  console.log(`Fake-out stop-losses  : ${recoveredStopLosses}`);
  console.log(`Fake-out rate         : ${stopLossExits ? ((recoveredStopLosses / stopLossExits) * 100).toFixed(1) : "0.0"}%`);
  console.log(`Final cash            : $${fmt(cash, 4)}`);
  console.log(`Final equity          : $${fmt(finalPortfolioValue, 4)}`);
  console.log(`Lowest cash           : $${fmt(minCash, 4)}`);
  console.log(`Lowest equity         : $${fmt(minPortfolioValue, 4)}`);
  console.log(`Max drawdown          : $${fmt(maxDrawdown, 4)}`);
  console.log(`Survived?             : ${minPortfolioValue > 0 ? "YES" : "NO"}`);
  console.log(`Cash survived?        : ${minCash > 0 ? "YES" : "NO"}`);
  console.log(`Open positions left   : ${openPositions.size}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});