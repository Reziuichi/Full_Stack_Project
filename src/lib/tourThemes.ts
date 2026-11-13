// Each curated destination sets its own colour on the tours section: a
// ground, the ink set on it, and an accent for the button and badge. Places
// without a palette keep the site's amber. Every pair here is checked for
// contrast: ink on ground ≥ 5.8:1, secondary text ≥ 4.7:1, button text ≥ 4.7:1.

import type { CSSProperties } from "react";

export interface TourTheme {
  /** Shown on the cover, like a colour caption in a magazine. */
  name: string;
  ground: string;
  ink: string;
  accent: string;
  accentInk: string;
  /** How much ink goes into secondary text (the rest is ground). Higher on dark grounds. */
  softMix: number;
  /** The colour lit up for a dark page: glows, rules and markers (the destinations reel). */
  glow: string;
}

export const DEFAULT_TOUR_THEME: TourTheme = {
  name: "Longitude amber",
  ground: "#e6a36a",
  ink: "#1b120a",
  accent: "#1b120a",
  accentInk: "#f6d8b8",
  softMix: 72,
  glow: "#e6a36a",
};

const THEMES: Record<string, TourTheme> = {
  // The city of love: a deep rouge with cream type.
  paris: { name: "Rouge, for the city of love", ground: "#a51c30", ink: "#fdf1ea", accent: "#fdf1ea", accentInk: "#8a1426", softMix: 84, glow: "#e23b54" },
  // Cherry blossom, sumi ink, and the vermilion of a torii gate.
  tokyo: { name: "Sakura, sumi and torii vermilion", ground: "#f3c6cf", ink: "#25161b", accent: "#c73a2c", accentInk: "#fff3ec", softMix: 72, glow: "#f291a8" },
  london: { name: "British racing green", ground: "#1f4a3b", ink: "#f2ebda", accent: "#f2ebda", accentInk: "#1f4a3b", softMix: 82, glow: "#45a077" },
  // Desert sand, with the teal of the Gulf.
  dubai: { name: "Desert sand and Gulf teal", ground: "#e7cc98", ink: "#2a1c0b", accent: "#0f5257", accentInk: "#f7ecd6", softMix: 72, glow: "#e6c07a" },
  "new-york": { name: "Yellow cab", ground: "#f5c518", ink: "#121212", accent: "#121212", accentInk: "#f5c518", softMix: 72, glow: "#f5c518" },
  // The Red Fort's sandstone, with marigold.
  delhi: { name: "Red sandstone and marigold", ground: "#94401f", ink: "#fcefe2", accent: "#f3ad3f", accentInk: "#2b1605", softMix: 86, glow: "#e2773f" },
  // Le Corbusier's own polychromy: ultramarine and ochre.
  chandigarh: { name: "Le Corbusier blue and ochre", ground: "#2c5c99", ink: "#f4efe4", accent: "#e9b949", accentInk: "#1c1406", softMix: 84, glow: "#5f94dc" },
  // Glacier ice and deodar pine.
  manali: { name: "Glacier blue and deodar green", ground: "#c3dce6", ink: "#0f2530", accent: "#24473b", accentInk: "#eef6f2", softMix: 72, glow: "#8fc8de" },
};

export const tourThemeFor = (slug: string): TourTheme => THEMES[slug] ?? DEFAULT_TOUR_THEME;

/** The theme as CSS custom properties, for the section's root element. */
export function tourThemeStyle(t: TourTheme): CSSProperties {
  return {
    "--tour-ground": t.ground,
    "--tour-ink": t.ink,
    "--tour-accent": t.accent,
    "--tour-accent-ink": t.accentInk,
    "--tour-soft-mix": `${t.softMix}%`,
  } as CSSProperties;
}
