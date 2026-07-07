"use client";

interface PricePoint {
  t: number;
  p: number;
}

interface DipTimelineProps {
  history: PricePoint[];
  entryTs: string;
  entryPrice: number;
  recoveryLow: number | null;
  stopNoPrice: number | null;
  exitTs?: string | null;
  exitPrice?: number | null;
  isWin?: boolean;
}

const W = 400;
const H = 88;
const PAD_X = 4;
const PAD_Y = 10;

export function DipTimeline({
  history,
  entryTs,
  entryPrice,
  recoveryLow,
  stopNoPrice,
  exitTs,
  exitPrice,
  isWin,
}: DipTimelineProps) {
  if (!history || history.length < 2) return null;

  const entryT = Date.parse(entryTs) / 1000;
  const exitT = exitTs ? Date.parse(exitTs) / 1000 : null;

  const xs = [...history.map((h) => h.t), entryT, ...(exitT ? [exitT] : [])];
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xSpan = xMax - xMin || 1;

  const ys = [
    ...history.map((h) => h.p),
    entryPrice,
    ...(recoveryLow != null ? [recoveryLow] : []),
    ...(stopNoPrice != null ? [stopNoPrice] : []),
    ...(exitPrice != null ? [exitPrice] : []),
  ];
  const yMinRaw = Math.min(...ys);
  const yMaxRaw = Math.max(...ys);
  const yPad = (yMaxRaw - yMinRaw) * 0.18 || 0.015;
  const yMin = yMinRaw - yPad;
  const yMax = yMaxRaw + yPad;
  const ySpan = yMax - yMin || 1;

  const scaleX = (t: number) => PAD_X + ((t - xMin) / xSpan) * (W - PAD_X * 2);
  const scaleY = (p: number) =>
    PAD_Y + (1 - (p - yMin) / ySpan) * (H - PAD_Y * 2);

  const linePoints = history
    .map((h) => `${scaleX(h.t).toFixed(1)},${scaleY(h.p).toFixed(1)}`)
    .join(" ");
  const baseline = H - PAD_Y;
  const areaPath = `M ${scaleX(history[0]!.t).toFixed(1)},${baseline} L ${linePoints} L ${scaleX(
    history[history.length - 1]!.t,
  ).toFixed(1)},${baseline} Z`;

  const lowPoint = history.reduce((min, h) => (h.p < min.p ? h : min), history[0]!);

  const entryX = scaleX(entryT);
  const entryY = scaleY(entryPrice);
  const stopY = stopNoPrice != null ? scaleY(stopNoPrice) : null;
  const exitX = exitT != null ? scaleX(exitT) : null;
  const exitY = exitPrice != null ? scaleY(exitPrice) : null;

  const pct = (p: number) => `${(p * 100).toFixed(1)}¢`;

  return (
    <div className="px-4 pb-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full block"
        style={{ height: 84 }}
      >
        {stopY != null && (
          <line
            x1={PAD_X}
            x2={W - PAD_X}
            y1={stopY}
            y2={stopY}
            className="stroke-red-400/40"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        <path d={areaPath} className="fill-foreground/5" stroke="none" />
        <polyline
          points={linePoints}
          fill="none"
          className="stroke-foreground/45"
          strokeWidth={1.4}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        <line
          x1={entryX}
          x2={entryX}
          y1={PAD_Y}
          y2={H - PAD_Y}
          className="stroke-blue-400/25"
          strokeWidth={1}
          strokeDasharray="2 2"
        />

        {exitX != null && exitY != null && (
          <line
            x1={entryX}
            y1={entryY}
            x2={exitX}
            y2={exitY}
            className={isWin ? "stroke-emerald-400/35" : "stroke-red-400/35"}
            strokeWidth={1.25}
            strokeDasharray="1 3"
            strokeLinecap="round"
          />
        )}

        <circle cx={scaleX(lowPoint.t)} cy={scaleY(lowPoint.p)} r={2.5} className="fill-amber-400" />
        <circle cx={entryX} cy={entryY} r={2.75} className="fill-blue-400" />
        {exitX != null && exitY != null && (
          <circle cx={exitX} cy={exitY} r={2.75} className={isWin ? "fill-emerald-400" : "fill-red-400"} />
        )}
      </svg>

      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
        <Legend variant="dot" swatchClass="bg-amber-400" label="Low" value={pct(lowPoint.p)} />
        <Legend variant="dot" swatchClass="bg-blue-400" label="Entry" value={pct(entryPrice)} />
        {stopNoPrice != null && (
          <Legend variant="dash" swatchClass="border-red-400/70" label="Stop" value={pct(stopNoPrice)} />
        )}
        {exitPrice != null && (
          <Legend
            variant="dot"
            swatchClass={isWin ? "bg-emerald-400" : "bg-red-400"}
            label="Exit"
            value={pct(exitPrice)}
          />
        )}
      </div>
    </div>
  );
}

function Legend({
  variant,
  swatchClass,
  label,
  value,
}: {
  variant: "dot" | "dash";
  swatchClass: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1">
      {variant === "dot" ? (
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${swatchClass}`} />
      ) : (
        <span className={`inline-block w-2.5 border-t border-dashed ${swatchClass}`} />
      )}
      <span className="text-[9px] font-mono uppercase tracking-wide text-muted-foreground/45">
        {label}
      </span>
      <span className="text-[10px] font-mono tabular-nums text-foreground/75 font-medium">
        {value}
      </span>
    </div>
  );
}
