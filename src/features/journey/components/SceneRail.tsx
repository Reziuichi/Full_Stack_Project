"use client";

import { useEffect, useRef } from "react";
import { ATTRACTION_REST, type Segment } from "../timeline";
import { useJourney } from "../JourneyProvider";
import { progressStore } from "../progressStore";

const LABELS: Record<string, string> = {
  earth: "Earth",
  location: "Origin",
  choose: "Destination",
  route: "Route",
  arrive: "Arrival",
  outro: "Tours",
};

/** Vertical scene index on the right edge; click a tick to jump there. */
export function SceneRail() {
  const { timeline, state, attractions, scrollToScene } = useJourney();
  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      progressStore.subscribe((p) => {
        if (fillRef.current) fillRef.current.style.transform = `scaleY(${p})`;
      }),
    [],
  );

  const label = (s: Segment) => (s.id === "attraction" ? attractions[s.attraction ?? 0]?.name ?? "Place" : LABELS[s.id]);

  return (
    <nav aria-label="Journey scenes" className="pointer-events-auto absolute right-3 top-1/2 z-20 hidden -translate-y-1/2 xl:block">
      <div className="relative py-1">
        <div className="absolute bottom-0 left-[5px] top-0 w-px bg-line-strong" aria-hidden />
        <div ref={fillRef} className="absolute bottom-0 left-[5px] top-0 w-px origin-top scale-y-0 bg-signal" aria-hidden />
        <ol className="relative flex flex-col gap-3.5">
          {timeline.segments.map((s) => {
            const active = s.index === state.scene.index;
            return (
              <li key={s.index}>
                <button
                  type="button"
                  onClick={() => scrollToScene(s.id, { attraction: s.attraction, offset: s.id === "attraction" ? ATTRACTION_REST : 0.5 })}
                  aria-current={active ? "step" : undefined}
                  className="group flex items-center gap-2.5"
                >
                  <span
                    className={`block h-[11px] w-[11px] rounded-full border transition-colors ${
                      active ? "border-signal bg-signal" : "border-line-strong bg-space group-hover:border-fg"
                    }`}
                  />
                  <span
                    className={`hud pointer-events-none absolute right-6 whitespace-nowrap rounded bg-space/80 px-2 py-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 ${
                      active ? "text-fg" : "text-muted"
                    }`}
                  >
                    {label(s)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
