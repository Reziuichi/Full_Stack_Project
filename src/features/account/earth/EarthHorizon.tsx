"use client";

import { useEffect, useRef, type RefObject } from "react";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./earthShader";

export interface EarthTelemetry {
  /** Sun elevation over the patch of Earth in view, in degrees. */
  sunElevation: number;
  phase: "Dawn" | "Morning" | "Daylight" | "Golden hour" | "Sunset" | "Orbital night";
  lat: number;
  lon: number;
  /** Local time down there, "HH:MM" (noon when the sun is highest). */
  localTime: string;
}

/** Where the giant word sits, in CSS pixels from the top-left of the scene. */
export interface WordLayout {
  left: number;
  top: number;
  capHeight: number;
}

type Vec3 = [number, number, number];

const DEG = Math.PI / 180;
const FOV = 38 * DEG;
const TAN_HALF = Math.tan(FOV / 2);
/** Tip the Earth so the band in view sits around 45°N (Europe, the Gulf, India, China by night). */
const AXIAL_TILT = -15 * DEG;
/** Start over Central Asia; the planet turns eastward, so the view drifts west. */
const SPIN_START = 92 * DEG;
const SPIN_RATE = 2.2 * DEG; // per second
/** The day starts at dawn: light sweeping up from the bottom of the frame. */
const THETA_START = 318;
const INTRO_S = 3.4;
const REDUCED_RATE = 0.3;
/** The patch of Earth the telemetry describes (between the bottom of the frame and the limb). */
const VIEW_NORMAL: Vec3 = [0, 0.5, 0.8660254];
/** Share of the word's cap height hidden behind the planet. */
const WORD_FOOT = 0.24;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const rotY = (v: Vec3, a: number): Vec3 => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];

/** Camera distance (Earth radii), where the top of the limb sits (-1 bottom .. 1 top), and the word's size and place. */
function framing(aspect: number) {
  return aspect < 0.9
    ? { distance: 1.26, limbY: 0.26, wordSize: 0.29, wordLeft: -1 } // -1: centred
    : { distance: 1.32, limbY: -0.2, wordSize: 0.172, wordLeft: 0.43 };
}
const restPitch = (distance: number, limbY: number) => Math.asin(1 / distance) - Math.atan(limbY * TAN_HALF);

function basis(pitch: number, yaw: number, roll: number) {
  const f = rotY([0, Math.sin(pitch), -Math.cos(pitch)], yaw);
  const u = rotY([0, Math.cos(pitch), Math.sin(pitch)], yaw);
  const r = rotY([1, 0, 0], yaw);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  return {
    f,
    r: [r[0] * cr + u[0] * sr, r[1] * cr + u[1] * sr, r[2] * cr + u[2] * sr] as Vec3,
    u: [u[0] * cr - r[0] * sr, u[1] * cr - r[1] * sr, u[2] * cr - r[2] * sr] as Vec3,
  };
}
const sunAt = (thetaDeg: number, yaw: number): Vec3 => {
  const th = thetaDeg * DEG;
  return [Math.cos(th) * Math.sin(yaw), Math.sin(th), Math.cos(th) * Math.cos(yaw)];
};

/** The moment the sun's centre meets the limb, for a given tilt of its path: its angle and screen position. */
function sunContact(yaw: number, distance: number, pitch: number) {
  const k = Math.sqrt(1 - 1 / (distance * distance)) / Math.cos(yaw);
  if (k >= 1) return null;
  const theta = Math.acos(-k) / DEG;
  const s = sunAt(theta, yaw);
  const b = basis(pitch, 0, 0);
  const z = dot(s, b.f);
  return { theta, x: dot(s, b.r) / z / TAN_HALF, y: dot(s, b.u) / z / TAN_HALF };
}
/** Tilt the sun's path so it sets exactly at screen x (bisection: x falls as the tilt grows). */
function solveSunYaw(targetX: number, distance: number, pitch: number) {
  let lo = -40 * DEG;
  let hi = 40 * DEG;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const c = sunContact(mid, distance, pitch);
    if (!c || c.x < targetX) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The day's pace, as the sun's angle θ goes round (0 = behind the camera,
 * 90 = overhead, `set` = on the limb, 270 = under the Earth). Quick through
 * the bright day, slow while the sun is in the sky and setting, steady through
 * the night, brisk through dawn. Speeds in degrees/second.
 */
function paceKeys(enter: number, set: number): [number, number][] {
  return [
    [0, 18],
    [enter - 16, 18],
    [enter, 3.2],
    [set, 2.2],
    [set + 18, 3.6],
    [set + 40, 9],
    [255, 9],
    [300, 14],
    [360, 18],
  ];
}
function paceAt(keys: [number, number][], theta: number) {
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    const [t0, v0] = keys[i - 1];
    if (theta <= t1) return v0 + (v1 - v0) * smoothstep(t0, t1, theta);
  }
  return keys[keys.length - 1][1];
}

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader error");
  return shader;
}

async function loadBitmap(url: string, signal: AbortSignal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return createImageBitmap(await res.blob(), { imageOrientation: "none", premultiplyAlpha: "none", colorSpaceConversion: "none" });
}

/**
 * The top of the Earth, lit by a sun that runs a full day, with a giant word
 * standing behind the planet: dawn sweeping up the frame, bright day, the sun
 * sinking into view and setting on the limb inside the word's O, dusk, city
 * lights through the night, dawn again. The planet turns the whole time.
 * WebGL2, NASA imagery (Blue Marble, Black Marble, cloud cover); paused while
 * off screen. `anchorRef` is kept pinned to the word's top-left corner.
 */
export function EarthHorizon({
  className = "",
  word = "ORBIT",
  onTelemetry,
  onLayout,
  anchorRef,
}: {
  className?: string;
  word?: string;
  onTelemetry?: (t: EarthTelemetry) => void;
  onLayout?: (l: WordLayout) => void;
  anchorRef?: RefObject<HTMLElement | null>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const callbacks = useRef({ onTelemetry, onLayout });
  useEffect(() => {
    callbacks.current = { onTelemetry, onLayout };
  }, [onTelemetry, onLayout]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "high-performance" });
    if (!gl) {
      wrap.dataset.fallback = "true";
      return;
    }

    let program: WebGLProgram;
    try {
      program = gl.createProgram()!;
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
      gl.bindAttribLocation(program, 0, "aPos");
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link error");
    } catch (err) {
      console.warn("Earth shader unavailable:", err);
      wrap.dataset.fallback = "true";
      return;
    }
    gl.useProgram(program);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const names = [
      "uRes", "uCamPos", "uCamR", "uCamU", "uCamF", "uRestR", "uRestU", "uRestF", "uTanHalf", "uSun", "uEarth", "uCloudShift",
      "uDay", "uNight", "uClouds", "uWord", "uTex", "uWordOn", "uWordRise", "uWordDrop", "uExposure", "uTime", "uSunScreen",
      "uSunVis", "uSunAlt", "uStars", "uDayness",
    ] as const;
    const u = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)])) as Record<(typeof names)[number], WebGLUniformLocation | null>;
    gl.uniform1i(u.uDay, 0);
    gl.uniform1i(u.uNight, 1);
    gl.uniform1i(u.uClouds, 2);
    gl.uniform1i(u.uWord, 3);
    gl.uniform1f(u.uTanHalf, TAN_HALF);

    // ── Imagery: 4K on large screens (city lights at 8K when the GPU allows),
    // 2K otherwise. Uploaded one texture per frame so the intro never hitches.
    const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const large = Math.max(window.innerWidth, window.innerHeight) * dpr >= 1600;
    const tier = large && maxTex >= 4096 ? "4k" : "2k";
    const nightTier = large && maxTex >= 8192 ? "8k" : tier;
    const textures: WebGLTexture[] = [];
    const pending: { unit: number; bitmap: ImageBitmap; mono: boolean }[] = [];
    let uploaded = 0;
    const abort = new AbortController();
    const sources = [
      { unit: 0, url: `/login/earth-day-${tier}.webp`, mono: false },
      { unit: 1, url: `/login/earth-night-${nightTier}.webp`, mono: true },
      { unit: 2, url: `/login/earth-clouds-${tier}.webp`, mono: true },
    ];
    for (const s of sources) {
      loadBitmap(s.url, abort.signal)
        .then((bitmap) => pending.push({ unit: s.unit, bitmap, mono: s.mono }))
        .catch((err) => {
          if (!abort.signal.aborted) console.warn("Earth imagery:", err);
        });
    }
    const params = (mip: boolean) => {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, mip ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    };
    const upload = ({ unit, bitmap, mono }: (typeof pending)[number]) => {
      const tex = gl.createTexture()!;
      textures.push(tex);
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      if (mono) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, bitmap);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, bitmap);
      gl.generateMipmap(gl.TEXTURE_2D);
      params(true);
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      bitmap.close();
      uploaded++;
    };

    // ── The word: drawn in the site's display face into its own texture, laid
    // out so the sun sets inside its O (the sun's path is tilted to meet it).
    const wordTex = gl.createTexture()!;
    textures.push(wordTex);
    const wordCanvas = document.createElement("canvas");
    const wctx = wordCanvas.getContext("2d")!;
    const family = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-sans").trim() || "system-ui, sans-serif";
    let fontReady = false;
    let layoutDirty = true;
    document.fonts
      .load(`700 100px ${family}`)
      .catch(() => undefined)
      .then(() => {
        fontReady = true;
        layoutDirty = true;
      });
    let wordOn = 0;
    let sunYaw = 0;
    let thetaSet = 131;
    let wordDrop = 0;
    let anchorRest: [number, number] = [0, 0]; // the word's top-left in the resting view (p units)
    const layoutWord = () => {
      layoutDirty = false;
      const W = canvas.width;
      const H = canvas.height;
      const fr = framing(W / H);
      const pitch = restPitch(fr.distance, fr.limbY);
      const rest = basis(pitch, 0, 0);
      const rho = Math.sqrt(1 - 1 / (fr.distance * fr.distance));
      // The limb's height (canvas px from the top) at canvas x: bisect along the
      // circle of tangent points, projected through the resting camera.
      const limbAt = (x: number) => {
        const target = (2 * x - W) / H;
        let lo = -Math.PI / 2 + 1e-3;
        let hi = Math.PI / 2 - 1e-3;
        let y = 0;
        for (let i = 0; i < 36; i++) {
          const mid = (lo + hi) / 2;
          const d: Vec3 = [rho * Math.sin(mid), rho * Math.cos(mid), 1 / fr.distance - fr.distance];
          const z = dot(d, rest.f);
          y = dot(d, rest.u) / z / TAN_HALF;
          if (dot(d, rest.r) / z / TAN_HALF < target) lo = mid;
          else hi = mid;
        }
        return (H * (1 - y)) / 2;
      };

      const size = fr.wordSize * W;
      const spacing = -0.045 * size;
      wordCanvas.width = W;
      wordCanvas.height = H;
      wctx.font = `700 ${size}px ${family}`;
      wctx.textBaseline = "alphabetic";
      const glyphs = [...word].map((ch) => ({ ch, m: wctx.measureText(ch) }));
      const width = glyphs.reduce((sum, g) => sum + g.m.width + spacing, -spacing);
      const left = fr.wordLeft < 0 ? (W - width) / 2 : fr.wordLeft * W;
      const first = glyphs[0].m;
      const capH = first.actualBoundingBoxAscent;
      // The sun's path is tilted so it sets on the limb at the O's centre.
      sunYaw = solveSunYaw((2 * (left + (first.actualBoundingBoxRight - first.actualBoundingBoxLeft) / 2) - W) / H, fr.distance, pitch);
      thetaSet = sunContact(sunYaw, fr.distance, pitch)?.theta ?? 131;
      wordDrop = capH * 1.05;

      // Each letter stands on the curve of the Earth: its foot a fixed share
      // below the limb, tilted to the horizon's slope. Black ground, white
      // letters: R is coverage; G carries light from above.
      wctx.fillStyle = "#000";
      wctx.fillRect(0, 0, W, H);
      let x = left;
      for (const g of glyphs) {
        const cx = x + (g.m.actualBoundingBoxRight - g.m.actualBoundingBoxLeft) / 2;
        const ly = limbAt(cx);
        const slope = (limbAt(cx + 4) - limbAt(cx - 4)) / 8;
        wctx.save();
        wctx.translate(cx, ly);
        wctx.rotate(Math.atan(slope));
        const grad = wctx.createLinearGradient(0, -capH * (1 - WORD_FOOT), 0, capH * WORD_FOOT);
        grad.addColorStop(0, "rgb(255,255,0)");
        grad.addColorStop(1, "rgb(255,110,0)");
        wctx.fillStyle = grad;
        wctx.fillText(g.ch, x - cx, capH * WORD_FOOT);
        wctx.restore();
        x += g.m.width + spacing;
      }
      // "Back in" hangs over the second letter, clear of the sun's path into the O.
      const bx = left + first.width + spacing;
      const top = limbAt(bx) - capH * (1 - WORD_FOOT);
      anchorRest = [(2 * bx - W) / H, (H - 2 * top) / H];

      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, wordTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, gl.RG, gl.UNSIGNED_BYTE, wordCanvas);
      params(false);
      wordOn = fontReady ? 1 : 0;
      const css = canvas.clientWidth / W;
      callbacks.current.onLayout?.({ left: bx * css, top: top * css, capHeight: capH * css });
    };

    // ── Resolution: device pixels up to 1.5×, stepped down if frames run long.
    let scale = Math.min(dpr, window.innerWidth < 800 ? 1.75 : 1.5);
    const resize = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth * scale));
      const h = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        layoutDirty = true;
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    // ── Pointer: the view banks a touch toward the cursor.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    let tx = 0;
    let ty = 0;
    const onPointer = (e: PointerEvent) => {
      if (!finePointer.matches || reduce.matches) return;
      tx = (e.clientX / window.innerWidth) * 2 - 1;
      ty = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    // ── The clock.
    let theta = THETA_START;
    let spin = SPIN_START;
    let time = 0;
    let started = 0; // seconds since the imagery arrived (or we gave up waiting)
    let texFade = 0;
    let mx = 0;
    let my = 0;
    let last = performance.now();
    let sinceTelemetry = 1;
    let slowFrames = 0;
    let ema = 1 / 60;
    let anchorShift = "";
    const startedAt = performance.now();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (pending.length) upload(pending.shift()!);
      const ready = uploaded === sources.length;
      if (!started && !ready && now - startedAt < 5000) return; // black until the imagery is in (or 5 s)
      if (layoutDirty) layoutWord();
      started += dt;
      if (ready) texFade = Math.min(1, texFade + dt / 0.8);

      const rate = reduce.matches ? REDUCED_RATE : 1;
      const aspect = canvas.width / canvas.height;
      const { distance, limbY } = framing(aspect);
      const basePitch = restPitch(distance, limbY);
      const keys = paceKeys(180 - (basePitch / DEG + FOV / 2 / DEG), thetaSet);

      time += dt;
      theta = (theta + paceAt(keys, theta) * dt * rate) % 360;
      spin -= SPIN_RATE * dt * rate;
      const k = 1 - Math.exp(-dt * 2.5);
      mx += (tx - mx) * k;
      my += (ty - my) * k;

      // Camera: an Earthrise as the page opens, then the slight bank to the pointer.
      const intro = reduce.matches ? 1 : easeOutCubic(Math.min(1, started / INTRO_S));
      const cam = basis(basePitch + (1 - intro) * 9 * DEG - my * 0.5 * DEG, mx * 1.4 * DEG, -mx * 0.9 * DEG);
      const rest = basis(basePitch, 0, 0);
      const camPos: Vec3 = [0, 0, distance];

      const sun = sunAt(theta, sunYaw);
      const zc = dot(sun, cam.f);
      const sunScreen = zc > 0.05 ? [dot(sun, cam.r) / zc / TAN_HALF, dot(sun, cam.u) / zc / TAN_HALF] : [0, 10];
      const bS = dot(camPos, sun);
      const sunAlt = bS < 0 ? Math.sqrt(Math.max(distance * distance - bS * bS, 0)) - 1 : distance - 1;
      const sunVis = smoothstep(-0.006, 0.006, sunAlt) * smoothstep(0.05, 0.3, zc);

      // Exposure adapts: brighter by night so the cities read, calmer by day.
      const light = dot(VIEW_NORMAL, sun);
      const dayness = smoothstep(-0.3, 0.4, light);
      const fade = reduce.matches ? Math.min(1, started / 1.2) : easeOutCubic(Math.min(1, started / 2.6));
      const exposure = fade * (1.6 - 0.6 * dayness);
      const rise = reduce.matches ? 1 : easeOutCubic(Math.min(1, Math.max(0, (started - 0.9) / 2.4)));

      // World -> Earth-fixed: tilt about x, then spin about the axis.
      const ct = Math.cos(AXIAL_TILT);
      const st = Math.sin(AXIAL_TILT);
      const cs = Math.cos(spin);
      const ss = Math.sin(spin);
      // Rows of Ry(spin)·Rx(tilt); uploaded column-major.
      const m = [cs, ss * st, ss * ct, 0, ct, -st, -ss, cs * st, cs * ct];

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform3fv(u.uCamPos, camPos);
      gl.uniform3fv(u.uCamR, cam.r);
      gl.uniform3fv(u.uCamU, cam.u);
      gl.uniform3fv(u.uCamF, cam.f);
      gl.uniform3fv(u.uRestR, rest.r);
      gl.uniform3fv(u.uRestU, rest.u);
      gl.uniform3fv(u.uRestF, rest.f);
      gl.uniform3fv(u.uSun, sun);
      gl.uniformMatrix3fv(u.uEarth, false, [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
      gl.uniform1f(u.uCloudShift, -time * 0.0011);
      gl.uniform1f(u.uTex, texFade);
      gl.uniform1f(u.uWordOn, wordOn);
      gl.uniform1f(u.uWordRise, rise);
      gl.uniform1f(u.uWordDrop, wordDrop);
      gl.uniform1f(u.uExposure, exposure);
      gl.uniform1f(u.uTime, time);
      gl.uniform2f(u.uSunScreen, sunScreen[0], sunScreen[1]);
      gl.uniform1f(u.uSunVis, sunVis);
      gl.uniform1f(u.uSunAlt, sunAlt);
      // The brightest stars stay faintly visible even by day; night brings the rest.
      gl.uniform1f(u.uStars, Math.max(0.14, Math.pow(1 - dayness, 1.5)) * (1 - 0.6 * sunVis));
      gl.uniform1f(u.uDayness, dayness);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Keep the anchor (the "Back in" line) on the word as the view banks.
      const anchor = anchorRef?.current;
      if (anchor) {
        const [ax, ay] = anchorRest;
        const d: Vec3 = [
          rest.r[0] * ax * TAN_HALF + rest.u[0] * ay * TAN_HALF + rest.f[0],
          rest.r[1] * ax * TAN_HALF + rest.u[1] * ay * TAN_HALF + rest.f[1],
          rest.r[2] * ax * TAN_HALF + rest.u[2] * ay * TAN_HALF + rest.f[2],
        ];
        const z = dot(d, cam.f);
        const half = canvas.clientHeight / 2;
        const sx = (dot(d, cam.r) / z / TAN_HALF - ax) * half;
        const sy = -(dot(d, cam.u) / z / TAN_HALF - ay) * half;
        const shift = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`;
        if (shift !== anchorShift) {
          anchorShift = shift;
          anchor.style.transform = shift;
        }
      }

      // Telemetry for the HUD, five times a second.
      sinceTelemetry += dt;
      const report = callbacks.current.onTelemetry;
      if (report && sinceTelemetry >= 0.2) {
        sinceTelemetry = 0;
        const e: Vec3 = [dot([m[0], m[1], m[2]], VIEW_NORMAL), dot([m[3], m[4], m[5]], VIEW_NORMAL), dot([m[6], m[7], m[8]], VIEW_NORMAL)];
        const lon = Math.atan2(e[0], e[2]);
        // Local time follows the sun over the patch in view: noon at its highest.
        const noon = Math.atan2(VIEW_NORMAL[1], VIEW_NORMAL[2] * Math.cos(sunYaw)) / DEG;
        const hours = (((12 + (theta - noon) / 15) % 24) + 24) % 24;
        const elevation = Math.asin(Math.max(-1, Math.min(1, light))) / DEG;
        const rising = theta >= noon + 180 || theta < noon;
        const phase: EarthTelemetry["phase"] =
          elevation > 14 ? "Daylight" : elevation > 0 ? (rising ? "Morning" : "Golden hour") : elevation > -9 ? (rising ? "Dawn" : "Sunset") : "Orbital night";
        report({
          sunElevation: elevation,
          phase,
          lat: Math.asin(e[1]) / DEG,
          lon: ((((lon / DEG + 180) % 360) + 360) % 360) - 180,
          localTime: `${String(Math.floor(hours)).padStart(2, "0")}:${String(Math.floor((hours % 1) * 60)).padStart(2, "0")}`,
        });
      }

      // Governor: if frames run long for a while, render fewer pixels.
      ema += (dt - ema) * 0.05;
      slowFrames = ema > 1 / 45 ? slowFrames + 1 : 0;
      if (slowFrames > 90 && scale > 0.6) {
        scale = Math.max(0.6, scale * 0.8);
        slowFrames = 0;
        resize();
      }
    };

    let raf = 0;
    let visible = true;
    const io = new IntersectionObserver(([entry]) => {
      const now = entry.isIntersecting;
      if (now === visible) return;
      visible = now;
      cancelAnimationFrame(raf);
      if (visible) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    });
    io.observe(canvas);
    raf = requestAnimationFrame(frame);

    const onLost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      wrap.dataset.fallback = "true";
    };
    canvas.addEventListener("webglcontextlost", onLost);

    return () => {
      cancelAnimationFrame(raf);
      abort.abort();
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", onPointer);
      canvas.removeEventListener("webglcontextlost", onLost);
      pending.forEach((p) => p.bitmap.close());
      textures.forEach((t) => gl.deleteTexture(t));
      gl.deleteBuffer(vbo);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    };
  }, [word, anchorRef]);

  return (
    <div ref={wrapRef} className={`earth-horizon ${className}`} aria-hidden>
      <canvas ref={canvasRef} className="earth-canvas" />
      <div className="earth-fallback" />
    </div>
  );
}
