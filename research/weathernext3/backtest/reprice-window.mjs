import fs from "fs";

const [monthName, fromDay, toDay, out] = process.argv.slice(2);
const OLD = "C:/Users/jitto/AppData/Local/Temp/claude/D--Projects-Vector-Core/451f5158-3bae-43ad-b878-3dc95c346d10/scratchpad";
const stations = JSON.parse(fs.readFileSync(`${OLD}/stations.json`, "utf8"));
const slugCity = (c) => c.toLowerCase().replace(" (incheon)", "").replace(/ /g, "-");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 429) { await sleep(2000 * (i + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch {
      await sleep(1500);
    }
  }
  return null;
}
async function pool(items, n, fn) {
  const res = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; res[k] = await fn(items[k]); }
  }));
  return res;
}

const jobs = [];
for (const c of Object.keys(stations)) for (let d = +fromDay; d <= +toDay; d++) jobs.push({ c, d });
let done = 0;
const events = (await pool(jobs, 6, async ({ c, d }) => {
  const e = (await get(`https://gamma-api.polymarket.com/events?slug=highest-temperature-in-${slugCity(c)}-on-${monthName}-${d}-2026`))?.[0];
  if (++done % 100 === 0) console.log(done, "/", jobs.length);
  if (!e || !e.closed) return null;
  const gst = e.markets.find((m) => m.gameStartTime)?.gameStartTime;
  if (!gst) return null;
  const dayStart = Date.parse(gst.replace(" ", "T").replace("+00", "Z"));
  const s = Math.floor(dayStart / 1000) - 60 * 3600;
  const buckets = await pool(e.markets, 4, async (m) => {
    const tok = JSON.parse(m.clobTokenIds)[0];
    const h = [];
    for (let a = s; a < s + 96 * 3600; a += 60 * 3600) {
      const r = await get(`https://clob.polymarket.com/prices-history?market=${tok}&startTs=${a}&endTs=${a + 60 * 3600}&fidelity=10`);
      for (const x of r?.history ?? []) if (!h.length || x.t > h[h.length - 1].t) h.push(x);
    }
    return { title: m.groupItemTitle, win: JSON.parse(m.outcomePrices)[0] === "1", h };
  });
  return { city: c, day: d, volume: e.volume, dayStart, closedTime: e.closedTime, buckets };
})).filter(Boolean);
fs.writeFileSync(out, JSON.stringify(events));
console.log("events", events.length);
