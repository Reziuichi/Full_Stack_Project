// Screen-space helpers shared by the 2D overlays drawn over the globe.

import type * as Cesium from "cesium";

const POLAR_RADIUS = 6_356_752;

/** True if the straight line from the camera to `p` clears the Earth (sphere test). */
export function lineOfSight(cam: Cesium.Cartesian3, p: Cesium.Cartesian3) {
  const dx = p.x - cam.x;
  const dy = p.y - cam.y;
  const dz = p.z - cam.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 1) return true;
  const t = -(cam.x * dx + cam.y * dy + cam.z * dz) / len2;
  if (t <= 0 || t >= 1) return true;
  const x = cam.x + dx * t;
  const y = cam.y + dy * t;
  const z = cam.z + dz * t;
  return x * x + y * y + z * z > POLAR_RADIUS * POLAR_RADIUS;
}

/** True if `p` is in front of the camera (projects to a real screen position). */
export function inFront(cam: Cesium.Cartesian3, dir: Cesium.Cartesian3, p: Cesium.Cartesian3) {
  return (p.x - cam.x) * dir.x + (p.y - cam.y) * dir.y + (p.z - cam.z) * dir.z > 1;
}
