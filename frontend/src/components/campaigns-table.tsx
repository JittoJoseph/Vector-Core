import React, { useState } from "react";
import { ExternalLink, ChevronDown, ChevronRight } from "lucide-react";
import { useCampaigns, useBuckets } from "@/lib/hooks";

export function CampaignsTable() {
  const { campaigns, loading: campaignsLoading } = useCampaigns();
  const { buckets, loading: bucketsLoading } = useBuckets();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (campaignId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(campaignId)) next.delete(campaignId);
      else next.add(campaignId);
      return next;
    });
  };

  if (campaignsLoading || bucketsLoading) {
    return <div className="p-12 text-center text-muted-foreground animate-pulse font-mono text-xs tracking-widest uppercase">Loading campaigns...</div>;
  }

  if (campaigns.length === 0) {
    return <div className="p-12 text-center text-muted-foreground font-mono text-xs">No active campaigns discovered.</div>;
  }

  return (
    <div className="flex flex-col h-full bg-card/50">
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
              <th className="text-right py-2.5 px-4 font-medium text-muted-foreground tracking-wider text-[10px]">BUCKETS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/10">
            {campaigns.map((c) => {
              const campaignBuckets = buckets.filter((b) => b.campaignId === c.id);
              const isExpanded = expanded.has(c.id);

              return (
                <React.Fragment key={c.id}>
                  <tr
                    className="hover:bg-muted/15 cursor-pointer transition-colors"
                    onClick={() => toggleExpand(c.id)}
                  >
                    <td className="py-3 px-4 text-muted-foreground">
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
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
                      <span className="tabular-nums font-medium">{campaignBuckets.length}</span>
                    </td>
                  </tr>
                  
                  {isExpanded && campaignBuckets.length > 0 && (
                    <tr className="bg-muted/5 border-b-0">
                      <td colSpan={4} className="p-0">
                        <div className="pl-12 pr-4 py-3 border-l-2 border-l-blue-500/30">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-border/10">
                                <th className="text-left pb-2 font-medium text-muted-foreground tracking-wider text-[9px]">BUCKET (LABEL)</th>
                                <th className="text-right pb-2 font-medium text-muted-foreground tracking-wider text-[9px]">YES PRICE</th>
                                <th className="text-right pb-2 font-medium text-muted-foreground tracking-wider text-[9px]">NO PRICE</th>
                                <th className="text-right pb-2 font-medium text-muted-foreground tracking-wider text-[9px]">24H VOL</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/5">
                              {campaignBuckets.map((b) => (
                                <tr key={b.id} className="hover:bg-muted/10 transition-colors">
                                  <td className="py-2.5">
                                    <a
                                      href={`https://polymarket.com/market/${b.id}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-medium text-foreground hover:text-blue-400 inline-flex items-center gap-1 truncate"
                                    >
                                      <span>{b.groupItemTitle}</span>
                                      <ExternalLink size={10} className="text-muted-foreground/40" />
                                    </a>
                                  </td>
                                  <td className="py-2.5 text-right tabular-nums text-emerald-400">
                                    {b.yesPrice ? `${Math.round(parseFloat(b.yesPrice) * 100)}¢` : "—"}
                                  </td>
                                  <td className="py-2.5 text-right tabular-nums text-red-400">
                                    {b.noPrice ? `${Math.round(parseFloat(b.noPrice) * 100)}¢` : "—"}
                                  </td>
                                  <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                                    ${b.volume24h ? parseFloat(b.volume24h).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "0"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                  {isExpanded && campaignBuckets.length === 0 && (
                     <tr className="bg-muted/5 border-b-0">
                       <td colSpan={4} className="pl-12 py-3 text-[10px] text-muted-foreground/60 tracking-wider">
                         No buckets discovered for this campaign yet.
                       </td>
                     </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
