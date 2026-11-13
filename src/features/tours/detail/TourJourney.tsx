"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Airplane, Pause, Play } from "@phosphor-icons/react";
import { gsap, MOTION_QUERIES, ScrollTrigger, useGSAP } from "@/lib/gsap";
import { numberWord, thumb, type TourPageData } from "../tourData";
import { createFlightPath, createFlyby, type Flyby } from "./flyby";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The brief: the description lights up word by word as it is read, then what you'll do. */
export function TourBrief({ tour }: { tour: TourPageData }) {
  const root = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const q = (s: string) => gsap.utils.toArray<HTMLElement>(s, root.current);
      const mm = gsap.matchMedia();
      mm.add(MOTION_QUERIES, (context) => {
        if (!context.conditions?.full) return;
        gsap.fromTo(q(".tdb-w"), { opacity: 0.14 }, { opacity: 1, stagger: 0.1, ease: "none", scrollTrigger: { trigger: q(".tdb-text")[0], start: "top 80%", end: "bottom 45%", scrub: 0.5 } });
        gsap.fromTo(q(".tdb-act"), { autoAlpha: 0, x: -28 }, { autoAlpha: 1, x: 0, duration: 0.9, ease: "expo.out", stagger: 0.08, scrollTrigger: { trigger: q(".tdb-acts")[0], start: "top 80%", once: true } });
      });
    },
    { scope: root },
  );
  return (
    <section ref={root} className="tdb" aria-labelledby="brief-title">
      <div className="tdb-inner">
        <h2 id="brief-title" className="tdb-kicker">
          The brief
        </h2>
        <p className="tdb-text">
          {tour.description.split(/\s+/).map((w, i) => (
            <span key={i} className="tdb-w">
              {w}{" "}
            </span>
          ))}
        </p>
        <div className="tdb-acts">
          <p className="tdb-acts-title">What you&apos;ll do</p>
          <ol>
            {tour.activities.map((a, i) => (
              <li key={a} className="tdb-act">
                <span>{pad2(i + 1)}</span>
                <p>{a}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/** Degrees between neighbouring prints in the fan. */
const TILT = 5;
/** Each photo's place in the fan, in the order they're dealt: the middle, then out to either side. */
const DEAL = [0, -1, 1, -2, 2, -3, 3];
/** The sequence, in seconds: the jet crosses, its wake spreads, the photo shrinks to a print, the rest are dealt. */
const T_FLY = 1.7;
const T_SPREAD = 1.35;
const T_SHRINK = 2.1;
const T_DEAL = 2.8;
const DEAL_STEP = 0.22;

/**
 * The prints. A jet crosses the section left to right, and the wake it
 * leaves opens like a tear in the sky onto a photo from the trip; the wake
 * spreads until the photo fills the stage, then the photo shrinks into a
 * print and the rest are dealt out from behind it into a fan. On a wide
 * screen the section holds while you scroll through all of that; on a
 * phone it plays once as it comes into view. Then the prints take turns in
 * the light, each lifting out of the fan for a few seconds (hover or tap one
 * to hold it; the turns can be paused).
 */
export function TourDeck({ tour }: { tour: TourPageData }) {
  const root = useRef<HTMLElement>(null);
  // Lead with the second photo: the first is already the page's hero.
  const pics = tour.images.length > 1 ? [tour.images[1], tour.images[0], ...tour.images.slice(2)] : tour.images;
  const n = pics.length;
  const ks = DEAL.slice(0, n);
  const order = useMemo(() => [...Array(n).keys()].sort((a, b) => DEAL[a] - DEAL[b]), [n]);
  const [dealt, setDealt] = useState(n);
  const [live, setLive] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [auto, setAuto] = useState(true);
  const [hold, setHold] = useState(false);
  const [seen, setSeen] = useState(false);

  const advance = () => setActive((a) => order[(order.indexOf(a ?? order[0]) + 1) % n]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useGSAP(
    () => {
      const el = root.current!;
      const stage = el.querySelector<HTMLElement>(".tdk-stage")!;
      const table = el.querySelector<HTMLElement>(".tdk-table")!;
      const canvas = el.querySelector<HTMLCanvasElement>(".tdk-canvas")!;
      const routeEl = el.querySelector<HTMLElement>(".tdk-route")!;
      const glyph = el.querySelector<HTMLElement>(".tdk-plane")!;
      const slots = gsap.utils.toArray<HTMLElement>(".tdk-slot", el);
      const flies = slots.map((s) => s.querySelector<HTMLElement>(".tdk-fly")!);
      const heroImg = flies[0].querySelector("img")!;
      const heroPaper = flies[0].querySelector<HTMLElement>(".tdk-paper")!;
      const heroCap = flies[0].querySelector(".tdk-cap");

      gsap.fromTo(el.querySelectorAll("[data-a=fade]"), { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 1, ease: "power3.out", stagger: 0.07, scrollTrigger: { trigger: stage, start: "top 78%", once: true } });

      const mm = gsap.matchMedia();
      mm.add({ pin: "(min-width: 1024px) and (prefers-reduced-motion: no-preference)", play: "(max-width: 1023px) and (prefers-reduced-motion: no-preference)", still: MOTION_QUERIES.reduce }, (context) => {
        if (context.conditions?.still) {
          setDealt(n);
          setLive(true);
          return;
        }
        const pinned = Boolean(context.conditions?.pin);
        const path = createFlightPath();
        const st = { u: 0, s: 0 };
        let fb: Flyby | null = null;
        let noGl = false;
        let raf = 0;
        let near = false;

        const measure = () => {
          path.resize(stage.clientWidth, stage.clientHeight);
          const [a, b] = path.route();
          gsap.set(routeEl, { x: a[0], y: a[1], width: Math.hypot(b[0] - a[0], b[1] - a[1]), rotation: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI });
          const origin = `${heroImg.offsetLeft + heroImg.offsetWidth / 2}px ${heroImg.offsetTop + heroImg.offsetHeight / 2}px`;
          gsap.set([flies[0], heroPaper], { transformOrigin: origin });
        };
        const draw = () => {
          const w = st.u > 0 && st.s < 1 ? path.wake(st.u, st.s) : null;
          table.style.clipPath = st.s >= 1 ? "" : w ? path.clip(w) : "polygon(0px 0px, 0px 0px, 0px 0px)";
          if (fb && fb.status() === "ready") fb.render(st.u, st.s, performance.now() / 1000, w);
          else if (noGl || fb?.status() === "failed") {
            // No WebGL2: a plain airplane glyph flies the same line.
            stage.dataset.glyph = "";
            const [nose, tail] = path.ends(Math.min(Math.max(st.u, 0), 1));
            const len = Math.hypot(nose[0] - tail[0], nose[1] - tail[1]);
            gsap.set(glyph, { x: (nose[0] + tail[0]) / 2, y: (nose[1] + tail[1]) / 2, xPercent: -50, yPercent: -50, width: len, height: len, rotation: (Math.atan2(nose[1] - tail[1], nose[0] - tail[0]) * 180) / Math.PI + 45, autoAlpha: st.u > 0 && st.u < 1 ? 1 : 0 });
          }
        };
        // Redraw on the next frame; keep drawing while the jet is on stage, for its lights.
        const loop = () => {
          raf = 0;
          draw();
          const flying = st.u > 0 && st.u < 1;
          const waiting = fb?.status() === "pending" && st.u > 0 && st.s < 1;
          if (near && (flying || waiting)) raf = requestAnimationFrame(loop);
        };
        const kick = () => void (raf ||= requestAnimationFrame(loop));

        // Build the jet a screen or so before it's needed.
        const io = new IntersectionObserver(
          ([e]) => {
            near = e.isIntersecting;
            if (near && !fb && !noGl) {
              fb = createFlyby(canvas, path);
              noGl = !fb;
            }
            kick();
          },
          { rootMargin: "120% 0px" },
        );
        io.observe(stage);
        const ro = new ResizeObserver(() => {
          measure();
          kick();
        });
        ro.observe(stage);
        measure();

        // Where a print sits relative to the middle one, undone in its own (rotated) frame.
        const home = (i: number) => {
          const m = new DOMMatrixReadOnly(getComputedStyle(slots[i]).transform);
          const th = (ks[i] * TILT * Math.PI) / 180;
          return { x: -(m.m41 * Math.cos(th) + m.m42 * Math.sin(th)), y: -(-m.m41 * Math.sin(th) + m.m42 * Math.cos(th)) };
        };
        // The middle print blown up until its photo covers the stage.
        const cover = () => {
          const iw = heroImg.offsetWidth || 1;
          const ih = heroImg.offsetHeight || 1;
          const cx = slots[0].offsetLeft + heroImg.offsetLeft + iw / 2;
          const cy = slots[0].offsetTop + heroImg.offsetTop + ih / 2;
          return { s: Math.max(stage.clientWidth / iw, stage.clientHeight / ih) * 1.02, x: stage.clientWidth / 2 - cx, y: stage.clientHeight / 2 - cy };
        };

        let dealtNow = -1;
        let liveNow = false;
        const deals = flies.map((_, i) => (i === 0 ? T_SHRINK + 0.5 : T_DEAL + (i - 1) * DEAL_STEP + 0.15));
        const sync = () => {
          const t = tl.time();
          const d = deals.filter((x) => t >= x).length;
          if (d !== dealtNow) setDealt((dealtNow = d));
          const done = t >= tl.duration() - 0.04;
          if (done !== liveNow) {
            liveNow = done;
            setLive(done);
            setActive(done ? 0 : null);
          }
        };

        const tl = gsap.timeline({
          defaults: { ease: "none" },
          onUpdate: sync,
          scrollTrigger: pinned
            ? { trigger: stage, pin: true, start: "top top", end: "+=240%", scrub: 0.9, anticipatePin: 1, invalidateOnRefresh: true }
            : { trigger: stage, start: "top 55%", once: true, invalidateOnRefresh: true },
        });
        tl.to(st, { u: 1, duration: T_FLY, onUpdate: kick }, 0)
          .to(st, { s: 1, duration: 0.8, ease: "power2.in", onUpdate: kick }, T_SPREAD)
          .fromTo(flies[0], { x: () => cover().x, y: () => cover().y, scale: () => cover().s }, { x: 0, y: 0, scale: 1, duration: 0.85, ease: "power3.inOut" }, T_SHRINK)
          // The print's border grows out from under the photo.
          .fromTo(heroPaper, { scaleX: () => heroImg.offsetWidth / (heroPaper.offsetWidth || 1), scaleY: () => heroImg.offsetHeight / (heroPaper.offsetHeight || 1) }, { scaleX: 1, scaleY: 1, duration: 0.5, ease: "power3.out" }, T_SHRINK + 0.4)
          .fromTo(heroPaper, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.08 }, T_SHRINK + 0.4)
          .fromTo(heroCap, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 }, T_SHRINK + 0.65)
          .fromTo(el.querySelector(".tdk-veil"), { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.45 }, T_SHRINK + 0.35);
        flies.slice(1).forEach((fly, j) => {
          const i = j + 1;
          tl.fromTo(fly, { x: () => home(i).x, y: () => home(i).y, rotation: -ks[i] * TILT, scale: 0.82 }, { x: 0, y: 0, rotation: 0, scale: 1, duration: 0.55, ease: "back.out(1.5)" }, T_DEAL + j * DEAL_STEP);
        });
        if (pinned) tl.to({}, { duration: 0.35 });
        sync();
        kick();

        return () => {
          cancelAnimationFrame(raf);
          io.disconnect();
          ro.disconnect();
          fb?.dispose();
          table.style.clipPath = "";
          delete stage.dataset.glyph;
          setLive(false);
          setActive(null);
          setDealt(n);
        };
      });
    },
    { scope: root },
  );

  const pos = active === null ? -1 : order.indexOf(active);
  return (
    <section
      ref={root}
      className="tdk"
      aria-labelledby="deck-title"
      style={{ "--tilt": `${TILT}deg` } as React.CSSProperties}
      data-live={live || undefined}
      data-hold={hold || !seen || !auto || undefined}
      data-paused={!auto || undefined}
    >
      <div className="tdk-stage">
        <div className="tdk-sky" aria-hidden>
          <span className="tdk-route" />
          <p className="tdk-hud">
            <span>
              {tour.flight} · IXC → {tour.city.code}
            </span>
            <span>FL380 · M0.85 · {tour.city.flightTime}</span>
          </p>
        </div>

        <div className="tdk-table" onPointerLeave={() => setHold(false)}>
          {pics.map((src, i) => {
            const k = ks[i];
            const at = order.indexOf(i);
            return (
              <div key={src} className="tdk-slot" data-active={active === i || undefined} style={{ "--k": k, "--k2": k * k, "--z": i === 0 ? 20 : 10 - Math.abs(k) } as React.CSSProperties}>
                <div className="tdk-fly">
                  <button
                    type="button"
                    className="tdk-card"
                    aria-label={`${tour.name}, photo ${at + 1} of ${n}`}
                    aria-pressed={active === i}
                    tabIndex={live ? 0 : -1}
                    onClick={() => live && setActive(i)}
                    onPointerEnter={(e) => {
                      if (!live || e.pointerType !== "mouse") return;
                      setHold(true);
                      setActive(i);
                    }}
                  >
                    <span className="tdk-paper" aria-hidden />
                    {/* eslint-disable-next-line @next/next/no-img-element -- remote photo; the first is blown up to fill the stage */}
                    <img src={thumb(src, i === 0 ? 1280 : 960)} alt="" draggable={false} loading="lazy" decoding="async" />
                    <span className="tdk-cap" aria-hidden>
                      {tour.city.name} · {pad2(at + 1)}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="tdk-veil" aria-hidden />
        <canvas className="tdk-canvas" aria-hidden />
        <span className="tdk-plane" aria-hidden>
          <Airplane size="100%" weight="fill" />
        </span>

        <div className="tdk-copy">
          <div>
            <p data-a="fade" className="tdk-kicker">
              <i aria-hidden />
              The prints · {tour.flight}
            </p>
            <h2 data-a="fade" id="deck-title" className="tdk-title">
              {numberWord(n)} frames from <em>{tour.city.name}.</em>
            </h2>
          </div>
          <div data-a="fade" className="tdk-side">
            <p className="tdk-note">
              Prints from the trip, taking turns in the light. <span className="tdk-how-hover">Hover one to hold it.</span>
              <span className="tdk-how-tap">Tap one to bring it up.</span>
            </p>
            <div className="tdk-ctrl">
              <p className="tdk-count" aria-live="polite">
                {pad2(live ? Math.max(1, pos + 1) : Math.max(1, dealt))} <span>/ {pad2(n)}</span>
              </p>
              <div className="tdk-ticks" role="group" aria-label="Choose a photo" onAnimationEnd={(e) => e.animationName === "tdk-fill" && advance()}>
                {order.map((i, at) => (
                  <button key={i} type="button" aria-label={`Photo ${at + 1}`} aria-pressed={active === i} data-on={i < dealt || undefined} data-active={active === i || undefined} disabled={!live} onClick={() => setActive(i)}>
                    <i />
                  </button>
                ))}
              </div>
              <button type="button" className="tdk-auto" onClick={() => setAuto((a) => !a)} aria-label={auto ? "Pause the slideshow" : "Play the slideshow"} disabled={!live}>
                {auto ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** An odometer: each digit rolls to its new value. */
function Roll({ value }: { value: number }) {
  const digits = pad2(value).split("");
  return (
    <span className="tdd-roll" aria-hidden>
      {digits.map((d, i) => (
        <span key={i} className="tdd-roll-col">
          <span className="tdd-roll-strip" style={{ transform: `translateY(-${Number(d) * 10}%)` }}>
            {"0123456789".split("").map((x) => (
              <span key={x}>{x}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * Day by day. A sticky panel keeps the day on show: its number rolls like
 * an odometer, its title and photo change with it, and a rail fills as the
 * days go by; the days themselves scroll past, the current one lit.
 */
export function TourDays({ tour }: { tour: TourPageData }) {
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const days = tour.itinerary;
  const photos = tour.images.map((u) => thumb(u, 960));

  useGSAP(
    () => {
      const q = (s: string) => gsap.utils.toArray<HTMLElement>(s, root.current);
      q(".tdd-day").forEach((el, i) => ScrollTrigger.create({ trigger: el, start: "top 58%", end: "bottom 58%", onToggle: (self) => self.isActive && setActive(i) }));
      const mm = gsap.matchMedia();
      mm.add(MOTION_QUERIES, (context) => {
        if (!context.conditions?.full) return;
        gsap.fromTo(q(".tdd-rail-fill"), { scaleX: 0 }, { scaleX: 1, ease: "none", scrollTrigger: { trigger: q(".tdd-days")[0], start: "top 58%", end: "bottom 58%", scrub: true } });
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} className="tdd" aria-labelledby="days-title">
      <div className="tdd-inner">
        <div className="tdd-side">
          <h2 id="days-title" className="tdd-kicker">
            Day by day
          </h2>
          <p className="tdd-counter">
            <span>Day</span>
            <Roll value={days[active]?.day ?? 1} />
            <small>/ {pad2(days.length)}</small>
          </p>
          <p key={active} className="tdd-side-title">
            {days[active]?.title}
          </p>
          <div className="tdd-photo" aria-hidden>
            {photos.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- crossfaded remote photos
              <img key={src} src={src} alt="" data-on={i === active % photos.length || undefined} loading="lazy" decoding="async" />
            ))}
          </div>
          <div className="tdd-rail" aria-hidden>
            <span className="tdd-rail-fill" />
            {days.map((d, i) => (
              <i key={d.day} data-on={i <= active || undefined} />
            ))}
          </div>
        </div>
        <ol className="tdd-days">
          {days.map((d, i) => (
            <li key={d.day} className="tdd-day" data-on={i === active || undefined}>
              <p className="tdd-day-no">Day {pad2(d.day)}</p>
              <h3 className="tdd-day-title">{d.title}</h3>
              <p className="tdd-day-text">{d.description}</p>
              {d.attractionSlugs.some((s) => tour.sights[s]) && (
                <ul className="tdd-sights" aria-label="Landmarks">
                  {d.attractionSlugs.map((s) =>
                    tour.sights[s] ? (
                      <li key={s}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- small remote thumbnail */}
                        <img src={thumb(tour.sights[s].image, 330)} alt="" loading="lazy" decoding="async" />
                        {tour.sights[s].name}
                      </li>
                    ) : null,
                  )}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
