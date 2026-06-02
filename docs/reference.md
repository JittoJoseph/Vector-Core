# Strategic Market Engine — System Reference

> **What this document covers**: The complete behavioral logic, core mechanics, decision algorithms, and data flows of the Strategic Market Engine. It is implementation-grounded but abstracted above code-level syntax. Read it to understand *why* the system behaves the way it does, not just *what* it does.

---

## 1. Purpose and Core Concept

The Strategic Market Engine is an automated **simulated trading system** targeting BTC-correlated binary prediction markets on Polymarket. It applies an **end-of-window micro-profit strategy**: entering high-probability positions during the final seconds of a prediction market window and collecting the spread between entry price and the $1.00 settlement payout.

The thesis is narrow: prediction market prices for short-window BTC directional markets (e.g., "Will BTC be above $X at time T?") converge toward 1.0 or 0.0 rapidly as the window nears its end, because BTC's position relative to the target price becomes observable and nearly certain. If BTC is comfortably above the target and 60 seconds remain, the "Up" token should trade near $0.97–$0.99 rather than $0.50. The system enters these high-probability positions and collects the residual gap to $1.00.

All trade execution is **simulated**, not live on-chain. The system uses real Polymarket market data, live BTC prices, and real orderbook depth to realistically model what trades *would* cost and yield, but no actual USDC is deployed.

---

## 2. System Architecture Overview

The system is a Node.js backend composed of six cooperating services, coordinated by a central `MarketOrchestrator`:

```
┌──────────────────────────────────────────────────────────────────────┐
│                        MarketOrchestrator                            │
│                                                                      │
│  MarketScanner ──▶ discovers BTC markets                             │
│  BtcPriceWatcher ──▶ streams live BTC/USD via RTDS WebSocket         │
│  MarketWebSocketWatcher ──▶ streams token prices via CLOB WebSocket  │
│  StrategyEngine ──▶ evaluates entry conditions on every tick         │
│  ExecutionSimulator ──▶ models FAK order fills against live books    │
│  PortfolioManager ──▶ tracks cash, sizes positions                   │
│                                                                      │
│  PerformanceCalculator ──▶ computes P&L and ROI statistics           │
│  MonteCarloSimulator ──▶ projects future equity curves               │
│  ApiServer ──▶ REST + WebSocket interface for frontend               │
└──────────────────────────────────────────────────────────────────────┘
```

The orchestrator acts as the event router: it wires events from all child services and coordinates state transitions. All services are singletons.

---

## 3. Market Discovery and Cataloging

### 3.1 Window Types

The system targets one of five configurable time windows:

| Window | Duration | Slug Prefix | Category |
|--------|----------|-------------|----------|
| 5M | 5 minutes | `btc-updown-5m` | `btc-5m` |
| 15M | 15 minutes | `btc-updown-15m` | `btc-15m` |
| 1H | 60 minutes | `btc-updown-1h` | `btc-1h` |
| 4H | 4 hours | `btc-updown-4h` | `btc-4h` |
| 1D | 24 hours | `btc-updown-1d` | `btc-1d` |

Only one window type is active at runtime (configured via `MARKET_WINDOW`). The window type determines slug patterns, scan coverage, and trading timing.

### 3.2 Deterministic Slug Computation

Rather than crawling all markets, the `MarketScanner` uses **deterministic slug computation**. Each BTC window market on Polymarket follows the slug convention:

```
{slugPrefix}-{UNIX_TIMESTAMP}
```

Where `UNIX_TIMESTAMP` is the Unix second of the window *start*, aligned to round boundaries:

```
currentWindowStart = Math.floor(nowSeconds / durationSeconds) * durationSeconds
```

On each scan cycle, the scanner computes slugs for:
- 2 past windows (lookbehind)
- The current window
- 3 upcoming windows (lookahead)

This produces **5 deterministic slugs** per scan that are passed directly to the Gamma API. This approach is highly efficient: it fetches exactly the right markets without scanning broad result sets.

### 3.3 Scan Cycle

The scanner runs on a configurable interval (`SCAN_INTERVAL_MS`, default 60 seconds). Each cycle:

1. Computes the 5 deterministic slugs
2. Fetches those markets from `gamma-api.polymarket.com/markets`
3. Filters out markets that are already `closed` (oracle-resolved)
4. For each new market: inserts into `markets` table (idempotent `ON CONFLICT DO NOTHING`)
5. Emits `newMarket` event only for genuinely new markets

The orchestrator deduplicates further via its in-memory `activeMarkets` Map.

### 3.4 Market Filtering Logic

A discovered market is skipped if:
- It is already in `activeMarkets` (deduplication)
- Its `endDate` is already in the past (expired before discovery)
- Its `clobTokenIds` or `outcomes` fields are missing or malformed (need both YES and NO tokens)
- Its slug doesn't start with the configured `slugPrefix` (safety guard)

### 3.5 Target Price Extraction

Each market's question text contains the BTC price target, e.g.:
```
"Will BTC be above $97,450.00 at 2026-02-21 15:05 UTC?"
```

The system parses this with a regex: `/(?:above|below)\s*\$([0-9,]+(?:\.\d+)?)/i`

For markets with a **fixed target price** (absolute level like `$97,450`), the extracted value is stored as `targetPrice`. For markets that resolve relative to the window-open price (Up/Down without a fixed level), `targetPrice` is null and is instead filled later from the BTC price at window start.

---

## 4. Market State Lifecycle

Each discovered market passes through three states tracked in `getLiveMarkets()`:

| Status | Condition |
|--------|-----------|
| `UPCOMING` | `now < windowStart` — window has not opened; BTC reference price unknown |
| `ACTIVE` | `windowStart <= now < endDate` — trading window is open |
| `ENDED` | `now >= endDate` — window closed, awaiting oracle resolution |

`windowStart = endDate - windowDurationMs`

The "price to beat" for relative markets is the BTC spot price captured at the moment `windowStart` is reached.

---

## 5. BTC Price Feed

### 5.1 Data Source

BTC/USD prices come from Polymarket's **RTDS WebSocket** (`wss://ws-live-data.polymarket.com`), which streams Chainlink oracle prices at approximately 1 tick/second. The system subscribes to the `crypto_prices_chainlink` topic filtered to `btc/usd`.

On subscribe, Chainlink sends a historical backfill (`type: "subscribe"` via the `crypto_prices` topic) that pre-seeds the price history buffer, enabling accurate `getPriceAt()` lookups for windows that opened before the server started.

### 5.2 Price History Buffer

All incoming ticks are stored in a rolling in-memory array with a **60-minute TTL**. The buffer is pruned every 60 ticks (not on every tick, to reduce GC pressure). Binary search is used for O(log N) point-in-time price lookups.

### 5.3 Staleness Watchdog

A dedicated watchdog checks every 10 seconds whether a price tick has been received in the last 30 seconds. If the feed goes stale (RTDS can silently stop sending while keeping the TCP connection open), the watchdog force-terminates and reconnects the WebSocket immediately — bypassing exponential backoff since 30+ seconds of staleness is already an emergency. Regular disconnects use exponential backoff: `1s × 2^attempt + random(500ms)`, capped at 30s.

### 5.4 BTC Window-Start Price

When a market transitions to `ACTIVE`, the system needs to know the "price to beat." It attempts to fill `btcPriceAtWindowStart` using two strategies in order:

1. **Historical lookup**: If the price history buffer contains data predating `windowStart`, `getPriceAt(windowStartMs)` is called (binary search). This is the normal path for markets discovered while the server is running.
2. **Current price fallback**: If the buffer doesn't cover the window start (server restarted mid-window), the current live price is used instead. This is logged with `source: "current"`.

If BTC isn't connected yet (neither history nor current price available), the market waits in `pendingBtcFills` and is filled on the next BTC tick.

### 5.5 Momentum Signal

The BTC watcher can compute a **momentum signal** over a configurable lookback window (`MOMENTUM_LOOKBACK_MS`, default 90 seconds):

```
changeUsd = currentPrice - priceAt(now - lookbackMs)
direction = changeUsd > +minChangeUsd  → "UP"
            changeUsd < -minChangeUsd  → "DOWN"
            otherwise                  → "NEUTRAL"
```

The minimum change threshold (`MOMENTUM_MIN_CHANGE_USD`, default $20) prevents signals during sideways chop. This signal is computed fresh on every price tick and passed to the strategy engine.

---

## 6. Market Token Price Feed (CLOB WebSocket)

### 6.1 Connection and Subscription

The `MarketWebSocketWatcher` connects to Polymarket's CLOB WebSocket (`wss://ws-subscriptions-clob.polymarket.com/ws/market`) with `custom_feature_enabled: true`. This enables two additional event types beyond the default:
- `best_bid_ask`: top-of-book changes (fires faster than `price_change`)
- `market_resolved`: oracle settlement notification

When a new market is discovered, both its YES and NO token IDs are subscribed immediately. Subscriptions persist across reconnects (the `subscribedTokens` set is replayed on reconnect).

### 6.2 Event Types Handled

| Event | Data Provided | Action |
|-------|--------------|--------|
| `price_change` | `best_bid`, `best_ask` per token | Cache prices, evaluate strategy, check stop-loss/take-profit |
| `best_bid_ask` | Same as `price_change` | Same handling — both paths lead to `onTokenPriceUpdate` |
| `book` | Full orderbook snapshot | Emit for orderbook display (not used for entry decisions) |
| `market_resolved` | `conditionId`, `winningAssetId`, `winningOutcome` | Trigger immediate position resolution |
| `tick_size_change` | Old/new tick size | Log only (price near extremes indicator) |

Both `price_change` and `best_bid_ask` are handled identically because they carry the same best bid/ask data. The system fires on whichever arrives first.

### 6.3 Price Caching and Freeze Behavior

Incoming bid/ask ticks update `state.lastPrices[tokenId]` with `{ bid, ask, mid: (bid+ask)/2 }`. Crucially, price updates are **frozen once the market's `endDate` has passed**. After window close, the CLOB stops streaming price changes and prices drift toward settlement values; freezing prevents stale/misleading data from influencing decisions.

---

## 7. Strategy Engine: Opportunity Detection

The strategy engine evaluates whether to enter a trade on every incoming price tick. All checks must pass for an opportunity to be emitted.

### 7.1 Complete Gate Sequence

```
For each token price update (bestBid, bestAsk):
  ├── Is this token registered?                          [skip if not]
  ├── Track BTC crossovers (always, even if bailing)     
  ├── Already evaluated this token?                      [skip if yes]
  ├── Is market window currently open?                   [skip if not]
  │   (secondsToEnd ∈ [0, tradeFromWindowSeconds])
  ├── midpoint >= entryPriceThreshold?                   [skip if no]
  ├── midpoint <= maxEntryPrice?                         [skip if no]
  ├── BTC price available?                               [skip if no]
  ├── targetPrice set?                                   [skip if null]
  ├── btcDistanceUsd >= minBtcDistanceUsd?               [skip if no]
  ├── Momentum filter passes?                            [skip if fails]
  ├── Oscillation filter passes?                         [skip if fails]
  └── openPositionCount < maxSimultaneousPositions?      [skip if at limit]
      → Emit "opportunityDetected"
```

### 7.2 Time Window Gate

```
secondsToEnd = (market.endDate - now) / 1000

Valid range: 0 < secondsToEnd <= tradeFromWindowSeconds (default 90s)
```

The system only enters in the **final `tradeFromWindowSeconds`** before the window closes. This is the micro-profit thesis: with less than 90 seconds remaining, a well-positioned trade has minimal time to go wrong.

### 7.3 Price Range Gate

Two price thresholds operate together:

| Parameter | Default | Meaning |
|-----------|---------|---------|
| `entryPriceThreshold` | 0.94 | Minimum midpoint to consider; below this, probability of winning is too uncertain |
| `maxEntryPrice` | 0.98 | Maximum midpoint; above this, the $0.02-or-less upside doesn't justify risk |

The entry window is the band: **[0.94, 0.98]**. Tokens priced outside this band are skipped.

### 7.4 BTC Distance Gate

```
btcDistanceUsd = |currentBtcPrice - market.targetPrice|

Must satisfy: btcDistanceUsd >= minBtcDistanceUsd (default $50)
```

If BTC is too close to the target price, the outcome is genuinely uncertain even in the final seconds — the market could move either way. The minimum distance ensures the system only trades when BTC is clearly on one side.

### 7.5 Momentum Filter (optional)

When `MOMENTUM_ENABLED=true`, the current BTC momentum signal is checked against the token's outcome label:

| Scenario | Action |
|----------|--------|
| No data (insufficient history) | Skip — conservative |
| Momentum is NEUTRAL | Skip — no directional edge |
| Trading "Up" but momentum is DOWN | Skip — direction mismatch |
| Trading "Down" but momentum is UP | Skip — direction mismatch |
| Momentum aligns with trade direction | Proceed |

This filter ensures the position is aligned with near-term BTC momentum, not just end-of-window pricing.

### 7.6 Oscillation Filter (optional)

When `OSCILLATION_FILTER_ENABLED=true`, the strategy engine tracks every time BTC crosses the market's target price. A **crossover** is recorded each time BTC switches sides (UP → DOWN or DOWN → UP).

```
recentCrossovers = count of crossovers within last oscillationWindowMs (default 60s)

Skip if: recentCrossovers >= oscillationMaxCrossovers (default 3)
```

Frequent crossovers indicate BTC is oscillating around the target — directional positions are unreliable in this condition. The filter prevents entering choppy markets even if all other criteria are met.

Crossover data is persisted to the market's `metadata` column on cleanup for post-analysis.

### 7.7 One-Opportunity-Per-Token Guarantee

Once an opportunity is detected for a token, that token is added to `evaluatedTokens`. Subsequent ticks for the same token are silently skipped. This ensures at most one trade per token per market.

If execution fails (no orderbook, insufficient liquidity, or price ceiling breach), `clearEvaluated(tokenId)` is called to allow a retry on the next tick.

---

## 8. Trade Execution Simulation

### 8.1 FAK Order Model

When an opportunity is confirmed, the system simulates a **Fill-And-Kill (FAK) taker buy**:

1. Fetch the live CLOB orderbook for the token
2. Walk asks from lowest to highest price
3. At each level: fill as many shares as budget allows, capped by available size at that level
4. Stop when budget is exhausted OR all eligible asks (price ≤ `maxEntryPrice`) are consumed
5. Any unfilled budget is discarded (the "Kill" in FAK)

This accurately models Polymarket's FAK order type for time-sensitive entries.

### 8.2 Position Budget Computation

```
portfolioValue = cashBalance + sum(actualCost of open positions)
rawBudget = portfolioValue / maxSimultaneousPositions

feePerShare = calculateFeePerShare(maxEntryPrice)
costPerShare = maxEntryPrice + feePerShare
minBudget = POLYMARKET_MIN_ORDER_SIZE × costPerShare   // 5 shares minimum

budget = max(rawBudget, minBudget)
budget = min(budget, cashBalance)           // never exceed available cash

if cashBalance < minBudget → return 0      // can't afford minimum order
```

Sizing is based on `maxEntryPrice` (the worst-case price accepted), not the current mid. This guarantees the budget can always fill at least `POLYMARKET_MIN_ORDER_SIZE` (5) shares even at the ceiling price.

### 8.3 Fee Model

Polymarket uses a quadratic fee formula for crypto markets:

```
fee_per_share = feeRate × (p × (1 - p))^exponent
             = 0.25 × (p × (1 - p))^2
```

Where `p` is the share price (0–1). Key properties:
- Fee is **highest at p = 0.50** (~1.56% effective rate) — maximally uncertain outcomes
- Fee is **nearly zero at extremes** — at p = 0.97: `fee ≈ 0.000212 USDC/share` (~0.02%)
- This means positions at high probability cost almost nothing in fees

The simulation models **taker fees only** (conservative — real limit orders may receive a 20% maker rebate). Fees are rounded to 4 decimal places (Polymarket's precision).

### 8.4 Minimum Order Size Enforcement

If the simulation fills fewer than `min_order_size` shares (typically 5, from the orderbook API), the result is flagged `belowMinimumOrderSize = true` and the trade is rejected. Polymarket would reject such an order at the protocol level.

### 8.5 Expected Profit Validation

Before committing the trade, expected profit is checked:

```
expectedProfit = (1.00 - averageFillPrice) × totalShares - fees
```

If `expectedProfit < 0.001`, the trade is abandoned (too small to be worthwhile).

### 8.6 Concurrency Guard

The `inFlightTokenIds` set prevents concurrent duplicate executions for the same token. If an `onOpportunity` call is already running for a token, subsequent calls for that same token are immediately skipped. The token is removed from the set in the `finally` block.

---

## 9. Position Management

### 9.1 In-Memory Position State

Each open position is tracked in `OpenPosition`:

| Field | Meaning |
|-------|---------|
| `tradeId` | UUID from DB |
| `marketId` | Which market |
| `tokenId` | Which token (YES or NO) |
| `outcomeLabel` | "Up" or "Down" |
| `entryPrice` | Volume-weighted average fill price |
| `entryShares` | Total shares bought |
| `fees` | Total entry fees paid |
| `actualCost` | Cash deducted: `shares × avgPrice + fees` |
| `marketEndDate` | When the window closes |
| `minPriceDuringPosition` | Lowest bestBid seen while window is open |
| `stopLossTriggered` | Prevents concurrent stop-loss execution |
| `takeProfitTriggered` | Prevents concurrent take-profit execution |

### 9.2 Index Structures

Three secondary indexes enable O(1) lookups:
- `tokenToMarket`: `tokenId → marketId` — used for every price tick
- `positionsByMarket`: `marketId → Set<tradeId>` — used for resolution checks
- `positionsByToken`: `tokenId → Set<tradeId>` — used for stop-loss/take-profit checks

### 9.3 Portfolio Value Accounting

Open position value is reported as **cost basis** (cash invested), not mark-to-market:

```
openPositionsValue = sum(pos.actualCost for all open positions)
portfolioValue = cashBalance + openPositionsValue
```

This prevents mark-to-market volatility from distorting position sizing. The displayed portfolio value = cash + what was spent on open positions.

---

## 10. Active Risk Management (Stop-Loss and Take-Profit)

Both controls operate on **price triggers** during the active market window only. After `endDate`, prices naturally move toward 0.50 during oracle settlement — triggering exit controls post-window would incorrectly close winning positions.

### 10.1 Stop-Loss

**Trigger**: `bestBid < stopLossPriceTrigger` (default 0.75)

When triggered:
1. Fetch live CLOB orderbook
2. Simulate a FAK **limit sell at price = 0** (accept any bid — full market sell)
3. Walk bids from highest to lowest, filling all available
4. Compute exit price as volume-weighted average of filled bids
5. If no orderbook available, use the trigger bid as approximation

```
PnL = (exitPrice - entryPrice) × shares - entryFees - exitFees
```

A stop-loss doesn't guarantee a loss — if the exit price is above entry price (e.g., bid spiked temporarily), the PnL can be positive and the trade is classified as WIN.

**Cash effect**: `sellProceeds = shares × exitPrice - exitFees` is returned to cash.

### 10.2 Take-Profit

**Trigger**: `bestBid >= takeProfitTriggerPrice` (default 0.88)

Same execution mechanics as stop-loss (FAK sell against live bid side), but triggered when the bid rises above the take-profit threshold. This locks in gains before the market window closes, at the cost of potentially missing a higher settlement at 1.0.

```
PnL = (exitPrice - entryPrice) × shares - entryFees - exitFees
```

### 10.3 Partial Fill Warning

During exit simulation, `isPartialFill = remainingShares > 10% of totalShares`. A partial fill means insufficient bid-side liquidity — only part of the position was liquidated. The trade is still resolved using the partial fill data.

---

## 11. Market Resolution and Settlement

### 11.1 Dual Resolution Path

Markets resolve via two concurrent mechanisms:

**Primary — WebSocket `market_resolved` event**:
- The CLOB WebSocket emits a `market_resolved` message with `conditionId`, `winningAssetId`, `winningOutcome`
- The orchestrator maps `conditionId → marketId` via in-memory `conditionIdMap` for O(1) lookup
- Resolution is applied immediately

**Secondary — Polling fallback**:
Immediately after a trade is opened, the system schedules resolution polling for that market:
- **Fast phase**: poll every 5s for first 2 minutes (typical oracle resolution window)
- **Slow phase**: poll every 30s thereafter
- **Hard timeout**: after 30 minutes, force-resolve remaining positions as LOSS

Polling calls `getMarketById()` on the Gamma API and looks for a token with `outcomePrices >= 0.99` (the oracle has settled it to $1.00 for the winner).

### 11.2 PnL at Resolution

When a market resolves with oracle prices (1.0 for winner, 0.0 for loser):

```
WIN:  pnl = (1.00 - entryPrice) × shares - fees
LOSS: pnl = -(entryPrice × shares + fees)
```

**Cash return on resolution**:
```
cashReturn = actualCost + pnl
```

For a WIN: cash increases by the profit component.
For a LOSS: cash decreases by the full entry cost (already deducted on entry, and `actualCost + negative pnl` results in net loss).

### 11.3 Force Resolution

If a market fails to resolve within 30 minutes, the system makes one final API attempt. Any positions still open after this are force-closed as LOSS (`exitReason: "FORCE_TIMEOUT"`) to prevent positions from lingering indefinitely. The force-loss uses `exitPrice: 0` and deducts full entry cost.

### 11.4 Consecutive Loss Counter

Every trade resolution (including stop-loss and take-profit exits) updates the consecutive loss counter:
- WIN → counter resets to 0
- LOSS → counter increments

If counter reaches `consecutiveLossPauseLimit` (default 3), the system **auto-pauses**: the scanner stops, no new positions are opened, existing positions continue to be tracked and resolved.

If `riskAutoResumeEnabled=true`, the system auto-resumes after `riskAutoResumeCooldownMs` (default 5 minutes) and the loss counter is reset.

---

## 12. Cash and Portfolio Accounting

### 12.1 Cash Flow Model

| Event | Cash Effect |
|-------|-------------|
| Trade opened | `- actualCost` (shares × avgFillPrice + fees) |
| WIN resolution | `+ actualCost + profit` = `+ shares × 1.0 - fees` |
| LOSS resolution | 0 (cost already deducted; nothing is returned) |
| Stop-loss sell | `+ shares × exitPrice - exitFees` |
| Take-profit sell | `+ shares × exitPrice - exitFees` |

Cash balance is persisted to the `portfolio` table after every mutation, ensuring survival across restarts.

### 12.2 Initial Capital and Portfolio Value

The portfolio is initialized once on first run with `STARTING_CAPITAL` (default $100 USDC). On restart, the existing DB row is reloaded.

```
portfolioValue = cashBalance + openPositionsValue (cost basis of open positions)
ROI = (portfolioValue - initialCapital) / initialCapital × 100
```

---

## 13. Performance Metrics

The performance calculator aggregates settled trades for four time periods: 1D, 1W, 1M, ALL.

### 13.1 Metrics Computed

| Metric | Calculation |
|--------|-------------|
| `totalPnl` | Sum of `realizedPnl` for all SETTLED trades in period |
| `totalDeployed` | Sum of `actualCost` for all trades in period |
| `winRate` | `wins / closedTrades × 100` |
| `avgWin` | Mean PnL of winning trades |
| `avgLoss` | Mean PnL of losing trades |
| `largestWin` / `largestLoss` | Extreme PnL values |
| `totalFees` | Sum of `entryFees` for all trades |
| `avgBtcDistance` | Mean of `btcDistanceUsd` at entry |
| `roi` | `(cashBalance + openPositionsValue - initialCapital) / initialCapital × 100` |
| `unrealizedPnl` | `(currentPrice - entryPrice) × shares - fees` for each OPEN trade |

### 13.2 Unrealized PnL

For open positions, unrealized PnL is computed using live prices from the `livePriceMap` (token → current midpoint). This reflects what the position would be worth if closed at the current market price, not at settlement.

---

## 14. Monte Carlo Risk Analysis

### 14.1 Purpose

The Monte Carlo module takes the realized PnL distribution from historical settled trades and bootstraps (random-with-replacement sampling) to project the distribution of possible future equity curves.

### 14.2 Algorithm

1. **Load** all SETTLED trades from the DB; extract `realizedPnl` values into a pool
2. **Compute historical statistics** (win rate, avg win/loss, profit factor, expectancy) in a single pass
3. **Run N simulations** (default 10,000), each with M trades (default 100):
   - Start at `startingCapital`
   - Each "trade" picks a random PnL from the pool (bootstrap sampling)
   - Track the equity curve and max drawdown during the run
4. **Co-sort** all simulations by final balance (keeps curves and drawdowns aligned)
5. **Compute distribution statistics**: mean, stdDev, p5/p25/p50/p75/p95, profit probability (% of sims ending above startingCapital), ruin probability (% of sims hitting >50% drawdown)
6. **Extract equity curves** at key percentiles (5th, 25th, 50th, 75th, 95th) for visualization

### 14.3 Classification Note

Monte Carlo uses **realized PnL** (not exitOutcome) to classify wins/losses. This means a stop-loss exit that yields positive PnL (exit above entry) is counted as a win, not a loss — which is the economically correct classification.

### 14.4 Output

| Section | Contents |
|---------|----------|
| `historical` | Win rate, avg win/loss PnL, profit factor, expectancy |
| `distribution` | Histogram (20 buckets), percentiles, mean, stdDev, profitProbability, ruinProbability |
| `equityCurves` | 5 percentile equity curves (array of balance points) |
| `drawdown` | Median, p95, worst max-drawdown across simulations |

---

## 15. Complete Decision Flow: Market Discovery to Settlement

```
1. SCANNER (every 60s)
   Compute 5 deterministic slugs → fetch from Gamma API
   → New market found → emit "newMarket"

2. ORCHESTRATOR receives "newMarket"
   Parse tokenIds, outcomes, targetPrice from question
   Skip if: expired, already tracked, missing tokens/outcomes
   Create ActiveMarketState, register in activeMarkets Map
   Subscribe both tokenIds to CLOB WebSocket
   Queue for BTC window-start price fill if window not yet open

3. BTC PRICE TICK (every ~1s from RTDS)
   Update priceHistory buffer
   Fill btcPriceAtWindowStart for any markets whose window just opened
   Update momentum signal
   → For relative markets: send targetPrice to StrategyEngine

4. MARKET TOKEN PRICE TICK (any frequency from CLOB)
   Cache bid/ask/mid in state.lastPrices (freeze after endDate)
   Update minPriceDuringPosition for open positions on this token
   Compute momentum signal (from BTC watcher)
   → StrategyEngine.evaluatePrice(tokenId, bestBid, bestAsk, btcPriceData, momentum)

5. STRATEGY ENGINE evaluates (on every tick):
   ✓ Token registered?
   Track BTC crossovers (always)
   ✓ Not already evaluated?
   ✓ Within last tradeFromWindowSeconds of window?
   ✓ midpoint in [entryPriceThreshold, maxEntryPrice]?
   ✓ BTC price available?
   ✓ targetPrice set?
   ✓ btcDistanceUsd >= minBtcDistanceUsd?
   ✓ Momentum filter passes (if enabled)?
   ✓ Oscillation filter passes (if enabled)?
   ✓ openPositionCount < maxSimultaneousPositions?
   → emit "opportunityDetected"

6. ORCHESTRATOR receives "opportunityDetected":
   Guard: token not in inFlightTokenIds
   Fetch live CLOB orderbook
   Compute positionBudget (portfolioValue / maxPositions, floored at minShares cost)
   simulateLimitBuy: walk asks up to maxEntryPrice, fill at each level
   Reject if: 0 shares filled, below minOrderSize, expectedProfit < 0.001
   Deduct actualCost from cashBalance (persisted to DB)
   Create simulatedTrade row (status=OPEN)
   trackPosition in openPositions + secondary indexes
   scheduleResolutionMonitor for this marketId
   Emit "tradeOpened"

7. DURING ACTIVE WINDOW:
   Every CLOB tick → checkStopLoss(tokenId, bestBid)
     If bestBid < stopLossPriceTrigger AND window still open:
       Fetch orderbook → simulateLimitSell(shares, 0) → exit at bid-side WAP
       resolveTrade with exitReason=STOP_LOSS
   Every CLOB tick → checkTakeProfit(tokenId, bestBid)
     If bestBid >= takeProfitTriggerPrice AND window still open:
       Fetch orderbook → simulateLimitSell(shares, 0) → exit at bid-side WAP
       resolveTrade with exitReason=TAKE_PROFIT

8. AFTER WINDOW CLOSE:
   CLOB WS stops streaming for ended market
   Stop-loss/take-profit checks frozen (endDate guard)
   Resolution polling begins: poll Gamma API every 5s for 2 min, then every 30s
   CLOB WS may also deliver market_resolved event (whichever arrives first)

9. RESOLUTION:
   Determine winning tokenId (price >= 0.99 from API, or winningAssetId from WS)
   For each open position on this market:
     isWin = (pos.tokenId == winningTokenId)
     exitPrice = 1.0 (WIN) or 0.0 (LOSS)
     pnl = isWin ? (1.0 - entryPrice) × shares - fees : -(entryPrice × shares + fees)
     cashReturn = actualCost + pnl
     addCash(cashReturn)
     resolveTrade (status=SETTLED, exitOutcome=WIN/LOSS, realizedPnl=pnl)
   updateConsecutiveLossState(isWin)
   untrackPosition (remove from all indexes)

10. CLEANUP:
    If no remaining open positions for market:
      Persist crossover data to markets.metadata
      Unsubscribe from CLOB WS
      Unregister from StrategyEngine
      Remove from all in-memory maps
    Expired markets with no positions: cleaned up every 10s
```

---

## 16. Key Assumptions and Constraints

### 16.1 Strategy Assumptions

- **Near-resolution price convergence**: The fundamental thesis assumes that BTC window prediction markets converge toward their settlement value in the final seconds. If Polymarket liquidity is thin or market makers are slow, convergence may be incomplete.
- **BTC position is observable**: The system assumes BTC's position relative to the target is clear enough to be priced by the market (enforced by `minBtcDistanceUsd`).
- **Prices are accurate**: Both the BTC price feed (Chainlink via RTDS) and token prices (CLOB WebSocket) are assumed to be timely and representative.

### 16.2 Execution Assumptions

- **Taker-only model**: All simulated orders are modeled as FAK takers (pay the spread). Real execution could use limit orders as makers (receive a 20% fee rebate), which would reduce costs.
- **No market impact**: The simulation assumes the simulated order does not move the market. For small position sizes relative to orderbook depth, this is reasonable.
- **CLOB orderbook is representative**: The orderbook fetched at execution time reflects the actual fill you'd receive. In reality, by the time an order is placed, the book may have changed.

### 16.3 Simulation Limitations

- No real USDC is deployed; this is a simulation tool. All P&L is tracked in a simulated portfolio.
- The system cannot guarantee that a real order would fill identically to the simulation — slippage, latency, and orderbook changes between decision and execution are not modeled.
- Force-timeout losses (FORCE_TIMEOUT) are a conservative fail-safe, not necessarily the true outcome of the trade.

### 16.4 Operational Constraints

| Constraint | Value | Rationale |
|-----------|-------|-----------|
| Min shares per order | 5 | Polymarket protocol minimum |
| Max simultaneous positions | configurable (default 5) | Portfolio risk management |
| Entry window | last 90s of market | Micro-profit thesis |
| Min BTC distance | $50 | Avoid uncertain outcomes |
| Price band | [0.94, 0.98] | Balance probability vs. payout |
| Consecutive loss pause | 3 losses | Prevent runaway drawdown |
| Resolution hard timeout | 30 minutes | Prevent zombie positions |
| Stop-loss only during window | Yes | Prevent false triggers post-close |

### 16.5 Known Edge Cases

- **Server restart mid-window**: Markets already open when the server restarts use the current BTC price as the window-start reference, not the true opening price. This can make `btcDistanceUsd` inaccurate.
- **Oscillation filter history loss on restart**: Crossover history is in-memory and not persisted during a window. After a restart, the oscillation filter has no crossover history until BTC crosses the target.
- **Partial sell liquidity**: Stop-loss and take-profit exits may partially fill if bid-side depth is thin. The remaining unsold shares are treated as unresolved and will settle with the market oracle.

---

## 17. Configuration Reference

All strategy behavior is controlled via environment variables:

| Variable | Default | Effect |
|----------|---------|--------|
| `MARKET_WINDOW` | `5M` | Window duration: 5M, 15M, 1H, 4H, 1D |
| `STARTING_CAPITAL` | `100` | Initial USDC portfolio value |
| `TRADE_FROM_WINDOW_SECONDS` | `90` | Only enter in final N seconds |
| `ENTRY_PRICE_THRESHOLD` | `0.94` | Minimum token midpoint to enter |
| `MAX_ENTRY_PRICE` | `0.98` | Maximum token midpoint to enter |
| `MAX_SIMULTANEOUS_POSITIONS` | `5` | Portfolio slot limit |
| `MIN_BTC_DISTANCE_USD` | `50` | Minimum BTC distance from target |
| `SCAN_INTERVAL_MS` | `60000` | How often to scan for new markets |
| `STOP_LOSS_ENABLED` | `true` | Enable stop-loss mechanism |
| `STOP_LOSS_PRICE_TRIGGER` | `0.75` | Bid price below which to stop-loss |
| `TAKE_PROFIT_ENABLED` | `true` | Enable take-profit mechanism |
| `TAKE_PROFIT_TRIGGER_PRICE` | `0.88` | Bid price above which to take profit |
| `MOMENTUM_ENABLED` | `true` | Enable momentum alignment filter |
| `MOMENTUM_LOOKBACK_MS` | `90000` | BTC lookback for momentum signal |
| `MOMENTUM_MIN_CHANGE_USD` | `20` | Threshold for non-neutral momentum |
| `OSCILLATION_FILTER_ENABLED` | `true` | Enable oscillation filter |
| `OSCILLATION_WINDOW_MS` | `60000` | Lookback for crossover counting |
| `OSCILLATION_MAX_CROSSOVERS` | `3` | Max crossovers before skip |
| `CONSECUTIVE_LOSS_PAUSE_LIMIT` | `3` | Losses before auto-pause |
| `RISK_AUTO_RESUME_ENABLED` | `false` | Auto-resume after cooldown |
| `RISK_AUTO_RESUME_COOLDOWN_MS` | `300000` | Cooldown before auto-resume |
