import fs from "fs";

const OLD = "C:/Users/jitto/AppData/Local/Temp/claude/D--Projects-Vector-Core/451f5158-3bae-43ad-b878-3dc95c346d10/scratchpad";
const events = ["reprice-events.json", "reprice-events-early.json"].flatMap((f) => JSON.parse(fs.readFileSync(`${OLD}/${f}`, "utf8")));
const stations = JSON.parse(fs.readFileSync(`${OLD}/stations.json`, "utf8"));
const runs = fs.readFileSync("ee-runs.jsonl", "utf8").trim().split("\n").map(JSON.parse);
const published = {};
for (const l of fs.readFileSync(`${OLD}/published.txt`, "utf8").trim().split("\n")) {
  const p = l.trim().split(/\s+/);
  const m = p[2]?.match(/(\d{4})(\d{2})(\d{2})_(\d{2})hr/);
  if (m) published[Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4])] = Date.parse(p[1]);
}
const snap = JSON.parse(fs.readFileSync(`${OLD}/spread-snapshot.json`, "utf8"));

const EE_LAG = 12 * 60e3;
const fee = (p) => 0.05 * p * (1 - p);
const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
const Phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const band = (h) => (h > 36 ? 3 : h > 18 ? 2 : h > 0 ? 1 : 0);
const pb = (m) => (m < 0.05 ? 0 : m < 0.15 ? 1 : m < 0.3 ? 2 : m < 0.5 ? 3 : 4);
const tab = {};
for (const r of snap) if (r.mid > 0.02 && r.mid < 0.98) (tab[band(r.leadH) * 10 + pb(Math.min(r.mid, 1 - r.mid))] ??= []).push(r.spread);
const SPREAD = {};
for (const [k, a] of Object.entries(tab)) SPREAD[k] = [...a].sort((x, y) => x - y)[a.length >> 1];
const spreadAt = (leadH, p) => SPREAD[band(leadH) * 10 + pb(Math.min(p, 1 - p))] ?? 0.05;

function parseBucket(title) {
  const m = title.match(/(-?\d+)(?:\s*-\s*(\d+))?/);
  const lo = +m[1], hi = m[2] != null ? +m[2] : lo;
  if (/or below/i.test(title)) return [-Infinity, hi + 0.5];
  if (/or higher|or above/i.test(title)) return [lo - 0.5, Infinity];
  return [lo - 0.5, hi + 0.5];
}
const center = ([lo, hi]) => (Number.isFinite(lo) && Number.isFinite(hi) ? (lo + hi) / 2 : null);
const priceAt = (h, t) => { let p = null; for (const x of h) { if (x.t * 1000 > t) break; p = x.p; } return p; };

const runList = runs.map((r) => {
  const init = Date.parse(r.init);
  const pub = published[init];
  return { init, six: new Date(init).getUTCHours() % 6 === 0, pub: pub ? pub + EE_LAG : null, byCity: r.byCity };
}).filter((r) => r.pub && r.pub - r.init < 12 * 3600e3).sort((a, b) => a.pub - b.pub);

const samples = [];
for (const ev of events) {
  const st = stations[ev.city];
  if (!st) continue;
  const isF = st.unit === "F";
  const buckets = ev.buckets.map((b) => ({ ...b, range: parseBucket(b.title) }));
  const winner = buckets.find((b) => b.win);
  if (!winner) continue;
  const closeT = Date.parse(ev.closedTime);
  for (const r of runList) {
    const s = r.byCity[ev.city];
    if (!s) continue;
    const t = r.pub;
    if (t >= closeT || t >= ev.dayStart + 86400e3) continue;
    let max = -Infinity, iMax = -1, covered = 0;
    for (let o = 0; o < s.mean.length; o++) {
      const vt = r.init + (o + 1) * 3600e3;
      if (vt >= ev.dayStart && vt < ev.dayStart + 86400e3 && s.mean[o] != null) {
        covered++;
        if (s.mean[o] > max) { max = s.mean[o]; iMax = o; }
      }
    }
    if (covered < 24) continue;
    const market = buckets.map((b) => priceAt(b.h, t));
    if (market.some((p) => p === null)) continue;
    const spreadC = (s.p90[iMax] - s.p10[iMax]) / 2.563;
    samples.push({
      city: ev.city, day: ev.day, isF, six: r.six, init: r.init, t, closeT, dayStart: ev.dayStart,
      leadH: (ev.dayStart - t) / 3600e3, fmaxC: max, ens: spreadC,
      actual: center(winner.range), winIdx: buckets.indexOf(winner), buckets, market,
    });
  }
}
console.log("samples", samples.length, "6h", samples.filter((s) => s.six).length, "events", new Set(samples.map((s) => s.city + s.day)).size);

const toUnit = (s, c) => (s.isF ? c * 1.8 + 32 : c);
const scale = (s) => (s.isF ? 1.8 : 1);
const resid = (s) => (s.actual - toUnit(s, s.fmaxC)) / scale(s);

function biasStatic(train) {
  const by = {};
  for (const s of train) if (s.actual != null) (by[s.city] ??= []).push(resid(s));
  const all = Object.values(by).flat(), g = mean(all), out = { g };
  for (const [c, a] of Object.entries(by)) out[c] = (a.reduce((x, y) => x + y, 0) + 8 * g) / (a.length + 8);
  return out;
}

const dayEnd = (d) => Math.max(...samples.filter((s) => s.day === d).map((s) => s.closeT));
function biasOnline(before, lambda, k) {
  const byDay = {};
  for (const s of samples) if (s.actual != null && s.closeT <= before) {
    const key = s.city + "|" + s.day;
    if (!byDay[key] || s.t > byDay[key].t) byDay[key] = s;
  }
  const obs = Object.values(byDay).sort((a, b) => a.closeT - b.closeT);
  const st = {};
  let gw = 0, gs = 0;
  for (const s of obs) {
    const r = resid(s);
    const c = (st[s.city] ??= { w: 0, s: 0 });
    c.w = lambda * c.w + 1; c.s = lambda * c.s + r;
    gw = lambda * gw + 1; gs = lambda * gs + r;
  }
  const g = gw ? gs / gw : 0.5, out = { g };
  for (const [c, v] of Object.entries(st)) out[c] = (v.s + k * g) / (v.w + k);
  return out;
}

function sigmaTable(train, biasFor) {
  const by = {};
  for (const s of train) if (s.actual != null) (by[band(s.leadH)] ??= []).push(resid(s) - (biasFor(s)));
  const out = {};
  for (const [b, a] of Object.entries(by)) { const m = mean(a); out[b] = Math.sqrt(mean(a.map((x) => (x - m) ** 2))); }
  return out;
}

function probs(s, mu, sig) {
  const raw = s.buckets.map(({ range: [lo, hi] }) => Phi((hi - mu) / sig) - Phi((lo - mu) / sig));
  const tot = raw.reduce((a, x) => a + x, 0);
  return raw.map((p) => Math.min(0.995, Math.max(0.002, p / tot)));
}

function build(model) {
  const days = [...new Set(samples.map((s) => s.day))];
  const cache = {};
  for (const s of samples) {
    let bias, sigT;
    if (model.bias === "static") {
      cache[s.day] ??= (() => { const tr = samples.filter((x) => x.day !== s.day); const b = biasStatic(tr); return { b, sg: sigmaTable(tr, (x) => b[x.city] ?? b.g) }; })();
      bias = cache[s.day].b; sigT = cache[s.day].sg;
    } else {
      const key = Math.floor(s.t / 86400e3);
      cache[key] ??= (() => { const b = biasOnline(s.t, model.lambda, model.k); const tr = samples.filter((x) => x.day !== s.day); const bs = biasStatic(tr); return { b, sg: sigmaTable(tr, (x) => bs[x.city] ?? bs.g) }; })();
      bias = cache[key].b; sigT = cache[key].sg;
    }
    const b = (bias[s.city] ?? bias.g) * scale(s);
    let sig = Math.max(0.6, sigT[band(s.leadH)] ?? 1.5);
    if (model.ens) sig = Math.sqrt(model.ens.a ** 2 + (model.ens.b * s.ens) ** 2);
    s.p = probs(s, toUnit(s, s.fmaxC) + b, sig * scale(s));
  }
}

function trade(list, { theta = 0.15, stop = 0.2, maxLead = Infinity }) {
  const out = [], seen = new Set();
  for (const s of [...list].sort((a, b) => a.t - b.t)) {
    if (s.leadH > maxLead) continue;
    s.buckets.forEach((b, i) => {
      const key = s.city + "|" + s.day + "|" + i;
      if (seen.has(key)) return;
      const pm = s.market[i], pw = s.p[i];
      if (pm < 0.03 || pm > 0.97) return;
      const sp = spreadAt(s.leadH, pm);
      if (sp > 0.03) return;
      const yes = pm + sp / 2, no = 1 - pm + sp / 2;
      let side = null;
      if (pw - yes - fee(yes) >= theta) side = "YES";
      else if (1 - pw - no - fee(no) >= theta) side = "NO";
      if (!side) return;
      seen.add(key);
      const entry = side === "YES" ? yes : no, target = side === "YES" ? pw : 1 - pw;
      const resolve = side === "YES" ? (b.win ? 1 : 0) : b.win ? 0 : 1;
      let exit = null;
      for (const x of b.h) {
        const tt = x.t * 1000;
        if (tt <= s.t) continue;
        if (tt >= Math.min(s.closeT, s.dayStart + 86400e3)) break;
        const v = side === "YES" ? x.p : 1 - x.p;
        const hs = spreadAt((s.dayStart - tt) / 3600e3, v) / 2;
        if (v - hs >= target) { exit = v - hs; break; }
        if (stop && v + hs <= entry - stop) { exit = Math.max(0, v - hs); break; }
      }
      const val = exit ?? resolve;
      out.push({ pnl: (val - (exit === null ? 0 : fee(val)) - entry - fee(entry)) / entry, day: s.day });
    });
  }
  return out;
}

let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function report(label, tr) {
  const byDay = {};
  for (const x of tr) (byDay[x.day] ??= []).push(x.pnl);
  const dm = Object.values(byDay).map(mean), boots = [];
  for (let k = 0; k < 2000; k++) boots.push(mean(dm.map(() => dm[Math.floor(rnd() * dm.length)])));
  boots.sort((a, b) => a - b);
  return `${label.padEnd(44)} n ${String(tr.length).padStart(5)}  mean ${(100 * mean(tr.map((x) => x.pnl))).toFixed(1).padStart(6)}%  CI[${(100 * boots[50]).toFixed(1)}, ${(100 * boots[1949]).toFixed(1)}]`;
}
const logloss = (list) => mean(list.map((s) => -Math.log(Math.max(1e-3, s.p[s.winIdx]))));
const mktLoss = (list) => mean(list.map((s) => -Math.log(Math.max(1e-3, s.market[s.winIdx]))));

const SPLITS = { explored: (d) => d >= 12 && d <= 21, "late 22-25": (d) => d >= 22, "early 2-11": (d) => d <= 11 };
function evaluate(name, model, cfg = {}) {
  build(model);
  const lists = { "6h runs": samples.filter((s) => s.six), "all runs": samples };
  for (const [ln, list] of Object.entries(lists)) {
    if (cfg.only && cfg.only !== ln) continue;
    console.log(`\n== ${name} | ${ln} | logloss wn3 ${logloss(list).toFixed(3)} mkt ${mktLoss(list).toFixed(3)}`);
    const tr = trade(list, cfg);
    for (const [sn, f] of Object.entries(SPLITS)) console.log("  " + report(sn, tr.filter((x) => f(x.day))));
  }
}

const which = process.argv[2] ?? "all";
if (which === "all" || which === "base") evaluate("static bias, band sigma", { bias: "static" });
if (which === "all" || which === "online") for (const [lambda, k] of [[0.97, 8], [0.93, 5]]) evaluate(`online bias l${lambda} k${k}, band sigma`, { bias: "online", lambda, k });
if (which === "all" || which === "ens") for (const [a, b] of [[0.8, 1], [0.6, 1.3], [1.0, 0.8]]) evaluate(`static bias, ens sigma a${a} b${b}`, { bias: "static", ens: { a, b } });
if (which === "all" || which === "lead") evaluate("static bias, band sigma, lead<=18h", { bias: "static" }, { maxLead: 18 });
if (which === "grid") {
  build({ bias: "static" });
  for (const theta of [0.12, 0.15, 0.18, 0.2]) for (const stop of [0.1, 0.2, 0.3]) {
    const tr = trade(samples, { theta, stop });
    const tot = (f) => { const x = tr.filter((t) => f(t.day)); return `$${(x.reduce((a, t) => a + t.pnl, 0) * 5).toFixed(0)}`; };
    console.log(`theta ${theta} stop ${stop}`.padEnd(20), Object.entries(SPLITS).map(([n, f]) => `${n}: ${report("", tr.filter((t) => f(t.day))).replace(/\s+/g, " ").trim()} tot ${tot(f)}`).join(" | "));
  }
}
if (which === "fit") {
  const b = biasStatic(samples);
  const sg = sigmaTable(samples, (x) => b[x.city] ?? b.g);
  const n = {};
  const byDayCity = new Set(samples.filter((s) => s.actual != null).map((s) => s.city + "|" + s.day));
  for (const k of byDayCity) { const c = k.split("|")[0]; n[c] = (n[c] ?? 0) + 1; }
  console.log(JSON.stringify({ global: b.g, sigma: sg }));
  console.log(Object.keys(b).filter((k) => k !== "g").sort().map((c) => `${c}: ${b[c].toFixed(3)} (days ${n[c]})`).join("\n"));
}
