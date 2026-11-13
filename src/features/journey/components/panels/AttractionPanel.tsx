"use client";

import { CaretLeft, CaretRight, Clock, SunHorizon } from "@phosphor-icons/react";
import { formatCoordinates } from "@/lib/geo";
import { Photo } from "@/components/ui/Photo";
import { useJourney } from "../../JourneyProvider";
import { PanelShell } from "./PanelShell";

export function AttractionPanel({ active, index }: { active: boolean; index: number }) {
  const { attractions, scrollToScene, state } = useJourney();
  const a = attractions[index];
  if (!a) return null;
  const total = attractions.length;
  const creditHost = a.imageCredit.startsWith("http") ? new URL(a.imageCredit).hostname.replace("www.", "") : a.imageCredit;

  return (
    <PanelShell active={active} label={a.name} className="max-h-full overflow-y-auto overscroll-contain p-0 sm:p-0">
      <div className="relative aspect-[21/9] w-full overflow-hidden bg-ink sm:aspect-[16/10]">
        <Photo src={a.imageUrl} alt={a.name} sizes="(min-width: 1024px) 420px, 100vw" />
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-space/80 to-transparent" aria-hidden />
        <p className="hud absolute left-4 top-3 rounded-full bg-space/80 px-2.5 py-1 text-fg">
          <span className="text-signal">{String(index + 1).padStart(2, "0")}</span>
          <span className="text-faint"> / {String(total).padStart(2, "0")}</span>
        </p>
        {a.imageCredit && (
          <a
            href={a.imageCredit.startsWith("http") ? a.imageCredit : undefined}
            target="_blank"
            rel="noreferrer"
            className="hud absolute bottom-2 right-3 text-[9px] text-dim hover:text-fg"
          >
            Photo · {creditHost}
          </a>
        )}
      </div>
      <div className="p-4 sm:p-6">
        <p className="eyebrow">{a.category}</p>
        <h2 className="mt-2 text-2xl font-medium leading-tight tracking-tight">{a.name}</h2>
        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-dim sm:line-clamp-4">{a.description || a.summary}</p>
        <dl className="hud mt-4 hidden grid-cols-2 gap-3 border-t border-line pt-4 text-faint sm:grid">
          {a.bestTime && (
            <div className="flex items-start gap-2">
              <SunHorizon size={14} className="mt-0.5 shrink-0 text-muted" aria-hidden />
              <div>
                <dt className="sr-only">Best time</dt>
                <dd className="normal-case tracking-normal text-dim">{a.bestTime}</dd>
              </div>
            </div>
          )}
          {a.visitDuration && (
            <div className="flex items-start gap-2">
              <Clock size={14} className="mt-0.5 shrink-0 text-muted" aria-hidden />
              <div>
                <dt className="sr-only">Visit duration</dt>
                <dd className="normal-case tracking-normal text-dim">{a.visitDuration}</dd>
              </div>
            </div>
          )}
          <div className="col-span-2">
            <dt className="sr-only">Coordinates</dt>
            <dd>{formatCoordinates(a, 4)}</dd>
          </div>
        </dl>
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            className="inline-flex h-11 items-center gap-1 text-sm text-muted hover:text-fg disabled:opacity-30"
            disabled={index === 0}
            onClick={() => scrollToScene("attraction", { attraction: index - 1, offset: 0.6 })}
          >
            <CaretLeft size={14} aria-hidden /> Previous
          </button>
          {state.engine.world.state !== "ready" && <span className="hud text-faint">Low-res imagery</span>}
          <button
            type="button"
            className="inline-flex h-11 items-center gap-1 text-sm text-muted hover:text-fg"
            onClick={() =>
              index + 1 < total ? scrollToScene("attraction", { attraction: index + 1, offset: 0.6 }) : scrollToScene("outro", { offset: 0.6 })
            }
          >
            {index + 1 < total ? "Next" : "Tours"} <CaretRight size={14} aria-hidden />
          </button>
        </div>
      </div>
    </PanelShell>
  );
}
