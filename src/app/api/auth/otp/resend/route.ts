import type { NextRequest } from "next/server";
import { otpResendSchema } from "@/lib/validation";
import { resendOtp } from "@/server/otp";
import { handleRouteError, jsonError } from "@/server/http";

/** Emails a fresh code for an open challenge (the previous code stops working). */
export async function POST(request: NextRequest) {
  try {
    const parsed = otpResendSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(422, "VALIDATION_FAILED", "Start again to get a new code.");
    return Response.json({ otp: await resendOtp(parsed.data.challenge) });
  } catch (error) {
    return handleRouteError(error);
  }
}
