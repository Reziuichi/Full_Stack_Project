// Loads everything the journey needs for a chosen destination.
// Curated destinations come from our catalog API with their tour packages;
// any other place is assembled on the fly with nearby attractions.

import type { Attraction, Destination, PlaceResult, TourPackage } from "@/lib/types";

export interface LoadedDestination {
  destination: Destination;
  packages: TourPackage[];
  curated: boolean;
  attractionsProvider: "catalog" | "google" | "wikipedia";
}

export async function loadDestination(place: PlaceResult, signal?: AbortSignal): Promise<LoadedDestination> {
  if (place.destinationSlug) {
    const res = await fetch(`/api/destinations/${place.destinationSlug}`, { signal });
    if (!res.ok) throw new Error("Could not load this destination");
    const json = (await res.json()) as { destination: Destination; packages: TourPackage[] };
    return { ...json, curated: true, attractionsProvider: "catalog" };
  }

  const params = new URLSearchParams({ lat: String(place.lat), lng: String(place.lng), name: place.name });
  const res = await fetch(`/api/attractions/nearby?${params}`, { signal });
  const json = res.ok
    ? ((await res.json()) as { attractions: Attraction[]; provider: "google" | "wikipedia" })
    : { attractions: [], provider: "wikipedia" as const };

  const [region, country] = place.context.includes(",")
    ? [place.context.split(",")[0].trim(), place.context.split(",").slice(-1)[0].trim()]
    : ["", place.context];

  return {
    destination: {
      slug: `place-${place.id.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
      name: place.name,
      country: country || "",
      region,
      tagline: "",
      summary: "",
      lat: place.lat,
      lng: place.lng,
      elevation: 0,
      timezone: "",
      bestSeason: "",
      heroImage: json.attractions[0]?.imageUrl ?? "",
      heroImageCredit: json.attractions[0]?.imageCredit ?? "",
      camera: { heading: 20, pitch: -35, range: 14_000 },
      attractions: json.attractions,
    },
    packages: [],
    curated: false,
    attractionsProvider: json.provider,
  };
}
