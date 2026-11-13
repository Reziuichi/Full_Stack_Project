// GLSL for the About page's world. three.js compiles these as GLSL ES 3.00
// (texture2D, varying and gl_FragColor are mapped for us). Colours are
// linear; three converts to sRGB on output. Textures are decoded as
// ImageBitmaps without flipping (Safari ignores the flip option), so the
// shaders flip v themselves.

const NOISE = /* glsl */ `
float hash31(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x), mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x), mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm3(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return s;
}
// How far (in radians) the living front has passed a point of the surface: > 0 alive,
// < 0 still moon. Life starts at uFront and spreads as a cap whose edge is torn by noise,
// sweeping an even angle per unit of life until it has passed the far side.
float lifeEdge(vec3 n, vec3 front, float life) {
  float ang = acos(clamp(dot(n, front), -1.0, 1.0));
  float reach = clamp(life, 0.0, 1.0) * 3.82 - 0.33;
  return reach - ang + (fbm3(n * 3.6) - 0.5) * 0.5 + (vnoise(n * 14.0) - 0.5) * 0.07;
}
`;

/**
 * How much sunlight reaches p (view space) past the ball in uShade (view-space centre, radius;
 * w = 0: none): 0 in its shadow, soft at the edge, the edge softer the farther behind the ball.
 */
const SHADOW = /* glsl */ `
uniform vec4 uShade;
float ballShadow(vec3 p, vec3 L) {
  if (uShade.w <= 0.0) return 1.0;
  vec3 oc = uShade.xyz - p;
  float t = dot(oc, L);
  if (t <= 0.0) return 1.0;
  float d = length(oc - L * t);
  float pen = 0.03 + t * 0.035;
  return smoothstep(uShade.w - pen, uShade.w + pen, d);
}
`;

/** Texture lookups that don't seam where the map's u wraps from 1 back to 0. */
const SEAMLESS = /* glsl */ `
void seamGrad(vec2 uv, out vec2 dx, out vec2 dy) {
  dx = dFdx(uv); dy = dFdy(uv);
  vec2 uv2 = vec2(fract(uv.x + 0.5), uv.y);
  vec2 dx2 = dFdx(uv2), dy2 = dFdy(uv2);
  if (dot(dx2, dx2) < dot(dx, dx)) dx = dx2;
  if (dot(dy2, dy2) < dot(dy, dy)) dy = dy2;
}
`;

export const PLANET_VS = /* glsl */ `
uniform sampler2D uMoonH;
uniform float uLife;
uniform vec3 uFront;
uniform float uRelief;
varying vec2 vUv;
varying vec3 vObjN;
varying vec3 vViewN;
varying vec3 vViewPos;
${NOISE}
void main() {
  vUv = vec2(uv.x, 1.0 - uv.y);
  vObjN = normalize(position);
  vec3 p = position;
  if (uRelief > 0.0) {
    #ifdef MOON_ONLY
    float alive = 0.0;
    #else
    float alive = smoothstep(-0.04, 0.04, lifeEdge(vObjN, uFront, uLife));
    #endif
    float h = texture2D(uMoonH, vUv).r;
    // The moon's craters stand proud on its limb; the living Earth is smooth.
    p *= 1.0 + (h - 0.5) * uRelief * (1.0 - alive);
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vViewPos = mv.xyz;
  vViewN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`;

export const PLANET_FS = /* glsl */ `
uniform sampler2D uMoon;
uniform sampler2D uMoonH;
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform sampler2D uMask;
uniform float uLife;
uniform vec3 uFront;
uniform vec3 uSun;      // towards the sun, view space
uniform float uTime;
uniform float uCloudShift;
uniform vec4 uCursor;   // object-space direction under the pointer, w = how much it shows
uniform vec4 uPulse;    // object-space direction of the last tap, w = seconds since (< 0: none)
#ifdef MOON_ONLY
uniform float uFade;
#endif
varying vec2 vUv;
varying vec3 vObjN;
varying vec3 vViewN;
varying vec3 vViewPos;
${NOISE}
${SEAMLESS}
${SHADOW}

vec3 bumped(vec3 pos, vec3 n, vec2 dHdxy) {
  vec3 sx = dFdx(pos), sy = dFdy(pos);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * n - grad);
}

void main() {
  vec2 dx, dy;
  seamGrad(vUv, dx, dy);
  vec3 N = normalize(vViewN);
  vec3 V = normalize(-vViewPos);
  vec3 L = normalize(uSun);
  vec3 objN = normalize(vObjN);
  // In the finale the Moon and the Earth can shadow each other.
  float shade = ballShadow(vViewPos, L);

  // ── The living front (once it has passed everywhere, skip the noise: the planet can fill the screen) ──
  #ifdef MOON_ONLY
  float x = -1.0;
  #else
  float x = uLife >= 0.999 ? 1.0 : lifeEdge(objN, uFront, uLife);
  #endif
  float alive = smoothstep(-0.012, 0.012, x);
  float band = exp(-x * x / 0.0006);

  // ── Moon: grey regolith, relief from the elevation map ──
  vec3 moon = vec3(0.0);
  if (alive < 0.999) {
    float h0 = textureGrad(uMoonH, vUv, dx, dy).r;
    float hx = textureGrad(uMoonH, vUv + dx, dx, dy).r - h0;
    float hy = textureGrad(uMoonH, vUv + dy, dx, dy).r - h0;
    vec3 Nm = bumped(vViewPos, N, vec2(hx, hy) * 0.05);
    vec3 moonAlb = textureGrad(uMoon, vUv, dx, dy).rgb;
    float ml = smoothstep(-0.05, 0.6, dot(Nm, L));
    moon = moonAlb * 0.95 * (ml * 1.05 * shade + 0.004);
    // In the Earth's shadow it keeps a faint dark red: sunlight bent round through the air.
    moon += moonAlb * ml * (1.0 - shade) * vec3(0.045, 0.014, 0.009);
    #ifdef MOON_ONLY
    // Earthshine: its dark face is lit faintly by the Earth.
    moon += moonAlb * 0.03 * (1.0 - ml);
    #endif
  }

  // ── Earth: land, dark seas that catch the sun, cities at night, warm terminator ──
  vec3 earth = vec3(0.0);
  float lit = 0.0;
  float ndl = dot(N, L);
  if (alive > 0.001) {
    vec3 day = textureGrad(uDay, vUv, dx, dy).rgb;
    vec4 mask = textureGrad(uMask, vUv, dx, dy);
    float water = mask.g;
    vec3 seaDeep = vec3(0.0035, 0.009, 0.016);
    vec3 alb = mix(day * vec3(1.03, 1.0, 0.94), mix(day, seaDeep, 0.7), water);
    // Lambert, with a little light carried past the terminator by the air.
    lit = (max(ndl, 0.0) * 1.25 + smoothstep(-0.1, 0.05, ndl) * 0.03) * shade;
    vec3 H = normalize(L + V);
    float nh = max(dot(N, H), 0.0);
    float glint = pow(nh, 160.0) * 1.5 + pow(nh, 24.0) * 0.025;
    earth = alb * (lit + 0.002);
    earth += glint * water * lit * vec3(1.0, 0.86, 0.68);
    // Cloud shadows on the ground, a little offset from the clouds themselves.
    float cloudShadow = textureGrad(uMask, vec2(vUv.x + uCloudShift + 0.003, vUv.y + 0.002), dx, dy).r;
    earth *= 1.0 - cloudShadow * 0.4 * lit;
    vec3 lights = textureGrad(uNight, vUv, dx, dy).rgb;
    float night = 1.0 - smoothstep(-0.2, 0.06, ndl);
    // Only the lights themselves, warm; the map's faint blue-grey land would tint the whole night
    // side, so the land keeps just a neutral trace of it.
    float lum = dot(lights, vec3(0.3, 0.55, 0.15));
    float city = smoothstep(0.05, 0.45, lum);
    earth += (vec3(1.0, 0.7, 0.4) * lum * city * 3.4 + vec3(lum) * 0.18 * (1.0 - city)) * night;
    earth += alb * exp(-pow((ndl - 0.02) / 0.075, 2.0)) * vec3(0.3, 0.11, 0.035) * shade;
  }

  vec3 col = mix(moon, earth, alive);
  // Where the front passes, the ground glows a moment: the light of a place waking up.
  if (band > 0.002) {
    float spark = smoothstep(0.8, 0.98, vnoise(objN * 60.0 + uTime * 0.6));
    col += band * (0.25 + 0.75 * smoothstep(-0.3, 0.4, ndl)) * vec3(1.0, 0.84, 0.62) * (0.45 + spark * 1.8);
  }
  // Limb haze, only where there is air.
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += fres * mix(vec3(0.24, 0.36, 0.55), vec3(0.85, 0.5, 0.3), pow(1.0 - lit, 2.0)) * 0.5 * alive * smoothstep(-0.3, 0.3, ndl);

  // The finale: a reticle where the pointer meets the ground, and a ring spreading from a tap
  // with a pin left where it landed.
  if (uCursor.w > 0.001) {
    float ca = acos(clamp(dot(objN, uCursor.xyz), -1.0, 1.0));
    float ring = exp(-pow((ca - 0.052) / 0.0045, 2.0)) * 0.9 + exp(-pow((ca - 0.09) / 0.003, 2.0)) * 0.35 + exp(-pow(ca / 0.009, 2.0));
    col += vec3(1.0, 0.64, 0.32) * ring * uCursor.w * 1.5;
  }
  if (uPulse.w >= 0.0) {
    float pa = acos(clamp(dot(objN, uPulse.xyz), -1.0, 1.0));
    float age = uPulse.w;
    float wave = exp(-pow((pa - age * 0.24) / 0.009, 2.0)) * exp(-age * 1.1);
    float wave2 = exp(-pow((pa - max(age - 0.35, 0.0) * 0.24) / 0.007, 2.0)) * exp(-age * 1.4) * step(0.35, age);
    float pinDot = exp(-pow(pa / 0.0075, 2.0));
    col += vec3(1.0, 0.68, 0.38) * (wave * 2.4 + wave2 * 1.6 + pinDot * 1.8);
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef MOON_ONLY
  gl_FragColor *= uFade;
  #endif
}
`;

/** The cloud deck of the living Earth: a shell just above the ground. */
export const CLOUDS_FS = /* glsl */ `
uniform sampler2D uMask;
uniform float uLife;
uniform vec3 uFront;
uniform vec3 uSun;
uniform float uCloudShift;
varying vec2 vUv;
varying vec3 vObjN;
varying vec3 vViewN;
varying vec3 vViewPos;
${NOISE}
${SEAMLESS}
${SHADOW}
void main() {
  vec2 dx, dy;
  vec2 uv = vec2(vUv.x + uCloudShift, vUv.y);
  seamGrad(uv, dx, dy);
  float c = textureGrad(uMask, uv, dx, dy).r;
  float alive = uLife >= 0.999 ? 1.0 : smoothstep(-0.05, 0.12, lifeEdge(normalize(vObjN), uFront, uLife));
  vec3 N = normalize(vViewN);
  float ndl = dot(N, normalize(uSun));
  float lit = (max(ndl, 0.0) * 1.15 + smoothstep(-0.1, 0.05, ndl) * 0.03) * ballShadow(vViewPos, normalize(uSun));
  vec3 col = vec3(1.0, 0.97, 0.93) * (lit + 0.004) + vec3(0.2, 0.07, 0.02) * exp(-pow((ndl - 0.02) / 0.1, 2.0));
  float a = smoothstep(0.14, 0.95, c) * 0.84 * alive;
  gl_FragColor = vec4(col * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const HALO_VS = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

/**
 * The air around the planet, on a camera-facing card behind it. Each pixel
 * finds where its ray passes closest to the planet: the lower that is, the
 * more air it crossed. Brightest just above the limb, on the side facing the
 * sun, warm where the sun is setting, and gone once the ray is in the dark.
 */
export const HALO_FS = /* glsl */ `
uniform vec3 uCenter;
uniform vec3 uSun;       // towards the sun, world space
uniform float uStrength;
varying vec3 vWorld;
void main() {
  vec3 dir = normalize(vWorld - cameraPosition);
  vec3 oc = uCenter - cameraPosition;
  // Looking away from the planet, the lowest point of the ray is where we are.
  float t = max(dot(oc, dir), 0.0);
  vec3 closest = cameraPosition + dir * t - uCenter;
  float b = length(closest);
  float h = b - 1.0;
  if (h < -0.004) discard;
  float dens = exp(-max(h, 0.0) / 0.018) * 0.85 + exp(-max(h, 0.0) / 0.07) * 0.22;
  vec3 n = closest / b;
  float up = dot(n, uSun);
  float lit = smoothstep(-0.28, 0.32, up);
  float dusk = exp(-pow((up + 0.04) / 0.16, 2.0));
  vec3 col = mix(vec3(0.42, 0.6, 1.0), vec3(1.0, 0.52, 0.26), dusk * 0.85) * lit;
  // Looking through the limb towards the sun, the air lights up.
  col += vec3(1.0, 0.74, 0.5) * pow(max(dot(dir, uSun), 0.0), 12.0) * 0.6 * lit;
  float a = dens * uStrength;
  gl_FragColor = vec4(col * a, 0.0);
  #include <colorspace_fragment>
}
`;

/** A card facing the camera (the sun). */
export const CARD_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * The sun, seen from orbit: a white-hot disc, a tight glow, a few fine rays. It sits far behind
 * everything, so the planet and the Moon hide it when they pass in front. Additive.
 */
export const SUN_FS = /* glsl */ `
uniform float uOn;
varying vec2 vUv;
void main() {
  vec2 q = (vUv - 0.5) * 2.0;
  float r = length(q);
  float core = 1.0 - smoothstep(0.024, 0.03, r);
  float glow = exp(-r / 0.016) * 2.2 + exp(-r / 0.06) * 0.3 + exp(-r / 0.25) * 0.05;
  float a = atan(q.y, q.x);
  float rays = pow(abs(cos(a * 3.0 + 0.35)), 80.0) * 0.55 + pow(abs(cos(a * 8.0 + 1.1)), 160.0) * 0.3;
  float burst = rays * exp(-r / 0.1) * 0.7;
  vec3 col = vec3(1.0, 0.97, 0.92) * (core * 26.0 + glow + burst) * uOn * (1.0 - smoothstep(0.8, 1.0, r));
  gl_FragColor = vec4(col, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * The sun's flare across the frame: a thin horizontal streak through it, a soft glare, and a few
 * faint ghosts on the line from it through the centre. uVis is how much of the sun shows past the
 * planet and the Moon; uFlash peaks as it slips behind a limb or comes out from one.
 */
export const FLARE_FS = /* glsl */ `
uniform vec2 uSunUv;
uniform float uVis;
uniform float uFlash;
uniform float uAspect;
varying vec2 vUv;
float blob(vec2 p, vec2 c, float r) {
  float d = length((p - c) * vec2(uAspect, 1.0));
  return exp(-pow(d / r, 2.0));
}
float ring(vec2 p, vec2 c, float r) {
  float d = length((p - c) * vec2(uAspect, 1.0));
  return exp(-pow((d - r) / (r * 0.18), 2.0));
}
void main() {
  vec2 d = (vUv - uSunUv) * vec2(uAspect, 1.0);
  float streak = exp(-abs(d.y) / 0.0022) * exp(-abs(d.x) / 0.17) * 0.35;
  float glare = exp(-length(d) / 0.045) * 0.22 + exp(-length(d) / 0.2) * 0.04;
  vec2 axis = vec2(0.5) - uSunUv;
  float ghosts = ring(vUv, uSunUv + axis * 0.5, 0.04) * 0.05 + blob(vUv, uSunUv + axis * 1.3, 0.055) * 0.04 + blob(vUv, uSunUv + axis * 1.75, 0.018) * 0.07;
  float k = uVis * (1.0 + 1.8 * uFlash);
  vec3 col = vec3(1.0, 0.96, 0.9) * (streak + glare) * k + vec3(0.9, 0.92, 0.95) * ghosts * uVis;
  gl_FragColor = vec4(col, 0.0);
  #include <colorspace_fragment>
}
`;

export const STARS_VS = /* glsl */ `
attribute float aSize;
attribute float aSeed;
uniform float uTime;
uniform float uScale;
varying float vTwinkle;
varying float vSeed;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // About a third of the stars twinkle (an uneven flicker, never fully out); the rest hold
  // steady with a faint shimmer.
  float tw = fract(aSeed * 7.31);
  float slow = 0.88 + 0.12 * sin(uTime * (0.4 + aSeed * 0.9) + aSeed * 40.0);
  float flick = (0.5 + 0.5 * sin(uTime * (1.3 + tw * 1.6) + aSeed * 91.0)) * (0.7 + 0.3 * sin(uTime * (3.1 + tw * 2.3) + aSeed * 17.0));
  vTwinkle = aSeed < 0.32 ? 0.42 + 0.78 * flick : slow;
  vSeed = aSeed;
  gl_PointSize = aSize * uScale;
}
`;

export const STARS_FS = /* glsl */ `
uniform float uOpacity;
varying float vTwinkle;
varying float vSeed;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  float a = exp(-d * 4.0) * vTwinkle * uOpacity;
  if (a < 0.004) discard;
  vec3 tint = mix(vec3(1.0, 0.88, 0.74), vec3(0.86, 0.9, 1.0), step(0.88, vSeed));
  gl_FragColor = vec4(tint * a, a);
}
`;

export const SKY_VS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

/**
 * The sky over the cloud, from dusk to night. At dusk: near-black overhead, a warm band low
 * down, the sun just above the deck. As the sun sinks the band narrows, reddens and gathers
 * under where it went, then fades to a faint airglow; overhead goes truly dark. At night the
 * Milky Way shows faintly, a shooting star crosses now and then, and a crescent moon stands
 * over the cloud, lit from where the sun went down, the rest of its face faint with earthshine.
 */
export const SKY_FS = /* glsl */ `
uniform vec3 uSunDir;
uniform float uOpacity;
uniform float uHorizon;
uniform float uNight;
uniform vec3 uMoonDir;
uniform sampler2D uMoonTex;
uniform sampler3D uNoise;
uniform float uTime;
varying vec3 vDir;
float skyNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return textureLod(uNoise, (i + f + 0.5) / 64.0, 0.0).r;
}
float skyHash(float n) {
  return fract(sin(n * 91.3458) * 47453.5453);
}
// A shooting star in some of the 6.5-second slots: a short streak with a bright head.
float meteor(vec3 d, float pix) {
  float slot = floor(uTime / 6.5);
  float f = (uTime - slot * 6.5) / 0.8;
  if (f > 1.0 || skyHash(slot) < 0.5) return 0.0;
  float az = mix(-0.55, 0.55, skyHash(slot + 1.3));
  float el = mix(0.2, 0.42, skyHash(slot + 2.7));
  vec3 a = vec3(sin(az) * cos(el), sin(el), -cos(az) * cos(el));
  vec3 way = vec3(mix(-1.0, 1.0, skyHash(slot + 4.1)), -0.6, 0.0);
  vec3 t = normalize(way - a * dot(way, a));
  vec3 head = normalize(a + t * 0.2 * f);
  vec3 tail = normalize(a + t * 0.2 * max(f - 0.4, 0.0));
  vec3 ab = head - tail;
  float k = clamp(dot(d - tail, ab) / max(dot(ab, ab), 1e-7), 0.0, 1.0);
  float dist = length(d - (tail + ab * k));
  return exp(-pow(dist / max(0.0008, pix * 0.8), 2.0)) * k * k * sin(3.14159 * f);
}
void main() {
  vec3 d = normalize(vDir);
  float pix = length(fwidth(d));
  float h = d.y + uHorizon;
  vec3 sun = normalize(uSunDir);
  float n = uNight;
  // Dusk: sRGB #0d0c10 overhead, #231c1f above the band, #9c6a52 at the horizon, #1c1516 below
  // it. Night: near-black, with a faint airglow low down.
  vec3 zenith = mix(vec3(0.004, 0.0037, 0.0052), vec3(0.0012, 0.0012, 0.0013), n);
  vec3 upper = mix(vec3(0.0168, 0.0116, 0.0137), vec3(0.0025, 0.0025, 0.0027), n);
  float toward = max(dot(normalize(d.xz + 1e-5), normalize(sun.xz + 1e-5)), 0.0);
  float gather = mix(1.0, 0.2 + 1.0 * pow(toward, 2.5), smoothstep(0.05, 0.55, n));
  vec3 band = mix(vec3(0.332, 0.144, 0.084), vec3(0.23, 0.065, 0.028), smoothstep(0.0, 0.5, n));
  band = band * gather * (1.0 - smoothstep(0.45, 0.95, n)) + vec3(0.005, 0.0049, 0.005) * n;
  vec3 low = mix(vec3(0.0116, 0.0075, 0.008), vec3(0.0017, 0.0017, 0.0018), n);
  vec3 col = mix(band, upper, pow(smoothstep(0.0, mix(0.2, 0.07, smoothstep(0.0, 0.6, n)), h), 0.6));
  col = mix(col, zenith, smoothstep(0.12, 0.7, h));
  col = mix(low, col, smoothstep(-0.05, 0.004, h));
  // The sun and its glow, until it's down.
  float s = max(dot(d, sun), 0.0);
  float up = smoothstep(-0.035, 0.01, sun.y);
  col += vec3(1.0, 0.6, 0.36) * (pow(s, 5000.0) * 4.0 + pow(s, 120.0) * 0.3 + pow(s, 10.0) * 0.06) * smoothstep(-0.1, 0.04, h) * up;
  float sky = smoothstep(-0.01, 0.03, h);
  vec3 m = normalize(uMoonDir);
  float md = dot(d, m);
  if (n > 0.001) {
    // The Milky Way: a faint band, broken by dark lanes.
    // (Its plane tilted so it rises from low on the left to high on the right of the view.)
    vec3 mwN = normalize(vec3(0.169, -0.889, -0.426));
    float g = dot(d, mwN);
    float lanes = skyNoise(d * 9.0 + 3.1) * 0.6 + skyNoise(d * 23.0 + 7.7) * 0.4;
    float mw = exp(-g * g / 0.018) * smoothstep(0.3, 0.75, lanes) + exp(-g * g / 0.004) * 0.3;
    col += vec3(0.024, 0.022, 0.02) * mw * n * sky * smoothstep(0.05, 0.3, h);
    col += vec3(0.9, 0.86, 0.78) * meteor(d, pix) * smoothstep(0.75, 1.0, n) * sky;
    // The moon: lit from where the sun went down, with a soft halo in the air round it.
    float mr = 0.019;
    if (md > 0.997) {
      vec3 tx = normalize(cross(vec3(0.0, 1.0, 0.0), m));
      vec3 ty = cross(m, tx);
      vec2 q = vec2(dot(d, tx), dot(d, ty)) / mr;
      float r = length(q);
      if (r < 1.0) {
        float z = sqrt(1.0 - r * r);
        vec3 nrm = tx * q.x + ty * q.y - m * z;
        vec2 uv = vec2(0.5 + atan(q.x, z) / 6.2832, 0.5 - asin(clamp(q.y, -1.0, 1.0)) / 3.1416);
        vec3 alb = texture2D(uMoonTex, uv).rgb;
        float lit = smoothstep(-0.03, 0.1, dot(nrm, sun));
        vec3 moon = alb * (lit * 1.7 + 0.014);
        float edge = 1.0 - smoothstep(1.0 - 1.5 * pix / mr, 1.0, r);
        col = mix(col, moon, edge * n * sky);
      }
    }
    col += vec3(0.9, 0.88, 0.85) * (pow(max(md, 0.0), 6000.0) * 0.05 + pow(max(md, 0.0), 400.0) * 0.008) * n * sky;
  }
  gl_FragColor = vec4(col, 1.0) * uOpacity;
  #include <colorspace_fragment>
}
`;

/**
 * The night's stars over the cloud, and a few satellites crossing among them: each moves along
 * its own great circle and shows for part of it, then fades as it passes into the Earth's
 * shadow. Stars twinkle and dim through the thick air near the horizon. Additive.
 */
export const NIGHT_STARS_VS = /* glsl */ `
attribute vec3 aB;
attribute float aSpeed;
attribute float aSize;
attribute float aSeed;
uniform float uTime;
uniform float uScale;
uniform float uOpacity;
varying float vA;
varying float vSeed;
varying float vSat;
void main() {
  vec3 p = position;
  float show = 1.0;
  float tw = 0.7 + 0.3 * sin(uTime * (1.3 + aSeed * 3.0) + aSeed * 40.0);
  if (aSpeed > 0.0) {
    float ang = aSpeed * uTime + aSeed * 6.2832;
    p = cos(ang) * position + sin(ang) * aB;
    float ph = fract(ang / 6.2832);
    show = smoothstep(0.0, 0.02, ph) * (1.0 - smoothstep(0.2, 0.235, ph));
    tw = 1.0;
  }
  vec3 d = normalize(p);
  vA = uOpacity * tw * show * smoothstep(0.0, 0.16, d.y);
  vSeed = aSeed;
  vSat = aSpeed > 0.0 ? 1.0 : 0.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale;
}
`;
export const NIGHT_STARS_FS = /* glsl */ `
varying float vA;
varying float vSeed;
varying float vSat;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  float a = (exp(-d * 9.0) + exp(-d * 2.5) * 0.12) * vA;
  if (a < 0.003) discard;
  vec3 tint = mix(vec3(1.0, 0.9, 0.78), vec3(0.88, 0.91, 1.0), step(0.86, vSeed));
  tint = mix(tint, vec3(1.0, 0.97, 0.92), vSat);
  gl_FragColor = vec4(tint * a, 0.0);
  #include <colorspace_fragment>
}
`;

export const CLOUD_VS = /* glsl */ `
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
varying vec3 vRay;
varying vec3 vRayView;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 v = uProjInv * vec4(position.xy, 1.0, 1.0);
  vRayView = v.xyz / v.w;
  vRay = (uCamWorld * vec4(vRayView, 0.0)).xyz;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * The sea of cloud, ray-marched: a deck of layered 3D noise that is dense low
 * down and billows at the top. Each sample is lit by how much the cloud
 * thins towards the sun (bright sides facing it, silver edges when looking
 * into it) plus a dim dusk sky from above, and hazes into the horizon with
 * distance. Each layer of noise is kept only as far as a pixel can resolve it:
 * towards the horizon one pixel spans many billows, and sampled sparsely they
 * would speckle into a crosshatch, so there they fade to their average and the
 * far deck stays as smooth as the near one. Where the satellite's beam lands,
 * the cloud tops carry its light, drawn the way the chosen lens sees the world.
 * At night the light is the moon's.
 * Premultiplied, linear, unclamped.
 */
export const CLOUD_FS = /* glsl */ `
uniform sampler3D uNoise;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmb;
uniform vec3 uHaze;
uniform float uTime;
uniform float uBase;
uniform float uTop;
uniform float uSteps;
uniform float uOpacity;
uniform vec3 uEye;   // the scene camera (this pass is drawn with a flat one)
// The beam's footprint: centre x and z, radius, strength. How much of each pattern is on
// (imaging swath, tiles, radar rings), and the patterns' clock.
uniform vec4 uFoot;
uniform vec3 uFootMix;
uniform float uFootTime;
uniform float uFootY;
uniform float uFootTile;
varying vec3 vRay;
varying vec2 vUv;

float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return textureLod(uNoise, (i + f + 0.5) / 64.0, 0.0).r;
}
// One layer of noise at frequency s, kept in proportion to how well it can be resolved: fq is the
// patch of noise space one sample stands for. The noise averages 0.5, which is what remains.
float octave(vec3 q, float s, vec3 o, float fq) {
  float k = 1.0 - smoothstep(0.35 / s, 1.0 / s, fq);
  return k > 0.0 ? mix(0.5, noise3(q * s + o), k) : 0.5;
}
// The big billows (two octaves) and the fine fraying on them (two more).
float shape(vec3 q, float fq) {
  return 0.5 * octave(q, 1.0, vec3(0.0), fq) + 0.25 * octave(q, 2.02, vec3(0.31, 0.17, 0.73), fq);
}
float detail(vec3 q, float fq) {
  return 0.125 * octave(q, 4.09, vec3(0.11, 0.53, 0.29), fq) + 0.0625 * octave(q, 8.26, vec3(0.47, 0.23, 0.61), fq);
}
// Dense low down, thinning upwards into billows (the noise has to beat a rising
// threshold), with a soft floor underneath.
float deck(float f, float y) {
  float h = (y - uBase) / (uTop - uBase);
  return clamp((f - mix(0.27, 0.68, h)) * 3.4, 0.0, 1.0) * smoothstep(-0.3, 0.1, h);
}
float hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// The beam's light where this pixel's ray crosses the cloud tops (the plane y = uFootY), worked
// out once per pixel rather than at every sample, so the march's jitter can't speckle it; lines
// are kept at least about a pixel wide.
vec3 footLight(vec2 at) {
  vec2 d = at - uFoot.xy;
  float r = length(d) / uFoot.z;
  float t = uFootTime;
  float pool = 1.0 - smoothstep(0.45, 1.1, r);
  float rim = exp(-pow((r - 1.0) / max(0.04, 1.5 * fwidth(r)), 2.0)) * 0.5;
  // 0 · Imaging: a swath along the ground track (x) with a bright line sweeping down it.
  vec2 w = d / uFoot.z;
  float s = fract(t * 0.3) * 2.8 - 1.4;
  float line = exp(-pow((w.x - s) / max(0.035, 1.5 * fwidth(w.x)), 2.0));
  float trail = w.x < s ? exp(-(s - w.x) * 2.4) : 0.0;
  float swath = (1.0 - smoothstep(0.7, 0.85, abs(w.y))) * (1.0 - smoothstep(0.85, 1.1, length(w)));
  float img = swath * (line * 2.8 + trail * 0.85 + 0.2);
  // 1 · Tiles: squares (turned 45° to the view, so no edge lies along a pixel row) that light
  // up as they stream in, each in its own time.
  vec2 g = mat2(0.7071, 0.7071, -0.7071, 0.7071) * d / uFootTile;
  vec2 f = fract(g) - 0.5;
  float arrive = fract(t * 0.24 + hash2(floor(g)));
  float flash = exp(-arrive * 6.0);
  // Where a tile is only a few pixels across its edges would crowd: let them go to a soft fill.
  float fwg = fwidth(g.x) + fwidth(g.y);
  float edge = (1.0 - smoothstep(0.0, 0.05 + 1.5 * fwg, 0.5 - max(abs(f.x), abs(f.y)))) * (1.0 - smoothstep(0.12, 0.3, fwg));
  float tiles = (edge * (0.45 + 1.4 * flash) + flash * 0.75 * (1.0 - smoothstep(0.12, 0.3, fwg)) + 0.2 * smoothstep(0.12, 0.3, fwg)) * (1.0 - smoothstep(0.8, 1.0, r));
  // 2 · Radar: rings sweeping out from under the craft.
  float rq = r * 1.7 - t * 0.5;
  float rings = exp(-pow((fract(rq) - 0.5) / max(0.09, 1.5 * fwidth(rq)), 2.0)) * (1.0 - smoothstep(0.65, 1.05, r)) * 2.0;
  float pat = uFootMix.x * img + uFootMix.y * tiles + uFootMix.z * rings;
  return vec3(1.0, 0.72, 0.46) * uFoot.w * (pool * (0.22 + 1.8 * pat) + rim) * step(r, 1.3);
}

void main() {
  vec3 ro = uEye;
  vec3 rd = normalize(vRay);
  // How far apart neighbouring pixels' rays are (radians), for the noise's level of detail.
  float pix = max(length(dFdx(rd)), length(dFdy(rd)));
  float y0 = uBase - 1.0;
  float y1 = uTop;
  float tMin = 0.0;
  float tMax = 3000.0;
  if (abs(rd.y) > 1e-5) {
    float ta = (y0 - ro.y) / rd.y;
    float tb = (y1 - ro.y) / rd.y;
    tMin = max(min(ta, tb), 0.0);
    tMax = min(max(ta, tb), tMax);
  } else if (ro.y < y0 || ro.y > y1) {
    tMax = -1.0;
  }
  // Inside the deck you can't see far, and the fog is rising over the frame: don't march for miles.
  if (ro.y < y1) tMax = min(tMax, 36.0);
  vec3 foot = vec3(0.0);
  if (uFoot.w > 0.001) foot = footLight((ro + rd * ((uFootY - ro.y) / min(rd.y, -1e-3))).xz) * step(rd.y, -1e-3);
  vec4 acc = vec4(0.0);
  if (tMax > tMin) {
    float mu = dot(rd, uSunDir);
    // Forward scattering: looking into the sun, thin cloud blazes.
    float phase = 0.08 + 3.4 * pow(max(mu, 0.0), 14.0) + 0.22 * pow(max(mu, 0.0), 3.0);
    // The horizon glows most under the sun.
    vec3 haze = uHaze * (0.3 + 1.1 * pow(max(mu, 0.0), 5.0));
    vec3 wind = vec3(uTime * 0.014, 0.0, uTime * 0.006);
    vec3 toSun = uSunDir * 0.09;
    // A pixel's footprint grows with distance and with how flat the ray meets the deck.
    float spread = pix / max(abs(rd.y), 0.02);
    // Start each ray a fraction of a step in (interleaved gradient noise: an even, fine pattern),
    // less so for rays that only meet the deck far off, where the smoothed cloud needs it least.
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float t = tMin + ign * mix(0.6, 0.25, smoothstep(40.0, 160.0, tMin)) * max(0.12, tMin * 0.025);
    for (int i = 0; i < 80; i++) {
      if (float(i) >= uSteps || t > tMax || acc.a > 0.975) break;
      vec3 pos = ro + rd * t;
      float dt = max(0.12, t * 0.025);
      vec3 q = pos * 0.15 + wind;
      // The patch of noise one sample stands for: across the pixel, or along the step.
      float fq = max(t * spread, dt * 0.35) * 0.15;
      float fc = shape(q, fq);
      float den = deck(fc + detail(q, fq), pos.y);
      if (den > 0.01) {
        // Light from the big shape only, so the fine fraying never speckles the shading.
        float lit = deck(fc + 0.09375, pos.y) - deck(shape(q + toSun, fq) + 0.09375, pos.y + uSunDir.y * 0.6);
        float dif = clamp(lit / 0.5, 0.0, 1.0);
        float hgt = clamp((pos.y - uBase) / (uTop - uBase), 0.0, 1.0);
        vec3 col = uAmb * (0.35 + 1.0 * hgt) + uSunCol * dif * phase;
        // It falls from above: the upper cloud takes it, the depths of the deck don't.
        col += foot * smoothstep(0.05, 0.55, hgt);
        col = mix(col, haze, 1.0 - exp(-0.0032 * t));
        float a = 1.0 - exp(-den * dt * 1.6);
        acc.rgb += (1.0 - acc.a) * a * col;
        acc.a += (1.0 - acc.a) * a;
      }
      t += dt;
    }
  }
  gl_FragColor = acc * uOpacity;
}
`;

/**
 * The clouds over what's already drawn: smoothed with a small tent filter as they're
 * scaled up, tone-mapped like the rest, kept premultiplied.
 */
export const COMPOSITE_FS = /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec2 o = uTexel;
  vec4 c = texture2D(uSrc, vUv) * 0.4
    + (texture2D(uSrc, vUv + vec2(o.x, o.y)) + texture2D(uSrc, vUv + vec2(-o.x, o.y))
     + texture2D(uSrc, vUv + vec2(o.x, -o.y)) + texture2D(uSrc, vUv + vec2(-o.x, -o.y))) * 0.15;
  if (c.a < 0.002) discard;
  gl_FragColor = vec4(c.rgb / c.a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * c.a, c.a);
}
`;

export const FLAT_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Cloud at the cuts, in one full-screen pass. Two layers of fog (a slower, darker one
 * behind a faster, lighter one) rise through the frame as the phase runs from 0 to 1:
 * each comes up from the bottom edge, covers everything at 0.5 and lifts off the top, its
 * edges torn by noise, lit along the rising crest, drifting up and in as we pass through.
 */
export const FOG_FS = /* glsl */ `
uniform sampler3D uNoise;
uniform float uPhase;
uniform float uTime;
uniform float uAspect;
uniform vec3 uDeep;
uniform vec3 uLit;
uniform vec3 uGlow;
varying vec2 vUv;
float n3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return textureLod(uNoise, (i + f + 0.5) / 64.0, 0.0).r;
}
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * n3(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s / 0.97;
}
vec4 layer(float scale, float speed, float lead, float seed) {
  vec2 q = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5) * (1.0 - 0.16 * uPhase);
  vec3 p = vec3(q * scale + vec2(uTime * 0.015, -uPhase * speed), seed + uPhase * 0.6 + uTime * 0.02);
  float n = fbm(p);
  // Wide enough that between phases 0.4 and 0.6 nothing behind can show (the engine skips
  // drawing the world then).
  float top = mix(-0.4, 1.9, smoothstep(0.0, 0.5 + lead, uPhase));
  float bot = mix(-0.9, 1.4, smoothstep(0.5 + lead, 1.0, uPhase));
  float y = vUv.y + (n - 0.5) * 0.8;
  float a = smoothstep(-0.02, 0.24, min(top - y, y - bot));
  float crest = smoothstep(0.32, 0.0, top - y);
  float lit = clamp(crest * 0.75 + (n - 0.42) * 1.1, 0.0, 1.0);
  vec3 col = mix(uDeep, uLit, lit) + uGlow * exp(-pow((top - y - 0.05) / 0.06, 2.0)) * 0.45;
  return vec4(col * a, a);
}
void main() {
  vec4 back = layer(1.5, 1.1, 0.0, 3.0);
  vec4 front = layer(2.4, 1.9, 0.035, 11.0);
  gl_FragColor = back * (1.0 - front.a) + front;
  #include <colorspace_fragment>
}
`;

/** A premultiplied layer drawn small, scaled up onto the screen. */
export const COPY_FS = /* glsl */ `
uniform sampler2D uSrc;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uSrc, vUv);
  if (c.a < 0.002) discard;
  gl_FragColor = vec4(c.rgb / c.a, 1.0);
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * c.a, c.a);
}
`;

/** One step of a dual-Kawase-style blur: four taps on the corners of a widening square. */
export const BLUR_FS = /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uOffset;
varying vec2 vUv;
void main() {
  vec2 o = uTexel * (uOffset + 0.5);
  vec4 c = texture2D(uSrc, vUv + vec2(-o.x, -o.y));
  c += texture2D(uSrc, vUv + vec2(o.x, -o.y));
  c += texture2D(uSrc, vUv + vec2(-o.x, o.y));
  c += texture2D(uSrc, vUv + vec2(o.x, o.y));
  gl_FragColor = c * 0.25;
}
`;

export const GLASS_VS = /* glsl */ `
uniform vec4 uRect;   // x, y, width, height in CSS px from the top left
uniform vec2 uRes;
varying vec2 vPx;
void main() {
  vec2 px = uRect.xy - 2.0 + (position.xy + 0.5) * (uRect.zw + 4.0);
  vPx = px;
  vec2 ndc = px / uRes * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}
`;

/**
 * A lens of glass over the world: lightly frosted so what's behind still reads, bent and
 * split into colour at the rim like thick glass, with a clear magnifying lens under the pointer
 * and an amber edge when its card is the lens that's on.
 */
export const GLASS_FS = /* glsl */ `
uniform sampler2D uBlur;
uniform sampler2D uSharp;
uniform vec4 uRect;
uniform vec2 uRes;
uniform float uRadius;
uniform float uAlpha;
uniform vec2 uPointer;   // CSS px
uniform float uHover;
uniform float uActive;
varying vec2 vPx;
float box(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
vec2 toUv(vec2 px) {
  return vec2(px.x / uRes.x, 1.0 - px.y / uRes.y);
}
void main() {
  vec2 hb = uRect.zw * 0.5;
  vec2 p = vPx - (uRect.xy + hb);
  float d = box(p, hb, uRadius);
  float inside = 1.0 - smoothstep(-0.7, 0.7, d);
  if (inside <= 0.0) discard;
  // The outward direction of the nearest edge.
  float e = 1.5;
  vec2 g = vec2(box(p + vec2(e, 0.0), hb, uRadius) - box(p - vec2(e, 0.0), hb, uRadius),
                box(p + vec2(0.0, e), hb, uRadius) - box(p - vec2(0.0, e), hb, uRadius));
  vec2 n = g / max(length(g), 1e-4);
  float rim = smoothstep(-20.0, 0.0, d);
  vec2 bend = n * rim * rim * 15.0;
  // The lens: what's under the pointer, clear and magnified 1.45×.
  vec2 toP = vPx - uPointer;
  float r = length(toP);
  float lens = uHover * (1.0 - smoothstep(44.0, 58.0, r));
  vec2 src = vPx - bend - toP * lens * 0.31;
  vec2 split = bend * 0.4;
  vec3 frost = vec3(texture2D(uBlur, toUv(src + split)).r, texture2D(uBlur, toUv(src)).g, texture2D(uBlur, toUv(src - split)).b);
  vec3 clear = vec3(texture2D(uSharp, toUv(src + split)).r, texture2D(uSharp, toUv(src)).g, texture2D(uSharp, toUv(src - split)).b);
  vec3 col = mix(frost, clear, max(lens, 0.3));
  col = col * mix(0.66, 0.8, uActive) + vec3(0.006, 0.005, 0.006);
  // The lens's own rim, and a sheen that follows the pointer across the glass.
  col += vec3(1.0, 0.82, 0.62) * (1.0 - smoothstep(0.0, 1.4, abs(r - 57.0))) * uHover * 0.4;
  col += vec3(1.0, 0.86, 0.7) * 0.05 * uHover * exp(-r * r / 20000.0);
  // The edge: lit along the top; amber when this card is scanning.
  float line = 1.0 - smoothstep(0.0, 1.2, abs(d + 0.9));
  col += line * mix(vec3(0.08), vec3(0.62, 0.34, 0.13), uActive) * (0.55 + 0.9 * smoothstep(0.2, -1.0, n.y));
  col += vec3(0.016) * smoothstep(hb.y, -hb.y, p.y);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor *= inside * uAlpha;
}
`;

/**
 * Injected into the satellite's standard material. The model carries its own colours per
 * vertex, with a material class in alpha: 0 gold foil, 1 amber foil, 2 silver, 3 white paint,
 * 4 dark parts, 5 solar cells. Foil is crinkled (a bump from 3D noise, faded out before it
 * gets finer than a few pixels, so it glints rather than sparkles); the cells are a mosaic of
 * dark glass, each a touch different, with fine silver bus bars, so the wing shimmers as it
 * turns through the light. Its metal reflects the dusk around it, worked out directly (the sky
 * above, the sea of cloud below, the low sun, and at night the moon) and softened with
 * roughness, rather than from a pre-blurred environment map. After sunset the Earth's shadow
 * climbs over it: the sun's light is cut below a rising line.
 */
export const CRAFT_VERTEX_HEAD = /* glsl */ `
attribute vec4 aTint;
varying vec4 vTint;
varying vec3 vObj;
varying float vWorldY;
`;
export const CRAFT_VERTEX_BODY = /* glsl */ `
vTint = aTint;
vObj = position;
vWorldY = (modelMatrix * vec4(transformed, 1.0)).y;
`;
export const CRAFT_FRAGMENT_HEAD = /* glsl */ `
uniform sampler3D uNoise;
uniform vec4 uCells;   // the wing's long axis in the model's y–z plane (cos, sin), cell size along and across
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uNight;
uniform float uShadowY;   // the Earth's shadow: below this height the sun's light is cut
varying vec4 vTint;
varying vec3 vObj;
varying float vWorldY;
// The sun's light (a directional light pointing at uSunDir) cut by the Earth's shadow.
float craftSunMask(vec3 dirView) {
  float isSun = smoothstep(0.985, 0.998, dot(inverseTransformDirection(dirView, viewMatrix), normalize(uSunDir)));
  return mix(1.0, smoothstep(uShadowY - 0.35, uShadowY + 0.35, vWorldY), isSun);
}
float craftNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return textureLod(uNoise, (i + f + 0.5) / 64.0, 0.0).r;
}
float craftHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// What a direction d (world space) sees at dusk out here, blurred as a surface of this roughness
// would see it: near-black overhead, the warm band low down, the low sun, the cloud below.
vec3 craftSky(vec3 d, float rough) {
  float h = d.y;
  float b = rough * 0.4;
  vec3 zenith = vec3(0.004, 0.0037, 0.0052);
  vec3 upper = vec3(0.0168, 0.0116, 0.0137);
  vec3 band = vec3(0.332, 0.144, 0.084);
  vec3 col = mix(band, upper, pow(smoothstep(-0.5 * b, 0.2 + b, h), 0.6));
  col = mix(col, zenith, smoothstep(0.12, 0.7 + b, h));
  vec3 sun = normalize(uSunDir);
  float s = max(dot(d, sun), 0.0);
  float n = mix(120.0, 4.0, sqrt(rough));
  col += vec3(1.0, 0.6, 0.36) * (pow(s, n) * 0.6 * (n + 1.0) / 121.0 + pow(s, min(n, 10.0)) * 0.08) * smoothstep(-0.035, 0.01, sun.y);
  float toward = max(dot(normalize(d.xz + 1e-5), normalize(sun.xz + 1e-5)), 0.0);
  vec3 sea = vec3(0.045, 0.032, 0.032) + vec3(0.42, 0.2, 0.1) * pow(toward, 3.0 - 2.0 * rough) * (0.4 + 0.6 * smoothstep(-0.5, 0.0, h));
  vec3 dusk = mix(sea, col, smoothstep(-0.04 - b, 0.01 + b, h));
  // Night: a dark sky, the cloud faintly moonlit, the moon itself.
  float mm = max(dot(d, normalize(uMoonDir)), 0.0);
  float nm = mix(900.0, 6.0, sqrt(rough));
  vec3 night = mix(vec3(0.006, 0.006, 0.0062), vec3(0.0017, 0.0017, 0.0019), smoothstep(-0.04 - b, 0.01 + b, h));
  night += vec3(0.85, 0.86, 0.9) * pow(mm, nm) * 0.5 * (nm + 1.0) / 901.0;
  return mix(dusk, night, uNight);
}
// A line about a pixel wide where x crosses a whole number, gone once the lines crowd.
float craftLine(float x) {
  float fw = max(fwidth(x), 1e-5);
  float d = abs(fract(x + 0.5) - 0.5) / fw;
  return (1.0 - smoothstep(0.5, 1.3, d)) * (1.0 - smoothstep(0.12, 0.3, fw));
}
`;
/** After <color_fragment>: the class's own colour, roughness and metalness. */
export const CRAFT_COLOR = /* glsl */ `
float craftClass = floor(vTint.a * 6.375 + 0.5);
vec3 craftTint = pow(vTint.rgb, vec3(2.2));
float craftRough = 0.55;
float craftMetal = 0.0;
float craftBump = 0.0;
// The cells, in the wing's own plane.
vec2 cellUv = mat2(uCells.x, -uCells.y, uCells.y, uCells.x) * vObj.yz;
vec2 cellQ = cellUv / uCells.zw;
vec2 cellId = floor(cellQ);
float bars = max(craftLine(cellQ.x), craftLine(cellQ.y * 0.5));
if (craftClass < 0.5) {
  diffuseColor.rgb = vec3(0.95, 0.62, 0.22) * mix(0.85, 1.1, craftTint.r);
  craftRough = 0.26;
  craftMetal = 1.0;
  craftBump = 1.0;
} else if (craftClass < 1.5) {
  diffuseColor.rgb = vec3(0.72, 0.42, 0.18) * (0.75 + 0.5 * craftTint.g);
  craftRough = 0.34;
  craftMetal = 1.0;
  craftBump = 0.8;
} else if (craftClass < 2.5) {
  diffuseColor.rgb = vec3(0.86, 0.85, 0.82);
  craftRough = 0.2;
  craftMetal = 1.0;
  craftBump = 0.35;
} else if (craftClass < 3.5) {
  diffuseColor.rgb = craftTint * 1.15;
  craftRough = 0.5;
} else if (craftClass < 4.5) {
  diffuseColor.rgb = craftTint;
  craftRough = 0.48;
  craftMetal = 0.4;
} else {
  float h = craftHash(cellId);
  diffuseColor.rgb = mix(vec3(0.012, 0.016, 0.04), vec3(0.02, 0.03, 0.075), h);
  craftRough = mix(0.08, 0.2, craftHash(cellId + 17.0));
  craftMetal = 0.3;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.16, 0.17), bars * 0.7);
  craftRough = mix(craftRough, 0.45, bars);
  craftMetal = mix(craftMetal, 0.6, bars * 0.7);
}
`;
export const CRAFT_ROUGHNESS = /* glsl */ `
roughnessFactor = craftRough;
`;
export const CRAFT_METALNESS = /* glsl */ `
metalnessFactor = craftMetal;
`;
/** After <lights_fragment_maps>: the dusk reflected in it (see craftSky). */
export const CRAFT_REFLECT = /* glsl */ `
{
  vec3 rv = normalize(mix(reflect(-geometryViewDir, geometryNormal), geometryNormal, material.roughness * material.roughness));
  radiance += craftSky(inverseTransformDirection(rv, viewMatrix), material.roughness);
}
`;
/** After <normal_fragment_maps>: crinkled foil, as a bump from noise in the model's own space. */
export const CRAFT_NORMAL = /* glsl */ `
{
  vec3 cp = vObj * 30.0;
  float ch = craftNoise(cp) * 0.65 + craftNoise(cp * 2.3 + 7.1) * 0.35;
  vec2 dh = vec2(dFdx(ch), dFdy(ch));
  vec3 sx = dFdx(-vViewPosition);
  vec3 sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, normal);
  vec3 r2 = cross(normal, sx);
  float det = dot(sx, r1);
  // Fade out before a crinkle is smaller than a few pixels.
  float keep = 1.0 - smoothstep(0.18, 0.5, length(fwidth(cp)));
  vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2) * 0.014 * craftBump * keep;
  normal = normalize(abs(det) * normal - grad);
}
`;

/**
 * The satellite's beam: a cone of soft light from under it to the cloud, brightest through its
 * middle, fading where it leaves the craft and as it sinks into the cloud, with pulses running
 * down it. Additive.
 */
export const BEAM_VS = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying float vY;
void main() {
  vY = uv.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
export const BEAM_FS = /* glsl */ `
uniform float uOn;
uniform float uTime;
uniform float uFlare;
varying vec3 vN;
varying vec3 vV;
varying float vY;
void main() {
  float core = pow(abs(dot(normalize(vN), normalize(vV))), 3.0);
  float along = smoothstep(0.0, 0.35, vY) * (1.0 - smoothstep(0.86, 1.0, vY));
  float k = fract(vY * 2.2 + uTime * 0.7);
  float pulse = 0.7 + 0.6 * exp(-pow((k - 0.5) / 0.08, 2.0));
  float a = core * along * pulse * uOn * (0.11 + 0.25 * uFlare);
  gl_FragColor = vec4(vec3(1.0, 0.76, 0.52) * a, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** A blinking light on the craft (a soft dot that keeps its size on screen). Additive. */
export const BEACON_VS = /* glsl */ `
attribute vec3 aColor;
attribute float aPhase;
uniform float uTime;
uniform float uScale;
uniform float uOn;
varying vec3 vColor;
varying float vA;
void main() {
  vColor = aColor;
  // A double flash every two seconds or so, each light in its own time.
  float t = fract(uTime * 0.45 + aPhase);
  vA = (exp(-pow((t - 0.05) / 0.018, 2.0)) + exp(-pow((t - 0.16) / 0.018, 2.0)) * 0.8 + 0.08) * uOn;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = 22.0 * uScale;
}
`;
export const BEACON_FS = /* glsl */ `
varying vec3 vColor;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  float a = (exp(-d * 18.0) * 1.6 + exp(-d * 4.0) * 0.25) * vA;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, 0.0);
  #include <colorspace_fragment>
}
`;

/**
 * The valley under the cloud, alive: the photo with a depth map, so it shifts in depth as the
 * pointer moves and as we sink into it, mist drifting through the valley and light slanting
 * across. Then it draws into a porthole of thick glass that flies back to orbit and lands on
 * the planet: the picture shrinks with the circle, refracted and split into colour at its rim.
 */
export const VALLEY_FS = /* glsl */ `
uniform sampler2D uPhoto;
uniform sampler2D uDepthMap;
uniform sampler3D uNoise;
uniform vec2 uRes;
uniform vec3 uCirc;       // centre (CSS px from the top left) and radius
uniform float uR0;        // the radius at which the picture fills the screen
uniform vec2 uPointer;    // -1…1
uniform float uDolly;     // 1 → 0: the last of the push into the valley
uniform float uTime;
uniform float uAspect;    // the photo's width / height
uniform float uAlpha;
uniform vec3 uMist;
varying vec2 vUv;
float vn(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return textureLod(uNoise, (i + f + 0.5) / 64.0, 0.0).r;
}
float vfbm(vec3 p) {
  return (0.5 * vn(p) + 0.25 * vn(p * 2.03 + 7.1) + 0.125 * vn(p * 4.1 + 3.3)) / 0.875;
}
vec2 cover(vec2 px) {
  vec2 c = px / uRes - 0.5;
  float sa = uRes.x / uRes.y;
  if (sa > uAspect) c.y *= uAspect / sa;
  else c.x *= sa / uAspect;
  return c + 0.5;
}
vec3 photo(vec2 px, float shift) {
  vec2 uv = cover(px);
  float depth = texture2D(uDepthMap, uv).r;
  // Depth parallax: near ground moves against the pointer, the sky barely at all.
  vec2 par = (uPointer * vec2(-0.011, 0.007) + vec2(0.0, 0.01) * uDolly) * (depth - 0.3);
  // The sky drifts.
  float sky = 1.0 - smoothstep(0.08, 0.14, depth);
  par.x += sky * (vfbm(vec3(uv * 3.0, uTime * 0.02)) - 0.5) * 0.006 + sky * sin(uTime * 0.05) * 0.004;
  uv = clamp(uv + par + vec2(shift, 0.0), 0.001, 0.999);
  return texture2D(uPhoto, uv).rgb;
}
void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  vec2 rel = px - uCirc.xy;
  float rl = length(rel);
  float d = rl - uCirc.z;
  float shrunk = 1.0 - smoothstep(uR0 * 0.85, uR0 * 0.99, uCirc.z);   // 0 while it fills the screen
  float glowOut = shrunk * (exp(-max(d, 0.0) / 10.0) * 0.8 + exp(-max(d, 0.0) / 46.0) * 0.45) * step(0.0, d);
  if (d > 1.0 && glowOut < 0.004) discard;
  // The picture holds still while the porthole closes in to the screen's height; after that it
  // shrinks with the circle, so it always fills it.
  float k = clamp(2.0 * uCirc.z / uRes.y, 1e-3, 1.0);
  vec2 nrm = rel / max(rl, 1e-3);
  // Thick glass at the rim: the picture bends inward and splits into colour.
  float rim = smoothstep(-36.0, 0.0, d) * shrunk;
  vec2 bend = nrm * rim * rim * 22.0;
  vec2 full = uRes * 0.5 + (rel - bend) / k;
  full = uRes * 0.5 + (full - uRes * 0.5) / (1.0 + 0.1 * uDolly);
  float chroma = rim * rim * 0.0035 / k;
  vec3 col = vec3(photo(full, chroma).r, photo(full, 0.0).g, photo(full, -chroma).b);
  // Mist in the valley, drifting; it gathers in the mid distance, not the sky or the slopes at our feet.
  vec2 uv = cover(full);
  float depth = texture2D(uDepthMap, uv).r;
  float band = smoothstep(0.1, 0.2, depth) * (1.0 - smoothstep(0.42, 0.7, depth));
  float m = vfbm(vec3(full / uRes.y * vec2(1.6, 3.2) + vec2(uTime * 0.018, 0.0), uTime * 0.025));
  col = mix(col, uMist, smoothstep(0.45, 0.8, m) * band * 0.5);
  // Light slanting in from the upper right, through the mist.
  vec2 sp = full / uRes;
  float shaft = vfbm(vec3((sp.x * 0.8 + sp.y * 1.3) * 6.0, uTime * 0.02, 1.7));
  col += vec3(1.0, 0.78, 0.55) * smoothstep(0.55, 0.85, shaft) * (1.0 - depth) * 0.07 * smoothstep(0.0, 0.6, sp.x);
  // Inside the porthole: a touch darker at the rim, a lit edge, and the window's reflection, an arc
  // of light across the upper left.
  col *= 1.0 - 0.14 * smoothstep(-60.0, 0.0, d) * shrunk;
  float edge = (1.0 - smoothstep(0.0, 2.2, abs(d + 1.2))) * shrunk;
  col += vec3(1.0, 0.84, 0.64) * edge * (0.75 + 0.6 * max(0.0, -nrm.y));
  float arc = smoothstep(-0.2, -0.85, nrm.x * 0.6 + nrm.y * 0.8) * smoothstep(-26.0, -8.0, d) * (1.0 - smoothstep(-8.0, -2.0, d));
  col += vec3(1.0, 0.95, 0.88) * arc * 0.28 * shrunk;
  float a = (1.0 - smoothstep(-0.8, 0.8, d));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  // Premultiplied, with a warm halo outside the glass.
  gl_FragColor = vec4(gl_FragColor.rgb * a + vec3(1.0, 0.64, 0.34) * glowOut * 0.5, max(a, glowOut * 0.25)) * uAlpha;
}
`;
