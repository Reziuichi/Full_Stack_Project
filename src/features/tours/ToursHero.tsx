"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowDown } from "@phosphor-icons/react";
import { formatInr } from "@/lib/format";
import { gsap, MOTION_QUERIES, useGSAP } from "@/lib/gsap";
import { numberWord, thumb, type TourCity } from "./tourData";

const COLUMNS = 8;

type Tile = { src: string; code: string; glow: string };

/**
 * The tours page opens on a wall: every tour's photos pinned to a tilted
 * plane in columns that drift up and down past each other (never pausing),
 * fading out of the dark. The headline sits over it; a departures ticker
 * cycles through the flights. Scrolling on, the wall swells and sinks away.
 */
export function ToursHero({ cities }: { cities: TourCity[] }) {
  const root = useRef<HTMLElement>(null);
  const tours = useMemo(() => cities.flatMap((c) => c.tours.map((t) => ({ ...t, city: c }))), [cities]);
  const days = tours.map((t) => t.durationDays);
  const minPrice = Math.min(...tours.map((t) => t.priceInr));

  // Deal the photos across the columns so no two neighbours share a city.
  const columns = useMemo(() => {
    const tiles: Tile[] = [];
    for (let k = 0; k < 3; k++) {
      for (const t of tours) {
        const src = t.images[k];
        if (src) tiles.push({ src: thumb(src, 500), code: t.city.code, glow: t.city.theme.glow });
      }
    }
    const cols: Tile[][] = Array.from({ length: COLUMNS }, () => []);
    tiles.forEach((tile, i) => cols[(i * 3) % COLUMNS].push(tile));
    return cols.map((c) => c.slice(0, 6));
  }, [tours]);

  useGSAP(
    () => {
      const q = (s: string) => gsap.utils.toArray<HTMLElement>(s, root.current);
      const mm = gsap.matchMedia();
      mm.add(MOTION_QUERIES, (context) => {
        const full = Boolean(context.conditions?.full);
        gsap.set(q(".th-plane"), { rotationX: 52, rotationZ: -24 });
        const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
        if (full) {
          // The wall fades in as a whole (fading the tilted plane itself would flatten its 3D).
          tl.fromTo(q(".th-wall"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 1.6, ease: "power2.out" }, 0)
            .fromTo(q(".th-plane"), { rotationX: 70, scale: 0.84 }, { rotationX: 52, scale: 1, duration: 2.4 }, 0)
            .fromTo(q("[data-a=line]"), { yPercent: 112 }, { yPercent: 0, duration: 1.5, stagger: 0.12 }, 0.35)
            .fromTo(q("[data-a=fade]"), { autoAlpha: 0, y: 22 }, { autoAlpha: 1, y: 0, duration: 1.2, stagger: 0.08 }, 0.8);
          // Scrolling on: the wall sinks back into the dark (a shade fading in over it: fading the
          // 3D wall itself would flatten it into one big offscreen surface each frame, and scaling
          // it made the GPU redraw every photo at each new size); the words lift away.
          const st = { trigger: root.current, start: "top top", end: "bottom top", scrub: 0.6 };
          gsap.to(q(".th-drift"), { yPercent: -9, ease: "none", scrollTrigger: st });
          gsap.fromTo(q(".th-shade"), { opacity: 0 }, { opacity: 0.7, ease: "none", scrollTrigger: { ...st } });
          gsap.to(q(".th-content"), { y: -110, autoAlpha: 0, ease: "none", scrollTrigger: { trigger: root.current, start: "top top", end: "70% top", scrub: 0.6 } });
        } else {
          tl.fromTo(q("[data-a=line], [data-a=fade], .th-wall"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8 });
        }
      });
    },
    { scope: root },
  );

  // The wall's columns hold still while the page scrolls (it's fading out by then anyway) and
  // while the hero is off screen: drifting under a moving page, the tilted columns kept
  // uncovering photos the GPU hadn't drawn yet, and the first scroll stuttered (200 ms frames).
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let idle = 0;
    const onScroll = () => {
      if (!el.dataset.scrolling) el.dataset.scrolling = "";
      window.clearTimeout(idle);
      idle = window.setTimeout(() => delete el.dataset.scrolling, 220);
    };
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? delete el.dataset.away : (el.dataset.away = "")));
    io.observe(el);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(idle);
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const toRoute = (e: React.MouseEvent) => {
    const route = document.getElementById("route");
    if (!route) return;
    e.preventDefault();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    gsap.to(window, { scrollTo: { y: route, autoKill: true }, duration: reduce ? 0 : 1.3, ease: "power3.inOut" });
  };

  return (
    <section ref={root} className="th" aria-labelledby="tours-title">
      <div className="th-wall" aria-hidden>
        <div className="th-drift">
          <div className="th-plane">
            {columns.map((col, c) => (
              <div key={c} className="th-col" style={{ "--dur": `${46 + (c % 4) * 8}s` } as CSSProperties} data-dir={c % 2 ? "down" : "up"}>
                <div className="th-col-inner">
                  {[...col, ...col].map((t, i) => (
                    <figure key={i} className="th-tile" style={{ "--glow": t.glow } as CSSProperties}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- remote thumbnails on a decorative wall */}
                      <img src={t.src} alt="" loading={i < 3 ? "eager" : "lazy"} decoding="async" />
                      <figcaption>
                        <i />
                        {t.code}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="th-shade" aria-hidden />
      <div className="th-fog" aria-hidden />

      <div className="th-content">
        <p data-a="fade" className="th-kicker">
          <i aria-hidden />
          {tours.length} tours · {cities.length} cities · {Math.min(...days)}–{Math.max(...days)} days · from {formatInr(minPrice)}
        </p>
        <h1 id="tours-title" className="th-title">
          <span className="th-mask">
            <span data-a="line" className="block">
              {numberWord(tours.length)} ways
            </span>
          </span>
          <span className="th-mask">
            <span data-a="line" className="block">
              to <em>leave.</em>
            </span>
          </span>
        </h1>
        <p data-a="fade" className="th-lede">
          Hotels named, days planned, entry tickets included. Every tour leaves from our desk in Chandigarh; prices are per person on twin sharing, flights booked separately.
        </p>
        <div data-a="fade" className="th-actions">
          <a href="#route" onClick={toRoute} className="th-cta">
            Board the route
            <span className="th-cta-icon" aria-hidden>
              <ArrowDown size={16} weight="bold" />
            </span>
          </a>
          <a href="#timetable" className="th-link">
            Or read the timetable
          </a>
        </div>
      </div>

      <Ticker tours={tours} />
    </section>
  );
}

/** A departures line that flips to the next flight every few seconds. */
function Ticker({ tours }: { tours: (TourCity["tours"][number] & { city: TourCity })[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setI((n) => (n + 1) % tours.length), 2800);
    return () => window.clearInterval(id);
  }, [tours.length]);
  const t = tours[i];
  return (
    <div data-a="fade" className="th-ticker" aria-hidden>
      <p className="th-ticker-label">
        <i />
        Now boarding
      </p>
      <p key={i} className="th-ticker-line" style={{ "--glow": t.city.theme.glow } as CSSProperties}>
        <b>{t.flight}</b>
        <span>
          IXC <em>→</em> {t.city.code}
        </span>
        <span className="th-ticker-name">{t.name}</span>
        <span>{t.durationDays} days</span>
      </p>
    </div>
  );
}
