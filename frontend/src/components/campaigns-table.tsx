import React, { useState } from "react";
import { ExternalLink, ChevronRight } from "lucide-react";
import { useCampaigns } from "@/lib/hooks";
import { CampaignDetailPopup } from "./campaign-detail-popup";
import type { DistributionCampaign } from "@/lib/types";

export function CampaignsTable() {
  const { campaigns, loading } = useCampaigns();
  const [selectedCampaign, setSelectedCampaign] = useState<DistributionCampaign | null>(null);

  if (loading) {
    return <div className="p-12 text-center text-muted-foreground animate-pulse font-mono text-xs tracking-widest uppercase">Loading campaigns...</div>;
  }

  if (campaigns.length === 0) {
    return <div className="p-12 text-center text-muted-foreground font-mono text-xs">No active campaigns discovered.</div>;
  }

  return (
    <div className="flex flex-col h-full bg-card/50 relative">
      <div className="p-4 border-b border-border/20 bg-muted/5 flex items-center justify-between">
        <div className="text-[10px] tracking-[0.15em] text-muted-foreground uppercase font-bold">
          Active Campaigns
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
              <th className="text-left py-2.5 px-4 font-medium text-muted-foreground tracking-wider text-[10px]">CAMPAIGN</th>
              <th className="text-right py-2.5 px-4 font-medium text-muted-foreground tracking-wider text-[10px]">SERIES</th>
              <th className="text-right py-2.5 px-4 font-medium text-muted-foreground tracking-wider text-[10px]" title="Actionable Candidate Buckets">CANDIDATES</th>
              <th className="text-right py-2.5 px-4 font-medium text-muted-foreground tracking-wider text-[10px]" title="Currently Tracked by WS">TRACKED</th>
              <th className="text-right py-2.5 px-4 font-medium text-muted-foreground tracking-wider text-[10px]">POSITIONS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/10">
            {campaigns.map((c) => (
              <tr
                key={c.id}
                className="hover:bg-muted/15 cursor-pointer transition-colors"
                onClick={() => setSelectedCampaign(c)}
              >
                <td className="py-3 px-4 text-muted-foreground">
                  <ChevronRight size={14} />
                </td>
                <td className="py-3 px-4 min-w-[300px]">
                  <div className="flex flex-col gap-0.5">
                    <a
                      href={`https://polymarket.com/event/${c.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-foreground hover:text-blue-400 inline-flex items-center gap-1.5"
                      title={c.title}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="truncate max-w-[400px]">{c.title}</span>
                      <ExternalLink size={10} className="text-muted-foreground/40 shrink-0" />
                    </a>
                  </div>
                </td>
                <td className="py-3 px-4 text-right text-muted-foreground">
                  {c.seriesSlug ? (
                     <span className="inline-flex items-center text-[9px] font-bold tracking-wider px-2 py-0.5 rounded border border-purple-500/25 bg-purple-500/5 text-purple-400">
                       {c.seriesSlug}
                     </span>
                  ) : "—"}
                </td>
                <td className="py-3 px-4 text-right">
                  <span className="tabular-nums font-medium text-emerald-400">{c.candidateCount ?? 0}</span>
                </td>
                <td className="py-3 px-4 text-right">
                  <span className="tabular-nums font-medium text-blue-400">{c.trackedCount ?? 0}</span>
                </td>
                <td className="py-3 px-4 text-right">
                  <span className="tabular-nums font-medium">{c.positionCount ?? 0}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selectedCampaign && (
        <CampaignDetailPopup campaign={selectedCampaign} onClose={() => setSelectedCampaign(null)} />
      )}
    </div>
  );
}
