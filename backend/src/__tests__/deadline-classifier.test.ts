import { describe, expect, it } from "vitest";
import {
  classifyEvent,
  normalizeUnderlyingKey,
  parseExplicitDeadline,
} from "../services/deadline-classifier.js";
import type { GammaEvent, GammaMarket } from "../types/index.js";

function market(overrides: Partial<GammaMarket>): GammaMarket {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    question: "US x Iran permanent peace deal by June 7, 2026?",
    outcomes: '["Yes","No"]',
    clobTokenIds: '["yes-token","no-token"]',
    outcomePrices: '["0.045","0.955"]',
    active: true,
    closed: false,
    acceptingOrders: true,
    enableOrderBook: true,
    negRiskOther: false,
    ...overrides,
  } as GammaMarket;
}

function event(markets: GammaMarket[]): GammaEvent {
  return {
    id: "event-1",
    slug: "us-x-iran-permanent-peace-deal-by",
    title: "US x Iran permanent peace deal by...?",
    active: true,
    closed: false,
    markets,
  } as GammaEvent;
}

describe("parseExplicitDeadline", () => {
  it("parses explicit month/day deadlines", () => {
    const now = new Date("2026-06-03T00:00:00Z");
    expect(parseExplicitDeadline("Will X happen by June 3?", now)?.deadlineDate)
      .toBe("2026-06-03");
    expect(
      parseExplicitDeadline("Will X happen by June 15, 2026?", now)
        ?.deadlineDate,
    ).toBe("2026-06-15");
    expect(parseExplicitDeadline("Will X happen by December 31?", now)?.deadlineDate)
      .toBe("2026-12-31");
  });

  it("rejects broad deadline phrases", () => {
    expect(parseExplicitDeadline("Will X happen before 2027?")).toBeNull();
    expect(parseExplicitDeadline("Will X happen in 2026?")).toBeNull();
    expect(parseExplicitDeadline("Will X happen by end of June?")).toBeNull();
  });

  it("normalizes underlying events by removing only explicit date", () => {
    expect(
      normalizeUnderlyingKey("US x Iran permanent peace deal by June 7, 2026?"),
    ).toBe("us x iran permanent peace deal by");
  });
});

describe("classifyEvent", () => {
  it("classifies same underlying event with different explicit dates as a deadline ladder", () => {
    const rows = classifyEvent(
      event([
        market({ id: "m1", question: "US x Iran permanent peace deal by June 7, 2026?" }),
        market({ id: "m2", question: "US x Iran permanent peace deal by June 15, 2026?" }),
      ]),
    );
    expect(rows.every((row) => row.familyKind === "deadline_ladder")).toBe(true);
    expect(rows.every((row) => row.rejectionReason === null)).toBe(true);
  });

  it("drops same-date outcome groups instead of storing watchlist noise", () => {
    const rows = classifyEvent(
      event([
        market({ id: "a", question: "Will Bank A fail by June 30, 2026?" }),
        market({ id: "b", question: "Will Bank B fail by June 30, 2026?" }),
      ]),
    );
    expect(rows).toEqual([]);
  });

  it("drops margin, by-election, and placeholder markets", () => {
    const rows = classifyEvent(
      event([
        market({ id: "margin", question: "Will Karen Bass win by 0-5% by June 30, 2026?" }),
        market({ id: "bye", question: "Will Rebecca win the by-election by June 30, 2026?" }),
        market({ id: "other", question: "Will Person AR win by June 30, 2026?", negRiskOther: true }),
      ]),
    );
    expect(rows).toEqual([]);
  });

  it("drops rejected non-Yes/No markets entirely", () => {
    const rows = classifyEvent(
      event([
        market({
          id: "spread",
          question: "Spread: Spurs (-15.5)",
          outcomes: '["Spurs","Knicks"]',
          clobTokenIds: '["spurs-token","knicks-token"]',
          groupItemTitle: "Spread -15.5",
        }),
      ]),
    );

    expect(rows).toEqual([]);
  });
});
