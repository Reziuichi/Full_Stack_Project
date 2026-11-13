// Seeds PostgreSQL from the curated catalog (src/data/catalog.ts).
// Idempotent: re-running updates existing rows by slug.
//   npm run db:seed

import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { destinations, packages } from "../src/data/catalog";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set — see .env.example");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

async function main() {
  for (const d of destinations) {
    const data = {
      name: d.name,
      country: d.country,
      region: d.region,
      tagline: d.tagline,
      summary: d.summary,
      latitude: d.lat,
      longitude: d.lng,
      elevation: d.elevation,
      timezone: d.timezone,
      bestSeason: d.bestSeason,
      heroImage: d.heroImage,
      heroImageCredit: d.heroImageCredit,
      cameraHeading: d.camera.heading,
      cameraPitch: d.camera.pitch,
      cameraRange: d.camera.range,
      sortOrder: d.sortOrder,
    };
    const destination = await prisma.destination.upsert({
      where: { slug: d.slug },
      create: { slug: d.slug, ...data },
      update: data,
    });

    for (const [index, a] of d.attractions.entries()) {
      const attraction = {
        destinationId: destination.id,
        name: a.name,
        category: a.category,
        summary: a.summary,
        description: a.description,
        latitude: a.lat,
        longitude: a.lng,
        elevation: a.elevation,
        focusHeight: a.focusHeight,
        viewRange: a.viewRange,
        viewHeading: a.viewHeading,
        viewPitch: a.viewPitch,
        imageUrl: a.imageUrl,
        imageCredit: a.imageCredit,
        bestTime: a.bestTime,
        visitDuration: a.visitDuration,
        sortOrder: index,
      };
      await prisma.attraction.upsert({ where: { slug: a.slug }, create: { slug: a.slug, ...attraction }, update: attraction });
    }
    console.log(`  ✓ ${d.name} (${d.attractions.length} attractions)`);
  }

  for (const [index, p] of packages.entries()) {
    const destination = await prisma.destination.findUniqueOrThrow({ where: { slug: p.destinationSlug } });
    const data = {
      destinationId: destination.id,
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
      hotelName: p.hotel.name,
      hotelStars: p.hotel.stars,
      hotelArea: p.hotel.area,
      hotelDescription: p.hotel.description,
      hotelAmenities: p.hotel.amenities,
      featured: p.featured,
      sortOrder: index,
    };
    const pkg = await prisma.tourPackage.upsert({ where: { slug: p.slug }, create: { slug: p.slug, ...data }, update: data });
    await prisma.itineraryDay.deleteMany({ where: { packageId: pkg.id } });
    await prisma.itineraryDay.createMany({
      data: p.itinerary.map((day) => ({ packageId: pkg.id, ...day })),
    });
  }
  console.log(`  ✓ ${packages.length} tour packages`);
}

main()
  .then(() => console.log("Seed complete."))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
