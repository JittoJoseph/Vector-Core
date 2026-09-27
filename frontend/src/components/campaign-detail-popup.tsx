import React from "react";
import { ExternalLink, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useCampaignDetails } from "@/lib/hooks";
import type { PositionPnl } from "@/lib/types";
import { cents, formatPnl, pnlColor, timeAgo, utcHour } from "@/lib/utils";

export function CampaignDetailPopup({
  campaignId,
  onClose,
  positionsPnl = {},
}: {
  campaignId: string;
  onClose: () => void;
  positionsPnl?: Record<string, PositionPnl>;
}) {
  const { details, loading } = useCampaignDetails(campaignId);
  const live = details && "buckets" in details ? details : null;
  const closed = details && "trades" in details ? details : null;
  const realizedPnl =
    closed?.trades.reduce((s, t) => s + parseFloat(t.realizedPnl || "0"), 0) ??
    0;

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="w-[calc(100%-2rem)] sm:w-full sm:max-w-[640px] font-mono bg-background border-border/30 flex flex-col max-h-[90dvh] gap-0 p-0 overflow-hidden rounded-xl">
        <div className="shrink-0 px-4 pt-4 pb-3 border-b border-border/20">
          <div className="flex items-start justify-between gap-3">
            <span
              className={`inline-flex items-center text-[10px] font-semibold tracking-[0.15em] px-2 py-0.5 rounded border ${
                closed
                  ? "text-emerald-400 border-emerald-500/25 bg-emerald-500/5"
                  : "text-blue-400 border-blue-400/25 bg-blue-400/5"
              }`}
            >
              {closed ? "RESOLVED" : "ACTIVE"}
            </span>
            <div className="flex items-center gap-0.5 shrink-0 -mr-1 -mt-0.5">
              {details && (
                <a
                  href={`https://polymarket.com/event/${details.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-2 py-1.5 rounded text-[10px] text-muted-foreground/35 hover:text-blue-400 hover:bg-blue-500/5 transition-colors"
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
          <DialogTitle className="mt-3 text-[13px] font-sans font-medium text-foreground/80 leading-relaxed">
            {details?.title ?? "Loading…"}
          </DialogTitle>
          {details && (
            <div className="mt-2 text-[10px] text-muted-foreground/70 tracking-wider uppercase">
              {closed ? "Resolved" : "Day ends"}{" "}
              <span className="text-foreground/90 font-semibold">
                {new Date(
                  closed?.closedTime ?? details.endDate,
                ).toLocaleString()}
              </span>
            </div>
          )}
        </div>

        <div className="overflow-y-auto flex-1 overscroll-contain bg-muted/5 relative">
          {loading && !details && (
            <div className="px-4 py-10 text-center text-xs text-muted-foreground animate-pulse tracking-widest uppercase">
              Loading...
            </div>
          )}

          {details?.forecast && (
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 bg-muted/40 border-b border-border/15">
              <Metric
                label="WN3 MAX"
                value={`${details.forecast.mu.toFixed(1)}° ± ${details.forecast.sigma.toFixed(1)}`}
              />
              <Metric label="RUN" value={utcHour(details.forecast.init)} />
              <Metric
                label="PUBLISHED"
                value={timeAgo(details.forecast.publishedAt)}
              />
              {closed && (
                <Metric
                  label="NET PNL"
                  value={
                    <span className={pnlColor(realizedPnl)}>
                      {formatPnl(realizedPnl)}
                    </span>
                  }
                />
              )}
            </div>
          )}

          {live && (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border/20 text-[9px] tracking-widest text-muted-foreground/60 uppercase">
                  <th className="text-left px-4 py-2 font-bold">Bucket</th>
                  <th className="text-right px-3 py-2 font-bold">Bid / Ask</th>
                  <th className="text-right px-3 py-2 font-bold">WN3</th>
                  <th className="text-right px-3 py-2 font-bold">Edge</th>
                  <th className="text-right px-4 py-2 font-bold">Position</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/10">
                {live.buckets.map((b) => (
                  <tr
                    key={b.id}
                    className={b.positions.length ? "bg-amber-500/5" : ""}
                  >
                    <td className="px-4 py-2 font-semibold text-foreground">
                      {b.title}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {cents(b.bid)} / {cents(b.ask)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-sky-400">
                      {cents(b.model, 1)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums font-bold ${
                        b.edge != null && b.edge >= 0.2
                          ? "text-emerald-400"
                          : "text-muted-foreground/60"
                      }`}
                    >
                      {cents(b.edge)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {b.positions.map((p) => {
                        const pnl = positionsPnl[p.id]?.pnl;
                        return (
                          <div
                            key={p.id}
                            className="flex items-center justify-end gap-2"
                          >
                            <span>
                              {cents(p.entryPrice)}→{cents(p.target)}
                            </span>
                            {pnl != null && (
                              <span className={pnlColor(pnl)}>
                                {formatPnl(pnl, 2)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {closed && (
            <div className="divide-y divide-border/10">
              {closed.trades.length === 0 && (
                <div className="px-4 py-6 text-center text-[10px] text-muted-foreground uppercase tracking-widest">
                  No trades taken.
                </div>
              )}
              {closed.trades.map((t) => {
                const pnl = parseFloat(t.realizedPnl || "0");
                return (
                  <div
                    key={t.id}
                    className="px-4 py-3 flex justify-between items-center text-[10px]"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="font-bold text-xs text-foreground">
                        {t.bucketGroupTitle}
                      </span>
                      <span className="text-muted-foreground uppercase tracking-wider">
                        {t.exitReason ?? "OPEN"}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 tabular-nums">
                      <span>
                        {cents(parseFloat(t.entryPrice))} →{" "}
                        {t.exitPrice ? cents(parseFloat(t.exitPrice)) : "—"}
                      </span>
                      <span className={`font-bold ${pnlColor(pnl)}`}>
                        {formatPnl(pnl, 2)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9px] tracking-widest text-muted-foreground/60 uppercase font-bold">
        {label}
      </span>
      <div className="text-[11px] text-foreground/90 font-medium">{value}</div>
    </div>
  );
}
