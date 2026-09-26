import fs from "fs";
const snap = JSON.parse(fs.readFileSync("spread-snapshot.json", "utf8"));
const band = (h) => (h > 36 ? "36h+" : h > 18 ? "18-36h" : h > 0 ? "0-18h" : "on-day");
const pb = (m) => (m < 0.05 ? 0 : m < 0.15 ? 1 : m < 0.3 ? 2 : m < 0.5 ? 3 : 4);
const tab = {};
for (const r of snap) if (r.mid > 0.02 && r.mid < 0.98) (tab[band(r.leadH) + pb(Math.min(r.mid, 1 - r.mid))] ??= []).push(r.spread);
const SPREAD = {};
for (const [k, a] of Object.entries(tab)) SPREAD[k] = [...a].sort((x, y) => x - y)[a.length >> 1];
globalThis.__spreadAt = (leadH, p) => SPREAD[band(leadH) + pb(Math.min(p, 1 - p))] ?? 0.05;
const src = fs.readFileSync("backtest.mjs", "utf8")
  .replace(/console\.log\(/g, "(globalThis.__quiet ? () => {} : console.log)(")
  .replace(`const buyYesCost = pm + HALF_SPREAD, buyNoCost = 1 - pm + HALF_SPREAD;`,
    `const sp = globalThis.__spreadAt(s.leadH, pm);
      if (sp > globalThis.__maxSpread) return;
      const buyYesCost = pm + sp / 2, buyNoCost = 1 - pm + sp / 2;`)
  .replace(`if (exit === "resolve") exitValue = resolveValue;`,
    `if (exit === "resolve") exitValue = resolveValue;
      else if (exit === "tpOrResolve") {
        const target = side === "YES" ? pw : 1 - pw;
        let hit = null;
        for (const x of b.h) {
          if (x.t * 1000 <= s.t) continue;
          if (x.t * 1000 >= s.closeT) break;
          const v = side === "YES" ? x.p : 1 - x.p;
          const hs = globalThis.__spreadAt((s.dayStart - x.t * 1000) / 3600e3, v) / 2;
          if (v - hs >= target) { hit = v - hs; break; }
        }
        if (hit === null) exitValue = resolveValue;
        else { exitValue = hit; exitFee = fee(hit); }
      }`)
  .replace(`exitValue = Math.max(0, last - HALF_SPREAD);`, `exitValue = Math.max(0, last - globalThis.__spreadAt((Math.min(s.dayStart, s.closeT) - s.t) / 3600e3 * 0, last) / 2);`)
  .replace(`trades.push({ pnl, side, city: s.city, day: s.day, band: leadBand(s.leadH) });`,
    `trades.push({ pnl, side, city: s.city, day: s.day, band: leadBand(s.leadH), key: s.city + "|" + s.day + "|" + i, entry });`);
fs.writeFileSync("_bt_level2.mjs", src + "\nexport { simulate, placebo, samples, report };\n");
globalThis.__quiet = true;
const { simulate, placebo, report } = await import("./_bt_level2.mjs");
globalThis.__quiet = false;
const splits = { "explored 12-21": [12,13,14,15,16,17,18,19,20,21], "holdout late 22-25": [22,23,24,25], "holdout early 2-11": [2,3,4,5,6,7,8,9,10,11] };
const firstOnly = (tr) => { const seen = new Set(); return tr.filter((t) => (seen.has(t.key) ? false : (seen.add(t.key), true))); };
for (const maxSpread of [0.03, 0.05]) {
  globalThis.__maxSpread = maxSpread;
  console.log(`\n=== modelled spreads, skip if spread > ${maxSpread}`);
  for (const exit of ["resolve", "tpOrResolve"]) for (const theta of [0.1, 0.15]) {
    for (const [name, ds] of Object.entries(splits)) report(`${exit} th${theta} ${name}`, firstOnly(simulate({ theta, exit }).filter((t) => ds.includes(t.day))));
    report(`  placebo ${exit} th${theta}`, firstOnly(simulate({ theta, exit, list: placebo })));
  }
  const tr = firstOnly(simulate({ theta: 0.15, exit: "tpOrResolve" }));
  const g = {};
  for (const t of tr) (g[t.band + " " + t.side] ??= []).push(t.pnl);
  console.log("tpOrResolve th0.15 by band/side:", Object.entries(g).map(([k, a]) => `${k} n${a.length} ${(100 * a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)}%`).join(" | "));
}
