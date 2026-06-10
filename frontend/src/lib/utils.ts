import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Returns "text-emerald-500" or "text-red-500" based on sign. Optional opacity suffix e.g. "/70". */
export function pnlColor(value: number, opacity?: string): string {
  const base = value >= 0 ? "text-emerald-500" : "text-red-500";
  return opacity ? `${base}/${opacity}` : base;
}

/** Format a PnL value as "+$0.0123" or "-$0.0456". */
export function formatPnl(value: number, decimals = 4): string {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(decimals)}`;
}

export function polymarketMarketUrl({
  eventSlug,
  marketSlug,
  marketId,
}: {
  eventSlug?: string | null;
  marketSlug?: string | null;
  marketId?: string | null;
}): string {
  if (eventSlug && marketSlug) {
    return `https://polymarket.com/event/${eventSlug}/${marketSlug}`;
  }
  if (eventSlug) return `https://polymarket.com/event/${eventSlug}`;
  if (marketSlug) return `https://polymarket.com/market/${marketSlug}`;
  if (marketId) return `https://polymarket.com/market/${marketId}`;
  return "https://polymarket.com";
}

export function shortCampaignTitle(title: string | null | undefined): string {
  if (!title) return "Unknown Campaign";
  const match = title.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}\s*-\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}/i);
  if (match) {
    return match[0];
  }
  return title;
}
