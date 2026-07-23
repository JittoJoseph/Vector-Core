import { EventEmitter } from "events";
import { eq, inArray } from "drizzle-orm";
import { createModuleLogger } from "../utils/logger.js";
import { getConfig } from "../utils/config.js";
import {
  getDb,
  createTrade,
  loadOpenTrades,
  logAudit,
  resolveTrade,
  sumRealizedPnl,
  updateTradePositionSize,
  wipeAllData,
} from "../db/client.js";
import * as schema from "../db/schema.js";
import { getPolymarketClient, PolymarketClient } from "./polymarket-client.js";
import {
  calculateLossAmount,
  calculateWinProfit,
  getTopOfBook,
  simulateTakerSell,
  simulateLimitBuy,
} from "./execution-simulator.js";
import {
  getMarketWebSocketWatcher,
  MarketWebSocketWatcher,
} from "./market-ws-watcher.js";
import type {
  FeeSchedule,
  GammaEvent,
  GammaMarket,
} from "../types/index.js";
import type { MarketResolvedEvent } from "../interfaces/websocket-types.js";
import { executionPolicy } from "./execution-policy.js";
import {
  parseBucketMinMax,
  findModalBucket,
  isCandidateBucket,
  isRelevantBucket,
  isSupportedWeatherCampaign,
  WEATHER_TAG_ID,
} from "../utils/weather-logic.js";

const logger = createModuleLogger("market-orchestrator");

const MAX_ENTRY_SPREAD = 0.02;
const TRADE_BUDGET = 5;

interface TrackedBucket {
  bucketId: string;
  campaignId: string;
  groupItemTitle: string;
  noTokenId: string;
  yesTokenId: string;
  feeSchedule: FeeSchedule | null;
  lastPrices: Record<string, { bid: number; ask: number; mid: number }>;
  resolved: boolean;
  acceptingOrders: boolean;
}

interface OpenPosition {
  tradeId: string;
  bucketId: string;
  tokenId: string;
  entryPrice: number;
  entryShares: number;
  fees: number;
  actualCost: number;
  minNoPriceDuringPosition: number | null;
  stopLossConditionFirstSeen?: number | null;
  isExiting?: boolean;
}

export interface PortfolioSnapshot {
  initialCapital: number;
  realizedPnl: number;
  unrealizedPnl: number;
  netPnl: number;
  portfolioValue: number;
  roi: number;
  cashBalance: number;
  openPositionsValue: number;
  openPositions: number;
}

export interface PositionPnl {
  mid: number | null;
  pnl: number | null;
  pnlPct: number | null;
  minNoPrice: number | null;
}

interface Candidate {
  bucket: typeof schema.buckets.$inferSelect;
  campaign: typeof schema.campaigns.$inferSelect;
  expectedNetProfit: number;
  expectedReturnPercent: number;
  execResult: ReturnType<typeof simulateLimitBuy>;
  modalBucketTitle: string;
}

export class MarketOrchestrator extends EventEmitter {
  private client = getPolymarketClient();
  private wsWatcher: MarketWebSocketWatcher = getMarketWebSocketWatcher();

  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private evaluateTimer: ReturnType<typeof setInterval> | null = null;
  private settlementTimer: ReturnType<typeof setInterval> | null = null;

  private trackedBuckets = new Map<string, TrackedBucket>();
  private tokenToBucket = new Map<string, string>();
  private conditionIdToBucket = new Map<string, string>();
  private openPositions = new Map<string, OpenPosition>();
  private realizedPnl = 0;

  private running = false;
  private paused = false;
  private cycleCount = 0;
  private isEvaluating = false;
  private isSyncing = false;

  private pausedByRiskGuard = false;
  private consecutiveLossCount = 0;
  private riskAutoResumeTimer: NodeJS.Timeout | null = null;
  private activeCampaignMetrics = new Map<
    string,
    { candidateCount: number; trackedCount: number; positionCount: number }
  >();

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.loadState();
    this.wireEvents();
    this.wsWatcher.start();
    executionPolicy.start();
    await this.syncCampaigns();
    await this.evaluateOpportunities();
    this.startTimers();
    logger.info("Market orchestrator started");
  }

  stop(): void {
    this.running = false;
    this.clearTimers();
    if (this.riskAutoResumeTimer) clearTimeout(this.riskAutoResumeTimer);
    this.wsWatcher.stop();
    executionPolicy.stop();
    logger.info("Market orchestrator stopped");
  }

  pause(): void {
    this.paused = true;
    this.clearTimers();
    this.wsWatcher.stop();
  }

  async resume(): Promise<void> {
    if (!this.paused) return;
    this.paused = false;
    this.pausedByRiskGuard = false;
    this.consecutiveLossCount = 0;
    this.wsWatcher.start();
    await this.loadState();
    await this.syncCampaigns();
    await this.evaluateOpportunities();
    this.startTimers();
  }

  async wipe(): Promise<void> {
    this.pause();
    await wipeAllData();
    this.trackedBuckets.clear();
    this.tokenToBucket.clear();
    this.conditionIdToBucket.clear();
    this.openPositions.clear();
    this.wsWatcher.clear();
    this.realizedPnl = 0;
    this.cycleCount = 0;
    this.consecutiveLossCount = 0;
    this.pausedByRiskGuard = false;
  }

  isPaused(): boolean {
    return this.paused;
  }

  private startTimers(): void {
    const config = getConfig();
    if (!this.syncTimer)
      this.syncTimer = setInterval(() => {
        this.syncCampaigns().catch((error) =>
          logger.error({ error }, "Campaign sync failed"),
        );
      }, 60_000);
    if (!this.evaluateTimer)
      this.evaluateTimer = setInterval(() => {
        this.evaluateOpportunities().catch((error) =>
          logger.error({ error }, "Opportunity evaluation failed"),
        );
      }, config.strategy.scanIntervalMs);
    if (!this.settlementTimer)
      this.settlementTimer = setInterval(() => {
        this.pollOpenPositionSettlements().catch((error) =>
          logger.error({ error }, "Settlement polling failed"),
        );
      }, 60_000);
  }

  private clearTimers(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
    if (this.evaluateTimer) clearInterval(this.evaluateTimer);
    if (this.settlementTimer) clearInterval(this.settlementTimer);
    this.syncTimer = null;
    this.evaluateTimer = null;
    this.settlementTimer = null;
  }

  private async loadState(): Promise<void> {
    this.realizedPnl = await sumRealizedPnl();
    const openTrades = await loadOpenTrades();
    const refreshed = new Map<string, OpenPosition>();
    for (const trade of openTrades) {
      const existing = this.openPositions.get(trade.id);
      refreshed.set(
        trade.id,
        existing ?? {
          tradeId: trade.id,
          bucketId: trade.bucketId ?? "",
          tokenId: trade.tokenId ?? "",
          entryPrice: parseFloat(trade.entryPrice),
          entryShares: parseFloat(trade.entryShares),
          fees: parseFloat(trade.entryFees),
          actualCost: parseFloat(trade.actualCost),
          minNoPriceDuringPosition:
            trade.minNoPriceDuringPosition !== null
              ? parseFloat(trade.minNoPriceDuringPosition)
              : null,
        },
      );
    }
    this.openPositions = refreshed;
  }

  getStats() {
    return {
      running: this.running,
      paused: this.paused,
      activeBuckets: this.trackedBuckets.size,
      openPositions: this.openPositions.size,
      cycleCount: this.cycleCount,
      ws: this.wsWatcher.getStats(),
      risk: {
        consecutiveLossCount: this.consecutiveLossCount,
        pausedByRiskGuard: this.pausedByRiskGuard,
      },
      polymarketStatus: executionPolicy.getStatus(),
    };
  }

  getOpenPositions(): OpenPosition[] {
    return Array.from(this.openPositions.values());
  }

  private getPositionMid(pos: OpenPosition): number | null {
    const price = this.trackedBuckets.get(pos.bucketId)?.lastPrices[
      pos.tokenId
    ];
    return price ? price.mid : null;
  }

  getOpenPositionsPnl(): Record<string, PositionPnl> {
    const result: Record<string, PositionPnl> = {};
    for (const pos of this.openPositions.values()) {
      const mid = this.getPositionMid(pos);
      const pnl =
        mid !== null
          ? (mid - pos.entryPrice) * pos.entryShares - pos.fees
          : null;
      result[pos.tradeId] = {
        mid,
        pnl,
        pnlPct:
          pnl !== null && pos.actualCost > 0
            ? (pnl / pos.actualCost) * 100
            : null,
        minNoPrice: pos.minNoPriceDuringPosition,
      };
    }
    return result;
  }

  getPortfolioSnapshot(): PortfolioSnapshot {
    const config = getConfig();
    const initialCapital = config.portfolio.startingCapital;

    let openPositionsValue = 0;
    let unrealizedPnl = 0;
    for (const pos of this.openPositions.values()) {
      openPositionsValue += pos.actualCost;
      const mid = this.getPositionMid(pos);
      if (mid !== null) {
        unrealizedPnl += (mid - pos.entryPrice) * pos.entryShares - pos.fees;
      }
    }

    const netPnl = this.realizedPnl + unrealizedPnl;
    return {
      initialCapital,
      realizedPnl: this.realizedPnl,
      unrealizedPnl,
      netPnl,
      portfolioValue: initialCapital + netPnl,
      roi: initialCapital > 0 ? (netPnl / initialCapital) * 100 : 0,
      cashBalance: initialCapital + this.realizedPnl - openPositionsValue,
      openPositionsValue,
      openPositions: this.openPositions.size,
    };
  }

  getActiveCampaignMetrics(campaignId: string) {
    return (
      this.activeCampaignMetrics.get(campaignId) || {
        candidateCount: 0,
        trackedCount: 0,
        positionCount: 0,
      }
    );
  }

  private wireEvents(): void {
    this.wsWatcher.on("priceUpdate", (ev) =>
      this.onTokenPriceUpdate(
        ev.tokenId,
        parseFloat(ev.bestBid),
        parseFloat(ev.bestAsk),
      ),
    );
    this.wsWatcher.on("bestBidAskUpdate", (ev) =>
      this.onTokenPriceUpdate(
        ev.tokenId,
        parseFloat(ev.bestBid),
        parseFloat(ev.bestAsk),
      ),
    );
    this.wsWatcher.on("marketResolved", (ev: MarketResolvedEvent) =>
      this.onMarketResolved(ev).catch((error) =>
        logger.error({ error }, "Market resolution handling failed"),
      ),
    );
  }

  async syncCampaigns(): Promise<void> {
    if (this.paused || this.isSyncing) return;
    this.isSyncing = true;
    try {
      const events: GammaEvent[] = [];
      let cursor: string | undefined;
      do {
        const page = await this.client.listEventsKeyset({
          limit: 100,
          active: true,
          closed: false,
          tag_id: WEATHER_TAG_ID,
          after_cursor: cursor,
        });
        events.push(...page.events);
        cursor = page.nextCursor ?? undefined;
      } while (cursor && events.length < 1000);

      const openApiEventIds = new Set(events.map((e) => String(e.id)));

      for (const event of events) {
        if (this.paused) break;
        if (!event.negRisk) continue;
        await this.persistCampaign(event);
      }

      const db = getDb();
      const openDbCampaigns = await db
        .select()
        .from(schema.campaigns)
        .where(eq(schema.campaigns.closed, false));
      for (const c of openDbCampaigns) {
        if (this.paused) break;
        if (!isSupportedWeatherCampaign(c.title)) {
          await db
            .update(schema.campaigns)
            .set({ closed: true, updatedAt: new Date() })
            .where(eq(schema.campaigns.id, c.id));
          continue;
        }
        if (!openApiEventIds.has(c.id)) {
          try {
            const fullEvent = await this.client.getEventById(c.id);
            if (fullEvent) await this.persistCampaign(fullEvent);
          } catch (err) {
            logger.error(
              { err, campaignId: c.id },
              "Failed to refresh dropped campaign",
            );
          }
        }
      }
    } finally {
      this.isSyncing = false;
    }
  }

  private async persistCampaign(event: GammaEvent): Promise<void> {
    if (!isSupportedWeatherCampaign(event.title)) return;

    const db = getDb();
    const eventId = String(event.id);
    const isClosed = event.closed ?? false;

    await db
      .insert(schema.campaigns)
      .values({
        id: eventId,
        slug: event.slug ?? eventId,
        title: event.title ?? eventId,
        seriesSlug: (event as any).seriesSlug ?? null,
        startDate: event.startDate ? new Date(event.startDate) : null,
        endDate: event.endDate ? new Date(event.endDate) : null,
        closed: isClosed,
        lastFetchedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.campaigns.id,
        set: {
          title: event.title ?? eventId,
          closed: isClosed,
          lastFetchedAt: new Date(),
          updatedAt: new Date(),
        },
      });

    if (!event.markets || event.markets.length === 0) {
      const fullEvent = await this.client.getEventBySlug(event.slug ?? eventId);
      if (fullEvent?.markets) {
        event.markets = fullEvent.markets;
      }
    }

    for (const market of event.markets ?? []) {
      if (!market.groupItemTitle) continue;
      const clobTokenIds = PolymarketClient.parseClobTokenIds(market);
      if (clobTokenIds.length < 2) continue;

      const prices = PolymarketClient.parseOutcomePrices(market);
      const bucketValues = {
        slug: market.slug ?? null,
        yesPrice: prices[0]?.toString() ?? null,
        noPrice: prices[1]?.toString() ?? null,
        spread: market.spread?.toString() ?? null,
        liquidityNum: (market.liquidityNum ?? 0).toString(),
        volume24h: (market.volumeNum ?? 0).toString(),
        lastFetchedAt: new Date(),
        updatedAt: new Date(),
      };

      await db
        .insert(schema.buckets)
        .values({
          id: market.id,
          campaignId: eventId,
          conditionId: market.conditionId ?? null,
          groupItemTitle: market.groupItemTitle,
          yesTokenId: clobTokenIds[0]!,
          noTokenId: clobTokenIds[1]!,
          ...bucketValues,
        })
        .onConflictDoUpdate({
          target: schema.buckets.id,
          set: bucketValues,
        });

      this.trackBucket(market, eventId, clobTokenIds[1]!, clobTokenIds[0]!);
    }
  }

  private trackBucket(
    market: GammaMarket,
    campaignId: string,
    noTokenId: string,
    yesTokenId: string,
  ): void {
    if (this.trackedBuckets.has(market.id)) return;
    this.trackedBuckets.set(market.id, {
      bucketId: market.id,
      campaignId,
      groupItemTitle: market.groupItemTitle ?? "",
      noTokenId,
      yesTokenId,
      feeSchedule: (market.feeSchedule as FeeSchedule | null) ?? null,
      lastPrices: {},
      resolved: false,
      acceptingOrders: market.acceptingOrders ?? true,
    });
    this.tokenToBucket.set(noTokenId, market.id);
    if (market.conditionId)
      this.conditionIdToBucket.set(market.conditionId, market.id);
  }

  async evaluateOpportunities(): Promise<void> {
    if (this.paused || this.isEvaluating) return;
    this.isEvaluating = true;
    this.cycleCount++;

    try {
      await this.loadState();
      const result = await this.findCandidateOpportunities();
      if (!result) return;

      const { candidates, requiredTokens } = result;
      this.updateWsSubscriptions(requiredTokens);
      await this.executeCandidates(candidates);
    } finally {
      this.isEvaluating = false;
    }
  }

  private async findCandidateOpportunities(): Promise<{
    candidates: Candidate[];
    requiredTokens: Set<string>;
  } | null> {
    const config = getConfig();
    const db = getDb();

    const campaigns = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.closed, false));
    if (campaigns.length === 0) return null;

    const allBuckets = await db
      .select()
      .from(schema.buckets)
      .where(
        inArray(
          schema.buckets.campaignId,
          campaigns.map((c) => c.id),
        ),
      );

    const candidates: Candidate[] = [];
    const requiredTokens = new Set<string>();

    for (const p of this.openPositions.values()) {
      const b = this.trackedBuckets.get(p.bucketId);
      if (b) {
        requiredTokens.add(b.noTokenId);
        requiredTokens.add(b.yesTokenId);
      }
    }

    this.activeCampaignMetrics.clear();

    for (const campaign of campaigns) {
      const buckets = allBuckets.filter((b) => b.campaignId === campaign.id);
      if (buckets.length === 0) continue;

      const modalBucket = findModalBucket(buckets);
      if (!modalBucket) continue;

      const [modalMin] = parseBucketMinMax(modalBucket.groupItemTitle);
      requiredTokens.add(modalBucket.noTokenId);
      requiredTokens.add(modalBucket.yesTokenId);

      let candidateCount = 0;
      let trackedCount = 0;
      let positionCount = 0;

      for (const bucket of buckets) {
        if (!isCandidateBucket(bucket.groupItemTitle, modalMin)) continue;
        candidateCount++;

        const noPrice = parseFloat(bucket.noPrice ?? "1");
        const bucketHasPosition = [...this.openPositions.values()].some(
          (p) => p.bucketId === bucket.id,
        );
        if (bucketHasPosition) positionCount++;

        if (
          isRelevantBucket(
            true,
            false,
            noPrice,
            config.strategy.maxNoEntryPrice,
            bucketHasPosition,
          )
        ) {
          trackedCount++;
          requiredTokens.add(bucket.noTokenId);
          requiredTokens.add(bucket.yesTokenId);
        }

        if (
          noPrice < config.strategy.minNoEntryPrice ||
          noPrice > config.strategy.maxNoEntryPrice
        )
          continue;
        if (bucketHasPosition) continue;

        const state = this.trackedBuckets.get(bucket.id);
        if (state && (state.resolved || !state.acceptingOrders)) continue;

        const { data: book } = await this.client.getOrderbook(
          bucket.noTokenId,
        );
        const top = getTopOfBook(book);
        if (
          top.bestAsk == null ||
          top.bestAsk < config.strategy.minNoEntryPrice ||
          top.bestAsk > config.strategy.maxNoEntryPrice
        )
          continue;
        if (top.spread == null || top.spread > MAX_ENTRY_SPREAD) continue;

        const execResult = simulateLimitBuy(
          book,
          TRADE_BUDGET,
          config.strategy.maxNoEntryPrice,
          state?.feeSchedule ?? null,
        );
        if (execResult.totalShares <= 0 || execResult.belowMinimumOrderSize)
          continue;

        const expectedNetProfit = execResult.totalShares - execResult.netCost;
        if (expectedNetProfit < config.strategy.minExpectedNetProfit) continue;

        candidates.push({
          bucket,
          campaign,
          expectedNetProfit,
          expectedReturnPercent: expectedNetProfit / execResult.netCost,
          execResult,
          modalBucketTitle: modalBucket.groupItemTitle,
        });
      }

      this.activeCampaignMetrics.set(campaign.id, {
        candidateCount,
        trackedCount,
        positionCount,
      });
    }

    return { candidates, requiredTokens };
  }

  private updateWsSubscriptions(requiredTokens: Set<string>): void {
    const currentlySubscribed = this.wsWatcher.getSubscribedTokens();
    const toSubscribe = [...requiredTokens].filter(
      (t) => !currentlySubscribed.has(t),
    );
    const toUnsubscribe = [...currentlySubscribed].filter(
      (t) => !requiredTokens.has(t),
    );
    if (toSubscribe.length > 0) this.wsWatcher.subscribe(toSubscribe);
    if (toUnsubscribe.length > 0) this.wsWatcher.unsubscribe(toUnsubscribe);
  }

  private async executeCandidates(candidates: Candidate[]): Promise<void> {
    const config = getConfig();

    candidates.sort((a, b) => {
      if (b.expectedReturnPercent !== a.expectedReturnPercent)
        return b.expectedReturnPercent - a.expectedReturnPercent;
      return (
        parseFloat(b.bucket.volume24h ?? "0") -
        parseFloat(a.bucket.volume24h ?? "0")
      );
    });

    for (const cand of candidates) {
      if (
        this.openPositions.size >= config.strategy.maxSimultaneousPositions &&
        !config.portfolio.allowNegativeBalance
      )
        break;

      try {
        await this.executeMarketEntry(cand);
      } catch (err) {
        logger.error(
          { err, bucketId: cand.bucket.id },
          "Failed to execute entry",
        );
      }
    }
  }

  private async executeMarketEntry(cand: Candidate): Promise<void> {
    if (!executionPolicy.canOpenNewPositions()) {
      logger.info(
        "Skipping market entry: Polymarket status restricts new positions",
      );
      return;
    }

    const execResult = cand.execResult;
    const trade = await createTrade({
      campaignId: cand.campaign.id,
      campaignSlug: cand.campaign.slug,
      campaignTitle: cand.campaign.title,
      bucketId: cand.bucket.id,
      bucketSlug: cand.bucket.slug,
      bucketGroupTitle: cand.bucket.groupItemTitle,
      tokenId: cand.bucket.noTokenId,
      entryTs: new Date(),
      entryPrice: execResult.averagePrice.toFixed(8),
      entryShares: execResult.totalShares.toFixed(8),
      actualCost: execResult.netCost.toFixed(8),
      entryFees: execResult.fees.toFixed(8),
      expectedNetProfit: cand.expectedNetProfit.toFixed(8),
      modalBucketAtEntry: cand.modalBucketTitle,
    });
    if (!trade) return;

    this.openPositions.set(trade.id, {
      tradeId: trade.id,
      bucketId: cand.bucket.id,
      tokenId: cand.bucket.noTokenId,
      entryPrice: execResult.averagePrice,
      entryShares: execResult.totalShares,
      fees: execResult.fees,
      actualCost: execResult.netCost,
      minNoPriceDuringPosition: null,
    });
    await logAudit(
      "info",
      "TRADE_OPENED",
      `Opened simulated NO trade for ${cand.bucket.groupItemTitle}`,
      { tradeId: trade.id },
    );
    logger.info(
      { tradeId: trade.id, bucketId: cand.bucket.id },
      "Entry executed",
    );
    this.emit("tradeOpened", { trade });
  }

  private onTokenPriceUpdate(
    tokenId: string,
    bestBid: number,
    bestAsk: number,
  ): void {
    const bucketId = this.tokenToBucket.get(tokenId);
    if (!bucketId) return;
    const state = this.trackedBuckets.get(bucketId);
    if (!state || state.resolved) return;
    state.lastPrices[tokenId] = {
      bid: bestBid,
      ask: bestAsk,
      mid: (bestBid + bestAsk) / 2,
    };

    const config = getConfig();
    const validAsk = !Number.isNaN(bestAsk) && bestAsk > 0 ? bestAsk : null;
    if (validAsk === null) return;

    for (const pos of this.openPositions.values()) {
      if (pos.tokenId !== tokenId || pos.bucketId !== bucketId) continue;

      if (
        state.acceptingOrders &&
        (pos.minNoPriceDuringPosition === null ||
          validAsk < pos.minNoPriceDuringPosition)
      ) {
        pos.minNoPriceDuringPosition = validAsk;
      }

      if (!config.strategy.stopLossEnabled) continue;
      if (validAsk <= config.strategy.stopLossNoPrice) {
        const now = Date.now();
        if (!pos.stopLossConditionFirstSeen) {
          pos.stopLossConditionFirstSeen = now;
        } else if (
          now - pos.stopLossConditionFirstSeen >= 10_000 &&
          executionPolicy.canExecuteStopLoss()
        ) {
          this.executeStopLoss(pos, state.feeSchedule).catch((e) =>
            logger.error({ err: e }, "Failed to execute stop loss"),
          );
        }
      } else {
        pos.stopLossConditionFirstSeen = null;
      }
    }
  }

  private async executeStopLoss(
    pos: OpenPosition,
    feeSchedule: FeeSchedule | null,
  ): Promise<void> {
    if (pos.isExiting) return;
    pos.isExiting = true;
    try {
      logger.warn(
        { tradeId: pos.tradeId, bucketId: pos.bucketId },
        "Executing stop-loss",
      );
      const { data: book } = await this.client.getOrderbook(pos.tokenId);

      const exit = simulateTakerSell(book, pos.entryShares, feeSchedule);
      if (exit.totalShares <= 0) {
        logger.warn(
          { tradeId: pos.tradeId },
          "Stop-loss failed: no bids available",
        );
        pos.isExiting = false;
        return;
      }

      if (exit.isPartialFill) {
        const ratioRemaining = 1 - exit.totalShares / pos.entryShares;
        pos.entryShares -= exit.totalShares;
        pos.actualCost *= ratioRemaining;
        pos.fees *= ratioRemaining;
        logger.warn(
          { tradeId: pos.tradeId, remainingShares: pos.entryShares },
          "Stop-loss partial fill",
        );
        await updateTradePositionSize(
          pos.tradeId,
          pos.entryShares.toFixed(8),
          pos.actualCost.toFixed(8),
          pos.fees.toFixed(8),
        );
        pos.isExiting = false;
      } else {
        const realizedPnl = exit.netCost - pos.actualCost;
        this.realizedPnl += realizedPnl;
        logger.info(
          { tradeId: pos.tradeId, avgPrice: exit.averagePrice, realizedPnl },
          "Stop-loss fully executed",
        );
        await resolveTrade(
          pos.tradeId,
          "LOSS",
          realizedPnl.toFixed(8),
          exit.averagePrice.toFixed(8),
          "EARLY_EXIT",
          pos.minNoPriceDuringPosition?.toFixed(8),
        );
        this.openPositions.delete(pos.tradeId);
        this.emit("tradeResolved", { bucketId: pos.bucketId });
      }
    } catch (e) {
      pos.isExiting = false;
      throw e;
    }
  }

  private async onMarketResolved(ev: MarketResolvedEvent): Promise<void> {
    const bucketId = this.conditionIdToBucket.get(ev.conditionId);
    if (!bucketId) return;
    await this.resolvePositionsForBucket(bucketId, ev.winningAssetId);
  }

  private async pollOpenPositionSettlements(): Promise<void> {
    const bucketIds = new Set(
      [...this.openPositions.values()].map((p) => p.bucketId),
    );
    for (const bucketId of bucketIds) {
      const market = await this.client.getMarketById(bucketId);
      if (!market) continue;

      const state = this.trackedBuckets.get(bucketId);
      if (state && market.acceptingOrders === false) {
        state.acceptingOrders = false;
      }

      if (!market.closed) continue;
      const tokens = PolymarketClient.parseClobTokenIds(market);
      const prices = PolymarketClient.parseOutcomePrices(market);
      const winnerIndex = prices.findIndex((p) => p >= 0.99);
      if (winnerIndex < 0 || !tokens[winnerIndex]) continue;
      await this.resolvePositionsForBucket(bucketId, tokens[winnerIndex]!);
    }
  }

  private async resolvePositionsForBucket(
    bucketId: string,
    winningTokenId: string,
  ): Promise<void> {
    const positions = [...this.openPositions.values()].filter(
      (p) => p.bucketId === bucketId,
    );
    const state = this.trackedBuckets.get(bucketId);
    if (state) state.resolved = true;

    try {
      const db = getDb();
      const [bucket] = await db
        .select()
        .from(schema.buckets)
        .where(eq(schema.buckets.id, bucketId));
      if (bucket) {
        const isYesWinner = bucket.yesTokenId === winningTokenId;
        await db
          .update(schema.buckets)
          .set({
            yesPrice: isYesWinner ? "1" : "0",
            noPrice: isYesWinner ? "0" : "1",
            updatedAt: new Date(),
          })
          .where(eq(schema.buckets.id, bucketId));
      }
    } catch (err) {
      logger.error({ err, bucketId }, "Failed to persist bucket resolution");
    }

    for (const pos of positions) {
      const isWin = pos.tokenId === winningTokenId;
      const pnl = isWin
        ? calculateWinProfit(pos.entryPrice, pos.entryShares, pos.fees)
        : calculateLossAmount(pos.entryPrice, pos.entryShares, pos.fees);
      this.realizedPnl += pnl;
      const trade = await resolveTrade(
        pos.tradeId,
        isWin ? "WIN" : "LOSS",
        pnl.toFixed(8),
        isWin ? "1" : "0",
        "RESOLUTION",
        pos.minNoPriceDuringPosition?.toFixed(8),
      );
      this.openPositions.delete(pos.tradeId);
      this.updateConsecutiveLossState(isWin);
      await logAudit(
        "info",
        "TRADE_RESOLVED",
        `Trade ${pos.tradeId} resolved ${isWin ? "WIN" : "LOSS"}`,
        { bucketId, pnl },
      );
      this.emit("tradeResolved", { tradeId: pos.tradeId, isWin, pnl, trade });
    }
  }

  private updateConsecutiveLossState(isWin: boolean): void {
    const config = getConfig();
    if (config.strategy.consecutiveLossPauseLimit <= 0) return;
    if (isWin) {
      this.consecutiveLossCount = 0;
      return;
    }
    this.consecutiveLossCount++;
    if (
      this.consecutiveLossCount < config.strategy.consecutiveLossPauseLimit ||
      this.paused
    )
      return;
    this.pausedByRiskGuard = true;
    this.pause();
    if (config.strategy.riskAutoResumeEnabled) {
      this.riskAutoResumeTimer = setTimeout(
        () =>
          this.resume().catch((error) =>
            logger.error({ error }, "Risk auto-resume failed"),
          ),
        config.strategy.riskAutoResumeCooldownMs,
      );
    }
  }
}

let instance: MarketOrchestrator | null = null;
export function getMarketOrchestrator(): MarketOrchestrator {
  if (!instance) instance = new MarketOrchestrator();
  return instance;
}
