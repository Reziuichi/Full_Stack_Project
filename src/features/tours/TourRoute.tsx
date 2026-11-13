"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { Airplane } from "@phosphor-icons/react";
import { formatInr, localTimeIn } from "@/lib/format";
import { gsap, MOTION_QUERIES, ScrollTrigger, useGSAP } from "@/lib/gsap";
import { TourPass } from "./TourPass";
import { numberWord, type TourCity } from "./tourData";

const pad2 = (n: number) => String(n).padStart(2, "0");
/** Where a city "arrives": when its title card crosses this fraction of the viewport. */
const ARRIVE = 0.62;

/**
 * The route: every tour, city by city, in the order the desk flies them.
 * On a wide screen the section pins and the passes travel sideways as you
 * scroll; each city repaints the room in its own colour as it arrives, the
 * passes swing through a shallow coverflow, their photos drift inside the
 * frame, and a flight path along the bottom tracks the journey (its airport
 * codes fly you to a city). On a phone, or with reduced motion, the same
 * content stacks: one colour block per city.
 */
export function TourRoute({ cities, initial }: { cities: TourCity[]; initial?: string }) {
  const root = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const jump = useRef<(i: number) => void>(() => {});
  const [now, setNow] = useState<Date | null>(null);
  const total = cities.reduce((n, c) => n + c.tours.length, 0);
  const first = cities[0].theme;

  // Local clocks on the city cards (first tick after mount: no hydration mismatch).
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);

  useGSAP(
    () => {
      const section = root.current;
      const trk = track.current;
      if (!section || !trk) return;
      const q = <T extends HTMLElement>(s: string) => gsap.utils.toArray<T>(s, section);
      const chapters = q(".tt-chapter");
      const initialIndex = Math.max(0, cities.findIndex((c) => c.slug === initial));
      const mm = gsap.matchMedia();

      mm.add({ rail: "(min-width: 1024px) and (prefers-reduced-motion: no-preference)", stack: "(max-width: 1023px), (prefers-reduced-motion: reduce)" }, (context) => {
        if (!context.conditions?.rail) {
          // Stacked: each city is its own colour block; a deep link just scrolls there.
          q(".tt-group").forEach((g) => gsap.fromTo(g.querySelectorAll(".tp, .tt-chapter"), { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: "power3.out", stagger: 0.08, scrollTrigger: { trigger: g, start: "top 78%", once: true } }));
          jump.current = (i) => {
            const el = document.getElementById(`city-${cities[i].slug}`);
            if (el) gsap.to(window, { scrollTo: { y: el, offsetY: 64 }, duration: window.matchMedia(MOTION_QUERIES.reduce).matches ? 0 : 1, ease: "power2.inOut" });
          };
          if (initial) gsap.delayedCall(0.4, () => jump.current(initialIndex));
          return;
        }

        section.dataset.mode = "rail";
        const rooms = q(".tt-room");
        const hudCode = section.querySelector<HTMLElement>(".tt-hud-code");
        const hudCount = section.querySelector<HTMLElement>(".tt-hud-count");
        const plane = section.querySelector<HTMLElement>(".tt-route-plane");
        const line = section.querySelector<HTMLElement>(".tt-route-line");
        const stops = q<HTMLButtonElement>(".tt-stop");
        const passes = q(".tp");
        const distance = () => Math.max(1, trk.scrollWidth - window.innerWidth);

        // Where each city arrives, as a fraction of the journey (for the waypoints and jumps). Measured
        // on refresh only: reading layout while scrolling would force it every frame.
        let arrive: number[] = [];
        let centres: number[] = [];
        let span = 1;
        let lineWidth = 0;
        let halfScreen = 0;
        const measure = () => {
          const d = distance();
          span = d;
          lineWidth = line?.offsetWidth ?? 0;
          halfScreen = window.innerWidth / 2;
          arrive = chapters.map((ch) => Math.min(1, Math.max(0, (ch.offsetLeft - window.innerWidth * (ARRIVE - 0.12)) / d)));
          centres = passes.map((p) => p.offsetLeft + p.offsetWidth / 2);
          stops.forEach((s, i) => (s.parentElement!.style.left = `${(arrive[i] * 100).toFixed(2)}%`));
        };

        // A new city repaints the room: its colour fades in on the back one of two full-screen
        // layers (opacity only, so the compositor does it and nothing repaints), and the few
        // things drawn in the room's ink follow with a short colour transition. (Tweening the
        // colours as variables on the section restyled and repainted every pass, every frame.)
        let current = -1;
        let front = 0;
        const setCity = (i: number, instant = false) => {
          if (i === current) return;
          current = i;
          const t = cities[i].theme;
          section.style.setProperty("--ground", t.ground);
          section.style.setProperty("--ink", t.ink);
          const next = rooms[1 - front];
          const prev = rooms[front];
          if (next && prev) {
            next.style.backgroundColor = t.ground;
            next.style.transitionDuration = instant ? "0s" : "";
            prev.style.zIndex = "0";
            next.style.zIndex = "1";
            next.style.opacity = "1";
            prev.style.transitionDuration = instant ? "0s" : "";
            // The old layer drops out once the new one covers it.
            window.setTimeout(() => current === i && (prev.style.opacity = "0"), instant ? 0 : 1150);
            front = 1 - front;
          }
          if (hudCode) hudCode.textContent = cities[i].code;
          stops.forEach((s, k) => s.toggleAttribute("data-on", k === i));
        };
        setCity(0, true);

        // While the route moves, nothing in it takes the pointer: passes sliding under a still mouse
        // would otherwise fire hover effects (tilt, glare, photo changes) on every frame.
        let idle = 0;
        const onScroll = () => {
          if (!section.dataset.scrolling) section.dataset.scrolling = "";
          window.clearTimeout(idle);
          idle = window.setTimeout(() => delete section.dataset.scrolling, 180);
        };

        let lastPass = -1;
        const onUpdate = (self: ScrollTrigger) => {
          const p = self.progress;
          if (self.isActive) onScroll();
          if (plane) plane.style.transform = `translate3d(${(p * lineWidth).toFixed(1)}px,0,0)`;
          line?.style.setProperty("--p", p.toFixed(4));
          // The pass nearest the middle of the screen is the one on show.
          const x = p * span + halfScreen;
          let best = 0;
          for (let k = 1; k < centres.length; k++) if (Math.abs(centres[k] - x) < Math.abs(centres[best] - x)) best = k;
          if (best !== lastPass && hudCount) {
            lastPass = best;
            hudCount.textContent = `${pad2(best + 1)} / ${pad2(total)}`;
          }
        };

        // The stage holds still with CSS (position: sticky, in a section as tall as the journey)
        // rather than ScrollTrigger's pin: pinning flips it to position: fixed as you arrive, and
        // Chrome then rebuilds and re-rasters every pass at once (a ~0.35 s stall on entering).
        const fitHeight = () => void (section.style.height = `${window.innerHeight + distance()}px`);
        fitHeight();
        ScrollTrigger.addEventListener("refreshInit", fitHeight);
        const move = gsap.to(trk, {
          x: () => -distance(),
          ease: "none",
          scrollTrigger: { trigger: section, start: "top top", end: () => `+=${distance()}`, scrub: 0.9, invalidateOnRefresh: true, onRefresh: measure, onUpdate },
        });
        measure();

        // Each city repaints the room as its title card arrives.
        chapters.forEach((ch, i) =>
          ScrollTrigger.create({
            trigger: ch,
            containerAnimation: move,
            start: `left ${ARRIVE * 100}%`,
            onEnter: () => setCity(i),
            onLeaveBack: () => setCity(Math.max(0, i - 1)),
          }),
        );

        // A shallow coverflow, and the photo drifting inside its frame.
        passes.forEach((pass) => {
          gsap.set(pass, { transformPerspective: 1600 });
          gsap
            .timeline({ scrollTrigger: { trigger: pass, containerAnimation: move, start: "left right", end: "right left", scrub: true } })
            .fromTo(pass, { rotationY: -18, scale: 0.93 }, { rotationY: 0, scale: 1, ease: "sine.out", duration: 1 })
            .to(pass, { rotationY: 18, scale: 0.93, ease: "sine.in", duration: 1 });
          const photo = pass.querySelector(".tp-photo-track");
          if (photo) gsap.fromTo(photo, { xPercent: 7 }, { xPercent: -7, ease: "none", scrollTrigger: { trigger: pass, containerAnimation: move, start: "left right", end: "right left", scrub: true } });
        });

        // The city cards' type slides a little slower than the track.
        q(".tt-city").forEach((el) => gsap.fromTo(el, { xPercent: 14 }, { xPercent: -14, ease: "none", scrollTrigger: { trigger: el, containerAnimation: move, start: "left right", end: "right left", scrub: true } }));

        jump.current = (i) => {
          const st = move.scrollTrigger;
          if (!st) return;
          gsap.to(window, { scrollTo: st.start + arrive[i] * distance() + window.innerWidth * 0.14, duration: 1.5, ease: "power2.inOut" });
        };
        if (initial) gsap.delayedCall(0.9, () => jump.current(initialIndex));

        // Draw the route's first screen once, out of sight, while the visitor is still on the hero.
        // The passes' first raster (photos, notch masks, shadows) is a ~100 ms GPU frame, and it used
        // to land on the first scroll into the route. Here it lands at rest instead: for a moment the
        // stage lies over the viewport at 1% opacity (Chrome rasters whatever is on screen, however
        // faint; much fainter and it skips some of it): first its passes, which land over the hero's
        // photo wall, then its type, slid right to land over the wall too (against the dark beside
        // the wall even 1% would show). Then it goes back to its place with its tiles ready. Any
        // scroll ends it at once, and so does a re-measure (the triggers must be measured with the
        // stage in its place).
        let warmEnd = 0;
        let warmGone = false;
        const endWarm = () => {
          window.clearTimeout(warmEnd);
          window.removeEventListener("scroll", endWarm);
          ScrollTrigger.removeEventListener("refreshInit", endWarm);
          delete section.dataset.warm;
        };
        const warm = () => {
          // Only while the route is still below the fold (the hero is exactly one screen tall).
          if (warmGone || section.getBoundingClientRect().top < window.innerHeight - 1) return;
          section.dataset.warm = "passes";
          window.addEventListener("scroll", endWarm, { passive: true });
          ScrollTrigger.addEventListener("refreshInit", endWarm);
          warmEnd = window.setTimeout(() => {
            section.dataset.warm = "type";
            warmEnd = window.setTimeout(endWarm, 450);
          }, 550);
        };
        // After the hero's entrance has played (its own frames come first).
        const warmAt = window.setTimeout(() => {
          if ("requestIdleCallback" in window) window.requestIdleCallback(warm, { timeout: 1500 });
          else warm();
        }, 2600);

        return () => {
          warmGone = true;
          window.clearTimeout(warmAt);
          endWarm();
          window.clearTimeout(idle);
          ScrollTrigger.removeEventListener("refreshInit", fitHeight);
          section.style.removeProperty("height");
          delete section.dataset.mode;
          delete section.dataset.scrolling;
          section.style.removeProperty("--ground");
          section.style.removeProperty("--ink");
          rooms.forEach((r) => r.removeAttribute("style"));
        };
      });
    },
    { scope: root },
  );

  return (
    <section
      id="route"
      ref={root}
      className="tt"
      aria-label="Tours by city"
      style={{ "--ground": first.ground, "--ink": first.ink } as CSSProperties}
    >
      <div className="tt-stage">
        <div className="tt-room" aria-hidden />
        <div className="tt-room" aria-hidden />
        <div className="tt-vignette" aria-hidden />
        <p className="tt-hud" aria-hidden>
          <span>The route</span>
          <b className="tt-hud-code">{cities[0].code}</b>
          <span className="tt-hud-count">
            01 / {pad2(total)}
          </span>
        </p>

        <div ref={track} className="tt-track">
          <div className="tt-intro">
            <p className="tt-intro-kicker">The route</p>
            <h2 className="tt-intro-title">
              {numberWord(cities.length)} cities, in the order we <em>fly them.</em>
            </h2>
            <p className="tt-intro-note">Each city paints the room its own colour. Every pass is a real tour: open one for the days, the hotel and the price.</p>
          </div>

          {cities.map((c, ci) => (
            <Fragment key={c.slug}>
              <div id={`city-${c.slug}`} className="tt-group" style={{ "--g-ground": c.theme.ground, "--g-ink": c.theme.ink } as CSSProperties}>
                <header className="tt-chapter">
                  <p className="tt-chapter-no">
                    {pad2(ci + 1)} <span>/ {pad2(cities.length)}</span>
                  </p>
                  <h3 className="tt-city" style={{ "--len": Math.max(5, c.name.length) } as CSSProperties}>
                    {c.name}
                  </h3>
                  <p className="tt-code" aria-hidden>
                    {c.code}
                  </p>
                  <p className="tt-caption">{c.theme.name}</p>
                  <dl className="tt-facts">
                    <div>
                      <dt>Local time</dt>
                      <dd>{now ? localTimeIn(c.timezone, now) : "--:--"}</dd>
                    </div>
                    <div>
                      <dt>From IXC</dt>
                      <dd>{c.flightTime}</dd>
                    </div>
                    <div>
                      <dt>Tours</dt>
                      <dd>
                        {c.tours.length} · from {formatInr(Math.min(...c.tours.map((t) => t.priceInr)))}
                      </dd>
                    </div>
                  </dl>
                </header>
                {c.tours.map((t) => (
                  <TourPass key={t.slug} tour={t} city={c} />
                ))}
              </div>
            </Fragment>
          ))}

          <div className="tt-end">
            <p className="tt-end-kicker">End of the line</p>
            <p className="tt-end-title">
              {total} tours, <em>one desk.</em>
            </p>
            <a href="#timetable" className="tt-end-link">
              Compare them side by side
            </a>
          </div>
        </div>

        <nav className="tt-route" aria-label="Fly to a city">
          <div className="tt-route-line">
            <span className="tt-route-plane" aria-hidden>
              <Airplane size={16} weight="fill" />
            </span>
          </div>
          <ol>
            {cities.map((c, i) => (
              <li key={c.slug} style={{ left: `${(i / Math.max(1, cities.length - 1)) * 100}%` }}>
                <button type="button" className="tt-stop" onClick={() => jump.current(i)} data-on={i === 0 || undefined}>
                  <i aria-hidden />
                  {c.code}
                  <span className="sr-only"> {c.name}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </div>
    </section>
  );
}
