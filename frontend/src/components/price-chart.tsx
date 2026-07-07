"use client";

import type { PricePoint } from "@/lib/types";

export interface ChartMarker {
  t: number; // unix seconds
  p: number; // 0..1 price
  className: string; // fill-* tailwind class
}

export interface ChartHLine {
  p: number;
  className: string; // stroke-* tailwind class
}

export interface ChartVLine {
  t: number;
  className: string; // stroke-* tailwind class
}

const W = 400;
const PAD_X = 4;
const PAD_Y = 12;

/**
 * Compact area+line price sparkline with optional reference lines and markers.
 * Shared by the trade dip-timeline and the campaign bucket sparkline so the
 * scaling/area/polyline math lives in exactly one place.
 */
export function PriceChart({
  history,
  height = 84,
  markers = [],
  hlines = [],
  vlines = [],
}: {
  history: PricePoint[];
  height?: number;
  markers?: ChartMarker[];
  hlines?: ChartHLine[];
  vlines?: ChartVLine[];
}) {
  if (!history || history.length < 2) return null;

  const H = height;
  const xsExtra = [...vlines.map((v) => v.t), ...markers.map((m) => m.t)];
  const xMin = Math.min(history[0]!.t, ...xsExtra);
  const xMax = Math.max(history[history.length - 1]!.t, ...xsExtra);
  const xSpan = xMax - xMin || 1;

  const ys = [
    ...history.map((h) => h.p),
    ...hlines.map((l) => l.p),
    ...markers.map((m) => m.p),
  ];
  const yMinRaw = Math.min(...ys);
  const yMaxRaw = Math.max(...ys);
  const yPad = (yMaxRaw - yMinRaw) * 0.18 || 0.015;
  const yMin = yMinRaw - yPad;
  const yMax = yMaxRaw + yPad;
  const ySpan = yMax - yMin || 1;

  const sx = (t: number) => PAD_X + ((t - xMin) / xSpan) * (W - PAD_X * 2);
  const sy = (p: number) => PAD_Y + (1 - (p - yMin) / ySpan) * (H - PAD_Y * 2);

  const points = history
    .map((h) => `${sx(h.t).toFixed(1)},${sy(h.p).toFixed(1)}`)
    .join(" ");
  const baseline = H - PAD_Y;
  const area = `M ${sx(history[0]!.t).toFixed(1)},${baseline} L ${points} L ${sx(
    history[history.length - 1]!.t,
  ).toFixed(1)},${baseline} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full block"
      style={{ height }}
    >
      {hlines.map((l, i) => (
        <line
          key={`h${i}`}
          x1={PAD_X}
          x2={W - PAD_X}
          y1={sy(l.p)}
          y2={sy(l.p)}
          className={l.className}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      ))}

      <path d={area} className="fill-foreground/5" stroke="none" />
      <polyline
        points={points}
        fill="none"
        className="stroke-foreground/45"
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {vlines.map((v, i) => (
        <line
          key={`v${i}`}
          x1={sx(v.t)}
          x2={sx(v.t)}
          y1={PAD_Y - 4}
          y2={H - PAD_Y + 4}
          className={v.className}
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      ))}

      {markers.map((m, i) => (
        <circle key={`m${i}`} cx={sx(m.t)} cy={sy(m.p)} r={2.6} className={m.className} />
      ))}
    </svg>
  );
}

export function ChartLegend({
  items,
}: {
  items: { variant: "dot" | "dash"; swatchClass: string; label: string; value: string }[];
}) {
  return (
    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-1">
          {it.variant === "dot" ? (
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${it.swatchClass}`} />
          ) : (
            <span className={`inline-block w-2.5 border-t border-dashed ${it.swatchClass}`} />
          )}
          <span className="text-[9px] font-mono uppercase tracking-wide text-muted-foreground/45">
            {it.label}
          </span>
          <span className="text-[10px] font-mono tabular-nums text-foreground/75 font-medium">
            {it.value}
          </span>
        </div>
      ))}
    </div>
  );
}
