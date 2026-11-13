// Pure spherical geodesy helpers (no Cesium). Angles in degrees unless noted.

import type { LatLng } from "./types";

export const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

export const toRad = (deg: number) => deg * DEG;
export const toDeg = (rad: number) => rad / DEG;

/** Wrap an angle to [-180, 180). */
export function wrapLongitude(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** Wrap radians to (-π, π]. */
export function wrapPi(rad: number): number {
  let r = rad % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

type Vec3 = [number, number, number];

function toVec(p: LatLng): Vec3 {
  const lat = toRad(p.lat);
  const lng = toRad(p.lng);
  const c = Math.cos(lat);
  return [c * Math.cos(lng), c * Math.sin(lng), Math.sin(lat)];
}

function fromVec(v: Vec3): LatLng {
  const [x, y, z] = v;
  return { lat: toDeg(Math.atan2(z, Math.hypot(x, y))), lng: toDeg(Math.atan2(y, x)) };
}

/** Central angle between two points, in radians. */
export function centralAngle(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Great-circle distance in metres. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  return centralAngle(a, b) * EARTH_RADIUS_M;
}

/** Initial bearing from a to b, degrees clockwise from north in [0, 360). */
export function initialBearing(a: LatLng, b: LatLng): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point at fraction t ∈ [0,1] along the great circle from a to b (spherical slerp). */
export function interpolateGreatCircle(a: LatLng, b: LatLng, t: number): LatLng {
  const va = toVec(a);
  const vb = toVec(b);
  const dot = Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const ω = Math.acos(dot);
  if (ω < 1e-9) return { ...a };
  const s = Math.sin(ω);
  const k1 = Math.sin((1 - t) * ω) / s;
  const k2 = Math.sin(t * ω) / s;
  return fromVec([k1 * va[0] + k2 * vb[0], k1 * va[1] + k2 * vb[1], k1 * va[2] + k2 * vb[2]]);
}

/** Midpoint of the great circle between a and b. */
export function midpoint(a: LatLng, b: LatLng): LatLng {
  return interpolateGreatCircle(a, b, 0.5);
}

/** Rough nonstop flight time for a great-circle distance (cruise + taxi/climb). */
export function estimateFlightMinutes(meters: number): number {
  const km = meters / 1000;
  if (km < 300) return Math.round((km / 60) * 60); // road trip at ~60 km/h
  return Math.round((km / 830) * 60 + 35);
}

/** "30.7333° N · 76.7797° E" */
export function formatCoordinates(p: LatLng, digits = 4): string {
  const lat = `${Math.abs(p.lat).toFixed(digits)}° ${p.lat >= 0 ? "N" : "S"}`;
  const lng = `${Math.abs(p.lng).toFixed(digits)}° ${p.lng >= 0 ? "E" : "W"}`;
  return `${lat} · ${lng}`;
}

// IATA city/airport codes for places we route to often.
const IATA: Record<string, string> = {
  paris: "PAR",
  london: "LON",
  dubai: "DXB",
  tokyo: "TYO",
  "new york": "NYC",
  "new york city": "NYC",
  chandigarh: "IXC",
  delhi: "DEL",
  "new delhi": "DEL",
  manali: "KUU",
  mumbai: "BOM",
  bengaluru: "BLR",
  bangalore: "BLR",
  kolkata: "CCU",
  chennai: "MAA",
  hyderabad: "HYD",
  pune: "PNQ",
  ahmedabad: "AMD",
  jaipur: "JAI",
  amritsar: "ATQ",
  lucknow: "LKO",
  goa: "GOI",
  kochi: "COK",
  singapore: "SIN",
  bangkok: "BKK",
  "hong kong": "HKG",
  sydney: "SYD",
  "los angeles": "LAX",
  "san francisco": "SFO",
  toronto: "YTO",
  berlin: "BER",
  rome: "ROM",
  madrid: "MAD",
  amsterdam: "AMS",
  istanbul: "IST",
};

/** Three-letter code used in the HUD: IATA when known, e.g. "Chandigarh" → "IXC". */
export function placeCode(name: string): string {
  const known = IATA[name.toLowerCase().trim()];
  if (known) return known;
  const clean = name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z ]/g, "").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0] + (words[1][1] ?? words[0][1] ?? "X")).toUpperCase();
  const w = words[0] ?? "XXX";
  const consonants = w.slice(1).replace(/[aeiou]/gi, "");
  return (w[0] + (consonants[0] ?? w[1] ?? "X") + (consonants[1] ?? w[2] ?? "X")).toUpperCase();
}
