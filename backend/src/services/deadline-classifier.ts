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

function classifyRejection(market: GammaMarket): string | null {
  const question = market.question ?? "";
  const groupTitle = market.groupItemTitle ?? "";
  const text = `${question} ${groupTitle}`;

  if (market.negRiskOther) return "neg_risk_other";
  if (market.active !== true) return "inactive";
  if (market.closed === true) return "closed";
  if (market.acceptingOrders !== true) return "not_accepting_orders";
  if (market.enableOrderBook !== true) return "orderbook_disabled";
  if (EXCLUDED_TEXT_RE.test(text)) return "excluded_deadline_shape";
  if (SPORTS_HINT_RE.test(text) && !/\bby\s+/.test(question)) return "sports_or_winner_group";
  if (!parseExplicitDeadline(text)) return "missing_explicit_month_day_deadline";

  const outcomes = PolymarketClient.parseOutcomes(market);
  const tokenIds = PolymarketClient.parseClobTokenIds(market);
  if (outcomes.length !== 2 || tokenIds.length !== 2) return "not_binary_tokenized";
  const yesIndex = outcomes.findIndex((o) => o.toLowerCase() === "yes");
  const noIndex = outcomes.findIndex((o) => o.toLowerCase() === "no");
  if (yesIndex < 0 || noIndex < 0) return "not_yes_no";

  return null;
}

export function classifyEvent(event: GammaEvent): ClassifiedMarket[] {
  const eventId = String(event.id);
  const eventSlug = event.slug ?? eventId;
  const eventTitle = event.title ?? eventSlug;
  const provisional: ClassifiedMarket[] = [];

  for (const market of event.markets ?? []) {
    const rejectionReason = classifyRejection(market);
    const text = `${market.question ?? ""} ${market.groupItemTitle ?? ""}`;
    const parsed = parseExplicitDeadline(text);
    const outcomes = PolymarketClient.parseOutcomes(market);
    const tokenIds = PolymarketClient.parseClobTokenIds(market);
    const prices = PolymarketClient.parseOutcomePrices(market);
    const yesIndex = outcomes.findIndex((o) => o.toLowerCase() === "yes");
    const noIndex = outcomes.findIndex((o) => o.toLowerCase() === "no");
    const underlyingKey = normalizeUnderlyingKey(market.question ?? eventTitle);

    if (!parsed || yesIndex < 0 || noIndex < 0 || tokenIds[yesIndex] == null || tokenIds[noIndex] == null) {
      provisional.push({
        eventId,
        eventSlug,
        eventTitle,
        market,
        underlyingKey,
        deadline: parsed?.deadline ?? new Date(0),
        deadlineDate: parsed?.deadlineDate ?? "",
        yesTokenId: tokenIds[yesIndex] ?? "",
        noTokenId: tokenIds[noIndex] ?? "",
        outcomes,
        outcomePrices: prices,
        noPrice: prices[noIndex] ?? null,
        familyKind: "single_deadline",
        rejectionReason: rejectionReason ?? "not_classifiable",
      });
      continue;
    }

    provisional.push({
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
      rejectionReason,
    });
  }

  const valid = provisional.filter((m) => !m.rejectionReason);
  const datesByKey = new Map<string, Set<string>>();
  const countByDate = new Map<string, number>();
  for (const item of valid) {
    if (!datesByKey.has(item.underlyingKey)) {
      datesByKey.set(item.underlyingKey, new Set());
    }
    datesByKey.get(item.underlyingKey)!.add(item.deadlineDate);
    countByDate.set(item.deadlineDate, (countByDate.get(item.deadlineDate) ?? 0) + 1);
  }

  return provisional.map((item) => {
    if (item.rejectionReason) return item;
    const uniqueDates = datesByKey.get(item.underlyingKey)?.size ?? 1;
    if (uniqueDates >= 2) return { ...item, familyKind: "deadline_ladder" };
    const sameDateCount = countByDate.get(item.deadlineDate) ?? 1;
    if (sameDateCount >= 2) {
      return {
        ...item,
        familyKind: "same_deadline_group",
        rejectionReason: "same_deadline_group_watchlist_only",
      };
    }
    return item;
  });
}
