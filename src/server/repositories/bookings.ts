import { randomInt } from "node:crypto";
import { withDb } from "@/server/db";
import { priceBreakdown } from "@/lib/format";
import type { BookingInput } from "@/lib/validation";
import type { BookingRecord } from "@/lib/types";
import type { Prisma } from "@/generated/prisma/client";

type DbBooking = Prisma.BookingGetPayload<{ include: { package: { include: { destination: true } } } }>;

const include = { package: { include: { destination: true } } } as const;

// Crockford-style alphabet without I, L, O, U to avoid misreads over the phone.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function newReference(): string {
  const pick = (n: number) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `LGT-${pick(4)}-${pick(3)}`;
}

function map(b: DbBooking): BookingRecord {
  return {
    reference: b.reference,
    status: b.status,
    packageSlug: b.package.slug,
    packageName: b.package.name,
    destinationName: b.package.destination.name,
    durationDays: b.package.durationDays,
    leadName: b.leadName,
    email: b.email,
    phone: b.phone,
    travelers: b.travelers,
    travelDate: b.travelDate.toISOString().slice(0, 10),
    originCity: b.originCity,
    notes: b.notes,
    unitPriceInr: b.unitPriceInr,
    taxesInr: b.taxesInr,
    totalInr: b.totalInr,
    createdAt: b.createdAt.toISOString(),
  };
}

export class PackageNotFoundError extends Error {}

export async function createBooking(input: BookingInput, userId: string | null): Promise<BookingRecord> {
  return withDb(async (db) => {
    const pkg = await db.tourPackage.findUnique({ where: { slug: input.packageSlug } });
    if (!pkg) throw new PackageNotFoundError(`Unknown package "${input.packageSlug}"`);

    // Price always comes from the database, never from the client.
    const { taxes, total } = priceBreakdown(pkg.priceInr, input.travelers);
    const [y, m, d] = input.travelDate.split("-").map(Number);

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const booking = await db.booking.create({
          data: {
            reference: newReference(),
            packageId: pkg.id,
            userId,
            leadName: input.leadName,
            email: input.email.toLowerCase(),
            phone: input.phone,
            travelers: input.travelers,
            travelDate: new Date(Date.UTC(y, m - 1, d)),
            originCity: input.originCity || null,
            notes: input.notes || null,
            unitPriceInr: pkg.priceInr,
            taxesInr: taxes,
            totalInr: total,
            status: "CONFIRMED",
          },
          include,
        });
        return map(booking);
      } catch (error) {
        if ((error as { code?: string }).code === "P2002") continue; // reference collision, retry
        throw error;
      }
    }
    throw new Error("Could not allocate a booking reference");
  });
}

export async function findBooking(reference: string, email: string): Promise<BookingRecord | null> {
  return withDb(async (db) => {
    const b = await db.booking.findUnique({ where: { reference: reference.toUpperCase() }, include });
    if (!b || b.email !== email.toLowerCase()) return null;
    return map(b);
  });
}

export async function getBookingByReference(reference: string): Promise<BookingRecord | null> {
  return withDb(async (db) => {
    const b = await db.booking.findUnique({ where: { reference: reference.toUpperCase() }, include });
    return b ? map(b) : null;
  });
}

export async function listBookingsForUser(userId: string, email: string): Promise<BookingRecord[]> {
  return withDb(async (db) => {
    const rows = await db.booking.findMany({
      where: { OR: [{ userId }, { email: email.toLowerCase() }] },
      include,
      orderBy: { travelDate: "asc" },
    });
    return rows.map(map);
  });
}
