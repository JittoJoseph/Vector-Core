import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function pnlColor(value: number, opacity?: string): string {
  if (value >= 0) {
    if (opacity === "80") return "text-emerald-500/80";
    return opacity ? `text-emerald-500/${opacity}` : "text-emerald-500";
  } else {
    if (opacity === "80") return "text-red-500/80";
    return opacity ? `text-red-500/${opacity}` : "text-red-500";
  }
}

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
  const match = title.match(/^Highest temperature in (.+) on (.+)\?$/);
  if (match) {
    const date = match[2]!.replace(/^([A-Za-z]{3})[a-z]+/, "$1");
    return `${match[1]} · ${date}`;
  }
  return title;
}

import { SimulatedTrade, LiveMarketPrice } from "./types";

export function calculateTradeUnrealizedPnl(
  trade: SimulatedTrade,
  livePrice: LiveMarketPrice | null
): { pnl: number | null; pnlPct: number | null } {
  const liveMid = livePrice?.mid ?? null;
  if (liveMid === null) return { pnl: null, pnlPct: null };

  const entryPrice = parseFloat(trade.entryPrice || "0");
  const shares = parseFloat(trade.entryShares || "0");
  const fees = parseFloat(trade.entryFees || "0");
  const actualCost = parseFloat(trade.actualCost || "0");

  const pnl = (liveMid - entryPrice) * shares - fees;
  const pnlPct = actualCost > 0 ? (pnl / actualCost) * 100 : null;

  return { pnl, pnlPct };
}

export function aggregatePortfolioMetrics(
  openTrades: SimulatedTrade[],
  livePricesMap: Record<string, LiveMarketPrice>
) {
  let liveUnrealizedPnl = 0;
  let closestExpiration: Date | null = null;
  let closestTrades: SimulatedTrade[] = [];
  const expirationBuckets = { "<24h": 0, "1-3d": 0, "4-7d": 0, ">7d": 0 };

  const now = new Date();

  for (const t of openTrades) {
    const livePrice = t.tokenId ? (livePricesMap[t.tokenId] ?? null) : null;
    const { pnl } = calculateTradeUnrealizedPnl(t, livePrice);
    if (pnl !== null) {
      liveUnrealizedPnl += pnl;
    }

    const endStr = t.campaignEndDate;
    if (endStr) {
      const d = new Date(endStr);
      if (!closestExpiration || d < closestExpiration) {
        closestExpiration = d;
        closestTrades = [t];
      } else if (d.getTime() === closestExpiration.getTime()) {
        closestTrades.push(t);
      }

      const hours = (d.getTime() - now.getTime()) / (1000 * 60 * 60);
      if (hours < 24) expirationBuckets["<24h"]++;
      else if (hours < 72) expirationBuckets["1-3d"]++;
      else if (hours < 168) expirationBuckets["4-7d"]++;
      else expirationBuckets[">7d"]++;
    }
  }

  return {
    liveUnrealizedPnl,
    closestExpiration,
    closestTrades,
    expirationBuckets,
  };
}
