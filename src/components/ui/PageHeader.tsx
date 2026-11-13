import type { ReactNode } from "react";

/** Standard page opening for non-globe pages: eyebrow, mono display title, lede. */
export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <header className="mx-auto max-w-[1400px] px-4 pb-10 pt-32 sm:px-6 lg:px-8">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="mt-4 max-w-[18ch] font-mono text-[clamp(2.6rem,7vw,6.5rem)] font-light uppercase leading-[0.9] tracking-[-0.035em]">{title}</h1>
      {children && <div className="mt-6 max-w-[62ch] text-base leading-relaxed text-dim">{children}</div>}
    </header>
  );
}
