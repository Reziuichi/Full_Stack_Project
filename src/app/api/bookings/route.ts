import type { NextRequest } from "next/server";
import { bookingSchema, fieldErrors } from "@/lib/validation";
import { createBooking, PackageNotFoundError } from "@/server/repositories/bookings";
import { getSessionUser } from "@/server/auth";
import { handleRouteError, jsonError } from "@/server/http";

// POST /api/bookings — create a confirmed booking.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = bookingSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(422, "VALIDATION_FAILED", "Please fix the highlighted fields.", { fields: fieldErrors(parsed.error) });
    }
    const user = await getSessionUser();
    const booking = await createBooking(parsed.data, user?.id ?? null);
    return Response.json({ booking }, { status: 201 });
  } catch (error) {
    if (error instanceof PackageNotFoundError) return jsonError(404, "PACKAGE_NOT_FOUND", error.message);
    return handleRouteError(error);
  }
}
