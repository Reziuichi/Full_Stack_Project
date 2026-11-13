// Email one-time codes. A six-digit code, sent by email, proves the traveller
// owns the address: creating an account waits for it (the account only exists
// once the code is entered) and signing in asks for it after the password.
//
// The browser holds a random challenge id; the database keeps an HMAC of the
// code, never the code. A code lives 10 minutes and allows 5 guesses; another
// can be sent after 30 seconds, up to 5 times per challenge; one address gets
// at most 6 challenges an hour.

import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { withDb } from "@/server/db";
import { MailNotConfiguredError, sendCodeEmail, type Delivery } from "@/server/mail";
import type { OtpPurpose, Prisma } from "@/generated/prisma/client";

export const OTP = {
  length: 6,
  ttlMs: 10 * 60_000,
  maxAttempts: 5,
  resendAfterMs: 30_000,
  maxSends: 5,
  perHour: 6,
} as const;

export type OtpErrorCode = "OTP_INVALID" | "OTP_EXPIRED" | "OTP_LOCKED" | "OTP_NOT_FOUND" | "OTP_RATE_LIMITED" | "OTP_RESEND_TOO_SOON" | "OTP_SEND_FAILED";

export class OtpError extends Error {
  constructor(
    public code: OtpErrorCode,
    message: string,
    public status: number,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "OtpError";
  }
}

/** What the browser needs to show the code step. */
export type OtpTicket = {
  challenge: string;
  email: string;
  purpose: OtpPurpose;
  length: number;
  expiresAt: string;
  resendAt: string;
  attemptsLeft: number;
  maxAttempts: number;
  /** Development without SMTP only: the code, so the flow can be tried without email. */
  devCode?: string;
};

const hashCode = (challenge: string, code: string) => createHmac("sha256", serverEnv.authSecret).update(`otp:${challenge}:${code}`).digest("base64url");

const newCode = () => String(randomInt(0, 10 ** OTP.length)).padStart(OTP.length, "0");

function sameHash(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function deliver(to: string, code: string, purpose: OtpPurpose): Promise<Delivery> {
  try {
    return await sendCodeEmail({ to, code, purpose, minutes: OTP.ttlMs / 60_000 });
  } catch (error) {
    if (error instanceof MailNotConfiguredError) throw new OtpError("OTP_SEND_FAILED", "Email isn't set up on this server yet, so no code can be sent.", 503);
    console.error("[otp] sending the code failed:", error);
    throw new OtpError("OTP_SEND_FAILED", "We couldn't send the email. Try again in a moment.", 502);
  }
}

function ticket(
  row: { id: string; email: string; purpose: OtpPurpose; expiresAt: Date; lastSentAt: Date; attempts: number },
  delivery: Delivery,
  code: string,
): OtpTicket {
  return {
    challenge: row.id,
    email: row.email,
    purpose: row.purpose,
    length: OTP.length,
    expiresAt: row.expiresAt.toISOString(),
    resendAt: new Date(row.lastSentAt.getTime() + OTP.resendAfterMs).toISOString(),
    attemptsLeft: OTP.maxAttempts - row.attempts,
    maxAttempts: OTP.maxAttempts,
    ...(delivery === "console" ? { devCode: code } : {}),
  };
}

/** Starts a challenge for the address and emails its code. */
export async function issueOtp(input: { email: string; purpose: OtpPurpose; payload: Prisma.InputJsonValue }): Promise<OtpTicket> {
  const email = input.email.toLowerCase();
  const now = Date.now();
  const recent = await withDb(async (db) => {
    // Tidy up: challenges a day past expiry are no use to anyone.
    await db.otpChallenge.deleteMany({ where: { expiresAt: { lt: new Date(now - 86_400_000) } } });
    return db.otpChallenge.count({ where: { email, createdAt: { gt: new Date(now - 3_600_000) } } });
  });
  if (recent >= OTP.perHour) {
    throw new OtpError("OTP_RATE_LIMITED", "Too many codes sent to this address. Try again in an hour.", 429, { retryAfter: 3600 });
  }
  const id = randomBytes(24).toString("base64url");
  const code = newCode();
  const created = await withDb((db) =>
    db.otpChallenge.create({
      data: {
        id,
        email,
        purpose: input.purpose,
        codeHash: hashCode(id, code),
        payload: input.payload,
        expiresAt: new Date(now + OTP.ttlMs),
        lastSentAt: new Date(now),
      },
    }),
  );
  try {
    return ticket(created, await deliver(email, code, input.purpose), code);
  } catch (error) {
    // Nothing was sent, so the challenge is no use (and shouldn't count against the address).
    await withDb((db) => db.otpChallenge.delete({ where: { id } })).catch(() => {});
    throw error;
  }
}

async function live(challenge: string) {
  const row = await withDb((db) => db.otpChallenge.findUnique({ where: { id: challenge } }));
  if (!row || row.consumedAt) throw new OtpError("OTP_NOT_FOUND", "This code is no longer valid. Start again.", 404);
  return row;
}

/** Sends a fresh code for a challenge (the old one stops working). */
export async function resendOtp(challenge: string): Promise<OtpTicket> {
  const row = await live(challenge);
  const now = Date.now();
  const wait = row.lastSentAt.getTime() + OTP.resendAfterMs - now;
  if (wait > 0) {
    throw new OtpError("OTP_RESEND_TOO_SOON", "Give it a moment before asking for another code.", 429, { retryAfter: Math.ceil(wait / 1000) });
  }
  if (row.sends >= OTP.maxSends) {
    throw new OtpError("OTP_RATE_LIMITED", "That's as many codes as we'll send for this attempt. Start again.", 429);
  }
  const code = newCode();
  const updated = await withDb((db) =>
    db.otpChallenge.update({
      where: { id: row.id },
      data: { codeHash: hashCode(row.id, code), attempts: 0, sends: { increment: 1 }, lastSentAt: new Date(now), expiresAt: new Date(now + OTP.ttlMs) },
    }),
  );
  return ticket(updated, await deliver(row.email, code, row.purpose), code);
}

/**
 * Checks a code. Right: the challenge is used up and its email and payload
 * returned. Wrong: one guess is spent (the last one locks the challenge).
 */
export async function verifyOtp(challenge: string, code: string) {
  const row = await live(challenge);
  if (row.expiresAt.getTime() < Date.now()) throw new OtpError("OTP_EXPIRED", "This code has expired. Send yourself a new one.", 410);
  if (row.attempts >= OTP.maxAttempts) throw new OtpError("OTP_LOCKED", "Too many wrong codes. Send yourself a new one.", 429, { attemptsLeft: 0 });

  if (!sameHash(hashCode(row.id, code), row.codeHash)) {
    // Spend a guess, but never past the limit (two tabs guessing at once).
    const spent = await withDb((db) =>
      db.otpChallenge.updateMany({ where: { id: row.id, attempts: { lt: OTP.maxAttempts } }, data: { attempts: { increment: 1 } } }),
    );
    const attemptsLeft = spent.count ? OTP.maxAttempts - row.attempts - 1 : 0;
    if (attemptsLeft <= 0) throw new OtpError("OTP_LOCKED", "Too many wrong codes. Send yourself a new one.", 429, { attemptsLeft: 0 });
    throw new OtpError("OTP_INVALID", "That code doesn't match.", 401, { attemptsLeft });
  }

  // Use it up exactly once, even if the same code arrives twice.
  const used = await withDb((db) => db.otpChallenge.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } }));
  if (!used.count) throw new OtpError("OTP_NOT_FOUND", "This code is no longer valid. Start again.", 404);
  return { email: row.email, purpose: row.purpose, payload: row.payload };
}
