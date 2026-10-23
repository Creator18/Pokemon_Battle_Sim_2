/**
 * The pond surface: afl_ext's ocean shader (2017–2024, MIT License —
 * https://www.shadertoy.com/view/MdXyzX), turned from a full-screen raymarch
 * into a material for a tile's top. The surface is real geometry: a finely
 * subdivided hex (pondMesh) whose vertices rise on the waves (fewer octaves,
 * VERTEX_ITERATIONS, the original's raymarch count), up to WAVE_HEIGHT above
 * the tile and calming to flat along any edge on land (its `fade`); the
 * normals come from the full waves per pixel. The view ray comes from the
 * scene's camera, and the sun holds still. Fresnel reflection of the cheap atmosphere and the sun, plus
 * a little subsurface scattering, tonemapped with ACES — as the original.
 */
import type { Scene } from '@babylonjs/core/scene';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';

/** World units → wave space: how many wave units a world metre spans. */
const WAVE_SCALE = 2.4;
/** How deep the waves read (their height, for the normals). */
const WATER_DEPTH = 1.0;
/** Wave octaves summed for the normals (the original's ITERATIONS_NORMAL is 36). */
const ITERATIONS_NORMAL = 28;
/** How strongly the waves pull on each other (the original's DRAG_MULT). */
const DRAG_MULT = 0.38;
/** Wave octaves for the surface's height, per vertex (the original's ITERATIONS_RAYMARCH is 12). */
const VERTEX_ITERATIONS = 12;
/** How high the waves stand above the tile top (world units, at a wave's crest). */
const WAVE_HEIGHT = 0.12;
/** Brightens the result a little: the original lights an open ocean; a pond on a sunny board reads darker. */
const EXPOSURE = 2.6;

/** The waves (shared by both stages): wavedx, getwavesN (any octave count) and getwaves (the normals' count). */
const WAVES = /* glsl */ `
float getwavesN(vec2 position, int iterations);
vec2 wavedx(vec2 position, vec2 direction, float frequency, float timeshift) {
  float x = dot(direction, position) * frequency + timeshift;
  float wave = exp(sin(x) - 1.0);
  float dx = wave * cos(x);
  return vec2(wave, -dx);
}

float getwaves(vec2 position) { return getwavesN(position, ${ITERATIONS_NORMAL}); }
float getwavesN(vec2 position, int iterations) {
  float wavePhaseShift = length(position) * 0.1;
  float iter = 0.0;
  float frequency = 1.0;
  float timeMultiplier = 2.0;
  float weight = 1.0;
  float sumOfValues = 0.0;
  float sumOfWeights = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= iterations) break;
    vec2 p = vec2(sin(iter), cos(iter));
    vec2 res = wavedx(position, p, frequency, iTime * timeMultiplier + wavePhaseShift);
    position += p * res.y * weight * ${DRAG_MULT.toFixed(2)};
    sumOfValues += res.x * weight;
    sumOfWeights += weight;
    weight = mix(weight, 0.0, 0.2);
    frequency *= 1.18;
    timeMultiplier *= 1.07;
    iter += 1232.399963;
  }
  return sumOfValues / sumOfWeights;
}

`;

Effect.ShadersStore.pondWaterVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute float fade;
uniform mat4 world, viewProjection;
uniform float iTime;
varying vec3 vWorld;
varying float vFade;
${WAVES}
void main(void) {
  vec4 w = world * vec4(position, 1.0);
  // Up on the waves (never below the tile: they run 0..1), flat at the shore.
  w.y += getwavesN(w.xz * ${WAVE_SCALE.toFixed(2)}, ${VERTEX_ITERATIONS}) * ${WAVE_HEIGHT.toFixed(3)} * fade;
  vWorld = w.xyz;
  vFade = fade;
  gl_Position = viewProjection * w;
}`;

Effect.ShadersStore.pondWaterFragmentShader = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying float vFade;
uniform vec3 cameraPos;
uniform float iTime;

${WAVES}
vec3 waveNormal(vec2 pos, float e, float depth) {
  vec2 ex = vec2(e, 0);
  float H = getwaves(pos) * depth;
  vec3 a = vec3(pos.x, H, pos.y);
  return normalize(cross(
    a - vec3(pos.x - e, getwaves(pos - ex.xy) * depth, pos.y),
    a - vec3(pos.x, getwaves(pos + ex.yx) * depth, pos.y + e)));
}

vec3 extra_cheap_atmosphere(vec3 raydir, vec3 sundir) {
  float special_trick = 1.0 / (raydir.y * 1.0 + 0.1);
  float special_trick2 = 1.0 / (sundir.y * 11.0 + 1.0);
  float raysundt = pow(abs(dot(sundir, raydir)), 2.0);
  vec3 suncolor = mix(vec3(1.0), max(vec3(0.0), vec3(1.0) - vec3(5.5, 13.0, 22.4) / 22.4), special_trick2);
  vec3 bluesky = vec3(5.5, 13.0, 22.4) / 22.4 * suncolor;
  vec3 bluesky2 = max(vec3(0.0), bluesky - vec3(5.5, 13.0, 22.4) * 0.002 * (special_trick + -6.0 * sundir.y * sundir.y));
  bluesky2 *= special_trick * (0.24 + raysundt * 0.24);
  return bluesky2 * (1.0 + 1.0 * pow(1.0 - raydir.y, 3.0));
}

// A still sun, high over the board.
vec3 sunDir() { return normalize(vec3(-0.0773502691896258, 0.62, 0.5773502691896258)); }
vec3 getAtmosphere(vec3 dir) { return extra_cheap_atmosphere(dir, sunDir()) * 0.5; }
float getSun(vec3 dir) { return pow(max(0.0, dot(dir, sunDir())), 720.0) * 210.0; }

vec3 aces_tonemap(vec3 color) {
  mat3 m1 = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  mat3 m2 = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  vec3 v = m1 * color;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return pow(clamp(m2 * (a / b), 0.0, 1.0), vec3(1.0 / 2.2));
}

void main(void) {
  vec3 ray = normalize(vWorld - cameraPos);
  vec2 wpos = vWorld.xz * ${WAVE_SCALE.toFixed(2)};
  float dist = length(vWorld - cameraPos) * ${WAVE_SCALE.toFixed(2)};
  vec3 N = waveNormal(wpos, 0.01, ${WATER_DEPTH.toFixed(2)});
  // Calmer with distance (the original's smoothing, against shimmer).
  N = mix(N, vec3(0.0, 1.0, 0.0), 0.8 * min(1.0, sqrt(dist * 0.01) * 1.1));
  // Calm at the shore, as the surface is.
  N = normalize(mix(vec3(0.0, 1.0, 0.0), N, 0.35 + 0.65 * vFade));
  float fresnel = 0.04 + (1.0 - 0.04) * pow(1.0 - max(0.0, dot(-N, ray)), 5.0);
  vec3 R = normalize(reflect(ray, N));
  R.y = abs(R.y);
  vec3 reflection = getAtmosphere(R) + getSun(R);
  float h = getwaves(wpos) * ${WATER_DEPTH.toFixed(2)};
  vec3 scattering = vec3(0.0293, 0.0698, 0.1717) * 0.1 * (0.2 + h / ${WATER_DEPTH.toFixed(2)});
  vec3 C = fresnel * reflection + scattering;
  gl_FragColor = vec4(aces_tonemap(C * ${EXPOSURE.toFixed(2)}), 1.0);
}`;

/** One material for every pond tile (they share the waves, so neighbours join seamlessly). */
export function pondWaterMaterial(scene: Scene): ShaderMaterial {
  const mat = new ShaderMaterial('pondWater', scene, { vertex: 'pondWater', fragment: 'pondWater' }, {
    attributes: ['position', 'fade'],
    uniforms: ['world', 'viewProjection', 'cameraPos', 'iTime'],
  });
  mat.backFaceCulling = false;
  const start = performance.now();
  mat.onBindObservable.add(() => {
    const cam = scene.activeCamera;
    const e = mat.getEffect();
    if (!e) return;
    if (cam) e.setVector3('cameraPos', cam.globalPosition);
    e.setFloat('iTime', (performance.now() - start) / 1000);
  });
  return mat;
}
