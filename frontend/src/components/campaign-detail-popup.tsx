import React, { useEffect } from "react";
import { X, ExternalLink } from "lucide-react";
import type { DistributionCampaign } from "@/lib/types";
import { polymarketMarketUrl } from "@/lib/utils";

export interface CampaignDetailPopupProps {
  campaign: DistributionCampaign;
  onClose: () => void;
}

export function CampaignDetailPopup({ campaign, onClose }: CampaignDetailPopupProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const buckets = campaign.relevantBuckets || [];

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-4xl max-h-[85vh] bg-card border border-border/40 shadow-2xl flex flex-col rounded-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border/20 bg-muted/10">
          <div>
            <h2 className="text-sm font-semibold tracking-wide flex items-center gap-2">
              <a
                href={`https://polymarket.com/event/${campaign.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-blue-400 flex items-center gap-1.5"
              >
                {campaign.title}
                <ExternalLink size={12} className="text-muted-foreground/60" />
              </a>
            </h2>
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest mt-1 flex items-center gap-3">
              <span>SERIES: {campaign.seriesSlug || "NONE"}</span>
              <span>•</span>
              <span>RESOLVES: {campaign.endDate ? new Date(campaign.endDate).toLocaleDateString() : "UNKNOWN"}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-muted/50 rounded-md text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-card">
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 bg-card z-10 border-b border-border/30">
              <tr>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground tracking-wider text-[10px]">BUCKET (LABEL)</th>
                <th className="text-right py-3 px-4 font-medium text-muted-foreground tracking-wider text-[10px]">YES PRICE</th>
                <th className="text-right py-3 px-4 font-medium text-muted-foreground tracking-wider text-[10px]">NO PRICE</th>
                <th className="text-right py-3 px-4 font-medium text-muted-foreground tracking-wider text-[10px]">24H VOL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/10">
              {buckets.map((b) => {
                const isModal = b.groupItemTitle === campaign.modalBucketTitle;
                return (
                  <tr key={b.id} className={`hover:bg-muted/15 transition-colors ${isModal ? 'bg-blue-500/5' : ''}`}>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <a
                          href={polymarketMarketUrl({ eventSlug: campaign.slug, marketSlug: b.slug })}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-foreground hover:text-blue-400 flex items-center gap-1.5"
                        >
                          {b.groupItemTitle}
                          <ExternalLink size={10} className="text-muted-foreground/40" />
                        </a>
                        {isModal && (
                           <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">
                             MODAL
                           </span>
                        )}
                        {b.hasOpenPosition && (
                           <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-500 border border-amber-500/30">
                             POSITION
                           </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums text-emerald-400 font-medium">
                      {b.yesPrice ? `${Math.round(parseFloat(b.yesPrice) * 100)}¢` : "—"}
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums text-red-400 font-medium">
                      {b.noPrice ? `${Math.round(parseFloat(b.noPrice) * 100)}¢` : "—"}
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums text-muted-foreground">
                      ${b.volume24h ? parseFloat(b.volume24h).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "0"}
                    </td>
                  </tr>
                );
              })}
              {buckets.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-muted-foreground/60 tracking-wider">
                    No relevant buckets to display.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
