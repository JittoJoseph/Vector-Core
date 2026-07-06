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
  positions?: SimulatedTrade[];
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
  modalBucketAtEntry?: string | null;
  minNoPriceDuringPosition?: string | null;
  createdAt: string;
  updatedAt: string;
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
      consecutiveLossPauseLimit: number;
      pausedByRiskGuard: boolean;
      riskPauseTriggeredAt: number | null;
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
    stopLossBufferBelowLow: number;
    stopLossAbsoluteFloor: number;
  };
  openPositionPrices?: Record<string, LiveMarketPrice>;
  portfolio?: {
    cashBalance: number;
    initialCapital: number;
    openPositionsValue: number;
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
  totalWin: string;
  totalLoss: string;
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

export interface WsMessage {
  type:
    | "systemState"
    | "tradeOpened"
    | "tradeResolved"
    | "btcPriceUpdate"
    | "pong";
  data?: unknown;
}
