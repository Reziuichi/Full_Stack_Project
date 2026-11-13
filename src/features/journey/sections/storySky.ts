// The night sky behind the destination story's outro: a field of stars, and
// the landmarks you just scrolled through laid out as a constellation.
// Everything here is deterministic (seeded), so the server and the browser
// render exactly the same sky.

/** mulberry32: a tiny seeded PRNG. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a, to seed each destination's sky from its slug. */
export function hashSeed(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface SkyStar {
  left: string;
  top: string;
  size: number;
  color: string;
  /** Twinkling stars carry their own period and phase; the rest hold still. */
  twinkle: { duration: string; delay: string } | null;
}

/** A sparse field of mostly faint stars, a few bright ones, some warm. */
export function skyStars(seed: number, count: number): SkyStar[] {
  const rand = seeded(seed);
  return Array.from({ length: count }, () => {
    const x = rand() * 100;
    const y = rand() * 100;
    const m = rand() ** 3;
    const alpha = Math.min(1, 0.26 + m * 0.64 + rand() * 0.1).toFixed(2);
    const warm = rand() < 0.16;
    const twinkles = rand() < 0.45;
    const period = 2.6 + rand() * 4.4;
    const phase = rand() * period;
    return {
      left: `${x.toFixed(2)}%`,
      top: `${y.toFixed(2)}%`,
      size: +(0.8 + m * 1.9).toFixed(2),
      color: warm ? `rgb(246 222 196 / ${alpha})` : `rgb(226 232 242 / ${alpha})`,
      twinkle: twinkles ? { duration: `${period.toFixed(2)}s`, delay: `-${phase.toFixed(2)}s` } : null,
    };
  });
}

export interface ConstellationStar {
  /** Position in the constellation box, in percent. */
  u: number;
  v: number;
  /** Which side of the star its label sits on. */
  side: "left" | "right";
  twinkle: { duration: string; delay: string };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The landmarks as stars, keeping their real layout on the map (north up),
 * stretched to fill the box, then nudged apart so no two stars or labels
 * crowd each other.
 */
export function constellation(points: { lat: number; lng: number }[], seed: number): ConstellationStar[] {
  const n = points.length;
  if (n === 0) return [];
  const rand = seeded(seed ^ 0x5bd1e995);
  const k = Math.cos((points.reduce((s, p) => s + p.lat, 0) / n) * (Math.PI / 180));
  const norm = (vs: number[]) => {
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    return vs.map((v) => (hi - lo < 1e-9 ? 0.5 : (v - lo) / (hi - lo)));
  };
  const nx = norm(points.map((p) => p.lng * k));
  const ny = norm(points.map((p) => p.lat));
  const pts = nx.map((x, i) => ({ u: 0.08 + 0.84 * x, v: 0.12 + 0.76 * (1 - ny[i]) }));

  // Minimum spacing, as a share of the box (wider than tall: labels run sideways).
  const SX = 0.2;
  const SY = 0.28;
  for (let pass = 0; pass < 80; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = (pts[j].u - pts[i].u) / SX;
        const dy = (pts[j].v - pts[i].v) / SY;
        const d = Math.hypot(dx, dy);
        if (d >= 1) continue;
        const angle = d > 1e-6 ? Math.atan2(dy, dx) : (i + j) * 2.4;
        const push = (1 - d) / 2 + 0.002;
        pts[i].u -= Math.cos(angle) * push * SX;
        pts[i].v -= Math.sin(angle) * push * SY;
        pts[j].u += Math.cos(angle) * push * SX;
        pts[j].v += Math.sin(angle) * push * SY;
        moved = true;
      }
    }
    for (const p of pts) {
      p.u = clamp(p.u, 0.06, 0.94);
      p.v = clamp(p.v, 0.1, 0.9);
    }
    if (!moved) break;
  }

  return pts.map((p) => {
    const period = 3.2 + rand() * 2.6;
    return {
      u: +(p.u * 100).toFixed(2),
      v: +(p.v * 100).toFixed(2),
      side: p.u > 0.7 ? "left" : "right",
      twinkle: { duration: `${period.toFixed(2)}s`, delay: `-${(rand() * period).toFixed(2)}s` },
    };
  });
}
