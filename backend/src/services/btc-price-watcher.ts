import { EventEmitter } from "events";

export class BtcPriceWatcher extends EventEmitter {
  start(): void {}
  stop(): void {}
  isConnected(): boolean {
    return false;
  }
  getCurrentPrice(): { price: number; timestamp: number } | null {
    return null;
  }
  getPriceAgeMs(): number | null {
    return null;
  }
  isPriceFresh(): boolean {
    return false;
  }
  getMomentum() {
    return null;
  }
  getOldestHistoryTimestamp(): number | null {
    return null;
  }
  getPriceAt(): number | null {
    return null;
  }
}

let instance: BtcPriceWatcher | null = null;
export function getBtcPriceWatcher(): BtcPriceWatcher {
  if (!instance) instance = new BtcPriceWatcher();
  return instance;
}
