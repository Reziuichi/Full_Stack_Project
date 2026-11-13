// The survey's choreography, apart from any renderer: the camera's flight
// over the land chapter by chapter, how strongly each layer shows (points,
// contours, grid, strata, pins, route), the landmark panel's decode, the
// cursor's probe, and the outro behind the tours. A WebGL and a Canvas 2D
// renderer draw the same `Frame`.

import { heightAt, SIZE, type Survey, type V3 } from "./terrain";

export type Kind = "void" | "acquire" | "brief" | "strata" | "spot" | "route";
export type SceneDef = { kind: Kind; spot: number };

export type Frame = {
  time: number;
  eye: V3;
  target: V3;
  fov: number;
  aspect: number;
  width: number;
  height: number;
  view: Float32Array;
  proj: Float32Array;
  /** The scan that draws the land in, from near to far (0..1.2). */
  scan: number;
  points: number;
  contours: number;
  /** How many contour levels are drawn, from the lowest (0..1). */
  contourReveal: number;
  grid: number;
  strata: number;
  /** How far the strata planes have spread apart (0..1). */
  spread: number;
  /** Which plane (and landmark) is picked out, or -1. */
  focus: number;
  pins: number;
  /** The landmark whose panel shows, its reveal (0..1), its mosaic block size (texels) and colour (0 grey, 1 colour). */
  active: number;
  panel: number;
  block: number;
  color: number;
  route: number;
  routeAlpha: number;
  sun: number;
  probe: V3;
  probeAmt: number;
  outro: number;
  flash: number;
  aberration: number;
  calm: boolean;
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const unit = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

export function lookAt(eye: V3, target: V3, out: Float32Array) {
  const z = unit([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = unit([z[2], 0, -z[0]]);
  const y: V3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  out.set([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]), -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]), -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]), 1]);
  return out;
}
export function perspective(fov: number, aspect: number, near: number, far: number, out: Float32Array) {
  const f = 1 / Math.tan(fov / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}
/** A world point to CSS pixels: [x, y, in front of the camera]. */
export function project(f: Pick<Frame, "view" | "proj" | "width" | "height">, p: V3): [number, number, boolean] {
  const v = f.view;
  const P = f.proj;
  const vx = v[0] * p[0] + v[4] * p[1] + v[8] * p[2] + v[12];
  const vy = v[1] * p[0] + v[5] * p[1] + v[9] * p[2] + v[13];
  const vz = v[2] * p[0] + v[6] * p[1] + v[10] * p[2] + v[14];
  const w = -vz;
  if (w < 0.05) return [0, 0, false];
  return [((P[0] * vx) / w * 0.5 + 0.5) * f.width, (0.5 - ((P[5] * vy) / w) * 0.5) * f.height, true];
}

const FOV = (36 * Math.PI) / 180;
const FOV_TALL = (56 * Math.PI) / 180;
/** Where the panel of each landmark floats: this far above its pin's foot. */
export const PANEL_LIFT = 0.95;
/** A photo panel's size in world units: its photo's shape, kept between a tall 4:5 and a wide 16:10. */
export function panelSize(ar: number) {
  const pa = Math.min(1.6, Math.max(0.8, ar));
  const w = pa >= 1 ? 1.55 : 1.55 * pa;
  return { pa, w, h: w / pa };
}
/** Each landmark's view comes from a slightly different side. */
const SIDES = [-0.55, 0.5, -0.2, 0.75, -0.8, 0.25, -0.45, 0.6];

type Pose = { eye: V3; target: V3; fov: number; half: number };

/**
 * The world for one survey and its landmarks (world positions of their
 * pins' feet). `update` moves everything to story position `s` (whole
 * numbers are scenes) and returns the frame to draw.
 */
export function createStory(survey: Survey, scenes: SceneDef[], spots: V3[], calm: boolean) {
  const frame: Frame = {
    time: 0,
    eye: [0, 1, 6],
    target: [0, 0, 0],
    fov: FOV,
    aspect: 1,
    width: 1,
    height: 1,
    view: new Float32Array(16),
    proj: new Float32Array(16),
    scan: 0,
    points: 0,
    contours: 0,
    contourReveal: 0,
    grid: 0,
    strata: 0,
    spread: 0,
    focus: -1,
    pins: 0,
    active: -1,
    panel: 0,
    block: 40,
    color: 0,
    route: 0,
    routeAlpha: 0,
    sun: 0,
    probe: [0, 0, 0],
    probeAmt: 0,
    outro: 0,
    flash: 0,
    aberration: 0,
    calm,
  };
  const pointer = { x: -1e4, y: -1e4, inside: false, overPanel: false };
  let activeSince = -1;
  let active = -1;
  let colorAmt = 0;
  let probeOn = 0;
  let scanStart = -1;
  // Panel heights (a guess until each photo arrives, then eased to the real one so the camera never jumps).
  const panelGoal = spots.map(() => 1.1);
  const panelH = spots.map(() => 1.1);

  const pose = (k: number, time: number): Pose => {
    const d = scenes[k];
    const drift = calm ? 0 : time;
    if (d.kind === "void" || d.kind === "acquire") return { eye: [0, 1.35, 5.6], target: [0, 0.35, -2.2], fov: FOV * 1.1, half: 0 };
    if (d.kind === "brief") {
      const az = 0.7 + drift * 0.012;
      return { eye: [Math.sin(az) * 7.4, 4.4, Math.cos(az) * 7.4], target: [0, 0.3, 0], fov: FOV, half: 5.2 };
    }
    if (d.kind === "strata") return { eye: [7.4, 3.9, 7.0], target: [0, 1.25, 0], fov: FOV, half: 6.2 };
    if (d.kind === "spot") {
      const p = spots[d.spot] ?? [0, 0, 0];
      const az = SIDES[d.spot % SIDES.length];
      // Framed on the whole stack (pin foot to panel top) with room for the nav above and the label below.
      const top = PANEL_LIFT + (panelH[d.spot] ?? 1.1) + 0.06;
      const target: V3 = [p[0], p[1] + top * 0.5, p[2]];
      const dist = (top * 0.5 + 0.42) / Math.tan(FOV / 2);
      const run = dist * 0.975;
      return { eye: [target[0] + Math.sin(az) * run, target[1] + dist * 0.22, target[2] + Math.cos(az) * run], target, fov: FOV, half: 2.3 };
    }
    return { eye: [0, 10.8, 3.1], target: [0, 0, 0.25], fov: FOV, half: SIZE * 0.62 };
  };

  type Look = { points: number; contours: number; grid: number; strata: number; pins: number; routeAlpha: number; sun: number };
  const LOOK: Record<Kind, Look> = {
    void: { points: 0, contours: 0, grid: 0, strata: 0, pins: 0, routeAlpha: 0, sun: 0 },
    acquire: { points: 1, contours: 0.12, grid: 0.1, strata: 0, pins: 0, routeAlpha: 0, sun: 1 },
    brief: { points: 0.95, contours: 0.9, grid: 0.2, strata: 0, pins: 0.35, routeAlpha: 0, sun: 0.45 },
    strata: { points: 0.5, contours: 0.6, grid: 0.08, strata: 1, pins: 0.55, routeAlpha: 0, sun: 0.2 },
    spot: { points: 0.9, contours: 0.4, grid: 0.06, strata: 0, pins: 1, routeAlpha: 0.35, sun: 0.15 },
    route: { points: 0.8, contours: 0.8, grid: 0.24, strata: 0, pins: 1, routeAlpha: 1, sun: 0.1 },
  };

  function update(input: { s: number; dt: number; time: number; width: number; height: number; tilt: [number, number]; outro: number; ready: boolean; speed: number }) {
    const { dt, time, tilt } = input;
    for (let i = 0; i < panelH.length; i++) panelH[i] += (panelGoal[i] - panelH[i]) * (calm ? 1 : 1 - Math.exp(-dt * 3));
    const last = scenes.length - 1;
    const s = clamp(input.s, 0, last);
    const a = Math.floor(s);
    const b = Math.min(a + 1, last);
    const m = a === b ? 0 : s - a;
    const e = calm ? (m < 0.5 ? 0 : 1) : ease(m);
    const ka = scenes[a].kind;
    const kb = scenes[b].kind;
    frame.time = time;
    frame.width = input.width;
    frame.height = input.height;
    frame.calm = calm;
    const outro = calm ? smooth(0.4, 0.6, input.outro) : smooth(0, 1, input.outro);
    frame.outro = outro;

    // ── Camera: a flight between the two scenes' views, lifted in the middle so it never skims the land. ──
    const pa = pose(a, time);
    const pb = pose(b, time);
    const aspect = input.width / Math.max(1, input.height);
    const tall = aspect < 1 ? clamp((1 - aspect) / 0.55, 0, 1) : 0;
    const fov = lerp(pa.fov, pb.fov, e) + (FOV_TALL - FOV) * tall;
    let target = mix3(pa.target, pb.target, e);
    let eye = mix3(pa.eye, pb.eye, e);
    if (!calm) {
      const hop = Math.hypot(pb.target[0] - pa.target[0], pb.target[2] - pa.target[2]);
      eye[1] += Math.sin(Math.PI * e) * Math.min(2.2, 0.35 + hop * 0.32);
    }
    // Narrow screens step back until the scene's width fits.
    const half = lerp(pa.half, pb.half, e);
    const dist = Math.hypot(eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]);
    if (half > 0) {
      const fit = Math.max(1, half / (Math.tan(fov / 2) * aspect * dist));
      eye = mix3(target, eye, fit);
    }
    // The outro: the whole survey drawn back into a floating object behind the tours, turning slowly.
    if (outro > 0) {
      const az = 0.5 + (calm ? 0 : time * 0.04);
      const oEye: V3 = [Math.sin(az) * 12.5, 4.6, Math.cos(az) * 12.5];
      const oTarget: V3 = [0, 0.1, 0];
      eye = mix3(eye, oEye, outro);
      target = mix3(target, oTarget, outro);
    }
    if (!calm) {
      eye[0] += tilt[0] * 0.28 * (1 - outro);
      eye[1] += tilt[1] * 0.16 * (1 - outro);
    }
    frame.eye = eye;
    frame.target = target;
    frame.fov = fov;
    frame.aspect = aspect;
    lookAt(eye, target, frame.view);
    perspective(fov, aspect, 0.05, 220, frame.proj);

    // ── Layers. ───────────────────────────────────────────────────────────
    const la = LOOK[ka];
    const lb = LOOK[kb];
    const blend = (k: keyof Look) => lerp(la[k], lb[k], e);
    if (input.ready && scanStart < 0) scanStart = time;
    frame.scan = scanStart < 0 ? 0 : calm ? 1.2 : Math.min(1.2, (time - scanStart) / 2.6) + smooth(1, 1.4, s) * 1.2;
    frame.points = blend("points") * (1 - outro * 0.45);
    frame.contours = blend("contours") * (1 - outro * 0.35);
    frame.grid = blend("grid") * (1 - outro);
    frame.pins = blend("pins") * (1 - outro);
    frame.sun = blend("sun");
    const strataAt = scenes.findIndex((d) => d.kind === "strata");
    const routeAt = scenes.findIndex((d) => d.kind === "route");
    const briefAt = scenes.findIndex((d) => d.kind === "brief");
    frame.strata = blend("strata");
    frame.spread = strataAt < 0 ? 0 : smooth(strataAt - 0.5, strataAt + 0.05, s) * (1 - smooth(strataAt + 0.05, strataAt + 0.7, s));
    frame.contourReveal = briefAt < 0 ? 1 : calm ? 1 : smooth(briefAt - 0.85, briefAt - 0.05, s);
    frame.route = routeAt < 0 ? 0 : smooth(routeAt - 0.55, routeAt - 0.02, s);
    frame.routeAlpha = Math.max(blend("routeAlpha") * frame.route, blend("routeAlpha") * (kb === "spot" || ka === "spot" ? 1 : 0)) * (1 - outro * 0.6);

    // ── The landmark in view: its panel decodes from coarse blocks to the full photo. ──
    const near = Math.round(s);
    const nowSpot = scenes[near]?.kind === "spot" ? scenes[near].spot : -1;
    const strataFocus = ka === "strata" || kb === "strata" ? -1 : nowSpot;
    frame.focus = strataFocus;
    if (nowSpot !== active) {
      active = nowSpot;
      activeSince = time;
      colorAmt = 0;
    }
    frame.active = active;
    const closeness = active < 0 ? 0 : 1 - smooth(0.08, 0.34, Math.abs(s - near));
    const age = activeSince < 0 ? 0 : time - activeSince;
    frame.panel = closeness * (calm ? 1 : smooth(0.05, 0.5, age)) * (1 - outro);
    const steps = [40, 20, 10, 5, 2.5, 1];
    frame.block = calm ? 1 : steps[Math.min(steps.length - 1, Math.floor(Math.max(0, age - 0.15) / 0.13))];
    colorAmt += ((pointer.overPanel ? 1 : 0) - colorAmt) * (1 - Math.exp(-dt * 6));
    frame.color = colorAmt;

    // ── The probe: where the cursor touches the land. ─────────────────────
    let hit: V3 | null = null;
    if (pointer.inside && !pointer.overPanel && outro < 0.5) hit = raycast(pointer.x, pointer.y);
    probeOn += ((hit ? 1 : 0) - probeOn) * (1 - Math.exp(-dt * 7));
    if (hit) frame.probe = hit;
    frame.probeAmt = probeOn * (calm ? 0.7 : 1);

    frame.flash = 0;
    const move = Math.min(1, input.speed * 0.4) + (calm ? 0 : Math.sin(Math.PI * m) * 0.25);
    frame.aberration += (Math.min(0.012, move * 0.006) - frame.aberration) * (1 - Math.exp(-dt * 8));
    if (calm) frame.aberration = 0;
    return frame;
  }

  /** The point of land under a screen position: march along the camera ray until it dips below the surface. */
  function raycast(x: number, y: number): V3 | null {
    const f = frame;
    const nx = (x / f.width) * 2 - 1;
    const ny = 1 - (y / f.height) * 2;
    const t = Math.tan(f.fov / 2);
    const v = f.view;
    const right: V3 = [v[0], v[4], v[8]];
    const up: V3 = [v[1], v[5], v[9]];
    const back: V3 = [v[2], v[6], v[10]];
    const dir = unit([right[0] * nx * t * f.aspect + up[0] * ny * t - back[0], right[1] * nx * t * f.aspect + up[1] * ny * t - back[1], right[2] * nx * t * f.aspect + up[2] * ny * t - back[2]]);
    const o = f.eye;
    const H = SIZE / 2;
    let prev = 0;
    for (let d = 0.2, i = 0; i < 900 && d < 40; i++, d += 0.04 + d * 0.004) {
      const p: V3 = [o[0] + dir[0] * d, o[1] + dir[1] * d, o[2] + dir[2] * d];
      if (Math.abs(p[0]) > H || Math.abs(p[2]) > H) {
        prev = d;
        continue;
      }
      const g = heightAt(survey, p[0] / SIZE + 0.5, p[2] / SIZE + 0.5);
      if (p[1] <= g) {
        // Refine between the last step and this one.
        let lo = prev;
        let hi = d;
        for (let k = 0; k < 10; k++) {
          const mid = (lo + hi) / 2;
          const q: V3 = [o[0] + dir[0] * mid, o[1] + dir[1] * mid, o[2] + dir[2] * mid];
          if (q[1] <= heightAt(survey, q[0] / SIZE + 0.5, q[2] / SIZE + 0.5)) hi = mid;
          else lo = mid;
        }
        return [o[0] + dir[0] * hi, o[1] + dir[1] * hi, o[2] + dir[2] * hi];
      }
      prev = d;
    }
    return null;
  }

  /** A landmark's photo arrived with this width / height ratio. */
  const photo = (i: number, ar: number) => {
    if (i >= 0 && i < panelGoal.length) panelGoal[i] = panelSize(ar).h;
  };

  return { frame, update, pointer, photo };
}

export type Story = ReturnType<typeof createStory>;
