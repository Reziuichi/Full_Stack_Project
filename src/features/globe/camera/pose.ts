// Camera pose model shared by the scroll timeline, the director and flights.
// Pure math — no Cesium — so it can be reasoned about and tested in isolation.
//
// A pose orbits a focus point on/above the Earth, like Cesium's
// camera.lookAt(target, HeadingPitchRange). `yaw`/`lift` then nudge the view
// so the subject sits off-centre (composition), and `roll` tilts the horizon.

import type { LatLng } from "@/lib/types";
import { centralAngle, EARTH_RADIUS_M, interpolateGreatCircle, wrapLongitude } from "@/lib/geo";

export interface OrbitPose {
  lat: number; // focus latitude (deg)
  lng: number; // focus longitude (deg)
  height: number; // focus height above ellipsoid (m)
  heading: number; // deg clockwise from north — the direction the camera faces
  pitch: number; // deg, negative looks down; -90 is straight down
  range: number; // metres from focus to camera
  roll: number; // deg horizon tilt
  yaw: number; // deg — positive turns the view right, moving the subject left
  lift: number; // deg — positive tilts the view down, moving the subject up
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
export const easeInOutCubic = (t: number) => {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

/** Shortest-path interpolation between two angles in degrees. */
export function lerpAngle(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * t;
}

const logLerp = (a: number, b: number, t: number) => Math.exp(lerp(Math.log(Math.max(a, 1)), Math.log(Math.max(b, 1)), t));

export function pose(p: Partial<OrbitPose> & Pick<OrbitPose, "lat" | "lng" | "range">): OrbitPose {
  return { height: 0, heading: 0, pitch: -90, roll: 0, yaw: 0, lift: 0, ...p };
}

/**
 * Interpolate two poses. The focus travels along the great circle, range
 * interpolates logarithmically (constant perceived zoom speed), and `arc`
 * optionally lifts the camera mid-way so long hops read as a flight.
 */
export function lerpPose(a: OrbitPose, b: OrbitPose, t: number, arc = 0): OrbitPose {
  const focus = interpolateGreatCircle(a, b, t);
  let range = logLerp(a.range, b.range, t);
  if (arc > 0) range *= 1 + arc * Math.sin(Math.PI * clamp(t, 0, 1));
  return {
    lat: focus.lat,
    lng: focus.lng,
    height: lerp(a.height, b.height, t),
    heading: lerpAngle(a.heading, b.heading, t),
    pitch: lerp(a.pitch, b.pitch, t),
    range,
    roll: lerp(a.roll, b.roll, t),
    yaw: lerp(a.yaw, b.yaw, t),
    lift: lerp(a.lift, b.lift, t),
  };
}

/**
 * How much to lift the camera when hopping between two poses so both ends
 * stay in view and the move reads as travel rather than a ground-level slide.
 */
export function hopArc(a: OrbitPose, b: OrbitPose): number {
  const dist = centralAngle(a, b) * EARTH_RADIUS_M;
  const base = Math.max(a.range, b.range);
  if (dist < base * 0.35) return 0;
  return clamp((dist * 0.9) / base - 0.3, 0, 6);
}

/** Frame-rate independent exponential damping toward a target pose. */
export function dampPose(current: OrbitPose, target: OrbitPose, dt: number, lambda: number): OrbitPose {
  const t = 1 - Math.exp(-lambda * dt);
  return lerpPose(current, target, t);
}

/** A rough "how different are these views" metric, used to settle the director. */
export function poseDelta(a: OrbitPose, b: OrbitPose): number {
  const angular = (centralAngle(a, b) * EARTH_RADIUS_M) / Math.max(a.range, 1);
  const rangeRatio = Math.abs(Math.log(Math.max(a.range, 1) / Math.max(b.range, 1)));
  const angles =
    (Math.abs(lerpAngle(a.heading, b.heading, 1) - a.heading) +
      Math.abs(a.pitch - b.pitch) +
      Math.abs(a.roll - b.roll) +
      Math.abs(a.yaw - b.yaw) +
      Math.abs(a.lift - b.lift)) /
    57.3;
  return angular + rangeRatio + angles + Math.abs(a.height - b.height) / Math.max(a.range, 1);
}

export function withFocus(p: OrbitPose, focus: LatLng, height = p.height): OrbitPose {
  return { ...p, lat: focus.lat, lng: wrapLongitude(focus.lng), height };
}
