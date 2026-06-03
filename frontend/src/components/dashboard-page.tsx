"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { Header } from "./header";
import { SystemStatusIndicator } from "./system-status-indicator";
import { TradesTable } from "./trades-table";
import { TradeDetailPopup } from "./trade-detail-popup";
import { MarketsPanel } from "./markets-panel";
import { ActivityPanel } from "./activity-panel";
import { MarketDetailModal } from "./market-detail-modal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getApiClient } from "@/lib/api-client";
import { pnlColor, formatPnl } from "@/lib/utils";
import {
  useTrades,
  useSystemStats,
  useActiveMarkets,
  useLiveMarkets,
  useCountdown,
  usePerformanceRealtime,
  useActivityLog,
  useUnrealizedPnL,
  useAnimatedNumber,
} from "@/lib/hooks";
import type {
  SimulatedTrade,
  DiscoveredMarket,
  LiveMarketPrice,
  EventFamily,
  Opportunity,
} from "@/lib/types";
import {
  ExternalLink,
  TrendingUp,
  ShieldAlert,
  RefreshCw,
  Server,
  Workflow,
  SlidersHorizontal,
} from "lucide-react";

export function DashboardPage() {
  const [activeTab, setActiveTab] = useState("positions");
  const [selectedTrade, setSelectedTrade] = useState<SimulatedTrade | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<DiscoveredMarket | null>(null);
  const [performancePeriod, setPerformancePeriod] = useState<"1D" | "1W" | "1M" | "ALL">("ALL");

  // Fetch real-time states via hooks
  const { stats, loading: statsLoading, refetch: refetchStats } = useSystemStats();
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
    markets,
    loading: marketsLoading,
    loadMore: loadMoreMarkets,
    hasMore: hasMoreMarkets,
    loadingMore: loadingMoreMarkets,
    refetch: refetchMarkets,
  } = useActiveMarkets();

  const { activities, loading: activitiesLoading } = useActivityLog();
  const { performance } = usePerformanceRealtime(performancePeriod);
  const liveUnrealizedPnL = useUnrealizedPnL(trades, liveMarkets);

  // States loaded via one-off REST (for tabs)
  const [families, setFamilies] = useState<EventFamily[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [refreshingExtra, setRefreshingExtra] = useState(false);

  const fetchExtraData = useCallback(async () => {
    setRefreshingExtra(true);
    try {
      const api = getApiClient();
      const [familyRows, opportunityRows] = await Promise.all([
        api.getFamilies({ limit: 50 }).catch(() => []),
        api.getOpportunities({ limit: 100 }).catch(() => []),
      ]);
      setFamilies(familyRows);
      setOpportunities(opportunityRows);
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
  const openTrades = useMemo(() => trades.filter((t) => t.status === "OPEN"), [trades]);
  const settledTrades = useMemo(() => trades.filter((t) => t.status === "SETTLED"), [trades]);
  const candidateMarkets = useMemo(
    () => markets.filter((m) => m.classificationStatus === "candidate" || m.classificationStatus === "traded"),
    [markets]
  );

  // Stats calculation
  const initialCapital = parseFloat(performance?.initialCapital || "0");
  const cashBalance = parseFloat(performance?.cashBalance || "0");
  const openPositionsValue = parseFloat(performance?.openPositionsValue || "0");
  const portfolioValue = cashBalance + openPositionsValue;
  const netPnl = portfolioValue - initialCapital;
  const roi = initialCapital > 0 ? (netPnl / initialCapital) * 100 : 0;
  const winRate = parseFloat(performance?.winRate || "0");

  const animatedNetPnl = useAnimatedNumber(netPnl, 300);

  // Live price map from monitored contracts
  const livePricesMap = useMemo<Record<string, LiveMarketPrice>>(() => {
    const map: Record<string, LiveMarketPrice> = {};
    for (const m of liveMarkets) {
      for (const [tokenId, price] of Object.entries(m.prices)) {
        map[tokenId] = price;
      }
    }
    return map;
  }, [liveMarkets]);

  const marketEndDates = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const m of liveMarkets) {
      map[m.marketId] = m.deadline;
    }
    for (const m of markets) {
      if (m.id && m.deadline) map[m.id] = m.deadline;
    }
    return map;
  }, [liveMarkets, markets]);

  const isPaused = stats?.orchestrator.paused ?? false;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-mono selection:bg-muted-foreground/30">
      <Header />

      {isPaused && (
        <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-red-950/20 border-b border-red-500/20 animate-pulse shrink-0">
          <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
          <span className="text-[11px] font-bold text-red-400 tracking-widest uppercase">
            SYSTEM PAUSED — Simulated trading is suspended. Go to settings to resume execution.
          </span>
        </div>
      )}

      <main className="flex-1 px-4 py-4 pb-16 max-w-7xl mx-auto w-full space-y-4">
        {/* ── GROUNDED, CLEAN COMMAND CENTER PANEL ────────────── */}
        <div className="border border-border/30 rounded-xl bg-card/25 overflow-hidden">
          <div className="flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-border/20">
            
            {/* LEFT: SYSTEM OPERATIONAL STATE */}
            <div className="flex-1 p-5 flex flex-col gap-4 min-w-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Server className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-[10px] tracking-[0.18em] text-muted-foreground uppercase font-bold">
                    SYSTEM OPERATIONAL STATE
                  </span>
                </div>
                <button
                  onClick={handleManualRefresh}
                  className="p-1 rounded border border-border/40 hover:bg-muted/40 transition-colors text-muted-foreground"
                  title="Refresh state"
                >
                  <RefreshCw size={11} className={refreshingExtra ? "animate-spin" : ""} />
                </button>
              </div>

              {statsLoading ? (
                <div className="text-[10px] text-muted-foreground animate-pulse py-8 text-center">
                  Loading system statistics…
                </div>
              ) : stats ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-1">
                  <StatusMetric
                    label="Trading Engine"
                    value={isPaused ? "PAUSED" : stats.orchestrator.running ? "RUNNING" : "IDLE"}
                    statusColor={isPaused ? "text-red-400" : stats.orchestrator.running ? "text-emerald-400 font-bold" : "text-muted-foreground"}
                  />
                  <StatusMetric
                    label="WebSocket Feed"
                    value={stats.orchestrator.ws.connected ? "CONNECTED" : "DISCONNECTED"}
                    statusColor={stats.orchestrator.ws.connected ? "text-emerald-400 font-bold" : "text-amber-500"}
                  />
                  <StatusMetric
                    label="Monitored Markets"
                    value={`${liveMarkets.length} Contracts`}
                  />
                  <StatusMetric
                    label="Discovered Ladders"
                    value={`${stats.orchestrator.scanner.candidateCount} event families`}
                  />
                  <StatusMetric
                    label="Evaluated Decisions"
                    value={`${stats.orchestrator.scanner.discoveredCount} opportunities`}
                  />
                  <StatusMetric
                    label="Cycles executed"
                    value={stats.orchestrator.cycleCount.toString()}
                  />
                </div>
              ) : (
                <div className="text-[10px] text-muted-foreground py-8 text-center">
                  Unalbe to load system statistics.
                </div>
              )}
            </div>

            {/* RIGHT: PORTFOLIO PERFORMANCE SUMMARY */}
            <div className="flex-1 p-5 flex flex-col gap-4 min-w-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-[10px] tracking-[0.18em] text-muted-foreground uppercase font-bold">
                    PORTFOLIO & CAPITAL SUMMARY
                  </span>
                </div>
                <div className="flex border border-border/30 rounded overflow-hidden text-[9px] bg-background/45">
                  {(["1D", "1W", "1M", "ALL"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPerformancePeriod(p)}
                      className={`px-2.5 py-1 transition-all ${
                        performancePeriod === p
                          ? "bg-muted text-foreground font-bold"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
                <div>
                  <span className="text-[9px] text-muted-foreground/60 tracking-widest block uppercase">
                    Net Profit / Loss
                  </span>
                  <div className={`text-xl font-bold font-mono tracking-tight tabular-nums mt-0.5 ${pnlColor(animatedNetPnl)}`}>
                    {formatPnl(animatedNetPnl)}
                  </div>
                  <span className={`text-[10px] font-semibold mt-0.5 block font-mono ${pnlColor(roi)}`}>
                    {roi >= 0 ? "+" : ""}{roi.toFixed(2)}% ROI ({performancePeriod})
                  </span>
                  <span className={`text-[9px] block mt-0.5 font-mono ${pnlColor(liveUnrealizedPnL)}`}>
                    Unrealized: {formatPnl(liveUnrealizedPnL)}
                  </span>
                </div>

                <div>
                  <span className="text-[9px] text-muted-foreground/60 tracking-widest block uppercase">
                    Asset Allocation
                  </span>
                  <div className="text-xl font-bold font-mono tracking-tight tabular-nums mt-0.5 text-foreground">
                    ${portfolioValue.toFixed(2)}
                  </div>
                  <div className="text-[9px] text-muted-foreground/60 mt-0.5 flex flex-col">
                    <span>Cash: ${cashBalance.toFixed(1)}</span>
                    <span>Invested: ${openPositionsValue.toFixed(1)}</span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-[9px] text-muted-foreground/60 tracking-widest uppercase">
                    <span>Win Rate</span>
                    <span className="text-foreground font-bold">{winRate.toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full overflow-hidden bg-red-500/20 mt-1 flex">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${winRate}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[9px] font-bold mt-1 text-muted-foreground">
                    <span className="text-emerald-500/80">{performance?.wins || 0}W</span>
                    <span>/</span>
                    <span className="text-red-400/80">{performance?.losses || 0}L</span>
                    <span>/</span>
                    <span>{trades.length} Total</span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* ── TWO-COLUMN: TABS AREA & SIDEBAR ─────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
          
          {/* LEFT: MAIN TAB CONTENT */}
          <div className="border border-border/30 rounded-lg bg-card/25 overflow-hidden flex flex-col">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <div className="border-b border-border/20 px-3 py-2 flex items-center justify-between bg-muted/10 shrink-0">
                <TabsList className="bg-transparent gap-2 h-auto p-0 flex-wrap">
                  <TabsTrigger
                    value="positions"
                    className="data-[state=active]:bg-muted/40 data-[state=active]:text-foreground rounded px-3 py-1 text-[10px] font-mono tracking-wider font-bold"
                  >
                    POSITIONS ({openTrades.length})
                  </TabsTrigger>
                  <TabsTrigger
                    value="trades"
                    className="data-[state=active]:bg-muted/40 data-[state=active]:text-foreground rounded px-3 py-1 text-[10px] font-mono tracking-wider font-bold"
                  >
                    TRADES ({settledTrades.length})
                  </TabsTrigger>
                  <TabsTrigger
                    value="monitored"
                    className="data-[state=active]:bg-muted/40 data-[state=active]:text-foreground rounded px-3 py-1 text-[10px] font-mono tracking-wider font-bold"
                  >
                    MONITORED ({liveMarkets.length})
                  </TabsTrigger>
                  <TabsTrigger
                    value="candidates"
                    className="data-[state=active]:bg-muted/40 data-[state=active]:text-foreground rounded px-3 py-1 text-[10px] font-mono tracking-wider font-bold"
                  >
                    CANDIDATES ({candidateMarkets.length})
                  </TabsTrigger>
                  <TabsTrigger
                    value="families"
                    className="data-[state=active]:bg-muted/40 data-[state=active]:text-foreground rounded px-3 py-1 text-[10px] font-mono tracking-wider font-bold"
                  >
                    LADDERS ({families.length})
                  </TabsTrigger>
                  <TabsTrigger
                    value="opportunities"
                    className="data-[state=active]:bg-muted/40 data-[state=active]:text-foreground rounded px-3 py-1 text-[10px] font-mono tracking-wider font-bold"
                  >
                    DECISIONS ({opportunities.length})
                  </TabsTrigger>
                  <TabsTrigger
                    value="activity"
                    className="data-[state=active]:bg-muted/40 data-[state=active]:text-foreground rounded px-3 py-1 text-[10px] font-mono tracking-wider font-bold"
                  >
                    ACTIVITY
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* POSITIONS TAB */}
              <TabsContent value="positions" className="mt-0">
                <TradesTable
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

              {/* TRADES TAB */}
              <TabsContent value="trades" className="mt-0">
                <TradesTable
                  trades={settledTrades}
                  loading={tradesLoading}
                  marketEndDates={marketEndDates}
                  onTradeClick={setSelectedTrade}
                  onLoadMore={loadMoreTrades}
                  hasMore={hasMoreTrades}
                  loadingMore={loadingMoreTrades}
                />
              </TabsContent>

              {/* MONITORED TAB - High-density live Pricing Table */}
              <TabsContent value="monitored" className="mt-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="border-b border-border/30 text-muted-foreground text-[10px] tracking-wider uppercase">
                        <th className="text-left py-2.5 px-3 font-medium">Live Monitored question</th>
                        <th className="text-right py-2.5 px-3 font-medium">YES Price</th>
                        <th className="text-right py-2.5 px-3 font-medium">NO Price</th>
                        <th className="text-right py-2.5 px-3 font-medium">Spread</th>
                        <th className="text-right py-2.5 px-3 font-medium">Closes In</th>
                        <th className="text-left py-2.5 px-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liveMarkets.map((m) => {
                        const yesPrice = m.prices[m.yesTokenId]?.mid ?? null;
                        const noPrice = m.prices[m.noTokenId]?.mid ?? null;
                        const spread = m.prices[m.noTokenId] ? Math.abs((m.prices[m.yesTokenId]?.ask ?? 0) - (m.prices[m.yesTokenId]?.bid ?? 0)) : null;

                        return (
                          <tr key={m.marketId} className="border-b border-border/5 hover:bg-muted/15 transition-all">
                            <td className="py-3 px-3 min-w-[360px]">
                              <div className="flex flex-col gap-0.5">
                                <a
                                  href={m.slug ? `https://polymarket.com/event/${m.slug}` : `https://polymarket.com/market/${m.marketId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-medium text-foreground hover:text-blue-400 inline-flex items-center gap-1"
                                >
                                  {m.question}
                                  <ExternalLink size={10} className="text-muted-foreground/40" />
                                </a>
                                <span className="text-[10px] text-muted-foreground/60 uppercase">{m.eventTitle}</span>
                              </div>
                            </td>
                            <td className="py-3 px-3 text-right font-semibold text-emerald-400 tabular-nums">
                              {yesPrice !== null ? `${(yesPrice * 100).toFixed(1)}¢` : "—"}
                            </td>
                            <td className="py-3 px-3 text-right font-semibold text-red-400 tabular-nums">
                              {noPrice !== null ? `${(noPrice * 100).toFixed(1)}¢` : "—"}
                            </td>
                            <td className="py-3 px-3 text-right text-muted-foreground tabular-nums">
                              {spread !== null ? `${(spread * 100).toFixed(1)}¢` : "—"}
                            </td>
                            <td className="py-3 px-3 text-right text-foreground font-semibold font-mono tabular-nums">
                              <MarketCountdown endDate={m.deadline} />
                            </td>
                            <td className="py-3 px-3">
                              <span
                                className={`inline-flex rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                                  m.status === "ACTIVE"
                                    ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                                    : m.status === "UPCOMING"
                                    ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                                    : "bg-muted text-muted-foreground border border-border/30"
                                }`}
                              >
                                {m.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      {liveMarkets.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-12 text-center text-muted-foreground">
                            No live contracts currently tracked. Engine is scanning...
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </TabsContent>

              {/* CANDIDATES TAB */}
              <TabsContent value="candidates" className="mt-0">
                <MarketsPanel
                  markets={candidateMarkets}
                  trades={trades}
                  loading={marketsLoading}
                  loadingMore={loadingMoreMarkets}
                  hasMore={hasMoreMarkets}
                  onLoadMore={loadMoreMarkets}
                  onMarketClick={setSelectedMarket}
                />
              </TabsContent>

              {/* EVENT FAMILIES (LADDERS) TAB */}
              <TabsContent value="families" className="mt-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="border-b border-border/30 text-muted-foreground text-[10px] tracking-wider uppercase">
                        <th className="text-left py-2.5 px-3 font-medium">Event Family / Title</th>
                        <th className="text-right py-2.5 px-3 font-medium">Dates</th>
                        <th className="text-right py-2.5 px-3 font-medium">24h Volume</th>
                        <th className="text-left py-2.5 px-3 font-medium">Kind</th>
                      </tr>
                    </thead>
                    <tbody>
                      {families.map((f) => (
                        <tr key={f.id} className="border-b border-border/5 hover:bg-muted/15 transition-all">
                          <td className="py-3 px-3">
                            <div className="flex flex-col gap-0.5">
                              <a
                                href={`https://polymarket.com/event/${f.slug}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold text-foreground hover:text-blue-400 inline-flex items-center gap-1"
                              >
                                {f.title}
                                <ExternalLink size={10} className="text-muted-foreground/40" />
                              </a>
                              <span className="text-[10px] text-muted-foreground/60">{f.slug}</span>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums text-foreground">{f.explicitDateCount}</td>
                          <td className="py-3 px-3 text-right tabular-nums text-foreground">
                            {f.volume24h ? `$${parseFloat(f.volume24h).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}
                          </td>
                          <td className="py-3 px-3">
                            <span className="inline-flex rounded px-1.5 py-0.5 text-[9px] font-bold bg-muted text-muted-foreground border border-border/30">
                              {f.familyKind.replace("_", " ")}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {families.length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-12 text-center text-muted-foreground">
                            No event families registered yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </TabsContent>

              {/* OPPORTUNITIES (DECISIONS) TAB */}
              <TabsContent value="opportunities" className="mt-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="border-b border-border/30 text-muted-foreground text-[10px] tracking-wider uppercase">
                        <th className="text-left py-2.5 px-3 font-medium">Market Question</th>
                        <th className="text-right py-2.5 px-3 font-medium">Ask Price</th>
                        <th className="text-right py-2.5 px-3 font-medium">Spread</th>
                        <th className="text-right py-2.5 px-3 font-medium">Exp. PnL</th>
                        <th className="text-left py-2.5 px-3 font-medium">Decision Status / Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {opportunities.map((opp) => (
                        <tr key={opp.id} className="border-b border-border/5 hover:bg-muted/15 transition-all">
                          <td className="py-3 px-3 min-w-[300px]">
                            <div className="flex flex-col gap-0.5">
                              <span className="font-medium text-foreground">{opp.reason?.split(" - ")[0] || "Simulated Market Scanner Check"}</span>
                              <span className="text-[10px] text-muted-foreground/60">
                                {new Date(opp.createdAt).toLocaleString()}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums text-foreground">
                            {opp.noBestAsk ? `${(parseFloat(opp.noBestAsk) * 100).toFixed(1)}¢` : "—"}
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums text-muted-foreground">
                            {opp.spread ? `${(parseFloat(opp.spread) * 100).toFixed(1)}¢` : "—"}
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums text-emerald-400 font-semibold">
                            {opp.expectedNetProfit ? `$${parseFloat(opp.expectedNetProfit).toFixed(3)}` : "—"}
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex flex-col gap-1 items-start">
                              <span
                                className={`inline-flex rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                                  opp.status === "traded" || opp.status === "accepted"
                                    ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                                    : opp.status === "rejected"
                                    ? "bg-red-500/10 text-red-400 border border-red-500/20"
                                    : "bg-muted text-muted-foreground border border-border/30"
                                }`}
                              >
                                {opp.status}
                              </span>
                              {opp.reason && (
                                <span className="text-[9px] text-muted-foreground/75 leading-normal max-w-[280px]">
                                  {opp.reason.includes(" - ") ? opp.reason.substring(opp.reason.indexOf(" - ") + 3) : opp.reason}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {opportunities.length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-12 text-center text-muted-foreground">
                            No scanner opportunities evaluated yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </TabsContent>

              {/* ACTIVITY TAB */}
              <TabsContent value="activity" className="mt-0">
                <ActivityPanel activities={activities} loading={activitiesLoading} />
              </TabsContent>
            </Tabs>
          </div>

          {/* RIGHT: SYSTEM & STRATEGY SIDEBAR */}
          <div className="space-y-4">
            
            {/* System Stats Card */}
            <div className="border border-border/30 rounded-lg bg-card/20 p-4 space-y-3">
              <div className="text-[10px] text-muted-foreground font-bold tracking-widest border-b border-border/20 pb-1.5 uppercase flex items-center gap-1.5">
                <Workflow size={11} className="text-muted-foreground/60" />
                <span>Simulation Stats</span>
              </div>
              {statsLoading ? (
                <div className="text-[10px] text-muted-foreground animate-pulse py-4 text-center">
                  Loading statistics…
                </div>
              ) : stats ? (
                <div className="space-y-2.5 text-[11px] font-mono">
                  <SidebarRow label="Open Positions" value={stats.orchestrator.openPositions.toString()} />
                  <SidebarRow label="Monitored Markets" value={stats.orchestrator.activeMarkets.toString()} />
                  <SidebarRow label="Trades Executed" value={stats.orchestrator.cycleCount.toString()} />
                  <SidebarRow label="Discovered Count" value={stats.orchestrator.scanner.discoveredCount.toLocaleString()} />
                  <SidebarRow label="Uptime WS messages" value={stats.orchestrator.ws.messageCount.toLocaleString()} />
                  <SidebarRow label="WS Connect Retries" value={stats.orchestrator.ws.reconnectAttempts.toString()} />
                </div>
              ) : null}
            </div>

            {/* Current Settings / Context */}
            <div className="border border-border/30 rounded-lg bg-card/20 p-4 space-y-3">
              <div className="text-[10px] text-muted-foreground font-bold tracking-widest border-b border-border/20 pb-1.5 uppercase flex items-center justify-between">
                <span>Active Parameters</span>
                <SlidersHorizontal size={10} className="text-muted-foreground/50" />
              </div>
              {stats?.config ? (
                <div className="space-y-2.5 text-[11px] font-mono">
                  <SidebarRow label="NO Price Range" value={`${(stats.config.minNoEntryPrice * 100).toFixed(0)}¢ – ${(stats.config.maxNoEntryPrice * 100).toFixed(0)}¢`} />
                  <SidebarRow label="Max Allowable Spread" value={`${(stats.config.maxSpread * 100).toFixed(1)}¢`} />
                  <SidebarRow label="Scanner Lookahead" value={`${stats.config.deadlineLookaheadDays} Days`} />
                  <SidebarRow label="Min Liquidity Req." value={`$${(stats.config.minLiquidityNum).toLocaleString()}`} />
                  <SidebarRow label="Min 24h Volume" value={`$${(stats.config.minVolume24h).toLocaleString()}`} />
                  <SidebarRow label="Expected Profit Min" value={`$${stats.config.minExpectedNetProfit}`} />
                </div>
              ) : (
                <div className="text-[10px] text-muted-foreground py-4 text-center">
                  Loading parameters…
                </div>
              )}
            </div>

          </div>

        </div>
      </main>

      <SystemStatusIndicator stats={stats} />

      {/* Details Modals */}
      <TradeDetailPopup
        trade={selectedTrade}
        open={selectedTrade !== null}
        onClose={() => setSelectedTrade(null)}
      />

      <MarketDetailModal
        market={selectedMarket}
        trades={trades}
        open={selectedMarket !== null}
        onClose={() => setSelectedMarket(null)}
      />
    </div>
  );
}

/* ─── Inline components ───────────────────────────────────────── */

function SidebarRow({
  label,
  value,
  accent,
  warn,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="flex justify-between items-center text-[10px] md:text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`font-semibold font-mono ${
          warn
            ? "text-red-400"
            : accent
            ? "text-emerald-500"
            : "text-foreground"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function StatusMetric({
  label,
  value,
  statusColor,
}: {
  label: string;
  value: string;
  statusColor?: string;
}) {
  return (
    <div className="bg-background/40 p-2.5 rounded border border-border/20 flex flex-col gap-0.5 justify-center">
      <span className="text-[9px] text-muted-foreground/60 uppercase tracking-wide truncate">{label}</span>
      <span className={`text-[11px] font-bold font-mono ${statusColor ?? "text-foreground"}`}>{value}</span>
    </div>
  );
}

function MarketCountdown({ endDate }: { endDate: string }) {
  const countdown = useCountdown(endDate);
  if (!countdown) return <span>—</span>;
  if (countdown.expired) return <span className="text-amber-500 font-bold">ENDED</span>;
  const { days, hours, minutes, seconds } = countdown;
  if (days > 0) return <span>{days}d {hours}h</span>;
  if (hours > 0) return <span>{hours}:{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}</span>;
  return <span className={minutes < 2 ? "text-red-400 animate-pulse font-bold" : ""}>{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}</span>;
}
