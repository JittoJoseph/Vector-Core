import fs from "fs";
const OLD = "C:/Users/jitto/AppData/Local/Temp/claude/D--Projects-Vector-Core/451f5158-3bae-43ad-b878-3dc95c346d10/scratchpad";
const stations = JSON.parse(fs.readFileSync(`${OLD}/stations.json`, "utf8"));
const OUT = process.env.OUT ?? "obs.json";
const obs = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [y1, m1, d1, y2, m2, d2] = process.argv.slice(2);
for (const [city, s] of Object.entries(stations)) {
  if (obs[city]) continue;
  const url = `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=${s.icao}&data=tmpc&year1=${y1}&month1=${m1}&day1=${d1}&year2=${y2}&month2=${m2}&day2=${d2}&tz=Etc/UTC&format=onlycomma&latlon=no&missing=M&trace=T&direct=no&report_type=3&report_type=4`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = await fetch(url).catch(() => null);
    const txt = r ? await r.text() : "";
    if (r?.ok && txt.startsWith("station")) {
      const rows = txt.trim().split("\n").slice(1).map((l) => l.split(",")).filter((p) => p[2] !== "M").map((p) => [Date.parse(p[1].replace(" ", "T") + ":00Z"), +p[2]]);
      obs[city] = rows;
      fs.writeFileSync(OUT, JSON.stringify(obs));
      console.log(city, s.icao, rows.length);
      break;
    }
    await sleep(15000 * (attempt + 1));
  }
  await sleep(6000);
}
console.log("done", Object.keys(obs).length);
