"use client";

import { useState } from "react";
import Link from "next/link";
import type { BookingRecord } from "@/lib/types";
import { formatInr, formatIsoDate } from "@/lib/format";

/** Find a guest booking by reference + email (sent as a POST body, never in the URL). */
export function BookingLookup() {
  const [result, setResult] = useState<BookingRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const res = await fetch("/api/bookings/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error?.message ?? "Lookup failed");
      else setResult(json.booking);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
        <div className="grid gap-2">
          <label htmlFor="lookup-ref" className="text-sm text-dim">
            Booking reference
          </label>
          <input id="lookup-ref" name="reference" className="field font-mono uppercase" placeholder="LGT-XXXX-XXX" required />
        </div>
        <div className="grid gap-2">
          <label htmlFor="lookup-email" className="text-sm text-dim">
            Email used to book
          </label>
          <input id="lookup-email" name="email" type="email" className="field" autoComplete="email" required />
        </div>
        <button type="submit" className="btn btn-ghost" disabled={busy}>
          {busy ? "Searching…" : "Find booking"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}
      {result && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-panel p-5">
          <div>
            <p className="font-mono text-lg">{result.reference}</p>
            <p className="text-sm text-dim">
              {result.packageName} · {formatIsoDate(result.travelDate)} · {result.travelers} travellers
            </p>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono">{formatInr(result.totalInr)}</span>
            <Link href={`/book/confirmation/${result.reference}`} className="btn btn-ghost">
              Open
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
