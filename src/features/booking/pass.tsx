"use client";

import { memo, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatInr } from "@/lib/format";
import { gsap, MOTION_QUERIES } from "@/lib/gsap";

/** Seats in the order the tour page's cabin map fills them: two rows, A–C | D–F. */
export function seatsFor(travelers: number): string {
  const seats = Array.from({ length: travelers }, (_, i) => `${Math.floor(i / 6) + 1}${"ABCDEF"[i % 6]}`);
  if (seats.length <= 2) return seats.join(", ");
  return `${seats[0]}–${seats[seats.length - 1]}`;
}

/** "Sun 1 Nov" from YYYY-MM-DD, without timezone drift. */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** A fare that rolls to its new value instead of jumping. */
export function Fare({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [first] = useState(value);
  const shown = useRef(value);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || shown.current === value) return;
    const st = { v: shown.current };
    shown.current = value;
    const tw = gsap.to(st, {
      v: value,
      duration: window.matchMedia(MOTION_QUERIES.reduce).matches ? 0 : 0.7,
      ease: "power3.out",
      onUpdate: () => void (el.textContent = formatInr(Math.round(st.v))),
    });
    return () => void tw.kill();
  }, [value]);
  return <span ref={ref}>{formatInr(first)}</span>;
}

/**
 * A value that rolls into place when it changes: the new text rises out of a
 * mask (a CSS animation, replayed by keying the inner span on the value).
 */
export function Swap({ value, className }: { value: string; className?: string }) {
  return (
    <span className={className ? `nt-swap ${className}` : "nt-swap"}>
      <span key={value}>{value}</span>
    </span>
  );
}

/** Bars of a barcode drawn from a string, so each pass has its own (redrawn only when the string changes). */
export const Barcode = memo(function Barcode({ seed, className }: { seed: string; className?: string }) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  for (let i = 0; i < 46; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    const w = 1 + ((h >>> 3) % 3);
    const gap = 1 + ((h >>> 9) % 2);
    bars.push({ x, w });
    x += w + gap;
  }
  return (
    <svg className={className} viewBox={`0 0 ${x} 24`} preserveAspectRatio="none" aria-hidden>
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y="0" width={b.w} height="24" />
      ))}
    </svg>
  );
});

/**
 * The pass leans towards the pointer a little, with a sheen (its
 * `.nt-pass-sheen`) that follows it; fine pointers only, never with reduced
 * motion. Both move by transform alone, so nothing down the pass's many
 * flaps restyles or repaints while they do.
 */
export function usePassTilt() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !matchMedia("(hover: hover) and (pointer: fine)").matches || matchMedia(MOTION_QUERIES.reduce).matches) return;
    gsap.set(el, { transformPerspective: 1400 });
    const rx = gsap.quickTo(el, "rotationX", { duration: 0.6, ease: "power3.out" });
    const ry = gsap.quickTo(el, "rotationY", { duration: 0.6, ease: "power3.out" });
    // The sheen rests at the top middle of the pass; these are offsets from there.
    const sheen = el.querySelector(".nt-pass-sheen");
    const sx = sheen && gsap.quickTo(sheen, "x", { duration: 0.45, ease: "power3.out" });
    const sy = sheen && gsap.quickTo(sheen, "y", { duration: 0.45, ease: "power3.out" });
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      rx(-py * 3.2);
      ry(px * 4.2);
      if (sx && sy) {
        sx(px * r.width);
        sy((py + 0.5) * r.height);
      }
    };
    const leave = () => {
      rx(0);
      ry(0);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, []);
  return ref;
}

/** "01 NOV" from YYYY-MM-DD, the way a boarding pass prints it. */
export function passDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }).toUpperCase();
}

/** Seats as a boarding pass prints them: "1A", "1A 1B", "1A-2B". */
export function passSeats(travelers: number): string {
  const seat = (i: number) => `${Math.floor(i / 6) + 1}${"ABCDEF"[i % 6]}`;
  if (travelers <= 1) return seat(0);
  if (travelers === 2) return `${seat(0)} ${seat(1)}`;
  return `${seat(0)}-${seat(travelers - 1)}`;
}

// A shared minute clock: one timer for every reader, and nothing on the server.
const clockListeners = new Set<() => void>();
let clockTimer = 0;
function subscribeClock(cb: () => void) {
  clockListeners.add(cb);
  if (!clockTimer) clockTimer = window.setInterval(() => clockListeners.forEach((l) => l()), 5000);
  return () => {
    clockListeners.delete(cb);
    if (!clockListeners.size) {
      window.clearInterval(clockTimer);
      clockTimer = 0;
    }
  };
}

/** The time now in a time zone, "HH:MM", updating as the minute turns ("--:--" until hydrated). */
export function useClock(timezone: string) {
  return useSyncExternalStore(
    subscribeClock,
    () => {
      try {
        return new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone });
      } catch {
        return "--:--";
      }
    },
    () => "--:--",
  );
}
