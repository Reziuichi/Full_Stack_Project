import type { NextRequest } from "next/server";
import { fieldErrors, otpVerifySchema } from "@/lib/validation";
import { setSessionCookie } from "@/server/auth";
import { OtpError, verifyOtp } from "@/server/otp";
import { confirmUserEmail, createUser, EmailTakenError } from "@/server/repositories/users";
import { handleRouteError, jsonError } from "@/server/http";

/**
 * Step two: the emailed code. Right, and the account is created (sign-up) or
 * found (sign-in), the address is marked verified and the session starts.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = otpVerifySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError(422, "VALIDATION_FAILED", "Enter the 6-digit code from the email.", { fields: fieldErrors(parsed.error) });
    }
    const { email, purpose, payload } = await verifyOtp(parsed.data.challenge, parsed.data.code);
    const data = payload as { name?: string; passwordHash?: string; userId?: string };

    const user =
      purpose === "REGISTER"
        ? await createUser({ name: String(data.name), email, passwordHash: String(data.passwordHash), emailVerifiedAt: new Date() })
        : await confirmUserEmail(String(data.userId));
    if (!user) throw new OtpError("OTP_NOT_FOUND", "This account no longer exists. Start again.", 404);

    await setSessionCookie(user.id);
    return Response.json({ user }, { status: purpose === "REGISTER" ? 201 : 200 });
  } catch (error) {
    if (error instanceof EmailTakenError) {
      return jsonError(409, "EMAIL_TAKEN", error.message, { fields: { email: error.message } });
    }
    return handleRouteError(error);
  }
}
