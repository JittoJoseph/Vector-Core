const ee = require("@google/earthengine");
const { execSync } = require("child_process");
const fs = require("fs");

const GCLOUD = `"${process.env.LOCALAPPDATA}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd"`;
const token = execSync(`${GCLOUD} auth print-access-token`, { encoding: "utf8" }).trim();
const stations = JSON.parse(fs.readFileSync("../stations.json", "utf8"));
stations["Hong Kong"] = { ...stations["Hong Kong"], lat: 22.302, lon: 114.174 };
const init = process.argv[2] ?? "2026-09-25T18:00:00Z";
const maxLead = +(process.argv[3] ?? 60);

ee.data.setAuthToken("", "Bearer", token, 3600, [], () => {
  ee.initialize(null, null, () => {
    const pts = ee.FeatureCollection(
      Object.entries(stations)
        .filter(([, s]) => s.lat != null)
        .map(([c, s]) => ee.Feature(ee.Geometry.Point([s.lon, s.lat]), { city: c })),
    );
    const img = ee.ImageCollection("projects/gcp-public-data-weathernext/assets/weathernext_3_0_0_0p05deg")
      .filter(ee.Filter.eq("start_time", init))
      .filter(ee.Filter.lte("forecast_hour", maxLead))
      .select(["station_head_temperature_2m_.*"])
      .toBands();
    const fc = img.reduceRegions({ collection: pts, reducer: ee.Reducer.first(), scale: 5566 });
    const serialized = ee.Serializer.encodeCloudApi(fc);
    fs.writeFileSync("expression.json", JSON.stringify(serialized, null, 1));
    const t = Date.now();
    fc.evaluate((res, err) => {
      if (err) { console.log("ERR", err); return; }
      fs.writeFileSync("sample-result.json", JSON.stringify(res));
      const f0 = res.features.find((f) => f.properties.city === "London");
      const keys = Object.keys(f0.properties).filter((k) => k.endsWith("_mean")).sort();
      console.log("features", res.features.length, "props per feature", Object.keys(f0.properties).length, "ms", Date.now() - t);
      console.log("London mean first 24h (C):", keys.slice(0, 24).map((k) => (f0.properties[k] - 273.15).toFixed(1)).join(" "));
      console.log("sample key", keys[0], "| response bytes", JSON.stringify(res).length, "| expression bytes", JSON.stringify(serialized).length);
    });
  }, (e) => console.log("init error", e), null, "weather-vector");
}, false);
