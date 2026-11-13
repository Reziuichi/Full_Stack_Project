// Airports and flight maths shared by the destination pages: each curated
// city's airport code, the desk's home base (Chandigarh, IXC), great-circle
// distances and a planning estimate of the flying time.

import type { LatLng } from "./types";

/** The airport code printed for each curated destination. */
export const AIRPORT_CODES: Record<string, string> = {
  paris: "CDG",
  london: "LHR",
  dubai: "DXB",
  tokyo: "HND",
  "new-york": "JFK",
  chandigarh: "IXC",
  delhi: "DEL",
  manali: "KUU",
};

export const airportCode = (slug: string, name: string) => AIRPORT_CODES[slug] ?? name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();

/** Where every Longitude trip is planned from. */
export const HOME_BASE = { code: "IXC", name: "Chandigarh", lat: 30.6735, lng: 76.7885 };

const EARTH_RADIUS_KM = 6371;
const RAD = Math.PI / 180;

export function greatCircleKm(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Points along the great circle from a to b (inclusive), as [lng, lat]. */
export function greatCirclePath(a: LatLng, b: LatLng, samples = 64): [number, number][] {
  const toVec = (p: LatLng) => [Math.cos(p.lat * RAD) * Math.cos(p.lng * RAD), Math.cos(p.lat * RAD) * Math.sin(p.lng * RAD), Math.sin(p.lat * RAD)];
  const va = toVec(a);
  const vb = toVec(b);
  const omega = Math.acos(Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])));
  const out: [number, number][] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const s = Math.sin(omega) || 1;
    const k1 = omega ? Math.sin((1 - t) * omega) / s : 1 - t;
    const k2 = omega ? Math.sin(t * omega) / s : t;
    const v = [0, 1, 2].map((j) => k1 * va[j] + k2 * vb[j]);
    out.push([Math.atan2(v[1], v[0]) / RAD, Math.asin(Math.max(-1, Math.min(1, v[2]))) / RAD]);
  }
  return out;
}

/** Planning estimate: cruise at 850 km/h plus half an hour for climb and descent. */
export function flightTime(km: number): string {
  if (km < 30) return "Home base";
  if (km < 150) return "By road";
  const minutes = Math.round((km / 850) * 60 + 30);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
