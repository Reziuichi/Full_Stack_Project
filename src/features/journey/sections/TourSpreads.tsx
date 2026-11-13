"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight } from "@phosphor-icons/react";
import type { Destination, TourPackage } from "@/lib/types";
import { formatInr } from "@/lib/format";
import { formatCoordinates } from "@/lib/geo";
import { gsap, MOTION_QUERIES, useGSAP } from "@/lib/gsap";
import { scrambleText } from "@/lib/textFx";
import { PLANE_PATH } from "@/features/globe/route/plane";
import { tourThemeFor, tourThemeStyle } from "@/lib/tourThemes";

// Scroll choreography, in timeline units (one unit ≈ VH_PER_UNIT of scrolling).
const COVER = 0.35; // the amber cover holds with the section title
const ENTER = 1; // the curtain pulls back, a tour slides in, its copy rises
const HOLD = 0.7; // reading time per tour
const LEAVE = 0.6; // copy out, the curtain sweeps back across the photos
const TAIL = 0.3;
const VH_PER_UNIT = 62;

const COUNT_WORDS = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const pad2 = (n: number) => String(n).padStart(2, "0");
const cssUrl = (u: string) => `url("${u.replace(/"/g, "%22")}")`;

/** Two photos per tour: its first landmark and its last (the city shot is shared by every tour). */
function photosOf(p: TourPackage): [string, string] {
  const im = p.images.filter(Boolean);
  return [im[1] ?? im[0] ?? "", im.length > 2 ? im[im.length - 1] : (im[0] ?? "")];
}

/**
 * Tour packages as a pinned, scroll-scrubbed "panel conveyor". An amber
 * cover names the section; scrolling pulls the amber back like a curtain
 * while the first tour's photo columns slide in from the left and its copy
 * rises on an amber panel. Each next tour: the copy lifts away, the curtain
 * sweeps back across the photos, the next number drifts past, and the next
 * tour slides in behind it. A spinning badge on the photos links to the
 * tour. Everything animates transform and opacity only, except the one-off
 * colour bloom on arrival (a clip-path circle, cleared once it has opened).
 * The colours are the destination's own (see lib/tourThemes.ts).
 */
export function TourSpreads({ destination: d, packages }: { destination: Destination; packages: TourPackage[] }) {
  const root = useRef<HTMLDivElement>(null);
  const T = packages.length;
  const theme = tourThemeFor(d.slug);

  const settle = (k: number) => COVER + ENTER + k * (HOLD + LEAVE + ENTER);
  const leaveAt = useCallback((k: number) => COVER + ENTER + k * (HOLD + LEAVE + ENTER) + HOLD, []);
  const enterAt = useCallback((k: number) => (k === 0 ? COVER : leaveAt(k - 1) + LEAVE), [leaveAt]);
  const total = settle(T - 1) + HOLD + TAIL;

  // -1 cover · 0..T-1 tour on show.
  const [active, setActive] = useState(-1);
  const activeRef = useRef(-1);
  const track = useCallback(
    (progress: number) => {
      const unit = progress * total;
      let next = unit < COVER + ENTER * 0.4 ? -1 : 0;
      for (let k = 1; k < T; k++) if (unit >= enterAt(k)) next = k;
      if (next !== activeRef.current) {
        activeRef.current = next;
        setActive(next);
      }
    },
    [T, enterAt, total],
  );

  // The price decodes like the rest of the HUD whenever its tour comes up.
  useEffect(() => {
    if (active < 0) return;
    const el = root.current?.querySelectorAll('[data-t="price"]')[active] ?? null;
    const fx = scrambleText(el, { duration: 0.8 });
    return () => {
      fx.tween.kill();
      fx.restore();
    };
  }, [active]);

  useGSAP(
    () => {
      const el = root.current;
      if (!el || T === 0) return;
      const all = (s: string, scope: Element = el) => gsap.utils.toArray<HTMLElement>(`[data-t="${s}"]`, scope);
      const one = (s: string) => all(s)[0];
      const tracks = all("track");
      const panels = all("pc");
      const nums = all("num");
      const curtain = one("curtain");
      const badge = one("badge");
      const stage = one("stage");
      const coverLines = all("cover-line");
      const coverIns = all("cover-in");
      const coverOut = all("cover-out");
      const ofTrack = (k: number) => ({ imgs: all("img", tracks[k]), words: all("word", tracks[k]), summary: all("summary", tracks[k]) });
      const ofPanel = (k: number) => ({ lines: all("line", panels[k]), fx: all("fx", panels[k]), rows: all("row", panels[k]) });

      const mm = gsap.matchMedia();
      mm.add(MOTION_QUERIES, (context) => {
        const full = Boolean(context.conditions?.full);
        const move = (px: number) => (full ? px : 0);

        // ── Base state: the curtain covers the photos; every tour waits off
        // to the left (or, for reduced motion, invisible in place). Pixel
        // offsets are zeroed alongside the percentages: GSAP reads a leftover
        // inline translate as pixels and would add the percentage on top.
        gsap.set(curtain, { x: 0, xPercent: 0, scaleX: 1, opacity: 1, transformOrigin: "0% 50%" });
        gsap.set(tracks, { x: 0, xPercent: full ? -100 : 0, autoAlpha: full ? 1 : 0 });
        tracks.forEach((_, k) => {
          const t = ofTrack(k);
          gsap.set(t.words, { y: 0, yPercent: full ? 110 : 0, opacity: full ? 1 : 0 });
          gsap.set(t.imgs, { x: 0 });
          gsap.set(t.summary, { opacity: 0 });
        });
        panels.forEach((_, k) => {
          const p = ofPanel(k);
          gsap.set(p.lines, { y: 0, yPercent: full ? 110 : 0, opacity: full ? 1 : 0 });
          gsap.set([...p.fx, ...p.rows], { opacity: 0 });
        });
        gsap.set(nums, { x: 0, opacity: 0 });
        gsap.set([...coverLines, ...coverOut], { x: 0, y: 0 });
        gsap.set(badge, { autoAlpha: 0 });

        // ── Arrival, on its own clock: the destination's colour blooms out
        // from the little plane on the cover, then the title rises.
        const intro = gsap.timeline({ paused: true });
        if (full) {
          intro.fromTo(
            stage,
            { clipPath: "circle(0% at 88% 24%)" },
            {
              // 125% just reaches the far corner, so the whole bloom stays visible.
              clipPath: "circle(125% at 88% 24%)",
              duration: 1.8,
              ease: "power2.out",
              // A clip left in place would cost a mask on every scroll frame.
              onComplete: () => gsap.set(stage, { clearProps: "clipPath" }),
            },
          );
        } else {
          intro.fromTo(stage, { opacity: 0 }, { opacity: 1, duration: 0.6, ease: "power1.out" });
        }
        intro
          .fromTo(coverLines, { yPercent: full ? 105 : 0, opacity: full ? 1 : 0 }, { yPercent: 0, opacity: 1, duration: 1.2, stagger: 0.09, ease: "expo.out" }, 0.3)
          .fromTo(coverIns, { opacity: 0, y: move(12) }, { opacity: 1, y: 0, duration: 0.9, stagger: 0.08, ease: "expo.out" }, 0.6);
        gsap.timeline({
          scrollTrigger: {
            trigger: el,
            start: "top 55%",
            onEnter: () => intro.restart(),
            onLeaveBack: () => intro.pause(0),
          },
        });
        if (el.getBoundingClientRect().top < window.innerHeight * 0.55) {
          intro.progress(1);
          gsap.set(stage, { clearProps: "clipPath" });
        }

        const tl = gsap.timeline({
          defaults: { ease: "power2.inOut" },
          scrollTrigger: {
            trigger: el,
            start: "top top",
            end: "bottom bottom",
            scrub: full ? 0.8 : true,
            invalidateOnRefresh: true,
            onUpdate: (self) => track(self.progress),
            onRefresh: (self) => track(self.progress),
          },
        });

        // A tour arrives: the curtain retreats to the right exactly as fast
        // as the photos slide in from the left (its left edge rides their
        // right edge); the photos settle inside their frames, the name and
        // copy rise through their masks.
        const enter = (k: number, at: number) => {
          const t = ofTrack(k);
          const p = ofPanel(k);
          const first = k === 0;
          if (full) {
            tl.fromTo(curtain, { xPercent: 0, scaleX: 1 }, { xPercent: 100, scaleX: 0, duration: 0.8, ease: "power3.inOut", immediateRender: first }, at)
              .fromTo(tracks[k], { xPercent: -100 }, { xPercent: 0, duration: 0.8, ease: "power3.inOut" }, at)
              .fromTo(t.imgs, { xPercent: (i: number) => (i ? 5 : 9), scale: 1.12 }, { xPercent: 0, scale: 1, duration: 1, ease: "power3.out" }, at);
          } else {
            tl.fromTo(curtain, { opacity: 1 }, { opacity: 0, duration: 0.5, immediateRender: first }, at).fromTo(
              tracks[k],
              { autoAlpha: 0 },
              { autoAlpha: 1, duration: 0.5 },
              at,
            );
          }
          tl.fromTo(t.words, { yPercent: full ? 110 : 0, opacity: full ? 1 : 0 }, { yPercent: 0, opacity: 1, duration: 0.45, stagger: 0.05, ease: "power4.out" }, at + 0.4)
            .fromTo(t.summary, { opacity: 0, y: move(14) }, { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" }, at + 0.55)
            .fromTo(p.lines, { yPercent: full ? 110 : 0, opacity: full ? 1 : 0 }, { yPercent: 0, opacity: 1, duration: 0.45, stagger: 0.07, ease: "power4.out" }, at + 0.35)
            .fromTo(p.fx, { opacity: 0, y: move(12) }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.06, ease: "power3.out" }, at + 0.45)
            .fromTo(p.rows, { opacity: 0, y: move(8) }, { opacity: 1, y: 0, duration: 0.3, stagger: 0.03, ease: "power3.out" }, at + 0.5)
            .fromTo(
              badge,
              { autoAlpha: 0, scale: full ? 0.7 : 1, rotation: full ? -80 : 0 },
              { autoAlpha: 1, scale: 1, rotation: 0, duration: 0.45, ease: "back.out(1.6)", immediateRender: first },
              at + 0.55,
            );
        };

        // A tour leaves: its copy lifts away, the curtain sweeps in from the
        // left over the photos (which drift on to the right beneath it), and
        // the next tour's number drifts across the amber.
        const leave = (k: number, at: number) => {
          const t = ofTrack(k);
          const p = ofPanel(k);
          tl.to(p.lines, { yPercent: full ? -110 : 0, opacity: full ? 1 : 0, duration: 0.3, stagger: 0.04 }, at)
            .to([...p.fx, ...p.rows], { opacity: 0, y: move(-10), duration: 0.25 }, at)
            .to(t.words, { yPercent: full ? -110 : 0, opacity: full ? 1 : 0, duration: 0.3, stagger: 0.03 }, at)
            .to(t.summary, { opacity: 0, duration: 0.2 }, at)
            .to(badge, { autoAlpha: 0, scale: full ? 0.7 : 1, rotation: full ? 60 : 0, duration: 0.25 }, at);
          if (full) {
            tl.fromTo(curtain, { xPercent: 0, scaleX: 0 }, { xPercent: 0, scaleX: 1, duration: 0.5, ease: "power3.inOut", immediateRender: false }, at + 0.08)
              .to(tracks[k], { xPercent: 24, duration: 0.5, ease: "power3.inOut" }, at + 0.08)
              .to(t.imgs, { scale: 1.08, duration: 0.5 }, at + 0.08);
          } else {
            tl.fromTo(curtain, { opacity: 0 }, { opacity: 1, duration: 0.4, immediateRender: false }, at + 0.08);
          }
          tl.set(tracks[k], { autoAlpha: 0 }, at + LEAVE)
            .fromTo(nums[k], { xPercent: full ? -14 : 0 }, { xPercent: full ? 14 : 0, duration: 1, ease: "none" }, at + 0.25)
            .fromTo(nums[k], { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.out", immediateRender: false }, at + 0.25)
            .to(nums[k], { opacity: 0, duration: 0.3 }, at + (full ? 0.95 : 0.5)); // gone before a crossfade brings the photos
        };

        tl.to(coverOut, { xPercent: full ? 18 : 0, autoAlpha: 0, duration: 0.5, stagger: 0.05 }, COVER);
        for (let k = 0; k < T; k++) {
          if (k > 0) leave(k - 1, leaveAt(k - 1));
          enter(k, enterAt(k));
        }
        tl.to({}, { duration: Math.max(0, total - tl.duration()) });

        return () => {
          intro.kill();
        };
      });
    },
    { scope: root, dependencies: [T], revertOnUpdate: true },
  );

  if (T === 0) return null;
  const current = packages[Math.max(0, active)];
  const minPrice = Math.min(...packages.map((p) => p.priceInr));
  const count = COUNT_WORDS[T - 1] ?? String(T);

  return (
    <div
      ref={root}
      className="tour-theme relative"
      style={{ height: `calc(100dvh + ${Math.round(total * VH_PER_UNIT)}vh)`, ...tourThemeStyle(theme) }}
    >
      <div className="sticky top-0 h-[100dvh] overflow-hidden bg-space">
        <div data-t="stage" className="tour-stage">
          {/* Photos: one track of two columns per tour, under the amber curtain */}
          <div className="tour-photos">
            {packages.map((p, k) => {
              const words = p.name.split(/\s+/);
              return (
                <div key={p.slug} data-t="track" className="tour-track" aria-hidden={active !== k} inert={active !== k}>
                  {photosOf(p).map((src, i) => (
                    <div key={i} className="tour-col">
                      <div data-t="img" className="tour-img">
                        <div className="tour-img-photo" style={{ backgroundImage: src ? cssUrl(src) : undefined }} />
                      </div>
                    </div>
                  ))}
                  <div className="tour-shade" aria-hidden />
                  <div className="tour-head">
                    {p.featured && (
                      <p data-t="summary" className="tour-chip">
                        Most booked
                      </p>
                    )}
                    <h3 className="tour-name">
                      {words.map((w, i) => (
                        <span key={i}>
                          <span className="tour-word">
                            <span data-t="word">{i === words.length - 1 && words.length > 1 ? <em>{w}</em> : w}</span>
                          </span>{" "}
                        </span>
                      ))}
                    </h3>
                  </div>
                  <p data-t="summary" className="tour-summary">
                    {p.summary}
                  </p>
                </div>
              );
            })}
            <div data-t="curtain" className="tour-curtain" aria-hidden />
          </div>

          {/* Panel: the amber page the copy is set on */}
          <div className="tour-panel">
            {packages.map((p, k) => {
              const nights = p.durationDays - 1;
              return (
                <div key={p.slug} data-t="pc" className="tour-pc" aria-hidden={active !== k} inert={active !== k}>
                  <div data-t="fx" className="tour-pc-top">
                    <span>
                      Tour {pad2(k + 1)} / {pad2(T)}
                    </span>
                    <span>{p.groupSize}</span>
                  </div>
                  <p className="tour-stack">
                    <span className="tour-line-mask">
                      <span data-t="line" className="tour-line">
                        {p.durationDays} {p.durationDays === 1 ? "day" : "days"},
                      </span>
                    </span>
                    <span className="tour-line-mask">
                      <span data-t="line" className="tour-line">
                        <em>{nights > 0 ? `${nights} ${nights === 1 ? "night" : "nights"},` : "day trip,"}</em>
                      </span>
                    </span>
                    <span className="tour-line-mask">
                      <span data-t="line" className="tour-line">
                        {p.pace.toLowerCase()} pace.
                      </span>
                    </span>
                  </p>
                  <dl data-t="fx" className="tour-facts">
                    <div>
                      <dt>Stay</dt>
                      <dd>
                        {p.hotel.name}
                        <small>
                          {p.hotel.stars}-star · {p.hotel.area}
                        </small>
                      </dd>
                    </div>
                    <div>
                      <dt>Highlights</dt>
                      <dd>{p.highlights.join(" · ")}</dd>
                    </div>
                  </dl>
                  <div data-t="fx" className="tour-pc-foot">
                    <ol className="tour-days" aria-label={`${p.name} day by day`}>
                      {p.itinerary.map((day) => (
                        <li key={day.day} data-t="row" className="tour-day">
                          <b>D{pad2(day.day)}</b>
                          <span>{day.title}</span>
                        </li>
                      ))}
                      {p.itinerary.length > 3 && (
                        <li data-t="row" className="tour-day tour-day-more">
                          <b>+{p.itinerary.length - 3}</b>
                          <span>more days</span>
                        </li>
                      )}
                    </ol>
                    <div className="tour-buy">
                      <span className="tour-buy-label">From, per person</span>
                      <span data-t="price" className="tour-price">
                        {formatInr(p.priceInr)}
                      </span>
                      <Link href={`/tours/${p.slug}`} className="tour-cta">
                        View tour <ArrowUpRight size={13} weight="bold" aria-hidden />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
            <p className="tour-vlabel" aria-hidden>
              Longitude curated tours · {d.name}, {d.country} · {formatCoordinates(d, 2)}
            </p>
          </div>

          {/* Cover: the section title on a full amber stage */}
          <div className="tour-cover">
            <div data-t="cover-out" className="tour-cover-top">
              <p data-t="cover-in">
                Tour packages · {d.name}, {d.country}
              </p>
              <Link data-t="cover-in" href="/tours" className="tour-cover-link">
                All tours <ArrowRight size={13} aria-hidden />
              </Link>
            </div>
            <svg data-t="cover-out" className="tour-cover-route" viewBox="0 0 1000 400" preserveAspectRatio="xMidYMid meet" aria-hidden focusable="false">
              <path d="M40 360 C 300 380, 520 60, 930 70" />
              <g transform="translate(930 70) rotate(-4) scale(1.6) translate(-12 -12)">
                <path className="tour-cover-plane" d={PLANE_PATH} />
              </g>
            </svg>
            <div>
              <h2 id="tours-title" className="tour-cover-title">
                <span data-t="cover-out" className="tour-cover-mask">
                  <span data-t="cover-line" className="block">
                    {count} {T === 1 ? "way" : "ways"}
                  </span>
                </span>
                <span data-t="cover-out" className="tour-cover-mask">
                  <span data-t="cover-line" className="block">
                    to see <em>{d.name}.</em>
                  </span>
                </span>
              </h2>
              <div data-t="cover-out" className="tour-cover-meta">
                <p data-t="cover-in">
                  {pad2(T)} curated {T === 1 ? "itinerary" : "itineraries"} · from {formatInr(minPrice)} per person
                </p>
                <p data-t="cover-in" className="tour-palette">
                  <span className="tour-swatch" aria-hidden>
                    <i />
                    <i />
                    <i />
                  </span>
                  Colour · {theme.name}
                </p>
              </div>
            </div>
          </div>

          {/* The next tour's number, drifting across the amber between tours */}
          {packages.slice(1).map((p, k) => (
            <span key={p.slug} data-t="num" className="tour-num" aria-hidden>
              {pad2(k + 2)}
            </span>
          ))}

          {/* Badge: spins on the photos, links to the tour on show */}
          <Link data-t="badge" href={`/tours/${current.slug}`} className="tour-badge" aria-label={`View ${current.name}`}>
            <svg viewBox="0 0 120 120" className="tour-badge-ring" aria-hidden focusable="false">
              <defs>
                <path id="tour-badge-path" d="M60 60 m-47 0 a47 47 0 1 1 94 0 a47 47 0 1 1 -94 0" />
              </defs>
              <text textLength={295} lengthAdjust="spacing">
                <textPath href="#tour-badge-path">
                  {`View tour · ${current.durationDays} days · ${d.name} · `.toUpperCase()}
                </textPath>
              </text>
            </svg>
            <span className="tour-badge-core">
              <ArrowUpRight size={18} weight="bold" aria-hidden />
            </span>
          </Link>
        </div>
      </div>

      {/* Every tour, for keyboard and screen-reader users who skip the scroll */}
      <ul className="sr-only">
        {packages.map((p) => (
          <li key={p.slug}>
            <Link href={`/tours/${p.slug}`}>
              {p.name}: {p.summary} From {formatInr(p.priceInr)} per person.
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
