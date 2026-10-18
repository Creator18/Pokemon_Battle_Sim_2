/**
 * UnitFx — the screen-space effects drawn ON a Pokémon's silhouette: the hit
 * flash, and the aura outline (docs/reference/EFFECTS.md, Part 2 §1).
 *
 * Both run after the image processing, at the very end of the camera's
 * post-process chain, so their colours reach the screen exactly as written —
 * the flash is the HP bar's colour, the aura the doc's palette. (Written in a
 * material, ACES would turn a bright green into a pale teal.)
 *
 * How a frame is made, only while something is showing:
 *  1. MASK. Both Pokémon are drawn into a render target, unit slot 0 in red
 *     and slot 1 in green, depth-tested against each other (so the one in
 *     front hides the other), multisampled so the edges are soft.
 *  2. DISTANCE. A jump flood at half resolution turns the mask into, for
 *     every pixel, the nearest pixel of each Pokémon (slot 0 in .xy, slot 1
 *     in .zw). Thresholding that distance is the doc's offset curve: one
 *     standoff all round the body, the same off the snout, belly and wingtip.
 *  3. COMPOSITE. Per pixel and per slot: on the body, tint (and flash);
 *     off it, the aura: a hot line round the body in a glow, the way the
 *     lightning glows (auraGlow), cut at the feet and bowed under them.
 *
 * Units are in screen pixels where the doc counts cells: half = half the
 * silhouette's height, stand = STAND·half·power, band = THICK·half.
 */

import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Effect } from '@babylonjs/core/Materials/effect';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
import { Constants } from '@babylonjs/core/Engines/constants';

import { auraPalette, auraHue, auraGlow, isFire, type RGB } from './auraPalette.ts';
import { SkinSampler } from '../render/skinSampler.ts';
import { partBones } from '../render/bodyParts.ts';

// ── the doc's constants (aura/mod.rs) ──────────────────────────────────
const STAND = 0.34; //       standoff, fraction of half-height
const THICK = 0.16; //       band, fraction of half-height
const THICK_MIN = 3; //      px
const TIGHT_STAND = 0.13; // a beam / claw outline (Reach::Cells): close to the body…
const BEAM_BAND = 0.47; //   …band = this × standoff
const PULSE = 0.58;
const WAVES = 1.0;
const RATE = 0.55; //        crest speed, heights per second
const SOFT = 0.34; //        rising front smear
const SWELL = 0.45;
const GROUND_BOW = 0.55;
/** On the ground, how deep the bottom curve dips under the body, × the standoff. */
const CURVE = 0.6;
const AIR_SOLE = 0.55; //    airborne: the cut sits this × standMax below the body
const TINT = 0.30;
const AMP = 0.45;
const LOW = 0.35;
const FLICKER = 0.6;
const FLICKER_POINTS = 72;
const FLICKER_ON = 0.35;
export const IGNITE = 0.70; // s, shine::IGNITE
export const DIE = 0.90; //    s, shine::DIE

/**
 * A focused aura coats one body part: it grows out from the part's own pixels
 * (the part mask), standing FOCUS_STAND and FOCUS_BAND as thick as an aura
 * round a whole body; over the body (the part itself, and whatever it reaches
 * across) it is FOCUS_OVER see-through.
 */
const FOCUS_STAND = 0.4, FOCUS_BAND = 0.7, FOCUS_OVER = 0.5;
/** Bone flags the part mask's shader takes (four to a vec4). */
const PART_BONES = 256;
const ZERO_FLAGS: number[] = new Array(PART_BONES).fill(0);
const JFA_STEPS = [64, 32, 16, 8, 4, 2, 1, 1]; // half-res px; reach ≤ 127 half px (+1 pass for accuracy)

export interface AuraOptions {
  /** Pokémon type whose palette to use. */
  element: string;
  /**
   * 'tongues': a charge's aura — the edge shivers, and a fire aura licks.
   * 'smooth':  a calm outline (beams, claws, a status move).
   */
  edge?: 'tongues' | 'smooth';
  /** 'body' stands well off the body; 'tight' hugs it (Reach::Cells). */
  reach?: 'body' | 'tight';
  /** Seconds to come fully up / to go out (default IGNITE / DIE). */
  ignite?: number;
  die?: number;
  /**
   * Filled: the whole shape inside the outline in the type's fill colour (a
   * lighter shade of the outline's), the body drawn over it. Default: on.
   */
  fill?: boolean;
  /** The edge shivers in and out round the body (default: with 'tongues'). */
  shiver?: boolean;
  /**
   * A strike: the factory works out which body part leads it (true: the
   * attack clip; 'swipe': a claw or a slash, the swipe where it has one) and
   * turns this into `focus` on it. UnitFx itself ignores it.
   */
  strike?: boolean | string;
  /**
   * A slash or claw move: a species that cuts with a blade of its own
   * (bodyParts.BLADES: Absol's horn) is coated there instead. UnitFx itself
   * ignores it.
   */
  blade?: boolean;
  /**
   * A body part (bodyParts.ts: 'head', 'left_hand', 'tail', 'right_wing'…)
   * or any bone name: the aura coats only that part (and all below it).
   */
  focus?: string;
  /**
   * Narrows `focus` to some of its vertices (a part with no bone of its own,
   * such as Absol's horn): per mesh, 1 for a vertex in the region, 0 out.
   * `key` names it (the flags are uploaded once per unit and key).
   */
  region?: { key: string; flags: Map<AbstractMesh, Float32Array> } | null;
}

export interface AuraHandle {
  /** Resolves when the aura is fully up. */
  readonly lit: Promise<void>;
  /** Let it go out; resolves when it is gone. */
  release(): Promise<void>;
}

interface Aura {
  opts: Required<AuraOptions>;
  pal: RGB[];
  hue: RGB;
  /** Outer glow, inner glow, line, fill (auraGlow). */
  glow: [RGB, RGB, RGB, RGB];
  lit: number; //  0..1 rising
  out: number; //  0..1 going out
  releasing: boolean;
  onLit: () => void;
  onGone: () => void;
  t0: number;
}

interface Flash { rgb: RGB; peak: number; hold: number; fade: number; t: number }

interface Unit {
  slot: number;
  root: TransformNode;
  meshes: AbstractMesh[];
  /** Shapes its clips switch on now and then (vines, claws out): in the masks while drawn, never sampled. */
  props: AbstractMesh[];
  skeleton: Skeleton | null;
  skin: SkinSampler;
  /** Off the ground (hovering): the floor cut drops below the body and nothing spills. */
  airborne: boolean;
  /** Effect geometry drawn into this unit's silhouette (a beam's shaft): no floor cut while any. */
  extras: Set<AbstractMesh>;
  auras: Aura[];
  flash: Flash | null;
  /** Held white (0..1): an evolving Pokémon glowing white, over any flash. */
  white: number;
  /** A body part's bones as flags (1 = in the part), by part name, for the part mask. */
  parts: Map<string, Float32Array>;
  /** The vertex region last uploaded to its meshes (AuraOptions.region), by key. */
  region: string | null;
}

// ── shaders ────────────────────────────────────────────────────────────
// The part mask: a unit drawn in its slot's colour only where its skin is
// weighted to the part's bones (skinned on the GPU, so whatever the pose),
// black elsewhere — black still hides what is behind it.
Effect.ShadersStore.unitFxPartVertexShader = `
precision highp float;
attribute vec3 position;
// A vertex region within the part (1 in, 0 out), when useRegion is on.
attribute float partRegion;
#include<bonesDeclaration>
uniform mat4 world;
uniform mat4 viewProjection;
uniform float useRegion;
uniform vec4 partFlags[${PART_BONES / 4}];
varying float vPart;
float flagOf(float bone) {
  int b = int(bone + 0.5);
  vec4 f = partFlags[b / 4];
  int c = b - (b / 4) * 4;
  return c == 0 ? f.x : c == 1 ? f.y : c == 2 ? f.z : f.w;
}
void main(void) {
  mat4 finalWorld = world;
#include<bonesVertex>
  float w = 0.0;
#if NUM_BONE_INFLUENCERS > 0
  w += flagOf(matricesIndices[0]) * matricesWeights[0];
#endif
#if NUM_BONE_INFLUENCERS > 1
  w += flagOf(matricesIndices[1]) * matricesWeights[1];
#endif
#if NUM_BONE_INFLUENCERS > 2
  w += flagOf(matricesIndices[2]) * matricesWeights[2];
#endif
#if NUM_BONE_INFLUENCERS > 3
  w += flagOf(matricesIndices[3]) * matricesWeights[3];
#endif
#if NUM_BONE_INFLUENCERS > 4
  w += flagOf(matricesIndicesExtra[0]) * matricesWeightsExtra[0];
#endif
#if NUM_BONE_INFLUENCERS > 5
  w += flagOf(matricesIndicesExtra[1]) * matricesWeightsExtra[1];
#endif
#if NUM_BONE_INFLUENCERS > 6
  w += flagOf(matricesIndicesExtra[2]) * matricesWeightsExtra[2];
#endif
#if NUM_BONE_INFLUENCERS > 7
  w += flagOf(matricesIndicesExtra[3]) * matricesWeightsExtra[3];
#endif
  vPart = useRegion > 0.5 ? w * partRegion : w;
  gl_Position = viewProjection * finalWorld * vec4(position, 1.0);
}`;

Effect.ShadersStore.unitFxPartFragmentShader = `
precision highp float;
varying float vPart;
uniform vec3 color;
void main(void) {
  gl_FragColor = vec4(vPart > 0.5 ? color : vec3(0.0), 1.0);
}`;

// The flood's seeds: each unit's silhouette — or, where its aura is focused
// on a part, that part's pixels in the part mask (so the field grows out from
// the part alone).
Effect.ShadersStore.unitFxSeedFragmentShader = `
precision highp float;
varying vec2 vUV;
uniform sampler2D maskSampler;
uniform sampler2D partSampler;
uniform vec2 usePart;
void main(void) {
  vec4 m = texture2D(maskSampler, vUV);
  vec4 pm = texture2D(partSampler, vUV);
  float s0 = usePart.x > 0.5 ? pm.r : m.r;
  float s1 = usePart.y > 0.5 ? pm.g : m.g;
  vec2 p = gl_FragCoord.xy - 0.5;
  gl_FragColor = vec4(s0 > 0.5 ? p : vec2(-1e4), s1 > 0.5 ? p : vec2(-1e4));
}`;

Effect.ShadersStore.unitFxFloodFragmentShader = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 texel;
uniform float stepPx;
void main(void) {
  vec2 p = gl_FragCoord.xy - 0.5;
  vec4 best = vec4(-1e4);
  float d0 = 1e9, d1 = 1e9;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec4 s = texture2D(textureSampler, vUV + vec2(float(x), float(y)) * stepPx * texel);
    if (s.x > -1e3) { float d = dot(s.xy - p, s.xy - p); if (d < d0) { d0 = d; best.xy = s.xy; } }
    if (s.z > -1e3) { float d = dot(s.zw - p, s.zw - p); if (d < d1) { d1 = d; best.zw = s.zw; } }
  }
  gl_FragColor = best;
}`;

Effect.ShadersStore.unitFxCompositeFragmentShader = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler; // nearest-pixel field (half res)
uniform sampler2D sceneSampler;   // the finished frame
uniform sampler2D maskSampler;
uniform vec2 fieldScale;          // full px per field px
uniform vec2 res;                 // this pass's size (gl_FragCoord units)
uniform float time;
uniform vec4 box[2];      // feet-bottom x0, y0 (feet), x1, y1 (top), gl px
uniform vec4 shape[2];    // power, stand, band, standMax
uniform vec4 flags[2];    // lobes (fire), shiver, front-of-other, active
uniform vec4 flash[2];    // rgb, amount
uniform vec4 extra[2];    // airborne, extras, zigzag (Electric: the outline is lightning), fill
uniform vec4 focus[2];    // focused on a body part: -, -, -, on (the field then grows from the part)
uniform vec3 hue[2];
uniform vec3 glowCol[8];  // per slot: outer glow, inner glow, line, fill
uniform vec4 shiverPts[36]; // 72 per slot, 4 per vec4

const float PI = 3.14159265;
const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);

// Luminance-preserving tint (aura::tinted): move toward the hue, keep L exactly,
// push chroma by up to 1+k while it stays in gamut.
vec3 tinted(vec3 c, vec3 tint, float k) {
  float L = dot(c, LUM);
  float Lt = max(dot(tint, LUM), 1e-4);
  vec3 mixed = c * (1.0 - k) + tint * (L / Lt) * k;
  vec3 d = mixed - vec3(L);
  float g = 1.0 + k;
  for (int i = 0; i < 3; i++) {
    if (d[i] > 1e-5) g = min(g, (1.0 - L) / d[i]);
    if (d[i] < -1e-5) g = min(g, -L / d[i]);
  }
  return clamp(vec3(L) + d * max(g, 0.0), 0.0, 1.0);
}

float shiverAt(int slot, float theta) {
  float f = (theta + PI) / (2.0 * PI) * 72.0;
  float k0 = floor(f);
  float w = 0.5 - 0.5 * cos(PI * (f - k0));
  int i0 = int(mod(k0, 72.0)) + slot * 72;
  int i1 = int(mod(k0 + 1.0, 72.0)) + slot * 72;
  float a = shiverPts[i0 / 4][i0 - (i0 / 4) * 4];
  float b = shiverPts[i1 / 4][i1 - (i1 / 4) * 4];
  return mix(a, b, w);
}

float h1(float x) { return fract(sin(x) * 43758.5453); }



float tongues(float theta, float up, float t) {
  float s = (sin(theta * 7.0 + t * 1.30) + sin(theta * 11.0 - t * 0.80) + sin(theta * 17.0 + t * 0.55)) / 3.0;
  s = s > 0.0 ? s : 0.33 * s;
  return 1.0 + ${AMP.toFixed(2)} * s * (${LOW.toFixed(2)} + (1.0 - ${LOW.toFixed(2)}) * clamp(up, 0.0, 1.0));
}

/**
 * The outline at pixel q (uv: where q is in the field): the weights of the
 * outer glow, the inner glow and the core, and the flicker. It glows the way
 * the lightning does (LightningFx): a hot line down the band's middle in a
 * saturated glow that spills both ways — laid OVER the scene in full-strength
 * colours, three layers standing in for the bloom this pass (after tone
 * mapping) never gets.
 */
// The ring at q: how far q is off the body, where the hot line runs (as a
// distance off the body), the line's half-width, and the flicker. False if no
// ring reaches q.
bool ringAt(int i, vec2 q, vec2 uv, out float off, out float lineAt, out float halfW, out float flick) {
  vec4 sh = shape[i];
  vec4 b = box[i];
  vec4 nq = texture2D(textureSampler, uv);
  vec2 seed = i == 0 ? nq.xy : nq.zw;
  off = seed.x < -1e3 ? 1e9 : length((seed + 0.5) * fieldScale - q);
  // Focused: the field grew from the body part alone (the part mask), so
  // \`off\` is how far q is off that part: it coats that part only.
  bool foc = focus[i].w > 0.5;
  lineAt = 0.0; halfW = 1.0; flick = 1.0;
  float H = max(b.w - b.y, 1.0);
  float hgt = clamp((q.y - b.y) / H, 0.0, 1.0);
  float beat = 1.0 + ${PULSE.toFixed(2)} * sin(2.0 * PI * (hgt * ${WAVES.toFixed(1)} - time * ${RATE.toFixed(2)}));
  float up = clamp((sh.x * (1.0 + ${SOFT.toFixed(2)}) - hgt) / ${SOFT.toFixed(2)}, 0.0, 1.0);
  if (up <= 0.0) return false;
  vec2 mid = vec2(0.5 * (b.x + b.z), b.y + 0.5 * H);
  float theta = atan(q.y - mid.y, q.x - mid.x);
  float lick = flags[i].x > 0.5 ? tongues(theta, hgt, time) : 1.0;
  float standHere = sh.y * (1.0 + ${SWELL.toFixed(2)} * (beat - 1.0)) * up * lick;
  if (flags[i].y > 0.5)
    standHere = max(standHere + shiverAt(i, theta) * ${FLICKER.toFixed(2)} * sh.z * up, 0.5 * standHere);
  // A coat on a hand hugs it closer than an aura round a body.
  if (foc) standHere *= ${FOCUS_STAND.toFixed(2)};
  // In the air the outline rounds under the body, bowed down under the
  // middle, and stops below the sole.
  if (extra[i].x > 0.5 && extra[i].y < 0.5) {
    float span = max(0.5 * (b.z - b.x), 1.0);
    float u = clamp((q.x - mid.x) / span, -1.0, 1.0);
    float sole = b.y - ${AIR_SOLE.toFixed(2)} * sh.w - ${GROUND_BOW.toFixed(2)} * sh.w * (1.0 - u * u);
    if (q.y < sole) return false;
  }
  float here = sh.z * beat * up * (foc ? ${FOCUS_BAND.toFixed(2)} : 1.0);
  lineAt = standHere - 0.5 * here;
  halfW = max(0.5 * here, 1.0);
  if (extra[i].z > 0.5) {
    // Electric: like a bolt it re-strikes (RESTRIKE 0.075 s) on a new
    // zigzag — corners round the outline, straight between.
    float tq = floor(time / 0.075);
    float f = (theta + PI) / (2.0 * PI) * 46.0;
    float k0 = floor(f), fr = f - k0;
    float j = mix(h1(mod(k0, 46.0) + tq * 57.0 + float(i) * 7.0), h1(mod(k0 + 1.0, 46.0) + tq * 57.0 + float(i) * 7.0), fr) - 0.5;
    lineAt += j * here * 0.9;
    flick = 0.9 + 0.1 * h1(tq * 13.0 + float(i));
  }
  return true;
}

/** Glow weights at d half-widths from the hot line: outer glow, inner glow, core. */
vec3 glowAt(float d) {
  return vec3(pow(max(0.0, 1.0 - d / 4.6), 1.6), pow(max(0.0, 1.0 - d / 1.8), 1.4), 1.0 - smoothstep(0.35, 0.75, d));
}

vec4 auraAt(int i, vec2 q, vec2 uv) {
  float off, lineAt, halfW, flick;
  if (!ringAt(i, q, uv, off, lineAt, halfW, flick)) return vec4(0.0);
  // Filled (struck): everything inside the hot line is the line itself.
  // Weights of the outer glow, the inner glow and the line (flickered), and
  // of the fill: filled, everything more than a line's width inside it.
  float sd = (off - lineAt) / halfW;
  if (extra[i].w > 0.5)
    return vec4(glowAt(max(sd, 0.0)) * flick, 1.0 - smoothstep(-1.0, -0.35, sd));
  return vec4(glowAt(abs(sd)) * flick, 0.0);
}

void main(void) {
  vec3 bg = texture2D(sceneSampler, vUV).rgb;
  vec3 col = bg;
  vec4 m = texture2D(maskSampler, vUV);
  vec4 near = texture2D(textureSampler, vUV);
  vec2 p = gl_FragCoord.xy;

  for (int i = 0; i < 2; i++) {
    if (flags[i].w < 0.5) continue;
    float mine = i == 0 ? m.r : m.g;
    float other = i == 0 ? m.g : m.r;
    vec4 sh = shape[i];
    float power = sh.x;

    if (power > 0.01) {
      vec4 b = box[i];
      float hgt = clamp((p.y - b.y) / max(b.w - b.y, 1.0), 0.0, 1.0);
      float up = clamp((power * (1.0 + ${SOFT.toFixed(2)}) - hgt) / ${SOFT.toFixed(2)}, 0.0, 1.0);
      if (up > 0.0) {
        if (mine > 0.5 && m.b > 0.5) {
          // Effect geometry (a beam) in the silhouette: outlined, never tinted.
        } else if (mine > 0.5) {
          if (focus[i].w > 0.5) {
            // A punch: the coat round the hand is laid over the body too,
            // see-through (FOCUS_OVER) — over the fist, and wherever the coat
            // reaches across the arm. The rest of the body is left alone.
            vec4 wb = auraAt(i, p, vUV);
            vec3 cb = mix(col, glowCol[i * 4], clamp(0.8 * wb.x, 0.0, 1.0));
            cb = mix(cb, glowCol[i * 4 + 1], clamp(0.9 * wb.y, 0.0, 1.0));
            cb = mix(cb, glowCol[i * 4 + 2], clamp(wb.z, 0.0, 1.0));
            cb = mix(cb, glowCol[i * 4 + 3], clamp(wb.w, 0.0, 1.0));
            col = mix(col, cb, ${FOCUS_OVER.toFixed(2)});
          } else {
            // The animal: hue and chroma only, never brightness.
            col = tinted(col, hue[i], ${TINT.toFixed(2)} * up);
          }
        } else if (mine < 0.5 && other < 0.5 && m.b > 0.5) {
          // An overlay (addOverlay: a wind spiral round the feet): drawn over the aura.
        } else if (!(other > 0.5 && flags[i].z < 0.5)) {
          vec4 w = vec4(0.0);
          if (extra[i].x > 0.5 || extra[i].y > 0.5 || focus[i].w > 0.5) {
            // In the air (or a beam): the whole outline, where it is.
            w = auraAt(i, p, vUV);
          } else {
            // On the ground the ring's sides stop at the feet line, and the
            // bottom joins them in a downward curve under the body: deepest
            // under the middle, rising to meet each side where it reaches the
            // ground, so the body is always inside the outline.
            vec2 g = vec2(p.x, b.y);
            float offG, lineG, halfG, flickG;
            bool atGround = ringAt(i, g, vUV + (g - p) / res, offG, lineG, halfG, flickG);
            // The sides' glow dies away just under the feet line, not in a hard edge.
            w = auraAt(i, p, vUV) * (1.0 - smoothstep(0.0, 1.5 * halfG, b.y - p.y));
            if (atGround) {
              // How far inside the ring's sides this column is at ground level:
              // 0 where a side meets the ground, 1 under the body.
              float inside = clamp((lineG - offG) / halfG + 0.5, 0.0, 1.0);
              float s = clamp((lineG - offG) / max(lineG, 1.0), 0.0, 1.0);
              // A round U: steep where it leaves the sides, flat at the bottom.
              float yLine = b.y - ${CURVE.toFixed(2)} * lineG * sqrt(s);
              if (extra[i].z > 0.5) {
                // Electric: it zigzags and re-strikes like the rest of the ring.
                float tq = floor(time / 0.075);
                float f = p.x / (3.0 * halfG);
                float k0 = floor(f), fr = f - k0;
                yLine += (mix(h1(k0 + tq * 31.0 + float(i) * 5.0), h1(k0 + 1.0 + tq * 31.0 + float(i) * 5.0), fr) - 0.5) * 0.9 * halfG;
              }
              // Filled: between the curve and the feet line is the line itself
              // (above the feet line the ring fills its own inside).
              bool filled = extra[i].w > 0.5;
              if (!(filled && p.y >= b.y)) {
                float sg = (yLine - p.y) / halfG; // > 0 outside (below the curve)
                vec4 wg = filled
                  ? vec4(glowAt(max(sg, 0.0)) * flickG, 1.0 - smoothstep(-1.0, -0.35, sg))
                  : vec4(glowAt(abs(sg)) * flickG, 0.0);
                w = max(w, wg * inside);
              }
            }
          }
          // The glow, the line in the outline's colour, then the fill inside it.
          vec3 c = mix(col, glowCol[i * 4], clamp(0.8 * w.x, 0.0, 1.0));
          c = mix(c, glowCol[i * 4 + 1], clamp(0.9 * w.y, 0.0, 1.0));
          c = mix(c, glowCol[i * 4 + 2], clamp(w.z, 0.0, 1.0));
          col = mix(c, glowCol[i * 4 + 3], clamp(w.w, 0.0, 1.0));
        }
      }
    }

    // The hit flash, over the body (the mask's soft edge is its alpha).
    if (flash[i].a > 0.0 && mine > 0.0 && m.b < 0.5) {
      float L = dot(col, LUM);
      col = mix(col, flash[i].rgb * (0.86 + 0.28 * L), flash[i].a * clamp(mine * 1.5, 0.0, 1.0));
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// ── deterministic per-point shiver (aura::shiver) ──────────────────────
function hash01(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function shiver(k: number, t: number): number {
  const W = 0.45 + 0.65 * hash01(k, 0x51ed);
  const hz = 5 + 4 * hash01(k, 0xa77e);
  const phi = 2 * Math.PI * hash01(k, 0x0c1a);
  const w = t / W + hash01(k, 0x3e77);
  const n = Math.floor(w);
  if (hash01(k ^ 0x9e3779b9, n) >= FLICKER_ON) return 0;
  const e = Math.sin(Math.PI * (w - n));
  return e * e * Math.sin(2 * Math.PI * hz * t + phi);
}

export class UnitFx {
  private units = new Map<TransformNode, Unit>();
  private mask: RenderTargetTexture;
  private maskMats: StandardMaterial[];
  /** The part mask (see unitFxPart) and its material per slot. */
  private partMask: RenderTargetTexture;
  private partMats: ShaderMaterial[];
  private usePart: [number, number] = [0, 0];
  private passes: PostProcess[] = [];
  private composite: PostProcess;
  private attached = false;
  private tick: Observer<Scene>;
  private time = 0;
  private uniforms = {
    box: new Float32Array(8), shape: new Float32Array(8), flags: new Float32Array(8),
    flash: new Float32Array(8), extra: new Float32Array(8), focus: new Float32Array(8), hue: new Float32Array(6), glow: new Float32Array(24),
    shiver: new Float32Array(144),
  };

  constructor(private readonly scene: Scene, private readonly camera: Camera) {
    const engine = scene.getEngine();

    this.mask = new RenderTargetTexture('unitFxMask', { ratio: 1 }, scene, false, true,
      Constants.TEXTURETYPE_UNSIGNED_BYTE, false, Texture.BILINEAR_SAMPLINGMODE, true);
    this.mask.clearColor = new Color4(0, 0, 0, 0);
    this.mask.samples = 4;
    this.mask.activeCamera = camera;
    this.mask.renderParticles = false;
    this.mask.renderSprites = false;
    this.mask.refreshRate = 1;
    this.maskMats = [new Color3(1, 0, 0), new Color3(0, 1, 0)].map((c, i) => {
      const m = new StandardMaterial(`unitFxMask${i}`, scene);
      m.disableLighting = true;
      m.emissiveColor = c;
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.fogEnabled = false;
      m.backFaceCulling = false;
      return m;
    });

    this.partMask = new RenderTargetTexture('unitFxPartMask', { ratio: 1 }, scene, false, true,
      Constants.TEXTURETYPE_UNSIGNED_BYTE, false, Texture.BILINEAR_SAMPLINGMODE, true);
    this.partMask.clearColor = new Color4(0, 0, 0, 0);
    this.partMask.samples = 4;
    this.partMask.activeCamera = camera;
    this.partMask.renderParticles = false;
    this.partMask.renderSprites = false;
    this.partMats = [new Vector3(1, 0, 0), new Vector3(0, 1, 0)].map((c, i) => {
      const m = new ShaderMaterial(`unitFxPart${i}`, scene, { vertex: 'unitFxPart', fragment: 'unitFxPart' }, {
        attributes: ['position', 'partRegion'],
        uniforms: ['world', 'viewProjection', 'partFlags', 'color', 'useRegion'],
      });
      m.backFaceCulling = false;
      m.setVector3('color', c);
      m.setFloat('useRegion', 0);
      m.setArray4('partFlags', new Array(PART_BONES).fill(0));
      return m;
    });

    // The flood: seed, then the steps. Each pass reads its own input and
    // writes into the next pass's, so every pass after the seed is the
    // half-res, half-float size its INPUT needs.
    const half = { ratio: 0.5 };
    const seed = new PostProcess('unitFxSeed', 'unitFxSeed', ['usePart'], ['maskSampler', 'partSampler'], 1.0, null,
      Texture.NEAREST_SAMPLINGMODE, engine as never, false);
    seed.onApply = (e) => {
      e.setTexture('maskSampler', this.mask);
      e.setTexture('partSampler', this.partMask);
      e.setFloat2('usePart', this.usePart[0], this.usePart[1]);
    };
    this.passes.push(seed);
    for (const stepPx of JFA_STEPS) {
      const pp = new PostProcess(`unitFxFlood${stepPx}`, 'unitFxFlood', ['texel', 'stepPx'], null, half.ratio, null,
        Texture.NEAREST_SAMPLINGMODE, engine as never, false, null, Constants.TEXTURETYPE_HALF_FLOAT);
      pp.onApply = (e) => {
        e.setFloat2('texel', 1 / pp.width, 1 / pp.height);
        e.setFloat('stepPx', stepPx);
      };
      this.passes.push(pp);
    }
    this.composite = new PostProcess('unitFxComposite', 'unitFxComposite',
      ['fieldScale', 'res', 'time', 'box', 'shape', 'flags', 'flash', 'extra', 'focus', 'hue', 'glowCol', 'shiverPts'],
      ['sceneSampler', 'maskSampler'], half.ratio, null, Texture.NEAREST_SAMPLINGMODE, engine as never, false,
      null, Constants.TEXTURETYPE_HALF_FLOAT);
    this.composite.onApply = (e) => {
      const u = this.uniforms;
      e.setTextureFromPostProcess('sceneSampler', seed);
      e.setTexture('maskSampler', this.mask);
      e.setFloat2('fieldScale', engine.getRenderWidth() / this.composite.width, engine.getRenderHeight() / this.composite.height);
      e.setFloat('time', this.time);
      e.setFloat2('res', this.composite.width, this.composite.height);
      e.setFloatArray4('box', u.box);
      e.setFloatArray4('shape', u.shape);
      e.setFloatArray4('flags', u.flags);
      e.setFloatArray4('flash', u.flash);
      e.setFloatArray4('extra', u.extra);
      e.setFloatArray4('focus', u.focus);
      e.setFloatArray3('hue', u.hue);
      e.setFloatArray3('glowCol', u.glow);
      e.setFloatArray4('shiverPts', u.shiver);
    };
    this.passes.push(this.composite);

    this.tick = scene.onBeforeRenderObservable.add(() => this.update());
  }

  /** Make a unit's silhouette available to effects. */
  register(root: TransformNode, meshes: AbstractMesh[], skeleton: Skeleton | null, props: AbstractMesh[] = []): void {
    const used = new Set([...this.units.values()].map((u) => u.slot));
    const slot = [0, 1].find((s) => !used.has(s));
    if (slot === undefined) return;
    this.units.set(root, { slot, root, meshes, props, skeleton, skin: new SkinSampler(meshes, skeleton), airborne: false, extras: new Set(), auras: [], flash: null, white: 0, parts: new Map(), region: null });
    this.refreshMaskList();
    for (const u of this.units.values()) {
      this.mask.setMaterialForRendering([...u.meshes, ...u.props], this.maskMats[u.slot]);
      this.partMask.setMaterialForRendering([...u.meshes, ...u.props], this.partMats[u.slot]);
    }
  }

  unregister(root: TransformNode): void {
    this.units.delete(root);
    this.refreshMaskList();
  }

  /**
   * The colour a unit's silhouette is drawn in in the mask — its slot's
   * channel, plus blue marking "effect, not body" (no tint or flash there).
   */
  maskColorFor(root: TransformNode): Color4 | null {
    const u = this.units.get(root);
    if (!u) return null;
    return u.slot === 0 ? new Color4(1, 0, 1, 1) : new Color4(0, 1, 1, 1);
  }

  /**
   * Draw `mesh` (with `material`, which must paint maskColorFor(root)) into
   * the unit's silhouette, so its aura outline wraps it too — a beam's shaft
   * (EFFECTS.md Part 3 §6). Returns the undo.
   */
  addToMask(root: TransformNode, mesh: AbstractMesh, material: Material): () => void {
    const u = this.units.get(root);
    if (!u) return () => {};
    u.extras.add(mesh);
    this.refreshMaskList();
    this.mask.setMaterialForRendering(mesh, material);
    return () => {
      u.extras.delete(mesh);
      this.refreshMaskList();
    };
  }

  /**
   * Draw `mesh` over every aura (an effect at a caster's feet — the wind
   * spiral — that the aura's glow would otherwise paint over). `material`
   * paints pure blue in the mask where the effect shows (blended by maximum,
   * so a body behind keeps its own colour). Returns the undo.
   */
  addOverlay(mesh: AbstractMesh, material: Material): () => void {
    this.overlays.add(mesh);
    this.refreshMaskList();
    this.mask.setMaterialForRendering(mesh, material);
    return () => {
      this.overlays.delete(mesh);
      this.refreshMaskList();
    };
  }

  private overlays = new Set<AbstractMesh>();

  private refreshMaskList(): void {
    this.mask.renderList = [...[...this.units.values()].flatMap((u) => [...u.meshes, ...u.props, ...u.extras]), ...this.overlays];
    // Every unit goes into the part mask (black where not the part), so a
    // part behind a body stays hidden behind it.
    this.partMask.renderList = [...this.units.values()].flatMap((u) => [...u.meshes, ...u.props]);
  }

  /** Tell the aura the unit is off the ground (hovering) or back on it. */
  setAirborne(root: TransformNode, on: boolean): void {
    const u = this.units.get(root);
    if (u) u.airborne = on;
  }

  has(root: TransformNode): boolean {
    return this.units.has(root);
  }

  /** Flash the body `rgb` (display colour): `hold` s at `peak`, then `fade` s out. */
  /** Hold the unit glowing white by `amount` (0..1) until set again (evolution). */
  setWhite(root: TransformNode, amount: number): void {
    const u = this.units.get(root);
    if (u) u.white = Math.max(0, Math.min(1, amount));
  }

  flash(root: TransformNode, rgb: RGB, { peak = 0.85, hold = 0.07, fade = 0.24 } = {}): void {
    const u = this.units.get(root);
    if (u) u.flash = { rgb, peak, hold, fade, t: 0 };
  }

  /** Light an aura outline round a unit. */
  aura(root: TransformNode, options: AuraOptions): AuraHandle {
    const u = this.units.get(root);
    const opts: Required<AuraOptions> = { edge: 'tongues', reach: 'body', ignite: IGNITE, die: DIE,
      // Every aura is a filled shape: the outline in the type's colour, a
      // lighter shade inside it (auraGlow).
      fill: true, shiver: (options.edge ?? 'tongues') === 'tongues', strike: false as boolean | string, blade: false, focus: '', region: null, ...options };
    const pal = auraPalette(opts.element);
    let onLit = () => {};
    let onGone = () => {};
    const lit = new Promise<void>((r) => { onLit = r; });
    const gone = new Promise<void>((r) => { onGone = r; });
    const a: Aura = { opts, pal, hue: auraHue(pal), glow: auraGlow(opts.element), lit: 0, out: 0, releasing: false, onLit, onGone, t0: this.time };
    if (!u) { onLit(); onGone(); } else u.auras.push(a);
    return {
      lit,
      release: () => { a.releasing = true; return gone; },
    };
  }

  // ── per frame ───────────────────────────────────────────────────────
  private update(): void {
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
    this.time += dt;
    let active = false;
    const U = this.uniforms;
    U.flags.fill(0);
    U.flash.fill(0);
    U.shape.fill(0);
    U.focus.fill(0);
    this.usePart = [0, 0];

    const camPos = this.camera.globalPosition;
    const others = [...this.units.values()];
    for (const u of this.units.values()) {
      const s = u.slot;
      // Clocks.
      for (const a of u.auras) {
        if (!a.releasing) {
          a.lit = Math.min(1, a.lit + dt / a.opts.ignite);
          if (a.lit >= 1) a.onLit();
        } else {
          a.out = Math.min(1, a.out + dt / a.opts.die);
        }
      }
      for (const a of u.auras.filter((x) => x.out >= 1)) { a.onLit(); a.onGone(); }
      u.auras = u.auras.filter((x) => x.out < 1);
      let flashAmt = 0;
      if (u.flash) {
        const f = u.flash;
        f.t += dt;
        const k = f.t < f.hold ? 1 : Math.max(0, 1 - (f.t - f.hold) / f.fade);
        flashAmt = f.peak * k * k;
        if (k <= 0) u.flash = null;
      }
      const aura = u.auras[u.auras.length - 1];
      const power = aura ? aura.lit * (1 - aura.out) : 0;
      if (!u.root.isEnabled() || (power <= 0.01 && flashAmt <= 0 && u.white <= 0)) continue;
      active = true;

      // Where the silhouette is on screen.
      const box = this.screenBox(u);
      U.box.set(box, s * 4);
      U.extra.set([u.airborne ? 1 : 0, u.extras.size ? 1 : 0, aura?.opts.element === 'Electric' ? 1 : 0, aura?.opts.fill ? 1 : 0], s * 4);
      if (aura?.opts.focus && this.partOn(u, aura.opts.focus)) {
        U.focus.set([0, 0, 0, 1], s * 4);
        this.usePart[s] = 1;
        this.regionOn(u, aura.opts.region);
      }
      // Held white (evolving) wins over a flash.
      const white = u.white > flashAmt;
      U.flash.set([...(white ? [1, 1, 1] as RGB : u.flash?.rgb ?? [1, 1, 1]), white ? u.white : flashAmt], s * 4);
      const inFront = others.every((o) => o === u
        || Vector3.DistanceSquared(camPos, u.root.getAbsolutePosition()) <= Vector3.DistanceSquared(camPos, o.root.getAbsolutePosition()));
      U.flags.set([aura && aura.opts.edge === 'tongues' && isFire(aura.opts.element) ? 1 : 0,
        aura && aura.opts.shiver ? 1 : 0, inFront ? 1 : 0, 1], s * 4);
      if (aura) {
        const half = Math.max(1, (box[3] - box[1]) / 2);
        let stand: number, band: number;
        if (aura.opts.reach === 'body') {
          stand = Math.max(1, STAND * half * power);
          band = Math.max(THICK_MIN, THICK * half);
        } else {
          stand = Math.max(1, TIGHT_STAND * half * power);
          band = Math.max(THICK_MIN * 0.67, stand * BEAM_BAND);
        }
        const standMax = stand * (1 + SWELL * PULSE);
        U.shape.set([power, stand, band, standMax], s * 4);
        U.hue.set(aura.hue, s * 3);
        aura.glow.forEach((c, k) => U.glow.set(c, (s * 4 + k) * 3));
        const t = this.time - aura.t0;
        for (let k = 0; k < FLICKER_POINTS; k++) U.shiver[s * FLICKER_POINTS + k] = shiver(k, t);
      }
    }
    this.setActive(active);
    const targets = this.scene.customRenderTargets;
    const want = active && (this.usePart[0] > 0 || this.usePart[1] > 0);
    const i = targets.indexOf(this.partMask);
    if (want && i < 0) targets.push(this.partMask);
    if (!want && i >= 0) targets.splice(i, 1);
    // Units without a focus draw all black into it.
    for (const u of this.units.values()) if (!this.usePart[u.slot]) this.partMats[u.slot].setArray4('partFlags', ZERO_FLAGS);
  }

  /** Narrow slot u's part mask to a vertex region (uploading its flags to the meshes once), or not. */
  private regionOn(u: Unit, region: AuraOptions['region']): void {
    this.partMats[u.slot].setFloat('useRegion', region ? 1 : 0);
    if (!region || u.region === region.key) return;
    u.region = region.key;
    for (const m of [...u.meshes, ...u.props]) {
      if (!(m instanceof Mesh)) continue;
      const flags = region.flags.get(m) ?? new Float32Array(m.getTotalVertices());
      m.setVerticesData('partRegion', flags, false, 1);
    }
  }

  /**
   * The silhouette's screen box in gl pixels (y up): x0, y0 = its lowest
   * point (the doc's "lowest row the animal painted"), x1, y1 = the top.
   * A skinned model is measured from a sample of its vertices skinned on the
   * CPU with this frame's bone matrices — exact to a pixel or two, where the
   * bones alone miss the wingtips and the top of the head.
   */
  private screenBox(u: Unit): [number, number, number, number] {
    const engine = this.scene.getEngine();
    const w = engine.getRenderWidth(), h = engine.getRenderHeight();
    // The camera's own matrices: the scene's current transform can belong to
    // whatever was drawn last (the shadow map, a render target).
    const vpm = this.camera.getViewMatrix().multiply(this.camera.getProjectionMatrix());
    const vp = this.camera.viewport.toGlobal(w, h);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const add = (p: Vector3) => {
      const sp = Vector3.Project(p, Matrix.IdentityReadOnly, vpm, vp);
      x0 = Math.min(x0, sp.x); x1 = Math.max(x1, sp.x);
      y0 = Math.min(y0, h - sp.y); y1 = Math.max(y1, h - sp.y);
    };
    u.skin.forEachPoint(add);
    return [x0, y0, x1, y1];
  }

  /**
   * Point slot u's part-mask material at a body part (bodyParts.ts: the part
   * and every bone below it); false if the rig has no such part.
   */
  private partOn(u: Unit, part: string): boolean {
    let flags = u.parts.get(part);
    if (!flags) {
      flags = new Float32Array(PART_BONES);
      for (const b of u.skeleton ? partBones(u.skeleton, part) : []) if (b.getIndex() < PART_BONES) flags[b.getIndex()] = 1;
      u.parts.set(part, flags);
    }
    if (!flags.some((f) => f > 0)) return false;
    this.partMats[u.slot].setArray4('partFlags', Array.from(flags));
    return true;
  }

  private setActive(on: boolean): void {
    if (on === this.attached) return;
    this.attached = on;
    const targets = this.scene.customRenderTargets;
    if (on) {
      if (!targets.includes(this.mask)) targets.push(this.mask);
      for (const pp of this.passes) this.camera.attachPostProcess(pp);
    } else {
      const i = targets.indexOf(this.mask);
      if (i >= 0) targets.splice(i, 1);
      for (const pp of this.passes) this.camera.detachPostProcess(pp);
    }
  }

  dispose(): void {
    this.setActive(false);
    this.scene.onBeforeRenderObservable.remove(this.tick);
    this.passes.forEach((p) => p.dispose());
    this.mask.dispose();
    this.maskMats.forEach((m) => m.dispose());
    const pi = this.scene.customRenderTargets.indexOf(this.partMask);
    if (pi >= 0) this.scene.customRenderTargets.splice(pi, 1);
    this.partMask.dispose();
    this.partMats.forEach((m) => m.dispose());
  }
}
