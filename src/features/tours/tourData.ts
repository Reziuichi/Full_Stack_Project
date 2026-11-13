import type { DestinationSummary, TourPackage } from "@/lib/types";
import { airportCode, flightTime, greatCircleKm, HOME_BASE } from "@/lib/airports";
import { tourThemeFor, type TourTheme } from "@/lib/tourThemes";

/** What the tours page needs of a package (the rest stays on the server). */
export type TourCard = {
  slug: string;
  name: string;
  summary: string;
  durationDays: number;
  priceInr: number;
  pace: string;
  groupSize: string;
  featured: boolean;
  images: string[];
  highlights: string[];
  /** Flight number on the pass and in the timetable, e.g. "LG 101". */
  flight: string;
};

/** A city on the route, in the order the desk flies them, with its tours. */
export type TourCity = {
  slug: string;
  name: string;
  country: string;
  code: string;
  timezone: string;
  km: number;
  flightTime: string;
  theme: TourTheme;
  tours: TourCard[];
};

/** Group the catalogue by city (destination order), numbering the flights. */
export function toCities(destinations: DestinationSummary[], packages: TourPackage[]): TourCity[] {
  let n = 0;
  return destinations
    .map((d) => {
      const km = greatCircleKm(HOME_BASE, d);
      const tours = packages
        .filter((p) => p.destinationSlug === d.slug)
        .map(
          (p): TourCard => ({
            slug: p.slug,
            name: p.name,
            summary: p.summary,
            durationDays: p.durationDays,
            priceInr: p.priceInr,
            pace: p.pace,
            groupSize: p.groupSize,
            featured: p.featured,
            images: p.images.slice(0, 5),
            highlights: p.highlights.slice(0, 3),
            flight: `LG ${101 + n++}`,
          }),
        );
      return { slug: d.slug, name: d.name, country: d.country, code: airportCode(d.slug, d.name), timezone: d.timezone, km, flightTime: flightTime(km), theme: tourThemeFor(d.slug), tours };
    })
    .filter((c) => c.tours.length);
}

/**
 * A Wikimedia thumbnail at another of its standard widths (330, 500, 960,
 * 1280); anything else is returned unchanged.
 */
export function thumb(url: string, width: 330 | 500 | 960 | 1280): string {
  return url.includes("/thumb/") ? url.replace(/\/\d+px-([^/]+)$/, `/${width}px-$1`) : url;
}

const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty"];
export const numberWord = (n: number) => WORDS[n] ?? String(n);

/** Everything a tour's own page needs, resolved on the server. */
export type TourPageData = {
  slug: string;
  name: string;
  summary: string;
  description: string;
  durationDays: number;
  priceInr: number;
  pace: string;
  groupSize: string;
  images: string[];
  activities: string[];
  includes: string[];
  excludes: string[];
  hotel: { name: string; stars: number; area: string; description: string; amenities: string[] };
  itinerary: { day: number; title: string; description: string; attractionSlugs: string[] }[];
  flight: string;
  city: { slug: string; name: string; country: string; code: string; flightTime: string; timezone: string; theme: TourTheme };
  /** The landmarks this tour visits, by slug. */
  sights: Record<string, { name: string; image: string }>;
  next: { slug: string; name: string; flight: string; code: string; cityName: string; image: string; days: number } | null;
};
