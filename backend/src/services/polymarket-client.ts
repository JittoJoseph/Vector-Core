import axios, { AxiosError, AxiosInstance } from "axios";
import { z } from "zod";
import { createModuleLogger } from "../utils/logger.js";
import { withRetry, isRateLimitError } from "../utils/retry.js";
import {
  POLY_URLS,
  GammaEventSchema,
  OrderbookSchema,
  type GammaEvent,
  type GammaMarket,
  type Orderbook,
} from "../types/index.js";
import { WEATHER_TAG_ID } from "../utils/weather-logic.js";

const logger = createModuleLogger("polymarket-client");

const EVENTS_PAGE = 100;
const QUOTE_CHUNK = 250;

export interface Quote {
  bid: number;
  ask: number;
}

export class PolymarketClient {
  private gammaApi: AxiosInstance;
  private clobApi: AxiosInstance;

  constructor() {
    const headers = {
      Accept: "application/json",
      "User-Agent": "VectorCore/2.0",
    };
    this.gammaApi = axios.create({
      baseURL: POLY_URLS.GAMMA_API_BASE,
      timeout: 30000,
      headers,
    });
    this.clobApi = axios.create({
      baseURL: POLY_URLS.CLOB_BASE,
      timeout: 30000,
      headers,
    });
    const onError = (api: string) => (error: AxiosError) => {
      if (error.response?.status === 429)
        logger.warn({ api, url: error.config?.url }, "Rate limited");
      throw error;
    };
    this.gammaApi.interceptors.response.use((r) => r, onError("gamma"));
    this.clobApi.interceptors.response.use((r) => r, onError("clob"));
  }

  private retry<T>(fn: () => Promise<T>): Promise<T> {
    return withRetry(fn, { maxRetries: 3, retryOn: isRateLimitError });
  }

  async listWeatherEventsSince(startDateMin: Date): Promise<GammaEvent[]> {
    const events: GammaEvent[] = [];
    for (let offset = 0; ; offset += EVENTS_PAGE) {
      const page = await this.retry(async () => {
        const res = await this.gammaApi.get("/events", {
          params: {
            tag_id: WEATHER_TAG_ID,
            closed: false,
            limit: EVENTS_PAGE,
            offset,
            start_date_min: startDateMin.toISOString(),
            order: "startDate",
            ascending: true,
          },
        });
        return z.array(GammaEventSchema).parse(res.data);
      });
      events.push(...page);
      if (page.length < EVENTS_PAGE) return events;
    }
  }

  async getEvent(id: string): Promise<GammaEvent> {
    return this.retry(async () => {
      const res = await this.gammaApi.get(`/events/${encodeURIComponent(id)}`);
      return GammaEventSchema.parse(res.data);
    });
  }

  async getOrderbook(tokenId: string): Promise<Orderbook> {
    return this.retry(async () => {
      const res = await this.clobApi.get("/book", {
        params: { token_id: tokenId },
      });
      return OrderbookSchema.parse(res.data);
    });
  }

  async getQuotes(tokenIds: string[]): Promise<Map<string, Quote>> {
    const quotes = new Map<string, Quote>();
    for (let i = 0; i < tokenIds.length; i += QUOTE_CHUNK) {
      const chunk = tokenIds.slice(i, i + QUOTE_CHUNK);
      const data = await this.retry(async () => {
        const res = await this.clobApi.post(
          "/prices",
          chunk.flatMap((token_id) => [
            { token_id, side: "BUY" },
            { token_id, side: "SELL" },
          ]),
        );
        return res.data as Record<string, { BUY?: string; SELL?: string }>;
      });
      for (const [token, p] of Object.entries(data)) {
        const bid = parseFloat(p.BUY ?? "");
        const ask = parseFloat(p.SELL ?? "");
        if (Number.isFinite(bid) && Number.isFinite(ask))
          quotes.set(token, { bid, ask });
      }
    }
    return quotes;
  }

  static tokenIds(market: GammaMarket): [string, string] | null {
    try {
      const ids = JSON.parse(market.clobTokenIds ?? "[]");
      return Array.isArray(ids) &&
        typeof ids[0] === "string" &&
        typeof ids[1] === "string"
        ? [ids[0], ids[1]]
        : null;
    } catch {
      return null;
    }
  }

  static outcomePrices(market: GammaMarket): [number, number] | null {
    try {
      const [yes, no] = JSON.parse(market.outcomePrices ?? "[]").map(Number);
      return Number.isFinite(yes) && Number.isFinite(no) ? [yes, no] : null;
    } catch {
      return null;
    }
  }
}

let clientInstance: PolymarketClient | null = null;
export function getPolymarketClient(): PolymarketClient {
  if (!clientInstance) clientInstance = new PolymarketClient();
  return clientInstance;
}
