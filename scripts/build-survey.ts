// Builds the topographic surveys the destination pages draw: for each
// destination, a square of real terrain round the city and its landmarks,
// sampled from the open AWS Terrain Tiles (Terrarium PNGs: elevation =
// R * 256 + G + B / 256 - 32768 metres) into a 200 x 200 heightfield.
//
//   npx tsx scripts/build-survey.ts            (all destinations)
//   npx tsx scripts/build-survey.ts paris      (one)
//
// Writes public/survey/<slug>.json. Data: Mapzen / AWS Terrain Tiles (SRTM,
// GMTED, ETOPO1, EU-DEM and others; see https://registry.opendata.aws/terrain-tiles).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { destinations } from "../src/data/catalog";

const GRID = 200;
const OUT = join(process.cwd(), "public", "survey");
const TILE = 256;

type Png = { w: number; h: number; bpp: number; px: Uint8Array };

/** A small PNG decoder for 8-bit RGB / RGBA, non-interlaced (what the tiles are). */
function decodePng(buf: Buffer): Png {
  let o = 8;
  let w = 0;
  let h = 0;
  let colorType = 2;
  const idat: Buffer[] = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString("ascii", o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error("unsupported PNG");
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    o += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = new Uint8Array(w * h * bpp);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const cur = y * stride;
    const prev = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x];
      const a = x >= bpp ? px[cur + x - bpp] : 0;
      const b = y > 0 ? px[prev + x] : 0;
      const c = x >= bpp && y > 0 ? px[prev + x - bpp] : 0;
      let out: number;
      if (filter === 0) out = v;
      else if (filter === 1) out = v + a;
      else if (filter === 2) out = v + b;
      else if (filter === 3) out = v + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      px[cur + x] = out & 255;
    }
  }
  return { w, h, bpp, px };
}

/** Global Web Mercator pixel coordinates at a zoom. */
const toPixel = (lat: number, lng: number, z: number) => {
  const n = TILE * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n] as const;
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tile(z: number, x: number, y: number, cache: Map<string, Png>) {
  const key = `${z}/${x}/${y}`;
  const hit = cache.get(key);
  if (hit) return hit;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`);
      if (!res.ok) throw new Error(`${res.status}`);
      const png = decodePng(Buffer.from(await res.arrayBuffer()));
      cache.set(key, png);
      return png;
    } catch (error) {
      if (attempt === 3) throw error;
      await wait(800 * (attempt + 1));
    }
  }
  throw new Error("unreachable");
}

async function survey(slug: string) {
  const d = destinations.find((x) => x.slug === slug);
  if (!d) throw new Error(`no destination ${slug}`);
  const pts = [{ lat: d.lat, lng: d.lng }, ...d.attractions.map((a) => ({ lat: a.lat, lng: a.lng }))];
  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lng0 = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  // The square: the landmarks' spread, half again for context, and never smaller than 7 km or larger than 46 km.
  const span = Math.max(...pts.map((p) => Math.max(Math.abs(p.lat - lat0) * 111320, Math.abs(p.lng - lng0) * 111320 * k))) * 2;
  const side = Math.min(46000, Math.max(7000, span * 1.6 + 3000));
  const mpp = (z: number) => (156543.03 * k) / 2 ** z;
  const zoom = Math.max(8, Math.min(14, Math.floor(Math.log2((156543.03 * k * 520) / side))));
  const [cx, cy] = toPixel(lat0, lng0, zoom);
  const sidePx = side / mpp(zoom);
  const cache = new Map<string, Png>();
  const elev = async (gx: number, gy: number) => {
    const tx = Math.floor(gx / TILE);
    const ty = Math.floor(gy / TILE);
    const t = await tile(zoom, tx, ty, cache);
    const lx = Math.min(TILE - 1, Math.max(0, Math.floor(gx - tx * TILE)));
    const ly = Math.min(TILE - 1, Math.max(0, Math.floor(gy - ty * TILE)));
    const o = (ly * t.w + lx) * t.bpp;
    return t.px[o] * 256 + t.px[o + 1] + t.px[o + 2] / 256 - 32768;
  };
  const values = new Float32Array(GRID * GRID);
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const gx = cx + (i / (GRID - 1) - 0.5) * sidePx;
      const gy = cy + (j / (GRID - 1) - 0.5) * sidePx;
      // Bilinear across the four pixels round the sample.
      const x0 = Math.floor(gx - 0.5);
      const y0 = Math.floor(gy - 0.5);
      const fx = gx - 0.5 - x0;
      const fy = gy - 0.5 - y0;
      const a = await elev(x0, y0);
      const b = await elev(x0 + 1, y0);
      const c = await elev(x0, y0 + 1);
      const e = await elev(x0 + 1, y0 + 1);
      values[j * GRID + i] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
    }
  }
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  const q = new Uint16Array(GRID * GRID);
  for (let i = 0; i < values.length; i++) q[i] = Math.round(((values[i] - min) / Math.max(1e-6, max - min)) * 65535);
  const out = {
    slug,
    grid: GRID,
    zoom,
    center: [lat0, lng0],
    // Global pixel square at `zoom`: [x, y] of its centre and its side, for placing landmarks.
    square: [cx, cy, sidePx],
    sideMeters: Math.round(side),
    min: Math.round(min * 10) / 10,
    max: Math.round(max * 10) / 10,
    data: Buffer.from(q.buffer).toString("base64"),
  };
  writeFileSync(join(OUT, `${slug}.json`), JSON.stringify(out));
  console.log(`${slug}: z${zoom}, ${(side / 1000).toFixed(1)} km, ${out.min}..${out.max} m, ${cache.size} tiles`);
}

mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
for (const d of destinations) {
  if (only.length && !only.includes(d.slug)) continue;
  await survey(d.slug);
}
