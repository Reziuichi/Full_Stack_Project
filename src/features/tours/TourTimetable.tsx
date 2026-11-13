"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, Shuffle } from "@phosphor-icons/react";
import { formatInr } from "@/lib/format";
import { Flip, gsap, MOTION_QUERIES, useGSAP } from "@/lib/gsap";
import { numberWord, thumb, type TourCard, type TourCity } from "./tourData";

type SortKey = "route" | "days" | "price";
type Row = TourCard & { city: TourCity; order: number };
const SORTS: { key: SortKey; label: string }[] = [
  { key: "route", label: "Route" },
  { key: "days", label: "Days" },
  { key: "price", label: "Price" },
];
const PACES = ["Relaxed", "Moderate", "Active"];
const reduced = () => typeof window !== "undefined" && window.matchMedia(MOTION_QUERIES.reduce).matches;
/** A roll of the dice, for "Surprise me" (only ever called from the click). */
const roll = (n: number) => Math.floor(Math.random() * n);

/**
 * Every tour, side by side, as a clean index: a photo, the name and route,
 * the length as a row of day pips and the pace as a three-bar meter, so the
 * rows compare at a glance. Re-sorting glides each row to its new place (a
 * Flip, never a reload), the sort pill slides between options, and
 * "Surprise me" runs a light down the list until it settles on a flight.
 */
export function TourTimetable({ cities }: { cities: TourCity[] }) {
  const root = useRef<HTMLElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const rows = useMemo<Row[]>(() => cities.flatMap((c) => c.tours.map((t) => ({ ...t, city: c }))).map((r, i) => ({ ...r, order: i })), [cities]);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "route", dir: 1 });
  const [lit, setLit] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const spinning = useRef<gsap.core.Tween | null>(null);
  const flip = useRef<ReturnType<typeof Flip.getState> | null>(null);

  const sorted = useMemo(() => {
    const by = { route: (r: Row) => r.order, days: (r: Row) => r.durationDays * 1e7 + r.priceInr, price: (r: Row) => r.priceInr }[sort.key];
    return [...rows].sort((a, b) => (by(a) - by(b)) * sort.dir);
  }, [rows, sort]);

  const days = rows.map((r) => r.durationDays);
  const prices = rows.map((r) => r.priceInr);
  const maxDays = Math.max(...days);

  const choose = (key: SortKey) => {
    spinning.current?.kill();
    setLit(null);
    setPicked(null);
    const els = root.current?.querySelectorAll(".tb-row");
    if (els && !reduced()) flip.current = Flip.getState(els);
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  };

  // The pill glides to the chosen option, and the rows glide to their new places.
  useLayoutEffect(() => {
    const btn = sortRef.current?.querySelector<HTMLButtonElement>("button[aria-pressed=true]");
    if (btn && pill.current) gsap.to(pill.current, { x: btn.offsetLeft, width: btn.offsetWidth, duration: reduced() ? 0 : 0.6, ease: "expo.out", overwrite: true });
    const state = flip.current;
    flip.current = null;
    if (!state) return;
    // Each tile sinks a touch as it travels, so the passing ones read as layers.
    Flip.from(state, { duration: 0.8, ease: "power3.inOut", stagger: 0.014, simple: true });
    gsap.fromTo(root.current!.querySelectorAll(".tb-link"), { scale: 0.965 }, { scale: 1, duration: 0.9, ease: "power3.out", stagger: 0.014, clearProps: "scale" });
  }, [sort]);

  const spin = () => {
    if (spinning.current?.isActive()) return;
    const n = sorted.length;
    const target = roll(n);
    const from = Math.max(0, sorted.findIndex((r) => r.slug === lit));
    const steps = n * 2 + ((target - from + n) % n);
    setPicked(null);
    const st = { v: 0 };
    spinning.current = gsap.to(st, {
      v: steps,
      duration: reduced() ? 0 : 3,
      ease: "power4.out",
      onUpdate: () => setLit(sorted[(from + Math.floor(st.v)) % n].slug),
      onComplete: () => {
        const slug = sorted[target].slug;
        setLit(slug);
        setPicked(slug);
        const row = root.current?.querySelector<HTMLElement>(`.tb-row[data-slug="${slug}"]`);
        if (!row) return;
        const r = row.getBoundingClientRect();
        if (r.top < 90 || r.bottom > window.innerHeight - 20) gsap.to(window, { scrollTo: { y: row, offsetY: window.innerHeight * 0.35 }, duration: 0.9, ease: "power3.inOut" });
      },
    });
  };
  useEffect(() => () => void spinning.current?.kill(), []);

  useGSAP(
    () => {
      const el = root.current!;
      const mm = gsap.matchMedia();
      mm.add(MOTION_QUERIES, (context) => {
        const full = Boolean(context.conditions?.full);
        gsap.fromTo(el.querySelectorAll("[data-a=fade]"), { autoAlpha: 0, y: full ? 26 : 0 }, { autoAlpha: 1, y: 0, duration: 1, ease: "power3.out", stagger: 0.08, scrollTrigger: { trigger: el, start: "top 75%", once: true } });
        // One trigger for the whole list, so a re-sort can never strand a hidden row.
        gsap.fromTo(el.querySelectorAll(".tb-row"), { autoAlpha: 0, y: full ? 22 : 0 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: "expo.out", stagger: 0.035, scrollTrigger: { trigger: el.querySelector(".tb-rows"), start: "top 85%", once: true } });
      });
    },
    { scope: root },
  );

  return (
    <section id="timetable" ref={root} className="tb" aria-labelledby="tb-title">
      <div className="tb-inner">
        <header className="tb-head">
          <div>
            <p data-a="fade" className="tb-kicker">
              <i aria-hidden />
              The timetable
            </p>
            <h2 data-a="fade" id="tb-title" className="tb-title">
              All {numberWord(rows.length).toLowerCase()}, <em>side by side.</em>
            </h2>
            <p data-a="fade" className="tb-stats">
              <span>
                <b>{rows.length}</b> tours
              </span>
              <span>
                <b>{cities.length}</b> cities
              </span>
              <span>
                <b>
                  {Math.min(...days)}–{maxDays}
                </b>{" "}
                days
              </span>
              <span>
                <b>{formatInr(Math.min(...prices))}</b> to <b>{formatInr(Math.max(...prices))}</b>
              </span>
            </p>
          </div>
          <div data-a="fade" className="tb-controls">
            <div ref={sortRef} className="tb-sort" role="group" aria-label="Sort the tours">
              <span ref={pill} className="tb-sort-pill" aria-hidden />
              <span className="tb-sort-label">Sort by</span>
              {SORTS.map((s) => (
                <button key={s.key} type="button" aria-pressed={sort.key === s.key} onClick={() => choose(s.key)}>
                  {s.label}
                  <span className="tb-sort-dir" aria-hidden>
                    {sort.key === s.key ? (sort.dir === 1 ? "↑" : "↓") : ""}
                  </span>
                </button>
              ))}
            </div>
            <button type="button" className="tb-spin" onClick={spin}>
              <Shuffle size={16} weight="bold" aria-hidden />
              Surprise me
            </button>
          </div>
        </header>

        <div data-a="fade" className="tb-cols" aria-hidden>
          <span />
          <span>Tour</span>
          <span className="tb-hide-sm">Length</span>
          <span className="tb-hide-sm">Pace</span>
          <span className="tb-hide-md">Group</span>
          <span className="tb-right">From</span>
          <span className="tb-hide-sm" />
        </div>
        <ol className="tb-rows">
          {sorted.map((r) => {
            const pace = PACES.indexOf(r.pace);
            const [kind, size] = r.groupSize.split(/,\s*/);
            return (
              <li key={r.slug} className="tb-row" data-slug={r.slug} data-tour-card data-lit={lit === r.slug || undefined} data-picked={picked === r.slug || undefined} style={{ "--glow": r.city.theme.glow } as CSSProperties}>
                <Link
                  href={`/tours/${r.slug}`}
                  className="tb-link"
                  aria-label={`${r.flight}: ${r.name}, ${r.city.name}. ${r.durationDays} days, ${r.pace}, from ${formatInr(r.priceInr)}`}
                  data-tour-photo={thumb(r.images[0], 1280)}
                  data-tour-flight={`${r.flight} · IXC → ${r.city.code}`}
                  data-tour-name={r.name}
                >
                  <span className="tb-thumb" data-tour-frame aria-hidden>
                    {/* eslint-disable-next-line @next/next/no-img-element -- small remote thumbnail; the boarding transition opens from it */}
                    <img src={thumb(r.images[0], 330)} alt="" loading="lazy" decoding="async" data-on="" />
                  </span>
                  <span className="tb-tour" aria-hidden>
                    <b>{r.name}</b>
                    <small>
                      <i />
                      <em>
                        {r.city.name}
                        <span className="tb-hide-sm">, {r.city.country}</span>
                      </em>
                      <span>{r.flight}</span>
                      <span className="tb-hide-sm">IXC → {r.city.code}</span>
                    </small>
                    <em className="tb-meta-sm">
                      {r.durationDays} days · {r.pace}
                    </em>
                  </span>
                  <span className="tb-days tb-hide-sm" aria-hidden>
                    <span className="tb-pips">
                      {Array.from({ length: maxDays }, (_, d) => (
                        <i key={d} data-on={d < r.durationDays || undefined} />
                      ))}
                    </span>
                    <span>
                      <b>{r.durationDays}</b> days
                    </span>
                  </span>
                  <span className="tb-pace tb-hide-sm" aria-hidden>
                    <span className="tb-meter">
                      {PACES.map((p, l) => (
                        <i key={p} data-on={l <= pace || undefined} />
                      ))}
                    </span>
                    {r.pace}
                  </span>
                  <span className="tb-group tb-hide-md" aria-hidden>
                    {kind}
                    {size && <small>{size}</small>}
                  </span>
                  <span className="tb-price" aria-hidden>
                    <b>{formatInr(r.priceInr)}</b>
                    <small>per person</small>
                  </span>
                  <span className="tb-go tb-hide-sm" aria-hidden>
                    <ArrowUpRight size={16} weight="bold" />
                  </span>
                  <span className="tb-pick" aria-hidden>
                    Your flight
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
