"use client";

import { useEffect, useRef } from "react";
import { PLANE_PATH } from "@/features/globe/route/plane";

const DEG = Math.PI / 180;
/** Earth's axial tilt, like a desk globe. */
const AXIAL_TILT = 23.4 * DEG;
/** The camera sits a little above the equator. */
const VIEW_ELEVATION = 16 * DEG;
/** The orbit, seen from slightly above and tipped against the globe. */
const RING_ELEVATION = 14 * DEG;
const RING_TILT = -12 * DEG;
/** Seconds for one turn of the globe, and one lap of the airplane. */
const SPIN_S = 16;
const ORBIT_S = 6.5;
/** Reduced motion: the same scene, turning at about a third of the speed. */
const REDUCED_RATE = 0.35;
const LIGHT = "247 244 239";
const SIGNAL = "230 163 106";
const SPACE = "#06070a";

type Pt = { x: number; y: number; z: number };

/**
 * The outro's emblem: a small wireframe globe turning on a tilted axis, the
 * destination's own line of longitude picked out in the accent with a beacon
 * where the city is, and an airliner flying laps on a dotted orbit, trailing
 * a contrail and passing behind the globe and out again. Drawn on a canvas
 * (exact projection and depth order) and only animated while `running`.
 */
export function OutroGlobe({ lat, lng, running }: { lat: number; lng: number; running: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clock = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const plane = new Path2D(PLANE_PATH);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let size = 0;
    let dpr = 1;

    const draw = (t: number) => {
      if (!size) return;
      const S = size;
      const cx = S / 2;
      const cy = S / 2;
      const R = S * 0.26;
      const RO = S * 0.43;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, S, S);

      const spin = (t / SPIN_S) * Math.PI * 2;
      const sinE = Math.sin(VIEW_ELEVATION);
      const cosE = Math.cos(VIEW_ELEVATION);
      const sinT = Math.sin(AXIAL_TILT);
      const cosT = Math.cos(AXIAL_TILT);
      const onGlobe = (phi: number, lam: number): Pt => {
        const cp = Math.cos(phi);
        const x = cp * Math.sin(lam + spin);
        const y = Math.sin(phi);
        const z = cp * Math.cos(lam + spin);
        const y1 = y * cosE - z * sinE;
        const z1 = y * sinE + z * cosE;
        return { x: cx + R * (x * cosT + y1 * sinT), y: cy - R * (y1 * cosT - x * sinT), z: z1 };
      };
      const sinRE = Math.sin(RING_ELEVATION);
      const cosRE = Math.cos(RING_ELEVATION);
      const sinRT = Math.sin(RING_TILT);
      const cosRT = Math.cos(RING_TILT);
      const onRing = (a: number): Pt => {
        const x = Math.cos(a);
        const s = Math.sin(a);
        const y1 = -s * sinRE;
        return { x: cx + RO * (x * cosRT + y1 * sinRT), y: cy - RO * (y1 * cosRT - x * sinRT), z: s * cosRE };
      };

      // Curves split into the half behind the globe and the half in front.
      const halves = (pts: Pt[]) => {
        const back = new Path2D();
        const front = new Path2D();
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          const path = a.z + b.z >= 0 ? front : back;
          path.moveTo(a.x, a.y);
          path.lineTo(b.x, b.y);
        }
        return { back, front };
      };
      const grid = { back: new Path2D(), front: new Path2D() };
      for (let m = 0; m < 12; m++) {
        const lam = m * 30 * DEG;
        const h = halves(Array.from({ length: 25 }, (_, i) => onGlobe((-90 + i * 7.5) * DEG, lam)));
        grid.back.addPath(h.back);
        grid.front.addPath(h.front);
      }
      for (const p of [-60, -30, 0, 30, 60]) {
        const h = halves(Array.from({ length: 49 }, (_, i) => onGlobe(p * DEG, i * 7.5 * DEG)));
        grid.back.addPath(h.back);
        grid.front.addPath(h.front);
      }
      const home = halves(Array.from({ length: 25 }, (_, i) => onGlobe((-90 + i * 7.5) * DEG, lng * DEG)));

      // The airplane and its contrail (the angle runs backwards: front half left → right).
      const a0 = -(t / ORBIT_S) * Math.PI * 2 + Math.PI * 0.85;
      const pos = onRing(a0);
      const ahead = onRing(a0 - 0.03);
      const heading = Math.atan2(ahead.y - pos.y, ahead.x - pos.x);
      const trail = Array.from({ length: 24 }, (_, i) => onRing(a0 + i * 0.045));
      const drawTrail = (front: boolean) => {
        ctx.lineWidth = 1.3;
        ctx.lineCap = "round";
        for (let i = 1; i < trail.length; i++) {
          const a = trail[i - 1];
          const b = trail[i];
          if (a.z + b.z >= 0 !== front) continue;
          ctx.strokeStyle = `rgb(${SIGNAL} / ${(0.75 * (1 - i / trail.length)).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      };
      const drawRing = (front: boolean) => {
        ctx.fillStyle = `rgb(${LIGHT} / ${front ? 0.5 : 0.2})`;
        for (let i = 0; i < 64; i++) {
          const p = onRing((i / 64) * Math.PI * 2);
          if (p.z >= 0 !== front) continue;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
      };
      const drawPlane = () => {
        const s = ((S * 0.13) / 24) * (1 + 0.12 * pos.z);
        ctx.save();
        ctx.globalAlpha = pos.z >= 0 ? 1 : 0.7;
        ctx.translate(pos.x, pos.y);
        ctx.rotate(heading);
        ctx.scale(s, s);
        ctx.translate(-12, -12);
        ctx.lineJoin = "round";
        ctx.lineWidth = 1.6 / s;
        ctx.strokeStyle = SPACE;
        ctx.stroke(plane);
        ctx.fillStyle = "#f6f1ea";
        ctx.fill(plane);
        ctx.restore();
      };

      // 1 · everything behind the globe
      drawRing(false);
      drawTrail(false);
      if (pos.z < 0) drawPlane();

      // 2 · the globe: a dark body lit from the upper left
      const body = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.45, R * 0.05, cx, cy, R);
      body.addColorStop(0, "#1b1d23");
      body.addColorStop(1, "#08090c");
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgb(${LIGHT} / 0.09)`;
      ctx.stroke(grid.back);
      ctx.strokeStyle = `rgb(${SIGNAL} / 0.2)`;
      ctx.stroke(home.back);
      ctx.strokeStyle = `rgb(${LIGHT} / 0.34)`;
      ctx.stroke(grid.front);
      // Night side: the lines fade toward the lower right.
      const shade = ctx.createRadialGradient(cx - R * 0.5, cy - R * 0.55, R * 0.2, cx - R * 0.15, cy - R * 0.15, R * 1.3);
      shade.addColorStop(0, "rgb(6 7 10 / 0)");
      shade.addColorStop(1, "rgb(6 7 10 / 0.62)");
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
      const rim = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      rim.addColorStop(0, `rgb(${LIGHT} / 0.75)`);
      rim.addColorStop(1, `rgb(${LIGHT} / 0.16)`);
      ctx.strokeStyle = rim;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();

      // 3 · the destination's meridian and a beacon on the city
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = `rgb(${SIGNAL} / 0.95)`;
      ctx.stroke(home.front);
      const city = onGlobe(lat * DEG, lng * DEG);
      if (city.z > 0.05) {
        const fade = Math.min(1, (city.z - 0.05) * 4);
        const beat = (t % 1.8) / 1.8;
        ctx.strokeStyle = `rgb(${SIGNAL} / ${(0.8 * (1 - beat) * fade).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(city.x, city.y, 2 + beat * 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgb(255 236 214 / ${fade.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(city.x, city.y, 1.9, 0, Math.PI * 2);
        ctx.fill();
      }

      // 4 · everything in front
      drawRing(true);
      drawTrail(true);
      if (pos.z >= 0) drawPlane();
    };

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      size = canvas.clientWidth;
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      draw(clock.current);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      clock.current += dt * (reduce.matches ? REDUCED_RATE : 1);
      draw(clock.current);
      raf = requestAnimationFrame(tick);
    };
    if (running) raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [running, lat, lng]);

  return <canvas ref={canvasRef} className="relative block h-full w-full" />;
}
