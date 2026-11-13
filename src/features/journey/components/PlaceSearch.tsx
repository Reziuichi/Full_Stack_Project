"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MagnifyingGlass, MapPin, Airplane } from "@phosphor-icons/react";
import type { DestinationSummary, PlaceResult } from "@/lib/types";
import { searchPlaces } from "@/features/location/locationService";

interface PlaceSearchProps {
  label: string;
  placeholder: string;
  variant: "origin" | "destination";
  onSelect(place: PlaceResult): void;
  catalog?: DestinationSummary[];
  autoFocus?: boolean;
  hint?: string;
  /** "up" for inputs anchored near the bottom of the screen (journey panels). */
  placement?: "auto" | "up";
  /** Increment to focus the input and open the list (e.g. after "Explore"). */
  focusSignal?: number;
}

type Status = "idle" | "loading" | "done" | "error";

/** Curated destinations matching `q` — all of them when `q` is empty (browse mode). */
function localMatches(catalog: DestinationSummary[], q: string): PlaceResult[] {
  const n = q.toLowerCase().trim();
  return catalog
    .filter((d) => !n || `${d.name} ${d.region} ${d.country}`.toLowerCase().includes(n))
    .map((d) => ({
      id: `catalog:${d.slug}`,
      name: d.name,
      context: `${d.region}, ${d.country}`,
      lat: d.lat,
      lng: d.lng,
      destinationSlug: d.slug,
      packageCount: d.packageCount,
      source: "catalog" as const,
    }));
}

/** Accessible combobox that searches curated destinations and the geocoder. */
export function PlaceSearch({
  label,
  placeholder,
  variant,
  onSelect,
  catalog = [],
  autoFocus,
  hint,
  placement = "auto",
  focusSignal = 0,
}: PlaceSearchProps) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [upward, setUpward] = useState(false);

  // Journey panels sit at the bottom of the screen: open the list upward when there's no room below.
  function openList() {
    const rect = inputRef.current?.getBoundingClientRect();
    if (placement === "up") setUpward(true);
    else if (rect) setUpward(window.innerHeight - rect.bottom < 320 && rect.top > 320);
    setOpen(true);
  }

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  // Focusing opens the list (see onFocus), so this "pops up" the picker.
  useEffect(() => {
    if (!focusSignal) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [focusSignal]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const { results } = await searchPlaces(q, controller.signal);
        setResults(variant === "origin" ? results.map((r) => ({ ...r, destinationSlug: undefined })) : results);
        setStatus("done");
        setActive(results.length ? 0 : -1);
      } catch (error) {
        if (!controller.signal.aborted) setStatus(error instanceof DOMException ? "idle" : "error");
      }
    }, 260);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, variant]);

  function onChange(value: string) {
    setQuery(value);
    openList();
    const q = value.trim();
    if (q.length < 2) {
      setStatus("idle");
      setResults(variant === "destination" ? localMatches(catalog, q) : []);
      return;
    }
    setStatus("loading");
    // Show curated matches instantly while the geocoder responds.
    if (variant === "destination") setResults(localMatches(catalog, q));
  }

  function choose(place: PlaceResult) {
    onSelect(place);
    setQuery(place.name);
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) openList();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      if (open && results[active]) {
        e.preventDefault();
        choose(results[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const browsing = variant === "destination" && !query.trim();
  const showList = open && (query.trim().length > 0 || (browsing && results.length > 0));
  const Icon = variant === "origin" ? MapPin : Airplane;

  return (
    <div className="relative">
      <label htmlFor={id} className="eyebrow mb-2 block">
        {label}
      </label>
      <div className="relative">
        <MagnifyingGlass size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          autoComplete="off"
          spellCheck={false}
          className="field pl-10 text-base"
          placeholder={placeholder}
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            const browse = variant === "destination" && !query.trim();
            if (browse) {
              setResults(localMatches(catalog, ""));
              setActive(-1);
            }
            if (browse || query) openList();
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
        />
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-2 text-xs text-faint">
          {hint}
        </p>
      )}

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className={`glass absolute inset-x-0 z-30 max-h-72 overflow-y-auto rounded-xl p-1.5 ${
            upward ? "bottom-[calc(100%+6px)] top-auto" : "top-[calc(100%+6px)]"
          }`}
        >
          {browsing && (
            <li role="presentation" className="eyebrow px-3 pb-1.5 pt-2 text-[10px]">
              Curated destinations · or type any city
            </li>
          )}
          {results.map((r, i) => (
            <li
              key={r.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(r)}
              onMouseEnter={() => setActive(i)}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 aria-selected:bg-white/[0.06]"
            >
              <Icon size={16} className={r.destinationSlug ? "text-signal" : "text-muted"} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg">{r.name}</span>
                {r.context && <span className="block truncate text-xs text-muted">{r.context}</span>}
              </span>
              {r.destinationSlug && r.packageCount ? (
                <span className="hud shrink-0 rounded-full border border-signal/40 px-2 py-0.5 text-signal">
                  {r.packageCount} tours
                </span>
              ) : null}
            </li>
          ))}
          {status === "loading" && (
            <li className="space-y-2 px-3 py-2.5" aria-hidden>
              <div className="skeleton h-3 w-2/3" />
              <div className="skeleton h-2.5 w-1/3" />
            </li>
          )}
          {status === "done" && results.length === 0 && (
            <li className="px-3 py-3 text-sm text-muted">No places match “{query.trim()}”. Try a city or region name.</li>
          )}
          {status === "error" && <li className="px-3 py-3 text-sm text-danger">Search is unavailable right now. Try again in a moment.</li>}
          {results.some((r) => r.source === "google") && (
            <li role="presentation" className="hud px-3 pb-1.5 pt-2 text-right text-[9.5px] text-faint">
              Search by Google · via Cesium ion
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
