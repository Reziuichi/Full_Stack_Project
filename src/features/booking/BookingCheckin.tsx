"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Airplane, ArrowDown, ArrowLeft, ArrowUpRight, Check, Minus, Plus, WarningCircle } from "@phosphor-icons/react";
import { addDaysIso, formatInr, priceBreakdown } from "@/lib/format";
import { BOOKING_LIMITS, checkBookingField, earliestDeparture, type BookingField } from "@/lib/bookingRules";
import { gsap, MOTION_QUERIES, useGSAP } from "@/lib/gsap";
import { Photo } from "@/components/ui/Photo";
import { thumb } from "@/features/tours/tourData";
import { useCurtain } from "./curtain/FlapCurtain";
import { TypedInput } from "./TypedInput";
import { DepartureCalendar } from "./DepartureCalendar";
import { Barcode, Fare, passDate, passSeats, seatsFor, shortDate, Swap, useClock, usePassTilt } from "./pass";
import type { BookingTour } from "./bookingData";

type Draft = {
  leadName: string;
  email: string;
  phone: string;
  originCity: string;
  notes: string;
  requests: string[];
  travelers: number;
  travelDate: string;
};

const REQUESTS = ["Vegetarian meals", "Step-free access", "Twin beds", "Late check-in", "Celebrating something"];
const FIELD_ORDER: BookingField[] = ["leadName", "email", "phone", "originCity", "travelDate", "travelers", "notes"];
const FIELD_LABEL: Record<BookingField, string> = {
  leadName: "Full name",
  email: "Email",
  phone: "Mobile number",
  originCity: "Travelling from",
  travelDate: "Departure date",
  travelers: "Travellers",
  notes: "Requests",
};
const HOME_ZONE = "Asia/Kolkata";

const draftKey = (slug: string) => `lgt:booking-draft:${slug}`;
const TEXT_FIELDS = ["leadName", "email", "phone", "originCity", "notes"] as const;
function readDraft(slug: string) {
  try {
    return sessionStorage.getItem(draftKey(slug));
  } catch {
    return null;
  }
}

/** The destination's UTC offset on the departure day, e.g. "GMT−5" (summer time included). */
function zoneOffset(timezone: string, iso: string) {
  try {
    const [y, m, d] = iso.split("-").map(Number);
    const name = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, timeZoneName: "shortOffset" })
      .formatToParts(new Date(Date.UTC(y, m - 1, d, 12)))
      .find((p) => p.type === "timeZoneName")?.value;
    return (name ?? timezone).replace("-", "−");
  } catch {
    return timezone;
  }
}

function composeNotes(requests: string[], notes: string) {
  return [requests.join(", "), notes.trim()].filter(Boolean).join("\n");
}

/**
 * The booking page, as a night terminal: the departures board with this tour's
 * flight checking in, then the check-in itself on the left and the boarding
 * pass on the right, which fills in with whatever is typed. Confirming sends
 * the booking, and the screen closes into a board of flaps that opens again
 * on the confirmation.
 */
export function BookingCheckin({
  tour,
  prefill,
  signedInAs,
}: {
  tour: BookingTour;
  prefill: { name?: string; email?: string; travelers?: number };
  signedInAs: string | null;
}) {
  const router = useRouter();
  const curtain = useCurtain();
  const root = useRef<HTMLDivElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const passRef = usePassTilt();
  const ctaRef = useRef<HTMLButtonElement>(null);

  const min = earliestDeparture();
  const max = addDaysIso(min, 540);
  const [f, setF] = useState<Draft>(() => ({
    leadName: prefill.name ?? "",
    email: prefill.email ?? "",
    phone: "",
    originCity: "",
    notes: "",
    requests: [],
    travelers: prefill.travelers ?? 2,
    travelDate: addDaysIso(min, 27),
  }));
  const [touched, setTouched] = useState<Partial<Record<BookingField, boolean>>>({});
  const [attempted, setAttempted] = useState(false);
  const [server, setServer] = useState<Partial<Record<BookingField | "form", string>>>({});
  const [phase, setPhase] = useState<"idle" | "sending" | "done">("idle");
  const [barVisible, setBarVisible] = useState(false);
  // Each failed attempt moves focus to the list of what to fix, once it's on the page.
  const [alertTick, setAlertTick] = useState(0);
  useEffect(() => {
    if (alertTick) alertRef.current?.focus();
  }, [alertTick]);

  // ── On arrival: the saved draft (a reload, or a trip back from the tour
  // page), then anything typed before the page finished loading (React leaves
  // it in the fields while hydrating, but it isn't in state yet). Read once,
  // straight after hydration and before the first save, so a draft this page
  // wrote itself is never mistaken for one to restore. ─────────────────────
  useLayoutEffect(() => {
    const raw = readDraft(tour.slug);
    const typed: Partial<Draft> = {};
    for (const id of TEXT_FIELDS) {
      const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
      if (el?.value) typed[id] = el.value;
    }
    if (!raw && !Object.keys(typed).length) return;
    queueMicrotask(() =>
      setF((cur) => {
        let next = cur;
        if (raw) {
          try {
            const d = JSON.parse(raw) as Partial<Draft>;
            next = {
              ...next,
              ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== "" && v !== undefined && v !== null)),
              // A seat count chosen on the tour page wins over an older draft.
              travelers: prefill.travelers ?? d.travelers ?? next.travelers,
              // An old draft's date may have run out of notice.
              travelDate: d.travelDate && d.travelDate >= min && d.travelDate <= max ? d.travelDate : next.travelDate,
            };
          } catch {
            /* a damaged draft: start fresh */
          }
        }
        return { ...next, ...typed };
      }),
    );
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (phase !== "idle") return;
    const t = window.setTimeout(() => {
      try {
        sessionStorage.setItem(draftKey(tour.slug), JSON.stringify(f));
      } catch {
        /* full or blocked: the draft is a convenience */
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [f, tour.slug, phase]);

  // ── Validation ──────────────────────────────────────────────────────────
  const notes = composeNotes(f.requests, f.notes);
  const valueOf = useCallback(
    (field: BookingField): string | number => (field === "notes" ? composeNotes(f.requests, f.notes) : field === "travelers" ? f.travelers : f[field]),
    [f],
  );
  const problems = useMemo(() => {
    const out: Partial<Record<BookingField, string>> = {};
    for (const field of FIELD_ORDER) {
      const p = checkBookingField(field, valueOf(field));
      if (p) out[field] = p;
    }
    return out;
  }, [valueOf]);
  const errorFor = (field: BookingField) => server[field] ?? (attempted || touched[field] ? problems[field] : undefined);
  const shownErrors = FIELD_ORDER.filter((field) => errorFor(field));
  const checks = [
    { key: "leadName", label: "Name", ok: !problems.leadName },
    { key: "email", label: "Email", ok: !problems.email },
    { key: "phone", label: "Phone", ok: !problems.phone },
    { key: "travelDate", label: "Date", ok: !problems.travelDate },
  ];
  const done = checks.filter((c) => c.ok).length;

  // Stable handlers, so a keystroke re-renders only the field it lands in (and the pass), not every field.
  const set = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setF((cur) => ({ ...cur, [key]: value }));
    setServer((s) => {
      if (!(key in s)) return s;
      const next = { ...s };
      delete next[key as BookingField];
      return next;
    });
  }, []);
  const blur = useCallback((field: BookingField) => setTouched((t) => (t[field] ? t : { ...t, [field]: true })), []);
  const onText = useMemo(
    () => ({
      leadName: (v: string) => set("leadName", v),
      email: (v: string) => set("email", v),
      phone: (v: string) => set("phone", v),
      originCity: (v: string) => set("originCity", v),
    }),
    [set],
  );
  const offText = useMemo(
    () => ({
      leadName: () => blur("leadName"),
      email: () => blur("email"),
      phone: () => blur("phone"),
      originCity: () => blur("originCity"),
    }),
    [blur],
  );
  const onDate = useCallback(
    (d: string) => {
      set("travelDate", d);
      blur("travelDate");
    },
    [set, blur],
  );

  const price = priceBreakdown(tour.priceInr, f.travelers);
  const endDate = addDaysIso(f.travelDate, tour.durationDays - 1);
  const nights = tour.durationDays - 1;
  const city = tour.to.name;
  const zone = useMemo(() => zoneOffset(tour.to.timezone, f.travelDate), [tour.to.timezone, f.travelDate]);

  // ── Motion: the title and the words around the board arrive, then the board's rows roll in. ──
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_QUERIES, (ctx) => {
        if (!ctx.conditions?.full) return;
        const el = root.current!;
        // Opacity only (never visibility), so nothing is unfocusable or hidden from screen readers while it waits.
        const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
        tl.from(el.querySelectorAll(".nt-line > span"), { yPercent: 110, duration: 1.3, stagger: 0.09 }, 0.1)
          .from(el.querySelectorAll(".nt-hero [data-in]"), { y: 22, opacity: 0, duration: 1.1, stagger: 0.06 }, 0.2)
          .from(el.querySelector(".nt-board"), { y: 40, opacity: 0, scale: 0.985, duration: 1.4 }, 0.3)
          // Row by row, each cell's text rises out of its own line, as a board refreshing.
          .from(el.querySelectorAll(".nt-table .nt-cell > span"), { yPercent: 115, duration: 0.85, stagger: 0.022 }, 0.7);
        // Each step's heading and note rise in as it scrolls into view. Only those: animating a whole step would
        // lift it onto a layer of its own and back, repainting all its fields twice in the middle of the scroll.
        el.querySelectorAll<HTMLElement>(".nt-step").forEach((step) => {
          gsap.from(step.querySelectorAll("legend, .nt-step-note"), { y: 24, opacity: 0, duration: 0.9, stagger: 0.08, ease: "power3.out", scrollTrigger: { trigger: step, start: "top 88%", once: true } });
        });
        gsap.from(el.querySelector(".nt-pass"), { y: 56, opacity: 0, duration: 1.3, ease: "expo.out", scrollTrigger: { trigger: el.querySelector(".nt-grid"), start: "top 80%", once: true } });
      });
    },
    { scope: root },
  );

  // The bar at the foot of small screens, while the pass's own button is out of view.
  useEffect(() => {
    const cta = ctaRef.current;
    const form = root.current?.querySelector(".nt-form");
    if (!cta || !form) return;
    let ctaOn = false;
    let inForm = false;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.target === cta) ctaOn = e.isIntersecting;
        else inForm = e.isIntersecting;
      }
      setBarVisible(inForm && !ctaOn);
    });
    io.observe(cta);
    io.observe(form);
    return () => io.disconnect();
  }, []);

  // ── Submit: send, then close the screen into a board of flaps. ──────────
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (phase !== "idle") return;
    setAttempted(true);
    if (Object.keys(problems).length) {
      setAlertTick((t) => t + 1);
      return;
    }
    const button = (e.nativeEvent as SubmitEvent).submitter ?? ctaRef.current;
    const r = button?.getBoundingClientRect();
    const origin = r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: innerWidth / 2, y: innerHeight / 2 };
    setPhase("sending");
    setServer({});
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageSlug: tour.slug,
          leadName: f.leadName.trim(),
          email: f.email.trim(),
          phone: f.phone.trim(),
          travelers: f.travelers,
          travelDate: f.travelDate,
          originCity: f.originCity.trim(),
          notes,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.booking?.reference) {
        setServer({ ...(json.error?.fields ?? {}), form: json.error?.message ?? "The booking didn't go through. Please try again." });
        setPhase("idle");
        setAlertTick((t) => t + 1);
        return;
      }
      try {
        sessionStorage.removeItem(draftKey(tour.slug));
      } catch {
        /* nothing to clear */
      }
      const reference = json.booking.reference as string;
      const href = `/book/confirmation/${reference}`;
      setPhase("done");
      router.prefetch(href);
      await curtain.close(origin, [`${tour.flight} · CHECKED IN`, reference]);
      router.push(href);
    } catch {
      setServer({ form: "Network error — check your connection and try again." });
      setPhase("idle");
      setAlertTick((t) => t + 1);
    }
  }

  const err = (field: BookingField) => errorFor(field);
  // The error replaces the hint under a field, so it describes the field instead.
  const describe = (field: BookingField, hint?: boolean) => (err(field) ? `${field}-error` : hint ? `${field}-hint` : undefined);
  const ok = (field: BookingField) => !problems[field] && !server[field] && (touched[field] || attempted);
  const ctaLabel = phase === "sending" ? "Printing your pass…" : phase === "done" ? "Checked in" : "Confirm booking";

  return (
    <div ref={root} className="nt-page" data-phase={phase}>
      <DeparturesHero tour={tour} city={city} nights={nights} signedInAs={signedInAs} />

      {/* ── Check-in ─────────────────────────────────────────────────────── */}
      <form id="manifest" className="nt-form" onSubmit={onSubmit} noValidate aria-labelledby="nt-form-title">
        <header className="nt-form-head">
          <p className="nt-eyebrow">
            {tour.flight} · {tour.from.code} → {tour.to.code}
          </p>
          <h2 id="nt-form-title">Check in</h2>
          <p className="nt-progress" aria-live="polite">
            Pre-flight <b>{done}</b> / {checks.length}
          </p>
          <span className="nt-progress-bar" aria-hidden>
            <i style={{ transform: `scaleX(${done / checks.length})` }} />
          </span>
        </header>

        {(server.form || (attempted && shownErrors.length > 0)) && (
          <div ref={alertRef} className="nt-alert" role="alert" tabIndex={-1}>
            <WarningCircle size={18} weight="fill" aria-hidden />
            <div>
              <p>
                {server.form && !shownErrors.length
                  ? server.form
                  : `${shownErrors.length === 1 ? "One detail" : `${shownErrors.length} details`} to fix before boarding`}
              </p>
              {shownErrors.length > 0 && (
                <ul>
                  {shownErrors.map((field) => (
                    <li key={field}>
                      <a
                        href={`#${field === "travelDate" ? "nt-date-label" : field}`}
                        onClick={(e) => {
                          e.preventDefault();
                          const target = field === "travelDate" ? root.current?.querySelector<HTMLElement>(".bk-day[tabindex='0']") : document.getElementById(field);
                          target?.focus();
                          target?.scrollIntoView({ block: "center", behavior: matchMedia(MOTION_QUERIES.reduce).matches ? "auto" : "smooth" });
                        }}
                      >
                        {FIELD_LABEL[field]}: {err(field)}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <div className="nt-grid">
          <div className="nt-steps">
            {/* 01 — Lead traveller */}
            <fieldset className="nt-step" data-done={(!problems.leadName && !problems.email && !problems.phone) || undefined}>
              <legend>
                <span className="nt-step-no">01</span>
                <span className="nt-step-title">Lead traveller</span>
              </legend>
              <p className="nt-step-note">As on the passport. We&apos;ll call this number to confirm rooms.</p>
              <div className="nt-fields">
                <Field id="leadName" label="Full name" error={err("leadName")} ok={ok("leadName")}>
                  <TypedInput
                    id="leadName"
                    name="leadName"
                    autoComplete="name"
                    value={f.leadName}
                    maxLength={BOOKING_LIMITS.nameMax}
                    onValue={onText.leadName}
                    onBlur={offText.leadName}
                    aria-invalid={!!err("leadName") || undefined}
                    aria-describedby={describe("leadName")}
                    required
                  />
                </Field>
                <div className="nt-pair">
                  <Field id="email" label="Email" hint="For your booking reference." error={err("email")} ok={ok("email")}>
                    <TypedInput
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      spellCheck={false}
                      value={f.email}
                      maxLength={BOOKING_LIMITS.emailMax}
                      onValue={onText.email}
                      onBlur={offText.email}
                      aria-invalid={!!err("email") || undefined}
                      aria-describedby={describe("email", true)}
                      required
                    />
                  </Field>
                  <Field id="phone" label="Mobile number" hint="With country code, e.g. +91 98140 27715" error={err("phone")} ok={ok("phone")}>
                    <TypedInput
                      id="phone"
                      name="phone"
                      type="tel"
                      autoComplete="tel"
                      inputMode="tel"
                      placeholder="+91"
                      value={f.phone}
                      maxLength={20}
                      onValue={onText.phone}
                      onBlur={offText.phone}
                      aria-invalid={!!err("phone") || undefined}
                      aria-describedby={describe("phone", true)}
                      required
                    />
                  </Field>
                </div>
                <Field id="originCity" label="Travelling from" optional error={err("originCity")}>
                  <TypedInput
                    id="originCity"
                    name="originCity"
                    autoComplete="address-level2"
                    placeholder={tour.from.name}
                    value={f.originCity}
                    maxLength={BOOKING_LIMITS.originMax}
                    onValue={onText.originCity}
                    onBlur={offText.originCity}
                    aria-invalid={!!err("originCity") || undefined}
                    aria-describedby={describe("originCity")}
                  />
                </Field>
              </div>
            </fieldset>

            {/* 02 — Departure */}
            <fieldset className="nt-step" data-done={!problems.travelDate || undefined}>
              <legend>
                <span className="nt-step-no">02</span>
                <span className="nt-step-title" id="nt-date-label">
                  Departure
                </span>
              </legend>
              <p className="nt-step-note" id="travelDate-hint">
                Pick the day you fly. Departures need {BOOKING_LIMITS.noticeDays} days&apos; notice; the whole trip lights up.
              </p>
              <div className="nt-when">
                <DepartureCalendar
                  value={f.travelDate}
                  onChange={onDate}
                  min={min}
                  max={max}
                  days={tour.durationDays}
                  labelledBy="nt-date-label"
                  describedBy={describe("travelDate", true)}
                  invalid={!!err("travelDate")}
                />
                <dl className="nt-when-sum" aria-live="polite">
                  <div>
                    <dt>Departs</dt>
                    <dd>{shortDate(f.travelDate)}</dd>
                  </div>
                  <div>
                    <dt>Returns</dt>
                    <dd>{shortDate(endDate)}</dd>
                  </div>
                  <div>
                    <dt>Stay</dt>
                    <dd>
                      {nights} {nights === 1 ? "night" : "nights"}
                    </dd>
                  </div>
                  <div>
                    <dt>Time zone</dt>
                    <dd>{zone}</dd>
                  </div>
                </dl>
              </div>
              {err("travelDate") && (
                <p id="travelDate-error" className="nt-error">
                  <WarningCircle size={13} weight="fill" aria-hidden /> {err("travelDate")}
                </p>
              )}
            </fieldset>

            {/* 03 — Travellers */}
            <fieldset className="nt-step" data-done>
              <legend>
                <span className="nt-step-no">03</span>
                <span className="nt-step-title">Travellers</span>
              </legend>
              <p className="nt-step-note">Up to {BOOKING_LIMITS.travelersMax} on one booking; prices are per person on twin sharing.</p>
              <div className="nt-seats">
                <div className="nt-stepper">
                  <button type="button" onClick={() => set("travelers", Math.max(1, f.travelers - 1))} disabled={f.travelers <= 1} aria-label="One traveller fewer">
                    <Minus size={15} weight="bold" />
                  </button>
                  <output id="travelers" aria-live="polite" aria-label={`${f.travelers} ${f.travelers === 1 ? "traveller" : "travellers"}`}>
                    {String(f.travelers).padStart(2, "0")}
                  </output>
                  <button type="button" onClick={() => set("travelers", Math.min(BOOKING_LIMITS.travelersMax, f.travelers + 1))} disabled={f.travelers >= BOOKING_LIMITS.travelersMax} aria-label="One traveller more">
                    <Plus size={15} weight="bold" />
                  </button>
                </div>
                <div className="nt-cabin" role="group" aria-label="Seats">
                  {Array.from({ length: BOOKING_LIMITS.travelersMax }, (_, i) => (
                    <button
                      key={i}
                      type="button"
                      className="nt-seat"
                      data-on={i < f.travelers || undefined}
                      aria-pressed={i < f.travelers}
                      aria-label={`${i + 1} ${i === 0 ? "traveller" : "travellers"}`}
                      onClick={() => set("travelers", i + 1)}
                    >
                      <span aria-hidden>{`${Math.floor(i / 6) + 1}${"ABCDEF"[i % 6]}`}</span>
                    </button>
                  ))}
                </div>
                <p className="nt-seat-note">
                  Seats <b>{seatsFor(f.travelers)}</b> · {formatInr(tour.priceInr)} each
                </p>
              </div>
            </fieldset>

            {/* 04 — Requests */}
            <fieldset className="nt-step" data-done={f.requests.length > 0 || f.notes.trim().length > 0 || undefined}>
              <legend>
                <span className="nt-step-no">04</span>
                <span className="nt-step-title">Requests</span>
                <span className="nt-optional">Optional</span>
              </legend>
              <p className="nt-step-note">Anything that makes the trip work for you. Your planner reads every word.</p>
              <div className="nt-chips" role="group" aria-label="Quick requests">
                {REQUESTS.map((r) => {
                  const on = f.requests.includes(r);
                  return (
                    <button key={r} type="button" className="nt-chip" aria-pressed={on} onClick={() => set("requests", on ? f.requests.filter((x) => x !== r) : [...f.requests, r])}>
                      <span className="nt-chip-mark" aria-hidden>
                        {on ? <Check size={11} weight="bold" /> : <Plus size={11} weight="bold" />}
                      </span>
                      {r}
                    </button>
                  );
                })}
              </div>
              <Field id="notes" label="Anything else" optional error={err("notes")} counter={`${notes.length} / ${BOOKING_LIMITS.notesMax}`}>
                <textarea
                  id="notes"
                  name="notes"
                  rows={3}
                  className="nt-textarea"
                  value={f.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  onBlur={() => blur("notes")}
                  aria-invalid={!!err("notes") || undefined}
                  aria-describedby={describe("notes")}
                  placeholder="Dietary needs, accessibility, room preferences…"
                />
              </Field>
            </fieldset>
          </div>

          {/* ── The boarding pass, filling in as the form does ─────────────── */}
          <aside className="nt-aside" aria-label="Booking summary">
            <div ref={passRef} className="nt-pass">
              <div className="nt-pass-photo">
                <Photo src={thumb(tour.image, 960)} alt={tour.name} sizes="(min-width: 1024px) 420px, 100vw" priority />
                <span className="nt-pass-shade" aria-hidden />
                <p className="nt-pass-tag">
                  <span>Boarding pass</span>
                  <b>{tour.flight}</b>
                </p>
              </div>
              <div className="nt-pass-body">
                <div className="nt-pass-route">
                  <p>
                    <b>{tour.from.code}</b>
                    <small>{tour.from.name}</small>
                  </p>
                  <span className="nt-pass-line" aria-hidden>
                    <Airplane size={15} weight="fill" />
                  </span>
                  <p>
                    <b>{tour.to.code}</b>
                    <small>{city}</small>
                  </p>
                </div>
                <p className="nt-pass-tour">{tour.name}</p>

                <div className="nt-pass-row nt-pass-name" data-empty={!f.leadName.trim() || undefined}>
                  <span className="nt-k">Passenger</span>
                  <span className="nt-v nt-v-name">{f.leadName.trim() || "Your name"}</span>
                </div>
                <div className="nt-pass-grid">
                  <div className="nt-pass-row">
                    <span className="nt-k">Departs</span>
                    <Swap value={passDate(f.travelDate)} className="nt-v nt-v-mono" />
                  </div>
                  <div className="nt-pass-row">
                    <span className="nt-k">Returns</span>
                    <Swap value={passDate(endDate)} className="nt-v nt-v-mono" />
                  </div>
                  <div className="nt-pass-row">
                    <span className="nt-k">Seats</span>
                    <Swap value={passSeats(f.travelers)} className="nt-v nt-v-mono" />
                  </div>
                  <div className="nt-pass-row">
                    <span className="nt-k">Hotel</span>
                    <span className="nt-v">{tour.hotel.name}</span>
                  </div>
                </div>

                <div className="nt-pass-fare">
                  <p>
                    <span>
                      {f.travelers} × {formatInr(tour.priceInr)}
                    </span>
                    <span>{formatInr(price.subtotal)}</span>
                  </p>
                  <p>
                    <span>GST 5%</span>
                    <span>{formatInr(price.taxes)}</span>
                  </p>
                  <div className="nt-pass-total">
                    <span>Total</span>
                    <b className="nt-total">
                      <Fare value={price.total} />
                    </b>
                  </div>
                </div>

                <ul className="nt-checks" aria-label="Pre-flight checks">
                  {checks.map((c) => (
                    <li key={c.key} data-ok={c.ok || undefined}>
                      <i aria-hidden>{c.ok ? <Check size={10} weight="bold" /> : null}</i>
                      {c.label}
                      <span className="sr-only">{c.ok ? " done" : " to do"}</span>
                    </li>
                  ))}
                </ul>
                <button ref={ctaRef} type="submit" className="nt-cta" disabled={phase !== "idle"} data-ready={done === checks.length || undefined}>
                  <span>{ctaLabel}</span>
                  <span className="nt-cta-icon" aria-hidden>
                    {phase === "done" ? <Check size={16} weight="bold" /> : <ArrowUpRight size={16} weight="bold" />}
                  </span>
                </button>
                <p className="nt-pass-note">No payment is taken online. A planner calls within one working day to confirm and collect a deposit.</p>
              </div>
              <div className="nt-pass-stub" aria-hidden>
                <Barcode seed={`${tour.flight}${f.travelDate}${f.travelers}`} className="nt-barcode" />
                <span>
                  {tour.flight} · {tour.from.code}-{tour.to.code} · {f.travelDate.replace(/-/g, "")}
                </span>
              </div>
              <span className="nt-pass-sheen" aria-hidden />
            </div>
          </aside>
        </div>

        {/* The total and the button, at the foot of small screens. */}
        <div className="nt-bar" data-on={barVisible || undefined} aria-hidden={!barVisible}>
          <p>
            <small>
              Total · {f.travelers} {f.travelers === 1 ? "traveller" : "travellers"}
            </small>
            <b>{formatInr(price.total)}</b>
          </p>
          <button type="submit" className="nt-cta nt-cta-sm" disabled={phase !== "idle"} tabIndex={barVisible ? 0 : -1}>
            <span>{phase === "idle" ? "Confirm" : "Printing…"}</span>
            <span className="nt-cta-icon" aria-hidden>
              <ArrowUpRight size={15} weight="bold" />
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}

/** A cell of the departures board: its text, in a line of its own that it rolls up into. */
function Cell({ children }: { children: React.ReactNode }) {
  return (
    <span className="nt-cell">
      <span>{children}</span>
    </span>
  );
}

/**
 * The top of the page: the title and the departures board. Apart from the
 * form, so typing never re-renders it; only the clock changes it.
 */
const DeparturesHero = memo(function DeparturesHero({ tour, city, nights, signedInAs }: { tour: BookingTour; city: string; nights: number; signedInAs: string | null }) {
  const clock = useClock(HOME_ZONE);
  return (
    <section className="nt-hero" aria-labelledby="nt-title">
      <div className="nt-top">
        <nav aria-label="Breadcrumb" className="nt-crumbs" data-in>
          <Link href={`/tours/${tour.slug}`}>
            <ArrowLeft size={13} aria-hidden /> {tour.name}
          </Link>
        </nav>
        <p className="nt-clock" data-in>
          <span>Chandigarh desk · local time</span>
          <Swap value={clock} className="nt-clock-time" />
        </p>
      </div>

      <div className="nt-head">
        <h1 id="nt-title" className="nt-title">
          <span className="nt-line">
            <span>Book your seat</span>
          </span>
          <span className="nt-line">
            <span>
              to <em>{city}.</em>
            </span>
          </span>
        </h1>
        <div className="nt-intro" data-in>
          <p className="nt-lead">
            {tour.name}: {tour.durationDays} days and {nights} {nights === 1 ? "night" : "nights"} at {tour.hotel.name}. Check in below; nothing is charged
            online.
          </p>
          <p className="nt-who">
            {signedInAs ? (
              <>Signed in as {signedInAs}. This booking will appear in your profile.</>
            ) : (
              <>
                Booking as a guest. <Link href="/account">Sign in</Link> to keep your trips in one place.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="nt-board">
        <div className="nt-board-head">
          <p className="nt-board-title">
            Departures
            <span>Longitude orbital desk · {tour.from.code}</span>
          </p>
          <p className="nt-board-live">
            <i aria-hidden /> Check-in open
          </p>
        </div>
        <table className="nt-table">
          <caption className="sr-only">Departures from the Longitude desk</caption>
          <thead>
            <tr>
              <th scope="col">Flight</th>
              <th scope="col">Destination</th>
              <th scope="col" className="nt-col-days">
                Days
              </th>
              <th scope="col" className="nt-col-fare">
                Fare from
              </th>
              <th scope="col">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {tour.board.map((row, i) => {
              const mine = i === 0;
              return (
                <tr key={row.slug} data-mine={mine || undefined}>
                  <td>
                    <Cell>{row.flight}</Cell>
                  </td>
                  <td className="nt-dest">
                    {mine ? (
                      <Cell>{row.city}</Cell>
                    ) : (
                      <Link href={`/book/${row.slug}`} className="nt-row-link" aria-label={`Book ${row.name}, ${row.city}`}>
                        <Cell>{row.city}</Cell>
                      </Link>
                    )}
                  </td>
                  <td className="nt-col-days">
                    <Cell>{String(row.days).padStart(2, "0")}</Cell>
                  </td>
                  <td className="nt-col-fare">
                    <Cell>{formatInr(row.priceInr)}</Cell>
                  </td>
                  <td className="nt-remark">
                    <Cell>{mine ? "Check-in" : "Open"}</Cell>
                    {mine && <i className="nt-blink" aria-hidden />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="nt-hero-foot" data-in>
        <a
          href="#manifest"
          className="nt-begin"
          onClick={(e) => {
            // Glide down to the check-in and put the cursor in the first field.
            e.preventDefault();
            const reduce = matchMedia(MOTION_QUERIES.reduce).matches;
            document.getElementById("manifest")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
            window.setTimeout(() => document.getElementById("leadName")?.focus({ preventScroll: true }), reduce ? 0 : 700);
          }}
        >
          Check in
          <span aria-hidden>
            <ArrowDown size={14} weight="bold" />
          </span>
        </a>
        <dl className="nt-facts">
          <div>
            <dt>Flight</dt>
            <dd>
              {tour.from.code} → {tour.to.code} · {tour.flightTime}
            </dd>
          </div>
          <div>
            <dt>Stay</dt>
            <dd>{tour.hotel.name}</dd>
          </div>
          <div>
            <dt>From</dt>
            <dd>{formatInr(tour.priceInr)} per person</dd>
          </div>
        </dl>
      </div>
    </section>
  );
});

function Field({
  id,
  label,
  hint,
  error,
  ok,
  optional,
  counter,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  ok?: boolean;
  optional?: boolean;
  counter?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="nt-field" data-invalid={!!error || undefined} data-ok={ok || undefined}>
      <label htmlFor={id} className="nt-label">
        {label}
        {optional && <span className="nt-optional">Optional</span>}
        {counter && <span className="nt-counter">{counter}</span>}
      </label>
      <div className="nt-control">
        {children}
        <span className="nt-rule" aria-hidden />
        <span className="nt-status" aria-hidden>
          {error ? <WarningCircle size={16} weight="fill" /> : ok ? <Check size={14} weight="bold" /> : null}
        </span>
      </div>
      {error ? (
        <p id={`${id}-error`} className="nt-error">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="nt-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
