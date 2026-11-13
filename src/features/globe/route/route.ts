// Origin → destination route: a great-circle arc lifted above the surface.
//
// The route is drawn as a 2D overlay on a canvas at the display's full pixel
// density, not inside the WebGL scene. The 3D view renders at a reduced
// resolution while it moves (to hold the frame rate on integrated GPUs); an
// overlay keeps the line pin-sharp and properly anti-aliased regardless.
//
//   dots      the planned trajectory: round dots with a thin dark rim at an
//             exactly even on-screen spacing, measured along the projected
//             arc back from the destination (so they hold still while the
//             line draws, and the airplane flies into them)
//   ghost     not-yet-drawn dots, faint and smaller, while A and B connect
//   contrail  behind the airplane the dots give way to a glowing line that
//             fades back toward the origin
//   head      the bright point that leads the dots while they are drawn

import type * as Cesium from "cesium";
import type { CesiumModule } from "../cesium/loadCesium";
import type { LatLng } from "@/lib/types";
import { distanceMeters, interpolateGreatCircle } from "@/lib/geo";
import { clamp } from "../camera/pose";
import { inFront, lineOfSight } from "./screen";

export interface RouteEndpoint extends LatLng {
  height?: number;
}

export interface RouteHandle {
  readonly distanceMeters: number;
  /** How many dots are drawn, 0..1 from the origin. */
  setDrawn(fraction: number): void;
  /** Where the airplane is: dots before it become contrail. Null = no flight. */
  setTravel(fraction: number | null): void;
  setOpacity(opacity: number): void;
  /** Point on the arc at `fraction` (0 = origin, 1 = destination). */
  pointAt(fraction: number, result: Cesium.Cartesian3): Cesium.Cartesian3;
  /** Draw into the overlay for the frame just rendered (call from postRender). */
  draw(layer: RouteLayer): void;
  destroy(): void;
}

/** Samples along the arc. */
const SEGMENTS = 256;

// Dot styling (CSS px).
const SPACING = 12;
const DOT_RADIUS = 1.9;
const GHOST_RADIUS = 1.3;
const RIM = 1.2;
const DOT_COLOR = "#f0f0fa";
const RIM_COLOR = "rgb(6 7 10)";
const RIM_ALPHA = 0.55;
const GHOST_ALPHA = 0.3;
/** Endpoint markers sit on the first/last point; keep dots clear of them. */
const ENDPOINT_CLEARANCE = 12;
/** Route fraction over which a dot fades in as the drawing passes it. */
const REVEAL = 0.012;

/** Arc height above the surface for a given route length. */
export function arcHeight(distance: number) {
  return clamp(distance * 0.16, 12_000, 1_400_000);
}

/**
 * Height of the arc at fraction `t` (between endpoint heights h0 and h1).
 * The sin² profile leaves and lands tangentially instead of a sharp V.
 */
export function arcAltitude(distance: number, t: number, h0 = 0, h1 = 0) {
  const bump = Math.sin(Math.PI * t);
  return h0 + (h1 - h0) * t + bump * bump * arcHeight(distance) * 1.15;
}

/** The overlay canvas the route draws into, sized to the globe at device resolution. */
export class RouteLayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private dirty = false;

  constructor(root: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "route-layer";
    this.canvas.setAttribute("aria-hidden", "true");
    root.prepend(this.canvas); // under the markers and the airplane
    this.ctx = this.canvas.getContext("2d");
  }

  /** Resize if needed and clear; returns a context in CSS pixel units. */
  begin(width: number, height: number): CanvasRenderingContext2D | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (width !== this.width || height !== this.height || dpr !== this.dpr) {
      this.width = width;
      this.height = height;
      this.dpr = dpr;
      this.canvas.width = Math.max(1, Math.round(width * dpr));
      this.canvas.height = Math.max(1, Math.round(height * dpr));
    } else if (this.dirty) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    this.dirty = true;
    return ctx;
  }

  clear() {
    if (!this.dirty || !this.ctx) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.dirty = false;
  }

  destroy() {
    this.canvas.remove();
  }
}

export function createRoute(
  C: CesiumModule,
  viewer: Cesium.Viewer,
  origin: RouteEndpoint,
  destination: RouteEndpoint,
  options: { color: string },
): RouteHandle {
  const distance = distanceMeters(origin, destination);
  const h0 = origin.height ?? 0;
  const h1 = destination.height ?? 0;

  const positions: Cesium.Cartesian3[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    const p = interpolateGreatCircle(origin, destination, t);
    positions.push(C.Cartesian3.fromDegrees(p.lng, p.lat, arcAltitude(distance, t, h0, h1)));
  }

  const accent = C.Color.fromCssColorString(options.color);
  const rgb = `${Math.round(accent.red * 255)} ${Math.round(accent.green * 255)} ${Math.round(accent.blue * 255)}`;
  const accentAt = (alpha: number) => `rgb(${rgb} / ${alpha.toFixed(3)})`;

  // Per-frame screen projection of every sample.
  const xs = new Float64Array(SEGMENTS + 1);
  const ys = new Float64Array(SEGMENTS + 1);
  const visible = new Uint8Array(SEGMENTS + 1);
  const win = new C.Cartesian2();
  const scratch = new C.Cartesian3();

  let drawn = 0;
  let travel: number | null = null;
  let opacity = 0;

  const pointAt = (fraction: number, result: Cesium.Cartesian3) => {
    const f = clamp(fraction, 0, 1) * SEGMENTS;
    const i = Math.floor(f);
    if (i >= SEGMENTS) return C.Cartesian3.clone(positions[SEGMENTS], result);
    return C.Cartesian3.lerp(positions[i], positions[i + 1], f - i, result);
  };

  /** Screen position of an arbitrary fraction, or null when hidden. */
  const project = (fraction: number): [number, number] | null => {
    const { camera, scene } = viewer;
    const p = pointAt(fraction, scratch);
    if (!inFront(camera.positionWC, camera.directionWC, p) || !lineOfSight(camera.positionWC, p)) return null;
    const w = C.SceneTransforms.worldToWindowCoordinates(scene, p, win);
    return w ? [w.x, w.y] : null;
  };

  function projectSamples() {
    const { camera, scene } = viewer;
    const cam = camera.positionWC;
    const dir = camera.directionWC;
    for (let i = 0; i <= SEGMENTS; i++) {
      const p = positions[i];
      let ok = inFront(cam, dir, p) && lineOfSight(cam, p);
      if (ok) {
        const w = C.SceneTransforms.worldToWindowCoordinates(scene, p, win);
        if (w) {
          xs[i] = w.x;
          ys[i] = w.y;
        } else ok = false;
      }
      visible[i] = ok ? 1 : 0;
    }
  }

  /** Trace the visible parts of the arc between two fractions as one path. */
  function tracePath(ctx: CanvasRenderingContext2D, from: number, to: number) {
    ctx.beginPath();
    let pen = false;
    let first: [number, number] | null = null;
    let last: [number, number] | null = null;
    const visit = (pt: [number, number] | null) => {
      if (!pt) {
        pen = false;
        return;
      }
      if (pen) ctx.lineTo(pt[0], pt[1]);
      else ctx.moveTo(pt[0], pt[1]);
      pen = true;
      first ??= pt;
      last = pt;
    };
    visit(project(from));
    const i0 = Math.floor(from * SEGMENTS) + 1;
    const i1 = Math.ceil(to * SEGMENTS) - 1;
    for (let i = i0; i <= i1; i++) visit(visible[i] ? [xs[i], ys[i]] : null);
    visit(project(to));
    return { first, last } as { first: [number, number] | null; last: [number, number] | null };
  }

  function drawContrail(ctx: CanvasRenderingContext2D, to: number) {
    const { first, last } = tracePath(ctx, 0, to);
    if (!first || !last) return;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    // Fades back toward the origin: brightest right behind the airplane.
    const glow = ctx.createLinearGradient(first[0], first[1], last[0], last[1]);
    glow.addColorStop(0, accentAt(0));
    glow.addColorStop(1, accentAt(0.22 * opacity));
    ctx.strokeStyle = glow;
    ctx.lineWidth = 7;
    ctx.stroke();
    const core = ctx.createLinearGradient(first[0], first[1], last[0], last[1]);
    core.addColorStop(0, accentAt(0.12 * opacity));
    core.addColorStop(0.55, accentAt(0.7 * opacity));
    core.addColorStop(1, accentAt(opacity));
    ctx.strokeStyle = core;
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }

  // Dot positions for this frame: x, y, route fraction.
  const dots: number[] = [];

  /**
   * Walk the projected arc from the destination back toward the origin and
   * drop a dot every SPACING px. A stretch cut off by the horizon restarts
   * from its destination-side end.
   */
  function placeDots(width: number, height: number) {
    dots.length = 0;
    let prev = -1;
    let acc = 0;
    let next = SPACING;
    for (let i = SEGMENTS; i >= 0; i--) {
      if (!visible[i]) {
        prev = -1;
        continue;
      }
      if (prev < 0) {
        prev = i;
        acc = 0;
        next = SPACING;
        continue;
      }
      const x0 = xs[prev];
      const y0 = ys[prev];
      const dx = xs[i] - x0;
      const dy = ys[i] - y0;
      const len = Math.hypot(dx, dy);
      // A sample right beside the camera can project absurdly far away: skip placing there.
      if (len < 4000) {
        while (acc + len >= next) {
          const u = (next - acc) / len;
          const x = x0 + dx * u;
          const y = y0 + dy * u;
          if (x > -8 && y > -8 && x < width + 8 && y < height + 8) dots.push(x, y, (prev - u) / SEGMENTS);
          next += SPACING;
        }
      } else next = acc + len + SPACING;
      acc += len;
      prev = i;
    }
  }

  function drawDots(ctx: CanvasRenderingContext2D, width: number, height: number) {
    placeDots(width, height);
    const ax = visible[0] ? xs[0] : Number.NaN;
    const ay = visible[0] ? ys[0] : Number.NaN;
    const bx = visible[SEGMENTS] ? xs[SEGMENTS] : Number.NaN;
    const by = visible[SEGMENTS] ? ys[SEGMENTS] : Number.NaN;
    const clear2 = ENDPOINT_CLEARANCE * ENDPOINT_CLEARANCE;

    // Two passes (rims, then dots) so neighbouring rims never cover a dot.
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass === 0 ? RIM_COLOR : DOT_COLOR;
      for (let k = 0; k < dots.length; k += 3) {
        const x = dots[k];
        const y = dots[k + 1];
        const t = dots[k + 2];
        if ((x - ax) ** 2 + (y - ay) ** 2 < clear2 || (x - bx) ** 2 + (y - by) ** 2 < clear2) continue;

        // Drawn / not yet drawn / passed by the airplane.
        const reveal = drawn >= 1 ? 1 : clamp((drawn - t) / REVEAL, 0, 1);
        const kept = travel === null ? 1 : clamp((t - travel) / 0.006, 0, 1);
        const alpha = opacity * (GHOST_ALPHA + (1 - GHOST_ALPHA) * reveal) * kept;
        if (alpha < 0.01) continue;

        const r = GHOST_RADIUS + (DOT_RADIUS - GHOST_RADIUS) * reveal;
        ctx.globalAlpha = pass === 0 ? alpha * RIM_ALPHA * reveal : alpha;
        if (ctx.globalAlpha < 0.01) continue;
        ctx.beginPath();
        ctx.arc(x, y, pass === 0 ? r + RIM : r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawHead(ctx: CanvasRenderingContext2D) {
    const pt = project(drawn);
    if (!pt) return;
    const [x, y] = pt;
    ctx.fillStyle = accentAt(0.2 * opacity);
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgb(6 7 10 / ${(0.8 * opacity).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, 4.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = accentAt(opacity);
    ctx.beginPath();
    ctx.arc(x, y, 3.1, 0, Math.PI * 2);
    ctx.fill();
  }

  return {
    distanceMeters: distance,
    pointAt,
    setDrawn(fraction) {
      drawn = clamp(fraction, 0, 1);
    },
    setTravel(fraction) {
      travel = fraction === null ? null : clamp(fraction, 0, 1);
    },
    setOpacity(value) {
      opacity = clamp(value, 0, 1);
    },
    draw(layer) {
      if (opacity < 0.01) {
        layer.clear();
        return;
      }
      const canvas = viewer.scene.canvas;
      const ctx = layer.begin(canvas.clientWidth, canvas.clientHeight);
      if (!ctx) return;
      projectSamples();
      if (travel !== null && travel > 0.0005) drawContrail(ctx, travel);
      drawDots(ctx, canvas.clientWidth, canvas.clientHeight);
      if (drawn > 0.002 && drawn < 1) drawHead(ctx);
    },
    destroy() {},
  };
}
