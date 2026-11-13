// Scroll-driven camera choreography.
//
// `poseForProgress` is a pure function: given the journey (origin,
// destination, attractions) and the scroll progress, it returns the camera
// pose plus route/marker state for that moment. `updateCameraFromScroll`
// feeds it to the CameraDirector, which damps toward it every frame — so
// scrubbing the scrollbar produces smooth, cinematic motion.

import type { Attraction, Destination, LatLng } from "@/lib/types";
import { centralAngle, distanceMeters, EARTH_RADIUS_M, initialBearing, interpolateGreatCircle, wrapLongitude } from "@/lib/geo";
import { ATTRACTION_TRANSITION, locate, type SceneId, type Timeline } from "@/features/journey/timeline";
import {
  clamp,
  easeInOutCubic,
  hopArc,
  lerp,
  lerpPose,
  pose,
  smoothstep,
  type OrbitPose,
} from "./pose";
import type { CameraDirector } from "./director";
import { arcAltitude } from "../route/route";

export interface Viewport {
  width: number;
  height: number;
  /** Vertical field of view in radians. */
  fovy: number;
}

export interface JourneyCameraContext {
  origin: LatLng;
  destination: Destination | null;
  attractions: Attraction[];
  timeline: Timeline;
  viewport: Viewport;
  /** Cesium World Terrain + sharp imagery are loaded — closer shots look good. */
  detailed: boolean;
}

export interface ScrollFrame {
  pose: OrbitPose;
  scene: SceneId;
  sceneIndex: number;
  local: number;
  /** 0..1 how much of the route polyline is drawn. */
  routeProgress: number;
  /** Route visibility 0..1. */
  routeOpacity: number;
  /** Index of the highlighted attraction, or -1. */
  activeAttraction: number;
  /** The attraction the camera is at or flying to (its segment's), or -1. */
  targetAttraction: number;
}

const EARTH_R = 6_371_000;

/** Camera range at which the whole Earth fills `fraction` of the smaller screen dimension. */
export function rangeForEarthFraction(viewport: Viewport, fraction: number): number {
  const aspect = viewport.width / Math.max(1, viewport.height);
  const fovx = 2 * Math.atan(Math.tan(viewport.fovy / 2) * aspect);
  const minFov = Math.min(viewport.fovy, fovx);
  const alpha = (fraction * minFov) / 2;
  return EARTH_R / Math.sin(alpha) - EARTH_R;
}

function isPortrait(v: Viewport) {
  return v.width < v.height * 0.9 || v.width < 768;
}

/** Composition offsets: subject left of the right-hand panels on desktop, higher on mobile. */
function compose(v: Viewport, strength = 1): Pick<OrbitPose, "yaw" | "lift"> {
  if (isPortrait(v)) {
    // Phones: panels cover the lower 60%, so aim the subject at the middle of
    // the strip between the title and the panels, whatever the scene.
    const region = freeRegion(v);
    const dy = (region.top + region.bottom) / 2 - v.height / 2;
    return { yaw: 0, lift: (Math.atan(-dy / focalLengths(v).fy) * 180) / Math.PI };
  }
  return { yaw: 9 * strength, lift: 1.5 * strength };
}

/** Scene 1 — the whole Earth, slowly turning. */
export function overviewPose(ctx: JourneyCameraContext, timeSeconds: number): OrbitPose {
  const v = ctx.viewport;
  const drift = (timeSeconds * 1.1) % 360;
  return pose({
    lat: clamp(ctx.origin.lat * 0.45, -30, 35),
    lng: wrapLongitude(ctx.origin.lng - 24 + drift),
    range: rangeForEarthFraction(v, isPortrait(v) ? 0.86 : 0.54),
    pitch: -90,
    heading: 0,
    ...compose(v),
  });
}

/** Opening shot: skimming the limb, like the reference intro. */
export function introPose(ctx: JourneyCameraContext): OrbitPose {
  return pose({
    lat: clamp(ctx.origin.lat - 18, -40, 40),
    lng: wrapLongitude(ctx.origin.lng - 40),
    range: 1_900_000,
    pitch: -6,
    heading: 62,
    roll: -16,
    yaw: 0,
    lift: -4,
  });
}

function originPose(ctx: JourneyCameraContext): OrbitPose {
  const v = ctx.viewport;
  return pose({
    lat: ctx.origin.lat,
    lng: ctx.origin.lng,
    range: isPortrait(v) ? 5_200_000 : 3_600_000,
    pitch: -80,
    heading: 8,
    ...compose(v, 0.8),
  });
}

/** The part of the screen not covered by the scene panel, rail, nav and giant title (px). */
function freeRegion(v: Viewport) {
  if (isPortrait(v)) {
    const top = 64 + v.width * 0.115 + 16; // nav + phone title
    return { left: 16, right: v.width - 16, top, bottom: v.height * 0.4 - 12 }; // panels start at 40%
  }
  const title = 3.4 * 16 + v.width * 0.094 * 0.86; // bottom HUD + giant title
  // Right edge leaves room for the panel (≈470px incl. rail) plus a marker label.
  return { left: 32, right: v.width - 620, top: 80, bottom: v.height - title - 8 };
}

function focalLengths(v: Viewport) {
  const aspect = v.width / Math.max(1, v.height);
  const fovx = 2 * Math.atan(Math.tan(v.fovy / 2) * aspect);
  return { fx: v.width / 2 / Math.tan(fovx / 2), fy: v.height / 2 / Math.tan(v.fovy / 2) };
}

/**
 * "Here → there" shot: both endpoints and the line between them framed inside
 * the free screen area, with a margin, so the blink + draw animation is fully
 * visible. Uses the route's bearing to know how much of it runs across vs up.
 */
function choosePose(ctx: JourneyCameraContext): OrbitPose {
  const v = ctx.viewport;
  const dest = ctx.destination;
  if (!dest) return { ...originPose(ctx), range: originPose(ctx).range * 1.5, pitch: -86 };

  const angle = centralAngle(ctx.origin, dest);
  const mid = interpolateGreatCircle(ctx.origin, dest, 0.5);
  const bearing = (initialBearing(mid, dest) * Math.PI) / 180;
  const region = freeRegion(v);
  const { fx, fy } = focalLengths(v);

  // Centre the route in the free region.
  const dx = (region.left + region.right) / 2 - v.width / 2;
  const dy = (region.top + region.bottom) / 2 - v.height / 2;
  const yaw = (Math.atan(-dx / fx) * 180) / Math.PI;
  const lift = (Math.atan(-dy / fy) * 180) / Math.PI;

  // Distance at which the half-chord fits in 80% of the free half-width/height.
  const halfChord = EARTH_R * Math.sin(angle / 2);
  const ax = Math.atan((((region.right - region.left) / 2) * 0.8) / fx);
  const ay = Math.atan((((region.bottom - region.top) / 2) * 0.8) / fy);
  const d = Math.max((halfChord * Math.abs(Math.sin(bearing))) / Math.tan(ax), (halfChord * Math.abs(Math.cos(bearing))) / Math.tan(ay), 1);
  const sag = EARTH_R * (1 - Math.cos(angle / 2));
  const range = clamp(d - sag, 300_000, 36_000_000);

  return pose({ lat: mid.lat, lng: mid.lng, range, pitch: -88, heading: 0, yaw, lift });
}

function routeDistance(ctx: JourneyCameraContext) {
  return ctx.destination ? centralAngle(ctx.origin, ctx.destination) * EARTH_RADIUS_M : 0;
}

/** Chase camera riding behind the airplane, focused on it at cruise altitude. */
function routeFollowPose(ctx: JourneyCameraContext, t: number): OrbitPose {
  const dest = ctx.destination!;
  const d = routeDistance(ctx);
  const head = interpolateGreatCircle(ctx.origin, dest, t);
  const ahead = interpolateGreatCircle(ctx.origin, dest, Math.min(1, t + 0.02));
  const bearing = t >= 0.98 ? initialBearing(interpolateGreatCircle(ctx.origin, dest, 0.97), dest) : initialBearing(head, ahead);
  const peak = clamp(d * 0.85, 350_000, 9_000_000);
  const endRange = clamp(d * 0.28, 90_000, 1_600_000);
  const startRange = clamp(d * 0.45, 220_000, 4_000_000);
  const range =
    t < 0.5
      ? Math.exp(lerp(Math.log(startRange), Math.log(peak), smoothstep(t / 0.5)))
      : Math.exp(lerp(Math.log(peak), Math.log(endRange), smoothstep((t - 0.5) / 0.5)));
  const pitch = t < 0.5 ? lerp(-72, -52, smoothstep(t / 0.5)) : lerp(-52, -48, smoothstep((t - 0.5) / 0.5));
  const v = ctx.viewport;
  const altitude = arcAltitude(distanceMeters(ctx.origin, dest), t, 0, Math.max(0, dest.elevation));
  return pose({ lat: head.lat, lng: head.lng, height: altitude, range, pitch, heading: bearing, ...compose(v, 0.55) });
}

export function destinationPose(ctx: JourneyCameraContext): OrbitPose {
  const dest = ctx.destination!;
  const scale = ctx.detailed ? 1 : 2.4;
  return pose({
    lat: dest.lat,
    lng: dest.lng,
    height: dest.elevation,
    heading: dest.camera.heading,
    pitch: ctx.detailed ? dest.camera.pitch : Math.min(dest.camera.pitch, -48),
    range: dest.camera.range * scale,
    ...compose(ctx.viewport, 0.5),
  });
}

export function attractionPose(ctx: JourneyCameraContext, a: Attraction, sweep: number): OrbitPose {
  const scale = ctx.detailed ? 1 : 4.5;
  return pose({
    lat: a.lat,
    lng: a.lng,
    height: ctx.detailed ? a.focusHeight : Math.max(0, a.elevation),
    heading: a.viewHeading + lerp(-14, 16, sweep),
    pitch: ctx.detailed ? a.viewPitch : Math.min(a.viewPitch, -45),
    range: a.viewRange * scale,
    ...compose(ctx.viewport, 0.45),
  });
}

function outroPose(ctx: JourneyCameraContext): OrbitPose {
  const base = destinationPose(ctx);
  return { ...base, heading: base.heading + 55, pitch: Math.max(base.pitch, -30), range: base.range * 2.6, ...compose(ctx.viewport, 1) };
}

/**
 * Route scene: how far along the route the camera (`eased`) and the airplane
 * (`plane`, slightly ahead so it lands before the camera settles) are, for
 * the scene's local progress 0..1.
 */
export function routeFlight(local: number) {
  const eased = easeInOutCubic(clamp((local - 0.08) / 0.84, 0, 1));
  return { eased, plane: clamp(eased * 1.04, 0, 1) };
}

/** Pure mapping from scroll progress to camera + scene state. */
export function poseForProgress(ctx: JourneyCameraContext, progress: number, timeSeconds: number): ScrollFrame {
  const { segment, local } = locate(ctx.timeline, progress);
  const base = { scene: segment.id, sceneIndex: segment.index, local, routeProgress: 0, routeOpacity: 0, activeAttraction: -1, targetAttraction: segment.attraction ?? -1 };
  const hasDest = !!ctx.destination;

  switch (segment.id) {
    case "earth": {
      const from = overviewPose(ctx, timeSeconds);
      // Ease toward the origin during the last third so scene 2 arrives smoothly.
      const toward = lerpPose(from, originPose(ctx), smoothstep((local - 0.66) / 0.34) * 0.25);
      return { ...base, pose: toward };
    }
    case "location": {
      const from = lerpPose(overviewPose(ctx, timeSeconds), originPose(ctx), 0.25);
      return { ...base, pose: lerpPose(from, originPose(ctx), easeInOutCubic(local / 0.7)) };
    }
    case "choose": {
      // Frame A and B together; the engine blinks both and draws the line here.
      const p = lerpPose(originPose(ctx), choosePose(ctx), easeInOutCubic(local / 0.55));
      return { ...base, pose: p, routeOpacity: hasDest ? smoothstep(local / 0.15) : 0 };
    }
    case "route": {
      if (!hasDest) return { ...base, pose: choosePose(ctx) };
      const { eased, plane } = routeFlight(local);
      const follow = routeFollowPose(ctx, eased);
      // Swoop from the wide "here → there" shot onto the travelling head.
      const swoop = smoothstep(local / 0.22);
      const p = swoop < 1 ? lerpPose(choosePose(ctx), follow, swoop) : follow;
      return { ...base, pose: p, routeProgress: plane, routeOpacity: 1 };
    }
    case "arrive": {
      if (!hasDest) return { ...base, pose: choosePose(ctx) };
      const from = routeFollowPose(ctx, 1);
      const to = destinationPose(ctx);
      return { ...base, pose: lerpPose(from, to, easeInOutCubic(local / 0.85)), routeProgress: 1, routeOpacity: 1 - smoothstep((local - 0.75) / 0.25) * 0.6 };
    }
    case "attraction": {
      if (!hasDest) return { ...base, pose: choosePose(ctx) };
      const i = segment.attraction ?? 0;
      const a = ctx.attractions[i];
      if (!a) return { ...base, pose: destinationPose(ctx) };
      const prev =
        i === 0 ? destinationPose(ctx) : attractionPose(ctx, ctx.attractions[i - 1], 1);
      const arrival = attractionPose(ctx, a, 0);
      const transition = ATTRACTION_TRANSITION;
      if (local < transition) {
        const t = easeInOutCubic(local / transition);
        return { ...base, pose: lerpPose(prev, arrival, t, hopArc(prev, arrival)), activeAttraction: t > 0.5 ? i : i - 1, routeOpacity: 0.4 * (1 - t) };
      }
      const sweep = (local - transition) / (1 - transition);
      return { ...base, pose: attractionPose(ctx, a, sweep), activeAttraction: i };
    }
    case "outro": {
      if (!hasDest) return { ...base, pose: choosePose(ctx) };
      const last = ctx.attractions.length ? attractionPose(ctx, ctx.attractions[ctx.attractions.length - 1], 1) : destinationPose(ctx);
      const to = outroPose(ctx);
      return { ...base, pose: lerpPose(last, to, easeInOutCubic(local / 0.8), hopArc(last, to) * 0.5), routeOpacity: 0 };
    }
  }
}

/**
 * Apply the scroll position to the 3D camera. Returns the frame so the
 * engine can update the route and markers to match.
 */
export function updateCameraFromScroll(
  director: CameraDirector,
  ctx: JourneyCameraContext,
  progress: number,
  timeSeconds: number,
): ScrollFrame {
  const frame = poseForProgress(ctx, progress, timeSeconds);
  director.setTarget(frame.pose);
  return frame;
}
