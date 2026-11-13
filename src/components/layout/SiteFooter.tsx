import Link from "next/link";
import { LogoMark } from "./Logo";
import { ExploreLink } from "./ExploreLink";
import { destinations } from "@/data/catalog";

const COLUMNS = [
  {
    title: "Explore",
    links: [
      { href: "/#explore", label: "Plan from orbit" },
      { href: "/destinations", label: "All destinations" },
      { href: "/tours", label: "All tours" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About Longitude" },
      { href: "/about#how-it-works", label: "How the 3D Earth works" },
      { href: "/about#contact", label: "Contact" },
    ],
  },
  {
    title: "Travellers",
    links: [
      { href: "/account", label: "Sign in / Profile" },
      { href: "/account#find-booking", label: "Find a booking" },
      { href: "/about#policies", label: "Cancellation policy" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-line bg-ink">
      <div className="mx-auto max-w-[1600px] px-4 pb-8 pt-16 sm:px-6 lg:px-8">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr_1fr_1.2fr]">
          <div className="max-w-sm">
            <div className="flex items-center gap-2.5">
              <LogoMark className="h-5 w-5" />
              <span className="font-mono text-[13px] tracking-[0.32em]">LONGITUDE</span>
            </div>
            <p className="mt-5 text-sm leading-relaxed text-muted">
              Tours and trips planned on a live 3D Earth. Chandigarh studio, travelling everywhere else.
            </p>
            <div className="hud mt-6 leading-[1.9] text-muted">
              <p className="flex items-center gap-2 text-dim">
                <span className="h-1.5 w-1.5 rounded-full bg-signal" aria-hidden />A comprehensive full-stack project
              </p>
              <p className="tabular-nums text-dim">24BDA70278 &amp; 24BDA70264</p>
              <p className="flex items-center gap-2.5">
                <span className="h-px w-5 bg-signal" aria-hidden />
                By Tejas and Aryan
              </p>
            </div>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h2 className="eyebrow">{col.title}</h2>
              <ul className="mt-4 space-y-2.5 text-sm">
                {col.links.map((l) => (
                  <li key={l.href}>
                    {l.href === "/#explore" ? (
                      <ExploreLink className="text-dim transition-colors hover:text-fg">{l.label}</ExploreLink>
                    ) : (
                      <Link href={l.href} className="text-dim transition-colors hover:text-fg">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <h2 className="eyebrow">Destinations</h2>
            <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
              {destinations.map((d) => (
                <li key={d.slug}>
                  <Link href={`/destinations/${d.slug}`} className="text-dim transition-colors hover:text-fg">
                    {d.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p
          aria-hidden="true"
          className="mt-20 select-none whitespace-nowrap font-mono text-[clamp(3rem,15.2vw,15rem)] font-light uppercase leading-[0.8] tracking-[-0.04em] text-fg/[0.06]"
        >
          Longitude
        </p>

        <div className="hud mt-8 flex flex-col gap-3 border-t border-line pt-6 text-faint md:flex-row md:items-center md:justify-between">
          <span>© {new Date().getFullYear()} Longitude Travel. Sample itineraries and prices for demonstration.</span>
          <span>
            3D cities © Google via Cesium ion · Terrain &amp; imagery via Cesium ion · Earth imagery NASA GIBS · Photos Wikimedia Commons
          </span>
        </div>
      </div>
    </footer>
  );
}
