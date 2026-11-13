import type { NextRequest } from "next/server";
import { fieldErrors, registerSchema } from "@/lib/validation";
import { hashPassword } from "@/server/auth";
import { issueOtp } from "@/server/otp";
import { emailInUse } from "@/server/repositories/users";
import { handleRouteError, jsonError } from "@/server/http";

/**
 * Step one of creating an account: check the details and email a code. The
 * account itself is created by /api/auth/otp/verify once the code comes back,
 * so an address nobody can read never gets an account.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = registerSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError(422, "VALIDATION_FAILED", "Please fix the highlighted fields.", { fields: fieldErrors(parsed.error) });
    }
    const { name, email, password } = parsed.data;
    if (await emailInUse(email)) {
      const message = "An account with this email already exists";
      return jsonError(409, "EMAIL_TAKEN", message, { fields: { email: message } });
    }
    const otp = await issueOtp({ email, purpose: "REGISTER", payload: { name, passwordHash: await hashPassword(password) } });
    return Response.json({ otp }, { status: 202 });
  } catch (error) {
    return handleRouteError(error);
  }
}
