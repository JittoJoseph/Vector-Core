import fs from "fs";

const events = ["reprice-events.json", "reprice-events-early.json"].filter((f) => fs.existsSync(f)).flatMap((f) => JSON.parse(fs.readFileSync(f, "utf8")));
const stations = JSON.parse(fs.readFileSync("stations.json", "utf8"));
const forecasts = fs.readFileSync("bq-mean.jsonl", "utf8").trim().split("\n").map(JSON.parse);
const PATCHED = ["NYC", "Toronto", "Singapore"];
const patch = new Map(
  ["bq-patch.jsonl", "bq-patch2.jsonl"]
    .filter((f) => fs.existsSync(f))
    .flatMap((f) => fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean))
    .map((l) => {
      const j = JSON.parse(l);
      return [j.init, j.byCity];
    }),
);
for (const f of forecasts)
  for (const c of PATCHED) {
    if (patch.get(f.init)?.[c]) f.byCity[c] = patch.get(f.init)[c];
    else delete f.byCity[c];
  }
const published = {};
for (const l of fs.readFileSync("published.txt", "utf8").trim().split("\n")) {
  const p = l.trim().split(/\s+/);
  const m = p[2]?.match(/(\d{4})(\d{2})(\d{2})_(\d{2})hr/);
  if (m) published[`${m[1]}-${m[2]}-${m[3]} ${m[4]}:00:00`] = Date.parse(p[1]);
}

const ENTRY_DELAY = 10 * 60e3;
const HALF_SPREAD = 0.01;
const fee = (p) => 0.05 * p * (1 - p);
const erf = (x) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
const Phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));

function parseBucket(title) {
  const m = title.match(/(-?\d+)(?:\s*-\s*(\d+))?/);
  const n = [Number(m[1]), m[2] != null ? Number(m[2]) : undefined];
  if (/or below/i.test(title)) return [-Infinity, n[0] + 0.5];
  if (/or higher|or above/i.test(title)) return [n[0] - 0.5, Infinity];
  return [n[0] - 0.5, (n[1] ?? n[0]) + 0.5];
}
const center = ([lo, hi]) => (Number.isFinite(lo) && Number.isFinite(hi) ? (lo + hi) / 2 : null);

function priceAt(h, t) {
  let p = null;
  for (const x of h) {
    if (x.t * 1000 > t) break;
    p = x.p;
  }
  return p;
}

const samples = [];
for (const ev of events) {
  const st = stations[ev.city];
  if (!st) continue;
  const isF = st.unit === "F";
  const buckets = ev.buckets.map((b) => ({ ...b, range: parseBucket(b.title) }));
  const winner = buckets.find((b) => b.win);
  if (!winner) continue;
  const actual = center(winner.range);
  const closeT = Date.parse(ev.closedTime);
  for (const f of forecasts) {
    const series = f.byCity[ev.city];
    if (!series) continue;
    const initT = Date.parse(f.init.replace(" ", "T") + "Z");
    const pub = published[f.init] ?? initT + 7.3 * 3600e3;
    const t = pub + ENTRY_DELAY;
    if (t >= closeT) continue;
    let max = -Infinity, covered = 0;
    series.forEach((c, o) => {
      const vt = initT + (o + 1) * 3600e3;
      if (vt >= ev.dayStart && vt < ev.dayStart + 86400e3) {
        covered++;
        const v = isF ? c * 1.8 + 32 : c;
        if (v > max) max = v;
      }
    });
    if (covered < 24) continue;
    const market = buckets.map((b) => priceAt(b.h, t));
    if (market.some((p) => p === null)) continue;
    samples.push({
      city: ev.city, day: ev.day, isF, init: f.init, t, closeT, dayStart: ev.dayStart,
      leadH: (ev.dayStart - t) / 3600e3, fmax: max, actual, winIdx: buckets.indexOf(winner),
      buckets, market,
    });
  }
}
console.log("samples", samples.length, "events", new Set(samples.map((s) => s.city + s.day)).size);

const leadBand = (h) => (h > 36 ? "36h+" : h > 18 ? "18-36h" : h > 0 ? "0-18h" : "on-day");
const unitScale = (s) => (s.isF ? 1.8 : 1);

function fitModel(train) {
  const byCity = {}, byBand = {};
  for (const s of train) {
    if (s.actual === null) continue;
    const r = (s.actual - s.fmax) / unitScale(s);
    (byCity[s.city] ??= []).push(r);
    (byBand[leadBand(s.leadH)] ??= []).push(r);
  }
  const all = Object.values(byCity).flat();
  const gBias = all.reduce((a, b) => a + b, 0) / all.length;
  const bias = {};
  for (const [c, a] of Object.entries(byCity)) {
    const k = 8;
    bias[c] = (a.reduce((x, y) => x + y, 0) + k * gBias) / (a.length + k);
  }
  const sigma = {};
  for (const [b, a] of Object.entries(byBand)) {
    const m = a.reduce((x, y) => x + y, 0) / a.length;
    sigma[b] = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
  }
  return { gBias, bias, sigma };
}

const days = [...new Set(samples.map((s) => s.day))];
for (const s of samples) {
  const model = fitModel(samples.filter((x) => x.day !== s.day));
  const b = (model.bias[s.city] ?? model.gBias) * unitScale(s);
  const sig = Math.max(0.6, model.sigma[leadBand(s.leadH)] ?? 1.5) * unitScale(s);
  const mu = s.fmax + b;
  const raw = s.buckets.map(({ range: [lo, hi] }) => Phi((hi - mu) / sig) - Phi((lo - mu) / sig));
  const tot = raw.reduce((a, x) => a + x, 0);
  s.wn3 = raw.map((p) => Math.min(0.995, Math.max(0.002, p / tot)));
  s.mu = mu;
  s.sig = sig;
}

function probsFor(s, mu) {
  const raw = s.buckets.map(({ range: [lo, hi] }) => Phi((hi - mu) / s.sig) - Phi((lo - mu) / s.sig));
  const tot = raw.reduce((a, x) => a + x, 0);
  return raw.map((p) => Math.min(0.995, Math.max(0.002, p / tot)));
}
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const placebo = samples.map((s) => {
  const pool = samples.filter((x) => x.city === s.city && x.day !== s.day && leadBand(x.leadH) === leadBand(s.leadH));
  if (!pool.length) return null;
  const other = pool[Math.floor(rnd() * pool.length)];
  return { ...s, wn3: probsFor(s, other.mu) };
}).filter(Boolean);

const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const brier = (p, w) => p.reduce((a, x, i) => a + (x - (i === w ? 1 : 0)) ** 2, 0);
const logloss = (p, w) => -Math.log(Math.max(1e-3, p[w]));
const mktExp = (s) => {
  let sum = 0, tot = 0;
  s.buckets.forEach((b, i) => {
    const c = center(b.range) ?? (Number.isFinite(b.range[0]) ? b.range[0] + 0.5 : b.range[1] - 0.5);
    sum += c * s.market[i];
    tot += s.market[i];
  });
  return sum / tot;
};

console.log("\nACCURACY (lower is better)  band      n   Brier mkt/wn3   LogLoss mkt/wn3   MAE mktExp/wn3 (deg, unit-native)");
for (const band of ["36h+", "18-36h", "0-18h", "on-day"]) {
  const g = samples.filter((s) => leadBand(s.leadH) === band);
  if (!g.length) continue;
  const withAct = g.filter((s) => s.actual !== null);
  console.log(
    band.padEnd(8), String(g.length).padStart(6),
    mean(g.map((s) => brier(s.market, s.winIdx))).toFixed(3), "/", mean(g.map((s) => brier(s.wn3, s.winIdx))).toFixed(3), "   ",
    mean(g.map((s) => logloss(s.market, s.winIdx))).toFixed(3), "/", mean(g.map((s) => logloss(s.wn3, s.winIdx))).toFixed(3), "   ",
    mean(withAct.map((s) => Math.abs(mktExp(s) - s.actual))).toFixed(2), "/", mean(withAct.map((s) => Math.abs(s.mu - s.actual))).toFixed(2),
  );
}

function simulate({ theta, exit, horizonH = 6, list = samples }) {
  const trades = [];
  for (const s of list) {
    s.buckets.forEach((b, i) => {
      const pm = s.market[i], pw = s.wn3[i];
      if (pm < 0.03 || pm > 0.97) return;
      const buyYesCost = pm + HALF_SPREAD, buyNoCost = 1 - pm + HALF_SPREAD;
      let side = null;
      if (pw - buyYesCost - fee(buyYesCost) > theta) side = "YES";
      else if (1 - pw - buyNoCost - fee(buyNoCost) > theta) side = "NO";
      if (!side) return;
      const entry = side === "YES" ? buyYesCost : buyNoCost;
      const entryFee = fee(entry);
      let exitValue, exitFee = 0, exitAt = null;
      const resolveValue = side === "YES" ? (b.win ? 1 : 0) : b.win ? 0 : 1;
      if (exit === "resolve") exitValue = resolveValue;
      else {
        const end = exit === "dayStart" ? Math.min(s.dayStart, s.closeT) : Math.min(s.t + horizonH * 3600e3, s.closeT);
        const target = side === "YES" ? pw : 1 - pw;
        let last = null;
        for (const x of b.h) {
          if (x.t * 1000 <= s.t) continue;
          if (x.t * 1000 > end) break;
          const v = side === "YES" ? x.p : 1 - x.p;
          last = v;
          if (exit === "target" && v >= target) { exitAt = x.t; break; }
        }
        if (last === null) exitValue = resolveValue;
        else {
          exitValue = Math.max(0, last - HALF_SPREAD);
          exitFee = fee(exitValue);
        }
      }
      const pnl = (exitValue - exitFee - entry - entryFee) / entry;
      trades.push({ pnl, side, city: s.city, day: s.day, band: leadBand(s.leadH) });
    });
  }
  return trades;
}

console.log("\nTRADING (return per $1 staked, 1c half-spread + taker fee both legs, entry 10 min after publish)");
for (const exit of ["resolve", "dayStart", "horizon6", "target"]) {
  for (const theta of [0.03, 0.06, 0.1, 0.15]) {
    const tr = simulate({ theta, exit: exit === "horizon6" ? "horizon" : exit, horizonH: 6 });
    if (!tr.length) continue;
    const byDay = {};
    for (const x of tr) (byDay[x.day] ??= []).push(x.pnl);
    const dayMeans = Object.values(byDay).map(mean);
    const pos = dayMeans.filter((x) => x > 0).length;
    console.log(
      exit.padEnd(9), "theta", theta.toFixed(2), "n", String(tr.length).padStart(5),
      "mean", (100 * mean(tr.map((x) => x.pnl))).toFixed(1).padStart(6) + "%",
      "win", (tr.filter((x) => x.pnl > 0).length / tr.length).toFixed(2),
      "YES/NO", tr.filter((x) => x.side === "YES").length + "/" + tr.filter((x) => x.side === "NO").length,
      "days+", `${pos}/${dayMeans.length}`,
    );
  }
}
function report(label, tr) {
  const byDay = {};
  for (const x of tr) (byDay[x.day] ??= []).push(x.pnl);
  const dm = Object.values(byDay).map(mean);
  const boots = [];
  for (let k = 0; k < 2000; k++) {
    const pick = dm.map(() => dm[Math.floor(rnd() * dm.length)]);
    boots.push(mean(pick));
  }
  boots.sort((x, y) => x - y);
  console.log(label.padEnd(34), "n", String(tr.length).padStart(5), "mean/trade", (100 * mean(tr.map((x) => x.pnl))).toFixed(1).padStart(6) + "%", "day-mean", (100 * mean(dm)).toFixed(1) + "%", "95% CI by day [", (100 * boots[50]).toFixed(1), ",", (100 * boots[1949]).toFixed(1), "]");
}
console.log("\nHOLD-TO-RESOLUTION vs PLACEBO (shuffled forecasts, same city)");
for (const theta of [0.06, 0.1, 0.15, 0.2]) {
  report("wn3     theta " + theta, simulate({ theta, exit: "resolve" }));
  report("placebo theta " + theta, simulate({ theta, exit: "resolve", list: placebo }));
}
const pool = (s, a, b) => {
  const raw = s.market.map((pm, i) => Math.max(1e-3, pm) ** a * s.wn3[i] ** b);
  const tot = raw.reduce((x, y) => x + y, 0);
  return raw.map((x) => x / tot);
};
const grid = [];
for (const a of [0.6, 0.8, 1, 1.2]) for (const b of [0, 0.1, 0.2, 0.3, 0.5, 0.7]) grid.push([a, b]);
let cvLoss = { market: [], pooled: [] }, chosen = [];
for (const d of days) {
  const train = samples.filter((s) => s.day !== d), test = samples.filter((s) => s.day === d);
  let best = null;
  for (const [a, b] of grid) {
    const l = mean(train.map((s) => logloss(pool(s, a, b), s.winIdx)));
    if (!best || l < best.l) best = { a, b, l };
  }
  chosen.push(`${d}:${best.a}/${best.b}`);
  for (const s of test) {
    cvLoss.market.push(logloss(pool(s, 1, 0), s.winIdx));
    cvLoss.pooled.push(logloss(pool(s, best.a, best.b), s.winIdx));
  }
}
const diffs = cvLoss.market.map((m, i) => m - cvLoss.pooled[i]);
console.log("\nPOOLING (leave-one-day-out): market logloss", mean(cvLoss.market).toFixed(4), "pooled", mean(cvLoss.pooled).toFixed(4), "improvement", mean(diffs).toFixed(4));
console.log("chosen a/b by held-out day:", chosen.join(" "));

fs.writeFileSync("backtest-samples.json", JSON.stringify(samples.map(({ buckets, ...s }) => s)));

console.log("\nPER CITY (lead 0-36h): n, Brier market, Brier wn3, wn3 better?");
const cityRows = [];
for (const c of [...new Set(samples.map((s) => s.city))]) {
  const g = samples.filter((s) => s.city === c && s.leadH > 0 && s.leadH <= 36);
  if (g.length < 8) continue;
  const bm = mean(g.map((s) => brier(s.market, s.winIdx))), bw = mean(g.map((s) => brier(s.wn3, s.winIdx)));
  cityRows.push([c, g.length, bm, bw]);
}
cityRows.sort((a, b) => a[3] - a[2] - (b[3] - b[2]));
for (const [c, n, bm, bw] of cityRows) console.log(c.padEnd(16), String(n).padStart(4), bm.toFixed(3), bw.toFixed(3), bw < bm ? "YES" : "");

const evByKey = new Map(events.map((e) => [e.city + "|" + e.day, e]));
function mktExpAt(ev, t) {
  let sum = 0, tot = 0;
  for (const b of ev.buckets) {
    const r = parseBucket(b.title);
    const c = center(r) ?? (Number.isFinite(r[0]) ? r[0] + 0.5 : r[1] - 0.5);
    const p = priceAt(b.h, t);
    if (p === null) return null;
    sum += c * p;
    tot += p;
  }
  return tot > 0 ? sum / tot : null;
}
console.log("\nREVISION LEAD TEST: WN3 revision (this init - previous init) vs market expected-max change after publish");
const groups = {};
for (const s of samples) (groups[s.city + "|" + s.day] ??= []).push(s);
const rows = [];
for (const [k, g] of Object.entries(groups)) {
  g.sort((a, b) => a.t - b.t);
  const ev = evByKey.get(k);
  for (let i = 1; i < g.length; i++) {
    const s = g[i], prev = g[i - 1];
    if (s.t - prev.t > 7 * 3600e3) continue;
    const rev = (s.mu - prev.mu) / unitScale(s);
    const m0 = mktExpAt(ev, s.t), mPrev = mktExpAt(ev, prev.t);
    const fut = [3, 6, 12].map((h) => {
      const tt = Math.min(s.t + h * 3600e3, s.closeT - 60e3);
      const m = mktExpAt(ev, tt);
      return m === null || m0 === null ? null : (m - m0) / unitScale(s);
    });
    if (m0 === null || mPrev === null || fut.includes(null)) continue;
    rows.push({ rev, before: (m0 - mPrev) / unitScale(s), f3: fut[0], f6: fut[1], f12: fut[2], band: leadBand(s.leadH), gap: (s.mu - m0) / unitScale(s) });
  }
}
const corr = (a, b) => {
  const ma = mean(a), mb = mean(b);
  let n = 0, da = 0, db = 0;
  a.forEach((x, i) => { n += (x - ma) * (b[i] - mb); da += (x - ma) ** 2; db += (b[i] - mb) ** 2; });
  return n / Math.sqrt(da * db);
};
for (const band of ["all", "36h+", "18-36h", "0-18h", "on-day"]) {
  const g = rows.filter((r) => band === "all" || r.band === band);
  if (g.length < 20) continue;
  const big = g.filter((r) => Math.abs(r.rev) >= 0.5);
  const hit = big.filter((r) => Math.sign(r.f6) === Math.sign(r.rev) && r.f6 !== 0).length / (big.filter((r) => r.f6 !== 0).length || 1);
  console.log(
    band.padEnd(7), "n", String(g.length).padStart(5),
    "corr(rev, mkt already moved)", corr(g.map((r) => r.rev), g.map((r) => r.before)).toFixed(3),
    "| corr(rev, next3h/6h/12h)", ["f3", "f6", "f12"].map((k) => corr(g.map((r) => r.rev), g.map((r) => r[k])).toFixed(3)).join("/"),
    "| corr(gap wn3-mkt, next12h)", corr(g.map((r) => r.gap), g.map((r) => r.f12)).toFixed(3),
    "| |rev|>=0.5deg n", big.length, "same-dir 6h", hit.toFixed(2),
  );
}

function revisionTrades({ tau, holdH, exit = "horizon", maker = false, list = samples, stopC = null }) {
  const out = [];
  const gs = {};
  for (const s of list) (gs[s.city + "|" + s.day] ??= []).push(s);
  for (const [k, g] of Object.entries(gs)) {
    g.sort((a, b) => a.t - b.t);
    for (let i = 1; i < g.length; i++) {
      const s = g[i], prev = g[i - 1];
      if (s.t - prev.t > 7 * 3600e3) continue;
      s.buckets.forEach((b, j) => {
        const pm = s.market[j];
        if (pm < 0.03 || pm > 0.97) return;
        const d = s.wn3[j] - prev.wn3[j];
        if (Math.abs(d) < tau) return;
        const side = d > 0 ? "YES" : "NO";
        const px = side === "YES" ? pm : 1 - pm;
        const entry = maker ? px : px + HALF_SPREAD;
        const entryFee = maker ? 0 : fee(entry);
        const end = exit === "dayStart" ? Math.min(s.dayStart, s.closeT - 60e3) : Math.min(s.t + holdH * 3600e3, s.closeT - 60e3);
        let v = null;
        for (const x of b.h) {
          if (x.t * 1000 <= s.t) continue;
          if (x.t * 1000 > end) break;
          v = side === "YES" ? x.p : 1 - x.p;
          if (stopC !== null && v - HALF_SPREAD <= entry - stopC) break;
        }
        if (v === null) return;
        const exitPx = Math.max(0, v - HALF_SPREAD);
        const pnl = (exitPx - fee(exitPx) - entry - entryFee) / entry;
        const cents = exitPx - fee(exitPx) - entry - entryFee;
        out.push({ pnl, cents, day: s.day, city: s.city, band: leadBand(s.leadH), side });
      });
    }
  }
  return out;
}
console.log("\nREVISION TRADING (direction of WN3 bucket-prob revision; taker both legs unless maker entry)");
for (const maker of [false, true])
  for (const holdH of [3, 6, 12])
    for (const tau of [0.05, 0.1, 0.15, 0.2]) {
      const tr = revisionTrades({ tau, holdH, maker });
      if (tr.length < 20) continue;
      report(`${maker ? "maker" : "taker"} hold ${holdH}h tau ${tau}`.padEnd(26) + ` c/sh ${(100 * mean(tr.map((x) => x.cents))).toFixed(2)}`, tr);
    }

console.log("\nPRE-REGISTERED HOLDOUT (rule fixed on days 12-21: taker both legs, hold 12h)");
const HOLDOUTS = { "late Sep 22-25": [22, 23, 24, 25], "early Sep 2-11": [2, 3, 4, 5, 6, 7, 8, 9, 10, 11], "explored Sep 12-21": [12, 13, 14, 15, 16, 17, 18, 19, 20, 21] };
for (const [name, ds] of Object.entries(HOLDOUTS)) {
  for (const tau of [0.1, 0.15]) {
    const tr = revisionTrades({ tau, holdH: 12 }).filter((x) => ds.includes(x.day));
    const pl = revisionTrades({ tau, holdH: 12, list: placebo }).filter((x) => ds.includes(x.day));
    if (tr.length) report(`${name} tau ${tau}`, tr);
    if (pl.length) report(`  placebo ${name} tau ${tau}`, pl);
  }
}
