import React from "react";
import { ExternalLink, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useCampaignDetails } from "@/lib/hooks";
import type {
  DistributionCampaign,
  SimulatedTrade,
  LiveMarketPrice,
} from "@/lib/types";
import {
  formatPnl,
  pnlColor,
  polymarketMarketUrl,
  calculateTradeUnrealizedPnl,
} from "@/lib/utils";
import NumberFlow from "@number-flow/react";

export function CampaignDetailPopup({
  campaign: initialCampaign,
  onClose,
  livePrices = {},
}: {
  campaign: DistributionCampaign;
  onClose: () => void;
  livePrices?: Record<string, LiveMarketPrice>;
}) {
  const { details: campaign, loading } = useCampaignDetails(initialCampaign.id);

  const displayCampaign = campaign || initialCampaign;
  const isHistorical = !displayCampaign.active;
  const buckets = displayCampaign.relevantBuckets || [];
  const tradesRaw = (displayCampaign as any).historicalTrades;
  const trades = Array.isArray(tradesRaw)
    ? (tradesRaw as SimulatedTrade[])
    : [];

  const totalTrades = Array.isArray(tradesRaw)
    ? trades.length
    : (tradesRaw?.length ?? 0);
  const realizedPnl = Array.isArray(tradesRaw)
    ? trades.reduce((sum, t) => sum + parseFloat(t.realizedPnl || "0"), 0)
    : parseFloat(tradesRaw?.totalPnl || "0");
  const winningTrades = trades.filter(
    (t) => parseFloat(t.realizedPnl || "0") > 0,
  ).length;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

  const statusBadgeCls = !isHistorical
    ? "text-blue-400 border-blue-400/25 bg-blue-400/5"
    : "text-emerald-400 border-emerald-500/25 bg-emerald-500/5";

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="w-[calc(100%-2rem)] sm:w-full sm:max-w-[600px] font-mono bg-background border-border/30 flex flex-col max-h-[90dvh] gap-0 p-0 overflow-hidden rounded-xl">
        <div className="shrink-0 px-4 pt-4 pb-3 border-b border-border/20">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className={`inline-flex items-center text-[10px] font-semibold tracking-[0.15em] px-2 py-0.5 rounded border ${statusBadgeCls}`}
              >
                {!isHistorical ? "ACTIVE" : "RESOLVED"}
              </span>
              {displayCampaign.seriesSlug && (
                <Chip>{displayCampaign.seriesSlug}</Chip>
              )}
            </div>

            <div className="flex items-center gap-0.5 shrink-0 -mr-1 -mt-0.5">
              <a
                href={`https://polymarket.com/event/${displayCampaign.slug}`}
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
            {displayCampaign.title}
          </DialogTitle>

          <div className="mt-2 mb-1 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-bold">
                RESOLUTION:
              </span>
              <span className="text-[11px] font-semibold text-foreground/90 bg-muted/20 px-2 py-0.5 rounded border border-border/10">
                {displayCampaign.endDate
                  ? new Date(displayCampaign.endDate).toLocaleDateString()
                  : "UNKNOWN"}
              </span>
            </div>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 overscroll-contain bg-muted/5 relative">
          {loading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/50 backdrop-blur-sm">
              <span className="text-xs text-muted-foreground animate-pulse tracking-widest uppercase font-bold">
                Loading...
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 bg-muted/40 border-y border-border/15">
            {!isHistorical ? (
              <>
                <Metric
                  label="MODAL TARGET"
                  value={displayCampaign.modalBucketTitle || "—"}
                />
                <Metric
                  label="CANDIDATES"
                  value={displayCampaign.candidateCount?.toString() || "0"}
                />
                <Metric
                  label="TRACKED"
                  value={displayCampaign.trackedCount?.toString() || "0"}
                />
                <Metric
                  label="POSITIONS"
                  value={displayCampaign.positionCount?.toString() || "0"}
                />
              </>
            ) : (
              <>
                <Metric label="TRADES" value={totalTrades.toString()} />
                <Metric label="WIN RATE" value={`${winRate.toFixed(1)}%`} />
                <Metric
                  label="NET PNL"
                  value={
                    <span className={pnlColor(realizedPnl)}>
                      {formatPnl(realizedPnl)}
                    </span>
                  }
                />
              </>
            )}
          </div>

          {!isHistorical ? (
            <>
              <Section title="TRACKED BUCKETS">
                {buckets.length === 0 && !loading ? (
                  <div className="px-4 py-6 text-center text-[10px] text-muted-foreground uppercase tracking-widest">
                    No tracked buckets found.
                  </div>
                ) : (
                  <div className="px-4 py-3 flex flex-wrap gap-2">
                    {buckets.map((b) => {
                      const isModal =
                        b.groupItemTitle === displayCampaign.modalBucketTitle;
                      let bgCls =
                        "bg-muted/40 border-border/20 text-muted-foreground";
                      if (isModal)
                        bgCls =
                          "bg-blue-500/10 border-blue-500/30 text-blue-400 font-bold";
                      if (b.hasOpenPosition)
                        bgCls =
                          "bg-amber-500/10 border-amber-500/40 text-amber-500 font-bold shadow-[0_0_8px_rgba(245,158,11,0.1)]";

                      return (
                        <div
                          key={b.id}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] transition-colors ${bgCls}`}
                        >
                          <span>{b.groupItemTitle}</span>
                          {b.noPrice && (
                            <>
                              <span className="opacity-40">|</span>
                              <span>
                                {Math.round(parseFloat(b.noPrice) * 100)}¢
                              </span>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Section>

              {buckets.some(
                (b) => b.hasOpenPosition && b.positions?.length,
              ) && (
                <Section title="OUR POSITIONS">
                  {buckets
                    .filter((b) => b.hasOpenPosition && b.positions?.length)
                    .map((b) => (
                      <div
                        key={b.id}
                        className="border-t border-border/10 px-4 py-3 hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-foreground">
                              {b.groupItemTitle}
                            </span>
                            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 font-bold border border-amber-500/30">
                              POSITION
                            </span>
                          </div>
                          <div className="text-xs font-bold text-foreground">
                            {b.noPrice
                              ? `${Math.round(parseFloat(b.noPrice) * 100)}¢`
                              : "—"}
                          </div>
                        </div>

                        <div className="mt-2 bg-card border border-border/20 rounded p-2 flex flex-col gap-1.5">
                          {b.positions!.map((pos) => {
                            const livePrice = pos.tokenId
                              ? livePrices[pos.tokenId] || null
                              : null;
                            const { pnl: unPnl, pnlPct: unPnlPct } =
                              calculateTradeUnrealizedPnl(pos, livePrice);
                            const entryPrice = parseFloat(pos.entryPrice);
                            return (
                              <div
                                key={pos.id}
                                className="flex items-center justify-between text-[10px]"
                              >
                                <div className="flex items-center gap-3">
                                  <span className="text-muted-foreground">
                                    SIZE:{" "}
                                    <span className="text-foreground font-bold">
                                      {parseFloat(pos.entryShares).toFixed(2)}
                                    </span>
                                  </span>
                                  <span className="text-muted-foreground">
                                    ENTRY:{" "}
                                    <span className="text-foreground font-bold">
                                      {Math.round(entryPrice * 100)}¢
                                    </span>
                                  </span>
                                </div>
                                {unPnl !== null && (
                                  <div className="flex items-center gap-1.5">
                                    <span
                                      className={`font-bold tabular-nums tracking-tight ${pnlColor(unPnl)}`}
                                    >
                                      <NumberFlow
                                        value={unPnl}
                                        format={{
                                          style: "currency",
                                          currency: "USD",
                                          signDisplay: "always",
                                          minimumFractionDigits: 2,
                                          maximumFractionDigits: 2,
                                        }}
                                      />
                                    </span>
                                    <span
                                      className={`text-[9px] tracking-tight tabular-nums font-bold ${pnlColor(unPnlPct!, "80")}`}
                                    >
                                      ({unPnlPct! >= 0 ? "+" : ""}
                                      {unPnlPct!.toFixed(1)}%)
                                    </span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                </Section>
              )}
            </>
          ) : (
            <Section title="CAMPAIGN TRADES">
              {trades.length === 0 && !loading && (
                <div className="px-4 py-6 text-center text-[10px] text-muted-foreground uppercase tracking-widest">
                  No trades taken.
                </div>
              )}
              {trades.map((t) => {
                const entryPrice = parseFloat(t.entryPrice);
                const exitPrice = t.exitPrice ? parseFloat(t.exitPrice) : null;
                const pnl = parseFloat(t.realizedPnl || "0");
                return (
                  <div
                    key={t.id}
                    className="border-t border-border/10 px-4 py-3 hover:bg-muted/30 transition-colors flex justify-between items-center"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="font-bold text-xs text-foreground">
                        {t.bucketGroupTitle || "Unknown"}
                      </span>
                      <span className="text-[9px] text-muted-foreground uppercase tracking-wider">
                        {new Date(t.entryTs).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-[10px]">
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-muted-foreground font-medium">
                          ENTER
                        </span>
                        <span className="font-bold text-foreground">
                          {Math.round(entryPrice * 100)}¢
                        </span>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-muted-foreground font-medium">
                          EXIT
                        </span>
                        <span className="font-bold text-foreground">
                          {exitPrice !== null
                            ? `${Math.round(exitPrice * 100)}¢`
                            : "—"}
                        </span>
                      </div>
                      <div className="flex flex-col items-end gap-1 ml-2">
                        <span className="text-muted-foreground font-medium">
                          PNL
                        </span>
                        <span
                          className={`font-bold tabular-nums ${pnlColor(pnl)}`}
                        >
                          {pnl > 0 ? "+" : ""}${pnl.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </Section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center text-[9px] font-bold tracking-[0.2em] px-1.5 py-[2px] rounded border border-border/40 text-muted-foreground/80 uppercase">
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
    <div className="mt-4">
      <div className="px-4 py-1.5 border-y border-border/15 bg-card/50">
        <span className="text-[9px] font-mono tracking-[0.25em] text-muted-foreground/40 font-bold uppercase">
          {title}
        </span>
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row2({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-border/10 border-b border-border/10 bg-card/20">
      {children}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-4 py-3 flex flex-col gap-1.5">
      <span className="text-[9px] font-mono tracking-widest text-muted-foreground/60 uppercase font-bold">
        {label}
      </span>
      <div className="text-[12px] font-mono text-foreground/90 font-medium">
        {value}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9px] font-mono tracking-widest text-muted-foreground/60 uppercase font-bold">
        {label}
      </span>
      <div className="text-[11px] font-mono text-foreground/90 font-medium">
        {value}
      </div>
    </div>
  );
}
