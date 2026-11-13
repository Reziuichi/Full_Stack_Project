"use client";

import { useEffect } from "react";
import { ScrollTrigger } from "@/lib/gsap";
import { useJourney } from "../JourneyProvider";
import { DestinationMarquee } from "./DestinationMarquee";
import { DestinationStory } from "./DestinationStory";

/**
 * "Destination exploration", right after the 3D journey: a two-line marquee
 * about the place, then a pinned scroll story that walks through each
 * landmark (photo on the left, its story on a rail of cards on the right).
 * Each landmark links back into the 3D flight.
 */
export function DestinationDossier() {
  const { state, attractions, scrollToScene } = useJourney();
  const data = state.destination.data;

  // The journey above and the story change height with the landmark count.
  const slug = data?.destination.slug;
  useEffect(() => {
    const id = requestAnimationFrame(() => ScrollTrigger.refresh());
    return () => cancelAnimationFrame(id);
  }, [attractions.length, slug]);

  return (
    <section id="destination" aria-labelledby="dossier-title" className="overflow-x-clip pt-10">
      {!data ? (
        <div className="mx-auto grid max-w-[1400px] gap-6 px-4 pt-16 sm:px-6 md:grid-cols-[1fr_1.4fr] lg:px-8" aria-hidden>
          <div className="space-y-3">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-12 w-64" />
            <div className="skeleton h-3 w-full" />
            <div className="skeleton h-3 w-4/5" />
          </div>
          <div className="skeleton aspect-[16/9] w-full rounded-[var(--radius-card)]" />
        </div>
      ) : (
        // Keyed by destination: a new place mounts fresh and replays its entrance.
        <div key={data.destination.slug}>
          <DestinationMarquee data={data} attractions={attractions} />
          {attractions.length === 0 ? (
            <div className="mx-auto max-w-[1400px] px-4 py-16 sm:px-6 lg:px-8">
              <h2 id="dossier-title" className="font-mono text-4xl font-light uppercase tracking-[-0.03em]">
                {data.destination.name}
              </h2>
              <div className="mt-8 rounded-[var(--radius-card)] border border-dashed border-line-strong p-10 text-center">
                <p className="text-sm text-dim">
                  No landmarks found near {data.destination.name}. Pick one of our curated destinations to see a full city flight.
                </p>
                <button type="button" className="btn btn-ghost mt-5" onClick={() => scrollToScene("choose")}>
                  Choose another destination
                </button>
              </div>
            </div>
          ) : (
            <DestinationStory
              data={data}
              attractions={attractions}
              tourCount={data.packages.length}
              onView={(i) => scrollToScene("attraction", { attraction: i, offset: 0.6, duration: 2 })}
            />
          )}
        </div>
      )}
    </section>
  );
}
