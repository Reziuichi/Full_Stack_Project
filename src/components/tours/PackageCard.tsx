import Link from "next/link";
import { ArrowUpRight } from "@phosphor-icons/react/ssr";
import type { TourPackage } from "@/lib/types";
import { formatDays, formatInr } from "@/lib/format";
import { Photo } from "@/components/ui/Photo";

/** Tour package card. `feature` is the larger, image-led variant. */
export function PackageCard({ pkg, variant = "standard", showDestination = true }: { pkg: TourPackage; variant?: "feature" | "standard"; showDestination?: boolean }) {
  const feature = variant === "feature";
  return (
    <article data-tour-card className="group relative flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel transition-colors hover:border-line-strong">
      <div className={`relative w-full overflow-hidden bg-ink ${feature ? "aspect-[16/10]" : "aspect-[4/3]"}`}>
        <Photo
          src={pkg.images[0]}
          alt={`${pkg.name} — ${pkg.destinationName}`}
          sizes={feature ? "(min-width: 1024px) 58vw, 100vw" : "(min-width: 1024px) 40vw, 100vw"}
          className="transition-transform duration-[1200ms] ease-[var(--ease-out-expo)] group-hover:scale-[1.03]"
        />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-panel to-transparent" aria-hidden />
        <p className="hud absolute left-4 top-4 rounded-full bg-space/70 px-2.5 py-1 text-fg backdrop-blur">{formatDays(pkg.durationDays)}</p>
        {pkg.featured && (
          <p className="hud absolute right-4 top-4 rounded-full bg-signal px-2.5 py-1 text-signal-ink">Most booked</p>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5 sm:p-6">
        {showDestination && (
          <p className="eyebrow">
            {pkg.destinationName}, {pkg.country}
          </p>
        )}
        <h3 className={`mt-2 font-medium leading-tight tracking-tight ${feature ? "text-2xl sm:text-[1.75rem]" : "text-xl"}`}>
          <Link href={`/tours/${pkg.slug}`} className="after:absolute after:inset-0" data-tour-flight={`IXC → ${pkg.destinationName}`} data-tour-name={pkg.name}>
            {pkg.name}
          </Link>
        </h3>
        <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-dim">{pkg.summary}</p>

        <ul className="hud mt-4 flex flex-wrap gap-x-3 gap-y-1.5 text-muted" aria-label="Main attractions">
          {pkg.highlights.map((h) => (
            <li key={h} className="flex items-center gap-1.5">
              <span className="h-1 w-1 rounded-full bg-signal" aria-hidden />
              {h}
            </li>
          ))}
        </ul>

        <div className="mt-auto flex items-end justify-between gap-4 border-t border-line pt-5">
          <p>
            <span className="hud block text-faint">From, per person</span>
            <span className="font-mono text-xl text-fg">{formatInr(pkg.priceInr)}</span>
          </p>
          <span className="btn btn-ghost relative z-10 group-hover:border-fg">
            View details <ArrowUpRight size={13} weight="bold" aria-hidden />
          </span>
        </div>
      </div>
    </article>
  );
}
