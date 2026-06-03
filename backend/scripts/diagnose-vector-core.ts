/**
 * Vector Core Production Diagnostic Script
 *
 * Fetches the live API state (stats/opportunities/trades/audit) and prints a
 * compact summary so you can quickly tell whether the scanner is running and
 * why it is (not) opening simulated trades.
 *
 * Usage:
 *   npx tsx scripts/diagnose-vector-core.ts https://vector-core.onrender.com
 *   VECTOR_CORE_API_BASE=https://vector-core.onrender.com npx tsx scripts/diagnose-vector-core.ts
 */

type Json = Record<string, unknown>;

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toIso(ms: number | null): string {
  if (ms == null) return "—";
  return new Date(ms).toISOString();
}

async function fetchJson(url: string): Promise<Json> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url}${text ? `: ${text}` : ""}`);
  }
  return (await res.json()) as Json;
}

function groupCounts(items: Array<Record<string, unknown>>, key: string): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const item of items) {
    const raw = item[key];
    const k = typeof raw === "string" && raw.length > 0 ? raw : "unknown";
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

async function main(): Promise<void> {
  const argBase = process.argv[2];
  const base =
    (argBase && argBase.trim().length > 0 ? argBase : process.env.VECTOR_CORE_API_BASE)?.replace(
      /\/+$/,
      "",
    ) ?? "https://vector-core.onrender.com";

  console.log(`Base: ${base}`);

  const [ping, stats, opportunities, trades, audit] = await Promise.all([
    fetchJson(`${base}/ping`).catch((e) => ({ error: String(e) })),
    fetchJson(`${base}/api/system/stats`).catch((e) => ({ error: String(e) })),
    fetchJson(`${base}/api/opportunities?limit=200`).catch((e) => ({ error: String(e) })),
    fetchJson(`${base}/api/trades?limit=200`).catch((e) => ({ error: String(e) })),
    fetchJson(`${base}/api/audit?limit=50`).catch((e) => ({ error: String(e) })),
  ]);

  if ("error" in ping) console.log(`Ping: ERROR ${(ping as any).error}`);
  else console.log(`Ping: ok (${JSON.stringify(ping)})`);

  if ("error" in stats) {
    console.log(`Stats: ERROR ${(stats as any).error}`);
  } else {
    const orchestrator = (stats as any).orchestrator as Json | undefined;
    const scanner = orchestrator?.scanner as Json | undefined;
    const activity = orchestrator?.activity as Json | undefined;

    console.log(`Orchestrator: running=${String(orchestrator?.running)} paused=${String(orchestrator?.paused)}`);
    console.log(
      `Scan: cycles=${String(orchestrator?.cycleCount)} discovered=${String(
        scanner?.discoveredCount,
      )} candidates=${String(scanner?.candidateCount)}`,
    );
    console.log(
      `Activity: lastScanStartedAt=${toIso(asNumber(activity?.lastScanStartedAt))} lastScanFinishedAt=${toIso(
        asNumber(activity?.lastScanFinishedAt),
      )}`,
    );
    console.log(`Activity: lastScanError=${String(activity?.lastScanError ?? "—")}`);
    console.log(
      `Decisions: lastDecisionAt=${toIso(asNumber(activity?.lastDecisionAt))} lastTradeOpenedAt=${toIso(
        asNumber(activity?.lastTradeOpenedAt),
      )}`,
    );
    console.log(
      `Positions: openPositions=${String(orchestrator?.openPositions)} monitoredMarkets=${String(
        orchestrator?.activeMarkets,
      )}`,
    );
  }

  const oppRows = Array.isArray(opportunities) ? (opportunities as any[]) : [];
  if ("error" in opportunities) {
    console.log(`Opportunities: ERROR ${(opportunities as any).error}`);
  } else {
    console.log(`Opportunities: ${oppRows.length} (latest first)`);
    const byStatus = groupCounts(oppRows, "status");
    const byReason = groupCounts(oppRows, "reason").slice(0, 10);
    console.log(`Opportunity statuses: ${byStatus.map(([k, v]) => `${k}=${v}`).join(", ") || "—"}`);
    console.log(`Top reasons: ${byReason.map(([k, v]) => `${k}=${v}`).join(", ") || "—"}`);
    const latest = oppRows[0] as any | undefined;
    if (latest?.createdAt) console.log(`Latest opportunity: ${String(latest.status)} ${String(latest.reason)} @ ${String(latest.createdAt)}`);
  }

  const tradeRows = Array.isArray(trades) ? (trades as any[]) : [];
  if ("error" in trades) {
    console.log(`Trades: ERROR ${(trades as any).error}`);
  } else {
    console.log(`Trades: ${tradeRows.length} (latest first)`);
    const byStatus = groupCounts(tradeRows, "status");
    console.log(`Trade statuses: ${byStatus.map(([k, v]) => `${k}=${v}`).join(", ") || "—"}`);
    const latest = tradeRows[0] as any | undefined;
    if (latest?.entryTs) console.log(`Latest trade: ${String(latest.status)} @ ${String(latest.entryTs)} (${String(latest.marketQuestion ?? latest.marketId ?? "")})`);
  }

  const auditRows = Array.isArray(audit) ? (audit as any[]) : [];
  if ("error" in audit) {
    console.log(`Audit: ERROR ${(audit as any).error}`);
  } else {
    console.log(`Audit: ${auditRows.length} (latest first)`);
    const byCat = groupCounts(auditRows, "category").slice(0, 10);
    console.log(`Top categories: ${byCat.map(([k, v]) => `${k}=${v}`).join(", ") || "—"}`);
    const latest = auditRows[0] as any | undefined;
    if (latest?.createdAt) console.log(`Latest audit: ${String(latest.category)} @ ${String(latest.createdAt)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

