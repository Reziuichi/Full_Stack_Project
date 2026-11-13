// A privacy-friendly approximate origin when the browser location is not
// (yet) available: the main city of the visitor's time zone. Always labelled
// as approximate in the UI.

import type { PlaceResult } from "@/lib/types";

const ZONES: Record<string, [string, string, number, number]> = {
  "Asia/Kolkata": ["New Delhi", "India", 28.6139, 77.209],
  "Asia/Calcutta": ["New Delhi", "India", 28.6139, 77.209],
  "Asia/Dubai": ["Dubai", "United Arab Emirates", 25.2048, 55.2708],
  "Asia/Tokyo": ["Tokyo", "Japan", 35.6812, 139.7671],
  "Asia/Singapore": ["Singapore", "Singapore", 1.3521, 103.8198],
  "Asia/Shanghai": ["Shanghai", "China", 31.2304, 121.4737],
  "Asia/Hong_Kong": ["Hong Kong", "China", 22.3193, 114.1694],
  "Asia/Seoul": ["Seoul", "South Korea", 37.5665, 126.978],
  "Asia/Bangkok": ["Bangkok", "Thailand", 13.7563, 100.5018],
  "Asia/Jakarta": ["Jakarta", "Indonesia", -6.2088, 106.8456],
  "Asia/Karachi": ["Karachi", "Pakistan", 24.8607, 67.0011],
  "Asia/Dhaka": ["Dhaka", "Bangladesh", 23.8103, 90.4125],
  "Asia/Kathmandu": ["Kathmandu", "Nepal", 27.7172, 85.324],
  "Asia/Colombo": ["Colombo", "Sri Lanka", 6.9271, 79.8612],
  "Asia/Riyadh": ["Riyadh", "Saudi Arabia", 24.7136, 46.6753],
  "Europe/London": ["London", "United Kingdom", 51.5072, -0.1276],
  "Europe/Paris": ["Paris", "France", 48.8566, 2.3522],
  "Europe/Berlin": ["Berlin", "Germany", 52.52, 13.405],
  "Europe/Madrid": ["Madrid", "Spain", 40.4168, -3.7038],
  "Europe/Rome": ["Rome", "Italy", 41.9028, 12.4964],
  "Europe/Amsterdam": ["Amsterdam", "Netherlands", 52.3676, 4.9041],
  "Europe/Istanbul": ["Istanbul", "Türkiye", 41.0082, 28.9784],
  "Europe/Moscow": ["Moscow", "Russia", 55.7558, 37.6173],
  "America/New_York": ["New York", "United States", 40.7128, -74.006],
  "America/Chicago": ["Chicago", "United States", 41.8781, -87.6298],
  "America/Denver": ["Denver", "United States", 39.7392, -104.9903],
  "America/Los_Angeles": ["Los Angeles", "United States", 34.0522, -118.2437],
  "America/Toronto": ["Toronto", "Canada", 43.6532, -79.3832],
  "America/Mexico_City": ["Mexico City", "Mexico", 19.4326, -99.1332],
  "America/Sao_Paulo": ["São Paulo", "Brazil", -23.5505, -46.6333],
  "America/Argentina/Buenos_Aires": ["Buenos Aires", "Argentina", -34.6037, -58.3816],
  "Australia/Sydney": ["Sydney", "Australia", -33.8688, 151.2093],
  "Australia/Melbourne": ["Melbourne", "Australia", -37.8136, 144.9631],
  "Pacific/Auckland": ["Auckland", "New Zealand", -36.8485, 174.7633],
  "Africa/Cairo": ["Cairo", "Egypt", 30.0444, 31.2357],
  "Africa/Johannesburg": ["Johannesburg", "South Africa", -26.2041, 28.0473],
  "Africa/Lagos": ["Lagos", "Nigeria", 6.5244, 3.3792],
  "Africa/Nairobi": ["Nairobi", "Kenya", -1.2921, 36.8219],
};

export function timezoneOrigin(): PlaceResult {
  let zone = "";
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    zone = "";
  }
  const hit = ZONES[zone];
  if (hit) {
    return { id: `tz:${zone}`, name: hit[0], context: hit[1], lat: hit[2], lng: hit[3], source: "timezone" };
  }
  // Unknown zone: place the origin on the right meridian band.
  const offsetHours = -new Date().getTimezoneOffset() / 60;
  return {
    id: `tz:${zone || "offset"}`,
    name: zone ? zone.split("/").pop()!.replace(/_/g, " ") : "Your region",
    context: `UTC${offsetHours >= 0 ? "+" : ""}${offsetHours}`,
    lat: 25,
    lng: Math.max(-179, Math.min(179, offsetHours * 15)),
    source: "timezone",
  };
}
