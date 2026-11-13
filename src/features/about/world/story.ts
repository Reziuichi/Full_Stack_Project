// The About page's one timeline, shared by the 3D world and the words over it.
// Scroll progress runs 0 → 1 down the pinned stage; every beat below is a
// stretch of that. Space first (a grey moon comes alive as the Earth), a dive
// through its clouds, dusk above a sea of cloud (the story, then a peak rising
// with how it all works), a descent below the clouds into a valley, and back
// out to orbit, where the planet is yours to turn.

export const BEAT = {
  /** The moon turns into the Earth. */
  life: [0.015, 0.25],
  /** The camera falls towards the planet… */
  dive: [0.265, 0.345],
  /** …through cloud that rises over everything by `cut`, where the world below takes over, and lifts off. */
  veil: [0.298, 0.345, 0.405],
  cut: 0.345,
  /** Dusk over the sea of cloud: the story is told here. */
  story: [0.39, 0.53],
  /** A peak rises out of the cloud, and the cards about how it works with it. */
  rise: [0.52, 0.63],
  works: [0.56, 0.78],
  /** Down through the cloud… */
  descend: [0.77, 0.87],
  /** …whose fog covers everything by 0.808 (as the camera reaches the cloud), where the valley takes over, and lifts. */
  down: [0.76, 0.82, 0.862],
  /** Under the cloud, the valley, alive (depth, mist, light)… */
  valley: [0.82, 0.905],
  /** …draws into a porthole that flies back to orbit and lands on the Earth… */
  port: [0.9, 0.962],
  /** …which is then yours to turn. */
  final: 0.962,
} as const;

/**
 * The four chapters: where each one takes over (`at`, for the index) and the
 * progress it is read at (`rest`, for the anchors and the index's jumps).
 * With reduced motion the story shows only the rests, and the first is the
 * living Earth rather than the moon.
 */
export const CHAPTERS = [
  { id: "about-earth", label: "Live Earth", at: 0, rest: 0, calm: 0.25 },
  { id: "our-story", label: "Our story", at: 0.33, rest: 0.465, calm: 0.5 },
  { id: "how-it-works", label: "How it works", at: 0.55, rest: 0.7, calm: 0.7 },
  { id: "contact", label: "Arrive", at: 0.82, rest: 1, calm: 1 },
] as const;

export const chapterAt = (p: number) => {
  let i = 0;
  while (i < CHAPTERS.length - 1 && p >= CHAPTERS[i + 1].at) i++;
  return i;
};

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** 0 → 1 across [a, b], eased at both ends. */
export const span = (p: number, a: number, b: number) => {
  const t = clamp01((p - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** 0 → 1 → 0: rising across [a, peak], falling across [peak, b]. */
export const bell = (p: number, a: number, peak: number, b: number) => (p < peak ? span(p, a, peak) : 1 - span(p, peak, b));
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
