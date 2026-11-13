"use client";

import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

type Glyphs = { value: string; ids: number[]; next: number; from: number; count: number };

/** Where `next` differs from `prev`: [first changed index, end of the new run in `next`]. */
function changed(prev: string, next: string): [number, number] {
  let start = 0;
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
  let end = 0;
  while (end < prev.length - start && end < next.length - start && prev[prev.length - 1 - end] === next[next.length - 1 - end]) end++;
  return [start, next.length - end];
}

/**
 * Give every character an identity that survives edits: characters kept on
 * either side of a change keep theirs (so their own animation, if still
 * running, isn't interrupted), and only the inserted ones get new ids and
 * animate in.
 */
function advance(g: Glyphs, value: string): Glyphs {
  const [start, end] = changed(g.value, value);
  const tail = value.length - end;
  const added = Array.from({ length: Math.max(0, end - start) }, (_, k) => g.next + k);
  return {
    value,
    ids: [...g.ids.slice(0, start), ...added, ...g.ids.slice(g.ids.length - tail)],
    next: g.next + added.length,
    from: start,
    count: added.length,
  };
}

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onValue: (value: string) => void;
};

/**
 * A text input whose characters arrive with a little motion: each one typed
 * (or pasted, in a quick cascade) rises into place out of a soft blur. The
 * real input sits on top for everything that matters (caret, selection,
 * autofill, accessibility) with its own glyphs made transparent; a mirror
 * behind draws them, kept in step with the input's sideways scroll.
 */
const Input = forwardRef<HTMLInputElement, Props>(function TypedInput({ value, onValue, className = "", onScroll, ...rest }, ref) {
  const input = useRef<HTMLInputElement>(null);
  const mirror = useRef<HTMLSpanElement>(null);
  useImperativeHandle(ref, () => input.current!);

  const [glyphs, setGlyphs] = useState<Glyphs>(() => ({ value, ids: value.split("").map((_, i) => i), next: value.length, from: 0, count: value.length }));
  const g = value === glyphs.value ? glyphs : advance(glyphs, value);
  if (g !== glyphs) setGlyphs(g);

  const sync = useCallback(() => {
    const el = input.current;
    const m = mirror.current;
    if (el && m) m.style.transform = `translateX(${-el.scrollLeft}px)`;
  }, []);
  useEffect(() => {
    sync();
    const el = input.current;
    if (!el) return;
    // Moving the caret (keys, clicks, selecting) can scroll the input without a scroll event.
    const later = () => requestAnimationFrame(sync);
    const kinds = ["keydown", "pointerup", "select", "blur", "focus"] as const;
    kinds.forEach((k) => el.addEventListener(k, later));
    return () => kinds.forEach((k) => el.removeEventListener(k, later));
  }, [sync, value]);

  return (
    <span className="ty">
      <span className="ty-mirror" aria-hidden>
        <span ref={mirror} className="ty-glyphs">
          {g.ids.map((id, i) => {
            const k = i - g.from;
            return (
              <span key={id} className="ty-ch" style={k >= 0 && k < g.count && g.count > 1 ? ({ "--i": Math.min(k, 24) } as React.CSSProperties) : undefined}>
                {value[i]}
              </span>
            );
          })}
        </span>
      </span>
      <input
        ref={input}
        {...rest}
        value={value}
        className={`ty-input ${className}`}
        onChange={(e) => onValue(e.target.value)}
        onScroll={(e) => {
          sync();
          onScroll?.(e);
        }}
      />
    </span>
  );
});

/** It re-renders only when its own props change: a keystroke in another field leaves it alone. */
export const TypedInput = memo(Input);
