/** Wordmark: a meridian-and-equator glyph with the name set in mono. */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.5" />
      <ellipse cx="12" cy="12" rx="4.1" ry="9.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.75 12h18.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="16.1" cy="7.4" r="1.6" fill="var(--color-signal)" />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark className="h-5 w-5 text-fg" />
      <span className="font-mono text-[13px] font-medium tracking-[0.32em] text-fg">LONGITUDE</span>
    </span>
  );
}
