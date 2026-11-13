// Single place that registers GSAP plugins (client only).
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { Flip } from "gsap/Flip";
import { SplitText } from "gsap/SplitText";
import { CustomEase } from "gsap/CustomEase";
import { CustomWiggle } from "gsap/CustomWiggle";
import { useGSAP } from "@gsap/react";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, ScrollToPlugin, SplitText, Flip, CustomEase, CustomWiggle, useGSAP);
  if (process.env.NODE_ENV !== "production") {
    Object.assign(window, { __gsap: gsap, __ScrollTrigger: ScrollTrigger });
  }
}

/** matchMedia conditions: full choreography, or a calmer version for reduced motion. */
export const MOTION_QUERIES = {
  full: "(prefers-reduced-motion: no-preference)",
  reduce: "(prefers-reduced-motion: reduce)",
};

export { gsap, ScrollTrigger, ScrollToPlugin, SplitText, Flip, CustomEase, CustomWiggle, useGSAP };
