// Client-side location services: browser geolocation + calls to our API
// routes for reverse geocoding and search.

import type { LatLng, PlaceResult } from "@/lib/types";

export type GeolocationFailure = "denied" | "unavailable" | "timeout" | "unsupported";

export class GeolocationError extends Error {
  constructor(
    public readonly kind: GeolocationFailure,
    message: string,
  ) {
    super(message);
  }
}

export async function permissionState(): Promise<PermissionState | "unknown"> {
  try {
    const status = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    return status?.state ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function getBrowserPosition(): Promise<{ coords: LatLng; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new GeolocationError("unsupported", "This browser cannot share its location."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ coords: { lat: pos.coords.latitude, lng: pos.coords.longitude }, accuracy: pos.coords.accuracy }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) reject(new GeolocationError("denied", "Location access was declined."));
        else if (err.code === err.TIMEOUT) reject(new GeolocationError("timeout", "Finding your location took too long."));
        else reject(new GeolocationError("unavailable", "Your location could not be determined."));
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 10 * 60_000 },
    );
  });
}

export async function reverseGeocode(coords: LatLng): Promise<PlaceResult | null> {
  const res = await fetch(`/api/places/reverse?lat=${coords.lat.toFixed(5)}&lng=${coords.lng.toFixed(5)}`);
  if (!res.ok) return null;
  const json = (await res.json()) as { place: PlaceResult | null };
  return json.place;
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<{ results: PlaceResult[]; provider: string }> {
  const res = await fetch(`/api/places/search?q=${encodeURIComponent(query)}`, { signal });
  if (!res.ok) throw new Error("Search is unavailable right now");
  return res.json();
}
