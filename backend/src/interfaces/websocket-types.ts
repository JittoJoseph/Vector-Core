export interface ClobWsMessage {
  event_type?: string;
  asset_id?: string;
  price_changes?: Array<{
    asset_id: string;
    best_bid: string;
    best_ask: string;
  }>;
  best_bid?: string;
  best_ask?: string;
}
