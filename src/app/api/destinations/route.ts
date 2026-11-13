import { listDestinations } from "@/server/repositories/catalog";
import { handleRouteError } from "@/server/http";

// GET /api/destinations — curated destination summaries.
export async function GET() {
  try {
    return Response.json({ destinations: await listDestinations() });
  } catch (error) {
    return handleRouteError(error);
  }
}
