"use client";

import { useEffect, useState } from "react";
import type { Trade, PositionPnl } from "@/lib/types";
import { formatPnl, pnlColor, polymarketMarketUrl } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ExternalLink, X } from "lucide-react";
import NumberFlow from "@number-flow/react";

interface TradeDetailPopupProps {
  trade: Trade | null;
  open: boolean;
  onClose: () => void;
  positionPnl?: PositionPnl;
}

export function TradeDetailPopup({
  trade,
  open,
  onClose,
  positionPnl,
}: TradeDetailPopupProps) {
  if (!trade) return null;

  const isClosed = trade.status === "SETTLED";
  const entryPrice = parseFloat(trade.entryPrice);
  const entryFees = parseFloat(trade.entryFees || "0");
  const pnl = parseFloat(trade.realizedPnl || "0");
  const exitPrice = trade.exitPrice ? parseFloat(trade.exitPrice) : null;
  const expectedProfit = parseFloat(trade.expectedNetProfit || "0");
  const shares = parseFloat(trade.entryShares);
  const actualCost = parseFloat(trade.actualCost);

  const outcome = trade.exitOutcome;
  const isWin = outcome === "WIN";

  const polyUrl = polymarketMarketUrl({
    eventSlug: trade.campaignSlug,
    marketSlug: trade.bucketSlug,
  });

  const returnPct = actualCost > 0 ? (pnl / actualCost) * 100 : 0;
  const expectedProfitPct =
    actualCost > 0 ? (expectedProfit / actualCost) * 100 : null;

  const statusBadgeCls = !isClosed
    ? "text-blue-400 border-blue-400/25 bg-blue-400/5"
    : isWin
      ? "text-emerald-400 border-emerald-500/25 bg-emerald-500/5"
      : "text-red-400 border-red-500/25 bg-red-500/5";

  const unrealizedPnl = !isClosed ? (positionPnl?.pnl ?? null) : null;
  const unrealizedPnlPct = !isClosed ? (positionPnl?.pnlPct ?? null) : null;
  const minNoPrice = !isClosed
    ? (positionPnl?.minNoPrice ??
      (trade.minNoPriceDuringPosition
        ? parseFloat(trade.minNoPriceDuringPosition)
        : null))
    : trade.minNoPriceDuringPosition
      ? parseFloat(trade.minNoPriceDuringPosition)
      : null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-[calc(100%-2rem)] sm:w-full sm:max-w-[560px] font-mono bg-background border-border/30 flex flex-col max-h-[90dvh] gap-0 p-0 overflow-hidden rounded-xl">
        <div className="shrink-0 px-4 pt-4 pb-3 border-b border-border/20">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className={`inline-flex items-center text-[10px] font-semibold tracking-[0.15em] px-2 py-0.5 rounded border ${statusBadgeCls}`}
              >
                {isClosed ? (outcome ?? "SETTLED") : "OPEN"}
              </span>
              <Chip>BUY NO</Chip>
            </div>

            <div className="flex items-center gap-0.5 shrink-0 -mr-1 -mt-0.5">
              {trade.bucketId && (
                <a
                  href={polyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-2 py-1.5 rounded text-[10px] font-mono text-muted-foreground/35 hover:text-blue-400 hover:bg-blue-500/5 transition-colors"
                >
                  polymarket <ExternalLink size={10} strokeWidth={1.75} />
                </a>
              )}
              <button
                onClick={onClose}
                className="p-1.5 rounded text-muted-foreground/30 hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                <X size={15} strokeWidth={1.75} />
              </button>
            </div>
          </div>

          {trade.campaignTitle ? (
            <DialogTitle className="mt-3 text-[13px] font-sans font-medium text-foreground/80 leading-relaxed">
              {trade.campaignTitle}
            </DialogTitle>
          ) : (
            <DialogTitle className="sr-only">Trade Detail</DialogTitle>
          )}
          {trade.bucketGroupTitle && (
            <div className="mt-2 mb-1 flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-bold">
                  TEMP BUCKET:
                </span>
                <span className="text-[11px] font-semibold text-foreground/90 bg-muted/20 px-2 py-0.5 rounded border border-border/10">
                  {trade.bucketGroupTitle}
                </span>
              </div>
              {trade.modalBucketAtEntry && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-bold">
                    MODAL AT ENTRY:
                  </span>
                  <span className="text-[11px] font-semibold text-foreground/90 bg-muted/20 px-2 py-0.5 rounded border border-border/10">
                    {trade.modalBucketAtEntry}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="overflow-y-auto flex-1 overscroll-contain">
          <Section title="POSITION FINANCIALS">
            <Row2>
              <Cell label="COST BASIS" value={`$${actualCost.toFixed(2)}`} />
              <Cell label="SHARES" value={shares.toFixed(2)} />
              <Cell
                label="ENTRY PRICE"
                value={`${(entryPrice * 100).toFixed(1)}¢`}
              />
              <Cell label="ENTRY FEES" value={`$${entryFees.toFixed(4)}`} />
              <Cell
                label={isClosed ? "EXIT PRICE" : "EXPECTED PNL"}
                value={
                  isClosed ? (
                    exitPrice !== null ? (
                      `${(exitPrice * 100).toFixed(1)}¢`
                    ) : (
                      "—"
                    )
                  ) : expectedProfit !== 0 ? (
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`font-bold tabular-nums tracking-tight ${pnlColor(expectedProfit)}`}
                      >
                        {expectedProfit.toFixed(4)}
                      </span>
                      {expectedProfitPct !== null && (
                        <span
                          className={`text-[10px] tracking-tight tabular-nums font-bold ${pnlColor(expectedProfitPct, true)}`}
                        >
                          ({expectedProfitPct >= 0 ? "+" : ""}
                          {expectedProfitPct.toFixed(1)}%)
                        </span>
                      )}
                    </div>
                  ) : (
                    "—"
                  )
                }
              />
              <Cell
                label={isClosed ? "REALIZED PNL" : "UNREALIZED PNL"}
                value={
                  isClosed ? (
                    <span className={pnlColor(pnl)}>
                      {formatPnl(pnl)} ({returnPct >= 0 ? "+" : ""}
                      {returnPct.toFixed(1)}%)
                    </span>
                  ) : unrealizedPnl !== null ? (
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`font-bold tabular-nums tracking-tight ${pnlColor(unrealizedPnl)}`}
                      >
                        <NumberFlow
                          value={unrealizedPnl}
                          format={{
                            style: "currency",
                            currency: "USD",
                            signDisplay: "always",
                            minimumFractionDigits: 4,
                            maximumFractionDigits: 4,
                          }}
                        />
                      </span>
                      {unrealizedPnlPct !== null && (
                        <span
                          className={`text-[10px] tracking-tight tabular-nums font-bold ${pnlColor(unrealizedPnlPct, true)}`}
                        >
                          ({unrealizedPnlPct >= 0 ? "+" : ""}
                          {unrealizedPnlPct.toFixed(1)}%)
                        </span>
                      )}
                    </div>
                  ) : (
                    "—"
                  )
                }
              />
              {minNoPrice !== null && (
                <Cell
                  label="MIN PRICE (DURING POS)"
                  value={`${(minNoPrice * 100).toFixed(1)}¢`}
                />
              )}
            </Row2>
          </Section>

          {isClosed && outcome && (
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/15 bg-card/10">
              <span className="text-[10px] font-mono tracking-[0.2em] text-muted-foreground/35 uppercase">
                RESULT
              </span>
              <span className="text-muted-foreground/20">/</span>
              <span className="text-zinc-400 text-[11px] font-mono tracking-wider">
                SETTLED
              </span>
              <span className="text-muted-foreground/20">·</span>
              <span
                className={`text-[12px] font-mono font-bold tracking-wider ${isWin ? "text-emerald-400" : "text-red-400"}`}
              >
                {outcome}
              </span>
              {trade.exitReason && (
                <>
                  <span className="text-muted-foreground/20">·</span>
                  <span className="text-[11px] font-mono tracking-wider text-muted-foreground/70">
                    {trade.exitReason}
                  </span>
                </>
              )}
            </div>
          )}

          <Section title="TIMESTAMPS">
            <Row2>
              <Cell label="ENTERED" value={formatTs(trade.entryTs)} />
              <Cell
                label="MARKET DEADLINE"
                value={
                  trade.campaignEndDate ? formatTs(trade.campaignEndDate) : "—"
                }
              />
              <Cell
                label="CLOSED"
                value={trade.exitTs ? formatTs(trade.exitTs) : "—"}
              />
              <Cell
                label="HOLD DURATION"
                value={
                  trade.exitTs ? (
                    formatDuration(trade.entryTs, trade.exitTs)
                  ) : (
                    <LiveHoldDuration entryTs={trade.entryTs} />
                  )
                }
              />
            </Row2>
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LiveHoldDuration({ entryTs }: { entryTs: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return <span>{formatDurationMs(now - new Date(entryTs).getTime())}</span>;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center text-[10px] font-mono font-medium tracking-wider text-muted-foreground/50 border border-border/25 rounded px-1.5 py-0.5 uppercase">
      {children}
    </span>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border/15 last:border-b-0">
      <div className="px-4 pt-3 pb-2">
        <span className="text-[10px] font-mono font-bold tracking-[0.2em] text-muted-foreground/30 uppercase">
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

function Row2({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-border/[0.08]">
      {children}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-4 py-2.5 flex flex-col gap-0.5">
      <span className="text-[9px] font-mono tracking-[0.15em] text-muted-foreground/40 uppercase">
        {label}
      </span>
      <span className="text-[12px] font-mono tabular-nums text-foreground/80 leading-tight">
        {value}
      </span>
    </div>
  );
}

function formatTs(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatDuration(start: string, end: string): string {
  return formatDurationMs(new Date(end).getTime() - new Date(start).getTime());
}

function formatDurationMs(diffMs: number): string {
  const secs = Math.max(0, Math.floor(diffMs / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}
