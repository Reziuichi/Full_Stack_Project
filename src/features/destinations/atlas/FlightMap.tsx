"use client";

import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap";
import { PLANE_PATH } from "@/features/globe/route/plane";
import { greatCirclePath, HOME_BASE } from "@/lib/airports";
import { DOT_STEP, landDots } from "./worldDots";

export interface MapStop {
  slug: string;
  code: string;
  name: string;
  lat: number;
  lng: number;
  /** The city's colour, lit for a dark page. */
  glow: string;
}

type View = { lon: number; lat: number; zoom: number };
const WORLD: View = { lon: 26, lat: 24, zoom: 1 };
const LIGHT = "232,234,238";
const SIGNAL = "230,163,106";

const hexToRgb = (hex: string) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
};

/**
 * A dot-matrix world with the desk's routes: great circles from Chandigarh
 * (IXC) to every destination. On arrival the land sweeps in from IXC like a
 * radar and the routes draw themselves outward. With a destination active the
 * camera glides to frame its route; the route runs as a marching line in the
 * city's colour with the site's airliner flying it, and the land around the
 * city lights up. One canvas, redrawn per frame while on screen.
 */
export function FlightMap({ stops, active, play }: { stops: MapStop[]; active: string | null; play: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Live state the draw loop reads; tweened by GSAP from the effects below.
  const state = useRef({ view: { ...WORLD }, sweep: 0, arcs: new Map<string, { p: number }>(), active: null as string | null, focus: { v: 0 } });
  const api = useRef<{ fit: (slug: string | null) => void } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dots = landDots();
    const plane = new Path2D(PLANE_PATH);
    const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-mono").trim() || "monospace";
    const routes = new Map(
      stops.map((s) => [s.slug, { stop: s, path: greatCirclePath(HOME_BASE, s, 72), home: Math.abs(s.lat - HOME_BASE.lat) + Math.abs(s.lng - HOME_BASE.lng) < 0.5 }]),
    );
    for (const s of stops) if (!state.current.arcs.has(s.slug)) state.current.arcs.set(s.slug, { p: 0 });

    let dpr = 1;
    let W = 0;
    let H = 0;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.round(canvas.clientWidth * dpr);
      H = Math.round(canvas.clientHeight * dpr);
      canvas.width = W;
      canvas.height = H;
      api.current?.fit(state.current.active);
    };
    // Pixels per degree at zoom 1: the world fills the width (or, on tall
    // screens, a band of the height), and is cropped at the sides.
    const baseK = () => Math.max((W * 0.94) / 360, (H * 0.5) / 134);

    // Frame a route in the free part of the screen (right side on desktop, top on phones).
    const fitView = (slug: string | null): View => {
      const r = slug ? routes.get(slug) : null;
      if (!r) return { ...WORLD };
      const tall = W / H < 0.9;
      const region = tall ? { x0: 0.06, x1: 0.94, y0: 0.12, y1: 0.4 } : { x0: 0.56, x1: 0.96, y0: 0.18, y1: 0.82 };
      const pts = r.home ? [[HOME_BASE.lng, HOME_BASE.lat]] : r.path;
      const lons = pts.map((p) => p[0]);
      const lats = pts.map((p) => p[1]);
      const spanLon = Math.max(Math.max(...lons) - Math.min(...lons), r.home ? 10 : 8);
      const spanLat = Math.max(Math.max(...lats) - Math.min(...lats), r.home ? 7 : 6);
      const k = baseK();
      const rw = (region.x1 - region.x0) * W;
      const rh = (region.y1 - region.y0) * H;
      const zoom = Math.min(4.5, Math.max(1, Math.min(rw / (spanLon * k), rh / (spanLat * k)) * 0.78));
      const cx = ((region.x0 + region.x1) / 2) * W;
      const cy = ((region.y0 + region.y1) / 2) * H;
      const midLon = (Math.max(...lons) + Math.min(...lons)) / 2;
      const midLat = (Math.max(...lats) + Math.min(...lats)) / 2;
      return { lon: midLon - (cx - W / 2) / (k * zoom), lat: midLat + (cy - H / 2) / (k * zoom), zoom };
    };
    api.current = {
      fit: (slug) => {
        const v = fitView(slug);
        gsap.to(state.current.view, { ...v, duration: 1.5, ease: "power3.inOut", overwrite: true });
      },
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    let raf = 0;
    let t0 = performance.now();
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const time = (now - t0) / 1000;
      const st = state.current;
      const v = st.view;
      const k = baseK() * v.zoom;
      const px = (lng: number, lat: number): [number, number] => [(lng - v.lon) * k + W / 2, (v.lat - lat) * k + H / 2];
      const act = st.active ? routes.get(st.active) : null;
      const actRgb = act ? hexToRgb(act.stop.glow) : SIGNAL;
      ctx.clearRect(0, 0, W, H);

      // A glow of the city's colour under the active destination.
      if (act) {
        const [ax, ay] = px(act.stop.lng, act.stop.lat);
        const g = ctx.createRadialGradient(ax, ay, 0, ax, ay, 160 * dpr);
        g.addColorStop(0, `rgba(${actRgb},${0.2 * st.focus.v})`);
        g.addColorStop(1, `rgba(${actRgb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(ax - 160 * dpr, ay - 160 * dpr, 320 * dpr, 320 * dpr);
      }

      // Land: brighter near home and near the active city, revealed by a sweep from IXC.
      const cell = DOT_STEP * k;
      const rad = Math.min(3.2 * dpr, Math.max(0.7 * dpr, cell * 0.24));
      const buckets: Path2D[] = Array.from({ length: 6 }, () => new Path2D());
      const cosHome = Math.cos(HOME_BASE.lat * (Math.PI / 180));
      for (const [lng, lat] of dots) {
        const [x, y] = px(lng, lat);
        if (x < -4 || y < -4 || x > W + 4 || y > H + 4) continue;
        const dh = Math.hypot((lng - HOME_BASE.lng) * cosHome, lat - HOME_BASE.lat);
        const reveal = Math.min(1, Math.max(0, (st.sweep - dh) / 12));
        if (reveal <= 0) continue;
        let b = 0.14 + 0.3 * Math.exp(-(dh * dh) / 90);
        if (act) {
          const da = Math.hypot((lng - act.stop.lng) * Math.cos(lat * (Math.PI / 180)), lat - act.stop.lat);
          b += 0.5 * st.focus.v * Math.exp(-(da * da) / 110);
        }
        const level = Math.min(5, Math.round(b * reveal * 7));
        if (level <= 0) continue;
        buckets[level].rect(x - rad, y - rad, rad * 2, rad * 2);
      }
      buckets.forEach((path, i) => {
        if (!i) return;
        ctx.fillStyle = `rgba(${LIGHT},${(0.06 + i * 0.15).toFixed(3)})`;
        ctx.fill(path);
      });

      // Routes.
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const [slug, r] of routes) {
        if (r.home) continue;
        const p = st.arcs.get(slug)?.p ?? 0;
        if (p <= 0) continue;
        const pts = r.path.map(([lng, lat]) => px(lng, lat));
        const n = Math.max(2, Math.round(pts.length * p));
        const isActive = st.active === slug;
        ctx.beginPath();
        pts.slice(0, n).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        if (isActive) {
          ctx.setLineDash([]);
          ctx.strokeStyle = `rgba(${actRgb},${0.22 * st.focus.v})`;
          ctx.lineWidth = 7 * dpr;
          ctx.stroke();
          ctx.setLineDash([6 * dpr, 7 * dpr]);
          ctx.lineDashOffset = -time * 34 * dpr;
          ctx.strokeStyle = `rgba(${actRgb},${0.55 + 0.45 * st.focus.v})`;
          ctx.lineWidth = 2 * dpr;
        } else {
          ctx.setLineDash([0.5 * dpr, 5 * dpr]);
          ctx.lineDashOffset = 0;
          ctx.strokeStyle = `rgba(${LIGHT},${st.active ? 0.2 : 0.42})`;
          ctx.lineWidth = 1.6 * dpr;
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // The airliner flying the active route.
      if (act && !act.home && (st.arcs.get(act.stop.slug)?.p ?? 0) >= 1) {
        const pts = act.path.map(([lng, lat]) => px(lng, lat));
        const f = (time * 0.16) % 1;
        const idx = Math.min(pts.length - 2, Math.floor(f * (pts.length - 1)));
        const local = f * (pts.length - 1) - idx;
        const [x0, y0] = pts[idx];
        const [x1, y1] = pts[idx + 1];
        const s = (18 * dpr) / 24;
        ctx.save();
        ctx.globalAlpha = st.focus.v * Math.min(1, f * 12, (1 - f) * 12);
        ctx.translate(x0 + (x1 - x0) * local, y0 + (y1 - y0) * local);
        ctx.rotate(Math.atan2(y1 - y0, x1 - x0));
        ctx.scale(s, s);
        ctx.translate(-12, -12);
        ctx.lineWidth = 2.4 / s;
        ctx.strokeStyle = "#06070a";
        ctx.stroke(plane);
        ctx.fillStyle = `rgb(${actRgb})`;
        ctx.fill(plane);
        ctx.restore();
      }

      // Markers and labels.
      const label = (text: string, x: number, y: number, color: string, size = 10) => {
        ctx.font = `500 ${size * dpr}px ${mono}`;
        ctx.fillStyle = color;
        ctx.fillText(text, x, y);
      };
      ctx.textBaseline = "middle";
      // On a short hop (Manali, Delhi) the city sits right on top of IXC:
      // split the two label pairs vertically so they never collide.
      const [hx, hy] = px(HOME_BASE.lng, HOME_BASE.lat);
      let homeLift = 0;
      for (const r of routes.values()) {
        if (r.home) continue;
        const arc = st.arcs.get(r.stop.slug)?.p ?? 0;
        if (arc < 1) continue;
        const [x, y] = px(r.stop.lng, r.stop.lat);
        const isActive = st.active === r.stop.slug;
        const rgb = hexToRgb(r.stop.glow);
        if (isActive) {
          const beat = (time % 1.8) / 1.8;
          ctx.beginPath();
          ctx.arc(x, y, (5 + beat * 20) * dpr, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${rgb},${(1 - beat) * 0.7 * st.focus.v})`;
          ctx.lineWidth = 1.2 * dpr;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(x, y, (isActive ? 4.5 : 3) * dpr, 0, Math.PI * 2);
        ctx.fillStyle = isActive ? `rgb(${rgb})` : `rgba(${LIGHT},0.75)`;
        ctx.fill();
        if (isActive) {
          const near = Math.hypot(x - hx, y - hy) < 80 * dpr;
          const lift = near ? (y <= hy ? -14 : 14) * dpr : 0;
          homeLift = -lift;
          label(r.stop.code, x + 12 * dpr, y - 7 * dpr + lift, `rgb(${rgb})`, 12);
          label(r.stop.name.toUpperCase(), x + 12 * dpr, y + 8 * dpr + lift, `rgba(${LIGHT},0.85)`, 9.5);
        } else if (!st.active) {
          label(r.stop.code, x + 8 * dpr, y, `rgba(${LIGHT},0.55)`, 9.5);
        }
      }
      // Home: IXC, always on.
      if (st.sweep > 0) {
        const beat = (time % 2.2) / 2.2;
        ctx.beginPath();
        ctx.arc(hx, hy, (6 + beat * 26) * dpr, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${SIGNAL},${(1 - beat) * 0.6})`;
        ctx.lineWidth = 1.2 * dpr;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(hx, hy, 4.5 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${SIGNAL})`;
        ctx.fill();
        label("IXC", hx - 34 * dpr, hy - 7 * dpr + homeLift, `rgb(${SIGNAL})`, 12);
        label("HOME", hx - 34 * dpr, hy + 8 * dpr + homeLift, `rgba(${LIGHT},0.6)`, 9);
      }
    };

    let visible = true;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting === visible) return;
      visible = entry.isIntersecting;
      cancelAnimationFrame(raf);
      if (visible) raf = requestAnimationFrame(draw);
    });
    io.observe(canvas);
    t0 = performance.now();
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      api.current = null;
    };
  }, [stops]);

  // Arrival: the land sweeps in from IXC, then the routes draw outward.
  useEffect(() => {
    if (!play) return;
    const st = state.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const arcs = [...st.arcs.values()];
    if (reduce) {
      st.sweep = 400;
      arcs.forEach((a) => (a.p = 1));
      return;
    }
    const tl = gsap.timeline();
    tl.to(st, { sweep: 400, duration: 2.6, ease: "power2.in" }, 0);
    arcs.forEach((a, i) => tl.to(a, { p: 1, duration: 1.1, ease: "power2.inOut" }, 0.7 + i * 0.1));
    return () => {
      tl.kill();
    };
  }, [play]);

  // The camera follows the active destination.
  useEffect(() => {
    const st = state.current;
    st.active = active;
    api.current?.fit(active);
    gsap.fromTo(st.focus, { v: 0 }, { v: 1, duration: 1.2, ease: "power2.out", overwrite: true });
  }, [active]);

  return <canvas ref={canvasRef} className="atlas-canvas" aria-hidden />;
}
