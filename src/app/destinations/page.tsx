import type { Metadata } from "next";
import { listDestinations } from "@/server/repositories/catalog";
import { DestinationsAtlas } from "@/features/destinations/atlas/DestinationsAtlas";

export const revalidate = 300;
export const metadata: Metadata = { title: "Destinations" };

export default async function DestinationsPage() {
  const destinations = await listDestinations();
  return <DestinationsAtlas destinations={destinations} />;
}
