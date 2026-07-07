/**
 * Threshold-calibration backtest for the ladder-aware entry gates.
 *
 * Read-only against the DB; fetches Polymarket /prices-history per YES token
 * to reconstruct the ladder over time for closed campaigns, then replays the
 * gated entry policy with per-gate ablation so thresholds can be calibrated.
 *
 * Limitation: prices-history is trade/mid price, not the live ask, so entry
 * and stop levels carry roughly spread/2 of error.
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
  cumulativeYesMassBelow,
  modalMarginBelow,
  bucketDistanceBelowModal,
  campaignAgeFraction,
  analyzeDipRecovery,
  isRecoveryEntryAllowed,
  computeStopNoPrice,
  evaluateSyncEntryGates,
} from "../utils/distribution-logic.js";

const STEP_SEC = 600; // 10-minute grid, matches fidelity=10

interface BucketSeries {
  bucket: typeof schema.distributionBuckets.$inferSelect;
  history: Array<{ t: number; p: number }>; // YES price
}

interface SimTrade {
  campaignId: string;
  bucketTitle: string;
  entryT: number;
  entryNoPrice: number;
  stopNoPrice: number;
  outcome: "WIN" | "STOP" | "OPEN_AT_END";
  exitNoPrice: number;
  pnlPerShare: number;
  maxDrawdown: number;
}

interface GateConfig {
  minCampaignAgeFraction: number;
  maxTailYesMass: number;
  minModalMargin: number;
  dipLookbackHours: number;
  highConfidenceNoPrice: number;
  reboundEpsilon: number;
  stopBufferBelowLow: number;
  stopAbsoluteFloor: number;
  disabled?: string; // gate key to ablate: age|tail|margin|trajectory
}

function yesAt(series: BucketSeries, t: number): number | null {
  // History is sorted ascending; last point at or before t.
  let latest: number | null = null;
  for (const h of series.history) {
    if (h.t > t) break;
    latest = h.p;
  }
  return latest;
}

function replayCampaign(
  campaign: typeof schema.distributionCampaigns.$inferSelect,
  series: BucketSeries[],
  gates: GateConfig,
  entryBand: { min: number; max: number },
): SimTrade[] {
  const allT = series.flatMap((s) => s.history.map((h) => h.t));
  if (allT.length === 0) return [];
  const tStart = Math.min(...allT);
  const tEnd = Math.max(...allT);

  const open = new Map<string, SimTrade>(); // bucketTitle -> trade
  const done: SimTrade[] = [];

  for (let t = tStart; t <= tEnd; t += STEP_SEC) {
    const ladder = series
      .map((s) => ({
        groupItemTitle: s.bucket.groupItemTitle,
        yesPrice: yesAt(s, t),
        series: s,
      }))
      .filter((b) => b.yesPrice !== null);
    if (ladder.length < 2) continue;

    let modal = ladder[0]!;
    for (const b of ladder) if (b.yesPrice! > modal.yesPrice!) modal = b;
    const [modalMin] = parseBucketMinMax(modal.groupItemTitle);
    const modalMargin = modalMarginBelow(ladder, modal.groupItemTitle);
    const age = campaignAgeFraction(
      campaign.startDate,
      campaign.endDate,
      new Date(t * 1000),
    );

    for (const b of ladder) {
      const noPrice = 1 - b.yesPrice!;
      const title = b.groupItemTitle;

      // Track open positions: context-relative stop + drawdown.
      const pos = open.get(title);
      if (pos) {
        pos.maxDrawdown = Math.min(pos.maxDrawdown, noPrice - pos.entryNoPrice);
        if (noPrice <= pos.stopNoPrice) {
          pos.outcome = "STOP";
          pos.exitNoPrice = noPrice;
          pos.pnlPerShare = noPrice - pos.entryNoPrice;
          done.push(pos);
          open.delete(title);
        }
        continue;
      }

      // Entry policy.
      if (!isCandidateBucket(title, modalMin)) continue;
      if (noPrice < entryBand.min || noPrice > entryBand.max) continue;

      const metrics = {
        campaignAgeFraction: age,
        bucketDistance: bucketDistanceBelowModal(
          ladder,
          title,
          modal.groupItemTitle,
        ),
        tailYesMass: cumulativeYesMassBelow(ladder, title),
        modalMargin,
      };
      const gate = evaluateSyncEntryGates(metrics, gates);
      const failed = gate.failed.filter((f) => f !== gates.disabled);
      if (failed.length > 0) continue;

      // Recovery gate (primary). recentLow also anchors the stop.
      const noHistory = b.series.history
        .filter((h) => h.t <= t)
        .map((h) => ({ t: h.t, p: 1 - h.p }));
      const dip = analyzeDipRecovery(
        noHistory,
        t,
        gates.dipLookbackHours,
        gates.reboundEpsilon,
      );
      if (!dip) continue;
      if (gates.disabled !== "trajectory") {
        const recovery = isRecoveryEntryAllowed(dip, noPrice, gates);
        if (!recovery.pass) continue;
      }

      open.set(title, {
        campaignId: campaign.id,
        bucketTitle: title,
        entryT: t,
        entryNoPrice: noPrice,
        stopNoPrice: computeStopNoPrice(
          dip.recentLow,
          gates.stopBufferBelowLow,
          gates.stopAbsoluteFloor,
        ),
        outcome: "OPEN_AT_END",
        exitNoPrice: noPrice,
        pnlPerShare: 0,
        maxDrawdown: 0,
      });
    }
  }

  // Resolve remaining positions from final prices: NO wins if final YES < 0.5.
  for (const pos of open.values()) {
    const s = series.find((x) => x.bucket.groupItemTitle === pos.bucketTitle)!;
    const finalYes = s.history[s.history.length - 1]!.p;
    if (finalYes < 0.5) {
      pos.outcome = "WIN";
      pos.exitNoPrice = 1;
      pos.pnlPerShare = 1 - pos.entryNoPrice;
    } else {
      pos.outcome = "STOP"; // NO lost at resolution
      pos.exitNoPrice = 0;
      pos.pnlPerShare = -pos.entryNoPrice;
    }
    done.push(pos);
  }
  return done;
}

function summarize(label: string, trades: SimTrade[]): void {
  const wins = trades.filter((t) => t.outcome === "WIN").length;
  const stops = trades.filter((t) => t.outcome === "STOP").length;
  const pnl = trades.reduce((s, t) => s + t.pnlPerShare, 0);
  const worstDd = Math.min(0, ...trades.map((t) => t.maxDrawdown));
  console.log(
    `${label.padEnd(24)} entries=${String(trades.length).padStart(3)} ` +
      `wins=${String(wins).padStart(3)} stops=${String(stops).padStart(3)} ` +
      `pnl/share=${pnl.toFixed(3).padStart(8)} worstDrawdown=${worstDd.toFixed(3)}`,
  );
}

async function main(): Promise<void> {
  const config = getConfig();
  const db = getDb();
  const client = getPolymarketClient();

  const campaigns = await db
    .select()
    .from(schema.distributionCampaigns)
    .where(eq(schema.distributionCampaigns.closed, true));

  if (campaigns.length === 0) {
    console.log("No closed campaigns in DB; nothing to backtest.");
    process.exit(0);
  }

  const allBuckets = await db
    .select()
    .from(schema.distributionBuckets)
    .where(
      inArray(
        schema.distributionBuckets.campaignId,
        campaigns.map((c) => c.id),
      ),
    );

  const gateCfg: Omit<GateConfig, "disabled"> = {
    minCampaignAgeFraction: config.strategy.entryMinCampaignAgeFraction,
    maxTailYesMass: config.strategy.entryMaxTailYesMass,
    minModalMargin: config.strategy.entryMinModalMargin,
    dipLookbackHours: config.strategy.entryDipLookbackHours,
    highConfidenceNoPrice: config.strategy.entryHighConfidenceNoPrice,
    reboundEpsilon: config.strategy.entryReboundEpsilon,
    stopBufferBelowLow: config.strategy.stopLossBufferBelowLow,
    stopAbsoluteFloor: config.strategy.stopLossAbsoluteFloor,
  };
  const entryBand = {
    min: config.strategy.minNoEntryPrice,
    max: config.strategy.maxNoEntryPrice,
  };

  const variants: Array<{ label: string; disabled?: string }> = [
    { label: "all gates" },
    { label: "ablate: age", disabled: "age" },
    { label: "ablate: tail", disabled: "tail" },
    { label: "ablate: margin", disabled: "margin" },
    { label: "ablate: trajectory", disabled: "trajectory" },
  ];
  const results = new Map<string, SimTrade[]>(
    variants.map((v) => [v.label, []]),
  );

  for (const campaign of campaigns) {
    const buckets = allBuckets.filter((b) => b.campaignId === campaign.id);
    if (buckets.length === 0) continue;

    console.log(`Fetching history: ${campaign.title} (${buckets.length} buckets)`);
    const series: BucketSeries[] = [];
    for (const bucket of buckets) {
      try {
        const { history } = await client.getPricesHistory(bucket.yesTokenId, {
          interval: "max",
          fidelity: 10,
        });
        if (history.length > 0) series.push({ bucket, history });
      } catch (err) {
        console.warn(`  skipping ${bucket.groupItemTitle}: ${err}`);
      }
    }
    await new Promise((r) => setTimeout(r, 100));

    for (const v of variants) {
      results
        .get(v.label)!
        .push(
          ...replayCampaign(
            campaign,
            series,
            { ...gateCfg, disabled: v.disabled },
            entryBand,
          ),
        );
    }
  }

  console.log(`\n=== Backtest over ${campaigns.length} closed campaigns ===`);
  for (const v of variants) summarize(v.label, results.get(v.label)!);
  console.log(
    "\nNote: history is trade/mid price, not the ask; entries/stops carry ~spread/2 error.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
