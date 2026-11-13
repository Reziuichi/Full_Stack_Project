// Minimal email + password authentication.
// Passwords: scrypt with a per-user salt. Sessions: a stateless HMAC-signed
// cookie ({ uid, exp }) — no session table needed.

import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { serverEnv } from "@/lib/env";
import { withDb, DatabaseUnavailableError } from "@/server/db";
import type { SessionUser } from "@/lib/types";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const SESSION_COOKIE = "lgt_session";
const SESSION_TTL_S = 60 * 60 * 24 * 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64url");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}

function sign(payload: string) {
  return createHmac("sha256", serverEnv.authSecret).update(payload).digest("base64url");
}

export function createSessionToken(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S })).toString(
    "base64url",
  );
  return `${payload}.${sign(payload)}`;
}

export function readSessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { uid: string; exp: number };
    if (!uid || exp < Date.now() / 1000) return null;
    return uid;
  } catch {
    return null;
  }
}

export async function setSessionCookie(userId: string) {
  (await cookies()).set(SESSION_COOKIE, createSessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The signed-in user, or null. Never throws when the database is down. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const uid = readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!uid) return null;
  try {
    return await withDb((db) => db.user.findUnique({ where: { id: uid }, select: { id: true, email: true, name: true } }));
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) return null;
    throw error;
  }
}
