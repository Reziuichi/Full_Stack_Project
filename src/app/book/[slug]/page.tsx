import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { getBookingTour } from "@/features/booking/bookingData";
import { BookingCheckin } from "@/features/booking/BookingCheckin";

export async function generateMetadata(props: PageProps<"/book/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const tour = await getBookingTour(slug);
  return { title: tour ? `Book ${tour.name}` : "Booking", robots: { index: false } };
}

export default async function BookPage(props: PageProps<"/book/[slug]">) {
  const { slug } = await props.params;
  const { travelers: seats } = await props.searchParams;
  const [tour, user] = await Promise.all([getBookingTour(slug), getSessionUser()]);
  if (!tour) notFound();
  // The tour page's seat picker carries its count over (?travelers=3).
  const wanted = Number(typeof seats === "string" ? seats : NaN);
  const travelers = Number.isInteger(wanted) ? Math.min(12, Math.max(1, wanted)) : undefined;
  const t = tour.theme;

  return (
    <div
      className="nt-city"
      style={{ "--glow": t.glow, "--ground": t.ground, "--ink": t.ink, "--accent": t.accent, "--accent-ink": t.accentInk } as React.CSSProperties}
    >
      <BookingCheckin tour={tour} prefill={{ name: user?.name ?? undefined, email: user?.email, travelers }} signedInAs={user?.email ?? null} />
    </div>
  );
}
