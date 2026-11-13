// What a failed sign-in or sign-up says, in the language of an airport:
// a departures-board status and line, a stamp for the pass, and which fields
// to flag. Denied (red) is about the traveller's details; on hold and delayed
// (amber) are about the form or the service.

export type FailureTone = "denied" | "hold" | "delayed";

export interface Failure {
  /** Increments on every failure, so repeat failures replay their animations. */
  key: number;
  tone: FailureTone;
  /** The board's status word. */
  status: string;
  /** The line that flips in on the board (and is announced to screen readers). */
  board: string;
  stamp: { top: string; bottom: string; code: string };
  /** Fields to flag even without a field-level message. */
  flag: string[];
  /** Offer to switch to signing in (the email already has an account). */
  action?: "login";
}

export function describeFailure(input: { status: number | "network"; code?: string; message?: string }, key: number): Failure {
  const { status, code, message } = input;
  if (status === "network") {
    return {
      key,
      tone: "delayed",
      status: "Delayed",
      board: "No signal. Check your connection and try again.",
      stamp: { top: "Flight", bottom: "Delayed", code: "ERR NET · NO SIGNAL" },
      flag: [],
    };
  }
  switch (code) {
    case "INVALID_CREDENTIALS":
      return {
        key,
        tone: "denied",
        status: "Denied",
        board: "Email and password don't match any pass.",
        stamp: { top: "Boarding", bottom: "Denied", code: "ERR 401 · CREDENTIALS" },
        flag: ["email", "password"],
      };
    case "EMAIL_TAKEN":
      return {
        key,
        tone: "denied",
        status: "Denied",
        board: "This email already holds a pass.",
        stamp: { top: "Boarding", bottom: "Denied", code: "ERR 409 · EMAIL IN USE" },
        flag: ["email"],
        action: "login",
      };
    case "VALIDATION_FAILED":
      return {
        key,
        tone: "hold",
        status: "On hold",
        board: "A few details need fixing. See the marked fields.",
        stamp: { top: "Boarding", bottom: "On hold", code: "ERR 422 · CHECK FIELDS" },
        flag: [],
      };
    case "OTP_RATE_LIMITED":
      return {
        key,
        tone: "hold",
        status: "On hold",
        board: message || "Too many codes sent to this address. Try again in an hour.",
        stamp: { top: "Boarding", bottom: "On hold", code: "ERR 429 · TOO MANY CODES" },
        flag: ["email"],
      };
    case "OTP_SEND_FAILED":
      return {
        key,
        tone: "delayed",
        status: "Delayed",
        board: message || "We couldn't send your code. Try again in a moment.",
        stamp: { top: "Code", bottom: "Delayed", code: "ERR MAIL · NOT SENT" },
        flag: [],
      };
    case "DATABASE_UNAVAILABLE":
      return {
        key,
        tone: "delayed",
        status: "Delayed",
        board: "Accounts are offline for a moment. Try again soon.",
        stamp: { top: "Flight", bottom: "Delayed", code: "ERR 503 · OFFLINE" },
        flag: [],
      };
  }
  if (status >= 500) {
    return {
      key,
      tone: "delayed",
      status: "Delayed",
      board: "Turbulence on our side. Try again in a moment.",
      stamp: { top: "Flight", bottom: "Delayed", code: `ERR ${status} · SERVER` },
      flag: [],
    };
  }
  return {
    key,
    tone: "denied",
    status: "Denied",
    board: message || "Something went wrong. Try again.",
    stamp: { top: "Boarding", bottom: "Denied", code: `ERR ${status}` },
    flag: [],
  };
}
