import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { SiteNav } from "@/components/layout/SiteNav";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { FlightTransition } from "@/components/transitions/FlightTransition";
import { TourTransition } from "@/components/transitions/TourTransition";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], weight: ["300", "400", "500"] });
// Editorial accent only (the destination marquee's italic line).
const instrumentSerif = Instrument_Serif({ variable: "--font-instrument-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: { default: "Longitude — plan your trip from orbit", template: "%s · Longitude" },
  description:
    "A tour and travel platform built around a live 3D Earth. Plot your route from where you are, fly into your destination in photorealistic 3D, and book curated tours.",
};

export const viewport: Viewport = {
  themeColor: "#06070a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} antialiased`}>
      <body className="min-h-[100dvh] bg-space text-fg">
        <a
          href="#main"
          className="hud sr-only z-[70] rounded-md bg-signal px-3 py-2 text-signal-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <SiteNav />
        <main id="main">{children}</main>
        <SiteFooter />
        <FlightTransition />
        <TourTransition />
        <div className="grain" aria-hidden="true" />
      </body>
    </html>
  );
}
