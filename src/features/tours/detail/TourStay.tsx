"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, Globe, Star, X } from "@phosphor-icons/react";
import { gsap, MOTION_QUERIES, useGSAP } from "@/lib/gsap";
import type { TourPageData } from "../tourData";

/**
 * Where you sleep: the hotel as a room key card. It leans towards the
 * pointer with a holographic sheen, and turns over (click, tap or Enter) to
 * the magnetic stripe and the fine print: the amenities.
 */
export function TourStay({ tour }: { tour: TourPageData }) {
  const root = useRef<HTMLElement>(null);
  const tilt = useRef<HTMLDivElement>(null);
  const [flipped, setFlipped] = useState(false);
  const h = tour.hotel;
  const nights = Math.max(1, tour.durationDays - 1);

  useEffect(() => {
    const el = tilt.current;
    if (!el || !window.matchMedia("(hover: hover) and (pointer: fine)").matches || window.matchMedia(MOTION_QUERIES.reduce).matches) return;
    const rx = gsap.quickTo(el, "rotationX", { duration: 0.8, ease: "power3.out" });
    const ry = gsap.quickTo(el, "rotationY", { duration: 0.8, ease: "power3.out" });
    gsap.set(el, { transformPerspective: 1100 });
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      rx((0.5 - py) * 14);
      ry((px - 0.5) * 18);
      el.style.setProperty("--sx", `${(px * 100).toFixed(1)}%`);
      el.style.setProperty("--sy", `${(py * 100).toFixed(1)}%`);
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

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_QUERIES, (context) => {
        const full = Boolean(context.conditions?.full);
        const el = root.current!;
        gsap.fromTo(el.querySelectorAll("[data-a=fade]"), { autoAlpha: 0, y: full ? 24 : 0 }, { autoAlpha: 1, y: 0, duration: 1, ease: "power3.out", stagger: 0.07, scrollTrigger: { trigger: el, start: "top 72%", once: true } });
        if (full) gsap.fromTo(el.querySelector(".tds-card"), { autoAlpha: 0, y: 80, rotation: -8 }, { autoAlpha: 1, y: 0, rotation: 0, duration: 1.4, ease: "expo.out", scrollTrigger: { trigger: el, start: "top 70%", once: true } });
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} className="tds" aria-labelledby="stay-title">
      <div className="tds-inner">
        <div className="tds-copy">
          <p data-a="fade" className="tds-kicker">
            Where you sleep
          </p>
          <h2 data-a="fade" id="stay-title" className="tds-title">
            {h.name}
          </h2>
          <p data-a="fade" className="tds-area">
            <span className="tds-stars" aria-label={`${h.stars} star hotel`}>
              {Array.from({ length: h.stars }, (_, i) => (
                <Star key={i} size={13} weight="fill" aria-hidden />
              ))}
            </span>
            {h.area}
          </p>
          <p data-a="fade" className="tds-desc">
            {h.description}
          </p>
          <ul data-a="fade" className="tds-amen" aria-label="Amenities">
            {h.amenities.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>

        <div className="tds-card-wrap">
          <div ref={tilt} className="tds-card">
            <button type="button" className="tds-flip" data-flipped={flipped || undefined} onClick={() => setFlipped((f) => !f)} aria-pressed={flipped} aria-label={flipped ? "Turn the room key back over" : "Turn the room key over"}>
              <span className="tds-face tds-front">
                <span className="tds-sheen" aria-hidden />
                <span className="tds-card-top">
                  <span className="tds-brand">
                    <Globe size={16} weight="bold" aria-hidden /> Longitude
                  </span>
                  <span>Room key</span>
                </span>
                <span className="tds-chip" aria-hidden />
                <span className="tds-card-name">{h.name}</span>
                <span className="tds-card-foot">
                  <span>
                    {tour.flight} · {nights} {nights === 1 ? "night" : "nights"}
                  </span>
                  <span className="tds-card-stars" aria-hidden>
                    {"★".repeat(h.stars)}
                  </span>
                </span>
              </span>
              <span className="tds-face tds-back">
                <span className="tds-stripe" aria-hidden />
                <span className="tds-fine">
                  <b>{h.name}</b>
                  {h.area}
                  <br />
                  {h.amenities.join(" · ")}
                </span>
                <span className="tds-sign" aria-hidden>
                  Authorised signature
                </span>
              </span>
            </button>
          </div>
          <p className="tds-hint" aria-hidden>
            {flipped ? "Tap to turn it back" : "Tap the key to turn it over"}
          </p>
        </div>
      </div>
    </section>
  );
}

/** What's in the bag: included items tick themselves off; the rest is struck through. */
export function TourPack({ tour }: { tour: TourPageData }) {
  const root = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_QUERIES, (context) => {
        const full = Boolean(context.conditions?.full);
        const el = root.current!;
        gsap.fromTo(el.querySelectorAll("[data-a=fade]"), { autoAlpha: 0, y: full ? 24 : 0 }, { autoAlpha: 1, y: 0, duration: 1, ease: "power3.out", stagger: 0.07, scrollTrigger: { trigger: el, start: "top 75%", once: true } });
        el.querySelectorAll<HTMLElement>(".tdp-list").forEach((list) => {
          const items = list.querySelectorAll(".tdp-item");
          const marks = list.querySelectorAll(".tdp-mark");
          const tl = gsap.timeline({ scrollTrigger: { trigger: list, start: "top 78%", once: true } });
          tl.fromTo(items, { autoAlpha: 0, x: full ? -18 : 0 }, { autoAlpha: 1, x: 0, duration: 0.7, ease: "power3.out", stagger: 0.08 }, 0);
          if (full) tl.fromTo(marks, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.45, ease: "power2.out", stagger: 0.08 }, 0.25);
        });
      });
    },
    { scope: root },
  );
  return (
    <section ref={root} className="tdp" aria-labelledby="pack-title">
      <div className="tdp-inner">
        <p data-a="fade" className="tdp-kicker">
          What&apos;s in the bag
        </p>
        <h2 data-a="fade" id="pack-title" className="tdp-title">
          Everything paid for, <em>nothing guessed.</em>
        </h2>
        <div className="tdp-cols">
          <div>
            <p className="tdp-col-title">Included</p>
            <ul className="tdp-list">
              {tour.includes.map((x) => (
                <li key={x} className="tdp-item">
                  <span className="tdp-mark" style={{ "--m": "var(--glow)" } as CSSProperties}>
                    <Check size={14} weight="bold" aria-hidden />
                  </span>
                  {x}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="tdp-col-title">Not included</p>
            <ul className="tdp-list">
              {tour.excludes.map((x) => (
                <li key={x} className="tdp-item tdp-no">
                  <span className="tdp-mark">
                    <X size={14} weight="bold" aria-hidden />
                  </span>
                  {x}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
