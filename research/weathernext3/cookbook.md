# WeatherNext 3 data cookbook: what's cheap, what's robust, what bites

These are hard-won specifics from the Sep 2026 research, with each figure measured on our projects. Use this file as the reference when writing the live feed or new research scripts.

## 0. Identities and projects (who can read what)

| Thing | Where it lives | Who can read it |
|---|---|---|
| WN3 BigQuery linked dataset | project `weather-vector` → dataset `weathernext_3` (Analytics Hub link, 2 views) | Anyone with BigQuery roles in `weather-vector`. **The link belongs to the project**, so a service account in `weather-vector` works. |
| WN3 GCS Zarr `gs://weathernext3_statistics_spatial/` | Google-owned bucket | Only the **approved Google account** (`jittojoseph01@gmail.com`). Not requester-pays, so reads cost us nothing. |
| WN3 Earth Engine collection `projects/gcp-public-data-weathernext/assets/weathernext_3_0_0_0p05deg` | Google-owned EE asset | Only the **approved Google account**. Compute is billed to the EE project named in `x-goog-user-project`. |
| Earth Engine quota | **project `weather-vector`**: registered Community tier, non-commercial, 150 EECU-h/month, under the approved account. Verified working 2026-09-26. | The approved account (project owner). |

A second EE registration exists on `weather-509809` under jittojosephcareer@gmail.com. It is **not needed**: that account isn't WeatherNext-approved, and `weather-vector` now does everything.

**Rule:** EE and GCS access follow the **identity**. BigQuery access follows the **project**. The live path runs as the approved user through an OAuth refresh token, which covers EE and BigQuery with one credential, until WeatherNext approves a service-account email.

## 1. BigQuery: cutting cost by 10,000×

- **Always filter `init_time = TIMESTAMP(...)`.** It is the partition key. `init_time >= day` on one day costs 4.6 GB for the `init_time` column alone. `init_time` with no filter costs 1.2 TB.
- **Always add a geography predicate on `t.geography`**, e.g. `ST_DWITHIN(t.geography, ST_GEOGPOINT(lon, lat), 4000)`. The table is clustered by geography. **Real billed bytes are ~30 MB per city per stat column** for all 360 lead hours. The dry-run says ~500 GB per column, because dry-run upper bounds ignore clustering.
- **Never select `f.hours`.** It is a full repeated column (~500 GB of estimate). Use `t.forecast f WITH OFFSET o`, where valid time = init + (o+1) h.
- **Use `geography`, not `geography_polygon`.** The polygon column estimate is larger (587 GB vs 528 GB), and the point lets you rank by distance.
- **Put all cities in one query.** The estimate doesn't grow with city count, only the real cost does (~30 MB each), and it saves per-query overhead and the 10 MB minimum.
- **Row filters on `o` don't cut billing.** They only cut the response size. Still use `o < 60` to keep responses small.
- **A missing partition is cheap.** Querying a not-yet-published init returns 0 rows and bills the 10 MB minimum, so it is a safe "is it published yet?" probe.
- **Joins against an `UNNEST([STRUCT(...)])` points array plus OR-ed `ST_DWITHIN` constants** billed 10 MB on a geography-only check. Clustering prunes fine with constant predicates.

### Sandbox-specific (no billing account)

- **Per-query admission uses the upper-bound estimate.** 1 stat column (528 GB) is admitted. 3 columns (1.52 TB) are rejected as "Quota exceeded … free query bytes scanned", even though the real cost would be ~100 MB.
- **`maximumBytesBilled` also checks the estimate**, not real bytes. A 20 GB cap rejected a query that really billed 89 MB. Don't rely on it for clustered point reads.
- **So in the sandbox: one stat column per query, and one query per (init, column).** Two columns cost two queries (~2× real bytes), which is fine.
- **Budget reality:**
  - 51 cities per init = 1.3–2.6 GB real.
  - The Sep 2026 research used 186 GB of the 1 TiB monthly allowance.
- **With billing enabled instead:** set a project custom quota *BigQuery API → Query usage per day* (~20 GiB). It is enforced on real bytes and hard-stops before any charge.

### Canonical query (single column)

```sql
SELECT ST_Y(t.geography) lat, ST_X(t.geography) lon, o,
       f.station_head_temperature_2m_mean AS k
FROM `weather-vector.weathernext_3.weathernext_3_0_0_0p05deg` t,
     t.forecast f WITH OFFSET o
WHERE t.init_time = TIMESTAMP('2026-09-25 18:00:00')
  AND o < 60
  AND (ST_DWITHIN(t.geography, ST_GEOGPOINT(0.055, 51.505), 4000)
    OR ST_DWITHIN(t.geography, ST_GEOGPOINT(-73.880, 40.779), 4000))
```

### Cell matching (robustness)

- **`geography` is a lattice point at 0.05° multiples**, so a station can be ~3.9 km from its nearest cell. **The radius must be ≥ 4 km.** At 2.8 km, NYC (2.83 km), Toronto (2.88 km) and Singapore (2.83 km) returned nothing.
- **Pick the nearest cell client-side and hard-reject anything beyond ~4.2 km.** Our first puller silently gave NYC and Toronto Chicago's series, and Singapore Kuala Lumpur's.
- A shared series across two cities is the tell. Check for it.

## 2. GCS Zarr: when (not) to use it

- Layout: `{init YYYYMMDD}_{HH}hr_01_preds/predictions.zarr/<var>/c/<lead>/0/0`, Zarr v3, float32.
  - Chunk = **one lead hour × the whole globe**: 3601 × 7200 for the 0.05° station head, 1801 × 3600 for 0.1°.
  - Compressed as **a single zstd frame**, so no byte-range seeking.
- Latitude runs **−90 → +90**, so northern cities sit near the end of the chunk. Streaming London needs ~61 MB of a ~77 MB chunk. At ~8 MB/s that is ~8 s per lead hour per statistic.
- Node ≥ 22 has `zlib.createZstdDecompress`, so no dependency is needed. You can stop reading early once the needed rows are decoded.
- **Good for:** a one-off global snapshot (every city at once for one lead) and the **publish time** (`<init>/success` object creation time).
- **Bad for:** live per-city monitoring (GBs per run).
- **Cheap metadata:**
  - `gcloud storage ls -l "gs://weathernext3_statistics_spatial/weathernext_3_0_0_statistics/zarr/2026_to_present/202609*/success"` lists every run's publish time in one call.
  - `predictions.zarr/zarr.json` holds consolidated metadata for all 133 arrays.

## 3. Publish timing (measured, Sep 2026)

- **6-hourly runs** (00/06/12/18Z, 360 h horizon): `success` at init + **7.30 h** median (p90 8.2 h).
- **Interim runs** (48 h horizon): + **6.65 h** median (p90 6.95 h).
- BigQuery rows appear about 1–5 min after `success` (`BQ_picked_grid_*` markers).
- **August 2026 and earlier were backfilled.** Their `success` markers are ~20 days late, so those runs were never available in real time. **Backtests must gate on the real `success` time**, never on init + constant.

## 4. Earth Engine (Community tier, 150 EECU-h/month)

- Collection: `projects/gcp-public-data-weathernext/assets/weathernext_3_0_0_0p05deg`.
  - One image per (init, lead).
  - 12 bands: `station_head_{temperature,dewpoint_temperature}_2m_{mean,p10,p25,p50,p75,p90}`.
  - Properties: `start_time` (init), `end_time` (valid), `forecast_hour`, `ingestion_time_utc`.
- **Why it can beat BigQuery for live use:**
  - no 1 TiB query-bytes budget;
  - **all 12 bands cost the same as 1**, since percentiles come for free and give a flow-dependent sigma;
  - interim hourly runs become affordable;
  - `ingestion_time_utc` gives exact availability.
- **Grid.** The image grid is EPSG:4326, 7200 × 3601, `translate (-180.025, 90.025)`, scale 0.05. Pixel centres are the same lattice points as BigQuery's `geography`. **Sampling at the station point equals BigQuery's nearest cell**: 3,060 values matched to ≤ 0.005 °C.
- **Image naming.** Image IDs are `YYYYMMDDHHmm_YYYYMMDDHHmm` (init_valid). Properties include `start_time`, `end_time`, `forecast_hour`, `ingestion_time_utc`, `job_start_utc`, and `B0..B11` band names.

### Readiness detection (free, no EECU)

- `GET https://earthengine.googleapis.com/v1/projects/gcp-public-data-weathernext/assets/weathernext_3_0_0_0p05deg:listAssets`
  - `filter=start_time = "2026-09-26T00:00:00Z" AND properties.forecast_hour = 60`
  - header `x-goog-user-project: weather-vector`
- Gotchas:
  - `forecast_hour` must be written as **`properties.forecast_hour`**.
  - `view=BASIC` drops everything useful, so use the default view.
  - `listImages` rejected `pageSize`/`filter`, so use **`listAssets`**.
- **All leads of a run land within ~30 s**, so checking the lead you need is enough:
  - lead 1 vs lead 360 were 02:00:06 vs 02:00:12;
  - use 60 for 6-hourly runs, 48 for interim.
- **EE ingestion trails the GCS `success` marker by only minutes** (measured Sep 19–26):
  - 6-hourly runs: median 12.4 min, p90 15.7 min;
  - interim runs: median 3.9 min.
- In total, runs are usable in EE at **init + 7.95 h** (6-hourly) or **init + 6.78 h** (interim), median.

### Fetch (one REST call per run, no client library needed)

- `POST https://earthengine.googleapis.com/v1/projects/weather-vector/value:compute` with body `{"expression": …}`.
- The template is `ee-value-compute-request.json`, 15 KB, built by `backtest/ee-sample.cjs` with the JS client. Its graph:
  1. `ImageCollection.load`
  2. `Collection.filter(Filter.equals start_time)`
  3. `Collection.filter(forecast_hour ≤ 60)`
  4. `Image.select("station_head_temperature_2m_.*")` mapped
  5. `ImageCollection.toBands`
  6. `Image.reduceRegions(points, Reducer.first, scale 5566)`
- **Only two things vary:** the `start_time` string and the station Point list. Substitute them in the JSON; no need to rebuild the graph.
- Result: a FeatureCollection with 51 features. Properties are named `<init>_<valid>_station_head_temperature_2m_<stat>` in Kelvin, 60 × 6 per station. About 1.7 MB of JSON, returned in **3–6 s**.
- **Measured cost: ≈ 100 EECU·s per uncached run** for 51 stations × 60 leads × 6 bands. The profile breaks down as 93.8 s "Loading assets" + 5.5 s plumbing; the reduce itself is < 0.1 s. It scales with images × bands loaded, not with station count.
  - 6-hourly runs ≈ 3.3 EECU-h/month.
  - Every hourly run ≈ 20 EECU-h/month.
  - Community tier gives 150 EECU-h.
  - Repeating an identical call is served from cache and costs almost nothing.
- **Profiling a call:**
  1. Send request header `X-Earth-Engine-Computation-Profiling: 1`.
  2. Read response header `X-Earth-Engine-Computation-Profile: <id>`.
  3. Call `value:compute` with `Profile.getProfiles {ids:[id], format:"text"}`.
- **Cloud Monitoring EE metrics** (`earthengine.googleapis.com/project/cpu/usage_time`) **need billing**, so they are unusable in this project. Use the profiler.
- **Exhausting the tier does not block.** EE drops to "restricted mode" (slower), so a runaway can't break the bot.
- **JS client in Node:** `ee.data.setAuthToken('', 'Bearer', token, 3600, [], cb, false)`. The last `false` stops it from loading the browser auth library, which otherwise crashes with `document is not defined`.

### Access-error decoder

With header `x-goog-user-project: <eeProject>`:
- `USER_PROJECT_DENIED`: the caller lacks `serviceusage.services.use` on that project.
- `SERVICE_DISABLED`: the EE API isn't enabled or the project isn't registered.
- 404 "does not exist or doesn't allow this operation": wrong URL shape. The asset path goes right after `/v1/`, **not** under `/v1/projects/<eeProject>/assets/`.

## 5. Polymarket-side cost and robustness notes

- **`prices-history`:**
  - `interval=max&fidelity=10` gives 10-min points for a whole closed market in one call.
  - For 1-min points, use explicit `startTs/endTs` windows of ≤ 24 h.
  - **`p` tracks the book midpoint, not the last trade.** Checked against live books.
- **Spreads, not mids, decide tradability.**
  - Buckets 18 h+ from day start often show 12–29¢ spreads on 5–30¢ prices.
  - Within 18 h they are 2–3¢.
  - Backtests on mids must model spread by (lead, price), or they overstate edges badly.
- **Bucket parsing:** `"64-65°F"` has a hyphen, not a minus. Use `/(-?\d+)(?:\s*-\s*(\d+))?/`, and treat `or below` / `or higher` as open tails.
- **Resolution station:** use `resolutionSource` `?site=<ICAO>` (NOAA timeseries). The exceptions are Hong Kong (HKO, no `resolutionSource`), Taipei and Jinan (Wunderground), and Istanbul, Moscow and Tel Aviv (source only in the description text).
- **`markets[].gameStartTime` is local midnight of the market day in UTC.** It defines the local-day window for the daily max.

## 6. Tools set up on the dev machine

- The Google Cloud SDK is installed via winget:

  ```
  %LOCALAPPDATA%\Google\Cloud SDK\google-cloud-sdk\bin
  ```

  It is logged in as `jittojoseph01@gmail.com` with ADC, and the project is `weather-vector`.
- From Git Bash, `bq` needs the Windows `.cmd` wrapper *and* the SDK `bin` on `PATH`.
- Pipe SQL through stdin to avoid Windows quoting bugs: `Get-Content q.sql -Raw | bq.cmd query ...`.
