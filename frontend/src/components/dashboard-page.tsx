"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { Header } from "./header";
import { TradesTable, MarketCountdown } from "./trades-table";
import { TradeDetailPopup } from "./trade-detail-popup";
import { ActivityPanel } from "./activity-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getApiClient } from "@/lib/api-client";
import { pnlColor, formatPnl } from "@/lib/utils";
import {
  useTrades,
  useSystemStats,
  useActiveMarkets,
  useLiveMarkets,
  usePerformanceRealtime,
  useActivityLog,
  useAnimatedNumber,
} from "@/lib/hooks";
import type { SimulatedTrade, Opportunity, LiveMarketPrice } from "@/lib/types";
import {
  ShieldAlert,
  RefreshCw,
  Server,
  Activity,
  Briefcase,
  TrendingUp,
  ExternalLink,
  Workflow,
  SlidersHorizontal,
} from "lucide-react";

export function DashboardPage() {
  const [activeTab, setActiveTab] = useState("positions");
  const [selectedTrade, setSelectedTrade] = useState<SimulatedTrade | null>(
    null,
  );

  // Core Hooks
  const {
    stats,
    loading: statsLoading,
    refetch: refetchStats,
  } = useSystemStats();
  const liveMarkets = useLiveMarkets();

  const {
    trades,
    loading: tradesLoading,
    loadMore: loadMoreTrades,
    hasMore: hasMoreTrades,
    loadingMore: loadingMoreTrades,
    refetch: refetchTrades,
  } = useTrades();

  const {
    markets: candidateMarketsRaw,
    loading: marketsLoading,
    loadMore: loadMoreMarkets,
    hasMore: hasMoreMarkets,
    loadingMore: loadingMoreMarkets,
    refetch: refetchMarkets,
  } = useActiveMarkets();

  const { activities, loading: activitiesLoading } = useActivityLog();
  const { performance } = usePerformanceRealtime("ALL");

  // Diagnostics state
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [refreshingExtra, setRefreshingExtra] = useState(false);

  const fetchExtraData = useCallback(async () => {
    setRefreshingExtra(true);
    try {
      const api = getApiClient();
      // Only fetch opportunities for rejection analytics
      const opps = await api.getOpportunities({ limit: 500 }).catch(() => []);
      setOpportunities(opps);
    } finally {
      setRefreshingExtra(false);
    }
  }, []);

  useEffect(() => {
    fetchExtraData();
  }, [fetchExtraData]);

  const handleManualRefresh = useCallback(async () => {
    await Promise.all([
      refetchStats().catch(() => {}),
      refetchTrades().catch(() => {}),
      refetchMarkets().catch(() => {}),
      fetchExtraData().catch(() => {}),
    ]);
  }, [refetchStats, refetchTrades, refetchMarkets, fetchExtraData]);

  // Derived datasets
  const openTrades = useMemo(
    () => trades.filter((t) => t.status === "OPEN"),
    [trades],
  );
  const settledTrades = useMemo(
    () => trades.filter((t) => t.status === "SETTLED"),
    [trades],
  );
  const candidateMarkets = useMemo(
    () =>
      candidateMarketsRaw.filter(
        (m) =>
          m.classificationStatus === "candidate" ||
          m.classificationStatus === "traded",
      ),
    [candidateMarketsRaw],
  );

  // Live prices map for Open Positions
  const livePricesMap = useMemo<Record<string, LiveMarketPrice>>(() => {
    const map: Record<string, LiveMarketPrice> = {};
    for (const m of liveMarkets) {
      for (const [tokenId, price] of Object.entries(m.prices)) {
        map[tokenId] = price;
      }
    }
    return map;
  }, [liveMarkets]);

  // Market deadlines map
  const marketEndDates = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const m of liveMarkets) map[m.marketId] = m.deadline;
    for (const m of candidateMarketsRaw)
      if (m.id && m.deadline) map[m.id] = m.deadline;
    return map;
  }, [liveMarkets, candidateMarketsRaw]);

  // Financial Stats
  const initialCapital = parseFloat(performance?.initialCapital || "0");
  const cashBalance = parseFloat(performance?.cashBalance || "0");
  const openPositionsValue = parseFloat(performance?.openPositionsValue || "0");
  const portfolioValue = cashBalance + openPositionsValue;
  const netPnl = portfolioValue - initialCapital;
  const roi = initialCapital > 0 ? (netPnl / initialCapital) * 100 : 0;
  const winRate = parseFloat(performance?.winRate || "0");

  const animatedNetPnl = useAnimatedNumber(netPnl, 300);
  const isPaused = stats?.orchestrator.paused ?? false;

  // Diagnostics Aggregation
  const rejectionStats = useMemo(() => {
    const rejections = opportunities.filter((o) => o.status === "rejected");
    const total = rejections.length;
    if (total === 0) return [];

    const counts: Record<string, number> = {};
    rejections.forEach((r) => {
      let reason = r.reason || "Unknown";
      if (reason.includes(" - ")) reason = reason.split(" - ")[1] || reason;
      counts[reason] = (counts[reason] || 0) + 1;
    });

    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({ reason, pct: (count / total) * 100 }));
  }, [opportunities]);

  let liveUnrealizedPnl = 0;
  let closestExpiration: Date | null = null;
  let closestTrades: SimulatedTrade[] = [];
  const expirationBuckets = { "<24h": 0, "1-3d": 0, "4-7d": 0, ">7d": 0 };

  const now = new Date();

  for (const t of openTrades) {
    const entryPrice = parseFloat(t.entryPrice);
    const shares = parseFloat(t.entryShares || "0");
    const fees = parseFloat(t.entryFees || "0");

    const livePrice = t.tokenId ? (livePricesMap[t.tokenId] ?? null) : null;
    const liveMid = livePrice?.mid ?? null;
    if (liveMid !== null) {
      liveUnrealizedPnl += (liveMid - entryPrice) * shares - fees;
    }

    const endStr =
      t.marketEndDate ?? (t.marketId ? marketEndDates[t.marketId] : null);
    if (endStr) {
      const d = new Date(endStr);
      if (!closestExpiration || d < closestExpiration) {
        closestExpiration = d;
        closestTrades = [t];
      } else if (d.getTime() === closestExpiration.getTime()) {
        closestTrades.push(t);
      }

      const hours = (d.getTime() - now.getTime()) / (1000 * 60 * 60);
      if (hours < 24) expirationBuckets["<24h"]++;
      else if (hours < 72) expirationBuckets["1-3d"]++;
      else if (hours < 168) expirationBuckets["4-7d"]++;
      else expirationBuckets[">7d"]++;
    }
  }

  const livePortfolioValue =
    cashBalance + openPositionsValue + liveUnrealizedPnl;

  const evaluatedCount =
    stats?.orchestrator.scanner.evaluatedOpportunities || 0;
  const discoveredLaddersCount =
    stats?.orchestrator.scanner.discoveredLadders || 0;
  const acceptanceRate =
    evaluatedCount > 0
      ? ((openTrades.length + settledTrades.length) / evaluatedCount) * 100
      : 0;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-mono selection:bg-muted-foreground/30">
      <Header />

      {isPaused && (
        <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-red-950/20 border-b border-red-500/20 animate-pulse shrink-0">
          <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
          <span className="text-[11px] font-bold text-red-400 tracking-widest uppercase">
            SYSTEM PAUSED — Simulated trading is suspended. Go to settings to
            resume.
          </span>
        </div>
      )}

      <main className="flex-1 px-4 py-4 pb-16 max-w-7xl mx-auto w-full space-y-4">
        {/* ── TOP LEVEL COMMAND PANELS ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ENGINE HEALTH (MINIMAL) */}
          <div className="border border-border/30 rounded bg-card/25 p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-5">
              <div className="text-[11px] tracking-[0.2em] text-muted-foreground/80 uppercase flex items-center gap-2 font-bold">
                <Server size={14} className="text-muted-foreground" /> Engine
                Health
              </div>
              <button
                onClick={handleManualRefresh}
                className="text-muted-foreground/50 hover:text-foreground transition-colors"
              >
                <RefreshCw
                  size={12}
                  className={refreshingExtra ? "animate-spin" : ""}
                />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-1.5">
                  Trading Engine
                </div>
                <div
                  className={`text-sm font-bold ${isPaused ? "text-amber-500" : stats?.orchestrator.running ? "text-emerald-400" : "text-muted-foreground"}`}
                >
                  {isPaused
                    ? "PAUSED"
                    : stats?.orchestrator.running
                      ? "RUNNING"
                      : "IDLE"}
                </div>
              </div>
              <div>
                <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-1.5">
                  Websocket Feed
                </div>
                <div
                  className={`text-sm font-bold ${stats?.orchestrator.ws.connected ? "text-emerald-400" : "text-red-400"}`}
                >
                  {stats?.orchestrator.ws.connected
                    ? "CONNECTED"
                    : "DISCONNECTED"}
                </div>
              </div>
            </div>
          </div>

          {/* PORTFOLIO HEALTH (MARK TO MARKET) */}
          <div className="border border-border/30 rounded bg-card/25 p-5 flex flex-col">
            <div className="flex items-center justify-between mb-5">
              <div className="text-[11px] tracking-[0.2em] text-muted-foreground/80 uppercase flex items-center gap-2 font-bold">
                <TrendingUp size={14} className="text-muted-foreground" />{" "}
                Portfolio Health (Live)
              </div>
            </div>

            <div className="grid grid-cols-4 gap-y-6 gap-x-4">
              <div className="col-span-1">
                <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-1.5">
                  Unrealized PnL
                </div>
                <div
                  className={`text-xl font-bold tracking-tight leading-none ${pnlColor(liveUnrealizedPnl)}`}
                >
                  {formatPnl(liveUnrealizedPnl)}
                </div>
                <div
                  className={`text-[10px] mt-1.5 font-bold ${pnlColor(netPnl, "80")}`}
                >
                  {formatPnl(animatedNetPnl)} (Realized)
                </div>
              </div>
              <div className="col-span-1">
                <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-1.5">
                  Portfolio Value
                </div>
                <div className="text-xl font-bold tracking-tight leading-none text-foreground">
                  $
                  {livePortfolioValue.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
                <div className="text-[10px] mt-1.5 text-muted-foreground/80">
                  Cash: $
                  {cashBalance.toLocaleString(undefined, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}
                </div>
              </div>
              <div className="col-span-1">
                <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-1.5">
                  Capital At Risk
                </div>
                <div className="text-xl font-bold tracking-tight leading-none text-foreground">
                  $
                  {openPositionsValue.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
                <div className="text-[10px] mt-1.5 text-muted-foreground/80">
                  Across {openTrades.length} positions
                </div>
              </div>
              <div className="col-span-1">
                <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-1.5 flex justify-end">
                  Win Rate
                </div>
                <div className="text-xl font-bold tracking-tight leading-none text-right">
                  {winRate.toFixed(1)}%
                </div>
                <div className="text-[9px] mt-2 flex items-center justify-end gap-1.5 font-bold text-muted-foreground/60">
                  <span className="text-emerald-400">
                    {performance?.wins || 0}W
                  </span>
                  <span>/</span>
                  <span className="text-red-400">
                    {performance?.losses || 0}L
                  </span>
                  <span>/</span>
                  <span className="text-foreground">
                    {performance?.totalTrades || 0} Total
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── MAIN SPLIT VIEW ── */}
        <div className="flex flex-col lg:flex-row gap-4">
          {/* LEFT: TABS & TABLES */}
          <div className="flex-1 min-w-0 border border-border/30 rounded bg-card/25 overflow-hidden flex flex-col">
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="flex flex-col flex-1"
            >
              <div className="border-b border-border/30 px-3 py-2 flex items-center gap-4 bg-card">
                {[
                  {
                    id: "positions",
                    label: `POSITIONS (${openTrades.length})`,
                  },
                  {
                    id: "history",
                    label: `TRADE HISTORY (${settledTrades.length})`,
                  },
                  { id: "pipeline", label: "PIPELINE" },
                  { id: "diagnostics", label: "DIAGNOSTICS" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-2 py-1.5 text-xs font-mono tracking-wider font-bold transition-colors ${
                      activeTab === tab.id
                        ? "text-foreground"
                        : "text-muted-foreground/80 hover:text-foreground"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* OPEN POSITIONS TAB */}
              <TabsContent value="positions" className="mt-0 flex-1 p-0">
                <TradesTable
                  type="OPEN"
                  trades={openTrades}
                  loading={tradesLoading}
                  livePrices={livePricesMap}
                  marketEndDates={marketEndDates}
                  onTradeClick={setSelectedTrade}
                  onLoadMore={loadMoreTrades}
                  hasMore={hasMoreTrades}
                  loadingMore={loadingMoreTrades}
                />
              </TabsContent>

              {/* TRADE HISTORY TAB */}
              <TabsContent
                value="history"
                className="mt-0 flex-1 p-0 flex flex-col"
              >
                <div className="bg-card/50 border-b border-border/20 px-4 py-3 flex items-center justify-between">
                  <div className="flex gap-8">
                    <div className="flex flex-col">
                      <span className="text-[9px] text-muted-foreground uppercase tracking-widest">
                        Realized PnL
                      </span>
                      <span
                        className={`text-sm font-bold ${pnlColor(parseFloat(performance?.totalPnl || "0"))}`}
                      >
                        {formatPnl(parseFloat(performance?.totalPnl || "0"))}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[9px] text-muted-foreground uppercase tracking-widest">
                        Avg Win
                      </span>
                      <span className="text-sm font-bold text-emerald-400">
                        {formatPnl(parseFloat(performance?.avgWin || "0"))}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[9px] text-muted-foreground uppercase tracking-widest">
                        Avg Loss
                      </span>
                      <span className="text-sm font-bold text-red-400">
                        {formatPnl(parseFloat(performance?.avgLoss || "0"))}
                      </span>
                    </div>
                  </div>
                </div>
                <TradesTable
                  type="SETTLED"
                  trades={settledTrades}
                  loading={tradesLoading}
                  marketEndDates={marketEndDates}
                  onTradeClick={setSelectedTrade}
                  onLoadMore={loadMoreTrades}
                  hasMore={hasMoreTrades}
                  loadingMore={loadingMoreTrades}
                />
              </TabsContent>

              {/* MARKET PIPELINE TAB */}
              <TabsContent
                value="pipeline"
                className="mt-0 flex-1 p-0 flex flex-col h-full"
              >
                {/* PIPELINE FUNNEL & REJECTIONS */}
                <div className="bg-card/50 border-b border-border/20 p-6 flex flex-col md:flex-row gap-8">
                  <div className="flex-1">
                    <div className="text-[10px] tracking-[0.15em] text-muted-foreground uppercase font-bold mb-4">
                      Dominant Rejection Reason
                    </div>
                    {rejectionStats.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        <div className="text-xl font-bold text-red-400">
                          {rejectionStats[0].reason}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Accounted for {rejectionStats[0].pct.toFixed(1)}% of
                          all rejected opportunities.
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        No significant rejections yet.
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="text-[10px] tracking-[0.15em] text-muted-foreground uppercase font-bold mb-4">
                      Rejection Funnel Breakdown
                    </div>
                    {rejectionStats.length > 0 ? (
                      <div className="flex flex-col gap-3">
                        {rejectionStats.slice(0, 5).map((stat) => (
                          <div
                            key={stat.reason}
                            className="flex flex-col gap-1.5"
                          >
                            <div className="flex justify-between text-[11px]">
                              <span className="text-foreground/80">
                                {stat.reason}
                              </span>
                              <span className="text-muted-foreground font-bold">
                                {stat.pct.toFixed(1)}%
                              </span>
                            </div>
                            <div className="w-full bg-muted/20 h-1.5 rounded-full overflow-hidden">
                              <div
                                className="bg-amber-500/50 h-full rounded-full"
                                style={{ width: `${stat.pct}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-muted-foreground">
                        Not enough recent rejections to analyze.
                      </div>
                    )}
                  </div>
                </div>

                {/* WAITING CANDIDATES TABLE */}
                <div className="p-4 border-b border-border/20 bg-muted/5 flex items-center justify-between">
                  <div className="text-[10px] tracking-[0.15em] text-muted-foreground uppercase font-bold">
                    Waiting Candidates
                  </div>
                  <div className="text-xs font-bold text-foreground">
                    {candidateMarkets.length}
                  </div>
                </div>
                <div className="overflow-x-auto flex-1">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="border-b border-border/30">
                        <th className="text-left py-2.5 px-4 font-medium text-muted-foreground tracking-wider text-[10px]">
                          CANDIDATE QUESTION
                        </th>
                        <th className="text-right py-2.5 px-4 font-medium text-muted-foreground tracking-wider text-[10px]">
                          CLOSES
                        </th>
                        <th className="text-right py-2.5 px-4 font-medium text-muted-foreground tracking-wider text-[10px]">
                          24H VOL
                        </th>
                        <th className="text-right py-2.5 px-4 font-medium text-muted-foreground tracking-wider text-[10px]">
                          STATUS
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidateMarkets.map((m) => (
                        <tr
                          key={m.id}
                          className="border-b border-border/5 hover:bg-muted/15"
                        >
                          <td className="py-3 px-4 min-w-[300px]">
                            <div className="flex flex-col gap-0.5">
                              <a
                                href={
                                  m.slug
                                    ? `https://polymarket.com/event/${m.slug}`
                                    : `https://polymarket.com/market/${m.id}`
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-foreground hover:text-blue-400 inline-flex items-center gap-1 truncate max-w-[400px]"
                                title={m.question}
                              >
                                <span className="truncate">{m.question}</span>
                                <ExternalLink
                                  size={10}
                                  className="text-muted-foreground/40 shrink-0"
                                />
                              </a>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right">
                            {new Date(m.deadline).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                          </td>
                          <td className="py-3 px-4 text-right">
                            $
                            {m.volume24h
                              ? parseFloat(m.volume24h).toLocaleString(
                                  undefined,
                                  { maximumFractionDigits: 0 },
                                )
                              : "0"}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <span className="inline-flex items-center text-[9px] font-bold tracking-wider px-2 py-0.5 rounded border border-blue-500/25 bg-blue-500/5 text-blue-400">
                              WAITING FOR DRIFT
                            </span>
                          </td>
                        </tr>
                      ))}
                      {candidateMarkets.length === 0 && (
                        <tr>
                          <td
                            colSpan={4}
                            className="py-12 text-center text-muted-foreground"
                          >
                            No candidate markets available.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </TabsContent>

              {/* DIAGNOSTICS TAB */}
              <TabsContent value="diagnostics" className="mt-0 flex-1 p-0">
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/20 h-full">
                  <div className="p-6 flex flex-col gap-6">
                    <div>
                      <div className="text-[10px] tracking-[0.15em] text-muted-foreground uppercase flex items-center gap-1.5 font-bold mb-4">
                        <Activity size={12} /> System Telemetry
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="border border-border/20 rounded p-3 bg-muted/5">
                          <div className="text-[9px] text-muted-foreground uppercase tracking-widest mb-1">
                            Scanner Loops
                          </div>
                          <div className="text-lg font-bold">
                            {stats?.orchestrator.cycleCount || 0}
                          </div>
                        </div>
                        <div className="border border-border/20 rounded p-3 bg-muted/5">
                          <div className="text-[9px] text-muted-foreground uppercase tracking-widest mb-1">
                            WS Messages
                          </div>
                          <div className="text-lg font-bold">
                            {stats?.orchestrator.ws.messageCount || 0}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] tracking-[0.15em] text-muted-foreground uppercase font-bold mb-3">
                        Scanner Strategy Telemetry
                      </div>
                      <div className="flex flex-col gap-4">
                        <div className="flex justify-between items-center border-b border-border/10 pb-3">
                          <span className="text-[11px] text-muted-foreground uppercase tracking-widest">
                            Discovered Ladders
                          </span>
                          <span className="text-sm font-bold text-foreground">
                            {discoveredLaddersCount}
                          </span>
                        </div>
                        <div className="flex justify-between items-center border-b border-border/10 pb-3">
                          <span className="text-[11px] text-muted-foreground uppercase tracking-widest">
                            Evaluated Opportunities
                          </span>
                          <span className="text-sm font-bold text-foreground">
                            {evaluatedCount}
                          </span>
                        </div>
                        <div className="flex justify-between items-center pb-3">
                          <span className="text-[11px] text-muted-foreground uppercase tracking-widest">
                            Acceptance Rate
                          </span>
                          <span className="text-sm font-bold text-blue-400">
                            {acceptanceRate.toFixed(2)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <div className="p-4 border-b border-border/20 bg-muted/5 flex items-center gap-2">
                      <div className="text-[10px] tracking-[0.15em] text-muted-foreground uppercase font-bold">
                        Audit Log
                      </div>
                    </div>
                    <div className="flex-1">
                      <ActivityPanel
                        activities={activities}
                        loading={activitiesLoading}
                      />
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* RIGHT SIDEBAR: EXPOSURE & CONFIGURATION */}
          <div className="w-full lg:w-[320px] shrink-0 flex flex-col gap-6">
            {/* TIME EXPOSURE */}
            <div className="border border-border/30 rounded-xl bg-card/25 p-5">
              <div className="text-[11px] tracking-[0.2em] text-muted-foreground/80 uppercase font-bold mb-5 flex items-center gap-2">
                <Workflow size={14} className="text-muted-foreground" /> Time
                Exposure
              </div>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] text-amber-500/80 uppercase tracking-widest font-bold">
                    Next Position To Resolve
                  </span>
                  {closestTrades.length > 0 && closestExpiration ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] text-muted-foreground uppercase">
                          Resolving In:
                        </span>
                        <span className="text-xs font-bold text-amber-500/80">
                          <MarketCountdown
                            endDate={closestExpiration.toISOString()}
                          />
                        </span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {closestTrades.map((trade) => {
                          const entryPrice = parseFloat(trade.entryPrice);
                          const shares = parseFloat(trade.entryShares || "0");
                          const fees = parseFloat(trade.entryFees || "0");
                          const actualCost = parseFloat(
                            trade.actualCost || "1",
                          );

                          const livePrice = trade.tokenId
                            ? (livePricesMap[trade.tokenId] ?? null)
                            : null;
                          const liveMid = livePrice?.mid ?? null;
                          let pnl: number | null = null;
                          let pnlPct: number | null = null;
                          if (liveMid !== null) {
                            pnl = (liveMid - entryPrice) * shares - fees;
                            pnlPct =
                              actualCost > 0 ? (pnl / actualCost) * 100 : null;
                          }

                          return (
                            <div
                              key={trade.id}
                              className="border border-border/30 bg-muted/10 rounded p-3 flex flex-col gap-2 cursor-pointer hover:bg-muted/20 transition-colors"
                              onClick={() => setSelectedTrade(trade)}
                            >
                              <div
                                className="text-[11px] font-medium text-foreground truncate"
                                title={trade.marketQuestion || "Unknown"}
                              >
                                {trade.marketQuestion}
                              </div>
                              <div className="flex justify-between items-end">
                                <div className="text-[10px] text-muted-foreground/60">
                                  {shares.toFixed(1)} shares
                                </div>
                                <div className="flex flex-col gap-1 items-end">
                                  {pnl !== null ? (
                                    <div className="flex items-center gap-1">
                                      <span
                                        className={`text-xs font-bold ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
                                      >
                                        {formatPnl(pnl)}
                                      </span>
                                      <span
                                        className={`text-[10px] ${pnlPct! >= 0 ? "text-emerald-400/60" : "text-red-400/60"}`}
                                      >
                                        ({pnlPct! >= 0 ? "+" : ""}
                                        {pnlPct!.toFixed(1)}%)
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-xs font-bold text-muted-foreground/40">
                                      —
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground bg-muted/10 p-3 rounded">
                      No open positions
                    </div>
                  )}
                </div>
                <div className="w-full h-px bg-border/20 my-1" />
                <div className="flex justify-between items-end">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    Expiring &lt; 24h
                  </span>
                  <span className="text-xs font-bold text-foreground tabular-nums">
                    {expirationBuckets["<24h"]}
                  </span>
                </div>
                <div className="flex justify-between items-end">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    Expiring 1-3d
                  </span>
                  <span className="text-xs font-bold text-foreground tabular-nums">
                    {expirationBuckets["1-3d"]}
                  </span>
                </div>
                <div className="flex justify-between items-end">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    Expiring 4-7d
                  </span>
                  <span className="text-xs font-bold text-foreground tabular-nums">
                    {expirationBuckets["4-7d"]}
                  </span>
                </div>
                <div className="flex justify-between items-end">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    Expiring &gt; 7d
                  </span>
                  <span className="text-xs font-bold text-foreground tabular-nums">
                    {expirationBuckets[">7d"]}
                  </span>
                </div>
                <div className="w-full h-px bg-border/20 my-1" />
                <div className="flex justify-between items-end">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    Total Open Positions
                  </span>
                  <span className="text-xs font-bold text-blue-400 tabular-nums">
                    {openTrades.length}
                  </span>
                </div>
              </div>
            </div>

            {/* ACTIVE PARAMETERS */}
            <div className="border border-border/30 rounded-xl bg-card/25 p-5">
              <div className="text-[11px] tracking-[0.2em] text-muted-foreground/80 uppercase font-bold mb-5 flex items-center gap-2">
                <SlidersHorizontal
                  size={14}
                  className="text-muted-foreground"
                />{" "}
                Active Parameters
              </div>
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-end">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    NO Price Range
                  </span>
                  <span className="text-[11px] font-mono text-foreground tabular-nums">
                    {Math.round((stats?.config.minNoEntryPrice || 0) * 100)}¢ —{" "}
                    {Math.round((stats?.config.maxNoEntryPrice || 0) * 100)}¢
                  </span>
                </div>
                <div className="flex justify-between items-end">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    Max Allowable Spread
                  </span>
                  <span className="text-[11px] font-mono text-foreground tabular-nums">
                    {((stats?.config.maxSpread || 0) * 100).toFixed(1)}¢
                  </span>
                </div>
                <div className="flex justify-between items-end">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    Scanner Lookahead
                  </span>
                  <span className="text-[11px] font-mono text-foreground tabular-nums">
                    {stats?.config.deadlineLookaheadDays || 0} Days
                  </span>
                </div>
                <div className="flex justify-between items-end">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    Min Liquidity Req
                  </span>
                  <span className="text-[11px] font-mono text-foreground tabular-nums">
                    ${stats?.config.minLiquidityNum?.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between items-end">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    Expected Profit Min
                  </span>
                  <span className="text-[11px] font-mono text-emerald-400 tabular-nums">
                    ${stats?.config.minExpectedNetProfit || 0}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <TradeDetailPopup
        trade={selectedTrade}
        open={!!selectedTrade}
        onClose={() => setSelectedTrade(null)}
      />
    </div>
  );
}
