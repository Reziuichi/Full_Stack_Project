import { getSessionUser } from "@/server/auth";

export async function GET() {
  return Response.json({ user: await getSessionUser() });
}
