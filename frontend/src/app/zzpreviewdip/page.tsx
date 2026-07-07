"use client";

import { useState } from "react";
import { TradeDetailPopup } from "@/components/trade-detail-popup";
import type { SimulatedTrade } from "@/lib/types";

function makeHistory(now: number) {
  // Dip-then-recover shape: starts ~0.95, falls to ~0.78, recovers to ~0.87.
  const pts: { t: number; p: number }[] = [];
  const hours = 20;
  for (let i = 0; i <= hours * 4; i++) {
    const t = now - (hours * 4 - i) * 900; // 15-min steps
    const frac = i / (hours * 4);
    let p: number;
    if (frac < 0.5) p = 0.95 - frac * 2 * 0.17; // down to 0.78
    else p = 0.78 + (frac - 0.5) * 2 * 0.09; // up to 0.87
    p += Math.sin(i * 1.3) * 0.004;
    pts.push({ t, p: Math.round(p * 1000) / 1000 });
  }
  return pts;
}

function makeTrade(overrides: Partial<SimulatedTrade>): SimulatedTrade {
  const now = Math.floor(Date.now() / 1000);
  const history = makeHistory(now);
  const recentLow = Math.min(...history.map((h) => h.p));
  const entryPrice = 0.865;
  const stopNoPrice = recentLow - 0.03;

  return {
    id: "preview-1",
    campaignId: "c1",
    campaignSlug: "elon-musk-tweets-preview",
    campaignTitle: "Elon Musk # tweets July 7 - July 14, 2026?",
    bucketId: "b1",
    bucketSlug: "b1-slug",
    bucketGroupTitle: "120-139",
    campaignEndDate: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
    tokenId: "tok1",
    outcomeLabel: "No",
    side: "BUY",
    orderType: "FAK",
    entryTs: new Date(now * 1000).toISOString(),
    entryPrice: entryPrice.toFixed(8),
    entryShares: "23.1",
    positionBudget: "20.00",
    actualCost: "20.00",
    entryFees: "0.0421",
    fillStatus: "FULL",
    expectedNetProfit: "3.12",
    noBestBidAtEntry: "0.86",
    noBestAskAtEntry: entryPrice.toFixed(8),
    depthAtLimit: "120",
    exitPrice: null,
    exitTs: null,
    exitOutcome: null,
    exitReason: null,
    realizedPnl: null,
    status: "OPEN",
    modalBucketAtEntry: "180-199",
    minNoPriceDuringPosition: recentLow.toFixed(8),
    stopNoPrice: stopNoPrice.toFixed(8),
    entryGateSnapshot: {
      campaignAgeFraction: 0.46,
      bucketDistance: 2,
      tailYesMass: 0.11,
      modalMargin: 0.08,
      dip: {
        recentLow,
        lastPrice: history[history.length - 1]!.p,
        dipped: true,
        recovered: true,
        pass: true,
      },
      stopNoPrice,
      ladderYes: {},
      priceHistory: history,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export default function PreviewDip() {
  const [which, setWhich] = useState<"open" | "win" | "loss">("open");

  const base = makeTrade({});
  const trade: SimulatedTrade =
    which === "open"
      ? base
      : which === "win"
        ? {
            ...base,
            status: "SETTLED",
            exitOutcome: "WIN",
            exitReason: "RESOLUTION",
            exitPrice: "1.0",
            exitTs: new Date(Date.now() + 3600_000).toISOString(),
            realizedPnl: "3.12",
          }
        : {
            ...base,
            status: "SETTLED",
            exitOutcome: "LOSS",
            exitReason: "EARLY_EXIT",
            exitPrice: base.stopNoPrice,
            exitTs: new Date(Date.now() + 1800_000).toISOString(),
            realizedPnl: "-4.10",
          };

  return (
    <div style={{ padding: 40, background: "#0a0a0a", minHeight: "100vh" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button onClick={() => setWhich("open")}>open</button>
        <button onClick={() => setWhich("win")}>win</button>
        <button onClick={() => setWhich("loss")}>loss</button>
      </div>
      <TradeDetailPopup trade={trade} open={true} onClose={() => {}} />
    </div>
  );
}
