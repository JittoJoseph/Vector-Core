import {
  type ClassifiedMarket,
  type DeadlineParseResult,
  type GammaEvent,
  type GammaMarket,
} from "../types/index.js";
import { PolymarketClient } from "./polymarket-client.js";

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const MONTH_PATTERN = Object.keys(MONTHS).join("|");
const EXPLICIT_BY_DATE_RE = new RegExp(
  `\\bby\\s+(${MONTH_PATTERN})\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?\\b`,
  "i",
);

const EXCLUDED_TEXT_RE =
  /\b(before\s+\d{4}|in\s+\d{4}|by\s+end\s+of|win\s+by\s+\d+(?:\s*[–-]\s*\d+)?%?|by less than|by more than|by between|by \d+%|by-election)\b/i;

const SPORTS_HINT_RE =
  /\b(vs\.|winner|tournament|match|game|spread|round margin|margin of victory)\b/i;

export function parseExplicitDeadline(
  text: string,
  now = new Date(),
): DeadlineParseResult | null {
  if (EXCLUDED_TEXT_RE.test(text)) return null;
  const match = text.match(EXPLICIT_BY_DATE_RE);
  if (!match) return null;

  const monthName = match[1]!.toLowerCase();
  const day = Number(match[2]);
  const monthIndex = MONTHS[monthName];
  if (monthIndex === undefined || !Number.isInteger(day) || day < 1 || day > 31) {
    return null;
  }

  let year = match[3] ? Number(match[3]) : now.getUTCFullYear();
  let deadline = new Date(Date.UTC(year, monthIndex, day, 23, 59, 59, 999));

  if (!match[3] && deadline.getTime() < now.getTime() - 30 * 24 * 60 * 60 * 1000) {
    year++;
    deadline = new Date(Date.UTC(year, monthIndex, day, 23, 59, 59, 999));
  }

  if (deadline.getUTCMonth() !== monthIndex || deadline.getUTCDate() !== day) {
    return null;
  }

  return {
    deadline,
    deadlineDate: `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(
      day,
    ).padStart(2, "0")}`,
    matchedText: match[0],
  };
}

export function normalizeUnderlyingKey(question: string): string {
  return question
    .replace(EXPLICIT_BY_DATE_RE, "by")
    .replace(/\s+/g, " ")
    .replace(/[?.,]/g, "")
    .trim()
    .toLowerCase();
}

function isEligibleYesNoDeadlineMarket(market: GammaMarket): boolean {
  const question = market.question ?? "";
  const groupTitle = market.groupItemTitle ?? "";
  const text = `${question} ${groupTitle}`;

  if (market.negRiskOther) return false;
  if (market.active !== true) return false;
  if (market.closed === true) return false;
  if (market.acceptingOrders !== true) return false;
  if (market.enableOrderBook !== true) return false;
  if (EXCLUDED_TEXT_RE.test(text)) return false;
  if (SPORTS_HINT_RE.test(text) && !/\bby\s+/.test(question)) return false;
  if (!parseExplicitDeadline(text)) return false;

  const outcomes = PolymarketClient.parseOutcomes(market);
  const tokenIds = PolymarketClient.parseClobTokenIds(market);
  if (outcomes.length !== 2 || tokenIds.length !== 2) return false;
  const yesIndex = outcomes.findIndex((o) => o.toLowerCase() === "yes");
  const noIndex = outcomes.findIndex((o) => o.toLowerCase() === "no");
  if (yesIndex < 0 || noIndex < 0) return false;

  return tokenIds[yesIndex] != null && tokenIds[noIndex] != null;
}

export function classifyEvent(event: GammaEvent): ClassifiedMarket[] {
  const eventId = String(event.id);
  const eventSlug = event.slug ?? eventId;
  const eventTitle = event.title ?? eventSlug;
  const eligible: ClassifiedMarket[] = [];

  for (const market of event.markets ?? []) {
    if (!isEligibleYesNoDeadlineMarket(market)) continue;

    const text = `${market.question ?? ""} ${market.groupItemTitle ?? ""}`;
    const parsed = parseExplicitDeadline(text);
    const outcomes = PolymarketClient.parseOutcomes(market);
    const tokenIds = PolymarketClient.parseClobTokenIds(market);
    const prices = PolymarketClient.parseOutcomePrices(market);
    const yesIndex = outcomes.findIndex((o) => o.toLowerCase() === "yes");
    const noIndex = outcomes.findIndex((o) => o.toLowerCase() === "no");
    const underlyingKey = normalizeUnderlyingKey(market.question ?? eventTitle);

    if (!parsed || yesIndex < 0 || noIndex < 0) continue;

    eligible.push({
      eventId,
      eventSlug,
      eventTitle,
      market,
      underlyingKey,
      deadline: parsed.deadline,
      deadlineDate: parsed.deadlineDate,
      yesTokenId: tokenIds[yesIndex]!,
      noTokenId: tokenIds[noIndex]!,
      outcomes,
      outcomePrices: prices,
      noPrice: prices[noIndex] ?? null,
      familyKind: "single_deadline",
      rejectionReason: null,
    });
  }

  const datesByKey = new Map<string, Set<string>>();
  for (const item of eligible) {
    if (!datesByKey.has(item.underlyingKey)) {
      datesByKey.set(item.underlyingKey, new Set());
    }
    datesByKey.get(item.underlyingKey)!.add(item.deadlineDate);
  }

  return eligible.flatMap((item) => {
    const uniqueDates = datesByKey.get(item.underlyingKey)?.size ?? 1;
    return uniqueDates >= 2
      ? [{ ...item, familyKind: "deadline_ladder" as const }]
      : [];
  });
}
