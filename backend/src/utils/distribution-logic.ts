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

// Total mass of candidate and lower buckets. Used for exit signals.
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

// Ladder steps up to the modal bucket. Decreasing distance is an exit signal.
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
  confirmLow: number;
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

// Thins a series to <= maxPoints while preserving extrema for accurate sparklines.
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

// Validates a fresh rebound above the lookback low and the recent confirm window low.
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

  // Lowest price within the confirm window.
  const confirmCutoff = nowSec - confirmHours * 3600;
  let confirmLow = lastPrice;
  for (const h of window)
    if (h.t >= confirmCutoff && h.p < confirmLow) confirmLow = h.p;

  const rising = lastPrice - confirmLow >= epsilon;
  const aboveLow = lastPrice >= recentLow + epsilon;
  return {
    recentLow,
    lastPrice,
    confirmLow,
    rising,
    aboveLow,
    isRecovery: rising && aboveLow,
  };
}

// Reward (upside to 1.0) over Risk (downside to anchor).
export function riskReward(entryPrice: number, riskAnchor: number): number {
  const downside = entryPrice - riskAnchor;
  if (downside <= 0) return Infinity;
  return (1 - entryPrice) / downside;
}

// Risk anchor reference (not a live stop) placed below the recovery low.
export function riskAnchorNoPrice(
  recentLow: number,
  bufferBelowLow: number,
  absoluteFloor: number,
): number {
  return Math.max(absoluteFloor, recentLow - bufferBelowLow);
}

// Ladder-based exit fires if the modal or mass migrates toward us significantly since entry.
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
