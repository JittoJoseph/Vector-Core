const HOUR = 3_600_000;
const SIGMA_FLOOR_C = 0.6;
const SIGMA_BY_LEAD_C: [number, number][] = [
  [0, 0.875],
  [18, 0.904],
  [36, 0.95],
  [Infinity, 1.0],
];

export interface FairValue {
  fmaxC: number;
  mu: number;
  sigma: number;
  probs: number[];
}

function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

const normalCdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));

export function sigmaForLead(leadHours: number): number {
  const row = SIGMA_BY_LEAD_C.find(([limit]) => leadHours <= limit)!;
  return Math.max(SIGMA_FLOOR_C, row[1]);
}

export function localDayMaxC(
  temps: number[],
  init: number,
  dayStart: number,
): number | null {
  let max = -Infinity;
  let covered = 0;
  for (let o = 0; o < temps.length; o++) {
    const valid = init + (o + 1) * HOUR;
    if (valid < dayStart || valid >= dayStart + 24 * HOUR) continue;
    const t = temps[o];
    if (t === undefined || !Number.isFinite(t)) return null;
    covered++;
    if (t > max) max = t;
  }
  return covered === 24 ? max : null;
}

export function fairValue(params: {
  fmaxC: number;
  dayStart: number;
  now: number;
  biasC: number;
  fahrenheit: boolean;
  ranges: [number, number][];
}): FairValue {
  const { fmaxC } = params;
  const toUnit = (c: number) => (params.fahrenheit ? c * 1.8 + 32 : c);
  const mu = toUnit(fmaxC + params.biasC);
  const sigma =
    sigmaForLead((params.dayStart - params.now) / HOUR) *
    (params.fahrenheit ? 1.8 : 1);
  const raw = params.ranges.map(
    ([lo, hi]) => normalCdf((hi - mu) / sigma) - normalCdf((lo - mu) / sigma),
  );
  const total = raw.reduce((a, b) => a + b, 0);
  return {
    fmaxC,
    mu,
    sigma,
    probs: raw.map((p) => Math.min(0.995, Math.max(0.002, p / total))),
  };
}

export function winnerTempC(
  range: [number, number],
  fahrenheit: boolean,
): number | null {
  const [lo, hi] = range;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const mid = (lo + hi) / 2;
  return fahrenheit ? (mid - 32) / 1.8 : mid;
}
