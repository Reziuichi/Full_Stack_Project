"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Airplane, ArrowRight, ArrowUpRight, Globe, Minus, Plus } from "@phosphor-icons/react";
import { formatInr, priceBreakdown } from "@/lib/format";
import { gsap, MOTION_QUERIES, useGSAP } from "@/lib/gsap";
import { thumb, type TourPageData } from "../tourData";

const MAX_SEATS = 12;

/** A fare that rolls to its new value instead of jumping. */
function Fare({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [first] = useState(value);
  const shown = useRef(value);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || shown.current === value) return;
    const st = { v: shown.current };
    shown.current = value;
    const tw = gsap.to(st, {
      v: value,
      duration: window.matchMedia(MOTION_QUERIES.reduce).matches ? 0 : 0.7,
      ease: "power3.out",
      onUpdate: () => void (el.textContent = formatInr(Math.round(st.v))),
    });
    return () => void tw.kill();
  }, [value]);
  return <span ref={ref}>{formatInr(first)}</span>;
}

/**
 * Final call: a boarding pass in the city's colours. Pick seats on the
 * cabin map (or with the stepper); the fare, the GST and the total roll to
 * the new figures, and the stub books exactly that many seats.
 */
export function TourBook({ tour }: { tour: TourPageData }) {
  const root = useRef<HTMLElement>(null);
  const [seats, setSeats] = useState(2);
  const [hover, setHover] = useState<number | null>(null);
  const fare = priceBreakdown(tour.priceInr, seats);
  const lit = hover ?? seats;

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_QUERIES, (context) => {
        const full = Boolean(context.conditions?.full);
        const el = root.current!;
        gsap.fromTo(el.querySelectorAll("[data-a=fade]"), { autoAlpha: 0, y: full ? 24 : 0 }, { autoAlpha: 1, y: 0, duration: 1, ease: "power3.out", stagger: 0.07, scrollTrigger: { trigger: el, start: "top 75%", once: true } });
        if (full) gsap.fromTo(el.querySelector(".tbk-pass"), { autoAlpha: 0, y: 90, rotation: 2.5 }, { autoAlpha: 1, y: 0, rotation: 0, duration: 1.4, ease: "expo.out", scrollTrigger: { trigger: el, start: "top 70%", once: true } });
      });
    },
    { scope: root },
  );

  return (
    <section id="book" ref={root} className="tbk" aria-labelledby="book-title">
      <div className="tbk-inner">
        <p data-a="fade" className="tbk-kicker">
          <i aria-hidden />
          Final call
        </p>
        <h2 data-a="fade" id="book-title" className="tbk-title">
          Now boarding <em>{tour.flight}.</em>
        </h2>

        <div className="tbk-pass">
          <div className="tbk-main">
            <p className="tbk-airline">
              <Globe size={16} weight="bold" aria-hidden /> Longitude · orbital travel desk
            </p>
            <div className="tbk-route">
              <p>
                <b>IXC</b>
                <small>Chandigarh</small>
              </p>
              <span className="tbk-line" aria-hidden>
                <Airplane size={18} weight="fill" />
              </span>
              <p>
                <b>{tour.city.code}</b>
                <small>{tour.city.name}</small>
              </p>
            </div>
            <dl className="tbk-facts">
              <div>
                <dt>Tour</dt>
                <dd>{tour.name}</dd>
              </div>
              <div>
                <dt>Days</dt>
                <dd>{tour.durationDays}</dd>
              </div>
              <div>
                <dt>Pace</dt>
                <dd>{tour.pace}</dd>
              </div>
              <div>
                <dt>Hotel</dt>
                <dd>{tour.hotel.name}</dd>
              </div>
            </dl>

            <div className="tbk-seats">
              <div className="tbk-seats-head">
                <p>Travellers</p>
                <div className="tbk-stepper">
                  <button type="button" onClick={() => setSeats((s) => Math.max(1, s - 1))} disabled={seats <= 1} aria-label="One traveller fewer">
                    <Minus size={14} weight="bold" />
                  </button>
                  <output aria-live="polite">{seats}</output>
                  <button type="button" onClick={() => setSeats((s) => Math.min(MAX_SEATS, s + 1))} disabled={seats >= MAX_SEATS} aria-label="One traveller more">
                    <Plus size={14} weight="bold" />
                  </button>
                </div>
              </div>
              <div className="tbk-cabin" role="group" aria-label="Pick seats" onPointerLeave={() => setHover(null)}>
                {Array.from({ length: MAX_SEATS }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    className="tbk-seat"
                    data-on={i < lit || undefined}
                    data-hover={hover !== null || undefined}
                    style={{ transitionDelay: `${(i % 6) * 18}ms` }}
                    onPointerEnter={(e) => e.pointerType === "mouse" && setHover(i + 1)}
                    onClick={() => setSeats(i + 1)}
                    aria-label={`${i + 1} ${i ? "travellers" : "traveller"}`}
                    aria-pressed={i < seats}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="tbk-stub">
            <dl className="tbk-fare">
              <div>
                <dt>
                  {seats} × {formatInr(tour.priceInr)}
                </dt>
                <dd>
                  <Fare value={fare.subtotal} />
                </dd>
              </div>
              <div>
                <dt>GST, 5%</dt>
                <dd>
                  <Fare value={fare.taxes} />
                </dd>
              </div>
              <div className="tbk-total">
                <dt>Total</dt>
                <dd>
                  <Fare value={fare.total} />
                </dd>
              </div>
            </dl>
            <Link href={`/book/${tour.slug}?travelers=${seats}`} className="tbk-cta">
              Book {seats} {seats === 1 ? "seat" : "seats"}
              <span aria-hidden>
                <ArrowUpRight size={15} weight="bold" />
              </span>
            </Link>
            <span className="tbk-barcode" aria-hidden />
            <p className="tbk-fine">Free cancellation up to 30 days before departure</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The next tour on the route, as a banner that boards straight into it. */
export function TourNext({ next }: { next: NonNullable<TourPageData["next"]> }) {
  const hero = thumb(next.image, 1280);
  return (
    <section className="tnx" data-tour-card aria-label="Next departure">
      <Link href={`/tours/${next.slug}`} className="tnx-link" data-tour-photo={hero} data-tour-flight={`${next.flight} · IXC → ${next.code}`} data-tour-name={next.name}>
        <span className="tnx-photo" data-tour-frame>
          {/* eslint-disable-next-line @next/next/no-img-element -- the boarding transition opens from this photo */}
          <img src={thumb(next.image, 960)} alt="" data-on="" loading="lazy" decoding="async" />
        </span>
        <span className="tnx-shade" aria-hidden />
        <span className="tnx-copy">
          <span className="tnx-kicker">
            <i aria-hidden />
            Next departure · {next.flight} · IXC → {next.code}
          </span>
          <span className="tnx-name">{next.name}</span>
          <span className="tnx-meta">
            {next.cityName} · {next.days} days
            <span className="tnx-arrow" aria-hidden>
              <ArrowRight size={22} weight="light" />
            </span>
          </span>
        </span>
      </Link>
    </section>
  );
}

/**
 * A slim bar that rises once the hero is behind you and steps aside when
 * the final call is on screen (and while the prints take the stage): the
 * tour, the fare and a way to the seats.
 */
export function TourBar({ tour }: { tour: TourPageData }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const hero = document.querySelector(".tdh");
    const book = document.getElementById("book");
    const deck = document.querySelector(".tdk-stage");
    let past = false;
    let atBook = false;
    let atDeck = false;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.target === hero) past = !e.isIntersecting && e.boundingClientRect.top < 0;
          if (e.target === book) atBook = e.isIntersecting;
          if (e.target === deck) atDeck = e.intersectionRatio > 0.55;
        }
        setShown(past && !atBook && !atDeck);
      },
      { threshold: [0, 0.55] },
    );
    for (const el of [hero, book, deck]) if (el) io.observe(el);
    return () => io.disconnect();
  }, []);
  const toBook = (e: React.MouseEvent) => {
    const book = document.getElementById("book");
    if (!book) return;
    e.preventDefault();
    gsap.to(window, { scrollTo: { y: book, offsetY: 40 }, duration: window.matchMedia(MOTION_QUERIES.reduce).matches ? 0 : 1.2, ease: "power3.inOut" });
  };
  return (
    <div className="tbar" data-on={shown || undefined} inert={!shown}>
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny remote thumbnail */}
      <img src={thumb(tour.images[0], 330)} alt="" />
      <p>
        <b>{tour.name}</b>
        <span>
          {tour.flight} · {tour.durationDays} days · from {formatInr(tour.priceInr)}
        </span>
      </p>
      <a href="#book" onClick={toBook} className="tbar-cta">
        Choose seats
      </a>
    </div>
  );
}
