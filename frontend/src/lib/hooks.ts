"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getApiClient, getWsClient } from "./api-client";
import { formatPnl } from "./utils";
import type {
  TradeExit,
  TradeHistoryRow,
  Readiness,
  Trade,
  SystemStats,
  ActiveCampaign,
  HistoryCampaign,
  CampaignDetail,
  PerformanceMetrics,
  AuditLog,
  ActivityEntry,
  WsMessage,
} from "./types";

const PAGE_SIZE = 25;

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
  }, [enabled, ...deps]);
}

function useWsEvent<T>(eventName: string, handler: (data: T) => void) {
  useEffect(() => {
    const ws = getWsClient();
    ws.connect();
    return ws.on(eventName, (msg) => handler(msg.data as T));
  }, [eventName, handler]);
}

export function usePositions() {
  const [positions, setPositions] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchPositions = useCallback(async () => {
    try {
      setLoading(true);
      const response = await getApiClient().getPositions();
      setPositions((prev) => {
        const existingIds = new Set(prev.map((t) => t.id));
        const missing = response.filter((t) => !existingIds.has(t.id));
        return [...missing, ...prev];
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

  useWsEvent<{ trade?: Trade }>(
    "tradeOpened",
    useCallback((data) => {
      const trade = data?.trade;
      if (!trade || trade.status !== "OPEN") return;
      setPositions((prev) =>
        prev.some((t) => t.id === trade.id) ? prev : [trade, ...prev],
      );
    }, []),
  );

  useWsEvent<{ trade?: Trade }>(
    "tradeResolved",
    useCallback((data) => {
      const trade = data?.trade;
      if (!trade) return;
      setPositions((prev) => prev.filter((t) => t.id !== trade.id));
    }, []),
  );

  useWsEvent<{ exit?: TradeExit; trade?: Trade }>(
    "tradeExit",
    useCallback((data) => {
      const exit = data?.exit;
      const trade = data?.trade;
      if (!exit || !trade || trade.status !== "OPEN") return;
      setPositions((prev) =>
        prev.map((t) =>
          t.id === trade.id
            ? {
                ...t,
                ...trade,
                campaignEndDate: t.campaignEndDate,
                exits: [...(t.exits ?? []), exit],
              }
            : t,
        ),
      );
    }, []),
  );

  return { positions, loading, error, refetch: fetchPositions };
}

export function useTradeHistory(enabled: boolean = true) {
  const [rows, setRows] = useState<TradeHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const dbFetchedRef = useRef(0);

  const fetchTrades = useCallback(async () => {
    try {
      setLoading(true);
      dbFetchedRef.current = 0;
      const response = await getApiClient().getTradeHistory({
        limit: PAGE_SIZE,
        offset: 0,
      });
      setRows((prev) => {
        const existingIds = new Set(prev.map((r) => r.exit.id));
        return [
          ...prev,
          ...response.filter((r) => !existingIds.has(r.exit.id)),
        ];
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
      const response = await getApiClient().getTradeHistory({
        limit: PAGE_SIZE,
        offset: dbFetchedRef.current,
      });
      dbFetchedRef.current += response.length;
      setRows((prev) => {
        const ids = new Set(prev.map((r) => r.exit.id));
        return [...prev, ...response.filter((r) => !ids.has(r.exit.id))];
      });
      setHasMore(response.length === PAGE_SIZE);
    } catch {
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore]);

  useFetchOnce(enabled, fetchTrades, [fetchTrades]);

  useWsEvent<{ exit?: TradeExit; trade?: Trade }>(
    "tradeExit",
    useCallback((data) => {
      const exit = data?.exit;
      const trade = data?.trade;
      if (!exit || !trade) return;
      setRows((prev) => {
        if (prev.some((r) => r.exit.id === exit.id)) return prev;
        const exits = [
          ...prev.filter((r) => r.trade.id === trade.id).map((r) => r.exit),
          exit,
        ];
        return [
          { exit, trade: { ...trade, exits } },
          ...prev.map((r) =>
            r.trade.id === trade.id ? { ...r, trade: { ...trade, exits } } : r,
          ),
        ];
      });
    }, []),
  );

  return {
    rows,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    error,
    refetch: fetchTrades,
  };
}

export function useSystemStats() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const response = await getApiClient().getSystemStats();
      setStats(response);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useWsEvent<SystemStats>(
    "systemState",
    useCallback((data) => {
      setStats(data);
    }, []),
  );

  return { stats, loading, error, refetch: fetchStats };
}

function useLazyList<T>(enabled: boolean, load: () => Promise<T[]>) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      setLoading(true);
      setItems(await load());
    } catch {
    } finally {
      setLoading(false);
    }
  }, [load]);

  useFetchOnce(enabled, refetch, [refetch]);
  return { items, loading, refetch };
}

const loadActive = () => getApiClient().getActiveCampaigns();
const loadHistory = () => getApiClient().getHistoryCampaigns();

export function useActiveCampaigns(enabled: boolean) {
  return useLazyList<ActiveCampaign>(enabled, loadActive);
}

export function useHistoryCampaigns(enabled: boolean) {
  return useLazyList<HistoryCampaign>(enabled, loadHistory);
}

export function useCampaignDetails(id: string | null) {
  const [details, setDetails] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchDetails = useCallback(async (campaignId: string) => {
    try {
      setLoading(true);
      const response = await getApiClient().getCampaignDetails(campaignId);
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

export function usePerformance(period: "1D" | "1W" | "1M" | "ALL" = "ALL") {
  const [performance, setPerformance] = useState<PerformanceMetrics | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchPerformance = useCallback(async () => {
    try {
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
    fetchPerformance();
  }, [fetchPerformance]);

  const refetchOnTrade = useCallback(() => {
    fetchPerformance();
  }, [fetchPerformance]);
  useWsEvent("tradeResolved", refetchOnTrade);

  return { performance, loading, error, refetch: fetchPerformance };
}

function useWsConnection() {
  const [isConnected, setIsConnected] = useState(false);
  const pongTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const ws = getWsClient();
    ws.connect();

    const resetPongTimeout = () => {
      if (pongTimerRef.current) clearTimeout(pongTimerRef.current);
      pongTimerRef.current = setTimeout(() => setIsConnected(false), 20_000);
    };

    const unsubPong = ws.on("pong", () => {
      setIsConnected(true);
      resetPongTimeout();
    });

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

export function useSystemStatus() {
  const [backendActive, setBackendActive] = useState(true);
  const wsConnected = useWsConnection();

  useEffect(() => {
    getApiClient()
      .ping()
      .then(() => setBackendActive(true))
      .catch(() => setBackendActive(false));
  }, []);

  return { backendActive, wsConnected };
}

function auditLogToActivity(log: AuditLog): ActivityEntry {
  const outcome = log.metadata?.outcome;
  const pnl =
    typeof log.metadata?.pnl === "number" ? log.metadata.pnl : undefined;
  const kind: ActivityEntry["kind"] =
    log.category === "TRADE_OPENED"
      ? "TRADE_OPENED"
      : log.category === "TRADE_CLOSED"
        ? outcome === "WIN"
          ? "TRADE_WIN"
          : "TRADE_LOSS"
        : log.level === "warn"
          ? "WARN"
          : log.level === "error"
            ? "ERROR"
            : "INFO";
  return {
    id: log.id,
    kind,
    title: log.category,
    detail: log.message,
    ts: new Date(log.createdAt).getTime(),
    pnl,
  };
}

const MAX_ACTIVITY_ENTRIES = 100;

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
          .sort((a, b) => b.ts - a.ts);
        entries.forEach((e) => seenIds.current.add(e.id));
        setActivities(entries);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useFetchOnce(enabled, fetchAuditLogs, [fetchAuditLogs]);

  useEffect(() => {
    const ws = getWsClient();
    ws.connect();

    const unsubOpened = ws.on("tradeOpened", (msg: WsMessage) => {
      const trade = (msg.data as { trade?: Trade } | undefined)?.trade;
      if (!trade) return;
      const id = `opened-${trade.id}`;
      if (seenIds.current.has(id)) return;
      seenIds.current.add(id);

      const entry: ActivityEntry = {
        id,
        kind: "TRADE_OPENED",
        title: "TRADE_OPENED",
        detail: `${trade.bucketGroupTitle} @${(parseFloat(trade.entryPrice) * 100).toFixed(1)}¢ · ${trade.campaignTitle}`,
        ts: Date.now(),
      };
      setActivities((prev) => [entry, ...prev].slice(0, MAX_ACTIVITY_ENTRIES));
    });

    const unsubResolved = ws.on("tradeResolved", (msg: WsMessage) => {
      const d = msg.data as
        { trade?: Trade; isWin?: boolean; pnl?: number } | undefined;
      const trade = d?.trade;
      const isWin = d?.isWin;
      const pnl = typeof d?.pnl === "number" ? d.pnl : undefined;

      const id = `resolved-${trade?.id ?? Date.now()}`;
      if (seenIds.current.has(id)) return;
      seenIds.current.add(id);

      const entry: ActivityEntry = {
        id,
        kind: isWin ? "TRADE_WIN" : "TRADE_LOSS",
        title: "TRADE_CLOSED",
        detail: `${trade?.exitReason ?? ""} ${trade?.bucketGroupTitle ?? "?"}${pnl !== undefined ? ` · ${formatPnl(pnl)}` : ""}`,
        ts: Date.now(),
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

export function useReadiness() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchReadiness = useCallback(async () => {
    try {
      setReadiness(await getApiClient().getReadiness());
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReadiness();
    const timer = setInterval(fetchReadiness, 30_000);
    return () => clearInterval(timer);
  }, [fetchReadiness]);

  return { readiness, loading, error };
}
