"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, ArrowUpRight } from "@phosphor-icons/react";
import type { DestinationSummary } from "@/lib/types";
import { airportCode, flightTime, greatCircleKm, HOME_BASE } from "@/lib/airports";
import { formatInr, formatNumber, localTimeIn } from "@/lib/format";
import { gsap, MOTION_QUERIES, ScrollTrigger, useGSAP } from "@/lib/gsap";
import { tourThemeFor } from "@/lib/tourThemes";
import { FlightMap, type MapStop } from "./FlightMap";

const CONTINENT: Record<string, string> = {
  France: "Europe",
  "United Kingdom": "Europe",
  "United Arab Emirates": "Asia",
  Japan: "Asia",
  India: "Asia",
  "United States": "North America",
};
const pad2 = (n: number) => String(n).padStart(2, "0");
const cssUrl = (u: string) => `url("${u.replace(/"/g, "%22")}")`;

/**
 * The destinations page as a flight atlas. A dot-matrix world stays pinned
 * behind the page with the desk's routes from Chandigarh; the page itself is
 * a departures board. Scrolling (or pointing at) a departure flies the map
 * to that city and runs its route; a photo of the city follows the cursor
 * over the board. After the jet transition, the page waits for the smoke to
 * clear before its own entrance plays.
 */
export function DestinationsAtlas({ destinations }: { destinations: DestinationSummary[] }) {
  const root = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  // The preview photos load only once a mouse first reaches the board: they
  // are never needed on touch, and never compete with the page's arrival.
  const [armed, setArmed] = useState(false);
  const [play, setPlay] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const fromFlight = useRef(false);
  const hoverTimer = useRef(0);

  const rows = useMemo(
    () =>
      destinations.map((d, i) => {
        const km = greatCircleKm(HOME_BASE, d);
        return { d, i, code: airportCode(d.slug, d.name), km, time: flightTime(km), glow: tourThemeFor(d.slug).glow, flight: `LG ${101 + i}` };
      }),
    [destinations],
  );
  const stops: MapStop[] = useMemo(() => rows.map((r) => ({ slug: r.d.slug, code: r.code, name: r.d.name, lat: r.d.lat, lng: r.d.lng, glow: r.glow })), [rows]);
  const longest = rows.reduce((a, b) => (b.km > a.km ? b : a), rows[0]);
  const tours = destinations.reduce((sum, d) => sum + d.packageCount, 0);
  const continents = new Set(destinations.map((d) => CONTINENT[d.country]).filter(Boolean)).size;

  // Local clocks on the board.
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = requestAnimationFrame(tick);
    const id = window.setInterval(tick, 20_000);
    return () => {
      cancelAnimationFrame(first);
      window.clearInterval(id);
    };
  }, []);

  // Start as the jet's wake opens (or straight away on a direct visit). It
  // never waits long: whatever happened to a flight, the map and entrance
  // play within a moment.
  useEffect(() => {
    const flight = (window as Window & { __lgtFlight?: string }).__lgtFlight;
    if (flight) fromFlight.current = true;
    const go = () => setPlay(true);
    if (flight === "covering") {
      window.addEventListener("lgt:flight-reveal", go, { once: true });
      const late = window.setTimeout(go, 1600);
      return () => {
        window.removeEventListener("lgt:flight-reveal", go);
        window.clearTimeout(late);
      };
    }
    const id = requestAnimationFrame(go);
    // A frame may never come in a hidden tab; start anyway.
    const late = window.setTimeout(go, 300);
    return () => {
      cancelAnimationFrame(id);
      window.clearTimeout(late);
    };
  }, []);

  // Entrance, and the scroll-driven focus on each departure.
  useGSAP(
    () => {
      const el = root.current;
      if (!el || !play) return;
      const q = (s: string) => gsap.utils.toArray<HTMLElement>(`[data-a="${s}"]`, el);
      const mm = gsap.matchMedia();
      mm.add(MOTION_QUERIES, (context) => {
        const full = Boolean(context.conditions?.full);
        // Arriving in the jet's wake: the world settles up into place.
        if (full && fromFlight.current) {
          gsap.fromTo(q("map")[0] ?? [], { scale: 0.93, opacity: 0.4 }, { scale: 1, opacity: 1, duration: 2.2, ease: "expo.out", clearProps: "transform,opacity,scale" });
        }
        gsap
          .timeline({ defaults: { ease: "expo.out" } })
          .fromTo(q("line"), { y: 0, yPercent: full ? 110 : 0, opacity: full ? 1 : 0 }, { yPercent: 0, opacity: 1, duration: 1.5, stagger: 0.1 }, 0.2)
          .fromTo(q("fade"), { opacity: 0, y: full ? 18 : 0 }, { opacity: 1, y: 0, duration: 1.1, stagger: 0.07 }, 0.5)
          .fromTo(q("stat"), { opacity: 0, y: full ? 12 : 0 }, { opacity: 1, y: 0, duration: 0.9, stagger: 0.06 }, 0.8);
        // Departures rise in as they arrive.
        q("row").forEach((row) => {
          gsap.fromTo(row, { opacity: 0, y: full ? 40 : 0 }, { opacity: 1, y: 0, duration: 1, ease: "expo.out", scrollTrigger: { trigger: row, start: "top 92%", once: true } });
        });
      });
      // The departure crossing the middle of the screen is the one on show.
      const triggers = q("row").map((row, i) =>
        ScrollTrigger.create({
          trigger: row,
          start: "top 58%",
          end: "bottom 58%",
          onToggle: (self) => {
            if (self.isActive) setActive(rows[i].d.slug);
          },
        }),
      );
      const hero = ScrollTrigger.create({
        trigger: q("hero")[0],
        start: "top top",
        end: "bottom 58%",
        onToggle: (self) => {
          if (self.isActive) setActive(null);
        },
      });
      return () => {
        triggers.forEach((t) => t.kill());
        hero.kill();
      };
    },
    { scope: root, dependencies: [play] },
  );

  // A photo of the city follows the cursor over the board.
  useGSAP(
    () => {
      const card = preview.current;
      if (!card) return;
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)", () => {
        const x = gsap.quickTo(card, "x", { duration: 0.6, ease: "power3.out" });
        const y = gsap.quickTo(card, "y", { duration: 0.6, ease: "power3.out" });
        const r = gsap.quickTo(card, "rotation", { duration: 0.8, ease: "power3.out" });
        let lastX = 0;
        const move = (e: PointerEvent) => {
          x(e.clientX + 28);
          y(e.clientY - 150);
          r(Math.max(-8, Math.min(8, (e.clientX - lastX) * 0.4)));
          lastX = e.clientX;
        };
        window.addEventListener("pointermove", move, { passive: true });
        return () => window.removeEventListener("pointermove", move);
      });
    },
    { scope: root },
  );

  // The photo shows only while the pointer is moving over a departure: it
  // steps aside after a moment's stillness, and at once when the page
  // scrolls (the scroll-driven focus leads again).
  const clearHover = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
    setHover(null);
  }, []);
  const pokeHover = (slug: string) => {
    setHover(slug);
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHover(null), 1300);
  };
  useEffect(() => {
    window.addEventListener("scroll", clearHover, { passive: true });
    return () => {
      window.removeEventListener("scroll", clearHover);
      window.clearTimeout(hoverTimer.current);
    };
  }, [clearHover]);

  const shown = hover ?? active;

  return (
    <div ref={root} className="atlas">
      <div className="atlas-map" aria-hidden>
        <div data-a="map" className="atlas-map-inner">
          <FlightMap stops={stops} active={shown} play={play} />
        </div>
        <div className="atlas-map-shade" />
      </div>

      <div className="atlas-content">
        <section data-a="hero" className="atlas-hero" aria-labelledby="atlas-title">
          <p data-a="fade" className="atlas-kicker">
            <i aria-hidden />
            {pad2(destinations.length)} destinations · departing {HOME_BASE.code} {HOME_BASE.name}
          </p>
          <h1 id="atlas-title" className="atlas-title">
            <span className="atlas-mask">
              <span data-a="line" className="block">
                Where we
              </span>
            </span>
            <span className="atlas-mask">
              <span data-a="line" className="block">
                fly <em>you.</em>
              </span>
            </span>
          </h1>
          <p data-a="fade" className="atlas-lede">
            Eight cities we know street by street, each with a curated 3D flight over its landmarks and tours we run ourselves. Every route starts at
            our desk in Chandigarh.
          </p>
          <dl className="atlas-stats">
            <div data-a="stat">
              <dt>Cities</dt>
              <dd>{pad2(destinations.length)}</dd>
            </div>
            <div data-a="stat">
              <dt>Tours</dt>
              <dd>{pad2(tours)}</dd>
            </div>
            <div data-a="stat">
              <dt>Continents</dt>
              <dd>{pad2(continents)}</dd>
            </div>
            <div data-a="stat" className="atlas-stats-wide">
              <dt>Longest leg</dt>
              <dd>
                {HOME_BASE.code} → {longest.code} · {formatNumber(Math.round(longest.km))} km
              </dd>
            </div>
          </dl>
        </section>

        <section
          className="atlas-board"
          aria-labelledby="atlas-board-title"
          onPointerEnter={(e) => e.pointerType === "mouse" && setArmed(true)}
          onPointerLeave={clearHover}
        >
          <div className="atlas-board-head">
            <h2 id="atlas-board-title">Departures</h2>
            <span>From {HOME_BASE.code} · local times live</span>
          </div>
          <ol className="atlas-rows">
            {rows.map(({ d, i, code, km, time, glow, flight }) => {
              const isOn = shown === d.slug;
              return (
                <li key={d.slug} data-a="row">
                  <Link
                    href={`/destinations/${d.slug}`}
                    className="atlas-row"
                    data-on={isOn || undefined}
                    style={{ "--glow": glow } as CSSProperties}
                    onPointerMove={(e) => e.pointerType === "mouse" && pokeHover(d.slug)}
                    onPointerLeave={clearHover}
                  >
                    <span className="atlas-row-bar" aria-hidden />
                    <span className="atlas-row-flight">
                      <span>{flight}</span>
                      <span className="atlas-row-status">{isOn ? "Boarding" : "On time"}</span>
                    </span>
                    <span className="atlas-row-code">{code}</span>
                    <span className="atlas-row-main">
                      <span className="atlas-row-name">{d.name}</span>
                      <span className="atlas-row-place">
                        {d.country} · {d.region}
                      </span>
                      <span className="atlas-row-tag">{d.tagline}</span>
                    </span>
                    <span className="atlas-row-data">
                      <span>
                        <small>Distance</small>
                        {km < 30 ? "Home" : `${formatNumber(Math.round(km))} km`}
                      </span>
                      <span>
                        <small>Flight</small>
                        {time}
                      </span>
                      <span>
                        <small>Local time</small>
                        {now ? localTimeIn(d.timezone, now) : "--:--"}
                      </span>
                      <span>
                        <small>Tours</small>
                        {d.packageCount}
                        {d.fromPriceInr ? ` · ${formatInr(d.fromPriceInr)}` : ""}
                      </span>
                    </span>
                    <span className="atlas-row-go" aria-hidden>
                      <ArrowUpRight size={18} weight="light" />
                    </span>
                    <span className="sr-only">
                      {`${String(i + 1)}. ${d.name}, ${d.country}.`}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="atlas-end">
          <p className="atlas-end-kicker">Not on the board?</p>
          <Link href="/#explore" className="atlas-end-link">
            Plot it on the globe <ArrowRight size={26} weight="light" aria-hidden />
          </Link>
          <p className="atlas-end-note">Search any place on the live Earth and we&apos;ll plan the trip with you.</p>
        </section>
      </div>

      {/* The photo that follows the cursor over the board */}
      <div ref={preview} className="atlas-preview" data-on={hover ? true : undefined} aria-hidden>
        {rows.map(({ d, glow }) => (
          <span
            key={d.slug}
            className="atlas-preview-img"
            data-on={hover === d.slug || undefined}
            style={{ backgroundImage: armed && d.heroImage ? cssUrl(d.heroImage) : undefined, "--glow": glow } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}
