# WeatherNext 3: verified facts for Vector Core

Measured against project `weather-vector` on 2026-09-26. Where a fact is from the docs rather than measured, it says so.

## What it is

- A Google DeepMind/Google Research global AI forecast model, released Aug–Sep 2026. It is an FGN mesh transformer that ingests live geostationary satellite data (docs).
- It runs **every hour**:
  - 6-hourly synoptic inits (00/06/12/18Z) forecast **360 h**.
  - Interim inits (every other hour) forecast **48 h**.
- It has a 64-member ensemble. The BigQuery and GCS "statistics" products only expose **mean, p10, p25, p50, p75, p90** of that ensemble, not the members. Raw members are only in `gs://weathernext3_spatial/`, which is much heavier.
- The **station head** (`station_head_temperature_2m_*`, `station_head_dewpoint_temperature_2m_*`) is a 0.05° (~5.5 km) output trained on surface station observations. This is the variable that matters for airport-station max-temperature markets. The 0.1° `temperature_2m_*` is the ordinary gridded field.
- Units are Kelvin, and values are instantaneous at the top of each hour. `lead_time` index `o` means valid time = init + (o+1) h.
- Licence: data less than 1 h old falls under GDM Real-Time Experimental Terms; older data is CC BY 4.0 (docs).

## History

2026 inits are queryable from January. **August 2026 and earlier were backfilled.** Their `success` markers were written about 20 days after init (p90 ~494 h), so they were never available in real time. From September onward, runs publish in real time. A backtest must use each run's actual `success` time, not init + 7 h.

## Publication latency (measured)

Latency is taken from the `success` marker on 603 September inits.

| Init type | p10 | median | p90 | max |
|---|---|---|---|---|
| 6-hourly (00/06/12/18Z) | 7.05 h | **7.30 h** | 8.20 h | 15.0 h |
| Interim hourly | 6.52 h | **6.65 h** | 6.95 h | 18.8 h |

The BigQuery view is populated about 1–5 min after `success` (the `BQ_picked_grid_*` markers). **Practical rule: a forecast initialised at T is usable around T+7 h.** It is not a nowcast. Its information vintage is about the same as ECMWF/GFS runs that land at similar wall-clock times.

## Access paths compared

| Path | Point read cost | Notes |
|---|---|---|
| **BigQuery** `weather-vector.weathernext_3.weathernext_3_0_0_0p05deg` | **~30 MB billed per city per init** for one column, all 360 h | Partitioned by `init_time`, clustered by `geography`. The dry-run estimate is a massive **UPPER_BOUND** (~500 GB per column) because clustering pruning isn't counted. The real cost is about 10,000× lower. |
| GCS Zarr `gs://weathernext3_statistics_spatial/.../{YYYYMMDD}_{HH}hr_01_preds/predictions.zarr` | 60–80 MB **per lead hour per statistic** | Zarr v3, chunk = `[1 lead, 3601 lat, 7200 lon]` float32, one zstd frame, so no byte-range seeking. Latitude runs **−90 → +90**, so northern cities sit at the end of the chunk. Fine for a one-off pull, not for live use. |
| Earth Engine `projects/gcp-public-data-weathernext/assets/weathernext_3_0_0_0p05deg` | a few KB | One image per init × lead, 12 bands, property `ingestion_time_utc`. It needs the Cloud project registered for Earth Engine, which is blocked on billing for now. |

### BigQuery sandbox trap (important)

The project is a **Sandbox** (no billing account), which has two consequences:

- **"Maximum bytes billed" is checked against the upper-bound estimate.** A 1-city query estimated at 1.03 TB fails with a 20 GB cap, even though it really bills 89 MB.
- **The sandbox refuses any query whose upper-bound estimate exceeds the free allowance.** The 12-city query with 3 stat columns (estimate 2.02 TB) was rejected as "Quota exceeded". The same cities with 1 column (estimate 528 GB) ran and billed 364 MB.

Measured upper-bound estimates per query:

| Referenced columns | Estimate |
|---|---|
| geography filter only | 30 GB |
| + 1 stat column (`WITH OFFSET` instead of `f.hours`) | 528 GB |
| + 3 stat columns | 1.52 TB (rejected) |
| + 6 stat columns | 3.02 TB (rejected) |

The number of cities in the `WHERE` clause does **not** change the estimate, only the real cost. So the rule inside the sandbox is: **one stat column per query, all cities in one query, filter with `ST_DWITHIN(t.geography, point, 2800)`**. Use `WITH OFFSET` rather than selecting `f.hours`, because `hours` is itself a ~500 GB column in the estimate.

Once billing works, set a project-level custom quota ("Query usage per day", e.g. 30 GiB) instead. It is a hard server-side cap, it keeps usage inside the 1 TiB free tier, and it removes the estimate-based rejections.

### Canonical point query

```sql
SELECT ST_Y(t.geography) lat, ST_X(t.geography) lon, o,
       f.station_head_temperature_2m_mean AS k
FROM `weather-vector.weathernext_3.weathernext_3_0_0_0p05deg` t,
     t.forecast f WITH OFFSET o
WHERE t.init_time = TIMESTAMP('2026-09-25 00:00:00')
  AND (ST_DWITHIN(t.geography, ST_GEOGPOINT(0.055, 51.505), 2800)
    OR ST_DWITHIN(t.geography, ST_GEOGPOINT(-73.880, 40.779), 2800))
```

`geography` is a **point on the 0.05° lattice** (e.g. `41.95, -87.95`), so a station can be up to ~3.9 km from its nearest cell. **Use a 4 km radius.** With 2.8 km, NYC (2.83 km), Toronto (2.88 km) and Singapore (2.83 km) returned no cell, and a naive nearest-row match silently took another city's series. Always pick the nearest cell client-side and reject any match farther than about 4.2 km. Measured cost:

- 1 city: 89 MB (with `hours` too)
- 12 cities: 364 MB
- 51 cities: 1.3–2.6 GB per init

## Budget arithmetic (1 TiB/month free)

| Scope | Monthly quota used |
|---|---|
| 12 cities × every hourly init × mean only | ≈ 262 GB |
| 12 cities × 6-hourly × {mean, p10, p90} (3 queries) | ≈ 130 GB |
| 51 cities × every hourly init | ≈ 1 TB (too much) |

## Resolution-station mapping

Polymarket resolves on NOAA `weather.gov/wrh/timeseries?site=<ICAO>` (whole degrees), with Weather Underground as fallback. The exceptions are Hong Kong, which uses the Hong Kong Observatory "Absolute Daily Max", and Taipei and Jinan, which use Wunderground. See `stations.json` for ICAO, lat/lon and unit for every city.
