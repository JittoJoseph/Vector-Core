"use client";

import type { PricePoint } from "@/lib/types";
import {
  PriceChart,
  ChartLegend,
  type ChartMarker,
  type ChartHLine,
  type ChartVLine,
} from "./price-chart";

interface DipTimelineProps {
  history: PricePoint[];
  entryTs: string;
  entryPrice: number;

  recoveryLow: number | null;
  stopFloor: number | null;
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
  stopFloor,
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

  const preEntry = history.filter((h) => h.t <= entryT);
  const lowSource = preEntry.length ? preEntry : history;
  const lowPoint = lowSource.reduce(
    (m, h) => (h.p < m.p ? h : m),
    lowSource[0]!,
  );

  const markers: ChartMarker[] = [
    { t: lowPoint.t, p: lowPoint.p, className: "fill-amber-400", label: "Low" },
    { t: entryT, p: entryPrice, className: "fill-purple-400", label: "Entry" },
    {
      t: endT,
      p: endP,
      className: end.fill,
      label: isClosed ? (isWin ? "Win" : "Loss") : "Now",
    },
  ];
  const hlines: ChartHLine[] = [
    ...(stopFloor != null
      ? [{ p: stopFloor, className: "stroke-red-400/40" }]
      : []),
  ];
  const vlines: ChartVLine[] = [
    { t: entryT, className: "stroke-purple-400/30" },
  ];

  const pct = (p: number) => `${(p * 100).toFixed(1)}¢`;

  return (
    <div className="px-4 pb-3">
      <PriceChart
        history={history}
        height={84}
        markers={markers}
        hlines={hlines}
        vlines={vlines}
      />
      <ChartLegend
        items={[
          {
            variant: "dot",
            swatchClass: "bg-amber-400",
            label: "Low",
            value: pct(recoveryLow ?? lowPoint.p),
          },
          {
            variant: "dot",
            swatchClass: "bg-purple-400",
            label: "Entry",
            value: pct(entryPrice),
          },
          ...(stopFloor != null
            ? [
                {
                  variant: "dash" as const,
                  swatchClass: "border-red-400/70",
                  label: "Stop",
                  value: pct(stopFloor),
                },
              ]
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
