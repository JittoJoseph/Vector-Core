import Decimal from "decimal.js";
import { createModuleLogger } from "../utils/logger.js";
import { type FeeSchedule, type Orderbook } from "../types/index.js";

const logger = createModuleLogger("execution-simulator");

export interface ExecutionResult {
  averagePrice: number;
  totalShares: number;
  fees: number;
  netCost: number;
  isPartialFill: boolean;
  belowMinimumOrderSize: boolean;
}

export function calculateFeePerShare(
  price: number,
  feeSchedule?: FeeSchedule | null,
): number {
  const feeRate = feeSchedule?.rate ?? 0;
  if (!Number.isFinite(feeRate) || feeRate <= 0) return 0;
  return Math.round(feeRate * price * (1 - price) * 10000) / 10000;
}

export function getTopOfBook(orderbook: Orderbook): {
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
} {
  let bestBid: number | null = null;
  let bestAsk: number | null = null;
  for (const b of orderbook.bids) {
    const p = parseFloat(b.price);
    if (Number.isFinite(p) && (bestBid === null || p > bestBid)) bestBid = p;
  }
  for (const a of orderbook.asks) {
    const p = parseFloat(a.price);
    if (Number.isFinite(p) && (bestAsk === null || p < bestAsk)) bestAsk = p;
  }
  return {
    bestBid,
    bestAsk,
    spread: bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null,
  };
}

function settle(
  label: string,
  orderbook: Orderbook,
  shares: Decimal,
  gross: Decimal,
  feesDec: Decimal,
  remaining: Decimal,
  feeSign: 1 | -1,
): ExecutionResult {
  const totalShares = shares.toNumber();
  const fees = Math.round(feesDec.toNumber() * 10000) / 10000;
  const minOrderSize = parseFloat(orderbook.min_order_size ?? "5") || 5;
  const averagePrice = shares.gt(0) ? gross.div(shares).toNumber() : 0;

  if (totalShares > 0)
    logger.debug({ averagePrice, totalShares, fees }, label);

  return {
    averagePrice,
    totalShares,
    fees,
    netCost: gross.toNumber() + feeSign * fees,
    isPartialFill: remaining.gt(0) && totalShares > 0,
    belowMinimumOrderSize: totalShares > 0 && totalShares < minOrderSize,
  };
}

export function simulateLimitBuy(
  orderbook: Orderbook,
  usdAmount: number,
  limitPrice: number,
  feeSchedule?: FeeSchedule | null,
): ExecutionResult {
  const asks = [...orderbook.asks].sort(
    (a, b) => parseFloat(a.price) - parseFloat(b.price),
  );
  let remaining = new Decimal(usdAmount);
  let totalShares = new Decimal(0);
  let gross = new Decimal(0);
  let totalFees = new Decimal(0);

  for (const level of asks) {
    if (remaining.lte(0)) break;
    const price = parseFloat(level.price);
    const size = parseFloat(level.size);
    if (!Number.isFinite(price) || !Number.isFinite(size)) continue;
    if (price > limitPrice) break;

    const feePerShare = calculateFeePerShare(price, feeSchedule);
    const costPerShare = new Decimal(price).plus(feePerShare);
    const fill = Math.min(remaining.div(costPerShare).toNumber(), size);
    if (fill <= 0) continue;

    const shares = new Decimal(fill);
    const cost = shares.mul(price);
    const fees = shares.mul(feePerShare);
    totalShares = totalShares.plus(shares);
    gross = gross.plus(cost);
    totalFees = totalFees.plus(fees);
    remaining = remaining.minus(cost).minus(fees);
  }

  return settle(
    "FAK buy simulated",
    orderbook,
    totalShares,
    gross,
    totalFees,
    remaining,
    1,
  );
}

export function simulateTakerSell(
  orderbook: Orderbook,
  sharesAmount: number,
  feeSchedule?: FeeSchedule | null,
): ExecutionResult {
  const bids = [...orderbook.bids].sort(
    (a, b) => parseFloat(b.price) - parseFloat(a.price),
  );
  let remaining = new Decimal(sharesAmount);
  let totalShares = new Decimal(0);
  let gross = new Decimal(0);
  let totalFees = new Decimal(0);

  for (const level of bids) {
    if (remaining.lte(0)) break;
    const price = parseFloat(level.price);
    const size = parseFloat(level.size);
    if (!Number.isFinite(price) || !Number.isFinite(size)) continue;

    const fill = Math.min(remaining.toNumber(), size);
    if (fill <= 0) continue;

    const feePerShare = calculateFeePerShare(price, feeSchedule);
    const shares = new Decimal(fill);
    totalShares = totalShares.plus(shares);
    gross = gross.plus(shares.mul(price));
    totalFees = totalFees.plus(shares.mul(feePerShare));
    remaining = remaining.minus(shares);
  }

  return settle(
    "FAK sell simulated",
    orderbook,
    totalShares,
    gross,
    totalFees,
    remaining,
    -1,
  );
}

export function calculateWinProfit(
  entryPrice: number,
  shares: number,
  fees: number,
): number {
  return (1 - entryPrice) * shares - fees;
}

export function calculateLossAmount(
  entryPrice: number,
  shares: number,
  fees: number,
): number {
  return -(entryPrice * shares + fees);
}
