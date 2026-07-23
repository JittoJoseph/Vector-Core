import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Trade } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function pnlColor(value: number, muted = false): string {
  if (muted) return value >= 0 ? "text-emerald-500/80" : "text-red-500/80";
  return value >= 0 ? "text-emerald-500" : "text-red-500";
}

export function formatPnl(value: number, decimals = 4): string {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(decimals)}`;
}

export function polymarketMarketUrl({
  eventSlug,
  marketSlug,
}: {
  eventSlug?: string | null;
  marketSlug?: string | null;
}): string {
  if (eventSlug && marketSlug) {
    return `https://polymarket.com/event/${eventSlug}/${marketSlug}`;
  }
  if (eventSlug) return `https://polymarket.com/event/${eventSlug}`;
  if (marketSlug) return `https://polymarket.com/market/${marketSlug}`;
  return "https://polymarket.com";
}

export function shortCampaignTitle(title: string | null | undefined): string {
  if (!title) return "Unknown Campaign";
  const match = title.match(/^Highest temperature in (.+) on (.+)\?$/);
  if (match) {
    const date = match[2]!.replace(/^([A-Za-z]{3})[a-z]+/, "$1");
    return `${match[1]} · ${date}`;
  }
  return title;
}

export function groupExpirations(openTrades: Trade[]) {
  let closestExpiration: Date | null = null;
  let closestTrades: Trade[] = [];
  const expirationBuckets = { "<24h": 0, "1-3d": 0, "4-7d": 0, ">7d": 0 };
  const now = Date.now();

  for (const t of openTrades) {
    if (!t.campaignEndDate) continue;
    const d = new Date(t.campaignEndDate);
    if (!closestExpiration || d < closestExpiration) {
      closestExpiration = d;
      closestTrades = [t];
    } else if (d.getTime() === closestExpiration.getTime()) {
      closestTrades.push(t);
    }

    const hours = (d.getTime() - now) / (1000 * 60 * 60);
    if (hours < 24) expirationBuckets["<24h"]++;
    else if (hours < 72) expirationBuckets["1-3d"]++;
    else if (hours < 168) expirationBuckets["4-7d"]++;
    else expirationBuckets[">7d"]++;
  }

  return { closestExpiration, closestTrades, expirationBuckets };
}
