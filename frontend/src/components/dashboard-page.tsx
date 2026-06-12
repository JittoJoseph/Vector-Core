"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { Header } from "./header";
import { TradesTable, MarketCountdown } from "./trades-table";
import { TradeDetailPopup } from "./trade-detail-popup";
import { ActivityPanel } from "./activity-panel";
import { CampaignsTable } from "./campaigns-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getApiClient } from "@/lib/api-client";
import { pnlColor, formatPnl, aggregatePortfolioMetrics } from "@/lib/utils";
import NumberFlow from "@number-flow/react";
import {
  useTrades,
  useSystemStats,
  useCampaigns,
  useLiveMarkets,
  usePerformanceRealtime,
  useActivityLog,
} from "@/lib/hooks";
import type { SimulatedTrade, LiveMarketPrice } from "@/lib/types";
import {
  ShieldAlert,
  RefreshCw,
  Activity,
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
    refetch: refetchCampaigns,
  } = useCampaigns();

  const { activities, loading: activitiesLoading } = useActivityLog();
  const { performance, refetch: refetchPerformance } = usePerformanceRealtime("ALL");

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([
      refetchStats().catch(() => {}),
      refetchTrades().catch(() => {}),
      refetchCampaigns().catch(() => {}),
      refetchPerformance().catch(() => {}),
    ]);
    setIsRefreshing(false);
  }, [refetchStats, refetchTrades, refetchCampaigns, refetchPerformance]);

  // Derived datasets
  const openTrades = useMemo(
    () => trades.filter((t) => t.status === "OPEN"),
    [trades],
  );
  const settledTrades = useMemo(
    () => trades.filter((t) => t.status === "SETTLED"),
    [trades],
  );

  // Live prices map for Open Positions
  const livePricesMap = useMemo<Record<string, LiveMarketPrice>>(() => {
    const map: Record<string, LiveMarketPrice> = {};
    for (const m of liveMarkets) {
      for (const [tokenId, price] of Object.entries(m.markPrice)) {
        map[tokenId] = price;
      }
    }
    return map;
  }, [liveMarkets]);



  // Financial Stats
  const initialCapital = parseFloat(performance?.initialCapital || "0");
  const cashBalance = parseFloat(performance?.cashBalance || "0");
  const openPositionsValue = parseFloat(performance?.openPositionsValue || "0");
  const portfolioValue = cashBalance + openPositionsValue;
  
  const winRate = parseFloat(performance?.winRate || "0");
  const isPaused = stats?.orchestrator.paused ?? false;


  const {
    liveUnrealizedPnl,
    closestExpiration,
    closestTrades,
    expirationBuckets,
  } = aggregatePortfolioMetrics(openTrades, livePricesMap);

  const livePortfolioValue =
    cashBalance + openPositionsValue + liveUnrealizedPnl;

  const netPnl = livePortfolioValue - initialCapital;
  const roi = initialCapital > 0 ? (netPnl / initialCapital) * 100 : 0;

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
        <div className="border border-border/30 rounded-xl bg-card/25 p-6 pt-4">
          <div className="flex items-center justify-between border-b border-border/20 pb-2 mb-3">
            <div className="text-[10px] tracking-[0.2em] text-muted-foreground/80 uppercase flex items-center gap-2 font-bold">
              PORTFOLIO PERFORMANCE
            </div>
            <button
              onClick={handleManualRefresh}
              className="text-muted-foreground/50 hover:text-foreground transition-colors"
            >
              <RefreshCw size={12} className={isRefreshing ? "animate-spin" : ""} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 divide-y md:divide-y-0 md:divide-x divide-border/20">
            {/* Section 1: Returns & PnL */}
            <div className="flex flex-col gap-4 lg:pr-6">
               <div className="pt-3">
                 <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-0.5 font-bold">Net P&L</div>
                 <div className={`text-3xl font-bold tracking-tight leading-none ${pnlColor(netPnl)}`}>
                   <NumberFlow value={netPnl} format={{ style: "currency", currency: "USD", signDisplay: "always", minimumFractionDigits: 4, maximumFractionDigits: 4 }} />
                 </div>
                 <div className={`text-xs mt-1.5 font-bold tracking-widest uppercase ${pnlColor(roi, "80")}`}>
                   {roi > 0 ? "+" : ""}{roi.toFixed(2)}% ROI
                 </div>
               </div>
               
               <div className="grid grid-cols-2 gap-2 mt-auto">
                 <div>
                   <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-0.5 font-bold">Unrealized</div>
                   <div className={`text-sm font-bold tracking-tight leading-none ${pnlColor(liveUnrealizedPnl)}`}>
                     <NumberFlow value={liveUnrealizedPnl} format={{ style: "currency", currency: "USD", signDisplay: "always", minimumFractionDigits: 4, maximumFractionDigits: 4 }} />
                   </div>
                 </div>
                 <div>
                   <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-0.5 font-bold">Realized</div>
                   <div className={`text-sm font-bold tracking-tight leading-none ${pnlColor(parseFloat(performance?.totalPnl || "0"))}`}>
                     <NumberFlow value={parseFloat(performance?.totalPnl || "0")} format={{ style: "currency", currency: "USD", signDisplay: "always", minimumFractionDigits: 4, maximumFractionDigits: 4 }} />
                   </div>
                 </div>
               </div>
            </div>

            {/* Section 2: Capital Allocation */}
            <div className="flex flex-col gap-4 md:pl-6 lg:px-6 md:pt-0 pt-4">
               <div className="pt-3">
                 <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-0.5 font-bold">Portfolio Value</div>
                 <div className="text-2xl font-bold tracking-tight leading-none text-foreground">
                   <NumberFlow value={livePortfolioValue} format={{ style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }} />
                 </div>
               </div>
               <div className="flex flex-col gap-1.5 mt-auto">
                 <div className="flex justify-between items-center">
                   <div className="text-[10px] text-muted-foreground/60 uppercase tracking-widest font-bold">Cash Balance</div>
                   <div className="text-xs font-bold text-foreground">${cashBalance.toFixed(2)}</div>
                 </div>
                 <div className="flex justify-between items-center">
                   <div className="text-[10px] text-muted-foreground/60 uppercase tracking-widest font-bold">In Positions</div>
                   <div className="text-xs font-bold text-foreground">${openPositionsValue.toFixed(2)}</div>
                 </div>
                 <div className="flex justify-between items-center border-t border-border/10 pt-1.5 mt-0.5">
                   <div className="text-[10px] text-muted-foreground/80 uppercase tracking-widest font-bold">Initial Capital</div>
                   <div className="text-sm font-bold text-foreground">${initialCapital.toFixed(2)}</div>
                 </div>
               </div>
            </div>

            {/* Section 3: Trade Statistics */}
            <div className="flex flex-col gap-3 lg:pl-6 lg:px-6 md:pt-4 lg:pt-0 pt-4">
               <div className="pt-3">
                 <div className="flex justify-between items-center mb-1.5">
                   <div className="text-[10px] text-muted-foreground/60 uppercase tracking-widest font-bold">Win Rate</div>
                   <div className="text-sm font-bold text-foreground">{winRate.toFixed(1)}%</div>
                 </div>
                 <div className="h-1.5 w-full bg-red-500/30 rounded-full overflow-hidden flex">
                    <div className="h-full bg-emerald-500" style={{ width: `${winRate}%` }}></div>
                 </div>
                 <div className="flex items-center justify-between mt-1.5">
                   <div className="text-xs text-emerald-500/80 font-bold">{performance?.wins || 0} wins</div>
                   <div className="text-[11px] text-muted-foreground/60 font-bold">{performance?.totalTrades || 0} trades</div>
                   <div className="text-xs text-red-500/80 font-bold">{performance?.losses || 0} losses</div>
                 </div>
               </div>
               
               <div className="grid grid-cols-2 gap-2 mt-auto border-t border-border/10 pt-2">
                 <div>
                   <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-0.5 font-bold">Avg Win</div>
                   <div className="text-xs font-bold text-emerald-400">
                     {formatPnl(parseFloat(performance?.avgWin || "0"))}
                   </div>
                 </div>
                 <div>
                   <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-0.5 font-bold">Avg Loss</div>
                   <div className="text-xs font-bold text-red-400">
                     {formatPnl(parseFloat(performance?.avgLoss || "0"))}
                   </div>
                 </div>
               </div>
            </div>

            {/* Section 4: System & Engine Health */}
            <div className="flex flex-col gap-4 md:pl-6 lg:pl-6 md:pt-4 lg:pt-0 pt-4">
               
               {/* Engine & Feed Status */}
               <div className="flex flex-col gap-2 mt-3">
                 <div className="flex items-center justify-between bg-card/30 border border-border/20 rounded px-3 py-1.5">
                   <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground/80 uppercase tracking-widest font-bold">Engine</span>
                   </div>
                   <span className={`text-[10px] font-bold tracking-widest uppercase ${isPaused ? "text-amber-500" : stats?.orchestrator.running ? "text-emerald-400" : "text-muted-foreground"}`}>
                     {isPaused ? "PAUSED" : stats?.orchestrator.running ? "RUNNING" : "IDLE"}
                   </span>
                 </div>

                 <div className="flex items-center justify-between bg-card/30 border border-border/20 rounded px-3 py-1.5">
                   <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground/80 uppercase tracking-widest font-bold">Feed</span>
                   </div>
                   <span className={`text-[10px] font-bold tracking-widest uppercase ${stats?.orchestrator.ws.connected ? "text-emerald-400" : "text-red-400"}`}>
                     {stats?.orchestrator.ws.connected ? "LIVE" : "DEAD"}
                   </span>
                 </div>
               </div>

               {/* Telemetry Grid */}
               <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                 <div>
                   <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-0.5 font-bold">Active Pos</div>
                   <div className="text-xs font-bold text-foreground">{openTrades.length}</div>
                 </div>
                 <div>
                   <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-0.5 font-bold">Analyzed</div>
                   <div className="text-xs font-bold text-foreground">{evaluatedCount}</div>
                 </div>
                 <div>
                   <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-0.5 font-bold">Loops</div>
                   <div className="text-xs font-mono font-bold text-foreground">{stats?.orchestrator.cycleCount || 0}</div>
                 </div>
                 <div>
                   <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-0.5 font-bold">Found</div>
                   <div className="text-xs font-mono font-bold text-foreground">{discoveredLaddersCount}</div>
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
                    label: `TRADE HISTORY`,
                  },
                  { id: "campaigns", label: "ACTIVE CAMPAIGNS" },
                  { id: "campaign_history", label: "CAMPAIGN HISTORY" },
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
                  onTradeClick={setSelectedTrade}
                  onLoadMore={loadMoreTrades}
                  hasMore={hasMoreTrades}
                  loadingMore={loadingMoreTrades}
                />
              </TabsContent>

              {/* CAMPAIGNS TAB */}
              <TabsContent
                value="campaigns"
                className="mt-0 flex-1 p-0 flex flex-col h-full"
              >
                <CampaignsTable status="active" />
              </TabsContent>

              {/* CAMPAIGN HISTORY TAB */}
              <TabsContent
                value="campaign_history"
                className="mt-0 flex-1 p-0 flex flex-col h-full"
              >
                <CampaignsTable status="history" />
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
                                title={trade.campaignTitle ? `${trade.campaignTitle} - ${trade.bucketGroupTitle}` : "Unknown"}
                              >
                                {trade.campaignTitle ? `${trade.campaignTitle} - ${trade.bucketGroupTitle}` : "Unknown"}
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
