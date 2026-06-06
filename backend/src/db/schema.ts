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

export const eventFamilies = pgTable(
  "event_families",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    normalizedKey: text("normalized_key").notNull(),
    familyKind: text("family_kind").notNull().default("single_deadline"),
    explicitDateCount: integer("explicit_date_count").default(0).notNull(),
    active: boolean("active").default(true).notNull(),
    closed: boolean("closed").default(false).notNull(),
    liquidity: decimal("liquidity", { precision: 18, scale: 8 }).default("0"),
    volume24h: decimal("volume_24h", { precision: 18, scale: 8 }).default("0"),
    raw: jsonb("raw"),
    lastFetchedAt: timestamp("last_fetched_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    slugIdx: uniqueIndex("event_families_slug_idx").on(table.slug),
    kindIdx: index("event_families_kind_idx").on(table.familyKind),
    updatedAtIdx: index("event_families_updated_at_idx").on(table.updatedAt),
  }),
);

export const deadlineMarkets = pgTable(
  "deadline_markets",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull(),
    eventSlug: text("event_slug").notNull(),
    eventTitle: text("event_title").notNull(),
    conditionId: text("condition_id"),
    slug: text("slug"),
    question: text("question").notNull(),
    underlyingKey: text("underlying_key").notNull(),
    deadline: timestamp("deadline").notNull(),
    deadlineDate: text("deadline_date").notNull(),
    familyKind: text("family_kind").notNull(),
    classificationStatus: text("classification_status").notNull(),
    rejectionReason: text("rejection_reason"),
    active: boolean("active").default(true).notNull(),
    closed: boolean("closed").default(false).notNull(),
    acceptingOrders: boolean("accepting_orders").default(false).notNull(),
    enableOrderBook: boolean("enable_order_book").default(false).notNull(),
    negRisk: boolean("neg_risk").default(false).notNull(),
    negRiskOther: boolean("neg_risk_other").default(false).notNull(),
    frozenPrices: jsonb("frozen_prices"),
    outcomes: jsonb("outcomes").notNull(),
    clobTokenIds: jsonb("clob_token_ids").notNull(),
    yesTokenId: text("yes_token_id").notNull(),
    noTokenId: text("no_token_id").notNull(),
    yesPrice: decimal("yes_price", { precision: 18, scale: 8 }),
    noPrice: decimal("no_price", { precision: 18, scale: 8 }),
    spread: decimal("spread", { precision: 18, scale: 8 }),
    liquidityNum: decimal("liquidity_num", { precision: 18, scale: 8 }),
    volume24h: decimal("volume_24h", { precision: 18, scale: 8 }),
    orderMinSize: decimal("order_min_size", { precision: 18, scale: 8 }),
    orderTickSize: decimal("order_tick_size", { precision: 18, scale: 8 }),
    feesEnabled: boolean("fees_enabled").default(false).notNull(),
    feeSchedule: jsonb("fee_schedule"),
    resolutionRules: text("resolution_rules"),
    resolutionSource: text("resolution_source"),
    umaResolutionStatus: text("uma_resolution_status"),
    raw: jsonb("raw"),
    lastFetchedAt: timestamp("last_fetched_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    eventIdx: index("deadline_markets_event_idx").on(table.eventId),
    deadlineIdx: index("deadline_markets_deadline_idx").on(table.deadline),
    statusIdx: index("deadline_markets_status_idx").on(
      table.classificationStatus,
    ),
    noTokenIdx: index("deadline_markets_no_token_idx").on(table.noTokenId),
  }),
);

export const opportunities = pgTable(
  "opportunities",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    marketId: text("market_id").notNull(),
    eventId: text("event_id").notNull(),
    noTokenId: text("no_token_id").notNull(),
    status: text("status").notNull(),
    reason: text("reason"),
    deadline: timestamp("deadline").notNull(),
    daysToDeadline: decimal("days_to_deadline", { precision: 18, scale: 8 }),
    noPrice: decimal("no_price", { precision: 18, scale: 8 }),
    noBestBid: decimal("no_best_bid", { precision: 18, scale: 8 }),
    noBestAsk: decimal("no_best_ask", { precision: 18, scale: 8 }),
    spread: decimal("spread", { precision: 18, scale: 8 }),
    depthAtLimit: decimal("depth_at_limit", { precision: 18, scale: 8 }),
    expectedNetProfit: decimal("expected_net_profit", {
      precision: 18,
      scale: 8,
    }),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    marketIdx: index("opportunities_market_idx").on(table.marketId),
    statusIdx: index("opportunities_status_idx").on(table.status),
    createdAtIdx: index("opportunities_created_at_idx").on(table.createdAt),
  }),
);

export const orderbookSnapshots = pgTable(
  "orderbook_snapshots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    marketId: text("market_id").notNull(),
    tokenId: text("token_id").notNull(),
    side: text("side").notNull().default("NO"),
    bestBid: decimal("best_bid", { precision: 18, scale: 8 }),
    bestAsk: decimal("best_ask", { precision: 18, scale: 8 }),
    spread: decimal("spread", { precision: 18, scale: 8 }),
    depthAtLimit: decimal("depth_at_limit", { precision: 18, scale: 8 }),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    tokenIdx: index("orderbook_snapshots_token_idx").on(table.tokenId),
    createdAtIdx: index("orderbook_snapshots_created_at_idx").on(
      table.createdAt,
    ),
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
    eventId: text("event_id"),
    eventSlug: text("event_slug"),
    eventTitle: text("event_title"),
    marketId: text("market_id"),
    marketSlug: text("market_slug"),
    marketQuestion: text("market_question"),
    deadline: timestamp("deadline"),
    deadlineDate: text("deadline_date"),
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
    orderbookSnapshot: jsonb("orderbook_snapshot"),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    marketIdIdx: index("st_market_id_idx").on(table.marketId),
    statusIdx: index("st_status_idx").on(table.status),
    entryTsIdx: index("st_entry_ts_idx").on(table.entryTs),
    uqOpenTradePerToken: uniqueIndex("uq_open_trade_per_deadline_token")
      .on(table.marketId, table.tokenId)
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
