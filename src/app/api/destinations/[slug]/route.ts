import type { NextRequest } from "next/server";
import { getDestination, listPackages } from "@/server/repositories/catalog";
import { handleRouteError, jsonError } from "@/server/http";

// GET /api/destinations/:slug — destination with attractions and its packages.
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/destinations/[slug]">) {
  try {
    const { slug } = await ctx.params;
    const destination = await getDestination(slug);
    if (!destination) return jsonError(404, "NOT_FOUND", `No destination "${slug}"`);
    const packages = await listPackages({ destinationSlug: slug });
    return Response.json({ destination, packages });
  } catch (error) {
    return handleRouteError(error);
  }
}
