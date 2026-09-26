import fs from "fs";
const all = [];
for (let off = 0; off < 1000; off += 100) {
  const j = await (await fetch(`https://gamma-api.polymarket.com/events?tag_id=84&closed=false&limit=100&offset=${off}`)).json();
  if (!j.length) break;
  all.push(...j.filter((e) => /^Highest temperature in .* on September/.test(e.title)));
}
const jobs = [];
for (const e of all) {
  const gst = e.markets.find((m) => m.gameStartTime)?.gameStartTime;
  if (!gst) continue;
  const dayStart = Date.parse(gst.replace(" ", "T").replace("+00", "Z"));
  for (const m of e.markets) jobs.push({ tok: JSON.parse(m.clobTokenIds)[0], leadH: (dayStart - Date.now()) / 3600e3, city: e.title });
}
const rows = [];
let i = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (i < jobs.length) {
    const j = jobs[i++];
    try {
      const b = await (await fetch("https://clob.polymarket.com/book?token_id=" + j.tok)).json();
      const bid = Math.max(0, ...b.bids.map((x) => +x.price)), ask = Math.min(1, ...b.asks.map((x) => +x.price));
      const askSize = b.asks.filter((x) => +x.price === ask).reduce((a, x) => a + +x.size, 0);
      rows.push({ leadH: j.leadH, mid: (bid + ask) / 2, spread: ask - bid, askUsd: askSize * ask });
    } catch {}
  }
}));
fs.writeFileSync("spread-snapshot.json", JSON.stringify(rows));
const band = (h) => (h > 36 ? "36h+" : h > 18 ? "18-36h" : h > 0 ? "0-18h" : "on-day");
const pb = (m) => (m < 0.05 ? "<5c" : m < 0.15 ? "5-15c" : m < 0.3 ? "15-30c" : m < 0.5 ? "30-50c" : "50c+");
const table = {};
for (const r of rows) {
  if (r.mid <= 0.02 || r.mid >= 0.98) continue;
  (table[band(r.leadH) + " " + pb(r.mid)] ??= []).push(r.spread);
}
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
console.log("books", rows.length);
for (const [k, a] of Object.entries(table).sort()) console.log(k.padEnd(18), String(a.length).padStart(4), "median spread", med(a).toFixed(3), "p75", [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.75)].toFixed(3), "share<=3c", (a.filter((x) => x <= 0.03 + 1e-9).length / a.length).toFixed(2));
