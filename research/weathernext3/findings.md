# WeatherNext 3 × Polymarket temperature ladders: findings

## Final implemented rule (v2, 2026-09-26)

v2 re-ran the backtest on Earth Engine data covering all 612 hourly runs (Aug 31 – Sep 25). Scripts are `backtest/ee-pull.mjs` and `backtest/bt2.mjs`; output is in `backtest/results-v2.txt`. Parameters were chosen on Sep 12–21 and confirmed on both untouched holdouts.

| Choice | Decision | Evidence (hourly runs, modelled spreads, 20¢ stop) |
|---|---|---|
| Runs | **Every hourly run** (interim + 6-hourly) | Same or higher total P&L than 6-hourly only ($2,173 vs $2,045 across splits), tighter CIs |
| Edge threshold | **0.20** after fees | Best on explored days (+23.0%/trade, CI 9.1–34.8). Holdouts: late +17.5% (CI 6.4–28.2), early +31.6% (CI 20.9–41.2) |
| Uncertainty | **Lead-band sigma** (0.875 / 0.904 / 0.95 °C) | Ensemble-spread sigma (p10/p90) was worse, with the late holdout negative, so rejected. Only the `mean` band is fetched |
| City bias | **Seeded from the 24-day fit, updated online at resolution** (decay 0.98, prior weight 8) | Online-from-scratch underperforms the static fit because early data is thin. Seeding avoids that; the online update exists to track seasonal drift and **cannot be validated in-sample** |
| Lead cutoff (≤ 18 h) | Not adopted | No consistent gain |
| Stop | `STOP_LOSS_DELTA` env, default **0.20** | 0.30 is marginally higher; 0.10 costs ~3–4 pts; 0.05 ruins the edge |
| Data source | **Earth Engine only** | Values are identical to BigQuery (≤ 0.005 °C). ~100 EECU·s per run, so all hourly runs use ≈ 20 of the 150 EECU-h/month |

**Out-of-sample:** the same constants scored unchanged on all of August 2026 (six-hourly runs) give +37.0%/trade (CI 28.0–46.7) over 1,864 trades. See the v3 section below.

Expected live flow: ≈ 70 entries/day across 51 cities at $5 each, a ~55% take-profit hit rate, and a median hold of about a day.

## v1 analysis (6-hourly BigQuery runs)

Research date 2026-09-26.

**Data**
- 1,220 closed city/day ladders (51 cities, Sep 2–25 2026) with 10-min midpoint history.
- 102 WeatherNext 3 six-hourly runs (Aug 31 12Z – Sep 25 18Z), station-head mean temperature at every resolution station.
- Real publish times from the `success` markers.
- Scripts and full output are in `backtest/`. WN3 facts are in `weathernext3.md` and market structure in `polymarket-weather-markets.md`.

## Answer in brief

- **Speed is not the edge.** WN3 publishes ~7.3 h after init, about when the matching ECMWF cycle lands, and the market reprices on model cycles within minutes. **Accuracy at the resolution station is the edge.**
- **The market is well calibrated, but WN3 adds information it doesn't have.** Pooling WN3 with the market improves out-of-sample log-loss from **1.315 to 1.227**. The same weight (market 0.8, WN3 0.7) was selected on every held-out day. WN3's error on the daily max beats the market's implied expectation at ≥18 h leads (0.90 vs 0.93 °).
- **A tradable rule survives realistic costs and two untouched holdouts.** Enter when WN3's bucket probability beats the tradable price by ≥15 points after fees, take profit when the market reaches WN3's price, otherwise hold to resolution. The existing 10¢ confirmed stop can stay.
- **The "revision momentum" rule does not survive.** That rule trades the direction of run-to-run changes over a few hours. It looked strong on partial data, but on the full data it is +2.4% (CI −4.5% to +10.7%) and negative on one holdout. **Not recommended.**

## 1. How the market behaves

| Observation | Evidence |
|---|---|
| Reprices in bursts on model cycles | Pre-day ≥10¢ jumps peak at 05–06Z (~650 per hour-of-day vs 100–350 at other hours) |
| No momentum after moves | 6 h continuation after a ≥5¢ move: +0.35¢ at model hours, −0.81¢ at other hours; cost is 2–4¢ |
| Very well calibrated | Every price bin from 10¢ to 70¢ realises within ~1 point. Only a slight longshot overpricing (2–10¢ bins, −1.2 points) |
| Still uncertain at day start | Mean winner price 0.38 at local midnight of D, and only 28% of ladders have the winner ≥ 0.5 |
| Spreads depend on horizon | 0–18 h to day start: 2–3¢. 18 h+: 12–29¢ on 5–30¢ buckets (1,583-book snapshot) |

## 2. WN3 vs market accuracy

Leave-one-day-out model: max of hourly station-head mean over the local day, per-city bias (shrunk), normal error by lead band, and integer-degree buckets.

| Lead to local day | Brier mkt / WN3 | Log-loss mkt / WN3 | MAE of expected max mkt / WN3 |
|---|---|---|---|
| 36 h+ | 0.708 / 0.705 | 1.392 / 1.428 | 1.17 / 1.08 |
| 18–36 h | 0.676 / 0.702 | 1.314 / 1.404 | 0.93 / 0.90 |
| 0–18 h | 0.635 / 0.680 | 1.214 / 1.334 | 0.83 / 0.85 |
| on-day | 0.594 / 0.667 | 1.119 / 1.295 | 0.78 / 0.85 |

WN3 alone has comparable point accuracy but a worse probability shape, because a fixed normal sigma is crude. Combined with the market, it clearly adds information.

## 3. The validated rule

**Entry.** Evaluate each WN3 run 10 min after it publishes, for every bucket with a tradable price of 3–97¢:
- Estimated spread must be ≤ 3¢. In the backtest this comes from the spread model; live, it comes from the actual book.
- YES if `p_wn3 − (ask + fee) ≥ 0.15`. NO if `(1 − p_wn3) − (noAsk + fee) ≥ 0.15`.
- First entry per bucket only.

**Exit**
- **Take profit** when the held side's bid reaches `p_wn3` at entry.
- Otherwise the 10¢ confirmed stop.
- Otherwise resolution.

**Results.** Return per $ staked, taker fees on both legs, modelled spreads:

| Sample | n | Mean/trade | Day-bootstrap 95% CI |
|---|---|---|---|
| All days (no stop) | 1,832 | +23.0% | +13.6% to +29.7% |
| Holdout Sep 22–25 (no stop) | 286 | +13.9% | +6.8% to +23.2% |
| Holdout Sep 2–11 (no stop) | 865 | +30.9% | +18.3% to +43.0% |
| Holdout Sep 22–25 (10¢ stop) | 286 | +9.4% | +7.1% to +11.0% |
| Holdout Sep 2–11 (10¢ stop) | 865 | +25.8% | +15.9% to +34.6% |
| Placebo: same rule, WN3 forecasts shuffled across days | 4,099 | −12.4% | −17.5% to −6.4% |

**Anatomy of the trades**
- 57% exit on take-profit, averaging +113%. The rest mostly go to zero.
- Median hold is 31 h. A 24 h time cap still gives +13.8%. A 12 h cap gives ~0.
- **The market converges toward WN3 mainly during the local day, as observations arrive.**
- The edge concentrates **within 18 h of the local day start**:
  - 0–18 h YES: +59%, n=638
  - 0–18 h NO: +12%
  - 18–36 h NO: ≈ 0
- A 5¢ stop kills the edge (≈ +4%). 10¢ keeps most of it. 20¢ ≈ no stop.

## 4. Caveats (honest)

- **Spreads are modelled from one snapshot** (by lead band × price), not historical books. The live engine uses real books, which is the true test.
- **Top-of-book is often only $2–10**, so a $5 taker order may walk a level. The simulator already fills level by level.
- **24 days of one season.** Holdouts are split by date, not by regime.
- **Only 6-hourly runs were tested.** Interim hourly runs (48 h horizon) are untested.
- **The parameters were chosen on Sep 12–21 and frozen before scoring the holdouts** (θ = 0.15, 3¢ spread filter, take-profit at model price). I did explore several variants on those days, which is why only the frozen rule is reported for the holdouts.
- **I made two data bugs along the way**, both fixed and noted:
  - a hyphen parse in °F buckets;
  - a 2.8 km cell radius that silently mapped NYC, Toronto and Singapore to other cities' series.

  Early "revision momentum" numbers were computed before those fixes and should be disregarded.

## 5. Quota used

About 186 GB of BigQuery sandbox quota (1 TiB/month free), plus ~2.3 GB of GCS Zarr downloads for the chunk-format probes. No billing is possible on the project.

## v3 research round (2026-09-26, after go-live)

### Fully out-of-sample check: August 2026

The deployed constants (θ 0.20, lead-band sigma, seeded city bias, 20¢ stop) were fitted on September only. They were scored unchanged on August 1–31:
- 1,517 closed ladders;
- 132 six-hourly WN3 runs from EE (the August backfill has no interim runs);
- publish latency modelled at 7.5 h.

| | n | mean / trade | 95% CI | total ($5) |
|---|---|---|---|---|
| All of August | 1,864 | **+37.0%** | 28.0 – 46.7 | $3,446 |
| Days 1–8 / 9–16 / 17–24 / 25–31 | | +30.9 / +34.0 / +33.6 / +53.4% | | |

- **No sign of hindcast leakage.** On its own, WN3 is *worse* than the market in August:
  - log-loss 1.460 vs 1.316;
  - daily-max MAE 0.815 vs 0.765 °C.

  The profit comes from the buckets where the two disagree by ≥ 20 points, not from WN3 being a better standalone forecast.
- **Threshold grid on both months:**

  | θ | Aug n / mean / total | Sep n / mean / total |
  |---|---|---|
  | 0.15 | 2,838 / +22.6% / $3,209 | 2,964 / +18.2% / $2,693 |
  | 0.20 | 1,864 / +37.0% / $3,446 | 1,943 / +28.8% / $2,796 |
  | 0.25 | 1,091 / +47.1% / $2,567 | 1,162 / +40.3% / $2,342 |
  | 0.30 | 546 / +68.1% / $1,860 | 611 / +55.6% / $1,697 |

  θ 0.20 maximises total P&L in both months, so the choice stands.
- **Where the money is** (θ 0.20). Bands are hours before local midnight of the market day:

  | Band | Aug | Sep |
  |---|---|---|
  | On-day | 84 trades, +$252 | 104, −$6 |
  | 0–18 h | 1,343, +$2,980 | 1,484, +$2,791 |
  | 18–36 h | 437, +$213 | 355, +$11 |
  | YES | 873, +$3,031 | 963, +$2,582 |
  | NO | 991, +$415 | 980, +$214 |

  The edge is concentrated in YES buys 0–18 h before the day. On-day and 18 h+ entries are roughly break-even. They are kept for now because cutting them was not consistently better in the September split tests (see the v2 table), but this is the first knob to revisit once live data accumulates.
- **Per-city totals are noise at this sample size**, so no city exclusions:
  - Dallas: −$122 in Aug, +$164 in Sep.
  - Jeddah: +$332 in Aug, −$22 in Sep.
  - Only Ankara (−$24 / −$55) and Tel Aviv (−$57 / −$1) are negative in both months, on ~40 trades each.

### Exits

A static take-profit at the model probability beat every dynamic variant tried: re-targeting on each new run, trailing, time-decayed targets. Re-entry after an exit added a negligible amount. The confirmed 20¢ stop stays.

### Maker vs taker entry

This used real taker prints from `data-api` on a ~35% sample of signals (script `backtest/maker.mjs`):
- **Maker only** (join the bid, or rest at mid, for 1–6 h) totals $1,078–1,082 vs $1,142 for taker. Fills happen mostly when the market is moving against us (adverse selection).
- **Hybrid** (rest at mid for 30 min, then take if the edge is still ≥ 0.20) gives $1,261 vs $1,164 on the same signals, **~+8%**.

  This is modest and adds order-state complexity, so it is not implemented.

### Does anyone else trade WN3?

Releases reach EE at minutes 40–59 of the hour. The absolute midpoint move in the 30 min after a release, compared with the same window at other hours, has a ratio of **0.83**: no elevated movement. There is no evidence that the market reacts to WN3 publishes, so latency to the release is not a race.

### Lowest-temperature ladders

136 open "Lowest temperature in …" events exist across 47 cities. However, their books are empty or one-sided (median spread 40–100¢), so they are **untradeable** at $5 taker sizes. Not added.

### Live fills (first 31 entries)

| Metric | Value |
|---|---|
| Average slippage vs the quoted ask | 0.26¢ (max 1.31¢) |
| Fee | ≈ 0.96¢/share |
| Average edge at entry | 24.1¢ |
| Partial fills | 2 of 31 |

The simulator's level-by-level fill matches what the book offered.

## Live review and YES-only switch (2026-09-27)

After about 30 hours live there were 116 trades: 44 closed, 72 open. Open positions are marked at the current mid.

| Group | Trades | Cost | P&L |
|---|---|---|---|
| YES < 20¢ | 48 | $222 | **+$25.9** |
| YES ≥ 20¢ | 5 | $20 | −$1.7 |
| NO < 40¢ | 7 | $34 | +$9.7 |
| NO 40–60¢ | 36 | $180 | **−$21.2** |
| NO ≥ 60¢ | 20 | $100 | −$8.7 |

- **Net P&L hid the capital problem.** Net was ≈ +$4, but the engine needed up to **$416 of capital at once**. Entries also come in bursts: single runs opened 31 and 27 positions.
- **Stops filled far past the trigger:**
  - Live stops filled on average 8¢ past the trigger (max 34¢, Miami: triggered at 55¢, filled at 21¢).
  - NO trades win about $1.5–2.7 at take-profit but lose $2–4 at the stop, so they need a win rate above 60%.
- **The backtest (Aug + Sep, with 8¢ stop slippage added) agrees.** Return per $:

  | Segment | Aug | Sep |
  |---|---|---|
  | YES < 10¢ | +108% | +75% |
  | YES 10–20¢ | +29% | +34% |
  | NO 40–60¢ | −3% | −5% |
  | NO < 40¢ | −12% | −9% |

  NO trades only turn positive without a stop, and only at ≥ 60¢.
- **YES-only keeps nearly all the P&L with half the trades and capital.** With a $100 bankroll and $5 stakes over the chronological Aug 1 – Sep 25 path: all trades end at $5,465, YES only at $5,461.
- **The stop is irrelevant for most YES entries.** It sits 20¢ below entry, so it can never trigger on a YES bought under 20¢ (≈ 90% of YES entries).

**Decision:** entries are YES only. The research engine keeps a fixed $5 per trade, realistic book-walking fills, and entries even with negative cash, so the per-trade data isn't shaped by bankroll luck.

**Sizing for a future real-money engine.** Rule under test: stake = fraction × equity, clamped to $5–20; skip the trade when cash is tied up. Bootstrap of 30-day paths, YES only:

| Fraction of equity | P(30-day loss) from $25 | from $50 | from $100 |
|---|---|---|---|
| 1/5 | 39% | 26% | 13% |
| 1/10 | 21% | 8% | 5% |
| **1/20** | **14%** | **3%** | **1%** |

The median outcome is about the same for all three, because the $20 cap binds. So **1/20 of equity** is the recommended fraction, and a bankroll of ≥ $50 is advisable.

**Also tested, no gain:**
- Kelly sizing (no better than a flat fraction);
- a one-position-per-ladder cap (worse);
- θ 0.15, 0.25 and 0.30 (0.20 is still best).

Scripts: `bank.mjs` (bankroll simulator) and the `bt2.mjs export` mode.
