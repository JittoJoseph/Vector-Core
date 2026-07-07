"use client";

import { useEffect, useState } from "react";
import type { PricePoint } from "@/lib/types";
import { getApiClient } from "@/lib/api-client";
import { PriceChart, ChartLegend } from "./price-chart";

// Minimal bucket shape this panel needs — decoupled from the full bucket type
// so any candidate-bucket source can render it.
export interface BucketPanelInfo {
  id: string;
  groupItemTitle: string;
  noPrice: string | null;
  gateStatus?: string | null;
  gateMetrics?: {
    campaignAgeFraction: number | null;
    bucketDistance: number;
    tailYesMass: number;
    modalMargin: number;
  } | null;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  eligible: { label: "ELIGIBLE — awaiting recovery", cls: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5" },
  band: { label: "OUT OF BAND", cls: "text-zinc-400 border-zinc-500/30 bg-zinc-500/5" },
  age: { label: "BLOCKED — campaign too young", cls: "text-sky-400 border-sky-500/30 bg-sky-500/5" },
  tail: { label: "BLOCKED — tail mass", cls: "text-violet-400 border-violet-500/30 bg-violet-500/5" },
  margin: { label: "BLOCKED — modal margin", cls: "text-amber-400 border-amber-500/30 bg-amber-500/5" },
};

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

  const status = bucket.gateStatus ? STATUS_META[bucket.gateStatus] : null;
  const gm = bucket.gateMetrics;

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
        {status && (
          <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${status.cls}`}>
            {status.label}
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

      {gm && (
        <div className="flex items-center gap-3 mt-2 flex-wrap text-[9px] font-mono">
          <Gm label="TAIL" value={`${(gm.tailYesMass * 100).toFixed(1)}%`} />
          <Gm label="MARGIN" value={`${(gm.modalMargin * 100).toFixed(1)}¢`} />
          <Gm label="DIST" value={`${gm.bucketDistance} bkt`} />
          <Gm
            label="AGE"
            value={gm.campaignAgeFraction != null ? `${(gm.campaignAgeFraction * 100).toFixed(0)}%` : "—"}
          />
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
          { t: lowPoint.t, p: lowPoint.p, className: "fill-amber-400", label: "Low" },
          { t: last.t, p: last.p, className: "fill-blue-400", label: "Now" }
        ]}
        hlines={[]}
      />
      <ChartLegend
        items={[
          { variant: "dot", swatchClass: "bg-amber-400", label: "Low", value: pct(recentLow ?? lowPoint.p) },
          { variant: "dot", swatchClass: "bg-blue-400", label: "Now", value: pct(last.p) },
        ]}
      />
    </div>
  );
}

function Gm({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-muted-foreground/40 uppercase">{label}</span>
      <span className="text-foreground/70 tabular-nums">{value}</span>
    </span>
  );
}
