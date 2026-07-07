import { describe, expect, it } from "vitest";
import {
  cumulativeYesMassBelow,
  modalMarginBelow,
  bucketDistanceBelowModal,
  campaignAgeFraction,
  analyzeDipRecovery,
  windowPriceHistory,
  downsamplePriceHistory,
  isRecoveryEntryAllowed,
  computeStopNoPrice,
  evaluateSyncEntryGates,
} from "../utils/distribution-logic.js";

const ladder = [
  { groupItemTitle: "<100", yesPrice: "0.01" },
  { groupItemTitle: "100-119", yesPrice: "0.03" },
  { groupItemTitle: "120-139", yesPrice: "0.08" },
  { groupItemTitle: "140-159", yesPrice: "0.30" },
  { groupItemTitle: "160-179", yesPrice: "0.35" },
  { groupItemTitle: "180-199", yesPrice: "0.15" },
  { groupItemTitle: "200+", yesPrice: "0.08" },
];

describe("cumulativeYesMassBelow", () => {
  it("sums mass strictly below a middle candidate, excluding self", () => {
    // Below 120-139: <100 (0.01) + 100-119 (0.03) = 0.04. The candidate's own
    // 0.08 is NOT included.
    expect(cumulativeYesMassBelow(ladder, "120-139")).toBeCloseTo(0.04);
  });

  it("is zero for the bottom bucket", () => {
    expect(cumulativeYesMassBelow(ladder, "<100")).toBeCloseTo(0);
  });

  it("covers everything below the open upper bucket, excluding itself", () => {
    // All but 200+ (0.08) → 0.92.
    expect(cumulativeYesMassBelow(ladder, "200+")).toBeCloseTo(0.92);
  });

  it("treats NaN prices as zero", () => {
    const noisy = [
      { groupItemTitle: "100-119", yesPrice: "not-a-number" },
      { groupItemTitle: "120-139", yesPrice: "0.05" },
    ];
    expect(cumulativeYesMassBelow(noisy, "120-139")).toBeCloseTo(0);
  });
});

describe("modalMarginBelow", () => {
  it("returns modal yes minus best challenger below", () => {
    // Modal 160-179 (0.35); best below is 140-159 (0.30).
    expect(modalMarginBelow(ladder, "160-179")).toBeCloseTo(0.05);
  });

  it("returns full modal yes when modal is the bottom bucket", () => {
    const bottomModal = [
      { groupItemTitle: "<100", yesPrice: "0.60" },
      { groupItemTitle: "100-119", yesPrice: "0.40" },
    ];
    expect(modalMarginBelow(bottomModal, "<100")).toBeCloseTo(0.6);
  });
});

describe("bucketDistanceBelowModal", () => {
  it("returns 1 for the bucket adjacent below modal", () => {
    expect(bucketDistanceBelowModal(ladder, "140-159", "160-179")).toBe(1);
  });

  it("counts intermediate buckets", () => {
    expect(bucketDistanceBelowModal(ladder, "100-119", "160-179")).toBe(3);
  });

  it("is order-independent of input array", () => {
    const shuffled = [...ladder].reverse();
    expect(bucketDistanceBelowModal(shuffled, "100-119", "160-179")).toBe(3);
  });

  it("returns 0 for the modal bucket or above", () => {
    expect(bucketDistanceBelowModal(ladder, "180-199", "160-179")).toBe(0);
  });
});

describe("campaignAgeFraction", () => {
  const start = new Date("2026-07-01T00:00:00Z");
  const end = new Date("2026-07-08T00:00:00Z");

  it("returns elapsed fraction mid-campaign", () => {
    const mid = new Date("2026-07-04T12:00:00Z");
    expect(campaignAgeFraction(start, end, mid)).toBeCloseTo(0.5);
  });

  it("clamps before start and after end", () => {
    expect(
      campaignAgeFraction(start, end, new Date("2026-06-30T00:00:00Z")),
    ).toBe(0);
    expect(
      campaignAgeFraction(start, end, new Date("2026-07-09T00:00:00Z")),
    ).toBe(1);
  });

  it("returns null for missing or inverted dates", () => {
    expect(campaignAgeFraction(null, end, end)).toBeNull();
    expect(campaignAgeFraction(start, null, end)).toBeNull();
    expect(campaignAgeFraction(end, start, end)).toBeNull();
  });
});

describe("analyzeDipRecovery", () => {
  const now = 1_000_000;
  const series = (prices: number[]) =>
    prices.map((p, i) => ({ t: now - (prices.length - 1 - i) * 600, p }));

  it("passes a flat series (no meaningful dip)", () => {
    const result = analyzeDipRecovery(series([0.95, 0.95, 0.951]), now, 24, 0.02, 0.02);
    expect(result).toMatchObject({ dipped: false, pass: true });
  });

  it("fails mid-fall (dipped, not recovered)", () => {
    const result = analyzeDipRecovery(series([0.95, 0.92, 0.89]), now, 24, 0.02, 0.02);
    expect(result).toMatchObject({ dipped: true, recovered: false, pass: false });
  });

  it("passes a V-shape recovery", () => {
    const result = analyzeDipRecovery(
      series([0.95, 0.9, 0.88, 0.9, 0.92]),
      now,
      24,
      0.02,
      0.02,
    );
    expect(result).toMatchObject({
      dipped: true,
      recovered: true,
      pass: true,
      recentLow: 0.88,
      lastPrice: 0.92,
    });
  });

  it("returns null on empty or fully-stale history", () => {
    expect(analyzeDipRecovery([], now, 24, 0.02, 0.02)).toBeNull();
    const stale = [{ t: now - 48 * 3600, p: 0.9 }];
    expect(analyzeDipRecovery(stale, now, 24, 0.02, 0.02)).toBeNull();
  });

  it("ignores points outside the lookback window", () => {
    const history = [
      { t: now - 30 * 3600, p: 0.7 }, // outside 24h — must not count as the low
      { t: now - 3600, p: 0.95 },
      { t: now - 600, p: 0.95 },
    ];
    const result = analyzeDipRecovery(history, now, 24, 0.02, 0.02);
    expect(result).toMatchObject({ recentLow: 0.95, dipped: false, pass: true });
  });
});

describe("windowPriceHistory", () => {
  const now = 1_000_000;
  const history = [
    { t: now - 30 * 3600, p: 0.7 },
    { t: now - 20 * 3600, p: 0.8 },
    { t: now - 1 * 3600, p: 0.95 },
  ];

  it("keeps only points at or after the cutoff", () => {
    expect(windowPriceHistory(history, now, 24)).toEqual([
      { t: now - 20 * 3600, p: 0.8 },
      { t: now - 1 * 3600, p: 0.95 },
    ]);
  });

  it("returns everything when the lookback covers the whole series", () => {
    expect(windowPriceHistory(history, now, 48)).toEqual(history);
  });
});

describe("downsamplePriceHistory", () => {
  it("returns the series unchanged when under the cap", () => {
    const short = [
      { t: 1, p: 0.9 },
      { t: 2, p: 0.85 },
    ];
    expect(downsamplePriceHistory(short, 10)).toBe(short);
  });

  it("caps the series while preserving first, last, min, and max", () => {
    const long = Array.from({ length: 200 }, (_, i) => ({
      t: i,
      p: 0.9 - Math.sin(i / 10) * 0.1,
    }));
    const result = downsamplePriceHistory(long, 20);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result[0]).toEqual(long[0]);
    expect(result[result.length - 1]).toEqual(long[long.length - 1]);

    const min = long.reduce((m, h) => (h.p < m.p ? h : m), long[0]!);
    const max = long.reduce((m, h) => (h.p > m.p ? h : m), long[0]!);
    expect(result).toContainEqual(min);
    expect(result).toContainEqual(max);
  });

  it("keeps points sorted by time", () => {
    const long = Array.from({ length: 100 }, (_, i) => ({ t: i, p: i % 7 }));
    const result = downsamplePriceHistory(long, 15);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.t).toBeGreaterThan(result[i - 1]!.t);
    }
  });
});

describe("isRecoveryEntryAllowed", () => {
  const cfg = { highConfidenceNoPrice: 0.9, minReboundFromLow: 0.03 };
  const analysis = (
    over: Partial<Parameters<typeof isRecoveryEntryAllowed>[0]>,
  ) => ({
    recentLow: 0.75,
    lastPrice: 0.8,
    dipped: true,
    recovered: true,
    pass: true,
    ...over,
  });

  it("admits a high-confidence entry on the lenient dip pass", () => {
    expect(isRecoveryEntryAllowed(analysis({}), 0.94, cfg).pass).toBe(true);
  });

  it("rejects a high-confidence entry that dipped and never recovered", () => {
    const res = isRecoveryEntryAllowed(analysis({ pass: false }), 0.94, cfg);
    expect(res).toMatchObject({ pass: false, reason: "highband-unrecovered" });
  });

  it("admits a convincing low-band recovery", () => {
    // entry 0.80, low 0.75 → 5¢ above low, over the 3¢ minimum.
    expect(isRecoveryEntryAllowed(analysis({}), 0.8, cfg).pass).toBe(true);
  });

  it("rejects a flat low bucket with no dip", () => {
    const res = isRecoveryEntryAllowed(analysis({ dipped: false }), 0.8, cfg);
    expect(res).toMatchObject({ pass: false, reason: "lowband-no-dip" });
  });

  it("rejects a low entry still hugging the recovery low", () => {
    // entry 0.76, low 0.75 → only 1¢ above, under the 3¢ minimum.
    const res = isRecoveryEntryAllowed(analysis({}), 0.76, cfg);
    expect(res).toMatchObject({
      pass: false,
      reason: "lowband-too-close-to-low",
    });
  });
});

describe("computeStopNoPrice", () => {
  it("sits a buffer below the recovery low", () => {
    expect(computeStopNoPrice(0.75, 0.03, 0.6)).toBeCloseTo(0.72);
  });

  it("never drops below the absolute floor", () => {
    expect(computeStopNoPrice(0.61, 0.03, 0.6)).toBeCloseTo(0.6);
  });
});

describe("evaluateSyncEntryGates", () => {
  const cfg = {
    minCampaignAgeFraction: 0.3,
    minBucketDistance: 1,
    maxTailYesMass: 0.25,
    minModalMargin: 0.05,
  };
  const passing = {
    campaignAgeFraction: 0.5,
    bucketDistance: 2,
    tailYesMass: 0.1,
    modalMargin: 0.2,
  };

  it("passes when all gates clear", () => {
    expect(evaluateSyncEntryGates(passing, cfg)).toEqual({
      pass: true,
      failed: [],
    });
  });

  it("fails each gate independently", () => {
    expect(
      evaluateSyncEntryGates({ ...passing, campaignAgeFraction: 0.1 }, cfg)
        .failed,
    ).toEqual(["age"]);
    expect(
      evaluateSyncEntryGates({ ...passing, bucketDistance: 0 }, cfg).failed,
    ).toEqual(["distance"]);
    expect(
      evaluateSyncEntryGates({ ...passing, tailYesMass: 0.3 }, cfg).failed,
    ).toEqual(["tail"]);
    expect(
      evaluateSyncEntryGates({ ...passing, modalMargin: 0.02 }, cfg).failed,
    ).toEqual(["margin"]);
  });

  it("passes open when age is unknown", () => {
    expect(
      evaluateSyncEntryGates({ ...passing, campaignAgeFraction: null }, cfg)
        .pass,
    ).toBe(true);
  });
});
