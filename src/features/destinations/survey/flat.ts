// The survey without WebGL: the same frame, drawn with Canvas 2D at a
// lighter density. Points are batched by brightness, contours are one path,
// the panel's photo is pixelated by drawing it small and scaling it up with
// smoothing off. It carries the page while the GPU is lost or missing.

import type { Renderer, SurveyScene } from "./gl";
import { budgetedDpr } from "./gl";
import { PANEL_LIFT, panelSize, project, type Frame } from "./story";
import { contours, route as traceRoute, SIZE, type V3 } from "./terrain";

const BUCKETS = 6;

export function createFlat(canvas: HTMLCanvasElement, world: SurveyScene): Renderer | null {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return null;
  const coarse = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768;
  const { survey } = world;
  const G = survey.grid;
  const step = coarse ? 3 : 2;
  const pts: { p: V3; s: number; w: number; f: number }[] = [];
  for (let j = 0; j < G; j += step) {
    for (let i = 0; i < G; i += step) {
      const c = j * G + i;
      pts.push({ p: [(i / (G - 1) - 0.5) * SIZE, survey.y[c], (j / (G - 1) - 0.5) * SIZE], s: survey.slope[c], w: survey.water[c], f: 1 - j / (G - 1) });
    }
  }
  const ct = contours(survey, 14, 3);
  const rt = traceRoute(survey, world.stops, 32);
  const photos = new Map<number, { img: HTMLImageElement; small: HTMLCanvasElement; block: number; w: number; h: number; crop: [number, number, number, number] }>();
  const rects: ([number, number, number, number] | null)[] = world.spots.map(() => null);
  const xs = new Float32Array(pts.length * 2);
  let scale = 1;
  let W = 0;
  let H = 0;
  let k = 1;

  const resize = () => {
    const cssW = canvas.clientWidth || 1;
    const cssH = canvas.clientHeight || 1;
    const d = budgetedDpr(cssW, cssH, 1.3e6) * scale;
    const w = Math.max(1, Math.round(cssW * d));
    const h = Math.max(1, Math.round(cssH * d));
    if (w === W && h === H) return;
    W = w;
    H = h;
    k = d;
    canvas.width = w;
    canvas.height = h;
  };

  const render = (f: Frame) => {
    resize();
    const P = (p: V3) => {
      const [x, y, ok] = project(f, p);
      return [x * k, y * k, ok] as const;
    };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgb(5 6 8)";
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";

    // The sun, low on the horizon.
    if (f.sun > 0.003) {
      const [sx, sy, ok] = P([0.6, 2.2, -26]);
      if (ok) {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, H * 0.25);
        g.addColorStop(0, `rgb(255 246 232 / ${(0.9 * f.sun).toFixed(3)})`);
        g.addColorStop(0.04, `rgb(255 246 232 / ${(0.25 * f.sun).toFixed(3)})`);
        g.addColorStop(1, "rgb(255 246 232 / 0)");
        ctx.fillStyle = g;
        ctx.fillRect(sx - H * 0.25, sy - H * 0.25, H * 0.5, H * 0.5);
      }
    }

    // The land, in a few brightness buckets.
    if (f.points > 0.003) {
      const buckets: number[][] = Array.from({ length: BUCKETS }, () => []);
      for (let i = 0; i < pts.length; i++) {
        const q = pts[i];
        if (q.f > f.scan) continue;
        const [x, y, ok] = P(q.p);
        if (!ok || x < -4 || y < -4 || x > W + 4 || y > H + 4) continue;
        let light = 0.3 + q.s * 0.95 + q.p[1] * 0.16;
        if (f.probeAmt > 0.01) {
          const d = Math.hypot(q.p[0] - f.probe[0], q.p[2] - f.probe[2]);
          light += Math.exp((-d * d) / 0.05) * 1.2 * f.probeAmt;
        }
        const b = Math.min(BUCKETS - 1, Math.floor(light * 0.6 * f.points * BUCKETS));
        if (b < 0) continue;
        xs[i * 2] = x;
        xs[i * 2 + 1] = y;
        buckets[b].push(i);
      }
      const size = Math.max(1, 1.3 * k);
      buckets.forEach((list, b) => {
        if (!list.length) return;
        ctx.fillStyle = `rgb(220 230 255 / ${((b + 1) / BUCKETS).toFixed(2)})`;
        for (const i of list) ctx.fillRect(xs[i * 2] - size / 2, xs[i * 2 + 1] - size / 2, size, size);
      });
    }

    // Contours.
    if (f.contours > 0.003) {
      ctx.strokeStyle = `rgb(210 222 255 / ${(0.32 * f.contours).toFixed(3)})`;
      ctx.lineWidth = k;
      ctx.beginPath();
      for (let i = 0; i < ct.level.length; i += 2) {
        if (ct.level[i] > f.contourReveal) continue;
        const [x0, y0, ok0] = P([ct.pos[i * 3], ct.pos[i * 3 + 1], ct.pos[i * 3 + 2]]);
        const [x1, y1, ok1] = P([ct.pos[i * 3 + 3], ct.pos[i * 3 + 4], ct.pos[i * 3 + 5]]);
        if (!ok0 || !ok1) continue;
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      }
      ctx.stroke();
    }

    // Strata planes.
    if (f.strata > 0.003) {
      const n = world.planes.length;
      world.planes.forEach((level, i) => {
        const y = level * world.top + f.spread * (i - (n - 1) / 2) * 0.62 + f.spread * 0.5;
        const h = (SIZE / 2) * 1.04;
        const corners = ([[-h, -h], [h, -h], [h, h], [-h, h]] as const).map(([x, z]) => P([x, y, z]));
        ctx.strokeStyle = `rgb(225 232 255 / ${(f.strata * (f.focus === i ? 0.9 : 0.5)).toFixed(3)})`;
        ctx.beginPath();
        corners.forEach(([x, yy], c) => (c ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy)));
        ctx.closePath();
        ctx.stroke();
      });
    }

    // Pins.
    if (f.pins > 0.003) {
      world.spots.forEach((p, i) => {
        const on = i === f.active;
        const [x0, y0, ok0] = P(p);
        const [x1, y1, ok1] = P([p[0], p[1] + PANEL_LIFT, p[2]]);
        if (!ok0 || !ok1) return;
        ctx.strokeStyle = on ? `rgb(255 200 160 / ${f.pins.toFixed(3)})` : `rgb(205 218 255 / ${(0.35 * f.pins).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(x0, y0, 9 * k, 4 * k, 0, 0, Math.PI * 2);
        ctx.stroke();
      });
    }

    // The route.
    if (f.routeAlpha > 0.003 && f.route > 0) {
      ctx.strokeStyle = `rgb(255 200 150 / ${(0.85 * f.routeAlpha).toFixed(3)})`;
      ctx.lineWidth = 1.5 * k;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < rt.pts.length; i++) {
        if (rt.total > 0 && rt.dist[i] / rt.total > f.route) break;
        const [x, y, ok] = P(rt.pts[i]);
        if (!ok) continue;
        if (started) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        started = true;
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";

    // The panel: the photo drawn small and scaled up without smoothing, while it decodes.
    world.spots.forEach((p, i) => (rects[i] = i === f.active && f.panel > 0.003 ? rects[i] : null));
    const ph = photos.get(f.active);
    if (ph && f.panel > 0.003) {
      const base = world.spots[f.active];
      const [cx, cy, ok] = P([base[0], base[1] + PANEL_LIFT + ph.h * 0.5 + 0.06, base[2]]);
      const [ex] = P([base[0] + 0.5, base[1] + PANEL_LIFT, base[2]]);
      if (ok) {
        const unitPx = Math.abs(ex - cx) * 2;
        const w = ph.w * unitPx;
        const h = ph.h * unitPx;
        const block = Math.max(1, f.block);
        if (block !== ph.block) {
          ph.block = block;
          const [, , sw, sh] = ph.crop;
          ph.small.width = Math.max(1, Math.round(sw / (block * 2)));
          ph.small.height = Math.max(1, Math.round(sh / (block * 2)));
          ph.small.getContext("2d")?.drawImage(ph.img, ...ph.crop, 0, 0, ph.small.width, ph.small.height);
        }
        ctx.save();
        ctx.globalAlpha = f.panel;
        ctx.imageSmoothingEnabled = block <= 1;
        ctx.filter = f.color > 0.5 ? "none" : "grayscale(1) contrast(1.1)";
        if (block <= 1) ctx.drawImage(ph.img, ...ph.crop, cx - w / 2, cy - h / 2, w, h);
        else ctx.drawImage(ph.small, cx - w / 2, cy - h / 2, w, h);
        ctx.filter = "none";
        ctx.strokeStyle = "rgb(255 255 255 / 0.8)";
        ctx.lineWidth = k;
        ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
        ctx.restore();
        rects[f.active] = [(cx - w / 2) / k, (cy - h / 2) / k, (cx + w / 2) / k, (cy + h / 2) / k];
      }
    }
  };

  return {
    kind: "2d",
    render,
    setPhoto(index, img) {
      if (photos.has(index)) return;
      const nw = img.naturalWidth;
      const nh = Math.max(1, img.naturalHeight);
      const { pa, w, h } = panelSize(nw / nh);
      // Cropped to the panel's shape from the middle, like the GL panel's cover fit.
      const sw = Math.min(nw, nh * pa);
      const sh = Math.min(nh, nw / pa);
      const crop: [number, number, number, number] = [(nw - sw) / 2, (nh - sh) / 2, sw, sh];
      photos.set(index, { img, small: document.createElement("canvas"), block: -1, w, h, crop });
    },
    setScale(v) {
      scale = Math.max(0.5, Math.min(1, v));
    },
    status: () => "ready",
    panelRect: (i) => rects[i] ?? null,
    dispose() {
      photos.clear();
      canvas.width = 1;
      canvas.height = 1;
    },
  };
}
