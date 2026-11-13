"use client";

import Link from "next/link";
import { ArrowRight, EnvelopeSimple } from "@phosphor-icons/react";
import { useJourney } from "../JourneyProvider";
import { TourSpreads } from "./TourSpreads";

/**
 * Tour packages for the destination chosen in the 3D journey: a pinned
 * scroll sequence when there are tours, otherwise the loading, error and
 * custom-trip states.
 */
export function DestinationTours() {
  const { state } = useJourney();
  const d = state.destination;
  const data = d.data;

  if (data && data.packages.length > 0) {
    return (
      <section id="tours" aria-labelledby="tours-title" className="scroll-mt-0">
        {/* Keyed by destination: a new place mounts fresh and replays its entrance. */}
        <TourSpreads key={data.destination.slug} destination={data.destination} packages={data.packages} />
      </section>
    );
  }

  return (
    <section id="tours" aria-labelledby="tours-title" className="mx-auto max-w-[1400px] scroll-mt-20 px-4 py-20 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-6 border-t border-line pt-10">
        <div>
          <p className="eyebrow">Tour packages</p>
          <h2 id="tours-title" className="mt-3 text-3xl font-medium tracking-tight md:text-4xl">
            {data ? `Tours in ${data.destination.name}` : "Tours"}
          </h2>
        </div>
        <Link href="/tours" className="hud inline-flex items-center gap-2 text-muted transition-colors hover:text-fg">
          All tours <ArrowRight size={13} aria-hidden />
        </Link>
      </div>

      {d.status === "loading" && (
        <div className="mt-10 grid gap-6 lg:grid-cols-[1.35fr_1fr]" aria-hidden>
          <div className="skeleton aspect-[16/10] rounded-[var(--radius-card)]" />
          <div className="skeleton aspect-[4/3] rounded-[var(--radius-card)]" />
        </div>
      )}

      {d.status === "error" && (
        <p className="mt-10 text-sm text-danger" role="alert">
          {d.error}. Pick another destination above.
        </p>
      )}

      {data && data.packages.length === 0 && (
        <div className="mt-10 grid gap-8 rounded-[var(--radius-card)] border border-line bg-panel p-8 md:grid-cols-[1.2fr_1fr] md:p-12">
          <div>
            <p className="eyebrow">Custom trip</p>
            <h3 className="mt-3 text-2xl font-medium tracking-tight">No ready-made tours to {data.destination.name} yet</h3>
            <p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-dim">
              Our desk plans trips anywhere we can fly you. Send your dates and group size, and a planner replies within one working day with an
              itinerary and a price.
            </p>
          </div>
          <div className="flex flex-col items-start justify-center gap-3 md:items-end">
            <a
              className="btn btn-signal"
              href={`mailto:trips@longitude.example?subject=${encodeURIComponent(`Custom trip to ${data.destination.name}`)}`}
            >
              <EnvelopeSimple size={14} aria-hidden /> Request an itinerary
            </a>
            <Link href="/tours" className="btn btn-ghost">
              Browse curated tours
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
