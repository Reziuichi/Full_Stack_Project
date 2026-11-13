"use client";

import { Crosshair, PencilSimple } from "@phosphor-icons/react";
import { formatCoordinates } from "@/lib/geo";
import { useJourney } from "../../JourneyProvider";
import { PlaceSearch } from "../PlaceSearch";
import { PanelShell, SceneIndex, Stagger } from "./PanelShell";

function accuracyLabel(m?: number) {
  if (!m) return null;
  return m < 1000 ? `±${Math.round(m)} m` : `±${(m / 1000).toFixed(1)} km`;
}

export function LocationPanel({ active, total }: { active: boolean; total: number }) {
  const { state, origin, requestLocation, setManualOrigin, editOrigin, scrollToScene } = useJourney();
  const loc = state.location;
  const needsInput = loc.status === "denied" || loc.status === "unavailable" || loc.status === "unsupported" || loc.status === "editing";
  const waiting = loc.status === "idle" || loc.status === "requesting";

  return (
    <PanelShell active={active} label="Your location">
      <Stagger i={0}>
        <SceneIndex n={2} total={total} label={needsInput ? "Origin" : "You are here"} />
      </Stagger>

      {waiting && (
        <>
          <Stagger i={1}>
            <h2 className="mt-4 flex items-center gap-2 text-2xl font-medium tracking-tight">
              <Crosshair size={20} className="animate-spin text-signal [animation-duration:3s]" aria-hidden />
              Finding you
            </h2>
          </Stagger>
          <Stagger i={2}>
            <p className="mt-2 max-w-[40ch] text-sm leading-relaxed text-dim">
              Allow location access in your browser so the route starts from where you are. Nothing is stored.
            </p>
            <div className="mt-4 space-y-2" aria-hidden>
              <div className="skeleton h-4 w-40" />
              <div className="skeleton h-3 w-56" />
            </div>
          </Stagger>
          <Stagger i={3} className="mt-5">
            <button type="button" className="text-sm text-muted underline underline-offset-4 hover:text-fg" onClick={editOrigin}>
              Enter your location manually instead
            </button>
          </Stagger>
        </>
      )}

      {loc.status === "resolving" && (
        <Stagger i={1}>
          <div className="mt-4 space-y-2" aria-live="polite">
            <div className="skeleton h-7 w-44" />
            <p className="hud text-muted">{loc.coords && formatCoordinates(loc.coords)}</p>
          </div>
        </Stagger>
      )}

      {loc.status === "ready" && (
        <>
          <Stagger i={1}>
            <h2 className="mt-4 text-3xl font-medium tracking-tight" aria-live="polite">
              {origin.name}
            </h2>
            {origin.context && <p className="mt-1 text-sm text-dim">{origin.context}</p>}
          </Stagger>
          <Stagger i={2}>
            <dl className="hud mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4">
              <div>
                <dt className="text-faint">Coordinates</dt>
                <dd className="mt-1 text-dim">{formatCoordinates(origin, 3)}</dd>
              </div>
              <div>
                <dt className="text-faint">Source</dt>
                <dd className="mt-1 text-dim">
                  {loc.source === "manual" ? "Entered manually" : "Browser location"}
                  {accuracyLabel(loc.accuracy) && <span className="normal-case"> · {accuracyLabel(loc.accuracy)}</span>}
                </dd>
              </div>
            </dl>
          </Stagger>
          <Stagger i={3} className="mt-5 flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-ghost" onClick={() => scrollToScene("choose", { duration: 1.6 })}>
              Choose a destination
            </button>
            <button type="button" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg" onClick={editOrigin}>
              <PencilSimple size={14} aria-hidden /> Change
            </button>
          </Stagger>
        </>
      )}

      {needsInput && (
        <>
          <Stagger i={1}>
            <h2 className="mt-4 text-2xl font-medium tracking-tight">Enter your location manually</h2>
            {loc.status !== "editing" && loc.message && <p className="mt-2 text-sm text-dim">{loc.message}</p>}
          </Stagger>
          <Stagger i={2} className="mt-4">
            <PlaceSearch
              label="Your city or town"
              placeholder="e.g. Chandigarh, Pune, Berlin"
              variant="origin"
              placement="up"
              onSelect={setManualOrigin}
              autoFocus={active && loc.status === "editing"}
              hint={`Until then the route starts from ${origin.name}${origin.approximate ? " (approximate, from your time zone)" : ""}.`}
            />
          </Stagger>
          {loc.status !== "denied" && loc.status !== "unsupported" && (
            <Stagger i={3} className="mt-4">
              <button type="button" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg" onClick={requestLocation}>
                <Crosshair size={14} aria-hidden /> Use my browser location
              </button>
            </Stagger>
          )}
        </>
      )}
    </PanelShell>
  );
}
