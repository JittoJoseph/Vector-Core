"use client";

import { Activity } from "lucide-react";
import { Header } from "./header";
import { useReadiness } from "@/lib/hooks";
import type { CityReadiness } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

const STATUS_STYLE: Record<CityReadiness["status"], string> = {
  ready: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  partial: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  blocked: "bg-red-500/10 text-red-400 border-red-500/20",
};

const STATUS_ORDER: Record<CityReadiness["status"], number> = {
  blocked: 0,
  partial: 1,
  ready: 2,
};

function Stat({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 p-3 rounded-lg border border-border/30 bg-card/30">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span
        className={`text-sm font-semibold tabular-nums ${
          ok === undefined
            ? "text-foreground"
            : ok
              ? "text-emerald-400"
              : "text-red-400"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export function ReadinessPage() {
  const { readiness, loading, error } = useReadiness();
  const cities = [...(readiness?.cities ?? [])].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      a.city.localeCompare(b.city),
  );
  const count = (s: CityReadiness["status"]) =>
    cities.filter((c) => c.status === s).length;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-mono">
      <Header />
      <main className="flex-1 px-4 py-6 pb-16 max-w-7xl mx-auto w-full space-y-6">
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-border/20">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-muted-foreground" />
            <h2 className="text-lg font-bold tracking-wider text-foreground">
              READINESS
            </h2>
          </div>
          <span className="text-[10px] text-muted-foreground">
            {readiness ? `checked ${timeAgo(readiness.checkedAt)}` : ""}
          </span>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          A city only trades when every input of the strategy is available for
          it. Anything missing blocks that city or ladder; nothing is
          substituted. Take-profit, stop and resolution keep running for open
          positions because they only need market prices.
        </p>

        {error && !readiness && (
          <div className="p-3 text-xs rounded border border-red-500/20 bg-red-500/10 text-red-400">
            Readiness unavailable: {error.message}
          </div>
        )}

        {loading && !readiness ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : readiness ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Stat
                label="Last WeatherNext run"
                value={
                  readiness.feed.lastPublishedAt
                    ? `${readiness.feed.lastInit?.slice(5, 16).replace("T", " ")}Z · ${timeAgo(readiness.feed.lastPublishedAt)}`
                    : "none yet"
                }
                ok={
                  !readiness.feed.lastError && !!readiness.feed.lastPublishedAt
                }
              />
              <Stat
                label="All-city error history (7 d)"
                value={`${readiness.correction.days7d}/${readiness.correction.minDays} days · ${readiness.correction.residuals7d} markets`}
                ok={readiness.correction.ready}
              />
              <Stat
                label="History backfill"
                value={
                  readiness.backfill.state === "running"
                    ? `running · ${readiness.backfill.recorded}/${readiness.backfill.missing} filled`
                    : readiness.backfill.state === "done"
                      ? `done · ${readiness.backfill.recorded} filled ${timeAgo(readiness.backfill.finishedAt)}`
                      : readiness.backfill.state
                }
                ok={
                  readiness.backfill.state === "running"
                    ? undefined
                    : readiness.backfill.state === "done"
                }
              />
              <Stat
                label="Cities ready / partial / blocked"
                value={`${count("ready")} / ${count("partial")} / ${count("blocked")}`}
              />
              <Stat
                label="Positions without a price"
                value={String(readiness.unpricedPositions)}
                ok={readiness.unpricedPositions === 0}
              />
            </div>

            {readiness.backfill.error && (
              <div className="p-3 text-xs rounded border border-red-500/20 bg-red-500/10 text-red-400">
                History backfill failed: {readiness.backfill.error}. It
                retries on the next restart; affected cities stay blocked
                until their history is complete.
              </div>
            )}

            {readiness.feed.lastError && (
              <div className="p-3 text-xs rounded border border-red-500/20 bg-red-500/10 text-red-400">
                Feed error: {readiness.feed.lastError}
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border border-border/30">
              <table className="w-full text-[11px]">
                <thead className="bg-card/40 text-muted-foreground uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="text-left py-2 px-3">City</th>
                    <th className="text-left py-2 px-3">Status</th>
                    <th className="text-right py-2 px-3">Correction</th>
                    <th className="text-right py-2 px-3">Resolved (14 d)</th>
                    <th className="text-right py-2 px-3">Open ladders</th>
                    <th className="text-left py-2 px-3">Why not trading</th>
                  </tr>
                </thead>
                <tbody>
                  {cities.map((c) => {
                    const reasons = [
                      ...(c.correctionReason
                        ? [`Station correction: ${c.correctionReason}`]
                        : []),
                      ...c.blockedLadders.map(
                        (l) =>
                          `${l.title.replace("Highest temperature in ", "")} — ${l.reason}`,
                      ),
                      ...(c.bucketsWithoutFee
                        ? [
                            `${c.bucketsWithoutFee} buckets without a fee schedule`,
                          ]
                        : []),
                    ];
                    return (
                      <tr
                        key={c.city}
                        className="border-t border-border/20 align-top"
                      >
                        <td className="py-2 px-3 font-semibold text-foreground whitespace-nowrap">
                          {c.city}
                        </td>
                        <td className="py-2 px-3">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-wider ${STATUS_STYLE[c.status]}`}
                          >
                            {c.status}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {c.correctionC === null
                            ? "—"
                            : `${c.correctionC >= 0 ? "+" : ""}${c.correctionC.toFixed(2)}°C`}
                        </td>
                        <td
                          className={`py-2 px-3 text-right tabular-nums ${
                            c.residuals14d >= c.minResiduals
                              ? "text-foreground"
                              : "text-red-400"
                          }`}
                        >
                          {c.residuals14d}/{c.minResiduals}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {c.openLadders}
                        </td>
                        <td className="py-2 px-3 text-muted-foreground">
                          {reasons.length ? (
                            <ul className="space-y-0.5">
                              {reasons.map((r) => (
                                <li key={r}>{r}</li>
                              ))}
                            </ul>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
