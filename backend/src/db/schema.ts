import {
  pgTable,
  text,
  boolean,
  timestamp,
  jsonb,
  decimal,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const campaigns = pgTable(
  "campaigns",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    seriesSlug: text("series_slug"),
    startDate: timestamp("start_date"),
    endDate: timestamp("end_date"),
    closed: boolean("closed").default(false).notNull(),
    lastFetchedAt: timestamp("last_fetched_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    slugIdx: uniqueIndex("c_slug_idx").on(table.slug),
    updatedAtIdx: index("c_updated_at_idx").on(table.updatedAt),
  }),
);

export const buckets = pgTable(
  "buckets",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id").notNull(),
    conditionId: text("condition_id"),
    slug: text("slug"),
    groupItemTitle: text("group_item_title").notNull(),
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
    campaignIdx: index("b_campaign_idx").on(table.campaignId),
    noTokenIdx: index("b_no_token_idx").on(table.noTokenId),
  }),
);

export const trades = pgTable(
  "trades",
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
    entryTs: timestamp("entry_ts").notNull(),
    entryPrice: decimal("entry_price", { precision: 18, scale: 8 }).notNull(),
    entryShares: decimal("entry_shares", { precision: 18, scale: 8 }).notNull(),
    actualCost: decimal("actual_cost", { precision: 18, scale: 8 }).notNull(),
    entryFees: decimal("entry_fees", { precision: 18, scale: 8 })
      .default("0")
      .notNull(),
    expectedNetProfit: decimal("expected_net_profit", {
      precision: 18,
      scale: 8,
    }),
    modalBucketAtEntry: text("modal_bucket_at_entry"),
    minNoPriceDuringPosition: decimal("min_no_price_during_position", {
      precision: 18,
      scale: 8,
    }),
    exitPrice: decimal("exit_price", { precision: 18, scale: 8 }),
    exitTs: timestamp("exit_ts"),
    exitOutcome: text("exit_outcome"),
    exitReason: text("exit_reason"),
    realizedPnl: decimal("realized_pnl", { precision: 18, scale: 8 }),
    status: text("status").default("OPEN").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    bucketIdIdx: index("t_bucket_id_idx").on(table.bucketId),
    statusIdx: index("t_status_idx").on(table.status),
    entryTsIdx: index("t_entry_ts_idx").on(table.entryTs),
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
    createdAtIdx: index("al_created_at_idx").on(table.createdAt),
  }),
);
