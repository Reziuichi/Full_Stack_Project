// Prisma client singleton + database availability tracking.
//
// The site must keep working (and the 3D Earth must render) when Postgres is
// not running, so callers either:
//   • use `withDb()` — throws DatabaseUnavailableError with a helpful message
//     (bookings, accounts), or
//   • use `tryDb()` — returns null so the caller can serve bundled catalog data.

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { serverEnv } from "@/lib/env";

type Status = { ok: boolean; reason?: string; checkedAt: number };

const globalForDb = globalThis as unknown as {
  __prisma?: PrismaClient;
  __prismaUrl?: string;
  __dbStatus?: Status;
  __dbWarned?: boolean;
};

const RETRY_AFTER_MS = 15_000;

export class DatabaseUnavailableError extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = "DatabaseUnavailableError";
  }
}

function client(): PrismaClient | null {
  const url = serverEnv.databaseUrl;
  if (!url) return null;
  // Rebuild if DATABASE_URL changed (e.g. .env.local edited while `next dev` runs).
  if (!globalForDb.__prisma || globalForDb.__prismaUrl !== url) {
    void globalForDb.__prisma?.$disconnect().catch(() => {});
    const adapter = new PrismaPg({ connectionString: url, connectionTimeoutMillis: 2500, max: 5 });
    globalForDb.__prisma = new PrismaClient({ adapter, log: ["error"] });
    globalForDb.__prismaUrl = url;
    globalForDb.__dbStatus = undefined;
  }
  return globalForDb.__prisma;
}

function errorText(error: unknown): string {
  const e = error as {
    code?: string;
    message?: string;
    meta?: { driverAdapterError?: { cause?: { originalMessage?: string; kind?: string } } };
    cause?: unknown;
  };
  const adapter = e?.meta?.driverAdapterError?.cause;
  const cause = e?.cause instanceof Error ? e.cause.message : "";
  return [e?.code, e?.message, adapter?.originalMessage, adapter?.kind, cause].filter(Boolean).join(" ");
}

function describe(error: unknown): string {
  const code = (error as { code?: string })?.code;
  const text = errorText(error);
  if (code === "P2021" || code === "P2022" || /relation .* does not exist/i.test(text)) {
    return "The database is reachable but not migrated. Run `npm run db:setup`.";
  }
  if (code === "P1000" || /password authentication failed|AuthenticationFailed/i.test(text)) {
    return "A PostgreSQL server answered but rejected the credentials in DATABASE_URL — check the port isn't used by another Postgres (Longitude uses 5433).";
  }
  if (code === "P1003" || /database .* does not exist|DatabaseDoesNotExist/i.test(text)) {
    return "The database named in DATABASE_URL does not exist. Start Longitude's Postgres with `npm run db:local` or `npm run db:up`.";
  }
  if (code === "P1001" || /ECONNREFUSED|connect|timeout|ENOTFOUND|Can't reach/i.test(text)) {
    return "PostgreSQL is not reachable. Start it with `npm run db:local` (no Docker) or `npm run db:up` (Docker), then run `npm run db:setup`.";
  }
  const line = text.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "unknown error";
  return `Database error: ${line}`;
}

function markDown(error: unknown) {
  const reason = describe(error);
  globalForDb.__dbStatus = { ok: false, reason, checkedAt: Date.now() };
  if (!globalForDb.__dbWarned) {
    globalForDb.__dbWarned = true;
    console.warn(`[db] ${reason} Serving bundled catalog data instead.`);
  }
  return reason;
}

function recentlyDown(): Status | null {
  const s = globalForDb.__dbStatus;
  if (s && !s.ok && Date.now() - s.checkedAt < RETRY_AFTER_MS) return s;
  return null;
}

/** Run a query that requires the database. */
export async function withDb<T>(fn: (db: PrismaClient) => Promise<T>): Promise<T> {
  const db = client();
  if (!db) throw new DatabaseUnavailableError("DATABASE_URL is not set. See .env.example.");
  const down = recentlyDown();
  if (down) throw new DatabaseUnavailableError(down.reason ?? "Database unavailable");
  try {
    const result = await fn(db);
    globalForDb.__dbStatus = { ok: true, checkedAt: Date.now() };
    globalForDb.__dbWarned = false;
    return result;
  } catch (error) {
    // Constraint / validation errors are real errors, not outages.
    if (!isOutage(error)) throw error;
    throw new DatabaseUnavailableError(markDown(error));
  }
}

const NETWORK_CODES = /^(ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE)/;

function isOutage(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  if (code === "P2021" || code === "P2022") return true; // table/column missing → not migrated
  if (typeof code === "string" && (code.startsWith("P1") || NETWORK_CODES.test(code))) return true; // connection-level
  if (typeof code === "string" && code.startsWith("P2")) return false; // query-level
  return /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|timeout|Connection terminated|Can't reach database|connect|password authentication failed|AuthenticationFailed|does not exist/i.test(
    errorText(error),
  );
}

/** Run a query, or return null when the database is unavailable. */
export async function tryDb<T>(fn: (db: PrismaClient) => Promise<T>): Promise<T | null> {
  try {
    return await withDb(fn);
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) return null;
    throw error;
  }
}

export async function databaseStatus(): Promise<{ state: "connected" | "unavailable" | "not-configured"; reason?: string }> {
  if (!serverEnv.databaseUrl) return { state: "not-configured", reason: "DATABASE_URL is not set." };
  try {
    await withDb((db) => db.$queryRaw`SELECT 1`);
    const seeded = await withDb((db) => db.destination.count());
    if (seeded === 0) return { state: "unavailable", reason: "The database is empty. Run `npm run db:seed`." };
    return { state: "connected" };
  } catch (error) {
    return { state: "unavailable", reason: error instanceof Error ? error.message : String(error) };
  }
}
