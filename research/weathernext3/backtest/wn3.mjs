import { execSync } from "child_process";
import zlib from "zlib";

const GCLOUD = `"${process.env.LOCALAPPDATA}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd"`;
let token = null, tokenAt = 0;
function auth() {
  if (!token || Date.now() - tokenAt > 30 * 60_000) {
    token = execSync(`${GCLOUD} auth print-access-token`, { encoding: "utf8" }).trim();
    tokenAt = Date.now();
  }
  return token;
}

const BUCKET = "weathernext3_statistics_spatial";
const ROOT = "weathernext_3_0_0_statistics/zarr/2026_to_present";
export const initKey = (d) =>
  `${d.toISOString().slice(0, 10).replace(/-/g, "")}_${String(d.getUTCHours()).padStart(2, "0")}hr_01_preds`;
const url = (path) =>
  `https://storage.googleapis.com/${BUCKET}/${ROOT}/${path}`;

export async function fetchBytes(path) {
  const r = await fetch(url(path), { headers: { Authorization: `Bearer ${auth()}` } });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return Buffer.from(await r.arrayBuffer());
}

export async function exists(path) {
  const r = await fetch(url(path), { method: "HEAD", headers: { Authorization: `Bearer ${auth()}` } });
  return r.ok;
}

export async function readSmallArray(init, name, type = Float32Array) {
  const raw = zlib.zstdDecompressSync(await fetchBytes(`${init}/predictions.zarr/${name}/c/0`));
  return new type(raw.buffer, raw.byteOffset, raw.byteLength / type.BYTES_PER_ELEMENT);
}

export async function streamRows(init, variable, lead, cells, ncols = 7200) {
  const maxRow = Math.max(...cells.map((c) => c.row));
  const needBytes = (maxRow + 1) * ncols * 4;
  const r = await fetch(url(`${init}/predictions.zarr/${variable}/c/${lead}/0/0`), {
    headers: { Authorization: `Bearer ${auth()}` },
  });
  if (!r.ok) throw new Error(`${r.status} ${variable} ${lead}`);
  const dec = zlib.createZstdDecompress();
  const parts = [];
  let have = 0, compressed = 0;
  const reader = r.body.getReader();
  const done = new Promise((resolve, reject) => {
    dec.on("data", (b) => {
      parts.push(b);
      have += b.length;
      if (have >= needBytes) resolve();
    });
    dec.on("end", resolve);
    dec.on("error", reject);
  });
  (async () => {
    while (have < needBytes) {
      const { value, done: d } = await reader.read();
      if (d) { dec.end(); break; }
      compressed += value.length;
      dec.write(value);
    }
  })().catch(() => {});
  await done;
  reader.cancel().catch(() => {});
  dec.destroy();
  const buf = Buffer.concat(parts);
  const out = cells.map((c) => {
    const off = (c.row * ncols + c.col) * 4;
    return buf.readFloatLE(off);
  });
  return { values: out, compressed, decompressed: have };
}
