import { buildJet, JET_LENGTH, JET_SPAN, LIGHTS } from "./jetGeometry";
import { add, basisMatrix, bezier, bezierD1, bezierD2, clamp, cross, dot, length, normalize, perspective, scale, smoothstep, sub, transformPoint, type V3 } from "./math";
import { EDGE_FS, EDGE_VS, FULL_VS, GLOW_FS, GLOW_VS, JET_FS, JET_VS, SHADOW_FS, SIL_FS } from "./shaders";

/** Seconds the jet takes along its path (it is off screen a little before the end). */
export const FLY = 1.5;
/** Seconds of the whole transition: the climb, then the wake spreading to the edges. */
export const DURATION = 2.35;

const FOV = (40 * Math.PI) / 180;
const TAN_H = Math.tan(FOV / 2);
/** Towards the sun, camera space: high, over the viewer's left shoulder. */
const SUN = normalize([-0.38, 0.62, 0.69]);
/** Where the wake is born: the wingtips (model space, right side). */
const WINGTIP: V3 = [31.0, 2.6, -14.0];
/** Samples along each edge of the wake (the clip polygon has twice this many points). */
const WAKE_SAMPLES = 40;
const MAX_GLOWS = 9;
const SHADOW_SCALE = 0.25;
/** Looking straight down on the jet, camera space already has the sky along +z. */
const ENV = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

type Pt = [number, number];
export type Wake = { a: Pt[]; b: Pt[] };
export type FlightEngine = {
  status(): "pending" | "ready" | "failed";
  /**
   * Lays out the wake for the whole transition and returns it as clip-path
   * keyframes (CSS px, viewport space) for the new page. The engine keeps the
   * same keyframes to draw the wake's edges, so line and clip always agree.
   */
  plan(frames: number): string[];
  render(t: number): void;
  dispose(): void;
};

/**
 * The flight in one WebGL2 canvas: a PBR airliner flying a banked S-curve up
 * and away from the camera, its soft shadow on the pages below, its
 * navigation lights and strobes, and the edges of its wake: the V it opens
 * behind the wingtips, through which the new page shows (the page itself is
 * clipped by the View Transitions API; this canvas draws the vortex
 * hairlines along the cut and the shade the cut edge casts).
 */
export function createFlightEngine(canvas: HTMLCanvasElement): FlightEngine | null {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: true, depth: true, stencil: false, powerPreference: "high-performance" });
  if (!gl) return null;
  const coarse = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768;
  const DPR = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 1.75);
  const parallel = gl.getExtension("KHR_parallel_shader_compile");

  // ------------------------------------------------------------ programs
  const shaders: WebGLShader[] = [];
  const make = (vs: string, fs: string, attribs: string[]) => {
    const p = gl.createProgram()!;
    for (const [type, src] of [
      [gl.VERTEX_SHADER, vs],
      [gl.FRAGMENT_SHADER, fs],
    ] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      gl.attachShader(p, s);
      shaders.push(s);
    }
    attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    return p;
  };
  const progs = {
    jet: make(JET_VS, JET_FS, ["aPos", "aNrm", "aUv", "aMat"]),
    sil: make(JET_VS, SIL_FS, ["aPos", "aNrm", "aUv", "aMat"]),
    shadow: make(FULL_VS, SHADOW_FS, ["aPos"]),
    glow: make(GLOW_VS, GLOW_FS, ["aPos", "aUv", "aColor"]),
    edge: make(EDGE_VS, EDGE_FS, ["aPos", "aColor"]),
  };
  type Uniforms = Record<string, WebGLUniformLocation | null>;
  const U: Record<keyof typeof progs, Uniforms> = { jet: {}, sil: {}, shadow: {}, glow: {}, edge: {} };
  let state: "pending" | "ready" | "failed" = "pending";
  const status = () => {
    if (state !== "pending") return state;
    const list = Object.values(progs);
    if (parallel && !list.every((p) => gl.getProgramParameter(p, parallel.COMPLETION_STATUS_KHR))) return state;
    if (!list.every((p) => gl.getProgramParameter(p, gl.LINK_STATUS))) {
      console.error("flight: shader link failed", shaders.map((s) => gl.getShaderInfoLog(s)).filter(Boolean));
      return (state = "failed");
    }
    const loc = (p: WebGLProgram, names: string[]) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
    U.jet = loc(progs.jet, ["uProj", "uModel", "uSun", "uEnv"]);
    U.sil = loc(progs.sil, ["uProj", "uModel"]);
    U.shadow = loc(progs.shadow, ["uTex", "uRes", "uLod", "uAlpha"]);
    return (state = "ready");
  };

  // ------------------------------------------------------------- buffers
  const buffers: WebGLBuffer[] = [];
  const vaos: WebGLVertexArrayObject[] = [];
  const staticAttr = (data: Float32Array, loc: number, size: number) => {
    const b = gl.createBuffer()!;
    buffers.push(b);
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  };
  const mesh = buildJet();
  const jetVao = gl.createVertexArray()!;
  vaos.push(jetVao);
  gl.bindVertexArray(jetVao);
  staticAttr(mesh.positions, 0, 3);
  staticAttr(mesh.normals, 1, 3);
  staticAttr(mesh.uvs, 2, 2);
  staticAttr(mesh.mats, 3, 1);
  const ibo = gl.createBuffer()!;
  buffers.push(ibo);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

  const dynamic = (floats: number, layout: [number, number][]) => {
    const vao = gl.createVertexArray()!;
    vaos.push(vao);
    gl.bindVertexArray(vao);
    const b = gl.createBuffer()!;
    buffers.push(b);
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, floats * 4, gl.DYNAMIC_DRAW);
    const stride = layout.reduce((s, [, n]) => s + n, 0) * 4;
    let off = 0;
    for (const [loc, n] of layout) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride, off);
      off += n * 4;
    }
    return { vao, buffer: b, data: new Float32Array(floats) };
  };
  const glow = dynamic(MAX_GLOWS * 6 * 8, [
    [0, 2],
    [1, 2],
    [2, 4],
  ]);
  // Per side: a shade strip and a two-strip hairline, 6 vertices a quad.
  const edge = dynamic(2 * 3 * (WAKE_SAMPLES - 1) * 6 * 6, [
    [0, 2],
    [1, 4],
  ]);
  const full = gl.createVertexArray()!;
  vaos.push(full);
  gl.bindVertexArray(full);
  staticAttr(new Float32Array([-1, -1, 3, -1, -1, 3]), 0, 2);
  gl.bindVertexArray(null);

  // Shadow target: the silhouette at quarter resolution, blurred through its mips.
  const shTex = gl.createTexture()!;
  const shFbo = gl.createFramebuffer()!;

  // --------------------------------------------------------- the camera
  let W = 0;
  let H = 0;
  let shW = 1;
  let shH = 1;
  let aspect = 1;
  let D0 = 230;
  let proj = perspective(FOV, 1, 5, 8000);
  let path: [V3, V3, V3, V3] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  let pathLen = 1;
  const toCam = (nx: number, ny: number, D: number): V3 => [nx * D * TAN_H * aspect, ny * D * TAN_H, -D];
  const project = (p: V3): Pt => {
    const inv = 1 / -p[2];
    return [((p[0] * inv) / (TAN_H * aspect) * 0.5 + 0.5) * W, (0.5 - ((p[1] * inv) / TAN_H) * 0.5) * H];
  };

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w === W && h === H) return;
    W = w;
    H = h;
    aspect = w / h;
    canvas.width = Math.round(w * DPR);
    canvas.height = Math.round(h * DPR);
    shW = Math.max(1, Math.round(w * SHADOW_SCALE));
    shH = Math.max(1, Math.round(h * SHADOW_SCALE));
    gl.bindTexture(gl.TEXTURE_2D, shTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, shW, shH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, shFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, shTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // The jet starts a quarter of the screen wide (more of it on a phone),
    // then recedes to under half that, climbing through a gentle S-turn.
    const frac = clamp(0.62 - (aspect - 0.46) * 0.33, 0.22, 0.62);
    D0 = JET_SPAN / (2 * TAN_H * aspect * frac);
    const D1 = D0 * 2.2;
    const hl0 = JET_LENGTH / 2 / (D0 * TAN_H);
    const hl1 = JET_LENGTH / 2 / (D1 * TAN_H);
    const narrow = aspect < 0.8;
    path = [
      toCam(narrow ? -0.04 : -0.12, -1 - hl0 * 1.2, D0),
      toCam(narrow ? -0.3 : -0.26, -0.35, D0 * 1.3),
      toCam(narrow ? 0.12 : 0.04, 0.45, D0 * 1.75),
      toCam(narrow ? 0.18 : 0.22, 1 + hl1 * 1.3 + 0.06, D1),
    ];
    pathLen = 0;
    let prev = path[0];
    for (let k = 1; k <= 32; k++) {
      const p = bezier(...path, k / 32);
      pathLen += length(sub(p, prev));
      prev = p;
    }
    proj = perspective(FOV, aspect, 5, 8000);
  };

  // The jet's pose at time t: on the path, heading along it, belly away
  // from the camera, banked into the turn.
  const model = new Float32Array(16);
  const pose = (t: number) => {
    const u = clamp(t / FLY, 0, 1);
    const s = u * (0.8 + 0.2 * u);
    const P = bezier(...path, s);
    const d1 = bezierD1(...path, s);
    const d2 = bezierD2(...path, s);
    const f = normalize(d1);
    const view = normalize(scale(P, -1));
    const up = normalize(sub(view, scale(f, dot(view, f))));
    // The model frame (x right, y up, z nose) is left-handed: right = forward x up.
    const r = cross(f, up);
    const bank = clamp((-dot(d2, r) / dot(d1, d1)) * pathLen * 0.55, -0.42, 0.42);
    const c = Math.cos(bank);
    const sn = Math.sin(bank);
    basisMatrix(add(scale(r, c), scale(up, sn)), sub(scale(up, c), scale(r, sn)), f, P, model);
    return P;
  };

  // ------------------------------------------------------------ the wake
  // Each edge is born at a wingtip and drifts outward as it ages (like the
  // vortices do); once the jet is gone the whole wake spreads to the edges.
  const wakeAt = (t: number): Wake => {
    const tMax = Math.min(t, FLY);
    const diag = Math.hypot(W, H);
    const spread = smoothstep(FLY - 0.05, DURATION, t);
    const extra = spread * spread * diag * 1.1;
    const a: Pt[] = [];
    const b: Pt[] = [];
    for (let k = 0; k < WAKE_SAMPLES; k++) {
      const tau = tMax * (k / (WAKE_SAMPLES - 1));
      pose(tau);
      const pa = project(transformPoint(model, [-WINGTIP[0], WINGTIP[1], WINGTIP[2]]));
      const pb = project(transformPoint(model, WINGTIP));
      const dx = pa[0] - pb[0];
      const dy = pa[1] - pb[1];
      const l = Math.hypot(dx, dy) || 1;
      const age = t - tau;
      const g = diag * (0.05 * age + 0.09 * age * age) + extra;
      a.push([pa[0] + (dx / l) * g, pa[1] + (dy / l) * g]);
      b.push([pb[0] - (dx / l) * g, pb[1] - (dy / l) * g]);
    }
    return { a, b };
  };
  let planned: Wake[] = [];
  const plan = (frames: number) => {
    resize();
    planned = [];
    const css: string[] = [];
    for (let i = 0; i < frames; i++) {
      const w = wakeAt((DURATION * i) / (frames - 1));
      planned.push(w);
      const pts = [...w.a, ...[...w.b].reverse()].map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`);
      css.push(`polygon(${pts.join(", ")})`);
    }
    return css;
  };
  // The wake at time t exactly as the browser draws the clip: linear between keyframes.
  const wakeNow = (t: number): Wake | null => {
    const n = planned.length;
    if (n < 2) return null;
    const x = clamp(t / DURATION, 0, 1) * (n - 1);
    const i = Math.min(n - 2, Math.floor(x));
    const f = x - i;
    const mix = (p: Pt[], q: Pt[]) => p.map(([px, py], k) => [px + (q[k][0] - px) * f, py + (q[k][1] - py) * f] as Pt);
    return { a: mix(planned[i].a, planned[i + 1].a), b: mix(planned[i].b, planned[i + 1].b) };
  };

  const drawEdges = (t: number) => {
    const w = wakeNow(t);
    if (!w) return;
    const d = edge.data;
    let o = 0;
    const nx = (x: number) => (x / W) * 2 - 1;
    const ny = (y: number) => 1 - (y / H) * 2;
    const vert = (x: number, y: number, r: number, g: number, bl: number, al: number) => {
      d[o++] = nx(x);
      d[o++] = ny(y);
      d[o++] = r * al;
      d[o++] = g * al;
      d[o++] = bl * al;
      d[o++] = al;
    };
    // A strip between two offset rows along the edge, each row with its own colour/alpha.
    const strip = (pts: Pt[], out: Pt[], off0: number, off1: number, col: V3, al0: (k: number) => number, al1: (k: number) => number) => {
      for (let k = 0; k < pts.length - 1; k++) {
        const q = [k, k + 1];
        const row = (kk: number, off: number): Pt => [pts[kk][0] + out[kk][0] * off, pts[kk][1] + out[kk][1] * off];
        const [a0, b0] = q.map((kk) => row(kk, off0));
        const [a1, b1] = q.map((kk) => row(kk, off1));
        const A0 = al0(k);
        const B0 = al0(k + 1);
        const A1 = al1(k);
        const B1 = al1(k + 1);
        vert(a0[0], a0[1], ...col, A0);
        vert(b0[0], b0[1], ...col, B0);
        vert(a1[0], a1[1], ...col, A1);
        vert(a1[0], a1[1], ...col, A1);
        vert(b0[0], b0[1], ...col, B0);
        vert(b1[0], b1[1], ...col, B1);
      }
    };
    const tMax = Math.min(t, FLY);
    const age = (k: number) => t - tMax * (k / (WAKE_SAMPLES - 1));
    for (const [pts, other] of [
      [w.a, w.b],
      [w.b, w.a],
    ] as const) {
      const out: Pt[] = pts.map((p, k) => {
        const dx = p[0] - other[k][0];
        const dy = p[1] - other[k][1];
        const l = Math.hypot(dx, dy) || 1;
        return [dx / l, dy / l];
      });
      // The cut edge's shade falling onto the new page, inside the wake.
      const shade = (k: number) => 0.46 * smoothstep(0, 0.14, age(k));
      strip(pts, out, 0, -34, [0, 0, 0], shade, () => 0);
      // The vortex hairline, bright where it is fresh.
      const hair = (k: number) => 0.75 * Math.exp(-age(k) * 1.5) * smoothstep(0, 0.05, age(k));
      strip(pts, out, -1.1, 0, [1, 1, 1], () => 0, hair);
      strip(pts, out, 0, 1.1, [1, 1, 1], hair, () => 0);
    }
    gl.useProgram(progs.edge);
    gl.bindVertexArray(edge.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, edge.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, o);
    gl.drawArrays(gl.TRIANGLES, 0, o / 6);
  };

  // ------------------------------------------------ navigation lights
  const drawGlows = (t: number) => {
    let o = 0;
    let count = 0;
    const put = (m: V3, rgb: V3, sizePx: number, streak: number) => {
      if (count >= MAX_GLOWS || rgb[0] + rgb[1] + rgb[2] < 0.01) return;
      const p = transformPoint(model, m);
      const [x, y] = project(p);
      const size = sizePx * (D0 / -p[2]);
      const cx = (x / W) * 2 - 1;
      const cy = 1 - (y / H) * 2;
      const sx = (size / W) * 2;
      const sy = (size / H) * 2;
      for (const [u, v] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ]) {
        glow.data.set([cx + u * sx, cy + v * sy, u, v, rgb[0], rgb[1], rgb[2], streak], o);
        o += 8;
      }
      count++;
    };
    const mirror = (m: V3): V3 => [-m[0], m[1], m[2]];
    const ph = t % 1.05;
    const strobe = ph < 0.045 || (ph > 0.12 && ph < 0.165) ? 3.2 : 0;
    const beacon = Math.exp(-((t + 0.4) % 1.2) * 11) * 2.4;
    put(LIGHTS.navRight, [0.12, 1.1, 0.5], 16, 0);
    put(mirror(LIGHTS.navRight), [1.2, 0.14, 0.1], 16, 0);
    put(LIGHTS.tail, [0.9, 0.9, 0.9], 12, 0);
    put(LIGHTS.beacon, [beacon, beacon * 0.14, beacon * 0.1], 36, 0);
    put(LIGHTS.strobeRight, [strobe, strobe, strobe], 44, 0.55);
    put(mirror(LIGHTS.strobeRight), [strobe, strobe, strobe], 44, 0.55);
    put(LIGHTS.tail, [strobe * 0.8, strobe * 0.8, strobe * 0.8], 32, 0.4);
    if (!count) return;
    gl.useProgram(progs.glow);
    gl.bindVertexArray(glow.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, glow.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, glow.data, 0, o);
    gl.drawArrays(gl.TRIANGLES, 0, count * 6);
  };

  // ------------------------------------------------------------- frame
  const shadowModel = new Float32Array(16);
  const render = (t: number) => {
    if (state !== "ready") return;
    resize();
    const flying = t < FLY;
    const P = pose(Math.min(t, FLY));

    // The silhouette for the shadow, offset down and to the right (away
    // from the sun) and a little further away, as if on the page below.
    if (flying) {
      shadowModel.set(model);
      const k = D0 / -P[2];
      shadowModel[12] += 0.075 * -P[2] * TAN_H * aspect * k * 0.9;
      shadowModel[13] -= 0.1 * -P[2] * TAN_H * k * 0.9;
      gl.bindFramebuffer(gl.FRAMEBUFFER, shFbo);
      gl.viewport(0, 0, shW, shH);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(progs.sil);
      gl.uniformMatrix4fv(U.sil.uProj, false, proj);
      gl.uniformMatrix4fv(U.sil.uModel, false, shadowModel);
      gl.bindVertexArray(jetVao);
      gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_INT, 0);
      gl.bindTexture(gl.TEXTURE_2D, shTex);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    drawEdges(t);
    if (!flying) return;

    gl.useProgram(progs.shadow);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, shTex);
    gl.uniform1i(U.shadow.uTex, 0);
    gl.uniform2f(U.shadow.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.shadow.uLod, coarse ? 1.4 : 1.8);
    gl.uniform1f(U.shadow.uAlpha, 0.3);
    gl.bindVertexArray(full);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.useProgram(progs.jet);
    gl.uniformMatrix4fv(U.jet.uProj, false, proj);
    gl.uniformMatrix4fv(U.jet.uModel, false, model);
    gl.uniform3f(U.jet.uSun, SUN[0], SUN[1], SUN[2]);
    gl.uniformMatrix3fv(U.jet.uEnv, false, ENV);
    gl.bindVertexArray(jetVao);
    gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_INT, 0);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    drawGlows(t);
  };

  const dispose = () => {
    buffers.forEach((b) => gl.deleteBuffer(b));
    vaos.forEach((v) => gl.deleteVertexArray(v));
    Object.values(progs).forEach((p) => gl.deleteProgram(p));
    shaders.forEach((s) => gl.deleteShader(s));
    gl.deleteTexture(shTex);
    gl.deleteFramebuffer(shFbo);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };

  return { status, plan, render, dispose };
}
