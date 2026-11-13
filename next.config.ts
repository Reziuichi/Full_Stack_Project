import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev badge sits on top of the globe's bottom HUD; build errors still show as an overlay.
  devIndicators: false,
  // The Postgres driver and Prisma adapter run on the Node.js server only.
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "upload.wikimedia.org" },
      { protocol: "https", hostname: "thumb.wikimedia.org" },
    ],
  },
  async headers() {
    return [
      {
        // CesiumJS static bundle is versioned by the copy script; cache it hard.
        source: "/cesium/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
