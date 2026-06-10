export interface DistributionCampaign {
  id: string;
  slug: string;
  title: string;
  seriesSlug: string | null;
  startDate: string | null;
  endDate: string | null;
  active: boolean;
  closed: boolean;
  lastFetchedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface DistributionBucket {
  id: string;
  campaignId: string;
  conditionId: string | null;
  groupItemTitle: string;
  yesTokenId: string;
  noTokenId: string;
  yesPrice: string | null;
  noPrice: string | null;
  spread: string | null;
  liquidityNum: string | null;
  volume24h: string | null;
  lastFetchedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Opportunity {
  id: string;
  marketId: string;
  eventId: string;
  noTokenId: string;
  status: string;
  reason: string | null;
  deadline: string;
  daysToDeadline: string | null;
  noPrice: string | null;
  noBestBid: string | null;
  noBestAsk: string | null;
  spread: string | null;
  depthAtLimit: string | null;
  expectedNetProfit: string | null;
  raw: unknown;
  createdAt: string;
}

export interface LiveMarketPrice {
  bid: number;
  ask: number;
  mid: number;
}

export interface LiveMarketInfo {
  marketId: string;
  eventId: string;
  eventSlug: string;
  eventTitle: string;
  question: string;
  slug: string | null;
  deadline: string;
  deadlineDate: string;
  yesTokenId: string;
  noTokenId: string;
  noPrice: number | null;
  markPrice: Record<string, { bid: number; ask: number; mid: number }>;
  status: "OPEN" | "AWAITING_RESOLUTION" | "RESOLVED";
  hasPosition: boolean;
  // legacy aliases
  endDate?: string;
  windowStart?: string;
  btcPriceAtWindowStart?: number | null;
}

export interface SimulatedTrade {
  id: string;
  eventId: string | null;
  eventSlug: string | null;
  eventTitle: string | null;
  marketId: string | null;
  marketSlug: string | null;
  marketQuestion: string | null;
  campaignId?: string | null;
  campaignTitle?: string | null;
  bucketGroupTitle?: string | null;
  campaignEndDate: string | null;
  tokenId: string | null;
  outcomeLabel: string | null;
  side: string;
  orderType: string;
  entryTs: string;
  entryPrice: string;
  entryShares: string;
  positionBudget: string;
  actualCost: string;
  entryFees: string | null;
  fillStatus: string | null;
  expectedNetProfit: string | null;
  noBestBidAtEntry: string | null;
  noBestAskAtEntry: string | null;
  depthAtLimit: string | null;
  exitPrice: string | null;
  exitTs: string | null;
  exitOutcome: string | null;
  exitReason: string | null;
  realizedPnl: string | null;
  status: string;
  orderbookSnapshot: unknown;
  raw: unknown;
  createdAt: string;
  updatedAt: string;
  // legacy optional fields retained for old components
  marketCategory?: string | null;
  windowType?: string | null;
  btcPriceAtEntry?: string | null;
  btcTargetPrice?: string | null;
  btcDistanceUsd?: string | null;
  momentumDirection?: string | null;
  momentumChangeUsd?: string | null;
  marketEndDate?: string | null;
  minPriceDuringPosition?: string | null;
  crossovers?: {
    all: number;
    last60s: number;
    details: Array<{ side: "UP" | "DOWN"; ts: number }>;
  };
}

export interface SystemStats {
  orchestrator: {
    running: boolean;
    paused: boolean;
    activeMarkets: number;
    openPositions: number;
    cycleCount: number;
    scanner: {
      discoveredLadders: number;
      evaluatedOpportunities: number;
    };
    ws: {
      connected: boolean;
      subscribedTokens: number;
      messageCount: number;
      reconnectAttempts: number;
    };
    strategy: {
      watchedTokens: number;
      triggersCount: number;
      evaluatedTokens: number;
    };
    risk?: {
      consecutiveLossCount: number;
      consecutiveLossPauseLimit: number;
      pausedByRiskGuard: boolean;
      riskPauseTriggeredAt: number | null;
    };
    btcConnected?: boolean;
    btcPrice?: number | null;
    momentum?: null;
  };
  config: {
    deadlineLookaheadDays: number;
    minNoEntryPrice: number;
    maxNoEntryPrice: number;
    maxSpread: number;
    minLiquidityNum: number;
    minVolume24h: number;
    minExpectedNetProfit: number;
    startingCapital: number;
    maxPositions: number;
    // legacy optional config
    marketWindow?: string;
    entryPriceThreshold?: number;
    maxEntryPrice?: number;
    tradeFromWindowSeconds?: number;
    minBtcDistanceUsd?: number;
  };
}

export interface PerformanceMetrics {
  period: string;
  totalPnl: string;
  totalDeployed: string;
  roi: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: string;
  avgWin: string;
  avgLoss: string;
  largestWin: string;
  largestLoss: string;
  totalFees: string;
  openPositions: number;
  unrealizedPnl: string;
  cashBalance: string;
  initialCapital: string;
  openPositionsValue: string;
  avgBtcDistance?: string;
}

export interface PortfolioState {
  initialCapital: number;
  cashBalance: number;
  openPositionsValue: number;
  portfolioValue: number;
  roi: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  level: string;
  category: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ActivityEntry {
  id: string;
  kind:
    | "TRADE_OPENED"
    | "TRADE_WIN"
    | "TRADE_LOSS"
    | "MOMENTUM_SKIP"
    | "MARKET_RESOLVED"
    | "SYSTEM"
    | "INFO"
    | "WARN"
    | "ERROR";
  title: string;
  detail: string;
  ts: number;
  trade?: SimulatedTrade;
  pnl?: number;
}

export interface HealthResponse {
  status: string;
  uptime: number;
  [key: string]: unknown;
}

export interface WsMessage {
  type: "systemState" | "tradeOpened" | "tradeResolved" | "btcPriceUpdate" | "pong";
  data?: unknown;
}

export interface MonteCarloResult {
  config: { simulations: number; tradesPerSim: number };
  historical: {
    totalSettled: number;
    wins: number;
    losses: number;
    winRate: number;
    avgWinPnl: number;
    avgLossPnl: number;
    avgWinPct: number;
    avgLossPct: number;
    largestWin: number;
    largestLoss: number;
    profitFactor: number;
    expectancy: number;
  };
  distribution: {
    histogram: Array<{ min: number; max: number; count: number }>;
    percentiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
    mean: number;
    stdDev: number;
    profitProbability: number;
    ruinProbability: number;
  };
  equityCurves: Array<{ percentile: number; curve: Array<{ tradeIndex: number; balance: number }> }>;
  drawdown: { median: number; p95: number; worst: number };
  startingCapital: number;
}

export type MarketWindow = "5M" | "15M" | "1H" | "4H" | "1D";
export const MARKET_WINDOW_LABELS: Record<MarketWindow, string> = {
  "5M": "LEGACY",
  "15M": "LEGACY",
  "1H": "LEGACY",
  "4H": "LEGACY",
  "1D": "LEGACY",
};
export function getMarketWindowDurationMs(_windowType?: string | null): number {
  return 0;
}
