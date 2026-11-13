// Typed helpers for the journey's markers.

import type { Attraction, Destination, LatLng } from "@/lib/types";
import type { MarkerHandle, MarkerLayer } from "./markerLayer";

export function addLocationMarker(layer: MarkerLayer, place: LatLng & { name: string }): MarkerHandle {
  return layer.add({
    id: "origin",
    kind: "origin",
    lat: place.lat,
    lng: place.lng,
    height: 0,
    label: place.name,
    sublabel: "You",
  });
}

export function addDestinationMarker(layer: MarkerLayer, destination: Pick<Destination, "lat" | "lng" | "name" | "country" | "elevation">): MarkerHandle {
  return layer.add({
    id: "destination",
    kind: "destination",
    lat: destination.lat,
    lng: destination.lng,
    height: Math.max(0, destination.elevation),
    label: destination.name,
    sublabel: destination.country,
  });
}

export function addAttractionMarkers(layer: MarkerLayer, attractions: Attraction[], onSelect: (index: number) => void): MarkerHandle[] {
  layer.removeKind("attraction");
  return attractions.map((a, index) =>
    layer.add({
      id: `attraction:${a.slug}`,
      kind: "attraction",
      lat: a.lat,
      lng: a.lng,
      height: Math.max(a.elevation, 0) + 12,
      label: a.name,
      index,
      onClick: () => onSelect(index),
    }),
  );
}
