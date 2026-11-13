"use client";

import { useEffect, useRef } from "react";

function stamp(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(
    d.getUTCSeconds(),
  )} UTC`;
}

/** Live UTC timestamp, updated without re-rendering React. */
export function HudClock({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const tick = () => {
      if (ref.current) ref.current.textContent = stamp(new Date());
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span ref={ref} className={className} suppressHydrationWarning>
      --/--/---- --:--:-- UTC
    </span>
  );
}
