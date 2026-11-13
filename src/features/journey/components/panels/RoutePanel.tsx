"use client";

import { useEffect, useRef } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { distanceMeters, estimateFlightMinutes, initialBearing, placeCode } from "@/lib/geo";
import { formatDistanceKm, formatDuration } from "@/lib/format";
import { PLANE_PATH } from "@/features/globe/route/plane";
import { routeFlight } from "@/features/globe/camera/scrollCamera";
import { useJourney } from "../../JourneyProvider";
import { progressStore } from "../../progressStore";
import { segmentOf } from "../../timeline";
import { PanelShell, SceneIndex, Stagger } from "./PanelShell";

export function RoutePanel({ active, total }: { active: boolean; total: number }) {
  const { state, origin, timeline } = useJourney();
  const dest = state.destination.data?.destination ?? null;
  const barRef = useRef<HTMLDivElement>(null);
  const pctRef = useRef<HTMLSpanElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);

  // Route progress bar follows the airplane on the globe, without re-rendering.
  useEffect(() => {
    const seg = segmentOf(timeline, "route");
    if (!seg) return;
    return progressStore.subscribe((p) => {
      const local = Math.min(1, Math.max(0, (p - seg.start) / (seg.end - seg.start)));
      const t = routeFlight(local).plane;
      if (barRef.current) barRef.current.style.transform = `scaleX(${t})`;
      if (planeRef.current) planeRef.current.style.transform = `translate3d(${(t * 100).toFixed(2)}%, 0, 0)`;
      if (pctRef.current) pctRef.current.textContent = `${Math.round(t * 100)}%`;
    });
  }, [timeline]);

  if (!dest) {
    return (
      <PanelShell active={active} label="Route">
        <SceneIndex n={4} total={total} label="Route" />
        <div className="mt-4 space-y-2" aria-hidden>
          <div className="skeleton h-8 w-48" />
          <div className="skeleton h-3 w-64" />
        </div>
      </PanelShell>
    );
  }

  const meters = distanceMeters(origin, dest);
  const minutes = estimateFlightMinutes(meters);
  const bearing = Math.round(initialBearing(origin, dest));

  return (
    <PanelShell active={active} label="Route">
      <Stagger i={0}>
        <SceneIndex n={4} total={total} label="Route" />
      </Stagger>
      <Stagger i={1}>
        <div className="mt-4 flex items-end justify-between gap-4 font-mono">
          <div className="min-w-0">
            <p className="text-4xl font-light tracking-tight">{placeCode(origin.name)}</p>
            <p className="mt-1 truncate text-xs text-muted">{origin.name}</p>
          </div>
          <ArrowRight size={22} className="mb-6 shrink-0 text-signal" aria-hidden />
          <div className="min-w-0 text-right">
            <p className="text-4xl font-light tracking-tight text-signal">{placeCode(dest.name)}</p>
            <p className="mt-1 truncate text-xs text-muted">{dest.name}</p>
          </div>
        </div>
      </Stagger>
      <Stagger i={2}>
        {/* Mirrors the globe: dotted flight path, contrail behind the plane. */}
        <div className="relative mt-5 h-4 w-full" aria-hidden>
          <div className="route-dots absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2" />
          <div ref={barRef} className="absolute inset-x-0 top-1/2 h-[3px] origin-left -translate-y-1/2 scale-x-0 rounded-full bg-signal" />
          <div ref={planeRef} className="absolute inset-0 will-change-transform">
            <svg viewBox="0 0 24 24" className="absolute left-0 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 fill-fg">
              <path d={PLANE_PATH} />
            </svg>
          </div>
        </div>
        <p className="hud mt-2 flex justify-between text-faint">
          <span>Great-circle route</span>
          <span ref={pctRef}>0%</span>
        </p>
      </Stagger>
      <Stagger i={3}>
        <dl className="hud mt-4 grid grid-cols-3 gap-4 border-t border-line pt-4">
          <div>
            <dt className="text-faint">Distance</dt>
            <dd className="mt-1 text-sm normal-case tracking-normal text-fg">{formatDistanceKm(meters)}</dd>
          </div>
          <div>
            <dt className="text-faint">{meters < 300_000 ? "By road" : "Nonstop"}</dt>
            <dd className="mt-1 text-sm normal-case tracking-normal text-fg">≈ {formatDuration(minutes)}</dd>
          </div>
          <div>
            <dt className="text-faint">Bearing</dt>
            <dd className="mt-1 text-sm normal-case tracking-normal text-fg">{String(bearing).padStart(3, "0")}°</dd>
          </div>
        </dl>
      </Stagger>
    </PanelShell>
  );
}
