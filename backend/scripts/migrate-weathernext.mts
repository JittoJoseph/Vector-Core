import { mkdirSync, writeFileSync } from "fs";
import postgres from "postgres";
import dotenv from "dotenv";

dotenv.config();

const PRIOR_WEIGHT = 8;
const GLOBAL_BIAS_C = 0.66;
const SEED: [string, number, number][] = [
  ["Amsterdam", 0.399, 24],
  ["Ankara", 0.96, 24],
  ["Atlanta", 0.83, 24],
  ["Austin", 1.92, 24],
  ["Beijing", 0.795, 24],
  ["Buenos Aires", 0.776, 23],
  ["Busan", 1.336, 24],
  ["Cape Town", 0.725, 23],
  ["Chengdu", 0.298, 23],
  ["Chicago", 0.955, 24],
  ["Chongqing", -0.336, 21],
  ["Dallas", 1.023, 24],
  ["Denver", 1.568, 24],
  ["Guangzhou", 1.32, 24],
  ["Helsinki", 0.366, 24],
  ["Hong Kong", 0.635, 23],
  ["Houston", 1.084, 24],
  ["Istanbul", 0.21, 24],
  ["Jeddah", 0.343, 24],
  ["Jinan", 0.066, 3],
  ["Karachi", 1.214, 22],
  ["Kuala Lumpur", 0.234, 24],
  ["London", 0.757, 24],
  ["Los Angeles", 0.847, 22],
  ["Lucknow", -0.081, 23],
  ["Madrid", 0.627, 24],
  ["Manila", 0.653, 24],
  ["Mexico City", 0.674, 21],
  ["Miami", 0.884, 24],
  ["Milan", 0.313, 24],
  ["Moscow", 0.08, 23],
  ["Munich", 0.567, 24],
  ["NYC", 0.302, 24],
  ["Panama City", 0.684, 23],
  ["Paris", 0.984, 24],
  ["Qingdao", 0.219, 24],
  ["San Francisco", 0.556, 23],
  ["Sao Paulo", 0.794, 23],
  ["Seattle", 0.941, 22],
  ["Seoul (Incheon)", 0.79, 24],
  ["Shanghai", 0.698, 24],
  ["Shenzhen", -0.085, 24],
  ["Singapore", 1.256, 24],
  ["Taipei", 1.604, 24],
  ["Tel Aviv", 0.176, 24],
  ["Tokyo", 0.204, 24],
  ["Toronto", -0.151, 24],
  ["Warsaw", 0.116, 24],
  ["Wellington", 0.864, 24],
  ["Wuhan", 0.274, 23],
  ["Zhengzhou", 0.931, 19],
];

const sql = postgres(process.env.SUPABASE_DATABASE_URL!, {
  max: 1,
  onnotice: () => {},
});

const [legacy] =
  await sql`SELECT to_regclass('public.trades') IS NOT NULL AS exists`;
if (legacy?.exists) {
  const rows = await sql`SELECT * FROM trades`;
  if (rows.length) {
    mkdirSync("../research/legacy", { recursive: true });
    writeFileSync(
      "../research/legacy/no-band-strategy-trades.json",
      JSON.stringify(rows, null, 1),
    );
    console.log(`Backed up ${rows.length} legacy trades`);
  }
}

await sql.begin(async (tx) => {
  await tx`DROP TABLE IF EXISTS buckets, trades, campaigns, audit_log, city_bias CASCADE`;
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
    CREATE TABLE city_bias (
      city text PRIMARY KEY,
      weight real NOT NULL,
      sum real NOT NULL
    )`;
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
      side text NOT NULL,
      entry_ts timestamp NOT NULL,
      entry_price numeric(18, 8) NOT NULL,
      entry_shares numeric(18, 8) NOT NULL,
      actual_cost numeric(18, 8) NOT NULL,
      entry_fees numeric(18, 8) NOT NULL DEFAULT 0,
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
  const rows = SEED.map(([city, bias, days]) => ({
    city,
    weight: days,
    sum: bias * (days + PRIOR_WEIGHT) - PRIOR_WEIGHT * GLOBAL_BIAS_C,
  }));
  await tx`INSERT INTO city_bias ${tx(rows, "city", "weight", "sum")}`;
});

console.log("WeatherNext schema ready");
await sql.end();
