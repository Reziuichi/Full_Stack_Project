const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const grouped = new Intl.NumberFormat("en-IN");

export const formatInr = (amount: number) => inr.format(amount);
export const formatNumber = (n: number) => grouped.format(n);

export function formatDistanceKm(meters: number): string {
  const km = meters / 1000;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${grouped.format(Math.round(km))} km`;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")} min`;
}

export function formatDays(days: number): string {
  const nights = Math.max(0, days - 1);
  return `${days} days · ${nights} ${nights === 1 ? "night" : "nights"}`;
}

/** Formats a YYYY-MM-DD date as "12 Oct 2026" without timezone drift. */
export function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

export function localTimeIn(timezone: string, date = new Date()): string {
  try {
    return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: timezone });
  } catch {
    return "--:--";
  }
}

/** GST on tour packages (5%, no input tax credit) — shown as a separate line. */
export const TOUR_TAX_RATE = 0.05;

export function priceBreakdown(unitPriceInr: number, travelers: number) {
  const subtotal = unitPriceInr * travelers;
  const taxes = Math.round(subtotal * TOUR_TAX_RATE);
  return { subtotal, taxes, total: subtotal + taxes };
}
