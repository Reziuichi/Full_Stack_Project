"use client";

import { ArrowDown } from "@phosphor-icons/react";
import { useJourney } from "../../JourneyProvider";
import { PanelShell, SceneIndex, Stagger } from "./PanelShell";

export function EarthPanel({ active, total }: { active: boolean; total: number }) {
  const { scrollToScene, state } = useJourney();
  const ready = state.engine.imageryReady;
  return (
    <PanelShell active={active} label="Earth">
      <Stagger i={0}>
        <SceneIndex n={1} total={total} label="Earth" />
      </Stagger>
      <Stagger i={1}>
        <h2 className="mt-4 text-[1.65rem] font-medium leading-[1.1] tracking-tight text-fg">
          Plan the trip from orbit, then fly into the city.
        </h2>
      </Stagger>
      <Stagger i={2}>
        <p className="mt-3 max-w-[42ch] text-sm leading-relaxed text-dim">
          We start the route where you are, draw it across the planet, and land you over photorealistic 3D streets with the tours for each place.
        </p>
      </Stagger>
      <Stagger i={3} className="mt-5 flex flex-wrap items-center gap-4">
        <button type="button" className="btn btn-signal" onClick={() => scrollToScene("location", { duration: 1.8 })} disabled={!ready}>
          Begin the journey
          <ArrowDown size={14} weight="bold" aria-hidden />
        </button>
        <span className="hud hidden text-faint sm:inline">Drag to turn · Ctrl + scroll to zoom</span>
      </Stagger>
    </PanelShell>
  );
}
