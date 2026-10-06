import postgres from "postgres";
import dotenv from "dotenv";

dotenv.config();

const sql = postgres(process.env.SUPABASE_DATABASE_URL!, {
  max: 1,
  onnotice: () => {},
});

await sql.begin(async (tx) => {
  await tx`DROP TABLE IF EXISTS buckets, trades, campaigns, audit_log, city_bias CASCADE`;
  await tx`
    CREATE TABLE IF NOT EXISTS forecast_residuals (
      campaign_id text PRIMARY KEY,
      city text NOT NULL,
      closed_at timestamp NOT NULL,
      residual_c real NOT NULL
    )`;
  await tx`CREATE INDEX IF NOT EXISTS fr_closed_at_idx ON forecast_residuals (closed_at)`;
  await tx`
    CREATE TABLE campaigns (
      id text PRIMARY KEY,
      slug text NOT NULL,
      title text NOT NULL,
      end_date timestamp NOT NULL,
      closed boolean NOT NULL DEFAULT false,
      closed_time timestamp,
      forecast jsonb,
      created_at timestamp NOT NULL DEFAULT now()
    )`;
  await tx`CREATE INDEX c_closed_idx ON campaigns (closed)`;
  await tx`
    CREATE TABLE trades (
      id text PRIMARY KEY,
      campaign_id text NOT NULL,
      campaign_slug text NOT NULL,
      campaign_title text NOT NULL,
      bucket_id text NOT NULL,
      bucket_slug text,
      bucket_group_title text NOT NULL,
      token_id text NOT NULL,
      entry_ts timestamp NOT NULL,
      entry_price numeric(18, 8) NOT NULL,
      entry_shares numeric(18, 8) NOT NULL,
      actual_cost numeric(18, 8) NOT NULL,
      entry_fees numeric(18, 8) NOT NULL DEFAULT 0,
      shares_sold numeric(18, 8) NOT NULL DEFAULT 0,
      target numeric(18, 8) NOT NULL,
      signal jsonb NOT NULL,
      min_price_during_position numeric(18, 8),
      exit_price numeric(18, 8),
      exit_ts timestamp,
      exit_outcome text,
      exit_reason text,
      realized_pnl numeric(18, 8),
      status text NOT NULL DEFAULT 'OPEN'
    )`;
  await tx`CREATE INDEX t_campaign_idx ON trades (campaign_id)`;
  await tx`CREATE INDEX t_status_idx ON trades (status)`;
  await tx`CREATE INDEX t_exit_ts_idx ON trades (exit_ts)`;
  await tx`CREATE UNIQUE INDEX uq_trade_bucket ON trades (bucket_id)`;
  await tx`
    CREATE TABLE audit_log (
      id text PRIMARY KEY,
      level text NOT NULL,
      category text NOT NULL,
      message text NOT NULL,
      metadata jsonb,
      created_at timestamp NOT NULL DEFAULT now()
    )`;
  await tx`CREATE INDEX al_created_at_idx ON audit_log (created_at)`;
});

console.log("Database reset");
await sql.end();
