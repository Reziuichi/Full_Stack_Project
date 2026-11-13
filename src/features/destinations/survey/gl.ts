// The survey in WebGL2, with three.js: the land as a point cloud (sea as
// moving waves), contour lines, a fine wireframe, strata planes, landmark
// pins and the panel whose photo decodes from coarse blocks, the route, a
// low sun, faint stars. One pass into a render target, then a lens pass
// (FXAA, vignette, grain, faint scanlines, a little chromatic aberration in
// motion). Losing the GPU context is survivable: three.js rebuilds on
// restore from the buffers it keeps.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  LineSegments,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  Texture,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  type IUniform,
} from "three";
import { PANEL_LIFT, panelSize, type Frame } from "./story";
import { contours, route as traceRoute, SIZE, type Survey, type V3 } from "./terrain";

export type Renderer = {
  kind: "gl" | "2d";
  render: (f: Frame) => void;
  setPhoto: (index: number, img: HTMLImageElement) => void;
  setScale: (k: number) => void;
  status: () => "ready" | "lost" | "failed";
  /** Where a landmark's panel sits on screen this frame: [left, top, right, bottom] in CSS px, or null. */
  panelRect: (index: number) => [number, number, number, number] | null;
  dispose: () => void;
};

export type SurveyScene = { survey: Survey; spots: V3[]; stops: [number, number][]; planes: number[]; top: number };

export function budgetedDpr(cssW: number, cssH: number, budget: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const px = cssW * cssH * dpr * dpr;
  return px > budget ? Math.max(0.6, Math.sqrt(budget / (cssW * cssH))) : dpr;
}

const QUAD_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const LAND_VS = /* glsl */ `
attribute float aSlope;
attribute float aWater;
attribute float aFront;
attribute float aSeed;
uniform float uScan;
uniform float uAlpha;
uniform float uTime;
uniform float uPx;
uniform vec3 uProbe;
uniform float uProbeAmt;
uniform vec3 uFocus;
uniform float uFocusAmt;
varying float vA;
varying vec3 vC;
void main() {
  vec3 p = position;
  if (aWater > 0.5) {
    p.y = 0.016 * sin(p.x * 3.1 + uTime * 0.9 + sin(p.z * 2.3 + uTime * 0.6) * 1.6) + 0.008 * sin(p.z * 7.0 - uTime * 1.3);
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // The scan: land appears behind a bright front sweeping away from the viewer.
  float vis = 1.0 - smoothstep(uScan - 0.035, uScan, aFront);
  float band = exp(-pow((aFront - uScan + 0.015) / 0.016, 2.0));
  float light = 0.42 + aSlope * 1.05 + p.y * 0.2;
  float dp = distance(p.xz, uProbe.xz);
  light += (exp(-dp * dp / 0.045) * 1.3 + exp(-pow((dp - 0.3) * 26.0, 2.0)) * 0.9) * uProbeAmt;
  float df = distance(p.xz, uFocus.xz);
  float wave = fract(uTime * 0.33);
  light += (exp(-df * df / 0.1) * 0.7 + exp(-pow((df - wave * 1.7) * 13.0, 2.0)) * 0.8 * (1.0 - wave)) * uFocusAmt;
  vec3 land = vec3(0.86, 0.9, 1.0);
  vec3 sea = vec3(0.4, 0.58, 0.7);
  float glint = aWater > 0.5 ? 0.45 + 0.9 * pow(max(0.0, sin(p.x * 9.0 + uTime * 1.6 + aSeed * 6.0)), 10.0) : 1.0;
  vC = mix(land, sea, aWater) * glint;
  vA = (vis * light + band * 1.6 * vis) * uAlpha * 0.78;
  float near = clamp(6.0 / max(0.5, -mv.z), 0.35, 2.6);
  gl_PointSize = (1.0 + aSlope * 0.8 + band * 1.6) * uPx * near;
}`;

const DOT_FS = /* glsl */ `
varying float vA;
varying vec3 vC;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.35, r) * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vC, a);
}`;

const CONTOUR_VS = /* glsl */ `
attribute float aLevel;
uniform float uAlpha;
uniform float uReveal;
uniform float uTime;
uniform float uScan;
uniform float uPlanes[8];
uniform float uPlaneAmt;
uniform float uFocus;
varying float vA;
varying vec3 vC;
void main() {
  vec4 mv = modelViewMatrix * vec4(position + vec3(0.0, 0.004, 0.0), 1.0);
  gl_Position = projectionMatrix * mv;
  float pulse = exp(-pow((aLevel - fract(uTime * 0.05)) * 12.0, 2.0));
  float a = step(aLevel, uReveal) * (0.3 + 0.7 * pulse);
  float cut = 0.0;
  for (int i = 0; i < 8; i++) {
    float on = abs(aLevel - uPlanes[i]) < 0.001 ? 1.0 : 0.0;
    float focus = float(i) == uFocus ? 1.0 : 0.0;
    cut = max(cut, on * (0.55 + focus * 0.45));
  }
  float front = 0.5 - position.z / ${SIZE.toFixed(1)};
  vA = (a + cut * uPlaneAmt * 1.4) * uAlpha * (1.0 - smoothstep(uScan - 0.04, uScan, front));
  vC = mix(vec3(0.82, 0.88, 1.0), vec3(1.0), cut * uPlaneAmt);
}`;

const LINE_FS = /* glsl */ `
varying float vA;
varying vec3 vC;
void main() {
  if (vA < 0.004) discard;
  gl_FragColor = vec4(vC, vA);
}`;

const GRID_VS = /* glsl */ `
uniform float uAlpha;
uniform float uScan;
varying float vA;
varying vec3 vC;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position + vec3(0.0, 0.002, 0.0), 1.0);
  float front = 0.5 - position.z / ${SIZE.toFixed(1)};
  vA = uAlpha * 0.35 * (1.0 - smoothstep(uScan - 0.04, uScan, front));
  vC = vec3(0.75, 0.82, 0.95);
}`;

const PLANE_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** A survey plane: a fine grid, a bright border with corner ticks, a faint fill. */
const PLANE_FS = /* glsl */ `
uniform float uAlpha;
uniform float uFocus;
varying vec2 vUv;
void main() {
  vec2 g = vUv * 12.0;
  vec2 w = fwidth(g);
  vec2 f = abs(fract(g - 0.5) - 0.5) / w;
  float grid = 1.0 - min(min(f.x, f.y), 1.0);
  vec2 e = min(vUv, 1.0 - vUv);
  vec2 ew = fwidth(vUv);
  float border = 1.0 - min(min(e.x / ew.x, e.y / ew.y) / 1.2, 1.0);
  float corner = step(min(e.x, e.y), 0.006) * step(max(e.x, e.y), 0.06);
  float a = (grid * 0.12 + border * 0.7 + corner * 0.9 + 0.035) * uAlpha * (0.55 + uFocus * 0.45);
  gl_FragColor = vec4(vec3(0.86, 0.9, 1.0) * (0.85 + uFocus * 0.3), a);
}`;

const PIN_VS = /* glsl */ `
attribute float aIndex;
attribute float aGlow;
uniform float uActive;
uniform float uAlpha;
uniform float uTime;
varying float vA;
varying vec3 vC;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  float on = abs(aIndex - uActive) < 0.5 ? 1.0 : 0.0;
  vA = uAlpha * (0.32 + on * 0.68) * (0.7 + aGlow * 0.3 * (0.6 + 0.4 * sin(uTime * 2.0)));
  vC = mix(vec3(0.8, 0.86, 1.0), vec3(1.0, 0.72, 0.5), on * aGlow);
}`;

/** A landmark's photo, decoding: coarse blocks that refine to the full image, grey until the cursor brings its colour up. */
const PANEL_FS = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uTexSize;
uniform vec2 uFit;
uniform float uBlock;
uniform float uColor;
uniform float uReveal;
uniform float uHas;
uniform float uTime;
varying vec2 vUv;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
void main() {
  vec2 uv = (vUv - 0.5) * uFit + 0.5;
  vec2 bs = vec2(max(uBlock, 1.0)) / uTexSize;
  vec2 q = uBlock > 1.01 ? (floor(uv / bs) + 0.5) * bs : uv;
  vec3 c = texture2D(uTex, q).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 grey = vec3(smoothstep(0.04, 0.96, l));
  vec3 col = mix(grey, c, uColor);
  // Cells arrive in a scattered order; a scanline sweeps down once.
  vec2 cell = floor(vUv * vec2(28.0, 18.0));
  float order = hash(cell);
  float on = step(order, uReveal * 1.15);
  float scan = exp(-pow((1.0 - vUv.y - fract(uTime * 0.22)) * 90.0, 2.0)) * 0.08;
  col += scan;
  col *= 0.94 + 0.06 * sin(vUv.y * 900.0);
  // A hairline frame and corner ticks.
  vec2 e = min(vUv, 1.0 - vUv);
  vec2 ew = fwidth(vUv);
  float frame = 1.0 - min(min(e.x / ew.x, e.y / ew.y), 1.0);
  col = mix(col, vec3(1.0), frame * 0.8);
  float a = (uHas > 0.5 ? on : 0.0) * uReveal;
  a = max(a, frame * uReveal);
  gl_FragColor = vec4(col, a);
}`;

const ROUTE_VS = /* glsl */ `
attribute float aDist;
uniform float uRoute;
uniform float uAlpha;
uniform float uTime;
varying float vA;
varying vec3 vC;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  float head = exp(-pow((aDist - uRoute) * 40.0, 2.0));
  float dash = step(0.35, fract(aDist * 90.0 - uTime * 0.6));
  vA = step(aDist, uRoute) * uAlpha * (0.55 + dash * 0.45) + head * uAlpha * step(0.001, uRoute) * step(uRoute, 0.999);
  vC = vec3(1.0, 0.78, 0.58);
}`;

const STAR_VS = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uPx;
varying float vA;
varying vec3 vC;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vA = (0.25 + 0.2 * sin(uTime * (0.5 + aSeed * 2.0) + aSeed * 30.0)) * (0.4 + aSeed * 0.6);
  vC = vec3(0.8, 0.86, 1.0);
  gl_PointSize = (1.0 + step(0.97, aSeed) * 1.6) * uPx;
}`;

const SUN_FS = /* glsl */ `
uniform float uAmt;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = (exp(-d * d * 220.0) * 1.2 + exp(-d * d * 18.0) * 0.28 + exp(-d * d * 3.0) * 0.08) * uAmt;
  gl_FragColor = vec4(vec3(1.0, 0.96, 0.9), a);
}`;

const POST_FS = /* glsl */ `
uniform sampler2D uMain;
uniform vec2 uPx;
uniform float uAberr;
uniform float uTime;
uniform float uFlash;
varying vec2 vUv;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec3 fxaa(vec2 uv) {
  const vec3 L = vec3(0.299, 0.587, 0.114);
  vec3 m = texture2D(uMain, uv).rgb;
  float lNW = dot(texture2D(uMain, uv + vec2(-0.5, -0.5) * uPx).rgb, L);
  float lNE = dot(texture2D(uMain, uv + vec2(0.5, -0.5) * uPx).rgb, L);
  float lSW = dot(texture2D(uMain, uv + vec2(-0.5, 0.5) * uPx).rgb, L);
  float lSE = dot(texture2D(uMain, uv + vec2(0.5, 0.5) * uPx).rgb, L);
  float lM = dot(m, L);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.05, lMax * 0.16)) return m;
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), -6.0, 6.0) * uPx;
  vec3 a = 0.5 * (texture2D(uMain, uv - dir / 6.0).rgb + texture2D(uMain, uv + dir / 6.0).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(uMain, uv - dir * 0.5).rgb + texture2D(uMain, uv + dir * 0.5).rgb);
  float lB = dot(b, L);
  return lB < lMin || lB > lMax ? a : b;
}
void main() {
  vec2 c = vUv - 0.5;
  float r2 = dot(c, c);
  vec3 col = fxaa(vUv);
  if (uAberr > 0.0004) {
    vec2 off = c * uAberr * (0.6 + r2 * 3.0);
    col.r = texture2D(uMain, vUv + off).r;
    col.b = texture2D(uMain, vUv - off).b;
  }
  col *= 1.0 - smoothstep(0.12, 0.62, r2) * 0.5;
  col *= 0.97 + 0.03 * sin(gl_FragCoord.y * 1.6);
  col += (hash(gl_FragCoord.xy + fract(uTime * 7.0) * 91.0) - 0.5) * 0.035;
  col = mix(col, vec3(0.9, 0.93, 1.0), uFlash);
  gl_FragColor = vec4(col, 1.0);
}`;

const quad = (frag: string, uniforms: Record<string, IUniform>) => {
  const m = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false }));
  m.frustumCulled = false;
  return m;
};

export type GlHooks = { onLost: () => void; onRestored: () => void };

export function createGl(canvas: HTMLCanvasElement, world: SurveyScene, seed: number, hooks: GlHooks): Renderer | null {
  let ctx: WebGL2RenderingContext | null = null;
  try {
    ctx = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: "high-performance", failIfMajorPerformanceCaveat: true });
  } catch {
    ctx = null;
  }
  if (!ctx || ctx.isContextLost()) return null;
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, context: ctx, antialias: false, alpha: false, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  renderer.setClearColor(0x050608, 1);
  const coarse = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768;
  let r = seed >>> 0 || 1;
  const rand = () => {
    r = (r + 0x6d2b79f5) >>> 0;
    let t = r;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const { survey } = world;
  const G = survey.grid;
  const camera = new PerspectiveCamera(36, 1, 0.05, 220);
  const scene = new Scene();
  const time = { value: 0 };
  const px = { value: 1 };
  const scan = { value: 0 };
  let lost = false;
  let scale = 1;
  let W = 0;
  let H = 0;
  const rtMain = new WebGLRenderTarget(1, 1, { depthBuffer: true, samples: 0, minFilter: LinearFilter, magFilter: LinearFilter });

  // ── The land as points. ───────────────────────────────────────────────
  const per = coarse ? 1 : 2;
  const NL = G * G * per;
  const pos = new Float32Array(NL * 3);
  const aSlope = new Float32Array(NL);
  const aWater = new Float32Array(NL);
  const aFront = new Float32Array(NL);
  const aSeed = new Float32Array(NL);
  let n = 0;
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      for (let k = 0; k < per; k++) {
        const u = Math.min(1, (i + (per > 1 || k ? rand() : 0.5)) / G);
        const v = Math.min(1, (j + (per > 1 || k ? rand() : 0.5)) / G);
        const ci = Math.min(G - 1, Math.round(u * (G - 1)));
        const cj = Math.min(G - 1, Math.round(v * (G - 1)));
        const c = cj * G + ci;
        // Height from the four neighbouring cells.
        const x = u * (G - 1);
        const y = v * (G - 1);
        const i0 = Math.min(G - 2, Math.floor(x));
        const j0 = Math.min(G - 2, Math.floor(y));
        const fx = x - i0;
        const fy = y - j0;
        const h = (survey.y[j0 * G + i0] * (1 - fx) + survey.y[j0 * G + i0 + 1] * fx) * (1 - fy) + (survey.y[(j0 + 1) * G + i0] * (1 - fx) + survey.y[(j0 + 1) * G + i0 + 1] * fx) * fy;
        pos.set([(u - 0.5) * SIZE, h, (v - 0.5) * SIZE], n * 3);
        aSlope[n] = survey.slope[c];
        aWater[n] = survey.water[c];
        aFront[n] = 1 - v;
        aSeed[n] = rand();
        n++;
      }
    }
  }
  const lg = new BufferGeometry();
  lg.setAttribute("position", new BufferAttribute(pos, 3));
  lg.setAttribute("aSlope", new BufferAttribute(aSlope, 1));
  lg.setAttribute("aWater", new BufferAttribute(aWater, 1));
  lg.setAttribute("aFront", new BufferAttribute(aFront, 1));
  lg.setAttribute("aSeed", new BufferAttribute(aSeed, 1));
  const landU = {
    uScan: scan,
    uAlpha: { value: 0 },
    uTime: time,
    uPx: px,
    uProbe: { value: new Vector3() },
    uProbeAmt: { value: 0 },
    uFocus: { value: new Vector3() },
    uFocusAmt: { value: 0 },
  };
  const land = new Points(lg, new ShaderMaterial({ vertexShader: LAND_VS, fragmentShader: DOT_FS, uniforms: landU, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending }));
  land.frustumCulled = false;
  land.renderOrder = 1;
  scene.add(land);

  // ── Contours. ─────────────────────────────────────────────────────────
  const LEVELS = 18;
  const ct = contours(survey, LEVELS, coarse ? 2 : 1);
  const cg = new BufferGeometry();
  cg.setAttribute("position", new BufferAttribute(ct.pos, 3));
  cg.setAttribute("aLevel", new BufferAttribute(ct.level, 1));
  const planeLevels = new Array(8).fill(-1);
  world.planes.forEach((l, i) => i < 8 && (planeLevels[i] = l));
  const contourU = { uAlpha: { value: 0 }, uReveal: { value: 0 }, uTime: time, uScan: scan, uPlanes: { value: planeLevels }, uPlaneAmt: { value: 0 }, uFocus: { value: -1 } };
  const contourLines = new LineSegments(cg, new ShaderMaterial({ vertexShader: CONTOUR_VS, fragmentShader: LINE_FS, uniforms: contourU, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending }));
  contourLines.frustumCulled = false;
  contourLines.renderOrder = 2;
  scene.add(contourLines);

  // ── A fine wireframe: lines along the grid every few cells. ───────────
  const gridPts: number[] = [];
  const every = 10;
  const at = (i: number, j: number) => [(i / (G - 1) - 0.5) * SIZE, survey.y[j * G + i], (j / (G - 1) - 0.5) * SIZE];
  for (let j = 0; j < G; j += every) for (let i = 0; i < G - 1; i++) gridPts.push(...at(i, j), ...at(i + 1, j));
  for (let i = 0; i < G; i += every) for (let j = 0; j < G - 1; j++) gridPts.push(...at(i, j), ...at(i, j + 1));
  const gg = new BufferGeometry();
  gg.setAttribute("position", new BufferAttribute(new Float32Array(gridPts), 3));
  const gridU = { uAlpha: { value: 0 }, uScan: scan };
  const grid = new LineSegments(gg, new ShaderMaterial({ vertexShader: GRID_VS, fragmentShader: LINE_FS, uniforms: gridU, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending }));
  grid.frustumCulled = false;
  grid.renderOrder = 0;
  scene.add(grid);

  // ── Strata planes. ────────────────────────────────────────────────────
  const planeMeshes = world.planes.map((level) => {
    const u = { uAlpha: { value: 0 }, uFocus: { value: 0 } };
    const m = new Mesh(new PlaneGeometry(SIZE * 1.04, SIZE * 1.04), new ShaderMaterial({ vertexShader: PLANE_VS, fragmentShader: PLANE_FS, uniforms: u, transparent: true, depthWrite: false, depthTest: false, side: 2 }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = level * world.top;
    m.frustumCulled = false;
    m.renderOrder = 3;
    m.visible = false;
    scene.add(m);
    return { m, u, level };
  });

  // ── Pins: a line up from each landmark, a ring at its foot, a tick at its head. ──
  const pinPts: number[] = [];
  const pinIdx: number[] = [];
  const pinGlow: number[] = [];
  const seg = (a: V3, b: V3, idx: number, g: number) => {
    pinPts.push(...a, ...b);
    pinIdx.push(idx, idx);
    pinGlow.push(g, g);
  };
  world.spots.forEach((p, idx) => {
    const top: V3 = [p[0], p[1] + PANEL_LIFT, p[2]];
    seg(p, top, idx, 1);
    for (const [rad, g] of [
      [0.13, 1],
      [0.26, 0.4],
    ] as const) {
      for (let k = 0; k < 40; k++) {
        const a0 = (k / 40) * Math.PI * 2;
        const a1 = ((k + 1) / 40) * Math.PI * 2;
        if (rad > 0.2 && k % 2) continue;
        seg([p[0] + Math.cos(a0) * rad, p[1] + 0.006, p[2] + Math.sin(a0) * rad], [p[0] + Math.cos(a1) * rad, p[1] + 0.006, p[2] + Math.sin(a1) * rad], idx, g);
      }
    }
    seg([top[0] - 0.06, top[1], top[2]], [top[0] + 0.06, top[1], top[2]], idx, 1);
  });
  const pg = new BufferGeometry();
  pg.setAttribute("position", new BufferAttribute(new Float32Array(pinPts), 3));
  pg.setAttribute("aIndex", new BufferAttribute(new Float32Array(pinIdx), 1));
  pg.setAttribute("aGlow", new BufferAttribute(new Float32Array(pinGlow), 1));
  const pinU = { uActive: { value: -1 }, uAlpha: { value: 0 }, uTime: time };
  const pins = new LineSegments(pg, new ShaderMaterial({ vertexShader: PIN_VS, fragmentShader: LINE_FS, uniforms: pinU, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending }));
  pins.frustumCulled = false;
  pins.renderOrder = 4;
  scene.add(pins);

  // ── The route. ────────────────────────────────────────────────────────
  const rt = traceRoute(survey, world.stops);
  const rPts: number[] = [];
  const rDist: number[] = [];
  for (let i = 1; i < rt.pts.length; i++) {
    rPts.push(...rt.pts[i - 1], ...rt.pts[i]);
    rDist.push(rt.total > 0 ? rt.dist[i - 1] / rt.total : 0, rt.total > 0 ? rt.dist[i] / rt.total : 0);
  }
  const rg = new BufferGeometry();
  rg.setAttribute("position", new BufferAttribute(new Float32Array(rPts.length ? rPts : [0, 0, 0, 0, 0, 0]), 3));
  rg.setAttribute("aDist", new BufferAttribute(new Float32Array(rDist.length ? rDist : [0, 0]), 1));
  const routeU = { uRoute: { value: 0 }, uAlpha: { value: 0 }, uTime: time };
  const routeLine = new LineSegments(rg, new ShaderMaterial({ vertexShader: ROUTE_VS, fragmentShader: LINE_FS, uniforms: routeU, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending }));
  routeLine.frustumCulled = false;
  routeLine.renderOrder = 5;
  scene.add(routeLine);

  // ── Photo panels. ─────────────────────────────────────────────────────
  const panels = world.spots.map((p, idx) => {
    const u = {
      uTex: { value: new Texture() },
      uTexSize: { value: [1, 1] },
      uFit: { value: [1, 1] },
      uBlock: { value: 40 },
      uColor: { value: 0 },
      uReveal: { value: 0 },
      uHas: { value: 0 },
      uTime: time,
    };
    const m = new Mesh(new PlaneGeometry(1, 1), new ShaderMaterial({ vertexShader: PLANE_VS, fragmentShader: PANEL_FS, uniforms: u, transparent: true, depthWrite: false, depthTest: false }));
    m.frustumCulled = false;
    m.renderOrder = 6;
    m.visible = false;
    scene.add(m);
    return { m, u, idx, base: p, w: 1.5, h: 1.0 };
  });

  // ── Sky: faint stars and a low sun on the horizon. ────────────────────
  const SN = coarse ? 600 : 1400;
  const sp = new Float32Array(SN * 3);
  const ss = new Float32Array(SN);
  for (let i = 0; i < SN; i++) {
    const az = rand() * Math.PI * 2;
    const el = 0.05 + rand() * 1.4;
    const rr = 80;
    sp.set([Math.sin(az) * Math.cos(el) * rr, Math.sin(el) * rr - 6, -Math.cos(az) * Math.cos(el) * rr], i * 3);
    ss[i] = rand();
  }
  const sg = new BufferGeometry();
  sg.setAttribute("position", new BufferAttribute(sp, 3));
  sg.setAttribute("aSeed", new BufferAttribute(ss, 1));
  const stars = new Points(sg, new ShaderMaterial({ vertexShader: STAR_VS, fragmentShader: DOT_FS, uniforms: { uTime: time, uPx: px }, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending }));
  stars.frustumCulled = false;
  stars.renderOrder = -2;
  scene.add(stars);
  const sunU = { uAmt: { value: 0 } };
  const sun = new Mesh(new PlaneGeometry(1, 1), new ShaderMaterial({ vertexShader: PLANE_VS, fragmentShader: SUN_FS, uniforms: sunU, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending }));
  sun.position.set(0.6, 2.2, -26);
  sun.scale.setScalar(16);
  sun.frustumCulled = false;
  sun.renderOrder = -1;
  scene.add(sun);

  const post = new Scene();
  const postU = { uMain: { value: rtMain.texture }, uPx: { value: [1, 1] }, uAberr: { value: 0 }, uTime: time, uFlash: { value: 0 } };
  post.add(quad(POST_FS, postU));

  const resize = () => {
    const cssW = canvas.clientWidth || 1;
    const cssH = canvas.clientHeight || 1;
    const d = budgetedDpr(cssW, cssH, coarse ? 1.7e6 : 2.6e6) * scale;
    const w = Math.max(1, Math.round(cssW * d));
    const h = Math.max(1, Math.round(cssH * d));
    if (w === W && h === H) return;
    W = w;
    H = h;
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    rtMain.setSize(w, h);
    postU.uPx.value = [1 / w, 1 / h];
    px.value = d;
  };

  const rects: ([number, number, number, number] | null)[] = panels.map(() => null);
  const corner = new Vector3();
  const render = (f: Frame) => {
    if (lost) return;
    resize();
    time.value = f.time;
    scan.value = f.scan;
    camera.fov = (f.fov * 180) / Math.PI;
    camera.aspect = f.aspect;
    camera.position.set(f.eye[0], f.eye[1], f.eye[2]);
    camera.up.set(0, 1, 0);
    camera.lookAt(f.target[0], f.target[1], f.target[2]);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    landU.uAlpha.value = f.points;
    landU.uProbe.value.set(f.probe[0], f.probe[1], f.probe[2]);
    landU.uProbeAmt.value = f.probeAmt;
    const focus = f.active >= 0 ? world.spots[f.active] : null;
    if (focus) landU.uFocus.value.set(focus[0], focus[1], focus[2]);
    landU.uFocusAmt.value = focus ? f.pins : 0;
    contourU.uAlpha.value = f.contours;
    contourU.uReveal.value = f.contourReveal;
    contourU.uPlaneAmt.value = f.strata;
    contourU.uFocus.value = f.focus;
    gridU.uAlpha.value = f.grid;
    grid.visible = f.grid > 0.003;

    const P = planeMeshes.length;
    planeMeshes.forEach((pm, i) => {
      pm.m.visible = f.strata > 0.003;
      pm.u.uAlpha.value = f.strata;
      pm.u.uFocus.value = f.focus === i ? 1 : 0;
      pm.m.position.y = pm.level * world.top + f.spread * (i - (P - 1) / 2) * 0.62 + f.spread * 0.5;
    });

    pinU.uAlpha.value = f.pins;
    pinU.uActive.value = f.active;
    pins.visible = f.pins > 0.003;
    routeU.uRoute.value = f.route;
    routeU.uAlpha.value = f.routeAlpha;
    routeLine.visible = f.routeAlpha > 0.003;
    sunU.uAmt.value = f.sun;
    sun.visible = f.sun > 0.003;
    sun.quaternion.copy(camera.quaternion);

    panels.forEach((p, i) => {
      const on = i === f.active && f.panel > 0.003;
      p.m.visible = on;
      rects[i] = null;
      if (!on) return;
      p.m.position.set(p.base[0], p.base[1] + PANEL_LIFT + p.h * 0.5 + 0.06, p.base[2]);
      p.m.quaternion.copy(camera.quaternion);
      p.m.scale.set(p.w, p.h, 1);
      p.u.uReveal.value = f.panel;
      p.u.uBlock.value = f.block;
      p.u.uColor.value = f.color;
      p.m.updateMatrixWorld();
      // Its rectangle on screen, for the labels and the cursor.
      let l = Infinity;
      let t = Infinity;
      let rr = -Infinity;
      let b = -Infinity;
      for (const [cx, cy] of [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.5, 0.5],
        [-0.5, 0.5],
      ]) {
        corner.set(cx, cy, 0).applyMatrix4(p.m.matrixWorld).project(camera);
        const sx = (corner.x * 0.5 + 0.5) * f.width;
        const sy = (0.5 - corner.y * 0.5) * f.height;
        l = Math.min(l, sx);
        t = Math.min(t, sy);
        rr = Math.max(rr, sx);
        b = Math.max(b, sy);
      }
      rects[i] = [l, t, rr, b];
    });

    postU.uAberr.value = f.aberration;
    postU.uFlash.value = f.flash;
    renderer.setRenderTarget(rtMain);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(post, camera);
  };

  const onLost = () => {
    lost = true;
    hooks.onLost();
  };
  const onRestored = () => {
    lost = false;
    W = H = 0;
    hooks.onRestored();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  return {
    kind: "gl",
    render,
    setPhoto(index, img) {
      const p = panels[index];
      if (!p || p.u.uHas.value) return;
      const tex = new Texture(img);
      tex.generateMipmaps = true;
      tex.minFilter = LinearMipmapLinearFilter;
      tex.magFilter = LinearFilter;
      tex.needsUpdate = true;
      const ar = img.naturalWidth / Math.max(1, img.naturalHeight);
      const { pa, w, h } = panelSize(ar);
      p.w = w;
      p.h = h;
      p.u.uFit.value = ar > pa ? [pa / ar, 1] : [1, ar / pa];
      p.u.uTex.value = tex;
      p.u.uTexSize.value = [img.naturalWidth, img.naturalHeight];
      p.u.uHas.value = 1;
      if (!lost) renderer.initTexture(tex);
    },
    setScale(k) {
      scale = Math.max(0.5, Math.min(1, k));
    },
    status: () => (lost ? "lost" : "ready"),
    panelRect: (i) => rects[i] ?? null,
    dispose() {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      for (const s of [scene, post]) {
        s.traverse((o) => {
          const m = o as Mesh;
          m.geometry?.dispose();
          (m.material as ShaderMaterial | undefined)?.dispose?.();
        });
      }
      for (const p of panels) p.u.uTex.value.dispose();
      rtMain.dispose();
      if (!lost) renderer.forceContextLoss();
      renderer.dispose();
    },
  };
}
