import { EventEmitter } from "events";
import { eq, inArray } from "drizzle-orm";
import { createModuleLogger } from "../utils/logger.js";
import { getConfig } from "../utils/config.js";
import {
  getDb,
  logAudit,
  pruneHistory,
  settleTrade,
  shrinkTrade,
  sumRealizedPnl,
  wipeTrades,
  type ExitReason,
} from "../db/client.js";
import * as schema from "../db/schema.js";
import type { ForecastSummary } from "../db/schema.js";
import {
  getPolymarketClient,
  PolymarketClient,
  type Quote,
} from "./polymarket-client.js";
import {
  calculateFeePerShare,
  getTopOfBook,
  simulateLimitBuy,
  simulateTakerSell,
} from "./execution-simulator.js";
import {
  getMarketWebSocketWatcher,
  type QuoteEvent,
} from "./market-ws-watcher.js";
import { getWeatherNextFeed, type ForecastRun } from "./weathernext.js";
import { executionPolicy } from "./execution-policy.js";
import { CityBias } from "./city-bias.js";
import {
  fairValue,
  localDayMaxC,
  winnerTempC,
} from "../utils/forecast-model.js";
import { bucketRange, cityOf, isFahrenheit } from "../utils/weather-logic.js";
import type { GammaEvent } from "../types/index.js";

const logger = createModuleLogger("market-orchestrator");

export const STRATEGY = {
  edge: 0.2,
  maxSpread: 0.03,
  minPrice: 0.03,
  maxPrice: 0.97,
  tradeBudget: 5,
  minEntryLeadHours: 12,
  partialTakeProfitAt: 0.5,
} as const;
const STOP_CONFIRM_MS = 5_000;
const AVERAGING_MS = 3 * 3_600_000;
const FRESH_RUN_MS = 3_600_000;
const DISCOVERY_MS = 30 * 60_000;
const SETTLEMENT_MS = 20 * 60_000;
const DAY_MS = 86_400_000;

interface Bucket {
  id: string;
  slug: string | null;
  title: string;
  range: [number, number];
  yesToken: string;
  feeRate: number;
}

interface Campaign {
  id: string;
  slug: string;
  title: string;
  city: string;
  fahrenheit: boolean;
  dayStart: number;
  endDate: number;
  buckets: Bucket[];
  forecast: ForecastSummary | null;
  probs: number[] | null;
  recent: { publishedAt: number; fmaxC: number }[];
}

interface Position {
  tradeId: string;
  campaignId: string;
  bucketId: string;
  tokenId: string;
  entryPrice: number;
  shares: number;
  fees: number;
  cost: number;
  realized: number;
  target: number;
  partialTaken: boolean;
  minPrice: number | null;
  bid: number | null;
  ask: number | null;
  stopSince: number | null;
  exiting: boolean;
}

export interface PositionPnl {
  mid: number | null;
  pnl: number | null;
  pnlPct: number | null;
  minPrice: number | null;
}

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

export class MarketOrchestrator extends EventEmitter {
  private client = getPolymarketClient();
  private ws = getMarketWebSocketWatcher();
  private feed = getWeatherNextFeed();
  private bias = new CityBias();

  private campaigns = new Map<string, Campaign>();
  private positions = new Map<string, Position>();
  private tradedBuckets = new Set<string>();
  private quotes = new Map<string, Quote>();
  private realizedPnl = 0;
  private lastDiscoveryStart = 0;
  private lastEvaluation: {
    at: string;
    init: string;
    covered: number;
    entries: number;
    exits: number;
  } | null = null;

  private timers: ReturnType<typeof setInterval>[] = [];
  private running = false;
  private paused = false;
  private busy: Promise<unknown> = Promise.resolve();

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.bias.load();
    await this.loadState();
    executionPolicy.start();
    await this.serial(() => this.discover());
    await this.serial(() => this.settle());
    this.ws.on("quote", (q: QuoteEvent) => this.onQuote(q));
    this.ws.subscribe([...this.positions.values()].map((p) => p.tokenId));
    this.ws.start();
    this.feed.on("run", (run: ForecastRun) =>
      this.serial(() => this.onRun(run)),
    );
    this.feed.start();
    this.timers = [
      setInterval(() => this.serial(() => this.discover()), DISCOVERY_MS),
      setInterval(() => this.serial(() => this.settle()), SETTLEMENT_MS),
    ];
    logger.info(
      { campaigns: this.campaigns.size, positions: this.positions.size },
      "Orchestrator started",
    );
  }

  stop(): void {
    this.running = false;
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.feed.stop();
    this.ws.stop();
    executionPolicy.stop();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  async wipe(): Promise<void> {
    await this.serial(async () => {
      await wipeTrades();
      this.ws.unsubscribe([...this.positions.values()].map((p) => p.tokenId));
      this.positions.clear();
      this.tradedBuckets.clear();
      this.realizedPnl = 0;
    });
  }

  private serial<T>(task: () => Promise<T>): Promise<T | undefined> {
    const next = this.busy.then(task).catch((err) => {
      logger.error({ err }, "Orchestrator task failed");
      return undefined;
    });
    this.busy = next;
    return next;
  }

  private async loadState(): Promise<void> {
    const db = getDb();
    this.realizedPnl = await sumRealizedPnl();
    const open = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.closed, false));
    const openIds = open.map((c) => c.id);
    const trades = openIds.length
      ? await db
          .select()
          .from(schema.trades)
          .where(inArray(schema.trades.campaignId, openIds))
      : [];
    for (const t of trades) {
      this.tradedBuckets.add(t.bucketId);
      if (t.status !== "OPEN") continue;
      this.positions.set(t.id, {
        tradeId: t.id,
        campaignId: t.campaignId,
        bucketId: t.bucketId,
        tokenId: t.tokenId,
        entryPrice: parseFloat(t.entryPrice),
        shares: parseFloat(t.entryShares),
        fees: parseFloat(t.entryFees),
        cost: parseFloat(t.actualCost),
        realized: parseFloat(t.realizedPnl ?? "0"),
        target: parseFloat(t.target),
        partialTaken: t.realizedPnl !== null,
        minPrice: t.minPriceDuringPosition
          ? parseFloat(t.minPriceDuringPosition)
          : null,
        bid: null,
        ask: null,
        stopSince: null,
        exiting: false,
      });
    }
    for (const c of open) {
      this.campaigns.set(c.id, {
        id: c.id,
        slug: c.slug,
        title: c.title,
        city: cityOf(c.title) ?? "",
        fahrenheit: false,
        dayStart: c.endDate.getTime() - DAY_MS,
        endDate: c.endDate.getTime(),
        buckets: [],
        forecast: c.forecast ?? null,
        probs: null,
        recent: [],
      });
    }
  }

  private toCampaign(event: GammaEvent): Campaign | null {
    const city = cityOf(event.title);
    if (!city || !event.negRisk || !event.markets?.length) return null;
    const gameStart = event.markets.find((m) => m.gameStartTime)?.gameStartTime;
    if (!gameStart) return null;
    const dayStart = Date.parse(
      gameStart.replace(" ", "T").replace(/\+00$/, "Z"),
    );
    if (!Number.isFinite(dayStart)) return null;
    const buckets: Bucket[] = [];
    for (const m of event.markets) {
      const tokens = PolymarketClient.tokenIds(m);
      if (!tokens || !m.groupItemTitle) continue;
      buckets.push({
        id: m.id,
        slug: m.slug ?? null,
        title: m.groupItemTitle,
        range: bucketRange(m.groupItemTitle),
        yesToken: tokens[0],
        feeRate: m.feeSchedule?.rate ?? 0,
      });
    }
    buckets.sort((a, b) => a.range[0] - b.range[0]);
    return {
      id: String(event.id),
      slug: event.slug ?? String(event.id),
      title: event.title!,
      city,
      fahrenheit: buckets.some((b) => isFahrenheit(b.title)),
      dayStart,
      endDate: dayStart + DAY_MS,
      buckets,
      forecast: null,
      probs: null,
      recent: [],
    };
  }

  private async discover(): Promise<void> {
    const since = this.lastDiscoveryStart
      ? new Date(this.lastDiscoveryStart + 1000)
      : new Date(Date.now() - 4 * DAY_MS);
    const events = await this.client.listWeatherEventsSince(since);
    const fresh: Campaign[] = [];
    for (const event of events) {
      const started = Date.parse(event.startDate ?? "");
      if (Number.isFinite(started))
        this.lastDiscoveryStart = Math.max(this.lastDiscoveryStart, started);
      if (event.closed) continue;
      const campaign = this.toCampaign(event);
      if (!campaign || campaign.endDate <= Date.now()) continue;
      const known = this.campaigns.get(campaign.id);
      if (known) {
        known.buckets = campaign.buckets;
        known.fahrenheit = campaign.fahrenheit;
        continue;
      }
      this.campaigns.set(campaign.id, campaign);
      fresh.push(campaign);
    }
    if (fresh.length)
      await getDb()
        .insert(schema.campaigns)
        .values(
          fresh.map((c) => ({
            id: c.id,
            slug: c.slug,
            title: c.title,
            endDate: new Date(c.endDate),
          })),
        )
        .onConflictDoNothing();
    logger.info(
      {
        scanned: events.length,
        added: fresh.length,
        open: this.campaigns.size,
      },
      "Discovery complete",
    );
  }

  private async settle(): Promise<void> {
    const now = Date.now();
    for (const campaign of [...this.campaigns.values()]) {
      if (campaign.endDate > now && campaign.buckets.length) continue;
      const event = await this.client.getEvent(campaign.id);
      if (!campaign.buckets.length) {
        const rebuilt = this.toCampaign(event);
        if (rebuilt) {
          campaign.buckets = rebuilt.buckets;
          campaign.fahrenheit = rebuilt.fahrenheit;
        }
      }
      if (event.closed) await this.resolveCampaign(campaign, event);
    }
    await pruneHistory();
  }

  private async resolveCampaign(
    campaign: Campaign,
    event: GammaEvent,
  ): Promise<void> {
    const payouts = new Map<string, [number, number]>();
    for (const m of event.markets ?? []) {
      const prices = PolymarketClient.outcomePrices(m);
      if (prices) payouts.set(m.id, prices);
    }
    const held = [...this.positions.values()].filter(
      (p) => p.campaignId === campaign.id,
    );
    if (!payouts.size || held.some((p) => !payouts.has(p.bucketId))) return;
    for (const pos of held) {
      const [payout] = payouts.get(pos.bucketId)!;
      await this.closePosition(
        pos,
        payout,
        payout * pos.shares - pos.cost,
        "RESOLUTION",
      );
    }
    const winner = campaign.buckets.find(
      (b) => (payouts.get(b.id)?.[0] ?? 0) >= 0.99,
    );
    const actualC = winner
      ? winnerTempC(winner.range, campaign.fahrenheit)
      : null;
    if (actualC !== null && campaign.forecast)
      await this.bias.record(campaign.city, actualC - campaign.forecast.fmaxC);
    await getDb()
      .update(schema.campaigns)
      .set({
        closed: true,
        closedTime: event.closedTime ? new Date(event.closedTime) : new Date(),
      })
      .where(eq(schema.campaigns.id, campaign.id));
    this.campaigns.delete(campaign.id);
    for (const b of campaign.buckets) this.tradedBuckets.delete(b.id);
    for (const b of campaign.buckets) this.quotes.delete(b.yesToken);
    logger.info(
      { campaign: campaign.title, winner: winner?.title },
      "Campaign resolved",
    );
  }

  private async onRun(run: ForecastRun): Promise<void> {
    const now = Date.now();
    const scored: { campaign: Campaign; probs: number[] }[] = [];
    for (const campaign of this.campaigns.values()) {
      const temps = run.series.get(campaign.city);
      if (!temps || !campaign.buckets.length || campaign.endDate <= now)
        continue;
      const runMaxC = localDayMaxC(temps, run.init, campaign.dayStart);
      if (runMaxC === null) continue;
      campaign.recent = [
        ...campaign.recent.filter(
          (r) => r.publishedAt >= run.publishedAt - AVERAGING_MS,
        ),
        { publishedAt: run.publishedAt, fmaxC: runMaxC },
      ];
      const fv = fairValue({
        fmaxC:
          campaign.recent.reduce((sum, r) => sum + r.fmaxC, 0) /
          campaign.recent.length,
        dayStart: campaign.dayStart,
        now,
        biasC: this.bias.get(campaign.city),
        fahrenheit: campaign.fahrenheit,
        ranges: campaign.buckets.map((b) => b.range),
      });
      campaign.probs = fv.probs;
      campaign.forecast = {
        init: new Date(run.init).toISOString(),
        publishedAt: new Date(run.publishedAt).toISOString(),
        fmaxC: round4(fv.fmaxC),
        mu: round4(fv.mu),
        sigma: round4(fv.sigma),
      };
      scored.push({ campaign, probs: fv.probs });
    }
    if (now - run.publishedAt > FRESH_RUN_MS) return;
    await Promise.all(
      scored.map(({ campaign }) =>
        getDb()
          .update(schema.campaigns)
          .set({ forecast: campaign.forecast })
          .where(eq(schema.campaigns.id, campaign.id)),
      ),
    );

    const tokens = scored.flatMap(({ campaign }) =>
      campaign.buckets.map((b) => b.yesToken),
    );
    if (tokens.length)
      for (const [token, quote] of await this.client.getQuotes(tokens))
        this.quotes.set(token, quote);

    let exits = 0;
    for (const { campaign, probs } of scored) {
      for (const pos of this.positions.values()) {
        if (pos.campaignId !== campaign.id || pos.exiting) continue;
        const i = campaign.buckets.findIndex((b) => b.id === pos.bucketId);
        const bid = this.quotes.get(campaign.buckets[i]?.yesToken ?? "")?.bid;
        if (i < 0 || bid === undefined || probs[i]! >= bid) continue;
        this.exit(pos, "MODEL_EXIT");
        exits++;
      }
    }

    let entries = 0;
    if (!this.paused && executionPolicy.canOpenNewPositions()) {
      for (const { campaign, probs } of scored) {
        const leadMs = campaign.dayStart - Date.now();
        if (leadMs < STRATEGY.minEntryLeadHours * 3_600_000) continue;
        for (const [i, bucket] of campaign.buckets.entries()) {
          if (this.tradedBuckets.has(bucket.id)) continue;
          const q = this.quotes.get(bucket.yesToken);
          if (!q || !this.hasEdge(probs[i]!, q, bucket.feeRate)) continue;
          if (await this.enter(campaign, bucket, probs[i]!, run, q))
            entries++;
        }
      }
    }
    this.lastEvaluation = {
      at: new Date().toISOString(),
      init: new Date(run.init).toISOString(),
      covered: scored.length,
      entries,
      exits,
    };
    await logAudit(
      "info",
      "FORECAST_RUN",
      `WeatherNext run evaluated: ${scored.length} ladders, ${entries} entries, ${exits} model exits`,
      {
        init: this.lastEvaluation.init,
      },
    );
  }

  private hasEdge(p: number, q: Quote, feeRate: number): boolean {
    const mid = (q.bid + q.ask) / 2;
    if (q.ask - q.bid > STRATEGY.maxSpread + 1e-9) return false;
    if (mid < STRATEGY.minPrice || mid > STRATEGY.maxPrice) return false;
    return p - q.ask - calculateFeePerShare(q.ask, feeRate) >= STRATEGY.edge;
  }

  private async enter(
    campaign: Campaign,
    bucket: Bucket,
    target: number,
    run: ForecastRun,
    quote: Quote,
  ): Promise<boolean> {
    const tokenId = bucket.yesToken;
    const book = await this.client.getOrderbook(tokenId);
    const top = getTopOfBook(book);
    if (top.bestBid === null || top.bestAsk === null) return false;
    if (top.bestAsk - top.bestBid > STRATEGY.maxSpread + 1e-9) return false;
    const cap = target - STRATEGY.edge;
    let limit = -1;
    for (const level of book.asks) {
      const price = parseFloat(level.price);
      if (
        price + calculateFeePerShare(price, bucket.feeRate) <= cap &&
        price > limit
      )
        limit = price;
    }
    if (limit <= 0) return false;
    const fill = simulateLimitBuy(
      book,
      STRATEGY.tradeBudget,
      limit,
      bucket.feeRate,
    );
    if (fill.totalShares <= 0 || fill.belowMinimumOrderSize) return false;

    const now = Date.now();
    const [trade] = await getDb()
      .insert(schema.trades)
      .values({
        campaignId: campaign.id,
        campaignSlug: campaign.slug,
        campaignTitle: campaign.title,
        bucketId: bucket.id,
        bucketSlug: bucket.slug,
        bucketGroupTitle: bucket.title,
        tokenId,
        entryTs: new Date(now),
        entryPrice: fill.averagePrice.toFixed(8),
        entryShares: fill.totalShares.toFixed(8),
        actualCost: fill.netCost.toFixed(8),
        entryFees: fill.fees.toFixed(8),
        target: target.toFixed(8),
        signal: {
          init: new Date(run.init).toISOString(),
          leadH: round4((campaign.dayStart - now) / 3_600_000),
          pModel: round4(target),
          quote: quote.ask,
          edge: round4(
            target - fill.averagePrice - fill.fees / fill.totalShares,
          ),
        },
      })
      .onConflictDoNothing()
      .returning();
    this.tradedBuckets.add(bucket.id);
    if (!trade) return false;

    this.positions.set(trade.id, {
      tradeId: trade.id,
      campaignId: campaign.id,
      bucketId: bucket.id,
      tokenId,
      entryPrice: fill.averagePrice,
      shares: fill.totalShares,
      fees: fill.fees,
      cost: fill.netCost,
      realized: 0,
      target,
      partialTaken: false,
      minPrice: null,
      bid: top.bestBid,
      ask: top.bestAsk,
      stopSince: null,
      exiting: false,
    });
    this.ws.subscribe([tokenId]);
    await logAudit(
      "info",
      "TRADE_OPENED",
      `${bucket.title} · ${campaign.title}`,
      {
        tradeId: trade.id,
        price: fill.averagePrice,
      },
    );
    this.emit("tradeOpened", { trade });
    return true;
  }

  private onQuote({ tokenId, bid, ask }: QuoteEvent): void {
    const now = Date.now();
    for (const pos of this.positions.values()) {
      if (pos.tokenId !== tokenId || pos.exiting) continue;
      pos.bid = bid;
      pos.ask = ask;
      const campaign = this.campaigns.get(pos.campaignId);
      if (!campaign || now >= campaign.endDate) continue;
      if (pos.minPrice === null || bid < pos.minPrice) pos.minPrice = bid;

      if (bid >= pos.target) {
        this.exit(pos, "TAKE_PROFIT");
        continue;
      }
      if (
        !pos.partialTaken &&
        bid >=
          pos.entryPrice +
            STRATEGY.partialTakeProfitAt * (pos.target - pos.entryPrice)
      ) {
        this.exit(pos, "TAKE_PROFIT", 0.5);
        continue;
      }
      const delta = getConfig().strategy.stopLossDelta;
      if (delta <= 0) continue;
      if (ask > round4(pos.entryPrice - delta)) {
        pos.stopSince = null;
        continue;
      }
      pos.stopSince ??= now;
      if (
        now - pos.stopSince >= STOP_CONFIRM_MS &&
        executionPolicy.canExecuteStopLoss()
      )
        this.exit(pos, "STOP_LOSS");
    }
  }

  private exit(pos: Position, reason: ExitReason, fraction = 1): void {
    pos.exiting = true;
    this.sell(pos, reason, fraction)
      .catch((err) =>
        logger.error({ err, tradeId: pos.tradeId }, "Exit failed"),
      )
      .finally(() => {
        pos.exiting = false;
      });
  }

  private async sell(
    pos: Position,
    reason: ExitReason,
    fraction: number,
  ): Promise<void> {
    const book = await this.client.getOrderbook(pos.tokenId);
    if (!this.positions.has(pos.tradeId)) return;
    const sale = simulateTakerSell(
      book,
      pos.shares * fraction,
      this.feeRateOf(pos),
    );
    if (sale.totalShares <= 0) return;
    const soldCost = pos.cost * (sale.totalShares / pos.shares);
    const pnl = sale.netCost - soldCost;
    if (fraction >= 1 && !sale.isPartialFill) {
      await this.closePosition(pos, sale.averagePrice, pnl, reason);
      return;
    }
    if (fraction < 1) {
      pos.partialTaken = true;
      await logAudit(
        "info",
        "PARTIAL_TAKE_PROFIT",
        `Sold ${sale.totalShares.toFixed(2)} shares @${(sale.averagePrice * 100).toFixed(1)}¢ (${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)})`,
        { tradeId: pos.tradeId, pnl },
      );
    }
    const keep = 1 - sale.totalShares / pos.shares;
    this.realizedPnl += pnl;
    pos.realized += pnl;
    pos.shares -= sale.totalShares;
    pos.cost *= keep;
    pos.fees *= keep;
    await shrinkTrade(
      pos.tradeId,
      pos.shares,
      pos.cost,
      pos.fees,
      pos.realized,
    );
  }

  private feeRateOf(pos: Position): number {
    return (
      this.campaigns
        .get(pos.campaignId)
        ?.buckets.find((b) => b.id === pos.bucketId)?.feeRate ?? 0
    );
  }

  private async closePosition(
    pos: Position,
    exitPrice: number,
    pnl: number,
    reason: ExitReason,
  ): Promise<void> {
    this.positions.delete(pos.tradeId);
    this.ws.unsubscribe([pos.tokenId]);
    this.realizedPnl += pnl;
    const total = pos.realized + pnl;
    const trade = await settleTrade(pos.tradeId, {
      outcome: total > 0 ? "WIN" : "LOSS",
      realizedPnl: total,
      exitPrice,
      exitReason: reason,
      minPrice: pos.minPrice,
    });
    await logAudit(
      "info",
      "TRADE_CLOSED",
      `${reason} ${total >= 0 ? "+" : ""}${total.toFixed(4)}`,
      {
        tradeId: pos.tradeId,
        pnl: total,
        outcome: total > 0 ? "WIN" : "LOSS",
      },
    );
    this.emit("tradeResolved", {
      tradeId: pos.tradeId,
      isWin: total > 0,
      pnl: total,
      trade,
    });
  }

  private positionPnl(pos: Position) {
    const mid =
      pos.bid !== null && pos.ask !== null ? (pos.bid + pos.ask) / 2 : null;
    return { mid, pnl: mid === null ? null : mid * pos.shares - pos.cost };
  }

  getOpenPositionsPnl(): Record<string, PositionPnl> {
    const out: Record<string, PositionPnl> = {};
    for (const pos of this.positions.values()) {
      const { mid, pnl } = this.positionPnl(pos);
      out[pos.tradeId] = {
        mid,
        pnl,
        pnlPct: pnl !== null && pos.cost > 0 ? (pnl / pos.cost) * 100 : null,
        minPrice: pos.minPrice,
      };
    }
    return out;
  }

  getPortfolioSnapshot() {
    const initialCapital = getConfig().portfolio.startingCapital;
    let openPositionsValue = 0;
    let unrealizedPnl = 0;
    for (const pos of this.positions.values()) {
      openPositionsValue += pos.cost;
      unrealizedPnl += this.positionPnl(pos).pnl ?? 0;
    }
    const netPnl = this.realizedPnl + unrealizedPnl;
    return {
      initialCapital,
      realizedPnl: this.realizedPnl,
      unrealizedPnl,
      netPnl,
      portfolioValue: initialCapital + netPnl,
      roi: (netPnl / initialCapital) * 100,
      cashBalance: initialCapital + this.realizedPnl - openPositionsValue,
      openPositionsValue,
      openPositions: this.positions.size,
    };
  }

  getStats() {
    return {
      running: this.running,
      paused: this.paused,
      campaigns: this.campaigns.size,
      openPositions: this.positions.size,
      ws: this.ws.getStats(),
      weathernext: {
        ...this.feed.getStats(),
        lastEvaluation: this.lastEvaluation,
      },
      polymarketStatus: executionPolicy.getStatus(),
    };
  }

  private campaignView(c: Campaign) {
    let modelTop: { title: string; p: number } | null = null;
    let marketTop: { title: string; mid: number } | null = null;
    let bestEdge: number | null = null;
    c.buckets.forEach((b, i) => {
      const p = c.probs?.[i];
      if (p !== undefined && (!modelTop || p > modelTop.p))
        modelTop = { title: b.title, p };
      const q = this.quotes.get(b.yesToken);
      if (!q) return;
      const mid = (q.bid + q.ask) / 2;
      if (!marketTop || mid > marketTop.mid)
        marketTop = { title: b.title, mid };
      if (p === undefined) return;
      const edge = p - q.ask;
      if (bestEdge === null || edge > bestEdge) bestEdge = edge;
    });
    return {
      id: c.id,
      slug: c.slug,
      title: c.title,
      city: c.city,
      unit: c.fahrenheit ? "F" : "C",
      endDate: new Date(c.endDate).toISOString(),
      forecast: c.forecast,
      modelTop,
      marketTop,
      bestEdge,
      positionCount: [...this.positions.values()].filter(
        (p) => p.campaignId === c.id,
      ).length,
    };
  }

  getActiveCampaigns() {
    return [...this.campaigns.values()]
      .sort((a, b) => a.endDate - b.endDate)
      .map((c) => this.campaignView(c));
  }

  async getCampaignDetail(id: string) {
    const c = this.campaigns.get(id);
    if (!c) return null;
    const quotes = c.buckets.length
      ? await this.client.getQuotes(c.buckets.map((b) => b.yesToken))
      : new Map();
    return {
      ...this.campaignView(c),
      buckets: c.buckets.map((b, i) => {
        const q = quotes.get(b.yesToken) ?? null;
        const p = c.probs?.[i] ?? null;
        return {
          id: b.id,
          slug: b.slug,
          title: b.title,
          bid: q?.bid ?? null,
          ask: q?.ask ?? null,
          model: p,
          edge: p !== null && q ? round4(p - q.ask) : null,
          positions: [...this.positions.values()]
            .filter((pos) => pos.bucketId === b.id)
            .map((pos) => ({
              id: pos.tradeId,
              entryPrice: pos.entryPrice,
              shares: pos.shares,
              target: pos.target,
            })),
        };
      }),
    };
  }
}

let instance: MarketOrchestrator | null = null;
export function getMarketOrchestrator(): MarketOrchestrator {
  if (!instance) instance = new MarketOrchestrator();
  return instance;
}
