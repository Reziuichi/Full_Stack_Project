import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDestination, getPackage, listDestinations, listPackages } from "@/server/repositories/catalog";
import { packages as catalogPackages } from "@/data/catalog";
import { airportCode, flightTime, greatCircleKm, HOME_BASE } from "@/lib/airports";
import { tourThemeFor } from "@/lib/tourThemes";
import { toCities, type TourPageData } from "@/features/tours/tourData";
import { TourHero } from "@/features/tours/detail/TourHero";
import { TourBrief, TourDays, TourDeck } from "@/features/tours/detail/TourJourney";
import { TourPack, TourStay } from "@/features/tours/detail/TourStay";
import { TourBook, TourNext, TourBar } from "@/features/tours/detail/TourBook";

export const revalidate = 300;

export function generateStaticParams() {
  return catalogPackages.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata(props: PageProps<"/tours/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const pkg = await getPackage(slug);
  return pkg ? { title: `${pkg.name} — ${pkg.destinationName}`, description: pkg.summary } : { title: "Tour not found" };
}

export default async function TourPage(props: PageProps<"/tours/[slug]">) {
  const { slug } = await props.params;
  const pkg = await getPackage(slug);
  if (!pkg) notFound();
  const [destination, destinations, packages] = await Promise.all([getDestination(pkg.destinationSlug), listDestinations(), listPackages()]);

  // The flight number and the next departure follow the route order of the tours page.
  const all = toCities(destinations, packages).flatMap((c) => c.tours.map((t) => ({ t, c })));
  const at = all.findIndex((x) => x.t.slug === slug);
  const here = at >= 0 ? all[at] : null;
  const after = all.length > 1 && at >= 0 ? all[(at + 1) % all.length] : null;
  const km = destination ? greatCircleKm(HOME_BASE, destination) : 0;

  const data: TourPageData = {
    slug: pkg.slug,
    name: pkg.name,
    summary: pkg.summary,
    description: pkg.description,
    durationDays: pkg.durationDays,
    priceInr: pkg.priceInr,
    pace: pkg.pace,
    groupSize: pkg.groupSize,
    images: pkg.images,
    activities: pkg.activities,
    includes: pkg.includes,
    excludes: pkg.excludes,
    hotel: pkg.hotel,
    itinerary: pkg.itinerary,
    flight: here?.t.flight ?? "LG 100",
    city: here
      ? { slug: here.c.slug, name: here.c.name, country: here.c.country, code: here.c.code, flightTime: here.c.flightTime, timezone: here.c.timezone, theme: here.c.theme }
      : {
          slug: pkg.destinationSlug,
          name: pkg.destinationName,
          country: pkg.country,
          code: airportCode(pkg.destinationSlug, pkg.destinationName),
          flightTime: flightTime(km),
          timezone: destination?.timezone ?? "UTC",
          theme: tourThemeFor(pkg.destinationSlug),
        },
    sights: Object.fromEntries((destination?.attractions ?? []).map((a) => [a.slug, { name: a.name, image: a.imageUrl }])),
    next: after
      ? { slug: after.t.slug, name: after.t.name, flight: after.t.flight, code: after.c.code, cityName: after.c.name, image: after.t.images[0], days: after.t.durationDays }
      : null,
  };

  const t = data.city.theme;
  return (
    <article className="td" style={{ "--glow": t.glow, "--ground": t.ground, "--ink": t.ink, "--accent": t.accent, "--accent-ink": t.accentInk } as React.CSSProperties}>
      <TourHero tour={data} />
      <TourBrief tour={data} />
      <TourDeck tour={data} />
      <TourDays tour={data} />
      <TourStay tour={data} />
      <TourPack tour={data} />
      <TourBook tour={data} />
      {data.next && <TourNext next={data.next} />}
      <TourBar tour={data} />
    </article>
  );
}
