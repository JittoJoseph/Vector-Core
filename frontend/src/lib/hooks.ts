"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getApiClient, getWsClient } from "./api-client";
import { formatPnl } from "./utils";
import type {
  SimulatedTrade,
  SystemStats,
  LiveMarketInfo,
  DistributionBucket,
  DistributionCampaign,
  PerformanceMetrics,
  AuditLog,
  ActivityEntry,
  WsMessage,
} from "./types";

/**
 * WS-driven trades hook with pagination.
 * - Initial load via REST (PAGE_SIZE=25)
 * - loadMore() fetches the next 25 from the DB
 * - tradeOpened → prepend to list
 * - tradeResolved / stopLossTriggered → update in place
 * No periodic polling.
 */
const PAGE_SIZE = 25;

export function usePositions() {
  const [positions, setPositions] = useState<SimulatedTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchPositions = useCallback(async () => {
    try {
      setLoading(true);
      const api = getApiClient();
      const response = await api.getPositions();
      setPositions(response);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  // WS-driven updates
  useEffect(() => {
    const ws = getWsClient();
    ws.connect();

    const unsubOpened = ws.on("tradeOpened", (msg: WsMessage) => {
      const trade = (msg.data as { trade?: SimulatedTrade })?.trade;
      if (!trade || trade.status !== "OPEN") return;
      setPositions((prev) => {
        if (prev.some((t) => t.id === trade.id)) return prev;
        return [trade, ...prev];
      });
    });

    const unsubResolved = ws.on("tradeResolved", (msg: WsMessage) => {
      const trade = (msg.data as { trade?: SimulatedTrade })?.trade;
      if (!trade) return;
      // Remove it from positions when resolved
      setPositions((prev) => prev.filter((t) => t.id !== trade.id));
    });

    return () => {
      unsubOpened();
      unsubResolved();
    };
  }, []);

  return { positions, loading, error, refetch: fetchPositions };
}

export function useTradeHistory() {
  const [trades, setTrades] = useState<SimulatedTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const dbFetchedRef = useRef(0);

  const fetchTrades = useCallback(async () => {
    try {
      setLoading(true);
      dbFetchedRef.current = 0;
      const api = getApiClient();
      const response = await api.getTradeHistory({
        limit: PAGE_SIZE,
        offset: 0,
      });
      setTrades(response);
      dbFetchedRef.current = response.length;
      setHasMore(response.length === PAGE_SIZE);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    try {
      setLoadingMore(true);
      const api = getApiClient();
      const response = await api.getTradeHistory({
        limit: PAGE_SIZE,
        offset: dbFetchedRef.current,
      });
      dbFetchedRef.current += response.length;
      setTrades((prev) => {
        const ids = new Set(prev.map((t) => t.id));
        return [...prev, ...response.filter((t) => !ids.has(t.id))];
      });
      setHasMore(response.length === PAGE_SIZE);
    } catch {
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore]);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  useEffect(() => {
    const ws = getWsClient();
    ws.connect();

    const unsubResolved = ws.on("tradeResolved", (msg: WsMessage) => {
      const trade = (msg.data as { trade?: SimulatedTrade })?.trade;
      if (!trade) return;
      setTrades((prev) => {
        if (prev.some((t) => t.id === trade.id)) return prev;
        return [trade, ...prev];
      });
    });

    return () => {
      unsubResolved();
    };
  }, []);

  return {
    trades,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    error,
    refetch: fetchTrades,
  };
}

/**
 * Hook to fetch system stats.
 */
export function useSystemStats() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const api = getApiClient();
      const response = await api.getSystemStats();
      setStats(response);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch initial on mount
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Keep updated via WebSocket
  useEffect(() => {
    const ws = getWsClient();
    ws.connect();

    const unsub = ws.on("systemState", (msg: WsMessage) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const incoming = msg.data as any;
      if (!incoming) return;

      setStats((prev) => ({
        ...prev,
        ...incoming,
      }));
    });

    return unsub;
  }, []);

  return { stats, loading, error, refetch: fetchStats };
}

export function useCampaigns(status: "active" | "history" = "active") {
  const [campaigns, setCampaigns] = useState<DistributionCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchCampaigns = useCallback(async () => {
    try {
      setLoading(true);
      const api = getApiClient();
      const response = await api.getCampaigns({ limit: 100, status });
      setCampaigns(response);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns, status]);

  return { campaigns, loading, error, refetch: fetchCampaigns };
}

export function useCampaignDetails(id: string | null) {
  const [details, setDetails] = useState<DistributionCampaign | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchDetails = useCallback(async (campaignId: string) => {
    try {
      setLoading(true);
      const api = getApiClient();
      const response = await api.getCampaignDetails(campaignId);
      setDetails(response);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (id) {
      fetchDetails(id);
    } else {
      setDetails(null);
    }
  }, [id, fetchDetails]);

  return { details, loading, error, refetch: () => id && fetchDetails(id) };
}

/**
 * Enhanced real-time performance hook.
 *
 * - Fetches initial performance data once on mount (for the given period)
 * - When period changes, re-fetches fresh data
 * - Listens to tradeOpened and tradeResolved WS events
 * - Updates metrics in real-time (wins/losses, PnL, ROI, win rate, etc.)
 * - Recalculates derived metrics efficiently
 * - Does NOT poll the API after initial load
 */
export function usePerformanceRealtime(
  period: "1D" | "1W" | "1M" | "ALL" = "1D",
) {
  const [performance, setPerformance] = useState<PerformanceMetrics | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Fetch initial data on mount and when period changes
  const fetchPerformance = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getApiClient().getPerformance(period);
      setPerformance(data);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    let cancelled = false;

    // Define an async IIFE to handle the fetch safely with cancellation
    const doFetch = async () => {
      try {
        setLoading(true);
        const data = await getApiClient().getPerformance(period);
        if (!cancelled) {
          setPerformance(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err as Error);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    doFetch();

    return () => {
      cancelled = true;
    };
  }, [period]);

  // Real-time updates from WebSocket events
  useEffect(() => {
    const ws = getWsClient();
    ws.connect();

    // Handle tradeOpened: increment open positions, deduct cost from cash, add to investedAmount
    const unsubOpened = ws.on("tradeOpened", (msg: WsMessage) => {
      const trade = (msg.data as any)?.trade as SimulatedTrade | undefined;
      if (!trade) return;

      setPerformance((prev) => {
        if (!prev) return prev;
        const actualCost = parseFloat(trade.actualCost || "0");
        const oldCash = parseFloat(prev.cashBalance || "0");
        const oldPositionsValue = parseFloat(prev.openPositionsValue || "0");
        return {
          ...prev,
          openPositions: prev.openPositions + 1,
          cashBalance: Math.max(0, oldCash - actualCost).toFixed(2),
          openPositionsValue: (oldPositionsValue + actualCost).toFixed(2),
        };
      });
    });

    // Handle tradeResolved: update wins/losses, PnL, and derived metrics
    const unsubResolved = ws.on("tradeResolved", (msg: WsMessage) => {
      const d = msg.data as any;
      const trade = d?.trade as SimulatedTrade | undefined;
      const isWin = d?.isWin as boolean | undefined;
      const pnl = typeof d?.pnl === "number" ? (d.pnl as number) : 0;

      if (!trade) return;

      setPerformance((prev) => {
        if (!prev) return prev;

        // Update win/loss counts
        const newWins = prev.wins + (isWin ? 1 : 0);
        const newLosses = prev.losses + (isWin ? 0 : 1);
        const newClosedPositions = newWins + newLosses;

        // Update PnL values
        const oldTotalPnl = parseFloat(prev.totalPnl || "0");
        const newTotalPnl = oldTotalPnl + pnl;

        // When a trade settles, cash is returned (actualCost) + pnl added back
        const actualCost = parseFloat(trade.actualCost || "0");
        const oldCashBalance = parseFloat(prev.cashBalance || "0");
        const newCashBalance = oldCashBalance + actualCost + pnl;

        // Reduce open positions value by the cost that was deployed
        const oldOpenPositionsValue = parseFloat(
          prev.openPositionsValue || "0",
        );
        const newOpenPositionsValue = Math.max(
          0,
          oldOpenPositionsValue - actualCost,
        );

        // ROI = (portfolioValue - initialCapital) / initialCapital × 100
        // (same formula as the backend performance-calculator)
        const initialCapital = parseFloat(prev.initialCapital || "0");
        const newPortfolioValue = newCashBalance + newOpenPositionsValue;
        const newRoi =
          initialCapital > 0
            ? ((newPortfolioValue - initialCapital) / initialCapital) * 100
            : 0;

        // Calculate win rate
        const newWinRate =
          newClosedPositions > 0
            ? ((newWins / newClosedPositions) * 100).toFixed(2)
            : "0.00";

        // Track best and worst trades
        const oldBestTrade = parseFloat(prev.largestWin || "0");
        const oldWorstTrade = parseFloat(prev.largestLoss || "0");
        const newBestTrade = Math.max(oldBestTrade, Math.max(0, pnl));
        const newWorstTrade = Math.min(oldWorstTrade, Math.min(0, pnl));

        // Update open positions
        const newOpenPositions = Math.max(0, prev.openPositions - 1);

        return {
          ...prev,
          totalPnl: newTotalPnl.toString(),
          roi: newRoi.toFixed(2),
          wins: newWins,
          losses: newLosses,
          winRate: newWinRate,
          cashBalance: newCashBalance.toFixed(2),
          openPositionsValue: newOpenPositionsValue.toFixed(2),
          largestWin: newBestTrade.toFixed(4),
          largestLoss: newWorstTrade.toFixed(4),
          openPositions: newOpenPositions,
        };
      });
    });

    return () => {
      unsubOpened();
      unsubResolved();
    };
  }, []);

  return { performance, loading, error, refetch: fetchPerformance };
}

/**
 * Hook for WebSocket connection status.
 * Sends a JSON ping to the backend every 15 s; isConnected flips to true
 * only after receiving a pong, and resets to false if none arrives within 20 s.
 */
export function useWsConnection() {
  const [isConnected, setIsConnected] = useState(false);
  const pongTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const ws = getWsClient();
    ws.connect();

    const resetPongTimeout = () => {
      if (pongTimerRef.current) clearTimeout(pongTimerRef.current);
      // If no pong within 20 s, mark disconnected
      pongTimerRef.current = setTimeout(() => setIsConnected(false), 20_000);
    };

    // Listen for pong responses
    const unsubPong = ws.on("pong", () => {
      setIsConnected(true);
      resetPongTimeout();
    });

    // Send ping now and every 15 s
    const sendPing = () => ws.sendPing();
    sendPing();
    const pingInterval = setInterval(sendPing, 15_000);

    return () => {
      unsubPong();
      clearInterval(pingInterval);
      if (pongTimerRef.current) clearTimeout(pongTimerRef.current);
    };
  }, []);

  return isConnected;
}

/**
 * Hook to track system status and connectivity.
 */
export function useSystemStatus() {
  const [backendActive, setBackendActive] = useState(true);
  const wsConnected = useWsConnection();

  useEffect(() => {
    const checkBackend = async () => {
      try {
        const api = getApiClient();
        await api.ping();
        setBackendActive(true);
      } catch {
        setBackendActive(false);
      }
    };

    checkBackend();
  }, []);

  return { backendActive, wsConnected };
}

// ── helper: map AuditLog → ActivityEntry ─────────────────────────────────────
function auditLogToActivity(log: AuditLog): ActivityEntry {
  const cat = log.category?.toUpperCase() ?? "";
  let kind: ActivityEntry["kind"] = "INFO";
  if (cat.includes("TRADE_RESOLVED") || cat.includes("TRADE_SETTLED"))
    kind = "TRADE_WIN"; // will be refined below by level
  else if (cat.includes("TRADE_OPENED")) kind = "TRADE_OPENED";
  else if (cat.includes("TRADE_FORCE") || cat.includes("LOSS"))
    kind = "TRADE_LOSS";
  else if (cat.includes("SKIP") || cat.includes("MOMENTUM"))
    kind = "MOMENTUM_SKIP";
  else if (cat.includes("MARKET")) kind = "MARKET_RESOLVED";
  else if (log.level === "warn") kind = "WARN";
  else if (log.level === "error") kind = "ERROR";

  // Refine TRADE_RESOLVED: look at metadata for outcome
  if (kind === "TRADE_WIN" && log.metadata) {
    const outcome = (log.metadata as any)?.outcome as string | undefined;
    if (outcome === "LOSS") kind = "TRADE_LOSS";
  }

  const pnl =
    log.metadata && typeof (log.metadata as any).pnl === "number"
      ? (log.metadata as any).pnl
      : undefined;

  return {
    id: log.id,
    kind,
    title: log.category ?? "EVENT",
    detail: log.message,
    ts: new Date(log.createdAt).getTime(),
    pnl,
  };
}

const MAX_ACTIVITY_ENTRIES = 100;

/**
 * Activity log hook.
 *
 * - Seeds from GET /api/audit?limit=30 at mount (one-time REST call)
 * - Appends real-time entries from `tradeOpened` and `tradeResolved` WS events
 * - Never polls the API again after initial load
 * - Capped at MAX_ACTIVITY_ENTRIES to prevent unbounded growth
 */
export function useActivityLog() {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const seenIds = useRef<Set<string>>(new Set());

  // One-time REST seed on mount
  useEffect(() => {
    let cancelled = false;
    getApiClient()
      .getAuditLogs({ limit: 30 })
      .then((logs) => {
        if (cancelled) return;
        const entries = logs
          .map(auditLogToActivity)
          .sort((a, b) => b.ts - a.ts); // newest first
        entries.forEach((e) => seenIds.current.add(e.id));
        setActivities(entries);
      })
      .catch(() => {
        /* silently skip if backend not ready */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Real-time: tradeOpened
  useEffect(() => {
    const ws = getWsClient();
    ws.connect();

    const unsubOpened = ws.on("tradeOpened", (msg: WsMessage) => {
      const trade = (msg.data as any)?.trade as SimulatedTrade | undefined;
      if (!trade) return;
      const id = `opened-${trade.id}`;
      if (seenIds.current.has(id)) return;
      seenIds.current.add(id);

      const outcome = trade.outcomeLabel ?? "??";
      const price = trade.entryPrice
        ? `@${(parseFloat(trade.entryPrice) * 100).toFixed(1)}¢`
        : "";

      const entry: ActivityEntry = {
        id,
        kind: "TRADE_OPENED",
        title: "TRADE OPENED",
        detail: `${outcome} ${price} — $${trade.actualCost}`,
        ts: Date.now(),
        trade,
      };

      setActivities((prev) => [entry, ...prev].slice(0, MAX_ACTIVITY_ENTRIES));
    });

    // Real-time: tradeResolved
    const unsubResolved = ws.on("tradeResolved", (msg: WsMessage) => {
      const d = msg.data as any;
      const trade = d?.trade as SimulatedTrade | undefined;
      const isWin = d?.isWin as boolean | undefined;
      const pnl = typeof d?.pnl === "number" ? (d.pnl as number) : undefined;

      const id = `resolved-${trade?.id ?? Date.now()}`;
      if (seenIds.current.has(id)) return;
      seenIds.current.add(id);

      const kind: ActivityEntry["kind"] = isWin ? "TRADE_WIN" : "TRADE_LOSS";
      const outcome = trade?.outcomeLabel ?? "??";
      const pnlStr = pnl !== undefined ? ` PnL: ${formatPnl(pnl)}` : "";

      const entry: ActivityEntry = {
        id,
        kind,
        title: isWin ? "TRADE WIN ✅" : "TRADE LOSS ❌",
        detail: `${outcome}${pnlStr}`,
        ts: Date.now(),
        trade,
        pnl,
      };

      setActivities((prev) => [entry, ...prev].slice(0, MAX_ACTIVITY_ENTRIES));
    });

    return () => {
      unsubOpened();
      unsubResolved();
    };
  }, []);

  return { activities, loading };
}
