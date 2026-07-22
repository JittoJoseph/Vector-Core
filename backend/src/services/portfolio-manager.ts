import Decimal from "decimal.js";
import { createModuleLogger } from "../utils/logger.js";
import { getConfig } from "../utils/config.js";
import { calculateFeePerShare } from "./execution-simulator.js";
import { POLYMARKET_MIN_ORDER_SIZE } from "../types/index.js";
import {
  getPortfolio,
  initPortfolio,
  updateCashBalance,
} from "../db/client.js";

const logger = createModuleLogger("portfolio-manager");

export class PortfolioManager {
  private cashBalance: Decimal = new Decimal(0);
  private initialCapital: Decimal = new Decimal(0);

  async init(): Promise<void> {
    const config = getConfig();
    const portfolio = await initPortfolio(config.portfolio.startingCapital);
    if (!portfolio) {
      throw new Error("Failed to initialise portfolio row");
    }
    this.cashBalance = new Decimal(portfolio.cashBalance);
    this.initialCapital = new Decimal(portfolio.initialCapital);
    logger.info(
      {
        initialCapital: this.initialCapital.toString(),
        cashBalance: this.cashBalance.toString(),
        maxPositions: config.strategy.maxSimultaneousPositions,
      },
      "Portfolio initialised",
    );
  }

  async reload(): Promise<void> {
    const portfolio = await getPortfolio();
    if (!portfolio) {
      throw new Error("Portfolio row missing — call init() first");
    }
    this.cashBalance = new Decimal(portfolio.cashBalance);
    this.initialCapital = new Decimal(portfolio.initialCapital);
  }

  getCashBalance(): number {
    return this.cashBalance.toNumber();
  }

  getInitialCapital(): number {
    return this.initialCapital.toNumber();
  }

  computePositionBudget(openPositionsValue: number): number {
    const config = getConfig();
    const minShares = POLYMARKET_MIN_ORDER_SIZE;
    const maxPrice = config.strategy.maxNoEntryPrice;
    const portfolioValue = this.cashBalance.plus(openPositionsValue);
    const rawBudget = portfolioValue.div(
      config.strategy.maxSimultaneousPositions,
    );

    const feePerShare = calculateFeePerShare(maxPrice);
    const costPerShare = new Decimal(maxPrice).plus(feePerShare);
    const minBudget = costPerShare.mul(minShares);

    const budget = Decimal.max(rawBudget, minBudget);

    if (!config.portfolio.allowNegativeBalance && this.cashBalance.lt(minBudget)) {
      logger.warn(
        {
          cash: this.cashBalance.toString(),
          minBudget: minBudget.toString(),
          minShares,
          maxEntryPrice: maxPrice,
        },
      `Insufficient cash for ${minShares}-share minimum at maxNoEntryPrice — skipping`,
      );
      return 0;
    }

    if (config.portfolio.allowNegativeBalance) {
      return budget.toDP(8).toNumber();
    }
    const capped = Decimal.min(budget, this.cashBalance);
    return capped.toDP(8).toNumber();
  }

  async deductCash(amount: number): Promise<boolean> {
    const config = getConfig();
    const dec = new Decimal(amount);
    if (!config.portfolio.allowNegativeBalance && dec.gt(this.cashBalance)) {
      logger.error(
        { requested: dec.toString(), available: this.cashBalance.toString() },
        "Attempted to deduct more cash than available",
      );
      return false;
    }
    this.cashBalance = this.cashBalance.minus(dec);
    await updateCashBalance(this.cashBalance.toString());
    logger.debug(
      { deducted: dec.toString(), remaining: this.cashBalance.toString() },
      "Cash deducted",
    );
    return true;
  }

  async addCash(amount: number): Promise<void> {
    const dec = new Decimal(amount);
    this.cashBalance = this.cashBalance.plus(dec);
    await updateCashBalance(this.cashBalance.toString());
    logger.debug(
      { added: dec.toString(), newBalance: this.cashBalance.toString() },
      "Cash added",
    );
  }
}
