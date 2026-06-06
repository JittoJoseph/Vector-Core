# Vector-Core

[![Live Demo](https://img.shields.io/badge/Live_Demo-vector--core.vercel.app-007acc)](https://vector-core-dev.vercel.app/)

[![Backend Build](https://img.shields.io/github/checks-status/JittoJoseph/Vector-Core/main?label=backend)](https://github.com/JittoJoseph/Vector-Core/deployments)
[![Frontend Build](https://img.shields.io/github/checks-status/JittoJoseph/Vector-Core/main?label=frontend)](https://github.com/JittoJoseph/Vector-Core/deployments)

Automated prediction market trading engine focused on short-term event resolutions. Continuously scans for mispriced probability distributions as market deadlines approach.

## Architecture

- **Backend**: Node.js/TypeScript service with PostgreSQL database
- **Frontend**: Next.js command-center dashboard with real-time WebSocket telemetry
- **Strategy**: End-of-window prediction market trading

## Features

- Real-time Polymarket data ingestion via WebSockets
- Automated market scanning and opportunity filtering pipeline
- Simulated trading execution with active position management
- Live dashboard visualizing portfolio health, time exposure, and orderbook drift
