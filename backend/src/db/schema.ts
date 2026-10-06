import {
  pgTable,
  text,
  boolean,
  timestamp,
  jsonb,
  decimal,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export interface ForecastSummary {
  init: string;
  publishedAt: string;
  fmaxC: number;
  refFmaxC?: number;
  mu: number;
  sigma: number;
}

export interface TradeSignal {
  init: string;
  leadH: number;
  pModel: number;
  quote: number;
  edge: number;
}

export const campaigns = pgTable(
  "campaigns",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    endDate: timestamp("end_date").notNull(),
    closed: boolean("closed").default(false).notNull(),
    closedTime: timestamp("closed_time"),
    forecast: jsonb("forecast").$type<ForecastSummary>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    closedIdx: index("c_closed_idx").on(table.closed),
  }),
);

export const forecastResiduals = pgTable(
  "forecast_residuals",
  {
    campaignId: text("campaign_id").primaryKey(),
    city: text("city").notNull(),
    closedAt: timestamp("closed_at").notNull(),
    residualC: real("residual_c").notNull(),
  },
  (table) => ({
    closedAtIdx: index("fr_closed_at_idx").on(table.closedAt),
  }),
);

export const trades = pgTable(
  "trades",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    campaignId: text("campaign_id").notNull(),
    campaignSlug: text("campaign_slug").notNull(),
    campaignTitle: text("campaign_title").notNull(),
    bucketId: text("bucket_id").notNull(),
    bucketSlug: text("bucket_slug"),
    bucketGroupTitle: text("bucket_group_title").notNull(),
    tokenId: text("token_id").notNull(),
    entryTs: timestamp("entry_ts").notNull(),
    entryPrice: decimal("entry_price", { precision: 18, scale: 8 }).notNull(),
    entryShares: decimal("entry_shares", { precision: 18, scale: 8 }).notNull(),
    actualCost: decimal("actual_cost", { precision: 18, scale: 8 }).notNull(),
    entryFees: decimal("entry_fees", { precision: 18, scale: 8 })
      .default("0")
      .notNull(),
    sharesSold: decimal("shares_sold", { precision: 18, scale: 8 })
      .default("0")
      .notNull(),
    target: decimal("target", { precision: 18, scale: 8 }).notNull(),
    signal: jsonb("signal").$type<TradeSignal>().notNull(),
    minPriceDuringPosition: decimal("min_price_during_position", {
      precision: 18,
      scale: 8,
    }),
    exitPrice: decimal("exit_price", { precision: 18, scale: 8 }),
    exitTs: timestamp("exit_ts"),
    exitOutcome: text("exit_outcome"),
    exitReason: text("exit_reason"),
    realizedPnl: decimal("realized_pnl", { precision: 18, scale: 8 }),
    status: text("status").default("OPEN").notNull(),
  },
  (table) => ({
    campaignIdx: index("t_campaign_idx").on(table.campaignId),
    statusIdx: index("t_status_idx").on(table.status),
    exitTsIdx: index("t_exit_ts_idx").on(table.exitTs),
    uqBucket: uniqueIndex("uq_trade_bucket").on(table.bucketId),
  }),
);

export const auditLogs = pgTable(
  "audit_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    level: text("level").notNull(),
    category: text("category").notNull(),
    message: text("message").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    createdAtIdx: index("al_created_at_idx").on(table.createdAt),
  }),
);
