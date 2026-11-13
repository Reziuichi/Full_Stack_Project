import type { NextRequest } from "next/server";
import { reverseGeocode } from "@/server/services/geocoding";
import { handleRouteError, jsonError, parseCoordinate } from "@/server/http";

// GET /api/places/reverse?lat=30.73&lng=76.78
export async function GET(request: NextRequest) {
  try {
    const lat = parseCoordinate(request.nextUrl.searchParams.get("lat"), -90, 90);
    const lng = parseCoordinate(request.nextUrl.searchParams.get("lng"), -180, 180);
    if (lat === null || lng === null) return jsonError(400, "BAD_COORDINATES", "lat and lng are required");
    const place = await reverseGeocode(lat, lng);
    return Response.json({ place });
  } catch (error) {
    return handleRouteError(error);
  }
}
