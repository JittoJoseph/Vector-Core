import { describe, expect, it } from "vitest";
import {
  calculateExpectedNetProfit,
  calculateFeePerShare,
  getTopOfBook,
  simulateLimitBuy,
} from "../services/execution-simulator.js";
import type { Orderbook } from "../types/index.js";

const book: Orderbook = {
  market: "condition",
  asset_id: "no-token",
  timestamp: "",
  hash: "hash",
  tick_size: "0.01",
  min_order_size: "5",
  neg_risk: false,
  bids: [
    { price: "0.91", size: "100" },
    { price: "0.95", size: "50" },
    { price: "0.93", size: "25" },
  ],
  asks: [
    { price: "0.98", size: "10" },
    { price: "0.96", size: "20" },
    { price: "0.99", size: "100" },
  ],
};

describe("execution simulator", () => {
  it("sorts top of book defensively", () => {
    expect(getTopOfBook(book)).toEqual({
      bestBid: 0.95,
      bestAsk: 0.96,
      spread: 0.010000000000000009,
    });
  });

  it("uses current Polymarket linear fee formula", () => {
    expect(calculateFeePerShare(0.95, { rate: 0.04 })).toBe(0.0019);
    expect(calculateFeePerShare(0.95, { rate: 0 })).toBe(0);
  });

  it("walks asks up to the limit and enforces min order size", () => {
    const result = simulateLimitBuy(book, 25, 0.98, { rate: 0.04 });
    expect(result.totalShares).toBeGreaterThan(5);
    expect(result.averagePrice).toBeGreaterThanOrEqual(0.96);
    expect(result.averagePrice).toBeLessThanOrEqual(0.98);
    expect(result.belowMinimumOrderSize).toBe(false);
    expect(result.fillDetails.map((fill) => fill.price)).toEqual([0.96, 0.98]);
    expect(calculateExpectedNetProfit(result)).toBeGreaterThan(0);
  });

  it("flags fills below the protocol minimum", () => {
    const result = simulateLimitBuy(book, 2, 0.98, { rate: 0.04 });
    expect(result.totalShares).toBeGreaterThan(0);
    expect(result.belowMinimumOrderSize).toBe(true);
  });
});
