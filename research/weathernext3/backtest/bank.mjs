import fs from "fs";
const load = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const TH = process.env.TH ?? "0.2";
const withDay = (tr, month) => tr.map((t) => ({ ...t, dayStart: t.t + t.leadH * 3600e3, m: month }));
const data = [...withDay(load(`x-aug-${TH}-slip.json`), "aug"), ...withDay(load(`x-sep-${TH}-slip.json`), "sep")];
const days = {};
for (const t of data) (days[t.m + t.day] ??= []).push(t);
const dayKeys = Object.keys(days).sort((a, b) => days[a][0].dayStart - days[b][0].dayStart);

function sim(trades, policy, B0) {
  const ev = [];
  for (const t of trades) if (policy.take(t)) ev.push({ at: t.t, kind: 1, t });
  ev.sort((a, b) => a.at - b.at);
  let cash = B0, open = [], equityMark = B0, peak = B0, maxDD = 0, taken = 0, skipped = 0, minEq = B0;
  const settleUntil = (time) => {
    open.sort((a, b) => a.xt - b.xt);
    while (open.length && open[0].xt <= time) {
      const p = open.shift();
      cash += p.stake * (1 + p.r);
      const eq = cash + open.reduce((a, q) => a + q.stake, 0);
      peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak); minEq = Math.min(minEq, eq);
    }
  };
  const perLadder = {};
  for (const { at, t } of ev) {
    settleUntil(at);
    const equity = cash + open.reduce((a, q) => a + q.stake, 0);
    if (policy.maxPerLadder && (perLadder[t.m + t.key] ?? 0) >= policy.maxPerLadder) { skipped++; continue; }
    let stake = policy.stake(t, equity);
    if (policy.maxOpenFrac) stake = Math.min(stake, policy.maxOpenFrac * equity - open.reduce((a, q) => a + q.stake, 0));
    stake = Math.min(stake, cash);
    if (stake < (policy.minStake ?? 1)) { skipped++; continue; }
    cash -= stake; taken++;
    perLadder[t.m + t.key] = (perLadder[t.m + t.key] ?? 0) + 1;
    open.push({ stake, xt: t.xt, r: policy.ret(t) });
  }
  settleUntil(Infinity);
  return { final: cash, maxDD, minEq, taken, skipped };
}

function bootstrap(policy, B0, nDays, paths, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const finals = [], dds = [];
  for (let p = 0; p < paths; p++) {
    const tr = [];
    for (let k = 0; k < nDays; k++) {
      const d = days[dayKeys[Math.floor(rnd() * dayKeys.length)]];
      const base = d[0].dayStart;
      for (const t of d) tr.push({ ...t, key: t.key + "#" + k, t: k * 86400e3 + (t.t - base), xt: k * 86400e3 + (t.xt - base) });
    }
    const r = sim(tr, policy, B0);
    finals.push(r.final); dds.push(r.maxDD);
  }
  finals.sort((a, b) => a - b); dds.sort((a, b) => a - b);
  const q = (a, x) => a[Math.floor(x * (a.length - 1))];
  return { p5: q(finals, 0.05), p50: q(finals, 0.5), p95: q(finals, 0.95), lossProb: finals.filter((f) => f < B0).length / finals.length, halfProb: finals.filter((f) => f < B0 / 2).length / finals.length, dd50: q(dds, 0.5), dd95: q(dds, 0.95) };
}

const allIn = (t) => t.entry + 0.05 * t.entry * (1 - t.entry);
const kellyF = (t) => Math.max(0, (t.target - allIn(t)) / (1 - allIn(t)));
const withStop = (t) => t.ret;
const noStop = (t) => t.retTpOnly;
const CAP = +(process.env.CAP ?? 20);
const YES = (t) => t.side === "YES";
const clampFrac = (f) => ({ take: YES, stake: (t, e) => Math.max(5, Math.min(20, f * e)), ret: withStop, minStake: 5 });
const P = {
  "YES only, $5 fixed": { take: YES, stake: () => 5, ret: withStop, minStake: 5 },
  "YES only, 1/5 eq clamp $5-20": clampFrac(0.2),
  "YES only, 1/10 eq clamp $5-20": clampFrac(0.1),
  "YES only, 1/20 eq clamp $5-20": clampFrac(0.05),
};
const B0 = +(process.env.B0 ?? 100);
console.log(`cap ${CAP}/trade, start ${B0}, theta ${TH}, realistic stop slippage 8c; chronological Aug1-Sep25 (${dayKeys.length} market days) | bootstrap 300 paths x 30 days`);
console.log("policy".padEnd(36), "trades  skipped   final   maxDD  minEq | 30d p5    p50     p95   P(loss) P(<half) DD50 DD95");
for (const [name, pol] of Object.entries(P)) {
  const r = sim(data, pol, B0);
  const b = bootstrap(pol, B0, 30, 300);
  console.log(name.padEnd(36), String(r.taken).padStart(6), String(r.skipped).padStart(8), r.final.toFixed(0).padStart(8), (100 * r.maxDD).toFixed(0).padStart(6) + "%", r.minEq.toFixed(0).padStart(6), "|", b.p5.toFixed(0).padStart(6), b.p50.toFixed(0).padStart(7), b.p95.toFixed(0).padStart(7), (100 * b.lossProb).toFixed(0).padStart(6) + "%", (100 * b.halfProb).toFixed(0).padStart(6) + "%", (100 * b.dd50).toFixed(0).padStart(4) + "%", (100 * b.dd95).toFixed(0).padStart(4) + "%");
}
