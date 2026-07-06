import {
  pgTable,
  text,
  boolean,
  timestamp,
  jsonb,
  decimal,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const distributionCampaigns = pgTable(
  "distribution_campaigns",
  {
    id: text("id").primaryKey(), // Polymarket event ID
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    seriesSlug: text("series_slug"), // e.g. "elon-tweets"
    startDate: timestamp("start_date"),
    endDate: timestamp("end_date"),
    active: boolean("active").default(true).notNull(),
    closed: boolean("closed").default(false).notNull(),
    lastFetchedAt: timestamp("last_fetched_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    slugIdx: uniqueIndex("dc_slug_idx").on(table.slug),
    seriesIdx: index("dc_series_idx").on(table.seriesSlug),
    updatedAtIdx: index("dc_updated_at_idx").on(table.updatedAt),
  }),
);

export const distributionBuckets = pgTable(
  "distribution_buckets",
  {
    id: text("id").primaryKey(), // Polymarket market ID
    campaignId: text("campaign_id").notNull(),
    conditionId: text("condition_id"),
    slug: text("slug"),
    groupItemTitle: text("group_item_title").notNull(), // e.g., "180-199"
    yesTokenId: text("yes_token_id").notNull(),
    noTokenId: text("no_token_id").notNull(),
    yesPrice: decimal("yes_price", { precision: 18, scale: 8 }),
    noPrice: decimal("no_price", { precision: 18, scale: 8 }),
    spread: decimal("spread", { precision: 18, scale: 8 }),
    liquidityNum: decimal("liquidity_num", { precision: 18, scale: 8 }),
    volume24h: decimal("volume_24h", { precision: 18, scale: 8 }),
    lastFetchedAt: timestamp("last_fetched_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    campaignIdx: index("db_campaign_idx").on(table.campaignId),
    noTokenIdx: index("db_no_token_idx").on(table.noTokenId),
  }),
);



export const portfolio = pgTable("portfolio", {
  id: integer("id").primaryKey().default(1),
  initialCapital: decimal("initial_capital", {
    precision: 18,
    scale: 8,
  }).notNull(),
  cashBalance: decimal("cash_balance", { precision: 18, scale: 8 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const simulatedTrades = pgTable(
  "simulated_trades",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    campaignId: text("campaign_id"),
    campaignSlug: text("campaign_slug"),
    campaignTitle: text("campaign_title"),
    bucketId: text("bucket_id"),
    bucketSlug: text("bucket_slug"),
    bucketGroupTitle: text("bucket_group_title"),
    tokenId: text("token_id"),
    outcomeLabel: text("outcome_label").default("No").notNull(),
    side: text("side").default("BUY").notNull(),
    orderType: text("order_type").default("FAK").notNull(),
    entryTs: timestamp("entry_ts").notNull(),
    entryPrice: decimal("entry_price", { precision: 18, scale: 8 }).notNull(),
    entryShares: decimal("entry_shares", { precision: 18, scale: 8 }).notNull(),
    positionBudget: decimal("position_budget", {
      precision: 18,
      scale: 8,
    }).notNull(),
    actualCost: decimal("actual_cost", { precision: 18, scale: 8 }).notNull(),
    entryFees: decimal("entry_fees", { precision: 18, scale: 8 }).default("0"),
    fillStatus: text("fill_status").default("FULL"),
    expectedNetProfit: decimal("expected_net_profit", {
      precision: 18,
      scale: 8,
    }),
    expectedReturnPercent: decimal("expected_return_percent", {
      precision: 18,
      scale: 8,
    }),
    noBestBidAtEntry: decimal("no_best_bid_at_entry", {
      precision: 18,
      scale: 8,
    }),
    noBestAskAtEntry: decimal("no_best_ask_at_entry", {
      precision: 18,
      scale: 8,
    }),
    depthAtLimit: decimal("depth_at_limit", { precision: 18, scale: 8 }),
    exitPrice: decimal("exit_price", { precision: 18, scale: 8 }),
    exitTs: timestamp("exit_ts"),
    exitOutcome: text("exit_outcome"),
    exitReason: text("exit_reason"),
    realizedPnl: decimal("realized_pnl", { precision: 18, scale: 8 }),
    status: text("status").default("OPEN").notNull(),
    modalBucketAtEntry: text("modal_bucket_at_entry"),
    minNoPriceDuringPosition: decimal("min_no_price_during_position", { precision: 18, scale: 8 }),
    entryGateSnapshot: jsonb("entry_gate_snapshot"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    bucketIdIdx: index("st_bucket_id_idx").on(table.bucketId),
    statusIdx: index("st_status_idx").on(table.status),
    entryTsIdx: index("st_entry_ts_idx").on(table.entryTs),
    uqOpenTradePerToken: uniqueIndex("uq_open_trade_per_bucket_token")
      .on(table.bucketId, table.tokenId)
      .where(sql`status = 'OPEN'`),
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
    levelIdx: index("al_level_idx").on(table.level),
    categoryIdx: index("al_category_idx").on(table.category),
    createdAtIdx: index("al_created_at_idx").on(table.createdAt),
  }),
);
