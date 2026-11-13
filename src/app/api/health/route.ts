import { databaseStatus } from "@/server/db";
import { geocodingProvider } from "@/server/services/geocoding";
import { hasCesiumIonToken } from "@/lib/env";

// GET /api/health — configuration status for the HUD and for debugging setup.
export async function GET() {
  const db = await databaseStatus();
  return Response.json({
    database: db,
    cesiumIon: hasCesiumIonToken() ? "configured" : "missing NEXT_PUBLIC_CESIUM_ION_TOKEN",
    geocoding: geocodingProvider(),
  });
}
