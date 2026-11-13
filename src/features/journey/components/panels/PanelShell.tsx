import type { ReactNode } from "react";

/** A scene panel: visible and interactive only while its scene is active. */
export function PanelShell({
  active,
  label,
  children,
  className = "",
  attention = false,
}: {
  active: boolean;
  label: string;
  children: ReactNode;
  className?: string;
  /** Briefly ring the panel in the accent colour (e.g. after "Explore"). */
  attention?: boolean;
}) {
  return (
    <section
      aria-label={label}
      aria-hidden={!active}
      inert={!active}
      data-active={active}
      data-attention={attention}
      className={`scene-panel glass absolute inset-x-0 bottom-0 rounded-[var(--radius-card)] p-5 sm:p-6 ${className}`}
    >
      {children}
    </section>
  );
}

/** Stagger helper: `<Stagger i={2}>` delays the child's entrance. */
export function Stagger({ i, children, className = "" }: { i: number; children: ReactNode; className?: string }) {
  return (
    <div data-stagger="" style={{ ["--i" as string]: i }} className={className}>
      {children}
    </div>
  );
}

export function SceneIndex({ n, total, label }: { n: number; total: number; label: string }) {
  return (
    <p className="eyebrow flex items-center gap-2">
      <span className="text-signal">{String(n).padStart(2, "0")}</span>
      <span className="text-faint">/ {String(total).padStart(2, "0")}</span>
      <span className="h-px w-6 bg-line-strong" aria-hidden />
      <span>{label}</span>
    </p>
  );
}
