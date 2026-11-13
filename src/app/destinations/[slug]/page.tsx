import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDestination, listDestinations, listPackages } from "@/server/repositories/catalog";
import { destinations as catalogDestinations } from "@/data/catalog";
import { distanceMeters, formatCoordinates } from "@/lib/geo";
import { formatDistanceKm, formatInr } from "@/lib/format";
import { thumb, toCities } from "@/features/tours/tourData";
import { DestinationSurvey, type SurveyData } from "@/features/destinations/survey/DestinationSurvey";

export const revalidate = 300;

export function generateStaticParams() {
  return catalogDestinations.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata(props: PageProps<"/destinations/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const d = await getDestination(slug);
  return d ? { title: `${d.name}, ${d.country}`, description: d.tagline } : { title: "Destination not found" };
}

/** A destination as an orbital survey: the story is built on the server, the land and the 3D on the client. */
export default async function DestinationPage(props: PageProps<"/destinations/[slug]">) {
  const { slug } = await props.params;
  const destination = await getDestination(slug);
  if (!destination) notFound();
  const [packages, allDestinations, allPackages] = await Promise.all([listPackages({ destinationSlug: slug }), listDestinations(), listPackages()]);
  // Flight numbers follow the tours page's route order, so a tour is the same flight everywhere.
  const city = toCities(allDestinations, allPackages).find((c) => c.slug === slug);
  const flights = new Map(city?.tours.map((t) => [t.slug, t.flight]));
  const spots = destination.attractions;
  const route = spots.reduce((sum, a, i) => (i ? sum + distanceMeters(spots[i - 1], a) : 0), 0);
  const fromPrice = packages.length ? Math.min(...packages.map((p) => p.priceInr)) : null;

  const data: SurveyData = {
    slug: destination.slug,
    name: destination.name,
    country: destination.country,
    region: destination.region,
    tagline: destination.tagline,
    summary: destination.summary,
    coords: formatCoordinates(destination, 3),
    lat: destination.lat,
    lng: destination.lng,
    elevation: destination.elevation,
    timezone: destination.timezone,
    bestSeason: destination.bestSeason,
    hero: destination.heroImage,
    heroCredit: destination.heroImageCredit,
    routeKm: formatDistanceKm(route),
    fromPrice: fromPrice ? formatInr(fromPrice) : null,
    spots: spots.map((a) => ({
      slug: a.slug,
      name: a.name,
      category: a.category,
      summary: a.summary,
      coords: formatCoordinates(a, 3),
      lat: a.lat,
      lng: a.lng,
      image: a.imageUrl,
      credit: a.imageCredit,
      bestTime: a.bestTime,
      visitDuration: a.visitDuration,
    })),
    tours: packages.map((p) => ({
      slug: p.slug,
      name: p.name,
      summary: p.summary,
      days: p.durationDays,
      pace: p.pace,
      priceInr: p.priceInr,
      thumb: thumb(p.images[0], 500),
      photo: thumb(p.images[0], 1280),
      flight: `${flights.get(p.slug) ?? "LG"} · IXC → ${city?.code ?? destination.name.slice(0, 3).toUpperCase()}`,
    })),
  };

  return <DestinationSurvey data={data} />;
}
