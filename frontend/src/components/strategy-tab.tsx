"use client";

import { useState } from "react";
import type {
  StrategyView,
  StrategyCampaign,
  StrategyBucket,
  ScanTelemetry,
} from "@/lib/types";
import { shortCampaignTitle } from "@/lib/utils";
import { BucketHistoryPanel } from "./bucket-history-panel";

// Shared reason vocabulary + colors for the funnel and bucket statuses.
const REASONS: { key: keyof ScanTelemetry["rejected"]; label: string; text: string; bar: string }[] = [
  { key: "band", label: "Band", text: "text-zinc-400", bar: "bg-zinc-500/70" },
  { key: "age", label: "Age", text: "text-sky-400", bar: "bg-sky-500/70" },
  { key: "tail", label: "Tail", text: "text-violet-400", bar: "bg-violet-500/70" },
  { key: "margin", label: "Margin", text: "text-amber-400", bar: "bg-amber-500/70" },
  { key: "recovery", label: "Recovery", text: "text-orange-400", bar: "bg-orange-500/70" },
  { key: "other", label: "Other", text: "text-zinc-500", bar: "bg-zinc-600/70" },
];

const STATUS_COLOR: Record<StrategyBucket["status"], string> = {
  eligible: "bg-emerald-500/15 border-emerald-500/40 text-emerald-400",
  held: "bg-amber-500/15 border-amber-500/40 text-amber-400",
  band: "bg-zinc-500/10 border-zinc-500/30 text-zinc-400",
  age: "bg-sky-500/10 border-sky-500/30 text-sky-400",
  tail: "bg-violet-500/10 border-violet-500/30 text-violet-400",
  margin: "bg-amber-500/10 border-amber-500/30 text-amber-400",
};

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}

export function StrategyTab({
  view,
  loading,
}: {
  view: StrategyView | null;
  loading: boolean;
}) {
  if (!view && loading) {
    return (
      <div className="p-8 text-center text-[11px] font-mono text-muted-foreground/40 uppercase tracking-widest">
        Loading strategy view…
      </div>
    );
  }
  const scan = view?.lastScan;
  const campaigns = view?.campaigns ?? [];

  return (
    <div className="flex flex-col">
      {scan && <DecisionFunnel scan={scan} />}

      <div className="px-4 py-3 border-b border-border/20 bg-card/30">
        <span className="text-[10px] font-mono font-bold tracking-[0.2em] text-muted-foreground/40 uppercase">
          What the engine sees
        </span>
      </div>

      {campaigns.length === 0 ? (
        <div className="p-8 text-center text-[11px] font-mono text-muted-foreground/40 uppercase tracking-widest">
          No active campaigns.
        </div>
      ) : (
        campaigns.map((c) => <CampaignRow key={c.id} campaign={c} />)
      )}
    </div>
  );
}

function DecisionFunnel({ scan }: { scan: ScanTelemetry }) {
  const totalRejected = REASONS.reduce((s, r) => s + scan.rejected[r.key], 0);
  const active = REASONS.map((r) => ({ ...r, n: scan.rejected[r.key] })).filter((r) => r.n > 0);
  // Bar segments across the in-band population: each rejection reason + entered.
  const denom = Math.max(1, scan.inBand);

  return (
    <div className="px-4 py-4 border-b border-border/20 bg-muted/10">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-mono font-bold tracking-[0.2em] text-muted-foreground/40 uppercase">
          Decision Flow
        </span>
        {scan.scanAt != null && (
          <span className="text-[10px] font-mono text-muted-foreground/40 tabular-nums">
            last scan {ago(scan.scanAt)}
          </span>
        )}
      </div>

      {/* Headline funnel numbers */}
      <div className="flex items-center gap-2 text-[11px] font-mono mb-3 flex-wrap">
        <FunnelStat n={scan.candidates} label="candidates" />
        <Arrow />
        <FunnelStat n={scan.inBand} label="in band" />
        <Arrow />
        <FunnelStat n={totalRejected} label="rejected" tone="text-muted-foreground/60" />
        <Arrow />
        <FunnelStat
          n={scan.entered}
          label="entered"
          tone={scan.entered > 0 ? "text-emerald-400" : "text-muted-foreground/40"}
        />
      </div>

      {/* Segmented bar of the in-band population by outcome */}
      <div className="h-2 w-full rounded-full overflow-hidden flex bg-muted/30">
        {active.map((r) => (
          <div
            key={r.key}
            className={r.bar}
            style={{ width: `${(r.n / denom) * 100}%` }}
            title={`${r.label}: ${r.n}`}
          />
        ))}
        {scan.entered > 0 && (
          <div className="bg-emerald-500/80" style={{ width: `${(scan.entered / denom) * 100}%` }} title={`Entered: ${scan.entered}`} />
        )}
      </div>

      {/* Reason legend */}
      <div className="flex items-center gap-x-4 gap-y-1 mt-2 flex-wrap">
        {active.map((r) => (
          <span key={r.key} className="flex items-center gap-1 text-[10px] font-mono">
            <span className={`inline-block w-2 h-2 rounded-sm ${r.bar}`} />
            <span className="text-muted-foreground/50">{r.label}</span>
            <span className={`tabular-nums font-semibold ${r.text}`}>{r.n}</span>
          </span>
        ))}
        {active.length === 0 && (
          <span className="text-[10px] font-mono text-muted-foreground/40">
            {scan.inBand === 0 ? "no candidates in the entry band this scan" : "all in-band candidates cleared the gates"}
          </span>
        )}
      </div>
    </div>
  );
}

function CampaignRow({ campaign }: { campaign: StrategyCampaign }) {
  const [openBucketId, setOpenBucketId] = useState<string | null>(null);
  const eligible = campaign.buckets.filter((b) => b.status === "eligible").length;

  return (
    <div className="border-b border-border/15">
      <div className="px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-mono font-semibold text-foreground/80 truncate">
            {shortCampaignTitle(campaign.title)}
          </span>
          {campaign.modalBucketTitle && (
            <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/45 shrink-0">
              modal {campaign.modalBucketTitle}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0 text-[10px] font-mono tabular-nums">
          <span className="text-muted-foreground/50">{campaign.inBand} in-band</span>
          {eligible > 0 && (
            <span className="text-emerald-400 font-semibold">{eligible} eligible</span>
          )}
        </div>
      </div>

      {/* Candidate-bucket ladder, colored by gate status */}
      <div className="px-4 pb-3 flex flex-wrap gap-1.5">
        {campaign.buckets.length === 0 ? (
          <span className="text-[10px] font-mono text-muted-foreground/35">
            no candidate buckets
          </span>
        ) : (
          campaign.buckets.map((b) => {
            const isOpen = b.id === openBucketId;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => setOpenBucketId(isOpen ? null : b.id)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-mono transition-colors cursor-pointer hover:brightness-125 ${STATUS_COLOR[b.status]} ${isOpen ? "ring-1 ring-foreground/40" : ""}`}
                title={b.status}
              >
                <span className="font-semibold">{b.groupItemTitle}</span>
                {b.noPrice && (
                  <span className="opacity-70 tabular-nums">
                    {(parseFloat(b.noPrice) * 100).toFixed(0)}¢
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      {openBucketId &&
        (() => {
          const sel = campaign.buckets.find((b) => b.id === openBucketId);
          return sel ? (
            <BucketHistoryPanel
              bucket={{
                id: sel.id,
                groupItemTitle: sel.groupItemTitle,
                noPrice: sel.noPrice,
                gateStatus: sel.status,
                gateMetrics: sel.gateMetrics,
              }}
            />
          ) : null;
        })()}
    </div>
  );
}

function FunnelStat({ n, label, tone = "text-foreground/80" }: { n: number; label: string; tone?: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className={`text-[15px] font-bold tabular-nums ${tone}`}>{n}</span>
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground/45">{label}</span>
    </span>
  );
}

function Arrow() {
  return <span className="text-muted-foreground/25">→</span>;
}
