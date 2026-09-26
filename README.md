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

- `backend/` — Node.js/TypeScript engine + REST/WebSocket API (Express, drizzle, Supabase Postgres), run by pm2 on the Oracle VM behind nginx at `vector-api.jittojoseph.xyz`
- `frontend/` — Next.js dashboard (static export) on Vercel at `vector.jittojoseph.xyz`, pointed at the API with `NEXT_PUBLIC_API_BASE_URL`
- `deploy.sh` + `.github/workflows/deploy.yml` — pushes to `main` touching the backend redeploy the VM over SSH (secrets `ORACLE_HOST`, `ORACLE_USER`, `ORACLE_SSH_KEY`)
- `ecosystem.config.cjs` — pm2 process definition (`vector-core-api`, port from `backend/.env`)

## First-time setup

```bash
cd backend && pnpm install && pnpm exec tsx scripts/migrate-weathernext.mts
```

Backend environment: see `backend/.env.example`. Earth Engine access uses the WeatherNext-approved Google account's application-default credentials (`gcloud auth application-default login` on the VM).
