// Attractions for destinations that are not in the curated catalog.
//   • Google Places API (New) Text Search when the optional server key is set.
//   • Otherwise Wikipedia GeoSearch: nearby articles with photos, filtered
//     to landmark-like descriptions.
// Heights are unknown here (0 = ellipsoid); the 3D engine samples real
// ground heights from Cesium World Terrain on the client.

import { serverEnv } from "@/lib/env";
import type { Attraction } from "@/lib/types";
import { distanceMeters, initialBearing } from "@/lib/geo";

const cache = new Map<string, { at: number; value: Attraction[] }>();
const TTL_MS = 6 * 60 * 60 * 1000;

function slugify(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function viewFor(center: { lat: number; lng: number }, p: { lat: number; lng: number }) {
  // Look at each place from the city-centre side so the flight between
  // attractions reads as moving outward through the city.
  const heading = distanceMeters(center, p) > 200 ? initialBearing(center, p) : 20;
  return { viewRange: 1100, viewHeading: heading, viewPitch: -30 };
}

interface GooglePlace {
  id: string;
  displayName?: { text: string };
  location?: { latitude: number; longitude: number };
  editorialSummary?: { text: string };
  primaryTypeDisplayName?: { text: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
}

async function fromGooglePlaces(name: string, lat: number, lng: number): Promise<Attraction[] | null> {
  const key = serverEnv.googleServerKey;
  if (!key) return null;
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.location,places.editorialSummary,places.primaryTypeDisplayName,places.formattedAddress,places.rating,places.userRatingCount",
      },
      body: JSON.stringify({
        textQuery: `top tourist attractions in ${name}`,
        languageCode: "en",
        maxResultCount: 6,
        locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 30000 } },
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { places?: GooglePlace[] };
    const places = (json.places ?? []).filter((p) => p.location && p.displayName);
    if (!places.length) return null;
    return places.slice(0, 5).map((p) => {
      const loc = { lat: p.location!.latitude, lng: p.location!.longitude };
      const rating = p.rating ? `Rated ${p.rating.toFixed(1)} by ${p.userRatingCount?.toLocaleString("en-IN")} visitors on Google.` : "";
      return {
        slug: `g-${slugify(p.displayName!.text)}`,
        name: p.displayName!.text,
        category: p.primaryTypeDisplayName?.text ?? "Point of interest",
        summary: p.editorialSummary?.text ?? p.formattedAddress ?? "",
        description: [p.editorialSummary?.text, rating].filter(Boolean).join(" "),
        ...loc,
        elevation: 0,
        focusHeight: 0,
        ...viewFor({ lat, lng }, loc),
        imageUrl: "",
        imageCredit: "Google Maps",
        bestTime: "",
        visitDuration: "",
      } satisfies Attraction;
    });
  } catch {
    return null;
  }
}

interface WikiPage {
  pageid: number;
  title: string;
  description?: string;
  extract?: string;
  coordinates?: { lat: number; lon: number }[];
  thumbnail?: { source: string };
  fullurl?: string;
  index?: number;
}

const LANDMARK =
  /(temple|museum|park|monument|fort|tower|lake|palace|church|cathedral|mosque|basilica|chapel|bridge|garden|beach|market|castle|shrine|gate|square|memorial|tomb|waterfall|mountain|pass|valley|landmark|gallery|zoo|harbour|harbor|opera|performing arts|amphithea|theatre|theater|island|monastery|abbey|reservoir|viewpoint|heritage|historic structure|skyscraper|wat )/i;
const NOT_LANDMARK =
  /(station|school|college|university|hospital|constituency|district|neighbourhood|neighborhood|company|hotel|airport|road|street|village in|census|bus|election|club|operator|exchange|broadcast|government|legislature|order|diocese|congregation|jurisdiction|institution|denomination|sports venue)/i;

// CirrusSearch's `nearcoord:` returns articles inside the radius ranked by
// relevance — which surfaces the famous landmarks (Colosseum, Wat Arun,
// Sydney Opera House) rather than whatever happens to be nearest.
async function fromWikipedia(lat: number, lng: number): Promise<Attraction[]> {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrsearch: `nearcoord:9km,${lat},${lng}`,
    gsrnamespace: "0",
    gsrlimit: "40",
    prop: "coordinates|pageimages|description|extracts|info",
    inprop: "url",
    exintro: "1",
    explaintext: "1",
    exsentences: "2",
    exlimit: "max",
    colimit: "max",
    piprop: "thumbnail",
    pithumbsize: "960",
    pilimit: "max",
  }).toString();
  const res = await fetch(url, {
    headers: { "User-Agent": "Longitude-Travel/0.1 (local development)" },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { query?: { pages?: WikiPage[] } };
  const pages = (json.query?.pages ?? [])
    .filter((p) => p.coordinates?.length && p.thumbnail && p.description)
    .filter((p) => LANDMARK.test(`${p.description} ${p.title}`) && !NOT_LANDMARK.test(p.description ?? ""))
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages.slice(0, 5).map((p) => {
    const loc = { lat: p.coordinates![0].lat, lng: p.coordinates![0].lon };
    const description = p.description!;
    return {
      slug: `w-${p.pageid}`,
      name: p.title,
      category: description.charAt(0).toUpperCase() + description.slice(1),
      summary: p.extract?.split(". ")[0]?.concat(".") ?? description,
      description: p.extract ?? description,
      ...loc,
      elevation: 0,
      focusHeight: 0,
      ...viewFor({ lat, lng }, loc),
      imageUrl: p.thumbnail!.source,
      imageCredit: p.fullurl ?? "https://en.wikipedia.org",
      bestTime: "",
      visitDuration: "",
    } satisfies Attraction;
  });
}

export async function findAttractionsNear(name: string, lat: number, lng: number): Promise<{ attractions: Attraction[]; provider: "google" | "wikipedia" }> {
  const key = `${name.toLowerCase()}:${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { attractions: hit.value, provider: hit.value[0]?.slug.startsWith("g-") ? "google" : "wikipedia" };

  const google = await fromGooglePlaces(name, lat, lng);
  const attractions = google ?? (await fromWikipedia(lat, lng).catch(() => []));
  cache.set(key, { at: Date.now(), value: attractions });
  return { attractions, provider: google ? "google" : "wikipedia" };
}
