"use client";

import { formatInr } from "@/lib/format";
import { useJourney } from "../../JourneyProvider";
import { LocalTime } from "../LocalTime";
import { PanelShell, SceneIndex, Stagger } from "./PanelShell";

export function DestinationPanel({ active, total }: { active: boolean; total: number }) {
  const { state, attractions, selectDestination } = useJourney();
  const d = state.destination;
  const data = d.data;

  return (
    <PanelShell active={active} label="Arrival">
      <Stagger i={0}>
        <SceneIndex n={5} total={total} label="Arrival" />
      </Stagger>

      {d.status === "loading" && (
        <div className="mt-4 space-y-2.5" aria-hidden>
          <div className="skeleton h-8 w-40" />
          <div className="skeleton h-3 w-full" />
          <div className="skeleton h-3 w-4/5" />
        </div>
      )}

      {d.status === "error" && (
        <p className="mt-4 text-sm text-danger" role="alert">
          {d.error}.{" "}
          {d.place && (
            <button type="button" className="underline underline-offset-4" onClick={() => void selectDestination(d.place!)}>
              Retry
            </button>
          )}
        </p>
      )}

      {d.status === "ready" && data && (
        <>
          <Stagger i={1}>
            <h2 className="mt-4 text-3xl font-medium tracking-tight">{data.destination.name}</h2>
            <p className="mt-1 text-sm text-muted">
              {[data.destination.region, data.destination.country].filter(Boolean).join(", ")}
              {data.destination.timezone && (
                <>
                  {" · "}
                  <LocalTime timezone={data.destination.timezone} className="font-mono text-dim" /> local time
                </>
              )}
            </p>
          </Stagger>
          <Stagger i={2}>
            <p className="mt-4 max-w-[46ch] text-sm leading-relaxed text-dim">
              {data.curated
                ? data.destination.summary
                : attractions.length
                  ? `We don't have a curated guide for ${data.destination.name} yet. Scroll to fly over nearby highlights from ${
                      data.attractionsProvider === "google" ? "Google Places" : "Wikipedia"
                    }.`
                  : `We don't have a curated guide for ${data.destination.name} yet, and no nearby landmarks were found.`}
            </p>
          </Stagger>
          <Stagger i={3}>
            <dl className="hud mt-5 grid grid-cols-3 gap-4 border-t border-line pt-4">
              <div>
                <dt className="text-faint">Places</dt>
                <dd className="mt-1 text-sm normal-case tracking-normal text-fg">{attractions.length} ahead</dd>
              </div>
              <div>
                <dt className="text-faint">Tours</dt>
                <dd className="mt-1 text-sm normal-case tracking-normal text-fg">
                  {data.packages.length ? `from ${formatInr(Math.min(...data.packages.map((p) => p.priceInr)))}` : "On request"}
                </dd>
              </div>
              <div>
                <dt className="text-faint">Best time</dt>
                <dd className="mt-1 text-sm normal-case tracking-normal text-fg">{data.destination.bestSeason || "Year-round"}</dd>
              </div>
            </dl>
          </Stagger>
        </>
      )}
    </PanelShell>
  );
}
