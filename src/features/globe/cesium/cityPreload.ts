// Streams the photoreal city ahead of the camera.
//
// Without this, Google's 3D tiles for a city are only requested once the
// camera is there, so every arrival opens on a blur that takes seconds to
// sharpen (measured: ~10 of ~80 tiles ready on arrival in Paris and Tokyo,
// ~5 s more on a fast connection, far longer on a slow one).
//
// Cesium already knows how to load tiles for where a camera *will* be: its
// "preload flight destination" pass traverses the tileset from a second camera
// and requests those tiles first. It only runs during Cesium's own camera.flyTo,
// which the journey doesn't use, so here it is switched on for our
// choreography instead: a hidden camera is aimed at each shot still to come
// (the city, then its landmarks), one at a time, until its tiles are in.
//
// The view on screen comes first: from the moment it asks for tiles until
// every download it started has landed, the preloading waits, so the two never
// fight over the connection (measured: the Eiffel Tower's own view needs ~9 MB,
// but arrived behind ~50 MB of preloading for the landmarks after it).
// Preloading fills the time a visitor spends on a view that's already sharp.
//
// Except for the shot the camera is flying to (`lead`). While it travels, the
// view on screen is a blur of passing frames, each asking for tiles it will
// never need again; waiting for those meant the destination only started
// downloading once the camera had landed (up to ~3 s of blur on arrival when
// clicking straight from one landmark to the next). So the destination is
// prepared all through the flight, and the passing views draw what is already
// loaded without asking for more: the whole connection goes to where the
// camera is going.
//
// Shots are prepared at the detail a view settles on once the camera rests
// (`detail`), not the coarser one it travels at: arriving at a prepared shot,
// the sharp tiles are already there, with no second wave of downloads.

import type * as Cesium from "cesium";
import type { CesiumModule } from "./loadCesium";
import type { OrbitPose } from "../camera/pose";
import { placeCamera } from "../camera/director";

/** Cesium's private tileset pass numbers (Cesium3DTilePass): the view on screen, the ordinary hidden-tileset preload, and the flight preload. */
const PASS_RENDER = 0;
const PASS_PRELOAD = 3;
const PASS_PRELOAD_FLIGHT = 4;
/** A shot counts as loaded after this many preloading frames with nothing pending… */
const QUIET_FRAMES = 3;
/** …but give it at least this long (the first frames haven't requested anything yet)… */
const MIN_MS = 700;
/** …and no more than this much preloading time, so one stuck tile can't hold up the shots after it. */
const MAX_MS = 20_000;
/** After the view on screen last asked for tiles, wait this long before preloading again. */
const YIELD_MS = 450;

type PreloadScene = Cesium.Scene & { preloadFlightCamera: Cesium.Camera; preloadFlightCullingVolume: Cesium.CullingVolume | undefined };
type PassState = { pass: number };
type PassTileset = Cesium.Cesium3DTileset & {
  updateForPass(frameState: unknown, passState: PassState): void;
  statistics: { numberOfPendingRequests: number; numberOfTilesProcessing: number };
  /** Tiles the last traversal wanted and hasn't requested yet (after a frame: the visible view's). */
  _requestedTiles: unknown[];
};

export class CityPreloader {
  private tileset: PassTileset | null = null;
  private shots: OrbitPose[] = [];
  private key = "";
  private index = 0;
  /** Time spent actually preloading the current shot. */
  private spent = 0;
  private lastFrameAt = 0;
  private quiet = 0;
  private screenWantedAt = -Infinity;
  /** The view on screen asked for tiles and its downloads haven't all landed yet. */
  private screenLoading = false;
  /** Tiles the shot's own pass still had to request in the last frame (-1: it didn't run). */
  private shotWants = -1;
  /** The first shot is where the camera is going: it doesn't wait for the view on screen. */
  private lead = false;
  private readonly scene: PreloadScene;
  private readonly restore: () => void;
  /** The detail (maximum screen-space error) shots are prepared at. */
  detail = 24;
  /** The camera is moving (the engine says so each frame). */
  travelling = false;
  /** While the camera travels to the shot being prepared, the passing views ask for no tiles. */
  quietTransit = true;
  /** …and the shot downloads as many tiles at once as a resting view does (see the engine). */
  leadAtFullSpeed = true;

  constructor(
    private readonly C: CesiumModule,
    private readonly viewer: Cesium.Viewer,
  ) {
    this.scene = viewer.scene as PreloadScene;
    // Cesium runs its flight-preload pass only while camera.flyTo is in progress.
    const camera = viewer.camera as Cesium.Camera & { canPreloadFlight(): boolean };
    const own = camera.canPreloadFlight;
    camera.canPreloadFlight = () => (this.busy && !this.yielding(performance.now())) || own.call(camera);
    this.restore = () => {
      camera.canPreloadFlight = own;
    };
  }

  /**
   * Use this tileset. `preloadHere` says whether Cesium's ordinary hidden-tileset
   * preload (tiles for the current view, while the city isn't shown yet) should
   * run: from orbit it would fetch the whole hemisphere's coarse tiles, which
   * only compete with the shots being prepared.
   */
  attach(tileset: Cesium.Cesium3DTileset, preloadHere: () => boolean) {
    const t = tileset as PassTileset;
    const update = t.updateForPass.bind(t);
    // Stands in for the tileset's list of tiles to request while a passing view draws: the
    // traversal still adds to it, but nothing is kept, so nothing is requested.
    const nothing = Object.assign([] as unknown[], { push: () => 0 });
    t.updateForPass = (frameState, passState) => {
      if (passState.pass === PASS_PRELOAD && !preloadHere()) return;
      if (passState.pass === PASS_PRELOAD_FLIGHT) {
        const own = t.maximumScreenSpaceError;
        t.maximumScreenSpaceError = this.detail;
        update(frameState, passState);
        t.maximumScreenSpaceError = own;
      } else if (passState.pass === PASS_RENDER && this.quietTransit && this.travelling && this.leading) {
        const list = t._requestedTiles;
        t._requestedTiles = nothing;
        update(frameState, passState);
        t._requestedTiles = list;
        list.length = 0; // the view on screen wanted nothing (left over: the shot's own wishes)
      } else update(frameState, passState);
      // What the shot still needs: tiles not yet loaded or in flight. Judging by
      // downloads alone would call a shot done in the lull before its first requests.
      if (passState.pass === PASS_PRELOAD_FLIGHT) this.shotWants = t._requestedTiles.length;
    };
    this.tileset = t;
  }

  /** True while shots are still being loaded: keep frames coming so Cesium keeps requesting. */
  get busy() {
    return !!this.tileset && this.index < this.shots.length;
  }

  /** Preparing the shot the camera is travelling to. */
  get leading() {
    return this.lead && this.index === 0 && this.busy;
  }

  /**
   * The shots still to come, nearest first. A new `key` restarts the list.
   * `lead`: the first one is where the camera is travelling to.
   */
  plan(key: string, shots: OrbitPose[], lead = false) {
    if (key === this.key) return;
    this.key = key;
    this.shots = shots;
    this.lead = lead;
    this.index = 0;
    this.aim();
  }

  /** Before a frame: hidden tilesets must be allowed to preload while shots remain. */
  beforeFrame() {
    if (this.busy && this.tileset) this.tileset.preloadWhenHidden = true;
  }

  /** After a frame: note what the screen still wants, and move on once this shot's tiles are in. */
  afterFrame(now: number) {
    const t = this.tileset;
    const dt = Math.min(250, now - this.lastFrameAt);
    this.lastFrameAt = now;
    if (!t) return;
    // The visible view's pass runs last in a frame, so its wishes are what's left in the list.
    // Once it has asked, it's loading until nothing is in flight (the preloading has been
    // waiting meanwhile, so whatever is in flight is the screen's).
    if (t.show && t._requestedTiles.length > 0) {
      this.screenWantedAt = now;
      this.screenLoading = true;
    } else if (this.screenLoading && (!t.show || (t.statistics.numberOfPendingRequests === 0 && t.statistics.numberOfTilesProcessing === 0))) {
      this.screenLoading = false;
    }
    if (!this.busy) return;
    if (this.yielding(now)) {
      this.quiet = 0;
      return;
    }
    this.spent += dt;
    const s = t.statistics;
    const done = this.shotWants === 0 && s.numberOfPendingRequests === 0 && s.numberOfTilesProcessing === 0;
    this.shotWants = -1;
    this.quiet = done ? this.quiet + 1 : 0;
    if ((this.quiet >= QUIET_FRAMES && this.spent > MIN_MS) || this.spent > MAX_MS) {
      this.index++;
      this.aim();
    }
  }

  destroy() {
    this.shots = [];
    this.restore();
  }

  private yielding(now: number) {
    if (this.lead && this.index === 0) return false;
    return this.screenLoading || now - this.screenWantedAt < YIELD_MS;
  }

  private aim() {
    this.spent = 0;
    this.quiet = 0;
    this.shotWants = -1;
    const shot = this.shots[this.index];
    if (!shot) return;
    const view = this.viewer.camera;
    const camera = this.scene.preloadFlightCamera;
    // Same lens and aspect as the real camera, so the same tiles are chosen.
    camera.frustum = view.frustum.clone();
    placeCamera(this.C, camera, shot);
    this.scene.preloadFlightCullingVolume = camera.frustum.computeCullingVolume(camera.positionWC, camera.directionWC, camera.upWC);
  }
}
