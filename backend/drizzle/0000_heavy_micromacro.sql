CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"category" text NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deadline_markets" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"event_slug" text NOT NULL,
	"event_title" text NOT NULL,
	"condition_id" text,
	"slug" text,
	"question" text NOT NULL,
	"underlying_key" text NOT NULL,
	"deadline" timestamp NOT NULL,
	"deadline_date" text NOT NULL,
	"family_kind" text NOT NULL,
	"classification_status" text NOT NULL,
	"rejection_reason" text,
	"active" boolean DEFAULT true NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"accepting_orders" boolean DEFAULT false NOT NULL,
	"enable_order_book" boolean DEFAULT false NOT NULL,
	"neg_risk" boolean DEFAULT false NOT NULL,
	"neg_risk_other" boolean DEFAULT false NOT NULL,
	"frozen_prices" jsonb,
	"outcomes" jsonb NOT NULL,
	"clob_token_ids" jsonb NOT NULL,
	"yes_token_id" text NOT NULL,
	"no_token_id" text NOT NULL,
	"yes_price" numeric(18, 8),
	"no_price" numeric(18, 8),
	"spread" numeric(18, 8),
	"liquidity_num" numeric(18, 8),
	"volume_24h" numeric(18, 8),
	"order_min_size" numeric(18, 8),
	"order_tick_size" numeric(18, 8),
	"fees_enabled" boolean DEFAULT false NOT NULL,
	"fee_schedule" jsonb,
	"resolution_rules" text,
	"resolution_source" text,
	"uma_resolution_status" text,
	"last_fetched_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_families" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"normalized_key" text NOT NULL,
	"family_kind" text DEFAULT 'single_deadline' NOT NULL,
	"explicit_date_count" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"liquidity" numeric(18, 8) DEFAULT '0',
	"volume_24h" numeric(18, 8) DEFAULT '0',
	"last_fetched_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"market_id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"no_token_id" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"deadline" timestamp NOT NULL,
	"days_to_deadline" numeric(18, 8),
	"no_price" numeric(18, 8),
	"no_best_bid" numeric(18, 8),
	"no_best_ask" numeric(18, 8),
	"spread" numeric(18, 8),
	"depth_at_limit" numeric(18, 8),
	"expected_net_profit" numeric(18, 8),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"initial_capital" numeric(18, 8) NOT NULL,
	"cash_balance" numeric(18, 8) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulated_trades" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text,
	"event_slug" text,
	"event_title" text,
	"market_id" text,
	"market_slug" text,
	"market_question" text,
	"deadline" timestamp,
	"deadline_date" text,
	"token_id" text,
	"outcome_label" text DEFAULT 'No' NOT NULL,
	"side" text DEFAULT 'BUY' NOT NULL,
	"order_type" text DEFAULT 'FAK' NOT NULL,
	"entry_ts" timestamp NOT NULL,
	"entry_price" numeric(18, 8) NOT NULL,
	"entry_shares" numeric(18, 8) NOT NULL,
	"position_budget" numeric(18, 8) NOT NULL,
	"actual_cost" numeric(18, 8) NOT NULL,
	"entry_fees" numeric(18, 8) DEFAULT '0',
	"fill_status" text DEFAULT 'FULL',
	"expected_net_profit" numeric(18, 8),
	"no_best_bid_at_entry" numeric(18, 8),
	"no_best_ask_at_entry" numeric(18, 8),
	"depth_at_limit" numeric(18, 8),
	"exit_price" numeric(18, 8),
	"exit_ts" timestamp,
	"exit_outcome" text,
	"exit_reason" text,
	"realized_pnl" numeric(18, 8),
	"status" text DEFAULT 'OPEN' NOT NULL,
	"orderbook_snapshot" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "al_level_idx" ON "audit_log" USING btree ("level");--> statement-breakpoint
CREATE INDEX "al_category_idx" ON "audit_log" USING btree ("category");--> statement-breakpoint
CREATE INDEX "al_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "deadline_markets_event_idx" ON "deadline_markets" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "deadline_markets_deadline_idx" ON "deadline_markets" USING btree ("deadline");--> statement-breakpoint
CREATE INDEX "deadline_markets_status_idx" ON "deadline_markets" USING btree ("classification_status");--> statement-breakpoint
CREATE INDEX "deadline_markets_no_token_idx" ON "deadline_markets" USING btree ("no_token_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_families_slug_idx" ON "event_families" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "event_families_kind_idx" ON "event_families" USING btree ("family_kind");--> statement-breakpoint
CREATE INDEX "event_families_updated_at_idx" ON "event_families" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "opportunities_status_idx" ON "opportunities" USING btree ("status");--> statement-breakpoint
CREATE INDEX "st_market_id_idx" ON "simulated_trades" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "st_status_idx" ON "simulated_trades" USING btree ("status");--> statement-breakpoint
CREATE INDEX "st_entry_ts_idx" ON "simulated_trades" USING btree ("entry_ts");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_open_trade_per_deadline_token" ON "simulated_trades" USING btree ("market_id","token_id") WHERE status = 'OPEN';