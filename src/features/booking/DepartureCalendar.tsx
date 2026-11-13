"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { addDaysIso } from "@/lib/format";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const monthName = (y: number, m: number) => new Date(Date.UTC(y, m, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const longDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const parts = (s: string) => s.split("-").map(Number) as [number, number, number];

/**
 * A month of departure days. Picking a day lights up the whole trip (the
 * departure and every day after it, through the last night); hovering a day
 * previews the trip from there. Keyboard: arrows move a day or a week,
 * Home/End go to the start/end of the week, Page Up/Down change month, Enter
 * or Space picks. Days without enough notice can't be picked.
 */
function Calendar({
  value,
  onChange,
  min,
  max,
  days,
  labelledBy,
  describedBy,
  invalid,
}: {
  value: string;
  onChange: (iso: string) => void;
  min: string;
  max: string;
  /** Length of the trip in days (the highlighted span). */
  days: number;
  labelledBy: string;
  describedBy?: string;
  invalid?: boolean;
}) {
  const [vy, vm] = parts(value || min);
  const [view, setView] = useState({ y: vy, m: vm - 1 });
  const [focus, setFocus] = useState(value || min);
  const [hover, setHover] = useState<string | null>(null);
  const grid = useRef<HTMLTableElement>(null);
  const moved = useRef(false);

  // Follow the value when it changes from outside (a restored draft).
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value) {
      const [y, m] = parts(value);
      setView({ y, m: m - 1 });
      setFocus(value);
    }
  }

  // Keep keyboard focus on the focused day after the grid re-renders.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"]`)?.focus();
  }, [focus, view]);

  const weeks = useMemo(() => {
    const first = new Date(Date.UTC(view.y, view.m, 1));
    const offset = (first.getUTCDay() + 6) % 7; // Monday first
    const count = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
    const cells: (string | null)[] = [...Array(offset).fill(null), ...Array.from({ length: count }, (_, i) => iso(view.y, view.m, i + 1))];
    while (cells.length % 7) cells.push(null);
    return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  }, [view]);

  const anchor = hover ?? value;
  const end = anchor ? addDaysIso(anchor, days - 1) : "";
  const canPrev = iso(view.y, view.m, 1) > min.slice(0, 8) + "01";
  const canNext = iso(view.y, view.m + 1, 1) <= max;

  const go = (target: string) => {
    const clamped = target < min ? min : target > max ? max : target;
    const [y, m] = parts(clamped);
    moved.current = true;
    setFocus(clamped);
    setView({ y, m: m - 1 });
  };
  const shiftMonth = (by: number) => {
    const [y, m, d] = parts(focus);
    const last = new Date(Date.UTC(y, m - 1 + by + 1, 0)).getUTCDate();
    go(iso(y, m - 1 + by, Math.min(d, last)));
  };

  const onKey = (e: React.KeyboardEvent) => {
    const [y, m, d] = parts(focus);
    const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    const map: Record<string, () => void> = {
      ArrowLeft: () => go(addDaysIso(focus, -1)),
      ArrowRight: () => go(addDaysIso(focus, 1)),
      ArrowUp: () => go(addDaysIso(focus, -7)),
      ArrowDown: () => go(addDaysIso(focus, 7)),
      Home: () => go(addDaysIso(focus, -weekday)),
      End: () => go(addDaysIso(focus, 6 - weekday)),
      PageUp: () => shiftMonth(-1),
      PageDown: () => shiftMonth(1),
    };
    if (map[e.key]) {
      e.preventDefault();
      map[e.key]();
    }
  };

  return (
    <div className="bk-cal" data-invalid={invalid || undefined}>
      <div className="bk-cal-head">
        <button type="button" className="bk-cal-nav" onClick={() => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))} disabled={!canPrev} aria-label="Previous month">
          <CaretLeft size={15} weight="bold" />
        </button>
        <p className="bk-cal-month" aria-live="polite">
          {monthName(view.y, view.m)}
        </p>
        <button type="button" className="bk-cal-nav" onClick={() => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))} disabled={!canNext} aria-label="Next month">
          <CaretRight size={15} weight="bold" />
        </button>
      </div>
      <table ref={grid} className="bk-cal-grid" role="grid" aria-labelledby={labelledBy} aria-describedby={describedBy} onKeyDown={onKey} onPointerLeave={() => setHover(null)}>
        <thead>
          <tr>
            {WEEKDAYS.map((w) => (
              <th key={w} scope="col" abbr={w}>
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, i) => (
            <tr key={i}>
              {week.map((day, j) => {
                if (!day) return <td key={j} />;
                const off = day < min || day > max;
                const inTrip = !!anchor && day >= anchor && day <= end;
                const isFocus = day === focus;
                return (
                  <td key={day} role="gridcell" aria-selected={day === value}>
                    <button
                      type="button"
                      data-day={day}
                      className="bk-day"
                      tabIndex={isFocus ? 0 : -1}
                      aria-disabled={off || undefined}
                      aria-label={`${longDate(day)}${off ? ", not available" : ""}`}
                      data-trip={inTrip || undefined}
                      data-start={day === anchor || undefined}
                      data-end={day === end || undefined}
                      data-preview={(hover !== null && inTrip) || undefined}
                      data-picked={day === value || undefined}
                      onFocus={() => setFocus(day)}
                      onPointerEnter={() => !off && setHover(day)}
                      onClick={() => {
                        if (off) return;
                        setFocus(day);
                        onChange(day);
                      }}
                    >
                      {Number(day.slice(8))}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Re-renders only when its own props change, not on every keystroke in the form around it. */
export const DepartureCalendar = memo(Calendar);
