"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Airplane, ArrowUpRight } from "@phosphor-icons/react";
import { formatDays, formatInr } from "@/lib/format";
import { gsap } from "@/lib/gsap";
import { thumb, type TourCard, type TourCity } from "./tourData";

/**
 * A tour as a boarding pass: the photo above the perforation, the flight
 * below it. With a mouse, the pass leans towards the pointer (a glare
 * follows it) and moving across the photo leafs through the tour's
 * pictures, one per segment of the bar along its top.
 */
export function TourPass({ tour, city }: { tour: TourCard; city: TourCity }) {
  const core = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  const photos = tour.images.map((u) => thumb(u, 960));
  const count = photos.length;

  useEffect(() => {
    const el = core.current;
    if (!el) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const photo = el.querySelector<HTMLElement>(".tp-photo");
    const rx = gsap.quickTo(el, "rotationX", { duration: 0.7, ease: "power3.out" });
    const ry = gsap.quickTo(el, "rotationY", { duration: 0.7, ease: "power3.out" });
    gsap.set(el, { transformPerspective: 900 });
    let last = 0;
    // Where the pass and its photo are, read when the pointer comes in (the pass doesn't move
    // under it meanwhile: the route stops taking the pointer while it scrolls), and the latest
    // pointer position, applied once a frame.
    let r: DOMRect | null = null;
    let p: DOMRect | null = null;
    let cx = 0;
    let cy = 0;
    let frame = 0;
    const apply = () => {
      frame = 0;
      if (!r) return;
      const px = (cx - r.left) / r.width;
      const py = (cy - r.top) / r.height;
      rx((0.5 - py) * 7);
      ry((px - 0.5) * 9);
      el.style.setProperty("--gx", `${(px * 100).toFixed(1)}%`);
      el.style.setProperty("--gy", `${(py * 100).toFixed(1)}%`);
      if (!p || cy > p.bottom) return;
      const i = Math.max(0, Math.min(count - 1, Math.floor(((cx - p.left) / p.width) * count)));
      if (i !== last) {
        last = i;
        setShown(i);
      }
    };
    const enter = () => {
      r = el.getBoundingClientRect();
      p = photo?.getBoundingClientRect() ?? null;
    };
    const move = (e: PointerEvent) => {
      if (!r) enter();
      cx = e.clientX;
      cy = e.clientY;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const leave = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      r = p = null;
      rx(0);
      ry(0);
      last = 0;
      setShown(0);
    };
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("pointerenter", enter);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [count]);

  return (
    <article className="tp" data-tour-card style={{ "--glow": city.theme.glow } as CSSProperties}>
      <div ref={core} className="tp-core">
        <div className="tp-photo" data-tour-frame>
          <div className="tp-photo-track">
            {photos.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- remote photos, crossfaded in place
              <img key={src} src={src} alt={i === 0 ? `${tour.name}, ${city.name}` : ""} data-on={i === shown || undefined} loading="lazy" decoding="async" />
            ))}
          </div>
          <div className="tp-segs" aria-hidden>
            {photos.map((src, i) => (
              <i key={src} data-on={i === shown || undefined} />
            ))}
          </div>
          <p className="tp-days">{formatDays(tour.durationDays)}</p>
          {tour.featured && <p className="tp-badge">Most booked</p>}
        </div>

        <div className="tp-perf" aria-hidden />

        <div className="tp-body">
          <p className="tp-route" aria-label={`${tour.flight}, Chandigarh to ${city.name}`}>
            <span>IXC</span>
            <span className="tp-route-line" aria-hidden>
              <Airplane size={13} weight="fill" />
            </span>
            <span>{city.code}</span>
            <em>{tour.flight}</em>
          </p>
          <h4 className="tp-name">
            <Link
              href={`/tours/${tour.slug}`}
              className="tp-link"
              data-tour-photo={thumb(tour.images[0], 1280)}
              data-tour-flight={`${tour.flight} · IXC → ${city.code}`}
              data-tour-name={tour.name}
            >
              {tour.name}
            </Link>
          </h4>
          <p className="tp-summary">{tour.summary}</p>
          <dl className="tp-meta">
            <div>
              <dt>Pace</dt>
              <dd>{tour.pace}</dd>
            </div>
            <div>
              <dt>Group</dt>
              <dd>{tour.groupSize}</dd>
            </div>
          </dl>
          <ul className="tp-sights" aria-label="Highlights">
            {tour.highlights.map((h) => (
              <li key={h}>
                <i aria-hidden />
                {h}
              </li>
            ))}
          </ul>
          <div className="tp-foot">
            <p className="tp-price">
              <span>From, per person</span>
              <b>{formatInr(tour.priceInr)}</b>
            </p>
            <span className="tp-cta" aria-hidden>
              View tour
              <span className="tp-cta-icon">
                <ArrowUpRight size={14} weight="bold" />
              </span>
            </span>
          </div>
        </div>
        <span className="tp-glare" aria-hidden />
      </div>
    </article>
  );
}
