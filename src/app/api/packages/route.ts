import type { NextRequest } from "next/server";
import { listPackages } from "@/server/repositories/catalog";
import { handleRouteError } from "@/server/http";

// GET /api/packages?destination=paris
export async function GET(request: NextRequest) {
  try {
    const destinationSlug = request.nextUrl.searchParams.get("destination") ?? undefined;
    return Response.json({ packages: await listPackages({ destinationSlug }) });
  } catch (error) {
    return handleRouteError(error);
  }
}
