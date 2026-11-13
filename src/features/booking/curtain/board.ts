/**
 * The curtain's board of blank flaps, drawn on one canvas: in a worker
 * (flapWorker.ts) where the browser can hand a canvas over to one, on the
 * page otherwise. Nothing here touches the DOM, so it runs in either.
 *
 * Why a canvas: as DOM elements each flap was a composited layer of its own,
 * and a screenful of them (around 150) meant as many separate rasters at
 * once, which stalls integrated graphics for a quarter of a second just as
 * the wave should start. Why a worker: the first accelerated canvas on a
 * thread makes a GPU context synchronously (about 185 ms here), and the
 * worker can do that while the page loads without the page noticing; its
 * frames also carry on whatever the page's main thread is busy with.
 */

export type Shape = { w: number; h: number; dpr: number };
export type Point = { x: number; y: number };
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** CSS `cubic-bezier(x1, y1, x2, y2)` as a function of progress, solved as browsers do. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = (t: number) => ((ax * t + bx) * t + cx) * t;
  const y = (t: number) => ((ay * t + by) * t + cy) * t;
  const slope = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (p: number) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let t = p;
    for (let i = 0; i < 6; i++) {
      const err = x(t) - p;
      if (Math.abs(err) < 1e-5) return y(t);
      const d = slope(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = p;
    while (hi - lo > 1e-5) {
      if (x(t) < p) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return y(t);
  };
}

/** Shutting: a quick swing down with a little bounce at the stop. */
const SHUT = cubicBezier(0.25, 1.2, 0.5, 1);
/** Opening: slow to let go, then away. */
const LIFT = cubicBezier(0.55, 0, 0.75, 0.3);
/** The board's perspective, as a CSS `perspective` on the screen. */
const DEPTH = 1400;
/** A turning flap is drawn in slices, so its free edge narrows or widens in perspective. */
const SLICES = 4;

// Frames: requestAnimationFrame where there is one (pages; workers in Chrome
// and Firefox), a 60 Hz timer where there isn't.
const scope = globalThis as unknown as {
  requestAnimationFrame?: (cb: (now: number) => void) => number;
  cancelAnimationFrame?: (id: number) => void;
};
const nextFrame = (cb: (now: number) => void): number =>
  scope.requestAnimationFrame
    ? scope.requestAnimationFrame(cb)
    : (setTimeout(() => cb(performance.now()), 16) as unknown as number);
const cancelFrame = (id: number) =>
  scope.cancelAnimationFrame ? scope.cancelAnimationFrame(id) : clearTimeout(id);

/** A blank flap, drawn once at the screen's density: two halves, the hinge seam, a dark rim. */
function flapSprite(size: number, dpr: number): AnyCanvas {
  const px = Math.max(2, Math.round(size * dpr));
  let c: AnyCanvas;
  if (typeof OffscreenCanvas !== "undefined") c = new OffscreenCanvas(px, px);
  else {
    c = document.createElement("canvas");
    c.width = px;
    c.height = px;
  }
  const g = c.getContext("2d") as Context;
  const shade = g.createLinearGradient(0, 0, 0, px);
  shade.addColorStop(0, "#1f1d1a");
  shade.addColorStop(0.494, "#161412");
  shade.addColorStop(0.494, "#050504");
  shade.addColorStop(0.506, "#050504");
  shade.addColorStop(0.506, "#11100e");
  shade.addColorStop(1, "#0b0a09");
  g.fillStyle = shade;
  g.fillRect(0, 0, px, px);
  g.strokeStyle = "rgba(0, 0, 0, 0.55)";
  g.lineWidth = dpr;
  g.strokeRect(dpr / 2, dpr / 2, px - dpr, px - dpr);
  return c;
}

type Slice = [sy: number, dx: number, dy: number, dw: number, dh: number];
type Pose = [deg: number, light: number] | null;

export class FlapBoard {
  private canvas: AnyCanvas;
  private ctx: Context;
  private shape: Shape = { w: 0, h: 0, dpr: 1 };
  private size = 64;
  private sprite: AnyCanvas | null = null;
  private tiles: Point[] = [];
  private frame = 0;

  constructor(canvas: AnyCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d") as Context;
  }

  /**
   * Make the GPU context now, while nothing is watching, rather than as the
   * wave starts; and size the canvas for the screen already, so the wave
   * doesn't start with the canvas changing size under the compositor.
   */
  warm(shape: Shape) {
    this.fit(shape);
    this.ctx.fillRect(0, 0, 1, 1);
    this.clear();
  }

  /** Size the canvas to the screen and lay the flaps out on it. */
  setup(shape: Shape) {
    this.stop();
    this.shape = shape;
    this.fit(shape);
    const size = Math.round(Math.max(64, Math.min(104, shape.w / 15)));
    if (!this.sprite || size !== this.size) this.sprite = flapSprite(size, shape.dpr);
    this.size = size;
    this.tiles = [];
    for (let y = 0; y < shape.h; y += size) for (let x = 0; x < shape.w; x += size) this.tiles.push({ x, y });
  }

  /**
   * Every flap shut, at once (for reduced motion); `done` once it's on
   * screen. Drawn on frames, for a few of them: a canvas that has only just
   * been shown can miss a frame drawn the moment it appeared.
   */
  still(done: () => void) {
    this.play(50, done, () => this.draw(() => [0, 1]));
  }

  /**
   * The flaps fall shut in a wave from `origin`, each after a delay that
   * grows with its distance, catching the light as it turns (brightness
   * 2.2 → 1); `done` once the last has landed.
   */
  shut(origin: Point, done: () => void) {
    const { w, h } = this.shape;
    const far = Math.hypot(Math.max(origin.x, w - origin.x), Math.max(origin.y, h - origin.y));
    const half = this.size / 2;
    const delays = this.tiles.map(({ x, y }) => (Math.hypot(x + half - origin.x, y + half - origin.y) / far) * 520);
    this.play(Math.max(...delays) + 440, done, (t) =>
      this.draw((i) => {
        const p = (t - delays[i]) / 440;
        if (p <= 0) return null;
        const e = SHUT(Math.min(1, p));
        return [-92 + 92 * e, 2.2 - 1.2 * e];
      }),
    );
  }

  /** The flaps fall away from the middle outwards, darkening as they go; `done` once all are gone. */
  lift(done: () => void) {
    const { w, h } = this.shape;
    const far = Math.hypot(w / 2, h / 2);
    const half = this.size / 2;
    const delays = this.tiles.map(({ x, y }) => 140 + (Math.hypot(x + half - w / 2, y + half - h / 2) / far) * 480);
    this.play(Math.max(...delays) + 460, done, (t) =>
      this.draw((i) => {
        const p = (t - delays[i]) / 460;
        if (p >= 1) return null;
        const e = LIFT(p);
        return [90 * e, 1 - 0.6 * e];
      }),
    );
  }

  stop() {
    cancelFrame(this.frame);
  }

  /** Nothing on the canvas (it keeps its size, ready for the next wave). */
  clear() {
    this.stop();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Stop, and shrink the canvas to nothing, giving its memory back. */
  release() {
    this.stop();
    this.canvas.width = 0;
    this.canvas.height = 0;
  }

  /** Resize only when the size actually changes: any assignment resets the canvas. */
  private fit({ w, h, dpr }: Shape) {
    const width = Math.round(w * dpr);
    const height = Math.round(h * dpr);
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  /** Draw `step(ms since start)` every frame for `duration`, then call `done`. */
  private play(duration: number, done: () => void, step: (t: number) => void) {
    this.stop();
    let start = -1;
    const tick = (now: number) => {
      if (start < 0) start = now;
      const t = now - start;
      step(t);
      if (t < duration) this.frame = nextFrame(tick);
      else done();
    };
    this.frame = nextFrame(tick);
  }

  /**
   * Draw every flap, given each one's turn about its top hinge in degrees
   * (CSS rotateX: negative leans its free edge into the screen, positive out
   * towards you; null for not shown) and its light (1 as it is, more
   * brighter, less darker).
   */
  private draw(pose: (i: number) => Pose) {
    const { ctx, size: s, sprite } = this;
    const { w, h, dpr } = this.shape;
    if (!sprite) return;
    const src = sprite.width;
    const cx = w / 2;
    const cy = h / 2;
    const lit: [Slice[], number][] = [];
    const dim: [Slice[], number][] = [];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.tiles.forEach(({ x, y }, i) => {
      const p = pose(i);
      if (!p) return;
      const [deg, light] = p;
      const a = (deg * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      // Edge on, or showing its back.
      if (cos < 0.004) return;
      const n = deg === 0 ? 1 : SLICES;
      const slices: Slice[] = [];
      let top = y;
      let fTop = 1;
      for (let k = 1; k <= n; k++) {
        const v = k / n;
        const f = DEPTH / (DEPTH - v * s * sin);
        const bottom = cy + (y + v * s * cos - cy) * f;
        const fm = (fTop + f) / 2;
        const left = cx + (x - cx) * fm;
        // A pixel of overlap on the right and bottom, so no hairline shows between flaps.
        const right = cx + (x + s + 1 - cx) * fm;
        const slice: Slice = [((k - 1) / n) * src, left, top, right - left, bottom - top + (k === n ? 1 : 0)];
        ctx.drawImage(sprite, 0, slice[0], src, src / n, slice[1], slice[2], slice[3], slice[4]);
        slices.push(slice);
        top = bottom;
        fTop = f;
      }
      if (light > 1.001) lit.push([slices, Math.min(1, light - 1)]);
      else if (light < 0.999) dim.push([slices, 1 - light]);
    });
    // Light as a second, added pass of the flap itself (c + k·c is brightness 1 + k); dark as black over it.
    if (lit.length) {
      ctx.globalCompositeOperation = "lighter";
      for (const [slices, k] of lit) {
        ctx.globalAlpha = k;
        for (const [sy, dx, dy, dw, dh] of slices) ctx.drawImage(sprite, 0, sy, src, src / slices.length, dx, dy, dw, dh);
      }
      ctx.globalCompositeOperation = "source-over";
    }
    if (dim.length) {
      ctx.fillStyle = "#000";
      for (const [slices, k] of dim) {
        ctx.globalAlpha = k;
        for (const [, dx, dy, dw, dh] of slices) ctx.fillRect(dx, dy, dw, dh);
      }
    }
    ctx.globalAlpha = 1;
  }
}
