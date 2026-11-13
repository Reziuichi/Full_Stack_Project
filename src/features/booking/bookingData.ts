// What the booking and confirmation pages need about a tour, resolved on the
// server: the tour itself, and the flight it continues from the tour page
// (the same flight number, airports and city colours as its boarding pass).

import { getDestination, getPackage, listDestinations, listPackages } from "@/server/repositories/catalog";
import { airportCode, flightTime, greatCircleKm, HOME_BASE } from "@/lib/airports";
import { tourThemeFor, type TourTheme } from "@/lib/tourThemes";
import { toCities } from "@/features/tours/tourData";

export type BookingTour = {
  slug: string;
  name: string;
  summary: string;
  durationDays: number;
  priceInr: number;
  pace: string;
  groupSize: string;
  image: string;
  hotel: { name: string; stars: number; area: string };
  includes: string[];
  flight: string;
  from: { code: string; name: string };
  to: { slug: string; code: string; name: string; country: string; timezone: string };
  flightTime: string;
  theme: TourTheme;
  /** The departures board: this flight, then the next few on the desk's route. */
  board: { slug: string; name: string; flight: string; city: string; code: string; days: number; priceInr: number }[];
};

export async function getBookingTour(slug: string): Promise<BookingTour | null> {
  const pkg = await getPackage(slug);
  if (!pkg) return null;
  const [destination, destinations, packages] = await Promise.all([getDestination(pkg.destinationSlug), listDestinations(), listPackages()]);
  // Flight numbers follow the tours page's route order, as on the tour page.
  const cities = toCities(destinations, packages);
  const city = cities.find((c) => c.tours.some((t) => t.slug === slug));
  const route = cities.flatMap((c) => c.tours.map((t) => ({ slug: t.slug, name: t.name, flight: t.flight, city: c.name, code: c.code, days: t.durationDays, priceInr: t.priceInr })));
  const at = route.findIndex((r) => r.slug === slug);
  const board = at < 0 ? [] : Array.from({ length: Math.min(6, route.length) }, (_, i) => route[(at + i) % route.length]);
  const flight = city?.tours.find((t) => t.slug === slug)?.flight ?? "LG 100";
  const km = destination ? greatCircleKm(HOME_BASE, destination) : 0;
  return {
    slug: pkg.slug,
    name: pkg.name,
    summary: pkg.summary,
    durationDays: pkg.durationDays,
    priceInr: pkg.priceInr,
    pace: pkg.pace,
    groupSize: pkg.groupSize,
    image: pkg.images[0] ?? "",
    hotel: { name: pkg.hotel.name, stars: pkg.hotel.stars, area: pkg.hotel.area },
    includes: pkg.includes.slice(0, 4),
    flight,
    from: { code: HOME_BASE.code, name: HOME_BASE.name },
    to: {
      slug: pkg.destinationSlug,
      code: city?.code ?? airportCode(pkg.destinationSlug, pkg.destinationName),
      name: pkg.destinationName,
      country: pkg.country,
      timezone: destination?.timezone ?? city?.timezone ?? "UTC",
    },
    flightTime: city?.flightTime ?? flightTime(km),
    theme: city?.theme ?? tourThemeFor(pkg.destinationSlug),
    board,
  };
}
