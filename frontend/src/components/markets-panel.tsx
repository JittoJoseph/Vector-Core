"use client";

import type { DiscoveredMarket, SimulatedTrade } from "@/lib/types";
import { ExternalLink } from "lucide-react";

interface MarketsPanelProps {
  markets: DiscoveredMarket[];
  trades: SimulatedTrade[];
  loading: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onMarketClick?: (market: DiscoveredMarket) => void;
}

function polymarketMarketUrl(market: DiscoveredMarket): string {
  if (market.eventSlug && market.slug) {
    return `https://polymarket.com/event/${market.eventSlug}/${market.slug}`;
  }
  if (market.eventSlug) return `https://polymarket.com/event/${market.eventSlug}`;
  if (market.slug) return `https://polymarket.com/market/${market.slug}`;
  return "https://polymarket.com";
}

function n(value: string | number | null | undefined, digits = 2): string {
  if (value == null) return "-";
  const num = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(num)) return "-";
  return num.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function MarketsPanel({
  markets,
  trades,
  loading,
  loadingMore = false,
  hasMore = false,
  onLoadMore,
  onMarketClick,
}: MarketsPanelProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex items-center gap-2 text-sm text-muted-foreground font-mono">
          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-pulse" />
          Loading discovered markets…
        </div>
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <div className="w-8 h-8 rounded-full border border-border/30 flex items-center justify-center text-muted-foreground/40 text-sm">
          ○
        </div>
        <div className="text-sm text-muted-foreground font-mono">
          No discovered markets
        </div>
        <div className="text-xs text-muted-foreground/50 font-mono">
          Waiting for the scanner to find Polymarket deadline ladders…
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-border/30 text-muted-foreground text-[10px] tracking-wider uppercase">
            <th className="text-left py-2.5 px-3 font-medium">Market</th>
            <th className="text-left py-2.5 px-3 font-medium">Deadline</th>
            <th className="text-right py-2.5 px-3 font-medium">NO Price</th>
            <th className="text-right py-2.5 px-3 font-medium">Spread</th>
            <th className="text-right py-2.5 px-3 font-medium">Liquidity</th>
            <th className="text-left py-2.5 px-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {markets.map((market) => {
            const openTrade = trades.find((t) => t.marketId === market.id && t.status === "OPEN");
            const settledTrade = trades.find((t) => t.marketId === market.id && t.status === "SETTLED");

            return (
              <tr
                key={market.id}
                onClick={() => onMarketClick?.(market)}
                className={`border-b border-border/5 cursor-pointer transition-colors duration-150 hover:bg-muted/15 ${
                  openTrade ? "bg-emerald-500/5" : ""
                }`}
              >
                {/* MARKET QUESTION */}
                <td className="py-3 px-3 min-w-[360px]">
                  <div className="flex flex-col gap-0.5">
                    <a
                      href={polymarketMarketUrl(market)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium hover:text-blue-400 inline-flex items-center gap-1 text-foreground"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {market.question}
                      <ExternalLink size={10} className="text-muted-foreground/50" />
                    </a>
                    <span className="text-[10px] text-muted-foreground/60">
                      {market.eventTitle}
                    </span>
                  </div>
                </td>

                {/* DEADLINE */}
                <td className="py-3 px-3 whitespace-nowrap">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-foreground">{market.deadlineDate}</span>
                    <span className="text-[10px] text-muted-foreground/50">
                      {market.deadline ? new Date(market.deadline).toLocaleDateString() : ""}
                    </span>
                  </div>
                </td>

                {/* NO PRICE */}
                <td className="py-3 px-3 text-right tabular-nums text-foreground">
                  {market.noPrice ? `${(parseFloat(market.noPrice) * 100).toFixed(1)}¢` : "—"}
                </td>

                {/* SPREAD */}
                <td className="py-3 px-3 text-right tabular-nums text-muted-foreground">
                  {market.spread ? `${(parseFloat(market.spread) * 100).toFixed(1)}¢` : "—"}
                </td>

                {/* LIQUIDITY */}
                <td className="py-3 px-3 text-right tabular-nums text-foreground font-semibold">
                  {market.liquidityNum ? `$${n(market.liquidityNum, 0)}` : "—"}
                </td>

                {/* STATUS BADGE */}
                <td className="py-3 px-3">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`inline-flex rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                        market.classificationStatus === "traded" || market.classificationStatus === "candidate"
                          ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                          : market.classificationStatus === "rejected"
                          ? "bg-red-500/10 text-red-400 border border-red-500/20"
                          : "bg-muted text-muted-foreground border border-border/30"
                      }`}
                    >
                      {market.classificationStatus}
                    </span>

                    {openTrade && (
                      <span className="inline-flex rounded px-1.5 py-0.5 text-[9px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        POSITION
                      </span>
                    )}

                    {settledTrade && (
                      <span
                        className={`inline-flex rounded px-1.5 py-0.5 text-[9px] font-bold ${
                          settledTrade.exitOutcome === "WIN"
                            ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                            : "bg-red-500/10 text-red-400 border border-red-500/20"
                        }`}
                      >
                        {settledTrade.exitOutcome}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Show More */}
      {(hasMore || loadingMore) && (
        <div className="flex justify-center pt-3 pb-1">
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded text-[11px] font-mono text-muted-foreground border border-border/30 hover:border-border/60 hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loadingMore ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-pulse" />
                Loading…
              </>
            ) : (
              "Show more"
            )}
          </button>
        </div>
      )}
    </div>
  );
}
