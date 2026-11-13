import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Next.js reads .env.local; the Prisma CLI does not, so load it explicitly.
config({ path: ".env.local", quiet: true });
config({ quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // `prisma generate` does not need a live URL; migrate/seed do.
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/longitude",
  },
});
