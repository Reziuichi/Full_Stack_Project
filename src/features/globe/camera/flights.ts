// Discrete camera flights used outside the scroll timeline — e.g. when the
// traveller's location resolves or they jump to a destination from search.
// Both go through the CameraDirector so they blend with scroll-driven motion.

import type { Destination, LatLng } from "@/lib/types";
import type { CameraDirector } from "./director";
import { pose, type OrbitPose } from "./pose";

export function flyToLocation(director: CameraDirector, place: LatLng, options: { range?: number; duration?: number } = {}): Promise<void> {
  const target: OrbitPose = pose({
    lat: place.lat,
    lng: place.lng,
    range: options.range ?? 3_600_000,
    pitch: -80,
    heading: 8,
    yaw: 7,
  });
  return director.flyTo(target, { duration: options.duration ?? 3.2 });
}

export function flyToDestination(
  director: CameraDirector,
  destination: Pick<Destination, "lat" | "lng" | "elevation" | "camera">,
  options: { duration?: number; detailed?: boolean } = {},
): Promise<void> {
  const scale = options.detailed === false ? 2.4 : 1;
  const target = pose({
    lat: destination.lat,
    lng: destination.lng,
    height: destination.elevation,
    heading: destination.camera.heading,
    pitch: destination.camera.pitch,
    range: destination.camera.range * scale,
  });
  return director.flyTo(target, { duration: options.duration ?? 4.5 });
}
