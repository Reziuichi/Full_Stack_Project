import Link from "next/link";
import { ArrowUpRight } from "@phosphor-icons/react/ssr";
import type { DestinationSummary } from "@/lib/types";
import { formatInr } from "@/lib/format";
import { formatCoordinates } from "@/lib/geo";
import { Photo } from "@/components/ui/Photo";

/** Asymmetric destination grid: two feature tiles, then a denser run. */
export function DestinationGrid({ destinations }: { destinations: DestinationSummary[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-12">
      {destinations.map((d, i) => {
        const span = i === 0 ? "lg:col-span-7 lg:row-span-2" : i === 1 ? "lg:col-span-5 lg:row-span-2" : "lg:col-span-4";
        const tall = i < 2;
        return (
          <li key={d.slug} className={span}>
            <Link
              href={`/destinations/${d.slug}`}
              className={`group relative flex h-full flex-col justify-end overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel ${
                tall ? "min-h-[26rem] lg:min-h-[34rem]" : "min-h-[18rem]"
              }`}
            >
              <Photo
                src={d.heroImage}
                alt={d.name}
                sizes={tall ? "(min-width: 1024px) 55vw, 100vw" : "(min-width: 1024px) 33vw, 100vw"}
                className="transition-transform duration-[1400ms] ease-[var(--ease-out-expo)] group-hover:scale-[1.04]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-space via-space/40 to-transparent" aria-hidden />
              <div className="relative p-5 sm:p-6">
                <p className="hud flex items-center justify-between text-muted">
                  <span>{d.country}</span>
                  <span className="hidden sm:inline">{formatCoordinates(d, 2)}</span>
                </p>
                <h3 className={`mt-2 font-mono font-light uppercase leading-[0.9] tracking-[-0.02em] ${tall ? "text-5xl md:text-6xl" : "text-3xl"}`}>
                  {d.name}
                </h3>
                <p className="mt-3 max-w-[44ch] text-sm leading-relaxed text-dim">{d.tagline}</p>
                <p className="hud mt-4 flex items-center justify-between border-t border-line pt-3 text-muted">
                  <span>
                    {d.packageCount} tours{d.fromPriceInr ? ` · from ${formatInr(d.fromPriceInr)}` : ""}
                  </span>
                  <ArrowUpRight size={14} className="text-fg transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
                </p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
