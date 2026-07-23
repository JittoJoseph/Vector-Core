"use client";

import { useState, useCallback } from "react";
import { Header } from "./header";
import { TradesTable, MarketCountdown } from "./trades-table";
import { TradeDetailPopup } from "./trade-detail-popup";
import { ActivityPanel } from "./activity-panel";
import { CampaignsTable } from "./campaigns-table";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  pnlColor,
  formatPnl,
  groupExpirations,
  shortCampaignTitle,
} from "@/lib/utils";
import NumberFlow from "@number-flow/react";
import {
  usePositions,
  useTradeHistory,
  useSystemStats,
  useCampaigns,
  usePerformance,
  useActivityLog,
} from "@/lib/hooks";
import type { Trade, PositionPnl } from "@/lib/types";
import { RefreshCw, Activity, SlidersHorizontal } from "lucide-react";

function Money({
  value,
  className,
  signed = true,
  decimals = 4,
}: {
  value: number;
  className?: string;
  signed?: boolean;
  decimals?: number;
}) {
  return (
    <span className={className}>
      <NumberFlow
        value={value}
        format={{
          style: "currency",
          currency: "USD",
          signDisplay: signed ? "always" : "auto",
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }}
      />
    </span>
  );
}

export function DashboardPage() {
  const [activeTab, setActiveTab] = useState("positions");
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);

  const { stats, refetch: refetchStats } = useSystemStats();
  const {
    positions: openTrades,
    loading: positionsLoading,
    refetch: refetchPositions,
  } = usePositions();
  const {
    trades: settledTrades,
    loading: tradesLoading,
    loadMore: loadMoreTrades,
    hasMore: hasMoreTrades,
    loadingMore: loadingMoreTrades,
    refetch: refetchTrades,
  } = useTradeHistory(activeTab === "history");
  const {
    campaigns: activeCampaigns,
    loading: activeLoading,
    refetch: refetchActive,
  } = useCampaigns("active", activeTab === "campaigns");
  const {
    campaigns: historyCampaigns,
    loading: historyLoading,
    refetch: refetchHistory,
  } = useCampaigns("history", activeTab === "campaign_history");
  const { activities, loading: activitiesLoading } = useActivityLog(
    activeTab === "diagnostics",
  );
  const { performance, refetch: refetchPerformance } = usePerformance("ALL");

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all(
      [
        refetchStats(),
        refetchPositions(),
        refetchTrades(),
        refetchActive(),
        refetchHistory(),
        refetchPerformance(),
      ].map((p) => Promise.resolve(p).catch(() => {})),
    );
    setIsRefreshing(false);
  }, [
    refetchStats,
    refetchPositions,
    refetchTrades,
    refetchActive,
    refetchHistory,
    refetchPerformance,
  ]);

  const portfolio = stats?.portfolio;
  const positionsPnl: Record<string, PositionPnl> = stats?.positionsPnl ?? {};

  const netPnl = portfolio?.netPnl ?? 0;
  const roi = portfolio?.roi ?? 0;
  const unrealizedPnl = portfolio?.unrealizedPnl ?? 0;
  const realizedPnl = portfolio?.realizedPnl ?? 0;
  const portfolioValue = portfolio?.portfolioValue ?? 0;
  const cashBalance = portfolio?.cashBalance ?? 0;
  const openPositionsValue = portfolio?.openPositionsValue ?? 0;
  const initialCapital = portfolio?.initialCapital ?? 0;

  const winRate = parseFloat(performance?.winRate || "0");
  const isPaused = stats?.orchestrator?.paused ?? false;

  const { closestExpiration, closestTrades, expirationBuckets } =
    groupExpirations(openTrades);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-mono selection:bg-muted-foreground/30">
      <Header />

      <main className="flex-1 px-4 py-4 pb-16 max-w-7xl mx-auto w-full space-y-4">
        <div className="border border-border/30 rounded-xl bg-card/25 p-6 pt-4">
          <div className="flex items-center justify-between border-b border-border/20 pb-2 mb-3">
            <div className="text-[10px] tracking-[0.2em] text-muted-foreground/80 uppercase flex items-center gap-2 font-bold">
              PORTFOLIO PERFORMANCE
            </div>
            <button
              onClick={handleManualRefresh}
              className="text-muted-foreground/50 hover:text-foreground transition-colors"
            >
              <RefreshCw
                size={12}
                className={isRefreshing ? "animate-spin" : ""}
              />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 divide-y md:divide-y-0 md:divide-x divide-border/20">
            <div className="flex flex-col gap-4 lg:pr-6">
              <div className="pt-3">
                <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-0.5 font-bold">
                  Net P&L
                </div>
                <Money
                  value={netPnl}
                  className={`block text-3xl font-bold tracking-tight leading-none ${pnlColor(netPnl)}`}
                />
                <div
                  className={`text-xs mt-1.5 font-bold tracking-widest uppercase ${pnlColor(roi, true)}`}
                >
                  {roi > 0 ? "+" : ""}
                  {roi.toFixed(2)}% ROI
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-auto">
                <div>
                  <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-0.5 font-bold">
                    Unrealized
                  </div>
                  <Money
                    value={unrealizedPnl}
                    className={`block text-sm font-bold tracking-tight leading-none ${pnlColor(unrealizedPnl)}`}
                  />
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-0.5 font-bold">
                    Realized
                  </div>
                  <Money
                    value={realizedPnl}
                    className={`block text-sm font-bold tracking-tight leading-none ${pnlColor(realizedPnl)}`}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4 md:pl-6 lg:px-6 md:pt-0 pt-4">
              <div className="pt-3">
                <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-0.5 font-bold">
                  Portfolio Value
                </div>
                <Money
                  value={portfolioValue}
                  signed={false}
                  decimals={2}
                  className="block text-2xl font-bold tracking-tight leading-none text-foreground"
                />
              </div>
              <div className="flex flex-col gap-1.5 mt-auto">
                <div className="flex justify-between items-center">
                  <div className="text-[10px] text-muted-foreground/60 uppercase tracking-widest font-bold">
                    Cash Balance
                  </div>
                  <div className="text-xs font-bold text-foreground">
                    ${cashBalance.toFixed(2)}
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <div className="text-[10px] text-muted-foreground/60 uppercase tracking-widest font-bold">
                    In Positions
                  </div>
                  <div className="text-xs font-bold text-foreground">
                    ${openPositionsValue.toFixed(2)}
                  </div>
                </div>
                <div className="flex justify-between items-center border-t border-border/10 pt-1.5 mt-0.5">
                  <div className="text-[10px] text-muted-foreground/80 uppercase tracking-widest font-bold">
                    Initial Capital
                  </div>
                  <div className="text-sm font-bold text-foreground">
                    ${initialCapital.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:pl-6 lg:px-6 md:pt-4 lg:pt-0 pt-4">
              <div className="pt-3">
                <div className="flex justify-between items-center mb-1.5">
                  <div className="text-[10px] text-muted-foreground/60 uppercase tracking-widest font-bold">
                    Win Rate
                  </div>
                  <div className="text-sm font-bold text-foreground">
                    {winRate.toFixed(1)}%
                  </div>
                </div>
                <div className="h-1.5 w-full bg-red-500/30 rounded-full overflow-hidden flex">
                  <div
                    className="h-full bg-emerald-500"
                    style={{ width: `${winRate}%` }}
                  ></div>
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <div className={`text-xs font-bold ${pnlColor(1, true)}`}>
                    {performance?.wins || 0} wins
                  </div>
                  <div className="text-[11px] text-muted-foreground/60 font-bold">
                    {performance?.totalTrades || 0} trades
                  </div>
                  <div className={`text-xs font-bold ${pnlColor(-1, true)}`}>
                    {performance?.losses || 0} losses
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-auto border-t border-border/10 pt-2">
                <div>
                  <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-0.5 font-bold">
                    Avg Win
                  </div>
                  <div className={`text-xs font-bold ${pnlColor(1)}`}>
                    {formatPnl(parseFloat(performance?.avgWin || "0"))}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-0.5 font-bold">
                    Avg Loss
                  </div>
                  <div className={`text-xs font-bold ${pnlColor(-1)}`}>
                    {formatPnl(parseFloat(performance?.avgLoss || "0"))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4 md:pl-6 lg:pl-6 md:pt-4 lg:pt-0 pt-4">
              <div className="flex flex-col gap-2 mt-3">
                <div className="flex items-center justify-between bg-card/30 border border-border/20 rounded px-3 py-1.5">
                  <span className="text-[10px] text-muted-foreground/80 uppercase tracking-widest font-bold">
                    Engine
                  </span>
                  <span
                    className={`text-[10px] font-bold tracking-widest uppercase ${isPaused ? "text-amber-500" : stats?.orchestrator?.running ? "text-emerald-400" : "text-muted-foreground"}`}
                  >
                    {isPaused
                      ? "PAUSED"
                      : stats?.orchestrator?.running
                        ? "ACTIVE"
                        : "IDLE"}
                  </span>
                </div>

                <div className="flex items-center justify-between bg-card/30 border border-border/20 rounded px-3 py-1.5">
                  <span className="text-[10px] text-muted-foreground/80 uppercase tracking-widest font-bold">
                    Feed
                  </span>
                  <span
                    className={`text-[10px] font-bold tracking-widest uppercase ${stats?.orchestrator?.ws?.connected ? "text-emerald-400" : "text-red-400"}`}
                  >
                    {stats?.orchestrator?.ws?.connected ? "LIVE" : "DEAD"}
                  </span>
                </div>

                <div className="flex items-center justify-between bg-card/30 border border-border/20 rounded px-3 py-1.5">
                  <span className="text-[10px] text-muted-foreground/80 uppercase tracking-widest font-bold">
                    Polymarket
                  </span>
                  <span
                    className={`text-[10px] font-bold tracking-widest uppercase ${
                      stats?.orchestrator?.polymarketStatus === "UP"
                        ? "text-emerald-400"
                        : stats?.orchestrator?.polymarketStatus === "HASISSUES"
                          ? "text-amber-500"
                          : stats?.orchestrator?.polymarketStatus ===
                              "UNDERMAINTENANCE"
                            ? "text-red-500"
                            : "text-muted-foreground"
                    }`}
                  >
                    {stats?.orchestrator?.polymarketStatus || "UNKNOWN"}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-0.5 font-bold">
                    Watched Markets
                  </div>
                  <div className="text-xs font-mono font-bold text-foreground">
                    {stats?.orchestrator?.activeBuckets || 0}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-0.5 font-bold">
                    Loops
                  </div>
                  <div className="text-[10px] font-bold tracking-widest uppercase text-foreground">
                    {stats?.orchestrator?.cycleCount || 0}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-4">
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
                  { id: "history", label: "TRADE HISTORY" },
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

              <TabsContent value="positions" className="mt-0 flex-1 p-0">
                <TradesTable
                  type="OPEN"
                  trades={openTrades}
                  loading={positionsLoading}
                  positionsPnl={positionsPnl}
                  onTradeClick={setSelectedTrade}
                  onLoadMore={loadMoreTrades}
                  hasMore={hasMoreTrades}
                  loadingMore={loadingMoreTrades}
                />
              </TabsContent>

              <TabsContent
                value="history"
                className="mt-0 flex-1 p-0 flex flex-col"
              >
                <div className="bg-card/50 border-b border-border/20 px-4 py-3 flex items-center justify-between">
                  <div className="flex gap-8">
                    {(
                      [
                        ["Realized PnL", performance?.totalPnl, null],
                        ["Avg Win", performance?.avgWin, 1],
                        ["Avg Loss", performance?.avgLoss, -1],
                        ["Total Win", performance?.totalWin, 1],
                        ["Total Loss", performance?.totalLoss, -1],
                      ] as const
                    ).map(([label, value, sign]) => {
                      const num = parseFloat(value || "0");
                      return (
                        <div key={label} className="flex flex-col">
                          <span className="text-[9px] text-muted-foreground uppercase tracking-widest">
                            {label}
                          </span>
                          <span
                            className={`text-sm font-bold ${pnlColor(sign ?? num)}`}
                          >
                            {formatPnl(num)}
                          </span>
                        </div>
                      );
                    })}
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

              <TabsContent
                value="campaigns"
                className="mt-0 flex-1 p-0 flex flex-col h-full"
              >
                <CampaignsTable
                  status="active"
                  campaigns={activeCampaigns}
                  loading={activeLoading}
                  positionsPnl={positionsPnl}
                />
              </TabsContent>

              <TabsContent
                value="campaign_history"
                className="mt-0 flex-1 p-0 flex flex-col h-full"
              >
                <CampaignsTable
                  status="history"
                  campaigns={historyCampaigns}
                  loading={historyLoading}
                />
              </TabsContent>

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
                            {stats?.orchestrator?.cycleCount || 0}
                          </div>
                        </div>
                        <div className="border border-border/20 rounded p-3 bg-muted/5">
                          <div className="text-[9px] text-muted-foreground uppercase tracking-widest mb-1">
                            WS Messages
                          </div>
                          <div className="text-lg font-bold">
                            {stats?.orchestrator?.ws?.messageCount || 0}
                          </div>
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

          <div className="w-full lg:w-[320px] shrink-0 flex flex-col gap-6">
            <div className="border border-border/30 rounded-xl bg-card/25 p-6 pt-4 flex flex-col">
              <div className="flex items-center justify-between border-b border-border/20 pb-2 mb-3 shrink-0">
                <div className="text-[10px] tracking-[0.2em] text-muted-foreground/80 uppercase flex items-center gap-2 font-bold">
                  UPCOMING EXPOSURES
                </div>
                <div className="text-[9px] text-muted-foreground/80 uppercase tracking-widest font-bold">
                  {openTrades.length} OPEN
                </div>
              </div>

              <div className="flex flex-col gap-3">
                {closestTrades.length > 0 && closestExpiration ? (
                  <>
                    <div className="pt-1 pb-3">
                      <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-0.5 font-bold">
                        Next Settlement
                      </div>
                      <div className="text-2xl font-bold tracking-tight leading-none text-foreground font-mono tabular-nums">
                        <MarketCountdown
                          endDate={closestExpiration.toISOString()}
                          showSeconds={true}
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-4 relative">
                      <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border/40 z-0"></div>

                      {closestTrades.map((trade) => {
                        const pp = positionsPnl[trade.id];
                        const pnl = pp?.pnl ?? null;
                        const pnlPct = pp?.pnlPct ?? null;

                        return (
                          <div
                            key={trade.id}
                            className="relative z-10 pl-6 flex flex-col gap-1 cursor-pointer group"
                            onClick={() => setSelectedTrade(trade)}
                          >
                            <div
                              className={`absolute left-0 top-1 w-[15px] h-[15px] rounded-full flex items-center justify-center bg-background border ${pnl !== null && pnl >= 0 ? "border-emerald-500/50" : pnl !== null ? "border-red-500/50" : "border-muted-foreground/30"}`}
                            >
                              <div
                                className={`w-1.5 h-1.5 rounded-full ${pnl !== null && pnl >= 0 ? "bg-emerald-500" : pnl !== null ? "bg-red-500" : "bg-muted-foreground/50"}`}
                              ></div>
                            </div>

                            <div className="flex justify-between items-start w-full">
                              <div className="flex flex-col gap-0.5 min-w-0 pr-2">
                                <span
                                  className="text-[11px] font-semibold text-foreground/90 group-hover:text-blue-400 transition-colors truncate"
                                  title={trade.campaignTitle || "Unknown"}
                                >
                                  {shortCampaignTitle(trade.campaignTitle)}
                                </span>
                                <span className="text-[10px] text-muted-foreground uppercase tracking-widest truncate">
                                  {trade.bucketGroupTitle}
                                </span>
                              </div>
                              <div className="flex flex-col items-end shrink-0 pt-[2px]">
                                {pnl !== null ? (
                                  <>
                                    <Money
                                      value={pnl}
                                      className={`text-[11px] font-bold tracking-tight leading-none ${pnlColor(pnl)}`}
                                    />
                                    {pnlPct !== null && (
                                      <span
                                        className={`text-[9px] mt-1 tracking-tight font-bold ${pnlColor(pnlPct, true)}`}
                                      >
                                        {pnlPct >= 0 ? "+" : ""}
                                        {pnlPct.toFixed(1)}%
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-[11px] font-bold text-muted-foreground/40">
                                    —
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground bg-muted/10 p-4 rounded text-center">
                    No active exposures
                  </div>
                )}

                <div className="grid grid-cols-2 gap-y-4 gap-x-4 pt-4 mt-2 border-t border-border/10">
                  {(
                    [
                      ["< 24h", "<24h"],
                      ["1-3 Days", "1-3d"],
                      ["4-7 Days", "4-7d"],
                      ["> 7 Days", ">7d"],
                    ] as const
                  ).map(([label, key]) => (
                    <div key={key}>
                      <div className="text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-0.5 font-bold">
                        {label}
                      </div>
                      <div className="text-sm font-bold tracking-tight leading-none text-foreground">
                        {expirationBuckets[key]}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

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

                <div className="flex justify-between items-end">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    Stop Loss Enabled
                  </span>
                  <span className="text-[11px] font-mono text-foreground tabular-nums">
                    {stats?.config.stopLossEnabled ? "Enabled" : "Disabled"}
                  </span>
                </div>

                <div className="flex justify-between items-end">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    Stop Loss Trigger
                  </span>
                  <span className="text-[11px] font-mono text-foreground tabular-nums">
                    {Math.round((stats?.config.stopLossNoPrice || 0) * 100)}¢
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
        positionPnl={selectedTrade ? positionsPnl[selectedTrade.id] : undefined}
      />
    </div>
  );
}
