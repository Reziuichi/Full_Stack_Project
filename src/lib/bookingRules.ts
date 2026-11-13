// The rules a booking must meet, in plain data so the browser can check a
// field the moment it's left without shipping zod. The server's schema
// (validation.ts) is built from the same limits and messages, and stays the
// authority: the API re-checks everything.

export const BOOKING_LIMITS = {
  nameMin: 2,
  nameMax: 120,
  emailMax: 200,
  travelersMin: 1,
  travelersMax: 12,
  /** Departures need this many days' notice. */
  noticeDays: 3,
  originMax: 120,
  notesMax: 1000,
} as const;

export const PHONE_PATTERN = /^[+()\d\s-]{7,20}$/;
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// Close to what zod's email check accepts; the server makes the final call.
const EMAIL_PATTERN = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

export const BOOKING_MESSAGES = {
  leadName: "Enter the lead traveller's full name",
  email: "Enter a valid email address",
  phone: "Enter a phone number with country code, e.g. +91 98140 27715",
  travelersMin: "At least one traveller",
  travelersMax: "For groups above 12, contact us",
  travelDateFormat: "Use the date picker to choose a travel date",
  travelDateNotice: "Departures need at least 3 days' notice",
  tooLong: (max: number) => `Keep this under ${max} characters`,
} as const;

/** The earliest departure (YYYY-MM-DD, UTC), given today. */
export function earliestDeparture(today = new Date()): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + BOOKING_LIMITS.noticeDays));
  return d.toISOString().slice(0, 10);
}

/** True when an ISO date leaves enough notice. */
export function hasNotice(iso: string, today = new Date()): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const min = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + BOOKING_LIMITS.noticeDays);
  return Date.UTC(y, m - 1, d) >= min;
}

export type BookingField = "leadName" | "email" | "phone" | "travelers" | "travelDate" | "originCity" | "notes";

/** The browser-side check for one field: an error message, or null. */
export function checkBookingField(field: BookingField, raw: string | number): string | null {
  const value = typeof raw === "string" ? raw.trim() : raw;
  switch (field) {
    case "leadName":
      return String(value).length < BOOKING_LIMITS.nameMin || String(value).length > BOOKING_LIMITS.nameMax ? BOOKING_MESSAGES.leadName : null;
    case "email":
      return !EMAIL_PATTERN.test(String(value)) || String(value).length > BOOKING_LIMITS.emailMax ? BOOKING_MESSAGES.email : null;
    case "phone":
      return PHONE_PATTERN.test(String(value)) ? null : BOOKING_MESSAGES.phone;
    case "travelers": {
      const n = Number(value);
      if (!Number.isInteger(n) || n < BOOKING_LIMITS.travelersMin) return BOOKING_MESSAGES.travelersMin;
      return n > BOOKING_LIMITS.travelersMax ? BOOKING_MESSAGES.travelersMax : null;
    }
    case "travelDate":
      if (!ISO_DATE_PATTERN.test(String(value))) return BOOKING_MESSAGES.travelDateFormat;
      return hasNotice(String(value)) ? null : BOOKING_MESSAGES.travelDateNotice;
    case "originCity":
      return String(value).length > BOOKING_LIMITS.originMax ? BOOKING_MESSAGES.tooLong(BOOKING_LIMITS.originMax) : null;
    case "notes":
      return String(value).length > BOOKING_LIMITS.notesMax ? BOOKING_MESSAGES.tooLong(BOOKING_LIMITS.notesMax) : null;
  }
}
