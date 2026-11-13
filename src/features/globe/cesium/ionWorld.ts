// The 3D world from Cesium ion, all streamed with one free Cesium ion access
// token (no Google Maps key or Google billing):
//
//   • Google Photorealistic 3D Tiles, served through Cesium ion — the real
//     city: every building and landmark as a textured 3D mesh. Shown once the
//     camera is below ~2,400 km; the globe is hidden underneath it.
//   • Cesium World Terrain + Cesium World Imagery (Bing Maps Aerial) — the
//     globe from orbit down to the handover, and the fallback below it.
//   • Cesium OSM Buildings — 3D buildings from OpenStreetMap, used only if the
//     photorealistic tiles are unavailable (e.g. an ion usage limit).
//
// Requirements:
//   • NEXT_PUBLIC_CESIUM_ION_TOKEN (free at ion.cesium.com).
//   • Keep the Google logo, the Cesium ion logo and the data attributions
//     visible: the viewer renders them in the page's credit container.
//   • Google geocoding alongside Google's tiles: place search goes through
//     Cesium ion's Google geocoder (see server/services/geocoding.ts).
//
// Without a token the globe still works: NASA imagery on the smooth
// ellipsoid, no terrain relief or buildings, and a notice explains the setup.

import type * as Cesium from "cesium";
import type { CesiumModule } from "./loadCesium";

export type WorldMode = "photoreal" | "osm";

export type WorldStatus =
  | { state: "disabled"; reason: string }
  | { state: "loading" }
  | { state: "ready"; mode: WorldMode }
  | { state: "error"; reason: string; mode?: WorldMode };

export interface IonWorld {
  terrain: boolean;
  imagery: Cesium.ImageryLayer | null;
  /** Google Photorealistic 3D Tiles via Cesium ion. */
  photoreal: Cesium.Cesium3DTileset | null;
  /** Cesium OSM Buildings — fallback when photoreal is unavailable. */
  buildings: Cesium.Cesium3DTileset | null;
  /** Human-readable problems with individual layers (empty when all loaded). */
  problems: string[];
}

/** OSM buildings only draw (and stream) below this camera height. */
const BUILDINGS_BELOW = 160_000;
/** Photoreal tiles take over below SHOW, hand back to the globe above HIDE. */
const PHOTOREAL_SHOW_BELOW = 2_400_000;
const PHOTOREAL_HIDE_ABOVE = 2_900_000;
/** Start streaming the photoreal tiles (hidden) a little before they show. */
export const PHOTOREAL_PRELOAD_BELOW = 5_000_000;
// NASA Blue Marble carries the orbit look; ion imagery takes over as we descend.
const ORBIT_IMAGERY_FULL_ABOVE = 2_800_000;
const ORBIT_IMAGERY_GONE_BELOW = 700_000;

/** Google Photorealistic 3D Tiles in the Cesium ion Asset Depot. */
const GOOGLE_PHOTOREALISTIC_ION_ASSET = 2275207;
/** Where ion's Google asset streams its tiles from (RequestScheduler server key). */
const GOOGLE_TILES_SERVER = "tile.googleapis.com:443";
/**
 * Concurrent photoreal tile downloads. While the camera travels, at most 8
 * (Cesium's default is 18): tiles then arrive steadily instead of in bursts
 * whose decoding and GPU uploads stall frames — measured on a first pass
 * through Paris (Intel UHD): 41 → 55 fps, slowest 1% of frames 109 → ~60 ms.
 * Once the camera rests, frame pacing no longer shows, so refine at full speed.
 */
const PHOTOREAL_REQUESTS = { moving: 8, still: 24 };

/** Throttle photoreal tile downloads while the camera moves; full speed when it rests. */
export function setPhotorealStreaming(C: CesiumModule, still: boolean) {
  C.RequestScheduler.requestsByServer[GOOGLE_TILES_SERVER] = still ? PHOTOREAL_REQUESTS.still : PHOTOREAL_REQUESTS.moving;
}

/**
 * Detail targets (maximum screen-space error) for the photoreal city. While the
 * camera travels, a coarser level streams fewer tiles and draws fewer
 * triangles (measured on Intel UHD: 45 → 50 fps with FXAA off, slowest frames
 * 101 → 32 ms); once it rests, finer tiles refine the still view.
 * Cesium's own default for Google tiles is 16.
 */
export const PHOTOREAL_SSE_MOVING = 32;
export const PHOTOREAL_SSE_STILL = 24;
/**
 * Coarser while moving when the GPU can't keep up even at the lowest resolution. A still view's
 * frame rate doesn't show, so it keeps the full detail (and the shots preloaded for it stay valid).
 */
export const PHOTOREAL_SSE_LOW_QUALITY = { moving: 40, still: PHOTOREAL_SSE_STILL };

/**
 * Coarser tiles toward a city view's horizon. Cesium's own falloff ("dynamic screen-space error")
 * hardly acts on Google's tiles: its strength follows the camera's height inside the tileset's
 * bounding box, which for a whole-Earth tileset comes down to latitude (about a sixth of full
 * strength over Paris, full over Sydney). Below city height it's one fixed density instead, the
 * same everywhere, so a landmark prepared during the flight is chosen with the same falloff it's
 * then seen with. Within ~1.5 km nothing changes; a few km out, a view settles up to about one
 * level coarser, where buildings are a few pixels tall in the haze.
 */
const HORIZON_DENSITY = 2.5e-4;
const HORIZON_BELOW = 30_000;
type HorizonTileset = Cesium.Cesium3DTileset & {
  prePassesUpdate(frameState: { camera: Cesium.Camera }): void;
  _dynamicScreenSpaceErrorComputedDensity: number;
  /** The falloff density at city level (0: none). */
  horizonDensity: number;
};
function softenHorizon(tileset: Cesium.Cesium3DTileset) {
  const t = tileset as HorizonTileset;
  t.horizonDensity = HORIZON_DENSITY;
  const pre = t.prePassesUpdate.bind(t);
  t.prePassesUpdate = (frameState) => {
    pre(frameState);
    if (frameState.camera.positionCartographic.height < HORIZON_BELOW) t._dynamicScreenSpaceErrorComputedDensity = t.horizonDensity;
  };
}

// Buildings in the site's palette: cool off-white blocks, landmark-scale
// towers warmed toward the signal accent so skylines read at a glance.
const BUILDING_STYLE = {
  color: {
    conditions: [
      ["${feature['cesium#estimatedHeight']} >= 150", "color('#ead9c6')"],
      ["${feature['cesium#estimatedHeight']} >= 60", "color('#dcdde0')"],
      ["true", "color('#cdd1d8')"],
    ],
  },
};

/**
 * Load terrain, imagery and buildings from Cesium ion. Each layer is
 * independent: one failing leaves the others (and the globe) working.
 * Resolves to null if the viewer was destroyed while the layers loaded.
 */
export async function loadIonWorld(C: CesiumModule, viewer: Cesium.Viewer, token: string): Promise<IonWorld | null> {
  C.Ion.defaultAccessToken = token;
  setPhotorealStreaming(C, false);
  const scene = viewer.scene;
  const [terrain, imagery, photoreal, buildings] = await Promise.allSettled([
    // No vertex normals: globe lighting only runs from orbit (it fades out
    // below 3,000 km), where terrain normals just darken the day side.
    C.createWorldTerrainAsync({ requestVertexNormals: false }),
    C.createWorldImageryAsync({ style: C.IonWorldImageryStyle.AERIAL }),
    // Google Photorealistic 3D Tiles as Cesium ion asset 2275207 — what
    // createGooglePhotorealistic3DTileset() streams when no Google key is set.
    // Loaded directly: that helper shares one cached request between callers,
    // which fails when the globe mounts twice (React dev mode, fast refresh).
    C.Cesium3DTileset.fromIonAssetId(GOOGLE_PHOTOREALISTIC_ION_ASSET, {
      showCreditsOnScreen: true,
      maximumScreenSpaceError: PHOTOREAL_SSE_MOVING,
      // A whole city's landmarks, preloaded, stay in memory.
      cacheBytes: 1024 * 1024 * 1024,
      maximumCacheOverflowBytes: 256 * 1024 * 1024,
    }),
    C.createOsmBuildingsAsync({ style: new C.Cesium3DTileStyle(BUILDING_STYLE) }),
  ]);

  // The page may have unmounted the globe while the layers were loading.
  if (viewer.isDestroyed()) return null;

  const world: IonWorld = { terrain: false, imagery: null, photoreal: null, buildings: null, problems: [] };

  if (terrain.status === "fulfilled") {
    scene.terrainProvider = terrain.value;
    world.terrain = true;
  } else world.problems.push(`Terrain: ${describeIonError(terrain.reason)}`);

  if (imagery.status === "fulfilled") {
    // Above the offline NaturalEarth base (index 0), under the NASA orbit layers.
    world.imagery = viewer.imageryLayers.addImageryProvider(imagery.value, 1);
  } else world.problems.push(`Imagery: ${describeIonError(imagery.reason)}`);

  if (photoreal.status === "fulfilled") {
    const tileset = photoreal.value;
    tileset.show = false;
    tileset.preloadWhenHidden = false;
    softenHorizon(tileset);
    scene.primitives.add(tileset);
    world.photoreal = tileset;
  } else world.problems.push(`Photorealistic 3D Tiles: ${describeIonError(photoreal.reason)}`);

  if (buildings.status === "fulfilled") {
    const tileset = buildings.value;
    tileset.maximumScreenSpaceError = 16;
    tileset.cacheBytes = 384 * 1024 * 1024;
    tileset.show = false;
    scene.primitives.add(tileset);
    world.buildings = tileset;
  } else world.problems.push(`OSM Buildings: ${describeIonError(buildings.reason)}`);

  return world;
}

/**
 * Per-frame level-of-detail switches for the camera height. Returns true when
 * something visible changed and a new frame is needed.
 */
export function updateIonWorld(world: IonWorld | null, globe: Cesium.Globe, orbitImagery: Cesium.ImageryLayer, cameraHeight: number): boolean {
  let changed = false;
  const photoreal = world?.photoreal;
  if (photoreal) {
    photoreal.preloadWhenHidden = cameraHeight < PHOTOREAL_PRELOAD_BELOW;
    const show = cameraHeight < PHOTOREAL_SHOW_BELOW ? true : cameraHeight > PHOTOREAL_HIDE_ABOVE ? false : photoreal.show;
    if (photoreal.show !== show) {
      photoreal.show = show;
      changed = true;
    }
    // The photoreal mesh already contains the ground: hide the globe under it.
    if (globe.show === show) {
      globe.show = !show;
      changed = true;
    }
  }
  if (world?.buildings) {
    const show = !photoreal && cameraHeight < BUILDINGS_BELOW;
    if (world.buildings.show !== show) {
      world.buildings.show = show;
      changed = true;
    }
  }
  // Fade NASA Blue Marble (max zoom level 8) out as the sharper ion imagery takes over.
  const t = world?.imagery ? smooth((cameraHeight - ORBIT_IMAGERY_GONE_BELOW) / (ORBIT_IMAGERY_FULL_ABOVE - ORBIT_IMAGERY_GONE_BELOW)) : 1;
  if (Math.abs(orbitImagery.alpha - t) > 0.004) {
    orbitImagery.alpha = t;
    orbitImagery.show = t > 0.004;
    changed = true;
  }
  return changed;
}

/** Turn Cesium ion request errors into a message a developer can act on. */
export function describeIonError(error: unknown): string {
  const e = error as { statusCode?: number; response?: unknown; message?: string };
  let detail = "";
  if (typeof e?.response === "string") {
    try {
      detail = (JSON.parse(e.response) as { message?: string }).message ?? "";
    } catch {
      detail = e.response.slice(0, 160);
    }
  }
  if (e?.statusCode === 401) {
    return `Cesium ion rejected the access token (HTTP 401). Check NEXT_PUBLIC_CESIUM_ION_TOKEN in .env.local. ${detail}`.trim();
  }
  if (e?.statusCode === 404) {
    return `This asset is not in your Cesium ion account (HTTP 404). Add it from the ion Asset Depot. ${detail}`.trim();
  }
  if (e?.statusCode === 429) return "Cesium ion rate limit reached (HTTP 429). Try again shortly.";
  if (e?.statusCode) return `Cesium ion request failed (HTTP ${e.statusCode}). ${detail}`.trim();
  return e?.message || String(error);
}

function smooth(x: number) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}
