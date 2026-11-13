// Catalog repository: destinations, attractions and tour packages.
// Reads from PostgreSQL via Prisma; falls back to the bundled catalog in
// src/data/catalog.ts when the database is not available or not seeded.

import { tryDb } from "@/server/db";
import { destinations as catalogDestinations, packages as catalogPackages } from "@/data/catalog";
import type { Attraction, Destination, DestinationSummary, PlaceResult, TourPackage } from "@/lib/types";
import type { Prisma } from "@/generated/prisma/client";

// ── Mapping ─────────────────────────────────────────────────────────────────

type DbAttraction = Prisma.AttractionGetPayload<object>;
type DbDestination = Prisma.DestinationGetPayload<{ include: { attractions: true } }>;
type DbPackage = Prisma.TourPackageGetPayload<{ include: { itinerary: true; destination: true } }>;

function mapAttraction(a: DbAttraction): Attraction {
  return {
    slug: a.slug,
    name: a.name,
    category: a.category,
    summary: a.summary,
    description: a.description,
    lat: a.latitude,
    lng: a.longitude,
    elevation: a.elevation,
    focusHeight: a.focusHeight,
    viewRange: a.viewRange,
    viewHeading: a.viewHeading,
    viewPitch: a.viewPitch,
    imageUrl: a.imageUrl,
    imageCredit: a.imageCredit,
    bestTime: a.bestTime,
    visitDuration: a.visitDuration,
  };
}

function mapDestination(d: DbDestination): Destination {
  return {
    slug: d.slug,
    name: d.name,
    country: d.country,
    region: d.region,
    tagline: d.tagline,
    summary: d.summary,
    lat: d.latitude,
    lng: d.longitude,
    elevation: d.elevation,
    timezone: d.timezone,
    bestSeason: d.bestSeason,
    heroImage: d.heroImage,
    heroImageCredit: d.heroImageCredit,
    camera: { heading: d.cameraHeading, pitch: d.cameraPitch, range: d.cameraRange },
    attractions: [...d.attractions].sort((x, y) => x.sortOrder - y.sortOrder).map(mapAttraction),
  };
}

function mapPackage(p: DbPackage): TourPackage {
  return {
    slug: p.slug,
    destinationSlug: p.destination.slug,
    destinationName: p.destination.name,
    country: p.destination.country,
    name: p.name,
    summary: p.summary,
    description: p.description,
    durationDays: p.durationDays,
    priceInr: p.priceInr,
    groupSize: p.groupSize,
    pace: p.pace,
    images: p.images,
    highlights: p.highlights,
    activities: p.activities,
    includes: p.includes,
    excludes: p.excludes,
    hotel: {
      name: p.hotelName,
      stars: p.hotelStars,
      area: p.hotelArea,
      description: p.hotelDescription,
      amenities: p.hotelAmenities,
    },
    featured: p.featured,
    itinerary: [...p.itinerary]
      .sort((a, b) => a.day - b.day)
      .map((d) => ({ day: d.day, title: d.title, description: d.description, attractionSlugs: d.attractionSlugs })),
  };
}

function staticPackage(slug: string): TourPackage | null {
  const p = catalogPackages.find((x) => x.slug === slug);
  if (!p) return null;
  const d = catalogDestinations.find((x) => x.slug === p.destinationSlug)!;
  return { ...p, destinationName: d.name, country: d.country };
}

function staticDestination(slug: string): Destination | null {
  const d = catalogDestinations.find((x) => x.slug === slug);
  if (!d) return null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { sortOrder, ...rest } = d;
  return rest;
}

function summarize(d: Destination, pkgs: { priceInr: number }[]): DestinationSummary {
  return {
    slug: d.slug,
    name: d.name,
    country: d.country,
    region: d.region,
    tagline: d.tagline,
    lat: d.lat,
    lng: d.lng,
    heroImage: d.heroImage,
    packageCount: pkgs.length,
    fromPriceInr: pkgs.length ? Math.min(...pkgs.map((p) => p.priceInr)) : null,
    summary: d.summary,
    timezone: d.timezone,
    bestSeason: d.bestSeason,
    landmarks: d.attractions.slice(0, 3).map((a) => ({ name: a.name, imageUrl: a.imageUrl })),
  };
}

// ── Queries ─────────────────────────────────────────────────────────────────

const packageInclude = { itinerary: true, destination: true } as const;

export async function listDestinations(): Promise<DestinationSummary[]> {
  const rows = await tryDb((db) =>
    db.destination.findMany({
      orderBy: { sortOrder: "asc" },
      include: { attractions: true, packages: { select: { priceInr: true } } },
    }),
  );
  if (rows && rows.length) return rows.map((r) => summarize(mapDestination(r), r.packages));
  return catalogDestinations.map((d) =>
    summarize(staticDestination(d.slug)!, catalogPackages.filter((p) => p.destinationSlug === d.slug)),
  );
}

export async function getDestination(slug: string): Promise<Destination | null> {
  const row = await tryDb((db) => db.destination.findUnique({ where: { slug }, include: { attractions: true } }));
  if (row) return mapDestination(row);
  const seeded = await tryDb((db) => db.destination.count());
  if (seeded) return null; // DB is authoritative once seeded
  return staticDestination(slug);
}

export async function listPackages(filter: { destinationSlug?: string } = {}): Promise<TourPackage[]> {
  const rows = await tryDb((db) =>
    db.tourPackage.findMany({
      where: filter.destinationSlug ? { destination: { slug: filter.destinationSlug } } : undefined,
      include: packageInclude,
      orderBy: [{ destination: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    }),
  );
  if (rows && rows.length) return rows.map(mapPackage);
  if (rows && !rows.length && filter.destinationSlug) {
    const seeded = await tryDb((db) => db.tourPackage.count());
    if (seeded) return [];
  }
  return catalogPackages
    .filter((p) => !filter.destinationSlug || p.destinationSlug === filter.destinationSlug)
    .map((p) => staticPackage(p.slug)!);
}

export async function getPackage(slug: string): Promise<TourPackage | null> {
  const row = await tryDb((db) => db.tourPackage.findUnique({ where: { slug }, include: packageInclude }));
  if (row) return mapPackage(row);
  const seeded = await tryDb((db) => db.tourPackage.count());
  if (seeded) return null;
  return staticPackage(slug);
}

/** Case- and accent-insensitive search over curated destinations. */
export async function searchCatalog(query: string): Promise<PlaceResult[]> {
  const q = normalize(query);
  if (!q) return [];
  const all = await listDestinations();
  return all
    .map((d) => {
      const name = normalize(d.name);
      const hay = normalize(`${d.name} ${d.region} ${d.country}`);
      const score = name.startsWith(q) ? 3 : name.includes(q) ? 2 : hay.includes(q) ? 1 : 0;
      return { d, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ d }) => ({
      id: `catalog:${d.slug}`,
      name: d.name,
      context: `${d.region}, ${d.country}`,
      lat: d.lat,
      lng: d.lng,
      destinationSlug: d.slug,
      packageCount: d.packageCount,
      source: "catalog" as const,
    }));
}

function normalize(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}
