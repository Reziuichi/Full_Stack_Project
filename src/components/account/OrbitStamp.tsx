import { useId } from "react";
import { PLANE_PATH } from "@/features/globe/route/plane";

/**
 * The "cleared" mark: a passport-style stamp in the site's amber ink. On
 * mount it slams onto the pass, a tick draws itself inside a dashed orbit,
 * and the site's airliner flies one lap around it. The ink edge is roughened
 * with a displacement filter so it reads as a rubber stamp, not a vector.
 */
export function OrbitStamp({ ring, label }: { ring: string; label: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <div className="stamp" role="img" aria-label={label}>
      <svg viewBox="0 0 160 160" focusable="false" aria-hidden>
        <defs>
          <path id={`${id}-ring`} d="M80 80 m-61 0 a61 61 0 1 1 122 0 a61 61 0 1 1 -122 0" />
          <filter id={`${id}-ink`} x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" />
            <feDisplacementMap in="SourceGraphic" scale="2.4" />
          </filter>
        </defs>
        <g filter={`url(#${id}-ink)`}>
          <circle className="stamp-rim" cx="80" cy="80" r="76" />
          <circle className="stamp-rim-inner" cx="80" cy="80" r="70" />
          <text className="stamp-ring">
            <textPath href={`#${id}-ring`} textLength={383} lengthAdjust="spacing">
              {ring}
            </textPath>
          </text>
          <circle className="stamp-track" cx="80" cy="80" r="44" />
          <path className="stamp-tick" d="M59 81 L74 96 L103 63" pathLength={1} />
        </g>
        <g className="stamp-orbit">
          <g transform="translate(80 36) scale(0.95) translate(-12 -12)">
            <path className="stamp-plane" d={PLANE_PATH} />
          </g>
        </g>
      </svg>
    </div>
  );
}
