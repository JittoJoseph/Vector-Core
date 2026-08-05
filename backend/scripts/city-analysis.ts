import postgres from "postgres";
import dotenv from "dotenv";

dotenv.config();

const FEATURES = [
  "updates",
  "spreadMean",
  "spreadStd",
  "spreadWorstMin",
  "spreadOkFrac",
  "bidDepth",
  "askDepth",
  "imbalance",
  "levels",
] as const;

const MIN_TRADES = 2;

const med = (a: number[]) =>
  a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : NaN;

const fmt = (n: number, digits = 4) =>
  Number.isFinite(n) ? n.toFixed(digits) : "-";

const cityFromSlug = (slug: string) =>
  slug.replace(/-high-temperature.*$/i, "");

async function main() {
  const sql = postgres(process.env.SUPABASE_DATABASE_URL!, { max: 1 });

  const rows = await sql`
    SELECT
      campaign_slug,
      realized_pnl,
      exit_reason,
      status,
      entry_quality
    FROM trades
    WHERE entry_quality IS NOT NULL
  `;

  const resolved = rows.filter((r) => r.status !== "OPEN");

  console.log(`Resolved trades: ${resolved.length}\n`);

  const groups = new Map<string, typeof resolved>();

  for (const trade of resolved) {
    const city = cityFromSlug(trade.campaign_slug ?? "unknown");

    const arr = groups.get(city) ?? [];
    arr.push(trade);
    groups.set(city, arr);
  }

  const cities = [...groups.entries()]
    .map(([city, trades]) => {
      const stops = trades.filter((t) => t.exit_reason === "EARLY_EXIT").length;

      const wins = trades.length - stops;

      const totalPnl = trades.reduce((s, t) => s + Number(t.realized_pnl), 0);

      return {
        city,
        trades,
        tradeCount: trades.length,
        wins,
        stops,
        stopRate: stops / trades.length,
        avgPnl: totalPnl / trades.length,
      };
    })
    .filter((c) => c.tradeCount >= MIN_TRADES)
    .sort((a, b) => a.stopRate - b.stopRate);

  console.log("============================================================");
  console.log("CITY PERFORMANCE");
  console.log("============================================================");

  console.log(
    "City".padEnd(18),
    "Trades".padStart(8),
    "Wins".padStart(6),
    "Stops".padStart(7),
    "Stop%".padStart(8),
    "AvgPnL".padStart(10),
  );

  for (const c of cities) {
    console.log(
      c.city.padEnd(18),
      String(c.tradeCount).padStart(8),
      String(c.wins).padStart(6),
      String(c.stops).padStart(7),
      fmt(c.stopRate * 100, 1).padStart(8),
      fmt(c.avgPnl, 3).padStart(10),
    );
  }

  for (const feature of FEATURES) {
    console.log("\n");
    console.log("============================================================");
    console.log(feature.toUpperCase());
    console.log("============================================================");

    const ranking = cities
      .map((c) => ({
        city: c.city,
        trades: c.tradeCount,
        stopRate: c.stopRate,
        value: med(
          c.trades
            .map((t) => Number(t.entry_quality?.[feature]))
            .filter(Number.isFinite),
        ),
      }))
      .sort((a, b) => a.value - b.value);

    console.log(
      "City".padEnd(18),
      "Median".padStart(12),
      "Stop%".padStart(10),
      "Trades".padStart(8),
    );

    for (const r of ranking) {
      console.log(
        r.city.padEnd(18),
        fmt(r.value).padStart(12),
        fmt(r.stopRate * 100, 1).padStart(10),
        String(r.trades).padStart(8),
      );
    }
  }

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
