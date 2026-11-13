import type { Metadata } from "next";
import Link from "next/link";
import { getSessionUser } from "@/server/auth";
import { databaseStatus } from "@/server/db";
import { listBookingsForUser } from "@/server/repositories/bookings";
import { addDaysIso, formatInr, formatIsoDate } from "@/lib/format";
import { SignOutButton } from "@/components/account/AuthForms";
import { BookingLookup } from "@/components/account/BookingLookup";
import { ExploreLink } from "@/components/layout/ExploreLink";
import { LoginHero } from "@/features/account/LoginHero";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const [user, db] = await Promise.all([getSessionUser(), databaseStatus()]);
  const bookings = user ? await listBookingsForUser(user.id, user.email).catch(() => []) : [];

  const findBooking = (
    <section id="find-booking" aria-labelledby="find-title" className="mt-20 scroll-mt-24 border-t border-line pt-10">
      <h2 id="find-title" className="text-2xl font-medium tracking-tight">
        Find a booking
      </h2>
      <p className="mt-2 text-sm text-dim">For bookings made without an account.</p>
      <div className="mt-6 max-w-4xl">
        <BookingLookup />
      </div>
    </section>
  );

  // Signed out: the login page, the Earth turning under it.
  if (!user) {
    return (
      <>
        <LoginHero online={db.state === "connected"} offlineReason={db.reason} />
        <div className="mx-auto max-w-[1400px] px-4 pb-24 sm:px-6 lg:px-8">{findBooking}</div>
      </>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-24 pt-32 sm:px-6 lg:px-8">
      {db.state !== "connected" && (
        <div role="status" className="mb-10 rounded-xl border border-signal/40 bg-signal-soft p-4 text-sm text-fg">
          <p className="font-medium">Accounts and bookings need the database.</p>
          <p className="mt-1 text-dim">{db.reason}</p>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">Profile</p>
          <h1 className="mt-4 font-mono text-[clamp(2.4rem,6vw,5rem)] font-light uppercase leading-[0.9] tracking-[-0.03em]">{user.name}</h1>
          <p className="mt-3 text-dim">{user.email}</p>
        </div>
        <SignOutButton />
      </div>

      <section aria-labelledby="trips" className="mt-16 border-t border-line pt-10">
        <h2 id="trips" className="text-2xl font-medium tracking-tight">
          Your trips
        </h2>
        {bookings.length === 0 ? (
          <div className="mt-6 rounded-[var(--radius-card)] border border-dashed border-line-strong p-10 text-center">
            <p className="text-dim">No trips yet. Pick a destination on the globe and book a tour — it will show up here.</p>
            <ExploreLink className="btn btn-signal mt-6">Plan a trip</ExploreLink>
          </div>
        ) : (
          <ul className="mt-6 divide-y divide-line border-y border-line">
            {bookings.map((b) => (
              <li key={b.reference}>
                <Link
                  href={`/book/confirmation/${b.reference}`}
                  className="grid gap-2 py-5 transition-colors hover:bg-white/[0.02] sm:grid-cols-[10rem_1fr_auto] sm:items-center sm:gap-6"
                >
                  <span className="font-mono text-sm text-signal">{b.reference}</span>
                  <span>
                    <span className="block">{b.packageName}</span>
                    <span className="text-sm text-muted">
                      {b.destinationName} · {formatIsoDate(b.travelDate)} – {formatIsoDate(addDaysIso(b.travelDate, b.durationDays - 1))} ·{" "}
                      {b.travelers} travellers
                    </span>
                  </span>
                  <span className="font-mono">{formatInr(b.totalInr)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {findBooking}
    </div>
  );
}
