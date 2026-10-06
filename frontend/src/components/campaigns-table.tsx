import React, { useState } from "react";
import { ChevronRight } from "lucide-react";
import { CampaignDetailPopup } from "./campaign-detail-popup";
import { MarketCountdown } from "./trades-table";
import type { ActiveCampaign, HistoryCampaign, PositionPnl } from "@/lib/types";
import { cents, pnlColor } from "@/lib/utils";

const TH =
  "py-2.5 px-4 font-medium text-muted-foreground tracking-wider text-[10px]";

function Shell({
  loading,
  empty,
  children,
  selectedId,
  onClose,
  positionsPnl,
}: {
  loading: boolean;
  empty: boolean;
  children: React.ReactNode;
  selectedId: string | null;
  onClose: () => void;
  positionsPnl?: Record<string, PositionPnl>;
}) {
  if (loading)
    return (
      <div className="p-12 text-center text-muted-foreground animate-pulse font-mono text-xs tracking-widest uppercase">
        Loading campaigns...
      </div>
    );
  if (empty)
    return (
      <div className="p-12 text-center text-muted-foreground font-mono text-xs">
        No campaigns.
      </div>
    );
  return (
    <div className="flex flex-col h-full bg-card/50 relative">
      <div className="flex-1 overflow-auto">{children}</div>
      {selectedId && (
        <CampaignDetailPopup
          campaignId={selectedId}
          onClose={onClose}
          positionsPnl={positionsPnl}
        />
      )}
    </div>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="p-4 border-b border-border/20 bg-muted/5 flex items-center justify-between">
      <div className="text-[10px] tracking-[0.15em] text-muted-foreground uppercase font-bold">
        {title}
      </div>
      <div className="text-xs font-bold text-foreground">{count}</div>
    </div>
  );
}

export function ActiveCampaignsTable({
  campaigns,
  loading,
  positionsPnl,
}: {
  campaigns: ActiveCampaign[];
  loading: boolean;
  positionsPnl?: Record<string, PositionPnl>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const sections = [
    { title: "FORECAST LIVE", rows: campaigns.filter((c) => c.forecast) },
    { title: "AWAITING FORECAST", rows: campaigns.filter((c) => !c.forecast) },
  ];

  return (
    <Shell
      loading={loading}
      empty={campaigns.length === 0}
      selectedId={selected}
      onClose={() => setSelected(null)}
      positionsPnl={positionsPnl}
    >
      {sections.map((section) => (
        <div key={section.title}>
          <SectionHeader title={section.title} count={section.rows.length} />
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-border/30 sticky top-0 bg-card z-10 shadow-sm">
                <th className={`${TH} text-left w-8`}></th>
                <th className={`${TH} text-left`}>CAMPAIGN</th>
                <th className={`${TH} text-right`}>TIME LEFT</th>
                <th
                  className={`${TH} text-right`}
                  title="WeatherNext 3 forecast daily max (3 h mean, corrected by recent station error)"
                >
                  WN3 MAX
                </th>
                <th className={`${TH} text-right`}>MODEL TOP</th>
                <th className={`${TH} text-right`}>MARKET TOP</th>
                <th
                  className={`${TH} text-right`}
                  title="Largest model-vs-quote gap"
                >
                  EDGE
                </th>
                <th className={`${TH} text-right`}>POS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/10">
              {section.rows.map((c) => (
                <tr
                  key={c.id}
                  className="hover:bg-muted/15 cursor-pointer transition-colors"
                  onClick={() => setSelected(c.id)}
                >
                  <td className="py-3 px-4 text-muted-foreground">
                    <ChevronRight size={14} />
                  </td>
                  <td className="py-3 px-4 min-w-[260px]">
                    <span className="font-medium text-foreground truncate max-w-[380px] block">
                      {c.title}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums font-medium">
                    <MarketCountdown endDate={c.endDate} />
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums text-sky-400">
                    {c.forecast ? `${c.forecast.mu.toFixed(1)}°${c.unit}` : "—"}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    {c.modelTop
                      ? `${c.modelTop.title} ${cents(c.modelTop.p)}`
                      : "—"}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums text-muted-foreground">
                    {c.marketTop
                      ? `${c.marketTop.title} ${cents(c.marketTop.mid)}`
                      : "—"}
                  </td>
                  <td
                    className={`py-3 px-4 text-right tabular-nums font-bold ${
                      c.bestEdge != null && c.bestEdge >= 0.2
                        ? "text-emerald-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    {c.bestEdge != null ? cents(c.bestEdge) : "—"}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums font-medium">
                    {c.positionCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </Shell>
  );
}

export function HistoryCampaignsTable({
  campaigns,
  loading,
}: {
  campaigns: HistoryCampaign[];
  loading: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <Shell
      loading={loading}
      empty={campaigns.length === 0}
      selectedId={selected}
      onClose={() => setSelected(null)}
    >
      <SectionHeader title="CAMPAIGN HISTORY" count={campaigns.length} />
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-border/30 sticky top-0 bg-card z-10 shadow-sm">
            <th className={`${TH} text-left w-8`}></th>
            <th className={`${TH} text-left`}>CAMPAIGN</th>
            <th className={`${TH} text-right`}>RESOLVED</th>
            <th className={`${TH} text-right`}>TRADES</th>
            <th className={`${TH} text-right`}>TOTAL PNL</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/10">
          {campaigns.map((c) => (
            <tr
              key={c.id}
              className="hover:bg-muted/15 cursor-pointer transition-colors"
              onClick={() => setSelected(c.id)}
            >
              <td className="py-3 px-4 text-muted-foreground">
                <ChevronRight size={14} />
              </td>
              <td className="py-3 px-4 min-w-[300px]">
                <span className="font-medium text-foreground truncate max-w-[400px] block">
                  {c.title}
                </span>
              </td>
              <td className="py-3 px-4 text-right tabular-nums text-muted-foreground">
                {new Date(c.closedTime ?? c.endDate).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
              <td className="py-3 px-4 text-right tabular-nums font-medium">
                {c.tradeCount}
              </td>
              <td
                className={`py-3 px-4 text-right tabular-nums font-bold ${c.tradeCount ? pnlColor(c.totalPnl) : ""}`}
              >
                {c.totalPnl > 0 ? "+" : ""}
                {c.totalPnl.toFixed(4)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}
