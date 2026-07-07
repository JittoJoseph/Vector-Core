"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getApiClient, getWsClient } from "./api-client";
import { formatPnl } from "./utils";
import type {
  SimulatedTrade,
  SystemStats,
  DistributionCampaign,
  PerformanceMetrics,
  StrategyView,
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

/**
 * Helper hook to lazily fetch data exactly once when enabled becomes true.
 */
function useFetchOnce(
  enabled: boolean,
  action: () => void,
  deps: React.DependencyList = [],
) {
  const hasFetched = useRef(false);
  useEffect(() => {
    if (enabled && !hasFetched.current) {
      hasFetched.current = true;
      action();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
}

/**
 * Helper hook to cleanly subscribe to a WebSocket event.
 */
function useWsEvent<T>(eventName: string, handler: (data: T) => void) {
  useEffect(() => {
    const ws = getWsClient();
    ws.connect();
    return ws.on(eventName, (msg) => handler(msg.data as T));
  }, [eventName, handler]);
}

export function usePositions() {
  const [positions, setPositions] = useState<SimulatedTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchPositions = useCallback(async () => {
    try {
      setLoading(true);
      const api = getApiClient();
      const response = await api.getPositions();
      setPositions((prev) => {
        // Merge: keep any positions that were added via WS while fetching
        const existingIds = new Set(prev.map((t) => t.id));
        const missingFromWs = response.filter((t) => !existingIds.has(t.id));
        return [...missingFromWs, ...prev];
      });
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
  useWsEvent<{ trade?: SimulatedTrade }>(
    "tradeOpened",
    useCallback((data) => {
      const trade = data?.trade;
      if (!trade || trade.status !== "OPEN") return;
      setPositions((prev) => {
        if (prev.some((t) => t.id === trade.id)) return prev;
        return [trade, ...prev];
      });
    }, []),
  );

  useWsEvent<{ trade?: SimulatedTrade }>(
    "tradeResolved",
    useCallback((data) => {
      const trade = data?.trade;
      if (!trade) return;
      setPositions((prev) => prev.filter((t) => t.id !== trade.id));
    }, []),
  );

  return { positions, loading, error, refetch: fetchPositions };
}

export function useTradeHistory(enabled: boolean = true) {
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
      setTrades((prev) => {
        const existingIds = new Set(prev.map((t) => t.id));
        const missingFromWs = response.filter((t) => !existingIds.has(t.id));
        return [...prev, ...missingFromWs];
      });
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

  useFetchOnce(enabled, fetchTrades, [fetchTrades]);

  useWsEvent<{ trade?: SimulatedTrade }>(
    "tradeResolved",
    useCallback((data) => {
      const trade = data?.trade;
      if (!trade) return;
      setTrades((prev) => {
        if (prev.some((t) => t.id === trade.id)) return prev;
        return [trade, ...prev];
      });
    }, []),
  );

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
      // Merge to ensure we don't overwrite newer WS payloads if they fired during the HTTP fetch
      setStats((prev) => ({ ...response, ...prev }));
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

  // Real-time updates
  useWsEvent<SystemStats>(
    "systemState",
    useCallback((data) => {
      setStats((prev) => ({ ...prev, ...data }));
    }, []),
  );

  return { stats, loading, error, refetch: fetchStats };
}

export function useCampaigns(
  status: "active" | "history" = "active",
  enabled: boolean = true,
) {
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

  useFetchOnce(enabled, fetchCampaigns, [fetchCampaigns, status]);

  return { campaigns, loading, error, refetch: fetchCampaigns };
}

/**
 * Strategy observability view. Fetches only while the Strategy tab is active,
 * with a light refresh matched to the ~60s scan cadence. No polling when the
 * tab is not open.
 */
export function useStrategyView(enabled: boolean) {
  const [view, setView] = useState<StrategyView | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchView = useCallback(async () => {
    try {
      setLoading(true);
      setView(await getApiClient().getStrategyView());
    } catch {
      // transient; keep prior view
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    fetchView();
    const id = setInterval(fetchView, 15000);
    return () => clearInterval(id);
  }, [enabled, fetchView]);

  return { view, loading, refetch: fetchView };
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
      setPerformance((prev) => ({ ...data, ...prev })); // Merge to prevent REST from clobbering WS
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    let cancelled = false;

    const doFetch = async () => {
      try {
        setLoading(true);
        const data = await getApiClient().getPerformance(period);
        if (!cancelled) {
          setPerformance((prev) => ({ ...data, ...prev }));
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
  useWsEvent<{ trade?: SimulatedTrade }>(
    "tradeOpened",
    useCallback((data) => {
      const trade = data?.trade;
      if (!trade) return;

      setPerformance((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          openPositions: prev.openPositions + 1,
        };
      });
    }, []),
  );

  useWsEvent<any>(
    "tradeResolved",
    useCallback((d) => {
      const trade = d?.trade as SimulatedTrade | undefined;
      const isWin = d?.isWin as boolean | undefined;
      const pnl = typeof d?.pnl === "number" ? (d.pnl as number) : 0;

      if (!trade) return;

      setPerformance((prev) => {
        if (!prev) return prev;

        const newWins = prev.wins + (isWin ? 1 : 0);
        const newLosses = prev.losses + (isWin ? 0 : 1);
        const newClosedPositions = newWins + newLosses;
        const oldTotalPnl = parseFloat(prev.totalPnl || "0");
        const newTotalPnl = oldTotalPnl + pnl;

        const newWinRate =
          newClosedPositions > 0
            ? ((newWins / newClosedPositions) * 100).toFixed(2)
            : "0.00";

        const oldBestTrade = parseFloat(prev.largestWin || "0");
        const oldWorstTrade = parseFloat(prev.largestLoss || "0");
        const newBestTrade = Math.max(oldBestTrade, Math.max(0, pnl));
        const newWorstTrade = Math.min(oldWorstTrade, Math.min(0, pnl));

        const newOpenPositions = Math.max(0, prev.openPositions - 1);

        return {
          ...prev,
          totalPnl: newTotalPnl.toString(),
          wins: newWins,
          losses: newLosses,
          winRate: newWinRate,
          largestWin: newBestTrade.toFixed(4),
          largestLoss: newWorstTrade.toFixed(4),
          openPositions: newOpenPositions,
        };
      });
    }, []),
  );

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
export function useActivityLog(enabled: boolean = true) {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const seenIds = useRef<Set<string>>(new Set());

  const fetchAuditLogs = useCallback(() => {
    getApiClient()
      .getAuditLogs({ limit: 30 })
      .then((logs) => {
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
        setLoading(false);
      });
  }, []);

  useFetchOnce(enabled, fetchAuditLogs, [fetchAuditLogs]);

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
