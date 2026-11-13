import type { NextRequest } from "next/server";
import { findAttractionsNear } from "@/server/services/attractions";
import { handleRouteError, jsonError, parseCoordinate } from "@/server/http";

// GET /api/attractions/nearby?lat=41.89&lng=12.49&name=Rome
// Used when the traveller picks a place outside the curated catalog.
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const lat = parseCoordinate(params.get("lat"), -90, 90);
    const lng = parseCoordinate(params.get("lng"), -180, 180);
    const name = (params.get("name") ?? "").slice(0, 80);
    if (lat === null || lng === null) return jsonError(400, "BAD_COORDINATES", "lat and lng are required");
    return Response.json(await findAttractionsNear(name, lat, lng));
  } catch (error) {
    return handleRouteError(error);
  }
}
