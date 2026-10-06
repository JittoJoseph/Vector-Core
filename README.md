# Vector-Core

[![Live Demo](https://img.shields.io/badge/Live_Demo-vector.jittojoseph.xyz-007acc)](https://vector.jittojoseph.xyz)

Simulated trading engine for Polymarket "Highest temperature in {city} on {day}" ladders, driven by Google DeepMind's WeatherNext 3 forecasts. Nothing trades with real money.

## Strategy

- Every hourly WeatherNext 3 run (via Earth Engine) is sampled at the 51 airport stations the markets resolve on.
- Each ladder gets a fair value per bucket: the mean forecast local-day max over the runs published in the last 3 hours + a per-city correction equal to the recent forecast error at that station (resolutions from the last 14 days, shrunk toward the 7-day all-city mean, measured against the forecast as it stood 12 h before the day; kept across DB resets), with lead-dependent uncertainty. Runs older than an hour (restart backlog) only fill that window and never trade.
- Enter a $5 simulated taker order when the model beats the live ask by ≥ 20¢ after fees on a book with ≤ 3¢ spread, only while the market day is still ≥ 12 h away (closer in, the market already sees the previous afternoon's high, live observations and short-range models). YES side only: NO entries were break-even at best (see research/weathernext3/findings.md, live review).
- Sell half the position once the bid is halfway from entry to the model price, then exit the rest on take-profit (bid reaches the model price), a model exit (a newer run values the bucket below the bid), a confirmed stop-loss (`STOP_LOSS_DELTA`), or resolution.

Research, backtests and data-access notes live in [`research/weathernext3`](research/weathernext3/README.md).

## Layout

- `backend/` — Node.js/TypeScript engine + REST/WebSocket API (Express, drizzle, Supabase Postgres), run by pm2 on the Oracle VM behind nginx at `vector-api.jittojoseph.xyz`
- `frontend/` — Next.js dashboard (static export) on Vercel at `vector.jittojoseph.xyz`, pointed at the API with `NEXT_PUBLIC_API_BASE_URL`
- `deploy.sh` + `.github/workflows/deploy.yml` — pushes to `main` touching the backend redeploy the VM over SSH (secrets `ORACLE_HOST`, `ORACLE_USER`, `ORACLE_SSH_KEY`)
- `ecosystem.config.cjs` — pm2 process definition (`vector-core-api`, port from `backend/.env`)

## First-time setup

```bash
cd backend && pnpm install && pnpm exec tsx scripts/reset-db.mts
```

Backend environment: see `backend/.env.example`. Earth Engine access uses the WeatherNext-approved Google account's application-default credentials (`gcloud auth application-default login` on the VM).
