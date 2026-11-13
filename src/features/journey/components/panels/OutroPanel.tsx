"use client";

import Link from "next/link";
import { ArrowDown } from "@phosphor-icons/react";
import { formatDays, formatInr } from "@/lib/format";
import { useJourney } from "../../JourneyProvider";
import { PanelShell, SceneIndex, Stagger } from "./PanelShell";

export function OutroPanel({ active, total }: { active: boolean; total: number }) {
  const { state, scrollToScene } = useJourney();
  const data = state.destination.data;
  if (!data) return null;
  const { destination, packages } = data;

  return (
    <PanelShell active={active} label="Tours">
      <Stagger i={0}>
        <SceneIndex n={total} total={total} label="Tours" />
      </Stagger>
      <Stagger i={1}>
        <h2 className="mt-4 text-[1.7rem] font-medium leading-tight tracking-tight">
          {packages.length ? `${packages.length} tours in ${destination.name}` : `Plan ${destination.name} with us`}
        </h2>
      </Stagger>
      {packages.length > 0 ? (
        <Stagger i={2}>
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {packages.map((p) => (
              <li key={p.slug}>
                <Link href={`/tours/${p.slug}`} className="flex items-baseline justify-between gap-4 py-3 hover:text-signal">
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{p.name}</span>
                    <span className="hud text-faint">{formatDays(p.durationDays)}</span>
                  </span>
                  <span className="shrink-0 font-mono text-sm">{formatInr(p.priceInr)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Stagger>
      ) : (
        <Stagger i={2}>
          <p className="mt-3 max-w-[44ch] text-sm leading-relaxed text-dim">
            There are no ready-made tours here yet. Our Chandigarh desk builds custom itineraries — tell us your dates and we reply within a day.
          </p>
        </Stagger>
      )}
      <Stagger i={3} className="mt-5 flex flex-wrap items-center gap-4">
        <a href="#tours" className="btn btn-signal">
          {packages.length ? "See the tours" : "Request a custom trip"} <ArrowDown size={14} weight="bold" aria-hidden />
        </a>
        <button type="button" className="text-sm text-muted underline underline-offset-4 hover:text-fg" onClick={() => scrollToScene("choose", { duration: 2.2 })}>
          Plan another trip
        </button>
      </Stagger>
    </PanelShell>
  );
}
