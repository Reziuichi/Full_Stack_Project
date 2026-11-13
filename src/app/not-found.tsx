import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[80dvh] max-w-[1400px] flex-col justify-end px-4 pb-20 pt-32 sm:px-6 lg:px-8">
      <p className="hud flex items-center gap-2 text-muted">
        <span className="status-dot" data-state="warn" aria-hidden /> Signal lost · 404
      </p>
      <h1 className="mt-6 font-mono text-[clamp(3.5rem,14vw,13rem)] font-light uppercase leading-[0.82] tracking-[-0.04em]">Off the map</h1>
      <p className="mt-6 max-w-[48ch] text-dim">That page isn&apos;t on any of our routes. Head back to the globe and pick somewhere that exists.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/" className="btn btn-signal">
          Back to the globe
        </Link>
        <Link href="/tours" className="btn btn-ghost">
          Browse tours
        </Link>
      </div>
    </div>
  );
}
