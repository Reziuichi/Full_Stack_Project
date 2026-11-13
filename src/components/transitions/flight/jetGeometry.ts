import { add, cross, dot, normalize, scale, sub, type V3 } from "./math";

/**
 * A twin-engine long-haul airliner (about A350-900 proportions), lofted in
 * code: an elliptical-section fuselage with a drooped nose and upswept tail
 * cone; NACA-section wings with a trailing-edge kink, dihedral, in-flight
 * flex and curved winglets; tailplanes and fin; lathed nacelles with a
 * polished lip, fan face, spinner and exhaust plug; pylons; flap-track
 * fairings. Metres. Model axes: x = right wing, y = up, z = forward (nose).
 */

export const MAT = { body: 0, wing: 1, cowl: 2, chrome: 3, dark: 4, livery: 5, metal: 6 } as const;

export type JetMesh = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  mats: Float32Array;
  indices: Uint32Array;
};

/** Where the contrails start (nozzle exits), model space, right engine. */
export const EXHAUST: V3 = [9.4, -3.0, -1.9];
/** Model-space anchor points for the lights. */
export const LIGHTS = {
  navRight: [30.3, 2.2, -11.5] as V3,
  strobeRight: [30.4, 2.15, -14.3] as V3,
  tail: [0, 1.78, -33.4] as V3,
  beacon: [0, 3.02, 1.5] as V3,
};
export const JET_LENGTH = 66.8;
export const JET_SPAN = 63.8;

type Surface = { rows: V3[][]; normals: V3[][]; mat: (i: number, j: number) => number; uv: (i: number, j: number) => [number, number] };

const R = 2.98; // fuselage radius

// ---------------------------------------------------------------- helpers

function centroid(ps: V3[]): V3 {
  const c: V3 = [0, 0, 0];
  for (const p of ps) {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  return scale(c, 1 / ps.length);
}

/** Normals for a grid closed around j (last column repeats the first), oriented outward. */
function gridNormals(rows: V3[][]): V3[][] {
  const ni = rows.length;
  const nj = rows[0].length;
  const m = nj - 1;
  const raw = rows.map((row, i) =>
    row.map((_, j) => {
      const jp = j === 0 ? m - 1 : j - 1;
      const jn = j === m ? 1 : j + 1;
      const du = sub(rows[i][jn], rows[i][jp]);
      const dv = sub(rows[Math.min(ni - 1, i + 1)][j], rows[Math.max(0, i - 1)][j]);
      return cross(dv, du);
    }),
  );
  const mid = Math.floor(ni / 2);
  const c = centroid(rows[mid].slice(0, m));
  let s = 0;
  for (let j = 0; j < m; j++) s += dot(raw[mid][j], sub(rows[mid][j], c));
  const flip = s < 0 ? -1 : 1;
  return raw.map((row) => row.map((n) => normalize(scale(n, flip))));
}

/** A surface of revolution. The profile's left-hand normal (in d, r) is outward. */
function lathe(profile: { d: number; r: number; mat: number }[], origin: V3, axis: V3, sides = 44): Surface {
  const a = normalize(axis);
  const e1 = normalize(Math.abs(a[1]) < 0.9 ? cross(a, [0, 1, 0]) : cross(a, [1, 0, 0]));
  const e2 = cross(a, e1);
  const rows: V3[][] = [];
  const normals: V3[][] = [];
  profile.forEach((p, k) => {
    const prev = profile[Math.max(0, k - 1)];
    const next = profile[Math.min(profile.length - 1, k + 1)];
    const td = next.d - prev.d;
    const tr = next.r - prev.r;
    const l = Math.hypot(td, tr) || 1;
    const nd = -tr / l;
    const nr = td / l;
    const row: V3[] = [];
    const nrow: V3[] = [];
    for (let j = 0; j <= sides; j++) {
      const phi = (j / sides) * Math.PI * 2;
      const radial = add(scale(e1, Math.cos(phi)), scale(e2, Math.sin(phi)));
      row.push(add(add(origin, scale(a, p.d)), scale(radial, p.r)));
      nrow.push(normalize(add(scale(a, nd), scale(radial, nr))));
    }
    rows.push(row);
    normals.push(nrow);
  });
  return { rows, normals, mat: (i) => profile[i].mat, uv: (i, j) => [j / sides, profile[i].d] };
}

/** NACA 4-digit half-thickness (closed trailing edge). */
const nacaT = (x: number, t: number) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
/** A gentle camber line (2% at 40% chord). */
const camber = (x: number, m: number) => (x < 0.4 ? (m / 0.16) * (0.8 * x - x * x) : (m / 0.36) * (0.2 + 0.8 * x - x * x));

type Station = { le: V3; chord: number; t: number; up: V3; span: number; mat: number; camber?: number };

/** A lifting surface lofted through airfoil stations (chord runs along -z). */
function lift(stations: Station[], nc = 20): Surface {
  const xs: number[] = [];
  for (let k = 0; k <= nc; k++) xs.push((1 - Math.cos((k / nc) * Math.PI)) / 2);
  const rows = stations.map((s) => {
    const loop: V3[] = [];
    const pt = (x: number, upper: boolean) => {
      const y = camber(x, s.camber ?? 0) + (upper ? 1 : -1) * nacaT(x, s.t);
      return add(add(s.le, [0, 0, -x * s.chord]), scale(s.up, y * s.chord));
    };
    for (let k = nc; k >= 0; k--) loop.push(pt(xs[k], true)); // TE -> LE along the top
    for (let k = 1; k <= nc; k++) loop.push(pt(xs[k], false)); // LE -> TE along the bottom
    return loop;
  });
  const cf = (j: number) => xs[j <= nc ? nc - j : j - nc];
  return { rows, normals: gridNormals(rows), mat: (i) => stations[i].mat, uv: (i, j) => [cf(j), stations[i].span] };
}

const mirror = (s: Surface): Surface => ({
  rows: s.rows.map((r) => r.map((p) => [-p[0], p[1], p[2]] as V3)),
  normals: s.normals.map((r) => r.map((n) => [-n[0], n[1], n[2]] as V3)),
  mat: s.mat,
  uv: s.uv,
});

// ------------------------------------------------------------- the parts

function fuselageSection(z: number): { c: number; a: number; b: number } {
  if (z > 22) {
    const t = Math.min(1, (z - 22) / 11.3);
    const top = -0.35 + (R + 0.35) * Math.sqrt(Math.max(0, 1 - t ** 2.3));
    const bot = -0.35 - (R - 0.35) * Math.sqrt(Math.max(0, 1 - t ** 2));
    const a = R * Math.sqrt(Math.max(0, 1 - t ** 2.2));
    return { c: (top + bot) / 2, a: Math.max(a, 0.03), b: Math.max((top - bot) / 2, 0.03) };
  }
  if (z < -14) {
    const t = Math.min(1, (-14 - z) / 19.3);
    const top = R - 1.0 * t ** 1.6;
    const bot = -R + (R + 1.55) * t ** 1.35;
    return { c: (top + bot) / 2, a: R * (1 - 0.9 * t ** 1.2), b: (top - bot) / 2 };
  }
  return { c: 0, a: R, b: R };
}

function fuselage(): Surface {
  const zs: number[] = [-33.42];
  for (let k = 0; k <= 16; k++) zs.push(-33.3 + 19.3 * (1 - Math.cos((k / 16) * (Math.PI / 2))) ** 0.9);
  for (let z = -11; z < 22; z += 3) zs.push(z);
  for (let k = 0; k <= 18; k++) zs.push(22 + 11.3 * (1 - (1 - k / 18) ** 1.7));
  const sides = 56;
  const rows = zs.map((z, i) => {
    const s = i === 0 ? { c: 1.76, a: 0.02, b: 0.02 } : fuselageSection(z);
    const row: V3[] = [];
    for (let j = 0; j <= sides; j++) {
      const th = (j / sides) * Math.PI * 2;
      row.push([s.a * Math.sin(th), s.c + s.b * Math.cos(th), z]);
    }
    return row;
  });
  return { rows, normals: gridNormals(rows), mat: (i) => (i <= 1 ? MAT.dark : MAT.body), uv: (i, j) => [j / sides, zs[i]] };
}

const TAN_IN = 0.65;
const TAN_OUT = 0.66;
const X_ROOT = 1.8;
const X_KINK = 11;
const X_TIP = 30.2;
const wingLE = (x: number) => (x <= X_KINK ? 7.0 - (x - X_ROOT) * TAN_IN : 7.0 - (X_KINK - X_ROOT) * TAN_IN - (x - X_KINK) * TAN_OUT);
const TE_KINK = -6.2;
const TE_TIP = wingLE(X_TIP) - 2.7;
const wingTE = (x: number) => (x <= X_KINK ? -6.4 + ((x - X_ROOT) / (X_KINK - X_ROOT)) * 0.2 : TE_KINK + ((x - X_KINK) / (X_TIP - X_KINK)) * (TE_TIP - TE_KINK));
const wingY = (x: number) => -1.55 + (x - X_ROOT) * 0.0963 + 0.0011 * (x - X_ROOT) ** 2;
const wingT = (x: number) => (x <= X_KINK ? 0.15 - ((x - X_ROOT) / (X_KINK - X_ROOT)) * 0.04 : 0.11 - ((x - X_KINK) / (X_TIP - X_KINK)) * 0.02);

function wing(): Surface {
  const stations: Station[] = [];
  for (const x of [X_ROOT, 3.2, 5, 7, 9, X_KINK, 13.5, 16, 18.5, 21, 23.5, 26, 28, 29.4, X_TIP]) {
    stations.push({ le: [x, wingY(x), wingLE(x)], chord: wingLE(x) - wingTE(x), t: wingT(x), up: [0, 1, 0], span: x - X_ROOT, mat: MAT.wing, camber: 0.02 });
  }
  // The curved winglet: a bend of radius 1.2 m, then straight to the tip.
  const y0 = wingY(X_TIP);
  const z0 = wingLE(X_TIP);
  const PHI = 1.25;
  const RB = 1.2;
  const STRAIGHT = 1.8;
  const total = RB * PHI + STRAIGHT;
  for (const w of [0.12, 0.26, 0.42, 0.6, 0.8, 1]) {
    const l = w * total;
    let x: number;
    let y: number;
    let phi: number;
    if (l <= RB * PHI) {
      phi = l / RB;
      x = X_TIP + RB * Math.sin(phi);
      y = y0 + RB * (1 - Math.cos(phi));
    } else {
      phi = PHI;
      const e = l - RB * PHI;
      x = X_TIP + RB * Math.sin(PHI) + e * Math.cos(PHI);
      y = y0 + RB * (1 - Math.cos(PHI)) + e * Math.sin(PHI);
    }
    stations.push({
      le: [x, y, z0 - 2.3 * w ** 1.3],
      chord: 2.7 - 1.8 * w,
      t: 0.09 - 0.012 * w,
      up: [-Math.sin(phi), Math.cos(phi), 0],
      span: X_TIP - X_ROOT + l,
      mat: MAT.livery,
    });
  }
  const last = stations[stations.length - 1];
  stations.push({ ...last, le: add(last.le, [Math.cos(PHI) * 0.02, Math.sin(PHI) * 0.02, -0.01]), t: 0 });
  return lift(stations, 22);
}

function stabilizer(): Surface {
  const stations: Station[] = [];
  for (const x of [0.3, 2.5, 4.8, 7.1, 9.0, 9.4]) {
    const f = (x - 0.3) / 9.1;
    stations.push({ le: [x, 1.35 + (x - 0.3) * 0.123, -24.5 - (x - 0.3) * 0.727], chord: 7.0 - f * 4.4, t: 0.1, up: [0, 1, 0], span: x, mat: MAT.wing });
  }
  const last = stations[stations.length - 1];
  stations.push({ ...last, le: add(last.le, [0.03, 0, -0.02]), t: 0 });
  return lift(stations, 16);
}

function fin(): Surface {
  const stations: Station[] = [];
  for (const y of [2.0, 4.2, 6.4, 8.6, 10.8, 12.5, 12.8]) {
    const f = (y - 2) / 10.8;
    stations.push({ le: [0, y, -18.8 - (y - 2) * 0.9], chord: 10 - f * 6.4, t: 0.1, up: [1, 0, 0], span: y, mat: MAT.livery });
  }
  const last = stations[stations.length - 1];
  stations.push({ ...last, le: add(last.le, [0, 0.03, -0.02]), t: 0 });
  return lift(stations, 16);
}

const NAC: V3 = [EXHAUST[0], -3.0, 6.9];

function nacelle(): Surface[] {
  const c = MAT.cowl;
  const cowl = lathe(
    [
      { d: 1.35, r: 1.3, mat: MAT.dark },
      { d: 0.9, r: 1.31, mat: MAT.dark },
      { d: 0.35, r: 1.32, mat: MAT.chrome },
      { d: 0.08, r: 1.33, mat: MAT.chrome },
      { d: 0.0, r: 1.4, mat: MAT.chrome },
      { d: 0.06, r: 1.49, mat: MAT.chrome },
      { d: 0.28, r: 1.54, mat: c },
      { d: 1.0, r: 1.585, mat: c },
      { d: 2.2, r: 1.6, mat: c },
      { d: 3.6, r: 1.56, mat: c },
      { d: 5.0, r: 1.45, mat: c },
      { d: 6.2, r: 1.28, mat: c },
      { d: 7.0, r: 1.12, mat: MAT.metal },
      { d: 7.9, r: 0.95, mat: MAT.metal },
      { d: 8.35, r: 0.86, mat: MAT.metal },
      { d: 8.3, r: 0.8, mat: MAT.dark },
      { d: 7.2, r: 0.82, mat: MAT.dark },
    ],
    NAC,
    [0, 0, -1],
  );
  const plug = lathe(
    [
      { d: 7.3, r: 0.64, mat: MAT.metal },
      { d: 8.2, r: 0.6, mat: MAT.metal },
      { d: 9.0, r: 0.42, mat: MAT.metal },
      { d: 9.8, r: 0.13, mat: MAT.metal },
      { d: 9.98, r: 0.02, mat: MAT.metal },
    ],
    NAC,
    [0, 0, -1],
    28,
  );
  const fan = lathe(
    [
      { d: 1.35, r: 0.5, mat: MAT.dark },
      { d: 1.35, r: 1.3, mat: MAT.dark },
    ],
    NAC,
    [0, 0, -1],
    32,
  );
  const spinner = lathe(
    [
      { d: 0.52, r: 0.02, mat: MAT.metal },
      { d: 0.8, r: 0.26, mat: MAT.metal },
      { d: 1.1, r: 0.43, mat: MAT.metal },
      { d: 1.35, r: 0.5, mat: MAT.metal },
    ],
    NAC,
    [0, 0, -1],
    28,
  );
  const pylon = lift(
    [-2.2, -1.6, -0.9].map((y) => ({ le: [NAC[0], y, 5.3] as V3, chord: 9.6, t: 0.075, up: [1, 0, 0] as V3, span: y, mat: MAT.wing })),
    12,
  );
  return [cowl, plug, fan, spinner, pylon];
}

function flapFairings(): Surface[] {
  return [13.5, 18.5, 23.5].map((x) => {
    const chord = wingLE(x) - wingTE(x);
    const front = wingTE(x) + chord * 0.45;
    const len = chord * 0.45 + 2.0;
    return lathe(
      [
        { d: 0, r: 0.02, mat: MAT.wing },
        { d: 0.45, r: 0.22, mat: MAT.wing },
        { d: len * 0.4, r: 0.34, mat: MAT.wing },
        { d: len * 0.8, r: 0.24, mat: MAT.wing },
        { d: len, r: 0.03, mat: MAT.wing },
      ],
      [x, wingY(x) - 0.28, front],
      [0, -0.06, -1],
      16,
    );
  });
}

// ---------------------------------------------------------------- build

let cached: JetMesh | null = null;

export function buildJet(): JetMesh {
  if (cached) return cached;
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const mat: number[] = [];
  const idx: number[] = [];
  const push = (s: Surface) => {
    const base = pos.length / 3;
    const ni = s.rows.length;
    const nj = s.rows[0].length;
    for (let i = 0; i < ni; i++) {
      for (let j = 0; j < nj; j++) {
        pos.push(...s.rows[i][j]);
        nrm.push(...s.normals[i][j]);
        uv.push(...s.uv(i, j));
        mat.push(s.mat(i, j));
      }
    }
    for (let i = 0; i < ni - 1; i++) {
      for (let j = 0; j < nj - 1; j++) {
        const a = base + i * nj + j;
        const b = a + nj;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  };
  push(fuselage());
  push(fin());
  for (const s of [wing(), stabilizer(), ...nacelle(), ...flapFairings()]) {
    push(s);
    push(mirror(s));
  }
  cached = {
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    uvs: new Float32Array(uv),
    mats: new Float32Array(mat),
    indices: new Uint32Array(idx),
  };
  return cached;
}
