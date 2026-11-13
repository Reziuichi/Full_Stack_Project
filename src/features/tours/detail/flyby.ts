import { buildJet, EXHAUST, JET_LENGTH, LIGHTS } from "@/components/transitions/flight/jetGeometry";
import { add, basisMatrix, clamp, cross, dot, noise1, normalize, perspective, scale, smoothstep, sub, transformPoint, type V3 } from "@/components/transitions/flight/math";
import { EDGE_FS, EDGE_VS, GLOW_FS, GLOW_VS, JET_FS, JET_VS } from "@/components/transitions/flight/shaders";

type Pt = [number, number];
export type Wake = { top: Pt[]; bottom: Pt[]; age: number[] };

const FOV = (30 * Math.PI) / 180;
const TAN_H = Math.tan(FOV / 2);
/** Towards the sun, camera space (y up): high, ahead and over the left shoulder. */
const SUN = normalize([-0.42, 0.78, 0.46]);
/** Camera space (y up) to the sky's frame (z up), column-major. */
const ENV = new Float32Array([1, 0, 0, 0, 0, 1, 0, -1, 0]);
/** Banked a little towards the camera, so the top of the wings catches the light. */
const BANK = -0.3;
const SAMPLES = 40;
const MAX_GLOWS = 7;

/**
 * The flyby's path, in one place so the page and the renderer agree: the
 * jet crosses the stage left to right on a straight, slightly climbing line,
 * coming a little closer as it goes, and the wake it leaves (a wedge between
 * two contrails, narrow at the engines and wider the older it gets) is laid
 * out in stage pixels, ready to clip the photo that shows through it.
 */
export function createFlightPath() {
  let W = 1;
  let H = 1;
  let aspect = 1;
  let D = 100;
  let P0: V3 = [0, 0, 0];
  let P1: V3 = [0, 0, 0];
  let f: V3 = [1, 0, 0];
  let r: V3 = [0, 0, 1];
  let u: V3 = [0, 1, 0];
  const model = new Float32Array(16);

  const resize = (w: number, h: number) => {
    W = Math.max(1, w);
    H = Math.max(1, h);
    aspect = W / H;
    // The jet's length as a share of the stage's width: big on a phone.
    const frac = aspect < 1 ? 0.84 : clamp(0.34 + (aspect - 1.2) * 0.12, 0.34, 0.46);
    D = JET_LENGTH / (frac * 2 * TAN_H * aspect);
    const zA = -D * 1.28;
    const zB = -D * 0.84;
    const half = (z: number) => -z * TAN_H * aspect;
    const yAt = (z: number, sy: number) => (0.5 - sy) * 2 * TAN_H * -z;
    const lineA = aspect < 1 ? 0.6 : 0.64;
    const lineB = aspect < 1 ? 0.5 : 0.5;
    P0 = [-(half(zA) + JET_LENGTH * 0.66), yAt(zA, lineA), zA];
    P1 = [half(zB) + JET_LENGTH * 0.66, yAt(zB, lineB), zB];
    f = normalize(sub(P1, P0));
    const up0: V3 = [0, 1, 0];
    const up = normalize(sub(up0, scale(f, dot(up0, f))));
    // The model frame (x right wing, y up, z nose) is left-handed: right = forward x up.
    const right = cross(f, up);
    const c = Math.cos(BANK);
    const s = Math.sin(BANK);
    r = add(scale(right, c), scale(up, s));
    u = sub(scale(up, c), scale(right, s));
  };

  /** Places the jet at progress t (0: just off the left edge, 1: just off the right). */
  const pose = (t: number) => {
    const P = add(P0, scale(sub(P1, P0), t));
    basisMatrix(r, u, f, P, model);
    return P;
  };

  const project = (p: V3): Pt => {
    const inv = 1 / -p[2];
    return [((p[0] * inv) / (TAN_H * aspect)) * 0.5 * W + W * 0.5, (0.5 - ((p[1] * inv) / TAN_H) * 0.5) * H];
  };

  /** The wake after the jet has flown to t, opened a further `spread` (0 to 1) towards the stage's edges. */
  const wake = (t: number, spread: number): Wake => {
    const top: Pt[] = [];
    const bottom: Pt[] = [];
    const age: number[] = [];
    const more = spread * spread * H * 1.15;
    for (let k = 0; k < SAMPLES; k++) {
      const tau = t * (k / (SAMPLES - 1));
      pose(tau);
      const a = project(transformPoint(model, EXHAUST));
      const b = project(transformPoint(model, [-EXHAUST[0], EXHAUST[1], EXHAUST[2]]));
      const x = (a[0] + b[0]) / 2;
      const y = (a[1] + b[1]) / 2;
      const old = t - tau;
      const h = Math.abs(a[1] - b[1]) / 2 + 3 + H * (0.006 + 0.46 * old ** 1.35) + more;
      // Contrails aren't ruled lines: each edge billows a little.
      const wob = H * 0.012 * (0.4 + old);
      top.push([x, y - h - wob * noise1(x / 70 + 3.1)]);
      bottom.push([x, y + h + wob * noise1(x / 64 + 11.7)]);
      age.push(old);
    }
    return { top, bottom, age };
  };

  const clip = (w: Wake) => {
    if (w.top.length < 2 || w.top[w.top.length - 1][0] <= w.top[0][0] + 0.5) return "polygon(0px 0px, 0px 0px, 0px 0px)";
    const pts = [...w.top, ...[...w.bottom].reverse()].map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`);
    return `polygon(${pts.join(", ")})`;
  };

  /** Two points on the line the jet flies along (the route drawn under it), stage pixels. */
  const route = (): [Pt, Pt] => {
    const at = (t: number) => {
      pose(t);
      return project(transformPoint(model, [0, EXHAUST[1], 0]));
    };
    return [at(0), at(1)];
  };

  /** The jet's nose and tail on screen at t, for the fallback airplane glyph. */
  const ends = (t: number): [Pt, Pt] => {
    pose(t);
    return [project(transformPoint(model, [0, 0, JET_LENGTH / 2])), project(transformPoint(model, [0, 0, -JET_LENGTH / 2]))];
  };

  return {
    resize,
    pose,
    project,
    wake,
    clip,
    route,
    ends,
    get model() {
      return model;
    },
    get size() {
      return { W, H, aspect, D };
    },
  };
}

export type FlightPath = ReturnType<typeof createFlightPath>;

/**
 * The same procedural airliner the destinations transition flies, drawn
 * side-on in one WebGL2 canvas over the stage: lit by a low sun with its
 * clear coat catching the sky, navigation lights and strobes blinking, and
 * the wake's edges drawn as vapour, a bright hairline where they're fresh
 * and a soft shade falling inside the cut.
 */
export function createFlyby(canvas: HTMLCanvasElement, path: FlightPath) {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: true, depth: true, stencil: false, powerPreference: "high-performance" });
  if (!gl) return null;
  const coarse = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768;
  const DPR = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 1.75);
  const parallel = gl.getExtension("KHR_parallel_shader_compile");

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
    glow: make(GLOW_VS, GLOW_FS, ["aPos", "aUv", "aColor"]),
    edge: make(EDGE_VS, EDGE_FS, ["aPos", "aColor"]),
  };
  let U: Record<string, WebGLUniformLocation | null> = {};
  let state: "pending" | "ready" | "failed" = "pending";
  const status = () => {
    if (state !== "pending") return state;
    const list = Object.values(progs);
    if (parallel && !list.every((p) => gl.getProgramParameter(p, parallel.COMPLETION_STATUS_KHR))) return state;
    if (!list.every((p) => gl.getProgramParameter(p, gl.LINK_STATUS))) {
      console.error("flyby: shader link failed", shaders.map((s) => gl.getShaderInfoLog(s)).filter(Boolean));
      return (state = "failed");
    }
    U = Object.fromEntries(["uProj", "uModel", "uSun", "uEnv"].map((n) => [n, gl.getUniformLocation(progs.jet, n)]));
    return (state = "ready");
  };

  const buffers: WebGLBuffer[] = [];
  const vaos: WebGLVertexArrayObject[] = [];
  const mesh = buildJet();
  const jetVao = gl.createVertexArray()!;
  vaos.push(jetVao);
  gl.bindVertexArray(jetVao);
  for (const [data, loc, size] of [
    [mesh.positions, 0, 3],
    [mesh.normals, 1, 3],
    [mesh.uvs, 2, 2],
    [mesh.mats, 3, 1],
  ] as const) {
    const b = gl.createBuffer()!;
    buffers.push(b);
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }
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
  // Per edge: vapour outside, a two-strip hairline, a shade inside; 6 vertices a quad.
  const edge = dynamic(2 * 4 * (SAMPLES - 1) * 6 * 6, [
    [0, 2],
    [1, 4],
  ]);
  gl.bindVertexArray(null);

  let proj = perspective(FOV, 1, 5, 8000);
  let cw = 0;
  let ch = 0;
  const fit = () => {
    const { W, H, aspect } = path.size;
    if (W === cw && H === ch) return;
    cw = W;
    ch = H;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    proj = perspective(FOV, aspect, 5, 8000);
  };

  const drawEdges = (w: Wake, spread: number) => {
    const { W, H } = path.size;
    const d = edge.data;
    let o = 0;
    const vert = (x: number, y: number, c: number, al: number) => {
      d[o++] = (x / W) * 2 - 1;
      d[o++] = 1 - (y / H) * 2;
      d[o++] = c * al;
      d[o++] = c * al;
      d[o++] = c * al;
      d[o++] = al;
    };
    // A strip along the edge between two vertical offsets, each row with its own alpha.
    const strip = (pts: Pt[], off0: (k: number) => number, off1: (k: number) => number, c: number, al0: (k: number) => number, al1: (k: number) => number) => {
      for (let k = 0; k < pts.length - 1; k++) {
        const x0 = pts[k][0];
        const x1 = pts[k + 1][0];
        const a0 = pts[k][1] + off0(k);
        const b0 = pts[k + 1][1] + off0(k + 1);
        const a1 = pts[k][1] + off1(k);
        const b1 = pts[k + 1][1] + off1(k + 1);
        vert(x0, a0, c, al0(k));
        vert(x1, b0, c, al0(k + 1));
        vert(x0, a1, c, al1(k));
        vert(x0, a1, c, al1(k));
        vert(x1, b0, c, al0(k + 1));
        vert(x1, b1, c, al1(k + 1));
      }
    };
    const fade = 1 - smoothstep(0.25, 0.85, spread);
    const zero = () => 0;
    for (const [pts, out] of [
      [w.top, -1],
      [w.bottom, 1],
    ] as const) {
      const age = (k: number) => w.age[k];
      const fresh = (k: number) => smoothstep(0, 0.018, age(k));
      // Vapour billowing out into the sky, wider and fainter as it ages.
      const puff = (k: number) => out * (10 + 70 * age(k)) * (0.7 + 0.6 * noise1(pts[k][0] / 55 + (out > 0 ? 7 : 0)));
      strip(pts, zero, puff, 1, (k) => (0.12 + 0.3 * Math.exp(-age(k) * 2.2)) * fresh(k) * fade, zero);
      // The hairline, bright where it's fresh.
      const hair = (k: number) => (0.25 + 0.7 * Math.exp(-age(k) * 3)) * fresh(k) * fade;
      strip(pts, () => -out * 1.2, zero, 1, zero, hair);
      strip(pts, zero, () => out * 1.2, 1, hair, zero);
      // The cut's shade on the photo, inside the wake.
      strip(pts, zero, () => -out * 34, 0, (k) => 0.42 * fresh(k) * fade, zero);
    }
    gl.useProgram(progs.edge);
    gl.bindVertexArray(edge.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, edge.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, o);
    gl.drawArrays(gl.TRIANGLES, 0, o / 6);
  };

  const drawGlows = (time: number) => {
    const { W, H, D } = path.size;
    const model = path.model;
    let o = 0;
    let count = 0;
    const put = (m: V3, rgb: V3, sizePx: number, streak: number) => {
      if (count >= MAX_GLOWS || rgb[0] + rgb[1] + rgb[2] < 0.01) return;
      const p = transformPoint(model, m);
      const [x, y] = path.project(p);
      const size = sizePx * (D / -p[2]) * (W / 1440 + 0.35);
      const cx = (x / W) * 2 - 1;
      const cy = 1 - (y / H) * 2;
      const sx = (size / W) * 2;
      const sy = (size / H) * 2;
      for (const [a, b] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ]) {
        glow.data.set([cx + a * sx, cy + b * sy, a, b, rgb[0], rgb[1], rgb[2], streak], o);
        o += 8;
      }
      count++;
    };
    const mirror = (m: V3): V3 => [-m[0], m[1], m[2]];
    const ph = time % 1.05;
    const strobe = ph < 0.045 || (ph > 0.12 && ph < 0.165) ? 3.2 : 0;
    const beacon = Math.exp(-((time + 0.4) % 1.2) * 11) * 2.4;
    put(LIGHTS.navRight, [0.12, 1.1, 0.5], 14, 0);
    put(mirror(LIGHTS.navRight), [1.2, 0.14, 0.1], 11, 0);
    put(LIGHTS.tail, [0.9, 0.9, 0.9], 10, 0);
    put(LIGHTS.beacon, [beacon, beacon * 0.14, beacon * 0.1], 30, 0);
    put(LIGHTS.strobeRight, [strobe, strobe, strobe], 40, 0.55);
    put(mirror(LIGHTS.strobeRight), [strobe, strobe, strobe], 30, 0.55);
    put(LIGHTS.tail, [strobe * 0.8, strobe * 0.8, strobe * 0.8], 28, 0.4);
    if (!count) return;
    gl.useProgram(progs.glow);
    gl.bindVertexArray(glow.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, glow.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, glow.data, 0, o);
    gl.drawArrays(gl.TRIANGLES, 0, count * 6);
  };

  let blank = false;
  /** One frame: the wake's edges, then the jet at t (if it's on stage), then its lights. */
  const render = (t: number, spread: number, time: number, w: Wake | null) => {
    if (state !== "ready") return;
    fit();
    const flying = t > 0 && t < 1;
    const edges = w && t > 0 && spread < 1;
    if (!flying && !edges) {
      if (!blank) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        blank = true;
      }
      return;
    }
    blank = false;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    if (edges) drawEdges(w, spread);
    if (!flying) return;

    path.pose(t);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.useProgram(progs.jet);
    gl.uniformMatrix4fv(U.uProj, false, proj);
    gl.uniformMatrix4fv(U.uModel, false, path.model);
    gl.uniform3f(U.uSun, SUN[0], SUN[1], SUN[2]);
    gl.uniformMatrix3fv(U.uEnv, false, ENV);
    gl.bindVertexArray(jetVao);
    gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_INT, 0);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    drawGlows(time);
  };

  const dispose = () => {
    buffers.forEach((b) => gl.deleteBuffer(b));
    vaos.forEach((v) => gl.deleteVertexArray(v));
    Object.values(progs).forEach((p) => gl.deleteProgram(p));
    shaders.forEach((s) => gl.deleteShader(s));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };

  return { status, render, dispose };
}

export type Flyby = NonNullable<ReturnType<typeof createFlyby>>;
