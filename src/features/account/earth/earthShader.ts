// The login page's Earth: one full-screen fragment shader. Each pixel casts a
// ray from the camera. Rays that hit the unit sphere shade the surface (NASA
// day imagery, clouds, sun glint on the oceans, city lights on the night side,
// haze toward the limb). Rays that miss see, back to front: the stars, the sun,
// a giant word standing behind the planet (so the Earth hides its foot), the
// atmosphere edge-on, and finally the lens (glare, streak, starburst).
// Filmic (ACES) tone mapping, a vignette and dithering keep gradients clean.

export const VERTEX_SHADER = /* glsl */ `#version 300 es
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform vec3 uCamPos;
uniform vec3 uCamR;
uniform vec3 uCamU;
uniform vec3 uCamF;
uniform vec3 uRestR;        // the camera at rest: the word is fixed to this view
uniform vec3 uRestU;
uniform vec3 uRestF;
uniform float uTanHalf;
uniform vec3 uSun;
uniform mat3 uEarth;        // world -> Earth-fixed (axial tilt, then spin)
uniform float uCloudShift;  // clouds drift a little against the ground (texture u)
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform sampler2D uClouds;
uniform sampler2D uWord;    // R: letter coverage, G: coverage x (light from above)
uniform float uTex;         // 0 until the imagery has loaded, then 1
uniform float uWordOn;      // 0 until the word is drawn, then 1
uniform float uWordRise;    // 0..1: the word rises from behind the Earth
uniform float uWordDrop;    // how far below its place the word starts, in pixels
uniform float uExposure;
uniform float uTime;
uniform vec2 uSunScreen;    // the sun in screen space (same units as p below)
uniform float uSunVis;      // how much of the sun clears the limb (0..1)
uniform float uSunAlt;      // altitude of the sun's ray at the limb (reddening)
uniform float uStars;
uniform float uDayness;     // how lit the Earth below is (0 night .. 1 day)

out vec4 fragColor;

#define PI 3.14159265359
const vec3 SKY = vec3(0.24, 0.52, 1.0);
const vec3 DUSK = vec3(1.0, 0.38, 0.12);
const vec3 SUN = vec3(1.0, 0.94, 0.86);

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 equirect(vec3 e) {
  return vec2(atan(e.x, e.z) * (0.5 / PI) + 0.5, 0.5 - asin(clamp(e.y, -1.0, 1.0)) / PI);
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p, int octaves) {
  float s = 0.0;
  float a = 0.5;
  for (int k = 0; k < 4; k++) {
    if (k >= octaves) break;
    s += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}

// Each star breathes on its own slow clock (5 to 18 s): two gentle waves
// multiplied, so the rhythm never visibly repeats. About a third of them
// scintillate instead: a quicker, uneven flicker (never fully out).
float breathe(float h) {
  float a = 0.5 + 0.5 * sin(uTime * (0.35 + 0.9 * h) + h * 40.0);
  float b = 0.5 + 0.5 * sin(uTime * (0.23 + 0.6 * fract(h * 7.3)) + h * 91.0);
  float calm = 0.6 + 0.4 * a * (0.55 + 0.45 * b);
  float r = fract(h * 13.7);
  float f = (0.5 + 0.5 * sin(uTime * (1.7 + 1.5 * r) + h * 63.0)) * (0.72 + 0.28 * sin(uTime * (4.3 + 2.1 * fract(h * 5.9)) + h * 17.0));
  return r < 0.34 ? 0.42 + 0.62 * f : calm;
}

// Stellar colour: blue-white, white, and the odd warm giant.
vec3 starTint(float h) {
  return h < 0.55 ? mix(vec3(0.72, 0.8, 1.0), vec3(1.0), h / 0.55) : mix(vec3(1.0), vec3(1.0, 0.8, 0.58), (h - 0.55) / 0.45);
}

// The Milky Way: a faint band across the sky, clumped, with dark dust lanes.
const vec3 GALAXY_NORMAL = vec3(0.568, -0.508, -0.648);
float galaxyBand(vec3 d) {
  float x = dot(d, GALAXY_NORMAL);
  return exp(-x * x / 0.028);
}
vec3 milkyWay(vec3 d) {
  float band = galaxyBand(d);
  if (band < 0.01) return vec3(0.0);
  float glow = fbm(d * 5.0, 3);
  float dust = smoothstep(0.4, 0.66, fbm(d * 11.0 + 3.7, 2)) * smoothstep(0.35, 0.9, band);
  vec3 tint = mix(vec3(0.5, 0.58, 0.85), vec3(0.95, 0.8, 0.62), smoothstep(0.35, 0.7, glow));
  return tint * band * (0.35 + 0.9 * glow) * (1.0 - 0.75 * dust) * 0.045;
}

// Stars are measured in screen pixels: each star's direction is projected
// through the camera, so a star is a soft round Gaussian and its diffraction
// spikes line up with the frame, as a real lens draws them. A dense faint
// layer (denser along the Milky Way), then a sparse bright layer with halos
// and fine spikes that glimmer as the star breathes.
vec3 skyDir(vec2 sp) {
  float c = cos(sp.y);
  return vec3(c * sin(sp.x), sin(sp.y), c * cos(sp.x));
}
vec2 onScreen(vec3 v, float k) {
  return vec2(dot(v, uCamR), dot(v, uCamU)) / dot(v, uCamF) * k;
}
vec3 starField(vec3 d, float k) {
  vec2 sp = vec2(atan(d.x, d.z), asin(clamp(d.y, -1.0, 1.0)));
  vec2 here = onScreen(d, k);
  vec3 acc = vec3(0.0);

  float scale = 95.0;
  vec2 cell = floor(sp * scale);
  float h = hash12(cell);
  if (h > 0.955 - 0.05 * galaxyBand(d)) {
    vec2 o = (vec2(hash12(cell + 7.13), hash12(cell + 3.71)) - 0.5) * 0.6;
    vec2 q = onScreen(skyDir((cell + 0.5 + o) / scale), k) - here;
    float m = fract(h * 37.0);
    acc += starTint(fract(h * 91.0)) * exp(-dot(q, q) / (0.45 + 0.55 * m)) * (0.24 + 0.7 * m * m) * breathe(h);
  }

  scale = 24.0;
  vec2 base = floor(sp * scale);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = base + vec2(i, j);
      float hb = hash12(c + 19.7);
      if (hb < 0.9) continue;
      vec2 o = (vec2(hash12(c + 1.9), hash12(c + 8.3)) - 0.5) * 0.7;
      vec2 q = onScreen(skyDir((c + 0.5 + o) / scale), k) - here;
      float m = (hb - 0.9) / 0.1;
      float b = breathe(hb);
      float r2 = dot(q, q);
      float core = exp(-r2 / (0.8 + 1.3 * m));
      float halo = exp(-sqrt(r2) / (2.5 + 4.0 * m)) * 0.13 * m;
      float reach = 2.6 + 6.0 * m * m;
      float spikes = (exp(-abs(q.y) * 1.8) * exp(-abs(q.x) / reach) + exp(-abs(q.x) * 1.8) * exp(-abs(q.y) / reach)) * 0.16 * m * m;
      acc += starTint(fract(hb * 53.0)) * (core * (0.55 + 0.95 * m) + halo + spikes * b) * b;
    }
  }
  return acc;
}

void main() {
  vec2 p = (2.0 * gl_FragCoord.xy - uRes) / uRes.y;
  vec3 rd = normalize(uCamR * (p.x * uTanHalf) + uCamU * (p.y * uTanHalf) + uCamF);
  vec3 ro = uCamPos;

  float b = dot(ro, rd);
  float c = dot(ro, ro) - 1.0;
  float disc = b * b - c;
  float tHit = -b - sqrt(max(disc, 0.0));
  bool hit = disc > 0.0 && tHit > 0.0;
  vec3 pc = ro + rd * max(-b, 0.0);
  float alt = length(pc) - 1.0;

  // Map position of the surface point (past the limb: of the nearest point on
  // the sphere, so the derivatives stay continuous). Derivatives come from
  // whichever of two u parameterisations is smooth here: no date-line seam.
  vec3 n = hit ? normalize(ro + rd * tHit) : normalize(pc);
  vec2 uv = equirect(uEarth * n);
  vec2 uvS = vec2(fract(uv.x + 0.5), uv.y);
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);
  vec2 dxS = dFdx(uvS);
  vec2 dyS = dFdy(uvS);
  if (dot(dxS, dxS) < dot(dx, dx)) dx = dxS;
  if (dot(dyS, dyS) < dot(dy, dy)) dy = dyS;

  // The word, fixed to the resting view (so it turns with the world, not the
  // screen), rising into place from behind the planet.
  float rq = dot(rd, uRestF);
  vec2 pr = vec2(dot(rd, uRestR), dot(rd, uRestU)) / (max(rq, 1e-4) * uTanHalf);
  vec2 wf = (pr * uRes.y + uRes) * 0.5 + vec2(0.0, uWordDrop * (1.0 - uWordRise));
  vec2 wuv = vec2(wf.x / uRes.x, 1.0 - wf.y / uRes.y);
  vec2 wt = texture(uWord, wuv).rg * uWordOn;
  float wcov = wt.r;

  float mu = dot(rd, uSun);
  vec3 sunCol = mix(DUSK * vec3(1.0, 0.85, 0.75), SUN, smoothstep(0.0, 0.045, uSunAlt));
  vec3 col = vec3(0.0005, 0.0007, 0.0013);

  if (hit) {
    float ndl = dot(n, uSun);
    vec3 day = textureGrad(uDay, uv, dx, dy).rgb;
    day *= day;
    float cloud = textureGrad(uClouds, vec2(uv.x + uCloudShift, uv.y), dx, dy).r;
    day = mix(vec3(0.003, 0.01, 0.03), day, uTex);
    cloud = smoothstep(0.12, 0.95, cloud) * uTex;

    float sunlit = max(ndl, 0.0);
    float term = smoothstep(-0.05, 0.2, ndl);
    // Blue Marble paints the oceans a deep blue: that is the water mask.
    float water = smoothstep(0.004, 0.03, day.b - max(day.r, day.g));
    vec3 ground = day * (1.55 * sunlit + 0.01);
    vec3 h = normalize(uSun - rd);
    float nh = max(dot(n, h), 0.0);
    ground += SUN * water * term * (1.0 - cloud) * (pow(nh, 160.0) * 2.4 + pow(nh, 18.0) * 0.05);
    ground = mix(ground, vec3(1.0) * (1.3 * sunlit + 0.008), cloud * 0.9);
    // A warm band where day turns to night.
    float band = exp(-pow((ndl - 0.02) / 0.1, 2.0));
    ground *= mix(vec3(1.0), vec3(1.4, 0.76, 0.52), band * 0.75);

    // City lights: sharp cores, a sodium halo from a blurred level of the same
    // map, and, where the map is magnified, each lit texel broken into points
    // (streets and blocks) instead of a smooth blob.
    vec2 nsz = vec2(textureSize(uNight, 0));
    float lod = 0.5 * log2(max(dot(dx * nsz, dx * nsz), dot(dy * nsz, dy * nsz)));
    float core = textureGrad(uNight, uv, dx, dy).r * uTex;
    float halo = textureLod(uNight, uv, max(lod, 0.0) + 2.6).r * uTex;
    vec2 g = uv * nsz * 3.0;
    vec2 gc = floor(g);
    vec2 jitter = vec2(hash12(gc + 5.3), hash12(gc + 9.1)) - 0.5;
    float speck = smoothstep(0.42, 0.0, length(fract(g) - 0.5 - jitter * 0.5)) * step(0.33, hash12(gc));
    core *= mix(1.0, 0.2 + 2.0 * speck, clamp(-lod * 0.6, 0.0, 1.0));
    float night = 1.0 - smoothstep(-0.18, 0.04, ndl);
    vec3 city = vec3(1.0, 0.87, 0.68) * pow(core, 1.2) * 1.35 + vec3(1.0, 0.5, 0.18) * halo * 0.55;
    col = ground + city * night * (1.0 - 0.82 * cloud);

    // Haze thickens toward the limb: blue by day, amber at dusk.
    float fres = pow(1.0 - max(dot(n, -rd), 0.0), 2.6);
    float lit = smoothstep(-0.32, 0.3, ndl);
    vec3 haze = mix(DUSK, SKY, smoothstep(0.0, 0.35, ndl)) * lit;
    col = mix(col, haze * 0.75, fres * 0.65) + haze * fres * 0.18;
  } else {
    // Deep space: the Milky Way and the stars, then the sun's disk.
    col += (milkyWay(rd) + starField(rd, uRes.y * 0.5 / uTanHalf)) * uStars;
    col += sunCol * smoothstep(0.99995, 0.99998, mu) * 60.0;

    // The word stands between the stars and the Earth. By day it catches the
    // light; with the sun behind it, it turns to a silhouette with a golden
    // rim; at night it is dark titanium in starlight: graphite faces that
    // brighten toward the top, and a fine cool bevel along every edge that
    // faces up and to the left, so the letters read as solid, sculpted forms
    // against the stars.
    float lightFromAbove = wt.g / max(wt.r, 1e-3);
    float backlit = uSunVis;
    float nightness = 1.0 - uDayness;
    vec3 wDay = vec3(0.62, 0.64, 0.68) * (0.5 + 0.5 * lightFromAbove);
    float rise = smoothstep(0.5, 1.0, lightFromAbove);
    vec3 wNight = vec3(0.0105, 0.011, 0.012) + vec3(0.024, 0.0245, 0.026) * rise * rise;
    vec3 wCol = mix(wNight, wDay, uDayness * (1.0 - 0.8 * backlit));
    col = mix(col, wCol, wcov);
    // The bevel: the part of each letter whose next few pixels up and to the
    // left are sky; a fainter line where the letter meets the sky on the
    // opposite sides.
    vec2 px = vec2(1.0 / uRes.x, 1.0 / uRes.y) * (uRes.y * 0.0024);
    vec2 sky = vec2(-0.5, -0.866) * px;
    float lit = 0.5 * texture(uWord, wuv + sky).r + 0.5 * texture(uWord, wuv + 2.4 * sky).r;
    float far = texture(uWord, wuv - 1.6 * sky).r;
    float bevel = max(wcov - lit * uWordOn, 0.0);
    float back = max(wcov - far * uWordOn, 0.0);
    col += vec3(0.27, 0.275, 0.285) * (bevel + 0.16 * back) * nightness * (1.0 - backlit);
    // Rim light: the part of each letter whose next few pixels toward the sun
    // are empty space (a soft, directional edge rather than a hard outline).
    vec2 toSun = normalize(uSunScreen - p + 1e-4) * vec2(1.0 / uRes.x, -1.0 / uRes.y) * (uRes.y * 0.0032);
    float ahead = 0.5 * texture(uWord, wuv + toSun).r + 0.5 * texture(uWord, wuv + 2.2 * toSun).r;
    col += sunCol * max(wcov - ahead * uWordOn, 0.0) * backlit * 2.4;

    // The atmosphere seen edge-on above the limb (in front of the word).
    float h = max(alt, 0.0);
    float shell = exp(-h / 0.011);
    float l = dot(normalize(pc), uSun);
    float dayRim = smoothstep(-0.12, 0.4, l);
    float duskRim = exp(-pow((l - 0.02) / 0.17, 2.0));
    float forward = pow(max(mu, 0.0), 10.0);
    vec3 rim = SKY * dayRim * 1.35 + DUSK * duskRim * (0.45 + 2.4 * forward);
    rim += vec3(0.2, 0.62, 0.48) * 0.04 * exp(-pow((h - 0.009) / 0.0028, 2.0));
    col = col * (1.0 - min(shell, 1.0) * 0.35) + rim * shell;
  }

  // The lens: glare, a streak and a starburst as the sun touches the limb.
  float glare = pow(max(mu, 0.0), 9000.0) * 6.0 + pow(max(mu, 0.0), 900.0) * 0.35 + pow(max(mu, 0.0), 40.0) * 0.035;
  col += sunCol * glare * uSunVis;
  vec2 ds = p - uSunScreen;
  float burst = clamp(uSunVis * (1.0 - uSunVis) * 4.0, 0.0, 1.0);
  float streak = exp(-abs(ds.y) * 120.0) * exp(-abs(ds.x) * 1.25) * (0.22 * uSunVis + 1.5 * burst);
  float spikes = pow(abs(cos(4.0 * atan(ds.y, ds.x) + 0.35)), 90.0) * exp(-length(ds) * 4.5) * burst * 1.3;
  col += sunCol * (streak + spikes);

  col *= uExposure;
  col = aces(col);
  col = pow(col, vec3(1.0 / 2.2));
  vec2 q = p * vec2(uRes.y / uRes.x, 1.0);
  col *= 1.0 - 0.16 * dot(q, q);
  col += (hash12(gl_FragCoord.xy + fract(uTime * 7.0) * 173.0) - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
}
`;
