"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import type { Attraction } from "@/lib/types";
import type { LoadedDestination } from "@/features/destinations/destinationService";
import { gsap, MOTION_QUERIES, useGSAP } from "@/lib/gsap";

/** Scroll speed of the marquee, CSS px per second. */
const SPEED = 70;

/**
 * Two-line marquee that opens the destination section, right after the 3D
 * journey: the landmarks drift one way, an italic line about the place drifts
 * the other. The drift is a compositor-only CSS animation (transform on a
 * duplicated track), so it never stutters; scrolling adds a gentle push.
 */
export function DestinationMarquee({ data, attractions }: { data: LoadedDestination; attractions: Attraction[] }) {
  const root = useRef<HTMLDivElement>(null);
  const d = data.destination;

  const landmarks = useMemo(() => (attractions.length ? attractions.map((a) => a.name) : [d.name]), [attractions, d.name]);
  const phrases = useMemo(() => placePhrases(d), [d]);

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const rows = gsap.utils.toArray<HTMLElement>("[data-row]", el);
      const mm = gsap.matchMedia();
      mm.add(MOTION_QUERIES, (context) => {
        const full = Boolean(context.conditions?.full);
        // Rows glide in from opposite sides when the section arrives…
        gsap.fromTo(
          rows,
          { opacity: 0, xPercent: (i) => (i === 0 ? -1 : 1) * (full ? 6 : 1.5) },
          {
            opacity: 1,
            xPercent: 0,
            duration: 1.4,
            ease: "expo.out",
            stagger: 0.12,
            scrollTrigger: { trigger: el, start: "top 92%", toggleActions: "play none none reverse" },
          },
        );
        // …and scrolling nudges them further apart (on an outer wrapper, so it
        // composes with the CSS drift instead of fighting it).
        if (full) {
          gsap.fromTo(
            gsap.utils.toArray<HTMLElement>("[data-push]", el),
            { x: (i) => (i === 0 ? 1 : -1) * 60 },
            { x: (i) => (i === 0 ? -1 : 1) * 60, ease: "none", scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: 0.8 } },
          );
        }
      });
    },
    { scope: root },
  );

  return (
    <div ref={root} className="marquee relative overflow-hidden border-y border-line py-7 md:py-10">
      <p className="sr-only">
        {d.name}: {landmarks.join(", ")}.
      </p>
      {/* Rows overhang both edges so the scroll push never reveals an empty strip. */}
      <div data-push="" className="-mx-24">
        <MarqueeRow items={landmarks} direction="left" className="font-sans font-medium tracking-[-0.045em] text-fg" />
      </div>
      <div data-push="" className="-mx-24 mt-1 md:mt-2">
        <MarqueeRow items={phrases} direction="right" className="font-serif italic tracking-[-0.01em] text-fg/[0.32]" />
      </div>
    </div>
  );
}

function MarqueeRow({ items, direction, className }: { items: string[]; direction: "left" | "right"; className: string }) {
  const track = useRef<HTMLDivElement>(null);
  // One copy must be wider than any screen for a seamless loop: repeat short lists.
  const copy = useMemo(() => {
    const out: string[] = [];
    while (out.length < 8) out.push(...items);
    return out;
  }, [items]);

  // Constant speed whatever the text length: duration = copy width / SPEED.
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => {
      const width = el.scrollWidth / 2;
      if (width > 0) el.style.setProperty("--marquee-duration", `${(width / SPEED).toFixed(2)}s`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    void document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [copy]);

  return (
    <div data-row="" className="marquee-row" aria-hidden="true">
      <div ref={track} className={`marquee-track ${className}`} data-direction={direction}>
        {[0, 1].map((n) => (
          <div key={n} className="marquee-copy">
            {copy.map((text, i) => (
              <span key={i} className="marquee-item">
                {text}
                <span className="marquee-dot" />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** "Twenty arrondissements, one river, and a bakery…" → short phrases, plus region and country. */
function placePhrases(d: LoadedDestination["destination"]): string[] {
  const fromTagline = (d.tagline ?? "")
    .replace(/[.!?]+$/, "")
    .split(/,\s*(?:and\s+)?|\s+and\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 2 && s.length < 42)
    .map((s) => s[0].toUpperCase() + s.slice(1));
  const place = [d.region, d.country].filter((x): x is string => !!x && x !== d.name);
  const out = [...fromTagline, ...place];
  return out.length ? out : [d.name];
}
