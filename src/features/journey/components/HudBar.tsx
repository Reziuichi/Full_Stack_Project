"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { Hand, Minus, Plus, ArrowCounterClockwise } from "@phosphor-icons/react";
import type { Telemetry } from "@/features/globe/engine";
import { formatNumber } from "@/lib/format";
import { useJourney } from "../JourneyProvider";

export interface HudBarHandle {
  telemetry(t: Telemetry): void;
}

function locationLabel(status: string, approximate: boolean): [string, "active" | "warn" | "idle"] {
  switch (status) {
    case "ready":
      return ["Active", "active"];
    case "requesting":
    case "resolving":
    case "idle":
      return ["Acquiring", "idle"];
    case "editing":
      return ["Manual entry", "idle"];
    default:
      return [approximate ? "Approx. (time zone)" : "Unavailable", "warn"];
  }
}

/** Bottom HUD strip: system status, live camera telemetry and globe controls. */
export const HudBar = forwardRef<HudBarHandle>(function HudBar(_, ref) {
  const { state, origin, engineRef, dispatchEngine } = useJourney();
  const altRef = useRef<HTMLSpanElement>(null);
  const posRef = useRef<HTMLSpanElement>(null);

  useImperativeHandle(ref, () => ({
    telemetry(t) {
      if (altRef.current) {
        altRef.current.textContent = t.height > 10_000 ? `${formatNumber(Math.round(t.height / 1000))} km` : `${formatNumber(Math.round(t.height))} m`;
      }
      if (posRef.current) {
        posRef.current.textContent = `${Math.abs(t.lat).toFixed(2)}°${t.lat >= 0 ? "N" : "S"} ${Math.abs(t.lng).toFixed(2)}°${t.lng >= 0 ? "E" : "W"}`;
      }
    },
  }));

  const [locText, locState] = locationLabel(state.location.status, origin.approximate);
  const world = state.engine.world;
  const modeText = { photoreal: "Photorealistic 3D", osm: "Terrain + OSM buildings" } as const;
  const worldText =
    world.state === "ready"
      ? modeText[world.mode]
      : world.state === "loading"
        ? "Connecting"
        : world.state === "disabled"
          ? "No ion token"
          : world.mode
            ? `${modeText[world.mode]} (partial)`
            : "Error";
  const worldState = world.state === "ready" ? "active" : world.state === "loading" ? "idle" : "warn";
  const { userControl, freeCamera } = state.engine;

  return (
    <div className="hud pointer-events-none absolute inset-x-0 bottom-0 z-20 flex h-12 items-center justify-between gap-4 border-t border-line/60 bg-gradient-to-t from-space/90 to-space/0 px-4 text-muted sm:px-6 lg:px-8">
      <div className="flex items-center gap-5">
        <span className="flex items-center gap-2">
          <span className="status-dot" data-state={locState} aria-hidden />
          <span className="hidden sm:inline">Location:</span> <span className="text-dim">{locText}</span>
        </span>
        <span className="hidden items-center gap-2 md:flex">
          Alt <span ref={altRef} className="text-dim">—</span>
          <span className="text-faint">·</span>
          <span ref={posRef} className="text-dim">—</span>
        </span>
      </div>

      <div className="pointer-events-auto flex items-center gap-2">
        <span className="mr-2 hidden items-center gap-2 lg:flex">
          <span className="status-dot" data-state={worldState} aria-hidden />
          3D world: <span className="text-dim">{worldText}</span>
        </span>
        {userControl && (
          <button
            type="button"
            onClick={() => {
              engineRef.current?.resumeJourney();
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-signal/50 px-3 text-signal hover:bg-signal hover:text-signal-ink"
          >
            <ArrowCounterClockwise size={12} weight="bold" aria-hidden /> Resume journey
          </button>
        )}
        <div className="flex items-center rounded-full border border-line-strong bg-space/60">
          <button type="button" aria-label="Zoom in" className="grid h-8 w-9 place-items-center hover:text-fg" onClick={() => engineRef.current?.zoom(1)}>
            <Plus size={13} weight="bold" />
          </button>
          <span className="h-4 w-px bg-line-strong" aria-hidden />
          <button type="button" aria-label="Zoom out" className="grid h-8 w-9 place-items-center hover:text-fg" onClick={() => engineRef.current?.zoom(-1)}>
            <Minus size={13} weight="bold" />
          </button>
          <span className="h-4 w-px bg-line-strong" aria-hidden />
          <button
            type="button"
            aria-pressed={freeCamera}
            aria-label="Free camera: scroll wheel zooms the globe"
            title="Free camera"
            className="grid h-8 w-9 place-items-center hover:text-fg aria-pressed:text-signal"
            onClick={() => {
              const next = !freeCamera;
              if (next) engineRef.current?.setFreeCamera(true);
              else engineRef.current?.resumeJourney();
              dispatchEngine({ freeCamera: next, userControl: next });
            }}
          >
            <Hand size={14} />
          </button>
        </div>
      </div>
    </div>
  );
});
