"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Airplane, ArrowUpRight, CalendarPlus, Check, Printer } from "@phosphor-icons/react";
import type { BookingRecord } from "@/lib/types";
import { addDaysIso, formatInr } from "@/lib/format";
import { gsap, MOTION_QUERIES, useGSAP } from "@/lib/gsap";
import { useCurtain } from "./curtain/FlapCurtain";
import { Barcode, passDate, passSeats, seatsFor, shortDate } from "./pass";
import type { BookingTour } from "./bookingData";

function maskEmail(email: string) {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 2)}${"•".repeat(Math.max(2, user.length - 2))}@${domain}`;
}

/** "+91 98140 27715" → "+91 ••••• 7715": enough to recognise, not enough to copy. */
function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return phone;
  return `${phone.trim().slice(0, 3)} ••••• ${digits.slice(-4)}`;
}

/** An all-day calendar entry for the trip, as an .ics file. */
function calendarFile(b: BookingRecord, tour: BookingTour) {
  const ymd = (iso: string) => iso.replace(/-/g, "");
  const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Longitude//Booking//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${b.reference}@longitude`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${ymd(b.travelDate)}`,
    // All-day events end the day after the last one.
    `DTEND;VALUE=DATE:${ymd(addDaysIso(b.travelDate, b.durationDays))}`,
    `SUMMARY:${esc(`${tour.flight} · ${b.packageName}, ${b.destinationName}`)}`,
    `DESCRIPTION:${esc(`Longitude booking ${b.reference}. ${b.travelers} ${b.travelers === 1 ? "traveller" : "travellers"}, ${tour.hotel.name}.`)}`,
    `LOCATION:${esc(`${b.destinationName}, ${tour.to.country}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/**
 * The booking, issued. Arriving straight from the booking, the board of flaps
 * the booking page closed into falls away; the reference rolls into place a
 * character at a time and the pass feeds out of the printer slot, line by line.
 */
export function ConfirmationView({ booking, tour }: { booking: BookingRecord; tour: BookingTour }) {
  const curtain = useCurtain();
  const root = useRef<HTMLDivElement>(null);
  // Read once, on arrival: is the curtain down (it opens onto this page by itself)? Then the entrance waits for it.
  const [fromBooking] = useState(() => typeof window !== "undefined" && curtain.isClosed());

  const end = addDaysIso(booking.travelDate, booking.durationDays - 1);
  const first = booking.leadName.trim().split(/\s+/)[0];
  const nights = booking.durationDays - 1;
  const status = booking.status === "CONFIRMED" ? "Confirmed" : booking.status === "PENDING" ? "Pending" : "Cancelled";

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_QUERIES, (ctx) => {
        if (!ctx.conditions?.full) return;
        const el = root.current!;
        const tl = gsap.timeline({ delay: fromBooking ? 0.55 : 0.1, defaults: { ease: "expo.out" } });
        tl.from(el.querySelectorAll(".ntc-line > span"), { yPercent: 110, duration: 1.25, stagger: 0.09 }, 0)
          .from(el.querySelectorAll("[data-in]"), { y: 22, opacity: 0, duration: 1.1, stagger: 0.06 }, 0.1)
          .from(el.querySelectorAll(".ntc-ref > span > span"), { yPercent: 115, duration: 0.9, stagger: 0.045 }, 0.3)
          .from(el.querySelectorAll(".ntc-board-rows .nt-cell > span"), { yPercent: 115, duration: 0.8, stagger: 0.08 }, 0.75)
          // The pass feeds out of the slot: down in short steps, like paper through rollers.
          .fromTo(el.querySelector(".ntc-pass"), { yPercent: -100 }, { yPercent: 0, duration: 1.9, ease: "steps(14)" }, 0.45)
          .from(el.querySelectorAll(".ntc-next li"), { y: 18, opacity: 0, duration: 0.9, stagger: 0.08 }, 1.1);
      });
    },
    { scope: root },
  );

  const download = () => {
    const blob = new Blob([calendarFile(booking, tour)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${booking.reference}.ics`;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div ref={root} className="ntc">
      <div className="ntc-hero">
        <div>
          <p className="ntc-kicker" data-in>
            <i aria-hidden>
              <Check size={11} weight="bold" />
            </i>
            Checked in · {tour.flight}
          </p>
          <h1 className="ntc-title">
            <span className="ntc-line">
              <span>See you in</span>
            </span>
            <span className="ntc-line">
              <span>
                <em>{booking.destinationName}</em>, {first}.
              </span>
            </span>
          </h1>
          <p className="ntc-lead" data-in>
            Your seats are held under the reference below. A planner will call you on <span className="ntc-mono">{maskPhone(booking.phone)}</span> within
            one working day to confirm rooms and take the deposit. Nothing has been charged. Booked under {maskEmail(booking.email)}.
          </p>
        </div>

        {/* A small board of its own: the reference, and how the booking stands. */}
        <div className="ntc-board" data-in>
          <p className="nt-k">Booking reference</p>
          <p className="ntc-ref" aria-label={booking.reference}>
            {[...booking.reference].map((ch, i) => (
              <span key={i} aria-hidden>
                <span>{ch}</span>
              </span>
            ))}
          </p>
          <dl className="ntc-board-rows">
            <div>
              <dt className="nt-k">Flight</dt>
              <dd>
                <span className="nt-cell">
                  <span>{tour.flight}</span>
                </span>
              </dd>
            </div>
            <div>
              <dt className="nt-k">To</dt>
              <dd>
                <span className="nt-cell">
                  <span>{tour.to.code}</span>
                </span>
              </dd>
            </div>
            <div>
              <dt className="nt-k">Status</dt>
              <dd className="ntc-board-status">
                <span className="nt-cell">
                  <span>{status}</span>
                </span>
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* The printer: a slot, and the pass feeding out of it. */}
      <div className="ntc-printer">
        <div className="ntc-slot" aria-hidden />
        <div className="ntc-feed">
          <article className="ntc-pass" aria-label="Your boarding pass">
            <div className="ntc-pass-main">
              <p className="ntc-pass-head">
                <span>Longitude · Boarding pass</span>
                <b>{tour.flight}</b>
              </p>
              <div className="ntc-route">
                <p>
                  <b>{tour.from.code}</b>
                  <small>{tour.from.name}</small>
                </p>
                <span className="ntc-route-line" aria-hidden>
                  <Airplane size={17} weight="fill" />
                </span>
                <p>
                  <b>{tour.to.code}</b>
                  <small>{booking.destinationName}</small>
                </p>
              </div>
              <dl className="ntc-facts">
                <div className="ntc-wide">
                  <dt>Passenger</dt>
                  <dd className="ntc-name">{booking.leadName.toUpperCase()}</dd>
                </div>
                <div className="ntc-wide">
                  <dt>Tour</dt>
                  <dd>{booking.packageName}</dd>
                </div>
                <div>
                  <dt>Departs</dt>
                  <dd>{passDate(booking.travelDate)}</dd>
                </div>
                <div>
                  <dt>Returns</dt>
                  <dd>{passDate(end)}</dd>
                </div>
                <div>
                  <dt>Stay</dt>
                  <dd>
                    {nights} {nights === 1 ? "night" : "nights"}
                  </dd>
                </div>
                <div>
                  <dt>Seats</dt>
                  <dd aria-label={seatsFor(booking.travelers)}>{passSeats(booking.travelers)}</dd>
                </div>
                <div className="ntc-wide">
                  <dt>Hotel</dt>
                  <dd>{tour.hotel.name}</dd>
                </div>
              </dl>
            </div>
            <div className="ntc-stub">
              <p className="ntc-status" data-status={booking.status}>
                <i aria-hidden />
                {status}
              </p>
              <dl className="ntc-fare">
                <div>
                  <dt>
                    {booking.travelers} × {formatInr(booking.unitPriceInr)}
                  </dt>
                  <dd>{formatInr(booking.unitPriceInr * booking.travelers)}</dd>
                </div>
                <div>
                  <dt>GST 5%</dt>
                  <dd>{formatInr(booking.taxesInr)}</dd>
                </div>
                <div className="ntc-total">
                  <dt>Total</dt>
                  <dd>{formatInr(booking.totalInr)}</dd>
                </div>
              </dl>
              <Barcode seed={booking.reference} className="ntc-barcode" />
              <p className="ntc-stub-code" aria-hidden>
                {booking.reference} · {booking.travelDate.replace(/-/g, "")}
              </p>
            </div>
          </article>
        </div>
      </div>

      <div className="ntc-actions" data-in>
        <button type="button" className="ntc-btn ntc-btn-main" onClick={download}>
          <CalendarPlus size={16} aria-hidden /> Add to calendar
        </button>
        <button type="button" className="ntc-btn" onClick={() => window.print()}>
          <Printer size={16} aria-hidden /> Print pass
        </button>
        <Link href="/account" className="ntc-btn">
          View in profile <ArrowUpRight size={14} aria-hidden />
        </Link>
        <Link href="/tours" className="ntc-btn">
          Browse more tours <ArrowUpRight size={14} aria-hidden />
        </Link>
      </div>

      <section className="ntc-next" aria-labelledby="ntc-next-title">
        <h2 id="ntc-next-title" data-in>
          What happens now
        </h2>
        <ol>
          <li>
            <span>01</span>
            <p>
              <b>A planner calls you</b> within one working day to go through the trip and confirm rooms at {tour.hotel.name}.
            </p>
          </li>
          <li>
            <span>02</span>
            <p>
              <b>You pay a deposit</b> to hold everything. Nothing is charged online.
            </p>
          </li>
          <li>
            <span>03</span>
            <p>
              <b>You fly {shortDate(booking.travelDate)}.</b> Keep {booking.reference} handy; it finds this booking from your profile or the account page.
            </p>
          </li>
        </ol>
      </section>
    </div>
  );
}
