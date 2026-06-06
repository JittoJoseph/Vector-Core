import { EventEmitter } from "events";
import { and, desc, eq, gte, sql, inArray } from "drizzle-orm";
import { createModuleLogger } from "../utils/logger.js";
import { getConfig } from "../utils/config.js";
import { getDb, createSimulatedTrade, loadOpenTradesWithMarkets, logAudit, resolveTrade, wipeAndResetPortfolio } from "../db/client.js";
import * as schema from "../db/schema.js";
import { getPolymarketClient, PolymarketClient } from "./polymarket-client.js";
import { classifyEvent } from "./deadline-classifier.js";
import { PortfolioManager } from "./portfolio-manager.js";
import {
  calculateExpectedNetProfit,
  calculateLossAmount,
  calculateWinProfit,
  estimateDepthAtOrBelow,
  getTopOfBook,
  simulateLimitBuy,
} from "./execution-simulator.js";
import {
  getMarketWebSocketWatcher,
  MarketWebSocketWatcher,
} from "./market-ws-watcher.js";
import type { ClassifiedMarket, FeeSchedule, GammaEvent, GammaMarket } from "../types/index.js";
import type { MarketResolvedEvent } from "../interfaces/websocket-types.js";

const logger = createModuleLogger("market-orchestrator");

interface TrackedMarket {
  marketId: string;
  eventId: string;
  eventSlug: string;
  eventTitle: string;
  question: string;
  slug: string | null;
  conditionId: string | null;
  deadline: Date;
  deadlineDate: string;
  noTokenId: string;
  yesTokenId: string;
  noPrice: number | null;
  feeSchedule: FeeSchedule | null;
  resolutionRules: string | null;
  lastPrices: Record<string, { bid: number; ask: number; mid: number }>;
  frozenPrices: Record<string, { bid: number; ask: number; mid: number }> | null;
  resolved: boolean;
}

export type MarketLifecycle = "OPEN" | "AWAITING_RESOLUTION" | "RESOLVED";

interface OpenPosition {
  tradeId: string;
  marketId: string;
  tokenId: string;
  entryPrice: number;
  entryShares: number;
  fees: number;
  actualCost: number;
  deadline: Date | null;
}

export class MarketOrchestrator extends EventEmitter {
  private client = getPolymarketClient();
  private wsWatcher: MarketWebSocketWatcher = getMarketWebSocketWatcher();
  readonly portfolioManager = new PortfolioManager();

  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private settlementTimer: ReturnType<typeof setInterval> | null = null;
  private lifecycleTimer: ReturnType<typeof setInterval> | null = null;
  private trackedMarkets = new Map<string, TrackedMarket>();
  private tokenToMarket = new Map<string, string>();
  private conditionIdToMarket = new Map<string, string>();
  private openPositions = new Map<string, OpenPosition>();
  private inFlightTokens = new Set<string>();
  private running = false;
  private paused = false;
  private cycleCount = 0;
  private discoveredLadders = 0;
  private evaluatedOpportunities = 0;
  private consecutiveLossCount = 0;
  private pausedByRiskGuard = false;
  private riskPauseTriggeredAt: number | null = null;
  private riskAutoResumeTimer: ReturnType<typeof setTimeout> | null = null;
  private evaluatedMarketIds = new Set<string>();

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.portfolioManager.init();
    await this.pruneNonLadderRows();
    await this.loadOpenPositions();
    this.wireEvents();
    this.wsWatcher.start();
    await this.scan();
    const config = getConfig();
    this.scanTimer = setInterval(() => {
      this.scan().catch((error) =>
        logger.error({ error }, "Deadline market scan failed"),
      );
    }, config.strategy.scanIntervalMs);
    this.settlementTimer = setInterval(() => {
      this.pollOpenPositionSettlements().catch((error) =>
        logger.error({ error }, "Settlement polling failed"),
      );
    }, 60_000);
    this.lifecycleTimer = setInterval(() => {
      this.checkLifecycleTransitions();
    }, 1000);
    logger.info("Explicit-date deadline market orchestrator started");
  }

  stop(): void {
    this.running = false;
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.settlementTimer) clearInterval(this.settlementTimer);
    if (this.lifecycleTimer) clearInterval(this.lifecycleTimer);
    if (this.riskAutoResumeTimer) clearTimeout(this.riskAutoResumeTimer);
    this.scanTimer = null;
    this.settlementTimer = null;
    this.lifecycleTimer = null;
    this.wsWatcher.stop();
    logger.info("Deadline market orchestrator stopped");
  }

  pause(): void {
    this.paused = true;
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.settlementTimer) {
      clearInterval(this.settlementTimer);
      this.settlementTimer = null;
    }
    if (this.lifecycleTimer) {
      clearInterval(this.lifecycleTimer);
      this.lifecycleTimer = null;
    }
    this.wsWatcher.stop();
    logger.warn("System paused — discovery, settlement polling, and WS stopped");
  }

  async resume(): Promise<void> {
    if (!this.paused) return;
    this.paused = false;
    this.pausedByRiskGuard = false;
    this.riskPauseTriggeredAt = null;
    this.consecutiveLossCount = 0;
    
    this.wsWatcher.start();
    await this.portfolioManager.reload();
    await this.scan();
    
    const config = getConfig();
    if (!this.scanTimer) {
      this.scanTimer = setInterval(() => {
        this.scan().catch((error) =>
          logger.error({ error }, "Deadline market scan failed"),
        );
      }, config.strategy.scanIntervalMs);
    }
    if (!this.settlementTimer) {
      this.settlementTimer = setInterval(() => {
        this.pollOpenPositionSettlements().catch((error) =>
          logger.error({ error }, "Settlement polling failed"),
        );
      }, 60_000);
    }
    if (!this.lifecycleTimer) {
      this.lifecycleTimer = setInterval(() => {
        this.checkLifecycleTransitions();
      }, 1000);
    }
    logger.info("System resumed");
  }

  async wipe(): Promise<void> {
    this.pause();
    
    const config = getConfig();
    await wipeAndResetPortfolio(config.portfolio.startingCapital);
    
    this.trackedMarkets.clear();
    this.tokenToMarket.clear();
    this.conditionIdToMarket.clear();
    this.openPositions.clear();
    this.inFlightTokens.clear();
    this.evaluatedMarketIds.clear();
    this.wsWatcher.clear();

    this.cycleCount = 0;
    this.discoveredLadders = 0;
    this.evaluatedOpportunities = 0;
    this.consecutiveLossCount = 0;
    this.pausedByRiskGuard = false;
    this.riskPauseTriggeredAt = null;

    logger.warn("System wiped, portfolio reset, and engine paused.");
  }

  isPaused(): boolean {
    return this.paused;
  }

  getStats() {
    const config = getConfig();
    return {
      running: this.running,
      paused: this.paused,
      activeMarkets: this.trackedMarkets.size,
      openPositions: this.openPositions.size,
      cycleCount: this.cycleCount,
      scanner: {
        discoveredLadders: this.discoveredLadders,
        evaluatedOpportunities: this.evaluatedOpportunities,
      },
      ws: this.wsWatcher.getStats(),
      strategy: {
        watchedTokens: this.tokenToMarket.size,
        triggersCount: this.cycleCount,
        evaluatedTokens: this.evaluatedMarketIds.size,
      },
      risk: {
        consecutiveLossCount: this.consecutiveLossCount,
        consecutiveLossPauseLimit: config.strategy.consecutiveLossPauseLimit,
        pausedByRiskGuard: this.pausedByRiskGuard,
        riskPauseTriggeredAt: this.riskPauseTriggeredAt,
      },
    };
  }

  getLiveMarkets() {
    const now = Date.now();
    return Array.from(this.trackedMarkets.values())
      .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime())
      .map((m) => ({
        marketId: m.marketId,
        eventId: m.eventId,
        eventSlug: m.eventSlug,
        eventTitle: m.eventTitle,
        question: m.question,
        slug: m.slug,
        deadline: new Date(m.deadline).toISOString(),
        deadlineDate: m.deadlineDate,
        yesTokenId: m.yesTokenId,
        noTokenId: m.noTokenId,
        noPrice: m.noPrice,
        markPrice: m.frozenPrices ?? { ...m.lastPrices }, // unified mark price
        status: this.getMarketLifecycle(m),
        hasPosition: Array.from(this.openPositions.values()).some(
          (p) => p.marketId === m.marketId,
        ),
      }));
  }

  computeOpenPositionsValue(): number {
    let total = 0;
    for (const pos of this.openPositions.values()) total += pos.actualCost;
    return total;
  }

  private wireEvents(): void {
    this.wsWatcher.on("priceUpdate", (ev) =>
      this.onTokenPriceUpdate(ev.tokenId, parseFloat(ev.bestBid), parseFloat(ev.bestAsk)),
    );
    this.wsWatcher.on("bestBidAskUpdate", (ev) =>
      this.onTokenPriceUpdate(ev.tokenId, parseFloat(ev.bestBid), parseFloat(ev.bestAsk)),
    );
    this.wsWatcher.on("marketResolved", (ev: MarketResolvedEvent) =>
      this.onMarketResolved(ev).catch((error) =>
        logger.error({ error }, "WS resolution handling failed"),
      ),
    );
  }

  private async pruneNonLadderRows(): Promise<void> {
    const db = getDb();
    await db.execute(sql`
      DELETE FROM ${schema.opportunities}
      WHERE market_id IN (
        SELECT id FROM ${schema.deadlineMarkets}
        WHERE classification_status NOT IN ('candidate', 'traded')
           OR family_kind <> 'deadline_ladder'
      )
    `);
    await db.execute(sql`
      DELETE FROM ${schema.deadlineMarkets}
      WHERE classification_status NOT IN ('candidate', 'traded')
         OR family_kind <> 'deadline_ladder'
    `);
    await db.execute(sql`
      DELETE FROM ${schema.eventFamilies}
      WHERE family_kind <> 'deadline_ladder'
    `);
  }

  async scan(): Promise<void> {
    if (this.paused) return;
    const config = getConfig();
    this.cycleCount++;
    let cursor: string | null = null;
    for (let page = 0; page < config.strategy.discoveryPages; page++) {
      if (this.paused) break;
      const result = await this.client.listEventsKeyset({
        limit: 100,
        after_cursor: cursor ?? undefined,
        active: true,
        closed: false,
        order: "volume24hr",
        ascending: false,
      });
      
      const pageEvents = result.events;
      if (pageEvents.length > 0) {
        const db = getDb();
        const eventIds = pageEvents.map((e) => String(e.id));
        
        // Pre-fetch the latest updated_at from DB for all discovered events in one query
        const existing = await db
          .select({
            id: schema.eventFamilies.id,
            updatedAt: schema.eventFamilies.updatedAt,
          })
          .from(schema.eventFamilies)
          .where(inArray(schema.eventFamilies.id, eventIds));
          
        const existingUpdates = new Map(existing.map((row) => [row.id, row.updatedAt]));
        
        // Filter out events that haven't changed since last scan
        const changedEvents = pageEvents.filter((e) => {
          const currentUpdatedAt = e.updatedAt ? new Date(e.updatedAt).getTime() : 0;
          const dbUpdatedAt = existingUpdates.get(String(e.id))?.getTime() ?? 0;
          return dbUpdatedAt !== currentUpdatedAt;
        });

        for (const event of changedEvents) {
          if (this.paused) break;
          await this.persistClassifiedEvent(event);
        }
      }

      cursor = result.nextCursor;
      if (!cursor) break;
    }

    if (this.paused) return;

    // Update real metrics from DB
    const db = getDb();
    const familiesCount = await db.select({ count: sql<number>`count(*)` }).from(schema.eventFamilies);
    const marketsCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.deadlineMarkets)
      .where(eq(schema.deadlineMarkets.classificationStatus, "candidate"));

    this.discoveredLadders = familiesCount[0]?.count ?? 0;
    this.evaluatedOpportunities = marketsCount[0]?.count ?? 0;

    await this.evaluateTradeCandidates();
    this.cleanupTrackedMarkets();
  }

  private cleanupTrackedMarkets(): void {
    const toUntrack: string[] = [];

    for (const [marketId, state] of this.trackedMarkets.entries()) {
      const hasPosition = Array.from(this.openPositions.values()).some((p) => p.marketId === marketId);
      if (!hasPosition) {
        toUntrack.push(marketId);
      }
    }

    for (const marketId of toUntrack) {
      this.untrackMarket(marketId);
    }
  }

  private untrackMarket(marketId: string): void {
    const state = this.trackedMarkets.get(marketId);
    if (!state) return;
    
    this.wsWatcher.unsubscribe([state.noTokenId]);
    this.tokenToMarket.delete(state.noTokenId);
    if (state.conditionId) this.conditionIdToMarket.delete(state.conditionId);
    this.trackedMarkets.delete(marketId);
    logger.info({ marketId, question: state.question }, "Untracked market (no longer eligible)");
  }

  private async persistClassifiedEvent(event: GammaEvent): Promise<void> {
    const db = getDb();
    const classified = classifyEvent(event);
    if (classified.length === 0) return;

    const uniqueDates = new Set(classified.map((m) => m.deadlineDate));
    const familyKind = "deadline_ladder";
    const eventId = String(event.id);
    const eventSlug = event.slug ?? eventId;
    const eventTitle = event.title ?? eventSlug;
    const normalizedKey = eventTitle.toLowerCase().replace(/\s+/g, " ").trim();
    const eventSummary = {
      id: eventId,
      slug: eventSlug,
      title: eventTitle,
      active: event.active ?? true,
      closed: event.closed ?? false,
      liquidity: event.liquidityClob ?? event.liquidity ?? 0,
      volume24hr: event.volume24hr ?? 0,
      updatedAt: event.updatedAt ?? null,
    };

    await db
      .insert(schema.eventFamilies)
      .values({
        id: eventId,
        slug: eventSlug,
        title: eventTitle,
        normalizedKey,
        familyKind,
        explicitDateCount: uniqueDates.size,
        active: event.active ?? true,
        closed: event.closed ?? false,
        liquidity: String(event.liquidityClob ?? event.liquidity ?? 0),
        volume24h: String(event.volume24hr ?? 0),
        lastFetchedAt: new Date(),
        updatedAt: event.updatedAt ? new Date(event.updatedAt) : new Date(),
      })
      .onConflictDoUpdate({
        target: schema.eventFamilies.id,
        set: {
          title: eventTitle,
          familyKind,
          explicitDateCount: uniqueDates.size,
          active: event.active ?? true,
          closed: event.closed ?? false,
          liquidity: String(event.liquidityClob ?? event.liquidity ?? 0),
          volume24h: String(event.volume24hr ?? 0),
          lastFetchedAt: new Date(),
          updatedAt: event.updatedAt ? new Date(event.updatedAt) : new Date(),
        },
      });

    for (const item of classified) {
      await this.persistClassifiedMarket(item);
    }
  }

  private async persistClassifiedMarket(item: ClassifiedMarket): Promise<void> {
    const db = getDb();
    const m = item.market;
    const classificationStatus = "candidate";

    await db
      .insert(schema.deadlineMarkets)
      .values({
        id: m.id,
        eventId: item.eventId,
        eventSlug: item.eventSlug,
        eventTitle: item.eventTitle,
        conditionId: m.conditionId ?? null,
        slug: m.slug ?? null,
        question: m.question ?? "",
        underlyingKey: item.underlyingKey,
        deadline: item.deadline,
        deadlineDate: item.deadlineDate,
        familyKind: item.familyKind,
        classificationStatus,
        rejectionReason: item.rejectionReason,
        active: m.active ?? true,
        closed: m.closed ?? false,
        acceptingOrders: m.acceptingOrders ?? false,
        enableOrderBook: m.enableOrderBook ?? false,
        negRisk: m.negRisk ?? false,
        negRiskOther: m.negRiskOther ?? false,
        outcomes: item.outcomes as any,
        clobTokenIds: [item.yesTokenId, item.noTokenId] as any,
        yesTokenId: item.yesTokenId,
        noTokenId: item.noTokenId,
        yesPrice: item.outcomePrices[0]?.toString() ?? null,
        noPrice: item.noPrice?.toString() ?? null,
        spread: m.spread?.toString() ?? null,
        liquidityNum: (m.liquidityNum ?? 0).toString(),
        volume24h: (m.volume24hr ?? 0).toString(),
        orderMinSize: m.orderMinSize?.toString() ?? null,
        orderTickSize: m.orderPriceMinTickSize?.toString() ?? null,
        feesEnabled: m.feesEnabled ?? false,
        feeSchedule: (m.feeSchedule ?? null) as any,
        resolutionRules: m.description ?? null,
        resolutionSource: m.resolutionSource ?? null,
        umaResolutionStatus: m.umaResolutionStatus ?? null,
        lastFetchedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.deadlineMarkets.id,
        set: {
          eventTitle: item.eventTitle,
          deadline: item.deadline,
          deadlineDate: item.deadlineDate,
          familyKind: item.familyKind,
          classificationStatus,
          rejectionReason: item.rejectionReason,
          active: m.active ?? true,
          closed: m.closed ?? false,
          acceptingOrders: m.acceptingOrders ?? false,
          enableOrderBook: m.enableOrderBook ?? false,
          noPrice: item.noPrice?.toString() ?? null,
          spread: m.spread?.toString() ?? null,
          liquidityNum: (m.liquidityNum ?? 0).toString(),
          volume24h: (m.volume24hr ?? 0).toString(),
          feeSchedule: (m.feeSchedule ?? null) as any,
          lastFetchedAt: new Date(),
          updatedAt: new Date(),
        },
      });
  }

  private async evaluateTradeCandidates(): Promise<void> {
    const config = getConfig();
    const db = getDb();
    const now = new Date();
    const maxDeadline = new Date(
      now.getTime() + config.strategy.deadlineLookaheadDays * 24 * 60 * 60 * 1000,
    );
    const rows = await db
      .select()
      .from(schema.deadlineMarkets)
      .where(
        and(
          eq(schema.deadlineMarkets.classificationStatus, "candidate"),
          eq(schema.deadlineMarkets.closed, false),
          eq(schema.deadlineMarkets.acceptingOrders, true),
          gte(schema.deadlineMarkets.deadline, config.strategy.allowPostDeadlineEntries ? new Date(0) : now),
        ),
      )
      .orderBy(schema.deadlineMarkets.deadline)
      .limit(100);

    this.evaluatedMarketIds.clear();

    for (const market of rows) {
      if (this.paused) break;
      if (new Date(market.deadline).getTime() > maxDeadline.getTime()) continue;
      
      this.evaluatedMarketIds.add(market.id);

      const hasMaxPositions = this.openPositions.size >= config.strategy.maxSimultaneousPositions;
      if (!config.portfolio.allowNegativeBalance && hasMaxPositions) continue;
      if (this.inFlightTokens.has(market.noTokenId)) continue;
      if ([...this.openPositions.values()].some((p) => p.marketId === market.id)) continue;
      await this.evaluateCandidate(market);
    }
  }

  private async evaluateCandidate(market: typeof schema.deadlineMarkets.$inferSelect): Promise<void> {
    const config = getConfig();
    this.inFlightTokens.add(market.noTokenId);
    try {
      const db = getDb();
      const noPrice = market.noPrice ? parseFloat(market.noPrice) : null;
      if (noPrice == null || noPrice < config.strategy.minNoEntryPrice || noPrice > config.strategy.maxNoEntryPrice) {
        await this.recordOpportunity(market, "rejected", "no_price_outside_entry_band");
        return;
      }
      if (parseFloat(market.liquidityNum ?? "0") < config.strategy.minLiquidityNum) {
        await this.recordOpportunity(market, "rejected", "insufficient_gamma_liquidity");
        return;
      }
      if (parseFloat(market.volume24h ?? "0") < config.strategy.minVolume24h) {
        await this.recordOpportunity(market, "rejected", "insufficient_24h_volume");
        return;
      }

      const { data: book } = await this.client.getOrderbook(market.noTokenId);
      const top = getTopOfBook(book);
      if (top.bestBid == null || top.bestAsk == null || top.spread == null) {
        await this.recordOpportunity(market, "rejected", "empty_no_orderbook");
        return;
      }
      if (top.bestAsk < config.strategy.minNoEntryPrice || top.bestAsk > config.strategy.maxNoEntryPrice) {
        await this.recordOpportunity(market, "rejected", "no_best_ask_outside_entry_band", top);
        return;
      }
      if (top.spread > config.strategy.maxSpread) {
        await this.recordOpportunity(market, "rejected", "spread_too_wide", top);
        return;
      }

      const depthAtLimit = estimateDepthAtOrBelow(book, config.strategy.maxNoEntryPrice);
      const budget = this.portfolioManager.computePositionBudget(this.computeOpenPositionsValue());
      if (budget <= 0) {
        await this.recordOpportunity(market, "rejected", "insufficient_cash", top, depthAtLimit);
        return;
      }

      const feeSchedule = (market.feeSchedule as FeeSchedule | null) ?? null;
      const fill = simulateLimitBuy(book, budget, config.strategy.maxNoEntryPrice, feeSchedule);
      if (fill.totalShares <= 0 || fill.belowMinimumOrderSize) {
        await this.recordOpportunity(market, "rejected", "insufficient_fill_size", top, depthAtLimit);
        return;
      }

      const expectedNetProfit = calculateExpectedNetProfit(fill);
      if (expectedNetProfit < config.strategy.minExpectedNetProfit) {
        await this.recordOpportunity(
          market,
          "rejected",
          "expected_profit_below_threshold",
          top,
          depthAtLimit,
          expectedNetProfit,
        );
        return;
      }

      const deducted = await this.portfolioManager.deductCash(fill.netCost);
      if (!deducted) {
        await this.recordOpportunity(market, "rejected", "cash_deduction_failed", top, depthAtLimit);
        return;
      }

      const trade = await createSimulatedTrade({
        eventId: market.eventId,
        eventSlug: market.eventSlug,
        eventTitle: market.eventTitle,
        marketId: market.id,
        marketSlug: market.slug,
        marketQuestion: market.question,
        deadline: market.deadline,
        deadlineDate: market.deadlineDate,
        tokenId: market.noTokenId,
        entryTs: new Date(),
        entryPrice: fill.averagePrice.toFixed(8),
        entryShares: fill.totalShares.toFixed(8),
        positionBudget: budget.toFixed(8),
        actualCost: fill.netCost.toFixed(8),
        entryFees: fill.fees.toFixed(8),
        fillStatus: fill.isPartialFill ? "PARTIAL" : "FULL",
        expectedNetProfit: expectedNetProfit.toFixed(8),
        noBestBidAtEntry: top.bestBid.toFixed(8),
        noBestAskAtEntry: top.bestAsk.toFixed(8),
        depthAtLimit: depthAtLimit.toFixed(8),
        orderbookSnapshot: fill.orderbookSnapshot,
      });
      if (!trade) throw new Error("Trade insert did not return a row");

      this.openPositions.set(trade.id, {
        tradeId: trade.id,
        marketId: market.id,
        tokenId: market.noTokenId,
        entryPrice: fill.averagePrice,
        entryShares: fill.totalShares,
        fees: fill.fees,
        actualCost: fill.netCost,
        deadline: market.deadline,
      });

      this.trackMarketFromDb(market);

      await this.recordOpportunity(market, "traded", "trade_opened", top, depthAtLimit, expectedNetProfit);
      await db.update(schema.deadlineMarkets).set({ classificationStatus: "traded", updatedAt: new Date() }).where(eq(schema.deadlineMarkets.id, market.id));
      await logAudit("info", "TRADE_OPENED", `Opened simulated NO trade for ${market.question}`, {
        tradeId: trade.id,
        marketId: market.id,
        expectedNetProfit,
        entryPrice: fill.averagePrice,
        shares: fill.totalShares,
      });
      this.emit("tradeOpened", { trade });
    } catch (error) {
      logger.error({ error, marketId: market.id }, "Candidate evaluation failed");
      await logAudit("error", "OPPORTUNITY_ERROR", `Candidate evaluation failed for ${market.id}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.inFlightTokens.delete(market.noTokenId);
    }
  }

  private async recordOpportunity(
    market: typeof schema.deadlineMarkets.$inferSelect,
    status: string,
    reason: string,
    top?: { bestBid: number | null; bestAsk: number | null; spread: number | null },
    depthAtLimit?: number,
    expectedNetProfit?: number,
  ) {
    const db = getDb();
    const days = (new Date(market.deadline).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    
    await db.insert(schema.opportunities).values({
      marketId: market.id,
      eventId: market.eventId,
      noTokenId: market.noTokenId,
      status,
      reason,
      deadline: market.deadline,
      daysToDeadline: days.toFixed(8),
      noPrice: market.noPrice,
      noBestBid: top?.bestBid?.toString() ?? null,
      noBestAsk: top?.bestAsk?.toString() ?? null,
      spread: top?.spread?.toString() ?? null,
      depthAtLimit: depthAtLimit?.toString() ?? null,
      expectedNetProfit: expectedNetProfit?.toString() ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: schema.opportunities.marketId,
      set: {
        status,
        reason,
        daysToDeadline: days.toFixed(8),
        noPrice: market.noPrice,
        noBestBid: top?.bestBid?.toString() ?? null,
        noBestAsk: top?.bestAsk?.toString() ?? null,
        spread: top?.spread?.toString() ?? null,
        depthAtLimit: depthAtLimit?.toString() ?? null,
        expectedNetProfit: expectedNetProfit?.toString() ?? null,
        updatedAt: new Date(),
      }
    });
  }

  private getMarketLifecycle(state: TrackedMarket): MarketLifecycle {
    if (state.resolved) return "RESOLVED";
    if (Date.now() >= new Date(state.deadline).getTime()) return "AWAITING_RESOLUTION";
    return "OPEN";
  }

  private checkLifecycleTransitions(): void {
    for (const state of this.trackedMarkets.values()) {
      if (this.getMarketLifecycle(state) === "AWAITING_RESOLUTION" && !state.frozenPrices) {
        state.frozenPrices = { ...state.lastPrices };
        this.persistFrozenPrices(state.marketId, state.frozenPrices).catch(err => 
          logger.error({ err }, "Failed to persist frozen prices on timer")
        );
      }
    }
  }

  private onTokenPriceUpdate(tokenId: string, bestBid: number, bestAsk: number): void {
    const marketId = this.tokenToMarket.get(tokenId);
    if (!marketId) return;
    const state = this.trackedMarkets.get(marketId);
    if (!state) return;
    
    const lifecycle = this.getMarketLifecycle(state);
    
    // Freeze prices at transition
    if (lifecycle !== "OPEN") {
      if (!state.frozenPrices) {
        state.frozenPrices = { ...state.lastPrices };
        this.persistFrozenPrices(state.marketId, state.frozenPrices).catch(err => 
          logger.error({ err }, "Failed to persist frozen prices")
        );
      }
      return; // Ignore incoming WS price updates
    }

    if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk)) return;
    state.lastPrices[tokenId] = {
      bid: bestBid,
      ask: bestAsk,
      mid: (bestBid + bestAsk) / 2,
    };
  }

  private async persistFrozenPrices(marketId: string, frozenPrices: any): Promise<void> {
    const db = getDb();
    await db
      .update(schema.deadlineMarkets)
      .set({ frozenPrices, updatedAt: new Date() })
      .where(eq(schema.deadlineMarkets.id, marketId));
  }

  private async onMarketResolved(ev: MarketResolvedEvent): Promise<void> {
    const marketId = this.conditionIdToMarket.get(ev.conditionId);
    if (!marketId) return;
    await this.resolvePositionsForMarket(marketId, ev.winningAssetId, ev.winningOutcome);
  }

  private async pollOpenPositionSettlements(): Promise<void> {
    const marketIds = new Set([...this.openPositions.values()].map((p) => p.marketId));
    for (const marketId of marketIds) {
      const market = await this.client.getMarketById(marketId);
      if (!market?.closed) continue;
      const outcomes = PolymarketClient.parseOutcomes(market);
      const tokens = PolymarketClient.parseClobTokenIds(market);
      const prices = PolymarketClient.parseOutcomePrices(market);
      const winnerIndex = prices.findIndex((p) => p >= 0.99);
      if (winnerIndex < 0 || !tokens[winnerIndex]) continue;
      await this.resolvePositionsForMarket(marketId, tokens[winnerIndex]!, outcomes[winnerIndex] ?? "Unknown");
    }
  }

  private async resolvePositionsForMarket(
    marketId: string,
    winningTokenId: string,
    winningOutcome: string,
  ): Promise<void> {
    const positions = [...this.openPositions.values()].filter((p) => p.marketId === marketId);
    const state = this.trackedMarkets.get(marketId);
    if (state) state.resolved = true;

    for (const pos of positions) {
      const isWin = pos.tokenId === winningTokenId;
      const pnl = isWin
        ? calculateWinProfit(pos.entryPrice, pos.entryShares, pos.fees)
        : calculateLossAmount(pos.entryPrice, pos.entryShares, pos.fees);
      const cashReturn = pos.actualCost + pnl;
      if (cashReturn > 0) await this.portfolioManager.addCash(cashReturn);
      const trade = await resolveTrade(
        pos.tradeId,
        isWin ? "WIN" : "LOSS",
        pnl.toFixed(8),
        isWin ? "1" : "0",
        { exitReason: "RESOLUTION" },
      );
      this.openPositions.delete(pos.tradeId);
      this.updateConsecutiveLossState(isWin);
      await logAudit("info", "TRADE_RESOLVED", `Trade ${pos.tradeId} resolved ${isWin ? "WIN" : "LOSS"}`, {
        marketId,
        winningOutcome,
        pnl,
      });
      this.emit("tradeResolved", { tradeId: pos.tradeId, isWin, pnl, exitPrice: isWin ? 1 : 0, trade });
    }
  }

  private updateConsecutiveLossState(isWin: boolean): void {
    const config = getConfig();
    const limit = config.strategy.consecutiveLossPauseLimit;
    if (limit <= 0) return;
    if (isWin) {
      this.consecutiveLossCount = 0;
      return;
    }
    this.consecutiveLossCount++;
    if (this.consecutiveLossCount < limit || this.paused) return;
    this.pausedByRiskGuard = true;
    this.riskPauseTriggeredAt = Date.now();
    this.pause();
    if (config.strategy.riskAutoResumeEnabled) {
      this.riskAutoResumeTimer = setTimeout(() => {
        this.resume().catch((error) => logger.error({ error }, "Auto-resume failed"));
      }, config.strategy.riskAutoResumeCooldownMs);
    }
  }

  private async loadOpenPositions(): Promise<void> {
    const rows = await loadOpenTradesWithMarkets();
    for (const { trade, market } of rows) {
      this.openPositions.set(trade.id, {
        tradeId: trade.id,
        marketId: trade.marketId ?? "",
        tokenId: trade.tokenId ?? "",
        entryPrice: parseFloat(trade.entryPrice),
        entryShares: parseFloat(trade.entryShares),
        fees: parseFloat(trade.entryFees ?? "0"),
        actualCost: parseFloat(trade.actualCost),
        deadline: trade.deadline,
      });
      if (market) {
        this.trackMarketFromDb(market);
      }
    }
  }

  private trackMarketFromDb(market: typeof schema.deadlineMarkets.$inferSelect): void {
    if (this.trackedMarkets.has(market.id)) return;
    const item: TrackedMarket = {
      marketId: market.id,
      eventId: market.eventId,
      eventSlug: market.eventSlug,
      eventTitle: market.eventTitle,
      question: market.question,
      slug: market.slug,
      conditionId: market.conditionId,
      deadline: market.deadline,
      deadlineDate: market.deadlineDate,
      noTokenId: market.noTokenId,
      yesTokenId: market.yesTokenId,
      noPrice: market.noPrice ? parseFloat(market.noPrice) : null,
      feeSchedule: (market.feeSchedule as FeeSchedule | null) ?? null,
      resolutionRules: market.resolutionRules,
      lastPrices: {},
      frozenPrices: (market.frozenPrices as any) ?? null,
      resolved: false,
    };
    this.trackedMarkets.set(market.id, item);
    this.tokenToMarket.set(market.noTokenId, market.id);
    if (market.conditionId) this.conditionIdToMarket.set(market.conditionId, market.id);
    this.wsWatcher.subscribe([market.noTokenId]);
  }
}

let instance: MarketOrchestrator | null = null;
export function getMarketOrchestrator(): MarketOrchestrator {
  if (!instance) instance = new MarketOrchestrator();
  return instance;
}
