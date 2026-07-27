import { describe, expect, it } from "vitest";
import { nextBelowBand } from "../utils/weather-logic.js";

const MIN = 0.8;
const MAX = 0.85;

function entrySignals(prices: number[]): number[] {
  let belowBand = false;
  const entries: number[] = [];
  for (const p of prices) {
    belowBand = nextBelowBand(belowBand, p, MIN, MAX);
    if (belowBand && p >= MIN && p <= MAX) {
      entries.push(p);
      belowBand = false;
    }
  }
  return entries;
}

describe("upward-crossing entry", () => {
  it("ignores a bucket sitting inside the band", () => {
    expect(
      entrySignals([0.81, 0.81, 0.8, 0.8, 0.81, 0.8, 0.81]),
    ).toEqual([]);
  });

  it("enters when price rises into the band from below", () => {
    expect(entrySignals([0.76, 0.78, 0.79, 0.8, 0.81, 0.82])).toEqual([0.8]);
  });

  it("ignores a bucket falling into the band from above", () => {
    expect(entrySignals([0.95, 0.9, 0.86, 0.84, 0.82])).toEqual([]);
  });

  it("does not re-enter without a fresh crossing", () => {
    expect(entrySignals([0.78, 0.81, 0.83, 0.82, 0.84])).toEqual([0.81]);
  });

  it("re-arms only after dropping below the band again", () => {
    expect(entrySignals([0.78, 0.81, 0.84, 0.77, 0.82])).toEqual([0.81, 0.82]);
  });

  it("skips the band entirely when price jumps over it", () => {
    expect(entrySignals([0.76, 0.9, 0.88])).toEqual([]);
  });

  it("stays disarmed while drifting down inside the band", () => {
    expect(entrySignals([0.9, 0.85, 0.84, 0.83, 0.81])).toEqual([]);
  });
});
