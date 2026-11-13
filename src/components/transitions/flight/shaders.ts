// GLSL for the flight transition. Camera space throughout: the camera sits at
// the origin looking down -z, so "towards the camera" (+z) is the sky above
// the jet and -z is the ground far below it.

// ------------------------------------------------------------------ jet

export const JET_VS = /* glsl */ `#version 300 es
in vec3 aPos;
in vec3 aNrm;
in vec2 aUv;
in float aMat;
uniform mat4 uProj;
uniform mat4 uModel;
out vec3 vPos;
out vec3 vN;
out vec3 vMPos;
out vec3 vMN;
out vec2 vUv;
flat out int vMat;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vPos = wp.xyz;
  vN = mat3(uModel) * aNrm;
  vMPos = aPos;
  vMN = aNrm;
  vUv = aUv;
  vMat = int(aMat + 0.5);
  gl_Position = uProj * wp;
}
`;

export const JET_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vPos;
in vec3 vN;
in vec3 vMPos;
in vec3 vMN;
in vec2 vUv;
flat in int vMat;
uniform vec3 uSun;   // towards the sun
uniform mat3 uEnv;   // camera space -> sky space (z up); identity for the view from above
out vec4 fragColor;
vec3 gSun;           // the sun in sky space

#define PI 3.14159265
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
float fill(float d) { float w = max(fwidth(d), 1e-5) * 0.8; return 1.0 - smoothstep(-w, w, d); }
float sdRound(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// A dusk sky above, the dark earth below; roughness widens the horizon and the sun.
vec3 sky(vec3 d, float rough) {
  float w = 0.02 + rough * 0.6;
  float up = smoothstep(-w, w, d.z);
  float h = clamp(d.z, 0.0, 1.0);
  vec3 c = mix(vec3(0.3, 0.33, 0.38), vec3(0.02, 0.032, 0.058), pow(h, mix(0.42, 1.0, rough)));
  vec2 sxy = normalize(gSun.xy + 1e-4);
  float az = max(dot(normalize(d.xy + 1e-4), sxy), 0.0);
  c += vec3(0.36, 0.27, 0.19) * pow(az, 3.0) * exp(-h * 7.0) * (1.0 - rough * 0.6);
  vec3 ground = mix(vec3(0.05, 0.055, 0.066), vec3(0.01, 0.012, 0.016), smoothstep(0.0, 0.45, -d.z));
  c = mix(ground, c, up);
  float sp = max(dot(d, gSun), 0.0);
  c += vec3(1.0, 0.93, 0.84) * pow(sp, mix(1400.0, 5.0, rough)) * mix(70.0, 0.5, rough);
  return c;
}

float ggx(float nh, float a) { float a2 = a * a; float d = nh * nh * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
float smithV(float nl, float nv, float a) { float k = a * 0.5; return 0.25 / ((nl * (1.0 - k) + k) * (nv * (1.0 - k) + k)); }
vec2 envBRDF(float nv, float r) {
  vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 rr = r * c0 + c1;
  float a004 = min(rr.x * rr.x, exp2(-9.28 * nv)) * rr.x + rr.y;
  return vec2(-1.04, 1.04) * a004 + rr.zw;
}
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

void main() {
  gSun = normalize(uEnv * uSun);
  vec3 P = vMPos;
  vec3 MN = normalize(vMN);
  vec3 AMBER = lin(vec3(0.902, 0.639, 0.416));
  vec3 alb = lin(vec3(0.925, 0.935, 0.945));
  float rough = 0.3;
  float metal = 0.0;
  float coat = 1.0;

  if (vMat == 0) {
    // Fuselage: white over a grey belly, amber cheatline, cabin windows, cockpit.
    alb = mix(alb, lin(vec3(0.72, 0.75, 0.79)), smoothstep(-0.2, -0.55, MN.y));
    float sideM = smoothstep(0.45, 0.72, abs(MN.x));
    float zBody = smoothstep(-17.5, -15.5, P.z) * (1.0 - smoothstep(23.0, 24.5, P.z));
    alb = mix(alb, AMBER, fill(abs(P.y - 0.02) - 0.07) * sideM * zBody);
    alb = mix(alb, lin(vec3(0.12, 0.13, 0.15)), fill(abs(P.y + 0.13) - 0.022) * sideM * zBody);
    float cabin = step(-13.6, P.z) * step(P.z, 21.0) * sideM;
    cabin *= step(0.72, abs(P.z - 20.2)) * step(0.72, abs(P.z - 10.4)) * step(0.72, abs(P.z + 1.6)) * step(0.72, abs(P.z + 12.4));
    float win = fill(sdRound(vec2(mod(P.z + 0.12, 0.53) - 0.265, P.y - 0.82), vec2(0.115, 0.19), 0.1)) * cabin;
    float tn = clamp((P.z - 22.0) / 11.3, 0.0, 1.0);
    float top = -0.35 + 3.33 * sqrt(max(1.0 - pow(tn, 2.3), 0.0));
    float bot = -0.35 - 2.63 * sqrt(max(1.0 - tn * tn, 0.0));
    float ang = atan(abs(P.x), P.y - 0.5 * (top + bot));
    float shield = fill(sdRound(vec2(ang - 0.74, tn - 0.585 + ang * 0.045), vec2(0.62, 0.048), 0.015)) * step(0.075, ang);
    float sideW = fill(sdRound(vec2(ang - 1.12, tn - 0.49), vec2(0.2, 0.036), 0.01));
    float glass = max(win, max(shield, sideW) * step(24.0, P.z));
    alb = mix(alb, lin(vec3(0.03, 0.04, 0.055)), glass);
    rough = mix(rough, 0.05, glass);
  } else if (vMat == 1) {
    // Wing and tailplanes: silver-grey paint, bare-metal leading edge, control surfaces.
    alb = lin(vec3(0.67, 0.7, 0.74));
    rough = 0.4;
    metal = 0.25;
    coat = 0.35;
    float c = vUv.x;
    float s = vUv.y;
    float onWing = step(0.2, MN.y) * step(-19.0, P.z) * step(abs(P.x), 30.0);
    float le = (1.0 - smoothstep(0.012, 0.03, c)) * step(-19.0, P.z);
    alb = mix(alb, lin(vec3(0.84, 0.86, 0.89)), le);
    metal = mix(metal, 1.0, le);
    rough = mix(rough, 0.16, le);
    float spoil = step(0.6, c) * step(c, 0.745) * step(2.5, s) * step(s, 19.5);
    alb = mix(alb, lin(vec3(0.66, 0.69, 0.73)), spoil * onWing);
    float line = fill(abs(c - 0.13) - 0.0025) * step(3.0, s) * step(s, 27.5);
    line = max(line, spoil * fill(abs(fract(s / 2.35 + 0.5) - 0.5) * 2.35 - 0.035));
    line = max(line, fill(abs(c - 0.755) - 0.003) * step(1.0, s) * step(s, 27.0));
    alb = mix(alb, lin(vec3(0.36, 0.38, 0.42)), line * onWing);
  } else if (vMat == 2) {
    // Engine cowl: white with a thin amber ring behind the lip.
    alb = mix(alb, AMBER, fill(abs(P.z - 6.5) - 0.06));
    rough = 0.28;
  } else if (vMat == 3) {
    alb = lin(vec3(0.93, 0.94, 0.95));
    metal = 1.0;
    rough = 0.13;
    coat = 0.0;
  } else if (vMat == 4) {
    alb = lin(vec3(0.045, 0.05, 0.058));
    metal = 0.6;
    rough = 0.45;
    coat = 0.0;
  } else if (vMat == 5) {
    // Livery: charcoal fin and winglets, amber winglet tips, the globe on the fin.
    alb = lin(vec3(0.1, 0.108, 0.125));
    rough = 0.28;
    if (abs(P.x) > 30.3) alb = mix(alb, AMBER, smoothstep(3.1, 3.5, P.y));
    if (abs(P.x) < 1.5 && P.y > 2.2) {
      vec2 q = vec2(P.z + 26.4, P.y - 7.2);
      float Rg = 2.1;
      float r = length(q);
      float inside = step(r, Rg);
      float logo = fill(abs(r - Rg) - 0.13);
      logo = max(logo, fill(abs(q.y) - 0.1) * inside);
      logo = max(logo, fill(abs(abs(q.y) - Rg * 0.52) - 0.085) * inside);
      logo = max(logo, fill(abs(length(q / vec2(Rg * 0.44, Rg)) - 1.0) * Rg * 0.44 - 0.1) * inside);
      alb = mix(alb, AMBER, logo);
    }
  } else {
    alb = lin(vec3(0.55, 0.57, 0.6));
    metal = 0.9;
    rough = 0.32;
    coat = 0.0;
  }

  vec3 N = normalize(vN);
  vec3 V = normalize(-vPos);
  vec3 L = uSun;
  vec3 H = normalize(L + V);
  float nl = max(dot(N, L), 0.0);
  float nv = max(dot(N, V), 1e-3);
  float nh = max(dot(N, H), 0.0);
  float vh = max(dot(V, H), 0.0);
  float a = max(rough * rough, 0.002);
  vec3 f0 = mix(vec3(0.04), alb, metal);
  vec3 F = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
  vec3 kd = (1.0 - metal) * (1.0 - F);
  vec3 sun = vec3(1.0, 0.95, 0.88) * 2.5;
  vec3 R = reflect(-V, N);
  vec2 ab = envBRDF(nv, rough);

  vec3 col = (kd * alb + ggx(nh, a) * smithV(nl, nv, a) * F * PI) * sun * nl;
  col += kd * alb * sky(uEnv * N, 1.0) * 1.35;
  col += sky(uEnv * R, rough) * (f0 * ab.x + ab.y);

  // Clear coat over the paint: a sharp second reflection of the sky and the sun.
  float fc = (0.04 + 0.96 * pow(1.0 - nv, 5.0)) * coat;
  col *= 1.0 - fc;
  col += fc * (sky(uEnv * R, 0.05) + ggx(nh, 0.0025) * smithV(nl, nv, 0.0025) * PI * sun * nl);

  col = aces(col * 1.05);
  fragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}
`;

// ------------------------------------------------------------ light glows

export const GLOW_VS = /* glsl */ `#version 300 es
in vec2 aPos;
in vec2 aUv;
in vec4 aColor;  // rgb intensity, star-streak amount
out vec2 vUv;
out vec4 vColor;
void main() {
  vUv = aUv;
  vColor = aColor;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const GLOW_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
in vec4 vColor;
out vec4 fragColor;
void main() {
  float r2 = dot(vUv, vUv);
  float glow = exp(-r2 * 26.0) + exp(-r2 * 5.0) * 0.26;
  // A four-point star for the strobes.
  float fade = 1.0 - smoothstep(0.0, 1.0, sqrt(r2));
  glow += vColor.a * (exp(-abs(vUv.y) * 34.0) + exp(-abs(vUv.x) * 34.0) * 0.55) * fade;
  vec3 c = vColor.rgb * glow;
  fragColor = vec4(c, clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0));
}
`;

// ------------------------------------------------------------- the shadow

/** The jet's silhouette, into a small target that is then blurred through its mips. */
export const SIL_FS = /* glsl */ `#version 300 es
precision mediump float;
out vec4 fragColor;
void main() { fragColor = vec4(1.0); }
`;

export const FULL_VS = /* glsl */ `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/** A soft shadow: the silhouette sampled from a blurry mip, a few taps wide. */
export const SHADOW_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uLod;
uniform float uAlpha;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 px = 1.0 / vec2(textureSize(uTex, 0)) * exp2(uLod);
  float a = textureLod(uTex, uv, uLod).r * 0.4;
  a += textureLod(uTex, uv + vec2(px.x, 0.0), uLod).r * 0.15;
  a += textureLod(uTex, uv - vec2(px.x, 0.0), uLod).r * 0.15;
  a += textureLod(uTex, uv + vec2(0.0, px.y), uLod).r * 0.15;
  a += textureLod(uTex, uv - vec2(0.0, px.y), uLod).r * 0.15;
  fragColor = vec4(0.0, 0.0, 0.0, a * uAlpha);
}
`;

// ---------------------------------------------------------- the wake edges

/** Flat premultiplied colour per vertex: the cut-edge shade and the vortex hairlines. */
export const EDGE_VS = /* glsl */ `#version 300 es
in vec2 aPos;
in vec4 aColor;
out vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const EDGE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 fragColor;
void main() { fragColor = vColor; }
`;
