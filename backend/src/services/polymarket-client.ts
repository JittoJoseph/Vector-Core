import axios, { AxiosError, AxiosInstance } from "axios";
import { z } from "zod";
import { createModuleLogger } from "../utils/logger.js";
import { withRetry, isRateLimitError } from "../utils/retry.js";
import {
  POLY_URLS,
  GammaEventSchema,
  GammaEventsKeysetResponseSchema,
  GammaMarketSchema,
  OrderbookSchema,
  type GammaEvent,
  type GammaMarket,
  type Orderbook,
} from "../types/index.js";
import { logAudit } from "../db/client.js";

const logger = createModuleLogger("polymarket-client");

export class PolymarketClient {
  private gammaApi: AxiosInstance;
  private clobApi: AxiosInstance;

  constructor() {
    this.gammaApi = axios.create({
      baseURL: POLY_URLS.GAMMA_API_BASE,
      timeout: 30000,
      headers: { Accept: "application/json", "User-Agent": "VectorCore/1.0" },
    });
    this.clobApi = axios.create({
      baseURL: POLY_URLS.CLOB_BASE,
      timeout: 30000,
      headers: { Accept: "application/json", "User-Agent": "VectorCore/1.0" },
    });
    this.setupInterceptors();
  }

  private setupInterceptors() {
    const handleError = (apiName: string) => async (error: AxiosError) => {
      if (error.response?.status === 429) {
        logger.warn({ api: apiName, url: error.config?.url }, "Rate limited");
        await logAudit("warn", "rate_limit", `Rate limited on ${apiName}`, {
          url: error.config?.url,
          retryAfter: error.response.headers["retry-after"],
        });
      }
      throw error;
    };

    this.gammaApi.interceptors.response.use((r) => r, handleError("gammaApi"));
    this.clobApi.interceptors.response.use((r) => r, handleError("clobApi"));
  }

  async listEventsKeyset(options: {
    limit?: number;
    after_cursor?: string;
    order?: string;
    ascending?: boolean;
    active?: boolean;
    closed?: boolean;
    tag_id?: string;
  }): Promise<{ events: GammaEvent[]; nextCursor: string | null }> {
    return withRetry(
      async () => {
        const params = new URLSearchParams();
        params.set("limit", String(options.limit ?? 100));
        params.set("active", String(options.active ?? true));
        params.set("closed", String(options.closed ?? false));
        params.set("order", options.order ?? "volume24hr");
        params.set("ascending", String(options.ascending ?? false));
        if (options.after_cursor) {
          params.set("after_cursor", options.after_cursor);
        }
        if (options.tag_id) {
          params.set("tag_id", options.tag_id);
        }

        const response = await this.gammaApi.get("/events/keyset", { params });
        const parsed = GammaEventsKeysetResponseSchema.parse(response.data);
        return {
          events: parsed.events,
          nextCursor: parsed.next_cursor ?? null,
        };
      },
      { maxRetries: 3, retryOn: isRateLimitError },
    );
  }

  async getEventBySlug(slug: string): Promise<GammaEvent | null> {
    return withRetry(
      async () => {
        const response = await this.gammaApi.get(
          `/events/slug/${encodeURIComponent(slug)}`,
        );
        return GammaEventSchema.parse(response.data);
      },
      { maxRetries: 3, retryOn: isRateLimitError },
    );
  }

  async getEventById(id: string): Promise<GammaEvent | null> {
    return withRetry(
      async () => {
        const response = await this.gammaApi.get(
          `/events/${encodeURIComponent(id)}`,
        );
        return GammaEventSchema.parse(response.data);
      },
      { maxRetries: 3, retryOn: isRateLimitError },
    );
  }

  async getMarketById(marketId: string): Promise<GammaMarket | null> {
    return withRetry(
      async () => {
        const response = await this.gammaApi.get(
          `/markets/${encodeURIComponent(marketId)}`,
        );
        return GammaMarketSchema.parse(response.data);
      },
      { maxRetries: 3, retryOn: isRateLimitError },
    );
  }

  async getOrderbook(tokenId: string): Promise<Orderbook> {
    return withRetry(
      async () => {
        const response = await this.clobApi.get("/book", {
          params: { token_id: tokenId },
        });
        return OrderbookSchema.parse(response.data);
      },
      { maxRetries: 3, retryOn: isRateLimitError },
    );
  }

  private static parseJsonArray(value: string | null | undefined): unknown[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  static parseClobTokenIds(market: GammaMarket): string[] {
    return PolymarketClient.parseJsonArray(market.clobTokenIds)
      .filter((v): v is string => typeof v === "string" && v.length > 0);
  }

  static parseOutcomePrices(market: GammaMarket): number[] {
    return PolymarketClient.parseJsonArray(market.outcomePrices)
      .map(Number)
      .filter((v) => Number.isFinite(v));
  }
}

let clientInstance: PolymarketClient | null = null;
export function getPolymarketClient(): PolymarketClient {
  if (!clientInstance) clientInstance = new PolymarketClient();
  return clientInstance;
}
