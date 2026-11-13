import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBookingByReference } from "@/server/repositories/bookings";
import { DatabaseUnavailableError } from "@/server/db";
import { getBookingTour } from "@/features/booking/bookingData";
import { ConfirmationView } from "@/features/booking/ConfirmationView";

export const metadata: Metadata = { title: "Booking confirmed", robots: { index: false } };

export default async function ConfirmationPage(props: PageProps<"/book/confirmation/[reference]">) {
  const { reference } = await props.params;
  let booking;
  try {
    booking = await getBookingByReference(reference);
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) {
      return (
        <div className="ntc ntc-down">
          <p className="ntc-kicker ntc-kicker-down">Database unavailable</p>
          <p className="ntc-lead">{error.reason}</p>
          <Link href="/tours" className="ntc-btn">
            Browse tours
          </Link>
        </div>
      );
    }
    throw error;
  }
  if (!booking) notFound();
  const tour = await getBookingTour(booking.packageSlug);
  if (!tour) notFound();
  const t = tour.theme;

  return (
    <div className="nt-city" style={{ "--glow": t.glow, "--ground": t.ground, "--ink": t.ink, "--accent": t.accent, "--accent-ink": t.accentInk } as React.CSSProperties}>
      <ConfirmationView booking={booking} tour={tour} />
    </div>
  );
}
