"use client";

import { useEffect, useState } from "react";
import type { PricePoint } from "@/lib/types";
import { getApiClient } from "@/lib/api-client";
import { PriceChart, ChartLegend } from "./price-chart";

// Minimal bucket shape this panel needs — decoupled from the full bucket type
// so any bucket source can render it.
export interface BucketPanelInfo {
  id: string;
  groupItemTitle: string;
  noPrice: string | null;
  statusLabel?: string;
}

export function BucketHistoryPanel({ bucket }: { bucket: BucketPanelInfo }) {
  const [history, setHistory] = useState<PricePoint[] | null>(null);
  const [recentLow, setRecentLow] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setHistory(null);
      setRecentLow(null);
      setLoading(true);
      try {
        const r = await getApiClient().getPriceHistory({ bucketId: bucket.id });
        if (!cancelled) {
          setHistory(r.history ?? []);
          setRecentLow(r.recentLow ?? null);
        }
      } catch {
        if (!cancelled) setHistory([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bucket.id]);

  return (
    <div className="border-t border-border/10 bg-muted/20 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-foreground font-mono">
            {bucket.groupItemTitle}
          </span>
          {bucket.noPrice && (
            <span className="text-[10px] font-mono tabular-nums text-muted-foreground/70">
              {(parseFloat(bucket.noPrice) * 100).toFixed(1)}¢ NO
            </span>
          )}
        </div>
        {bucket.statusLabel && (
          <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-border/30 text-muted-foreground/70">
            {bucket.statusLabel}
          </span>
        )}
      </div>

      {loading ? (
        <div className="h-[82px] flex items-center justify-center text-[10px] font-mono text-muted-foreground/35">
          loading price history…
        </div>
      ) : history && history.length >= 2 ? (
        <Sparkline history={history} recentLow={recentLow} />
      ) : (
        <div className="h-[82px] flex items-center justify-center text-[10px] font-mono text-muted-foreground/35">
          price history unavailable
        </div>
      )}
    </div>
  );
}

function Sparkline({
  history,
  recentLow,
}: {
  history: PricePoint[];
  recentLow: number | null;
}) {
  const last = history[history.length - 1]!;
  const lowPoint = history.reduce((m, h) => (h.p < m.p ? h : m), history[0]!);
  const pct = (p: number) => `${(p * 100).toFixed(1)}¢`;

  return (
    <div>
      <PriceChart
        history={history}
        height={76}
        markers={[
          {
            t: lowPoint.t,
            p: lowPoint.p,
            className: "fill-amber-400",
            label: "Low",
          },
          { t: last.t, p: last.p, className: "fill-blue-400", label: "Now" },
        ]}
        hlines={[]}
      />
      <ChartLegend
        items={[
          {
            variant: "dot",
            swatchClass: "bg-amber-400",
            label: "Low",
            value: pct(recentLow ?? lowPoint.p),
          },
          {
            variant: "dot",
            swatchClass: "bg-blue-400",
            label: "Now",
            value: pct(last.p),
          },
        ]}
      />
    </div>
  );
}
