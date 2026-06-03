import { EventEmitter } from "events";

export class MarketScanner extends EventEmitter {
  async start(): Promise<void> {}
  stop(): void {}
  getDiscoveredCount(): number {
    return 0;
  }
  async scan(): Promise<void> {}
}

let instance: MarketScanner | null = null;
export function getMarketScanner(): MarketScanner {
  if (!instance) instance = new MarketScanner();
  return instance;
}
