"use client";

import Link from "next/link";
import { useRef } from "react";
import { Airplane, ArrowRight, Bed, ChatsCircle, Compass, Ticket } from "@phosphor-icons/react";
import { gsap, MOTION_QUERIES, useGSAP } from "@/lib/gsap";

const PROMISES = [
  { icon: Bed, title: "The hotel, named", body: "You know where you sleep before you pay: the hotel, its street and its room type." },
  { icon: Ticket, title: "Tickets in hand", body: "Entry for every listed attraction is booked, timed and in the trip pack." },
  { icon: Compass, title: "A local guide", body: "English-speaking guides on every sightseeing day, people we know by name." },
  { icon: ChatsCircle, title: "A desk that answers", body: "Chandigarh, around the clock on WhatsApp, from the airport to the flight home." },
];

/** A flight that has not been planned yet: from our desk to wherever you are. */
function FlightArc() {
  const d = "M44 316 C 150 70, 360 36, 486 178";
  return (
    <svg className="ta-arc" viewBox="0 0 540 380" aria-hidden>
      <path d={d} className="ta-arc-track" />
      <path d={d} className="ta-arc-line" />
      <circle cx="44" cy="316" r="5" className="ta-arc-home" />
      <text x="44" y="350" textAnchor="middle">
        IXC
      </text>
      <circle cx="486" cy="178" r="6" className="ta-arc-end" />
      <circle cx="486" cy="178" r="6" className="ta-arc-ping" />
      <text x="486" y="214" textAnchor="middle">
        YOU?
      </text>
      <g className="ta-arc-plane">
        <g transform="rotate(90)">
          <Airplane x={-11} y={-11} width={22} height={22} weight="fill" />
        </g>
        <animateMotion dur="5.2s" repeatCount="indefinite" rotate="auto" calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines="0.45 0 0.25 1">
          <mpath href="#ta-arc-path" />
        </animateMotion>
      </g>
      <path id="ta-arc-path" d={d} fill="none" stroke="none" />
    </svg>
  );
}

/** Arrivals: what every tour includes, then the way out to the globe. */
export function ToursArrivals() {
  const root = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_QUERIES, (context) => {
        const full = Boolean(context.conditions?.full);
        const el = root.current!;
        gsap.fromTo(el.querySelectorAll(".ta-item"), { autoAlpha: 0, y: full ? 30 : 0 }, { autoAlpha: 1, y: 0, duration: 1, ease: "power3.out", stagger: 0.09, scrollTrigger: { trigger: el, start: "top 78%", once: true } });
        gsap.fromTo(el.querySelectorAll("[data-a=line]"), { yPercent: full ? 110 : 0, autoAlpha: full ? 1 : 0 }, { yPercent: 0, autoAlpha: 1, duration: 1.3, ease: "expo.out", stagger: 0.1, scrollTrigger: { trigger: el.querySelector(".ta-cta"), start: "top 80%", once: true } });
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} className="ta" aria-labelledby="ta-title">
      <div className="ta-inner">
        <h2 id="ta-title" className="sr-only">
          What every tour includes
        </h2>
        <ul className="ta-grid">
          {PROMISES.map(({ icon: Icon, title, body }) => (
            <li key={title} className="ta-item">
              <span className="ta-icon" aria-hidden>
                <Icon size={22} weight="light" />
              </span>
              <p className="ta-item-title">{title}</p>
              <p className="ta-item-body">{body}</p>
            </li>
          ))}
        </ul>

        <div className="ta-cta">
          <FlightArc />
          <p className="ta-kicker">Not on the board?</p>
          <Link href="/#explore" className="ta-link">
            <span className="ta-mask">
              <span data-a="line" className="block">
                Plot it on
              </span>
            </span>
            <span className="ta-mask">
              <span data-a="line" className="block">
                the <em>globe</em>
                <ArrowRight className="ta-arrow" weight="light" aria-hidden />
              </span>
            </span>
          </Link>
          <p className="ta-note">Search any place on the live Earth; we plan the days, the hotels and the tickets with you.</p>
        </div>
      </div>
    </section>
  );
}
