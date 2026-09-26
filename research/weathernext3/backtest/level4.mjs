import fs from "fs";
const snap = JSON.parse(fs.readFileSync("spread-snapshot.json", "utf8"));
const band = (h) => (h > 36 ? "36h+" : h > 18 ? "18-36h" : h > 0 ? "0-18h" : "on-day");
const pb = (m) => (m < 0.05 ? 0 : m < 0.15 ? 1 : m < 0.3 ? 2 : m < 0.5 ? 3 : 4);
const tab = {};
for (const r of snap) if (r.mid > 0.02 && r.mid < 0.98) (tab[band(r.leadH) + pb(Math.min(r.mid, 1 - r.mid))] ??= []).push(r.spread);
const SPREAD = {};
for (const [k, a] of Object.entries(tab)) SPREAD[k] = [...a].sort((x, y) => x - y)[a.length >> 1];
const spreadAt = (leadH, p) => SPREAD[band(leadH) + pb(Math.min(p, 1 - p))] ?? 0.05;
globalThis.__quiet = true;
fs.writeFileSync("_bt_core2.mjs", fs.readFileSync("backtest.mjs", "utf8").replace(/console\.log\(/g, "(globalThis.__quiet ? () => {} : console.log)(") + "\nexport { samples, placebo, report, fee };\n");
const { samples, placebo, report, fee } = await import("./_bt_core2.mjs");
globalThis.__quiet = false;

function run(list, theta, mode, holdCapH = 999, stopC = null) {
  const out = [];
  const seen = new Set();
  for (const s of list) s.buckets.forEach((b, i) => {
    const key = s.city + "|" + s.day + "|" + i;
    if (seen.has(key)) return;
    const pm = s.market[i], pw = s.wn3[i];
    if (pm < 0.03 || pm > 0.97) return;
    const sp = spreadAt(s.leadH, pm);
    if (sp > 0.03) return;
    const yes = pm + sp / 2, no = 1 - pm + sp / 2;
    let side = null;
    if (pw - yes - fee(yes) > theta) side = "YES";
    else if (1 - pw - no - fee(no) > theta) side = "NO";
    if (!side) return;
    seen.add(key);
    const entry = side === "YES" ? yes : no;
    const target = side === "YES" ? pw : 1 - pw;
    const resolveValue = side === "YES" ? (b.win ? 1 : 0) : b.win ? 0 : 1;
    const deadline = mode === "tpOrTime" ? Math.min(s.t + holdCapH * 3600e3, s.closeT - 60e3) : s.closeT;
    let exitValue = null, how = "resolve", holdH = (s.closeT - s.t) / 3600e3, last = null;
    for (const x of b.h) {
      const tt = x.t * 1000;
      if (tt <= s.t) continue;
      if (tt >= deadline) break;
      const v = side === "YES" ? x.p : 1 - x.p;
      const hs = spreadAt((s.dayStart - tt) / 3600e3, v) / 2;
      last = v - hs;
      if (v - hs >= target) { exitValue = v - hs; how = "tp"; holdH = (tt - s.t) / 3600e3; break; }
      if (stopC !== null && v - hs <= entry - stopC) { exitValue = Math.max(0, v - hs); how = "stop"; holdH = (tt - s.t) / 3600e3; break; }
    }
    if (exitValue === null && mode === "tpOrTime" && last !== null && deadline < s.closeT - 60e3) { exitValue = Math.max(0, last); how = "time"; holdH = holdCapH; }
    const val = exitValue ?? resolveValue;
    const pnl = (val - (how === "resolve" ? 0 : fee(val)) - entry - fee(entry)) / entry;
    out.push({ pnl, how, holdH, day: s.day, side });
  });
  return out;
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
for (const stopC of [null, 0.05, 0.1, 0.2]) {
  const tr = run(samples, 0.15, "tpOrResolve", 999, stopC);
  const h = {}; for (const t of tr) h[t.how] = (h[t.how] ?? 0) + 1;
  report("stop " + (stopC ?? "none") + " " + JSON.stringify(h), tr);
  report("   holdout late", tr.filter((t) => t.day >= 22));
  report("   holdout early", tr.filter((t) => t.day <= 11));
}