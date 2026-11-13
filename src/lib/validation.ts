import { z } from "zod";
import { BOOKING_LIMITS as L, BOOKING_MESSAGES as M, hasNotice, ISO_DATE_PATTERN, PHONE_PATTERN } from "./bookingRules";

const isoDate = z.string().regex(ISO_DATE_PATTERN, M.travelDateFormat);

// The same limits and messages the booking page checks in the browser (bookingRules.ts).
export const bookingSchema = z.object({
  packageSlug: z.string().min(1),
  leadName: z.string().trim().min(L.nameMin, M.leadName).max(L.nameMax),
  email: z.email(M.email).max(L.emailMax),
  phone: z.string().trim().regex(PHONE_PATTERN, M.phone),
  travelers: z.coerce.number().int().min(L.travelersMin, M.travelersMin).max(L.travelersMax, M.travelersMax),
  travelDate: isoDate.refine((value) => hasNotice(value), M.travelDateNotice),
  originCity: z.string().trim().max(L.originMax).optional().or(z.literal("")),
  notes: z.string().trim().max(L.notesMax).optional().or(z.literal("")),
});

export type BookingInput = z.infer<typeof bookingSchema>;

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  email: z.email("Enter a valid email address").max(200),
  password: z.string().min(8, "Use at least 8 characters").max(200),
});

export const loginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export const otpVerifySchema = z.object({
  challenge: z.string().min(16).max(64),
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from the email"),
});

export const otpResendSchema = z.object({
  challenge: z.string().min(16).max(64),
});

export const lookupSchema = z.object({
  reference: z.string().trim().min(6).max(20),
  email: z.email(),
});

/** Flatten zod issues into { field: message } for inline form errors. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
