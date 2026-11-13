// Place search and reverse geocoding.
//
// Provider order:
//   1. Google Geocoding API — only if the optional GOOGLE_MAPS_SERVER_API_KEY
//      is set and accepted.
//   2. Google geocoding through Cesium ion (NEXT_PUBLIC_CESIUM_ION_TOKEN) —
//      the default. Google's terms pair Photorealistic 3D Tiles with Google
//      geocoding, and ion provides both with the same free token.
//   3. Open-Meteo geocoding (search) and OpenStreetMap Nominatim (reverse) —
//      free, keyless fallbacks if ion is unavailable.

import { serverEnv } from "@/lib/env";
import type { PlaceResult } from "@/lib/types";

const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return value;
}

// If Google rejects the key (e.g. referrer-restricted browser key used on the
// server), stop calling it for this process and log the reason once.
let googleDisabledReason: string | null = null;
function googleKey(): string | null {
  const key = serverEnv.googleServerKey;
  return key && !googleDisabledReason ? key : null;
}
function disableGoogle(reason: string) {
  if (!googleDisabledReason) {
    googleDisabledReason = reason;
    console.warn(`[geocoding] Google Geocoding disabled: ${reason}. Falling back to open geocoders.`);
  }
}

export function geocodingProvider(): "google" | "ion-google" | "open" {
  if (googleKey()) return "google";
  return ionToken() ? "ion-google" : "open";
}

// ── Google ──────────────────────────────────────────────────────────────────

interface GoogleComponent {
  long_name: string;
  short_name: string;
  types: string[];
}
interface GoogleResult {
  place_id: string;
  formatted_address: string;
  address_components: GoogleComponent[];
  geometry: { location: { lat: number; lng: number } };
  types: string[];
}

function googleToPlace(r: GoogleResult): PlaceResult {
  const pick = (type: string) => r.address_components.find((c) => c.types.includes(type))?.long_name;
  const name =
    pick("locality") ??
    pick("postal_town") ??
    pick("administrative_area_level_3") ??
    pick("administrative_area_level_2") ??
    pick("natural_feature") ??
    pick("point_of_interest") ??
    r.address_components[0]?.long_name ??
    r.formatted_address;
  const context = [pick("administrative_area_level_1"), pick("country")].filter((x) => x && x !== name).join(", ");
  return {
    id: `google:${r.place_id}`,
    name,
    context,
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    source: "google",
  };
}

async function googleGeocode(params: Record<string, string>): Promise<GoogleResult[] | null> {
  const key = googleKey();
  if (!key) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.search = new URLSearchParams({ ...params, key, language: "en" }).toString();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const json = (await res.json()) as { status: string; error_message?: string; results: GoogleResult[] };
    if (json.status === "OK") return json.results;
    if (json.status === "ZERO_RESULTS") return [];
    if (json.status === "REQUEST_DENIED" || json.status === "OVER_DAILY_LIMIT") {
      disableGoogle(json.error_message ?? json.status);
    }
    return null;
  } catch {
    return null;
  }
}

// ── Google via Cesium ion ───────────────────────────────────────────────────
// ion's Google geocoder returns the best matches as address labels with a
// bounding box. It has no reverse endpoint, but a "lat,lng" query returns the
// addresses around that point, from street level up to the country.

interface IonFeature {
  properties?: { label?: string };
  bbox?: [number, number, number, number];
  geometry?: { type: string; coordinates: [number, number] };
}

let ionDisabledReason: string | null = null;
function ionToken(): string | null {
  const token = serverEnv.cesiumIonToken;
  return token && !ionDisabledReason ? token : null;
}

async function ionGeocode(text: string): Promise<IonFeature[] | null> {
  const token = ionToken();
  if (!token) return null;
  const url = new URL("https://api.cesium.com/v1/geocode/search");
  url.search = new URLSearchParams({ text, geocoder: "google", access_token: token }).toString();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.status === 401 || res.status === 403) {
      ionDisabledReason = `HTTP ${res.status}`;
      console.warn(`[geocoding] Cesium ion geocoder rejected the token (${ionDisabledReason}). Falling back to open geocoders.`);
      return null;
    }
    if (!res.ok) return null;
    const json = (await res.json()) as { features?: IonFeature[] };
    return json.features ?? [];
  } catch {
    return null;
  }
}

function featureCenter(f: IonFeature): { lat: number; lng: number } | null {
  if (f.geometry?.type === "Point") return { lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
  if (f.bbox) return { lng: (f.bbox[0] + f.bbox[2]) / 2, lat: (f.bbox[1] + f.bbox[3]) / 2 };
  return null;
}

/** "75007 Paris" → "Paris", "Tokyo 105-0011" → "Tokyo"; drops bare postcodes and house numbers. */
function labelParts(label: string): string[] {
  return label
    .split(",")
    .map((p) =>
      p
        .trim()
        .replace(/^〒[\d-]+\s*/, "")
        .replace(/^\d{4,}[\d-]*\s+/, "")
        .replace(/\s+\d{3,}[\d-]*$/, ""),
    )
    .filter((p) => p && !/^\d[\d\s-]*$/.test(p));
}

function ionToPlace(f: IonFeature, i: number, at?: { lat: number; lng: number }): PlaceResult | null {
  const label = f.properties?.label;
  const center = at ?? featureCenter(f);
  if (!label || !center) return null;
  const parts = labelParts(label);
  if (!parts.length) return null;
  return {
    id: `ion-google:${i}:${label}`,
    name: parts[0],
    context: parts.slice(1).join(", "),
    lat: center.lat,
    lng: center.lng,
    source: "google",
  };
}

/** From the addresses around a point, the town/city-level one ("Chandigarh, India"). */
function pickLocality(features: IonFeature[]): IonFeature | null {
  let fallback: IonFeature | null = null;
  for (const f of features) {
    const parts = labelParts(f.properties?.label ?? "");
    if (parts.length >= 2 && parts.length <= 3 && !/\d/.test(parts[0])) return f;
    if (parts.length >= 2 && !fallback) fallback = f;
  }
  return fallback;
}

// ── Open fallbacks ──────────────────────────────────────────────────────────

interface OpenMeteoResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
  feature_code?: string;
  population?: number;
}

async function openMeteoSearch(query: string, limit: number): Promise<PlaceResult[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({ name: query, count: String(limit), language: "en", format: "json" }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return [];
  const json = (await res.json()) as { results?: OpenMeteoResult[] };
  return (json.results ?? []).map((r) => ({
    id: `open-meteo:${r.id}`,
    name: r.name,
    context: [r.admin1, r.country].filter((x) => x && x !== r.name).join(", "),
    lat: r.latitude,
    lng: r.longitude,
    source: "open-meteo" as const,
  }));
}

interface NominatimResult {
  place_id: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  address?: Record<string, string>;
}

async function nominatimReverse(lat: number, lng: number): Promise<PlaceResult | null> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.search = new URLSearchParams({
    format: "jsonv2",
    lat: String(lat),
    lon: String(lng),
    zoom: "10",
    "accept-language": "en",
  }).toString();
  // Nominatim's usage policy requires an identifying User-Agent.
  const res = await fetch(url, {
    headers: { "User-Agent": "Longitude-Travel/0.1 (local development; https://github.com/)" },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return null;
  const r = (await res.json()) as NominatimResult;
  if (!r?.lat) return null;
  const a = r.address ?? {};
  const name = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? r.name ?? r.display_name.split(",")[0];
  return {
    id: `nominatim:${r.place_id}`,
    name,
    context: [a.state, a.country].filter((x) => x && x !== name).join(", "),
    lat,
    lng,
    source: "nominatim",
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function searchPlaces(query: string, limit = 6): Promise<PlaceResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  return cached(`search:${q.toLowerCase()}:${limit}`, async () => {
    const google = await googleGeocode({ address: q });
    if (google) return google.slice(0, limit).map(googleToPlace);
    const ion = await ionGeocode(q);
    if (ion) return ion.slice(0, limit).flatMap((f, i) => ionToPlace(f, i) ?? []);
    try {
      return await openMeteoSearch(q, limit);
    } catch {
      return [];
    }
  });
}

export async function reverseGeocode(lat: number, lng: number): Promise<PlaceResult | null> {
  const key = `reverse:${lat.toFixed(3)},${lng.toFixed(3)}`;
  return cached(key, async () => {
    const google = await googleGeocode({
      latlng: `${lat},${lng}`,
      result_type: "locality|postal_town|administrative_area_level_2|administrative_area_level_1",
    });
    if (google && google.length) return { ...googleToPlace(google[0]), lat, lng };
    const ion = await ionGeocode(`${lat.toFixed(5)},${lng.toFixed(5)}`);
    const locality = ion && pickLocality(ion);
    const place = locality && ionToPlace(locality, 0, { lat, lng });
    if (place) return place;
    try {
      return await nominatimReverse(lat, lng);
    } catch {
      return null;
    }
  });
}
