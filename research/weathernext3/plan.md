# WeatherNext fair-value strategy: implementation (done 2026-09-26)

The parameter evidence is in `findings.md` (v2 table). The data-access specifics are in `cookbook.md`.

## Backend

- **`services/weathernext.ts`**: the Earth Engine feed.
  - Uses the approved account's OAuth refresh token from the ADC file (`GOOGLE_APPLICATION_CREDENTIALS`), billed to `GCP_PROJECT=weather-vector`.
  - Every 5 min it calls `listAssets` (free) for runs whose lead-48 image is ingested.
  - Each new run gets one `value:compute` returning all 51 stations × 60 leads of `station_head_temperature_2m_mean`.
  - It processes every unprocessed run in init order. A late 6-hourly run is still used; ladders only accept newer forecasts.
- **`utils/forecast-model.ts`**: local-day max, then bias, lead-band sigma, and bucket probabilities.
- **`services/city-bias.ts`**: per-city bias from the `city_bias` table (51 rows), updated at each resolution.
- **`services/market-orchestrator.ts`**: event-driven.
  - Discovery runs every 30 min via `start_date_min`, so it downloads only new events.
  - On each run: fair values, one batch `/prices` call for all quotes, then order books only for candidates, and a simulated $5 taker fill.
  - Exits: take-profit and confirmed stop on WebSocket ticks of held tokens only.
  - Resolution comes from `/events/{id}` for ladders past their end, paying out at the market's final outcome prices.
- **Database** (`scripts/migrate-weathernext.mts`): the `campaigns` table is written once, plus a ~100-byte forecast summary. Also `trades`, `city_bias` and `audit_log`. The `buckets` table is gone. Closed campaigns with no trades are pruned after 30 days, audit rows after 14 days.
- **Removed:** the modal/NO-band strategy, market-quality instrumentation, the risk pause, max positions, the negative-balance flag, BigQuery/GCS/Cloud Monitoring, and the Render keep-alive.

## Frontend

- Static export (`output: "export"`) served by nginx on the same origin as the API.
- **ACTIVE CAMPAIGNS:** WN3 max, model top vs market top, and edge.
- **Campaign popup:** per bucket, the bid/ask, the WN3 probability, the edge and our positions.
- **Trades:** side and take-profit target; the trade popup shows the WeatherNext signal.
- **Diagnostics:** Earth Engine run telemetry.

## Deploy (Oracle VM, pm2 + nginx)

1. Restore Supabase and run `pnpm exec tsx scripts/migrate-weathernext.mts` once.
2. On the VM, run `gcloud auth application-default login` as the approved account.
3. Backend: `pnpm build`, then `pm2 start ecosystem.config.cjs`.
4. Frontend: `pnpm build`, then point nginx at `frontend/out`, proxying `/api/` and `/ws` to `127.0.0.1:4000`.
5. Auto-deploy workflow: mirror the other repo's once SSH access is available.

## Kill criteria

Stop the strategy if either holds after ≥ 300 closed trades:
- the mean return per trade is ≤ 0, or
- the day-bootstrap upper bound is < +5%.
