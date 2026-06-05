"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { Header } from "./header";
import { TradesTable } from "./trades-table";
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

  // Sidebar Metrics
  const avgExpectedProfit =
    openTrades.length > 0
      ? openTrades.reduce(
          (sum, t) => sum + parseFloat(t.expectedNetProfit || "0"),
          0,
        ) / openTrades.length
      : 0;

  let bestPos: SimulatedTrade | null = null;
  let worstPos: SimulatedTrade | null = null;
  for (const t of openTrades) {
    const pnl = parseFloat(t.expectedNetProfit || "0");
    if (!bestPos || pnl > parseFloat(bestPos.expectedNetProfit || "0"))
      bestPos = t;
    if (!worstPos || pnl < parseFloat(worstPos.expectedNetProfit || "0"))
      worstPos = t;
  }

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
          {/* SYSTEM OPERATIONAL STATE */}
          <div className="border border-border/30 rounded bg-card/25 p-5 flex flex-col">
            <div className="flex items-center justify-between mb-5">
              <div className="text-[11px] tracking-[0.2em] text-muted-foreground/80 uppercase flex items-center gap-2 font-bold">
                <Server size={14} className="text-muted-foreground" /> System
                Operational State
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

            <div className="grid grid-cols-2 gap-y-6 gap-x-4">
              <div>
                <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-1.5">
                  Trading Engine
                </div>
                <div
                  className={`text-xs font-bold ${isPaused ? "text-amber-500" : stats?.orchestrator.running ? "text-emerald-400" : "text-muted-foreground"}`}
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
                  className={`text-xs font-bold ${stats?.orchestrator.ws.connected ? "text-emerald-400" : "text-red-400"}`}
                >
                  {stats?.orchestrator.ws.connected
                    ? "CONNECTED"
                    : "DISCONNECTED"}
                </div>
              </div>
              <div>
                <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-1.5">
                  Discovered Ladders
                </div>
                <div className="text-sm font-semibold">
                  {discoveredLaddersCount}{" "}
                  <span className="text-xs font-normal text-muted-foreground/60">
                    event families
                  </span>
                </div>
              </div>
              <div>
                <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-1.5">
                  Evaluated Decisions
                </div>
                <div className="text-sm font-semibold">
                  {evaluatedCount}{" "}
                  <span className="text-xs font-normal text-muted-foreground/60">
                    opportunities
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* PORTFOLIO & CAPITAL SUMMARY */}
          <div className="border border-border/30 rounded bg-card/25 p-5 flex flex-col">
            <div className="flex items-center justify-between mb-5">
              <div className="text-[11px] tracking-[0.2em] text-muted-foreground/80 uppercase flex items-center gap-2 font-bold">
                <TrendingUp size={14} className="text-muted-foreground" />{" "}
                Portfolio & Capital Summary
              </div>
            </div>

            <div className="grid grid-cols-3 gap-y-6 gap-x-4">
              <div className="col-span-1">
                <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-1.5">
                  Net Profit / Loss
                </div>
                <div
                  className={`text-xl font-bold tracking-tight leading-none ${pnlColor(netPnl)}`}
                >
                  {formatPnl(animatedNetPnl)}
                </div>
                <div
                  className={`text-[10px] mt-1.5 font-bold ${pnlColor(netPnl, "80")}`}
                >
                  {roi >= 0 ? "+" : ""}
                  {roi.toFixed(2)}% ROI (ALL)
                </div>
              </div>
              <div className="col-span-1">
                <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-1.5">
                  Asset Allocation
                </div>
                <div className="text-xl font-bold tracking-tight leading-none text-foreground">
                  $
                  {portfolioValue.toLocaleString(undefined, {
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
                <div className="text-[10px] mt-0.5 text-muted-foreground/80">
                  Invested: $
                  {openPositionsValue.toLocaleString(undefined, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}
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
              <div className="border-b border-border/30 px-3 py-2 flex items-center justify-between bg-card">
                <TabsList className="bg-transparent h-auto p-0 gap-2">
                  <TabsTrigger
                    value="positions"
                    className="data-[state=active]:bg-foreground data-[state=active]:text-background text-muted-foreground/60 px-3 py-1.5 text-[11px] font-mono tracking-wider font-bold rounded transition-colors hover:text-foreground"
                  >
                    POSITIONS ({openTrades.length})
                  </TabsTrigger>
                  <TabsTrigger
                    value="history"
                    className="data-[state=active]:bg-foreground data-[state=active]:text-background text-muted-foreground/60 px-3 py-1.5 text-[11px] font-mono tracking-wider font-bold rounded transition-colors hover:text-foreground"
                  >
                    TRADE HISTORY ({settledTrades.length})
                  </TabsTrigger>
                  <TabsTrigger
                    value="pipeline"
                    className="data-[state=active]:bg-foreground data-[state=active]:text-background text-muted-foreground/60 px-3 py-1.5 text-[11px] font-mono tracking-wider font-bold rounded transition-colors hover:text-foreground"
                  >
                    PIPELINE
                  </TabsTrigger>
                  <TabsTrigger
                    value="diagnostics"
                    className="data-[state=active]:bg-foreground data-[state=active]:text-background text-muted-foreground/60 px-3 py-1.5 text-[11px] font-mono tracking-wider font-bold rounded transition-colors hover:text-foreground"
                  >
                    DIAGNOSTICS
                  </TabsTrigger>
                </TabsList>
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
              <TabsContent value="pipeline" className="mt-0 flex-1 p-0">
                <div className="overflow-x-auto">
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
                                className="font-medium text-foreground hover:text-blue-400 inline-flex items-center gap-1"
                              >
                                {m.question}
                                <ExternalLink
                                  size={10}
                                  className="text-muted-foreground/40"
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
                        Recent Rejection Reasons
                      </div>
                      {rejectionStats.length > 0 ? (
                        <div className="flex flex-col gap-2">
                          {rejectionStats.slice(0, 5).map((stat) => (
                            <div
                              key={stat.reason}
                              className="flex flex-col gap-1"
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

          {/* RIGHT SIDEBAR: EVALUATION & CONFIGURATION */}
          <div className="w-full lg:w-[320px] shrink-0 flex flex-col gap-6">
            {/* STRATEGY EVALUATION */}
            <div className="border border-border/30 rounded-xl bg-card/25 p-5">
              <div className="text-[11px] tracking-[0.2em] text-muted-foreground/80 uppercase font-bold mb-5 flex items-center gap-2">
                <Workflow size={14} className="text-muted-foreground" />{" "}
                Strategy Evaluation
              </div>
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-end">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    Open Positions
                  </span>
                  <span className="text-xs font-bold text-foreground tabular-nums">
                    {openTrades.length}
                  </span>
                </div>
                <div className="flex justify-between items-end">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    Capital At Risk
                  </span>
                  <span className="text-xs font-bold text-foreground tabular-nums">
                    ${openPositionsValue.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between items-end">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    Avg Expected Profit
                  </span>
                  <span
                    className={`text-xs font-bold tabular-nums ${avgExpectedProfit > 0 ? "text-emerald-400" : "text-muted-foreground"}`}
                  >
                    ${avgExpectedProfit.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between items-end">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    Best Expected Pos
                  </span>
                  <span className="text-[11px] font-mono text-emerald-400 tabular-nums">
                    {bestPos
                      ? `$${parseFloat(bestPos.expectedNetProfit || "0").toFixed(2)}`
                      : "—"}
                  </span>
                </div>
                <div className="w-full h-px bg-border/20 my-1" />
                <div className="flex justify-between items-end">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    Candidate Markets
                  </span>
                  <span className="text-xs font-bold text-foreground tabular-nums">
                    {candidateMarkets.length}
                  </span>
                </div>
                <div className="flex justify-between items-end">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    Acceptance Rate
                  </span>
                  <span className="text-xs font-bold text-blue-400 tabular-nums">
                    {acceptanceRate.toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between items-end">
                  <span className="text-[10px] text-muted-foreground/50 uppercase tracking-widest">
                    Evaluated Checks
                  </span>
                  <span className="text-xs font-medium text-muted-foreground/70 tabular-nums">
                    {evaluatedCount}
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
