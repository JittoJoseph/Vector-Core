# Polymarket "Highest temperature" markets: observed structure

Observed on 2026-09-26 from the Gamma/CLOB APIs and live pages. Screenshots are in `screenshots/`.

## Layout

- There is one **negRisk event per city per local day**, e.g. `highest-temperature-in-london-on-september-27-2026`. **51 cities** were live, each listed about **2–3 days ahead** (D-2 and D-1 open alongside D).
- Every event has **11 buckets** (a temperature ladder):
  - °C cities: 1 °C buckets, `17°C or below … 27°C or higher`.
  - °F cities (US): 2 °F buckets, `55°F or below`, `56-57°F` … `74°F or higher`.
- `markets[].gameStartTime` is **local midnight of day D in UTC**. The trading day ends 24 h later. Resolution arrives when the next day's first datapoint publishes: London Sep 24 closed at 23:50Z, and Hong Kong can take days.
- Resolution source is NOAA `weather.gov/wrh/timeseries?site=<ICAO>`, whole degrees, with Weather Underground as fallback. The exceptions:
  - Hong Kong uses the Hong Kong Observatory daily extract.
  - Taipei and Jinan use Wunderground.
  - The per-city list is in `stations.json`.
  - US stations are not always the obvious ones: Dallas = Love Field, Houston = Hobby, Denver = Buckley SFB, NYC = LaGuardia.

## Fees and microstructure

- The fee schedule on every weather market is `{"rate":0.05,"exponent":1,"takerOnly":true,"rebateRate":0.25}`. The taker fee per share is `0.05·p·(1−p)`, which is at most 1.25¢ at p = 0.5. **Makers pay nothing and receive a 25% rebate.**
- Central buckets carry liquidity-reward (gift) icons. There is a "Maker Rebate" and a sponsor-rewards programme (screenshot 04).
- Typical central-bucket book (London 23°C, D-1): 2¢ spread, top-of-book only $2–4, and $75–275 per level a few cents away. Tail buckets often have **no NO asks at all** ("Buy No --").
- A same-day event can trade ~$50k (Seoul Sep 26) versus ~$10–13k for the D-1 listing. **Most volume happens on the day itself**, while observations arrive.

## How prices move (14 days, 710 closed events, 10-min history)

**Repricing is bursty and tied to model cycles.** Before the local day starts, total ladder movement per 10 min and the count of ≥10¢ jumps peak at **05–06Z**, with ~650 jumps per hour-of-day versus ~100–350 at other hours. That is when ECMWF 00Z output lands. Smaller bumps appear around 00Z and 12–13Z. Polymarket's own AI summary on the London page says "traders are monitoring the next model runs".

**There is no exploitable momentum.** After a ≥5¢ one-hour move, the next 6 h continue by:

| Move type | 6 h continuation |
|---|---|
| Model-hour moves (05–07Z) | +0.35¢ |
| All other moves | −0.81¢ (slight reversion) |

Both are far below the ≈2–4¢ round-trip cost. Up-moves revert toward the final outcome (−1.7¢), which is mild overreaction on the YES side.

**Large residual uncertainty at day start.** Price of the eventual winner:

| Time | Mean winner price | Share with winner ≥ 0.5 | Brier |
|---|---|---|---|
| D-1 local midnight | 0.33 | 13% | 0.66 |
| D local midnight | 0.38 | 28% | 0.62 |
| D local noon | 0.45 | 39% | — |

## Implications for a WeatherNext strategy

- The market already digests ECMWF/GFS within minutes of release. WN3 publishes about 7 h after init, which is roughly the same wall-clock time as the matching ECMWF cycle. **Speed is not an edge. Only better accuracy at the resolution station can be.**
- Taking liquidity twice (enter and exit) costs 2 spreads + 2 fees, about 10–13% of a 30¢ position. **Exit-before-resolution strategies need the market to move toward our view by more than that within the holding window.**
- Maker orders pay no fee and earn rebates and rewards. If the model is well calibrated, **resting limit orders at our fair value** is the cheapest way to express it.
