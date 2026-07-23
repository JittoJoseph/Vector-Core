export interface Campaign {
  id: string;
  slug: string;
  title: string;
  seriesSlug: string | null;
  startDate: string | null;
  endDate: string | null;
  closedTime: string | null;
  closed: boolean;
  lastFetchedAt: string;
  createdAt: string;
  updatedAt: string;

  modalBucketTitle?: string;
  candidateCount?: number;
  trackedCount?: number;
  positionCount?: number;
  relevantBuckets?: CampaignBucket[];
  historicalTrades?: Trade[] | { length: number; totalPnl: number };
}

export interface CampaignBucket {
  id: string;
  slug: string | null;
  groupItemTitle: string;
  noPrice: string | null;
  hasOpenPosition: boolean;
  positions: { id: string; entryPrice: number; entryShares: number }[];
}

export interface Trade {
  id: string;
  campaignId: string | null;
  campaignSlug: string | null;
  campaignTitle: string | null;
  bucketId: string | null;
  bucketSlug: string | null;
  bucketGroupTitle: string | null;
  campaignEndDate: string | null;
  tokenId: string | null;
  entryTs: string;
  entryPrice: string;
  entryShares: string;
  actualCost: string;
  entryFees: string;
  expectedNetProfit: string | null;
  modalBucketAtEntry: string | null;
  minNoPriceDuringPosition: string | null;
  exitPrice: string | null;
  exitTs: string | null;
  exitOutcome: string | null;
  exitReason: string | null;
  realizedPnl: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface PositionPnl {
  mid: number | null;
  pnl: number | null;
  pnlPct: number | null;
  minNoPrice: number | null;
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

export interface SystemStats {
  orchestrator: {
    running: boolean;
    paused: boolean;
    activeBuckets: number;
    openPositions: number;
    cycleCount: number;
    ws: {
      connected: boolean;
      subscribedTokens: number;
      messageCount: number;
      reconnectAttempts: number;
    };
    risk?: {
      consecutiveLossCount: number;
      pausedByRiskGuard: boolean;
    };
    polymarketStatus?: "UNKNOWN" | "UP" | "HASISSUES" | "UNDERMAINTENANCE";
  };
  config: {
    minNoEntryPrice: number;
    maxNoEntryPrice: number;
    minExpectedNetProfit: number;
    startingCapital: number;
    maxPositions: number;
    stopLossEnabled: boolean;
    stopLossNoPrice: number;
  };
  portfolio?: PortfolioSnapshot;
  positionsPnl?: Record<string, PositionPnl>;
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
  kind:
    | "TRADE_OPENED"
    | "TRADE_WIN"
    | "TRADE_LOSS"
    | "MARKET_RESOLVED"
    | "SYSTEM"
    | "INFO"
    | "WARN"
    | "ERROR";
  title: string;
  detail: string;
  ts: number;
  trade?: Trade;
  pnl?: number;
}

export interface WsMessage {
  type: "systemState" | "tradeOpened" | "tradeResolved" | "pong";
  data?: unknown;
}
