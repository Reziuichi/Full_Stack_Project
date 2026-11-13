"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import type { Failure } from "./authFailure";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
/** When tile i settles, in ms: the board fills left to right, like an airport's. */
const settleAt = (i: number) => 140 + i * 17;

/**
 * The failure message on a split-flap departures board. Each letter is a
 * flap that swings down into place, shuffling through random letters until
 * it lands, left to right. A status word (Denied, On hold, Delayed) blinks in
 * the header next to the gate and the time. The whole line is also announced
 * to screen readers as one alert.
 */
export function FlapBoard({ failure, onAction }: { failure: Failure; onAction?: () => void }) {
  const row = useRef<HTMLParagraphElement>(null);
  const [time] = useState(() => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
  const words = failure.board.toUpperCase().split(/\s+/);

  // Shuffle each flap's letter until its moment, then land it. Writes to the
  // text nodes React rendered (the final letters), so nothing is replaced.
  useEffect(() => {
    const tiles = [...(row.current?.querySelectorAll<HTMLElement>("[data-flap]") ?? [])];
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !tiles.length) return;
    const start = performance.now();
    let raf = 0;
    let lastTick = -1;
    const step = (now: number) => {
      const t = now - start;
      const tick = Math.floor(t / 55);
      let busy = false;
      tiles.forEach((el, i) => {
        const node = el.firstChild;
        if (!node) return;
        const final = el.dataset.flap!;
        if (t >= settleAt(i)) {
          if (node.nodeValue !== final) node.nodeValue = final;
        } else {
          busy = true;
          if (tick !== lastTick) node.nodeValue = GLYPHS[(Math.random() * GLYPHS.length) | 0];
        }
      });
      lastTick = tick;
      if (busy) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      tiles.forEach((el) => {
        if (el.firstChild) el.firstChild.nodeValue = el.dataset.flap!;
      });
    };
  }, []);

  let index = 0;
  return (
    <div className="flapboard" data-tone={failure.tone} role="alert">
      <div className="flapboard-head">
        <span className="flapboard-status">
          <i aria-hidden />
          {failure.status}
        </span>
        <span>Gate L-26 · {time}</span>
      </div>
      <p ref={row} className="flapboard-row" aria-hidden>
        {words.map((w, wi) => (
          <span key={wi} className="flap-word">
            {[...w].map((ch) => {
              const i = index++;
              return (
                <span key={i} data-flap={ch} className="flap" style={{ animationDelay: `${settleAt(i) - 120}ms` }}>
                  {ch}
                </span>
              );
            })}
          </span>
        ))}
      </p>
      <p className="sr-only">{failure.board}</p>
      {onAction && (
        <button type="button" className="flapboard-action" onClick={onAction}>
          Sign in instead <ArrowRight size={12} weight="bold" aria-hidden />
        </button>
      )}
    </div>
  );
}
