import { z } from "zod";

export const POLY_URLS = {
  GAMMA_API_BASE: "https://gamma-api.polymarket.com",
  CLOB_BASE: "https://clob.polymarket.com",
  CLOB_WS: "wss://ws-subscriptions-clob.polymarket.com/ws/market",
} as const;

export const ConfigSchema = z.object({
  db: z.object({ url: z.string() }),
  google: z.object({
    credentialsPath: z.string(),
    project: z.string(),
  }),
  portfolio: z.object({
    startingCapital: z.number().min(1).max(10_000_000),
  }),
  strategy: z.object({
    stopLossDelta: z.number().min(0).max(1),
  }),
  admin: z.object({ password: z.string().min(1) }),
  server: z.object({
    port: z.number().min(1).max(65535),
    host: z.string(),
  }),
  logging: z.object({
    level: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]),
  }),
  env: z.enum(["development", "production", "test"]),
});

export type Config = z.infer<typeof ConfigSchema>;

export const FeeScheduleSchema = z.object({
  rate: z.number().nullable().optional(),
});

export const GammaMarketSchema = z.object({
  id: z.string(),
  slug: z.string().nullable().optional(),
  groupItemTitle: z.string().nullable().optional(),
  clobTokenIds: z.string().nullable().optional(),
  outcomePrices: z.string().nullable().optional(),
  gameStartTime: z.string().nullable().optional(),
  acceptingOrders: z.boolean().nullable().optional(),
  closed: z.boolean().nullable().optional(),
  bestBid: z.number().nullable().optional(),
  bestAsk: z.number().nullable().optional(),
  feeSchedule: FeeScheduleSchema.nullable().optional(),
});

export type GammaMarket = z.infer<typeof GammaMarketSchema>;

export const GammaEventSchema = z.object({
  id: z.string().or(z.number()),
  slug: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  closed: z.boolean().nullable().optional(),
  closedTime: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  negRisk: z.boolean().nullable().optional(),
  markets: z.array(GammaMarketSchema).optional(),
});

export type GammaEvent = z.infer<typeof GammaEventSchema>;

export const GammaEventsKeysetResponseSchema = z.object({
  events: z.array(GammaEventSchema),
  next_cursor: z.string().nullable().optional(),
});

export const OrderbookLevelSchema = z.object({
  price: z.string(),
  size: z.string(),
});

export const OrderbookSchema = z.object({
  bids: z.array(OrderbookLevelSchema),
  asks: z.array(OrderbookLevelSchema),
  min_order_size: z.string().optional(),
});

export type Orderbook = z.infer<typeof OrderbookSchema>;
