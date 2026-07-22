# Vector-Core

[![Live Demo](https://img.shields.io/badge/Live_Demo-vector.jittojoseph.xyz-007acc)](https://vector.jittojoseph.xyz)

[![Backend Build](https://img.shields.io/github/checks-status/JittoJoseph/Vector-Core/main?label=backend)](https://github.com/JittoJoseph/Vector-Core/deployments)
[![Frontend Build](https://img.shields.io/github/checks-status/JittoJoseph/Vector-Core/main?label=frontend)](https://github.com/JittoJoseph/Vector-Core/deployments)

Automated weather campaign trading engine for Polymarket. Trades daily highest-temperature markets in Wellington, Taipei, London, and Shenzhen — buying NO on temperature buckets below the modal bucket as resolution approaches.

## Architecture

- **Backend**: Node.js/TypeScript service with PostgreSQL database
- **Frontend**: Next.js command-center dashboard with real-time WebSocket telemetry
- **Strategy**: NO-side entries on mutually-exclusive temperature bucket ladders

## Features

- Real-time Polymarket data ingestion via WebSockets
- Automated weather campaign discovery and bucket grouping for supported cities
- Simulated trading execution with active position management
- Live dashboard visualizing portfolio health, time exposure, and orderbook drift
