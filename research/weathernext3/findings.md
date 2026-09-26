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
