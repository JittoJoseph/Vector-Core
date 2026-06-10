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

  // Computed API fields
  modalBucketTitle?: string;
  candidateCount?: number;
  trackedCount?: number;
  positionCount?: number;
  relevantBuckets?: DistributionBucket[];
}

export interface DistributionBucket {
  id: string;
  campaignId: string;
  conditionId: string | null;
  slug: string | null;
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
  hasOpenPosition?: boolean;
}

export interface Opportunity {
  bucketId: string;
  campaignId: string;
  noTokenId: string;
  status: string;
  reason: string | null;
  noPrice: string | null;
  noBestBid: string | null;
  noBestAsk: string | null;
  spread: string | null;
  depthAtLimit: string | null;
  expectedNetProfit: string | null;
  expectedReturnPercent: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LiveMarketPrice {
  bid: number;
  ask: number;
  mid: number;
}

export interface LiveMarketInfo {
  marketId: string;
  yesTokenId: string;
  noTokenId: string;
  noPrice: number | null;
  markPrice: Record<string, { bid: number; ask: number; mid: number }>;
  status: "OPEN" | "AWAITING_RESOLUTION" | "RESOLVED";
}

export interface SimulatedTrade {
  id: string;
  campaignId?: string | null;
  campaignSlug?: string | null;
  campaignTitle?: string | null;
  bucketId?: string | null;
  bucketSlug: string | null;
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
  createdAt: string;
  updatedAt: string;
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
