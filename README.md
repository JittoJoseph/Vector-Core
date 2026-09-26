# Vector-Core

[![Live Demo](https://img.shields.io/badge/Live_Demo-vector.jittojoseph.xyz-007acc)](https://vector.jittojoseph.xyz)

Simulated trading engine for Polymarket "Highest temperature in {city} on {day}" ladders, driven by Google DeepMind's WeatherNext 3 forecasts. Nothing trades with real money.

## Strategy

- Every hourly WeatherNext 3 run (via Earth Engine) is sampled at the 51 airport stations the markets resolve on.
- Each ladder gets a fair value per bucket: forecast local-day max + per-city bias (learned online from resolutions) with lead-dependent uncertainty.
- Enter a $5 simulated taker order when the model beats the live ask by ≥ 20¢ after fees on a book with ≤ 3¢ spread; YES or NO side.
- Exit on take-profit (bid reaches the model price), a confirmed stop-loss (`STOP_LOSS_DELTA`), or resolution.

Research, backtests and data-access notes live in [`research/weathernext3`](research/weathernext3/README.md).

## Layout

- `backend/` — Node.js/TypeScript engine + REST/WebSocket API (Express, drizzle, Postgres)
- `frontend/` — Next.js dashboard, built as a static export and served by nginx
- `ecosystem.config.cjs` — pm2 process definition for the backend

## Running

```bash
cd backend && pnpm install && pnpm build
pnpm exec tsx scripts/migrate-weathernext.mts
pm2 start ../ecosystem.config.cjs
cd ../frontend && pnpm install && pnpm build
```

Backend environment: see `backend/.env.example`. Earth Engine and WeatherNext access use the approved Google account's application-default credentials (`gcloud auth application-default login`).
