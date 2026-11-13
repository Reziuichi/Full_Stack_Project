import { DatabaseUnavailableError } from "@/server/db";
import { OtpError } from "@/server/otp";

export function jsonError(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return Response.json({ error: { code, message, ...extra } }, { status });
}

/** Map thrown errors to consistent JSON responses. */
export function handleRouteError(error: unknown) {
  if (error instanceof DatabaseUnavailableError) {
    return jsonError(503, "DATABASE_UNAVAILABLE", error.reason);
  }
  if (error instanceof OtpError) {
    return jsonError(error.status, error.code, error.message, error.extra);
  }
  console.error(error);
  return jsonError(500, "INTERNAL_ERROR", "Something went wrong on our side. Please try again.");
}

export function parseCoordinate(value: string | null, min: number, max: number): number | null {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
