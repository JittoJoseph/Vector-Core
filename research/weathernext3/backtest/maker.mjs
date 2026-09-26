import fs from "fs";

const signals = JSON.parse(fs.readFileSync("signals.json", "utf8"));
const CACHE = "trades-cache.json";
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
const fee = (p) => 0.05 * p * (1 - p);
const slugCity = (c) => c.toLowerCase().replace(" (incheon)", "").replace(/ /g, "-");
const month = (d) => (d <= 30 && d >= 1 ? "september" : "september");

let seed = 5;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const sample = signals.filter(() => rnd() < 0.35);
console.log("sampled signals", sample.length);

const eventCache = {};
async function event(city, day) {
  const slug = `highest-temperature-in-${slugCity(city)}-on-${month(day)}-${day}-2026`;
  eventCache[slug] ??= (await (await fetch(`https://gamma-api.polymarket.com/events?slug=${slug}`)).json())[0];
  return eventCache[slug];
}

async function tradesFor(conditionId, since) {
  if (cache[conditionId]) return cache[conditionId];
  const all = [];
  for (let offset = 0; offset < 20000; offset += 500) {
    const r = await fetch(`https://data-api.polymarket.com/trades?market=${conditionId}&limit=500&offset=${offset}&takerOnly=true`);
    if (!r.ok) break;
    const page = await r.json();
    all.push(...page.map((x) => [x.timestamp, x.outcomeIndex === 0 ? x.price : 1 - x.price, (x.outcomeIndex === 0) === (x.side === "SELL") ? -1 : 1]));
    if (page.length < 500 || page.at(-1).timestamp * 1000 < since) break;
  }
  cache[conditionId] = all;
  return all;
}

const results = [];
let i = 0;
await Promise.all(Array.from({ length: 5 }, async () => {
  while (i < sample.length) {
    const s = sample[i++];
    try {
      const ev = await event(s.city, s.day);
      const m = ev?.markets?.find((x) => x.groupItemTitle === s.title);
      if (!m) continue;
      const trades = await tradesFor(m.conditionId, s.t);
      results.push({ s, trades });
    } catch (e) {
      console.log("err", e.message);
    }
    if (i % 50 === 0) {
      console.log(i, "/", sample.length);
      fs.writeFileSync(CACHE, JSON.stringify(cache));
    }
  }
}));
fs.writeFileSync(CACHE, JSON.stringify(cache));

function simulate(s, trades, mode, windowH) {
  const yesSide = s.side === "YES";
  const hs = s.sp / 2;
  const yesBid = s.pm - hs, yesAsk = s.pm + hs;
  let entry, entryFee, filledAt = s.t;
  if (mode === "taker") {
    entry = yesSide ? yesAsk : 1 - yesBid;
    entryFee = fee(entry);
  } else {
    const levelYes = mode === "join" ? (yesSide ? yesBid : yesAsk) : s.pm;
    entry = yesSide ? levelYes : 1 - levelYes;
    entryFee = 0;
    const deadline = s.t + windowH * 3600e3;
    const fill = trades
      .filter(([ts]) => ts * 1000 > s.t && ts * 1000 <= deadline)
      .sort((a, b) => a[0] - b[0])
      .find(([, yesPrice, aggressor]) =>
        yesSide ? aggressor === -1 && yesPrice < levelYes - 1e-9 : aggressor === 1 && yesPrice > levelYes + 1e-9,
      );
    if (!fill) return null;
    filledAt = fill[0] * 1000;
  }
  const target = s.target;
  let exit = null;
  for (const x of s.h) {
    const tt = x.t * 1000;
    if (tt <= filledAt) continue;
    if (tt >= Math.min(s.closeT, s.dayStart + 86400e3)) break;
    const v = yesSide ? x.p : 1 - x.p;
    if (v - hs >= target) { exit = v - hs; break; }
    if (v + hs <= entry - 0.2) { exit = Math.max(0, v - hs); break; }
  }
  const resolve = yesSide ? (s.win ? 1 : 0) : s.win ? 0 : 1;
  const val = exit ?? resolve;
  return (val - (exit === null ? 0 : fee(val)) - entry - entryFee) / entry;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const withTrades = results.filter((r) => r.trades.length);
console.log("signals with trade history", withTrades.length);
const taker = withTrades.map((r) => simulate(r.s, r.trades, "taker"));
console.log(`taker (live)         n ${taker.length} fill 100% mean ${(100 * mean(taker)).toFixed(1)}% total $${(taker.reduce((a, b) => a + b, 0) * 5).toFixed(0)}`);
for (const mode of ["join", "mid"]) for (const w of [1, 3, 6]) {
  const r = withTrades.map((x) => simulate(x.s, x.trades, mode, w));
  const filled = r.filter((x) => x !== null);
  console.log(`maker ${mode.padEnd(4)} ${String(w).padStart(2)}h   n ${filled.length} fill ${((100 * filled.length) / r.length).toFixed(0)}% mean ${(100 * mean(filled)).toFixed(1)}% total $${(filled.reduce((a, b) => a + b, 0) * 5).toFixed(0)}`);
}

function hybrid(s, trades, w) {
  const maker = simulate(s, trades, "mid", w);
  if (maker !== null) return { pnl: maker, how: "maker" };
  const deadline = s.t + w * 3600e3;
  let pNow = null;
  for (const x of s.h) { if (x.t * 1000 > deadline) break; pNow = x.p; }
  if (pNow === null || deadline >= Math.min(s.closeT, s.dayStart + 86400e3)) return null;
  const hs = s.sp / 2;
  const entry = s.side === "YES" ? pNow + hs : 1 - pNow + hs;
  if (s.target - entry - fee(entry) < 0.2) return null;
  const shifted = { ...s, t: deadline, pm: pNow };
  return { pnl: simulate(shifted, trades, "taker"), how: "taker" };
}
for (const w of [0.5, 1, 2]) {
  const r = withTrades.map((x) => hybrid(x.s, x.trades, w)).filter(Boolean);
  const mk = r.filter((x) => x.how === "maker");
  console.log(`hybrid mid ${w}h then taker: n ${r.length} (maker ${mk.length}) mean ${(100 * mean(r.map((x) => x.pnl))).toFixed(1)}% total $${(r.reduce((a, b) => a + b.pnl, 0) * 5).toFixed(0)}`);
}
