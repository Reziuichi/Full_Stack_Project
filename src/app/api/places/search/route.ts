import type { NextRequest } from "next/server";
import { searchCatalog } from "@/server/repositories/catalog";
import { searchPlaces, geocodingProvider } from "@/server/services/geocoding";
import { distanceMeters } from "@/lib/geo";
import { handleRouteError } from "@/server/http";

// GET /api/places/search?q=manali&scope=destinations|origin
// Curated destinations first, then geocoder results (deduplicated).
export async function GET(request: NextRequest) {
  try {
    const q = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 80);
    if (q.trim().length < 2) return Response.json({ results: [], provider: geocodingProvider() });

    const [catalog, geocoded] = await Promise.all([searchCatalog(q), searchPlaces(q, 6)]);
    const others = geocoded.filter((g) => !catalog.some((c) => distanceMeters(c, g) < 25_000));
    return Response.json({ results: [...catalog, ...others].slice(0, 8), provider: geocodingProvider() });
  } catch (error) {
    return handleRouteError(error);
  }
}
