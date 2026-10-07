import fs from "fs";

const OLD = "C:/Users/jitto/AppData/Local/Temp/claude/D--Projects-Vector-Core/451f5158-3bae-43ad-b878-3dc95c346d10/scratchpad";
const events = (process.env.EVENTS ?? `${OLD}/reprice-events.json,${OLD}/reprice-events-early.json`).split(",").flatMap((f) => JSON.parse(fs.readFileSync(f, "utf8")));
const stations = JSON.parse(fs.readFileSync(`${OLD}/stations.json`, "utf8"));
const runs = fs.readFileSync(process.env.RUNS ?? "ee-runs.jsonl", "utf8").trim().split("\n").map(JSON.parse);
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
const spreadAt = (leadH, p) => process.env.FLATSPREAD ? (leadH < 24 ? +process.env.FLATSPREAD : 0.44) : SPREAD[band(leadH) * 10 + pb(Math.min(p, 1 - p))] ?? 0.05;

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
  const pub = process.env.PUBLAT === "auto" ? init + (new Date(init).getUTCHours() % 6 === 0 ? 7.3 : 6.65) * 3600e3 : process.env.PUBLAT ? init + +process.env.PUBLAT * 3600e3 - EE_LAG : published[init];
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
    let max = -Infinity, iMax = -1, covered = 0, q10 = -Infinity, q90 = -Infinity;
    for (let o = 0; o < s.mean.length; o++) {
      const vt = r.init + (o + 1) * 3600e3;
      if (vt >= ev.dayStart && vt < ev.dayStart + 86400e3 && s.mean[o] != null) {
        covered++;
        if (s.mean[o] > max) { max = s.mean[o]; iMax = o; }
        if (s.p10?.[o] != null && s.p10[o] > q10) q10 = s.p10[o];
        if (s.p90?.[o] != null && s.p90[o] > q90) q90 = s.p90[o];
      }
    }
    if (covered < 24) continue;
    const market = buckets.map((b) => priceAt(b.h, t));
    if (market.some((p) => p === null)) continue;
    const spreadC = (s.p90[iMax] - s.p10[iMax]) / 2.563;
    samples.push({
      city: ev.city, day: ev.day, isF, six: r.six, init: r.init, t, closeT, dayStart: ev.dayStart,
      leadH: (ev.dayStart - t) / 3600e3, fmaxC: max, ens: spreadC, q10, q90, iMax,
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

const PROD_SIGMA = { 0: 0.875, 1: 0.904, 2: 0.95, 3: 1.0 };
const PROD_BIAS = { g: 0.66, ...Object.fromEntries(JSON.parse(fs.readFileSync("prod-bias.json", "utf8"))) };
function build(model) {
  const days = [...new Set(samples.map((s) => s.day))];
  const cache = {};
  for (const s of samples) {
    let bias, sigT;
    if (model.bias === "prod") {
      bias = PROD_BIAS; sigT = PROD_SIGMA;
    } else if (model.bias === "static") {
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
    s.p = probs(s, toUnit(s, s.fmaxC) + b + (model.extraShift ? s.shift ?? 0 : 0), sig * scale(s));
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
      out.push({ pnl: (val - (exit === null ? 0 : fee(val)) - entry - fee(entry)) / entry, day: s.day, city: s.city, side, band: band(s.leadH) });
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
function tradeV({ theta = 0.2, stop = 0.2, dynamic = false, reenter = false, exitOnFlip = false, list = samples }) {
  const out = [], held = new Map(), done = new Set();
  const byKey = {};
  for (const s of list) (byKey[s.city + "|" + s.day] ??= []).push(s);
  for (const g of Object.values(byKey)) g.sort((a, b) => a.t - b.t);
  for (const s of [...list].sort((a, b) => a.t - b.t)) {
    const g = byKey[s.city + "|" + s.day];
    s.buckets.forEach((b, i) => {
      const key = s.city + "|" + s.day + "|" + i;
      if (done.has(key) && !reenter) return;
      if (held.has(key) && held.get(key) > s.t) return;
      const pm = s.market[i], pw = s.p[i];
      if (pm < 0.03 || pm > 0.97) return;
      const sp = spreadAt(s.leadH, pm);
      if (sp > 0.03) return;
      const yes = pm + sp / 2, no = 1 - pm + sp / 2;
      let side = null;
      if (pw - yes - fee(yes) >= theta) side = "YES";
      else if (1 - pw - no - fee(no) >= theta) side = "NO";
      if (!side) return;
      done.add(key);
      const entry = side === "YES" ? yes : no;
      let target = side === "YES" ? pw : 1 - pw;
      const resolve = side === "YES" ? (b.win ? 1 : 0) : b.win ? 0 : 1;
      let exit = null, exitT = s.closeT, j = g.indexOf(s) + 1;
      for (const x of b.h) {
        const tt = x.t * 1000;
        if (tt <= s.t) continue;
        if (tt >= Math.min(s.closeT, s.dayStart + 86400e3)) break;
        while (dynamic && j < g.length && g[j].t <= tt) { const q = g[j++].p[i]; target = side === "YES" ? q : 1 - q; }
        const v = side === "YES" ? x.p : 1 - x.p;
        const hs = spreadAt((s.dayStart - tt) / 3600e3, v) / 2;
        if (v - hs >= target) { exit = v - hs; exitT = tt; break; }
        if (exitOnFlip && target < v - hs - 0.02) { exit = v - hs; exitT = tt; break; }
        if (stop && v + hs <= entry - stop) { exit = Math.max(0, v - hs); exitT = tt; break; }
      }
      held.set(key, exitT);
      const val = exit ?? resolve;
      out.push({ pnl: (val - (exit === null ? 0 : fee(val)) - entry - fee(entry)) / entry, day: s.day, exited: exit !== null });
    });
  }
  return out;
}
if (which === "exit") {
  build({ bias: "static" });
  const variants = [["static target (live)", {}], ["dynamic target", { dynamic: true }], ["static + re-entry", { reenter: true }], ["dynamic + re-entry", { dynamic: true, reenter: true }]];
  for (const [name, opt] of variants) {
    const tr = tradeV(opt);
    const tot = (f) => `$${(tr.filter((t) => f(t.day)).reduce((a, t) => a + t.pnl, 0) * 5).toFixed(0)}`;
    console.log(name.padEnd(24), Object.entries(SPLITS).map(([n, f]) => `${n}: ${report("", tr.filter((t) => f(t.day))).replace(/\s+/g, " ").trim()} ${tot(f)}`).join(" | "));
  }
}
export function signalsForExport() {
  build({ bias: "static" });
  const out = [], done = new Set();
  for (const s of [...samples].sort((a, b) => a.t - b.t)) {
    s.buckets.forEach((b, i) => {
      const key = s.city + "|" + s.day + "|" + i;
      if (done.has(key)) return;
      const pm = s.market[i], pw = s.p[i];
      if (pm < 0.03 || pm > 0.97) return;
      const sp = spreadAt(s.leadH, pm);
      if (sp > 0.03) return;
      const yes = pm + sp / 2, no = 1 - pm + sp / 2;
      let side = null;
      if (pw - yes - fee(yes) >= 0.2) side = "YES";
      else if (1 - pw - no - fee(no) >= 0.2) side = "NO";
      if (!side) return;
      done.add(key);
      out.push({ city: s.city, day: s.day, t: s.t, closeT: s.closeT, dayStart: s.dayStart, title: b.title, win: b.win, h: b.h, side, pm, sp, target: side === "YES" ? pw : 1 - pw });
    });
  }
  return out;
}
if (which === "signals") fs.writeFileSync("signals.json", JSON.stringify(signalsForExport()));
if (which === "resid") {
  const latest = {};
  for (const s of samples) {
    if (s.actual == null || s.leadH < 0 || s.leadH > 24) continue;
    const k = s.city + "|" + s.day;
    if (!latest[k] || s.t > latest[k].t) latest[k] = s;
  }
  const rows = Object.values(latest);
  const runById = new Map(runs.map((r) => [Date.parse(r.init), r]));
  const cityMean = {};
  for (const s of rows) (cityMean[s.city] ??= []).push(s.fmaxC);
  for (const [c, a] of Object.entries(cityMean)) cityMean[c] = mean(a);
  const cityBias = {};
  for (const s of rows) (cityBias[s.city] ??= []).push(resid(s));
  for (const [c, a] of Object.entries(cityBias)) cityBias[c] = mean(a);
  const feats = rows.map((s) => {
    const r = runById.get(s.init).byCity[s.city];
    let min = Infinity, iMax = -1, max = -Infinity;
    r.mean.forEach((v, o) => { const vt = s.init + (o + 1) * 3600e3; if (vt >= s.dayStart && vt < s.dayStart + 86400e3 && v != null) { if (v < min) min = v; if (v > max) { max = v; iMax = o; } } });
    const peakLocalH = ((s.init + (iMax + 1) * 3600e3 - s.dayStart) / 3600e3);
    return { y: resid(s) - cityBias[s.city], anomaly: s.fmaxC - cityMean[s.city], ens: s.ens, range: max - min, peakH: peakLocalH, lead: s.leadH };
  });
  const corr = (k) => { const x = feats.map((f) => f[k]), y = feats.map((f) => f.y); const mx = mean(x), my = mean(y); let n = 0, a = 0, b = 0; x.forEach((v, i) => { n += (v - mx) * (y[i] - my); a += (v - mx) ** 2; b += (y[i] - my) ** 2; }); return (n / Math.sqrt(a * b)).toFixed(3); };
  console.log("city-days", feats.length, "residual sd after city bias", Math.sqrt(mean(feats.map((f) => f.y ** 2))).toFixed(3));
  for (const k of ["anomaly", "ens", "range", "peakH", "lead"]) console.log(k.padEnd(8), "corr with residual", corr(k));
  const q = (k, n = 4) => { const s = [...feats].sort((a, b) => a[k] - b[k]); const out = []; for (let i = 0; i < n; i++) { const g = s.slice(Math.floor((i * s.length) / n), Math.floor(((i + 1) * s.length) / n)); out.push(`${mean(g.map((f) => f[k])).toFixed(2)}→${mean(g.map((f) => f.y)).toFixed(2)}`); } return out.join("  "); };
  for (const k of ["anomaly", "ens", "range", "peakH"]) console.log(k.padEnd(8), "quartile mean feature→mean residual:", q(k));
}
if (which === "lin") {
  const cityMean = {};
  for (const s of samples) (cityMean[s.city] ??= []).push(s.fmaxC);
  for (const [c, a] of Object.entries(cityMean)) cityMean[c] = mean(a);
  const ensMean = mean(samples.map((s) => s.ens));
  const fitDay = {};
  for (const d of [...new Set(samples.map((s) => s.day))]) {
    const tr = samples.filter((x) => x.day !== d && x.actual != null);
    const b = biasStatic(tr);
    const X = tr.map((s) => [s.fmaxC - cityMean[s.city], s.ens - ensMean]);
    const Y = tr.map((s) => resid(s) - (b[s.city] ?? b.g));
    let a11 = 0, a12 = 0, a22 = 0, c1 = 0, c2 = 0;
    X.forEach(([x1, x2], i) => { a11 += x1 * x1; a12 += x1 * x2; a22 += x2 * x2; c1 += x1 * Y[i]; c2 += x2 * Y[i]; });
    const det = a11 * a22 - a12 * a12;
    fitDay[d] = [(c1 * a22 - c2 * a12) / det, (a11 * c2 - a12 * c1) / det];
  }
  console.log("coef sample (anomaly, ens):", fitDay[15].map((x) => x.toFixed(3)).join(", "));
  build({ bias: "static" });
  const base = { ll: logloss(samples), tr: trade(samples, { theta: 0.2 }) };
  const saveP = samples.map((s) => s.p);
  const sgCache = {};
  for (const s of samples) {
    const [k1, k2] = fitDay[s.day];
    const shift = (k1 * (s.fmaxC - cityMean[s.city]) + k2 * (s.ens - ensMean)) * scale(s);
    const [lo0] = s.buckets[0].range;
    const mu0 = s.p.reduce((a, p, i) => a, 0);
    s.shift = shift;
  }
  for (const s of samples) {
    const width = s.isF ? 1.8 : 1;
    const oldMuGuess = null;
    s.p = s.p;
  }
  build({ bias: "static", extraShift: true });
  const lin = { ll: logloss(samples), tr: trade(samples, { theta: 0.2 }) };
  const tot = (tr, f) => `$${(tr.filter((t) => f(t.day)).reduce((a, t) => a + t.pnl, 0) * 5).toFixed(0)}`;
  for (const [name, r] of [["base", base], ["linear correction", lin]])
    console.log(name.padEnd(18), "logloss", r.ll.toFixed(4), Object.entries(SPLITS).map(([n, f]) => `${n}: n ${r.tr.filter((t) => f(t.day)).length} ${tot(r.tr, f)}`).join(" | "));
}

const centerOf = (c) => (Number.isFinite(c[0]) && Number.isFinite(c[1]) ? (c[0] + c[1]) / 2 : Number.isFinite(c[0]) ? c[0] + 0.5 : c[1] - 0.5);
const expect = (x, probsArr) => { let m = 0, t = 0; x.buckets.forEach((b, i) => { m += centerOf(b.range) * probsArr[i]; t += probsArr[i]; }); return m / t; };
if (which === "oos") {
  build({ bias: process.env.BIAS ?? "prod" });
  const list = samples.filter((x) => (process.env.SIX ? x.six : true));
  console.log("logloss wn3", logloss(list).toFixed(3), "mkt", mktLoss(list).toFixed(3));
  const withAct = list.filter((x) => x.actual != null);
  const mae = (f) => mean(withAct.map((x) => Math.abs(f(x) - x.actual) / scale(x))).toFixed(3);
  console.log("MAE degC  wn3", mae((x) => expect(x, x.p)), "market", mae((x) => expect(x, x.market)));
  const tr = trade(list, { theta: 0.2, stop: 0.2 });
  console.log(report("all", tr), "total $" + (tr.reduce((a, t) => a + t.pnl, 0) * 5).toFixed(0));
  const byWeek = {};
  for (const t of tr) (byWeek[Math.ceil(t.day / 8)] ??= []).push(t);
  for (const [w, g] of Object.entries(byWeek)) console.log("  " + report("days " + (w * 8 - 7) + "-" + w * 8, g));
}

if (which === "breakdown") {
  build({ bias: "prod" });
  const list = samples.filter((x) => (process.env.SIX ? x.six : true));
  for (const theta of [0.15, 0.2, 0.25, 0.3]) {
    const tr = trade(list, { theta, stop: 0.2 });
    console.log("theta", theta, report("", tr), "total $" + (tr.reduce((a, t) => a + t.pnl, 0) * 5).toFixed(0));
  }
  const tr = trade(list, { theta: 0.2, stop: 0.2 });
  const agg = (k) => {
    const g = {};
    for (const t of tr) (g[t[k]] ??= []).push(t.pnl);
    return Object.fromEntries(Object.entries(g).map(([c, a]) => [c, { n: a.length, total: a.reduce((x, y) => x + y, 0) * 5 }]));
  };
  fs.writeFileSync(process.env.OUTCITY ?? "city.json", JSON.stringify({ city: agg("city"), side: agg("side"), band: agg("band") }));
  console.log("side", JSON.stringify(agg("side")), "band", JSON.stringify(agg("band")));
}

function tradeX(list, { theta = 0.2, stop = 0.2, stopSlip = 0 } = {}) {
  const out = [], seen = new Set();
  for (const s of [...list].sort((a, b) => a.t - b.t)) {
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
      let exit = null, xt = null, how = "RES";
      const noStop = [], noStopNoTp = null;
      for (const x of b.h) {
        const tt = x.t * 1000;
        if (tt <= s.t) continue;
        if (tt >= Math.min(s.closeT, s.dayStart + 86400e3)) break;
        const v = side === "YES" ? x.p : 1 - x.p;
        const hs = spreadAt((s.dayStart - tt) / 3600e3, v) / 2;
        if (v - hs >= target) { exit = v - hs; xt = tt; how = "TP"; break; }
        if (stop && v + hs <= entry - stop) { exit = Math.max(0, v - hs - stopSlip); xt = tt; how = "SL"; break; }
      }
      let tpOnly = null;
      for (const x of b.h) {
        const tt = x.t * 1000;
        if (tt <= s.t) continue;
        if (tt >= Math.min(s.closeT, s.dayStart + 86400e3)) break;
        const v = side === "YES" ? x.p : 1 - x.p;
        const hs = spreadAt((s.dayStart - tt) / 3600e3, v) / 2;
        if (v - hs >= target) { tpOnly = v - hs; break; }
      }
      const val = exit ?? resolve;
      const r = (v, isExit) => (v - (isExit ? fee(v) : 0) - entry - fee(entry)) / (entry + fee(entry));
      out.push({ key: s.city + "|" + s.day, city: s.city, day: s.day, side, entry, target, pw, pm, leadH: s.leadH, t: s.t,
        xt: xt ?? s.closeT, how, ret: r(val, exit !== null), retHold: r(resolve, false), retTpOnly: tpOnly !== null ? r(tpOnly, true) : r(resolve, false), win: resolve });
    });
  }
  return out;
}
if (which === "export") {
  build({ bias: "prod" });
  const list = samples.filter((x) => (process.env.SIX ? x.six : true));
  fs.writeFileSync(process.env.OUT, JSON.stringify(tradeX(list, { theta: +(process.env.THETA ?? 0.2), stop: +(process.env.STOP ?? 0.2), stopSlip: +(process.env.SLIP ?? 0) })));
  console.log("exported");
}

if (which === "feat") {
  build({ bias: "prod" });
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const hist = {};
  for (const s of sorted) (hist[s.city + "|" + s.day] ??= []).push(s);
  const runCount = {};
  const out = [], seen = new Set();
  const theta = +(process.env.THETA ?? 0.2);
  for (const s of sorted) {
    const sig = Math.max(0.6, PROD_SIGMA[band(s.leadH)]) * scale(s);
    const mu = toUnit(s, s.fmaxC) + (PROD_BIAS[s.city] ?? PROD_BIAS.g) * scale(s);
    const mRank = [...s.market.keys()].sort((a, b) => s.market[b] - s.market[a]);
    const pRank = [...s.p.keys()].sort((a, b) => s.p[b] - s.p[a]);
    const Em = expect(s, s.market);
    const prev = hist[s.city + "|" + s.day].filter((x) => x.t < s.t);
    const f6 = prev.filter((x) => x.t >= s.t - 6.5 * 3600e3);
    const f12 = prev.filter((x) => x.t >= s.t - 12.5 * 3600e3);
    s.buckets.forEach((b, i) => {
      const key = s.city + "|" + s.day + "|" + i;
      if (seen.has(key)) return;
      const pm = s.market[i], pw = s.p[i];
      if (pm < 0.03 || pm > 0.97) return;
      const sp = spreadAt(s.leadH, pm);
      if (sp > 0.03) return;
      const yes = pm + sp / 2;
      if (pw - yes - fee(yes) < theta) return;
      seen.add(key);
      const rk = s.city + s.day + s.t;
      runCount[s.t] = (runCount[s.t] ?? 0) + 1;
      let exit = null, how = "RES", xt = null;
      for (const x of b.h) {
        const tt = x.t * 1000;
        if (tt <= s.t) continue;
        if (tt >= Math.min(s.closeT, s.dayStart + 86400e3)) break;
        const hs = spreadAt((s.dayStart - tt) / 3600e3, x.p) / 2;
        if (x.p - hs >= pw) { exit = x.p - hs; how = "TP"; xt = tt; break; }
        if (x.p + hs <= yes - 0.2) { exit = Math.max(0, x.p - hs - 0.08); how = "SL"; xt = tt; break; }
      }
      const resolve = b.win ? 1 : 0;
      const val = exit ?? resolve;
      const ret = (val - (exit === null ? 0 : fee(val)) - yes - fee(yes)) / (yes + fee(yes));
      const c = centerOf(b.range);
      const pmAgo = (h) => priceAt(b.h, s.t - h * 3600e3);
      const muAt = (x) => toUnit(x, x.fmaxC);
      out.push({
        city: s.city, day: s.day, month: process.env.MONTH, t: s.t, leadH: s.leadH, localH: (s.t - s.dayStart) / 3600e3,
        pw, pm, entry: yes, edge: pw - yes - fee(yes), ratio: pw / yes,
        z: (c - mu) / sig, zMkt: (c - Em) / scale(s), gap: (mu - Em) / scale(s),
        mRank: mRank.indexOf(i), pRank: pRank.indexOf(i), mTop: s.market[mRank[0]], pTop: s.p[pRank[0]],
        ens: s.ens, isF: s.isF, tail: !Number.isFinite(b.range[0]) || !Number.isFinite(b.range[1]),
        d6: f6.length ? (muAt(s) - muAt(f6[0])) / scale(s) : null,
        r12: f12.length ? (Math.max(...f12.map(muAt), muAt(s)) - Math.min(...f12.map(muAt), muAt(s))) / scale(s) : null,
        n12: f12.length,
        pm2: pmAgo(2) != null ? pm - pmAgo(2) : null, pm6: pmAgo(6) != null ? pm - pmAgo(6) : null,
        how, ret, win: resolve, runKey: s.t,
      });
    });
  }
  for (const o of out) o.runN = runCount[o.runKey];
  fs.writeFileSync(process.env.OUT, JSON.stringify(out));
  console.log("feat", out.length);
}

if (which === "placebo") {
  build({ bias: "prod" });
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const seen = new Set();
  const groups = {};
  const MARK = +(process.env.MARK ?? 0.22);
  for (const s of sorted) {
    s.buckets.forEach((b, i) => {
      const pm = s.market[i], pw = s.p[i];
      if (pm < 0.03 || pm > 0.3) return;
      const sp = spreadAt(s.leadH, pm);
      if (sp > 0.03) return;
      const yes = pm + sp / 2;
      const e = pw - yes - fee(yes);
      const g = e >= 0.2 ? "A model +20pts" : e >= 0.1 ? "B model +10-20" : e >= -0.05 ? "C model ~agrees" : "D model says overpriced";
      const key = g + s.city + s.day + i;
      if (seen.has(key)) return;
      seen.add(key);
      const run = (target) => {
        let exit = null;
        for (const x of b.h) {
          const tt = x.t * 1000;
          if (tt <= s.t) continue;
          if (tt >= Math.min(s.closeT, s.dayStart + 86400e3)) break;
          const hs = spreadAt((s.dayStart - tt) / 3600e3, x.p) / 2;
          if (x.p - hs >= target) { exit = x.p - hs; break; }
          if (x.p + hs <= yes - 0.2) { exit = Math.max(0, x.p - hs - 0.08); break; }
        }
        const val = exit ?? (b.win ? 1 : 0);
        return (val - (exit === null ? 0 : fee(val)) - yes - fee(yes)) / (yes + fee(yes));
      };
      (groups[g] ??= []).push({ fixed: run(yes + MARK), model: run(Math.max(pw, yes + 0.01)), hold: ((b.win ? 1 : 0) - yes - fee(yes)) / (yes + fee(yes)), win: b.win ? 1 : 0, entry: yes, pw });
    });
  }
  for (const [g, a] of Object.entries(groups).sort()) {
    const m = (f) => (100 * mean(a.map(f))).toFixed(0).padStart(5) + "%";
    console.log(g.padEnd(24), "n", String(a.length).padStart(5), "avg entry", (100 * mean(a.map((x) => x.entry))).toFixed(1) + "c", "model p", (100 * mean(a.map((x) => x.pw))).toFixed(0) + "%", "win", (100 * mean(a.map((x) => x.win))).toFixed(1) + "%", "| fixed +" + MARK + " TP", m((x) => x.fixed), "| hold", m((x) => x.hold));
  }
}

function irls(X, y, iters = 25, ridge = 1e-4) {
  const k = X[0].length;
  let w = new Array(k).fill(0);
  for (let it = 0; it < iters; it++) {
    const H = Array.from({ length: k }, () => new Array(k).fill(0)), g = new Array(k).fill(0);
    for (let r = 0; r < X.length; r++) {
      const x = X[r];
      let z = 0; for (let j = 0; j < k; j++) z += w[j] * x[j];
      const p = 1 / (1 + Math.exp(-z)), v = p * (1 - p);
      for (let j = 0; j < k; j++) { g[j] += (y[r] - p) * x[j]; for (let l = 0; l < k; l++) H[j][l] += v * x[j] * x[l]; }
    }
    for (let j = 0; j < k; j++) { H[j][j] += ridge; g[j] -= ridge * w[j]; }
    const A = H.map((row, j) => [...row, g[j]]);
    for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]]; for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let l = c; l <= k; l++) A[r][l] -= f * A[c][l]; } }
    const d = A.map((row, j) => row[k] / row[j]);
    w = w.map((x, j) => x + d[j]);
  }
  return w;
}
if (which === "pool") {
  build({ bias: "prod" });
  const lg = (p, lo, hi) => { const q = Math.min(hi, Math.max(lo, p)); return Math.log(q / (1 - q)); };
  const SPLIT = +(process.env.SPLIT ?? 244);
  const FEATS = {
    m1: (s, i) => [1, lg(s.p[i], 0.002, 0.995), lg(s.market[i], 0.005, 0.995)],
    m2: (s, i) => { const a = lg(s.p[i], 0.002, 0.995), b = lg(s.market[i], 0.005, 0.995), od = s.leadH < 0 ? 1 : 0, far = s.leadH > 18 ? 1 : 0; return [1, a, b, a * od, b * od, a * far, b * far]; },
  };
  const fm = FEATS[process.env.FEAT ?? "m2"];
  const X = [], y = [];
  for (const s of samples) if (s.day < SPLIT) s.buckets.forEach((b, i) => { X.push(fm(s, i)); y.push(i === s.winIdx ? 1 : 0); });
  const w = irls(X, y);
  console.log("weights", w.map((x) => x.toFixed(3)).join(" "), "rows", X.length);
  for (const s of samples) {
    const raw = s.buckets.map((b, i) => { const x = fm(s, i); let z = 0; for (let j = 0; j < w.length; j++) z += w[j] * x[j]; return 1 / (1 + Math.exp(-z)); });
    const tot = raw.reduce((a, b) => a + b, 0);
    s.q = raw.map((x) => x / tot);
  }
  const ll = (list, f) => mean(list.map((s) => -Math.log(Math.max(1e-3, f(s)[s.winIdx]))));
  for (const [name, sel] of [["train", (s) => s.day < SPLIT], ["test", (s) => s.day >= SPLIT && s.day < 269], ["late 269+", (s) => s.day >= 269]]) {
    const l = samples.filter(sel);
    console.log(name.padEnd(10), "logloss wn3", ll(l, (s) => s.p).toFixed(3), "mkt", ll(l, (s) => s.market).toFixed(3), "pooled", ll(l, (s) => s.q).toFixed(3), "n", l.length);
  }
  const sim = (list, prob, theta) => {
    const out = [], seen = new Set();
    for (const s of [...list].sort((a, b) => a.t - b.t)) s.buckets.forEach((b, i) => {
      const key = s.city + "|" + s.day + "|" + i;
      if (seen.has(key)) return;
      const pm = s.market[i], pw = prob(s)[i];
      if (pm < 0.03 || pm > 0.97) return;
      const sp = spreadAt(s.leadH, pm);
      if (sp > 0.03) return;
      const yes = pm + sp / 2;
      if (pw - yes - fee(yes) < theta) return;
      seen.add(key);
      let exit = null;
      for (const x of b.h) {
        const tt = x.t * 1000;
        if (tt <= s.t) continue;
        if (tt >= Math.min(s.closeT, s.dayStart + 86400e3)) break;
        const hs = spreadAt((s.dayStart - tt) / 3600e3, x.p) / 2;
        if (x.p - hs >= pw) { exit = x.p - hs; break; }
        if (x.p + hs <= yes - 0.2) { exit = Math.max(0, x.p - hs - 0.08); break; }
      }
      const val = exit ?? (b.win ? 1 : 0);
      out.push({ day: s.day, entry: yes, ret: (val - (exit === null ? 0 : fee(val)) - yes - fee(yes)) / (yes + fee(yes)) });
    });
    return out;
  };
  const rep = (label, tr) => {
    const d = {}; for (const t of tr) (d[t.day] ??= []).push(t.ret);
    const dm = Object.values(d).map(mean);
    return `${label.padEnd(26)} n ${String(tr.length).padStart(5)} ret ${(100 * mean(tr.map((t) => t.ret))).toFixed(0).padStart(5)}% total $${(5 * tr.reduce((a, t) => a + t.ret, 0)).toFixed(0).padStart(5)} losingDays ${dm.filter((x) => x < 0).length}/${dm.length} worstDay ${(100 * Math.min(...dm)).toFixed(0)}% avgEntry ${(100 * mean(tr.map((t) => t.entry))).toFixed(1)}c`;
  };
  for (const [name, sel] of [["TRAIN aug", (s) => s.day < SPLIT], ["TEST sep", (s) => s.day >= SPLIT && s.day < 269], ["LATE 26-28", (s) => s.day >= 269]]) {
    const l = samples.filter(sel);
    console.log(`\n${name}`);
    console.log("  " + rep("base wn3 edge>=.20", sim(l, (s) => s.p, 0.2).filter((t) => true)));
    for (const th of [0.02, 0.04, 0.06, 0.08, 0.12]) console.log("  " + rep(`pooled edge>=${th}`, sim(l, (s) => s.q, th)));
  }
}

if (which === "obs") {
  build({ bias: "prod" });
  const OBS = JSON.parse(fs.readFileSync("obs.json", "utf8"));
  const SPLIT = +(process.env.SPLIT ?? 244);
  const runByInit = Object.fromEntries(runList.map((r) => [r.init, r]));
  const fcAt = (series, init, t) => { const o = (t - init) / 3600e3 - 1, a = Math.floor(o), f = o - a; const v0 = series[a], v1 = series[a + 1]; if (v0 == null) return null; return v1 == null ? v0 : v0 * (1 - f) + v1 * f; };
  let have = 0;
  for (const s of samples) {
    const ob = OBS[s.city];
    const run = runByInit[s.init];
    s.e3 = null; s.omax = null;
    if (!ob || !run) continue;
    const ser = run.byCity[s.city].mean;
    const errs = [];
    for (let j = ob.length - 1; j >= 0; j--) {
      const [ot, ov] = ob[j];
      if (ot > s.t) continue;
      if (ot < s.t - 3 * 3600e3) break;
      if (ot <= s.init) continue;
      const fc = fcAt(ser, s.init, ot);
      if (fc != null) errs.push(ov - fc);
    }
    if (errs.length) { s.e3 = mean(errs); have++; }
    if (s.t > s.dayStart) { let m = -Infinity; for (const [ot, ov] of ob) if (ot >= s.dayStart && ot <= s.t && ov > m) m = ov; if (Number.isFinite(m)) s.omax = m; }
  }
  console.log("samples with obs error", have, "of", samples.length);
  const muOf = (s) => toUnit(s, s.fmaxC) + (PROD_BIAS[s.city] ?? PROD_BIAS.g) * scale(s);
  const resC = (s) => (s.actual - muOf(s)) / scale(s);
  const lb = (h) => (h < 0 ? "onday" : h < 12 ? "0-12" : h < 24 ? "12-24" : "24+");
  const cityE = {};
  for (const s of samples) if (s.day < SPLIT && s.e3 != null) (cityE[s.city] ??= []).push(s.e3);
  const cityMeanE = Object.fromEntries(Object.entries(cityE).map(([c, a]) => [c, mean(a)]));
  const fit = {};
  for (const band of ["onday", "0-12", "12-24", "24+"]) {
    const tr = samples.filter((s) => s.day < SPLIT && s.e3 != null && s.actual != null && lb(s.leadH) === band);
    const xs = tr.map((s) => s.e3 - (cityMeanE[s.city] ?? 0)), ys = tr.map(resC);
    const mx = mean(xs), my = mean(ys);
    const k = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    const corr = k * Math.sqrt(mean(xs.map((x) => (x - mx) ** 2)) / mean(ys.map((y) => (y - my) ** 2)));
    fit[band] = k;
    const sdBefore = Math.sqrt(mean(ys.map((y) => (y - my) ** 2)));
    const sdAfter = Math.sqrt(mean(ys.map((y, i) => (y - my - k * (xs[i] - mx)) ** 2)));
    console.log(`train ${band.padEnd(6)} n ${tr.length} k ${k.toFixed(3)} corr ${corr.toFixed(3)} residSD ${sdBefore.toFixed(3)} -> ${sdAfter.toFixed(3)}`);
  }
  const variant = process.env.V ?? "both";
  for (const s of samples) {
    const sig0 = Math.max(0.6, PROD_SIGMA[band(s.leadH)]);
    let mu = muOf(s);
    let sig = sig0;
    if (s.e3 != null && variant !== "max") mu += (fit[lb(s.leadH)] ?? 0) * (s.e3 - (cityMeanE[s.city] ?? 0)) * scale(s);
    s.p2 = probs(s, mu, sig * scale(s));
    if (s.omax != null && variant !== "err") {
      const floor = toUnit(s, s.omax);
      const lo = floor - 0.5 * scale(s);
      const raw = s.buckets.map(({ range: [a, b] }, i) => (b < lo ? 0 : s.p2[i]));
      const tot = raw.reduce((x, y) => x + y, 0);
      if (tot > 0) s.p2 = raw.map((x) => Math.min(0.995, Math.max(0.002, x / tot)));
    }
  }
  const ll = (list, f) => mean(list.map((s) => -Math.log(Math.max(1e-3, f(s)[s.winIdx]))));
  for (const [name, sel] of [["train aug", (s) => s.day < SPLIT], ["test sep", (s) => s.day >= SPLIT && s.day < 269], ["late 26-28", (s) => s.day >= 269]]) {
    const l = samples.filter(sel);
    console.log(name.padEnd(11), "logloss wn3", ll(l, (s) => s.p).toFixed(3), "wn3+obs", ll(l, (s) => s.p2).toFixed(3), "mkt", ll(l, (s) => s.market).toFixed(3));
  }
  const sim = (list, prob) => {
    const out = [], seen = new Set();
    for (const s of [...list].sort((a, b) => a.t - b.t)) s.buckets.forEach((b, i) => {
      const key = s.city + "|" + s.day + "|" + i;
      if (seen.has(key)) return;
      const pm = s.market[i], pw = prob(s)[i];
      if (pm < 0.03 || pm > 0.97) return;
      const sp = spreadAt(s.leadH, pm);
      if (sp > 0.03) return;
      const yes = pm + sp / 2;
      if (pw - yes - fee(yes) < 0.2) return;
      seen.add(key);
      let exit = null;
      for (const x of b.h) {
        const tt = x.t * 1000;
        if (tt <= s.t) continue;
        if (tt >= Math.min(s.closeT, s.dayStart + 86400e3)) break;
        const hs = spreadAt((s.dayStart - tt) / 3600e3, x.p) / 2;
        if (x.p - hs >= pw) { exit = x.p - hs; break; }
        if (x.p + hs <= yes - 0.2) { exit = Math.max(0, x.p - hs - 0.08); break; }
      }
      const val = exit ?? (b.win ? 1 : 0);
      out.push({ key, day: s.day, lead: s.leadH, ret: (val - (exit === null ? 0 : fee(val)) - yes - fee(yes)) / (yes + fee(yes)) });
    });
    return out;
  };
  const rep = (label, tr) => {
    const d = {}; for (const t of tr) (d[t.day] ??= []).push(t.ret);
    const dm = Object.values(d).map(mean);
    return `${label.padEnd(12)} n ${String(tr.length).padStart(5)} ret ${(100 * mean(tr.map((t) => t.ret))).toFixed(0).padStart(5)}% total $${(5 * tr.reduce((a, t) => a + t.ret, 0)).toFixed(0).padStart(5)} losingDays ${dm.filter((x) => x < 0).length}/${dm.length} worstDay ${(100 * Math.min(...dm)).toFixed(0)}%`;
  };
  for (const [name, sel] of [["TRAIN aug", (s) => s.day < SPLIT], ["TEST sep", (s) => s.day >= SPLIT && s.day < 269], ["LATE 26-28", (s) => s.day >= 269]]) {
    const l = samples.filter(sel);
    const a = sim(l, (s) => s.p), b = sim(l, (s) => s.p2);
    const bk = new Set(b.map((t) => t.key)), ak = new Set(a.map((t) => t.key));
    console.log(`\n${name}\n  ${rep("wn3 only", a)}\n  ${rep("wn3+obs", b)}\n  ${rep(" dropped", a.filter((t) => !bk.has(t.key)))}\n  ${rep(" added", b.filter((t) => !ak.has(t.key)))}\n  ${rep(" kept", a.filter((t) => bk.has(t.key)))}`);
    for (const lbName of ["onday", "0-12", "12-24"]) console.log(`    ${lbName.padEnd(6)} ${rep("wn3", a.filter((t) => lb(t.lead) === lbName))} | ${rep("+obs", b.filter((t) => lb(t.lead) === lbName))}`);
  }
}

if (which === "model2") {
  build({ bias: "prod" });
  const SPLIT = +(process.env.SPLIT ?? 244);
  const muOf = (s) => toUnit(s, s.fmaxC) + (PROD_BIAS[s.city] ?? PROD_BIAS.g) * scale(s);
  const groups = {};
  for (const s of samples) (groups[s.city + "|" + s.day] ??= []).push(s);
  for (const g of Object.values(groups)) g.sort((a, b) => a.t - b.t);
  const resC = (s, mu) => (s.actual - mu) / scale(s);
  const variants = {
    base: { lag: 0, citySig: false },
    lag3h: { lag: 3, citySig: false },
    lag6h: { lag: 6, citySig: false },
    lag12h: { lag: 12, citySig: false },
    citySig: { lag: 0, citySig: true },
    "lag6h+citySig": { lag: 6, citySig: true },
  };
  const results = {};
  for (const [vname, v] of Object.entries(variants)) {
    for (const g of Object.values(groups)) for (const s of g) {
      const win = g.filter((x) => x.t <= s.t && x.t >= s.t - v.lag * 3600e3);
      s.muV = mean(win.map(muOf));
    }
    const sigCity = {};
    if (v.citySig) {
      const by = {};
      for (const s of samples) if (s.day < SPLIT && s.actual != null) (by[s.city] ??= []).push(resC(s, s.muV));
      for (const [c, a] of Object.entries(by)) { const m = mean(a); sigCity[c] = Math.sqrt(mean(a.map((x) => (x - m) ** 2))); }
      const all = Object.values(by).flat(); const m = mean(all); sigCity.g = Math.sqrt(mean(all.map((x) => (x - m) ** 2)));
    }
    for (const s of samples) {
      let sig = Math.max(0.6, PROD_SIGMA[band(s.leadH)]);
      if (v.citySig) sig = Math.max(0.6, sig * (0.5 + 0.5 * (sigCity[s.city] ?? sigCity.g) / sigCity.g));
      s.pv = probs(s, s.muV, sig * scale(s));
    }
    const ll = (list) => mean(list.map((s) => -Math.log(Math.max(1e-3, s.pv[s.winIdx]))));
    const tradeSet = (list) => {
      const out = [], seen = new Set();
      for (const s of [...list].sort((a, b) => a.t - b.t)) s.buckets.forEach((b, i) => {
        const key = s.city + "|" + s.day + "|" + i;
        if (seen.has(key)) return;
        const pm = s.market[i], pw = s.pv[i];
        if (pm < 0.03 || pm > 0.97) return;
        const sp = spreadAt(s.leadH, pm);
        if (sp > 0.03) return;
        const yes = pm + sp / 2;
        if (pw - yes - fee(yes) < 0.2) return;
        seen.add(key);
        let exit = null;
        for (const x of b.h) {
          const tt = x.t * 1000;
          if (tt <= s.t) continue;
          if (tt >= Math.min(s.closeT, s.dayStart + 86400e3)) break;
          const hs = spreadAt((s.dayStart - tt) / 3600e3, x.p) / 2;
          if (x.p - hs >= pw) { exit = x.p - hs; break; }
          if (x.p + hs <= yes - 0.2) { exit = Math.max(0, x.p - hs - 0.08); break; }
        }
        const val = exit ?? (b.win ? 1 : 0);
        out.push({ day: s.day, ret: (val - (exit === null ? 0 : fee(val)) - yes - fee(yes)) / (yes + fee(yes)) });
      });
      return out;
    };
    const cells = [["aug", (s) => s.day < SPLIT], ["sep", (s) => s.day >= SPLIT && s.day < 269], ["late", (s) => s.day >= 269]].map(([n, f]) => {
      const l = samples.filter(f), tr = tradeSet(l);
      const d = {}; for (const t of tr) (d[t.day] ??= []).push(t.ret);
      const dm = Object.values(d).map(mean);
      return `${n} ll ${ll(l).toFixed(3)} n ${String(tr.length).padStart(4)} ret ${(100 * mean(tr.map((t) => t.ret))).toFixed(0).padStart(4)}% $${(5 * tr.reduce((a, t) => a + t.ret, 0)).toFixed(0).padStart(5)} worstDay ${(100 * Math.min(...dm)).toFixed(0).padStart(4)}%`;
    });
    console.log(vname.padEnd(15), cells.join(" | "));
  }
}

if (which === "flip") {
  build({ bias: "prod" });
  const SPLIT = +(process.env.SPLIT ?? 244);
  const byKey = {};
  for (const s of samples) (byKey[s.city + "|" + s.day] ??= []).push(s);
  for (const g of Object.values(byKey)) g.sort((a, b) => a.t - b.t);
  if (process.env.LAG) {
    const lag = +process.env.LAG;
    const muOf = (s) => toUnit(s, s.fmaxC) + (PROD_BIAS[s.city] ?? PROD_BIAS.g) * scale(s);
    for (const g of Object.values(byKey)) for (const s of g) s.muV = mean(g.filter((x) => x.t <= s.t && x.t >= s.t - lag * 3600e3).map(muOf));
    const by = {};
    for (const s of samples) if (s.day < SPLIT && s.actual != null) (by[s.city] ??= []).push((s.actual - s.muV) / scale(s));
    const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
    const gsd = sd(Object.values(by).flat());
    for (const s of samples) {
      let sig = Math.max(0.6, PROD_SIGMA[band(s.leadH)]);
      if (process.env.CITYSIG) sig = Math.max(0.6, sig * (0.5 + 0.5 * (by[s.city] ? sd(by[s.city]) : gsd) / gsd));
      s.p = probs(s, s.muV, sig * scale(s));
    }
  }
  const rules = {
    base: () => false,
    "q < bid": (q, bid) => q < bid,
    "q < entry": (q, bid, entry) => q < entry,
    "q < entry+.05": (q, bid, entry) => q < entry + 0.05,
    "q < half pw0": (q, bid, entry, pw0) => q < 0.5 * pw0,
  };
  for (const [period, sel] of [["aug", (s) => s.day < SPLIT], ["sep", (s) => s.day >= SPLIT && s.day < 269], ["late", (s) => s.day >= 269 && s.day < 272], ...[...new Set(samples.filter((s) => s.day >= 269).map((s) => s.day))].sort().map((d) => ["day " + d, (s) => s.day === d])]) {
    const list = samples.filter(sel).sort((a, b) => a.t - b.t);
    const line = [];
    for (const [rname, rule] of Object.entries(rules)) {
      const out = [], seen = new Set();
      for (const s of list) {
        const g = byKey[s.city + "|" + s.day];
        s.buckets.forEach((b, i) => {
          const key = s.city + "|" + s.day + "|" + i;
          if (seen.has(key)) return;
          const pm = s.market[i], pw = s.p[i];
          if (pm < 0.03 || pm > 0.97) return;
          const sp = spreadAt(s.leadH, pm);
          if (sp > 0.03) return;
          const yes = pm + sp / 2;
          if (pw - yes - fee(yes) < 0.2) return;
          seen.add(key);
          let exit = null, how = "RES", q = pw, j = g.indexOf(s) + 1;
          for (const x of b.h) {
            const tt = x.t * 1000;
            if (tt <= s.t) continue;
            if (tt >= Math.min(s.closeT, s.dayStart + 86400e3)) break;
            let fresh = false;
            while (j < g.length && g[j].t <= tt) { q = g[j++].p[i]; fresh = true; }
            const hs = spreadAt((s.dayStart - tt) / 3600e3, x.p) / 2;
            if (x.p - hs >= pw) { exit = x.p - hs; how = "TP"; break; }
            if (x.p + hs <= yes - 0.2) { exit = Math.max(0, x.p - hs - 0.08); how = "SL"; break; }
            if (fresh && rule(q, x.p - hs, yes, pw)) { exit = Math.max(0, x.p - hs); how = "FLIP"; break; }
          }
          const val = exit ?? (b.win ? 1 : 0);
          out.push({ day: s.day, how, win: b.win, ret: (val - (exit === null ? 0 : fee(val)) - yes - fee(yes)) / (yes + fee(yes)) });
        });
      }
      const d = {}; for (const t of out) (d[t.day] ??= []).push(t.ret);
      const dm = Object.values(d).map(mean);
      const flips = out.filter((t) => t.how === "FLIP");
      line.push(`  ${rname.padEnd(14)} n ${String(out.length).padStart(4)} ret ${(100 * mean(out.map((t) => t.ret))).toFixed(0).padStart(4)}% $${(5 * out.reduce((a, t) => a + t.ret, 0)).toFixed(0).padStart(5)} worstDay ${(100 * Math.min(...dm)).toFixed(0).padStart(4)}% flips ${String(flips.length).padStart(4)} (would have won ${flips.filter((t) => t.win).length})`);
    }
    console.log(period + "\n" + line.join("\n"));
  }
}

if (which === "drift") {
  build({ bias: "prod" });
  const muOf = (s) => toUnit(s, s.fmaxC) + (PROD_BIAS[s.city] ?? PROD_BIAS.g) * scale(s);
  const last = {};
  for (const s of samples) { if (s.actual == null || s.leadH < 0 || s.leadH > 24) continue; const k = s.city + "|" + s.day; if (!last[k] || s.t > last[k].t) last[k] = s; }
  const wk = (d) => d < 244 ? "Aug " + (Math.floor((d - 213) / 7) + 1) : d < 269 ? "Sep " + (Math.floor((d - 244) / 7) + 1) : "Sep26+ d" + d;
  const g = {};
  for (const s of Object.values(last)) (g[wk(s.day)] ??= []).push(s);
  console.log("period          n   rawResid(act-fmax)C  afterBias  |WN3 err|  |mkt err|  WN3 closer%  gap(mu-mkt)  WN3 warmer than mkt%");
  for (const [k, a] of Object.entries(g).sort((x, y) => Math.min(...x[1].map((s) => s.day)) - Math.min(...y[1].map((s) => s.day)))) {
    const raw = a.map((s) => (s.actual - toUnit(s, s.fmaxC)) / scale(s));
    const adj = a.map((s) => (s.actual - muOf(s)) / scale(s));
    const em = a.map((s) => (s.actual - expect(s, s.market)) / scale(s));
    const closer = a.filter((s, i) => Math.abs(adj[i]) < Math.abs(em[i])).length / a.length;
    const gap = a.map((s) => (muOf(s) - expect(s, s.market)) / scale(s));
    console.log(k.padEnd(14), String(a.length).padStart(4), mean(raw).toFixed(2).padStart(10), mean(adj).toFixed(2).padStart(18), mean(adj.map(Math.abs)).toFixed(2).padStart(10), mean(em.map(Math.abs)).toFixed(2).padStart(10), (100 * closer).toFixed(0).padStart(10), mean(gap).toFixed(2).padStart(12), (100 * gap.filter((x) => x > 0).length / gap.length).toFixed(0).padStart(14));
  }
}

if (which === "regime") {
  build({ bias: "prod" });
  const byKey = {};
  for (const s of samples) (byKey[s.city + "|" + s.day] ??= []).push(s);
  for (const g of Object.values(byKey)) g.sort((a, b) => a.t - b.t);
  const LAGH = +(process.env.LAG ?? 3);
  for (const g of Object.values(byKey)) for (const s of g) s.fLag = mean(g.filter((x) => x.t <= s.t && x.t >= s.t - LAGH * 3600e3).map((x) => x.fmaxC));
  const ladders = [];
  for (const [k, g] of Object.entries(byKey)) {
    const s0 = g[0];
    if (s0.actual == null) continue;
    const pre = g.filter((x) => x.t < s0.dayStart);
    const ref = (pre.length ? pre : g).at(-1);
    ladders.push({ city: s0.city, closeT: s0.closeT, r: (s0.actual - toUnit(s0, ref.fLag)) / scale(s0) });
  }
  ladders.sort((a, b) => a.closeT - b.closeT);
  const TG = +(process.env.TG ?? 4) * 86400e3, TC = +(process.env.TC ?? 21) * 86400e3, K = +(process.env.K ?? 4);
  const biasCache = new Map();
  const adaptiveBias = (city, t) => {
    const key = city + "|" + Math.floor(t / 3600e3);
    if (biasCache.has(key)) return biasCache.get(key);
    let gw = 0, gs = 0;
    for (const l of ladders) { if (l.closeT >= t) break; const w = Math.exp(-(t - l.closeT) / TG); gw += w; gs += w * l.r; }
    const G = gw > 0 ? gs / (gw + 2) + (2 / (gw + 2)) * 0.6 : 0.6;
    let cw = 0, cs = 0;
    for (const l of ladders) { if (l.closeT >= t) break; if (l.city !== city) continue; const w = Math.exp(-(t - l.closeT) / TC); cw += w; cs += w * (l.r - G); }
    const b = G + (cw > 0 ? cs / (cw + K) : 0);
    biasCache.set(key, b);
    return b;
  };
  const byRun = {};
  for (const s of samples) (byRun[s.t] ??= []).push(s);
  const variants = {
    "current (seeded city bias)": { bias: "prod", common: false },
    "adaptive bias": { bias: "adaptive", common: false },
    "seeded + common-mode removal": { bias: "prod", common: true },
    "adaptive + common-mode removal": { bias: "adaptive", common: true },
  };
  const periods = [["aug(8+)", (s) => s.day >= 213 && s.day < 244], ["sep", (s) => s.day >= 244 && s.day < 269], ["sep26-oct2", (s) => s.day >= 269]];
  for (const [vname, v] of Object.entries(variants)) {
    for (const s of samples) {
      const b = v.bias === "prod" ? PROD_BIAS[s.city] ?? PROD_BIAS.g : adaptiveBias(s.city, s.t);
      s.muR = toUnit(s, s.fLag) + b * scale(s);
    }
    if (v.common) {
      for (const g of Object.values(byRun)) {
        const gaps = g.map((s) => (s.muR - expect(s, s.market)) / scale(s));
        const m = mean(gaps);
        for (const s of g) s.muR -= m * scale(s);
      }
    }
    for (const s of samples) s.pR = probs(s, s.muR, Math.max(0.6, PROD_SIGMA[band(s.leadH)]) * scale(s));
    const line = [];
    const daily = [];
    for (const [pname, sel] of periods) {
      const list = samples.filter(sel).sort((a, b) => a.t - b.t);
      const out = [], seen = new Set();
      for (const s of list) {
        const g = byKey[s.city + "|" + s.day];
        s.buckets.forEach((b, i) => {
          const key = s.city + "|" + s.day + "|" + i;
          if (seen.has(key)) return;
          const pm = s.market[i], pw = s.pR[i];
          if (pm < 0.03 || pm > 0.97) return;
          const sp = spreadAt(s.leadH, pm);
          if (sp > 0.03) return;
          const yes = pm + sp / 2;
          if (pw - yes - fee(yes) < 0.2) return;
          seen.add(key);
          let exit = null, exitAt = null, q = pw, j = g.indexOf(s) + 1;
          for (const x of b.h) {
            const tt = x.t * 1000;
            if (tt <= s.t) continue;
            if (tt >= Math.min(s.closeT, s.dayStart + 86400e3)) break;
            let fresh = false;
            while (j < g.length && g[j].t <= tt) { q = g[j++].pR[i]; fresh = true; }
            const hs = spreadAt((s.dayStart - tt) / 3600e3, x.p) / 2;
            if (x.p - hs >= yes + (+(process.env.TPK ?? 1)) * (pw - yes)) { exit = x.p - hs; exitAt = tt; break; }
            if (x.p + hs <= yes - 0.2) { exit = Math.max(0, x.p - hs - 0.08); exitAt = tt; break; }
            if (fresh && q < x.p - hs) { exit = Math.max(0, x.p - hs); exitAt = tt; break; }
          }
          const val = exit ?? (b.win ? 1 : 0);
          out.push({ day: s.day, t: s.t, city: s.city, entry: yes, pw, leadH: s.leadH, closedAt: exitAt ?? s.closeT, how: exit === null ? "RES" : "EXIT", win: b.win ? 1 : 0, ret: (val - (exit === null ? 0 : fee(val)) - yes - fee(yes)) / (yes + fee(yes)) });
        });
      }
      if (process.env.EXPORT === vname) (globalThis.EXP ??= []).push(...out);
      const d = {}; for (const t of out) (d[t.day] ??= []).push(t.ret);
      const dm = Object.values(d).map(mean);
      const ll = mean(list.map((s) => -Math.log(Math.max(1e-3, s.pR[s.winIdx]))));
      line.push(`${pname} ll ${ll.toFixed(3)} n ${String(out.length).padStart(4)} ret ${(100 * mean(out.map((t) => t.ret))).toFixed(0).padStart(4)}% $${(5 * out.reduce((a, t) => a + t.ret, 0)).toFixed(0).padStart(5)} lose ${dm.filter((x) => x < 0).length}/${dm.length}`);
      if (pname === "sep26-oct2") for (const [dd, a] of Object.entries(d).sort()) daily.push(`${dd}:${(100 * mean(a)).toFixed(0)}%(${a.length})`);
    }
    console.log(vname.padEnd(32), line.join(" | "));
    if (process.env.EXPORT === vname) fs.writeFileSync(process.env.OUT, JSON.stringify(globalThis.EXP));
    console.log("".padEnd(32), "daily", daily.join(" "));
  }
}

if (which === "react") {
  build({ bias: "prod" });
  const wk = (d) => d < 244 ? "Aug" : d < 262 ? "Sep 1-18" : d < 269 ? "Sep 19-25" : d < 272 ? "Sep 26-28" : "Sep29-Oct2";
  const g = {};
  for (const s of samples) {
    const t0 = s.t - EE_LAG;
    s.buckets.forEach((b, i) => {
      const pm = s.market[i], pw = s.p[i];
      const d = pw - pm;
      if (Math.abs(d) < 0.15 || pm < 0.03 || pm > 0.6) return;
      const sgn = Math.sign(d);
      const at = (dt) => priceAt(b.h, t0 + dt * 60e3);
      const p0 = at(0), pPre = at(-60), p30 = at(30), p120 = at(120), p360 = at(360);
      if ([p0, pPre, p30, p120, p360].some((x) => x == null)) return;
      (g[wk(s.day)] ??= []).push({ pre: sgn * (p0 - pPre), m30: sgn * (p30 - p0), m120: sgn * (p120 - p0), m360: sgn * (p360 - p0) });
    });
  }
  console.log("period        n     move toward WN3 (pts): 60m BEFORE release | 0-30m after | 0-2h after | 0-6h after");
  for (const k of ["Aug", "Sep 1-18", "Sep 19-25", "Sep 26-28", "Sep29-Oct2"]) {
    const a = g[k] ?? [];
    console.log(k.padEnd(12), String(a.length).padStart(6), ["pre", "m30", "m120", "m360"].map((f) => (100 * mean(a.map((x) => x[f]))).toFixed(2).padStart(10)).join("  "));
  }
}

if (which === "skill") {
  build({ bias: "prod" });
  const byKey = {};
  for (const s of samples) (byKey[s.city + "|" + s.day] ??= []).push(s);
  const out = [];
  for (const g of Object.values(byKey)) {
    g.sort((a, b) => a.t - b.t);
    const s0 = g[0];
    if (s0.actual == null) continue;
    const pre = g.filter((x) => x.t < s0.dayStart && x.t >= s0.dayStart - 24 * 3600e3);
    if (!pre.length) continue;
    const errW = mean(pre.map((s) => { const lagged = g.filter((x) => x.t <= s.t && x.t >= s.t - 3 * 3600e3); const mu = toUnit(s, mean(lagged.map((x) => x.fmaxC))) + (PROD_BIAS[s.city] ?? PROD_BIAS.g) * scale(s); return Math.abs(s.actual - mu) / scale(s); }));
    const errM = mean(pre.map((s) => Math.abs(s.actual - expect(s, s.market)) / scale(s)));
    const llW = mean(pre.map((s) => -Math.log(Math.max(1e-3, s.p[s.winIdx]))));
    const llM = mean(pre.map((s) => -Math.log(Math.max(1e-3, s.market[s.winIdx]))));
    out.push({ city: s0.city, day: s0.day, closeT: s0.closeT, errW, errM, llW, llM });
  }
  fs.writeFileSync(process.env.OUT, JSON.stringify(out));
  console.log("ladders", out.length);
}

if (which === "far") {
  build({ bias: "prod" });
  const byKey = {};
  for (const s of samples) (byKey[s.city + "|" + s.day] ??= []).push(s);
  for (const g of Object.values(byKey)) { g.sort((a, b) => a.t - b.t); for (const s of g) { const lag = g.filter((x) => x.t <= s.t && x.t >= s.t - 3 * 3600e3); s.pL = probs(s, toUnit(s, mean(lag.map((x) => x.fmaxC))) + (PROD_BIAS[s.city] ?? PROD_BIAS.g) * scale(s), Math.max(0.6, PROD_SIGMA[band(s.leadH)]) * scale(s)); } }
  const P = [["Aug backfill", (d) => d < 239], ["Aug27-Sep25", (d) => d >= 239 && d < 269], ["Sep26-Oct2", (d) => d >= 269]];
  for (const [lo, hi] of [[0, 12], [12, 18], [18, 24], [24, 36], [36, 60]]) {
    const cells = P.map(([pn, pf]) => {
      const seen = new Set(), out = [];
      for (const s of [...samples].sort((a, b) => a.t - b.t)) {
        if (!pf(s.day) || s.leadH < lo || s.leadH >= hi) continue;
        s.buckets.forEach((b, i) => {
          const k = s.city + s.day + i; if (seen.has(k)) return;
          const pm = s.market[i]; if (pm < 0.03 || pm > 0.6) return;
          if (s.pL[i] - pm < 0.2) return;
          seen.add(k);
          const win = b.win ? 1 : 0;
          const later = (h) => priceAt(b.h, s.t + h * 3600e3);
          const best = Math.max(...b.h.filter((x) => x.t * 1000 > s.t && x.t * 1000 < s.dayStart + 86400e3).map((x) => x.p), pm);
          out.push({ pm, win, ret: (win - pm) / pm, tp: best >= s.pL[i] - 0.01 ? 1 : 0 });
        });
      }
      return `n ${String(out.length).padStart(4)} avgMid ${(100 * mean(out.map((x) => x.pm))).toFixed(1).padStart(4)}c win ${(100 * mean(out.map((x) => x.win))).toFixed(0).padStart(3)}% holdAtMid ${(100 * mean(out.map((x) => x.ret))).toFixed(0).padStart(4)}% reachesModel ${(100 * mean(out.map((x) => x.tp))).toFixed(0).padStart(3)}%`;
    });
    console.log(`lead ${lo}-${hi}h`.padEnd(12), cells.join(" | "));
  }
}

if (which === "skew") {
  build({ bias: "prod" });
  const SPLIT = 239;
  const muOf = (s) => toUnit(s, s.fmaxC) + (PROD_BIAS[s.city] ?? PROD_BIAS.g) * scale(s);
  const ok = samples.filter((s) => Number.isFinite(s.q10) && Number.isFinite(s.q90) && s.q90 > s.q10);
  const tr = ok.filter((s) => s.day < SPLIT && s.actual != null);
  const z = (s) => (s.actual - muOf(s)) / scale(s);
  const lowW = (s) => Math.max(0.05, s.fmaxC - s.q10), highW = (s) => Math.max(0.05, s.q90 - s.fmaxC);
  console.log("median daily-max quantile half-widths C: low", [...ok.map(lowW)].sort((a, b) => a - b)[ok.length >> 1].toFixed(2), "high", [...ok.map(highW)].sort((a, b) => a - b)[ok.length >> 1].toFixed(2));
  const skewTerc = (s) => (highW(s) - lowW(s)) / (highW(s) + lowW(s));
  const sorted = [...tr].sort((a, b) => skewTerc(a) - skewTerc(b));
  for (let k = 0; k < 4; k++) { const g = sorted.slice((k * sorted.length) / 4, ((k + 1) * sorted.length) / 4); console.log(`skew quartile ${k + 1} (${skewTerc(g[0]).toFixed(2)}..${skewTerc(g.at(-1)).toFixed(2)}): mean resid ${mean(g.map(z)).toFixed(2)}C  sd ${Math.sqrt(mean(g.map((s) => (z(s) - mean(g.map(z))) ** 2))).toFixed(2)}`); }
  const wSorted = [...tr].sort((a, b) => lowW(a) + highW(a) - lowW(b) - highW(b));
  for (let k = 0; k < 4; k++) { const g = wSorted.slice((k * wSorted.length) / 4, ((k + 1) * wSorted.length) / 4); const m = mean(g.map(z)); console.log(`width quartile ${k + 1} (${(lowW(g[0]) + highW(g[0])).toFixed(2)}..${(lowW(g.at(-1)) + highW(g.at(-1))).toFixed(2)}C): resid sd ${Math.sqrt(mean(g.map((s) => (z(s) - m) ** 2))).toFixed(2)} mean ${m.toFixed(2)}`); }
  const split = (s, mu, sl, sh) => {
    const raw = s.buckets.map(({ range: [lo, hi] }) => { const cdf = (x) => (x < mu ? 2 * sl / (sl + sh) * Phi((x - mu) / sl) : sl / (sl + sh) + 2 * sh / (sl + sh) * (Phi((x - mu) / sh) - 0.5)); return cdf(hi) - cdf(lo); });
    const tot = raw.reduce((a, b) => a + b, 0);
    return raw.map((p) => Math.min(0.995, Math.max(0.002, p / tot)));
  };
  const base = (s) => Math.max(0.6, PROD_SIGMA[band(s.leadH)]);
  const variants = {
    "current symmetric": (s) => s.p,
    "split-normal, mean width = current": (s) => { const k = base(s) * 2 / ((lowW(s) + highW(s)) / 1.2816); return split(s, muOf(s), Math.max(0.3, k * lowW(s) / 1.2816) * scale(s), Math.max(0.3, k * highW(s) / 1.2816) * scale(s)); },
    "flow width 50/50 + skew": (s) => { const w = (lowW(s) + highW(s)) / 2 / 1.2816; const sig = Math.max(0.6, 0.5 * base(s) + 0.5 * w * base(s) / 0.55); const r = highW(s) / (lowW(s) + highW(s)); return split(s, muOf(s), sig * 2 * (1 - r) * scale(s), sig * 2 * r * scale(s)); },
  };
  const ll = (list, f) => mean(list.map((s) => -Math.log(Math.max(1e-3, f(s)[s.winIdx]))));
  for (const [n, f] of Object.entries(variants)) console.log(n.padEnd(36), [["backfill", (s) => s.day < SPLIT], ["realtime Aug27-Sep25", (s) => s.day >= SPLIT && s.day < 269], ["Sep26-Oct2", (s) => s.day >= 269]].map(([p, g]) => `${p} ll ${ll(ok.filter(g), f).toFixed(4)}`).join(" | "));
}

if (which === "width") {
  build({ bias: "prod" });
  const SPLIT = +(process.env.SPLIT ?? 239);
  const byKey = {};
  for (const s of samples) (byKey[s.city + "|" + s.day] ??= []).push(s);
  for (const g of Object.values(byKey)) { g.sort((a, b) => a.t - b.t); for (const s of g) { const lag = g.filter((x) => x.t <= s.t && x.t >= s.t - 3 * 3600e3 && Number.isFinite(x.q10) && Number.isFinite(x.q90)); s.fL = mean(g.filter((x) => x.t <= s.t && x.t >= s.t - 3 * 3600e3).map((x) => x.fmaxC)); s.W = lag.length ? mean(lag.map((x) => x.q90 - x.q10)) : null; } }
  const muOf = (s) => toUnit(s, s.fL) + (PROD_BIAS[s.city] ?? PROD_BIAS.g) * scale(s);
  const ok = samples.filter((s) => s.W != null);
  const tr = ok.filter((s) => s.day < SPLIT && s.actual != null);
  const r = (s) => (s.actual - muOf(s)) / scale(s);
  const lin = (xs, ys) => { const mx = mean(xs), my = mean(ys); const b = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0); return [my - b * mx, b]; };
  const [g0, g1] = lin(tr.map((s) => s.W), tr.map(r));
  const [s0, s1] = lin(tr.map((s) => s.W), tr.map((s) => Math.abs(r(s) - (g0 + g1 * s.W)) * Math.sqrt(Math.PI / 2)));
  console.log(`fit on day<${SPLIT}: shift = ${g0.toFixed(3)} + ${g1.toFixed(3)}*W   sigma = ${s0.toFixed(3)} + ${s1.toFixed(3)}*W   (W = q90max - q10max, C)`);
  const PV = {
    current: (s) => probs(s, muOf(s), Math.max(0.6, PROD_SIGMA[band(s.leadH)]) * scale(s)),
    "width sigma only": (s) => probs(s, muOf(s), Math.max(0.6, s0 + s1 * s.W) * scale(s)),
    "width sigma + shift": (s) => probs(s, muOf(s) + (g0 + g1 * s.W) * scale(s), Math.max(0.6, s0 + s1 * s.W) * scale(s)),
  };
  const periods = [["backfill(train)", (s) => s.day < SPLIT], ["realtime Aug27-Sep25", (s) => s.day >= SPLIT && s.day < 269], ["Sep26-Oct2", (s) => s.day >= 269]];
  for (const [vn, pf] of Object.entries(PV)) {
    for (const s of ok) s.pV = pf(s);
    const cells = periods.map(([pn, sel]) => {
      const list = ok.filter(sel).sort((a, b) => a.t - b.t);
      const ll = mean(list.map((s) => -Math.log(Math.max(1e-3, s.pV[s.winIdx]))));
      const out = [], seen = new Set();
      for (const s of list) {
        if (s.leadH < 12) continue;
        const g = byKey[s.city + "|" + s.day].filter((x) => x.pV);
        s.buckets.forEach((b, i) => {
          const key = s.city + "|" + s.day + "|" + i;
          if (seen.has(key)) return;
          const pm = s.market[i], pw = s.pV[i];
          if (pm < 0.03 || pm > 0.97) return;
          const sp = spreadAt(s.leadH, pm);
          if (sp > 0.03) return;
          const yes = pm + sp / 2;
          if (pw - yes - fee(yes) < 0.2) return;
          seen.add(key);
          let exit = null, q = pw, j = g.indexOf(s) + 1;
          for (const x of b.h) {
            const tt = x.t * 1000;
            if (tt <= s.t) continue;
            if (tt >= Math.min(s.closeT, s.dayStart + 86400e3)) break;
            let fresh = false;
            while (j < g.length && g[j].t <= tt) { q = g[j++].pV[i]; fresh = true; }
            const hs = spreadAt((s.dayStart - tt) / 3600e3, x.p) / 2;
            if (x.p - hs >= pw) { exit = x.p - hs; break; }
            if (x.p + hs <= yes - 0.2) { exit = Math.max(0, x.p - hs - 0.08); break; }
            if (fresh && q < x.p - hs) { exit = Math.max(0, x.p - hs); break; }
          }
          const val = exit ?? (b.win ? 1 : 0);
          out.push({ day: s.day, ret: (val - (exit === null ? 0 : fee(val)) - yes - fee(yes)) / (yes + fee(yes)) });
        });
      }
      const d = {}; for (const t of out) (d[t.day] ??= []).push(t.ret);
      const dm = Object.values(d).map(mean);
      return `${pn} ll ${ll.toFixed(3)} n ${String(out.length).padStart(4)} ret ${(100 * mean(out.map((t) => t.ret))).toFixed(0).padStart(4)}% $${(5 * out.reduce((a, t) => a + t.ret, 0)).toFixed(0).padStart(5)} lose ${dm.filter((x) => x < 0).length}/${dm.length}`;
    });
    console.log(vn.padEnd(22), cells.join(" | "));
  }
}

if (which === "dew") {
  build({ bias: "prod" });
  const extra = {};
  for (const l of fs.readFileSync("ee-extra.jsonl", "utf8").trim().split("\n")) { const j = JSON.parse(l); extra[Date.parse(j.init)] = j.byCity; }
  const muOf = (s) => toUnit(s, s.fmaxC) + (PROD_BIAS[s.city] ?? PROD_BIAS.g) * scale(s);
  const rows = [];
  for (const s of samples) {
    const e = extra[s.init]?.[s.city];
    if (!e || s.actual == null) continue;
    const td = e.station_head_dewpoint_temperature_2m_mean, p50 = e.station_head_temperature_2m_p50, p25 = e.station_head_temperature_2m_p25, p75 = e.station_head_temperature_2m_p75;
    if (!td || td[s.iMax] == null || !p50) continue;
    let m50 = -Infinity, m25 = -Infinity, m75 = -Infinity, tdMean = 0, n = 0;
    for (let o = 0; o < p50.length; o++) {
      const vt = s.init + (o + 1) * 3600e3;
      if (vt >= s.dayStart && vt < s.dayStart + 86400e3) { if (p50[o] > m50) m50 = p50[o]; if (p25[o] > m25) m25 = p25[o]; if (p75[o] > m75) m75 = p75[o]; if (td[o] != null) { tdMean += td[o]; n++; } }
    }
    rows.push({ s, r: (s.actual - muOf(s)) / scale(s), dep: s.fmaxC - td[s.iMax], td: td[s.iMax], medGap: s.fmaxC - m50, iqr: m75 - m25, day: s.day, lead: s.leadH });
  }
  console.log("rows", rows.length);
  const q = (a, f, k) => { const b = [...a].sort((x, y) => f(x) - f(y)); return [0, 1, 2, 3].map((i) => b.slice((i * b.length) / k, ((i + 1) * b.length) / k)); };
  for (const [name, f] of [["dewpoint depression at max hour C", (x) => x.dep], ["dewpoint at max hour C", (x) => x.td], ["mean-max minus median-max C", (x) => x.medGap], ["IQR of daily max (p75-p25) C", (x) => x.iqr]]) {
    console.log(`\n${name}`);
    for (const half of [["Aug27-Sep12", (x) => x.day < 256], ["Sep13-Sep25", (x) => x.day >= 256 && x.day < 269], ["Sep26-Oct2", (x) => x.day >= 269]]) {
      const a = rows.filter(half[1]);
      console.log("  " + half[0].padEnd(12), q(a, f, 4).map((g) => `[${f(g[0]).toFixed(1)}..${f(g.at(-1)).toFixed(1)}] resid ${mean(g.map((x) => x.r)).toFixed(2).padStart(5)} sd ${Math.sqrt(mean(g.map((x) => (x.r - mean(g.map((y) => y.r))) ** 2))).toFixed(2)}`).join(" | "));
    }
  }
}

if (which === "median") {
  build({ bias: "prod" });
  const TRAIN_END = 256;
  const extra = {};
  for (const l of fs.readFileSync("ee-extra.jsonl", "utf8").trim().split("\n")) { const j = JSON.parse(l); extra[Date.parse(j.init)] = j.byCity; }
  const ok = [];
  for (const s of samples) {
    const e = extra[s.init]?.[s.city];
    if (!e?.station_head_temperature_2m_p50) continue;
    let m50 = -Infinity, m25 = -Infinity, m75 = -Infinity, n = 0;
    const p50 = e.station_head_temperature_2m_p50, p25 = e.station_head_temperature_2m_p25, p75 = e.station_head_temperature_2m_p75;
    for (let o = 0; o < p50.length; o++) { const vt = s.init + (o + 1) * 3600e3; if (vt >= s.dayStart && vt < s.dayStart + 86400e3 && p50[o] != null) { n++; m50 = Math.max(m50, p50[o]); m25 = Math.max(m25, p25[o]); m75 = Math.max(m75, p75[o]); } }
    if (n < 24) continue;
    s.m50 = m50; s.iqr = m75 - m25; ok.push(s);
  }
  const byKey = {};
  for (const s of ok) (byKey[s.city + "|" + s.day] ??= []).push(s);
  for (const g of Object.values(byKey)) { g.sort((a, b) => a.t - b.t); for (const s of g) { const lag = g.filter((x) => x.t <= s.t && x.t >= s.t - 3 * 3600e3); s.fL = mean(lag.map((x) => x.fmaxC)); s.mL = mean(lag.map((x) => x.m50)); s.iL = mean(lag.map((x) => x.iqr)); } }
  const cb = (s) => PROD_BIAS[s.city] ?? PROD_BIAS.g;
  const tr = ok.filter((s) => s.day < TRAIN_END && s.actual != null);
  const lin = (xs, ys) => { const mx = mean(xs), my = mean(ys); const b = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0); return [my - b * mx, b]; };
  const medOffset = mean(tr.map((s) => (s.actual - toUnit(s, s.mL)) / scale(s) - cb(s))) ;
  const rMed = (s) => (s.actual - toUnit(s, s.mL)) / scale(s) - cb(s) - medOffset;
  const [a0, a1] = lin(tr.map((s) => s.iL), tr.map((s) => Math.abs(rMed(s)) * Math.sqrt(Math.PI / 2)));
  const rMean = (s) => (s.actual - toUnit(s, s.fL)) / scale(s) - cb(s);
  const [b0, b1] = lin(tr.map((s) => s.iL), tr.map((s) => Math.abs(rMean(s) - mean(tr.map(rMean))) * Math.sqrt(Math.PI / 2)));
  console.log(`fit Aug27-Sep12: median offset ${medOffset.toFixed(3)}C; sigma(median) = ${a0.toFixed(3)} + ${a1.toFixed(3)}*IQR; sigma(mean) = ${b0.toFixed(3)} + ${b1.toFixed(3)}*IQR`);
  const PV = {
    "current (mean, lead sigma)": (s) => probs(s, toUnit(s, s.fL) + cb(s) * scale(s), Math.max(0.6, PROD_SIGMA[band(s.leadH)]) * scale(s)),
    "median center, lead sigma": (s) => probs(s, toUnit(s, s.mL) + (cb(s) + medOffset) * scale(s), Math.max(0.6, PROD_SIGMA[band(s.leadH)]) * scale(s)),
    "mean center, IQR sigma": (s) => probs(s, toUnit(s, s.fL) + cb(s) * scale(s), Math.max(0.6, b0 + b1 * s.iL) * scale(s)),
    "median center, IQR sigma": (s) => probs(s, toUnit(s, s.mL) + (cb(s) + medOffset) * scale(s), Math.max(0.6, a0 + a1 * s.iL) * scale(s)),
  };
  const periods = [["train Aug27-Sep12", (s) => s.day < TRAIN_END], ["test Sep13-25", (s) => s.day >= TRAIN_END && s.day < 269], ["test Sep26-Oct2", (s) => s.day >= 269]];
  for (const [vn, pf] of Object.entries(PV)) {
    for (const s of ok) s.pV = pf(s);
    const cells = periods.map(([pn, sel]) => {
      const list = ok.filter(sel).sort((a, b) => a.t - b.t);
      const ll = mean(list.map((s) => -Math.log(Math.max(1e-3, s.pV[s.winIdx]))));
      const out = [], seen = new Set();
      for (const s of list) {
        if (s.leadH < 12) continue;
        const g = byKey[s.city + "|" + s.day];
        s.buckets.forEach((b, i) => {
          const key = s.city + "|" + s.day + "|" + i;
          if (seen.has(key)) return;
          const pm = s.market[i], pw = s.pV[i];
          if (pm < 0.03 || pm > 0.97) return;
          const sp = spreadAt(s.leadH, pm);
          if (sp > 0.03) return;
          const yes = pm + sp / 2;
          if (pw - yes - fee(yes) < 0.2) return;
          seen.add(key);
          let exit = null, q = pw, j = g.indexOf(s) + 1;
          for (const x of b.h) {
            const tt = x.t * 1000;
            if (tt <= s.t) continue;
            if (tt >= Math.min(s.closeT, s.dayStart + 86400e3)) break;
            let fresh = false;
            while (j < g.length && g[j].t <= tt) { q = g[j++].pV[i]; fresh = true; }
            const hs = spreadAt((s.dayStart - tt) / 3600e3, x.p) / 2;
            if (x.p - hs >= pw) { exit = x.p - hs; break; }
            if (x.p + hs <= yes - 0.2) { exit = Math.max(0, x.p - hs - 0.08); break; }
            if (fresh && q < x.p - hs) { exit = Math.max(0, x.p - hs); break; }
          }
          const val = exit ?? (b.win ? 1 : 0);
          out.push({ day: s.day, ret: (val - (exit === null ? 0 : fee(val)) - yes - fee(yes)) / (yes + fee(yes)) });
        });
      }
      const d = {}; for (const t of out) (d[t.day] ??= []).push(t.ret);
      const dm = Object.values(d).map(mean);
      return `${pn} ll ${ll.toFixed(3)} n ${String(out.length).padStart(3)} ret ${(100 * mean(out.map((t) => t.ret))).toFixed(0).padStart(4)}% $${(5 * out.reduce((a, t) => a + t.ret, 0)).toFixed(0).padStart(4)} lose ${dm.filter((x) => x < 0).length}/${dm.length}`;
    });
    console.log(vn.padEnd(27), cells.join(" | "));
  }
}

if (which === "exits2") {
  build({ bias: "prod" });
  const byKey = {};
  for (const s of samples) (byKey[s.city + "|" + s.day] ??= []).push(s);
  for (const g of Object.values(byKey)) { g.sort((a, b) => a.t - b.t); for (const s of g) { const lag = g.filter((x) => x.t <= s.t && x.t >= s.t - 3 * 3600e3); s.pX = probs(s, toUnit(s, mean(lag.map((x) => x.fmaxC))) + (PROD_BIAS[s.city] ?? PROD_BIAS.g) * scale(s), Math.max(0.6, PROD_SIGMA[band(s.leadH)]) * scale(s)); } }
  const entries = [], seen = new Set();
  for (const s of [...samples].sort((a, b) => a.t - b.t)) {
    if (s.leadH < 12 || s.day < 239) continue;
    s.buckets.forEach((b, i) => {
      const key = s.city + "|" + s.day + "|" + i;
      if (seen.has(key)) return;
      const pm = s.market[i], pw = s.pX[i];
      if (pm < 0.03 || pm > 0.97) return;
      const sp = spreadAt(s.leadH, pm);
      if (sp > 0.03) return;
      const yes = pm + sp / 2;
      if (pw - yes - fee(yes) < 0.2) return;
      seen.add(key);
      entries.push({ s, b, i, pw, yes, g: byKey[s.city + "|" + s.day] });
    });
  }
  const run = ({ s, b, i, pw, yes, g }, pol) => {
    let j = g.indexOf(s) + 1, q = pw, peak = yes, armed = false, half = 0, stopLvl = yes - 0.2;
    for (const x of b.h) {
      const tt = x.t * 1000;
      if (tt <= s.t) continue;
      if (tt >= Math.min(s.closeT, s.dayStart + 86400e3)) break;
      let fresh = false;
      while (j < g.length && g[j].t <= tt) { q = g[j++].pX[i]; fresh = true; }
      const hs = spreadAt((s.dayStart - tt) / 3600e3, x.p) / 2;
      const bid = x.p - hs;
      peak = Math.max(peak, bid);
      const sell = (v, frac = 1) => ({ v: Math.max(0, v), frac });
      if (pol.half && !half && bid >= yes + (pol.halfAt ?? 0.5) * (pw - yes)) half = bid;
      if (bid >= pw) return { exits: [[half ? 0.5 : 1, bid], ...(half ? [[0.5, half]] : [])], how: "TP" };
      if (pol.trail && bid >= yes + pol.trail.arm * (pw - yes)) armed = true;
      if (armed && bid <= peak - pol.trail.give * (peak - yes)) return { exits: [[half ? 0.5 : 1, bid], ...(half ? [[0.5, half]] : [])], how: "TRAIL" };
      if (pol.be && bid >= yes + pol.be * (pw - yes)) stopLvl = Math.max(stopLvl, yes + fee(yes) + 0.005);
      if (x.p + hs <= stopLvl) { const v = stopLvl > yes - 0.2 ? Math.max(0, bid - 0.01) : Math.max(0, bid - 0.08); return { exits: [[half ? 0.5 : 1, v], ...(half ? [[0.5, half]] : [])], how: "SL" }; }
      if (fresh && q < bid) return { exits: [[half ? 0.5 : 1, bid], ...(half ? [[0.5, half]] : [])], how: "FLIP" };
      if (pol.timeH != null && tt >= s.dayStart + pol.timeH * 3600e3) return { exits: [[half ? 0.5 : 1, bid], ...(half ? [[0.5, half]] : [])], how: "TIME" };
    }
    const res = b.win ? 1 : 0;
    return { exits: [[half ? 0.5 : 1, res, true], ...(half ? [[0.5, half]] : [])], how: "RES" };
  };
  const retOf = (e, r) => r.exits.reduce((a, [f, v, isRes]) => a + f * (v - (isRes ? 0 : fee(v))), 0) / (e.yes + fee(e.yes)) - 1;
  const periods = [["Aug27-Sep25", (e) => e.s.day < 269], ["Sep26-Oct2", (e) => e.s.day >= 269]];
  const base = entries.map((e) => ({ e, r: run(e, {}) }));
  const losers = base.filter(({ e, r }) => retOf(e, r) < 0);
  const mfe = losers.map(({ e }) => { let pk = e.yes; for (const x of e.b.h) { const tt = x.t * 1000; if (tt <= e.s.t || tt >= Math.min(e.s.closeT, e.s.dayStart + 86400e3)) continue; pk = Math.max(pk, x.p - spreadAt((e.s.dayStart - tt) / 3600e3, x.p) / 2); } return (pk - e.yes) / (e.pw - e.yes); });
  const pct = (th) => (100 * mfe.filter((x) => x >= th).length / mfe.length).toFixed(0) + "%";
  console.log(`entries ${entries.length}; losers ${losers.length}; losers whose bid got >=25% of the way to target ${pct(0.25)}, >=50% ${pct(0.5)}, >=75% ${pct(0.75)}`);
  const POL = {
    current: {},
    "trail arm50% give50%": { trail: { arm: 0.5, give: 0.5 } },
    "trail arm50% give33%": { trail: { arm: 0.5, give: 0.33 } },
    "trail arm33% give50%": { trail: { arm: 0.33, give: 0.5 } },
    "breakeven after 50%": { be: 0.5 },
    "breakeven after 33%": { be: 0.33 },
    "half at 50%, rest at TP": { half: true },
    "half at 33%, rest at TP": { half: true, halfAt: 0.33 },
    "half at 66%, rest at TP": { half: true, halfAt: 0.66 },
    "half + trail arm50 give50": { half: true, trail: { arm: 0.5, give: 0.5 } },
    "time exit at local 12:00": { timeH: 12 },
    "time exit at local 06:00": { timeH: 6 },
  };
  for (const [n, pol] of Object.entries(POL)) {
    console.log(n.padEnd(28), periods.map(([pn, f]) => { const a = entries.filter(f).map((e) => ({ e, r: run(e, pol) })); const rets = a.map(({ e, r }) => retOf(e, r)); const d = {}; a.forEach(({ e }, k) => (d[e.s.day] ??= []).push(rets[k])); const dm = Object.values(d).map(mean); const sd = Math.sqrt(mean(rets.map((x) => (x - mean(rets)) ** 2))); return `${pn} n ${a.length} ret ${(100 * mean(rets)).toFixed(0).padStart(4)}% sd ${(100 * sd).toFixed(0).padStart(4)}% $${(5 * rets.reduce((x, y) => x + y, 0)).toFixed(0).padStart(5)} winRate ${(100 * rets.filter((x) => x > 0).length / rets.length).toFixed(0)}% lose ${dm.filter((x) => x < 0).length}/${dm.length}`; }).join(" | "));
  }
}

if (which === "confirm") {
  build({ bias: "prod" });
  const byKey = {};
  for (const s of samples) (byKey[s.city + "|" + s.day] ??= []).push(s);
  for (const g of Object.values(byKey)) { g.sort((a, b) => a.t - b.t); for (const s of g) { const lag = g.filter((x) => x.t <= s.t && x.t >= s.t - 3 * 3600e3); s.pX = probs(s, toUnit(s, mean(lag.map((x) => x.fmaxC))) + (PROD_BIAS[s.city] ?? PROD_BIAS.g) * scale(s), Math.max(0.6, PROD_SIGMA[band(s.leadH)]) * scale(s)); } }
  const edgeAt = (s, i) => { const pm = s.market[i]; const sp = spreadAt(s.leadH, pm); const yes = pm + sp / 2; return { ok: pm >= 0.03 && pm <= 0.97 && sp <= 0.03, e: s.pX[i] - yes - fee(yes), yes }; };
  const sim = (need, scale2) => {
    const out = [], seen = new Set();
    for (const s of [...samples].sort((a, b) => a.t - b.t)) {
      if (s.leadH < 12 || s.day < 239) continue;
      const g = byKey[s.city + "|" + s.day], k = g.indexOf(s);
      s.buckets.forEach((b, i) => {
        const key = s.city + "|" + s.day + "|" + i;
        if (seen.has(key)) return;
        const { ok, e, yes } = edgeAt(s, i);
        if (!ok || e < 0.2) return;
        if (need > 0) { const prev = g.slice(Math.max(0, k - need), k); if (prev.length < need || prev.some((p) => edgeAt(p, i).e < 0.15)) return; }
        seen.add(key);
        const pw = s.pX[i];
        let j = k + 1, q = pw, exit = null, cost = yes + fee(yes), shares = 1, second = false;
        for (const x of b.h) {
          const tt = x.t * 1000;
          if (tt <= s.t) continue;
          if (tt >= Math.min(s.closeT, s.dayStart + 86400e3)) break;
          let fresh = false;
          while (j < g.length && g[j].t <= tt) { q = g[j++].pX[i]; fresh = true; }
          const hs = spreadAt((s.dayStart - tt) / 3600e3, x.p) / 2, bid = x.p - hs, ask = x.p + hs;
          if (scale2 && !second && ask <= yes - scale2 && q - ask - fee(ask) >= 0.2) { second = true; shares += 1; cost += ask + fee(ask); }
          if (bid >= pw) { exit = bid - fee(bid); break; }
          if (ask <= yes - 0.2) { exit = Math.max(0, bid - 0.08); break; }
          if (fresh && q < bid) { exit = Math.max(0, bid - fee(bid)); break; }
        }
        const val = (exit ?? (b.win ? 1 : 0)) * shares;
        out.push({ day: s.day, ret: val / cost - 1, w: cost });
      });
    }
    return out;
  };
  for (const [name, need, sc] of [["current", 0, 0], ["confirm: previous run edge>=.15", 1, 0], ["confirm: previous 2 runs edge>=.15", 2, 0], ["scale-in: add 2nd unit if ask drops 3c", 0, 0.03], ["scale-in: add 2nd unit if ask drops 5c", 0, 0.05]]) {
    const o = sim(need, sc);
    console.log(name.padEnd(42), [["Aug27-Sep25", (t) => t.day < 269], ["Sep26-Oct2", (t) => t.day >= 269]].map(([p, f]) => { const a = o.filter(f); const r = a.reduce((x, t) => x + t.ret * t.w, 0) / a.reduce((x, t) => x + t.w, 0); const d = {}; for (const t of a) (d[t.day] ??= []).push(t.ret); const dm = Object.values(d).map(mean); return `${p} n ${String(a.length).padStart(3)} ret/$ ${(100 * r).toFixed(0).padStart(4)}% lose ${dm.filter((x) => x < 0).length}/${dm.length}`; }).join(" | "));
  }
}

if (which === "persist") {
  build({ bias: "prod" });
  const OLD2 = JSON.parse(fs.readFileSync(`${OLD}/stations.json`, "utf8"));
  const byKey = {};
  for (const s of samples) (byKey[s.city + "|" + s.day] ??= []).push(s);
  const res = {};
  for (const [k, g] of Object.entries(byKey)) {
    g.sort((a, b) => a.t - b.t);
    const s0 = g[0];
    if (s0.actual == null || s0.day < 239) continue;
    const pre = g.filter((x) => x.leadH >= 12 && x.leadH <= 24);
    if (!pre.length) continue;
    const s = pre.at(-1);
    const lag = g.filter((x) => x.t <= s.t && x.t >= s.t - 3 * 3600e3);
    const mu = toUnit(s, mean(lag.map((x) => x.fmaxC))) + (PROD_BIAS[s.city] ?? PROD_BIAS.g) * scale(s);
    (res[s0.city] ??= {})[s0.day] = { r: (s0.actual - mu) / scale(s0), mk: (s0.actual - expect(s, s.market)) / scale(s0), closeT: s0.closeT, dayStart: s0.dayStart };
  }
  const corr = (xs, ys) => { const mx = mean(xs), my = mean(ys); return mean(xs.map((x, i) => (x - mx) * (ys[i] - my))) / Math.sqrt(mean(xs.map((x) => (x - mx) ** 2)) * mean(ys.map((y) => (y - my) ** 2))); };
  for (const lagD of [1, 2, 3]) {
    const xs = [], ys = [], xm = [], ym = [];
    for (const [c, d] of Object.entries(res)) for (const [day, v] of Object.entries(d)) { const w = d[+day + lagD]; if (w) { xs.push(v.r); ys.push(w.r); xm.push(Math.abs(v.mk) - Math.abs(v.r)); ym.push(Math.abs(w.mk) - Math.abs(w.r)); } }
    console.log(`WN3 error autocorrelation, same city, lag ${lagD} day(s): ${corr(xs, ys).toFixed(2)} (n ${xs.length});  WN3 skill (|mkt err|-|wn3 err|) autocorr: ${corr(xm, ym).toFixed(2)}`);
  }
  const region = (c) => { const lon = OLD2[c]?.lon ?? 0; return lon > 60 ? "Asia/Oceania" : lon > -30 ? "Europe/Africa/MidEast" : "Americas"; };
  const days = [...new Set(Object.values(res).flatMap((d) => Object.keys(d).map(Number)))].sort();
  const reg = {};
  for (const d of days) { const by = {}; for (const [c, dd] of Object.entries(res)) if (dd[d]) (by[region(c)] ??= []).push(dd[d].r); for (const [r, a] of Object.entries(by)) (reg[r] ??= {})[d] = mean(a); }
  const R = Object.keys(reg);
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) { const ds = days.filter((d) => reg[R[i]][d] != null && reg[R[j]][d] != null); console.log(`same-day mean WN3 error corr ${R[i]} vs ${R[j]}: ${corr(ds.map((d) => reg[R[i]][d]), ds.map((d) => reg[R[j]][d])).toFixed(2)} (days ${ds.length})`); }
}

if (which === "activity") {
  build({ bias: "prod" });
  const byKey = {};
  for (const s of samples) (byKey[s.city + "|" + s.day] ??= []).push(s);
  for (const g of Object.values(byKey)) { g.sort((a, b) => a.t - b.t); for (const s of g) { const lag = g.filter((x) => x.t <= s.t && x.t >= s.t - 3 * 3600e3); s.pX = probs(s, toUnit(s, mean(lag.map((x) => x.fmaxC))) + (PROD_BIAS[s.city] ?? PROD_BIAS.g) * scale(s), Math.max(0.6, PROD_SIGMA[band(s.leadH)]) * scale(s)); } }
  const out = [], seen = new Set();
  for (const s of [...samples].sort((a, b) => a.t - b.t)) {
    if (s.leadH < 12 || s.day < 239) continue;
    const g = byKey[s.city + "|" + s.day];
    s.buckets.forEach((b, i) => {
      const key = s.city + "|" + s.day + "|" + i;
      if (seen.has(key)) return;
      const pm = s.market[i], pw = s.pX[i];
      if (pm < 0.03 || pm > 0.97) return;
      const yes = pm + 0.01;
      if (pw - yes - fee(yes) < 0.2) return;
      seen.add(key);
      const win6 = b.h.filter((x) => x.t * 1000 <= s.t && x.t * 1000 > s.t - 6 * 3600e3);
      let changes = 0; for (let k = 1; k < win6.length; k++) if (Math.abs(win6[k].p - win6[k - 1].p) > 0.0049) changes++;
      const ladderAct = s.buckets.reduce((a, bb) => { const w = bb.h.filter((x) => x.t * 1000 <= s.t && x.t * 1000 > s.t - 6 * 3600e3); let c = 0; for (let k = 1; k < w.length; k++) if (Math.abs(w[k].p - w[k - 1].p) > 0.0049) c++; return a + c; }, 0);
      let exit = null, q = pw, j = g.indexOf(s) + 1, half = 0;
      for (const x of b.h) {
        const tt = x.t * 1000;
        if (tt <= s.t) continue;
        if (tt >= Math.min(s.closeT, s.dayStart + 86400e3)) break;
        let fresh = false;
        while (j < g.length && g[j].t <= tt) { q = g[j++].pX[i]; fresh = true; }
        const bid = x.p - 0.01;
        if (!half && bid >= yes + 0.5 * (pw - yes)) half = bid - fee(bid);
        if (bid >= pw) { exit = bid - fee(bid); break; }
        if (x.p + 0.01 <= yes - 0.2) { exit = Math.max(0, bid - 0.08); break; }
        if (fresh && q < bid) { exit = Math.max(0, bid - fee(bid)); break; }
      }
      const fin = exit ?? (b.win ? 1 : 0);
      const val = half ? 0.5 * half + 0.5 * fin : fin;
      out.push({ day: s.day, changes, ladderAct, ret: val / (yes + fee(yes)) - 1 });
    });
  }
  const q4 = (f, name) => { const a = [...out].sort((x, y) => f(x) - f(y)); console.log(name); for (let k = 0; k < 4; k++) { const g = a.slice((k * a.length) / 4, ((k + 1) * a.length) / 4); console.log(`  q${k + 1} [${f(g[0])}..${f(g.at(-1))}] n ${g.length} ret ${(100 * mean(g.map((t) => t.ret))).toFixed(0)}% | Aug27-Sep25 ${(100 * mean(g.filter((t) => t.day < 269).map((t) => t.ret))).toFixed(0)}% | Sep26+ ${(100 * mean(g.filter((t) => t.day >= 269).map((t) => t.ret))).toFixed(0)}% (${g.filter((t) => t.day >= 269).length})`); } };
  q4((t) => t.changes, "bucket price changes in prior 6h");
  q4((t) => t.ladderAct, "ladder-wide price changes in prior 6h");
}

if (which === "calib") {
  build({ bias: "prod" });
  const byKey = {};
  for (const s of samples) (byKey[s.city + "|" + s.day] ??= []).push(s);
  for (const g of Object.values(byKey)) { g.sort((a, b) => a.t - b.t); for (const s of g) { const lag = g.filter((x) => x.t <= s.t && x.t >= s.t - 3 * 3600e3); s.muX = toUnit(s, mean(lag.map((x) => x.fmaxC))) + (PROD_BIAS[s.city] ?? PROD_BIAS.g) * scale(s); s.pX = probs(s, s.muX, Math.max(0.6, PROD_SIGMA[band(s.leadH)]) * scale(s)); } }
  const rt = samples.filter((s) => s.day >= 239 && s.leadH >= 12 && s.leadH <= 30);
  const bins = [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 1.01];
  console.log("reliability (real-time, lead 12-30h): predicted bin -> actual frequency");
  for (const [name, f] of [["WN3", (s, i) => s.pX[i]], ["market", (s, i) => s.market[i]]]) {
    const cells = [];
    for (let k = 0; k < bins.length - 1; k++) { let n = 0, w = 0, ps = 0; for (const s of rt) s.buckets.forEach((b, i) => { const p = f(s, i); if (p >= bins[k] && p < bins[k + 1]) { n++; ps += p; if (i === s.winIdx) w++; } }); cells.push(`${(100 * ps / n).toFixed(0)}->${(100 * w / n).toFixed(0)}%`); }
    console.log(" ", name.padEnd(7), cells.join("  "));
  }
  const rs = rt.filter((s) => s.actual != null).map((s) => (s.actual - s.muX) / scale(s));
  const m = mean(rs);
  console.log(`realized WN3 residual: mean ${m.toFixed(2)}C sd ${Math.sqrt(mean(rs.map((x) => (x - m) ** 2))).toFixed(2)}C vs model sigma ${PROD_SIGMA[1]}-${PROD_SIGMA[2]}`);
  const out = [], seen = new Set();
  for (const s of [...samples].sort((a, b) => a.t - b.t)) {
    if (s.leadH < 12 || s.day < 239) continue;
    const g = byKey[s.city + "|" + s.day];
    s.buckets.forEach((b, i) => {
      const key = s.city + "|" + s.day + "|" + i;
      if (seen.has(key)) return;
      const pm = s.market[i], pw = s.pX[i];
      if (pm < 0.03 || pm > 0.97) return;
      const yes = pm + 0.01;
      if (pw - yes - fee(yes) < 0.2) return;
      seen.add(key);
      let exit = null, q = pw, j = g.indexOf(s) + 1, half = 0;
      for (const x of b.h) {
        const tt = x.t * 1000;
        if (tt <= s.t) continue;
        if (tt >= Math.min(s.closeT, s.dayStart + 86400e3)) break;
        let fresh = false;
        while (j < g.length && g[j].t <= tt) { q = g[j++].pX[i]; fresh = true; }
        const bid = x.p - 0.01;
        if (!half && bid >= yes + 0.5 * (pw - yes)) half = bid - fee(bid);
        if (bid >= pw) { exit = bid - fee(bid); break; }
        if (x.p + 0.01 <= yes - 0.2) { exit = Math.max(0, bid - 0.08); break; }
        if (fresh && q < bid) { exit = Math.max(0, bid - fee(bid)); break; }
      }
      const fin = exit ?? (b.win ? 1 : 0);
      out.push({ day: s.day, gap: Math.abs(s.muX - expect(s, s.market)) / scale(s), ret: (half ? 0.5 * half + 0.5 * fin : fin) / (yes + fee(yes)) - 1 });
    });
  }
  console.log("\ncurrent rules (lead>=12, 3h mean, flip, half TP) by |WN3 centre - market centre|:");
  for (const [lo, hi] of [[0, 0.5], [0.5, 1], [1, 1.5], [1.5, 99]]) {
    const a = out.filter((t) => t.gap >= lo && t.gap < hi);
    console.log(`  |gap| ${lo}-${hi}C`.padEnd(18), [["Aug27-Sep25", (t) => t.day < 269], ["Sep26-Oct2", (t) => t.day >= 269]].map(([p, f]) => { const x = a.filter(f); return `${p} n ${String(x.length).padStart(3)} ret ${(100 * mean(x.map((t) => t.ret))).toFixed(0).padStart(4)}%`; }).join(" | "));
  }
}

if (which === "hi") {
  build({ bias: "prod" });
  const rt = samples.filter((s) => s.day >= 239 && s.leadH >= 12 && s.leadH <= 30);
  const hits = [];
  for (const s of rt) s.buckets.forEach((b, i) => { if (s.p[i] >= 0.7) hits.push({ city: s.city, day: s.day, title: b.title, range: b.range, pw: s.p[i], pm: s.market[i], win: i === s.winIdx, actual: s.actual, mu: toUnit(s, s.fmaxC), nb: s.buckets.length, titles: s.buckets.map((x) => x.title).join(",") }); });
  console.log("samples with WN3 >= 70%:", hits.length, "distinct ladders", new Set(hits.map((h) => h.city + h.day)).size);
  const seen = new Set();
  for (const h of hits) { const k = h.city + h.day + h.title; if (seen.has(k)) continue; seen.add(k); console.log(h.city.padEnd(14), h.day, h.title.padEnd(14), JSON.stringify(h.range), "pw", h.pw.toFixed(2), "mkt", h.pm.toFixed(2), "win", h.win, "actual", h.actual, "mu", h.mu.toFixed(1), "buckets", h.nb); if (seen.size > 25) break; }
}

if (which === "biasdrift") {
  build({ bias: "prod" });
  const SEEDB = JSON.parse(fs.readFileSync("prod-bias.json", "utf8"));
  const seedDays = Object.fromEntries((process.env.SEEDDAYS ? JSON.parse(process.env.SEEDDAYS) : []));
  const st = JSON.parse(fs.readFileSync(`${OLD}/stations.json`, "utf8"));
  const zone = (c) => { const lat = st[c]?.lat ?? 0; return Math.abs(lat) < 23.5 ? "tropics" : lat > 0 ? "north" : "south"; };
  const byKey = {};
  for (const s of samples) (byKey[s.city + "|" + s.day] ??= []).push(s);
  for (const g of Object.values(byKey)) { g.sort((a, b) => a.t - b.t); for (const s of g) s.fL = mean(g.filter((x) => x.t <= s.t && x.t >= s.t - 3 * 3600e3).map((x) => x.fmaxC)); }
  const lad = [];
  for (const g of Object.values(byKey)) {
    const s0 = g[0]; if (s0.actual == null) continue;
    const pre = g.filter((x) => x.leadH >= 12); if (!pre.length) continue;
    lad.push({ city: s0.city, zone: zone(s0.city), closeT: s0.closeT, day: s0.day, r: (s0.actual - toUnit(s0, pre.at(-1).fL)) / scale(s0) });
  }
  lad.sort((a, b) => a.closeT - b.closeT);
  const seedG = 0.66;
  const seedCity = (c) => SEEDB.find((x) => x[0] === c)?.[1] ?? seedG;
  const before = (t) => lad.filter((l) => l.closeT < t);
  const mem = new Map();
  const memo = (k, f) => { if (!mem.has(k)) mem.set(k, f()); return mem.get(k); };
  const scheme = {
    "0a no correction": () => 0,
    "0b fixed global +0.66": () => 0.66,
    "0c rolling global only (7d all cities)": (c, t) => memo("glob" + Math.floor(t / 3600e3), () => { const g7 = before(t).filter((l) => l.closeT >= t - 7 * 86400e3); return g7.length ? mean(g7.map((l) => l.r)) : 0.66; }),
    "1 static summer seed": (c, t) => seedCity(c),
    "2 live slow learner (decay .98)": (c, t) => memo("live" + c + Math.floor(t / 3600e3), () => {
      let w = 24, sum = seedCity(c) * (24 + 8) - 8 * seedG;
      const rows = {}; for (const cc of new Set(lad.map((l) => l.city))) rows[cc] = { w: 24, s: seedCity(cc) * 32 - 8 * seedG };
      for (const l of before(t)) { const r = rows[l.city]; r.w = 0.98 * r.w + 1; r.s = 0.98 * r.s + l.r; }
      const W = Object.values(rows).reduce((a, r) => a + r.w, 0), Sm = Object.values(rows).reduce((a, r) => a + r.s, 0), g = Sm / W;
      const r = rows[c]; if (!r) return seedCity(c); return (r.s + 8 * g) / (r.w + 8);
    }),
    "3 recent: city 14d shrunk to global 7d": (c, t) => memo("rec" + c + Math.floor(t / 3600e3), () => {
      const b = before(t); const GW = +(process.env.GW ?? 7), CW = +(process.env.CW ?? 14), KK = +(process.env.KK ?? 3); const g7 = b.filter((l) => l.closeT >= t - GW * 86400e3); const G = g7.length ? mean(g7.map((l) => l.r)) : seedG;
      const c14 = b.filter((l) => l.city === c && l.closeT >= t - CW * 86400e3); return (c14.reduce((a, l) => a + l.r, 0) + KK * G) / (c14.length + KK);
    }),
    "4 station offset + 7d zone drift": (c, t) => memo("zone" + c + Math.floor(t / 3600e3), () => {
      const b = before(t).filter((l) => l.closeT >= t - 7 * 86400e3);
      const z = zone(c);
      const zr = b.filter((l) => l.zone === z).map((l) => l.r - (seedCity(l.city) - seedG));
      const drift = zr.length >= 10 ? mean(zr) : seedG;
      return seedCity(c) - seedG + drift;
    }),
  };
  const wk = (d) => d < 251 ? "Aug27-Sep7" : d < 258 ? "Sep8-14" : d < 265 ? "Sep15-21" : d < 272 ? "Sep22-28" : "Sep29-Oct5";
  for (const [name, f] of Object.entries(scheme).filter(([n]) => !process.env.ONLY || n.startsWith(process.env.ONLY))) {
    for (const s of samples) if (s.day >= 239) s.pB = probs(s, toUnit(s, s.fL) + f(s.city, s.t) * scale(s), Math.max(0.6, PROD_SIGMA[band(s.leadH)]) * scale(s));
    const cells = [];
    const groups = {};
    for (const l of lad.filter((l) => l.day >= 244)) { const ref = byKey[l.city + "|" + l.day].filter((x) => x.leadH >= 12).at(-1); (groups[wk(l.day)] ??= []).push(l.r - f(l.city, ref.t)); }
    for (const [w, a] of Object.entries(groups)) cells.push(`${w} ${mean(a) >= 0 ? "+" : ""}${mean(a).toFixed(2)}/${mean(a.map(Math.abs)).toFixed(2)}`);
    const out = [], seen = new Set();
    for (const s of [...samples].sort((a, b) => a.t - b.t)) {
      if (s.leadH < 12 || s.day < 244) continue;
      const g = byKey[s.city + "|" + s.day];
      s.buckets.forEach((b, i) => {
        const key = s.city + "|" + s.day + "|" + i; if (seen.has(key)) return;
        const pm = s.market[i], pw = s.pB[i]; if (pm < 0.03 || pm > 0.97) return;
        const yes = pm + 0.01; if (pw - yes - fee(yes) < 0.2) return;
        seen.add(key);
        let exit = null, q = pw, j = g.indexOf(s) + 1, half = 0;
        for (const x of b.h) {
          const tt = x.t * 1000; if (tt <= s.t) continue; if (tt >= Math.min(s.closeT, s.dayStart + 86400e3)) break;
          let fresh = false; while (j < g.length && g[j].t <= tt) { q = g[j++].pB[i]; fresh = true; }
          const bid = x.p - 0.01;
          if (!half && bid >= yes + 0.5 * (pw - yes)) half = bid - fee(bid);
          if (bid >= pw) { exit = bid - fee(bid); break; }
          if (x.p + 0.01 <= yes - 0.2) { exit = Math.max(0, bid - 0.08); break; }
          if (fresh && q < bid) { exit = Math.max(0, bid - fee(bid)); break; }
        }
        const fin = exit ?? (b.win ? 1 : 0);
        out.push({ day: s.day, ret: (half ? 0.5 * half + 0.5 * fin : fin) / (yes + fee(yes)) - 1 });
      });
    }
    const per = [["Sep1-25", (t) => t.day < 269], ["Sep26-Oct5", (t) => t.day >= 269]].map(([p, f2]) => { const a = out.filter(f2); const d = {}; for (const t of a) (d[t.day] ??= []).push(t.ret); const dm = Object.values(d).map(mean); return `${p} n ${a.length} ret ${(100 * mean(a.map((t) => t.ret))).toFixed(0)}% $${(5 * a.reduce((x, t) => x + t.ret, 0)).toFixed(0)} lose ${dm.filter((x) => x < 0).length}/${dm.length}`; });
    const ll = mean(samples.filter((s) => s.day >= 269 && s.pB).map((s) => -Math.log(Math.max(1e-3, s.pB[s.winIdx]))));
    console.log(`\n${name}\n  weekly resid mean/MAE C: ${cells.join(" | ")}\n  ll Sep26-Oct5 ${ll.toFixed(3)}  trading: ${per.join(" | ")}`);
  }
}

if (which === "exportres") {
  const byKey = {};
  for (const s of samples) (byKey[s.city + "|" + s.day] ??= []).push(s);
  const out = [];
  for (const g of Object.values(byKey)) {
    g.sort((a, b) => a.t - b.t);
    const s0 = g[0];
    if (s0.actual == null || s0.day < +(process.env.FROMDAY ?? 262)) continue;
    const pre = g.filter((x) => x.leadH >= 12);
    if (!pre.length) continue;
    const ref = pre.at(-1);
    const fL = mean(g.filter((x) => x.t <= ref.t && x.t >= ref.t - 3 * 3600e3).map((x) => x.fmaxC));
    out.push({ campaignId: `backtest:${s0.city}:${s0.day}`, city: s0.city, closedAt: s0.closeT, residualC: Math.round(((s0.actual - toUnit(s0, fL)) / scale(s0)) * 1e4) / 1e4 });
  }
  fs.writeFileSync(process.env.OUT, JSON.stringify(out));
  console.log("residuals", out.length, "mean", mean(out.map((r) => r.residualC)).toFixed(3), "from", new Date(Math.min(...out.map((r) => r.closedAt))).toISOString(), "to", new Date(Math.max(...out.map((r) => r.closedAt))).toISOString());
}

if (which === "sidecmp") {
  build({ bias: "prod" });
  const byKey = {};
  for (const s of samples) (byKey[s.city + "|" + s.day] ??= []).push(s);
  for (const g of Object.values(byKey)) { g.sort((a, b) => a.t - b.t); for (const s of g) s.fL = mean(g.filter((x) => x.t <= s.t && x.t >= s.t - 3 * 3600e3).map((x) => x.fmaxC)); }
  const lad = [];
  for (const g of Object.values(byKey)) {
    const s0 = g[0]; if (s0.actual == null) continue;
    const pre = g.filter((x) => x.leadH >= 12); if (!pre.length) continue;
    lad.push({ city: s0.city, closeT: s0.closeT, r: (s0.actual - toUnit(s0, pre.at(-1).fL)) / scale(s0) });
  }
  lad.sort((a, b) => a.closeT - b.closeT);
  const cache = new Map();
  const corr = (city, t) => {
    const k = city + "|" + Math.floor(t / 3600e3);
    if (cache.has(k)) return cache.get(k);
    let gs = 0, gn = 0, cs = 0, cn = 0; const days = new Set();
    for (const l of lad) {
      if (l.closeT >= t) break;
      if (l.closeT >= t - 7 * 86400e3) { gs += l.r; gn++; days.add(Math.floor(l.closeT / 86400e3)); }
      if (l.city === city && l.closeT >= t - 14 * 86400e3) { cs += l.r; cn++; }
    }
    const v = days.size >= 4 && cn >= 7 ? (cs + 3 * (gs / gn)) / (cn + 3) : null;
    cache.set(k, v);
    return v;
  };
  for (const s of samples) {
    const b = corr(s.city, s.t);
    s.pX = b === null ? null : probs(s, toUnit(s, s.fL) + b * scale(s), Math.max(0.6, PROD_SIGMA[band(s.leadH)]) * scale(s));
  }
  const sim = (side, opt = {}) => {
    const out = [], seen = new Set();
    for (const s of [...samples].sort((a, b) => a.t - b.t)) {
      if (!s.pX || s.leadH < 12 || s.day < 239) continue;
      const g = byKey[s.city + "|" + s.day];
      s.buckets.forEach((b, i) => {
        const key = s.city + "|" + s.day + "|" + i;
        if (seen.has(key)) return;
        const pm = s.market[i];
        if (pm < 0.03 || pm > 0.97) return;
        const sp = spreadAt(s.leadH, pm);
        if (sp > 0.03) return;
        const pYes = s.pX[i];
        const fair = side === "YES" ? pYes : 1 - pYes;
        const entry = side === "YES" ? pm + sp / 2 : 1 - pm + sp / 2;
        if (fair - entry - fee(entry) < (opt.edge ?? 0.2)) return;
        if (opt.minEntry && entry < opt.minEntry) return;
        seen.add(key);
        let exit = null, q = fair, j = g.indexOf(s) + 1, half = 0, how = "RES";
        for (const x of b.h) {
          const tt = x.t * 1000;
          if (tt <= s.t) continue;
          if (tt >= Math.min(s.closeT, s.dayStart + 86400e3)) break;
          let fresh = false;
          while (j < g.length && g[j].t <= tt) { const nx = g[j++].pX; if (nx) { q = side === "YES" ? nx[i] : 1 - nx[i]; fresh = true; } }
          const hs = spreadAt((s.dayStart - tt) / 3600e3, x.p) / 2;
          const v = side === "YES" ? x.p : 1 - x.p;
          const bid = v - hs, ask = v + hs;
          if (!opt.noHalf && !half && bid >= entry + 0.5 * (fair - entry)) half = bid - fee(bid);
          if (bid >= fair) { exit = bid - fee(bid); how = "TP"; break; }
          if (!opt.noStop && ask <= entry - 0.2) { exit = Math.max(0, bid - 0.08); how = "SL"; break; }
          if (!opt.noModel && fresh && q < bid) { exit = Math.max(0, bid - fee(bid)); how = "MODEL"; break; }
          if (opt.holdOnly) continue;
        }
        const won = side === "YES" ? b.win : !b.win;
        const fin = exit ?? (won ? 1 : 0);
        const val = half ? 0.5 * half + 0.5 * fin : fin;
        out.push({ day: s.day, city: s.city, side, entry, fair, edge: fair - entry - fee(entry), how, half: !!half, won: won ? 1 : 0, ret: val / (entry + fee(entry)) - 1 });
      });
    }
    return out;
  };
  const P = [["Aug27-Sep25", (t) => t.day < 269], ["Sep26-Oct6", (t) => t.day >= 269], ["all realtime", () => true]];
  const rep = (name, tr) => console.log(name.padEnd(20), P.map(([p, f]) => {
    const a = tr.filter(f); if (!a.length) return `${p} n 0`;
    const d = {}; for (const t of a) (d[t.day] ??= []).push(t.ret);
    const dm = Object.values(d).map(mean);
    const sd = Math.sqrt(mean(a.map((t) => (t.ret - mean(a.map((x) => x.ret))) ** 2)));
    return `${p} n ${String(a.length).padStart(4)} ret ${(100 * mean(a.map((t) => t.ret))).toFixed(0).padStart(4)}% sd ${(100 * sd).toFixed(0).padStart(3)}% $${(5 * a.reduce((x, t) => x + t.ret, 0)).toFixed(0).padStart(5)} profitable ${(100 * a.filter((t) => t.ret > 0).length / a.length).toFixed(0)}% loseDays ${dm.filter((x) => x < 0).length}/${dm.length} worst ${(100 * Math.min(...dm)).toFixed(0)}%`;
  }).join(" | "));
  if (process.env.VARIANTS) {
    const V = [["NO current", {}], ["NO no stop", { noStop: true }], ["NO no half TP", { noHalf: true }], ["NO no stop, no half", { noStop: true, noHalf: true }], ["NO hold to resolution", { noStop: true, noHalf: true, noModel: true, holdOnly: true }], ["NO only >=60c", { minEntry: 0.6 }], ["NO >=60c no stop", { minEntry: 0.6, noStop: true }], ["NO edge>=.30", { edge: 0.3 }], ["NO edge>=.30 no stop", { edge: 0.3, noStop: true }], ["YES current", {}, "YES"], ["YES no stop", { noStop: true }, "YES"]];
    for (const [n, o, sd] of V) rep(n, sim(sd ?? "NO", o));
    process.exit(0);
  }
  const yes = sim("YES"), no = sim("NO", process.env.NOOPT ? JSON.parse(process.env.NOOPT) : {});
  fs.writeFileSync("sidecmp.json", JSON.stringify({ yes, no }));
  rep("YES (live logic)", yes);
  rep("NO (mirror)", no);
  rep("YES + NO", [...yes, ...no]);
}
