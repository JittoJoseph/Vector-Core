"use client";

import { useEffect, useState } from "react";
import type { Trade, PositionPnl } from "@/lib/types";
import {
  cents,
  formatDuration,
  formatDurationMs,
  formatPnl,
  pnlColor,
  polymarketMarketUrl,
  utcHour,
} from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ExternalLink, X } from "lucide-react";
import { saleLabel } from "./trade-history-table";
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
  const pnl = parseFloat(trade.realizedPnl || "0");
  const exitPrice = trade.exitPrice ? parseFloat(trade.exitPrice) : null;
  const actualCost = parseFloat(trade.actualCost);
  const isWin = trade.exitOutcome === "WIN";
  const returnPct = actualCost > 0 ? (pnl / actualCost) * 100 : 0;
  const unrealizedPnl = !isClosed ? (positionPnl?.pnl ?? null) : null;
  const unrealizedPnlPct = !isClosed ? (positionPnl?.pnlPct ?? null) : null;
  const minPrice =
    (!isClosed ? positionPnl?.minPrice : null) ??
    (trade.minPriceDuringPosition
      ? parseFloat(trade.minPriceDuringPosition)
      : null);
  const signal = trade.signal;

  const statusBadgeCls = !isClosed
    ? "text-blue-400 border-blue-400/25 bg-blue-400/5"
    : isWin
      ? "text-emerald-400 border-emerald-500/25 bg-emerald-500/5"
      : "text-red-400 border-red-500/25 bg-red-500/5";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-[calc(100%-2rem)] sm:w-full sm:max-w-[560px] font-mono bg-background border-border/30 flex flex-col max-h-[90dvh] gap-0 p-0 overflow-hidden rounded-xl">
        <div className="shrink-0 px-4 pt-4 pb-3 border-b border-border/20">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className={`inline-flex items-center text-[10px] font-semibold tracking-[0.15em] px-2 py-0.5 rounded border ${statusBadgeCls}`}
              >
                {isClosed ? (trade.exitOutcome ?? "SETTLED") : "OPEN"}
              </span>
              <Chip>BUY YES</Chip>
            </div>
            <div className="flex items-center gap-0.5 shrink-0 -mr-1 -mt-0.5">
              <a
                href={polymarketMarketUrl({
                  eventSlug: trade.campaignSlug,
                  marketSlug: trade.bucketSlug,
                })}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-2 py-1.5 rounded text-[10px] font-mono text-muted-foreground/35 hover:text-blue-400 hover:bg-blue-500/5 transition-colors"
              >
                polymarket <ExternalLink size={10} strokeWidth={1.75} />
              </a>
              <button
                onClick={onClose}
                className="p-1.5 rounded text-muted-foreground/30 hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                <X size={15} strokeWidth={1.75} />
              </button>
            </div>
          </div>
          <DialogTitle className="mt-3 text-[13px] font-sans font-medium text-foreground/80 leading-relaxed">
            {trade.campaignTitle}
          </DialogTitle>
          <div className="mt-2 mb-1 flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-bold">
              TEMP BUCKET:
            </span>
            <span className="text-[11px] font-semibold text-foreground/90 bg-muted/20 px-2 py-0.5 rounded border border-border/10">
              {trade.bucketGroupTitle}
            </span>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 overscroll-contain">
          <Section title="POSITION FINANCIALS">
            <Row2>
              <Cell label="COST BASIS" value={`$${actualCost.toFixed(2)}`} />
              <Cell
                label="SHARES"
                value={parseFloat(trade.entryShares).toFixed(2)}
              />
              <Cell
                label="ENTRY PRICE"
                value={cents(parseFloat(trade.entryPrice), 1)}
              />
              <Cell
                label="ENTRY FEES"
                value={`$${parseFloat(trade.entryFees || "0").toFixed(4)}`}
              />
              <Cell
                label="PARTIAL TP SOLD"
                value={
                  parseFloat(trade.sharesSold) > 0
                    ? `${parseFloat(trade.sharesSold).toFixed(2)} shares`
                    : "—"
                }
              />
              <Cell
                label={isClosed ? "EXIT PRICE" : "TAKE PROFIT AT"}
                value={
                  isClosed
                    ? cents(exitPrice, 1)
                    : cents(parseFloat(trade.target), 1)
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
              {minPrice !== null && (
                <Cell label="MIN BID (DURING POS)" value={cents(minPrice, 1)} />
              )}
            </Row2>
          </Section>

          {(trade.exits?.length ?? 0) > 0 && (
            <Section title="SALES">
              <div className="flex flex-col gap-1.5">
                {trade.exits!.map((e) => {
                  const salePnl = parseFloat(e.pnl);
                  return (
                    <div
                      key={e.id}
                      className="flex items-center justify-between text-[11px] tabular-nums"
                    >
                      <span className="text-muted-foreground">
                        {formatTs(e.ts)}
                      </span>
                      <span className="text-foreground/80">
                        {saleLabel(e.reason, salePnl)} ·{" "}
                        {parseFloat(e.shares).toFixed(1)} @{" "}
                        {cents(parseFloat(e.price), 1)}
                      </span>
                      <span className={pnlColor(salePnl)}>
                        {salePnl >= 0 ? "+" : ""}${salePnl.toFixed(4)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          <Section title="WEATHERNEXT SIGNAL">
            <Row2>
              <Cell label="MODEL PROB" value={cents(signal.pModel, 1)} />
              <Cell label="QUOTE AT SIGNAL" value={cents(signal.quote, 1)} />
              <Cell label="EDGE AFTER FEES" value={cents(signal.edge, 1)} />
              <Cell
                label="HOURS TO DAY START"
                value={`${signal.leadH.toFixed(1)}h`}
              />
              <Cell label="RUN" value={utcHour(signal.init)} />
            </Row2>
          </Section>

          {isClosed && (
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/15 bg-card/10">
              <span className="text-[10px] font-mono tracking-[0.2em] text-muted-foreground/35 uppercase">
                RESULT
              </span>
              <span className="text-muted-foreground/20">/</span>
              <span
                className={`text-[12px] font-mono font-bold tracking-wider ${isWin ? "text-emerald-400" : "text-red-400"}`}
              >
                {trade.exitOutcome}
              </span>
              <span className="text-muted-foreground/20">·</span>
              <span className="text-[11px] font-mono tracking-wider text-muted-foreground/70">
                {trade.exitReason}
              </span>
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
