import { z } from "zod";

export const POLY_URLS = {
  GAMMA_API_BASE: "https://gamma-api.polymarket.com",
  CLOB_BASE: "https://clob.polymarket.com",
  CLOB_WS: "wss://ws-subscriptions-clob.polymarket.com/ws/market",
} as const;

export const POLYMARKET_MIN_ORDER_SIZE = 5;

export const ConfigSchema = z.object({
  db: z.object({
    url: z.string(),
  }),
  portfolio: z.object({
    startingCapital: z.number().min(1).max(10_000_000),
    allowNegativeBalance: z.boolean().default(true),
  }),
  strategy: z.object({
    scanIntervalMs: z.number().int().positive(),
    minNoEntryPrice: z.number().min(0).max(1),
    maxNoEntryPrice: z.number().min(0).max(1),

    minExpectedNetProfit: z.number().positive(),
    maxSimultaneousPositions: z.number().int().positive(),
    consecutiveLossPauseLimit: z.number().int().nonnegative(),
    riskAutoResumeEnabled: z.boolean(),
    riskAutoResumeCooldownMs: z.number().int().positive(),
    stopLossEnabled: z.boolean(),
    stopLossNoPrice: z.number().min(0).max(1),

    entryMinCampaignAgeFraction: z.number().min(0).max(1),
    entryMinBucketDistance: z.number().int().min(1),
    entryMaxTailYesMass: z.number().min(0).max(1),
    entryMinModalMargin: z.number().min(0).max(1),
    entryDipLookbackHours: z.number().positive(),
    entryDipThreshold: z.number().min(0).max(1),
    entryReboundDelta: z.number().min(0).max(1),
  }),
  admin: z.object({
    password: z.string().min(1),
  }),
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

export const GammaTagSchema = z.object({
  id: z.number().or(z.string()),
  label: z.string().optional(),
  slug: z.string().optional(),
});

export const FeeScheduleSchema = z
  .object({
    exponent: z.number().nullable().optional(),
    rate: z.number().nullable().optional(),
    takerOnly: z.boolean().nullable().optional(),
    rebateRate: z.number().nullable().optional(),
  })
  .passthrough();

export type FeeSchedule = z.infer<typeof FeeScheduleSchema>;

export const GammaMarketSchema = z
  .object({
    id: z.string(),
    question: z.string().nullable().optional(),
    conditionId: z.string().nullable().optional(),
    slug: z.string().nullable().optional(),
    clobTokenIds: z.string().nullable().optional(),
    outcomes: z.string().nullable().optional(),
    outcomePrices: z.string().nullable().optional(),
    volume: z.string().nullable().optional(),
    volumeNum: z.number().nullable().optional(),
    liquidity: z.string().nullable().optional(),
    liquidityNum: z.number().nullable().optional(),
    active: z.boolean().nullable().optional(),
    closed: z.boolean().nullable().optional(),
    enableOrderBook: z.boolean().nullable().optional(),
    acceptingOrders: z.boolean().nullable().optional(),
    negRisk: z.boolean().nullable().optional(),
    negRiskOther: z.boolean().nullable().optional(),
    marketType: z.string().nullable().optional(),
    groupItemTitle: z.string().nullable().optional(),
    groupItemThreshold: z.string().nullable().optional(),
    endDate: z.string().nullable().optional(),
    endDateIso: z.string().nullable().optional(),
    startDate: z.string().nullable().optional(),
    umaEndDate: z.string().nullable().optional(),
    umaResolutionStatus: z.string().nullable().optional(),
    bestBid: z.number().nullable().optional(),
    bestAsk: z.number().nullable().optional(),
    lastTradePrice: z.number().nullable().optional(),
    spread: z.number().nullable().optional(),
    description: z.string().nullable().optional(),
    resolutionSource: z.string().nullable().optional(),
    image: z.string().nullable().optional(),
    icon: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    orderMinSize: z.number().nullable().optional(),
    orderPriceMinTickSize: z.number().nullable().optional(),
    makerBaseFee: z.number().nullable().optional(),
    takerBaseFee: z.number().nullable().optional(),
    feesEnabled: z.boolean().nullable().optional(),
    feeType: z.string().nullable().optional(),
    feeSchedule: FeeScheduleSchema.nullable().optional(),
    tags: z.array(GammaTagSchema).optional(),
  })
  .passthrough();

export type GammaMarket = z.infer<typeof GammaMarketSchema>;

export const GammaEventSchema = z
  .object({
    id: z.string().or(z.number()),
    slug: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    active: z.boolean().nullable().optional(),
    closed: z.boolean().nullable().optional(),
    archived: z.boolean().nullable().optional(),
    negRisk: z.boolean().nullable().optional(),
    enableOrderBook: z.boolean().nullable().optional(),
    liquidity: z.number().nullable().optional(),
    liquidityClob: z.number().nullable().optional(),
    volume: z.number().nullable().optional(),
    volume24hr: z.number().nullable().optional(),
    startDate: z.string().nullable().optional(),
    endDate: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
    image: z.string().nullable().optional(),
    icon: z.string().nullable().optional(),
    tags: z.array(GammaTagSchema).optional(),
    markets: z.array(GammaMarketSchema).optional(),
  })
  .passthrough();

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
  market: z.string(),
  asset_id: z.string(),
  timestamp: z.string().optional().default(""),
  hash: z.string().optional().default(""),
  bids: z.array(OrderbookLevelSchema),
  asks: z.array(OrderbookLevelSchema),
  min_order_size: z.string().optional(),
  tick_size: z.string(),
  neg_risk: z.boolean().optional().default(false),
});

export type Orderbook = z.infer<typeof OrderbookSchema>;
export type OrderbookLevel = z.infer<typeof OrderbookLevelSchema>;

export const MidpointResponseSchema = z.object({ mid: z.string() });
export type MidpointResponse = z.infer<typeof MidpointResponseSchema>;

export const PricesHistoryResponseSchema = z.object({
  history: z.array(z.object({ t: z.number(), p: z.number() })),
});
export type PricesHistoryResponse = z.infer<typeof PricesHistoryResponseSchema>;
