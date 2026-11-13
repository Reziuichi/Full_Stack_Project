"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, ArrowUpRight } from "@phosphor-icons/react";
import type { DestinationSummary } from "@/lib/types";
import { formatInr, localTimeIn } from "@/lib/format";
import { formatCoordinates } from "@/lib/geo";
import { gsap, MOTION_QUERIES, ScrollTrigger, useGSAP } from "@/lib/gsap";
import { tourThemeFor } from "@/lib/tourThemes";
import { airportCode } from "@/lib/airports";

const COUNT_WORDS = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const pad2 = (n: number) => String(n).padStart(2, "0");
const cssUrl = (u: string) => `url("${u.replace(/"/g, "%22")}")`;
const codeOf = (d: DestinationSummary) => airportCode(d.slug, d.name);

/** Long names break over two offset lines, like a poster: NEW / YORK, CHANDI / GARH. */
function splitName(name: string): string[] {
  const n = name.toUpperCase();
  const space = n.indexOf(" ");
  if (space > 0) return [n.slice(0, space), n.slice(space + 1)];
  if (n.length >= 8) {
    const k = Math.ceil(n.length / 2);
    return [n.slice(0, k), n.slice(k)];
  }
  return [n];
}

/**
 * "Eight places we know street by street" as a scrolling reel. Each city's
 * name rises out of a blur into focus; beside it a postcard of the city
 * (with a passport stamp) tumbles in out of focus, settles, and tumbles
 * away, over a glow in that city's own colour. A side index brackets the
 * city on show, and the corner HUD reads its local time. The list closes
 * in a viewfinder. Scroll-linked throughout (GSAP ScrollTrigger, scrubbed),
 * animating transform, opacity and filter only.
 */
export function DestinationReel({ destinations }: { destinations: DestinationSummary[] }) {
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const [clock, setClock] = useState("--:--");
  const n = destinations.length;
  const current = destinations[active] ?? destinations[0];
  const tours = destinations.reduce((sum, d) => sum + d.packageCount, 0);
  const count = COUNT_WORDS[n - 1] ?? String(n);

  // The HUD's clock: local time wherever is on show.
  const timezone = current?.timezone;
  useEffect(() => {
    if (!timezone) return;
    const tick = () => setClock(localTimeIn(timezone));
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, [timezone]);

  // The journey above loads its sections late; when that moves this section,
  // re-measure every scroll trigger so the reel stays in step.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let top = el.getBoundingClientRect().top + window.scrollY;
    let timer = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const next = el.getBoundingClientRect().top + window.scrollY;
        if (Math.abs(next - top) > 1) {
          top = next;
          ScrollTrigger.refresh();
        }
      }, 150);
    });
    ro.observe(document.body);
    return () => {
      ro.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  const jumpTo = (i: number) => {
    const item = root.current?.querySelectorAll<HTMLElement>('[data-r="item"]')[i];
    if (!item) return;
    const y = item.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.06;
    const reduce = window.matchMedia(MOTION_QUERIES.reduce).matches;
    gsap.to(window, { scrollTo: y, duration: reduce ? 0 : 1.2, ease: "power3.inOut" });
  };

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const all = (s: string, scope: Element = el) => gsap.utils.toArray<HTMLElement>(`[data-r="${s}"]`, scope);
      const one = (s: string, scope: Element = el) => all(s, scope)[0];
      const items = all("item");

      // Which city is on show (the last one whose top has passed 55% of the
      // screen): drives the side index, the colour and the clock. Measured
      // from cached positions, so a fast jump can never skip a city.
      let tops: number[] = [];
      const measure = () => {
        tops = items.map((item) => item.getBoundingClientRect().top + window.scrollY);
      };
      const pick = () => {
        const line = window.scrollY + window.innerHeight * 0.55;
        let k = 0;
        tops.forEach((top, i) => {
          if (top <= line) k = i;
        });
        if (k !== activeRef.current) {
          activeRef.current = k;
          setActive(k);
        }
      };
      measure();
      ScrollTrigger.addEventListener("refresh", measure);
      ScrollTrigger.create({ trigger: el, start: "top bottom", end: "bottom top", onUpdate: pick, onRefresh: pick });

      const mm = gsap.matchMedia();
      mm.add(MOTION_QUERIES, (context) => {
        const full = Boolean(context.conditions?.full);
        const blur = (px: number) => `blur(${full ? px : 0}px)`;

        // The HUD fades up once the section is on screen.
        gsap.fromTo(one("hud"), { opacity: 0 }, { opacity: 1, ease: "none", scrollTrigger: { trigger: el, start: "top 70%", end: "top 25%", scrub: true } });

        // Intro: the crosshairs turn in and the statement sharpens, word by word.
        const intro = one("intro");
        gsap.fromTo(
          all("plus", intro),
          { rotation: full ? -90 : 0, opacity: 0 },
          { rotation: 0, opacity: 1, stagger: 0.12, ease: "power2.out", scrollTrigger: { trigger: intro, start: "top 85%", end: "top 50%", scrub: 0.6 } },
        );
        gsap.fromTo(
          all("word", intro),
          { y: 0, yPercent: full ? 35 : 0, opacity: 0.08, filter: blur(10) },
          { yPercent: 0, opacity: 1, filter: blur(0), stagger: 0.05, ease: "none", scrollTrigger: { trigger: intro, start: "top 80%", end: "top 30%", scrub: 0.6 } },
        );
        gsap.fromTo(
          all("intro-copy", intro),
          { opacity: 0, y: full ? 18 : 0 },
          { opacity: 1, y: 0, stagger: 0.2, ease: "power2.out", scrollTrigger: { trigger: intro, start: "top 55%", end: "top 20%", scrub: 0.6 } },
        );

        items.forEach((item) => {
          // The name rises into focus; a second line comes later and from further right.
          const name = gsap.timeline({ scrollTrigger: { trigger: item, start: "top 92%", end: "top 38%", scrub: 0.6 } });
          all("line", item).forEach((line, j) => {
            name.fromTo(
              line,
              { y: 0, yPercent: full ? 38 : 0, x: full ? j * 90 : 0, opacity: 0.1, filter: blur(14 + j * 6) },
              { yPercent: 0, x: 0, opacity: 1, filter: blur(0), duration: 1, ease: "power2.out" },
              j * 0.35,
            );
          });
          gsap.fromTo(
            all("reveal", item),
            { opacity: 0, y: full ? 24 : 0 },
            { opacity: 1, y: 0, stagger: 0.12, ease: "power2.out", scrollTrigger: { trigger: item, start: "top 68%", end: "top 28%", scrub: 0.6 } },
          );
          // The rule beside the copy grows as you read through the city.
          gsap.fromTo(one("bar", item), { scaleY: 0.06 }, { scaleY: 1, ease: "none", scrollTrigger: { trigger: item, start: "top 60%", end: "bottom 60%", scrub: true } });

          // The postcard tumbles in out of focus, settles, and tumbles away;
          // a second photo drifts past further back, softly out of focus.
          const card = one("card", item);
          const far = one("far", item);
          const glow = one("glow", item);
          const float = gsap.timeline({ scrollTrigger: { trigger: item, start: "top bottom", end: "bottom top", scrub: 0.9 } });
          if (full) {
            float
              .fromTo(
                card,
                { y: 0, yPercent: 55, rotationZ: -26, rotationY: 40, rotationX: 14, scale: 0.84, filter: blur(16), opacity: 0 },
                { yPercent: 0, rotationZ: -7, rotationY: 14, rotationX: 5, scale: 1, filter: blur(0), opacity: 1, duration: 0.4, ease: "power2.out" },
              )
              .to(card, { yPercent: -8, rotationZ: -3, rotationY: 6, rotationX: 2, duration: 0.25, ease: "none" })
              .to(card, { yPercent: -60, rotationZ: 16, rotationY: -30, rotationX: -12, scale: 0.9, filter: blur(14), opacity: 0, duration: 0.35, ease: "power2.in" })
              .fromTo(far, { y: 0, yPercent: 150, rotationZ: 20 }, { yPercent: -170, rotationZ: -14, duration: 1, ease: "none" }, 0)
              .fromTo(glow, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.4, ease: "power2.out" }, 0)
              .to(glow, { opacity: 0, scale: 0.8, duration: 0.35, ease: "power2.in" }, 0.65);
          } else {
            gsap.set(far, { opacity: 0 });
            float
              .fromTo([card, glow], { opacity: 0 }, { opacity: 1, duration: 0.3 })
              .to([card, glow], { opacity: 1, duration: 0.4 })
              .to([card, glow], { opacity: 0, duration: 0.3 });
          }
        });

        // The list ends in a viewfinder: its corners close in on the call to action.
        const end = one("end");
        gsap.fromTo(
          all("corner", end),
          { x: (i: number) => (i % 2 ? 1 : -1) * (full ? 70 : 0), y: (i: number) => (i < 2 ? -1 : 1) * (full ? 44 : 0), opacity: 0 },
          { x: 0, y: 0, opacity: 1, ease: "power2.out", scrollTrigger: { trigger: end, start: "top 85%", end: "top 40%", scrub: 0.6 } },
        );
        gsap.fromTo(
          all("end-copy", end),
          { opacity: 0.08, y: full ? 20 : 0, filter: blur(10) },
          { opacity: 1, y: 0, filter: blur(0), stagger: 0.15, ease: "power2.out", scrollTrigger: { trigger: end, start: "top 75%", end: "top 35%", scrub: 0.6 } },
        );
      });
      return () => ScrollTrigger.removeEventListener("refresh", measure);
    },
    { scope: root },
  );

  if (!n || !current) return null;
  const hudGlow = tourThemeFor(current.slug).glow;

  return (
    <section
      ref={root}
      id="destinations"
      aria-labelledby="all-destinations"
      className="reel"
      style={{ "--hud-glow": hudGlow } as CSSProperties}
    >
      {/* HUD: pinned over the section while it scrolls */}
      <div className="reel-hud-track">
        <div data-r="hud" className="reel-hud">
          <p className="reel-hud-tl">
            <span>03</span>
            <i className="reel-rule" aria-hidden />
            <span>Destinations</span>
          </p>
          <Link href="/destinations" className="reel-hud-tr">
            All destinations <span aria-hidden>+</span>
          </Link>
          <nav className="reel-nav" aria-label="Jump to a destination">
            {destinations.map((d, i) => (
              <button key={d.slug} type="button" data-active={i === active} aria-current={i === active ? "true" : undefined} onClick={() => jumpTo(i)}>
                {d.name}
              </button>
            ))}
          </nav>
          <p className="reel-hud-bl">
            {pad2(n)} cities · {tours} tours
          </p>
          <p className="reel-hud-br">
            <span className="reel-live" aria-hidden />
            <span>
              Local {clock} · {current.name}
            </span>
          </p>
        </div>
      </div>

      {/* Intro statement */}
      <div data-r="intro" className="reel-intro">
        <p className="reel-plus" aria-hidden>
          {[0, 1, 2].map((k) => (
            <svg key={k} data-r="plus" viewBox="0 0 16 16" focusable="false">
              <path d="M8 1v14M1 8h14" />
            </svg>
          ))}
        </p>
        <h2 id="all-destinations" className="reel-title">
          {`${count} places we know street by street.`.split(" ").map((w, i) => (
            <span key={i}>
              <span data-r="word" className="reel-word">
                {w}
              </span>{" "}
            </span>
          ))}
        </h2>
        <p data-r="intro-copy" className="reel-manifesto">
          We don&apos;t list every city on the map. We know these {count.toLowerCase()} the way the locals do: the side doors, the quiet hours, the
          table by the window.
        </p>
        <p data-r="intro-copy" className="reel-pitch">
          That&apos;s the whole list.
        </p>
      </div>

      {/* One reel frame per city */}
      {destinations.map((d, i) => {
        const theme = tourThemeFor(d.slug);
        const lines = splitName(d.name);
        const code = codeOf(d);
        const far = d.landmarks[1]?.imageUrl || d.landmarks[0]?.imageUrl || "";
        return (
          <article key={d.slug} data-r="item" className="reel-item" style={{ "--glow": theme.glow } as CSSProperties} aria-labelledby={`reel-${d.slug}`}>
            <div className="reel-copy-col">
              <p className="reel-index">
                {pad2(i + 1)} / {pad2(n)} · {d.country}
              </p>
              <h3 id={`reel-${d.slug}`} className="reel-name" aria-label={d.name}>
                {lines.map((line, j) => (
                  <span key={j} data-r="line" className="reel-line" aria-hidden>
                    {line}
                  </span>
                ))}
              </h3>
              <div className="reel-body">
                <span data-r="bar" className="reel-bar" aria-hidden />
                <p data-r="reveal" className="reel-summary">
                  {d.summary}
                </p>
                <p data-r="reveal" className="reel-tagline">
                  {d.tagline}
                </p>
                <ul data-r="reveal" className="reel-tags" aria-label={`Landmarks in ${d.name}`}>
                  {d.landmarks.map((l) => (
                    <li key={l.name}>{l.name}</li>
                  ))}
                </ul>
                <p data-r="reveal" className="reel-meta">
                  <span>
                    {d.packageCount} {d.packageCount === 1 ? "tour" : "tours"}
                    {d.fromPriceInr ? ` · from ${formatInr(d.fromPriceInr)}` : ""}
                  </span>
                  <span>Best {d.bestSeason}</span>
                  <Link href={`/destinations/${d.slug}`} className="reel-open">
                    Open {d.name} <ArrowUpRight size={12} weight="bold" aria-hidden />
                  </Link>
                </p>
              </div>
            </div>

            {/* The postcard: the city with its stamp, over a glow in the city's colour */}
            <div className="reel-float" aria-hidden>
              <span data-r="glow" className="reel-glow" />
              {far && <div data-r="far" className="reel-far" style={{ backgroundImage: cssUrl(far) }} />}
              <div data-r="card" className="reel-card">
                <div className="reel-card-photo" style={{ backgroundImage: d.heroImage ? cssUrl(d.heroImage) : undefined }} />
                <div className="reel-card-foot">
                  <b>{code}</b>
                  <span>{formatCoordinates(d, 2)}</span>
                </div>
                <svg className="reel-stamp" viewBox="0 0 120 120" focusable="false">
                  <defs>
                    <path id={`reel-stamp-${d.slug}`} d="M60 60 m-47 0 a47 47 0 1 1 94 0 a47 47 0 1 1 -94 0" />
                  </defs>
                  <circle cx="60" cy="60" r="57" />
                  <circle cx="60" cy="60" r="38" className="reel-stamp-dash" />
                  <text className="reel-stamp-ring" textLength={295} lengthAdjust="spacing">
                    <textPath href={`#reel-stamp-${d.slug}`}>{`Longitude · ${d.name} · ${d.country} · `.toUpperCase()}</textPath>
                  </text>
                  <text x="60" y="63" textAnchor="middle" className="reel-stamp-code">
                    {code}
                  </text>
                  <text x="60" y="78" textAnchor="middle" className="reel-stamp-sub">
                    Arrived
                  </text>
                </svg>
              </div>
            </div>
          </article>
        );
      })}

      {/* The end of the list, in a viewfinder */}
      <div data-r="end" className="reel-end">
        <div className="reel-finder">
          {[0, 1, 2, 3].map((k) => (
            <span key={k} data-r="corner" className="reel-corner" aria-hidden />
          ))}
          <p data-r="end-copy" className="reel-end-kicker">
            End of list · {pad2(n)} / {pad2(n)}
          </p>
          <Link data-r="end-copy" href="/destinations" className="reel-end-link">
            See all {count.toLowerCase()} <ArrowRight size={28} weight="light" aria-hidden />
          </Link>
          <p data-r="end-copy" className="reel-end-note">
            Somewhere else in mind? Search it on the globe above and we&apos;ll plan it with you.
          </p>
        </div>
      </div>
    </section>
  );
}
