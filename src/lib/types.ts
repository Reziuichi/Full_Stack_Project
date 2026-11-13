// Shared domain types used by the server (repositories, API routes) and the
// client (3D journey, UI). Keep these free of Prisma and Cesium imports.

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Attraction {
  slug: string;
  name: string;
  category: string;
  summary: string;
  description: string;
  lat: number;
  lng: number;
  /** Ground height above the WGS84 ellipsoid (m). */
  elevation: number;
  /** Camera look-at height above the ellipsoid (m), e.g. mid-height of a tower. */
  focusHeight: number;
  /** Camera distance from the look-at point (m). */
  viewRange: number;
  /** Camera heading in degrees clockwise from north. */
  viewHeading: number;
  /** Camera pitch in degrees (negative looks down). */
  viewPitch: number;
  imageUrl: string;
  imageCredit: string;
  bestTime: string;
  visitDuration: string;
}

export interface DestinationSummary {
  slug: string;
  name: string;
  country: string;
  region: string;
  tagline: string;
  lat: number;
  lng: number;
  heroImage: string;
  packageCount: number;
  fromPriceInr: number | null;
  summary: string;
  timezone: string;
  bestSeason: string;
  /** The first few landmarks, for previews. */
  landmarks: { name: string; imageUrl: string }[];
}

export interface Destination {
  slug: string;
  name: string;
  country: string;
  region: string;
  tagline: string;
  summary: string;
  lat: number;
  lng: number;
  elevation: number;
  timezone: string;
  bestSeason: string;
  heroImage: string;
  heroImageCredit: string;
  camera: { heading: number; pitch: number; range: number };
  attractions: Attraction[];
}

export interface ItineraryDay {
  day: number;
  title: string;
  description: string;
  attractionSlugs: string[];
}

export interface Hotel {
  name: string;
  stars: number;
  area: string;
  description: string;
  amenities: string[];
}

export interface TourPackage {
  slug: string;
  destinationSlug: string;
  destinationName: string;
  country: string;
  name: string;
  summary: string;
  description: string;
  durationDays: number;
  priceInr: number;
  groupSize: string;
  pace: string;
  images: string[];
  highlights: string[];
  activities: string[];
  includes: string[];
  excludes: string[];
  hotel: Hotel;
  featured: boolean;
  itinerary: ItineraryDay[];
}

/** A place returned by search or geocoding — curated or not. */
export interface PlaceResult {
  id: string;
  name: string;
  /** Second line, e.g. "Himachal Pradesh, India". */
  context: string;
  lat: number;
  lng: number;
  /** Set when the place is one of our curated destinations. */
  destinationSlug?: string;
  packageCount?: number;
  source: "catalog" | "google" | "open-meteo" | "nominatim" | "timezone" | "browser";
}

export type BookingStatus = "PENDING" | "CONFIRMED" | "CANCELLED";

export interface BookingRecord {
  reference: string;
  status: BookingStatus;
  packageSlug: string;
  packageName: string;
  destinationName: string;
  durationDays: number;
  leadName: string;
  email: string;
  phone: string;
  travelers: number;
  travelDate: string; // YYYY-MM-DD
  originCity: string | null;
  notes: string | null;
  unitPriceInr: number;
  taxesInr: number;
  totalInr: number;
  createdAt: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}
