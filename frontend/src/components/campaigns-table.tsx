import React, { useState } from "react";
import { ChevronRight } from "lucide-react";
import { CampaignDetailPopup } from "./campaign-detail-popup";
import { MarketCountdown } from "./trades-table";
import type { Campaign, PositionPnl } from "@/lib/types";

export function CampaignsTable({
  status = "active",
  campaigns,
  loading,
  positionsPnl,
}: {
  status?: "active" | "history";
  campaigns: Campaign[];
  loading: boolean;
  positionsPnl?: Record<string, PositionPnl>;
}) {
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(
    null,
  );

  if (loading) {
    return (
      <div className="p-12 text-center text-muted-foreground animate-pulse font-mono text-xs tracking-widest uppercase">
        Loading campaigns...
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="p-12 text-center text-muted-foreground font-mono text-xs">
        No active campaigns discovered.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card/50 relative">
      <div className="p-4 border-b border-border/20 bg-muted/5 flex items-center justify-between">
        <div className="text-[10px] tracking-[0.15em] text-muted-foreground uppercase font-bold">
          {status === "active" ? "Active Campaigns" : "Campaign History"}
        </div>
        <div className="text-xs font-bold text-foreground">
          {campaigns.length}
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-border/30 sticky top-0 bg-card z-10 shadow-sm">
              <th className="text-left py-2.5 px-4 font-medium text-muted-foreground tracking-wider text-[10px] w-8"></th>
              <th className="text-left py-2.5 px-4 font-medium text-muted-foreground tracking-wider text-[10px]">
                CAMPAIGN
              </th>
              <th className="text-right py-2.5 px-4 font-medium text-muted-foreground tracking-wider text-[10px]">
                {status === "active" ? "TIME LEFT" : "SERIES"}
              </th>
              {status === "active" ? (
                <>
                  <th
                    className="text-right py-2.5 px-4 font-medium text-muted-foreground tracking-wider text-[10px]"
                    title="Actionable Candidate Buckets"
                  >
                    CANDIDATES
                  </th>
                  <th
                    className="text-right py-2.5 px-4 font-medium text-muted-foreground tracking-wider text-[10px]"
                    title="Currently Tracked by WS"
                  >
                    TRACKED
                  </th>
                  <th className="text-right py-2.5 px-4 font-medium text-muted-foreground tracking-wider text-[10px]">
                    POSITIONS
                  </th>
                </>
              ) : (
                <>
                  <th className="text-right py-2.5 px-4 font-medium text-muted-foreground tracking-wider text-[10px]">
                    TRADES
                  </th>
                  <th className="text-right py-2.5 px-4 font-medium text-muted-foreground tracking-wider text-[10px]">
                    TOTAL PNL
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/10">
            {campaigns.map((c) => {
              const historical =
                !Array.isArray(c.historicalTrades) && c.historicalTrades
                  ? c.historicalTrades
                  : null;
              const pnl = historical?.totalPnl ?? 0;
              return (
                <tr
                  key={c.id}
                  className="hover:bg-muted/15 cursor-pointer transition-colors"
                  onClick={() => setSelectedCampaign(c)}
                >
                  <td className="py-3 px-4 text-muted-foreground">
                    <ChevronRight size={14} />
                  </td>
                  <td className="py-3 px-4 min-w-[300px]">
                    <span className="font-medium text-foreground truncate max-w-[400px] block">
                      {c.title}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    {status === "active" ? (
                      c.endDate ? (
                        <span className="tabular-nums font-medium text-foreground">
                          <MarketCountdown endDate={c.endDate} />
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )
                    ) : c.seriesSlug ? (
                      <span className="inline-flex items-center text-[9px] font-bold tracking-wider px-2 py-0.5 rounded border border-purple-500/25 bg-purple-500/5 text-purple-400">
                        {c.seriesSlug}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  {status === "active" ? (
                    <>
                      <td className="py-3 px-4 text-right">
                        <span className="tabular-nums font-medium text-emerald-400">
                          {c.candidateCount ?? 0}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="tabular-nums font-medium text-blue-400">
                          {c.trackedCount ?? 0}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="tabular-nums font-medium">
                          {c.positionCount ?? 0}
                        </span>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-3 px-4 text-right">
                        <span className="tabular-nums font-medium">
                          {historical?.length ?? 0}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span
                          className={`tabular-nums font-bold ${pnl > 0 ? "text-emerald-400" : pnl < 0 ? "text-red-400" : ""}`}
                        >
                          {pnl > 0 ? "+" : ""}
                          {pnl.toFixed(4)}
                        </span>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selectedCampaign && (
        <CampaignDetailPopup
          campaign={selectedCampaign}
          onClose={() => setSelectedCampaign(null)}
          positionsPnl={positionsPnl}
        />
      )}
    </div>
  );
}
