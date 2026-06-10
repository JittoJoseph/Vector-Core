import { EventEmitter } from "events";
import { and, desc, eq, sql, inArray } from "drizzle-orm";
import { createModuleLogger } from "../utils/logger.js";
import { getConfig } from "../utils/config.js";
import { getDb, createSimulatedTrade, loadOpenTradesWithBuckets, logAudit, resolveTrade, wipeAndResetPortfolio } from "../db/client.js";
import * as schema from "../db/schema.js";
import { getPolymarketClient, PolymarketClient } from "./polymarket-client.js";
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
import type { FeeSchedule, GammaEvent, GammaMarket } from "../types/index.js";
import type { MarketResolvedEvent } from "../interfaces/websocket-types.js";

const logger = createModuleLogger("distribution-orchestrator");

export function parseBucketMinMax(title: string): [number, number] {
  if (title.includes("+")) {
    const val = parseFloat(title.replace("+", ""));
    return [val, Infinity];
  }
  if (title.includes("-")) {
    const parts = title.split("-");
    return [parseFloat(parts[0] ?? "0"), parseFloat(parts[1] ?? "0")];
  }
  const val = parseFloat(title);
  return [val, val];
}

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
}

interface OpenPosition {
  tradeId: string;
  bucketId: string;
  tokenId: string;
  entryPrice: number;
  entryShares: number;
  fees: number;
  actualCost: number;
}

export type MarketLifecycle = "OPEN" | "AWAITING_RESOLUTION" | "RESOLVED";

export class MarketOrchestrator extends EventEmitter {
  private client = getPolymarketClient();
  private wsWatcher: MarketWebSocketWatcher = getMarketWebSocketWatcher();
  readonly portfolioManager = new PortfolioManager();

  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private settlementTimer: ReturnType<typeof setInterval> | null = null;
  
  private trackedBuckets = new Map<string, TrackedBucket>();
  private tokenToBucket = new Map<string, string>();
  private conditionIdToBucket = new Map<string, string>();
  private openPositions = new Map<string, OpenPosition>();
  private inFlightTokens = new Set<string>();
  
  private running = false;
  private paused = false;
  private cycleCount = 0;
  
  private discoveredCampaigns = 0;
  private evaluatedOpportunities = 0;
  private consecutiveLossCount = 0;
  private pausedByRiskGuard = false;
  private riskPauseTriggeredAt: number | null = null;
  private riskAutoResumeTimer: ReturnType<typeof setTimeout> | null = null;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.portfolioManager.init();
    await this.loadOpenPositions();
    this.wireEvents();
    this.wsWatcher.start();
    await this.scan();
    const config = getConfig();
    this.scanTimer = setInterval(() => {
      this.scan().catch((error) => logger.error({ error }, "Distribution scan failed"));
    }, config.strategy.scanIntervalMs);
    this.settlementTimer = setInterval(() => {
      this.pollOpenPositionSettlements().catch((error) => logger.error({ error }, "Settlement polling failed"));
    }, 60_000);
    logger.info("Distribution market orchestrator started");
  }

  stop(): void {
    this.running = false;
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.settlementTimer) clearInterval(this.settlementTimer);
    if (this.riskAutoResumeTimer) clearTimeout(this.riskAutoResumeTimer);
    this.scanTimer = null;
    this.settlementTimer = null;
    this.wsWatcher.stop();
    logger.info("Distribution market orchestrator stopped");
  }

  pause(): void {
    this.paused = true;
    if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null; }
    if (this.settlementTimer) { clearInterval(this.settlementTimer); this.settlementTimer = null; }
    this.wsWatcher.stop();
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
    if (!this.scanTimer) this.scanTimer = setInterval(() => this.scan().catch(console.error), config.strategy.scanIntervalMs);
    if (!this.settlementTimer) this.settlementTimer = setInterval(() => this.pollOpenPositionSettlements().catch(console.error), 60_000);
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
    this.wsWatcher.clear();
    this.cycleCount = 0;
    this.discoveredCampaigns = 0;
    this.evaluatedOpportunities = 0;
    this.consecutiveLossCount = 0;
    this.pausedByRiskGuard = false;
    this.riskPauseTriggeredAt = null;
  }

  isPaused(): boolean { return this.paused; }

  getStats() {
    return {
      running: this.running,
      paused: this.paused,
      activeBuckets: this.trackedBuckets.size,
      openPositions: this.openPositions.size,
      cycleCount: this.cycleCount,
      scanner: { discoveredCampaigns: this.discoveredCampaigns, evaluatedOpportunities: this.evaluatedOpportunities },
      ws: this.wsWatcher.getStats(),
      risk: { consecutiveLossCount: this.consecutiveLossCount, pausedByRiskGuard: this.pausedByRiskGuard },
    };
  }

  getLiveMarkets() {
    return Array.from(this.trackedBuckets.values()).map((b) => ({
      marketId: b.bucketId,
      eventId: b.campaignId,
      question: b.groupItemTitle,
      noTokenId: b.noTokenId,
      yesTokenId: b.yesTokenId,
      noPrice: b.noPrice,
      markPrice: b.lastPrices,
      status: b.resolved ? "RESOLVED" : "OPEN",
    }));
  }

  computeOpenPositionsValue(): number {
    let total = 0;
    for (const pos of this.openPositions.values()) total += pos.actualCost;
    return total;
  }

  private wireEvents(): void {
    this.wsWatcher.on("priceUpdate", (ev) => this.onTokenPriceUpdate(ev.tokenId, parseFloat(ev.bestBid), parseFloat(ev.bestAsk)));
    this.wsWatcher.on("bestBidAskUpdate", (ev) => this.onTokenPriceUpdate(ev.tokenId, parseFloat(ev.bestBid), parseFloat(ev.bestAsk)));
    this.wsWatcher.on("marketResolved", (ev: MarketResolvedEvent) => this.onMarketResolved(ev).catch(console.error));
  }

  async scan(): Promise<void> {
    if (this.paused) return;
    this.cycleCount++;
    
    // Tag 972 = Tweet Markets
    const result = await this.client.listEventsKeyset({
      limit: 100,
      active: true,
      closed: false,
      tag_id: "972",
    });
    
    const db = getDb();
    
    for (const event of result.events) {
      if (this.paused) break;
      if (!event.negRisk) continue; // Must be a multi-outcome campaign
      await this.persistCampaign(event);
    }
    
    if (this.paused) return;

    const campaignsCount = await db.select({ count: sql<number>`count(*)` }).from(schema.distributionCampaigns);
    const bucketsCount = await db.select({ count: sql<number>`count(*)` }).from(schema.distributionBuckets);
    this.discoveredCampaigns = campaignsCount[0]?.count ?? 0;
    this.evaluatedOpportunities = bucketsCount[0]?.count ?? 0;

    await this.evaluateOpportunities();
  }

  private async persistCampaign(event: GammaEvent): Promise<void> {
    const db = getDb();
    const eventId = String(event.id);

    if (!/^Elon Musk # tweets [A-Za-z]+ \d+ - [A-Za-z]+ \d+, \d{4}\?$/.test(event.title ?? "")) {
      return;
    }
    
    await db.insert(schema.distributionCampaigns).values({
      id: eventId,
      slug: event.slug ?? eventId,
      title: event.title ?? eventId,
      seriesSlug: (event as any).seriesSlug ?? null,
      startDate: event.startDate ? new Date(event.startDate) : null,
      endDate: event.endDate ? new Date(event.endDate) : null,
      active: event.active ?? true,
      closed: event.closed ?? false,
      lastFetchedAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: schema.distributionCampaigns.id,
      set: {
        title: event.title ?? eventId,
        active: event.active ?? true,
        closed: event.closed ?? false,
        lastFetchedAt: new Date(),
        updatedAt: new Date(),
      }
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
        
        await db.insert(schema.distributionBuckets).values({
          id: market.id,
          campaignId: eventId,
          conditionId: market.conditionId ?? null,
          groupItemTitle: market.groupItemTitle,
          yesTokenId: clobTokenIds[0]!,
          noTokenId: clobTokenIds[1]!,
          yesPrice: market.outcomePrices ? JSON.parse(market.outcomePrices)[0] : null,
          noPrice: market.outcomePrices ? JSON.parse(market.outcomePrices)[1] : null,
          spread: market.spread?.toString() ?? null,
          liquidityNum: (market.liquidityNum ?? 0).toString(),
          volume24h: (market.volumeNum ?? 0).toString(),
          lastFetchedAt: new Date(),
          updatedAt: new Date(),
        }).onConflictDoUpdate({
          target: schema.distributionBuckets.id,
          set: {
            yesPrice: market.outcomePrices ? JSON.parse(market.outcomePrices)[0] : null,
            noPrice: market.outcomePrices ? JSON.parse(market.outcomePrices)[1] : null,
            spread: market.spread?.toString() ?? null,
            liquidityNum: (market.liquidityNum ?? 0).toString(),
            volume24h: (market.volumeNum ?? 0).toString(),
            lastFetchedAt: new Date(),
            updatedAt: new Date(),
          }
        });
        
        this.trackBucket(market, eventId, clobTokenIds[1]!, clobTokenIds[0]!);
      }
    }
  }

  private trackBucket(market: GammaMarket, campaignId: string, noTokenId: string, yesTokenId: string): void {
    if (this.trackedBuckets.has(market.id)) return;
    this.trackedBuckets.set(market.id, {
      bucketId: market.id,
      campaignId,
      groupItemTitle: market.groupItemTitle ?? "",
      noTokenId,
      yesTokenId,
      noPrice: market.outcomePrices ? parseFloat(JSON.parse(market.outcomePrices)[1]) : null,
      feeSchedule: (market.feeSchedule as FeeSchedule | null) ?? null,
      lastPrices: {},
      resolved: false,
      endDate: market.endDate ? new Date(market.endDate) : null,
    });
    this.tokenToBucket.set(noTokenId, market.id);
    if (market.conditionId) this.conditionIdToBucket.set(market.conditionId, market.id);
  }

  private async evaluateOpportunities(): Promise<void> {
    const config = getConfig();
    const db = getDb();
    
    const campaigns = await db.select().from(schema.distributionCampaigns).where(eq(schema.distributionCampaigns.active, true));
    
    interface Candidate {
      bucket: typeof schema.distributionBuckets.$inferSelect;
      expectedNetProfit: number;
      expectedReturnPercent: number;
      fill: any;
      top: any;
      depthAtLimit: number;
      budget: number;
    }
    
    let allCandidates: Candidate[] = [];
    const requiredTokens = new Set<string>();

    for (const p of this.openPositions.values()) {
      const b = this.trackedBuckets.get(p.bucketId);
      if (b) {
        requiredTokens.add(b.noTokenId);
        requiredTokens.add(b.yesTokenId);
      }
    }
    
    for (const campaign of campaigns) {
      const buckets = await db.select().from(schema.distributionBuckets).where(eq(schema.distributionBuckets.campaignId, campaign.id));
      if (buckets.length === 0) continue;
      
      let modalBucket = buckets[0];
      let maxYes = parseFloat(buckets[0]?.yesPrice?.toString() ?? "0");
      for (const b of buckets) {
        const y = parseFloat(b.yesPrice?.toString() ?? "0");
        if (y > maxYes) { maxYes = y; modalBucket = b; }
      }
      if (!modalBucket) continue;
      
      const [modalMin] = parseBucketMinMax(modalBucket.groupItemTitle);
      
      for (const bucket of buckets) {
        const [, bMax] = parseBucketMinMax(bucket.groupItemTitle);
        // Eligible if strictly below modal bucket
        if (bMax < modalMin) {
          const noPrice = parseFloat(bucket.noPrice?.toString() ?? "0");
          
          if (noPrice < 0.99 || Number.isNaN(noPrice)) {
             requiredTokens.add(bucket.noTokenId);
          }

          if (noPrice >= config.strategy.minNoEntryPrice && noPrice <= config.strategy.maxNoEntryPrice) {
            
            const campaignHasPosition = Array.from(this.openPositions.values()).some(p => {
               const b = this.trackedBuckets.get(p.bucketId);
               return b?.campaignId === campaign.id;
            });
            if (campaignHasPosition) continue;
            
            if (this.inFlightTokens.has(bucket.noTokenId)) continue;
            
            const { data: book } = await this.client.getOrderbook(bucket.noTokenId);
            const top = getTopOfBook(book);
            if (top.bestAsk == null || top.bestAsk < config.strategy.minNoEntryPrice || top.bestAsk > config.strategy.maxNoEntryPrice) continue;
            
            const depthAtLimit = estimateDepthAtOrBelow(book, config.strategy.maxNoEntryPrice);
            const budget = this.portfolioManager.computePositionBudget(this.computeOpenPositionsValue());
            if (budget <= 0) continue;
            
            const tracked = this.trackedBuckets.get(bucket.id);
            const fill = simulateLimitBuy(book, budget, config.strategy.maxNoEntryPrice, tracked?.feeSchedule);
            if (fill.totalShares <= 0 || fill.belowMinimumOrderSize) continue;
            
            const expectedNetProfit = calculateExpectedNetProfit(fill);
            if (expectedNetProfit < config.strategy.minExpectedNetProfit) continue;
            
            const expectedReturnPercent = expectedNetProfit / fill.totalCost;
            
            allCandidates.push({ bucket, expectedNetProfit, expectedReturnPercent, fill, top, depthAtLimit, budget });
          }
        }
      }
    }
    
    const currentlySubscribed = this.wsWatcher.getSubscribedTokens();
    const tokensToSubscribe = Array.from(requiredTokens).filter(t => !currentlySubscribed.has(t));
    const tokensToUnsubscribe = Array.from(currentlySubscribed).filter(t => !requiredTokens.has(t));
    
    if (tokensToSubscribe.length > 0) this.wsWatcher.subscribe(tokensToSubscribe);
    if (tokensToUnsubscribe.length > 0) this.wsWatcher.unsubscribe(tokensToUnsubscribe);
    
    allCandidates.sort((a, b) => {
      if (b.expectedReturnPercent !== a.expectedReturnPercent) return b.expectedReturnPercent - a.expectedReturnPercent;
      return parseFloat(b.bucket.volume24h ?? "0") - parseFloat(a.bucket.volume24h ?? "0");
    });
    
    const executedCampaigns = new Set<string>();
    
    for (const cand of allCandidates) {
      if (this.openPositions.size >= config.strategy.maxSimultaneousPositions && !config.portfolio.allowNegativeBalance) break;
      if (executedCampaigns.has(cand.bucket.campaignId)) continue;
      
      this.inFlightTokens.add(cand.bucket.noTokenId);
      try {
        const deducted = await this.portfolioManager.deductCash(cand.fill.netCost);
        if (!deducted) continue;
        
        const trade = await createSimulatedTrade({
          campaignId: cand.bucket.campaignId,
          bucketId: cand.bucket.id,
          bucketGroupTitle: cand.bucket.groupItemTitle,
          tokenId: cand.bucket.noTokenId,
          entryTs: new Date(),
          entryPrice: cand.fill.averagePrice.toFixed(8),
          entryShares: cand.fill.totalShares.toFixed(8),
          positionBudget: cand.budget.toFixed(8),
          actualCost: cand.fill.netCost.toFixed(8),
          entryFees: cand.fill.fees.toFixed(8),
          fillStatus: cand.fill.isPartialFill ? "PARTIAL" : "FULL",
          expectedNetProfit: cand.expectedNetProfit.toFixed(8),
          expectedReturnPercent: cand.expectedReturnPercent.toFixed(8),
          noBestBidAtEntry: cand.top.bestBid?.toFixed(8),
          noBestAskAtEntry: cand.top.bestAsk?.toFixed(8),
          depthAtLimit: cand.depthAtLimit.toFixed(8),
          orderbookSnapshot: cand.fill.orderbookSnapshot,
        });
        
        if (trade) {
          this.openPositions.set(trade.id, {
            tradeId: trade.id,
            bucketId: cand.bucket.id,
            tokenId: cand.bucket.noTokenId,
            entryPrice: cand.fill.averagePrice,
            entryShares: cand.fill.totalShares,
            fees: cand.fill.fees,
            actualCost: cand.fill.netCost,
          });
          executedCampaigns.add(cand.bucket.campaignId);
          await logAudit("info", "TRADE_OPENED", `Opened simulated NO trade for ${cand.bucket.groupItemTitle}`, { tradeId: trade.id });
        }
      } catch (err) {
        logger.error({ err }, "Trade execution failed");
      } finally {
        this.inFlightTokens.delete(cand.bucket.noTokenId);
      }
    }
  }

  private onTokenPriceUpdate(tokenId: string, bestBid: number, bestAsk: number): void {
    const bucketId = this.tokenToBucket.get(tokenId);
    if (!bucketId) return;
    const state = this.trackedBuckets.get(bucketId);
    if (!state) return;
    if (state.resolved) return;
    state.lastPrices[tokenId] = { bid: bestBid, ask: bestAsk, mid: (bestBid + bestAsk) / 2 };
  }

  private async onMarketResolved(ev: MarketResolvedEvent): Promise<void> {
    const bucketId = this.conditionIdToBucket.get(ev.conditionId);
    if (!bucketId) return;
    await this.resolvePositionsForBucket(bucketId, ev.winningAssetId, ev.winningOutcome);
  }

  private async pollOpenPositionSettlements(): Promise<void> {
    const bucketIds = new Set([...this.openPositions.values()].map((p) => p.bucketId));
    for (const bucketId of bucketIds) {
      const market = await this.client.getMarketById(bucketId);
      if (!market?.closed) continue;
      const outcomes = PolymarketClient.parseOutcomes(market);
      const tokens = PolymarketClient.parseClobTokenIds(market);
      const prices = PolymarketClient.parseOutcomePrices(market);
      const winnerIndex = prices.findIndex((p) => p >= 0.99);
      if (winnerIndex < 0 || !tokens[winnerIndex]) continue;
      await this.resolvePositionsForBucket(bucketId, tokens[winnerIndex]!, outcomes[winnerIndex] ?? "Unknown");
    }
  }

  private async resolvePositionsForBucket(bucketId: string, winningTokenId: string, winningOutcome: string): Promise<void> {
    const positions = [...this.openPositions.values()].filter((p) => p.bucketId === bucketId);
    const state = this.trackedBuckets.get(bucketId);
    if (state) state.resolved = true;

    for (const pos of positions) {
      const isWin = pos.tokenId === winningTokenId;
      const pnl = isWin
        ? calculateWinProfit(pos.entryPrice, pos.entryShares, pos.fees)
        : calculateLossAmount(pos.entryPrice, pos.entryShares, pos.fees);
      const cashReturn = pos.actualCost + pnl;
      if (cashReturn > 0) await this.portfolioManager.addCash(cashReturn);
      const trade = await resolveTrade(pos.tradeId, isWin ? "WIN" : "LOSS", pnl.toFixed(8), isWin ? "1" : "0", { exitReason: "RESOLUTION" });
      this.openPositions.delete(pos.tradeId);
      this.updateConsecutiveLossState(isWin);
      await logAudit("info", "TRADE_RESOLVED", `Trade ${pos.tradeId} resolved ${isWin ? "WIN" : "LOSS"}`, { bucketId, pnl });
      this.emit("tradeResolved", { tradeId: pos.tradeId, isWin, pnl, trade });
    }
  }

  private updateConsecutiveLossState(isWin: boolean): void {
    const config = getConfig();
    if (config.strategy.consecutiveLossPauseLimit <= 0) return;
    if (isWin) { this.consecutiveLossCount = 0; return; }
    this.consecutiveLossCount++;
    if (this.consecutiveLossCount < config.strategy.consecutiveLossPauseLimit || this.paused) return;
    this.pausedByRiskGuard = true;
    this.pause();
    if (config.strategy.riskAutoResumeEnabled) {
      this.riskAutoResumeTimer = setTimeout(() => this.resume().catch(console.error), config.strategy.riskAutoResumeCooldownMs);
    }
  }

  private async loadOpenPositions(): Promise<void> {
    const rows = await loadOpenTradesWithBuckets();
    for (const { trade, bucket } of rows) {
      this.openPositions.set(trade.id, {
        tradeId: trade.id,
        bucketId: trade.bucketId ?? "",
        tokenId: trade.tokenId ?? "",
        entryPrice: parseFloat(trade.entryPrice),
        entryShares: parseFloat(trade.entryShares),
        fees: parseFloat(trade.entryFees ?? "0"),
        actualCost: parseFloat(trade.actualCost),
      });
    }
  }
}

let instance: MarketOrchestrator | null = null;
export function getMarketOrchestrator(): MarketOrchestrator {
  if (!instance) instance = new MarketOrchestrator();
  return instance;
}
