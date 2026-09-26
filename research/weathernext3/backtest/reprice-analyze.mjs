import fs from "fs";
const events = JSON.parse(fs.readFileSync("reprice-events.json", "utf8"));

const STEP = 600;
function grid(ev) {
  const tMin = Math.min(...ev.buckets.flatMap((b) => b.h.map((x) => x.t)));
  const tMax = Math.max(...ev.buckets.flatMap((b) => b.h.map((x) => x.t)));
  const start = Math.ceil(tMin / STEP) * STEP;
  const series = ev.buckets.map((b) => {
    const out = [];
    let j = 0, last = b.h[0]?.p ?? 0;
    for (let t = start; t <= tMax; t += STEP) {
      while (j < b.h.length && b.h[j].t <= t) last = b.h[j++].p;
      out.push(last);
    }
    return out;
  });
  return { start, series, n: series[0]?.length ?? 0 };
}

const preHour = Array(24).fill(0), preCnt = Array(24).fill(0), preJumps = Array(24).fill(0);
const dayHour = Array(24).fill(0), dayCnt = Array(24).fill(0);
const winnerAt = { "D-1 00L": [], "D 00L": [], "D 06L": [], "D 12L": [] };
let brier = { "D-1 00L": [], "D 00L": [] };

for (const ev of events) {
  if (!ev.buckets.length || !ev.buckets[0].h.length) continue;
  const { start, series, n } = grid(ev);
  const ds = ev.dayStart / 1000;
  for (let i = 1; i < n; i++) {
    const t = start + i * STEP;
    let move = 0;
    for (const s of series) move += Math.abs(s[i] - s[i - 1]);
    const h = new Date(t * 1000).getUTCHours();
    if (t < ds) {
      preHour[h] += move; preCnt[h]++;
      if (move >= 0.1) preJumps[h]++;
    } else if (t < ds + 86400) {
      dayHour[h] += move; dayCnt[h]++;
    }
  }
  const wi = ev.buckets.findIndex((b) => b.win);
  if (wi < 0) continue;
  const at = (ts) => {
    const i = Math.round((ts - start) / STEP);
    return i >= 0 && i < n ? i : -1;
  };
  for (const [k, off] of [["D-1 00L", -86400], ["D 00L", 0], ["D 06L", 21600], ["D 12L", 43200]]) {
    const i = at(ds + off);
    if (i < 0) continue;
    winnerAt[k].push(series[wi][i]);
    if (brier[k]) {
      let b = 0;
      series.forEach((s, j) => (b += (s[i] - (j === wi ? 1 : 0)) ** 2));
      brier[k].push(b);
    }
  }
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
console.log("UTC hour | pre-day move/10min (x100) | jumps>=10c | on-day move/10min (x100)");
for (let h = 0; h < 24; h++)
  console.log(
    String(h).padStart(2, "0") + "Z",
    (100 * preHour[h] / preCnt[h]).toFixed(2).padStart(7),
    String(preJumps[h]).padStart(6),
    (100 * dayHour[h] / dayCnt[h]).toFixed(2).padStart(9),
  );
console.log("\nprice of eventual winner (mean / median / share>=0.5):");
for (const [k, a] of Object.entries(winnerAt)) {
  const s = [...a].sort((x, y) => x - y);
  console.log(k.padEnd(8), a.length, mean(a).toFixed(3), s[Math.floor(s.length / 2)].toFixed(3), (a.filter((x) => x >= 0.5).length / a.length).toFixed(2));
}
for (const [k, a] of Object.entries(brier)) console.log("brier", k, mean(a).toFixed(3));
