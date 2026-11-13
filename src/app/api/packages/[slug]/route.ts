import type { NextRequest } from "next/server";
import { getPackage } from "@/server/repositories/catalog";
import { handleRouteError, jsonError } from "@/server/http";

// GET /api/packages/:slug
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/packages/[slug]">) {
  try {
    const { slug } = await ctx.params;
    const tourPackage = await getPackage(slug);
    if (!tourPackage) return jsonError(404, "NOT_FOUND", `No package "${slug}"`);
    return Response.json({ package: tourPackage });
  } catch (error) {
    return handleRouteError(error);
  }
}
