import type { Metadata } from "next";
import { listDestinations, listPackages } from "@/server/repositories/catalog";
import { toCities } from "@/features/tours/tourData";
import { ToursHero } from "@/features/tours/ToursHero";
import { TourRoute } from "@/features/tours/TourRoute";
import { TourTimetable } from "@/features/tours/TourTimetable";
import { ToursArrivals } from "@/features/tours/ToursArrivals";

export const metadata: Metadata = { title: "Tours" };

export default async function ToursPage(props: PageProps<"/tours">) {
  const { destination } = await props.searchParams;
  const initial = typeof destination === "string" ? destination : undefined;
  const [destinations, packages] = await Promise.all([listDestinations(), listPackages()]);
  const cities = toCities(destinations, packages);

  return (
    <div className="tours">
      <ToursHero cities={cities} />
      <TourRoute cities={cities} initial={initial} />
      <TourTimetable cities={cities} />
      <ToursArrivals />
    </div>
  );
}
