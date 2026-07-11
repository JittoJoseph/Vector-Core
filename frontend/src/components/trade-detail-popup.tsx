"use client";

import { useEffect, useState } from "react";
import type { SimulatedTrade, LiveMarketPrice, PricePoint } from "@/lib/types";
import {
  formatPnl,
  polymarketMarketUrl,
  calculateTradeUnrealizedPnl,
} from "@/lib/utils";
import { getApiClient } from "@/lib/api-client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ExternalLink, X } from "lucide-react";
import NumberFlow from "@number-flow/react";
import { DipTimeline } from "./dip-timeline";

interface TradeDetailPopupProps {
  trade: SimulatedTrade | null;
  open: boolean;
  onClose: () => void;
  livePrice?: LiveMarketPrice;
}

export function TradeDetailPopup({
  trade,
  open,
  onClose,
  livePrice,
}: TradeDetailPopupProps) {
  const tradeId = trade?.id;
  const [history, setHistory] = useState<PricePoint[] | null>(null);
  const [histLoading, setHistLoading] = useState(false);

  // Lazily fetch the price curve once the popup opens.
  useEffect(() => {
    if (!open || !tradeId) return;
    let cancelled = false;
    (async () => {
      setHistory(null);
      setHistLoading(true);
      try {
        const r = await getApiClient().getPriceHistory({ tradeId });
        if (!cancelled) setHistory(r.history ?? []);
      } catch {
        if (!cancelled) setHistory([]);
      } finally {
        if (!cancelled) setHistLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tradeId]);

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
  const exitReason = trade.exitReason;

  const rv = trade.recoveryRisk ?? null;
  const stopFloor = trade.stopFloor ? parseFloat(trade.stopFloor) : null;
  const minPrice = trade.minNoPriceDuringPosition
    ? parseFloat(trade.minNoPriceDuringPosition)
    : null;

  const statusBadgeCls = !isClosed
    ? "text-blue-400 border-blue-400/25 bg-blue-400/5"
    : isWin
      ? "text-emerald-400 border-emerald-500/25 bg-emerald-500/5"
      : "text-red-400 border-red-500/25 bg-red-500/5";

  const { pnl: unrealizedPnl, pnlPct: unrealizedPnlPct } = !isClosed
    ? calculateTradeUnrealizedPnl(trade, livePrice || null)
    : { pnl: null, pnlPct: null };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-[calc(100%-2rem)] sm:w-full sm:max-w-[560px] font-mono bg-background border-border/30 flex flex-col max-h-[90dvh] gap-0 p-0 overflow-hidden rounded-xl">
        {/* ── HEADER ── */}
        <div className="shrink-0 px-4 pt-4 pb-3 border-b border-border/20">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className={`inline-flex items-center text-[10px] font-semibold tracking-[0.15em] px-2 py-0.5 rounded border ${statusBadgeCls}`}
              >
                {isClosed ? (outcome ?? "SETTLED") : "OPEN"}
              </span>
              <Chip>{trade.side}</Chip>
              {trade.orderType && <Chip>{trade.orderType}</Chip>}
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
                  COUNT BUCKET:
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

        {/* ── SCROLLABLE BODY ── */}
        <div className="overflow-y-auto flex-1 overscroll-contain">
          <Section title="POSITION FINANCIALS">
            <div className="px-4 pt-1 pb-3 space-y-2">
              <StatGroup label="POSITION">
                <Stat
                  label="ENTRY"
                  value={`${(entryPrice * 100).toFixed(1)}¢`}
                  emphasis
                />
                <Stat label="COST" value={`$${actualCost.toFixed(2)}`} />
                <Stat label="SHARES" value={shares.toFixed(1)} tone="muted" />
                <Stat
                  label="FEES"
                  value={`$${entryFees.toFixed(3)}`}
                  tone="muted"
                />
                <Stat
                  label="MIN HELD"
                  value={
                    minPrice !== null
                      ? `${(minPrice * 100).toFixed(1)}¢`
                      : "—"
                  }
                  tone="muted"
                />
              </StatGroup>

              <StatGroup label="P&L">
                {isClosed ? (
                  <>
                    <Stat
                      label="EXIT"
                      value={
                        exitPrice !== null
                          ? `${(exitPrice * 100).toFixed(1)}¢`
                          : "—"
                      }
                    />
                    <Stat
                      label="REALIZED"
                      value={`${formatPnl(pnl)} (${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(1)}%)`}
                      tone={pnl >= 0 ? "positive" : "negative"}
                      emphasis
                    />
                    <Stat
                      label="EXP @100¢"
                      value={
                        expectedProfit > 0 ? (
                          <span className="inline-flex items-baseline gap-1">
                            <span className="font-semibold">{formatPnl(expectedProfit)}</span>
                            <span className="text-[9px] opacity-70">
                              (+{((expectedProfit / actualCost) * 100).toFixed(1)}%)
                            </span>
                          </span>
                        ) : (
                          "—"
                        )
                      }
                      tone="muted"
                    />
                  </>
                ) : (
                  <>
                    <Stat
                      label="EXP @100¢"
                      value={
                        expectedProfit > 0 ? (
                          <span className="inline-flex items-baseline gap-1">
                            <span className="font-semibold">{formatPnl(expectedProfit)}</span>
                            <span className="text-[9px] opacity-70">
                              (+{((expectedProfit / actualCost) * 100).toFixed(1)}%)
                            </span>
                          </span>
                        ) : (
                          "—"
                        )
                      }
                      tone="positive"
                    />
                    <Stat
                      label="UNREALIZED"
                      tone={
                        unrealizedPnl != null && unrealizedPnl < 0
                          ? "negative"
                          : "positive"
                      }
                      emphasis
                      value={
                        unrealizedPnl !== null ? (
                          <span className="inline-flex items-baseline gap-1">
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
                            <span className="text-[9px] opacity-70">
                              ({unrealizedPnlPct! >= 0 ? "+" : ""}
                              {unrealizedPnlPct!.toFixed(1)}%)
                            </span>
                          </span>
                        ) : (
                          "—"
                        )
                      }
                    />
                  </>
                )}
              </StatGroup>
            </div>
          </Section>

          {rv && (
            <Section title="DIP TIMELINE">
              {histLoading ? (
                <TimelinePlaceholder text="loading price history…" />
              ) : history && history.length >= 2 ? (
                <DipTimeline
                  history={history}
                  entryTs={trade.entryTs}
                  entryPrice={entryPrice}
                  recoveryLow={rv.recentLow}
                  stopFloor={stopFloor}
                  exitTs={isClosed ? trade.exitTs : null}
                  exitPrice={isClosed ? exitPrice : null}
                  isClosed={isClosed}
                  isWin={isWin}
                />
              ) : (
                <TimelinePlaceholder text="price history unavailable" />
              )}
            </Section>
          )}

          {(rv || stopFloor !== null) && (
            <Section title="RECOVERY / RISK">
              <div className="px-4 pt-1 pb-3 space-y-2">
                {rv && (
                  <StatGroup label="RECOVERY">
                    <Stat
                      label="LOW"
                      value={`${(rv.recentLow * 100).toFixed(1)}¢`}
                      tone="warning"
                      emphasis
                    />
                    <Stat
                      label="ABOVE LOW"
                      value={signedCents(rv.aboveLow)}
                      tone={rv.aboveLow < 0 ? "negative" : "positive"}
                      emphasis
                    />
                    <Stat
                      label="RISING"
                      value={rv.rising ? "Yes" : "No"}
                      tone={rv.rising ? "positive" : "muted"}
                    />
                  </StatGroup>
                )}

                <StatGroup label="RISK">
                  <Stat
                    label="R:R"
                    value={rv != null ? `${rv.riskReward.toFixed(2)}×` : "—"}
                    tone={
                      rv != null && rv.riskReward >= 1.1
                        ? "positive"
                        : "negative"
                    }
                    emphasis
                  />
                  <Stat
                    label="STOP FLOOR"
                    value={
                      stopFloor !== null
                        ? `${(stopFloor * 100).toFixed(1)}¢`
                        : "—"
                    }
                    tone="muted"
                  />
                </StatGroup>
              </div>
            </Section>
          )}

          {/* ── RESOLUTION & RESULT (only if settled) ── */}
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
              {exitReason && (
                <>
                  <span className="text-muted-foreground/20">·</span>
                  <span className="text-[11px] font-mono tracking-wider text-muted-foreground/70">
                    {exitReason}
                  </span>
                </>
              )}
            </div>
          )}

          <Section title="TIMESTAMPS">
            <div className="px-4 pt-1 pb-3 space-y-2">
              <StatGroup label="ENTRY">
                <Stat label="ENTERED" value={formatTs(trade.entryTs)} />
                <Stat
                  label="DEADLINE"
                  value={
                    trade.campaignEndDate
                      ? formatTs(trade.campaignEndDate)
                      : "—"
                  }
                  tone="muted"
                />
              </StatGroup>
              <StatGroup label="EXIT">
                <Stat
                  label="CLOSED"
                  value={trade.exitTs ? formatTs(trade.exitTs) : "—"}
                  tone="muted"
                />
                <Stat
                  label="HELD"
                  value={
                    trade.exitTs
                      ? formatDuration(trade.entryTs, trade.exitTs)
                      : "—"
                  }
                  tone="muted"
                />
              </StatGroup>
            </div>
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────── Primitives ─────────────── */

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

function TimelinePlaceholder({ text }: { text: string }) {
  return (
    <div className="px-4 pb-3 h-[88px] flex items-center justify-center">
      <span className="text-[10px] font-mono tracking-wide text-muted-foreground/35">
        {text}
      </span>
    </div>
  );
}

function StatGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="w-14 shrink-0 pt-0.5 text-[8px] font-mono font-bold uppercase tracking-[0.15em] text-muted-foreground/25">
        {label}
      </span>
      <div className="flex-1 grid grid-cols-3 sm:grid-cols-4 gap-x-3 gap-y-1.5 min-w-0">
        {children}
      </div>
    </div>
  );
}

const STAT_TONE_CLS = {
  default: "text-foreground/85",
  positive: "text-emerald-400",
  negative: "text-red-400",
  warning: "text-amber-400",
  muted: "text-muted-foreground/70",
} as const;

function Stat({
  label,
  value,
  tone = "default",
  emphasis = false,
}: {
  label: string;
  value: React.ReactNode;
  tone?: keyof typeof STAT_TONE_CLS;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[8.5px] font-mono uppercase tracking-wide text-muted-foreground/40 truncate">
        {label}
      </span>
      <span
        className={`font-mono tabular-nums leading-none ${emphasis ? "text-[13px] font-bold" : "text-[11px] font-semibold"} ${STAT_TONE_CLS[tone]}`}
      >
        {value}
      </span>
    </div>
  );
}

/* ─────────────── Formatters ─────────────── */

function signedCents(delta: number): string {
  const c = delta * 100;
  return `${c >= 0 ? "+" : ""}${c.toFixed(1)}¢`;
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
  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}
