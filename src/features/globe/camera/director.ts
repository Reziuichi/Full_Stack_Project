// CameraDirector — the single owner of camera motion.
//
// Every frame it eases the Cesium camera toward a target OrbitPose (set by the
// scroll timeline), or plays a timed flight. When the user grabs the globe it
// steps aside; on the next scroll it captures wherever the user left the
// camera and blends back into the choreography without a jump.

import type * as Cesium from "cesium";
import type { CesiumModule } from "../cesium/loadCesium";
import { clamp, dampPose, easeInOutCubic, hopArc, lerpPose, poseDelta, type OrbitPose } from "./pose";

const DEG = Math.PI / 180;
/** Minimum camera height above Cesium World Terrain (m). */
const GROUND_CLEARANCE = 90;

interface Flight {
  from: OrbitPose;
  to: OrbitPose;
  start: number;
  duration: number;
  arc: number;
  resolve: () => void;
}

/** Put any Cesium camera where a pose says (also used for the hidden camera that preloads the city ahead). */
export function placeCamera(C: CesiumModule, camera: Cesium.Camera, p: OrbitPose, hpr = new C.HeadingPitchRange(), axisScratch = new C.Cartesian3()) {
  const focus = C.Cartesian3.fromDegrees(p.lng, p.lat, p.height);
  hpr.heading = p.heading * DEG;
  hpr.pitch = clamp(p.pitch, -89.9, 89.9) * DEG;
  hpr.range = Math.max(p.range, 5);
  camera.lookAt(focus, hpr);
  camera.lookAtTransform(C.Matrix4.IDENTITY);
  if (p.roll) camera.twistRight(p.roll * DEG);
  if (p.yaw) {
    // Yaw about the local vertical on oblique shots so the horizon stays
    // level; about the camera's own up axis when looking straight down.
    const vertical = C.Ellipsoid.WGS84.geodeticSurfaceNormal(camera.positionWC, axisScratch);
    const w = clamp((p.pitch + 88) / 35, 0, 1);
    const axis = C.Cartesian3.lerp(camera.up, vertical, w, axisScratch);
    C.Cartesian3.normalize(axis, axis);
    camera.look(axis, p.yaw * DEG);
  }
  if (p.lift) camera.lookDown(p.lift * DEG);
}

export class CameraDirector {
  private current: OrbitPose | null = null;
  private target: OrbitPose | null = null;
  private flight: Flight | null = null;
  private suspended = false;
  private lastTime = performance.now();
  private readonly scratchHpr: Cesium.HeadingPitchRange;
  private readonly scratchAxis: Cesium.Cartesian3;
  private groundHeight: ((carto: Cesium.Cartographic) => number | undefined) | null = null;
  /** Higher = snappier. 4.5 settles in ~0.5 s: smooth, but no rubber-band lag behind the scroll. */
  lambda = 4.5;

  constructor(
    private readonly C: CesiumModule,
    private readonly viewer: Cesium.Viewer,
  ) {
    this.scratchHpr = new C.HeadingPitchRange();
    this.scratchAxis = new C.Cartesian3();
  }

  get isSuspended() {
    return this.suspended;
  }

  get isFlying() {
    return this.flight !== null;
  }

  get pose(): OrbitPose | null {
    return this.current;
  }

  /** Set where the camera should settle. Applied with damping each frame. */
  setTarget(pose: OrbitPose, options: { immediate?: boolean } = {}) {
    this.target = pose;
    if (options.immediate || !this.current) {
      this.current = pose;
      this.apply(pose);
    }
  }

  /** Timed flight from the current view to `to`, then hand back to damping. */
  flyTo(to: OrbitPose, options: { duration?: number; arc?: number; from?: OrbitPose } = {}): Promise<void> {
    this.flight?.resolve();
    this.suspended = false;
    const from = options.from ?? this.current ?? this.capture() ?? to;
    return new Promise((resolve) => {
      this.flight = {
        from,
        to,
        start: performance.now(),
        duration: (options.duration ?? 2.8) * 1000,
        arc: options.arc ?? hopArc(from, to),
        resolve,
      };
    });
  }

  /** The user took over (drag / pinch). Stop driving the camera. */
  suspend() {
    if (this.suspended) return;
    this.suspended = true;
    this.flight?.resolve();
    this.flight = null;
  }

  /** Continue the choreography from wherever the user left the camera. */
  resume() {
    if (!this.suspended) return;
    this.suspended = false;
    this.current = this.capture() ?? this.current;
  }

  /** Abort a running flight; damping continues from the current pose. */
  cancelFlight() {
    if (!this.flight) return;
    const f = this.flight;
    this.flight = null;
    f.resolve();
  }

  destroy() {
    this.flight?.resolve();
    this.flight = null;
  }

  /** Advance one frame. Call from the scene's preUpdate. */
  update() {
    const now = performance.now();
    const dt = clamp((now - this.lastTime) / 1000, 0, 0.1);
    this.lastTime = now;
    if (this.suspended) return;

    if (this.flight) {
      const f = this.flight;
      const t = clamp((now - f.start) / f.duration, 0, 1);
      this.current = lerpPose(f.from, f.to, easeInOutCubic(t), f.arc);
      this.apply(this.current);
      if (t >= 1) {
        this.flight = null;
        f.resolve();
      }
      return;
    }

    if (!this.target) return;
    if (!this.current) this.current = this.target;
    if (poseDelta(this.current, this.target) < 1e-5) {
      this.current = this.target;
    } else {
      this.current = dampPose(this.current, this.target, dt, this.lambda);
    }
    this.apply(this.current);
  }

  /** Position the Cesium camera for a pose. */
  private apply(p: OrbitPose) {
    placeCamera(this.C, this.viewer.camera, p, this.scratchHpr, this.scratchAxis);
    this.clampAboveGround();
  }

  /**
   * With real terrain, never leave the camera inside a mountain: lift it to
   * GROUND_CLEARANCE above the terrain under it, keeping its orientation.
   */
  setGroundClamp(groundHeight: ((carto: Cesium.Cartographic) => number | undefined) | null) {
    this.groundHeight = groundHeight;
  }

  private clampAboveGround() {
    if (!this.groundHeight) return;
    const C = this.C;
    const camera = this.viewer.camera;
    const carto = camera.positionCartographic;
    if (carto.height > 60_000) return;
    const ground = this.groundHeight(carto);
    if (ground === undefined || carto.height >= ground + GROUND_CLEARANCE) return;
    camera.position = C.Cartesian3.fromRadians(carto.longitude, carto.latitude, ground + GROUND_CLEARANCE, undefined, camera.position);
  }

  /** Reconstruct an OrbitPose from the camera's current state. */
  capture(): OrbitPose | null {
    const C = this.C;
    const { camera, scene } = this.viewer;
    const canvas = scene.canvas;
    const ellipsoid = C.Ellipsoid.WGS84;
    const center = new C.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
    let focus = camera.pickEllipsoid(center, ellipsoid);
    if (!focus) {
      // Looking past the limb: orbit the point under the camera instead.
      focus = ellipsoid.scaleToGeodeticSurface(camera.positionWC, new C.Cartesian3());
      if (!focus) return null;
    }
    const range = C.Cartesian3.distance(camera.positionWC, focus);
    const carto = C.Cartographic.fromCartesian(focus);
    const enu = C.Transforms.eastNorthUpToFixedFrame(focus);
    const inv = C.Matrix4.inverseTransformation(enu, new C.Matrix4());
    const d = C.Matrix4.multiplyByPointAsVector(inv, camera.directionWC, new C.Cartesian3());
    C.Cartesian3.normalize(d, d);
    return {
      lat: carto.latitude / DEG,
      lng: carto.longitude / DEG,
      height: carto.height,
      heading: Math.atan2(d.x, d.y) / DEG,
      pitch: Math.asin(clamp(d.z, -1, 1)) / DEG,
      range,
      roll: 0,
      yaw: 0,
      lift: 0,
    };
  }
}
