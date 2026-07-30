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

const med = (a: number[]) =>
  a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : NaN;

async function main() {
  const sql = postgres(process.env.SUPABASE_DATABASE_URL!, { max: 1 });
  const rows = await sql`
    SELECT entry_price, min_no_price_during_position, exit_reason,
           exit_outcome, status, entry_quality
    FROM trades WHERE entry_quality IS NOT NULL`;
  console.log("trades with entry_quality:", rows.length);
  if (!rows.length) {
    console.log("(none yet - deploy and wait for new entries)");
    await sql.end();
    return;
  }

  const survived: any[] = [];
  const stopped: any[] = [];
  for (const r of rows) {
    if (r.status === "OPEN") continue;
    (r.exit_reason === "EARLY_EXIT" ? stopped : survived).push(r.entry_quality);
  }
  console.log(`survived=${survived.length}  stopped=${stopped.length}\n`);
  console.log("feature".padEnd(16), "survived".padStart(10), "stopped".padStart(10), "  delta");
  for (const f of FEATURES) {
    const a = med(survived.map((q) => Number(q?.[f])).filter(Number.isFinite));
    const b = med(stopped.map((q) => Number(q?.[f])).filter(Number.isFinite));
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    const d = a - b;
    console.log(
      f.padEnd(16),
      a.toFixed(4).padStart(10),
      b.toFixed(4).padStart(10),
      `  ${d >= 0 ? "+" : ""}${d.toFixed(4)}`,
    );
  }
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
