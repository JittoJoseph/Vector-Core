/**
 * Backtest: replays the recovery + R:R entry with the floor stop over closed
 * campaigns to measure PnL. Read-only; reconstructs each bucket's NO price from
 * Polymarket /prices-history (trade/mid price, ~spread/2 error vs the live ask).
 *
 * Usage: npx tsx src/scripts/backtest-entry-gates.ts
 */
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";
import { getPolymarketClient } from "../services/polymarket-client.js";
import { getConfig } from "../utils/config.js";
import {
  parseBucketMinMax,
  isCandidateBucket,
  findModalBucket,
  analyzeRecovery,
  riskReward,
  riskAnchorNoPrice,
} from "../utils/distribution-logic.js";

const STEP_SEC = 600; // 10-minute grid, matches fidelity=10

type BucketRow = typeof schema.distributionBuckets.$inferSelect;
type CampaignRow = typeof schema.distributionCampaigns.$inferSelect;

interface BucketSeries {
  bucket: BucketRow;
  history: Array<{ t: number; p: number }>; // YES price
}

interface SimTrade {
  bucketTitle: string;
  entryT: number;
  entryNoPrice: number;
  outcome: "WIN" | "STOP" | "OPEN_AT_END";
  exitNoPrice: number;
  pnlPerShare: number;
  maxDrawdown: number;
}

interface PolicyConfig {
  min: number;
  max: number;
  lookbackHours: number;
  confirmHours: number;
  epsilon: number;
  minRiskReward: number;
  stopBuffer: number;
  floor: number;
}

function yesAt(series: BucketSeries, t: number): number | null {
  let latest: number | null = null;
  for (const h of series.history) {
    if (h.t > t) break;
    latest = h.p;
  }
  return latest;
}

// Replays the live strategy: enter on recovery + R:R, hold to resolution, and
// cut only when NO falls to the floor (the sole exit).
function replayCampaign(
  _campaign: CampaignRow,
  series: BucketSeries[],
  cfg: PolicyConfig,
): SimTrade[] {
  const allT = series.flatMap((s) => s.history.map((h) => h.t));
  if (allT.length === 0) return [];
  const tStart = Math.min(...allT);
  const tEnd = Math.max(...allT);

  const open = new Map<string, SimTrade>();
  const done: SimTrade[] = [];

  for (let t = tStart; t <= tEnd; t += STEP_SEC) {
    const ladder = series
      .map((s) => ({ groupItemTitle: s.bucket.groupItemTitle, yesPrice: yesAt(s, t), series: s }))
      .filter((b) => b.yesPrice !== null) as Array<{
      groupItemTitle: string;
      yesPrice: number;
      series: BucketSeries;
    }>;
    if (ladder.length < 2) continue;

    const modal = findModalBucket(ladder)!;
    const [modalMin] = parseBucketMinMax(modal.groupItemTitle);

    for (const b of ladder) {
      const noPrice = 1 - b.yesPrice;
      const title = b.groupItemTitle;

      const pos = open.get(title);
      if (pos) {
        pos.maxDrawdown = Math.min(pos.maxDrawdown, noPrice - pos.entryNoPrice);
        if (noPrice <= cfg.floor) {
          pos.outcome = "STOP";
          pos.exitNoPrice = noPrice;
          pos.pnlPerShare = noPrice - pos.entryNoPrice;
          done.push(pos);
          open.delete(title);
        }
        continue;
      }

      if (!isCandidateBucket(title, modalMin)) continue;
      if (noPrice < cfg.min || noPrice > cfg.max) continue;

      const noHistory = b.series.history
        .filter((h) => h.t <= t)
        .map((h) => ({ t: h.t, p: 1 - h.p }));
      const rec = analyzeRecovery(noHistory, t, cfg.lookbackHours, cfg.confirmHours, cfg.epsilon);
      if (!rec || !rec.isRecovery) continue;

      const anchor = riskAnchorNoPrice(rec.recentLow, cfg.stopBuffer, cfg.floor);
      if (riskReward(noPrice, anchor) < cfg.minRiskReward) continue;

      open.set(title, {
        bucketTitle: title,
        entryT: t,
        entryNoPrice: noPrice,
        outcome: "OPEN_AT_END",
        exitNoPrice: noPrice,
        pnlPerShare: 0,
        maxDrawdown: 0,
      });
    }
  }

  // Resolve survivors from final prices: NO wins if final YES < 0.5.
  for (const pos of open.values()) {
    const s = series.find((x) => x.bucket.groupItemTitle === pos.bucketTitle)!;
    const finalYes = s.history[s.history.length - 1]!.p;
    if (finalYes < 0.5) {
      pos.outcome = "WIN";
      pos.exitNoPrice = 1;
      pos.pnlPerShare = 1 - pos.entryNoPrice;
    } else {
      pos.outcome = "STOP";
      pos.exitNoPrice = 0;
      pos.pnlPerShare = -pos.entryNoPrice;
    }
    done.push(pos);
  }
  return done;
}

function summarize(label: string, trades: SimTrade[]): void {
  const wins = trades.filter((t) => t.pnlPerShare > 0).length;
  const losses = trades.length - wins;
  const pnl = trades.reduce((s, t) => s + t.pnlPerShare, 0);
  const worstDd = Math.min(0, ...trades.map((t) => t.maxDrawdown));
  const avg = trades.length ? pnl / trades.length : 0;
  console.log(
    `${label.padEnd(22)} n=${String(trades.length).padStart(3)} ` +
      `win=${String(wins).padStart(3)} loss=${String(losses).padStart(3)} ` +
      `pnl/sh=${pnl.toFixed(3).padStart(8)} avg=${avg.toFixed(4).padStart(8)} ` +
      `worstDD=${worstDd.toFixed(3)}`,
  );
}

async function loadSeries(
  client: ReturnType<typeof getPolymarketClient>,
  buckets: BucketRow[],
): Promise<BucketSeries[]> {
  const series: BucketSeries[] = [];
  for (const bucket of buckets) {
    try {
      const { history } = await client.getPricesHistory(bucket.yesTokenId, {
        interval: "max",
        fidelity: 10,
      });
      if (history.length > 0) series.push({ bucket, history });
    } catch (err) {
      console.warn(`  skip ${bucket.groupItemTitle}: ${err}`);
    }
  }
  await new Promise((r) => setTimeout(r, 100));
  return series;
}

async function main(): Promise<void> {
  const config = getConfig();
  const db = getDb();
  const client = getPolymarketClient();

  const cfg: PolicyConfig = {
    min: config.strategy.minNoEntryPrice,
    max: config.strategy.maxNoEntryPrice,
    lookbackHours: config.strategy.entryDipLookbackHours,
    confirmHours: config.strategy.entryConfirmHours,
    epsilon: config.strategy.entryReboundEpsilon,
    minRiskReward: config.strategy.entryMinRiskReward,
    stopBuffer: config.strategy.riskAnchorBuffer,
    floor: config.strategy.stopFloor,
  };

  const closed = await db
    .select()
    .from(schema.distributionCampaigns)
    .where(eq(schema.distributionCampaigns.closed, true));
  if (closed.length === 0) {
    console.log("No closed campaigns yet — nothing to replay.");
    process.exit(0);
  }

  const allBuckets = await db
    .select()
    .from(schema.distributionBuckets)
    .where(
      inArray(
        schema.distributionBuckets.campaignId,
        closed.map((c) => c.id),
      ),
    );

  const trades: SimTrade[] = [];
  for (const c of closed) {
    const buckets = allBuckets.filter((b) => b.campaignId === c.id);
    if (buckets.length === 0) continue;
    console.log(`Fetching: ${c.title} (${buckets.length} buckets)`);
    const series = await loadSeries(client, buckets);
    trades.push(...replayCampaign(c, series, cfg));
  }

  console.log(`\n=== PnL over ${closed.length} closed campaigns (floor stop) ===`);
  summarize("recovery + R:R", trades);
  console.log(
    "\nNote: history is trade/mid price, not the ask; carries ~spread/2 error.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
