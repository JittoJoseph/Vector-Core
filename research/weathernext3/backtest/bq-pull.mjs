import fs from "fs";
import { spawnSync } from "child_process";

const BIN = `${process.env.LOCALAPPDATA}\\Google\\Cloud SDK\\google-cloud-sdk\\bin`;
const env = { ...process.env, PATH: `${BIN};${process.env.PATH}` };
const [from, to, stepH = "6"] = process.argv.slice(2);
const OUT = process.env.OUT ?? "bq-mean.jsonl";
const ONLY = process.env.CITIES ? process.env.CITIES.split(",") : null;

const stations = JSON.parse(fs.readFileSync("stations.json", "utf8"));
stations["Hong Kong"] = { ...stations["Hong Kong"], lat: 22.302, lon: 114.174 };
const cities = Object.entries(stations).filter(([c, s]) => s.lat != null && (!ONLY || ONLY.includes(c)));

const done = new Set(
  fs.existsSync(OUT)
    ? fs.readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).init)
    : [],
);

const where = cities
  .map(([, s]) => `ST_DWITHIN(t.geography, ST_GEOGPOINT(${s.lon}, ${s.lat}), 4000)`)
  .join(" OR ");

let billed = 0;
for (let t = Date.parse(from); t <= Date.parse(to); t += +stepH * 3600e3) {
  const init = new Date(t).toISOString().replace("T", " ").slice(0, 19);
  if (done.has(init)) continue;
  const sql = `SELECT ST_Y(t.geography) lat, ST_X(t.geography) lon, o, f.station_head_temperature_2m_mean m
FROM \`weather-vector.weathernext_3.weathernext_3_0_0_0p05deg\` t, t.forecast f WITH OFFSET o
WHERE t.init_time = TIMESTAMP("${init}") AND (${where})`;
  const job = `bt_${init.replace(/\D/g, "")}_${Date.now() % 100000}`;
  const q = spawnSync(
    "bq.cmd",
    ["--format=json", "query", `--job_id=${job}`, "--use_legacy_sql=false", "--max_rows=1000000"],
    { input: sql, env, encoding: "utf8", maxBuffer: 1 << 28, shell: true },
  );
  const text = q.stdout.slice(q.stdout.indexOf("["));
  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    console.log("FAIL", init, (q.stdout + q.stderr).slice(0, 300));
    continue;
  }
  const s = spawnSync("bq.cmd", ["--format=json", "show", "-j", job], { env, encoding: "utf8", shell: true });
  const b = +(s.stdout.match(/"totalBytesBilled":\s*"(\d+)"/)?.[1] ?? 0);
  billed += b;
  const byCity = {};
  for (const [name, st] of cities) {
    let best = null, bd = Infinity;
    for (const r of rows) {
      const d = (r.lat - st.lat) ** 2 + ((r.lon - st.lon) * Math.cos((st.lat * Math.PI) / 180)) ** 2;
      if (d < bd) { bd = d; best = r; }
    }
    if (!best || bd > (4.2 / 111) ** 2) continue;
    const key = `${best.lat},${best.lon}`;
    const series = rows
      .filter((r) => `${r.lat},${r.lon}` === key)
      .sort((a, b) => a.o - b.o)
      .map((r) => Math.round((r.m - 273.15) * 100) / 100);
    byCity[name] = series;
  }
  fs.appendFileSync(OUT, JSON.stringify({ init, billed: b, byCity }) + "\n");
  console.log(init, "rows", rows.length, "billed MB", (b / 1e6).toFixed(0), "total GB", (billed / 1e9).toFixed(2));
}
