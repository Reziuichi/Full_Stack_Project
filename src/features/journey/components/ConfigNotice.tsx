"use client";

import { useState } from "react";
import { CaretDown, Warning, X } from "@phosphor-icons/react";
import { useJourney } from "../JourneyProvider";

const STORAGE_KEY = "lgt-config-notice-dismissed";

function wasDismissed() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Explicit configuration message when the Cesium ion 3D world (terrain,
 * imagery, OSM buildings) is not available. The globe keeps rendering NASA
 * imagery — never a 2D map — and this card says exactly what to set up.
 * Collapsed to one line on phones.
 */
export function ConfigNotice() {
  const { state } = useJourney();
  const world = state.engine.world;
  const [dismissed, setDismissed] = useState(wasDismissed);
  const [expanded, setExpanded] = useState(false);

  if (dismissed || (world.state !== "disabled" && world.state !== "error")) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* private mode */
    }
  };

  const title =
    world.state === "disabled"
      ? "3D terrain and buildings are off"
      : world.mode === "osm"
        ? "Photorealistic 3D city unavailable"
        : "3D world could not fully load";

  return (
    <aside
      role="status"
      className="glass pointer-events-auto absolute left-3 right-3 top-[calc(5rem+11vw)] z-30 rounded-xl p-3 sm:left-6 sm:right-auto sm:w-[380px] sm:p-4 lg:left-8 lg:top-20"
    >
      <div className="flex items-start gap-3">
        <Warning size={18} className="mt-0.5 shrink-0 text-signal" aria-hidden />
        <div className="min-w-0 flex-1 text-sm">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left font-medium text-fg lg:pointer-events-none"
            aria-expanded={expanded}
            onClick={() => setExpanded((e) => !e)}
          >
            {title}
            <CaretDown size={14} className={`shrink-0 text-muted transition-transform lg:hidden ${expanded ? "rotate-180" : ""}`} aria-hidden />
          </button>
          <p className={`mt-1.5 leading-relaxed text-dim ${expanded ? "block" : "hidden"} lg:block`}>
            {world.state === "disabled" ? (
              <>
                Add a free Cesium ion token as <code className="rounded bg-white/5 px-1 font-mono text-[12px] text-fg">NEXT_PUBLIC_CESIUM_ION_TOKEN</code>{" "}
                in <code className="rounded bg-white/5 px-1 font-mono text-[12px] text-fg">.env.local</code> and restart the dev server. Until then
                the globe uses NASA imagery without terrain relief or 3D buildings.
              </>
            ) : (
              world.reason
            )}
          </p>
        </div>
        <button type="button" onClick={dismiss} aria-label="Dismiss" className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:text-fg">
          <X size={14} />
        </button>
      </div>
    </aside>
  );
}
