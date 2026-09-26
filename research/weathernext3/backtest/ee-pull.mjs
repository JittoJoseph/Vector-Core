import fs from "fs";
import { execSync } from "child_process";

const OLD = "C:/Users/jitto/AppData/Local/Temp/claude/D--Projects-Vector-Core/451f5158-3bae-43ad-b878-3dc95c346d10/scratchpad";
const GCLOUD = `"${process.env.LOCALAPPDATA}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd"`;
const OUT = "ee-runs.jsonl";
const BANDS = ["mean", "p10", "p90"];
const MAX_LEAD = 60;
const COLLECTION = "projects/gcp-public-data-weathernext/assets/weathernext_3_0_0_0p05deg";

let token = null, tokenAt = 0;
const auth = () => {
  if (!token || Date.now() - tokenAt > 30 * 60e3) {
    token = execSync(`${GCLOUD} auth print-access-token`, { encoding: "utf8" }).trim();
    tokenAt = Date.now();
  }
  return token;
};

const stations = JSON.parse(fs.readFileSync(`${OLD}/stations.json`, "utf8"));
stations["Hong Kong"] = { ...stations["Hong Kong"], lat: 22.302, lon: 114.174 };
const cities = Object.entries(stations).filter(([, s]) => s.lat != null);

const call = (name, args) => ({ functionInvocationValue: { functionName: name, arguments: args } });
const c = (v) => ({ constantValue: v });
function expression(init) {
  const coll = call("Collection.filter", {
    collection: call("Collection.filter", {
      collection: call("ImageCollection.load", { id: c(COLLECTION) }),
      filter: call("Filter.equals", { leftField: c("start_time"), rightValue: c(init) }),
    }),
    filter: call("Filter.not", { filter: call("Filter.greaterThan", { leftField: c("forecast_hour"), rightValue: c(MAX_LEAD) }) }),
  });
  const points = call("Collection", {
    features: { arrayValue: { values: cities.map(([name, s]) => call("Feature", { geometry: call("GeometryConstructors.Point", { coordinates: c([s.lon, s.lat]) }), metadata: c({ c: name }) })) } },
  });
  return {
    result: "0",
    values: {
      "0": call("Image.reduceRegions", {
        image: call("ImageCollection.toBands", {
          collection: call("Collection.map", { collection: coll, baseAlgorithm: { functionDefinitionValue: { argumentNames: ["x"], body: "1" } } }),
        }),
        collection: points,
        reducer: call("Reducer.first", {}),
        scale: c(5566),
      }),
      "1": call("Image.select", { input: { argumentReference: "x" }, bandSelectors: c(BANDS.map((b) => `station_head_temperature_2m_${b}`)) }),
    },
  };
}

async function sample(init) {
  const r = await fetch("https://earthengine.googleapis.com/v1/projects/weather-vector/value:compute", {
    method: "POST",
    headers: { Authorization: `Bearer ${auth()}`, "x-goog-user-project": "weather-vector", "Content-Type": "application/json" },
    body: JSON.stringify({ expression: expression(init) }),
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const byCity = {};
  for (const f of j.result.features) {
    const p = f.properties;
    const s = Object.fromEntries(BANDS.map((b) => [b, []]));
    for (const [k, v] of Object.entries(p)) {
      const m = k.match(/^\d{12}_(\d{12})_station_head_temperature_2m_(\w+)$/);
      if (!m) continue;
      const vt = Date.UTC(+m[1].slice(0, 4), +m[1].slice(4, 6) - 1, +m[1].slice(6, 8), +m[1].slice(8, 10));
      const lead = Math.round((vt - Date.parse(init)) / 3600e3);
      s[m[2]][lead - 1] = Math.round((v - 273.15) * 100) / 100;
    }
    byCity[p.c] = s;
  }
  return byCity;
}

const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).init) : []);
const [from, to] = process.argv.slice(2);
const inits = [];
for (let t = Date.parse(from); t <= Date.parse(to); t += 3600e3) {
  const init = new Date(t).toISOString().replace(".000Z", "Z");
  if (!done.has(init)) inits.push(init);
}
console.log("runs to pull", inits.length);
let i = 0, ok = 0;
const start = Date.now();
await Promise.all(Array.from({ length: 4 }, async () => {
  while (i < inits.length) {
    const init = inits[i++];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const byCity = await sample(init);
        fs.appendFileSync(OUT, JSON.stringify({ init, byCity }) + "\n");
        ok++;
        break;
      } catch (e) {
        if (attempt === 2) console.log("FAIL", init, e.message);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    if (ok % 50 === 0) console.log(`${ok}/${inits.length} ${((Date.now() - start) / 60e3).toFixed(1)} min`);
  }
}));
console.log("done", ok);
