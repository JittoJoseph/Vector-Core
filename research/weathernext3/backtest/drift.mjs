import fs from "fs";
const events = JSON.parse(fs.readFileSync("reprice-events.json", "utf8"));
const STEP = 600;

function align(ev) {
  const all = ev.buckets.flatMap((b) => b.h.map((x) => x.t));
  const start = Math.ceil(Math.min(...all) / STEP) * STEP;
  const end = Math.max(...all);
  return ev.buckets.map((b) => {
    const out = [];
    let j = 0, last = b.h[0]?.p ?? 0;
    for (let t = start; t <= end; t += STEP) {
      while (j < b.h.length && b.h[j].t <= t) last = b.h[j++].p;
      out.push(last);
    }
    return { start, s: out, win: b.win };
  });
}

const res = [];
for (const ev of events) {
  if (!ev.buckets[0]?.h.length) continue;
  const bs = align(ev);
  const ds = ev.dayStart / 1000;
  for (const b of bs) {
    for (let i = 6; i + 36 < b.s.length; i += 3) {
      const t = b.start + i * STEP;
      if (t + 36 * STEP > ds) break;
      const jump = b.s[i] - b.s[i - 6];
      if (Math.abs(jump) < 0.05) continue;
      if (b.s[i] < 0.05 || b.s[i] > 0.95) continue;
      res.push({
        jump,
        h1: b.s[i + 6] - b.s[i],
        h3: b.s[i + 18] - b.s[i],
        h6: b.s[i + 36] - b.s[i],
        toFinal: (b.win ? 1 : 0) - b.s[i],
        hour: new Date(t * 1000).getUTCHours(),
      });
    }
  }
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sgn = (x) => Math.sign(x);
function summarize(label, rows) {
  const cont = (k) => mean(rows.map((r) => sgn(r.jump) * r[k]));
  const hit = (k) => rows.filter((r) => sgn(r[k]) === sgn(r.jump)).length / rows.length;
  console.log(
    label.padEnd(26), String(rows.length).padStart(6),
    "cont+1h", (100 * cont("h1")).toFixed(2).padStart(6),
    "+3h", (100 * cont("h3")).toFixed(2).padStart(6),
    "+6h", (100 * cont("h6")).toFixed(2).padStart(6),
    "toFinal", (100 * cont("toFinal")).toFixed(2).padStart(6),
    "sameDir6h", hit("h6").toFixed(2),
  );
}
console.log("signed continuation after a >=5c 1h move (cents, positive = drift continues)");
summarize("all jumps", res);
summarize("jumps 05-07Z (model burst)", res.filter((r) => r.hour >= 5 && r.hour <= 7));
summarize("jumps other hours", res.filter((r) => r.hour < 5 || r.hour > 7));
summarize("up jumps", res.filter((r) => r.jump > 0));
summarize("down jumps", res.filter((r) => r.jump < 0));
summarize("big jumps >=10c", res.filter((r) => Math.abs(r.jump) >= 0.1));
