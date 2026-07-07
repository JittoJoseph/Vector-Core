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

/** Points at or after `nowSec - lookbackHours`, in original order. */
export function windowPriceHistory(
  history: Array<{ t: number; p: number }>,
  nowSec: number,
  lookbackHours: number,
): Array<{ t: number; p: number }> {
  const cutoff = nowSec - lookbackHours * 3600;
  return history.filter((h) => h.t >= cutoff);
}

/**
 * Caps a price series to at most maxPoints for compact display/storage while
 * always preserving the first point, last point, and the global min/max —
 * so a rendered sparkline never loses the recovery low or high it's meant
 * to show, even after thinning.
 */
export function downsamplePriceHistory(
  history: Array<{ t: number; p: number }>,
  maxPoints: number,
): Array<{ t: number; p: number }> {
  if (history.length <= maxPoints) return history;

  let minIdx = 0;
  let maxIdx = 0;
  for (let i = 1; i < history.length; i++) {
    if (history[i]!.p < history[minIdx]!.p) minIdx = i;
    if (history[i]!.p > history[maxIdx]!.p) maxIdx = i;
  }
  const keep = new Set([0, history.length - 1, minIdx, maxIdx]);
  const remaining = maxPoints - keep.size;
  if (remaining > 0) {
    const stride = history.length / (remaining + 1);
    for (let i = 1; i <= remaining; i++) {
      keep.add(Math.min(history.length - 1, Math.round(i * stride)));
    }
  }
  return Array.from(keep)
    .sort((a, b) => a - b)
    .map((i) => history[i]!);
}

/**
 * `reboundEpsilon` is the single "meaningful move around the recovery low"
 * scale: a drop of at least epsilon counts as a dip, and a rise of at least
 * epsilon back off the low counts as a recovery.
 */
export function analyzeDipRecovery(
  history: Array<{ t: number; p: number }>,
  nowSec: number,
  lookbackHours: number,
  reboundEpsilon: number,
): DipRecoveryAnalysis | null {
  const window = windowPriceHistory(history, nowSec, lookbackHours);
  if (window.length === 0) return null;

  let recentLow = Infinity;
  let recentHigh = -Infinity;
  for (const h of window) {
    if (h.p < recentLow) recentLow = h.p;
    if (h.p > recentHigh) recentHigh = h.p;
  }
  const lastPrice = window[window.length - 1]!.p;
  const dipped = recentHigh - recentLow >= reboundEpsilon;
  const recovered = lastPrice >= recentLow + reboundEpsilon;
  return { recentLow, lastPrice, dipped, recovered, pass: !dipped || recovered };
}

/**
 * Primary entry decision for the recovery strategy. High-confidence prices
 * (a stable or fully-recovered NO near the top of the band) may enter on the
 * lenient dip-recovery pass. Below that threshold we are taking real loss risk,
 * so we demand the entry sit at least one rebound-epsilon above the recovery
 * low — which already implies a real dip happened (a flat low price leaves no
 * room above it) and that price has turned back up, not still hugging the low.
 */
export function isRecoveryEntryAllowed(
  analysis: DipRecoveryAnalysis,
  entryPrice: number,
  cfg: { highConfidenceNoPrice: number; reboundEpsilon: number },
): { pass: boolean; reason: string | null } {
  if (entryPrice >= cfg.highConfidenceNoPrice) {
    return analysis.pass
      ? { pass: true, reason: null }
      : { pass: false, reason: "highband-unrecovered" };
  }
  if (entryPrice < analysis.recentLow + cfg.reboundEpsilon)
    return { pass: false, reason: "lowband-no-recovery" };
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
  // Retained for display/analysis only; no longer a gate (was a no-op at the
  // default distance of 1, which candidate selection already guarantees).
  bucketDistance: number;
  tailYesMass: number;
  modalMargin: number;
}

/** Builds the ladder-gate metric tuple for a candidate bucket (one definition,
 * shared by the scan loop and the strategy view). */
export function buildEntryGateMetrics(
  buckets: Array<{ groupItemTitle: string; yesPrice?: any }>,
  candidateTitle: string,
  modalTitle: string,
  ageFraction: number | null,
  modalMargin: number,
): EntryGateMetrics {
  return {
    campaignAgeFraction: ageFraction,
    bucketDistance: bucketDistanceBelowModal(buckets, candidateTitle, modalTitle),
    tailYesMass: cumulativeYesMassBelow(buckets, candidateTitle),
    modalMargin,
  };
}

export function evaluateSyncEntryGates(
  metrics: EntryGateMetrics,
  cfg: {
    minCampaignAgeFraction: number;
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
