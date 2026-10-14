# Vector-Core

[![Live Demo](https://img.shields.io/badge/Live_Demo-vector.jittojoseph.xyz-007acc)](https://vector.jittojoseph.xyz)

A simulated trading engine for Polymarket's daily "Highest temperature" markets, with a live dashboard. It compares weather forecast data against market prices and paper-trades the outcomes it considers mispriced. Nothing trades with real money.

## How it works

- Forecast data is turned into a probability for each temperature bucket of a market.
- Those probabilities are compared with the live order book, and simulated positions are opened where the engine disagrees with the market.
- Open positions are managed with take-profit, stop-loss and forecast-driven exits until the market resolves.

## Layout

- `backend/`: Node.js/TypeScript engine and REST/WebSocket API (Express, drizzle, Postgres), run by pm2.
- `frontend/`: Next.js dashboard (static export) on Vercel, pointed at the API with `NEXT_PUBLIC_API_BASE_URL`.

## Setup

```bash
cd backend && pnpm install && pnpm exec tsx scripts/reset-db.mts
```

Environment variables are listed in `backend/.env.example`.
