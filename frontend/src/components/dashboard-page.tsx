"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "./header";
import { SystemStatusIndicator } from "./system-status-indicator";
import { getApiClient } from "@/lib/api-client";
import { useLiveMarkets, useSystemStats, useTrades, useWsConnection } from "@/lib/hooks";
import type { DiscoveredMarket, EventFamily, Opportunity, PortfolioState } from "@/lib/types";
import { formatPnl, pnlColor } from "@/lib/utils";
import { ExternalLink, RefreshCw } from "lucide-react";

function n(value: string | number | null | undefined, digits = 2): string {
  if (value == null) return "-";
  const num = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(num)) return "-";
  return num.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function daysTo(deadline: string): string {
  const diff = new Date(deadline).getTime() - Date.now();
  const days = diff / 86_400_000;
  if (days < 0) return "past";
  if (days < 1) return `${Math.max(0, Math.floor(diff / 3_600_000))}h`;
  return `${days.toFixed(1)}d`;
}

function polymarketEventUrl(slug?: string | null): string {
  return slug ? `https://polymarket.com/event/${slug}` : "https://polymarket.com";
}

function polymarketMarketUrl(market: {
  eventSlug?: string | null;
  slug?: string | null;
}): string {
  if (market.eventSlug && market.slug) {
    return `https://polymarket.com/event/${market.eventSlug}/${market.slug}`;
  }
  if (market.eventSlug) return `https://polymarket.com/event/${market.eventSlug}`;
  if (market.slug) return `https://polymarket.com/market/${market.slug}`;
  return "https://polymarket.com";
}

export function DashboardPage() {
  const wsConnected = useWsConnection();
  const { stats, loading: statsLoading } = useSystemStats();
  const liveMarkets = useLiveMarkets();
  const { trades, loading: tradesLoading } = useTrades();
  const [families, setFamilies] = useState<EventFamily[]>([]);
  const [markets, setMarkets] = useState<DiscoveredMarket[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioState | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const api = getApiClient();
      const [familyRows, marketRows, opportunityRows, portfolioState] =
        await Promise.all([
          api.getFamilies({ limit: 50 }),
          api.getMarkets({ limit: 100 }),
          api.getOpportunities({ limit: 100 }),
          api.getPortfolio().catch(() => null),
        ]);
      setFamilies(familyRows);
      setMarkets(marketRows);
      setOpportunities(opportunityRows);
      setPortfolio(portfolioState);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const candidateMarkets = useMemo(
    () =>
      markets
        .filter((m) => m.classificationStatus === "candidate" || m.classificationStatus === "traded")
        .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime()),
    [markets],
  );

  const ladderFamilies = useMemo(
    () => families.filter((f) => f.familyKind === "deadline_ladder"),
    [families],
  );

  const openTrades = trades.filter((t) => t.status === "OPEN");
  const settledTrades = trades.filter((t) => t.status === "SETTLED");
  const totalPnl = settledTrades.reduce(
    (sum, trade) => sum + parseFloat(trade.realizedPnl ?? "0"),
    0,
  );

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Header />
      <main className="flex-1 px-4 py-4 pb-16 max-w-7xl mx-auto w-full space-y-4">
        <section className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4">
          <div className="border border-border/40 rounded-lg bg-card/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-mono tracking-[0.18em] text-muted-foreground">
                  EXPLICIT-DATE DEADLINE ENGINE
                </div>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight">
                  NO-side Polymarket deadline ladders
                </h1>
                <p className="mt-2 text-sm text-muted-foreground max-w-3xl">
                  Discovering markets with calendar deadlines like June 3, June
                  15, and December 31. Broad shapes like before 2027 and end of
                  month phrasing are excluded from trading.
                </p>
              </div>
              <button
                onClick={() => load().catch(() => {})}
                className="h-9 w-9 inline-flex items-center justify-center border border-border/50 rounded hover:bg-muted"
                title="Refresh"
              >
                <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-5">
              <Metric label="Ladders" value={ladderFamilies.length} />
              <Metric label="Candidates" value={candidateMarkets.length} />
              <Metric label="Open Trades" value={openTrades.length} />
              <Metric label="Settled" value={settledTrades.length} />
              <Metric label="Live Tokens" value={liveMarkets.length} />
            </div>
          </div>

          <div className="border border-border/40 rounded-lg bg-card/30 p-4">
            <div className="text-[10px] font-mono tracking-[0.18em] text-muted-foreground">
              SYSTEM
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Metric
                label="Engine"
                value={stats?.orchestrator.paused ? "PAUSED" : stats?.orchestrator.running ? "RUNNING" : "IDLE"}
                accent={!!stats?.orchestrator.running && !stats?.orchestrator.paused}
                warn={!!stats?.orchestrator.paused}
              />
              <Metric label="WS" value={wsConnected ? "LIVE" : "WAITING"} accent={wsConnected} />
              <Metric label="Open Trades" value={openTrades.length} />
              <Metric label="P&L" value={formatPnl(totalPnl)} className={pnlColor(totalPnl)} />
            </div>
            <div className="mt-4 text-xs text-muted-foreground space-y-1">
              <div>NO band: {statsLoading ? "-" : `${n(stats?.config.minNoEntryPrice, 3)}-${n(stats?.config.maxNoEntryPrice, 3)}`}</div>
              <div>Lookahead: {stats?.config.deadlineLookaheadDays ?? "-"} days</div>
              <div>Min liquidity: ${n(stats?.config.minLiquidityNum, 0)}</div>
              <div>Portfolio: ${n(portfolio?.portfolioValue)}</div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-4">
          <div className="border border-border/40 rounded-lg bg-card/30 overflow-hidden">
            <PanelHeader title="Candidate Deadline Markets" subtitle="Explicit month/day ladders only" />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/30">
                  <tr>
                    <th className="text-left p-3">Market</th>
                    <th className="text-left p-3">Deadline</th>
                    <th className="text-right p-3">NO</th>
                    <th className="text-right p-3">Spread</th>
                    <th className="text-right p-3">Liquidity</th>
                    <th className="text-left p-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {candidateMarkets.slice(0, 40).map((market) => (
                    <tr key={market.id} className="border-b border-border/20 hover:bg-muted/20">
                      <td className="p-3 min-w-[360px]">
                        <a
                          href={polymarketMarketUrl(market)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium hover:text-blue-400 inline-flex items-center gap-1"
                        >
                          {market.question}
                          <ExternalLink size={12} />
                        </a>
                        <div className="text-xs text-muted-foreground mt-1">{market.eventTitle}</div>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <div>{market.deadlineDate}</div>
                        <div className="text-xs text-muted-foreground">{daysTo(market.deadline)}</div>
                      </td>
                      <td className="p-3 text-right font-mono">{n(market.noPrice, 4)}</td>
                      <td className="p-3 text-right font-mono">{n(market.spread, 4)}</td>
                      <td className="p-3 text-right font-mono">${n(market.liquidityNum, 0)}</td>
                      <td className="p-3">
                        <StatusBadge value={market.classificationStatus} />
                      </td>
                    </tr>
                  ))}
                  {candidateMarkets.length === 0 && (
                    <tr>
                      <td className="p-6 text-center text-muted-foreground" colSpan={6}>
                        No candidate ladders loaded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-4">
            <div className="border border-border/40 rounded-lg bg-card/30 overflow-hidden">
              <PanelHeader title="Deadline Families" subtitle="Different explicit dates under one event" />
              <div className="divide-y divide-border/20">
                {ladderFamilies.slice(0, 12).map((family) => (
                  <a
                    key={family.id}
                    href={polymarketEventUrl(family.slug)}
                    target="_blank"
                    rel="noreferrer"
                    className="block p-3 hover:bg-muted/20"
                  >
                    <div className="font-medium text-sm">{family.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground flex justify-between">
                      <span>{family.explicitDateCount} dates</span>
                      <span>${n(family.volume24h, 0)} 24h volume</span>
                    </div>
                  </a>
                ))}
              </div>
            </div>

            <div className="border border-border/40 rounded-lg bg-card/30 overflow-hidden">
              <PanelHeader title="Recent Decisions" subtitle="Rejected, accepted, and traded opportunities" />
              <div className="divide-y divide-border/20 max-h-[420px] overflow-auto">
                {opportunities.slice(0, 30).map((opp) => (
                  <div key={opp.id} className="p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <StatusBadge value={opp.status} />
                      <span className="text-xs text-muted-foreground">{new Date(opp.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">{opp.reason}</div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs font-mono">
                      <span>NO {n(opp.noBestAsk, 4)}</span>
                      <span>spr {n(opp.spread, 4)}</span>
                      <span>pnl {n(opp.expectedNetProfit, 3)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border border-border/40 rounded-lg bg-card/30 overflow-hidden">
          <PanelHeader title="Trades" subtitle="Simulated NO positions" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/30">
                <tr>
                  <th className="text-left p-3">Market</th>
                  <th className="text-right p-3">Entry</th>
                  <th className="text-right p-3">Shares</th>
                  <th className="text-right p-3">Cost</th>
                  <th className="text-right p-3">Expected</th>
                  <th className="text-right p-3">Realized</th>
                  <th className="text-left p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => (
                  <tr key={trade.id} className="border-b border-border/20">
                    <td className="p-3 min-w-[360px]">
                      <div className="font-medium">{trade.marketQuestion}</div>
                      <div className="text-xs text-muted-foreground">{trade.deadlineDate}</div>
                    </td>
                    <td className="p-3 text-right font-mono">{n(trade.entryPrice, 4)}</td>
                    <td className="p-3 text-right font-mono">{n(trade.entryShares, 2)}</td>
                    <td className="p-3 text-right font-mono">${n(trade.actualCost, 2)}</td>
                    <td className="p-3 text-right font-mono">${n(trade.expectedNetProfit, 3)}</td>
                    <td className={`p-3 text-right font-mono ${pnlColor(parseFloat(trade.realizedPnl ?? "0"))}`}>
                      {trade.realizedPnl ? formatPnl(parseFloat(trade.realizedPnl)) : "-"}
                    </td>
                    <td className="p-3"><StatusBadge value={trade.status} /></td>
                  </tr>
                ))}
                {!tradesLoading && trades.length === 0 && (
                  <tr>
                    <td className="p-6 text-center text-muted-foreground" colSpan={7}>
                      No simulated trades yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
      <SystemStatusIndicator stats={stats} />
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
  warn,
  className,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
  warn?: boolean;
  className?: string;
}) {
  return (
    <div className="border border-border/30 rounded p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold font-mono ${warn ? "text-amber-400" : accent ? "text-emerald-400" : className ?? ""}`}>
        {value}
      </div>
    </div>
  );
}

function PanelHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="px-4 py-3 border-b border-border/30 flex items-end justify-between gap-3">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

function StatusBadge({ value }: { value: string }) {
  const tone =
    value === "traded" || value === "OPEN" || value === "candidate"
      ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
      : value === "rejected" || value === "LOSS"
        ? "text-red-400 border-red-500/30 bg-red-500/10"
        : "text-muted-foreground border-border/40 bg-muted/20";
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-[10px] font-mono uppercase ${tone}`}>
      {value}
    </span>
  );
}
