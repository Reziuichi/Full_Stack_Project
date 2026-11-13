"use client";

import { memo, useEffect, useRef } from "react";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/·";

/**
 * The oversized monospace line along the bottom of the hero — the signature
 * element from the reference. Text changes decode character by character.
 * Font size fits the string to the available width (mono = 0.6em per char).
 */
export const SceneTitle = memo(function SceneTitle({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(text);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = shown.current;
    const to = text.toUpperCase();
    shown.current = to;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || from === to) {
      el.textContent = to;
      return;
    }
    const length = Math.max(from.length, to.length);
    const start = performance.now();
    const duration = 650;
    let frame = 0;
    const step = (now: number) => {
      const t = (now - start) / duration;
      let out = "";
      for (let i = 0; i < length; i++) {
        const settle = (i / length) * 0.7 + 0.3;
        if (t >= settle) out += to[i] ?? "";
        else if (to[i] === " " || (from[i] === " " && t < 0.15)) out += " ";
        else out += GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      el.textContent = out.trimEnd();
      if (t < 1) frame = requestAnimationFrame(step);
      else el.textContent = to;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [text]);

  const chars = Math.max(text.length, 8);
  return (
    <p
      aria-hidden="true"
      className="pointer-events-none select-none whitespace-nowrap font-mono font-light uppercase leading-[0.86] tracking-[-0.035em] text-fg/90"
      style={{
        fontSize: `min(var(--title-max), calc(var(--title-width) / (${chars} * 0.6)))`,
      }}
    >
      <span ref={ref}>{text.toUpperCase()}</span>
    </p>
  );
});
