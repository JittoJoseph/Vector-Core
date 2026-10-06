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

## YES-only live review and model research (2026-09-29)

### What happened live

After about 40 hours on the YES-only rule: 75 trades, 25 closed, −$34.6 on $117.

Almost all closed trades belong to Sep 28 ladders:
- 24 trades hit only 3 take-profits.
- The backtest replayed on newly pulled EE runs and prices for Sep 25–28 reproduces this: Sep 28 is **−64% to −71%**.
- That is the worst day in 57 backtest days. The next worst is −8%, and the median day is +52%.
- There was no common direction that day: WN3 was warmer than the market in 19 cities and colder in 16.

### Integrity checks (all passed)

- **Archive = live:** EE archive values for the runs the engine used live match its stored forecasts (39 ladders, max diff 0.005 °C). The backtest is not using revised or hindcast data.
- **Exits are realistic:** on the same 27 finished trades, the backtest exit rule agreed with the live exit 25 times. The two mismatches were live take-profits the backtest missed, so mid-based exits are not optimistic.
- **Placebo: WN3 is the edge, not the exit mechanics.** The same entry and exit rules on buckets under 30¢:

  | WN3 vs price | Aug | Sep | Win rate |
  |---|---|---|---|
  | WN3 ≥ 20 pts above (our trades) | +66% | +51% | 17–18% at ~11¢ |
  | WN3 10–20 pts above | +13% | +10% | |
  | WN3 roughly agrees | −24% | −28% | |
  | WN3 says overpriced | −39% | −43% | |

  Take-profit ≈ hold-to-resolution on average, so the value is in WN3 picking under-priced buckets.

### Tested, not adopted

- **Pooling WN3 with the market** (logistic regression, fitted on Aug):
  - Log-loss improves (Sep 1.288 → 1.184).
  - Trades get worse: +33% vs +49% per trade on Sep. The pooling shrinks exactly the longshot disagreements that carry the edge.
- **Live station observations (IEM METAR archive, 51 ICAO stations):**
  - The latest obs-minus-forecast error barely predicts the daily-max error (corr 0.03–0.10).
  - An observed-max floor kills few trades, because the market already prices dead buckets near 0.
  - Log-loss unchanged. Not worth the extra feed.
- **Univariate filters** on edge, price, the gap between model and market means, market rank, and market top price:
  - Several raise per-trade return in Aug and Sep.
  - None protects the late period consistently.

### Improvement found: smoothed fair value + model-flip exit

- **Fair value** = normal around the mean of μ over all runs published in the last **6 h**, instead of the latest run only.
- **Per-city σ scale** = `0.5 + 0.5 · cityResidSD / globalResidSD`, fitted on Aug.
- **Flip exit:** exit at the bid when a newer run's fair value falls below the current bid.

| | Aug (n / ret / worst day) | Sep, out of sample | Sep 26–28, out of sample |
|---|---|---|---|
| Current rule | 877 / +66% / −7% | 976 / +49% / −6% | 105 / +23% / −64% |
| 6 h mean + city σ | 806 / +67% / −22% | 624 / +67% / +6% | 52 / +19% / −52% |
| **6 h mean + city σ + flip exit** | 806 / +67% / −18% | 624 / **+64% / +10%** | 52 / **+30% / −33%** |

- Log-loss (Sep) goes from 1.288 to 1.253.
- There are fewer trades, but higher return per trade and a smaller worst day, which is what matters for a small bankroll.
- The flip exit on the unsmoothed hourly model hurts Sep (+43%), because single hourly runs flip too often. It only works on the smoothed fair value.

Scripts: `bt2.mjs` modes `feat`, `placebo`, `pool`, `obs`, `model2`, `flip`; `obs-pull.mjs` (IEM ASOS archive, rate-limited to about 1 station per minute).

### Adopted (2026-09-29): 3 h run averaging + model exit, no per-city σ

To limit curve fitting, the per-city σ table (51 constants fitted on Aug) was **dropped**. Its out-of-sample effect was mixed.

Averaging window sensitivity, with the model exit:

| Window | Aug ret / worst day | Sep ret / worst day | Sep 26–28 ret / worst day |
|---|---|---|---|
| 3 h | +67% / −13% | +64% / −12% | **+35% / −25%** |
| 6 h | +64% / −32% | +71% / −10% | +24% / −45% |
| 9 h | +64% / −32% | +72% / −7% | +41% / −48% |
| 12 h | +67% / −68% | +71% / −11% | +7% / −67% |
| Old rule | +66% / −7% | +49% / −6% | +23% / −64% |

- 3–9 h all beat the old rule on Sep; 3 h is the most consistent across all three periods.
- Aug only has 6-hourly runs, so there the 3 h window means "latest run only", and the model exit alone still holds up.
- Model-exit precision with 3 h averaging: exited trades were losers at resolution 90% (Aug), 76% (Sep) and 89% (late) of the time.

### Winners vs losers at entry (1,946 YES trades, medians)

| At entry | Won at resolution | TP, then lost at resolution | Lost (no TP) |
|---|---|---|---|
| Model p | 0.40–0.41 | 0.36–0.38 | 0.34–0.38 |
| Entry | 12–15¢ | 12–13¢ | 8.5–10¢ |
| Model p / price | 2.6–3.3× | 2.8–3.2× | 3.5–3.8× |
| Distance from model μ | 0.35–0.50 sd | 0.53–0.67 sd | 0.56–0.72 sd |

- Lead, ensemble spread, model swing and market momentum show no consistent difference.
- **Winners** cluster on the bucket the model centres on.
- **Losers** cluster on the cheapest, most extreme disagreements. Those still carry the highest return per $ (+90% or more under 8¢), because the payoff outweighs the lower hit rate. So they are not filtered out.
- At entry, outcomes are largely weather still to come. Later runs are what separate them, hence the model exit.

## Live review 2026-10-03: the edge faded from Sep 28

### Live (Sep 29 – Oct 2, 3 h averaging + model exit)

113 trades; 80 closed for −$36.8 on $359:

| Exit | Trades | P&L |
|---|---|---|
| Take-profit | 21 | +$165 |
| Model exit | 10 | +$14 |
| Stop | 3 | −$11 |
| Resolution | 46 | −$205 (all losers) |

The take-profit hit rate is 26%; break-even needs about 36%. By market day:

| Market day | Return per $ |
|---|---|
| Sep 29 | −100% |
| Sep 30 | −54% |
| Oct 1 | −8% |
| Oct 2 | +140% |

### The backtest agrees, so this is not execution

New EE runs and prices to Oct 2. Same rules, per day:

| Day | Sep 26 | Sep 27 | Sep 28 | Sep 29 | Sep 30 | Oct 1 | Oct 2 (partly resolved) |
|---|---|---|---|---|---|---|---|
| Return | +135% | +9% | −25% | −28% | −64% | +30% | −58% |

### Root cause: WN3 lost relative accuracy

Head-to-head on resolved ladders (market error − WN3 error, °C; > 0 means WN3 was better):

| Aug | Sep weeks | Sep 28 → Oct 2 |
|---|---|---|
| −0.06 | −0.03 to +0.04 | −0.14, −0.11, −0.18, −0.14, −0.12 |

- After the seeded per-city correction, WN3 now runs about 0.1–0.3 °C warm.
- The market's drift toward WN3 in the 6 h after a release fell from 1.5–2.7 pts to 0.75.
- There is still **no reaction in the first 30 min** after a release, so this is not other bots trading WN3.

### Data notes

- **August EE data is a backfill.** Ingestion was days to weeks after init (Aug 10 was ingested Aug 26). Real-time ingestion starts **Aug 27**, so treat Aug 27 – Sep 25 as the reference period.
- **The old spread model was stale.** Live books now (Oct 3) have median spread 2–3¢ at every lead up to 24 h (≤ 3¢ for 82–88%). At 24–60 h the median is 44¢ (no market makers yet). The backtest now uses a flat 2¢ within 24 h (`FLATSPREAD`).

### Tested and rejected (do not fix the bad week, or cost too much in good periods)

Return per trade:

| Variant | Real-time Sep | Sep 26 – Oct 2 |
|---|---|---|
| Baseline | +64% | −1% |
| Causal adaptive bias (global 4-day EWMA + city 21-day) | +55% | −6% |
| Common-mode removal (subtract the cross-city mean model-minus-market gap per run) | +55% | **+13%** |
| Skill gating, global (WN3 vs market error, last 2–5 d) | roughly unchanged, ~⅓ fewer trades | n too small |
| Paper-P&L gating (trade only if last 24 h of paper trades > 0) | −3 pts | **+26%** |
| Partial take-profit at entry + k·(model − entry), k = 0.35–0.75 | +40% to +59% | +5% to +10% |

- Per-city skill gating fails because city skill does not persist (corr 0.21 between halves of September).
- Paper-P&L gating looked good under the old spread model, but its benefit **vanishes with realistic spreads** (+10% → +7%).

### Best supported change: enter only ≥ ~12 h before the market day

- **Structural reason:** close to the day, the market has information WN3 lacks — the previous afternoon's observed high (about 9–12 h before day start), live obs, nowcasts and short-range high-resolution models. Far out, everyone relies on medium-range models, where WN3 is strongest.
- **Live:** < 12 h −43% (n 27), on-day −25% (21), 12–24 h +16% (22), 24 h+ +43% (10).
- **Backtest at the mid price, real-time Sep:** 0–12 h +107%, 18–24 h +121%, 24–36 h +129%. In the bad week: 0–12 h −14%, 18–36 h +34–38%.
- **Backtest with realistic spreads:**

  | Min lead | Real-time Sep (ret / losing days) | Sep 26 – Oct 2 (ret / losing days) |
  |---|---|---|
  | All leads | +69%, 2/29 | +10%, 4/7 |
  | 9 h | +80% | +11% |
  | **12 h** | **+77%, 1/29** | **+10%, 2/7** |
  | 15 h | +78% | +11% |

  The response is smooth across 9–15 h, so 12 h is not a knife-edge. It cuts about half the trades.

**Honest bottom line:** no rule recovers the bad week much beyond +10–13%. The edge depends on WN3 out-forecasting the market on the disagreements, and for about 5 days it did not.

### Implemented 2026-10-03: entries only ≥ 12 h before the market day (commit f995894)

The exits (TP, model exit, stop, resolution) still apply to every position.

## What else is in WN3 (2026-10-03)

The EE collection has 12 bands per image:
- `station_head_temperature_2m_{mean,p10,p25,p50,p75,p90}`
- `station_head_dewpoint_temperature_2m_{mean,p10,p25,p50,p75,p90}`

The engine uses only `temperature_2m_mean`. The 64 raw ensemble members and other gridded variables exist only in GCS (Zarr, 60–80 MB per lead per statistic), which is too heavy for live use.

Tested on the real-time period, with extra bands pulled every 2 h via `backtest/ee-pull3.mjs`:

- **Ensemble spread predicts error size strongly and consistently.**
  - With W = max-of-p90 − max-of-p10 over the local day, the residual SD runs from 0.79 °C (narrowest quartile) to 1.37 °C (widest).
  - IQR of the daily max (p75 − p25): 0.71–0.81 → 1.11–1.18 °C in every period.
  - Wide-spread days also run warm (actual hotter, about +0.2–0.5 °C).
- **The median is a better centre than the mean.**
  - When the mean max sits below the median max (cool outlier members), the actual is hotter: +0.27, +0.12, +0.06 °C across the three periods. The opposite quartile gives −0.07, −0.12, −0.25 °C. Same sign every period.
- **Dewpoint:** humid days (small depression at the max hour) have larger errors (SD about 1.1 vs 0.8 °C). There is no consistent mean shift, so it is weaker than the spread.
- **Skew** of the hourly p10/p90 around the mean: no signal.

Out of sample (fit Aug 27 – Sep 12; lead ≥ 12 h; flat 2¢ spread):

| Model | ll Sep 13–25 | ll Sep 26 – Oct 2 | ret Sep 13–25 | ret Sep 26 – Oct 2 |
|---|---|---|---|---|
| Current (mean, lead σ) | 1.293 | 1.396 | +68% | +19% |
| Mean, σ = 0.29 + 0.33·IQR | 1.251 | 1.380 | +76% | +0% |
| Median, lead σ | 1.286 | 1.384 | +52% | +6% |
| Median, σ = 0.33 + 0.30·IQR | 1.247 | 1.373 | +56% | +7% |

The extra bands give **consistently better-calibrated forecasts**, but **no consistent trading gain**. The edge lives in the disagreements, not in average calibration. Not adopted.

Cheap next step if revisited: fetching all 12 bands costs about the same EECU as one, so the engine could log the IQR live and re-test once more live data exists.

## Exit research 2026-10-05: losers often go our way first

### Live (since the Oct 3 reset)

24 trades; 6 closed for +$2.33 (3 TP +$17.33, 3 resolution losses −$15). The other 18 are open, marked at −$26.

Several losers made a large favourable move before collapsing:

| Trade | Entry | Peak | Target | Share of the way | Result |
|---|---|---|---|---|---|
| Buenos Aires 25°C | 16¢ | 36¢ | 38¢ | 92% | 0 |
| São Paulo 27°C | 20¢ | 34¢ | 41¢ | 65% | 0 |
| Chicago 70–71°F | 7.4¢ | 29¢ | 44¢ | 60% | 2.5¢ |
| Denver 90–91°F | 17¢ | 31.5¢ | 42¢ | 59% | 10¢ |

Others never moved at all.

### Backtest

Real-time Aug 27 – Oct 2, current rules (3 h mean, lead ≥ 12 h, flip exit, flat 2¢ spread), 553 entries:
- Of the 284 losers, the bid reached ≥ 25% of the way to target in **52%**, ≥ 50% in **33%**, and ≥ 75% in **17%**.

Exit variants (mean ret per trade / sd; profitable-trade rate; Sep 26 – Oct 2 mean / sd):

| Exit | Aug 27 – Sep 25 | Profitable | Sep 26 – Oct 2 |
|---|---|---|---|
| Current (TP at model prob) | +77% / 226% | 50% | +10% / 167% |
| **Sell half at 50% of the way, rest at TP** | **+70% / 179%** | **59%** | **+14% / 123%** |
| Half at 33% | +60% / 158% | 59% | +14% / 114% |
| Half at 66% | +73% / 197% | 57% | +14% / 135% |
| Half + trailing (arm 50%, give back 50%) | +64% / 165% | 64% | +17% / 118% |
| Trailing (arm 50%, give back 33%) | +64% / 180% | 62% | +21% / 146% |
| Breakeven stop after 50% | +71% / 215% | 47% | +8% / 161% |
| Time exit at local 12:00 on the market day | +51% / 149% | 55% | +19% / 125% |

Every protective exit trades a little mean return for much lower variance and a better bad period. "Half at 50%" is the best balance: mean / sd improves from 0.34 to 0.39 (good period) and from 0.06 to 0.11 (bad period). The response is smooth across 33–66%.

### Entry ideas rejected

- **Confirmation:** requiring the previous 1–2 runs to also show edge ≥ 0.15 gives −3 pts on Sep and −15 pts on the bad week. Fresh signals are the valuable ones.
- **Scale-in** (a second unit after the ask dips 3–5¢ while the edge holds): +1–3 pts at twice the capital. Not worth it.

### Implemented 2026-10-05: half take-profit (commit c53e759)

- Sell half once the bid is ≥ entry + 0.5·(target − entry); the rest exits normally.
- Restart-safe: an open trade with a non-null `realized_pnl` is treated as "partial already taken".
- The DB was reset at deploy.

### Lateral ideas tested 2026-10-05 (real-time Aug 27 – Oct 2, lead ≥ 12 h)

None was adopted:

| Idea | Result |
|---|---|
| WN3 error persistence, same city | Lag-1 autocorr 0.10, lag-2 0.08 |
| WN3 *skill* persistence (\|mkt err\| − \|WN3 err\|) | Lag-1 0.07, lag-2 0.02. No per-city or short-term skill memory |
| Cross-region same-day error (learn from cities that resolved earlier) | corr −0.05 to 0.02. WN3 errors are regional, not global |
| Entry UTC hour | 8–11Z weakest on Aug 27 – Sep 25, but the bad week reorders everything. Noise |
| Market activity (price changes in the 6 h before entry, bucket or ladder) | No monotonic or consistent effect |
| Calibration (lead 12–30 h) | WN3 25 → 23%, 36 → 38%, 42 → 46%, 58 → 54%; market similarly calibrated; realized residual SD 0.94 °C vs model σ 0.90–0.95. Not overconfident. The ≥ 70% bin is a few tail buckets (5/9 won), not a bug |
| Location-gap bets (\|WN3 centre − market centre\|) | ≥ 1.5 °C: +125% (real-time Sep) but +12% in the bad week; 0.5–1 °C: +42% vs +28%. Reverses, so not a filter |
| Horse-race (multi-bucket Kelly) baskets | Adds the 10–20 pt edge buckets, which earned only +10–13%. Not worth it |

## Review 2026-10-06: partial-TP accounting and a self-updating station correction

### Partial TP

- **It fires correctly.** 4 half-sales, each logged, then the rest closed normally.
- **Totals are right.** Realized totals and the dashboard performance aggregates use `realized_pnl` only.
- **Per-trade figures were inflated.** `shrinkTrade` overwrote `entry_shares`, `actual_cost` and `entry_fees` with the remaining half, so per-trade return showed about 2×. Houston 90–91°F showed +522% instead of +261%. The same happened after thin-book partial exits.
- **Fixed (2026-10-06).** Entry columns are never modified. A new `shares_sold` column tracks partial sales, the remaining position is derived from it on restart, and per-position P&L shown for open trades = realized + mark of the remainder, over the original cost.

### Bad trades this run

- Mostly cheap buckets (4–8¢) that never rose after entry: warm US buckets (Los Angeles ×4, Miami ×2, Chicago, Dallas, Atlanta).
- **Station correction:** the live engine used summer-fitted per-city corrections with a slow learner (decay 0.98). Every DB reset reset it back to the summer seed.

### Station-correction schemes compared causally

Real-time, current rules; Sep 26 – Oct 5 is the honest out-of-sample period, because the static seed was fitted on Sep 2–25:

| Scheme | ll Sep 26 – Oct 5 | ret Sep 26 – Oct 5 | Losing days | ret Sep 1–25 |
|---|---|---|---|---|
| Static summer seed | 1.453 | +25% | 2/10 | +70% (in-sample) |
| Live slow learner | 1.472 | +27% | 4/10 | +60% |
| **Recent: city 14 d mean, shrunk (k = 3) to the 7 d all-city mean** | **1.443** | **+47%** | **1/10** | +55%, 0/24 losing days |
| Station offset + 7 d climate-zone drift | 1.456 | +20% | 2/10 | +64% |

The recent scheme is robust across settings:

| Setting | ll | ret Sep 26 – Oct 5 |
|---|---|---|
| City window 7 / 14 / 21 d | 1.453 / 1.443 / 1.451 | +38 / +47 / +34% |
| Global window 4 / 10 d | 1.443 / 1.443 | +45 / +45% |
| k = 1 / 6 | 1.445 / 1.446 | +48 / +38% |

**Implemented (2026-10-06):**
- `forecast_residuals` stores one row per resolved ladder (city, closed time, actual − forecast as of 12 h before day start, the trade-relevant forecast `refFmaxC`).
- Correction = (Σ city residuals in the last 14 d + 3 · mean of all residuals in the last 7 d) / (n + 3), with a 0.66 °C prior when there is no history. Rows are pruned after 30 days.
- The table survives DB resets. It was seeded with 818 backtest residuals (Sep 19 – Oct 6), mean +0.62 °C.
- The `city_bias` table was removed.
