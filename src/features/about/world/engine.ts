// The About page's world: one WebGL2 renderer (three.js), the whole screen.
//
//   A, space: a grey moon comes alive as the Earth (life spreads out from
//      Chandigarh, where Longitude began), the air glows round it and the
//      stars turn behind. Then the camera falls towards the Himalaya, on the
//      side of the planet where the sun is setting.
//   B, dusk above a sea of cloud: the story is told over it; then a satellite
//      (Landsat 8) glides in among lenses of glass and shines its beam down on
//      the cloud, drawn the way the lens you pick sees the world (an imaging
//      swath, tiles streaming in, radar rings). Night falls while it's there:
//      the sun sinks into the cloud, the Earth's shadow climbs over the craft,
//      stars, the Milky Way and a crescent moon come out over a moonlit deck.
//      The craft turns slowly and can be spun by hand. Then the camera sinks
//      through the cloud.
//   C, under it: the valley as a living photo (depth, mist, light), which
//      draws into a porthole that flies back to orbit and lands on the Earth;
//      the planet is then yours to turn, read and drop a pin on, while the sun
//      goes round it (day sweeps across to night, the sun slips behind the
//      limb and comes out again) and the Moon circles it, each throwing its
//      shadow on the other when they line up.
//
// Fog hides each cut. Everything is a function of the scroll progress p (see
// story.ts), so the same p always draws the same frame.

import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Data3DTexture,
  DirectionalLight,
  DoubleSide,
  FogExp2,
  HalfFloatType,
  HemisphereLight,
  LinearFilter,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  NormalBlending,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Quaternion,
  RedFormat,
  RepeatWrapping,
  Scene,
  ShaderChunk,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  type Blending,
  type IUniform,
} from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import {
  BEACON_FS,
  BEACON_VS,
  BEAM_FS,
  BEAM_VS,
  BLUR_FS,
  CARD_VS,
  CLOUDS_FS,
  CLOUD_FS,
  CLOUD_VS,
  COMPOSITE_FS,
  COPY_FS,
  CRAFT_COLOR,
  CRAFT_FRAGMENT_HEAD,
  CRAFT_METALNESS,
  CRAFT_NORMAL,
  CRAFT_REFLECT,
  CRAFT_ROUGHNESS,
  CRAFT_VERTEX_BODY,
  CRAFT_VERTEX_HEAD,
  FLARE_FS,
  FLAT_VS,
  FOG_FS,
  GLASS_FS,
  GLASS_VS,
  HALO_FS,
  HALO_VS,
  NIGHT_STARS_FS,
  NIGHT_STARS_VS,
  PLANET_FS,
  PLANET_VS,
  SKY_FS,
  SKY_VS,
  STARS_FS,
  SUN_FS,
  STARS_VS,
  VALLEY_FS,
} from "./shaders";
import { BEAT, clamp01, mix, span } from "./story";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
/** Earth's axial tilt, reached as the moon becomes the Earth. */
const TILT = 23.4 * DEG;
/** Height above the ground (planet radii) where the dive meets the cloud. */
const DIVE_ALT = 0.045;
/** How far right of the view the sun sits as we come down: we look along the dusk line, day to the right, night to the left. */
const SUN_OFF = 70 * DEG;
/** The valley photo's shape. */
const PHOTO_ASPECT = 2400 / 1170;

/** A lens of glass, in CSS px from the canvas's top left; `hover` and `active` are 0–1. */
export type Pane = { x: number; y: number; w: number; h: number; a: number; hover: number; active: number };

export type FrameIn = {
  /** Smoothed story progress (0–1). */
  p: number;
  time: number;
  dt: number;
  /** Reduced motion: changes happen at once. */
  calm: boolean;
  /** Pointer, -1…1 from the centre (already smoothed), and where it is in CSS px. */
  pointer: [number, number];
  pointerPx: [number, number];
  panes: Pane[];
  paneRadius: number;
  /** How the satellite's beam draws on the cloud: 0 imaging swath, 1 tiles, 2 radar rings, -1 none. */
  scan: number;
  /** The planet is being dragged (the finale): no idle turning. */
  dragging: boolean;
  /** The satellite is being turned by hand. */
  turning: boolean;
};

export type Readout = {
  /** Which set is on screen. */
  set: "A" | "B" | "C";
  /** How much of the moon has come alive (0–1). */
  life: number;
  /** Camera height: km above the ground in space, metres over the cloud. */
  alt: number;
  /** Where Chandigarh is on screen (CSS px) and how squarely it faces us (0–1). */
  pin: [number, number, number];
  /** Where the lenses point, on the beam's footprint on the cloud: [x, y, visible] × 3 (CSS px). */
  anchors: number[];
  /** The satellite on screen (beside its body, for its tag) and how much of the tag shows (0–1). */
  craft: [number, number, number];
  /** How much of the satellite is still in sunlight (0 once the Earth's shadow is over it). */
  craftLit: number;
  /** The planet's disc on screen in the finale: centre x, y and radius (CSS px); r = 0 when it isn't there. */
  globe: [number, number, number];
  /** The dropped pin on screen and how squarely it faces us (0 when it's round the back or there isn't one). */
  drop: [number, number, number];
  /** The finale: how much of the face towards us is in daylight (1 day, −1 night). */
  daylight: number;
};

/** A place on the planet under a screen point. */
export type Pick = { lat: number; lon: number };

export type World = {
  /** Space is loaded and on the GPU. */
  ready: Promise<void>;
  /** The cloud world and the valley are loaded too. */
  more: Promise<void>;
  frame: (f: FrameIn) => Readout;
  resize: (w: number, h: number) => void;
  setScale: (k: number) => void;
  /** The finale: turn the planet by a horizontal drag of `dx` CSS px over `ms` milliseconds. */
  spinBy: (dx: number, ms: number) => void;
  /** The finale: show the reticle where (x, y) meets the ground, and say where that is. */
  aim: (x: number, y: number) => Pick | null;
  clearAim: () => void;
  /** The finale: drop a pin where (x, y) meets the ground. */
  tap: (x: number, y: number) => Pick | null;
  /** Over the cloud: is (x, y) on the satellite (its body or its solar wing)? */
  pickCraft: (x: number, y: number) => boolean;
  /** Turn the satellite by a drag of (dx, dy) CSS px over `ms` milliseconds. */
  turnCraft: (dx: number, dy: number, ms: number) => void;
  /** A tap on the satellite: its beam flares and it gives a little kick. */
  tapCraft: () => void;
  lost: () => boolean;
  dispose: () => void;
};

export type WorldOptions = {
  /** Smaller textures and fewer clouds, for phones and small GPUs. */
  lite: boolean;
  /** Device-pixel budget for the canvas. */
  budget: number;
};

/** Object-space direction of a place on the planet (three's sphere UVs, north up). */
function place(lat: number, lon: number) {
  const f = lat * DEG;
  const l = lon * DEG;
  return new Vector3(Math.cos(f) * Math.cos(l), Math.sin(f), -Math.cos(f) * Math.sin(l));
}
const CHANDIGARH = place(30.73, 76.78);
const KULLU = place(32.24, 77.19);

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function bitmap(url: string, signal: AbortSignal, size?: [number, number]) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const blob = await res.blob();
  const opts: ImageBitmapOptions = { premultiplyAlpha: "none", colorSpaceConversion: "none" };
  if (size) Object.assign(opts, { resizeWidth: size[0], resizeHeight: size[1], resizeQuality: "high" });
  // Decoded off the main thread; not flipped (the shaders and glTF UVs expect the first row at v = 0).
  return createImageBitmap(blob, opts);
}

function texture(img: ImageBitmap, color: boolean, opts: { wrap?: boolean; aniso?: number } = {}) {
  const t = new Texture(img);
  t.flipY = false;
  t.colorSpace = color ? SRGBColorSpace : NoColorSpace;
  if (opts.wrap) t.wrapS = RepeatWrapping;
  t.anisotropy = opts.aniso ?? 1;
  t.needsUpdate = true;
  return t;
}

const u = <T>(value: T): IUniform<T> => ({ value });

/** three's light loop, with the sun's light cut by the Earth's shadow (craftSunMask, shaders.ts). */
const DIR_LIGHT = "getDirectionalLightInfo( directionalLight, directLight );";
const LIGHTS_WITH_SHADOW = ShaderChunk.lights_fragment_begin.includes(DIR_LIGHT)
  ? ShaderChunk.lights_fragment_begin.replace(DIR_LIGHT, `${DIR_LIGHT}\n\t\tdirectLight.color *= craftSunMask( directLight.direction );`)
  : ShaderChunk.lights_fragment_begin;

type CraftHead = { count: number; indexCount: number; stride: number; vb: number; ib: number };

/**
 * The satellite, from public/about/landsat8.bin (NASA's Landsat 8 model, made compact for the
 * web): positions (int16), normals (int8) and the model's colours with a material class (uint8)
 * in one meshopt-encoded vertex stream, then the indices. Four bytes "1SAT", the header's
 * length, the header (JSON), then the two encoded buffers.
 */
async function loadCraft(url: string, signal: AbortSignal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const buf = await res.arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x54415331) throw new Error(`${url}: not a craft file`);
  const jl = dv.getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jl))) as CraftHead;
  let at = 8 + jl;
  const encV = new Uint8Array(buf, at, head.vb);
  at += head.vb + ((4 - (head.vb % 4)) % 4);
  const encI = new Uint8Array(buf, at, head.ib);
  await MeshoptDecoder.ready;
  const n = head.count;
  const st = head.stride;
  const vb = new Uint8Array(n * st);
  MeshoptDecoder.decodeVertexBuffer(vb, n, st, encV);
  const index = new Uint32Array(head.indexCount);
  MeshoptDecoder.decodeIndexBuffer(new Uint8Array(index.buffer), head.indexCount, 4, encI);
  const s16 = new Int16Array(vb.buffer);
  const s8 = new Int8Array(vb.buffer);
  const pos = new Int16Array(n * 3);
  const nor = new Int8Array(n * 3);
  const tint = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const h = (i * st) >> 1;
    pos[i * 3] = s16[h];
    pos[i * 3 + 1] = s16[h + 1];
    pos[i * 3 + 2] = s16[h + 2];
    nor[i * 3] = s8[i * st + 8];
    nor[i * 3 + 1] = s8[i * st + 9];
    nor[i * 3 + 2] = s8[i * st + 10];
    tint.set(vb.subarray(i * st + 12, i * st + 16), i * 4);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3, true));
  geo.setAttribute("normal", new BufferAttribute(nor, 3, true));
  geo.setAttribute("aTint", new BufferAttribute(tint, 4, true));
  geo.setIndex(new BufferAttribute(index, 1));
  return geo;
}

/**
 * Where things are on the satellite, from its vertices (model units, −1…1): the body's centre
 * (what it turns about and the beam leaves from), the far tip of the solar wing, the top of the
 * body, and the wing's long axis in its plane (the model's y–z) with a cell size along and across.
 */
function surveyCraft(geo: BufferGeometry) {
  const pos = geo.getAttribute("position");
  const tint = geo.getAttribute("aTint");
  const lo = new Vector3(Infinity, Infinity, Infinity);
  const hi = new Vector3(-Infinity, -Infinity, -Infinity);
  const v = new Vector3();
  let sy = 0, sz = 0, syy = 0, szz = 0, syz = 0, nw = 0;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (Math.round(tint.getW(i) * 6.375) === 5) {
      sy += v.y;
      sz += v.z;
      syy += v.y * v.y;
      szz += v.z * v.z;
      syz += v.y * v.z;
      nw++;
    } else if (v.x > -0.26) {
      lo.min(v);
      hi.max(v);
    }
  }
  const body = lo.clone().add(hi).multiplyScalar(0.5);
  const my = sy / nw;
  const mz = sz / nw;
  const ang = 0.5 * Math.atan2(2 * (syz / nw - my * mz), syy / nw - my * my - (szz / nw - mz * mz));
  const ax = [Math.cos(ang), Math.sin(ang)];
  let along = 0, across = 0, far = -1;
  const tip = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    if (Math.round(tint.getW(i) * 6.375) !== 5) continue;
    v.fromBufferAttribute(pos, i);
    const a = (v.y - my) * ax[0] + (v.z - mz) * ax[1];
    const c = -(v.y - my) * ax[1] + (v.z - mz) * ax[0];
    along = Math.max(along, Math.abs(a));
    across = Math.max(across, Math.abs(c));
    const d = v.distanceToSquared(body);
    if (d > far) {
      far = d;
      tip.copy(v);
    }
  }
  let reach = 0;
  let wx = 0;
  for (let i = 0; i < pos.count; i++) {
    reach = Math.max(reach, v.fromBufferAttribute(pos, i).distanceTo(body));
    if (Math.round(tint.getW(i) * 6.375) === 5) wx += v.x;
  }
  wx /= nw;
  // The wing as a rectangle (for picking it on screen), and the body as a ball.
  const wing = [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ].map(([a, c]) => new Vector3(wx, my + a * along * ax[0] - c * across * ax[1], mz + a * along * ax[1] + c * across * ax[0]));
  const bodyR = hi.clone().sub(lo).length() / 2;
  return { body, tip, reach, wing, bodyR, top: new Vector3(body.x, hi.y, body.z), cells: [ax[0], ax[1], (2 * along) / 72, (2 * across) / 14] as [number, number, number, number] };
}

function premultiplied(m: ShaderMaterial, blending: Blending = NormalBlending) {
  m.transparent = true;
  m.premultipliedAlpha = true;
  m.blending = blending;
  m.depthWrite = false;
  return m;
}

/** A Catmull–Rom path through keyed points, parameterised by the story's p. */
function keyed(keys: readonly (readonly number[])[]) {
  const n = keys[0].length - 1;
  const out = new Array<number>(n).fill(0);
  return (p: number) => {
    let i = 0;
    while (i < keys.length - 2 && p > keys[i + 1][0]) i++;
    const k1 = keys[i];
    const k2 = keys[i + 1];
    const t = clamp01((p - k1[0]) / (k2[0] - k1[0]));
    const k0 = keys[Math.max(0, i - 1)];
    const k3 = keys[Math.min(keys.length - 1, i + 2)];
    const t2 = t * t;
    const t3 = t2 * t;
    for (let j = 0; j < n; j++) {
      const a = k0[j + 1];
      const b = k1[j + 1];
      const c = k2[j + 1];
      const d = k3[j + 1];
      out[j] = 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
    }
    return out;
  };
}

// Camera B over the sea of cloud: [p, eye x, y, z, target x, y, z].
const CAM_B = keyed([
  [BEAT.cut, 0, 10.5, 19, 0, 8.2, -40],
  [0.41, 0, 9.2, 15, 0, 7.3, -40],
  [0.53, 0, 7.4, 8.5, 0, 5.8, -40],
  [0.63, 0, 6.5, 4.4, 0, 3.4, -16],
  [0.78, 1.5, 6.2, 1.8, 0, 3.4, -16],
  [0.835, 1.8, -0.8, 0.2, 0.4, -0.6, -30],
  [0.9, 1.9, -3.5, -0.6, 0.5, -3.2, -30],
]);

const SUN_A = new Vector3(-0.78, 0.32, 0.36).normalize();
const SUN_B = new Vector3(0.5, 0.05, -1).normalize();
/** Which way the sun sets over the cloud (level), and its height (degrees) through "How it works". */
const SUN_AZ = new Vector3(SUN_B.x, 0, SUN_B.z).normalize();
const SUN_ELEV = keyed([
  [0.6, Math.asin(SUN_B.y) / DEG],
  [0.64, 1.6],
  [0.67, 0],
  [0.69, -1.6],
  [0.72, -4.5],
  [0.75, -8],
  [0.8, -10],
]);
/** Nightfall over the cloud: 0 at dusk, 1 once it's night. */
const nightAt = (p: number) => span(p, 0.66, 0.75);

type Tint = { deep: Color; lit: Color; glow: Color };

// Dusk over the cloud (linear). The sun is low and warm; the sky light from above is dim mauve.
const CLOUD_LIGHT = {
  sun: new Color(1.0, 0.44, 0.18).multiplyScalar(0.62),
  ambient: new Color("#3a3338"),
  haze: new Color(0.36, 0.16, 0.09),
};
// And at night: moonlight, silver and dim; a dark sky; a haze that's nearly black.
const CLOUD_NIGHT = {
  moon: new Color(0.1, 0.101, 0.104),
  ambient: new Color("#141415"),
  haze: new Color(0.011, 0.011, 0.0115),
  twilight: new Color("#2a2127"),
};

/** The finale's Moon: its size (Earth radii), how fast the day and the Moon go round (rad/s). */
const MOON_R = 0.27;
const DAY_RATE = 8 * (Math.PI / 180);
const DAY_START = -135 * (Math.PI / 180);
const MOON_RATE = (Math.PI * 2) / 32;
const MOON_START = 2.0;
const MOON_CALM = 3.6;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Builds the world in `canvas`, or returns null if WebGL2 isn't available. */
export function createWorld(canvas: HTMLCanvasElement, opts: WorldOptions): World | null {
  // Ask for the context ourselves: without WebGL2 we return quietly and the page shows its poster.
  const attrs: WebGLContextAttributes = { antialias: true, alpha: true, premultipliedAlpha: true, stencil: false, depth: true, powerPreference: "high-performance" };
  const context = canvas.getContext("webgl2", attrs);
  if (!context) return null;
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, context, ...attrs });
  } catch {
    return null;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const gl = renderer.getContext();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  // A laptop's integrated GPU (Chrome on Windows uses it even beside a discrete one) gets a
  // lighter cloud march from the start, so frames stay even rather than racing and stalling.
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const gpuName = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const modest = !opts.lite && /intel|uhd|iris/i.test(gpuName) && !/nvidia|geforce|radeon|arc/i.test(gpuName);
  const cloudSteps = opts.lite ? 40 : modest ? 46 : 56;
  const cloudDiv = opts.lite ? 3 : modest ? 2.5 : 2.1;
  const abort = new AbortController();
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);
  const r = rng(20240611);

  let width = 1;
  let height = 1;
  let dprBase = 1;
  let scale = 1;
  let isLost = false;
  const onLost = (e: Event) => {
    e.preventDefault();
    isLost = true;
  };
  const onRestored = () => void (isLost = false);
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  // ── Set A: space ──────────────────────────────────────────────────────────
  const sceneA = new Scene();
  const camA = new PerspectiveCamera(30, 1, 0.004, 400);
  const blank = keep(new Texture());
  const shared = {
    uMoonH: u<Texture>(blank),
    uLife: u(0),
    uFront: u(CHANDIGARH.clone()),
    uSun: u(new Vector3()),
    uTime: u(0),
    uCloudShift: u(0),
    /** A ball that shadows the planet (the Moon, in the finale): view-space centre and radius. */
    uShade: u([0, 0, 0, 0]),
  };
  const planetMat = keep(
    new ShaderMaterial({
      vertexShader: PLANET_VS,
      fragmentShader: PLANET_FS,
      uniforms: {
        ...shared,
        uRelief: u(0.026),
        uMoon: u<Texture>(blank),
        uDay: u<Texture>(blank),
        uNight: u<Texture>(blank),
        uMask: u<Texture>(blank),
        uCursor: u([0, 1, 0, 0]),
        uPulse: u([0, 1, 0, -1]),
      },
    }),
  );
  const segs = opts.lite ? [160, 100] : [256, 160];
  const planetGeo = keep(new SphereGeometry(1, segs[0], segs[1]));
  const tiltGroup = new Mesh();
  const planet = new Mesh(planetGeo, planetMat);
  tiltGroup.add(planet);
  sceneA.add(tiltGroup);

  const cloudsMat = keep(
    premultiplied(
      new ShaderMaterial({
        vertexShader: PLANET_VS,
        fragmentShader: CLOUDS_FS,
        uniforms: { ...shared, uRelief: u(0), uMask: planetMat.uniforms.uMask },
      }),
    ),
  );
  const clouds = new Mesh(keep(new SphereGeometry(1.008, segs[0] >> 1, segs[1] >> 1)), cloudsMat);
  planet.add(clouds);

  const haloMat = keep(
    premultiplied(new ShaderMaterial({ vertexShader: HALO_VS, fragmentShader: HALO_FS, uniforms: { uCenter: u(new Vector3()), uSun: u(SUN_A.clone()), uStrength: u(0) } }), AdditiveBlending),
  );
  // A shell round the planet, seen from inside out: it covers every ray that passes near it,
  // whether we're far away or down in the air.
  haloMat.side = BackSide;
  const halo = new Mesh(keep(new SphereGeometry(1.4, 64, 32)), haloMat);
  halo.frustumCulled = false;
  halo.renderOrder = 2;
  sceneA.add(halo);

  // The finale's Moon: the planet's own shader, all moon (relief, regolith), turned so its near
  // side always faces the Earth as it goes round.
  const moonGeo = keep(new SphereGeometry(MOON_R, 96, 64));
  moonGeo.rotateY(-Math.PI / 2);
  const moonMat = keep(
    premultiplied(
      new ShaderMaterial({
        vertexShader: PLANET_VS,
        fragmentShader: PLANET_FS,
        defines: { MOON_ONLY: 1 },
        uniforms: {
          uMoonH: shared.uMoonH,
          uMoon: planetMat.uniforms.uMoon,
          uDay: u<Texture>(blank),
          uNight: u<Texture>(blank),
          uMask: u<Texture>(blank),
          uLife: u(0),
          uFront: u(new Vector3(0, 1, 0)),
          uRelief: u(0.02),
          uSun: shared.uSun,
          uTime: shared.uTime,
          uCloudShift: u(0),
          uCursor: u([0, 1, 0, 0]),
          uPulse: u([0, 1, 0, -1]),
          uShade: u([0, 0, 0, 0]),
          uFade: u(0),
        },
      }),
    ),
  );
  moonMat.depthTest = true;
  const moon = new Mesh(moonGeo, moonMat);
  moon.renderOrder = 3;
  moon.visible = false;
  sceneA.add(moon);
  // The sun: a card far behind everything, facing the camera (the planet and the Moon hide it).
  const sunMat = keep(premultiplied(new ShaderMaterial({ vertexShader: CARD_VS, fragmentShader: SUN_FS, uniforms: { uOn: u(0) } }), AdditiveBlending));
  sunMat.depthTest = true;
  const sunCard = new Mesh(keep(new PlaneGeometry(1, 1)), sunMat);
  sunCard.renderOrder = 1;
  sunCard.frustumCulled = false;
  sunCard.visible = false;
  sceneA.add(sunCard);
  /** The finale's day: the sun's great circle (a, b: it's at a when it comes on screen) and the Moon's ring. */
  const orbit = { a: new Vector3(), b: new Vector3(), R: 1.65, m1: new Vector3(1, 0, 0), m2: new Vector3(0, 0, -1) };
  const sunFin = SUN_A.clone();
  let dayTurn = 0;
  let moonTurn = 0;
  let daylight = 1;
  const sunPx = [0, 0];

  const starCount = opts.lite ? 900 : 1600;
  const starPos = new Float32Array(starCount * 3);
  const starSize = new Float32Array(starCount);
  const starSeed = new Float32Array(starCount);
  for (let i = 0; i < starCount; i++) {
    const z = r() * 2 - 1;
    const a = r() * TAU;
    const s = Math.sqrt(1 - z * z);
    starPos.set([Math.cos(a) * s * 90, z * 90, Math.sin(a) * s * 90], i * 3);
    starSize[i] = 1.1 + Math.pow(r(), 7) * 3.6;
    starSeed[i] = r();
  }
  const starGeo = keep(new BufferGeometry());
  starGeo.setAttribute("position", new BufferAttribute(starPos, 3));
  starGeo.setAttribute("aSize", new BufferAttribute(starSize, 1));
  starGeo.setAttribute("aSeed", new BufferAttribute(starSeed, 1));
  const starMat = keep(
    premultiplied(new ShaderMaterial({ vertexShader: STARS_VS, fragmentShader: STARS_FS, uniforms: { uTime: shared.uTime, uScale: u(1), uOpacity: u(1) } }), AdditiveBlending),
  );
  const stars = new Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.renderOrder = -1;
  sceneA.add(stars);

  // Composition of space, by the screen's shape: the planet right of the words on wide
  // screens, centred and low on tall ones.
  const lay = { dist: 6, cx: 1, cy: 0, front: 0, tall: 0 };
  const dive = { s: 0, T: new Vector3(), dir0: new Vector3(), d0: 6 };
  /** The finale: the turn that brings Kullu round to face us. */
  const fin = { s: 0 };
  const C = new Vector3();
  const cam0 = new Vector3();
  const layout = () => {
    const aspect = width / height;
    const tan = Math.tan(15 * DEG);
    const wide = clamp01((aspect - 0.85) / 0.4);
    // Over the cloud on a tall screen: the satellite farther off, between the title and the lenses.
    lay.tall = clamp01((1.1 - aspect) / 0.6);
    // Wide: the planet fills ~64% of the height, its centre 64% across. Tall: ~96% of the width, rising from the bottom edge.
    const dWide = 1 / (0.64 * tan);
    const dTall = 1 / (0.96 * tan * aspect);
    lay.dist = mix(dTall, dWide, wide);
    lay.cx = mix(0, 0.28 * lay.dist * tan * aspect, wide);
    lay.cy = mix(-0.62 * lay.dist * tan, -0.02, wide);
    C.set(lay.cx, lay.cy, 0);
    cam0.set(0, 0, lay.dist);
    // The finale's sun goes round a great circle chosen on the screen of the finale's camera (at
    // cam0, looking at the origin), clear of the words: on a wide screen it comes in at the top
    // just left of the planet (between the logo and the links), crosses behind the planet's right
    // side while its night side faces us, and leaves by the bottom right corner; on a tall one it
    // comes in from the right edge above the planet and sets behind it. The rest of the way round
    // it's behind us, and the face we see is in daylight.
    {
      const pd = C.distanceTo(cam0);
      const px = width / 2 + ((lay.cx / lay.dist) / (tan * aspect)) * (width / 2);
      const pr = (Math.tan(Math.asin(1 / pd)) / tan) * (height / 2);
      const dirAt = (sx: number, sy: number) => new Vector3(((sx / width) * 2 - 1) * tan * aspect, (1 - (sy / height) * 2) * tan, -1).normalize();
      orbit.a.copy(dirAt(mix(width * 1.1, px - 0.22 * pr, wide), mix(height * 0.5, 0, wide)));
      const end = dirAt(mix(px - 0.3 * pr, px + 2.4 * pr, wide), mix(height * 1.3, height, wide));
      orbit.b.copy(end).addScaledVector(orbit.a, -orbit.a.dot(end)).normalize();
      // The Moon's ring: tilted so it passes in front of the planet low down and behind it high up,
      // and turned so its near side is to the left (it swings low there, under the title).
      orbit.R = mix(1.25, 1.45, wide);
      const inc = mix(38, 18, wide) * DEG;
      const yaw = -35 * DEG;
      orbit.m1.set(Math.cos(yaw), 0, -Math.sin(yaw));
      orbit.m2.set(-Math.cos(inc) * Math.sin(yaw), Math.sin(inc), -Math.cos(inc) * Math.cos(yaw));
    }
    // Turn Chandigarh to face us (a little left of centre) as the story starts.
    const toCam = cam0.clone().sub(C);
    lay.front = Math.atan2(toCam.x, toCam.z) - Math.atan2(CHANDIGARH.x, CHANDIGARH.z) - 0.42;
    // Where the dive ends: Kullu, turned to the dusk line (the sun ~2° up), in view from the start.
    dive.dir0.copy(toCam).normalize();
    dive.d0 = toCam.length();
    const qt = new Quaternion().setFromAxisAngle(Z, TILT);
    const q = new Quaternion();
    const v = new Vector3();
    let best = Infinity;
    let face = -Infinity;
    for (let i = 0; i < 720; i++) {
      const s = (i / 720) * TAU;
      q.setFromAxisAngle(Y, s).premultiply(qt);
      v.copy(KULLU).applyQuaternion(q);
      const score = Math.abs(v.dot(SUN_A) - 0.035) * 4 - Math.min(v.dot(dive.dir0), 0.55);
      if (score < best) {
        best = score;
        dive.s = s;
        dive.T.copy(v);
      }
      // The finale: Kullu as squarely towards the camera as the tilt allows.
      if (v.dot(dive.dir0) > face) {
        face = v.dot(dive.dir0);
        fin.s = s;
      }
    }
  };

  // ── Set B: dusk over the cloud ───────────────────────────────────────────
  const sceneB = new Scene();
  sceneB.fog = new FogExp2(new Color("#5a3a2e"), 0.006);
  const camB = new PerspectiveCamera(40, 1, 0.1, 1500);
  const skyMat = keep(
    premultiplied(
      new ShaderMaterial({
        vertexShader: SKY_VS,
        fragmentShader: SKY_FS,
        side: BackSide,
        uniforms: { uSunDir: u(SUN_B.clone()), uOpacity: u(1), uHorizon: u(0), uNight: u(0), uMoonDir: u(new Vector3(0, 0.1, -1)), uMoonTex: planetMat.uniforms.uMoon, uNoise: u<Texture>(blank), uTime: shared.uTime },
      }),
    ),
  );
  // Opaque, and drawn first: everything else goes over it.
  skyMat.transparent = false;
  skyMat.depthTest = false;
  const sky = new Mesh(keep(new SphereGeometry(900, 48, 24)), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  sceneB.add(sky);

  const quad = keep(new PlaneGeometry(1, 1));
  const full = keep(new PlaneGeometry(2, 2));
  const ortho = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const canFloat = renderer.extensions.has("EXT_color_buffer_float") || renderer.extensions.has("EXT_color_buffer_half_float");
  const hdr = canFloat ? HalfFloatType : UnsignedByteType;
  const flatScene = (mat: ShaderMaterial) => {
    const scene = new Scene();
    const mesh = new Mesh(full, mat);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return scene;
  };

  // The sea of cloud is ray-marched (shaders.ts, CLOUD_FS) at a fraction of the
  // resolution, through tileable value noise in a small 3D texture, and laid
  // over the sky. The satellite flies above it and is drawn over it afterwards.
  const NOISE = 64;
  const noiseData = new Uint8Array(NOISE ** 3);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.floor(r() * 256);
  const noiseTex = keep(new Data3DTexture(noiseData, NOISE, NOISE, NOISE));
  noiseTex.format = RedFormat;
  noiseTex.minFilter = noiseTex.magFilter = LinearFilter;
  noiseTex.wrapS = noiseTex.wrapT = noiseTex.wrapR = RepeatWrapping;
  noiseTex.unpackAlignment = 1;
  noiseTex.needsUpdate = true;
  skyMat.uniforms.uNoise.value = noiseTex;
  // The night's stars over the cloud (upper sky only), and a few satellites crossing among them.
  const nStars = opts.lite ? 1300 : 2400;
  const nSats = 5;
  const nsPos = new Float32Array((nStars + nSats) * 3);
  const nsB = new Float32Array((nStars + nSats) * 3);
  const nsSpeed = new Float32Array(nStars + nSats);
  const nsSize = new Float32Array(nStars + nSats);
  const nsSeed = new Float32Array(nStars + nSats);
  for (let i = 0; i < nStars; i++) {
    const y = Math.pow(r(), 1.4);
    const a = r() * TAU;
    const c = Math.sqrt(1 - y * y);
    nsPos.set([Math.cos(a) * c * 850, y * 850, Math.sin(a) * c * 850], i * 3);
    nsSize[i] = 1.4 + Math.pow(r(), 5) * 4.6;
    nsSeed[i] = r();
  }
  for (let i = nStars; i < nStars + nSats; i++) {
    // Each crosses the sky in front of us on its own great circle, rising from the horizon.
    const az = (r() - 0.5) * 1.6;
    const tilt = 0.35 + r() * 0.9;
    const A = new Vector3(Math.sin(az + Math.PI / 2), 0, -Math.cos(az + Math.PI / 2)).multiplyScalar(r() < 0.5 ? 1 : -1);
    const B = new Vector3(0, Math.sin(tilt), 0).add(new Vector3(Math.sin(az), 0, -Math.cos(az)).multiplyScalar(Math.cos(tilt))).normalize();
    nsPos.set([A.x * 840, A.y * 840, A.z * 840], i * 3);
    nsB.set([B.x * 840, B.y * 840, B.z * 840], i * 3);
    nsSpeed[i] = 0.035 + r() * 0.03;
    nsSize[i] = 2.6;
    nsSeed[i] = r();
  }
  const nsGeo = keep(new BufferGeometry());
  nsGeo.setAttribute("position", new BufferAttribute(nsPos, 3));
  nsGeo.setAttribute("aB", new BufferAttribute(nsB, 3));
  nsGeo.setAttribute("aSpeed", new BufferAttribute(nsSpeed, 1));
  nsGeo.setAttribute("aSize", new BufferAttribute(nsSize, 1));
  nsGeo.setAttribute("aSeed", new BufferAttribute(nsSeed, 1));
  const nightStarsMat = keep(premultiplied(new ShaderMaterial({ vertexShader: NIGHT_STARS_VS, fragmentShader: NIGHT_STARS_FS, uniforms: { uTime: shared.uTime, uScale: u(1), uOpacity: u(0) } }), AdditiveBlending));
  nightStarsMat.depthTest = false;
  const nightStars = new Points(nsGeo, nightStarsMat);
  nightStars.frustumCulled = false;
  nightStars.renderOrder = -9;
  nightStars.visible = false;
  sceneB.add(nightStars);
  const rtClouds = keep(new WebGLRenderTarget(4, 4, { type: hdr, depthBuffer: false }));
  const cloudMat = keep(
    new ShaderMaterial({
      vertexShader: CLOUD_VS,
      fragmentShader: CLOUD_FS,
      uniforms: {
        uNoise: u<Texture>(noiseTex),
        uProjInv: u(new Matrix4()),
        uCamWorld: u(new Matrix4()),
        uEye: u(new Vector3()),
        uSunDir: u(SUN_B.clone()),
        uSunCol: u(CLOUD_LIGHT.sun.clone()),
        uAmb: u(CLOUD_LIGHT.ambient.clone()),
        uHaze: u(CLOUD_LIGHT.haze.clone()),
        uTime: shared.uTime,
        uBase: u(-1.6),
        uTop: u(1.8),
        uSteps: u(cloudSteps),
        uOpacity: u(1),
        uFoot: u([0, 0, 1, 0]),
        uFootMix: u([0, 0, 0]),
        uFootTime: u(0),
        uFootY: u(1),
        uFootTile: u(0.95),
      },
      depthTest: false,
      depthWrite: false,
    }),
  );
  const cloudScene = flatScene(cloudMat);
  const compMat = keep(premultiplied(new ShaderMaterial({ vertexShader: FLAT_VS, fragmentShader: COMPOSITE_FS, uniforms: { uSrc: u<Texture>(rtClouds.texture), uTexel: u([0, 0]) } })));
  compMat.depthTest = false;
  const compScene = flatScene(compMat);

  // ── The satellite: Landsat 8 over the cloud, drawn after it (it flies above the deck) ──
  const craftScene = new Scene();
  craftScene.fog = sceneB.fog;
  const sunB = new DirectionalLight(new Color(1.0, 0.6, 0.36), 2.6);
  sunB.position.copy(SUN_B).multiplyScalar(50);
  const fill = new DirectionalLight(new Color(0.62, 0.55, 0.56), 0.45);
  fill.position.set(-8, 6, 20);
  // Light thrown back up off the cloud, warm, onto the craft's underside.
  const bounce = new DirectionalLight(new Color(0.95, 0.62, 0.45), 0.8);
  bounce.position.set(6, -6, 14);
  const hemi = new HemisphereLight(new Color(0.3, 0.22, 0.22), new Color(0.2, 0.12, 0.09), 0.9);
  const moonLight = new DirectionalLight(new Color(0.84, 0.84, 0.86), 0);
  craftScene.add(sunB, fill, bounce, hemi, moonLight);
  /** Where the sun and the moon are over the cloud, shared with the craft's and the sky's shaders. */
  const sunNow = SUN_B.clone();
  const moonNow = new Vector3(0, 0.1, -1);
  const lightNow = new Vector3();
  const shadowY = u(-10);
  const nightU = u(0);
  const sunWarm = new Color(1.0, 0.6, 0.36);
  const sunLow = new Color(1.0, 0.36, 0.14);
  /** How big the satellite is (model units → world). */
  const CRAFT_SCALE = 3.1;
  const craft = new Group();
  craft.visible = false;
  craftScene.add(craft);
  const craftMesh = new Mesh();
  craftMesh.scale.setScalar(CRAFT_SCALE);
  craft.add(craftMesh);
  const cells = u<[number, number, number, number]>([1, 0, 0.03, 0.04]);
  const craftMat = keep(new MeshStandardMaterial({ roughness: 0.5, metalness: 0 }));
  craftMat.onBeforeCompile = (shader) => {
    shader.uniforms.uNoise = { value: noiseTex };
    shader.uniforms.uCells = cells;
    shader.uniforms.uSunDir = { value: sunNow };
    shader.uniforms.uMoonDir = { value: moonNow };
    shader.uniforms.uNight = nightU;
    shader.uniforms.uShadowY = shadowY;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${CRAFT_VERTEX_HEAD}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${CRAFT_VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${CRAFT_FRAGMENT_HEAD}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${CRAFT_COLOR}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${CRAFT_ROUGHNESS}`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\n${CRAFT_METALNESS}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${CRAFT_NORMAL}`)
      .replace("#include <lights_fragment_maps>", `#include <lights_fragment_maps>\n${CRAFT_REFLECT}`)
      .replace("#include <lights_fragment_begin>", LIGHTS_WITH_SHADOW);
  };
  craftMesh.material = craftMat;
  // Two lights on it that blink: white at the wing's tip, amber on the body.
  const beaconGeo = keep(new BufferGeometry());
  beaconGeo.setAttribute("position", new BufferAttribute(new Float32Array(6), 3));
  beaconGeo.setAttribute("aColor", new BufferAttribute(new Float32Array([1, 0.95, 0.88, 1, 0.55, 0.22]), 3));
  beaconGeo.setAttribute("aPhase", new BufferAttribute(new Float32Array([0, 0.43]), 1));
  const beaconMat = keep(premultiplied(new ShaderMaterial({ vertexShader: BEACON_VS, fragmentShader: BEACON_FS, uniforms: { uTime: shared.uTime, uScale: u(1), uOn: u(0) } }), AdditiveBlending));
  const beacons = new Points(beaconGeo, beaconMat);
  beacons.frustumCulled = false;
  beacons.renderOrder = 3;
  craftMesh.add(beacons);
  // Its beam: a cone of light from under it down into the cloud.
  const beamMat = keep(premultiplied(new ShaderMaterial({ vertexShader: BEAM_VS, fragmentShader: BEAM_FS, uniforms: { uOn: u(0), uTime: shared.uTime, uFlare: u(0) } }), AdditiveBlending));
  beamMat.side = DoubleSide;
  const beam = new Mesh(keep(new CylinderGeometry(0.06, 1, 1, 48, 1, true)), beamMat);
  beam.frustumCulled = false;
  beam.renderOrder = 2;
  beam.visible = false;
  craftScene.add(beam);
  const craftAt = { body: new Vector3(), tip: new Vector3(), top: new Vector3(), reach: 1 };
  /** The satellite's disc on screen (centre x, y and radius, CSS px), to tell when it's behind a lens. */
  const craftDisc = [0, 0, 0];
  /** Where the beam lands, and its radius. */
  const foot = { x: 0, z: 0, r: 3.0, y: 1.0 };
  // The beam's patterns (one per lens), blended as the lens changes, and a flare at each change.
  const footMix = [0, 0, 0];
  let scanNow = -2;
  let flare = 0;
  let nudge = 0;
  // Its own slow turn, and the turn you give it (yaw keeps its spin and coasts to a stop; a
  // tilt springs back to level).
  let craftIdle = 0;
  let userYaw = 0;
  let yawVel = 0;
  let userPitch = 0;
  let pitchVel = 0;
  let craftLit = 1;
  const wingCorners = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  let bodyR = 0.4;
  const anchorsOut = new Array<number>(9).fill(0);
  const craftOut: [number, number, number] = [0, 0, 0];
  const qCraft = new Quaternion();
  // Its resting turn: the cells (the model's −x) towards us, the wing reaching down to the left.
  const qBase = new Quaternion().setFromAxisAngle(Z, -Math.PI / 2).multiply(new Quaternion().setFromAxisAngle(Y, Math.PI / 2));

  // ── Glass over set B ──────────────────────────────────────────────────────
  // The scene behind the lenses: sharp at half size (for the clear lens under the pointer),
  // and a lightly blurred copy at a quarter (the frost).
  const rtA = keep(new WebGLRenderTarget(4, 4, { type: hdr, depthBuffer: true }));
  const rtB = keep(new WebGLRenderTarget(4, 4, { type: hdr, depthBuffer: false }));
  const rtC = keep(new WebGLRenderTarget(4, 4, { type: hdr, depthBuffer: false }));
  const blurMat = keep(new ShaderMaterial({ vertexShader: FLAT_VS, fragmentShader: BLUR_FS, uniforms: { uSrc: u<Texture>(rtA.texture), uTexel: u([0, 0]), uOffset: u(1) }, depthTest: false, depthWrite: false }));
  const blurScene = flatScene(blurMat);
  const glassScene = new Scene();
  const panes = Array.from({ length: 4 }, () => {
    const mat = keep(
      premultiplied(
        new ShaderMaterial({
          vertexShader: GLASS_VS,
          fragmentShader: GLASS_FS,
          uniforms: {
            uBlur: u<Texture>(rtC.texture),
            uSharp: u<Texture>(rtA.texture),
            uRect: u([0, 0, 0, 0]),
            uRes: u([1, 1]),
            uRadius: u(18),
            uAlpha: u(0),
            uPointer: u([-999, -999]),
            uHover: u(0),
            uActive: u(0),
          },
        }),
      ),
    );
    mat.depthTest = false;
    // The quad is mirrored into CSS's y-down space, so its winding flips: draw both sides.
    mat.side = DoubleSide;
    const mesh = new Mesh(quad, mat);
    mesh.frustumCulled = false;
    glassScene.add(mesh);
    return mesh;
  });

  // ── Cloud at the cuts: fog that rises through the frame (shaders.ts, FOG_FS) ──
  const fogMat = keep(
    premultiplied(
      new ShaderMaterial({
        vertexShader: FLAT_VS,
        fragmentShader: FOG_FS,
        uniforms: { uNoise: u<Texture>(noiseTex), uPhase: u(0), uTime: shared.uTime, uAspect: u(1), uDeep: u(new Color()), uLit: u(new Color()), uGlow: u(new Color()) },
      }),
    ),
  );
  fogMat.depthTest = false;
  const fogScene = flatScene(fogMat);
  // The sun's flare over the finale.
  const flareMat = keep(premultiplied(new ShaderMaterial({ vertexShader: FLAT_VS, fragmentShader: FLARE_FS, uniforms: { uSunUv: u([0.5, 0.5]), uVis: u(0), uFlash: u(0), uAspect: u(1) } }), AdditiveBlending));
  flareMat.depthTest = false;
  const flareScene = flatScene(flareMat);
  // Fog is soft: it's drawn at half size and scaled up, which looks the same at a quarter of the cost.
  const rtFog = keep(new WebGLRenderTarget(4, 4, { type: hdr, depthBuffer: false }));
  const fogCopy = keep(premultiplied(new ShaderMaterial({ vertexShader: FLAT_VS, fragmentShader: COPY_FS, uniforms: { uSrc: u<Texture>(rtFog.texture) } })));
  fogCopy.depthTest = false;
  const fogCopyScene = flatScene(fogCopy);

  /** The fog at `phase` (0 → 1; it covers everything at 0.5). */
  const drawFog = (phase: number, { deep, lit, glow }: Tint) => {
    if (phase <= 0 || phase >= 1) return;
    const fu = fogMat.uniforms;
    fu.uPhase.value = phase;
    fu.uAspect.value = width / height;
    (fu.uDeep.value as Color).copy(deep);
    (fu.uLit.value as Color).copy(lit);
    (fu.uGlow.value as Color).copy(glow);
    renderer.setRenderTarget(rtFog);
    renderer.clear();
    renderer.render(fogScene, ortho);
    renderer.setRenderTarget(null);
    renderer.render(fogCopyScene, ortho);
  };
  /** Between these phases the fog hides everything, so the world behind it needn't be drawn. */
  const fogCovers = (phase: number) => phase >= 0.4 && phase <= 0.6;

  // ── Set C: the valley, alive, and the porthole back to orbit (shaders.ts, VALLEY_FS) ──
  const valleyMat = keep(
    premultiplied(
      new ShaderMaterial({
        vertexShader: FLAT_VS,
        fragmentShader: VALLEY_FS,
        uniforms: {
          uPhoto: u<Texture>(blank),
          uDepthMap: u<Texture>(blank),
          uNoise: u<Texture>(noiseTex),
          uRes: u([1, 1]),
          uCirc: u([0, 0, 1]),
          uR0: u(1),
          uPointer: u([0, 0]),
          uDolly: u(0),
          uTime: shared.uTime,
          uAspect: u(PHOTO_ASPECT),
          uAlpha: u(1),
          uMist: u(new Color("#8a7d72")),
        },
      }),
    ),
  );
  valleyMat.depthTest = false;
  const valleyScene = flatScene(valleyMat);
  let valleyReady = false;

  // The finale's planet: turned by drags (with a little inertia), idling round otherwise.
  let userSpin = 0;
  let spinVel = 0;
  let cursorWant = 0;
  let cursorAmt = 0;
  let pulseAge = -1;
  let finaleOn = false;

  // ── Loading ───────────────────────────────────────────────────────────────
  const earthSize: [number, number] | undefined = opts.lite ? [2048, 1024] : undefined;
  const signal = abort.signal;
  const uploads: Texture[] = [];
  let warmB = false;
  const ready = (async () => {
    const [moonImg, height, day, night, mask] = await Promise.all([
      bitmap("/about/moon-color.webp", signal, opts.lite ? [1024, 512] : undefined),
      bitmap("/about/moon-height.jpg", signal, opts.lite ? [1024, 512] : undefined),
      bitmap("/about/earth-day.webp", signal, earthSize),
      bitmap("/about/earth-night.webp", signal, earthSize),
      bitmap("/about/earth-mask.webp", signal, opts.lite ? [1024, 512] : undefined),
    ]);
    const pu = planetMat.uniforms;
    pu.uMoon.value = keep(texture(moonImg, true, { wrap: true, aniso }));
    shared.uMoonH.value = keep(texture(height, false, { wrap: true }));
    pu.uDay.value = keep(texture(day, true, { wrap: true, aniso }));
    pu.uNight.value = keep(texture(night, true, { wrap: true }));
    pu.uMask.value = keep(texture(mask, false, { wrap: true, aniso }));
    for (const t of [pu.uMoon.value, shared.uMoonH.value, pu.uDay.value, pu.uNight.value, pu.uMask.value] as Texture[]) renderer.initTexture(t);
    moon.visible = sunCard.visible = true;
    const compiled = renderer.compileAsync(sceneA, camA);
    moon.visible = sunCard.visible = false;
    await compiled;
  })();
  const more = (async () => {
    await ready;
    const [craftGeo, photo, depthMap] = await Promise.all([
      loadCraft("/about/landsat8.bin", signal),
      bitmap("/about/valley.webp", signal, opts.lite ? [1600, 780] : undefined),
      bitmap("/about/valley-depth.webp", signal),
    ]);
    if (signal.aborted) return;
    craftMesh.geometry = keep(craftGeo);
    const at = surveyCraft(craftGeo);
    craftAt.body.copy(at.body);
    craftAt.tip.copy(at.tip);
    craftAt.top.copy(at.top);
    craftAt.reach = at.reach;
    at.wing.forEach((c, i) => wingCorners[i].copy(c));
    bodyR = at.bodyR;
    cells.value = at.cells;
    // The craft turns about its body: shift the model so the body sits at the group's origin.
    craftMesh.position.copy(at.body).multiplyScalar(-CRAFT_SCALE);
    const bp = beaconGeo.getAttribute("position") as BufferAttribute;
    bp.setXYZ(0, at.tip.x, at.tip.y, at.tip.z);
    bp.setXYZ(1, at.top.x, at.top.y + 0.02, at.top.z);
    bp.needsUpdate = true;
    valleyMat.uniforms.uPhoto.value = keep(texture(photo, true));
    valleyMat.uniforms.uDepthMap.value = keep(texture(depthMap, false));
    uploads.push(valleyMat.uniforms.uPhoto.value as Texture, valleyMat.uniforms.uDepthMap.value as Texture);
    valleyReady = true;
    // Compile everything the later sets draw, and run their passes once off screen, so the
    // first frame over the cloud doesn't stall on shader links or render-target allocation.
    craft.visible = beam.visible = nightStars.visible = true;
    for (const [scene, cam] of [[sceneB, camB], [cloudScene, ortho], [compScene, ortho], [craftScene, camB], [blurScene, ortho], [glassScene, ortho], [fogScene, ortho], [fogCopyScene, ortho], [valleyScene, ortho], [flareScene, ortho]] as const) {
      await renderer.compileAsync(scene, cam);
    }
    // The lenses draw the scene into a render target too, which takes its own shader variants
    // (no tone mapping, linear output): compile those now as well. (Programs are created when
    // compileAsync is called, so the target only needs setting around the calls.)
    renderer.setRenderTarget(rtA);
    const variants = [renderer.compileAsync(sceneB, camB), renderer.compileAsync(compScene, ortho), renderer.compileAsync(cloudScene, ortho), renderer.compileAsync(craftScene, camB)];
    renderer.setRenderTarget(null);
    craft.visible = beam.visible = nightStars.visible = false;
    await Promise.all(variants);
    if (signal.aborted) return;
    warmB = true;
  })();
  // Failures surface to the caller through the promises; don't leave them unhandled here.
  ready.catch(() => {});
  more.catch(() => {});

  // ── Per frame ─────────────────────────────────────────────────────────────
  let drift = 0;
  const v1 = new Vector3();
  const v2 = new Vector3();
  const v3 = new Vector3();
  const qSpin = new Quaternion();
  const qTilt = new Quaternion();
  const qAll = new Quaternion();
  const look = new Vector3();
  const fwd = new Vector3();
  const side = new Vector3();
  const pinOut: [number, number, number] = [0, 0, 0];
  const globeOut: [number, number, number] = [0, 0, 0];
  const dropOut: [number, number, number] = [0, 0, 0];
  const pulseDir = new Vector3();
  // The fog: warm-lit as we fall into it, dark inside at dusk, lifting as we come out under it.
  const tint = (deep: string, lit: string, glow: string): Tint => ({ deep: new Color(deep), lit: new Color(lit), glow: new Color(glow) });
  const tintA = tint("#181314", "#5a4842", "#c89a76");
  const tintB = tint("#120e0f", "#3d3230", "#9a7058");
  const tintV = tint("#191413", "#4c4038", "#a08470");
  const tintN = tint("#08080a", "#1c1c1f", "#343434");
  const nightFog: Tint = { deep: new Color(), lit: new Color(), glow: new Color() };
  /** The cloud's fog as it is at this point of nightfall. */
  const fogB = (p: number) => {
    const n = nightAt(p);
    nightFog.deep.copy(tintB.deep).lerp(tintN.deep, n);
    nightFog.lit.copy(tintB.lit).lerp(tintN.lit, n);
    nightFog.glow.copy(tintB.glow).lerp(tintN.glow, n);
    return nightFog;
  };
  const mixed: Tint = { deep: new Color(), lit: new Color(), glow: new Color() };
  const blend = (a: Tint, b: Tint, t: number): Tint => {
    mixed.deep.copy(a.deep).lerp(b.deep, t);
    mixed.lit.copy(a.lit).lerp(b.lit, t);
    mixed.glow.copy(a.glow).lerp(b.glow, t);
    return mixed;
  };
  /** Where a fog [start, cut, end] is: 0 → 0.5 coming in, 0.5 → 1 lifting; -1 outside it. */
  const fogPhase = (p: number, [a, cut, b]: readonly number[]) => (p <= a || p >= b ? -1 : p < cut ? (0.5 * (p - a)) / (cut - a) : 0.5 + (0.5 * (p - cut)) / (b - cut));

  const spinAt = (p: number) => lay.front + 1.35 * clamp01(p / 0.27) + drift;
  const toScreen = (v: Vector3, cam: PerspectiveCamera, out: number[], at: number) => {
    v.project(cam);
    out[at] = (v.x * 0.5 + 0.5) * width;
    out[at + 1] = (0.5 - v.y * 0.5) * height;
    return v.z < 1;
  };

  /** Where Chandigarh is on screen and how squarely it faces us. */
  const placePin = () => {
    v2.copy(CHANDIGARH).applyQuaternion(planet.quaternion).applyQuaternion(tiltGroup.quaternion);
    const facing = v2.dot(v3.copy(camA.position).sub(C).normalize());
    toScreen(v1.copy(C).add(v2), camA, pinOut, 0);
    pinOut[2] = clamp01((facing - 0.25) / 0.35);
  };

  /** The planet in its last place: Kullu brought round to us, then pulled back to the hero's framing. */
  const drawFinale = (p: number, dt: number, time: number, calm: boolean, pointer: [number, number], dragging: boolean) => {
    finaleOn = p >= BEAT.final - 0.01;
    shared.uLife.value = 1;
    planetMat.uniforms.uRelief.value = 0;
    shared.uCloudShift.value = time * 0.0012;
    if (!dragging) {
      userSpin += spinVel * dt;
      spinVel *= Math.exp(-dt * 2.4);
      if (finaleOn && !calm) userSpin += dt * 0.03;
    }
    tiltGroup.position.copy(C);
    tiltGroup.quaternion.copy(qTilt.setFromAxisAngle(Z, TILT));
    planet.quaternion.copy(qSpin.setFromAxisAngle(Y, fin.s + userSpin));
    const e = easeInOut(span(p, BEAT.port[0], BEAT.port[1]));
    // From just above Kullu (it fills the porthole's place), back out to the hero's framing.
    v1.copy(KULLU).applyQuaternion(planet.quaternion).applyQuaternion(tiltGroup.quaternion);
    v2.copy(C).addScaledVector(v1, 1.8);
    camA.position.copy(v2).lerp(cam0, e);
    camA.position.x += pointer[0] * 0.18 * e;
    camA.position.y += pointer[1] * 0.1 * e;
    look.copy(C).lerp(v3.set(0, 0, 0), e);
    camA.up.copy(Y);
    camA.lookAt(look);
    if (Math.abs(camA.fov - 30) > 1e-3) {
      camA.fov = 30;
      camA.updateProjectionMatrix();
    }
    camA.updateMatrixWorld();
    // The day goes round (not with reduced motion): the sun moves on its great circle.
    if (finaleOn && !calm) dayTurn += dt * DAY_RATE;
    const th = DAY_START + dayTurn;
    sunFin.copy(orbit.a).multiplyScalar(Math.cos(th)).addScaledVector(orbit.b, Math.sin(th));
    shared.uSun.value.copy(sunFin).transformDirection(camA.matrixWorldInverse);
    (haloMat.uniforms.uSun.value as Vector3).copy(sunFin);
    daylight = sunFin.dot(v3.copy(camA.position).sub(C).normalize());
    haloMat.uniforms.uCenter.value.copy(C);
    haloMat.uniforms.uStrength.value = 1;
    halo.position.copy(C);
    starMat.uniforms.uScale.value = renderer.getPixelRatio();
    starMat.uniforms.uOpacity.value = e;
    // The Moon comes into view once we're well back, from behind the planet, and goes round.
    const moonShow = span(e, 0.62, 0.92);
    moon.visible = moonShow > 0.001;
    const sh = shared.uShade.value;
    sh[3] = 0;
    if (moon.visible) {
      if (!calm) moonTurn += dt * MOON_RATE;
      const ph = calm ? MOON_CALM : MOON_START + moonTurn;
      moon.position.copy(C).addScaledVector(orbit.m1, Math.cos(ph) * orbit.R).addScaledVector(orbit.m2, Math.sin(ph) * orbit.R);
      moon.lookAt(C);
      moonMat.uniforms.uFade.value = moonShow;
      // Each shadows the other (in view space, like the light).
      v1.copy(moon.position).applyMatrix4(camA.matrixWorldInverse);
      sh[0] = v1.x;
      sh[1] = v1.y;
      sh[2] = v1.z;
      sh[3] = MOON_R;
      v1.copy(C).applyMatrix4(camA.matrixWorldInverse);
      moonMat.uniforms.uShade.value = [v1.x, v1.y, v1.z, 1.0];
    }
    // The sun, far off along its direction, and how much of it shows past the planet and the Moon.
    sunCard.visible = e > 0.5;
    let sunVis = 0;
    if (sunCard.visible) {
      sunCard.position.copy(camA.position).addScaledVector(sunFin, 60);
      sunCard.quaternion.copy(camA.quaternion);
      sunCard.scale.setScalar(60 * Math.tan(20 * DEG) * 2);
      sunMat.uniforms.uOn.value = span(e, 0.6, 0.95);
      const sr = 0.7 * DEG;
      v1.copy(C).sub(camA.position);
      const pd = v1.length();
      sunVis = span(Math.acos(Math.min(1, sunFin.dot(v1.normalize()))), Math.asin(Math.min(1, 1.01 / pd)) - sr, Math.asin(Math.min(1, 1.01 / pd)) + sr);
      if (moon.visible) {
        v1.copy(moon.position).sub(camA.position);
        const md = v1.length();
        sunVis *= span(Math.acos(Math.min(1, sunFin.dot(v1.normalize()))), Math.asin(MOON_R / md) - sr, Math.asin(MOON_R / md) + sr);
      }
    }
    // The reticle and the tap ring.
    cursorAmt += ((finaleOn ? cursorWant : 0) - cursorAmt) * (1 - Math.exp(-dt * 10));
    const cu = planetMat.uniforms.uCursor.value as number[];
    cu[3] = cursorAmt;
    const pu = planetMat.uniforms.uPulse.value as number[];
    if (pulseAge >= 0) pulseAge += dt;
    pu[3] = pulseAge;
    renderer.render(sceneA, camA);
    // Its flare, while it's in front of us and on (or near) the screen.
    if (sunCard.visible && sunVis > 0.001 && sunFin.dot(v2.set(0, 0, -1).applyQuaternion(camA.quaternion)) > 0 && toScreen(v1.copy(camA.position).addScaledVector(sunFin, 100), camA, sunPx, 0)) {
      const [sx, sy] = sunPx;
      const near = 1 - span(Math.max(-sx, sx - width, -sy, sy - height, 0), 0, Math.max(width, height) * 0.25);
      if (near > 0.001) {
        const fu = flareMat.uniforms;
        fu.uSunUv.value = [sx / width, 1 - sy / height];
        fu.uVis.value = sunVis * near * span(e, 0.7, 1);
        fu.uFlash.value = 4 * sunVis * (1 - sunVis);
        fu.uAspect.value = width / height;
        renderer.render(flareScene, ortho);
      }
    }
    placePin();
    // The dropped pin rides round with the planet.
    if (pulseAge >= 0) {
      v2.copy(pulseDir).applyQuaternion(planet.quaternion).applyQuaternion(tiltGroup.quaternion);
      const facing = v2.dot(v3.copy(camA.position).sub(C).normalize());
      toScreen(v1.copy(C).add(v2), camA, dropOut, 0);
      dropOut[2] = clamp01((facing - 0.1) / 0.25);
    }
    // The disc on screen, for the drag and hover area.
    toScreen(v1.copy(C), camA, globeOut, 0);
    v2.setFromMatrixColumn(camA.matrixWorld, 0);
    const cx = globeOut[0];
    const cy = globeOut[1];
    const edge = [0, 0];
    toScreen(v1.copy(C).add(v2), camA, edge, 0);
    globeOut[2] = finaleOn ? Math.hypot(edge[0] - cx, edge[1] - cy) : 0;
    globeOut[0] = cx;
    globeOut[1] = cy;
  };

  /** Ray from a screen point to the planet's surface, as a direction in the planet's own frame. */
  const hitPlanet = (x: number, y: number, out: Vector3) => {
    v1.set((x / width) * 2 - 1, -((y / height) * 2 - 1), 0.5).unproject(camA).sub(camA.position).normalize();
    v2.copy(camA.position).sub(C);
    const b = v2.dot(v1);
    const c = v2.lengthSq() - 1;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0) return null;
    out.copy(camA.position).addScaledVector(v1, t).sub(C).normalize();
    qAll.copy(tiltGroup.quaternion).multiply(planet.quaternion).invert();
    out.applyQuaternion(qAll);
    return { lat: Math.asin(Math.max(-1, Math.min(1, out.y))) / DEG, lon: Math.atan2(-out.z, out.x) / DEG };
  };

  const frame = ({ p, time, dt, calm, pointer, pointerPx, panes: rects, paneRadius, scan: scanWant, dragging, turning }: FrameIn): Readout => {
    shared.uTime.value = time;
    if (uploads.length && p < BEAT.dive[0]) renderer.initTexture(uploads.shift()!);
    else if (warmB && p < BEAT.dive[0]) {
      // Once, while we're still in space: allocate and touch the later sets' targets.
      warmB = false;
      renderer.setRenderTarget(rtClouds);
      renderer.render(cloudScene, ortho);
      renderer.setRenderTarget(rtA);
      renderer.render(compScene, ortho);
      renderer.setRenderTarget(rtB);
      renderer.render(blurScene, ortho);
      renderer.setRenderTarget(rtC);
      renderer.render(blurScene, ortho);
      renderer.setRenderTarget(null);
    }
    const out: Readout = { set: "A", life: 0, alt: 0, pin: pinOut, anchors: anchorsOut, craft: craftOut, craftLit: 1, globe: globeOut, drop: dropOut, daylight: 1 };
    pinOut[2] = 0;
    craftOut[2] = 0;
    globeOut[2] = 0;
    dropOut[2] = 0;
    anchorsOut[2] = anchorsOut[5] = anchorsOut[8] = 0;
    finaleOn = false;
    const inA = p < BEAT.cut;
    const fog1 = fogPhase(p, BEAT.veil);
    const fog2 = fogPhase(p, BEAT.down);
    renderer.setRenderTarget(null);
    renderer.clear();

    if (inA) {
      // ── Space ──
      if (p < BEAT.life[1]) drift += dt * 0.012;
      const life = span(p, BEAT.life[0], BEAT.life[1]);
      out.life = life;
      shared.uLife.value = life;
      // The moon's relief only matters while some of it is left.
      planetMat.uniforms.uRelief.value = life >= 0.999 ? 0 : 0.026;
      shared.uCloudShift.value = time * 0.0012;
      (planetMat.uniforms.uCursor.value as number[])[3] = 0;
      (planetMat.uniforms.uPulse.value as number[])[3] = -1;
      const tilt = TILT * span(p, 0.03, 0.25);
      // Turning with the scroll, then brought round so Kullu meets the camera at the end of the dive.
      const sLife = spinAt(p);
      const end = dive.s + TAU * Math.round((spinAt(0.3) - dive.s) / TAU);
      const spin = mix(sLife, end, span(p, 0.245, 0.31));
      tiltGroup.position.copy(C);
      tiltGroup.quaternion.copy(qTilt.setFromAxisAngle(Z, tilt));
      planet.quaternion.copy(qSpin.setFromAxisAngle(Y, spin));

      // The camera: a slow drift, the pointer, then the fall.
      const k = span(p, BEAT.dive[0], BEAT.cut);
      const ang = span(k, 0, 0.52);
      const alt = (dive.d0 - 1) * Math.pow(DIVE_ALT / (dive.d0 - 1), k);
      const theta = Math.acos(Math.min(1, Math.max(-1, dive.dir0.dot(dive.T))));
      v1.copy(dive.dir0);
      if (theta > 1e-4) {
        // Slerp the direction from the planet's centre round to the dive point.
        const s0 = Math.sin(theta);
        v1.multiplyScalar(Math.sin((1 - ang) * theta) / s0).addScaledVector(dive.T, Math.sin(ang * theta) / s0);
      }
      const still = 1 - k;
      camA.position
        .copy(C)
        .addScaledVector(v1, 1 + alt)
        .add(v2.set(Math.sin(time * 0.13) * 0.03 + pointer[0] * 0.2, Math.cos(time * 0.11) * 0.02 + pointer[1] * 0.12, 0).multiplyScalar(still));
      // Turn early to look at the horizon itself (it dips as we come down), along the dusk
      // line with the sun off to the right, as it will be over the cloud.
      const up = v3.copy(camA.position).sub(C);
      const dist = up.length();
      up.divideScalar(dist);
      fwd.copy(SUN_A).addScaledVector(up, -SUN_A.dot(up)).normalize();
      side.crossVectors(fwd, up);
      fwd.multiplyScalar(Math.cos(SUN_OFF)).addScaledVector(side, -Math.sin(SUN_OFF));
      const dip = Math.acos(Math.min(1, 1 / dist)) - 0.06;
      fwd.multiplyScalar(Math.cos(dip)).addScaledVector(up, -Math.sin(dip)).normalize();
      const level = span(k, 0.04, 0.55);
      look.copy(v1.set(0, 0, 0).sub(camA.position).normalize()).lerp(fwd, level).normalize().add(camA.position);
      camA.up.copy(Y).lerp(up, level).normalize();
      camA.lookAt(look);
      const fov = mix(30, 50, span(k, 0.35, 1));
      if (Math.abs(camA.fov - fov) > 1e-3) {
        camA.fov = fov;
        camA.updateProjectionMatrix();
      }
      camA.updateMatrixWorld();
      out.alt = alt * 6371;

      shared.uSun.value.copy(SUN_A).transformDirection(camA.matrixWorldInverse);
      shared.uShade.value[3] = 0;
      (haloMat.uniforms.uSun.value as Vector3).copy(SUN_A);
      moon.visible = sunCard.visible = false;
      haloMat.uniforms.uCenter.value.copy(C);
      haloMat.uniforms.uStrength.value = span(life, 0.25, 1);
      halo.position.copy(C);
      starMat.uniforms.uScale.value = renderer.getPixelRatio();
      starMat.uniforms.uOpacity.value = 1 - span(k, 0.35, 0.8);
      if (!fogCovers(fog1)) renderer.render(sceneA, camA);
      placePin();
      drawFog(fog1, blend(tintA, tintB, span(fog1, 0.35, 0.65)));
      return out;
    }

    if (p >= BEAT.down[1]) {
      // ── Under the cloud, and back out to orbit ──
      out.set = "C";
      const port = span(p, BEAT.port[0], BEAT.port[1]);
      const hidden = fogCovers(fog2);
      if (!hidden && (port > 0.001 || !valleyReady)) {
        drawFinale(p, dt, time, calm, pointer, dragging);
        out.alt = Math.max(0, camA.position.distanceTo(C) - 1) * 6371;
        out.daylight = daylight;
      }
      if (!hidden && valleyReady && port < 0.999) {
        // The porthole: it fills the screen, then shrinks onto Kullu as we pull back.
        const r0 = Math.hypot(width, height) * 0.52;
        const radius = Math.max(0.5, r0 * Math.pow(1 - easeInOut(port), 1.25));
        const target = [width / 2, height / 2];
        if (port > 0.001) {
          v1.copy(KULLU).applyQuaternion(planet.quaternion).applyQuaternion(tiltGroup.quaternion).add(C);
          toScreen(v1, camA, target, 0);
        }
        // It flies to Kullu only once it fits on screen (until then the picture inside holds still).
        const toward = easeInOut(clamp01(1 - radius / (Math.min(width, height) / 2)));
        const vu = valleyMat.uniforms;
        vu.uRes.value = [width, height];
        vu.uCirc.value = [mix(width / 2, target[0], toward), mix(height / 2, target[1], toward), radius];
        vu.uR0.value = r0;
        vu.uPointer.value = pointer;
        vu.uDolly.value = 1 - span(p, BEAT.valley[0], BEAT.valley[1]);
        vu.uAlpha.value = 1 - span(port, 0.82, 1);
        renderer.render(valleyScene, ortho);
      }
      drawFog(fog2, blend(fogB(p), tintV, span(fog2, 0.35, 0.65)));
      return out;
    }

    // ── Over the cloud ──
    out.set = "B";
    const [ex, ey, ez, tx, ty, tz] = CAM_B(p);
    const bob = Math.sin(time * 0.21) * 0.06;
    camB.position.set(ex + pointer[0] * 0.55, ey + bob + pointer[1] * 0.22, ez);
    camB.lookAt(tx, ty + bob * 0.5, tz);
    camB.updateMatrixWorld();
    out.alt = 2600 + ey * 260;

    // Nightfall: the sun sinks into the cloud and the light goes from it to the moon. The cloud
    // loses the sun as it meets the deck's horizon; the craft, higher up, keeps it until the
    // Earth's shadow climbs over it.
    const night = nightAt(p);
    const elev = SUN_ELEV(p)[0] * DEG;
    sunNow.copy(SUN_AZ).multiplyScalar(Math.cos(elev)).addScaledVector(Y, Math.sin(elev));
    const tall = lay.tall;
    const mAz = mix(-22, -6, tall) * DEG;
    const mEl = mix(5.5, 1.6, tall) * DEG;
    moonNow.set(Math.sin(mAz) * Math.cos(mEl), Math.sin(mEl), -Math.cos(mAz) * Math.cos(mEl));
    nightU.value = night;
    shadowY.value = mix(-4, 14, span(p, 0.7, 0.75));
    const sunOnCloud = clamp01((elev / DEG + 1) / 2);
    const sk = skyMat.uniforms;
    (sk.uSunDir.value as Vector3).copy(sunNow);
    (sk.uMoonDir.value as Vector3).copy(moonNow);
    sk.uNight.value = night;
    nightStars.visible = night > 0.001;
    nightStarsMat.uniforms.uOpacity.value = span(p, 0.675, 0.75);
    nightStarsMat.uniforms.uScale.value = renderer.getPixelRatio();
    {
      const cl = cloudMat.uniforms;
      // The light swings from the sun to the moon as the one sets and the other takes over.
      lightNow.copy(sunNow).lerp(moonNow, span(night, 0.25, 0.7)).normalize();
      (cl.uSunDir.value as Vector3).copy(lightNow);
      (cl.uSunCol.value as Color).copy(CLOUD_LIGHT.sun).multiplyScalar(sunOnCloud).lerp(CLOUD_NIGHT.moon, span(night, 0.3, 1));
      (cl.uAmb.value as Color).copy(CLOUD_LIGHT.ambient).lerp(CLOUD_NIGHT.twilight, span(night, 0, 0.4)).lerp(CLOUD_NIGHT.ambient, span(night, 0.4, 1));
      (cl.uHaze.value as Color).copy(CLOUD_LIGHT.haze).lerp(CLOUD_NIGHT.haze, span(night, 0.15, 0.85));
    }
    sunB.position.copy(sunNow).multiplyScalar(50);
    sunB.color.copy(sunWarm).lerp(sunLow, span(p, 0.64, 0.72));
    moonLight.position.copy(moonNow).multiplyScalar(50);
    moonLight.intensity = 1.3 * night;
    fill.intensity = 0.45 * (1 - 0.8 * night);
    bounce.intensity = 0.8 * (1 - 0.85 * night);
    hemi.intensity = 0.9 * (1 - 0.7 * night);
    // The satellite glides in from the sun's side, slows to a stop over the middle of the frame,
    // drifts while the lenses are shown, then carries on its pass, sweeping off to the left, as
    // we sink into the cloud.
    const arrive = 1 - Math.pow(1 - clamp01((p - 0.535) / (0.645 - 0.535)), 3);
    const leave = Math.pow(clamp01((p - 0.755) / (0.83 - 0.755)), 2.2);
    const hasCraft = !!craftMesh.geometry.attributes.position;
    // (Drawn over the cloud, so only while the camera is above the deck; it goes under the fog.)
    craft.visible = hasCraft && p > 0.53 && p < 0.83 && camB.position.y > 1.9;
    // Each lens changes the pattern the beam draws: blend to it, with a flare and a small nudge.
    if (scanWant !== scanNow) {
      if (scanNow > -2 && scanWant >= 0) {
        flare = 1;
        nudge = 1;
      }
      scanNow = scanWant;
    }
    const kMix = calm ? 1 : 1 - Math.exp(-dt * 4.5);
    for (let i = 0; i < 3; i++) footMix[i] += ((i === scanWant ? 1 : 0) - footMix[i]) * kMix;
    flare *= Math.exp(-dt * 2.2);
    nudge *= Math.exp(-dt * 1.6);
    // Its own slow turn (not with reduced motion), and the turn you gave it, coasting down.
    if (!calm && !turning) craftIdle += dt * 0.12;
    if (!turning) {
      userYaw += yawVel * dt;
      yawVel *= Math.exp(-dt * (calm ? 12 : 1.4));
      pitchVel += (-userPitch * 7 - pitchVel * 3.4) * dt;
      userPitch += pitchVel * dt;
    }
    if (craft.visible) {
      const drift = p - 0.69;
      craft.position.set(0.4 + 0.6 * tall + 30 * (1 - arrive) - 12 * drift - 13 * leave, 5.75 + 0.5 * tall + 6 * (1 - arrive) - 4 * drift - 0.6 * leave, -12.2 - 7 * tall - 22 * (1 - arrive) + 5 * leave);
      craft.scale.setScalar(1 - 0.25 * tall);
      // Turned so the solar wing reaches down to the left and its cells face us; then the pass's
      // own slow turn, a sway, the pointer, and the nudge.
      const sway = calm ? 0 : Math.sin(time * 0.11) * 0.05;
      const kick = calm ? 0 : Math.sin(nudge * 9) * nudge * 0.07;
      // Scrolling turns it on as well (about a quarter turn across the section).
      qCraft.setFromAxisAngle(Y, 0.45 * (1 - arrive) + 9 * drift - 0.5 * leave + pointer[0] * 0.14 + sway + craftIdle + userYaw);
      craft.quaternion.copy(qCraft).multiply(qBase);
      qCraft.setFromAxisAngle(v1.set(1, 0, 0), -pointer[1] * 0.07 + kick + 0.15 * (1 - arrive) + userPitch);
      craft.quaternion.premultiply(qCraft);
      qCraft.setFromAxisAngle(Z, 0.22 * (1 - arrive) - 0.12 * leave + kick * 0.6);
      craft.quaternion.premultiply(qCraft);
      craft.updateMatrixWorld(true);
      beaconMat.uniforms.uScale.value = renderer.getPixelRatio();
      beaconMat.uniforms.uOn.value = span(p, 0.55, 0.6);
      // On screen: just left of the body (the wing reaches down and away to the left), for its tag.
      v1.set(-CRAFT_SCALE * 0.3, CRAFT_SCALE * 0.08, 0).multiplyScalar(craft.scale.x).add(craft.position);
      craftOut[2] = toScreen(v1, camB, craftOut, 0) ? span(p, 0.6, 0.64) * (1 - span(p, 0.745, 0.77)) : 0;
      // Its disc on screen: from the body out to the farthest point of the wing, at its distance.
      toScreen(v1.copy(craft.position), camB, craftDisc, 0);
      const dist = Math.max(0.1, camB.position.distanceTo(craft.position));
      craftDisc[2] = (craftAt.reach * CRAFT_SCALE * craft.scale.x * height) / (2 * dist * Math.tan((camB.fov * DEG) / 2));
      craftLit = clamp01((craft.position.y - (shadowY.value as number) + 0.35) / 0.7);
      out.craftLit = craftLit;
    }
    // The beam lands straight below the body.
    const beamOn = craft.visible ? span(p, 0.6, 0.64) * (1 - span(p, 0.745, 0.775)) : 0;
    foot.x = craft.position.x;
    foot.z = craft.position.z;
    foot.r = 3 * (1 - 0.3 * lay.tall);
    beam.visible = beamOn > 0.001;
    if (beam.visible) {
      const top = craft.position.y - 0.25;
      const len = top - foot.y + 0.4;
      beam.position.set(foot.x, top - len / 2, foot.z);
      beam.scale.set(foot.r * 0.8, len, foot.r * 0.8);
      beam.updateMatrixWorld();
      // It shows best against the dark.
      beamMat.uniforms.uOn.value = beamOn * (1 + 0.7 * night);
      beamMat.uniforms.uFlare.value = flare;
    }
    const cu = cloudMat.uniforms;
    cu.uFoot.value = [foot.x, foot.z, foot.r, beamOn * (1 + flare * 0.8) * (1 + 0.5 * night)];
    cu.uFootMix.value = footMix;
    cu.uFootTime.value = calm ? 0 : time;
    cu.uFootTile.value = mix(0.95, 1.45, lay.tall);
    // Where the lenses point: three spots across the footprint, left to right.
    if (beamOn > 0.001) {
      const spots = [
        [-0.3, 0.7],
        [0.2, -0.15],
        [0.65, 0.45],
      ];
      spots.forEach(([dx, dz], i) => {
        v1.set(foot.x + dx * foot.r, foot.y, foot.z + dz * foot.r);
        anchorsOut[i * 3 + 2] = toScreen(v1, camB, anchorsOut, i * 3) ? 1 : 0;
      });
    }
    const hidden = fogCovers(fog1) || fogCovers(fog2);
    if (!hidden) {
      // The sky, the clouds over it, then the satellite over both.
      renderer.render(sceneB, camB);
      (cu.uProjInv.value as Matrix4).copy(camB.projectionMatrixInverse);
      (cu.uCamWorld.value as Matrix4).copy(camB.matrixWorld);
      (cu.uEye.value as Vector3).copy(camB.position);
      renderer.setRenderTarget(rtClouds);
      renderer.clear();
      renderer.render(cloudScene, ortho);
      renderer.setRenderTarget(null);
      renderer.render(compScene, ortho);
      if (craft.visible) renderer.render(craftScene, camB);
    }

    // The lenses: the scene behind them, sharp and lightly blurred.
    const showGlass = !hidden && rects.some((g) => g.a > 0.01);
    if (showGlass) {
      renderer.setRenderTarget(rtA);
      renderer.clear();
      renderer.render(sceneB, camB);
      renderer.render(compScene, ortho);
      // The satellite (and its beam, straight below it) only if it's behind one of the lenses.
      const [cx, cy, cr] = craftDisc;
      const behind = rects.some((g) => g.a > 0.01 && cx + cr > g.x && cx - cr < g.x + g.w && cy + cr + height * 0.6 > g.y && cy - cr < g.y + g.h);
      if (craft.visible && behind) renderer.render(craftScene, camB);
      const passes: [WebGLRenderTarget, WebGLRenderTarget, number][] = [
        [rtA, rtB, 1],
        [rtB, rtC, 1.5],
      ];
      for (const [src, dst, off] of passes) {
        blurMat.uniforms.uSrc.value = src.texture;
        blurMat.uniforms.uTexel.value = [1 / src.width, 1 / src.height];
        blurMat.uniforms.uOffset.value = off;
        renderer.setRenderTarget(dst);
        renderer.render(blurScene, ortho);
      }
      renderer.setRenderTarget(null);
      panes.forEach((m, i) => {
        const g = rects[i];
        m.visible = !!g && g.a > 0.01;
        if (!g) return;
        const un = (m.material as ShaderMaterial).uniforms;
        un.uRect.value = [g.x, g.y, g.w, g.h];
        un.uRes.value = [width, height];
        un.uRadius.value = paneRadius;
        un.uAlpha.value = g.a;
        un.uPointer.value = pointerPx;
        un.uHover.value = g.hover;
        un.uActive.value = g.active;
      });
      renderer.render(glassScene, ortho);
    }

    drawFog(fog1, blend(tintA, tintB, span(fog1, 0.35, 0.65)));
    drawFog(fog2, blend(fogB(p), tintV, span(fog2, 0.35, 0.65)));
    return out;
  };

  const applySize = () => {
    renderer.setPixelRatio(dprBase * scale);
    renderer.setSize(width, height, false);
    const aspect = width / height;
    camA.aspect = camB.aspect = aspect;
    camA.updateProjectionMatrix();
    camB.updateProjectionMatrix();
    const s = opts.lite ? 3 : 2;
    rtA.setSize(Math.max(4, Math.round(width / s)), Math.max(4, Math.round(height / s)));
    rtB.setSize(Math.max(4, Math.round(width / (s * 2))), Math.max(4, Math.round(height / (s * 2))));
    rtC.setSize(rtB.width, rtB.height);
    // The clouds are the costliest pass: their resolution follows the quality scale.
    const c = cloudDiv / scale;
    rtClouds.setSize(Math.max(4, Math.round(width / c)), Math.max(4, Math.round(height / c)));
    compMat.uniforms.uTexel.value = [1 / rtClouds.width, 1 / rtClouds.height];
    rtFog.setSize(Math.max(4, Math.round(width / 2)), Math.max(4, Math.round(height / 2)));
    layout();
  };

  if (process.env.NODE_ENV !== "production") Object.assign(window, { __abWorld: { sceneA, sceneB, craftScene, planet, clouds, halo, stars, craft, beam, fogMat, camA, camB, dive, lay, cloudMat, panes, valleyMat } });

  const cursorDir = new Vector3();
  return {
    ready,
    more,
    frame,
    resize(w, h) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      dprBase = width * height * dpr * dpr > opts.budget ? Math.max(0.75, Math.sqrt(opts.budget / (width * height))) : dpr;
      applySize();
    },
    setScale(k) {
      scale = k;
      applySize();
    },
    spinBy(dx, ms) {
      // A drag across the disc turns it about as far as the ground under the pointer moved.
      const turn = dx / Math.max(120, globeOut[2] || 240);
      userSpin += turn;
      spinVel = mix(spinVel, turn / Math.max(ms / 1000, 1 / 120), 0.5);
    },
    aim(x, y) {
      if (!finaleOn) return null;
      const hit = hitPlanet(x, y, cursorDir);
      cursorWant = hit ? 1 : 0;
      if (hit) planetMat.uniforms.uCursor.value = [cursorDir.x, cursorDir.y, cursorDir.z, cursorAmt];
      return hit;
    },
    clearAim() {
      cursorWant = 0;
    },
    tap(x, y) {
      if (!finaleOn) return null;
      const hit = hitPlanet(x, y, pulseDir);
      if (hit) {
        planetMat.uniforms.uPulse.value = [pulseDir.x, pulseDir.y, pulseDir.z, 0];
        pulseAge = 0;
      }
      return hit;
    },
    pickCraft(x, y) {
      if (!craft.visible || craftOut[2] < 0.05) return false;
      // The body as a disc, the wing as its four corners on screen.
      const [cx, cy] = craftDisc;
      v1.set(0, 0, 0).applyMatrix4(craftMesh.matrixWorld);
      const dist = Math.max(0.1, camB.position.distanceTo(v1));
      const br = (bodyR * CRAFT_SCALE * craft.scale.x * height) / (2 * dist * Math.tan((camB.fov * DEG) / 2));
      if (Math.hypot(x - cx, y - cy) < br * 0.75 + 8) return true;
      const q = wingCorners.map((c) => {
        const o = [0, 0];
        toScreen(v2.copy(c).applyMatrix4(craftMesh.matrixWorld), camB, o, 0);
        return o;
      });
      let sign = 0;
      for (let i = 0; i < 4; i++) {
        const [ax, ay] = q[i];
        const [bx, by] = q[(i + 1) % 4];
        const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
        if (Math.abs(c) < 1e-6) continue;
        if (sign === 0) sign = Math.sign(c);
        else if (Math.sign(c) !== sign) return false;
      }
      return sign !== 0;
    },
    turnCraft(dx, dy, ms) {
      // A drag across the craft turns it about as far as the wing under the pointer moved.
      const k = 2.4 / Math.max(260, craftDisc[2] || 400);
      userYaw += dx * k;
      yawVel = mix(yawVel, (dx * k) / Math.max(ms / 1000, 1 / 120), 0.5);
      userPitch = Math.max(-0.6, Math.min(0.6, userPitch + dy * k * 0.6));
      pitchVel = 0;
    },
    tapCraft() {
      flare = 1;
      nudge = 1;
    },
    lost: () => isLost || gl.isContextLost(),
    dispose() {
      abort.abort();
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      for (const d of disposables) d.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
