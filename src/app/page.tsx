import Link from "next/link";
import { listDestinations } from "@/server/repositories/catalog";
import { JourneyProvider } from "@/features/journey/JourneyProvider";
import { JourneyExperience } from "@/features/journey/JourneyExperience";
import { DestinationDossier } from "@/features/journey/sections/DestinationDossier";
import { DestinationTours } from "@/features/journey/sections/DestinationTours";
import { DestinationReel } from "@/features/destinations/DestinationReel";

export const revalidate = 300;

const STEPS = [
  {
    n: "01",
    title: "Start where you stand",
    body: "Your browser location (or a city you type) becomes the origin. It never leaves your device except to name the place.",
  },
  {
    n: "02",
    title: "Draw the route",
    body: "We trace the great-circle path — the one aircraft actually fly — and ride the camera along it across the planet.",
  },
  {
    n: "03",
    title: "Land in 3D",
    body: "Photorealistic 3D cities put you over real streets, rooftops and landmarks. Scroll to move between the places worth your time.",
  },
  {
    n: "04",
    title: "Book the version that fits",
    body: "Every tour lists the hotel, the day-by-day plan and what's included. Book online; a planner in Chandigarh confirms within a day.",
  },
];

export default async function HomePage() {
  const catalog = await listDestinations();

  return (
    <>
      <JourneyProvider catalog={catalog}>
        <JourneyExperience />
        <DestinationDossier />
        <DestinationTours />
      </JourneyProvider>

      <DestinationReel destinations={catalog} />

      <section aria-labelledby="how-it-works" className="mx-auto max-w-[1400px] px-4 pb-28 pt-8 sm:px-6 lg:px-8">
        <div className="grid gap-12 border-t border-line pt-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div>
            <p className="eyebrow">How it works</p>
            <h2 id="how-it-works" className="mt-3 max-w-[16ch] text-3xl font-medium tracking-tight md:text-4xl">
              A travel desk built on a live Earth
            </h2>
            <Link href="/about" className="btn btn-ghost mt-8">
              About Longitude
            </Link>
          </div>
          <ol className="divide-y divide-line border-y border-line">
            {STEPS.map((s) => (
              <li key={s.n} className="grid gap-2 py-6 sm:grid-cols-[4rem_1fr_1.4fr] sm:gap-6">
                <span className="font-mono text-sm text-signal">{s.n}</span>
                <h3 className="text-base font-medium">{s.title}</h3>
                <p className="text-sm leading-relaxed text-dim">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
