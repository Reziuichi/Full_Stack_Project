import { useId } from "react";
import type { FailureTone } from "./authFailure";

/**
 * The failure mark, a companion to the orbit tick: a rectangular rubber
 * stamp that slams onto the pass's destination. A ring draws itself, an X is
 * struck through it, and the stamp carries the status and an error code.
 * Red ink when the details were refused, amber when the flight is on hold or
 * delayed. When the traveller starts fixing things it peels away.
 */
export function DeniedStamp({
  tone,
  top,
  bottom,
  code,
  leaving,
  onGone,
}: {
  tone: FailureTone;
  top: string;
  bottom: string;
  code: string;
  leaving: boolean;
  onGone: () => void;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <div
      className="deny"
      data-tone={tone}
      data-leaving={leaving || undefined}
      aria-hidden
      onAnimationEnd={(e) => {
        if (e.animationName === "deny-out") onGone();
      }}
    >
      <svg viewBox="0 0 214 88" focusable="false">
        <defs>
          <filter id={`${id}-ink`} x="-5%" y="-10%" width="110%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" />
            <feDisplacementMap in="SourceGraphic" scale="2.2" />
          </filter>
        </defs>
        <g filter={`url(#${id}-ink)`}>
          <rect className="deny-frame" x="3" y="3" width="208" height="82" rx="9" />
          <rect className="deny-frame-inner" x="9" y="9" width="196" height="70" rx="5" />
          <circle className="deny-ring" cx="45" cy="44" r="23" pathLength={1} />
          <path className="deny-x" d="M35.5 34.5 L54.5 53.5 M54.5 34.5 L35.5 53.5" pathLength={1} />
          <text className="deny-top" x="80" y="34">
            {top.toUpperCase()}
          </text>
          <text className="deny-bottom" x="79" y="58">
            {bottom.toUpperCase()}
          </text>
          <text className="deny-code" x="80" y="72">
            {code}
          </text>
        </g>
      </svg>
    </div>
  );
}
