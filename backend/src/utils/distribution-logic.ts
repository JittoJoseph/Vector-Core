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

export interface RecoveryMeasurement {
  recentLow: number;
  confirmLow: number;
  lastPrice: number;
}

export interface RecoverySignal {
  rising: boolean;
  aboveLow: boolean;
  isRecovery: boolean;
}

export type RecoveryAnalysis = RecoveryMeasurement & RecoverySignal;
export function recoverySignal(
  m: RecoveryMeasurement,
  epsilon: number,
): RecoverySignal {
  const rising = m.lastPrice - m.confirmLow >= epsilon;
  const aboveLow = m.lastPrice >= m.recentLow + epsilon;
  return { rising, aboveLow, isRecovery: rising && aboveLow };
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
export function measureRecovery(
  history: Array<{ t: number; p: number }>,
  nowSec: number,
  lookbackHours: number,
  confirmHours: number,
): RecoveryMeasurement | null {
  const window = windowPriceHistory(history, nowSec, lookbackHours);
  if (window.length === 0) return null;

  let recentLow = Infinity;
  for (const h of window) if (h.p < recentLow) recentLow = h.p;

  const lastPrice = window[window.length - 1]!.p;

  // Seeded with lastPrice (whose own sample is inside the window), so
  // confirmLow <= lastPrice always.
  const confirmCutoff = nowSec - confirmHours * 3600;
  let confirmLow = lastPrice;
  for (const h of window)
    if (h.t >= confirmCutoff && h.p < confirmLow) confirmLow = h.p;

  return { recentLow, confirmLow, lastPrice };
}
export function analyzeRecovery(
  history: Array<{ t: number; p: number }>,
  nowSec: number,
  lookbackHours: number,
  confirmHours: number,
  epsilon: number,
): RecoveryAnalysis | null {
  const m = measureRecovery(history, nowSec, lookbackHours, confirmHours);
  if (!m) return null;
  return { ...m, ...recoverySignal(m, epsilon) };
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
