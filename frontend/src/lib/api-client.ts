import type {
  Readiness,
  Trade,
  SystemStats,
  ActiveCampaign,
  HistoryCampaign,
  CampaignDetail,
  PerformanceMetrics,
  AuditLog,
  WsMessage,
} from "./types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

function wsBaseUrl(): string {
  if (API_BASE_URL) return API_BASE_URL.replace(/^http/, "ws");
  const { protocol, host } = window.location;
  return `${protocol === "https:" ? "wss:" : "ws:"}//${host}`;
}

async function fetchWithRetry<T>(
  url: string,
  options: RequestInit = {},
  retries = 3,
  delay = 1000,
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error as Error;
      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
      }
    }
  }

  throw lastError || new Error("Request failed after retries");
}

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async ping(): Promise<string> {
    return fetchWithRetry(`${this.baseUrl}/ping`);
  }

  async getActiveCampaigns(): Promise<ActiveCampaign[]> {
    return fetchWithRetry(`${this.baseUrl}/api/campaigns`);
  }

  async getHistoryCampaigns(limit = 100): Promise<HistoryCampaign[]> {
    return fetchWithRetry(
      `${this.baseUrl}/api/campaigns?status=history&limit=${limit}`,
    );
  }

  async getCampaignDetails(id: string): Promise<CampaignDetail> {
    return fetchWithRetry(`${this.baseUrl}/api/campaigns/${id}`);
  }

  async getPositions(): Promise<Trade[]> {
    return fetchWithRetry(`${this.baseUrl}/api/positions`);
  }

  async getSystemStats(): Promise<SystemStats> {
    return fetchWithRetry(`${this.baseUrl}/api/stats`);
  }

  async getReadiness(): Promise<Readiness> {
    return fetchWithRetry(`${this.baseUrl}/api/readiness`);
  }

  async getTradeHistory(params?: {
    limit?: number;
    offset?: number;
  }): Promise<Trade[]> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.offset) searchParams.set("offset", String(params.offset));

    const qs = searchParams.toString();
    return fetchWithRetry(
      `${this.baseUrl}/api/trades/history${qs ? `?${qs}` : ""}`,
    );
  }

  async getPerformance(
    period: "1D" | "1W" | "1M" | "ALL" = "1D",
  ): Promise<PerformanceMetrics> {
    return fetchWithRetry(`${this.baseUrl}/api/performance?period=${period}`);
  }

  async getAuditLogs(params?: { limit?: number }): Promise<AuditLog[]> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", String(params.limit));

    const qs = searchParams.toString();
    return fetchWithRetry(`${this.baseUrl}/api/audit${qs ? `?${qs}` : ""}`);
  }

  async pauseSystem(
    password: string,
  ): Promise<{ success: boolean; paused: boolean }> {
    return fetchWithRetry(`${this.baseUrl}/api/admin/pause`, {
      method: "POST",
      headers: { Authorization: `Bearer ${password}` },
    });
  }

  async resumeSystem(
    password: string,
  ): Promise<{ success: boolean; paused: boolean }> {
    return fetchWithRetry(`${this.baseUrl}/api/admin/resume`, {
      method: "POST",
      headers: { Authorization: `Bearer ${password}` },
    });
  }

  async wipeSystem(password: string): Promise<{ success: boolean }> {
    return fetchWithRetry(`${this.baseUrl}/api/admin/wipe`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${password}` },
    });
  }
}

export class WsClient {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private reconnectAttempts = 0;
  private listeners: Map<string, Set<(data: WsMessage) => void>> = new Map();

  constructor(wsUrl: string = wsBaseUrl()) {
    this.wsUrl = `${wsUrl}/ws`;
  }

  connect(): void {
    if (this.ws) return;
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.sendPing();
    };
    ws.onmessage = (event) => {
      try {
        const message: WsMessage = JSON.parse(event.data);
        this.listeners.get(message.type)?.forEach((cb) => cb(message));
      } catch {}
    };
    ws.onclose = () => {
      this.ws = null;
      const delay = Math.min(1000 * 2 ** this.reconnectAttempts++, 30_000);
      setTimeout(() => this.connect(), delay);
    };
  }

  on(type: string, callback: (data: WsMessage) => void): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(callback);
    return () => {
      this.listeners.get(type)?.delete(callback);
    };
  }

  sendPing(): void {
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ type: "ping" }));
  }
}

let apiClient: ApiClient | null = null;
let wsClient: WsClient | null = null;

export function getApiClient(): ApiClient {
  if (!apiClient) {
    apiClient = new ApiClient();
  }
  return apiClient;
}

export function getWsClient(): WsClient {
  if (!wsClient) {
    wsClient = new WsClient();
  }
  return wsClient;
}
