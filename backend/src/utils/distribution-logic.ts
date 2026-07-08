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

export function findModalBucket<T extends { yesPrice?: any }>(
  buckets: T[],
): T | undefined {
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

export function isCandidateBucket(
  bucketGroupTitle: string,
  modalMin: number,
): boolean {
  const [, bMax] = parseBucketMinMax(bucketGroupTitle);
  return bMax < modalMin;
}

function toYesPrice(yesPrice: any): number {
  const y = parseFloat(yesPrice?.toString() ?? "0");
  return Number.isNaN(y) ? 0 : y;
}

// P(outcome lands in the candidate bucket or lower). Rising after entry = mass
// migrating onto us; the ladder-denoised exit signal.
export function yesMassAtOrBelow(
  buckets: Array<{ groupItemTitle: string; yesPrice?: any }>,
  candidateTitle: string,
): number {
  const [, candidateMax] = parseBucketMinMax(candidateTitle);
  let mass = 0;
  for (const b of buckets) {
    const [, bMax] = parseBucketMinMax(b.groupItemTitle);
    if (bMax <= candidateMax) mass += toYesPrice(b.yesPrice);
  }
  return mass;
}

// Ladder steps from the candidate up to the modal bucket. Used as an exit
// signal: the modal migrating toward us means the outcome is shifting onto us.
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

export interface RecoveryAnalysis {
  recentLow: number;
  lastPrice: number;
  priorPrice: number;
  rising: boolean;
  aboveLow: boolean;
  isRecovery: boolean;
}

export function windowPriceHistory(
  history: Array<{ t: number; p: number }>,
  nowSec: number,
  lookbackHours: number,
): Array<{ t: number; p: number }> {
  const cutoff = nowSec - lookbackHours * 3600;
  return history.filter((h) => h.t >= cutoff);
}

// Thins a series to <= maxPoints, always keeping the first, last, min and max
// so a rendered sparkline never loses its low or high.
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

// A genuine recovery is upward momentum now (last price up >= epsilon over the
// past confirmHours, and above the lookback low) — not merely sitting above a
// stale minimum.
export function analyzeRecovery(
  history: Array<{ t: number; p: number }>,
  nowSec: number,
  lookbackHours: number,
  confirmHours: number,
  epsilon: number,
): RecoveryAnalysis | null {
  const window = windowPriceHistory(history, nowSec, lookbackHours);
  if (window.length === 0) return null;

  let recentLow = Infinity;
  for (const h of window) if (h.p < recentLow) recentLow = h.p;

  const lastPrice = window[window.length - 1]!.p;
  const priorCutoff = nowSec - confirmHours * 3600;
  const priorPrice = (window.find((h) => h.t >= priorCutoff) ?? window[0]!).p;

  const rising = lastPrice - priorPrice >= epsilon;
  const aboveLow = lastPrice >= recentLow + epsilon;
  return {
    recentLow,
    lastPrice,
    priorPrice,
    rising,
    aboveLow,
    isRecovery: rising && aboveLow,
  };
}

// Upside to resolution over downside to the risk anchor; Infinity if no downside.
export function riskReward(entryPrice: number, riskAnchor: number): number {
  const downside = entryPrice - riskAnchor;
  if (downside <= 0) return Infinity;
  return (1 - entryPrice) / downside;
}

// R:R reference (not a live stop): just below the recovery low, floored.
export function riskAnchorNoPrice(
  recentLow: number,
  bufferBelowLow: number,
  absoluteFloor: number,
): number {
  return Math.max(absoluteFloor, recentLow - bufferBelowLow);
}

// Ladder-based exit: fire only when the outcome has genuinely migrated onto the
// bucket SINCE ENTRY — the modal moved at least modalStepsIn steps closer, or
// mass at-or-below rose by massRise. Both legs measure change since entry, so a
// bucket entered next to the modal doesn't exit unless the modal keeps closing.
export function evaluateLadderExit(
  entryMassAtOrBelow: number,
  currentMassAtOrBelow: number,
  entryDistanceToModal: number,
  currentDistanceToModal: number,
  cfg: { massRise: number; modalStepsIn: number },
): { exit: boolean; reason: string | null } {
  if (entryDistanceToModal - currentDistanceToModal >= cfg.modalStepsIn)
    return { exit: true, reason: "modal-migrated" };
  if (currentMassAtOrBelow - entryMassAtOrBelow >= cfg.massRise)
    return { exit: true, reason: "mass-migrated" };
  return { exit: false, reason: null };
}

export function isRelevantBucket(
  isCandidate: boolean,
  isModal: boolean,
  noPrice: number,
  maxNoEntryPrice: number,
  hasOpenPosition: boolean,
): boolean {
  if (hasOpenPosition || isModal) return true;
  if (
    isCandidate &&
    (noPrice <= maxNoEntryPrice + 0.1 || Number.isNaN(noPrice))
  )
    return true;
  return false;
}
