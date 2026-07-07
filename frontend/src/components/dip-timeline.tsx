"use client";

import type { PricePoint } from "@/lib/types";
import { PriceChart, ChartLegend, type ChartMarker, type ChartHLine, type ChartVLine } from "./price-chart";

interface DipTimelineProps {
  history: PricePoint[];
  entryTs: string;
  entryPrice: number;
  // Authoritative recovery low (entryGateSnapshot.dip.recentLow). Rendered as a
  // reference level — never recomputed from the curve, so it always agrees with
  // the RECOVERY / RISK section.
  recoveryLow: number | null;
  stopNoPrice: number | null;
  exitTs?: string | null;
  exitPrice?: number | null;
  isClosed: boolean;
  isWin?: boolean;
}

export function DipTimeline({
  history,
  entryTs,
  entryPrice,
  recoveryLow,
  stopNoPrice,
  exitTs,
  exitPrice,
  isClosed,
  isWin,
}: DipTimelineProps) {
  if (!history || history.length < 2) return null;

  const entryT = Date.parse(entryTs) / 1000;
  const exitT = exitTs ? Date.parse(exitTs) / 1000 : null;

  const last = history[history.length - 1]!;
  const endT = exitT ?? last.t;
  const endP = exitPrice != null ? exitPrice : last.p;
  // Static class strings (Tailwind can't see interpolated class names).
  const end = isClosed
    ? isWin
      ? { fill: "fill-emerald-400", bg: "bg-emerald-400" }
      : { fill: "fill-red-400", bg: "bg-red-400" }
    : { fill: "fill-blue-400", bg: "bg-blue-400" };

  const markers: ChartMarker[] = [
    { t: entryT, p: entryPrice, className: "fill-blue-400" },
    { t: endT, p: endP, className: end.fill },
  ];
  const hlines: ChartHLine[] = [
    ...(recoveryLow != null ? [{ p: recoveryLow, className: "stroke-amber-400/50" }] : []),
    ...(stopNoPrice != null ? [{ p: stopNoPrice, className: "stroke-red-400/40" }] : []),
  ];
  const vlines: ChartVLine[] = [{ t: entryT, className: "stroke-blue-400/30" }];

  const pct = (p: number) => `${(p * 100).toFixed(1)}¢`;

  return (
    <div className="px-4 pb-3">
      <PriceChart history={history} height={84} markers={markers} hlines={hlines} vlines={vlines} />
      <ChartLegend
        items={[
          ...(recoveryLow != null
            ? [{ variant: "dash" as const, swatchClass: "border-amber-400/70", label: "Low", value: pct(recoveryLow) }]
            : []),
          { variant: "dot", swatchClass: "bg-blue-400", label: "Entry", value: pct(entryPrice) },
          ...(stopNoPrice != null
            ? [{ variant: "dash" as const, swatchClass: "border-red-400/70", label: "Stop", value: pct(stopNoPrice) }]
            : []),
          {
            variant: "dot",
            swatchClass: end.bg,
            label: isClosed ? "Exit" : "Now",
            value: pct(endP),
          },
        ]}
      />
    </div>
  );
}
