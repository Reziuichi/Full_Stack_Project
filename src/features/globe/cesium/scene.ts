// Cesium Viewer construction and the look of the globe from space.
//
// Imagery (keyless):
//   • NaturalEarthII — bundled with CesiumJS, works offline, bottom layer.
//   • NASA Blue Marble Next Generation via GIBS — the cloudless true-colour
//     Earth seen from orbit ("orbit imagery").
//   • NASA VIIRS city lights via GIBS — shown only on the night side.
// With a Cesium ion token, Cesium World Terrain, World Imagery and OSM
// Buildings are added on top of this (see ionWorld.ts); the orbit imagery
// fades out as the camera descends and the sharper ion imagery takes over.

import type * as Cesium from "cesium";
import type { CesiumModule } from "./loadCesium";

export const SPACE_COLOR = "#06070a";

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";

export interface GlobeViewer {
  viewer: Cesium.Viewer;
  /** NASA Blue Marble — the look from orbit, faded out close to the ground. */
  orbitImagery: Cesium.ImageryLayer;
}

export function createViewer(C: CesiumModule, container: HTMLElement, creditContainer: HTMLElement): GlobeViewer {
  const viewer = new C.Viewer(container, {
    baseLayer: false,
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    vrButton: false,
    scene3DOnly: true,
    skyBox: false,
    skyAtmosphere: new C.SkyAtmosphere(),
    terrainProvider: new C.EllipsoidTerrainProvider(),
    creditContainer,
    // Performance: no MSAA (FXAA below is far cheaper on integrated GPUs), and
    // only render when something changes — the engine requests frames while
    // the camera, route or particles are animating.
    useBrowserRecommendedResolution: false,
    orderIndependentTranslucency: false,
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
    contextOptions: { webgl: { alpha: false, antialias: false, powerPreference: "high-performance" } },
  });

  // Start at CSS-pixel resolution; the engine's frame-rate governor raises it
  // on fast GPUs and lowers it on slow ones.
  viewer.resolutionScale = 1;
  viewer.clock.shouldAnimate = false;

  const { scene } = viewer;
  scene.backgroundColor = C.Color.fromCssColorString(SPACE_COLOR);
  if (scene.sun) scene.sun.show = false;
  if (scene.moon) scene.moon.show = false;
  scene.postProcessStages.fxaa.enabled = true;

  const globe = scene.globe;
  globe.baseColor = C.Color.fromCssColorString("#0a1624");
  globe.enableLighting = true;
  // Ground atmosphere is the most expensive globe feature by far (measured
  // ~20 → ~55 fps on Intel UHD graphics when disabled). The sky-atmosphere
  // rim below keeps the blue edge of the planet.
  globe.showGroundAtmosphere = false;
  globe.dynamicAtmosphereLighting = true;
  globe.dynamicAtmosphereLightingFromSun = false;
  globe.atmosphereLightIntensity = 11;
  // Day/night shading only matters from orbit; fade it out as we descend.
  globe.lightingFadeOutDistance = 3_000_000;
  globe.lightingFadeInDistance = 10_000_000;
  globe.nightFadeOutDistance = 3_000_000;
  globe.nightFadeInDistance = 10_000_000;
  globe.maximumScreenSpaceError = 2;
  globe.tileCacheSize = 200;

  scene.atmosphere.dynamicLighting = C.DynamicAtmosphereLightingType.SCENE_LIGHT;
  if (scene.skyAtmosphere) {
    scene.skyAtmosphere.atmosphereLightIntensity = 26;
    scene.skyAtmosphere.saturationShift = -0.05;
  }

  // Light direction is updated every frame relative to the camera (lighting.ts).
  scene.light = new C.DirectionalLight({ direction: new C.Cartesian3(1, 0, 0), intensity: 2.4 });

  const orbitImagery = addImagery(C, viewer);
  configureControls(C, viewer);
  return { viewer, orbitImagery };
}

function addImagery(C: CesiumModule, viewer: Cesium.Viewer): Cesium.ImageryLayer {
  const layers = viewer.imageryLayers;

  layers.add(
    C.ImageryLayer.fromProviderAsync(C.TileMapServiceImageryProvider.fromUrl(C.buildModuleUrl("Assets/Textures/NaturalEarthII"))),
  );

  const blueMarble = new C.UrlTemplateImageryProvider({
    url: `${GIBS}/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`,
    tilingScheme: new C.WebMercatorTilingScheme(),
    maximumLevel: 8,
    credit: new C.Credit("Earth imagery: NASA Blue Marble via GIBS"),
  });
  const day = layers.addImageryProvider(blueMarble);
  day.saturation = 1.08;
  day.gamma = 1.05;

  const cityLights = new C.UrlTemplateImageryProvider({
    url: `${GIBS}/VIIRS_CityLights_2012/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`,
    tilingScheme: new C.WebMercatorTilingScheme(),
    maximumLevel: 8,
    credit: new C.Credit("Night lights: NASA VIIRS via GIBS"),
  });
  const night = layers.addImageryProvider(cityLights);
  night.dayAlpha = 0;
  night.nightAlpha = 0.85;
  night.brightness = 1.6;
  return day;
}

function configureControls(C: CesiumModule, viewer: Cesium.Viewer) {
  const ssc = viewer.scene.screenSpaceCameraController;
  ssc.minimumZoomDistance = 120;
  // Terrain: keep the free camera from sliding under mountains.
  ssc.enableCollisionDetection = true;
  ssc.maximumZoomDistance = 60_000_000;
  // Plain mouse-wheel scrolls the page (the journey); zoom with ctrl+wheel,
  // right-drag or pinch. Free-camera mode re-enables the wheel.
  setWheelZoom(C, viewer, false);
}

export function setWheelZoom(C: CesiumModule, viewer: Cesium.Viewer, enabled: boolean) {
  const ssc = viewer.scene.screenSpaceCameraController;
  ssc.zoomEventTypes = [
    C.CameraEventType.RIGHT_DRAG,
    C.CameraEventType.PINCH,
    { eventType: C.CameraEventType.WHEEL, modifier: C.KeyboardEventModifier.CTRL },
    ...(enabled ? [C.CameraEventType.WHEEL] : []),
  ];
}

/**
 * Light the globe from the camera's upper-left, slightly behind — so from
 * orbit the Earth always shows a lit face with a terminator on the right,
 * like the reference renders. Recomputed every frame.
 */
export function updateCameraRelativeLight(C: CesiumModule, viewer: Cesium.Viewer, scratch: Cesium.Cartesian3) {
  const light = viewer.scene.light as Cesium.DirectionalLight;
  const cam = viewer.camera;
  const d = C.Cartesian3.multiplyByScalar(cam.directionWC, 0.45, scratch);
  const r = C.Cartesian3.multiplyByScalar(cam.rightWC, 0.85, new C.Cartesian3());
  const u = C.Cartesian3.multiplyByScalar(cam.upWC, -0.28, new C.Cartesian3());
  C.Cartesian3.add(d, r, d);
  C.Cartesian3.add(d, u, d);
  C.Cartesian3.normalize(d, d);
  light.direction = C.Cartesian3.clone(d, light.direction);
}
