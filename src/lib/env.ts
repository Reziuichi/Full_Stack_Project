// Central access to environment configuration.
// NEXT_PUBLIC_* values are inlined at build time and safe for the browser.

export const publicEnv = {
  /** Cesium ion access token: World Terrain, World Imagery, OSM Buildings. */
  cesiumIonToken: (process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN ?? "").trim(),
};

export const hasCesiumIonToken = () => publicEnv.cesiumIonToken.length > 0;

/** Server-only configuration. Do not import from client components. */
export const serverEnv = {
  /** The same Cesium ion token, used server-side for ion's Google geocoder. */
  get cesiumIonToken(): string {
    return (process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN ?? "").trim();
  },
  /** Optional: Google Geocoding + Places. Blank = free Open-Meteo / Nominatim / Wikipedia. */
  get googleServerKey(): string {
    return (process.env.GOOGLE_MAPS_SERVER_API_KEY ?? "").trim();
  },
  get databaseUrl(): string {
    return (process.env.DATABASE_URL ?? "").trim();
  },
  get authSecret(): string {
    const secret = (process.env.AUTH_SECRET ?? "").trim();
    if (secret) return secret;
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET is required in production. See .env.example.");
    }
    return "longitude-dev-only-secret-change-me";
  },
  /** Outgoing mail for sign-in codes (any SMTP provider). Blank host = codes go to the server console in development. */
  get smtp() {
    const host = (process.env.SMTP_HOST ?? "").trim();
    const port = Number(process.env.SMTP_PORT ?? "") || 587;
    const user = (process.env.SMTP_USER ?? "").trim();
    return {
      host,
      port,
      /** Implicit TLS (port 465); otherwise STARTTLS is negotiated. */
      secure: (process.env.SMTP_SECURE ?? "").trim() ? process.env.SMTP_SECURE === "true" : port === 465,
      user,
      pass: (process.env.SMTP_PASS ?? "").trim(),
      from: (process.env.MAIL_FROM ?? "").trim() || (user ? `Longitude <${user}>` : "Longitude <no-reply@longitude.local>"),
    };
  },
};
