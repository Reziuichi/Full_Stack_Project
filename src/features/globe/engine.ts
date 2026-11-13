// GlobeEngine — the imperative 3D core behind the journey.
//
// React owns the journey state (origin, destination, attractions, scroll
// progress) and pushes it here; the engine owns everything Cesium: the
// viewer, the Cesium ion world (World Terrain, World Imagery, OSM Buildings),
// lighting, the camera director, the route, markers and the orbital particle
// halo. No React re-renders
// happen per frame.
//
// Performance: the viewer runs in request-render mode, so a frame is only
// drawn when the camera moves or something animates (the engine requests
// frames explicitly for the route and particles). A small governor adapts
// the canvas resolution to what the GPU can sustain.

import type * as Cesium from "cesium";
import type { Attraction, Destination, LatLng } from "@/lib/types";
import { loadCesium, type CesiumModule } from "./cesium/loadCesium";
import { createViewer, setWheelZoom, updateCameraRelativeLight, type GlobeViewer } from "./cesium/scene";
import { createOrbitalField, type OrbitalField } from "./cesium/orbitalField";
import { CityPreloader } from "./cesium/cityPreload";
import {
  describeIonError,
  loadIonWorld,
  PHOTOREAL_PRELOAD_BELOW,
  PHOTOREAL_SSE_LOW_QUALITY,
  PHOTOREAL_SSE_MOVING,
  PHOTOREAL_SSE_STILL,
  setPhotorealStreaming,
  updateIonWorld,
  type IonWorld,
  type WorldStatus,
} from "./cesium/ionWorld";
import { CameraDirector } from "./camera/director";
import {
  attractionPose,
  destinationPose,
  introPose,
  overviewPose,
  updateCameraFromScroll,
  type JourneyCameraContext,
  type ScrollFrame,
} from "./camera/scrollCamera";
import type { OrbitPose } from "./camera/pose";
import { flyToDestination, flyToLocation } from "./camera/flights";
import { clamp, easeInOutCubic } from "./camera/pose";
import { MarkerLayer, type LinkState, type MarkerHandle } from "./markers/markerLayer";
import { addAttractionMarkers, addDestinationMarker, addLocationMarker } from "./markers/markers";
import { createRoute, RouteLayer, type RouteHandle } from "./route/route";
import { PlaneSprite } from "./route/plane";
import { placeCode } from "@/lib/geo";
import { ATTRACTION_REST_SWEEP, type SceneId, type Timeline } from "@/features/journey/timeline";

export type { WorldStatus };

export interface Telemetry {
  height: number;
  lat: number;
  lng: number;
}

export interface EngineCallbacks {
  /** Cesium ion terrain / imagery / buildings availability. */
  onWorldStatus?(status: WorldStatus): void;
  onUserControl?(active: boolean): void;
  onAttractionSelect?(index: number): void;
  onTelemetry?(t: Telemetry): void;
  onReady?(): void;
  /** A→B connection animation progress, for UI copy ("Connecting…"). */
  onConnection?(phase: ConnectionPhase): void;
}

export interface EngineOptions {
  container: HTMLElement;
  creditContainer: HTMLElement;
  markerContainer: HTMLElement;
  /** Cesium ion access token (NEXT_PUBLIC_CESIUM_ION_TOKEN); blank = offline globe. */
  ionToken: string;
  accentColor: string;
  callbacks: EngineCallbacks;
}

export interface JourneyInput {
  origin: LatLng & { name: string; approximate?: boolean };
  destination: Destination | null;
  attractions: Attraction[];
  timeline: Timeline;
}

const INTRO_SECONDS = 5.2;
/**
 * Landmark shots prepared ahead of the camera: the one it's heading for, then the next two (each
 * is ~100-200 MB of tiles once decoded at full detail; more than three at once overflows the cache
 * and evicts the ones prepared first).
 */
const PRELOAD_AHEAD = 3;

// A→B connection timing: both endpoints blink, then the line draws.
const BLINK_MS = 1300;
const DRAW_MS = 2400;
const ARRIVAL_BURST_MS = 1400;
/** Route fraction at which the airplane counts as landed (destination bursts). */
const TOUCHDOWN = 0.985;
const CONNECT_SCENES = new Set<SceneId>(["choose", "route", "arrive", "attraction", "outro"]);

export type ConnectionPhase = "idle" | "blinking" | "drawing" | "done";

interface Connection {
  key: string;
  phase: ConnectionPhase;
  phaseStart: number;
  drawn: number;
  doneAt: number;
}

export class GlobeEngine {
  private director: CameraDirector;
  private markers: MarkerLayer;
  private orbital: OrbitalField;
  private preloader: CityPreloader;
  private world: IonWorld | null = null;
  /** Terrain + sharp imagery are loaded: close-up city shots look good. */
  private detailed = false;
  private readonly orbitImagery: Cesium.ImageryLayer;
  private route: RouteHandle | null = null;
  private routeKey = "";
  private connection: Connection = { key: "", phase: "idle", phaseStart: 0, drawn: 0, doneAt: 0 };
  private travel = 0;
  private landedAt = -Infinity;
  private plane: PlaneSprite;
  private routeLayer: RouteLayer;
  private originMarker: MarkerHandle | null = null;
  private originKey = "";
  private destinationMarker: MarkerHandle | null = null;
  private attractionMarkers: MarkerHandle[] = [];
  private attractionKey = "";
  private ctx: JourneyCameraContext | null = null;
  private input: JourneyInput | null = null;
  private progress = 0;
  private lastFrame: ScrollFrame | null = null;
  private introRunning = false;
  private freeCamera = false;
  private readonly t0 = performance.now();
  private lastTick = performance.now();
  private readonly heightCorrections = new Map<string, number>();
  private sampledFor = "";
  private lastTelemetry = 0;
  private readonly lightScratch: Cesium.Cartesian3;
  private readonly disposers: (() => void)[] = [];
  private destroyed = false;
  private readonly perf = {
    last: 0,
    sum: 0,
    count: 0,
    cooldownUntil: 0,
    /** Resolution used while the camera moves (adapted by the governor). */
    scale: 1,
    min: 0.6,
    /** Resolution for still frames — sharp when you stop to read. */
    max: Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, 1.5),
    lowQuality: false,
    sharp: false,
    /** Last time the camera moved or an animation ran. */
    lastMoveAt: 0,
    /** Last time the camera itself moved (not tiles streaming or animations). */
    lastCameraMoveAt: 0,
    /** The photoreal city is at its "still" detail level. */
    cityDetailStill: false,
  };
  private readonly lastCamPos: Cesium.Cartesian3;
  private readonly lastCamDir: Cesium.Cartesian3;

  readonly viewer: Cesium.Viewer;

  private constructor(
    private readonly C: CesiumModule,
    globe: GlobeViewer,
    private readonly options: EngineOptions,
  ) {
    const viewer = globe.viewer;
    this.viewer = viewer;
    this.orbitImagery = globe.orbitImagery;
    this.director = new CameraDirector(C, viewer);
    this.markers = new MarkerLayer(C, viewer, options.markerContainer);
    this.orbital = createOrbitalField(C, viewer.scene);
    this.preloader = new CityPreloader(C, viewer);
    this.routeLayer = new RouteLayer(options.markerContainer);
    this.plane = new PlaneSprite(C, viewer, options.markerContainer);
    this.lightScratch = new C.Cartesian3();
    this.lastCamPos = new C.Cartesian3();
    this.lastCamDir = new C.Cartesian3();

    const scene = viewer.scene;
    this.disposers.push(scene.preUpdate.addEventListener(() => this.preUpdate()));
    this.disposers.push(scene.postRender.addEventListener(() => this.postRender()));
    this.bindInput();
    this.watchFirstLoad();
    // While city shots are still loading ahead, keep a slow trickle of frames
    // coming: request-render mode would otherwise stop drawing when the camera
    // rests, and Cesium only requests tiles while it draws.
    const pump = window.setInterval(() => {
      if (!this.destroyed && this.preloader.busy && this.viewer.useDefaultRenderLoop && !document.hidden) scene.requestRender();
    }, 120);
    this.disposers.push(() => window.clearInterval(pump));
  }

  static async create(options: EngineOptions): Promise<GlobeEngine> {
    const C = await loadCesium();
    const globe = createViewer(C, options.container, options.creditContainer);
    const engine = new GlobeEngine(C, globe, options);
    void engine.initWorld();
    if (process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_GLOBE_PROBE === "1") {
      // Debug handle for the browser console (and the performance tests, which can build
      // production with NEXT_PUBLIC_GLOBE_PROBE=1): __globe.viewer.scene …
      (window as unknown as { __globe?: GlobeEngine }).__globe = engine;
    }
    return engine;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Push the latest journey state (markers, route, camera context). */
  setJourney(input: JourneyInput) {
    this.input = input;
    const C = this.C;
    const canvas = this.viewer.scene.canvas;
    const frustum = this.viewer.camera.frustum as Cesium.PerspectiveFrustum;
    this.ctx = {
      origin: input.origin,
      destination: input.destination,
      attractions: this.applyHeightCorrections(input.attractions),
      timeline: input.timeline,
      viewport: { width: canvas.clientWidth, height: canvas.clientHeight, fovy: frustum.fovy ?? C.Math.toRadians(60) },
      detailed: this.detailed,
    };

    // Origin marker
    const originKey = `${input.origin.lat.toFixed(4)},${input.origin.lng.toFixed(4)},${input.origin.name}`;
    if (originKey !== this.originKey) {
      this.originKey = originKey;
      this.originMarker?.remove();
      this.originMarker = addLocationMarker(this.markers, input.origin);
    }

    // Destination marker + route. A new A→B pair replays the connection animation.
    const dest = input.destination;
    const routeKey = dest ? `${originKey}->${dest.slug}` : "";
    if (routeKey !== this.routeKey) {
      this.routeKey = routeKey;
      this.route?.destroy();
      this.route = null;
      this.destinationMarker?.remove();
      this.destinationMarker = null;
      this.connection = { key: routeKey, phase: "idle", phaseStart: 0, drawn: 0, doneAt: 0 };
      this.travel = 0;
      this.landedAt = -Infinity;
      this.options.callbacks.onConnection?.("idle");
      if (dest) {
        this.destinationMarker = addDestinationMarker(this.markers, dest);
        this.route = createRoute(C, this.viewer, input.origin, { lat: dest.lat, lng: dest.lng, height: Math.max(0, dest.elevation) }, {
          color: this.options.accentColor,
        });
      }
      this.plane.setRoute(this.route, dest ? placeCode(dest.name) : "");
    }

    // Attraction markers
    const attractionKey = `${dest?.slug ?? ""}:${input.attractions.map((a) => a.slug).join(",")}`;
    if (attractionKey !== this.attractionKey) {
      this.attractionKey = attractionKey;
      this.attractionMarkers = addAttractionMarkers(this.markers, this.ctx.attractions, (i) => this.options.callbacks.onAttractionSelect?.(i));
    }
    this.viewer.scene.requestRender();
  }

  /** Scroll progress through the journey section, 0..1. */
  setProgress(progress: number) {
    const moved = Math.abs(progress - this.progress) > 0.0005;
    this.progress = progress;
    if (this.introRunning && progress > 0.015) {
      this.introRunning = false;
      this.director.cancelFlight();
    }
    if (moved && this.director.isSuspended && !this.freeCamera) this.resumeJourney();
    this.viewer.scene.requestRender();
  }

  /**
   * Resolves once the origin → destination line for `destinationSlug` has
   * finished drawing (true), or after the timeout (false).
   */
  waitForConnection(destinationSlug: string, timeoutMs = 7000): Promise<boolean> {
    const start = performance.now();
    return new Promise((resolve) => {
      const check = () => {
        if (this.destroyed) return resolve(false);
        const c = this.connection;
        if (c.key.endsWith(`->${destinationSlug}`) && c.phase === "done") return resolve(true);
        if (performance.now() - start > timeoutMs) return resolve(false);
        setTimeout(check, 100);
      };
      check();
    });
  }

  /** The opening shot: skim the limb, then pull back to the whole Earth. */
  playIntro() {
    if (!this.ctx) return;
    this.introRunning = true;
    const t = this.elapsed();
    this.director.setTarget(introPose(this.ctx), { immediate: true });
    void this.director
      .flyTo(overviewPose(this.ctx, t + INTRO_SECONDS), { duration: INTRO_SECONDS, arc: 0 })
      .then(() => {
        this.introRunning = false;
      });
  }

  flyToLocation(place: LatLng) {
    return flyToLocation(this.director, place);
  }

  flyToDestination(destination: Destination) {
    return flyToDestination(this.director, destination, { detailed: this.detailed });
  }

  /** Hand the camera back to the scroll choreography. */
  resumeJourney() {
    if (this.freeCamera) this.setFreeCamera(false);
    this.director.resume();
    this.options.callbacks.onUserControl?.(false);
    this.viewer.scene.requestRender();
  }

  /** Free-camera mode: mouse wheel zooms the globe instead of scrolling the page. */
  setFreeCamera(enabled: boolean) {
    this.freeCamera = enabled;
    setWheelZoom(this.C, this.viewer, enabled);
    if (enabled) {
      this.director.suspend();
      this.options.callbacks.onUserControl?.(true);
    }
  }

  zoom(direction: 1 | -1) {
    this.takeControl();
    const camera = this.viewer.camera;
    const height = Math.max(camera.positionCartographic.height, 200);
    if (direction > 0) camera.zoomIn(height * 0.45);
    else camera.zoomOut(height * 0.8);
  }

  /** Pause rendering while the globe is off-screen. */
  setActive(active: boolean) {
    if (this.destroyed) return;
    this.viewer.useDefaultRenderLoop = active;
    if (active) this.viewer.scene.requestRender();
  }

  /** Terrain and sharp imagery are streaming from Cesium ion. */
  get isDetailed() {
    return this.detailed;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const d of this.disposers) d();
    this.director.destroy();
    this.markers.destroy();
    this.orbital.destroy();
    this.preloader.destroy();
    this.route?.destroy();
    this.routeLayer.destroy();
    this.plane.destroy();
    this.viewer.destroy();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private elapsed() {
    return (performance.now() - this.t0) / 1000;
  }

  private preUpdate() {
    const C = this.C;
    const { camera, scene } = this.viewer;
    const now = performance.now();
    const dt = clamp((now - this.lastTick) / 1000, 0, 0.1);
    this.lastTick = now;
    const time = this.elapsed();

    if (this.ctx) {
      const canvas = scene.canvas;
      this.ctx.viewport.width = canvas.clientWidth;
      this.ctx.viewport.height = canvas.clientHeight;
      this.ctx.detailed = this.detailed;
      this.lastFrame = updateCameraFromScroll(this.director, this.ctx, this.progress, time);
    }
    // Moving the camera here is picked up by Cesium's change detection, so
    // request-render mode still draws every frame while the camera travels.
    this.director.update();
    updateCameraRelativeLight(C, this.viewer, this.lightScratch);

    const height = camera.positionCartographic.height;
    if (updateIonWorld(this.world, scene.globe, this.orbitImagery, height)) scene.requestRender();
    if (this.lastFrame) this.planPreload(this.lastFrame);
    this.preloader.beforeFrame();
    this.orbital.update(time, height);
    if (height > 4_500_000) scene.requestRender(); // keep the particle halo turning in orbit view

    const frame = this.lastFrame;
    if (frame) {
      this.updateConnection(frame, now, dt);
      const inCity = frame.scene === "attraction" || frame.scene === "outro" || (frame.scene === "arrive" && frame.local > 0.6);
      this.markers.setKindVisible("attraction", inCity && height < 160_000);
      this.markers.setKindVisible("destination", !(frame.scene === "attraction" && height < 30_000));
      this.markers.setKindVisible("origin", frame.scene !== "attraction");
      this.attractionMarkers.forEach((m, i) => m.setActive(i === frame.activeAttraction));
    }
    if (this.world?.terrain) this.maybeSampleHeights();
    this.updateMotionResolution(now, height);
  }

  /**
   * Render at the governed resolution while anything moves, and one sharp
   * full-resolution frame once everything has been still for a moment.
   */
  private updateMotionResolution(now: number, height: number) {
    const C = this.C;
    const camera = this.viewer.camera;
    const p = this.perf;
    const tolerance = Math.max(0.05, height * 1e-6);
    const moved =
      !C.Cartesian3.equalsEpsilon(camera.positionWC, this.lastCamPos, 0, tolerance) ||
      C.Cartesian3.dot(camera.directionWC, this.lastCamDir) < 0.99999995;
    C.Cartesian3.clone(camera.positionWC, this.lastCamPos);
    C.Cartesian3.clone(camera.directionWC, this.lastCamDir);
    if (moved) p.lastCameraMoveAt = now;
    this.setCityDetail(now - p.lastCameraMoveAt > 350);
    this.preloader.travelling = moved;
    // Downloads are throttled only while the city is on screen and moving (decoding
    // bursts stall frames there); while it is hidden, preloading runs at full speed,
    // and so does the landmark the camera is flying to.
    const photoreal = this.world?.photoreal;
    const lead = this.preloader.leading && this.preloader.leadAtFullSpeed;
    if (photoreal) setPhotorealStreaming(C, p.cityDetailStill || !photoreal.show || lead);

    const c = this.connection.phase;
    const animating = moved || height > 4_500_000 || c === "blinking" || c === "drawing";
    if (animating) {
      p.lastMoveAt = now;
      if (p.sharp) {
        p.sharp = false;
        this.viewer.resolutionScale = p.scale;
      }
    } else if (!p.sharp && now - p.lastMoveAt > 280) {
      p.sharp = true;
      if (p.max > p.scale) this.viewer.resolutionScale = p.max;
      this.viewer.scene.requestRender();
    }
    // FXAA is the single most expensive pass on integrated GPUs at city level
    // (~9 fps). Skip it while the camera travels — motion hides the aliasing —
    // and anti-alias every still frame. From orbit the scene is cheap: keep it.
    const fxaa = this.viewer.scene.postProcessStages.fxaa;
    const wantFxaa = p.sharp || height > 1_500_000;
    if (fxaa.enabled !== wantFxaa) fxaa.enabled = wantFxaa;
  }

  /**
   * The city shots still ahead of the camera, nearest first: before landing,
   * the arrival shot and the first landmarks; at a landmark, the next ones.
   */
  private planPreload(frame: ScrollFrame) {
    const ctx = this.ctx;
    const dest = ctx?.destination;
    if (!ctx || !dest || !this.world?.photoreal) return;
    const beforeLanding = frame.scene === "earth" || frame.scene === "location" || frame.scene === "choose" || frame.scene === "route" || frame.scene === "arrive";
    // The landmark the camera is flying to stays first until it's there, and loads during the
    // flight rather than waiting for the passing views (see CityPreloader).
    const heading = frame.scene === "attraction" && frame.targetAttraction >= 0;
    const from = beforeLanding ? 0 : frame.scene === "attraction" ? Math.max(0, frame.targetAttraction) : ctx.attractions.length;
    const ahead = ctx.attractions.slice(from, from + PRELOAD_AHEAD);
    const shots: OrbitPose[] = [...(beforeLanding ? [destinationPose(ctx)] : []), ...ahead.map((a) => attractionPose(ctx, a, ATTRACTION_REST_SWEEP))];
    const v = ctx.viewport;
    this.preloader.plan(`${dest.slug}|${beforeLanding ? "in" : from}|${v.width}x${v.height}|${ahead.map((a) => a.slug).join(",")}`, shots, heading);
  }

  /** Coarser photoreal tiles while the camera travels, finer once it rests. */
  private setCityDetail(still: boolean) {
    const tileset = this.world?.photoreal;
    if (!tileset || this.perf.cityDetailStill === still) return;
    this.perf.cityDetailStill = still;
    const levels = this.perf.lowQuality ? PHOTOREAL_SSE_LOW_QUALITY : { moving: PHOTOREAL_SSE_MOVING, still: PHOTOREAL_SSE_STILL };
    tileset.maximumScreenSpaceError = still ? levels.still : levels.moving;
    this.preloader.detail = levels.still;
    if (still) this.viewer.scene.requestRender(); // start refining
  }

  /**
   * A→B connection: when the journey reaches the destination scene, both
   * endpoints blink, then the dotted route draws smoothly from A to B on a
   * timer (not tied to scroll steps), and the destination bursts on arrival.
   * After that, scrolling flies an airplane along it.
   */
  private updateConnection(frame: ScrollFrame, now: number, dt: number) {
    const route = this.route;
    if (!route) return;
    const c = this.connection;

    const before = c.phase;
    if (c.phase === "idle" && CONNECT_SCENES.has(frame.scene)) {
      c.phase = "blinking";
      c.phaseStart = now;
    }
    if (c.phase === "blinking" && now - c.phaseStart >= BLINK_MS) {
      c.phase = "drawing";
      c.phaseStart = now;
    }
    if (c.phase === "drawing") {
      const t = (now - c.phaseStart) / DRAW_MS;
      c.drawn = t >= 1 ? 1 : easeInOutCubic(t);
      if (t >= 1) {
        c.phase = "done";
        c.doneAt = now;
      }
    }
    if (c.phase !== before) this.options.callbacks.onConnection?.(c.phase);

    route.setOpacity(frame.routeOpacity);
    route.setDrawn(c.drawn);

    // The airplane: once the dotted line is complete, scrolling through the
    // route scene flies it from A to B. Its position eases toward the scroll
    // position so wheel steps glide; the dots it passes become contrail.
    const flying = c.phase === "done" && (frame.scene === "route" || (frame.scene === "arrive" && frame.local < 0.35));
    const flown = c.phase === "done" && (frame.scene === "arrive" || frame.scene === "attraction" || frame.scene === "outro");
    let headMoving = false;
    if (flying) {
      const previous = this.travel;
      const delta = frame.routeProgress - this.travel;
      headMoving = Math.abs(delta) > 1e-4;
      this.travel = headMoving ? this.travel + delta * (1 - Math.exp(-7 * dt)) : frame.routeProgress;
      if (previous < TOUCHDOWN && this.travel >= TOUCHDOWN) this.landedAt = now;
      route.setTravel(this.travel);
    } else if (flown) {
      this.travel = 1;
      route.setTravel(1);
    } else {
      this.travel = frame.routeProgress;
      route.setTravel(null);
    }
    this.plane.set(flying && frame.routeOpacity > 0.05 && this.travel < 0.999 ? this.travel : null);

    // Endpoint blinking while the route is on screen.
    const linkVisible = frame.routeOpacity > 0.05 && (frame.scene === "choose" || frame.scene === "route" || (frame.scene === "arrive" && frame.local < 0.5));
    let originLink: LinkState = "none";
    let destinationLink: LinkState = "none";
    if (linkVisible) {
      if (c.phase === "blinking") {
        originLink = "burst";
        destinationLink = "burst";
      } else if (c.phase === "drawing") {
        originLink = "steady";
        destinationLink = "steady";
      } else if (c.phase === "done") {
        originLink = "steady";
        // Burst when the line completes, and again when the airplane touches down.
        destinationLink = now - Math.max(c.doneAt, this.landedAt) < ARRIVAL_BURST_MS ? "burst" : "steady";
      }
    }
    this.markers.setLink("origin", originLink);
    this.markers.setLink("destination", destinationLink);

    if (c.phase === "blinking" || c.phase === "drawing" || headMoving) this.viewer.scene.requestRender();
  }

  private postRender() {
    if (this.route) this.route.draw(this.routeLayer);
    else this.routeLayer.clear();
    this.markers.update();
    this.plane.update();
    const now = performance.now();
    this.preloader.afterFrame(now);
    this.governResolution(now);
    if (this.options.callbacks.onTelemetry && now - this.lastTelemetry > 200) {
      this.lastTelemetry = now;
      const c = this.viewer.camera.positionCartographic;
      this.options.callbacks.onTelemetry({
        height: c.height,
        lat: this.C.Math.toDegrees(c.latitude),
        lng: this.C.Math.toDegrees(c.longitude),
      });
    }
  }

  /**
   * Frame-rate governor: while frames are being drawn back to back, measure
   * the average frame time and nudge the canvas resolution down when the GPU
   * can't keep up (integrated graphics) or back up when there's headroom.
   */
  private governResolution(now: number) {
    const p = this.perf;
    const dt = now - p.last;
    p.last = now;
    // Still frames (including finer tiles streaming in while the camera rests)
    // stay sharp: their frame rate is invisible, and they don't count toward
    // the moving-resolution budget.
    if (p.sharp) return;
    if (dt > 4 && dt < 100) {
      p.sum += dt;
      p.count++;
    }
    if (p.count < 45 || now < p.cooldownUntil) return;
    const avg = p.sum / p.count;
    p.sum = 0;
    p.count = 0;
    const scale = p.scale;
    let next = scale;
    // Aim for 60 fps while moving: drop resolution once more than a few frames miss.
    if (avg > 19.5 && scale > p.min) next = Math.max(p.min, Math.round((scale - 0.1) * 100) / 100);
    else if (avg < 17.5 && scale < p.max) next = Math.min(p.max, Math.round((scale + 0.1) * 100) / 100);
    if (next !== scale) {
      p.scale = next;
      this.viewer.resolutionScale = next;
      p.cooldownUntil = now + 2500;
      this.viewer.scene.requestRender();
    } else if (avg > 30 && scale <= p.min && !p.lowQuality) {
      // Still slow at the lowest resolution: load coarser terrain and 3D tiles.
      p.lowQuality = true;
      this.viewer.scene.globe.maximumScreenSpaceError = 3;
      if (this.world?.buildings) this.world.buildings.maximumScreenSpaceError = 24;
      if (this.world?.photoreal) this.world.photoreal.maximumScreenSpaceError = PHOTOREAL_SSE_LOW_QUALITY.moving;
    }
  }

  private takeControl() {
    if (!this.director.isSuspended) {
      this.director.suspend();
      this.introRunning = false;
      this.options.callbacks.onUserControl?.(true);
    }
  }

  private bindInput() {
    const container = this.options.container;
    const canvas = this.viewer.scene.canvas;

    // Plain wheel over the globe scrolls the page (the journey). Stopping the
    // event before it reaches Cesium's canvas listener leaves the browser's
    // default scroll intact. Ctrl+wheel and free-camera mode zoom the globe.
    const onWheel = (e: WheelEvent) => {
      if (this.freeCamera || e.ctrlKey) {
        this.takeControl();
        return;
      }
      e.stopPropagation();
    };
    const onPointerDown = () => this.takeControl();

    container.addEventListener("wheel", onWheel, { capture: true, passive: true });
    canvas.addEventListener("pointerdown", onPointerDown);
    this.disposers.push(() => {
      container.removeEventListener("wheel", onWheel, { capture: true });
      canvas.removeEventListener("pointerdown", onPointerDown);
    });
  }

  private watchFirstLoad() {
    let done = false;
    const finish = () => {
      if (done || this.destroyed) return;
      done = true;
      remove();
      clearTimeout(timer);
      this.options.callbacks.onReady?.();
    };
    const remove = this.viewer.scene.globe.tileLoadProgressEvent.addEventListener((queued: number) => {
      if (queued === 0) finish();
    });
    const timer = setTimeout(finish, 3500);
    this.disposers.push(() => {
      remove();
      clearTimeout(timer);
    });
  }

  /** Stream the free 3D world from Cesium ion (or report why it is off). */
  private async initWorld() {
    const report = this.options.callbacks.onWorldStatus;
    const token = this.options.ionToken.trim();
    if (!token) {
      report?.({ state: "disabled", reason: "NEXT_PUBLIC_CESIUM_ION_TOKEN is not set" });
      return;
    }
    report?.({ state: "loading" });
    try {
      const world = await loadIonWorld(this.C, this.viewer, token);
      if (!world || this.destroyed) return;
      this.world = world;
      if (world.photoreal) this.preloader.attach(world.photoreal, () => this.viewer.camera.positionCartographic.height < PHOTOREAL_PRELOAD_BELOW);
      if (this.perf.lowQuality) {
        if (world.buildings) world.buildings.maximumScreenSpaceError = 24;
        if (world.photoreal) world.photoreal.maximumScreenSpaceError = PHOTOREAL_SSE_LOW_QUALITY.moving;
      }
      const mode = world.photoreal ? "photoreal" : "osm";
      const city = world.photoreal ?? world.buildings;
      if (city) {
        let failures = 0;
        const offFail = city.tileFailed.addEventListener((err: { message?: string }) => {
          failures += 1;
          if (failures === 8) report?.({ state: "error", mode, reason: `Some 3D city tiles failed to load: ${err?.message ?? "network error"}` });
        });
        this.disposers.push(offFail);
      }
      // Close-up city shots need the photoreal city, or at least terrain + sharp imagery.
      this.detailed = !!world.photoreal || (world.terrain && !!world.imagery);
      // Keep the camera above terrain while the globe is drawn. Under the photoreal
      // city the globe is hidden and its heights go stale, so the clamp stands down.
      const globe = this.viewer.scene.globe;
      this.director.setGroundClamp(world.terrain ? (carto) => (globe.show ? globe.getHeight(carto) : undefined) : null);
      // OSM buildings only matter when photoreal is missing, so their problems don't count then.
      const problems = world.photoreal ? world.problems.filter((p) => !p.startsWith("OSM Buildings")) : world.problems;
      if (problems.length === 0) report?.({ state: "ready", mode });
      else if (!world.terrain && !world.imagery && !city) report?.({ state: "error", reason: problems[0] });
      else if (!world.photoreal && world.buildings) {
        report?.({ state: "error", mode, reason: `${problems.join(" ")} Showing 3D buildings from OpenStreetMap instead.` });
      } else report?.({ state: "error", mode, reason: `Partly loaded. ${problems.join(" ")}` });
      this.viewer.scene.requestRender();
    } catch (error) {
      if (!this.destroyed) report?.({ state: "error", reason: describeIonError(error) });
    }
  }

  /**
   * Put the markers on the real ground: sample Cesium World Terrain under the
   * origin, destination and attractions (once per journey).
   */
  private maybeSampleHeights() {
    const input = this.input;
    if (!input) return;
    const key = `${this.originKey}|${this.attractionKey}`;
    if (this.sampledFor === key) return;
    this.sampledFor = key;
    const C = this.C;
    const dest = input.destination;
    const points: LatLng[] = [input.origin, ...(dest ? [dest] : []), ...input.attractions];
    const cartos = points.map((p) => C.Cartographic.fromDegrees(p.lng, p.lat));
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 12_000));
    void Promise.race([C.sampleTerrainMostDetailed(this.viewer.scene.terrainProvider, cartos), timeout])
      .then((result) => {
        if (!result || this.destroyed || this.sampledFor !== key) return;
        const ground = (i: number) => (Number.isFinite(result[i]?.height) ? result[i].height : null);
        const origin = ground(0);
        if (origin !== null) this.originMarker?.setHeight(origin + 4);
        let offset = 1;
        if (dest) {
          const h = ground(1);
          if (h !== null) this.destinationMarker?.setHeight(h + 4);
          offset = 2;
        }
        input.attractions.forEach((a, i) => {
          const h = ground(i + offset);
          if (h === null) return;
          this.heightCorrections.set(a.slug, h);
          this.attractionMarkers[i]?.setHeight(h + 12);
        });
        if (this.ctx) this.ctx.attractions = this.applyHeightCorrections(input.attractions);
        this.viewer.scene.requestRender();
      })
      .catch(() => {
        /* heights stay at catalogue values */
      });
  }

  private applyHeightCorrections(attractions: Attraction[]): Attraction[] {
    return attractions.map((a) => {
      const ground = this.heightCorrections.get(a.slug);
      if (ground === undefined) return a;
      const aboveGround = Math.max(0, a.focusHeight - a.elevation);
      return { ...a, elevation: ground, focusHeight: ground + aboveGround };
    });
  }
}
