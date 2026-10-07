"use client";

import { useEffect, useState } from "react";
import type { Trade, PositionPnl } from "@/lib/types";
import { polymarketMarketUrl, pnlColor, shortCampaignTitle } from "@/lib/utils";
import NumberFlow from "@number-flow/react";
import { ExternalLink, Clock } from "lucide-react";

interface TradesTableProps {
  trades: Trade[];
  loading: boolean;
  positionsPnl?: Record<string, PositionPnl>;
  onTradeClick?: (trade: Trade) => void;
}

export function TradesTable({
  trades,
  loading,
  positionsPnl = {},
  onTradeClick,
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
          No open positions
        </div>
      </div>
    );
  }

  const headers = [
    "MARKET",
    "COST BASIS",
    "ENTRY → LIVE → TP",
    "PNL / ROI",
    "TIME LEFT",
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
          {trades.map((trade, idx) => {
            const entryCents = Math.round(parseFloat(trade.entryPrice) * 100);
            const shares = parseFloat(trade.entryShares);
            const sold = parseFloat(trade.sharesSold);
            const held = shares - sold;
            const heldCost =
              shares > 0 ? (parseFloat(trade.actualCost) * held) / shares : 0;
            const polyUrl = polymarketMarketUrl({
              eventSlug: trade.campaignSlug,
              marketSlug: trade.bucketSlug,
            });

            const marketCell = (
              <td className="py-3 px-3">
                <div className="flex flex-col gap-1.5 max-w-[280px]">
                  <a
                    href={polyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-[12px] text-foreground/90 hover:text-blue-400 truncate inline-flex items-center gap-1 group"
                    title={trade.campaignTitle || "Unknown Campaign"}
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
            );

            const rowCls = `border-b border-border/5 cursor-pointer transition-colors duration-150 hover:bg-muted/15 ${
              idx % 2 === 0 ? "bg-transparent" : "bg-card/5"
            }`;

            const pp = positionsPnl[trade.id];
            const liveCents = pp?.mid != null ? Math.round(pp.mid * 100) : null;

            return (
              <tr
                key={trade.id}
                onClick={() => onTradeClick?.(trade)}
                className={rowCls}
              >
                {marketCell}

                <td className="py-3 px-3 text-right">
                  <div className="flex flex-col gap-0.5 items-end">
                    <span className="text-foreground font-medium tabular-nums">
                      ${heldCost.toFixed(2)}
                    </span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {sold > 0
                        ? `${held.toFixed(1)} left of ${shares.toFixed(1)} · ½ sold`
                        : `${shares.toFixed(1)} shares`}
                    </span>
                  </div>
                </td>

                <td className="py-3 px-3 text-right">
                  <div className="flex items-center justify-end gap-1.5 tabular-nums">
                    <span className="text-muted-foreground">{entryCents}¢</span>
                    <span className="text-muted-foreground/40">→</span>
                    {liveCents !== null ? (
                      <span
                        className={`font-semibold ${pnlColor(liveCents - entryCents)}`}
                      >
                        {liveCents}¢
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                    <span className="text-muted-foreground/40">→</span>
                    <span className="text-sky-400">
                      {Math.round(parseFloat(trade.target) * 100)}¢
                    </span>
                  </div>
                </td>

                <td className="py-3 px-3 text-right">
                  <div className="flex flex-col items-end gap-0.5">
                    {pp?.pnl != null ? (
                      <div className="flex items-center gap-1">
                        <span
                          className={`tabular-nums font-semibold ${pnlColor(pp.pnl)}`}
                        >
                          <NumberFlow
                            value={pp.pnl}
                            format={{
                              style: "currency",
                              currency: "USD",
                              signDisplay: "always",
                              minimumFractionDigits: 4,
                              maximumFractionDigits: 4,
                            }}
                          />
                        </span>
                        {pp.pnlPct != null && (
                          <span
                            className={`text-[10px] tabular-nums ${pnlColor(pp.pnlPct, true)}`}
                          >
                            {pp.pnlPct >= 0 ? "+" : ""}
                            {pp.pnlPct.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </div>
                </td>

                <td className="py-3 px-3 text-right">
                  {trade.campaignEndDate ? (
                    <div className="flex items-center justify-end">
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground font-mono text-[11px] font-medium tabular-nums">
                        <Clock size={11} className="text-muted-foreground/50" />
                        <MarketCountdown endDate={trade.campaignEndDate} />
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MarketCountdown({
  endDate,
  showSeconds = false,
}: {
  endDate: string;
  showSeconds?: boolean;
}) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    const end = new Date(endDate).getTime();

    const update = () => {
      const diff = end - Date.now();
      if (diff <= 0) {
        setTimeLeft("Awaiting resolution");
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / 1000 / 60) % 60);
      const seconds = Math.floor((diff / 1000) % 60);

      if (showSeconds) {
        if (days > 0) setTimeLeft(`${days}d ${hours}h ${minutes}m ${seconds}s`);
        else if (hours > 0) setTimeLeft(`${hours}h ${minutes}m ${seconds}s`);
        else if (minutes > 0) setTimeLeft(`${minutes}m ${seconds}s`);
        else setTimeLeft(`${seconds}s`);
      } else {
        const mm = String(minutes).padStart(2, "0");
        if (days > 0) setTimeLeft(`${days}d ${hours}h`);
        else if (hours > 0) setTimeLeft(`${hours}h ${mm}m`);
        else setTimeLeft(`${minutes}m`);
      }
    };

    update();
    const timer = setInterval(update, showSeconds ? 1000 : 60000);
    return () => clearInterval(timer);
  }, [endDate, showSeconds]);

  return <span>{timeLeft}</span>;
}
