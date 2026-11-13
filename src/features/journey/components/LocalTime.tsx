"use client";

import { useEffect, useRef } from "react";
import { localTimeIn } from "@/lib/format";

/** Live local time in a destination's time zone (DOM-updated each 15 s). */
export function LocalTime({ timezone, className = "" }: { timezone: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const tick = () => {
      if (ref.current) ref.current.textContent = localTimeIn(timezone);
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [timezone]);
  return (
    <span ref={ref} className={className} suppressHydrationWarning>
      --:--
    </span>
  );
}
