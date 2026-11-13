import type { NextRequest } from "next/server";
import { fieldErrors, loginSchema } from "@/lib/validation";
import { verifyPassword } from "@/server/auth";
import { issueOtp } from "@/server/otp";
import { findUserForLogin } from "@/server/repositories/users";
import { handleRouteError, jsonError } from "@/server/http";

/**
 * Step one of signing in: the password. Right, and a code is emailed; the
 * session only starts at /api/auth/otp/verify when the code comes back.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = loginSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError(422, "VALIDATION_FAILED", "Please fix the highlighted fields.", { fields: fieldErrors(parsed.error) });
    }
    const user = await findUserForLogin(parsed.data.email);
    const ok = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
    if (!user || !ok) return jsonError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    const otp = await issueOtp({ email: user.email, purpose: "LOGIN", payload: { userId: user.id } });
    return Response.json({ otp }, { status: 202 });
  } catch (error) {
    return handleRouteError(error);
  }
}
