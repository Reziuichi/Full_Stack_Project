// The land a destination stands on, as a survey: a real heightfield (built
// by scripts/build-survey.ts from open elevation tiles) smoothed of building
// speckle, with its sea marked, contour lines traced at even heights, and
// helpers to place landmarks and sample a route across it. Without a survey
// file it falls back to a quiet procedural relief, so the page never waits
// on missing data.

export type V3 = [number, number, number];

/** The terrain spans SIZE world units on each side, centred on the origin (x east, z south). */
export const SIZE = 8;
/** The tallest land, in world units: every city's relief is scaled to read clearly. */
export const RELIEF = 1.5;

export type Survey = {
  grid: number;
  /** Visual height of each cell, in world units (0 at the sea or the lowest land). */
  y: Float32Array;
  /** Real elevation of each cell, in metres. */
  meters: Float32Array;
  /** 1 where the cell is sea. */
  water: Uint8Array;
  /** Steepness of each cell, 0..1. */
  slope: Float32Array;
  min: number;
  max: number;
  sideMeters: number;
  zoom: number;
  square: [number, number, number];
  real: boolean;
};

type SurveyFile = { grid: number; zoom: number; square: [number, number, number]; sideMeters: number; min: number; max: number; data: string };

const TILE = 256;
const toPixel = (lat: number, lng: number, z: number) => {
  const n = TILE * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n] as const;
};

/** A separable box blur, `passes` times (three passes is close to a gaussian). */
function blur(src: Float32Array, G: number, r: number, passes: number) {
  const a = src.slice();
  const b = new Float32Array(G * G);
  const k = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < G; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[y * G + Math.min(G - 1, Math.max(0, x))];
      for (let x = 0; x < G; x++) {
        b[y * G + x] = acc * k;
        acc += a[y * G + Math.min(G - 1, x + r + 1)] - a[y * G + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < G; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.min(G - 1, Math.max(0, y)) * G + x];
      for (let y = 0; y < G; y++) {
        a[y * G + x] = acc * k;
        acc += b[Math.min(G - 1, y + r + 1) * G + x] - b[Math.max(0, y - r) * G + x];
      }
    }
  }
  return a;
}

function build(G: number, metersRaw: Float32Array, info: Omit<Survey, "grid" | "y" | "meters" | "water" | "slope" | "min" | "max">): Survey {
  let min = Infinity;
  let max = -Infinity;
  for (const v of metersRaw) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  // Flat cities carry speckle from buildings and trees: smooth it more where the land itself is gentle.
  const range = max - min;
  const meters = blur(metersRaw, G, range < 400 ? 2 : 1, range < 400 ? 3 : 2);
  const water = new Uint8Array(G * G);
  let landMin = Infinity;
  let landMax = -Infinity;
  for (let i = 0; i < G * G; i++) {
    if (metersRaw[i] <= 0.5 && min < 0.5) water[i] = 1;
    else {
      landMin = Math.min(landMin, meters[i]);
      landMax = Math.max(landMax, meters[i]);
    }
  }
  if (!Number.isFinite(landMin)) {
    landMin = 0;
    landMax = 1;
  }
  const floor = min < 0.5 ? Math.min(0, landMin) : landMin;
  const span = Math.max(landMax - floor, 140);
  const y = new Float32Array(G * G);
  for (let i = 0; i < G * G; i++) y[i] = water[i] ? 0 : Math.max(0, ((meters[i] - floor) / span) * RELIEF);
  const slope = new Float32Array(G * G);
  const cell = SIZE / (G - 1);
  let top = 1e-6;
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const dx = y[j * G + Math.min(G - 1, i + 1)] - y[j * G + Math.max(0, i - 1)];
      const dz = y[Math.min(G - 1, j + 1) * G + i] - y[Math.max(0, j - 1) * G + i];
      const s = Math.hypot(dx, dz) / (2 * cell);
      slope[j * G + i] = s;
      top = Math.max(top, s);
    }
  }
  const norm = Math.min(top, 1.6);
  for (let i = 0; i < G * G; i++) slope[i] = Math.min(1, slope[i] / norm);
  return { ...info, grid: G, y, meters, water, slope, min, max };
}

const loaded = new Map<string, Promise<Survey>>();

/** The survey for a destination (fetched once per page): its file if there is one, otherwise a procedural stand-in. */
export function loadSurvey(slug: string, seed: number): Promise<Survey> {
  let p = loaded.get(slug);
  if (!p) {
    p = fetchSurvey(slug, seed);
    loaded.set(slug, p);
  }
  return p;
}

async function fetchSurvey(slug: string, seed: number): Promise<Survey> {
  try {
    const res = await fetch(`/survey/${slug}.json`);
    if (!res.ok) throw new Error(String(res.status));
    const f = (await res.json()) as SurveyFile;
    const bin = atob(f.data);
    const q = new Uint16Array(f.grid * f.grid);
    for (let i = 0; i < q.length; i++) q[i] = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
    const m = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) m[i] = f.min + (q[i] / 65535) * (f.max - f.min);
    return build(f.grid, m, { sideMeters: f.sideMeters, zoom: f.zoom, square: f.square, real: true });
  } catch {
    return procedural(seed);
  }
}

function procedural(seed: number): Survey {
  const G = 160;
  const m = new Float32Array(G * G);
  const hash = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 0.013) * 43758.5453;
    return s - Math.floor(s);
  };
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      let f = 0;
      let amp = 1;
      let fr = 3 / G;
      for (let o = 0; o < 5; o++) {
        f += noise(i * fr, j * fr) * amp;
        amp *= 0.5;
        fr *= 2;
      }
      m[j * G + i] = 20 + f * 90;
    }
  }
  return build(G, m, { sideMeters: 10000, zoom: 12, square: [0, 0, 1], real: false });
}

/** Where a point lies on the survey: u east, v south, both 0..1 (clamped). */
export function uvOf(s: Survey, lat: number, lng: number, center: [number, number]): [number, number] {
  if (!s.real) {
    // The stand-in has no real extent: spread the points round the middle by their offsets.
    const k = Math.cos((center[0] * Math.PI) / 180);
    const u = 0.5 + ((lng - center[1]) * 111320 * k) / s.sideMeters;
    const v = 0.5 - ((lat - center[0]) * 111320) / s.sideMeters;
    return [Math.min(0.96, Math.max(0.04, u)), Math.min(0.96, Math.max(0.04, v))];
  }
  const [px, py] = toPixel(lat, lng, s.zoom);
  const [cx, cy, side] = s.square;
  return [Math.min(0.98, Math.max(0.02, (px - (cx - side / 2)) / side)), Math.min(0.98, Math.max(0.02, (py - (cy - side / 2)) / side))];
}

const sample = (s: Survey, field: Float32Array, u: number, v: number) => {
  const G = s.grid;
  const x = Math.min(G - 1.001, Math.max(0, u * (G - 1)));
  const y = Math.min(G - 1.001, Math.max(0, v * (G - 1)));
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const a = field[j * G + i];
  const b = field[j * G + i + 1];
  const c = field[(j + 1) * G + i];
  const d = field[(j + 1) * G + i + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
};
export const heightAt = (s: Survey, u: number, v: number) => sample(s, s.y, u, v);
export const metersAt = (s: Survey, u: number, v: number) => sample(s, s.meters, u, v);
export const worldOf = (s: Survey, u: number, v: number, lift = 0): V3 => [(u - 0.5) * SIZE, heightAt(s, u, v) + lift, (v - 0.5) * SIZE];

/**
 * Contour lines by marching squares, `levels` evenly spaced through the
 * relief: segments as [x, y, z] pairs, with each segment's level (0..1).
 */
export function contours(s: Survey, levels: number, step = 1) {
  const G = s.grid;
  const out: number[] = [];
  const lv: number[] = [];
  let top = 0;
  for (const v of s.y) top = Math.max(top, v);
  const cell = SIZE / (G - 1);
  for (let k = 1; k <= levels; k++) {
    const iso = (k / (levels + 1)) * top;
    for (let j = 0; j < G - step; j += step) {
      for (let i = 0; i < G - step; i += step) {
        const a = s.y[j * G + i];
        const b = s.y[j * G + i + step];
        const c = s.y[(j + step) * G + i + step];
        const d = s.y[(j + step) * G + i];
        const idx = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (c > iso ? 2 : 0) | (d > iso ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const x0 = (i / (G - 1) - 0.5) * SIZE;
        const z0 = (j / (G - 1) - 0.5) * SIZE;
        const w = cell * step;
        const t = (p: number, q: number) => (iso - p) / (q - p || 1e-6);
        const top_: [number, number] = [x0 + w * t(a, b), z0];
        const right: [number, number] = [x0 + w, z0 + w * t(b, c)];
        const bottom: [number, number] = [x0 + w * t(d, c), z0 + w];
        const left: [number, number] = [x0, z0 + w * t(a, d)];
        const seg = (p: [number, number], q: [number, number]) => {
          out.push(p[0], iso, p[1], q[0], iso, q[1]);
          lv.push(k / (levels + 1), k / (levels + 1));
        };
        switch (idx) {
          case 1:
          case 14:
            seg(left, bottom);
            break;
          case 2:
          case 13:
            seg(bottom, right);
            break;
          case 3:
          case 12:
            seg(left, right);
            break;
          case 4:
          case 11:
            seg(top_, right);
            break;
          case 5:
            seg(left, top_);
            seg(bottom, right);
            break;
          case 6:
          case 9:
            seg(top_, bottom);
            break;
          case 7:
          case 8:
            seg(left, top_);
            break;
          case 10:
            seg(top_, right);
            seg(left, bottom);
            break;
        }
      }
    }
  }
  return { pos: new Float32Array(out), level: new Float32Array(lv), top };
}

/** The route between landmarks in order, hugging the land: points, distances in metres, elevations. */
export function route(s: Survey, stops: [number, number][], perLeg = 64) {
  const pts: V3[] = [];
  const dist: number[] = [];
  const elev: number[] = [];
  const legEnds: number[] = [];
  let run = 0;
  for (let k = 0; k < stops.length; k++) {
    if (k === 0) {
      pts.push(worldOf(s, stops[0][0], stops[0][1], 0.025));
      dist.push(0);
      elev.push(metersAt(s, stops[0][0], stops[0][1]));
      legEnds.push(0);
      continue;
    }
    const [u0, v0] = stops[k - 1];
    const [u1, v1] = stops[k];
    const legMeters = Math.hypot(u1 - u0, v1 - v0) * s.sideMeters;
    for (let i = 1; i <= perLeg; i++) {
      const t = i / perLeg;
      const u = u0 + (u1 - u0) * t;
      const v = v0 + (v1 - v0) * t;
      pts.push(worldOf(s, u, v, 0.025));
      dist.push(run + legMeters * t);
      elev.push(metersAt(s, u, v));
    }
    run += legMeters;
    legEnds.push(pts.length - 1);
  }
  return { pts, dist, elev, legEnds, total: run };
}
