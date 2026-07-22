export interface ClobWsMessage {
  event_type?: string;
  asset_id?: string;
  market?: string;
  timestamp?: number | string;
  price_changes?: Array<{
    asset_id: string;
    price: string;
    size: string;
    side: string;
    hash: string;
    best_bid: string;
    best_ask: string;
  }>;
  best_bid?: string;
  best_ask?: string;
  spread?: string;
  price?: string;
  size?: string;
  side?: string;
  fee_rate_bps?: string;
  old_tick_size?: string;
  new_tick_size?: string;
  winning_asset_id?: string;
  winning_outcome?: string;
  id?: string;
  question?: string;
  slug?: string;
  assets_ids?: string[];
  outcomes?: string[];
  [key: string]: unknown;
}

export interface PriceUpdateEvent {
  tokenId: string;
  bestBid: string;
  bestAsk: string;
  midpoint: number;
  timestamp: number;
}

export interface BestBidAskEvent {
  tokenId: string;
  bestBid: string;
  bestAsk: string;
  spread: string;
  timestamp: number;
}

export interface MarketResolvedEvent {
  marketId: string;
  conditionId: string;
  winningAssetId: string;
  winningOutcome: string;
  timestamp: number;
}

export interface TickSizeChangeEvent {
  tokenId: string;
  oldTickSize: string;
  newTickSize: string;
  timestamp: number;
}

export interface MarketSubscriptionMessage {
  assets_ids: string[];
  type: "market";
  custom_feature_enabled: boolean;
}

export interface SubscriptionUpdateMessage {
  assets_ids: string[];
  operation: "subscribe" | "unsubscribe";
}
