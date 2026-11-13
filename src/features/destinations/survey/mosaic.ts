// An image decoding into a canvas: coarse blocks that halve until the photo
// is whole, the first pass arriving cell by cell in a scattered order. The
// canvas covers its box like `object-fit: cover`.

const STEPS = [36, 18, 9, 4.5, 2.25, 1];

export function mosaic(canvas: HTMLCanvasElement, img: HTMLImageElement, { duration = 0.9, still = false } = {}) {
  const ctx = canvas.getContext("2d");
  const small = document.createElement("canvas");
  const sctx = small.getContext("2d");
  let raf = 0;
  let start = 0;
  let order: Float32Array | null = null;
  let done = false;

  const size = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return [w, h, dpr] as const;
  };

  /** The image's cover crop for a w x h box. */
  const crop = (w: number, h: number) => {
    const ar = img.naturalWidth / Math.max(1, img.naturalHeight);
    const br = w / h;
    let sw = img.naturalWidth;
    let sh = img.naturalHeight;
    if (ar > br) sw = sh * br;
    else sh = sw / br;
    return [(img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh] as const;
  };

  const draw = (block: number, reveal: number) => {
    if (!ctx || !sctx) return;
    const [w, h, dpr] = size();
    const [sx, sy, sw, sh] = crop(w, h);
    ctx.clearRect(0, 0, w, h);
    if (block <= 1) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
      return;
    }
    const bw = Math.max(1, Math.round(w / (block * dpr)));
    const bh = Math.max(1, Math.round(h / (block * dpr)));
    small.width = bw;
    small.height = bh;
    sctx.drawImage(img, sx, sy, sw, sh, 0, 0, bw, bh);
    ctx.imageSmoothingEnabled = false;
    if (reveal >= 1) {
      ctx.drawImage(small, 0, 0, bw, bh, 0, 0, w, h);
      return;
    }
    // The first pass: cells appear one by one.
    if (!order || order.length !== bw * bh) order = Float32Array.from({ length: bw * bh }, () => Math.random());
    const cw = w / bw;
    const ch = h / bh;
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        if (order[y * bw + x] > reveal) continue;
        ctx.drawImage(small, x, y, 1, 1, Math.floor(x * cw), Math.floor(y * ch), Math.ceil(cw), Math.ceil(ch));
      }
    }
  };

  const frame = (now: number) => {
    if (!start) start = now;
    const t = (now - start) / 1000 / duration;
    const first = Math.min(1, t * 3.2);
    const step = Math.min(STEPS.length - 1, Math.floor(Math.max(0, t - 0.25) * STEPS.length * 1.25));
    draw(STEPS[step], first);
    if (STEPS[step] > 1 || first < 1) raf = requestAnimationFrame(frame);
    else done = true;
  };

  return {
    play() {
      cancelAnimationFrame(raf);
      if (still) {
        draw(1, 1);
        done = true;
        return;
      }
      start = 0;
      done = false;
      raf = requestAnimationFrame(frame);
    },
    /** Redraw at the current size (after a resize). */
    refresh() {
      if (done) draw(1, 1);
    },
    stop() {
      cancelAnimationFrame(raf);
    },
  };
}
