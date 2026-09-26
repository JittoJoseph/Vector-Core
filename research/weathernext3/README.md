# WeatherNext 3 research (2026-09-26)

| File | What |
|---|---|
| `findings.md` | Answer and evidence: what works, what doesn't, caveats |
| `plan.md` | Implementation plan for the validated rule, plus decisions needed |
| `cookbook.md` | **Reference first.** Cost-cutting and robustness specifics: BigQuery pruning and sandbox rules, cell matching, Zarr layout, publish timing, Earth Engine call shape and IAM, Polymarket data gotchas |
| `weathernext3.md` | Verified WN3 facts: latency, access paths, BigQuery sandbox traps, canonical query, budget |
| `polymarket-weather-markets.md` | Ladder structure, resolution stations, fees, spreads, repricing behaviour |
| `ee-value-compute-request.json` | Working Earth Engine REST request template (51 stations, one run, 60 leads, 6 temperature bands). Substitute `start_time` and the points. |
| `stations.json` | City → resolution ICAO, lat/lon, unit, local-midnight UTC |
| `screenshots/` | BigQuery cost-cap failure, Polymarket ladder, order book, same-day collapse |
| `backtest/` | Scripts (`reprice*`, `drift`, `bq-pull`, `backtest`, `spreads`, `level2–4`) and `results.txt` |

The scripts expect their data files (`reprice-events*.json`, `bq-mean.jsonl`, `bq-patch*.jsonl`, `published.txt`, `spread-snapshot.json`) in the working directory.

Those files are regenerable:
- `reprice.mjs` rebuilds the event histories.
- `bq-pull.mjs <from> <to> 6` rebuilds the WN3 series (~1.8 GB of quota per run).
- `gcloud storage ls -l ".../2026_to_present/2026MM*/success"` rebuilds `published.txt`.
