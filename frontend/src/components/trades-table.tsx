"use client";

import type { SimulatedTrade, LiveMarketPrice } from "@/lib/types";
import { pnlColor, formatPnl, polymarketMarketUrl } from "@/lib/utils";
import { ExternalLink } from "lucide-react";

interface TradesTableProps {
  trades: SimulatedTrade[];
  loading: boolean;
  type: "OPEN" | "SETTLED";
  /** Real-time prices keyed by tokenId, refreshed from WS */
  livePrices?: Record<string, LiveMarketPrice>;

  onTradeClick?: (trade: SimulatedTrade) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
}

export function TradesTable({
  trades,
  loading,
  type,
  livePrices = {},
  onTradeClick,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
}: TradesTableProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex items-center gap-2 text-sm text-muted-foreground font-mono">
          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-pulse" />
          Loading...
        </div>
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <div className="w-8 h-8 rounded-full border border-border/30 flex items-center justify-center text-muted-foreground/40 text-sm">
          ○
        </div>
        <div className="text-sm text-muted-foreground font-mono">
          {type === "OPEN" ? "No open positions" : "No trade history"}
        </div>
      </div>
    );
  }

  const sortedTrades = [...trades];
  if (type === "OPEN") {
    sortedTrades.sort((a, b) => {
      const aEnd = a.campaignEndDate;
      const bEnd = b.campaignEndDate;
      if (!aEnd && !bEnd) return 0;
      if (!aEnd) return 1;
      if (!bEnd) return -1;
      return new Date(aEnd).getTime() - new Date(bEnd).getTime();
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-border/30">
            {type === "OPEN" ? (
              <>
                <th className="text-left py-2.5 px-3 font-medium text-amber-500/80 tracking-wider text-[10px]">
                  TIME LEFT
                </th>
                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground tracking-wider text-[10px]">
                  CAMPAIGN
                </th>
                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground tracking-wider text-[10px]">
                  COUNT
                </th>
                <th className="text-right py-2.5 px-3 font-medium text-muted-foreground tracking-wider text-[10px]">
                  COST BASIS
                </th>
                <th className="text-right py-2.5 px-3 font-medium text-muted-foreground tracking-wider text-[10px]">
                  PRICE DRIFT
                </th>
                <th className="text-right py-2.5 px-3 font-medium text-muted-foreground tracking-wider text-[10px]">
                  PNL / ROI
                </th>
              </>
            ) : (
              <>
                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground tracking-wider text-[10px]">
                  CAMPAIGN
                </th>
                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground tracking-wider text-[10px]">
                  COUNT
                </th>
                <th className="text-right py-2.5 px-3 font-medium text-muted-foreground tracking-wider text-[10px]">
                  RESOLUTION DATE
                </th>
                <th className="text-right py-2.5 px-3 font-medium text-muted-foreground tracking-wider text-[10px]">
                  COST BASIS
                </th>
                <th className="text-right py-2.5 px-3 font-medium text-muted-foreground tracking-wider text-[10px]">
                  PRICE DRIFT
                </th>
                <th className="text-right py-2.5 px-3 font-medium text-muted-foreground tracking-wider text-[10px]">
                  OUTCOME
                </th>
                <th className="text-right py-2.5 px-3 font-medium text-muted-foreground tracking-wider text-[10px]">
                  REALIZED PNL
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {sortedTrades.map((trade, idx) => {
            const entryPrice = parseFloat(trade.entryPrice);
            const entryCents = Math.round(entryPrice * 100);
            const shares = parseFloat(trade.entryShares || "0");
            const fees = parseFloat(trade.entryFees || "0");
            const actualCost = parseFloat(trade.actualCost || "1");
            const expectedProfit = parseFloat(trade.expectedNetProfit || "0");
            const isClosed = trade.status === "SETTLED";
            const isOpen = trade.status === "OPEN";

            const endDateStr = trade.campaignEndDate;

            if (type === "OPEN") {
              const livePrice = trade.tokenId
                ? (livePrices[trade.tokenId] ?? null)
                : null;
              const liveMid = livePrice?.mid ?? null;
              const liveCents =
                liveMid !== null ? Math.round(liveMid * 100) : null;
              const unrealizedPnl =
                liveMid !== null
                  ? (liveMid - entryPrice) * shares - fees
                  : null;
              const unrealizedPnlPct =
                unrealizedPnl !== null && actualCost > 0
                  ? (unrealizedPnl / actualCost) * 100
                  : null;

              const polyUrl = polymarketMarketUrl({
                eventSlug: trade.campaignSlug,
                marketSlug: trade.bucketSlug,
              });

              return (
                <tr
                  key={trade.id}
                  onClick={() => onTradeClick?.(trade)}
                  className={`border-b border-border/5 cursor-pointer transition-colors duration-150 hover:bg-muted/15 ${
                    idx % 2 === 0 ? "bg-transparent" : "bg-card/5"
                  }`}
                >
                  {/* TIME LEFT */}
                  <td className="py-2.5 px-3 text-left whitespace-nowrap">
                    {endDateStr ? (
                      <div className="text-xs font-medium text-yellow-500/70">
                        <MarketCountdown endDate={endDateStr} />
                      </div>
                    ) : (
                      <span className="text-xs font-medium text-amber-500/80">
                        —
                      </span>
                    )}
                  </td>

                  {/* CAMPAIGN */}
                  <td className="py-2.5 px-3 max-w-[200px]">
                    <div className="flex flex-col gap-1">
                      <a
                        href={polyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-[11px] text-foreground hover:text-blue-400 truncate inline-flex items-center gap-1.5"
                        title={trade.campaignTitle || "Unknown Campaign"}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="truncate">
                          {trade.campaignTitle || "Unknown Campaign"}
                        </span>
                        <ExternalLink
                          size={10}
                          className="text-muted-foreground/40 shrink-0"
                        />
                      </a>
                    </div>
                  </td>

                  {/* COUNT */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {trade.bucketGroupTitle || "N/A"}
                    </span>
                  </td>

                  {/* COST BASIS */}
                  <td className="py-3 px-3 text-right">
                    <div className="flex flex-col gap-0.5 items-end">
                      <span className="text-foreground font-medium tabular-nums">
                        ${actualCost.toFixed(2)}
                      </span>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {shares.toFixed(1)} shares
                      </span>
                    </div>
                  </td>

                  {/* PRICE DRIFT */}
                  <td className="py-3 px-3 text-right">
                    <div className="flex items-center justify-end gap-1.5 tabular-nums">
                      <span className="text-muted-foreground">
                        {entryCents}¢
                      </span>
                      <span className="text-muted-foreground/40">→</span>
                      {liveCents !== null ? (
                        <span
                          className={`font-semibold ${liveCents >= entryCents ? "text-emerald-400" : "text-red-400"}`}
                        >
                          {liveCents}¢
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </div>
                  </td>

                  {/* PNL / ROI */}
                  <td className="py-3 px-3 text-right">
                    <div className="flex flex-col items-end gap-0.5">
                      {unrealizedPnl !== null ? (
                        <div className="flex items-center gap-1">
                          <span
                            className={`tabular-nums font-semibold ${unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
                          >
                            {formatPnl(unrealizedPnl)}
                          </span>
                          <span
                            className={`text-[10px] tabular-nums ${unrealizedPnlPct! >= 0 ? "text-emerald-400/60" : "text-red-400/60"}`}
                          >
                            ({unrealizedPnlPct! >= 0 ? "+" : ""}
                            {unrealizedPnlPct!.toFixed(1)}%)
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                      {expectedProfit > 0 && (
                        <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                          Exp: {formatPnl(expectedProfit)}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            } else {
              // SETTLED VIEW
              const realizedPnl = parseFloat(trade.realizedPnl || "0");
              const realizedPnlPct =
                actualCost > 0 ? (realizedPnl / actualCost) * 100 : 0;
              const exitTs = trade.exitTs ? new Date(trade.exitTs) : null;

              const polyUrl = polymarketMarketUrl({
                eventSlug: trade.campaignSlug,
                marketSlug: trade.bucketSlug,
              });

              return (
                <tr
                  key={trade.id}
                  onClick={() => onTradeClick?.(trade)}
                  className={`border-b border-border/5 cursor-pointer transition-colors duration-150 hover:bg-muted/15 ${
                    idx % 2 === 0 ? "bg-transparent" : "bg-card/5"
                  }`}
                >
                  {/* CAMPAIGN */}
                  <td className="py-2.5 px-3 max-w-[200px]">
                    <div className="flex flex-col">
                      <a
                        href={polyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-[11px] text-foreground hover:text-blue-400 truncate inline-flex items-center gap-1.5"
                        title={trade.campaignTitle || "Unknown Campaign"}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="truncate">
                          {trade.campaignTitle || "Unknown Campaign"}
                        </span>
                        <ExternalLink
                          size={10}
                          className="text-muted-foreground/40 shrink-0"
                        />
                      </a>
                    </div>
                  </td>

                  {/* COUNT */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {trade.bucketGroupTitle || "N/A"}
                    </span>
                  </td>

                  {/* RESOLUTION DATE */}
                  <td className="py-3 px-3 text-right">
                    {exitTs ? (
                      <div className="flex flex-col gap-0.5 items-end">
                        <span className="text-foreground tabular-nums text-xs">
                          {exitTs.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                        <span className="text-[10px] text-muted-foreground/60">
                          {exitTs.toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>

                  {/* COST BASIS */}
                  <td className="py-3 px-3 text-right">
                    <span className="text-foreground font-medium tabular-nums">
                      ${actualCost.toFixed(2)}
                    </span>
                  </td>

                  {/* PRICE DRIFT */}
                  <td className="py-3 px-3 text-right">
                    <div className="flex items-center justify-end gap-1.5 tabular-nums">
                      <span className="text-muted-foreground">
                        {entryCents}¢
                      </span>
                      <span className="text-muted-foreground/40">→</span>
                      {trade.exitPrice !== null && trade.exitPrice !== undefined ? (
                        <span
                          className={`font-semibold ${Math.round(parseFloat(trade.exitPrice.toString()) * 100) >= entryCents ? "text-emerald-400" : "text-red-400"}`}
                        >
                          {Math.round(parseFloat(trade.exitPrice.toString()) * 100)}¢
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </div>
                  </td>

                  {/* OUTCOME */}
                  <td className="py-3 px-3 text-right">
                    <span
                      className={`inline-flex rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                        trade.exitOutcome === "WIN"
                          ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                          : trade.exitOutcome === "LOSS"
                            ? "bg-red-500/10 text-red-500 border border-red-500/20"
                            : "bg-muted text-muted-foreground border border-border/30"
                      }`}
                    >
                      {trade.exitOutcome || "SETTLED"}
                    </span>
                  </td>

                  {/* REALIZED PNL */}
                  <td className="py-3 px-3 text-right">
                    <div className="flex flex-col items-end gap-0.5">
                      <span
                        className={`tabular-nums font-semibold ${pnlColor(realizedPnl)}`}
                      >
                        {formatPnl(realizedPnl)}
                      </span>
                      <span
                        className={`text-[10px] tabular-nums ${pnlColor(realizedPnl, "60")}`}
                      >
                        {realizedPnlPct >= 0 ? "+" : ""}
                        {realizedPnlPct.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                </tr>
              );
            }
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
                Loading...
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

// Inline MarketCountdown component for portability
import { useEffect, useState } from "react";

export function MarketCountdown({ endDate }: { endDate: string }) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    const end = new Date(endDate).getTime();

    const update = () => {
      const now = Date.now();
      const diff = end - now;

      if (diff <= 0) {
        setTimeLeft("Resolving...");
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / 1000 / 60) % 60);

      if (days > 0) setTimeLeft(`${days}d ${hours}h`);
      else if (hours > 0) setTimeLeft(`${hours}h ${minutes}m`);
      else setTimeLeft(`${minutes}m`);
    };

    update();
    const timer = setInterval(update, 60000);
    return () => clearInterval(timer);
  }, [endDate]);

  return <span>{timeLeft}</span>;
}
