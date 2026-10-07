"use client";

import type { TradeHistoryRow } from "@/lib/types";
import {
  formatDuration,
  pnlColor,
  polymarketMarketUrl,
  shortCampaignTitle,
} from "@/lib/utils";
import NumberFlow from "@number-flow/react";
import { ExternalLink } from "lucide-react";
import type { Trade } from "@/lib/types";

const SALE_LABEL: Record<string, string> = {
  PARTIAL_TAKE_PROFIT: "½ TP",
  TAKE_PROFIT: "TP",
  MODEL_EXIT: "MODEL",
  STOP_LOSS: "STOP",
};

export function saleLabel(reason: string, pnl: number): string {
  if (reason === "RESOLUTION") return pnl > 0 ? "WIN" : "LOSS";
  return SALE_LABEL[reason] ?? reason;
}

interface TradeHistoryTableProps {
  rows: TradeHistoryRow[];
  loading: boolean;
  onTradeClick?: (trade: Trade) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
}

export function TradeHistoryTable({
  rows,
  loading,
  onTradeClick,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
}: TradeHistoryTableProps) {
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

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <div className="w-8 h-8 rounded-full border border-border/30 flex items-center justify-center text-muted-foreground/40 text-sm">
          ○
        </div>
        <div className="text-sm text-muted-foreground font-mono">
          No sales yet
        </div>
      </div>
    );
  }

  const headers = [
    "MARKET",
    "SOLD AT",
    "HELD",
    "SHARES",
    "ENTRY → EXIT",
    "EXIT",
    "PNL",
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-border/30">
            {headers.map((h, i) => (
              <th
                key={h}
                className={`py-2.5 px-3 font-medium text-muted-foreground tracking-wider text-[10px] ${i === 0 ? "text-left" : "text-right"}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ exit, trade }, idx) => {
            const pnl = parseFloat(exit.pnl);
            const costBasis = parseFloat(exit.costBasis);
            const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
            const soldAt = new Date(exit.ts);
            const entryCents = Math.round(parseFloat(trade.entryPrice) * 100);
            const exitCents = Math.round(parseFloat(exit.price) * 100);
            const label = saleLabel(exit.reason, pnl);
            return (
              <tr
                key={exit.id}
                onClick={() => onTradeClick?.(trade)}
                className={`border-b border-border/5 cursor-pointer transition-colors duration-150 hover:bg-muted/15 ${
                  idx % 2 === 0 ? "bg-transparent" : "bg-card/5"
                }`}
              >
                <td className="py-3 px-3">
                  <div className="flex flex-col gap-1.5 max-w-[280px]">
                    <a
                      href={polymarketMarketUrl({
                        eventSlug: trade.campaignSlug,
                        marketSlug: trade.bucketSlug,
                      })}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-[12px] text-foreground/90 hover:text-blue-400 truncate inline-flex items-center gap-1 group"
                      title={trade.campaignTitle}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="truncate">
                        {shortCampaignTitle(trade.campaignTitle)}
                      </span>
                      <ExternalLink
                        size={10}
                        className="text-muted-foreground/40 shrink-0 group-hover:text-blue-400/70 transition-colors"
                      />
                    </a>
                    <span className="text-[11px] font-medium text-muted-foreground/80">
                      {trade.bucketGroupTitle}
                    </span>
                  </div>
                </td>

                <td className="py-3 px-3 text-right">
                  <div className="flex flex-col gap-0.5 items-end">
                    <span className="text-foreground tabular-nums text-xs">
                      {soldAt.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60">
                      {soldAt.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </td>

                <td className="py-3 px-3 text-right">
                  <span className="text-foreground/90 tabular-nums font-medium">
                    {formatDuration(trade.entryTs, exit.ts)}
                  </span>
                </td>

                <td className="py-3 px-3 text-right">
                  <div className="flex flex-col gap-0.5 items-end">
                    <span className="text-foreground font-medium tabular-nums">
                      {parseFloat(exit.shares).toFixed(1)}
                    </span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      of {parseFloat(trade.entryShares).toFixed(1)} · $
                      {costBasis.toFixed(2)} cost
                    </span>
                  </div>
                </td>

                <td className="py-3 px-3 text-right">
                  <div className="flex items-center justify-end gap-1.5 tabular-nums">
                    <span className="text-muted-foreground">{entryCents}¢</span>
                    <span className="text-muted-foreground/40">→</span>
                    <span
                      className={`font-semibold ${pnlColor(exitCents - entryCents)}`}
                    >
                      {exitCents}¢
                    </span>
                  </div>
                </td>

                <td className="py-3 px-3 text-right">
                  <span
                    className={`inline-flex rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                      pnl > 0
                        ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                        : "bg-red-500/10 text-red-500 border border-red-500/20"
                    }`}
                  >
                    {label}
                  </span>
                </td>

                <td className="py-3 px-3 text-right">
                  <div className="flex flex-col items-end gap-0.5">
                    <span
                      className={`tabular-nums font-semibold ${pnlColor(pnl)}`}
                    >
                      <NumberFlow
                        value={pnl}
                        format={{
                          style: "currency",
                          currency: "USD",
                          signDisplay: "always",
                          minimumFractionDigits: 4,
                          maximumFractionDigits: 4,
                        }}
                      />
                    </span>
                    <span
                      className={`text-[10px] tabular-nums ${pnlColor(pnl, true)}`}
                    >
                      {pnlPct >= 0 ? "+" : ""}
                      {pnlPct.toFixed(1)}%
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

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
