import { EventEmitter } from "events";

export interface MarketOpportunity {
  marketId: string;
  tokenId: string;
  outcomeLabel: string;
}

export interface Crossover {
  side: "UP" | "DOWN";
  ts: number;
}

export class StrategyEngine extends EventEmitter {
  registerMarket(): void {}
  unregisterMarket(): void {}
  updateTargetPrice(): void {}
  clearEvaluated(): void {}
  setOpenPositionCount(): void {}
  getCrossoverData(): Crossover[] {
    return [];
  }
  getStats() {
    return { watchedTokens: 0, triggersCount: 0, evaluatedTokens: 0 };
  }
}

let instance: StrategyEngine | null = null;
export function getStrategyEngine(): StrategyEngine {
  if (!instance) instance = new StrategyEngine();
  return instance;
}
