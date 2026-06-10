"use client";

import type { SimulatedTrade } from "@/lib/types";
import { formatPnl, pnlColor, polymarketMarketUrl } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ExternalLink, X } from "lucide-react";

interface TradeDetailPopupProps {
  trade: SimulatedTrade | null;
  open: boolean;
  onClose: () => void;
}

export function TradeDetailPopup({
  trade,
  open,
  onClose,
}: TradeDetailPopupProps) {
  if (!trade) return null;

  const isClosed = trade.status === "SETTLED";
  const entryPrice = parseFloat(trade.entryPrice);
  const entryFees = parseFloat(trade.entryFees || "0");
  const pnl = parseFloat(trade.realizedPnl || "0");
  const exitPrice = trade.exitPrice ? parseFloat(trade.exitPrice) : null;
  const expectedProfit = parseFloat(trade.expectedNetProfit || "0");
  
  const shares = parseFloat(trade.entryShares);
  const budget = parseFloat(trade.positionBudget);
  const actualCost = parseFloat(trade.actualCost);

  const outcome = trade.exitOutcome;
  const isWin = outcome === "WIN";

  const polyUrl = polymarketMarketUrl({
    eventSlug: trade.campaignSlug,
    marketSlug: trade.bucketSlug,
  });

  const resolvedQuestion = trade.campaignTitle ? `${trade.campaignTitle} - ${trade.bucketGroupTitle}` : null;
  const returnPct = actualCost > 0 ? (pnl / actualCost) * 100 : 0;
  const exitReason = trade.exitReason;

  const statusBadgeCls = !isClosed
    ? "text-blue-400 border-blue-400/25 bg-blue-400/5"
    : isWin
      ? "text-emerald-400 border-emerald-500/25 bg-emerald-500/5"
      : "text-red-400 border-red-500/25 bg-red-500/5";

  // Attempt to parse orderbook snapshot if available
  let orderbook: any = null;
  try {
    if (typeof trade.orderbookSnapshot === "string") {
      orderbook = JSON.parse(trade.orderbookSnapshot);
    } else if (trade.orderbookSnapshot) {
      orderbook = trade.orderbookSnapshot;
    }
  } catch (e) {
    // Ignore parse errors
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-[calc(100%-2rem)] sm:w-full sm:max-w-[560px] font-mono bg-background border-border/30 flex flex-col max-h-[90dvh] gap-0 p-0 overflow-hidden rounded-xl">
        {/* ── HEADER ── */}
        <div className="shrink-0 px-4 pt-4 pb-3 border-b border-border/20">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`inline-flex items-center text-[10px] font-semibold tracking-[0.15em] px-2 py-0.5 rounded border ${statusBadgeCls}`}>
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

          {resolvedQuestion ? (
            <DialogTitle className="mt-3 text-[13px] font-sans font-medium text-foreground/80 leading-relaxed">
              {resolvedQuestion}
            </DialogTitle>
          ) : (
            <DialogTitle className="sr-only">Trade Detail</DialogTitle>
          )}
          {trade.campaignTitle && (
            <div className="mt-1 text-[11px] text-muted-foreground/60">{trade.campaignTitle}</div>
          )}
        </div>

        {/* ── SCROLLABLE BODY ── */}
        <div className="overflow-y-auto flex-1 overscroll-contain">
          
          {/* ── FINANCIALS ── */}
          <Section title="POSITION FINANCIALS">
            <Row2>
              <Cell label="COST BASIS" value={`$${actualCost.toFixed(2)}`} />
              <Cell label="SHARES" value={shares.toFixed(2)} />
              <Cell label="ENTRY PRICE" value={`${(entryPrice * 100).toFixed(1)}¢`} />
              <Cell label="ENTRY FEES" value={`$${entryFees.toFixed(4)}`} />
              <Cell 
                label={isClosed ? "EXIT PRICE" : "EXPECTED PNL (IF 100¢)"} 
                value={
                  isClosed 
                    ? (exitPrice !== null ? `${(exitPrice * 100).toFixed(1)}¢` : "—")
                    : (expectedProfit > 0 ? <span className="text-emerald-400">{formatPnl(expectedProfit)}</span> : "—")
                } 
              />
              <Cell 
                label={isClosed ? "REALIZED PNL" : "UNREALIZED PNL"} 
                value={
                  isClosed ? (
                    <span className={pnlColor(pnl)}>
                      {formatPnl(pnl)} ({returnPct >= 0 ? "+" : ""}{returnPct.toFixed(1)}%)
                    </span>
                  ) : "—" // We omit unrealized here as we don't pass live prices to the modal currently
                } 
              />
            </Row2>
          </Section>

          {/* ── ORDERBOOK SNAPSHOT AT ENTRY ── */}
          {orderbook && (
            <Section title="ORDERBOOK AT ENTRY">
              <div className="px-4 py-3 grid grid-cols-2 gap-4 bg-muted/5">
                <div>
                  <div className="text-[10px] text-muted-foreground/50 mb-1">NO BIDS</div>
                  {orderbook.bids && orderbook.bids.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {orderbook.bids.slice(0, 3).map((b: any, i: number) => (
                        <div key={i} className="flex justify-between text-[11px]">
                          <span className="text-emerald-400/80">{parseFloat(b.price).toFixed(3)}</span>
                          <span className="text-muted-foreground/60">{parseFloat(b.size).toFixed(1)} sh</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-muted-foreground/40">Empty</div>
                  )}
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground/50 mb-1">NO ASKS</div>
                  {orderbook.asks && orderbook.asks.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {orderbook.asks.slice(0, 3).map((a: any, i: number) => (
                        <div key={i} className="flex justify-between text-[11px]">
                          <span className="text-red-400/80">{parseFloat(a.price).toFixed(3)}</span>
                          <span className="text-muted-foreground/60">{parseFloat(a.size).toFixed(1)} sh</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-muted-foreground/40">Empty</div>
                  )}
                </div>
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
              <span className={`text-[12px] font-mono font-bold tracking-wider ${isWin ? "text-emerald-400" : "text-red-400"}`}>
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

          {/* ── TIMESTAMPS ── */}
          <Section title="TIMESTAMPS">
            <Row2>
              <Cell label="ENTERED" value={formatTs(trade.entryTs)} />
              <Cell label="MARKET DEADLINE" value={trade.campaignEndDate ? formatTs(trade.campaignEndDate) : "—"} />
              <Cell label="CLOSED" value={trade.exitTs ? formatTs(trade.exitTs) : "—"} />
              <Cell label="HOLD DURATION" value={trade.exitTs ? formatDuration(trade.entryTs, trade.exitTs) : "—"} />
            </Row2>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
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

/* ─────────────── Formatters ─────────────── */

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
