"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef } from "react";
import { Airplane, ArrowDown, Cube } from "@phosphor-icons/react";
import { formatInr } from "@/lib/format";
import { gsap, MOTION_QUERIES, useGSAP } from "@/lib/gsap";
import { thumb, type TourPageData } from "../tourData";

type TourWindow = Window & { __lgtTour?: string };

/**
 * The gate: the tour's photo full-bleed (the same frame the boarding
 * transition opens to, so the hand-off is seamless), the title rising word
 * by word and a boarding pass sliding in with the facts and the fare. The
 * photo drifts slowly; scrolling on, it sinks and the words lift away.
 */
export function TourHero({ tour }: { tour: TourPageData }) {
  const root = useRef<HTMLElement>(null);
  const hero = thumb(tour.images[0], 1280);

  // Tell the boarding transition the hero is ready to take over.
  useEffect(() => {
    const img = root.current?.querySelector<HTMLImageElement>(".tdh-img");
    let sent = false;
    const signal = () => {
      if (sent) return;
      sent = true;
      window.dispatchEvent(new CustomEvent("lgt:tour-ready", { detail: tour.slug }));
    };
    const late = window.setTimeout(signal, 4000);
    if (!img) signal();
    else if (img.complete) img.decode().then(signal, signal);
    else {
      img.addEventListener("load", () => img.decode().then(signal, signal), { once: true });
      img.addEventListener("error", signal, { once: true });
    }
    return () => window.clearTimeout(late);
  }, [tour.slug]);

  useGSAP(
    () => {
      const q = (s: string) => gsap.utils.toArray<HTMLElement>(s, root.current);
      const mm = gsap.matchMedia();
      mm.add(MOTION_QUERIES, (context) => {
        const full = Boolean(context.conditions?.full);
        const tl = gsap.timeline({ paused: true, defaults: { ease: "expo.out" } });
        if (full) {
          tl.fromTo(q("[data-a=word]"), { yPercent: 118 }, { yPercent: 0, duration: 1.3, stagger: 0.055 }, 0)
            .fromTo(q("[data-a=fade]"), { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 1, stagger: 0.07 }, 0.2)
            .fromTo(q(".tdh-pass"), { autoAlpha: 0, x: 80, rotation: 5 }, { autoAlpha: 1, x: 0, rotation: 0, duration: 1.5 }, 0.3);
          gsap.fromTo(q(".tdh-img"), { scale: 1 }, { scale: 1.07, duration: 18, ease: "none" });
          gsap.to(q(".tdh-photo"), { yPercent: 18, ease: "none", scrollTrigger: { trigger: root.current, start: "top top", end: "bottom top", scrub: true } });
          gsap.to(q(".tdh-lift"), { y: -90, autoAlpha: 0, ease: "none", scrollTrigger: { trigger: root.current, start: "top top", end: "75% top", scrub: true } });
        } else {
          tl.fromTo(q("[data-a=word], [data-a=fade], .tdh-pass"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6 });
        }
        // Arriving by the boarding transition: wait for the photo to land.
        if ((window as TourWindow).__lgtTour === "boarding") {
          const go = () => tl.play();
          window.addEventListener("lgt:tour-arrive", go, { once: true });
          const late = window.setTimeout(go, 9500);
          return () => {
            window.removeEventListener("lgt:tour-arrive", go);
            window.clearTimeout(late);
          };
        }
        tl.play();
      });
    },
    { scope: root },
  );

  const nights = Math.max(0, tour.durationDays - 1);
  const toBook = (e: React.MouseEvent) => {
    const book = document.getElementById("book");
    if (!book) return;
    e.preventDefault();
    gsap.to(window, { scrollTo: { y: book, offsetY: 40 }, duration: window.matchMedia(MOTION_QUERIES.reduce).matches ? 0 : 1.4, ease: "power3.inOut" });
  };

  return (
    <section ref={root} className="tdh" aria-labelledby="tour-title">
      <div className="tdh-photo">
        {/* eslint-disable-next-line @next/next/no-img-element -- the boarding transition hands off to this exact frame */}
        <img className="tdh-img" src={hero} alt={`${tour.name}, ${tour.city.name}`} fetchPriority="high" decoding="async" />
      </div>
      <div className="tdh-shade" aria-hidden />

      <div className="tdh-lift">
        <div className="tdh-content">
          <nav data-a="fade" aria-label="Breadcrumb" className="tdh-crumbs">
            <Link href="/tours">Tours</Link>
            <span aria-hidden>/</span>
            <Link href={`/tours?destination=${tour.city.slug}`}>{tour.city.name}</Link>
            <span aria-hidden>/</span>
            <span aria-current="page">{tour.name}</span>
          </nav>
          <p data-a="fade" className="tdh-kicker">
            <i aria-hidden />
            {tour.flight} · IXC → {tour.city.code} · {tour.city.name}, {tour.city.country}
          </p>
          <h1 id="tour-title" className="tdh-title">
            {tour.name.split(" ").map((w, i, all) => (
              <Fragment key={i}>
                <span className="tdh-mask">
                  <span data-a="word" className="inline-block">
                    {w}
                  </span>
                </span>
                {i < all.length - 1 ? " " : ""}
              </Fragment>
            ))}
          </h1>
          <p data-a="fade" className="tdh-summary">
            {tour.summary}
          </p>
          <Link data-a="fade" href={`/?to=${tour.city.slug}`} className="tdh-3d">
            <Cube size={15} weight="bold" aria-hidden /> See {tour.city.name} in 3D
          </Link>
        </div>

        <aside className="tdh-pass" aria-label="Trip at a glance">
          <p className="tdh-pass-top">
            <span>Boarding pass</span>
            <b>{tour.flight}</b>
          </p>
          <div className="tdh-pass-route">
            <p>
              <b>IXC</b>
              <small>Chandigarh</small>
            </p>
            <span className="tdh-pass-line" aria-hidden>
              <Airplane size={16} weight="fill" />
            </span>
            <p>
              <b>{tour.city.code}</b>
              <small>{tour.city.name}</small>
            </p>
          </div>
          <dl className="tdh-pass-grid">
            <div>
              <dt>Days</dt>
              <dd>{String(tour.durationDays).padStart(2, "0")}</dd>
            </div>
            <div>
              <dt>Nights</dt>
              <dd>{String(nights).padStart(2, "0")}</dd>
            </div>
            <div>
              <dt>Pace</dt>
              <dd>{tour.pace}</dd>
            </div>
            <div>
              <dt>Flight</dt>
              <dd>{tour.city.flightTime}</dd>
            </div>
          </dl>
          <div className="tdh-pass-perf" aria-hidden />
          <div className="tdh-pass-foot">
            <p>
              <span>From, per person</span>
              <b>{formatInr(tour.priceInr)}</b>
            </p>
            <a href="#book" onClick={toBook} className="tdh-book">
              Choose seats
              <span aria-hidden>
                <ArrowDown size={14} weight="bold" />
              </span>
            </a>
          </div>
        </aside>
      </div>
    </section>
  );
}
