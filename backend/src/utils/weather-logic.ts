export const WEATHER_CITIES = [
  "Wellington",
  "Taipei",
  "London",
  "Shenzhen",
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
