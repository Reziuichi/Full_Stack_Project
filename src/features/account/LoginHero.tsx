"use client";

import { useCallback, useRef } from "react";
import { AuthForms } from "@/components/account/AuthForms";
import { gsap, MOTION_QUERIES, useGSAP } from "@/lib/gsap";
import { EarthHorizon, type EarthTelemetry, type WordLayout } from "./earth/EarthHorizon";

const fmt = (n: number, digits = 1) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)}`;
const coord = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? pos : neg}`;

/**
 * The signed-out account page. A giant ORBIT stands behind the top of the
 * Earth (the planet hides its foot, and the sun sets inside its O) while a
 * full day runs over the planet; "Back in" hangs over it. The sign-in form
 * is a boarding pass on the left; a flight-data strip along the bottom reads the
 * scene live (phase, sun elevation, the point below, its local time).
 */
export function LoginHero({ online, offlineReason }: { online: boolean; offlineReason?: string }) {
  const root = useRef<HTMLElement>(null);
  const anchor = useRef<HTMLParagraphElement>(null);
  const phase = useRef<HTMLElement>(null);
  const elev = useRef<HTMLElement>(null);
  const point = useRef<HTMLElement>(null);
  const time = useRef<HTMLElement>(null);

  // Written straight to the DOM five times a second: no React renders.
  const onTelemetry = useCallback((t: EarthTelemetry) => {
    if (phase.current) {
      phase.current.textContent = t.phase;
      phase.current.dataset.phase = t.phase.toLowerCase().replace(/\s+/g, "-");
    }
    if (elev.current) elev.current.textContent = `${fmt(t.sunElevation)}°`;
    if (point.current) point.current.textContent = `${coord(t.lat, "N", "S")} ${coord(t.lon, "E", "W")}`;
    if (time.current) time.current.textContent = t.localTime;
  }, []);

  // Place "Back in" on the word's top-left corner (the renderer keeps it there as the view banks).
  const onLayout = useCallback((l: WordLayout) => {
    const el = root.current;
    if (!el) return;
    el.style.setProperty("--word-left", `${l.left}px`);
    el.style.setProperty("--word-top", `${l.top}px`);
    el.style.setProperty("--word-cap", `${l.capHeight}px`);
    el.dataset.word = "ready";
  }, []);

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const q = (s: string) => gsap.utils.toArray<HTMLElement>(`[data-l="${s}"]`, el);
      const mm = gsap.matchMedia();
      mm.add(MOTION_QUERIES, (context) => {
        const full = Boolean(context.conditions?.full);
        gsap
          .timeline({ defaults: { ease: "expo.out" }, delay: 0.2 })
          .fromTo(q("fade"), { opacity: 0, y: full ? 14 : 0 }, { opacity: 1, y: 0, duration: 1.1, stagger: 0.08 }, 0.2)
          // The glass itself fades (never a wrapper: an ancestor's opacity would
          // cut the pass off from the scene behind its blur).
          .fromTo(
            el.querySelector(".pass-card"),
            { opacity: 0, y: full ? 40 : 0, scale: full ? 0.96 : 1 },
            { opacity: 1, y: 0, scale: 1, duration: 1.4, clearProps: "transform" },
            0.5,
          )
          .fromTo(el.querySelector(".pass-shadow"), { opacity: 0 }, { opacity: 1, duration: 1.4 }, 0.5)
          // "Back in" arrives once ORBIT has risen from behind the planet.
          .fromTo(
            q("backin"),
            { opacity: 0, yPercent: full ? 60 : 0, filter: full ? "blur(8px)" : "blur(0px)" },
            { opacity: 1, yPercent: 0, filter: "blur(0px)", duration: 1.4, clearProps: "filter" },
            2.3,
          );
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} className="login-hero" aria-labelledby="login-title">
      <EarthHorizon className="login-earth" word="ORBIT" onTelemetry={onTelemetry} onLayout={onLayout} anchorRef={anchor} />
      <div className="login-scrim" aria-hidden />
      <div className="login-cross" data-at="tl" aria-hidden />
      <div className="login-cross" data-at="tr" aria-hidden />
      <div className="login-cross" data-at="bl" aria-hidden />
      <div className="login-cross" data-at="br" aria-hidden />

      <h1 id="login-title" className="sr-only">
        Back in orbit. Sign in to Longitude.
      </h1>
      <p ref={anchor} className="login-backin" aria-hidden>
        <span data-l="backin" className="block">
          Back in
        </span>
      </p>

      <div className="login-layout">
        <div className="login-panel">
          <AuthForms online={online} offlineReason={offlineReason} />
        </div>
        <div className="login-side">
          <p data-l="fade" className="login-pill">
            <i aria-hidden />
            Mission access · L-26
          </p>
          <p data-l="fade" className="login-lede">
            Sign in to find every trip, departure date and hotel in one place. Down there, the day keeps turning while you do.
          </p>
        </div>
      </div>

      <dl data-l="fade" className="login-strip" aria-label="Live view of the Earth below">
        <div>
          <dt>Phase</dt>
          <dd ref={phase} className="login-phase">
            —
          </dd>
        </div>
        <div>
          <dt>Sun elevation</dt>
          <dd ref={elev}>—</dd>
        </div>
        <div className="login-strip-wide">
          <dt>Below us</dt>
          <dd ref={point}>—</dd>
        </div>
        <div>
          <dt>Local time</dt>
          <dd ref={time}>—</dd>
        </div>
        <div className="login-strip-wide">
          <dt>Altitude</dt>
          <dd>2,039 km</dd>
        </div>
        <div className="login-strip-credit">
          <dt>Imagery</dt>
          <dd>NASA Blue Marble · Black Marble</dd>
        </div>
      </dl>
    </section>
  );
}
