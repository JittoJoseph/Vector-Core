import { EventEmitter } from "events";
import { and, desc, eq, sql, inArray } from "drizzle-orm";
import { createModuleLogger } from "../utils/logger.js";
import { getConfig } from "../utils/config.js";
import {
  getDb,
  createSimulatedTrade,
  loadOpenTradesWithBuckets,
  logAudit,
  resolveTrade,
  wipeAndResetPortfolio,
  updateTradePositionSize,
} from "../db/client.js";
import * as schema from "../db/schema.js";
import { getPolymarketClient, PolymarketClient } from "./polymarket-client.js";
import { PortfolioManager } from "./portfolio-manager.js";
import {
  calculateLossAmount,
  calculateWinProfit,
  estimateDepthAtOrBelow,
  getTopOfBook,
  simulateTakerSell,
  simulateLimitBuy,
  type ExecutionResult,
} from "./execution-simulator.js";
import {
  getMarketWebSocketWatcher,
  MarketWebSocketWatcher,
} from "./market-ws-watcher.js";
import type { FeeSchedule, GammaEvent, GammaMarket } from "../types/index.js";
import type { MarketResolvedEvent } from "../interfaces/websocket-types.js";
import { executionPolicy } from "./execution-policy.js";

const logger = createModuleLogger("distribution-orchestrator");
import { notifyDiscordEntry } from "../utils/discord.js";

import {
  parseBucketMinMax,
  findModalBucket,
  isCandidateBucket,
  isRelevantBucket,
  cumulativeYesMassBelow,
  modalMarginBelow,
  bucketDistanceBelowModal,
  campaignAgeFraction,
  analyzeDipRecovery,
  windowPriceHistory,
  downsamplePriceHistory,
  isRecoveryEntryAllowed,
  computeStopNoPrice,
  evaluateSyncEntryGates,
  ladderYesMap,
  type EntryGateMetrics,
  type DipRecoveryAnalysis,
} from "../utils/distribution-logic.js";

// Cap on points kept per trade for the dip-timeline chart: enough resolution
// for a compact sparkline, small enough for a one-time jsonb write.
const ENTRY_PRICE_HISTORY_POINTS = 48;

interface TrackedBucket {
  bucketId: string;
  campaignId: string;
  groupItemTitle: string;
  noTokenId: string;
  yesTokenId: string;
  noPrice: number | null;
  feeSchedule: FeeSchedule | null;
  lastPrices: Record<string, { bid: number; ask: number; mid: number }>;
  resolved: boolean;
  endDate: Date | null;
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
  stopNoPrice: number;
  stopLossConditionFirstSeen?: number | null;
  isExiting?: boolean;
}

export type MarketLifecycle = "OPEN" | "AWAITING_RESOLUTION" | "RESOLVED";

type BucketRow = typeof schema.distributionBuckets.$inferSelect;
type CampaignRow = typeof schema.distributionCampaigns.$inferSelect;

interface Candidate {
  bucket: BucketRow;
  campaign: CampaignRow;
  expectedNetProfit: number;
  expectedReturnPercent: number;
  budget: number;
  execResult: ExecutionResult;
  top: ReturnType<typeof getTopOfBook>;
  depthAtLimit: number;
  modalBucketTitle: string;
  gateMetrics: EntryGateMetrics;
  dip: DipRecoveryAnalysis;
  ladderYes: Record<string, number>;
  priceHistory: Array<{ t: number; p: number }>;
}

export class MarketOrchestrator extends EventEmitter {
  private client = getPolymarketClient();
  private wsWatcher: MarketWebSocketWatcher = getMarketWebSocketWatcher();
  readonly portfolioManager = new PortfolioManager();

  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private evaluateTimer: ReturnType<typeof setInterval> | null = null;
  private settlementTimer: ReturnType<typeof setInterval> | null = null;

  private trackedBuckets = new Map<string, TrackedBucket>();
  private tokenToBucket = new Map<string, string>();
  private conditionIdToBucket = new Map<string, string>();
  private openPositions = new Map<string, OpenPosition>();
  private inFlightTokens: Set<string> = new Set();
  private warnedMissingDateCampaigns = new Set<string>();

  private running = false;
  private paused = false;
  private cycleCount = 0;
  private isEvaluating = false;

  private pausedByRiskGuard = false;
  private consecutiveLossCount = 0;
  private riskAutoResumeTimer: NodeJS.Timeout | null = null;
  private activeCampaignMetrics = new Map<
    string,
    {
      candidateCount: number;
      trackedCount: number;
      positionCount: number;
      gateRejectedCount: number;
    }
  >();

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.portfolioManager.init();
    await this.loadOpenPositions();
    this.wireEvents();
    this.wsWatcher.start();
    executionPolicy.start();
    await this.syncCampaigns();
    await this.evaluateOpportunities();
    this.startTimers();
    logger.info("Distribution market orchestrator started");
  }

  private startTimers(): void {
    const config = getConfig();
    if (!this.syncTimer)
      this.syncTimer = setInterval(() => {
        this.syncCampaigns().catch((error) =>
          logger.error({ error }, "Distribution sync failed"),
        );
      }, 60_000);
    if (!this.evaluateTimer)
      this.evaluateTimer = setInterval(() => {
        this.evaluateOpportunities().catch((error) =>
          logger.error({ error }, "Distribution evaluate failed"),
        );
      }, config.strategy.scanIntervalMs);
    if (!this.settlementTimer)
      this.settlementTimer = setInterval(() => {
        this.pollOpenPositionSettlements().catch((error) =>
          logger.error({ error }, "Settlement polling failed"),
        );
      }, 60_000);
  }

  stop(): void {
    this.running = false;
    if (this.syncTimer) clearInterval(this.syncTimer);
    if (this.evaluateTimer) clearInterval(this.evaluateTimer);
    if (this.settlementTimer) clearInterval(this.settlementTimer);
    if (this.riskAutoResumeTimer) clearTimeout(this.riskAutoResumeTimer);
    this.syncTimer = null;
    this.evaluateTimer = null;
    this.settlementTimer = null;
    this.wsWatcher.stop();
    executionPolicy.stop();
    logger.info("Distribution market orchestrator stopped");
  }

  pause(): void {
    this.paused = true;
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.evaluateTimer) {
      clearInterval(this.evaluateTimer);
      this.evaluateTimer = null;
    }
    if (this.settlementTimer) {
      clearInterval(this.settlementTimer);
      this.settlementTimer = null;
    }
    this.wsWatcher.stop();
  }

  async resume(): Promise<void> {
    if (!this.paused) return;
    this.paused = false;
    this.pausedByRiskGuard = false;
    this.consecutiveLossCount = 0;
    this.wsWatcher.start();
    await this.portfolioManager.reload();
    await this.syncCampaigns();
    await this.evaluateOpportunities();
    this.startTimers();
  }

  async wipe(): Promise<void> {
    this.pause();
    const config = getConfig();
    await wipeAndResetPortfolio(config.portfolio.startingCapital);
    this.trackedBuckets.clear();
    this.tokenToBucket.clear();
    this.conditionIdToBucket.clear();
    this.openPositions.clear();
    this.inFlightTokens.clear();
    this.warnedMissingDateCampaigns.clear();
    this.wsWatcher.clear();
    this.cycleCount = 0;
    this.consecutiveLossCount = 0;
    this.pausedByRiskGuard = false;
  }

  isPaused(): boolean {
    return this.paused;
  }

  private isMarketActivelyTrading(state: TrackedBucket): boolean {
    return !state.resolved && state.acceptingOrders;
  }

  private getAuthoritativePriceSignal(bestAsk: number): number | null {
    if (Number.isNaN(bestAsk) || bestAsk <= 0) {
      return null;
    }
    return bestAsk;
  }

  public getOpenPositions(): OpenPosition[] {
    return Array.from(this.openPositions.values());
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

  getOpenPositionPrices(): Record<
    string,
    { bid: number; ask: number; mid: number }
  > {
    const prices: Record<string, { bid: number; ask: number; mid: number }> =
      {};
    for (const pos of this.openPositions.values()) {
      const bucket = this.trackedBuckets.get(pos.bucketId);
      const price = bucket?.lastPrices[pos.tokenId];
      if (price) {
        prices[pos.tokenId] = price;
      }
    }
    return prices;
  }

  computeOpenPositionsValue(): number {
    let total = 0;
    for (const pos of this.openPositions.values()) total += pos.actualCost;
    return total;
  }

  getActiveCampaignMetrics(campaignId: string) {
    return (
      this.activeCampaignMetrics.get(campaignId) || {
        candidateCount: 0,
        trackedCount: 0,
        positionCount: 0,
        gateRejectedCount: 0,
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
      this.onMarketResolved(ev).catch(console.error),
    );
  }

  async syncCampaigns(): Promise<void> {
    if (this.paused) return;

    // Tag 972 = Tweet Markets
    const result = await this.client.listEventsKeyset({
      limit: 100,
      active: true,
      closed: false,
      tag_id: "972",
    });

    const db = getDb();

    const activeApiEventIds = new Set(result.events.map((e) => String(e.id)));

    for (const event of result.events) {
      if (this.paused) break;
      if (!event.negRisk) continue; // Must be a multi-outcome campaign
      await this.persistCampaign(event);
    }

    // Check for campaigns that dropped from the active API list
    const activeDbCampaigns = await db
      .select()
      .from(schema.distributionCampaigns)
      .where(eq(schema.distributionCampaigns.active, true));
    for (const c of activeDbCampaigns) {
      if (this.paused) break;
      if (!activeApiEventIds.has(c.id)) {
        try {
          const fullEvent = await this.client.getEventById(c.id);
          if (fullEvent && (fullEvent.closed || !fullEvent.active)) {
            logger.info(
              { campaignId: c.id },
              "Campaign dropped from active API list, fetching final state...",
            );
            await this.persistCampaign(fullEvent);
          }
        } catch (err) {
          logger.error(
            { err, campaignId: c.id },
            "Failed to fetch dropped campaign state",
          );
        }
      }
    }
  }

  private async persistCampaign(event: GammaEvent): Promise<void> {
    const db = getDb();
    const eventId = String(event.id);

    if (
      !/^Elon Musk # tweets [A-Za-z]+ \d+ - [A-Za-z]+ \d+, \d{4}\?$/.test(
        event.title ?? "",
      )
    ) {
      return;
    }

    const isClosed = event.closed ?? false;
    const isActive = isClosed ? false : (event.active ?? true);

    await db
      .insert(schema.distributionCampaigns)
      .values({
        id: eventId,
        slug: event.slug ?? eventId,
        title: event.title ?? eventId,
        seriesSlug: (event as any).seriesSlug ?? null,
        startDate: event.startDate ? new Date(event.startDate) : null,
        endDate: event.endDate ? new Date(event.endDate) : null,
        active: isActive,
        closed: isClosed,
        lastFetchedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.distributionCampaigns.id,
        set: {
          title: event.title ?? eventId,
          active: isActive,
          closed: isClosed,
          // Backfill dates once Gamma exposes them; never clobber a good
          // value with a later null (keeps the age gate working).
          startDate: sql`COALESCE(excluded.start_date, ${schema.distributionCampaigns.startDate})`,
          endDate: sql`COALESCE(excluded.end_date, ${schema.distributionCampaigns.endDate})`,
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

    if (event.markets && Array.isArray(event.markets)) {
      for (const market of event.markets) {
        if (!market.groupItemTitle) continue;
        const clobTokenIds = PolymarketClient.parseClobTokenIds(market);
        if (clobTokenIds.length < 2) continue; // Need Yes and No tokens

        await db
          .insert(schema.distributionBuckets)
          .values({
            id: market.id,
            campaignId: eventId,
            conditionId: market.conditionId ?? null,
            slug: market.slug ?? null,
            groupItemTitle: market.groupItemTitle,
            yesTokenId: clobTokenIds[0]!,
            noTokenId: clobTokenIds[1]!,
            yesPrice: market.outcomePrices
              ? JSON.parse(market.outcomePrices)[0]
              : null,
            noPrice: market.outcomePrices
              ? JSON.parse(market.outcomePrices)[1]
              : null,
            spread: market.spread?.toString() ?? null,
            liquidityNum: (market.liquidityNum ?? 0).toString(),
            volume24h: (market.volumeNum ?? 0).toString(),
            lastFetchedAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: schema.distributionBuckets.id,
            set: {
              slug: market.slug ?? null,
              yesPrice: market.outcomePrices
                ? JSON.parse(market.outcomePrices)[0]
                : null,
              noPrice: market.outcomePrices
                ? JSON.parse(market.outcomePrices)[1]
                : null,
              spread: market.spread?.toString() ?? null,
              liquidityNum: (market.liquidityNum ?? 0).toString(),
              volume24h: (market.volumeNum ?? 0).toString(),
              lastFetchedAt: new Date(),
              updatedAt: new Date(),
            },
          });

        this.trackBucket(market, eventId, clobTokenIds[1]!, clobTokenIds[0]!);
      }
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
      noPrice: market.outcomePrices
        ? parseFloat(JSON.parse(market.outcomePrices)[1])
        : null,
      feeSchedule: (market.feeSchedule as FeeSchedule | null) ?? null,
      lastPrices: {},
      resolved: false,
      endDate: market.endDate ? new Date(market.endDate) : null,
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
      const result = await this.findCandidateOpportunities();
      if (!result) return;

      const { allCandidates, requiredTokens } = result;
      this.updateWsSubscriptions(requiredTokens);
      await this.executeCandidates(allCandidates);
    } finally {
      this.isEvaluating = false;
    }
  }

  private async findCandidateOpportunities(): Promise<{
    allCandidates: Candidate[];
    requiredTokens: Set<string>;
  } | null> {
    const db = getDb();

    const campaigns = await db
      .select()
      .from(schema.distributionCampaigns)
      .where(eq(schema.distributionCampaigns.active, true));

    if (campaigns.length === 0) return null;
    const campaignIds = campaigns.map((c) => c.id);
    const allBuckets = await db
      .select()
      .from(schema.distributionBuckets)
      .where(inArray(schema.distributionBuckets.campaignId, campaignIds));

    const allCandidates: Candidate[] = [];
    const requiredTokens = new Set<string>();
    const positionedBucketIds = new Set<string>();

    for (const p of this.openPositions.values()) {
      positionedBucketIds.add(p.bucketId);
      const b = this.trackedBuckets.get(p.bucketId);
      if (b) {
        requiredTokens.add(b.noTokenId);
        requiredTokens.add(b.yesTokenId);
      }
    }

    this.activeCampaignMetrics.clear();

    for (const campaign of campaigns) {
      const buckets = allBuckets.filter((b) => b.campaignId === campaign.id);
      allCandidates.push(
        ...(await this.evaluateCampaign(
          campaign,
          buckets,
          positionedBucketIds,
          requiredTokens,
        )),
      );
    }

    return { allCandidates, requiredTokens };
  }

  private async evaluateCampaign(
    campaign: CampaignRow,
    buckets: BucketRow[],
    positionedBucketIds: Set<string>,
    requiredTokens: Set<string>,
  ): Promise<Candidate[]> {
    const config = getConfig();
    const modalBucket = findModalBucket(buckets);
    if (!modalBucket) return [];

    const [modalMin] = parseBucketMinMax(modalBucket.groupItemTitle);
    requiredTokens.add(modalBucket.noTokenId);
    requiredTokens.add(modalBucket.yesTokenId);

    const ageFraction = campaignAgeFraction(
      campaign.startDate,
      campaign.endDate,
      new Date(),
    );
    if (ageFraction === null) {
      if (!this.warnedMissingDateCampaigns.has(campaign.id)) {
        this.warnedMissingDateCampaigns.add(campaign.id);
        logger.warn(
          { campaignId: campaign.id },
          "Campaign missing start/end date; age gate passes open until backfilled",
        );
      }
    } else {
      this.warnedMissingDateCampaigns.delete(campaign.id);
    }
    const modalMargin = modalMarginBelow(buckets, modalBucket.groupItemTitle);
    const ladderYes = ladderYesMap(buckets);
    const gateConfig = {
      minCampaignAgeFraction: config.strategy.entryMinCampaignAgeFraction,
      minBucketDistance: config.strategy.entryMinBucketDistance,
      maxTailYesMass: config.strategy.entryMaxTailYesMass,
      minModalMargin: config.strategy.entryMinModalMargin,
    };

    const candidates: Candidate[] = [];
    const counts = {
      candidateCount: 0,
      trackedCount: 0,
      positionCount: 0,
      gateRejectedCount: 0,
      inBandCount: 0,
    };

    for (const bucket of buckets) {
      if (!isCandidateBucket(bucket.groupItemTitle, modalMin)) continue;
      counts.candidateCount++;

      const noPrice = parseFloat(bucket.noPrice?.toString() ?? "1");
      const hasPosition = positionedBucketIds.has(bucket.id);
      if (hasPosition) counts.positionCount++;

      if (
        isRelevantBucket(
          true,
          false,
          noPrice,
          config.strategy.maxNoEntryPrice,
          hasPosition,
        )
      ) {
        counts.trackedCount++;
        requiredTokens.add(bucket.noTokenId);
        requiredTokens.add(bucket.yesTokenId);
      }

      if (
        noPrice < config.strategy.minNoEntryPrice ||
        noPrice > config.strategy.maxNoEntryPrice
      )
        continue;
      if (hasPosition || this.inFlightTokens.has(bucket.noTokenId)) continue;
      counts.inBandCount++;

      const gateMetrics: EntryGateMetrics = {
        campaignAgeFraction: ageFraction,
        bucketDistance: bucketDistanceBelowModal(
          buckets,
          bucket.groupItemTitle,
          modalBucket.groupItemTitle,
        ),
        tailYesMass: cumulativeYesMassBelow(buckets, bucket.groupItemTitle),
        modalMargin,
      };
      const gate = evaluateSyncEntryGates(gateMetrics, gateConfig);
      if (!gate.pass) {
        counts.gateRejectedCount++;
        logger.debug(
          {
            campaignId: campaign.id,
            bucket: bucket.groupItemTitle,
            failed: gate.failed,
            gateMetrics,
          },
          "Entry gate rejected candidate",
        );
        continue;
      }

      const result = await this.buildEntryCandidate(
        campaign,
        bucket,
        modalBucket.groupItemTitle,
        gateMetrics,
        ladderYes,
      );
      if (result === "TRAJECTORY_REJECTED") {
        counts.gateRejectedCount++;
        continue;
      }
      if (result) candidates.push(result);
    }

    this.activeCampaignMetrics.set(campaign.id, {
      candidateCount: counts.candidateCount,
      trackedCount: counts.trackedCount,
      positionCount: counts.positionCount,
      gateRejectedCount: counts.gateRejectedCount,
    });

    if (counts.inBandCount > 0) {
      logger.info(
        {
          campaignId: campaign.id,
          band: counts.inBandCount,
          gateRejected: counts.gateRejectedCount,
          candidates: candidates.length,
        },
        "Entry gate scan summary",
      );
    }

    return candidates;
  }

  /**
   * Final, non-free entry stages for a bucket that already passed the
   * ladder gates: live orderbook band check, budget, trajectory gate
   * (fail-closed), and execution simulation. Returns "TRAJECTORY_REJECTED"
   * when the dip-recovery gate blocks so the caller can count it as a
   * gate rejection; null for ordinary filtering.
   */
  private async buildEntryCandidate(
    campaign: CampaignRow,
    bucket: BucketRow,
    modalBucketTitle: string,
    gateMetrics: EntryGateMetrics,
    ladderYes: Record<string, number>,
  ): Promise<Candidate | "TRAJECTORY_REJECTED" | null> {
    const config = getConfig();

    const { data: book } = await this.client.getOrderbook(bucket.noTokenId);
    const top = getTopOfBook(book);
    if (
      top.bestAsk == null ||
      top.bestAsk < config.strategy.minNoEntryPrice ||
      top.bestAsk > config.strategy.maxNoEntryPrice
    )
      return null;

    const budget = this.portfolioManager.computePositionBudget(
      this.computeOpenPositionsValue(),
    );
    if (budget <= 0) return null;

    const state = this.trackedBuckets.get(bucket.id);
    if (state && !this.isMarketActivelyTrading(state)) return null;

    let dip: DipRecoveryAnalysis | null = null;
    let priceHistory: Array<{ t: number; p: number }> = [];
    try {
      const { history } = await this.client.getPricesHistory(bucket.noTokenId);
      const nowSec = Date.now() / 1000;
      dip = analyzeDipRecovery(
        history,
        nowSec,
        config.strategy.entryDipLookbackHours,
        config.strategy.entryDipThreshold,
        config.strategy.entryReboundDelta,
      );
      priceHistory = downsamplePriceHistory(
        windowPriceHistory(history, nowSec, config.strategy.entryDipLookbackHours),
        ENTRY_PRICE_HISTORY_POINTS,
      );
    } catch (err) {
      logger.warn(
        { err, bucket: bucket.groupItemTitle },
        "Failed to fetch price history; skipping candidate this scan",
      );
    }
    // Recovery gate is primary: fail closed when we have no history, and below
    // the high-confidence band demand a convincing recovery to justify the risk.
    if (!dip) return "TRAJECTORY_REJECTED";
    const recovery = isRecoveryEntryAllowed(dip, top.bestAsk, {
      highConfidenceNoPrice: config.strategy.entryHighConfidenceNoPrice,
      minReboundFromLow: config.strategy.entryMinReboundFromLow,
    });
    if (!recovery.pass) {
      logger.debug(
        {
          campaignId: campaign.id,
          bucket: bucket.groupItemTitle,
          reason: recovery.reason,
          dip,
        },
        "Recovery gate rejected candidate",
      );
      return "TRAJECTORY_REJECTED";
    }

    const execResult = simulateLimitBuy(
      book,
      budget,
      config.strategy.maxNoEntryPrice,
      state?.feeSchedule ?? null,
    );
    if (execResult.totalCost < 5) return null;

    const expectedNetProfit = execResult.totalShares - execResult.netCost;
    if (expectedNetProfit < config.strategy.minExpectedNetProfit) return null;

    return {
      bucket,
      campaign,
      expectedNetProfit,
      expectedReturnPercent: expectedNetProfit / execResult.netCost,
      budget: execResult.netCost,
      execResult,
      top,
      depthAtLimit: estimateDepthAtOrBelow(book, config.strategy.maxNoEntryPrice),
      modalBucketTitle,
      gateMetrics,
      dip,
      ladderYes,
      priceHistory,
    };
  }

  private updateWsSubscriptions(requiredTokens: Set<string>): void {
    const currentlySubscribed = this.wsWatcher.getSubscribedTokens();
    const tokensToSubscribe = Array.from(requiredTokens).filter(
      (t) => !currentlySubscribed.has(t),
    );
    const tokensToUnsubscribe = Array.from(currentlySubscribed).filter(
      (t) => !requiredTokens.has(t),
    );

    if (tokensToSubscribe.length > 0) {
      this.wsWatcher.subscribe(tokensToSubscribe);
    }
    if (tokensToUnsubscribe.length > 0) {
      this.wsWatcher.unsubscribe(tokensToUnsubscribe);
    }
  }

  private async executeCandidates(allCandidates: Candidate[]): Promise<void> {
    const config = getConfig();

    // Within the entry band the return spread is narrow, so lower tail risk
    // (probability the NO actually loses) outranks expected return.
    allCandidates.sort((a, b) => {
      if (a.gateMetrics.tailYesMass !== b.gateMetrics.tailYesMass)
        return a.gateMetrics.tailYesMass - b.gateMetrics.tailYesMass;
      if (b.expectedReturnPercent !== a.expectedReturnPercent)
        return b.expectedReturnPercent - a.expectedReturnPercent;
      return (
        parseFloat(b.bucket.volume24h ?? "0") -
        parseFloat(a.bucket.volume24h ?? "0")
      );
    });

    for (const cand of allCandidates) {
      if (
        this.openPositions.size >= config.strategy.maxSimultaneousPositions &&
        !config.portfolio.allowNegativeBalance
      )
        break;

      this.inFlightTokens.add(cand.bucket.noTokenId);

      try {
        const deducted = await this.portfolioManager.deductCash(cand.budget);
        if (!deducted) continue;

        await this.executeMarketEntry(cand);
      } catch (err) {
        logger.error(
          { err, bucketId: cand.bucket.id },
          "Failed to execute Taker entry",
        );
      } finally {
        this.inFlightTokens.delete(cand.bucket.noTokenId);
      }
    }
  }

  private onTokenPriceUpdate(
    tokenId: string,
    bestBid: number,
    bestAsk: number,
  ): void {
    const bucketId = this.tokenToBucket.get(tokenId);
    if (!bucketId) return;
    const state = this.trackedBuckets.get(bucketId);
    if (!state) return;
    if (state.resolved) return;
    state.lastPrices[tokenId] = {
      bid: bestBid,
      ask: bestAsk,
      mid: (bestBid + bestAsk) / 2,
    };

    const config = getConfig();
    const currentPrice = this.getAuthoritativePriceSignal(bestAsk);

    for (const pos of this.openPositions.values()) {
      if (pos.tokenId === tokenId && pos.bucketId === bucketId) {
        if (this.isMarketActivelyTrading(state)) {
          if (currentPrice !== null) {
            if (
              pos.minNoPriceDuringPosition === null ||
              currentPrice < pos.minNoPriceDuringPosition
            ) {
              pos.minNoPriceDuringPosition = currentPrice;
            }
          }
        }

        if (config.strategy.stopLossEnabled) {
          if (currentPrice !== null && currentPrice <= pos.stopNoPrice) {
            const now = Date.now();
            if (!pos.stopLossConditionFirstSeen) {
              pos.stopLossConditionFirstSeen = now;
            } else if (now - pos.stopLossConditionFirstSeen >= 10000) {
              if (executionPolicy.canExecuteStopLoss()) {
                this.executeStopLoss(pos, state.feeSchedule).catch((e) =>
                  logger.error({ err: e }, "Failed to execute stop loss"),
                );
              }
            }
          } else {
            pos.stopLossConditionFirstSeen = null;
          }
        }
      }
    }
  }

  private async executeMarketEntry(cand: Candidate) {
    if (!executionPolicy.canOpenNewPositions()) {
      logger.info(
        "Skipping market entry: Polymarket status restricts new positions.",
      );
      return;
    }

    const config = getConfig();

    try {
      const execResult = cand.execResult;

      // Context-relative stop anchored to the recovery low we entered on.
      const stopNoPrice = computeStopNoPrice(
        cand.dip.recentLow,
        config.strategy.stopLossBufferBelowLow,
        config.strategy.stopLossAbsoluteFloor,
      );

      const trade = await createSimulatedTrade({
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
        positionBudget: cand.budget.toFixed(8),
        actualCost: execResult.netCost.toFixed(8),
        entryFees: execResult.fees.toFixed(8),
        fillStatus: execResult.isPartialFill ? "PARTIAL" : "FULL",
        expectedNetProfit: cand.expectedNetProfit.toFixed(8),
        expectedReturnPercent: cand.expectedReturnPercent.toFixed(8),
        noBestBidAtEntry: cand.top.bestBid?.toFixed(8),
        noBestAskAtEntry: cand.top.bestAsk?.toFixed(8),
        depthAtLimit: cand.depthAtLimit.toFixed(8),
        modalBucketAtEntry: cand.modalBucketTitle,
        stopNoPrice: stopNoPrice.toFixed(8),
        entryGateSnapshot: {
          ...cand.gateMetrics,
          dip: cand.dip,
          stopNoPrice,
          ladderYes: cand.ladderYes,
          priceHistory: cand.priceHistory,
        },
      });

      if (trade) {
        this.openPositions.set(trade.id, {
          tradeId: trade.id,
          bucketId: cand.bucket.id,
          tokenId: cand.bucket.noTokenId,
          entryPrice: execResult.averagePrice,
          entryShares: execResult.totalShares,
          fees: execResult.fees,
          actualCost: execResult.netCost,
          minNoPriceDuringPosition: null,
          stopNoPrice,
        });
        await logAudit(
          "info",
          "TRADE_OPENED",
          `Opened simulated Taker NO trade for ${cand.bucket.groupItemTitle}`,
          { tradeId: trade.id },
        );
        logger.info(
          {
            tradeId: trade.id,
            bucketId: cand.bucket.id,
            fillStatus: execResult.isPartialFill ? "PARTIAL" : "FULL",
          },
          "Taker entry executed",
        );
        this.emit("tradeOpened", { trade });
        notifyDiscordEntry({
          campaignTitle: cand.campaign.title,
          bucketTitle: cand.bucket.groupItemTitle,
          entryPrice: execResult.averagePrice.toFixed(8),
          shares: execResult.totalShares.toFixed(8),
          cost: execResult.netCost.toFixed(8),
        });
      }
    } catch (err) {
      logger.error({ err }, "Simulated trade creation failed");
      throw err;
    }
  }

  private async executeStopLoss(
    pos: OpenPosition,
    feeSchedule: FeeSchedule | null,
  ) {
    if (pos.isExiting) return;
    pos.isExiting = true;
    try {
      logger.warn(
        { tradeId: pos.tradeId, bucketId: pos.bucketId },
        "Executing Stop-Loss!",
      );
      const { data: book } = await this.client.getOrderbook(pos.tokenId);

      const exit = simulateTakerSell(book, pos.entryShares, feeSchedule);
      if (exit.totalShares <= 0) {
        logger.warn(
          { tradeId: pos.tradeId },
          "Stop-Loss failed: No bids available",
        );
        pos.isExiting = false;
        return;
      }

      await this.portfolioManager.addCash(exit.netCost);

      if (exit.isPartialFill) {
        logger.warn(
          {
            tradeId: pos.tradeId,
            soldShares: exit.totalShares,
            remainingShares: pos.entryShares - exit.totalShares,
          },
          "Stop-Loss partial fill",
        );
        const ratioRemaining = 1 - exit.totalShares / pos.entryShares;
        const newShares = pos.entryShares - exit.totalShares;
        const newActualCost = pos.actualCost * ratioRemaining;
        const newFees = pos.fees * ratioRemaining;

        pos.entryShares = newShares;
        pos.actualCost = newActualCost;
        pos.fees = newFees;

        await updateTradePositionSize(
          pos.tradeId,
          newShares.toFixed(8),
          newActualCost.toFixed(8),
          newFees.toFixed(8),
        );
        pos.isExiting = false;
      } else {
        logger.info(
          { tradeId: pos.tradeId, avgPrice: exit.averagePrice },
          "Stop-Loss fully executed",
        );
        const realizedPnl = exit.netCost - pos.actualCost;
        await resolveTrade(
          pos.tradeId,
          "LOSS",
          realizedPnl.toFixed(8),
          exit.averagePrice.toFixed(8),
          {
            exitReason: "EARLY_EXIT",
            minNoPriceDuringPosition: pos.minNoPriceDuringPosition?.toFixed(8),
          },
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
    await this.resolvePositionsForBucket(
      bucketId,
      ev.winningAssetId,
      ev.winningOutcome,
    );
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
      const outcomes = PolymarketClient.parseOutcomes(market);
      const tokens = PolymarketClient.parseClobTokenIds(market);
      const prices = PolymarketClient.parseOutcomePrices(market);
      const winnerIndex = prices.findIndex((p) => p >= 0.99);
      if (winnerIndex < 0 || !tokens[winnerIndex]) continue;
      await this.resolvePositionsForBucket(
        bucketId,
        tokens[winnerIndex]!,
        outcomes[winnerIndex] ?? "Unknown",
      );
    }
  }

  private async resolvePositionsForBucket(
    bucketId: string,
    winningTokenId: string,
    winningOutcome: string,
  ): Promise<void> {
    const positions = [...this.openPositions.values()].filter(
      (p) => p.bucketId === bucketId,
    );
    const state = this.trackedBuckets.get(bucketId);
    if (state) state.resolved = true;

    // Update the DB to reflect the resolution of this bucket so it stops being considered
    try {
      const db = getDb();
      const [bucket] = await db
        .select()
        .from(schema.distributionBuckets)
        .where(eq(schema.distributionBuckets.id, bucketId));
      if (bucket) {
        const isYesWinner = bucket.yesTokenId === winningTokenId;
        await db
          .update(schema.distributionBuckets)
          .set({
            yesPrice: isYesWinner ? "1" : "0",
            noPrice: isYesWinner ? "0" : "1",
            updatedAt: new Date(),
          })
          .where(eq(schema.distributionBuckets.id, bucketId));

        await db
          .update(schema.distributionCampaigns)
          .set({
            active: false,
            closed: true,
            updatedAt: new Date(),
          })
          .where(eq(schema.distributionCampaigns.id, bucket.campaignId));
      }
    } catch (err) {
      logger.error(
        { err, bucketId },
        "Failed to update bucket resolution in DB",
      );
    }

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
        {
          exitReason: "RESOLUTION",
          minNoPriceDuringPosition: pos.minNoPriceDuringPosition?.toFixed(8),
        },
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
        () => this.resume().catch(console.error),
        config.strategy.riskAutoResumeCooldownMs,
      );
    }
  }

  private async loadOpenPositions(): Promise<void> {
    const config = getConfig();
    const rows = await loadOpenTradesWithBuckets();
    for (const { trade } of rows) {
      this.openPositions.set(trade.id, {
        tradeId: trade.id,
        bucketId: trade.bucketId ?? "",
        tokenId: trade.tokenId ?? "",
        entryPrice: parseFloat(trade.entryPrice),
        entryShares: parseFloat(trade.entryShares),
        fees: parseFloat(trade.entryFees ?? "0"),
        actualCost: parseFloat(trade.actualCost),
        minNoPriceDuringPosition:
          trade.minNoPriceDuringPosition !== null &&
          trade.minNoPriceDuringPosition !== undefined
            ? parseFloat(trade.minNoPriceDuringPosition)
            : null,
        // Fall back to the absolute floor for positions opened before the
        // context-relative stop existed.
        stopNoPrice: trade.stopNoPrice
          ? parseFloat(trade.stopNoPrice)
          : config.strategy.stopLossAbsoluteFloor,
      });
    }
  }
}

let instance: MarketOrchestrator | null = null;
export function getMarketOrchestrator(): MarketOrchestrator {
  if (!instance) instance = new MarketOrchestrator();
  return instance;
}
