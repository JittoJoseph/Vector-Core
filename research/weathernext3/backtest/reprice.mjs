import fs from "fs";

const stations = JSON.parse(fs.readFileSync("stations.json", "utf8"));
const cities = Object.keys(stations);
const slugCity = (c) =>
  c.toLowerCase().replace(" (incheon)", "").replace(/ /g, "-");
const days = [];
for (let d = 12; d <= 25; d++) days.push(d);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 429) { await sleep(2000 * (i + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(1000); }
  }
  return null;
}

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

const jobs = [];
for (const c of cities) for (const d of days) jobs.push({ c, d });

const events = (
  await pool(jobs, 6, async ({ c, d }) => {
    const slug = `highest-temperature-in-${slugCity(c)}-on-september-${d}-2026`;
    const e = (await get(`https://gamma-api.polymarket.com/events?slug=${slug}`))?.[0];
    if (!e || !e.closed) return null;
    const gst = e.markets.find((m) => m.gameStartTime)?.gameStartTime;
    if (!gst) return null;
    const dayStart = Date.parse(gst.replace(" ", "T").replace("+00", "Z"));
    const buckets = await pool(e.markets, 4, async (m) => {
      const tok = JSON.parse(m.clobTokenIds)[0];
      const h = await get(
        `https://clob.polymarket.com/prices-history?market=${tok}&interval=max&fidelity=10`,
      );
      return {
        title: m.groupItemTitle,
        win: JSON.parse(m.outcomePrices)[0] === "1",
        h: h?.history ?? [],
      };
    });
    return { city: c, day: d, volume: e.volume, dayStart, closedTime: e.closedTime, buckets };
  })
).filter(Boolean);

fs.writeFileSync("reprice-events.json", JSON.stringify(events));
console.log("events", events.length);
