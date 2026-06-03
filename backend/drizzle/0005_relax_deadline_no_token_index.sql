DROP INDEX IF EXISTS "deadline_markets_no_token_idx";
CREATE INDEX IF NOT EXISTS "deadline_markets_no_token_idx" ON "deadline_markets" ("no_token_id");
