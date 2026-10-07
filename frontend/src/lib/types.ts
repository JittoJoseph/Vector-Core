export interface ForecastSummary {
  init: string;
  publishedAt: string;
  fmaxC: number;
  mu: number;
  sigma: number;
}

export interface ActiveCampaign {
  id: string;
  slug: string;
  title: string;
  city: string;
  unit: "C" | "F";
  endDate: string;
  forecast: ForecastSummary | null;
  modelTop: { title: string; p: number } | null;
  marketTop: { title: string; mid: number } | null;
  bestEdge: number | null;
  positionCount: number;
}

export interface HistoryCampaign {
  id: string;
  slug: string;
  title: string;
  endDate: string;
  closed: boolean;
  closedTime: string | null;
  forecast: ForecastSummary | null;
  tradeCount: number;
  totalPnl: number;
}

export interface CampaignBucket {
  id: string;
  slug: string | null;
  title: string;
  bid: number | null;
  ask: number | null;
  model: number | null;
  edge: number | null;
  positions: {
    id: string;
    entryPrice: number;
    shares: number;
    target: number;
  }[];
}

export type CampaignDetail =
  | (ActiveCampaign & { buckets: CampaignBucket[] })
  | (Omit<HistoryCampaign, "tradeCount" | "totalPnl"> & { trades: Trade[] });

export interface TradeSignal {
  init: string;
  leadH: number;
  pModel: number;
  quote: number;
  edge: number;
}

export interface Trade {
  id: string;
  campaignId: string;
  campaignSlug: string;
  campaignTitle: string;
  bucketId: string;
  bucketSlug: string | null;
  bucketGroupTitle: string;
  campaignEndDate: string | null;
  tokenId: string;
  entryTs: string;
  entryPrice: string;
  entryShares: string;
  actualCost: string;
  entryFees: string;
  sharesSold: string;
  target: string;
  signal: TradeSignal;
  minPriceDuringPosition: string | null;
  exitPrice: string | null;
  exitTs: string | null;
  exitOutcome: string | null;
  exitReason: string | null;
  realizedPnl: string | null;
  status: string;
  exits?: TradeExit[];
}

export interface TradeExit {
  id: string;
  tradeId: string;
  ts: string;
  reason: string;
  shares: string;
  price: string;
  fees: string;
  proceeds: string;
  costBasis: string;
  pnl: string;
}

export interface TradeHistoryRow {
  exit: TradeExit;
  trade: Trade;
}

export interface PositionPnl {
  mid: number | null;
  pnl: number | null;
  pnlPct: number | null;
  minPrice: number | null;
}

export interface PortfolioSnapshot {
  initialCapital: number;
  realizedPnl: number;
  unrealizedPnl: number;
  netPnl: number;
  portfolioValue: number;
  roi: number;
  cashBalance: number;
  openPositionsValue: number;
  openPositions: number;
}

export interface WeatherNextStats {
  lastInit: string | null;
  lastPublishedAt: string | null;
  lastFetchMs: number;
  runsProcessed: number;
  lastPollAt: string | null;
  lastError: string | null;
  lastEvaluation: {
    at: string;
    init: string;
    covered: number;
    entries: number;
    exits: number;
  } | null;
}

export interface SystemStats {
  orchestrator: {
    running: boolean;
    paused: boolean;
    campaigns: number;
    openPositions: number;
    ws: {
      connected: boolean;
      subscribedTokens: number;
      messageCount: number;
      reconnectAttempts: number;
    };
    weathernext: WeatherNextStats;
    polymarketStatus: "UNKNOWN" | "UP" | "HASISSUES" | "UNDERMAINTENANCE";
  };
  config: {
    startingCapital: number;
    tradeBudget: number;
    minEdge: number;
    minEntryLeadHours: number;
    partialTakeProfitAt: number;
    maxSpread: number;
    minPrice: number;
    maxPrice: number;
    stopLossDelta: number;
  };
  portfolio: PortfolioSnapshot;
  positionsPnl: Record<string, PositionPnl>;
}

export interface PerformanceMetrics {
  period: string;
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
  kind: "TRADE_OPENED" | "TRADE_WIN" | "TRADE_LOSS" | "INFO" | "WARN" | "ERROR";
  title: string;
  detail: string;
  ts: number;
  pnl?: number;
}

export interface WsMessage {
  type: "systemState" | "tradeOpened" | "tradeResolved" | "pong";
  data?: unknown;
}

export interface CityReadiness {
  city: string;
  status: "ready" | "partial" | "blocked";
  correctionC: number | null;
  correctionReason: string | null;
  residuals14d: number;
  minResiduals: number;
  openLadders: number;
  blockedLadders: { title: string; reason: string; since: string }[];
  bucketsWithoutFee: number;
}

export interface Readiness {
  checkedAt: string;
  feed: {
    lastInit: string | null;
    lastPublishedAt: string | null;
    lastError: string | null;
  };
  correction: {
    residuals7d: number;
    days7d: number;
    minDays: number;
    meanC: number | null;
    ready: boolean;
  };
  backfill: {
    state: "idle" | "running" | "done" | "failed";
    startedAt: string | null;
    finishedAt: string | null;
    missing: number;
    recorded: number;
    skipped: Record<string, number>;
    error: string | null;
  };
  unpricedPositions: number;
  cities: CityReadiness[];
}
