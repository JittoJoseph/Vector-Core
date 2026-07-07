"use client";

import type { PricePoint } from "@/lib/types";

export interface ChartMarker {
  t: number; // unix seconds
  p: number; // 0..1 price
  className: string; // fill-* tailwind class
  label?: string;
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

  // Inject exact marker coordinates into the sequence so the SVG curve hits them perfectly
  const injectedHistory = [...history];
  for (const m of markers) {
    injectedHistory.push({ t: m.t, p: m.p });
  }
  // Remove exact duplicates and sort
  injectedHistory.sort((a, b) => a.t - b.t);

  const rawPoints = injectedHistory.map((h) => ({ x: sx(h.t), y: sy(h.p) }));
  
  let linePath = "";
  if (rawPoints.length > 0) {
    linePath = `M ${rawPoints[0]!.x.toFixed(1)},${rawPoints[0]!.y.toFixed(1)}`;
    for (let i = 0; i < rawPoints.length - 1; i++) {
      const curr = rawPoints[i]!;
      const next = rawPoints[i + 1]!;
      const midX = (curr.x + next.x) / 2;
      linePath += ` C ${midX.toFixed(1)},${curr.y.toFixed(1)} ${midX.toFixed(1)},${next.y.toFixed(1)} ${next.x.toFixed(1)},${next.y.toFixed(1)}`;
    }
  }

  const baseline = H - PAD_Y;
  const areaPath = linePath
    ? `${linePath} L ${rawPoints[rawPoints.length - 1]!.x.toFixed(1)},${baseline} L ${rawPoints[0]!.x.toFixed(1)},${baseline} Z`
    : "";

  const formatTime = (t: number) => {
    return new Date(t * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  return (
    <div className="relative w-full mb-5" style={{ height }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full block overflow-visible pointer-events-none"
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

        <path d={areaPath} className="fill-foreground/5" stroke="none" />
        <path
          d={linePath}
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
      </svg>

      {/* HTML DOM Overlays for markers and tooltips */}
      {markers.map((m, i) => {
        const leftPct = (sx(m.t) / W) * 100;
        const topPct = (sy(m.p) / H) * 100;
        return (
          <div
            key={`html-m${i}`}
            className="absolute group z-10"
            style={{ left: `${leftPct}%`, top: `${topPct}%` }}
          >
            {/* Hit area for hovering */}
            <div className="absolute -inset-3 rounded-full cursor-default" />
            
            {/* The actual dot marker, converted to Tailwind classes */}
            <div
              className={`absolute -ml-[2.6px] -mt-[2.6px] w-[5.2px] h-[5.2px] rounded-full pointer-events-none ${
                m.className.replace("fill-", "bg-") // convert SVG fill to HTML bg
              }`}
            />

            {/* NextJS HTML Tooltip Card */}
            {m.label && (
              <div
                className={`absolute bottom-full mb-1.5 flex flex-col items-center justify-center bg-zinc-900 border border-white/10 rounded shadow-2xl pointer-events-none w-max px-2 py-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 ${
                  leftPct > 85
                    ? "right-0 translate-x-1"
                    : leftPct < 15
                    ? "left-0 -translate-x-1"
                    : "left-1/2 -translate-x-1/2"
                }`}
              >
                <span className="text-[9px] font-medium text-white/70 tracking-widest uppercase leading-none mb-0.5">
                  {m.label}
                </span>
                <span className="text-[11px] font-mono font-medium text-white leading-none">
                  {(m.p * 100).toFixed(1)}¢
                </span>
              </div>
            )}
          </div>
        );
      })}

      {/* Subtle X-axis Timestamps */}
      <div className="absolute left-0 right-0 top-full mt-0.5 flex justify-between px-1 text-[8px] font-mono text-muted-foreground/30 pointer-events-none">
        <span>{formatTime(xMin)}</span>
        <span>{formatTime(xMin + xSpan / 2)}</span>
        <span>{formatTime(xMax)}</span>
      </div>
    </div>
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
