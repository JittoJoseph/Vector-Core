export const WEATHER_CITIES = [
  "Wellington",
  "Taipei",
  "London",
  "Shenzhen",
  "Hong Kong",
  "Seoul",
  "Guangzhou",
  "Shanghai",
  "Chengdu",
  "Beijing",
  "Tokyo",
  "Madrid",
  "Kuala Lumpur",
  "Milan",
  "Paris",
  "Chongqing",
  "Houston",
  "Sao Paulo",
  "Los Angeles",
  "Singapore",
  "Istanbul",
  "Dallas",
  "NYC",
  "Busan",
  "Seattle",
  "Ankara",
  "Wuhan",
  "Jeddah",
] as const;

export const WEATHER_TAG_ID = "84";

const CAMPAIGN_TITLE_REGEX = new RegExp(
  `^Highest temperature in (?:${WEATHER_CITIES.join("|")}) on [A-Za-z]+ \\d+\\?$`,
);

export function isSupportedWeatherCampaign(
  title: string | null | undefined,
): boolean {
  return CAMPAIGN_TITLE_REGEX.test(title ?? "");
}

export function parseBucketMinMax(title: string): [number, number] {
  const value = parseFloat(title.replace(/°\s*[CF]/gi, "").trim());
  const normalized = title.toLowerCase();
  if (normalized.includes("or below")) return [-Infinity, value];
  if (normalized.includes("or higher")) return [value, Infinity];
  return [value, value];
}

export const MIN_MODAL_CONVICTION = 0.65;

export interface Ladder<T> {
  sorted: T[];
  modalIndex: number;
  modal: T;
  conviction: number;
  isPeaked: boolean;
}

export function analyzeLadder<
  T extends { groupItemTitle: string; yesPrice: string | null },
>(buckets: T[]): Ladder<T> | null {
  if (buckets.length === 0) return null;
  const sorted = [...buckets].sort(
    (a, b) =>
      parseBucketMinMax(a.groupItemTitle)[0] -
      parseBucketMinMax(b.groupItemTitle)[0],
  );
  let modalIndex = 0;
  let conviction = -1;
  sorted.forEach((b, i) => {
    const yes = parseFloat(b.yesPrice ?? "0");
    if (yes > conviction) {
      conviction = yes;
      modalIndex = i;
    }
  });
  return {
    sorted,
    modalIndex,
    modal: sorted[modalIndex]!,
    conviction,
    isPeaked: conviction >= MIN_MODAL_CONVICTION,
  };
}

export function isRelevantBucket(
  noPrice: number,
  maxNoEntryPrice: number,
  hasOpenPosition: boolean,
): boolean {
  return (
    hasOpenPosition || Number.isNaN(noPrice) || noPrice <= maxNoEntryPrice + 0.1
  );
}
