import { describe, expect, it } from "vitest";
import {
  findModalBucket,
  isCandidateBucket,
  yesMassAtOrBelow,
  bucketDistanceBelowModal,
  windowPriceHistory,
  downsamplePriceHistory,
  analyzeRecovery,
  riskReward,
  riskAnchorNoPrice,
  evaluateLadderExit,
} from "../utils/distribution-logic.js";

const ladder = [
  { groupItemTitle: "<100", yesPrice: "0.01" },
  { groupItemTitle: "100-119", yesPrice: "0.03" },
  { groupItemTitle: "120-139", yesPrice: "0.08" },
  { groupItemTitle: "140-159", yesPrice: "0.30" },
  { groupItemTitle: "160-179", yesPrice: "0.35" }, // modal
  { groupItemTitle: "180-199", yesPrice: "0.15" },
  { groupItemTitle: "200+", yesPrice: "0.08" },
];

describe("findModalBucket / isCandidateBucket", () => {
  it("finds the highest-YES bucket", () => {
    expect(findModalBucket(ladder)!.groupItemTitle).toBe("160-179");
  });
  it("candidate iff strictly below modal min", () => {
    expect(isCandidateBucket("120-139", 160)).toBe(true);
    expect(isCandidateBucket("160-179", 160)).toBe(false);
    expect(isCandidateBucket("180-199", 160)).toBe(false);
  });
});

describe("yesMassAtOrBelow", () => {
  it("sums YES at and below the candidate, inclusive", () => {
    // <=139: 0.01 + 0.03 + 0.08 = 0.12
    expect(yesMassAtOrBelow(ladder, "120-139")).toBeCloseTo(0.12);
  });
  it("is just the bottom bucket for the lowest", () => {
    expect(yesMassAtOrBelow(ladder, "<100")).toBeCloseTo(0.01);
  });
  it("treats NaN as zero", () => {
    const noisy = [
      { groupItemTitle: "100-119", yesPrice: "x" },
      { groupItemTitle: "120-139", yesPrice: "0.05" },
    ];
    expect(yesMassAtOrBelow(noisy, "120-139")).toBeCloseTo(0.05);
  });
});

describe("bucketDistanceBelowModal", () => {
  it("is 1 for the bucket adjacent below modal", () => {
    expect(bucketDistanceBelowModal(ladder, "140-159", "160-179")).toBe(1);
  });
  it("counts intermediate buckets", () => {
    expect(bucketDistanceBelowModal(ladder, "100-119", "160-179")).toBe(3);
  });
  it("is 0 at or above modal", () => {
    expect(bucketDistanceBelowModal(ladder, "180-199", "160-179")).toBe(0);
  });
});

describe("windowPriceHistory / downsamplePriceHistory", () => {
  const now = 1_000_000;
  it("keeps only points within the lookback", () => {
    const h = [
      { t: now - 30 * 3600, p: 0.7 },
      { t: now - 1 * 3600, p: 0.9 },
    ];
    expect(windowPriceHistory(h, now, 24)).toEqual([{ t: now - 3600, p: 0.9 }]);
  });
  it("caps points while preserving first/last/min/max", () => {
    const long = Array.from({ length: 200 }, (_, i) => ({
      t: i,
      p: 0.9 - Math.sin(i / 10) * 0.1,
    }));
    const r = downsamplePriceHistory(long, 20);
    expect(r.length).toBeLessThanOrEqual(20);
    expect(r[0]).toEqual(long[0]);
    expect(r[r.length - 1]).toEqual(long[long.length - 1]);
  });
});

describe("analyzeRecovery", () => {
  const now = 1_000_000;
  // hourly samples, oldest first
  const hourly = (prices: number[]) =>
    prices.map((p, i) => ({ t: now - (prices.length - 1 - i) * 3600, p }));

  it("detects a genuine V-recovery (dipped then rising now)", () => {
    // dip to 0.80 early, then a clear rise over the last 6h
    const h = hourly([0.95, 0.88, 0.8, 0.82, 0.84, 0.85, 0.86, 0.87, 0.88, 0.9]);
    const r = analyzeRecovery(h, now, 48, 6, 0.03)!;
    expect(r.recentLow).toBeCloseTo(0.8);
    expect(r.rising).toBe(true);
    expect(r.aboveLow).toBe(true);
    expect(r.isRecovery).toBe(true);
  });

  it("rejects a stale spike that already recovered and went flat (the bug case)", () => {
    // deep low long ago, then flat ~0.80 for many hours — no current momentum
    const h = hourly([0.34, 0.5, 0.7, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8]);
    const r = analyzeRecovery(h, now, 48, 6, 0.03)!;
    expect(r.recentLow).toBeCloseTo(0.34);
    expect(r.rising).toBe(false);
    expect(r.isRecovery).toBe(false);
  });

  it("rejects a still-falling price", () => {
    const h = hourly([0.9, 0.88, 0.86, 0.84, 0.82, 0.8, 0.78, 0.76]);
    const r = analyzeRecovery(h, now, 48, 6, 0.03)!;
    expect(r.rising).toBe(false);
    expect(r.isRecovery).toBe(false);
  });

  it("returns null on empty window", () => {
    expect(analyzeRecovery([], now, 48, 6, 0.03)).toBeNull();
  });
});

describe("riskReward / riskAnchorNoPrice", () => {
  it("is upside over downside to the anchor", () => {
    expect(riskReward(0.8, 0.61)).toBeCloseTo(0.2 / 0.19, 3);
    expect(riskReward(0.97, 0.87)).toBeCloseTo(0.3, 2); // the bad 0.32 trade
  });
  it("is Infinity when there is no downside", () => {
    expect(riskReward(0.8, 0.8)).toBe(Infinity);
  });
  it("anchors just below the low, floored", () => {
    expect(riskAnchorNoPrice(0.75, 0.03, 0.6)).toBeCloseTo(0.72);
    expect(riskAnchorNoPrice(0.61, 0.03, 0.6)).toBeCloseTo(0.6);
  });
});

describe("evaluateLadderExit", () => {
  const cfg = { massRise: 0.1, modalDistanceExit: 1 };
  it("holds when nothing migrated", () => {
    expect(evaluateLadderExit(0.05, 0.05, 3, cfg).exit).toBe(false);
  });
  it("exits when mass at-or-below rises past the threshold", () => {
    const r = evaluateLadderExit(0.05, 0.2, 3, cfg);
    expect(r).toEqual({ exit: true, reason: "mass-migrated" });
  });
  it("exits when the modal migrates within range", () => {
    const r = evaluateLadderExit(0.05, 0.05, 1, cfg);
    expect(r).toEqual({ exit: true, reason: "modal-migrated" });
  });
});
