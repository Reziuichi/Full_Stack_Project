"use client";

import { useEffect, useRef, useState } from "react";
import { AirplaneTakeoff } from "@phosphor-icons/react";
import { placeCode } from "@/lib/geo";
import { useJourney, catalogPlace, EXPLORE_ARRIVED_EVENT } from "../../JourneyProvider";
import { PlaceSearch } from "../PlaceSearch";
import { PanelShell, SceneIndex, Stagger } from "./PanelShell";

export function ChoosePanel({ active, total }: { active: boolean; total: number }) {
  const { state, catalog, origin, selectDestination } = useJourney();
  const dest = state.destination;
  const current = dest.place;
  const connection = state.engine.connection;

  // "Explore" lands here: highlight the panel and open the destination picker.
  // The panel is inert until its scene is active, so wait for that before focusing.
  const [focusSignal, setFocusSignal] = useState(0);
  const [attention, setAttention] = useState(false);
  const pending = useRef(false);
  const activeRef = useRef(active);

  useEffect(() => {
    activeRef.current = active;
    if (!active || !pending.current) return;
    pending.current = false;
    const frame = requestAnimationFrame(() => {
      setFocusSignal((n) => n + 1);
      setAttention(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    const onArrived = () => {
      if (activeRef.current) {
        setFocusSignal((n) => n + 1);
        setAttention(true);
      } else {
        pending.current = true;
      }
    };
    window.addEventListener(EXPLORE_ARRIVED_EVENT, onArrived);
    return () => window.removeEventListener(EXPLORE_ARRIVED_EVENT, onArrived);
  }, []);

  useEffect(() => {
    if (!attention) return;
    const t = setTimeout(() => setAttention(false), 1800);
    return () => clearTimeout(t);
  }, [attention]);

  const route = current ? `${placeCode(origin.name)} → ${placeCode(current.name)}` : "";

  return (
    <PanelShell active={active} attention={attention} label="Choose a destination">
      <Stagger i={0}>
        <SceneIndex n={3} total={total} label="Destination" />
      </Stagger>
      <Stagger i={1}>
        <h2 className="mt-4 text-[1.7rem] font-medium leading-tight tracking-tight">Where do you want to go?</h2>
      </Stagger>
      <Stagger i={2} className="mt-4">
        <PlaceSearch
          label={`From ${origin.name} to`}
          placeholder="Paris, Manali, Tokyo, anywhere…"
          variant="destination"
          placement="up"
          catalog={catalog}
          focusSignal={focusSignal}
          onSelect={(place) => void selectDestination(place, { autoplay: true })}
        />
      </Stagger>
      <Stagger i={3} className="mt-4">
        <ul className="flex flex-wrap gap-1.5" aria-label="Curated destinations">
          {catalog.map((d) => {
            const selected = current?.destinationSlug === d.slug;
            return (
              <li key={d.slug}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => void selectDestination(catalogPlace(d), { autoplay: true })}
                  className="hud rounded-full border border-line-strong px-3 py-1.5 text-dim transition-colors hover:border-fg hover:text-fg aria-pressed:border-signal aria-pressed:bg-signal-soft aria-pressed:text-signal"
                >
                  {d.name}
                </button>
              </li>
            );
          })}
        </ul>
      </Stagger>
      <Stagger i={4} className="mt-5 border-t border-line pt-4">
        {dest.status === "loading" && (
          <p className="hud flex items-center gap-2 text-muted" aria-live="polite">
            <span className="status-dot" data-state="active" /> Loading {dest.place?.name}…
          </p>
        )}
        {dest.status === "error" && (
          <p className="text-sm text-danger" role="alert">
            {dest.error}.{" "}
            {dest.place && (
              <button type="button" className="underline underline-offset-4" onClick={() => void selectDestination(dest.place!, { autoplay: true })}>
                Try again
              </button>
            )}
          </p>
        )}
        {dest.status === "ready" && current && (
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm text-dim">
                {dest.suggestion ? "Suggested: " : "Selected: "}
                <span className="text-fg">{current.name}</span>
                {dest.suggestion && <span className="text-faint"> — search to change it</span>}
              </p>
              <p className="hud mt-1 flex items-center gap-2 text-faint" aria-live="polite">
                <span className="status-dot" data-state={connection === "done" ? "idle" : "active"} aria-hidden />
                {connection === "blinking" && <>Locating {route}</>}
                {connection === "drawing" && <>Drawing route {route}</>}
                {connection === "done" && <>Route ready · {route}</>}
                {connection === "idle" && <>Waiting for route</>}
              </p>
            </div>
            <button type="button" className="btn btn-ghost shrink-0" onClick={() => void selectDestination(current, { autoplay: true })}>
              Fly there <AirplaneTakeoff size={14} aria-hidden />
            </button>
          </div>
        )}
      </Stagger>
    </PanelShell>
  );
}
