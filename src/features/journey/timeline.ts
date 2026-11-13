// The scroll timeline: which scene is active for a given scroll progress.
// The journey section is `totalWeight` viewport-heights tall; each scene
// occupies a share of it proportional to its weight.

export type SceneId = "earth" | "location" | "choose" | "route" | "arrive" | "attraction" | "outro";

export interface Segment {
  id: SceneId;
  index: number;
  /** Attraction index for `attraction` segments. */
  attraction?: number;
  start: number; // progress 0..1
  end: number;
}

export interface Timeline {
  segments: Segment[];
  totalWeight: number;
}

const WEIGHTS: Record<Exclude<SceneId, "attraction">, number> = {
  earth: 1.1,
  location: 1,
  choose: 1.1,
  route: 1.9,
  arrive: 1.3,
  outro: 0.9,
};
const ATTRACTION_WEIGHT = 1.15;

/**
 * Share of each attraction segment spent flying from the previous stop. The
 * scene (panel, title, rail) hands over halfway through that flight — when
 * the camera is closer to the new landmark — not the moment the segment starts.
 */
export const ATTRACTION_TRANSITION = 0.38;
/** Where a jump to a landmark (the rail, the panel's next/previous) comes to rest in its segment… */
export const ATTRACTION_REST = 0.6;
/** …which is this far through the camera's slow sweep round it (the shot the city is preloaded for). */
export const ATTRACTION_REST_SWEEP = (ATTRACTION_REST - ATTRACTION_TRANSITION) / (1 - ATTRACTION_TRANSITION);

export function buildTimeline(attractionCount: number): Timeline {
  const plan: { id: SceneId; weight: number; attraction?: number }[] = [
    { id: "earth", weight: WEIGHTS.earth },
    { id: "location", weight: WEIGHTS.location },
    { id: "choose", weight: WEIGHTS.choose },
    { id: "route", weight: WEIGHTS.route },
    { id: "arrive", weight: WEIGHTS.arrive },
    ...Array.from({ length: attractionCount }, (_, i) => ({ id: "attraction" as const, weight: ATTRACTION_WEIGHT, attraction: i })),
    { id: "outro", weight: WEIGHTS.outro },
  ];
  const totalWeight = plan.reduce((s, p) => s + p.weight, 0);
  let acc = 0;
  const segments = plan.map((p, index) => {
    const start = acc / totalWeight;
    acc += p.weight;
    return { id: p.id, index, attraction: p.attraction, start, end: acc / totalWeight };
  });
  return { segments, totalWeight };
}

export function locate(timeline: Timeline, progress: number): { segment: Segment; local: number } {
  const p = Math.min(1, Math.max(0, progress));
  const segment = timeline.segments.find((s) => p < s.end) ?? timeline.segments[timeline.segments.length - 1];
  const local = (p - segment.start) / Math.max(1e-6, segment.end - segment.start);
  return { segment, local: Math.min(1, Math.max(0, local)) };
}

/** The scene to show for a scroll position (see ATTRACTION_TRANSITION). */
export function sceneAt(timeline: Timeline, progress: number): { index: number; id: SceneId; attraction: number } {
  const { segment, local } = locate(timeline, progress);
  const i = segment.attraction ?? -1;
  if (segment.id === "attraction" && i > 0 && local < ATTRACTION_TRANSITION / 2) {
    return { index: segment.index - 1, id: "attraction", attraction: i - 1 };
  }
  return { index: segment.index, id: segment.id, attraction: i };
}

export function segmentOf(timeline: Timeline, id: SceneId, attraction?: number): Segment | undefined {
  return timeline.segments.find((s) => s.id === id && (attraction === undefined || s.attraction === attraction));
}
