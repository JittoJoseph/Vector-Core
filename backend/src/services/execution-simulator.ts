import Decimal from "decimal.js";
import { createModuleLogger } from "../utils/logger.js";
import { type FeeSchedule, type Orderbook } from "../types/index.js";

const logger = createModuleLogger("execution-simulator");

export interface FillDetail {
  price: number;
  shares: number;
  cost: number;
  feeForLevel: number;
}

export interface ExecutionResult {
  averagePrice: number;
  totalShares: number;
  totalCost: number;
  fees: number;
  netCost: number;
  isPartialFill: boolean;
  belowMinimumOrderSize: boolean;
  minOrderSize: number;
  fillDetails: FillDetail[];
  orderbookSnapshot: unknown;
}

export interface SellExecutionResult {
  averagePrice: number;
  totalSharesSold: number;
  totalRevenue: number;
  fees: number;
  netRevenue: number;
  isPartialFill: boolean;
  fillDetails: FillDetail[];
  orderbookSnapshot: unknown;
}

function snapshotOrderbook(orderbook: Orderbook, depth = 5) {
  return {
    bids: [...orderbook.bids]
      .sort((a, b) => parseFloat(b.price) - parseFloat(a.price))
      .slice(0, depth),
    asks: [...orderbook.asks]
      .sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
      .slice(0, depth),
    tick_size: orderbook.tick_size,
    min_order_size: orderbook.min_order_size,
    timestamp: orderbook.timestamp,
    hash: orderbook.hash,
  };
}

export function calculateFeePerShare(
  price: number,
  feeSchedule?: FeeSchedule | null,
): number {
  const feeRate = feeSchedule?.rate ?? 0;
  if (!Number.isFinite(feeRate) || feeRate <= 0) return 0;
  const fee = feeRate * price * (1 - price);
  return Math.round(fee * 10000) / 10000;
}

export function estimateDepthAtOrBelow(
  orderbook: Orderbook,
  limitPrice: number,
): number {
  return [...orderbook.asks]
    .filter((level) => parseFloat(level.price) <= limitPrice)
    .reduce((sum, level) => sum + parseFloat(level.size), 0);
}

export function getTopOfBook(orderbook: Orderbook): {
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
} {
  const bestBid =
    [...orderbook.bids]
      .map((b) => parseFloat(b.price))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0] ?? null;
  const bestAsk =
    [...orderbook.asks]
      .map((a) => parseFloat(a.price))
      .filter(Number.isFinite)
      .sort((a, b) => a - b)[0] ?? null;
  return {
    bestBid,
    bestAsk,
    spread: bestBid != null && bestAsk != null ? bestAsk - bestBid : null,
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
  const fillDetails: FillDetail[] = [];
  let remainingUsd = new Decimal(usdAmount);
  let totalShares = new Decimal(0);
  let totalCost = new Decimal(0);
  let totalFees = new Decimal(0);

  for (const level of asks) {
    if (remainingUsd.lte(0)) break;
    const price = parseFloat(level.price);
    const size = parseFloat(level.size);
    if (!Number.isFinite(price) || !Number.isFinite(size)) continue;
    if (price > limitPrice) break;

    const feePerShare = calculateFeePerShare(price, feeSchedule);
    const costPerShare = new Decimal(price).plus(feePerShare);
    const sharesToFill = Math.min(remainingUsd.div(costPerShare).toNumber(), size);
    if (sharesToFill <= 0) continue;

    const shares = new Decimal(sharesToFill);
    const cost = shares.mul(price);
    const fees = shares.mul(feePerShare);
    totalShares = totalShares.plus(shares);
    totalCost = totalCost.plus(cost);
    totalFees = totalFees.plus(fees);
    remainingUsd = remainingUsd.minus(cost).minus(fees);
    fillDetails.push({
      price,
      shares: sharesToFill,
      cost: cost.toNumber(),
      feeForLevel: fees.toNumber(),
    });
  }

  const avgPrice = totalShares.gt(0)
    ? totalCost.div(totalShares).toNumber()
    : 0;
  const roundedFees = Math.round(totalFees.toNumber() * 10000) / 10000;
  const minOrderSize = parseFloat(orderbook.min_order_size ?? "5") || 5;
  const belowMinimumOrderSize =
    totalShares.gt(0) && totalShares.lt(minOrderSize);

  if (totalShares.gt(0)) {
    logger.debug(
      {
        avgPrice,
        shares: totalShares.toNumber(),
        fees: roundedFees,
        levels: fillDetails.length,
      },
      "FAK buy simulated",
    );
  }

  return {
    averagePrice: avgPrice,
    totalShares: totalShares.toNumber(),
    totalCost: totalCost.toNumber(),
    fees: roundedFees,
    netCost: totalCost.toNumber() + roundedFees,
    isPartialFill: remainingUsd.gt(0) && totalShares.gt(0),
    belowMinimumOrderSize,
    minOrderSize,
    fillDetails,
    orderbookSnapshot: snapshotOrderbook(orderbook),
  };
}

export function simulateLimitSell(
  orderbook: Orderbook,
  sharesToSell: number,
  limitPrice: number,
  feeSchedule?: FeeSchedule | null,
): SellExecutionResult {
  const bids = [...orderbook.bids].sort(
    (a, b) => parseFloat(b.price) - parseFloat(a.price),
  );
  const fillDetails: FillDetail[] = [];
  let remainingShares = new Decimal(sharesToSell);
  let totalSharesSold = new Decimal(0);
  let totalRevenue = new Decimal(0);
  let totalFees = new Decimal(0);

  for (const level of bids) {
    if (remainingShares.lte(0)) break;
    const price = parseFloat(level.price);
    const size = parseFloat(level.size);
    if (!Number.isFinite(price) || !Number.isFinite(size)) continue;
    if (price < limitPrice) break;

    const sharesToFill = Math.min(remainingShares.toNumber(), size);
    const feePerShare = calculateFeePerShare(price, feeSchedule);
    const shares = new Decimal(sharesToFill);
    const revenue = shares.mul(price);
    const fees = shares.mul(feePerShare);
    totalSharesSold = totalSharesSold.plus(shares);
    totalRevenue = totalRevenue.plus(revenue);
    totalFees = totalFees.plus(fees);
    remainingShares = remainingShares.minus(shares);
    fillDetails.push({
      price,
      shares: sharesToFill,
      cost: revenue.toNumber(),
      feeForLevel: fees.toNumber(),
    });
  }

  const avgPrice = totalSharesSold.gt(0)
    ? totalRevenue.div(totalSharesSold).toNumber()
    : 0;
  const roundedFees = Math.round(totalFees.toNumber() * 10000) / 10000;
  return {
    averagePrice: avgPrice,
    totalSharesSold: totalSharesSold.toNumber(),
    totalRevenue: totalRevenue.toNumber(),
    fees: roundedFees,
    netRevenue: totalRevenue.toNumber() - roundedFees,
    isPartialFill: remainingShares.gt(new Decimal(sharesToSell).mul(0.1)),
    fillDetails,
    orderbookSnapshot: snapshotOrderbook(orderbook),
  };
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

export function calculateExpectedNetProfit(result: ExecutionResult): number {
  return calculateWinProfit(result.averagePrice, result.totalShares, result.fees);
}
