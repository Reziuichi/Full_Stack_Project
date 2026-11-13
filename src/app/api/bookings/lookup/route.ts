import type { NextRequest } from "next/server";
import { lookupSchema } from "@/lib/validation";
import { findBooking } from "@/server/repositories/bookings";
import { handleRouteError, jsonError } from "@/server/http";

// POST /api/bookings/lookup { reference, email } — guest booking lookup.
// A POST body keeps the email out of URLs and access logs.
export async function POST(request: NextRequest) {
  try {
    const parsed = lookupSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(422, "VALIDATION_FAILED", "Enter your booking reference and the email used to book.");
    const booking = await findBooking(parsed.data.reference, parsed.data.email);
    if (!booking) return jsonError(404, "NOT_FOUND", "No booking matches that reference and email.");
    return Response.json({ booking });
  } catch (error) {
    return handleRouteError(error);
  }
}
