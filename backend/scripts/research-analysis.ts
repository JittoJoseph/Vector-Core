import postgres from "postgres";
import dotenv from "dotenv";

dotenv.config();

const FEATURES = [
  "activeMinutes",
  "updates",
  "staleSec",
  "spreadMean",
  "spreadStd",
  "spreadMax",
  "spreadWorstMin",
  "spreadOkFrac",
  "bidChanges",
  "askChanges",
  "bidDepth",
  "askDepth",
  "imbalance",
  "levels",
] as const;

type Feature = (typeof FEATURES)[number];

const med = (a: number[]) =>
  a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : NaN;

const avg = (a: number[]) =>
  a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;

const fmt = (n: number, d = 4) => (Number.isFinite(n) ? n.toFixed(d) : "-");

const line = "=".repeat(80);

async function main() {
  const sql = postgres(process.env.SUPABASE_DATABASE_URL!, { max: 1 });

  const rows = await sql`
    SELECT
      entry_price,
      realized_pnl,
      exit_reason,
      status,
      entry_quality
    FROM trades
    WHERE entry_quality IS NOT NULL
  `;

  const resolved = rows.filter((r) => r.status !== "OPEN");

  const survived = resolved.filter((r) => r.exit_reason !== "EARLY_EXIT");

  const stopped = resolved.filter((r) => r.exit_reason === "EARLY_EXIT");

  console.log(line);
  console.log("ENTRY QUALITY REPORT");
  console.log(line);

  console.log();
  console.log("DATASET");
  console.log("-------");
  console.log(`Trades with quality : ${rows.length}`);
  console.log(`Resolved            : ${resolved.length}`);
  console.log(`Survived            : ${survived.length}`);
  console.log(`Stopped             : ${stopped.length}`);

  console.log();
  console.log(line);
  console.log("FEATURE SUMMARY");
  console.log(line);

  console.log(
    "Feature".padEnd(18),
    "Survived".padStart(12),
    "Stopped".padStart(12),
    "Delta".padStart(12),
  );

  const ranking: {
    feature: Feature;
    score: number;
  }[] = [];

  for (const feature of FEATURES) {
    const s = survived
      .map((r) => Number(r.entry_quality?.[feature]))
      .filter(Number.isFinite);

    const l = stopped
      .map((r) => Number(r.entry_quality?.[feature]))
      .filter(Number.isFinite);

    if (!s.length || !l.length) continue;

    const ms = med(s);
    const ml = med(l);

    const delta = ms - ml;

    const spread = Math.max(...s, ...l) - Math.min(...s, ...l);

    const score = spread > 0 ? Math.abs(delta) / spread : 0;

    ranking.push({
      feature,
      score,
    });

    console.log(
      feature.padEnd(18),
      fmt(ms).padStart(12),
      fmt(ml).padStart(12),
      fmt(delta).padStart(12),
    );
  }

  ranking.sort((a, b) => b.score - a.score);

  console.log();
  console.log(line);
  console.log("FEATURE STRENGTH");
  console.log(line);

  ranking.forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(2)}. ${r.feature.padEnd(18)} score=${fmt(
        r.score,
        3,
      )}`,
    );
  });

  for (const { feature } of ranking) {
    console.log();
    console.log(line);
    console.log(feature.toUpperCase());
    console.log(line);

    const trades = resolved
      .map((r) => ({
        value: Number(r.entry_quality?.[feature]),
        stop: r.exit_reason === "EARLY_EXIT",
        pnl: Number(r.realized_pnl),
      }))
      .filter((r) => Number.isFinite(r.value));

    trades.sort((a, b) => a.value - b.value);

    console.log(
      `Min ${fmt(trades[0].value)}   Median ${fmt(
        med(trades.map((x) => x.value)),
      )}   Max ${fmt(trades[trades.length - 1].value)}`,
    );

    console.log();

    const buckets = 5;

    for (let b = 0; b < buckets; b++) {
      const start = Math.floor((b * trades.length) / buckets);

      const end = Math.floor(((b + 1) * trades.length) / buckets);

      const slice = trades.slice(start, end);

      if (!slice.length) continue;

      const stops = slice.filter((x) => x.stop).length;

      const survives = slice.length - stops;

      const stopRate = (stops / slice.length) * 100;

      const pnl = slice.map((x) => x.pnl);

      console.log(
        `Bucket ${b + 1} (${fmt(slice[0].value, 3)} → ${fmt(
          slice[slice.length - 1].value,
          3,
        )})`,
      );

      console.log(`  Trades      : ${slice.length}`);

      console.log(`  Survived    : ${survives}`);

      console.log(`  Stopped     : ${stops}`);

      console.log(`  Stop Rate   : ${fmt(stopRate, 1)}%`);

      console.log(`  Avg PnL     : ${fmt(avg(pnl))}`);

      console.log(`  Median PnL  : ${fmt(med(pnl))}`);

      console.log(`  Total PnL   : ${fmt(pnl.reduce((a, b) => a + b, 0))}`);

      console.log();
    }
  }

  console.log();
  console.log(line);
  console.log("TOP WINNERS");
  console.log(line);

  [...resolved]
    .sort((a, b) => Number(b.realized_pnl) - Number(a.realized_pnl))
    .slice(0, 10)
    .forEach((t, i) => {
      console.log(
        `${i + 1}. pnl=${fmt(Number(t.realized_pnl))} quality=${JSON.stringify(
          t.entry_quality,
        )}`,
      );
    });

  console.log();
  console.log(line);
  console.log("TOP LOSERS");
  console.log(line);

  [...resolved]
    .sort((a, b) => Number(a.realized_pnl) - Number(b.realized_pnl))
    .slice(0, 10)
    .forEach((t, i) => {
      console.log(
        `${i + 1}. pnl=${fmt(Number(t.realized_pnl))} quality=${JSON.stringify(
          t.entry_quality,
        )}`,
      );
    });

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
