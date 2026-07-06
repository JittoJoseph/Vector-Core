export function parseBucketMinMax(title: string): [number, number] {
  if (title.includes("+")) {
    const val = parseFloat(title.replace("+", ""));
    return [val, Infinity];
  }
  if (title.includes("<")) {
    const val = parseFloat(title.replace("<", ""));
    return [-Infinity, val - 0.0001];
  }
  if (title.includes("-")) {
    const parts = title.split("-");
    return [parseFloat(parts[0] ?? "0"), parseFloat(parts[1] ?? "0")];
  }
  const val = parseFloat(title);
  return [val, val];
}

export function findModalBucket<T extends { yesPrice?: any }>(buckets: T[]): T | undefined {
  if (!buckets || buckets.length === 0) return undefined;
  let modalBucket = buckets[0];
  let maxYes = parseFloat(buckets[0]?.yesPrice?.toString() ?? "0");
  for (const b of buckets) {
    const y = parseFloat(b.yesPrice?.toString() ?? "0");
    if (y > maxYes) {
      maxYes = y;
      modalBucket = b;
    }
  }
  return modalBucket;
}

export function isCandidateBucket(bucketGroupTitle: string, modalMin: number): boolean {
  const [, bMax] = parseBucketMinMax(bucketGroupTitle);
  return bMax < modalMin;
}

function toYesPrice(yesPrice: any): number {
  const y = parseFloat(yesPrice?.toString() ?? "0");
  return Number.isNaN(y) ? 0 : y;
}

export function ladderYesMap(
  buckets: Array<{ groupItemTitle: string; yesPrice?: any }>,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const b of buckets) map[b.groupItemTitle] = toYesPrice(b.yesPrice);
  return map;
}

/**
 * YES mass in buckets strictly below the candidate — the probability the
 * outcome lands even further down the ladder than us, i.e. the risk that
 * downward migration continues past our bucket. Deliberately excludes the
 * candidate's own YES: that is already priced into the entry (a low NO price)
 * and judged by the recovery gate, so folding it in here would just make the
 * gate a proxy for the entry price and reject every low-priced recovery entry.
 */
export function cumulativeYesMassBelow(
  buckets: Array<{ groupItemTitle: string; yesPrice?: any }>,
  candidateTitle: string,
): number {
  const [candidateMin] = parseBucketMinMax(candidateTitle);
  let mass = 0;
  for (const b of buckets) {
    const [, bMax] = parseBucketMinMax(b.groupItemTitle);
    if (bMax < candidateMin) mass += toYesPrice(b.yesPrice);
  }
  return mass;
}

export function modalMarginBelow(
  buckets: Array<{ groupItemTitle: string; yesPrice?: any }>,
  modalTitle: string,
): number {
  const [modalMin] = parseBucketMinMax(modalTitle);
  const modal = buckets.find((b) => b.groupItemTitle === modalTitle);
  const modalYes = toYesPrice(modal?.yesPrice);
  let bestChallenger = 0;
  for (const b of buckets) {
    const [, bMax] = parseBucketMinMax(b.groupItemTitle);
    if (bMax < modalMin) {
      const y = toYesPrice(b.yesPrice);
      if (y > bestChallenger) bestChallenger = y;
    }
  }
  return modalYes - bestChallenger;
}

export function bucketDistanceBelowModal(
  buckets: Array<{ groupItemTitle: string }>,
  candidateTitle: string,
  modalTitle: string,
): number {
  const [, candidateMax] = parseBucketMinMax(candidateTitle);
  const [modalMin] = parseBucketMinMax(modalTitle);
  if (candidateMax >= modalMin) return 0;
  let between = 0;
  for (const b of buckets) {
    const [bMin, bMax] = parseBucketMinMax(b.groupItemTitle);
    if (bMin > candidateMax && bMax < modalMin) between++;
  }
  return between + 1;
}

export function campaignAgeFraction(
  start: Date | null,
  end: Date | null,
  now: Date,
): number | null {
  if (!start || !end) return null;
  const total = end.getTime() - start.getTime();
  if (total <= 0) return null;
  const elapsed = now.getTime() - start.getTime();
  return Math.min(1, Math.max(0, elapsed / total));
}

export interface DipRecoveryAnalysis {
  recentLow: number;
  lastPrice: number;
  dipped: boolean;
  recovered: boolean;
  pass: boolean;
}

export function analyzeDipRecovery(
  history: Array<{ t: number; p: number }>,
  nowSec: number,
  lookbackHours: number,
  dipThreshold: number,
  reboundDelta: number,
): DipRecoveryAnalysis | null {
  const cutoff = nowSec - lookbackHours * 3600;
  const window = history.filter((h) => h.t >= cutoff);
  if (window.length === 0) return null;

  let recentLow = Infinity;
  let recentHigh = -Infinity;
  for (const h of window) {
    if (h.p < recentLow) recentLow = h.p;
    if (h.p > recentHigh) recentHigh = h.p;
  }
  const lastPrice = window[window.length - 1]!.p;
  const dipped = recentHigh - recentLow >= dipThreshold;
  const recovered = lastPrice >= recentLow + reboundDelta;
  return { recentLow, lastPrice, dipped, recovered, pass: !dipped || recovered };
}

/**
 * Primary entry decision for the recovery strategy. High-confidence prices
 * (a stable or fully-recovered NO near the top of the band) may enter on the
 * lenient dip-recovery pass. Below that threshold we are taking real loss risk,
 * so we demand a convincing recovery: an actual dip, a confirmed rebound, and
 * an entry price sitting clearly above the recovery low (not still hugging it).
 */
export function isRecoveryEntryAllowed(
  analysis: DipRecoveryAnalysis,
  entryPrice: number,
  cfg: { highConfidenceNoPrice: number; minReboundFromLow: number },
): { pass: boolean; reason: string | null } {
  if (entryPrice >= cfg.highConfidenceNoPrice) {
    return analysis.pass
      ? { pass: true, reason: null }
      : { pass: false, reason: "highband-unrecovered" };
  }
  if (!analysis.dipped) return { pass: false, reason: "lowband-no-dip" };
  if (!analysis.recovered)
    return { pass: false, reason: "lowband-not-recovered" };
  if (entryPrice < analysis.recentLow + cfg.minReboundFromLow)
    return { pass: false, reason: "lowband-too-close-to-low" };
  return { pass: true, reason: null };
}

/**
 * Context-relative stop for a recovery entry: just below the recovery low that
 * the entry thesis rests on, but never below the absolute floor. Set once at
 * entry — if price breaks back under the level that held, the recovery failed.
 */
export function computeStopNoPrice(
  recentLow: number,
  bufferBelowLow: number,
  absoluteFloor: number,
): number {
  return Math.max(absoluteFloor, recentLow - bufferBelowLow);
}

export interface EntryGateMetrics {
  campaignAgeFraction: number | null;
  bucketDistance: number;
  tailYesMass: number;
  modalMargin: number;
}

export function evaluateSyncEntryGates(
  metrics: EntryGateMetrics,
  cfg: {
    minCampaignAgeFraction: number;
    minBucketDistance: number;
    maxTailYesMass: number;
    minModalMargin: number;
  },
): { pass: boolean; failed: string[] } {
  const failed: string[] = [];
  // Null age (missing campaign dates) passes open; the other gates still protect.
  if (
    metrics.campaignAgeFraction !== null &&
    metrics.campaignAgeFraction < cfg.minCampaignAgeFraction
  )
    failed.push("age");
  if (metrics.bucketDistance < cfg.minBucketDistance) failed.push("distance");
  if (metrics.tailYesMass > cfg.maxTailYesMass) failed.push("tail");
  if (metrics.modalMargin < cfg.minModalMargin) failed.push("margin");
  return { pass: failed.length === 0, failed };
}

export function isRelevantBucket(
  isCandidate: boolean,
  isModal: boolean,
  noPrice: number,
  maxNoEntryPrice: number,
  hasOpenPosition: boolean
): boolean {
  if (hasOpenPosition || isModal) return true;
  if (isCandidate && (noPrice <= maxNoEntryPrice + 0.10 || Number.isNaN(noPrice))) return true;
  return false;
}
