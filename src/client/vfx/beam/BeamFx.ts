/**
 * BeamFx — the beam attack, built the way Harry Alisavakis builds his anime
 * laser beam ("Crafting a Dragon Ball VFX in Unity", 80.lv, 2019): layered
 * simple meshes, each with an unlit "master shader" that pans noise along
 * itself, dissolves (cuts out) where the noise is under a threshold, and
 * displaces a little; and around them the things he says actually sell it —
 * a light that follows the beam, screen shake and a radial blur on launch.
 *
 * All procedural (value-noise fbm in the shaders; no textures):
 *
 *   beam      three nested open tubes, mouth → target: a hot core, the
 *             element's bright colour, and a torn black outer skin, each
 *             panning its noise at its own speed for depth. The whole beam
 *             holds a steady thickness.
 *   swirls    three ribbons wound round the beam (vertex-shader helix) —
 *             or, with SWIRL_TORNADO, a tornado wrapped round it instead,
 *             spinning fast.
 *   ball      the charging sphere: three nested spheres in the beam's own
 *             materials. During the wind-up it swells toward 120% while
 *             particles stream in; on launch it snaps to nothing and pops
 *             back to full as the beam fires.
 *   slashes   two squashed rings that blow out from the ball and dissolve.
 *   dust      two nested cones of spiky dust round the attacker's feet,
 *             panning opposite ways, scaled in on launch, dissolved out.
 *   sparks    glowing streak sparks (GlowSparks: the user's "sparks" and
 *             BigWings' sparkler shaders) — swirling into the ball as it
 *             charges; once the beam reaches the target, light small ones
 *             splashing off the contact point (never past it).
 *   light     a point light at the root whose strength follows the beam.
 *   launch    screen shake and a radial blur from the root.
 *
 * Timeline: fire() → the charge (during the wind-up clip); open() → the
 * launch, the front races out (GROW s) and the hit lands when it arrives;
 * release(s) → everything dissolves.
 */

import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Vector3, Vector2, Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Constants } from '@babylonjs/core/Engines/constants';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
import '@babylonjs/core/Meshes/Builders/sphereBuilder';
import '@babylonjs/core/Meshes/Builders/cylinderBuilder';

import { auraGlow } from '../auraPalette.ts';
import { smoothstep } from '../bolt.ts';
import { GlowSparks, type GlowSparkStyle } from './GlowSparks.ts';

type RGB = [number, number, number];

// ── sizes (model heights, H = the attacker's displayed height) and timing ──
export const ROOT = 0.45; //                 the ball sits this far along the aim from the mouth (clear of the face)
export const BEAM_R = [0.12, 0.18, 0.24]; // core, bright, torn skin
/**
 * The core's aura outline: a twin of each core piece (its tube, its ball, its
 * clash half, its tip and bursts) in its type's aura outline colour, as wide
 * again as OUTLINE_GROW, only its far side drawn (an inverted hull): behind
 * its core, so only its rim shows — and solid, writing its depth, so nothing
 * further off (the other beam) shows over it; it tears where the core
 * does, a little less (OUTLINE_CUT × its cutoff), so the border rims its tears too.
 */
const OUTLINE = true, OUTLINE_GROW = 1.6, OUTLINE_CUT = 0.6;
/** A soft outline's glow (BeamSpec.outline 'soft'): how far in from its edge it is whole (its facing, 0 edge-on … 1 straight behind). */
const OUTLINE_SOFT_IN = 0.75;
/**
 * The outline's spikes: its edge risen into spikes that stream forward along
 * the beam — measured from the egg's centre (the beam's origin) — each a
 * steep rise and a slow fall (leaning forward, as a flame's tongue in the
 * flow), staggered round the beam so they flicker rather than band. How far
 * a spike rises (× the core's radius, on top of OUTLINE_GROW), how far apart
 * they come (× the radius), how fast they travel (spikes a second), and how
 * much round the beam staggers them.
 */
const SPIKE = 0.6, SPIKE_GAP = 1.6, SPIKE_RATE = 3.2, SPIKE_STAGGER = 0.45;
/** And how far a spike's tip leans forward, the way the beam travels (× the core's radius, at a spike's full height). */
const SPIKE_LEAN = 1.4;
/** A spike's profile (GLSL): rising slowly from behind to its tip near its front, then falling away quickly (SPIKE_FRONT of it) — never a cliff. */
const SPIKE_FRONT = 0.15;
const SPIKE_GLSL = `float spikeAt(float along, float th, float rad, float time) {
  float x = along / (${SPIKE_GAP.toFixed(2)} * rad) - time * ${SPIKE_RATE.toFixed(2)} + ${SPIKE_STAGGER.toFixed(2)} * sin(th * 3.0 + 1.7) + 0.25 * sin(th * 7.0 - 0.6);
  float s = fract(x);
  return s < ${(1 - SPIKE_FRONT).toFixed(2)} ? pow(s / ${(1 - SPIKE_FRONT).toFixed(2)}, 2.5) : (1.0 - s) / ${SPIKE_FRONT.toFixed(2)};
}`;
/**
 * Rings of stars round the core, travelling from the mouth to the end: four-
 * pointed stars (a diamond whose sides curve in: RING_STAR, 1 a plain diamond),
 * each drawn out along the way it travels — its length RING_LEN of the
 * circumference, its width round the ring RING_WIDE of it (long and thin). Round
 * the ring, RING_SLOTS places a star may sit; whether one does follows a slow
 * swell round it (RING_BUNCH: its waves round the ring), so they bunch in
 * places and thin out in others. Two sets at once, evenly spaced along the
 * beam: [how many, how fast (beam lengths a second)] — one slow, one fast.
 * Each ring a new pattern every time round. On the core's surface
 * (RING_GROW), in its type's outline colour.
 */
const RINGS = true, RING_SLOTS = 24, RING_LEN: [number, number] = [0.06, 0.16], RING_WIDE: [number, number] = [0.014, 0.024];
const RING_STAR = 0.65, RING_BUNCH: [number, number] = [2, 4], RING_GROW = 1.06;
const RING_SETS: [number, number][] = [[4, 0.35], [3, 0.8]];
/**
 * The column is an elongated oval along its length: OVAL_END × its radius
 * where it leaves the egg and where it reaches the target, OVAL_MID × in the
 * middle (an ellipse between).
 */
const OVAL_END = 0.7, OVAL_MID = 1.2;
/** Each ball layer is its tube layer a little swollen, so the tube flows out of it. */
const BALL_OVER = 1.45;
const SPHERE_R = BEAM_R.map((r) => r * BALL_OVER);
/**
 * Once the beam pours, the ball becomes an egg along the aim: its back half
 * (toward the attacker) full and a little long (EGG_BACK × its radius), its
 * front half drawn out (EGG_FRONT ×) and narrowing to the column's own width
 * at its start, so it runs straight into the column. EGG_IN s to take shape.
 */
const EGG_BACK = 1.15, EGG_FRONT = 2.2, EGG_IN = 0.25;
const EGG_TIP = OVAL_END / BALL_OVER;
const SWIRL_R = 0.30, SWIRL_W = 0.05, SWIRLS = 3;
/**
 * The swirls a tornado instead (one tube round the beam, the aura tornado's
 * streaks on it, winding round and running toward the target), not three
 * ribbons: how many streaks round it (an integer, so they meet seamlessly),
 * how far they wind per radius along, how fast they turn and run.
 */
const SWIRL_TORNADO = true, TORNADO_STREAKS = 4, TORNADO_TWIST = 0.55, TORNADO_SPIN = 9, TORNADO_FLOW = 3.2;
/**
 * On a billowing beam (burstAlong, Flamethrower) its tornado bursts, over and
 * over: TORNADO_BURSTS swellings along it at once, each riding from the root
 * to the front in TORNADO_RIDE s, swelling it to TORNADO_SWELL × its radius,
 * its streaks tearing apart where it swells (as the puffs do).
 */
const TORNADO_BURSTS = 3, TORNADO_RIDE = 0.55, TORNADO_SWELL = 2.0;
/** Beams whose tornado bursts too, though they do not billow (no puffs): their types. */
const TORNADO_BURSTING = new Set(['Water']);
export const DUST_R = 0.55, DUST_H = 0.32;
const GROW = 0.6; //                   s, the front from the ball to the target (beams and bolts alike)
/**
 * On contact the beam splits: ARCS thinner beams leave the contact point,
 * spread over the top and round the sides of the target (never under it, or
 * through it), carry on past it and curve down to the ground behind it,
 * where they dissipate — the higher an arc, the further it goes and the more
 * it arcs. ARC_R × the beam's bright layer thick, ARC_GROW s to reach full
 * length; ARC_CLEAR × the target's body is the room they leave round it.
 */
const ARCS = 6, ARC_R = 0.5, ARC_GROW = 0.3, ARC_CLEAR = 1.6;
/**
 * A clash's hemisphere: each layer's radius CLASH_R × its tube's (at the two
 * beams' mean height), so the ball stands well out of the columns; it grows
 * out from the clash point over CLASH_GROW s once the beam gets there.
 */
export const CLASH_R = 3, CLASH_GROW = 0.35;
/**
 * The seam where the halves meet is blended, not a clean cut: each half runs
 * on past the clash plane by CLASH_SEAM of its radius, torn away by its noise
 * from CLASH_SEAM short of the plane to CLASH_SEAM past it, so the two
 * interlock raggedly across it.
 */
const CLASH_SEAM = 0.22;
/**
 * Its core and bright layers are torn less than the columns' (cutoffs ×
 * CLASH_TEAR), so it reads as a solid ball; its skin less still (×
 * CLASH_SKIN), so each half wears its own beam's dark noise all over it.
 */
export const CLASH_TEAR = 0.5, CLASH_SKIN = 0.72;
/** The winning beam: its egg up to × (1 + CLASH_EDGE_EGG), its torn skin's cutoff × (1 − CLASH_EDGE_SKIN) (heavier). */
const CLASH_EDGE_EGG = 0.55, CLASH_EDGE_SKIN = 0.3;
/** Once a clash is over, its half of the ball shrinks away over this, s. */
const CLASH_END = 0.25;
/** The column is this × the layers' radii (thinner than the balls and eggs it runs between). */
const COLUMN = 0.8;
/**
 * The tip: an egg at the front of the beam, its fat end toward the target
 * (TIP × the root ball's size: as big as the root ball was before it grew). On contact it bursts in a loop — TIP_SHELLS
 * shells, staggered, each swelling to TIP_BURST × (its dark noise to
 * TIP_NET_BURST ×) every TIP_LOOP s and tearing toward TIP_TEAR, never quite
 * gone — until the beam ends, when everything at the tip swells and disperses.
 */
const TIP = 1.25 / BALL_OVER, TIP_SHELLS = 2, TIP_LOOP = 0.55, TIP_BURST = 2.0, TIP_NET_BURST = 2.8, TIP_TEAR = 0.8;
/** The starting egg's dark noise is heavier than the column's: its cutoff × this. */
const ROOT_SKIN = 0.75;
/** Split arcs round the target: replaced by the tip's looping burst. */
const SPLIT_ARCS = false;
/**
 * A billowing beam (burstAlong, Flamethrower): PUFFS bursts ride the column
 * from just past its starting egg to its front, each crossing it in PUFF_RIDE s
 * (staggered), swelling from the column's width to PUFF_BURST × it and tearing
 * toward PUFF_TEAR as it goes, then starting again behind.
 */
const PUFFS = 7, PUFF_RIDE = 0.7, PUFF_BURST = 2.2, PUFF_TEAR = 0.85;
/** Its starting egg bursts in a loop too (as the tip does): shells swelling to ROOT_BURST × — forward only, their back held at the egg's, clear of the attacker. */
const ROOT_BURST = 1.7;
/** A billowing beam's column wears heavier dark noise: its cutoff × this. */
/** A bolt's heavy noise round it (Ice Beam): its column's dark skin, this much thinner, and sparser. */
const BOLT_SKIN_R = 0.7;
const BOLT_SKIN = 1.08;
/** A bolt's starting egg: its heavy noise lighter than a beam's egg (ROOT_SKIN). */
const BOLT_ROOT_SKIN = 0.87;
const BILLOW_SKIN = 0.8;
/**
 * A tied clash's ball bursts as a ball attack's does (BallFx): its half
 * swells to CLASH_BURST × and dissolves over CLASH_BURST_TIME s, its dark noise
 * further — to CLASH_NET_BURST ×, lingering CLASH_NET_LIFE × as long — with
 * CLASH_BURST_SPARKS sparks thrown out of it.
 */
const CLASH_BURST = 2.2, CLASH_BURST_TIME = 0.42, CLASH_NET_BURST = 4.5, CLASH_NET_LIFE = 1.6, CLASH_BURST_SPARKS = 40;
/**
 * A hemisphere burst on its own (BeamFx.hemiBurst): how long it takes to grow
 * in (s); and the lighter version's — its time (× the clash's), its swell
 * (× the clash's growth past full), and its dark skin's tear (sparser).
 */
const HEMI_GROW = 0.07, HEMI_LIGHT = 0.7, HEMI_LIGHT_SWELL = 0.45, HEMI_LIGHT_SKIN = 0.88;
/**
 * Over each half, a little of the OTHER beam's dark noise: a sparse torn skin
 * (cutoff CLASH_MIX_CUT) in its colour, a shade outside its own skin
 * (× CLASH_MIX_OUT), its pattern its own — flowing the other beam's way,
 * in from its side, against this half's own noise.
 */
const CLASH_MIX_CUT = 0.6, CLASH_MIX_OUT = 1.04;
/** The beam lands on the target first: the split starts this long (s) after it gets there. */
const ARC_DELAY = 0.1;

/** The arcs fan from a little below one side, over the top, to a little below the other (radians). */
const ARC_FROM = -0.26, ARC_TO = Math.PI + 0.26;
/** The ball's pulse: how far its size swings, and how fast (rad/s). */
export const BALL_PULSE = 0.14, BALL_PULSE_RATE = 9;
/** The widest a beam's ball reaches back (× the attacker's height): charged, pulsing, swollen by a winning clash. */
const BALL_MAX_BACK = BEAM_R[BEAM_R.length - 1] * BALL_OVER * 1.2 * (1 + BALL_PULSE) * EGG_BACK * (1 + CLASH_EDGE_EGG);
export const CHARGE_TAU = 0.35; //           s, the ball's swell toward 120%
const SNAP = 0.07, POP = 0.14; //     s, launch: ball to nothing, then back to full
export const BLUR_LIFE = 0.35, SLASH_LIFE = 0.38, DUST_LIFE = 2.6;
const RELEASE_SPAN = 0.6; //          share of the release clip spent dissolving

/**
 * How vigorous the noise is: CHURN its boil in place, WARP how hard a second
 * noise tears it, and the layers' pans (below) how fast it races along.
 */
const CHURN = 0.8, WARP = 2.6;
/** The flow's speed: each layer's pan × this (it reads as going forward best fast). */
export const FLOW = 1.0;
/** How fast the beam's surface ripples in place (its wobble). */
const RIPPLE = 1.0;

/** Sparks per second: charging into the ball; and, once the beam is on the target, off the contact point. */
export const CHARGE_RATE = 75, CONTACT_RATE = 220;

const TUBE_ALONG = 96, TUBE_AROUND = 28;
const STRIP_ALONG = 120;

// ── shaders ────────────────────────────────────────────────────────────
export const NOISE = /* glsl */ `
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * vn(p); p = p * 2.03 + vec3(17.1, 3.7, 9.2); a *= 0.5; } return v / 0.9375; }
`;

/** The master shader's surface: pan, distort, dissolve, posterize. */
const MASTER_FRAG = /* glsl */ `
precision highp float;
varying float vAlong, vTh;
#ifdef OUTLINE_TWIN
varying float vFace;
uniform float soft;
#endif
uniform vec3 color, rim, color2, color3;
uniform float time, pan, cutoff, dark, multi;
uniform vec2 nscale;
${NOISE}
void main(void) {
#ifdef OUTLINE_TWIN
  // (An outline's near side, by the way its surface faces — not its triangles', which its leaning spikes fold: only its
  // far side draws, behind its core.)
  if (vFace > 0.0) discard;
#endif
  // Seamless round the tube: the angle enters as a circle.
  vec3 q = vec3(vAlong * nscale.x - time * pan, cos(vTh) * nscale.y, sin(vTh) * nscale.y + time * ${CHURN.toFixed(2)});
  // UV displacement by a second noise: it warps and tears the pattern. It is
  // read from the already-panned coordinates (no clock of its own), so the
  // warp travels forward with the flow instead of dragging the pattern back
  // and forth: everything moves forward, churning only in place (q.z).
  vec3 w = vec3(vn(q * 0.55 + vec3(5.3, 0.0, 0.0)), vn(q * 0.55 + vec3(1.7, 8.1, 0.0)), 0.0) - 0.5;
  q += vec3(w.x * ${WARP.toFixed(2)}, w.y * ${WARP.toFixed(2)} * 0.5, 0.0);
  float n = fbm(q);
  // Dissolve.
  if (n < cutoff) discard;
  float t = clamp((n - cutoff) / max(1.0 - cutoff, 1e-3), 0.0, 1.0);
  vec3 c;
  if (dark > 0.5) {
    c = color;
    // A patchwork skin (BeamPalette.skins): its colours in drifting patches.
    if (multi > 0.5) {
      float m = vn(q * 0.32 + vec3(11.0, 3.0, 7.0));
      c = m < 0.4 ? color : m < 0.6 ? color2 : color3;
    }
  } else {
    // Posterized brightness, and a hot rim right at the torn edge (anime style).
    float band = floor(t * 3.0 + 0.5) / 3.0;
    c = color * (0.85 + 0.45 * band);
    c = mix(rim, c, smoothstep(0.0, 0.12, t));
  }
#ifdef OUTLINE_TWIN
  // A soft outline (beam 2's 'soft'): not a cel band but a glow — strongest against the core, its lighter colour
  // (\`rim\`) there, its outline colour out toward its edge, fading to nothing at it (its far side edge-on: vFace 0).
  if (soft > 0.5) {
    float k = smoothstep(0.0, ${OUTLINE_SOFT_IN.toFixed(2)}, -vFace);
    gl_FragColor = vec4(mix(color, rim, k * k), k);
    return;
  }
#endif
  gl_FragColor = vec4(c, 1.0);
}`;

Effect.ShadersStore.beamTubeVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 viewProjection;
uniform vec3 origin, aim, side, upv;
uniform float len, rad, time, disp, pan, split, grow, spike;
uniform vec3 eye;
varying float vAlong, vTh;
#ifdef OUTLINE_TWIN
varying float vFace;
#endif
${NOISE}
${SPIKE_GLSL}
void main(void) {
  float u = uv.x, th = uv.y * 6.2831853;
  vec3 n = cos(th) * side + sin(th) * upv;
  float along = u * len;
  // An elongated oval along its length: narrower at both ends, fullest mid-way —
  // until it splits on the target: then its far end opens out to full width
  // (\`split\` 0..1), straight into the arcs, with no neck where they part.
  float c = mix(2.0 * u - 1.0, min(2.0 * u, 1.0) - 1.0, split);
  float r = rad * mix(${OVAL_END.toFixed(2)}, ${OVAL_MID.toFixed(2)}, sqrt(max(0.0, 1.0 - c * c)));
  // A round dome at the front while it races out (as long as the end is wide).
  float cap = rad * ${OVAL_END.toFixed(2)};
  float d = clamp((len - along) / cap, 0.0, 1.0);
  r *= mix(sqrt(max(0.0, 1.0 - (1.0 - d) * (1.0 - d))), 1.0, split);
  r *= 1.0 + disp * (vn(vec3(along / rad * 0.9 - time * pan, cos(th) * 2.0, sin(th) * 2.0 + time * ${RIPPLE.toFixed(2)})) - 0.5);
  vAlong = along / rad; vTh = th;
  // (An outline's twin: as wide again as \`grow\` — its noise read as its core's, so it tears where its core does — and
  // its spikes streaming forward from the egg's centre (\`spike\`: how far they rise). Unset: 1, none.)
  float sk = spike > 0.0 ? spikeAt(along, th, rad, time) : 0.0;
  float g = max(grow, 1.0) + spike * sk;
  // (Its tip leaning forward, the way the beam travels: the higher, the further.)
  float lean = spike > 0.0 ? ${SPIKE_LEAN.toFixed(2)} * rad * sk : 0.0;
  gl_Position = viewProjection * vec4(origin + aim * (along + lean) + n * r * g + position * 0.0, 1.0);
#ifdef OUTLINE_TWIN
  // (Which way this point of it faces: out from the beam's axis, toward the eye or away.)
  vFace = dot(n, normalize(eye - (origin + aim * along + n * r)));
#endif
}`;
Effect.ShadersStore.beamTubeFragmentShader = MASTER_FRAG;

// The core's rings of stars (RINGS): on its surface (its tube's shape, grown a touch), each fragment asks whether it
// lies in a star of any ring of either set — where along the beam each ring is now, and the star (if any) in its slot.
Effect.ShadersStore.beamRingsVertexShader = Effect.ShadersStore.beamTubeVertexShader;
Effect.ShadersStore.beamRingsEggFragmentShader = Effect.ShadersStore.beamRingsFragmentShader = /* glsl */ `
precision highp float;
varying float vAlong, vTh;
uniform vec3 color;
uniform float time, len, rad, eggBack;
float h1(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
// In a star of one set's rings (n of them, \`speed\` beam lengths a second)? Measured in circumferences: along the beam
// (a / C) and round it (t), C its girth mid-way along (its oval at its fullest).
float inSet(float a, float t, float n, float speed, float seed) {
  float C = 6.2831853 * rad * ${OVAL_MID.toFixed(2)};
  float ac = a / C, lmax = ${(RING_LEN[1] / 2).toFixed(3)};
  float slot = t * ${RING_SLOTS.toFixed(1)}, si = floor(slot), f = fract(slot);
  for (int k = 0; k < 8; k++) {
    if (float(k) >= n) break;
    float run = time * speed + float(k) / n + seed;
    // (Each ring's way: from the back of the egg at the mouth to the end of the beam.)
    float at = (fract(run) * (len + eggBack) - eggBack) / C;
    float da = abs(ac - at);
    if (da > lmax) continue;
    // (This ring's pattern, this time round.)
    float id = floor(run) * 17.3 + float(k) * 5.1 + seed * 31.0;
    // A star in this slot? As thick as the swell round the ring is here: bunched where it is high, sparse where low.
    float waves = floor(mix(${RING_BUNCH[0].toFixed(1)}, ${(RING_BUNCH[1] + 0.99).toFixed(2)}, h1(id + 2.0)));
    float swell = 0.5 + 0.5 * sin(6.2831853 * (t * waves + h1(id + 4.0)));
    if (h1(si * 1.9 + id) > swell * swell * 1.2) continue;
    // Its length along the beam and width round it (circumferences, half each way), where in its slot it sits.
    float L = mix(${(RING_LEN[0] / 2).toFixed(3)}, lmax, h1(si + id * 0.7));
    float Wd = mix(${(RING_WIDE[0] / 2).toFixed(4)}, ${(RING_WIDE[1] / 2).toFixed(4)}, h1(si * 2.3 + id));
    float roomW = 0.5 - Wd * ${RING_SLOTS.toFixed(1)};
    float off = (h1(si * 3.7 + id * 1.3 + 9.0) - 0.5) * 2.0 * max(roomW, 0.0);
    // Along the beam it rides its ring (each star its own nudge); round it, in its slot.
    float dl = abs(ac - at - (h1(si * 5.1 + id) - 0.5) * lmax * 0.6) / L;
    float dw = abs((f - 0.5 - off) / ${RING_SLOTS.toFixed(1)}) / Wd;
    // Its sides curving in: a four-pointed star (RING_STAR < 1; 1, a diamond).
    if (pow(dl, ${RING_STAR.toFixed(2)}) + pow(dw, ${RING_STAR.toFixed(2)}) < 1.0) return 1.0;
  }
  return 0.0;
}
void main(void) {
  float a = vAlong * rad, t = fract(vTh / 6.2831853);
  float hit = 0.0;
  ${RING_SETS.map(([n, v], i) => `hit = max(hit, inSet(a, t, ${n.toFixed(1)}, ${v.toFixed(3)}, ${(i * 0.37).toFixed(2)}));`).join(' ')}
  if (hit < 0.5) discard;
  gl_FragColor = vec4(color, 1.0);
}`;

// A split arc: a thinner beam along a curve from the contact point round the
// target (a cubic Bezier p0..p3), drawn out to reachU of its length.
Effect.ShadersStore.beamArcVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 viewProjection;
uniform vec3 p0, p1, p2, p3;
uniform float rad, reachU, alen, time, disp, pan;
varying float vAlong, vTh, vFade;
${NOISE}
vec3 bez(float u) { float a = 1.0 - u; return a * a * a * p0 + 3.0 * a * a * u * p1 + 3.0 * a * u * u * p2 + u * u * u * p3; }
vec3 dbez(float u) { float a = 1.0 - u; return 3.0 * a * a * (p1 - p0) + 6.0 * a * u * (p2 - p1) + 3.0 * u * u * (p3 - p2); }
void main(void) {
  float u = uv.x * reachU, th = uv.y * 6.2831853;
  vec3 T = normalize(dbez(u) + vec3(1e-5));
  vec3 ref = abs(T.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 N = normalize(cross(T, ref)), B = cross(T, N);
  // Its share of the beam's end where it leaves it, full a little way out,
  // thinning along the way; a round tip where it has got to.
  float r = rad * (0.65 + 0.35 * smoothstep(0.0, 0.18, u)) * (1.0 - 0.7 * u);
  r *= sqrt(clamp((reachU - u) * alen / max(rad, 1e-4), 0.0, 1.0));
  r *= 1.0 + disp * (vn(vec3(u * alen / rad * 0.9 - time * pan, cos(th) * 2.0, sin(th) * 2.0 + time * ${RIPPLE.toFixed(2)})) - 0.5);
  vAlong = u * alen / max(rad, 1e-4); vTh = th; vFade = u;
  gl_Position = viewProjection * vec4(bez(u) + (cos(th) * N + sin(th) * B) * r + position * 0.0, 1.0);
}`;
// The master surface, torn away more and more toward the arc's tip (it dissipates).
Effect.ShadersStore.beamArcFragmentShader = MASTER_FRAG
  .replace('varying float vAlong, vTh;', 'varying float vAlong, vTh, vFade;')
  .replace('if (n < cutoff) discard;', 'float cutHere = cutoff + (1.0 - cutoff) * smoothstep(0.6, 1.0, vFade);\n  if (n < cutHere) discard;')
  .replace('float t = clamp((n - cutoff) / max(1.0 - cutoff, 1e-3), 0.0, 1.0);', 'float t = clamp((n - cutHere) / max(1.0 - cutHere, 1e-3), 0.0, 1.0);');

/**
 * Ordinary meshes (the ball, the slashes) in the master shader. Their noise
 * is read in the BEAM's coordinates — along its axis in units of the matching
 * tube's radius, and round it from the same side/up — so a ball layer's
 * pattern runs on into its tube without a seam.
 */
Effect.ShadersStore.beamMeshVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world, viewProjection;
uniform vec3 origin, aim, side, upv;
uniform float time, disp, pan, rad, egg, grow, spike;
uniform vec3 eye;
varying float vAlong, vTh;
#ifdef OUTLINE_TWIN
varying float vFace;
#endif
${NOISE}
${SPIKE_GLSL}
void main(void) {
  float onCap = 0.0;
  vec3 p = position * (1.0 + disp * (vn(position * 3.0 + vec3(0.0, 0.0, time * pan)) - 0.5));
  // The egg (its poles lie along the aim, +y forward): the back half full,
  // the front drawn out and narrowing into the column.
  if (egg > 0.0) {
    if (p.y > 0.0) {
      float y = clamp(p.y, 0.0, 1.0);
      p.xz *= mix(1.0, mix(1.0, ${EGG_TIP.toFixed(3)}, pow(y, 1.2)), egg);
      p.y *= mix(1.0, ${EGG_FRONT.toFixed(2)}, egg);
    } else {
      p.y *= mix(1.0, ${EGG_BACK.toFixed(2)}, egg);
    }
  }
  vec4 w = world * vec4(p, 1.0);
  vec3 rel = w.xyz - origin;
  vAlong = dot(rel, aim) / max(rad, 1e-4);
  vTh = atan(dot(rel, upv), dot(rel, side));
  // (An outline's twin: grown in its own shape by \`grow\`, its noise read as its core's — and, a clash's half, cut where its
  // core is, at the seam: never past it into the other beam's half. Unset: 1.)
  // (Its spikes as the tube's: by how far along from the egg's centre it is, and round.)
  float sk = spike > 0.0 ? spikeAt(dot(rel, aim), vTh, rad, time) : 0.0;
  vec3 pg = p * (max(grow, 1.0) + spike * sk);
  /*SEAM*/
  // (Its tip leaning forward, the way the beam travels: the higher, the further.)
  gl_Position = viewProjection * (world * vec4(pg, 1.0) + vec4(aim * ${SPIKE_LEAN.toFixed(2)} * rad * sk, 0.0));
#ifdef OUTLINE_TWIN
  // (Which way this point of it faces: out from its centre — a clash half's flat back, toward the other beam.)
  vec3 nrm = onCap > 0.5 ? aim : normalize(w.xyz - vec3(world[3]));
  // (An egg's front, drawn out into the column: it faces out from the beam's axis, as the tube does — out from its centre
  // it would face forward, and its near side, side-on, would count as its far side and show over the core.)
  float fwd = dot(w.xyz - vec3(world[3]), aim);
  if (egg > 0.0 && onCap < 0.5 && fwd > 0.0) nrm = normalize(w.xyz - vec3(world[3]) - aim * fwd + 1e-5 * side);
  vFace = dot(nrm, normalize(eye - w.xyz));
#endif
}`;
Effect.ShadersStore.beamMeshFragmentShader = MASTER_FRAG;
// (The core's rings round its egg at the mouth, where they start: the egg's shape, the rings' own fragment — RINGS.)
Effect.ShadersStore.beamRingsEggVertexShader = Effect.ShadersStore.beamMeshVertexShader;

// A clash's hemisphere: the half on this beam's side, running a little past
// the clash plane (its front flattened there) and torn away across it by its
// noise — so the other beam's half, torn the same way, blends into it.
Effect.ShadersStore.beamClashVertexShader = Effect.ShadersStore.beamMeshVertexShader
  .replace('varying float vAlong, vTh;', 'varying float vAlong, vTh, vSeam;')
  .replace('vec4 w = world * vec4(p, 1.0);', `onCap = p.y > ${CLASH_SEAM.toFixed(2)} ? 1.0 : 0.0;
  p.y = min(p.y, ${CLASH_SEAM.toFixed(2)});
  vSeam = p.y;
  vec4 w = world * vec4(p, 1.0);`)
  .replace('/*SEAM*/', `pg.y = min(pg.y, ${CLASH_SEAM.toFixed(2)});
  sk = 0.0; // (No lean here: it would carry its spikes past the seam, into the other beam's half.)`);
Effect.ShadersStore.beamClashFragmentShader = MASTER_FRAG
  .replace('varying float vAlong, vTh;', `varying float vAlong, vTh, vSeam;
uniform float grow;`)
  // (Torn away across the seam, to blend into the other half — but not an outline's twin: its back, flat at the seam, is the
  // rim behind its core, seen from its own side before the other half's.)
  .replace('if (n < cutoff) discard;', `float cutHere = grow > 1.0 ? cutoff : mix(cutoff, 1.0, smoothstep(-${CLASH_SEAM.toFixed(2)}, ${CLASH_SEAM.toFixed(2)}, vSeam));
  if (n < cutHere) discard;`)
  .replace('float t = clamp((n - cutoff) / max(1.0 - cutoff, 1e-3), 0.0, 1.0);', 'float t = clamp((n - cutHere) / max(1.0 - cutHere, 1e-3), 0.0, 1.0);');

Effect.ShadersStore.beamSwirlVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 viewProjection;
uniform vec3 origin, aim, side, upv;
uniform float len, rad, width, time, phase;
varying vec2 vUV;
void main(void) {
  float along = uv.x * len;
  float th = along / rad * 0.9 + time * 14.0 + phase;
  vec3 n = cos(th) * side + sin(th) * upv;
  vec3 tg = -sin(th) * side + cos(th) * upv;
  float wob = 1.0 + 0.18 * sin(along / rad * 1.7 - time * 9.0 + phase);
  vec3 c = origin + aim * along + n * rad * wob;
  // The ribbon's width lies across the helix, in its surface.
  vec3 wd = normalize(cross(normalize(aim + tg * 0.9), n));
  vUV = uv;
  gl_Position = viewProjection * vec4(c + wd * (uv.y - 0.5) * width + position * 0.0, 1.0);
}`;
Effect.ShadersStore.beamSwirlFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform vec3 color;
uniform float fade;
void main(void) {
  float across = 1.0 - abs(vUV.y - 0.5) * 2.0;
  float a = pow(across, 1.4) * smoothstep(0.0, 0.06, vUV.x) * (1.0 - smoothstep(0.92, 1.0, vUV.x)) * fade;
  gl_FragColor = vec4(color * a, a);
}`;

// The swirls as a tornado: an open tube round the beam (its unit cylinder laid
// along the aim, out to the swirls' radius), the aura tornado's voronoi
// streaks on it, two-toned, winding round and running toward the target.
Effect.ShadersStore.beamTornadoVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 viewProjection;
uniform vec3 origin, aim, side, upv, camPos;
uniform float len, rad, time, burst;
varying float vU, vAng, vAlong, vFacing, vBulge;
void main(void) {
  float u = position.y + 0.5;
  vec3 n = normalize(position.x * side + position.z * upv);
  // (Bursting: swellings riding it toward the front, none at its root.)
  float w = fract(u * ${TORNADO_BURSTS.toFixed(1)} - time / ${TORNADO_RIDE.toFixed(2)});
  float k = burst * pow(max(0.0, sin(3.14159265 * w)), 3.0) * smoothstep(0.0, 0.15, u);
  vBulge = k;
  vec3 c = origin + aim * u * len + n * rad * (1.0 + ${(TORNADO_SWELL - 1).toFixed(2)} * k);
  vU = u;
  vAng = atan(position.x, position.z);
  vAlong = u * len / max(rad, 1e-4);
  // (Seen edge-on, a shell looks thicker: its streaks brighter there.)
  vFacing = abs(dot(n, normalize(camPos - c)));
  gl_Position = viewProjection * vec4(c, 1.0);
}`;
Effect.ShadersStore.beamTornadoFragmentShader = /* glsl */ `
precision highp float;
varying float vU, vAng, vAlong, vFacing, vBulge;
uniform vec3 color, hot;
uniform float time, fade;
vec2 hash2(vec2 p) {
  p = mod(p, ${TORNADO_STREAKS.toFixed(1)});
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}
float voronoi(vec2 x, float t) {
  vec2 n = floor(x), f = fract(x);
  float md = 5.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = 0.5 + 0.5 * sin(t + 6.2831 * hash2(n + g));
    vec2 r = g + o - f;
    md = min(md, dot(r, r));
  }
  return md;
}
void main(void) {
  // (Round it: TORNADO_STREAKS cells, seamless; along it in radii, winding.)
  float x = vAng * ${TORNADO_STREAKS.toFixed(1)} / 6.2831853 - vAlong * ${TORNADO_TWIST.toFixed(2)} - time * ${TORNADO_SPIN.toFixed(1)} * 0.1;
  float y = vAlong * 0.35 - time * ${TORNADO_FLOW.toFixed(2)};
  float f = voronoi(vec2(x, y), time * 0.6);
  float v = pow(f, 0.75);
  // (Cel shaded, as the aura tornadoes: its streaks in flat bands of the
  // beam's own tones, each outlined dark.)
  // (Torn apart where it bursts: fewer, thinner streaks.)
  float cut = 0.44 + 0.28 * vBulge;
  float on = step(cut, v), ink = step(cut - 0.06, v) - on;
  vec3 c = v > 0.7 ? hot : color;
  c = mix(c, color * 0.25, ink);
  float a = max(on * 0.92, ink * 0.9) * (1.0 - 0.35 * vBulge);
  a *= smoothstep(0.0, 0.06, vU) * (1.0 - smoothstep(0.92, 1.0, vU)) * fade;
  gl_FragColor = vec4(c * a, a);
}`;

Effect.ShadersStore.beamDustVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world, viewProjection;
varying vec2 vUV;
void main(void) { vUV = uv; gl_Position = viewProjection * world * vec4(position, 1.0); }`;
Effect.ShadersStore.beamDustFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform vec3 color;
uniform float time, pan, cutoff;
${NOISE}
void main(void) {
  // Spikes standing up round the ring, panned round it.
  float x = vUV.x * 6.2831853 + time * pan;
  float sp = pow(fbm(vec3(cos(x) * 9.0, sin(x) * 9.0, time * 0.5)), 1.6) * 1.4;
  float h = vUV.y;
  if (h > sp) discard;
  float n = vn(vec3(cos(x) * 20.0, sin(x) * 20.0, h * 6.0 - time * 2.0));
  if (n < cutoff) discard;
  float a = (1.0 - h / max(sp, 1e-3)) * 0.85;
  gl_FragColor = vec4(color * a, a);
}`;

Effect.ShadersStore.beamRadialFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 center;
uniform float strength;
void main(void) {
  vec2 d = (center - vUV) * strength;
  vec4 c = vec4(0.0);
  for (int i = 0; i < 12; i++) c += texture2D(textureSampler, vUV + d * (float(i) / 11.0));
  gl_FragColor = c / 12.0;
}`;

// ── colours ────────────────────────────────────────────────────────────
interface Colours {
  hot: RGB; main: RGB; accent: RGB; dark: RGB;
  /** A patchwork skin's other colours (BeamPalette.skins). */
  dark2?: RGB; dark3?: RGB;
  /** The torn black skin's dissolve threshold (lower = more of it). */
  skinCut?: number;
}
/**
 * A beam wears its type's aura colours (auraPalette.auraGlow): the torn skin
 * (the "black noise") is the aura's outline colour, the beam's body its fill
 * colour, the hot core a brighter, whiter fill. Electric's outline and fill
 * are both white-hot, so its skin takes its amber glow (else it is all white).
 */
export function coloursFor(element: string, palette?: BeamPalette): Colours {
  const [outer, , typeLine, typeFill] = auraGlow(element);
  // A move's own palette (beamMoves) in place of its type's outline and fill.
  const line = palette?.skins?.[0] ?? palette?.skin ?? typeLine, fill = palette?.body ?? typeFill;
  const same = Math.hypot(line[0] - fill[0], line[1] - fill[1], line[2] - fill[2]) < 0.05;
  const skin = same ? outer : line;
  const main = fill.map((x) => x * 1.1) as RGB;
  const hot = fill.map((x) => (1 + x) * 0.62) as RGB;
  const lum = 0.2126 * skin[0] + 0.7152 * skin[1] + 0.0722 * skin[2];
  // A black skin reads best a little heavier (as the Dark beam had it).
  const more = palette?.skins && palette.skins.length > 1
    ? { dark2: palette.skins[1], dark3: palette.skins[2] ?? palette.skins[1] } : {};
  return { hot, main, accent: hot.map((x) => x * 1.1) as RGB, dark: skin, skinCut: lum < 0.1 ? 0.48 : 0.58, ...more };
}

// ── API ────────────────────────────────────────────────────────────────
/**
 * A beam's own colours, over its type's: `skin` its heavy (dark) noise, `body`
 * its fill (the hot core is drawn from it). `skins` (up to three) makes the
 * heavy noise a patchwork of those colours instead (Tri Attack: fire,
 * electricity and ice), in patches drifting with the noise.
 */
export interface BeamPalette { skin: RGB; body: RGB; skins?: RGB[] }

export interface BeamShot {
  element: string;
  /** Beam 1 (default: the layered beam) or beam 2 (the aura beam: its core alone, outlined, ringed) — BeamSpec.style. */
  style?: 1 | 2;
  /** Beam 2's outline: 'cel' (a flat band) or 'soft' (a glow) — BeamSpec.outline. */
  outline?: 'cel' | 'soft';
  /** Its own colours (beamMoves), over the type's. */
  palette?: BeamPalette;
  /** Its noise bursts all along the column past the starting egg (PUFFS): flame billowing. */
  burstAlong?: boolean;
  /** How thick it is (1 = as the others): its column, eggs and puffs (not a clash's ball). */
  thickness?: number;
  /**
   * Twin beams (from two cannons): shared by the pair, so both start the same
   * distance out — on one line across `fwd()` (the attacker's facing), as far
   * forward as the one that needs it most (each writes how far, by its id).
   */
  twin?: { fwd(): Vector3; reach: Map<number, number> };
  /**
   * How far ahead of `mouth` its ball sits at least (× its height; default
   * ROOT, clear of a face). A cannon's muzzle needs none: 0 puts the ball's
   * back at the muzzle (still kept clear of the body).
   */
  root?: number;
  /**
   * `target()` is already the point on the target's near side it meets (twin
   * or triple beams share one, so they converge on it): no TARGET_BODY step
   * back from it.
   */
  exactTarget?: boolean;
  /**
   * A bolt (Ice Beam, Thunderbolt in a clash): its starting egg, charge,
   * sparks and clash ball as a beam's, but no column or tip — the caller
   * draws a bolt from `origin()` to `end()` in their place.
   */
  bolt?: boolean;
  /** No starting egg, charge or launch either (Thunderbolt: its bolt leaves the body itself). */
  eggless?: boolean;
  /**
   * Its front is at the clash point the moment it opens (no column racing
   * out): a ball's half of a clash's ball, opened as the ball arrives.
   */
  instant?: boolean;
  /** The attacker's displayed height, world units ("model height"). */
  height: number;
  /** Where the mouth is this frame (it follows the animation). */
  mouth(): Vector3;
  /** Where the beam is aimed this frame (the target's middle). */
  target(): Vector3;
  /** Where the attacker stands (for the dust rings); null while it is in the air (no dust). */
  feet?(): Vector3 | null;
  /**
   * Which way the attacker faces (yaw, radians; 0 = +Z). Given, the ball and
   * the beam point the way it looks — pitched only to reach the target's
   * height — rather than straight from the mouth to the target.
   */
  facing?(): number;
  /** The target's displayed height (the beam meets it on its near side and splits round it). */
  targetSize?(): number;
  /**
   * How far ahead of `from`, along `aim`, the attacker's own body reaches
   * within `radius` of that line (its snout, its arms): the beam's ball is
   * kept clear of it, so no part of the beam lies over the attacker.
   */
  bodyAhead?(from: Vector3, aim: Vector3, radius: number): number;
  /**
   * Each point of the target's skin in every pose it takes while struck (its
   * flinch, its idle): the split arcs keep clear of all of them at once, so
   * they need not move with the flinch.
   */
  targetPoses?(fn: (p: Vector3) => void): void;
  /**
   * A beam clash: this beam meets another head-on at `at` (it aims there,
   * ends there and does not split), and ends in a hemisphere on its own side
   * of that point, `size` (the two beams' mean height) setting its
   * radius — the other beam's hemisphere makes the other half of the ball.
   * `other` is the other beam's element: a little of its dark noise is
   * streaked over this half.
   */
  clash?: BeamClash;
  /**
   * Its clash half's noise (the skin, and the other's streaks over it) drawn
   * by this instead (a tornado ball: the moving tornado's half, WindFx.hemi).
   */
  clashNoise?: () => ClashNoise;
}

/** A clash half's noise drawn elsewhere: each frame, the clash point, the way in, its radius (world) and how strongly it shows. */
export interface ClashNoise {
  update(at: Vector3, aim: Vector3, radius: number, show: number): void;
  dispose(): void;
}

/**
 * A beam clash, as one beam sees it. `at` is where the beams meet (it moves
 * as one pushes the other back) — null until they have: till then the beam
 * races at its target as ever, and stops where the other's front met it. Once `over` the clash has ended for this
 * beam: the winner's beam then runs on into the loser and splits round it,
 * as an ordinary hit. `edge` (0..1) is how far this beam is winning: its egg
 * swells (CLASH_EDGE_EGG) and its noise grows heavier (CLASH_EDGE_SKIN).
 */
/** The radius of a clash's ball for beams of mean height `size` (its outermost layer, at full size). */
export function clashBallRadius(size: number): number {
  return CLASH_R * BEAM_R[BEAM_R.length - 1] * CLASH_MIX_OUT * size;
}

export interface BeamClash {
  at(): Vector3 | null;
  size: number;
  other?: string;
  /** The other beam's own colours, if it has them. */
  otherPalette?: BeamPalette;
  over?(): boolean;
  edge?(): number;
  /** A tie: the ball bursts as a ball attack's does on contact (CLASH_BURST) while the beams fade. */
  burst?(): boolean;
  /** Draw this beam's half of the clash's ball (default yes; a twin's second beam leaves it to the first). */
  ball?: boolean;
}

export interface BeamHandle {
  /** Where the beam leaves the attacker (its ball's centre), this frame. */
  origin(): Vector3;
  /** Where its front is, this frame (its origin until it launches). */
  end(): Vector3;
  /** The tip of its starting egg (its front, toward the target), this frame. */
  eggTip(): Vector3;
  /** The launch: the mouth has opened (the loop clip begins). */
  open(): void;
  /** Resolves when the front reaches the target — where the hit lands. */
  readonly front: Promise<void>;
  /** Dissolve everything over `seconds` · RELEASE_SPAN, then clean up. */
  release(seconds: number): Promise<void>;
}

export interface BeamFxOptions {
  /** Camera shake (magnitude, ms), e.g. MoveVfx.shake. */
  shake?: (magnitude: number, ms: number) => void;
}

const UP = new Vector3(0, 1, 0);
const Y = new Vector3(0, 1, 0);
/** A target's body is about this × its height across from its middle to its near side. */
export const TARGET_BODY = 0.28;

export class BeamFx {
  readonly tube: VertexData;
  readonly strip: VertexData;
  /** Shared and made up front: adding a light, or compiling a post-process, mid-fight would hitch. */
  readonly light: PointLight;
  readonly blur: PostProcess;
  blurCenter = new Vector2(0.5, 0.5);
  blurStrength = 0;
  private blurOn = false;
  private blurUsers = 0;

  constructor(readonly scene: Scene, readonly camera: Camera, readonly options: BeamFxOptions = {}) {
    this.tube = grid(TUBE_ALONG, TUBE_AROUND);
    this.strip = grid(STRIP_ALONG, 1);
    this.light = new PointLight('beamLight', Vector3.Zero(), scene);
    this.light.intensity = 0;
    this.light.range = 6;
    this.blur = new PostProcess('beamRadial', 'beamRadial', ['center', 'strength'], null, 1.0, null,
      Constants.TEXTURE_BILINEAR_SAMPLINGMODE, scene.getEngine() as never, false);
    this.blur.onApply = (e) => {
      e.setFloat2('center', this.blurCenter.x, this.blurCenter.y);
      e.setFloat('strength', this.blurStrength);
    };
    // The clash hemisphere's shader, compiled now: a lone burst (hemiBurst)
    // lives less time than a first compile takes, and would never show.
    const warm = MeshBuilder.CreateSphere('hemiWarm', { diameter: 2, segments: 4 }, scene);
    warm.setEnabled(false);
    const warmMat = new ShaderMaterial('hemiWarmMat', scene, { vertex: 'beamClash', fragment: 'beamClash' }, {
      attributes: ['position', 'uv'],
      uniforms: ['world', 'viewProjection', 'origin', 'aim', 'side', 'upv', 'len', 'rad', 'egg', 'split', 'time', 'disp', 'pan',
        'color', 'rim', 'cutoff', 'dark', 'nscale', 'color2', 'color3', 'multi'],
    });
    warmMat.backFaceCulling = false;
    warmMat.forceCompilation(warm, () => { warm.dispose(); warmMat.dispose(); });
  }

  fire(shot: BeamShot): BeamHandle {
    return new Beam(this, shot);
  }

  /**
   * A clash's hemisphere burst on its own (a quick step's launch and blow):
   * its heavy noise alone — the torn dark skin, in the same shader — in
   * `element`'s beam colours, its curved side facing `dir`, `size` its
   * radius. It grows in, then bursts as a tied clash's ball's skin does:
   * swelling out and tearing away. `light`: the lighter version — sparser,
   * a smaller swell, quicker.
   */
  hemiBurst(at: Vector3, dir: Vector3, size: number, element: string, light = true): void {
    const scene = this.scene;
    const col = coloursFor(element);
    const aim = dir.normalizeToNew();
    const upv0 = Math.abs(aim.y) > 0.95 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const side = Vector3.Cross(upv0, aim).normalize();
    const upv = Vector3.Cross(aim, side).normalize();
    // (The clash shader flattens its +y side and keeps the dome below: turn
    // that side back, so the dome faces `dir`.)
    const turn = new Quaternion();
    Quaternion.FromUnitVectorsToRef(new Vector3(0, -1, 0), aim, turn);
    const k = light ? HEMI_LIGHT : 1;
    const layers = [
      { color: col.dark, rim: col.dark, dark: 1, pan: 5.5, nscale: [0.28, 3.0], cutoff: col.skinCut ?? 0.58, disp: 0.6,
        tear: light ? HEMI_LIGHT_SKIN : CLASH_SKIN },
    ];
    const parts = layers.map((l, i) => {
      const mesh = MeshBuilder.CreateSphere(`hemiBurst${i}`, { diameter: 2, segments: 24 }, scene);
      const mat = new ShaderMaterial(`hemiBurstMat${i}`, scene, { vertex: 'beamClash', fragment: 'beamClash' }, {
        attributes: ['position', 'uv'],
        uniforms: ['world', 'viewProjection', 'origin', 'aim', 'side', 'upv', 'len', 'rad', 'egg', 'split', 'time', 'disp', 'pan',
          'color', 'rim', 'cutoff', 'dark', 'nscale', 'color2', 'color3', 'multi'],
      });
      mat.backFaceCulling = false;
      mat.setColor3('color', new Color3(...l.color));
      mat.setColor3('rim', new Color3(...l.rim));
      mat.setFloat('dark', l.dark);
      mat.setFloat('pan', l.pan * FLOW);
      mat.setVector2('nscale', new Vector2(l.nscale[0], l.nscale[1]));
      mat.setFloat('disp', l.disp);
      mat.setFloat('egg', 0);
      mat.setFloat('multi', 0);
      mat.setVector3('origin', at); mat.setVector3('aim', aim); mat.setVector3('side', side); mat.setVector3('upv', upv);
      const r = size;
      mat.setFloat('rad', r);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.rotationQuaternion = turn.clone();
      mesh.position.copyFrom(at);
      return { mesh, mat, r, base: l.cutoff * l.tear, dark: true };
    });
    const grow = HEMI_GROW * k, life = CLASH_BURST_TIME * k;
    let t = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
      t += Math.min(0.05, scene.getEngine().getDeltaTime() / 1000);
      const g = easeOutCubic(t / grow);
      const bt = Math.max(0, t - grow);
      let alive = false;
      for (const p of parts) {
        const kk = clamp01(bt / (life * (p.dark ? CLASH_NET_LIFE : 1)));
        const swell = 1 + ((p.dark ? CLASH_NET_BURST : CLASH_BURST) - 1) * (light ? HEMI_LIGHT_SWELL : 1) * easeOutCubic(kk);
        const gone = smoothstep(0.1, 1, kk);
        p.mesh.setEnabled(gone < 0.999);
        if (gone < 0.999) alive = true;
        p.mesh.scaling.setAll(Math.max(1e-3, p.r * Math.max(0.05, g) * swell));
        p.mat.setFloat('time', t + (p.dark ? 1.7 : 0));
        p.mat.setFloat('cutoff', p.base + (1 - p.base) * gone);
      }
      if (!alive) {
        scene.onBeforeRenderObservable.remove(obs);
        for (const p of parts) { p.mesh.dispose(); p.mat.dispose(); }
      }
    });
  }

  /** The radial blur, attached only while some beam is using it. */
  useBlur(on: boolean): void {
    this.blurUsers = Math.max(0, this.blurUsers + (on ? 1 : -1));
    const want = this.blurUsers > 0;
    if (want === this.blurOn) return;
    this.blurOn = want;
    if (want) this.camera.attachPostProcess(this.blur);
    else this.camera.detachPostProcess(this.blur);
  }
}

/** A (cols+1) × (rows+1) grid of uv's; the shaders place it. */
function grid(cols: number, rows: number): VertexData {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let i = 0; i <= cols; i++) for (let j = 0; j <= rows; j++) { positions.push(0, 0, 0); uvs.push(i / cols, j / rows); }
  const at = (i: number, j: number) => i * (rows + 1) + j;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    indices.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
  }
  const vd = new VertexData();
  vd.positions = positions; vd.uvs = uvs; vd.indices = indices;
  return vd;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
/** A uniformly random unit vector. */
function randomDir(): Vector3 {
  const z = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z);
  return new Vector3(r * Math.cos(a), z, r * Math.sin(a));
}
const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
const easeOutBack = (t: number) => { const c = 1.7; const x = clamp01(t) - 1; return 1 + (c + 1) * x * x * x + c * x * x; };

interface Layer { mat: ShaderMaterial; cutoff: number }

let beamIds = 0;

class Beam implements BeamHandle {
  readonly front: Promise<void>;
  private resolveFront!: () => void;
  private frontDone = false;
  private opened = false;
  private chargeT = 0;
  private t = 0; //       since launch
  private time = 0;
  private releasing: { t: number; dur: number; done: () => void } | null = null;
  private finished = false;
  private readonly H: number;
  private readonly col: Colours;
  private readonly scene: Scene;

  private tubes: { mesh: Mesh; layer: Layer }[] = [];
  /** The split arcs (three layers each, as the beam: a hot core, the body, the torn skin). */
  private arcs: { mesh: Mesh; layer: Layer; k: number; size: number }[] = [];
  private frontT = 0;
  /** When it split on its target (arcs), -1 until it does: at its front, or once a won clash is over. */
  private splitT = -1;
  /** When its clash ended (-1: still on, or none). */
  private clashEndT = -1;
  /** When a tied clash's ball burst (-1: not). */
  private burstT = -1;
  /** How far ahead of the mouth the attacker's body reaches (the most yet seen), and the ball's back reach last frame. */
  private bodyClear = 0;
  private backR = 0;
  /** The target's reach in each arc's direction over all its struck poses (worked out once). */
  private reachOut: number[] | null = null;
  /** How far the release has dissolved it (0..1), this frame. */
  private dissolveNow = 0;
  private balls: { mesh: Mesh; layer: Layer }[] = [];
  /** The tip's egg (three layers), and its looping burst shells (TIP_SHELLS × three layers). */
  private tips: { mesh: Mesh; layer: Layer }[] = [];
  private shells: { mesh: Mesh; layer: Layer; i: number; phase: number }[] = [];
  /** When the looping burst at the tip began (-1: not yet). */
  private loopT = -1;
  /** A billowing beam's puffs (PUFFS × three layers). */
  private puffs: { mesh: Mesh; layer: Layer; i: number; phase: number }[] = [];
  /** A billowing beam's starting-egg burst shells (TIP_SHELLS × three layers). */
  private rootShells: { mesh: Mesh; layer: Layer; i: number; phase: number }[] = [];
  /** A clash's hemisphere: the beam's three layers, then the other beam's skin, sparse. */
  private hemis: { mesh: Mesh; layer: Layer; r: number; tear: number }[] = [];
  /** The core's outline: each core piece's twin (OUTLINE). */
  private outlines: { src: Mesh; core: ShaderMaterial; twin: Mesh; mat: ShaderMaterial; rings: boolean }[] = [];
  private clashNoise: ClashNoise | null = null;
  private slashes: { mesh: Mesh; layer: Layer }[] = [];
  private swirls: { mesh: Mesh; mat: ShaderMaterial }[] = [];
  private dust: { mesh: Mesh; mat: ShaderMaterial }[] = [];
  private chargeSparks: GlowSparks;
  private streamSparks: GlowSparks;
  private owed = { charge: 0, stream: 0 };
  private anchor = new Vector3();
  private tick: Observer<Scene>;
  private blurring = false;

  constructor(private readonly fx: BeamFx, private readonly shot: BeamShot) {
    const scene = (this.scene = fx.scene);
    this.front = new Promise((r) => { this.resolveFront = r; });
    this.H = shot.height;
    const col = (this.col = coloursFor(shot.element, shot.palette));
    const H = this.H;

    // The master-shader layers: hot core, bright, torn black skin. Each
    // pans and scales its noise differently, for depth.
    const LAYERS = [
      { color: col.hot, rim: col.hot, dark: 0, pan: 13.0, nscale: [0.75, 1.6], cutoff: 0.22, disp: 0.35 },
      { color: col.main, rim: col.hot, dark: 0, pan: 9.0, nscale: [0.5, 2.1], cutoff: 0.42, disp: 0.5 },
      { color: col.dark, rim: col.dark, dark: 1, pan: 5.5, nscale: [0.28, 3.0], cutoff: col.skinCut ?? 0.58, disp: 0.6 },
    ];
    // A patchwork skin (BeamPalette.skins): the heavy noise in several colours.
    const multi = col.dark2 ? { color2: col.dark2, color3: col.dark3 ?? col.dark2 } : null;
    type LayerDef = (typeof LAYERS)[number];
    const masterMat = (name: string, shader: string, l: LayerDef): Layer => {
      const mat = new ShaderMaterial(name, scene, { vertex: shader, fragment: shader }, {
        attributes: ['position', 'uv'],
        uniforms: ['world', 'viewProjection', 'origin', 'aim', 'side', 'upv', 'len', 'rad', 'egg', 'split', 'time', 'disp', 'pan',
          'color', 'rim', 'cutoff', 'dark', 'nscale', 'color2', 'color3', 'multi'],
      });
      // (Only its own skin: a clash's streaks of the other beam keep their one colour.)
      const patchwork = !!l.dark && !!multi && l.color === col.dark;
      mat.setFloat('multi', patchwork ? 1 : 0);
      if (patchwork && multi) {
        mat.setColor3('color2', new Color3(...multi.color2));
        mat.setColor3('color3', new Color3(...multi.color3));
      }
      mat.backFaceCulling = false;
      mat.setColor3('color', new Color3(...l.color));
      mat.setColor3('rim', new Color3(...l.rim));
      mat.setFloat('dark', l.dark);
      mat.setFloat('pan', l.pan * FLOW);
      mat.setVector2('nscale', new Vector2(l.nscale[0], l.nscale[1]));
      mat.setFloat('disp', l.disp);
      mat.setFloat('cutoff', l.cutoff);
      mat.setFloat('egg', 0);
      return { mat, cutoff: l.cutoff };
    };

    LAYERS.forEach((l, i) => {
      const mesh = new Mesh(`beamTube${i}`, scene);
      fx.tube.applyToMesh(mesh);
      const layer = masterMat(`beamTubeMat${i}`, 'beamTube', l);
      mesh.material = layer.mat;
      this.prepare(mesh);
      this.tubes.push({ mesh, layer });
    });
    LAYERS.forEach((l, i) => {
      const mesh = MeshBuilder.CreateSphere(`beamBall${i}`, { diameter: 2, segments: 20 }, scene);
      const layer = masterMat(`beamBallMat${i}`, 'beamMesh', l);
      mesh.material = layer.mat;
      mesh.isPickable = false;
      mesh.rotationQuaternion = new Quaternion();
      this.balls.push({ mesh, layer });
    });
    LAYERS.forEach((l, i) => {
      const mesh = MeshBuilder.CreateSphere(`beamTip${i}`, { diameter: 2, segments: 20 }, scene);
      const layer = masterMat(`beamTipMat${i}`, 'beamMesh', l);
      layer.mat.setFloat('egg', 1);
      mesh.material = layer.mat;
      mesh.isPickable = false;
      mesh.rotationQuaternion = new Quaternion();
      mesh.setEnabled(false);
      this.tips.push({ mesh, layer });
    });
    if (shot.burstAlong) {
      for (let p = 0; p < PUFFS; p++) {
        LAYERS.forEach((l, i) => {
          const mesh = MeshBuilder.CreateSphere(`beamPuff${p}${i}`, { diameter: 2, segments: 16 }, scene);
          const layer = masterMat(`beamPuffMat${p}${i}`, 'beamMesh', l);
          mesh.material = layer.mat;
          mesh.isPickable = false;
          mesh.setEnabled(false);
          this.puffs.push({ mesh, layer, i, phase: p / PUFFS });
        });
      }
      for (let sh = 0; sh < TIP_SHELLS; sh++) {
        LAYERS.forEach((l, i) => {
          const mesh = MeshBuilder.CreateSphere(`beamRootShell${sh}${i}`, { diameter: 2, segments: 20 }, scene);
          const layer = masterMat(`beamRootShellMat${sh}${i}`, 'beamMesh', l);
          mesh.material = layer.mat;
          mesh.isPickable = false;
          mesh.rotationQuaternion = new Quaternion();
          mesh.setEnabled(false);
          this.rootShells.push({ mesh, layer, i, phase: sh / TIP_SHELLS });
        });
      }
    }
    for (let sh = 0; sh < TIP_SHELLS; sh++) {
      LAYERS.forEach((l, i) => {
        const mesh = MeshBuilder.CreateSphere(`beamShell${sh}${i}`, { diameter: 2, segments: 20 }, scene);
        const layer = masterMat(`beamShellMat${sh}${i}`, 'beamMesh', l);
        mesh.material = layer.mat;
        mesh.isPickable = false;
        mesh.rotationQuaternion = new Quaternion();
        mesh.setEnabled(false);
        this.shells.push({ mesh, layer, i, phase: sh / TIP_SHELLS });
      });
    }
    LAYERS.forEach((l, i) => {
      const mesh = MeshBuilder.CreateSphere(`beamClash${i}`, { diameter: 2, segments: 24 }, scene);
      const layer = masterMat(`beamClashMat${i}`, 'beamClash', l);
      mesh.material = layer.mat;
      mesh.isPickable = false;
      mesh.rotationQuaternion = new Quaternion();
      mesh.setEnabled(false);
      this.hemis.push({ mesh, layer, r: BEAM_R[i], tear: i < LAYERS.length - 1 ? CLASH_TEAR : CLASH_SKIN });
    });
    if (shot.clash?.other) {
      const skin = LAYERS[LAYERS.length - 1];
      const theirs = coloursFor(shot.clash.other, shot.clash.otherPalette).dark;
      const mesh = MeshBuilder.CreateSphere('beamClashMix', { diameter: 2, segments: 24 }, scene);
      const layer = masterMat('beamClashMixMat', 'beamClash',
        // It flows the other beam's way (in from its side), against this half's own flow.
        { ...skin, color: theirs, rim: theirs, nscale: [0.36, 2.6], pan: -skin.pan, cutoff: CLASH_MIX_CUT });
      mesh.material = layer.mat;
      mesh.isPickable = false;
      mesh.rotationQuaternion = new Quaternion();
      mesh.setEnabled(false);
      this.hemis.push({ mesh, layer, r: BEAM_R[BEAM_R.length - 1] * CLASH_MIX_OUT, tear: 1 });
    }
    for (let k = 0; k < ARCS; k++) {
      for (const [li, size] of [[0, 0.55], [1, 1], [2, 1.2]] as const) {
        const tag = ['c', '', 's'][li];
        const mesh = new Mesh(`beamArc${k}${tag}`, scene);
        fx.tube.applyToMesh(mesh);
        const l = LAYERS[li];
        const mat = new ShaderMaterial(`beamArcMat${k}${tag}`, scene, { vertex: 'beamArc', fragment: 'beamArc' }, {
          attributes: ['position', 'uv'],
          uniforms: ['viewProjection', 'p0', 'p1', 'p2', 'p3', 'rad', 'reachU', 'alen', 'time', 'disp', 'pan', 'color', 'rim', 'cutoff', 'dark', 'nscale'],
        });
        mat.backFaceCulling = false;
        mat.setColor3('color', new Color3(...l.color));
        mat.setColor3('rim', new Color3(...l.rim));
        mat.setFloat('dark', l.dark);
        mat.setFloat('pan', l.pan * FLOW);
        mat.setVector2('nscale', new Vector2(l.nscale[0], l.nscale[1]));
        mat.setFloat('disp', l.disp * 0.7);
        mat.setFloat('cutoff', l.cutoff);
        mesh.material = mat;
        this.prepare(mesh);
        mesh.setEnabled(false);
        this.arcs.push({ mesh, layer: { mat, cutoff: l.cutoff }, k, size });
      }
    }
    for (let i = 0; i < 2; i++) {
      const mesh = MeshBuilder.CreateCylinder(`beamSlash${i}`, { height: 1, diameter: 2, tessellation: 48, cap: Mesh.NO_CAP }, scene);
      const layer = masterMat(`beamSlashMat${i}`, 'beamMesh', { ...LAYERS[1], color: i ? col.hot : col.accent, rim: col.hot, cutoff: 0.3 });
      mesh.material = layer.mat;
      mesh.isPickable = false;
      mesh.rotationQuaternion = new Quaternion();
      mesh.setEnabled(false);
      this.slashes.push({ mesh, layer });
    }

    // Swirls: a tornado round the beam (SWIRL_TORNADO), or three ribbons.
    if (SWIRL_TORNADO) {
      const mesh = MeshBuilder.CreateCylinder('beamTornado', { height: 1, diameter: 2, tessellation: 64, subdivisions: 48, cap: Mesh.NO_CAP }, scene);
      const mat = new ShaderMaterial('beamTornadoMat', scene, { vertex: 'beamTornado', fragment: 'beamTornado' }, {
        attributes: ['position'],
        uniforms: ['viewProjection', 'origin', 'aim', 'side', 'upv', 'camPos', 'len', 'rad', 'time', 'burst', 'color', 'hot', 'fade'],
        needAlphaBlending: true,
      });
      mat.backFaceCulling = false;
      mat.disableDepthWrite = true;
      // (Laid over the beam by its alpha, not added: its dark ink shows.)
      mat.alphaMode = Constants.ALPHA_PREMULTIPLIED;
      // (In its type's own colour: the beam's skin colour, its brightest
      // streaks the body's — not the near-white hot core.)
      mat.setColor3('color', new Color3(...col.dark));
      mat.setColor3('hot', new Color3(...col.main));
      mesh.material = mat;
      this.prepare(mesh);
      this.swirls.push({ mesh, mat });
    }
    for (let i = 0; i < (SWIRL_TORNADO ? 0 : SWIRLS); i++) {
      const mesh = new Mesh(`beamSwirl${i}`, scene);
      fx.strip.applyToMesh(mesh);
      const mat = new ShaderMaterial(`beamSwirlMat${i}`, scene, { vertex: 'beamSwirl', fragment: 'beamSwirl' }, {
        attributes: ['position', 'uv'],
        uniforms: ['viewProjection', 'origin', 'aim', 'side', 'upv', 'len', 'rad', 'width', 'time', 'phase', 'color', 'fade'],
        needAlphaBlending: true,
      });
      mat.backFaceCulling = false;
      mat.disableDepthWrite = true;
      mat.alphaMode = Constants.ALPHA_ADD;
      mat.setFloat('phase', (i / SWIRLS) * Math.PI * 2);
      mat.setColor3('color', new Color3(...(i === 1 ? col.hot : col.accent)));
      mesh.material = mat;
      this.prepare(mesh);
      this.swirls.push({ mesh, mat });
    }

    // Dust rings round the feet.
    for (let i = 0; i < 2; i++) {
      const r = DUST_R * H * (i ? 1.25 : 1);
      const mesh = MeshBuilder.CreateCylinder(`beamDust${i}`, {
        height: DUST_H * H * (i ? 0.8 : 1), diameterBottom: r * 1.2, diameterTop: r * 2.2, tessellation: 64, cap: Mesh.NO_CAP,
      }, scene);
      const mat = new ShaderMaterial(`beamDustMat${i}`, scene, { vertex: 'beamDust', fragment: 'beamDust' }, {
        attributes: ['position', 'uv'],
        uniforms: ['world', 'viewProjection', 'color', 'time', 'pan', 'cutoff'],
        needAlphaBlending: true,
      });
      mat.backFaceCulling = false;
      mat.disableDepthWrite = true;
      mat.alphaMode = Constants.ALPHA_PREMULTIPLIED;
      mat.setColor3('color', new Color3(0.98, 0.94, 0.86));
      mat.setFloat('pan', i ? -1.6 : 1.2);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.dust.push({ mesh, mat });
    }

    // Sparks: in while it charges; once it hits, off the contact point.
    const cam = fx.camera;
    // Fire keeps the shaders' own gold → ember; other elements pull it toward their colour.
    const tintMix = shot.element === 'Fire' ? 0.15 : 0.65;
    const spark = (o: Partial<GlowSparkStyle>): GlowSparkStyle => ({
      size: 0.022 * H, lengthPerSpeed: 0.05, tint: col.main, tintMix, gravity: 3 * H, drag: 2, turbulence: 1.5 * H,
      splitChance: 0.35, splitCount: 3, secondary: [1, 0.5, 0.3], intensity: 1.2, ...o,
    });
    this.chargeSparks = new GlowSparks(scene, cam, 90, spark({ size: 0.018 * H, gravity: 0, drag: 1.2, splitChance: 0 }));
    // Once it hits: light, small sparks off the contact point.
    this.streamSparks = new GlowSparks(scene, cam, 320, spark({
      size: 0.011 * H, lengthPerSpeed: 0.015, gravity: 0, drag: 3.5, turbulence: 0.8 * H, splitChance: 0, intensity: 0.75,
    }));

    // Beam 2 (the aura beam): its core's aura outline — a twin of each core piece, in the move's colour — and its rings;
    // the rest of the layered beam (its body and skin, swirls, sparks) never shown.
    const aura = shot.style === 2;
    if (aura) this.onlyCore();
    if (OUTLINE && aura) {
      const core = [this.tubes[0], this.balls[0], this.tips[0], this.hemis[0],
        ...this.shells.filter((x) => x.i === 0), ...this.rootShells.filter((x) => x.i === 0), ...this.puffs.filter((x) => x.i === 0)];
      // (In its type's aura outline colour — the line round a Pokémon's aura, and the beam's own skin: its body's colour is too pale to show against the white.)
      // (Soft: a glow from its body's lighter colour against the core out to that outline colour at its edge.)
      const soft = shot.outline === 'soft' ? col.main : undefined;
      for (const piece of core) if (piece) this.outlineOf(piece.mesh, piece.layer.mat, col.dark, undefined, soft);
    }
    // Its rings of stars, round the core's tube (RINGS).
    if (RINGS && aura && this.tubes[0]) this.outlineOf(this.tubes[0].mesh, this.tubes[0].layer.mat, col.dark, { shader: 'beamRings', grow: RING_GROW, near: true, name: 'Rings' });
    // (Starting on its egg at the mouth: the same rings on it, on one way with the tube's.)
    if (RINGS && aura && this.balls[0]) this.outlineOf(this.balls[0].mesh, this.balls[0].layer.mat, col.dark, { shader: 'beamRingsEgg', grow: RING_GROW, near: true, name: 'Rings' });
    this.setBeamVisible(false);
    this.tick = scene.onBeforeRenderObservable.add(() => this.update());
  }

  /**
   * Beam 2: everything of the layered beam but its core kept from view — its
   * body and skin layers (column, egg, tip and bursts, clash half), its swirls
   * and its sparks. (Its layer mask, which the beam's own updates never touch:
   * they go on running, unseen.)
   */
  private onlyCore(): void {
    const hidden = [...this.tubes.slice(1), ...this.balls.slice(1), ...this.tips.slice(1), ...this.hemis.slice(1),
      ...this.shells.filter((x) => x.i > 0), ...this.rootShells.filter((x) => x.i > 0), ...this.puffs.filter((x) => x.i > 0),
      ...this.swirls, ...this.arcs.filter((_, k) => k % BEAM_R.length > 0)].map((x) => x.mesh);
    for (const m of [...hidden, this.chargeSparks.mesh, this.streamSparks.mesh]) m.layerMask = 0;
  }

  /**
   * A twin of `src` (its core's shader), flat in `color`, drawn from behind only: its outline (synced each frame:
   * syncOutlines). `as`: another shader on its shape instead (its rings), grown so much, its near side drawn.
   */
  private outlineOf(src: Mesh, core: ShaderMaterial, color: RGB, as?: { shader: string; grow: number; near: boolean; name: string },
    soft?: RGB): void {
    const path = as ? { vertex: as.shader, fragment: as.shader } : (core as unknown as { _shaderPath: { vertex: string; fragment: string } })._shaderPath;
    const opts = (core as unknown as { _options: { attributes: string[]; uniforms: string[] } })._options;
    // (Its own define, so its own compiled effect: sharing its core's — compiled first, without \`grow\` among its uniforms —
    // its grow would never reach the shader.)
    const mat = new ShaderMaterial(`${core.name}${as?.name ?? 'Outline'}`, this.scene, path, {
      attributes: opts.attributes, uniforms: [...opts.uniforms.filter((u) => !['grow', 'eggBack', 'spike', 'eye', 'soft'].includes(u)), 'grow', 'eggBack', 'spike', 'eye', 'soft'], defines: ['#define OUTLINE_TWIN'],
      // (A soft outline is see-through at its edge: blended, writing no depth of its own.)
      needAlphaBlending: !!soft,
    });
    // (An outline: both sides, its near side dropped by the way it faces — see MASTER_FRAG. Its rings: their near side.)
    mat.backFaceCulling = !!as;
    mat.cullBackFaces = !!as?.near;
    mat.setColor3('color', new Color3(...color));
    mat.setColor3('rim', new Color3(...(soft ?? color)));
    mat.setFloat('soft', soft ? 1 : 0);
    if (soft) mat.disableDepthWrite = true;
    mat.setFloat('dark', 1);
    mat.setFloat('multi', 0);
    mat.setFloat('grow', as?.grow ?? OUTLINE_GROW);
    // (The outline spikes; its rings don't.)
    mat.setFloat('spike', as ? 0 : SPIKE);
    const twin = src.clone(`${src.name}${as?.name ?? 'Outline'}`, src.parent, true) as Mesh;
    twin.material = mat;
    if (src.rotationQuaternion) twin.rotationQuaternion = src.rotationQuaternion.clone();
    this.prepare(twin);
    twin.setEnabled(false);
    this.outlines.push({ src, core, twin, mat, rings: !!as });
  }

  /** Each outline as its core is this frame: where it is, its shape, its noise (a little less torn). */
  private syncOutlines(): void {
    type Store = { _floats: Record<string, number>; _vectors3: Record<string, Vector3>; _vectors2: Record<string, Vector2> };
    // The rings' one way, egg and tube alike: the tube's length and girth, and how far back the egg reaches.
    const tube = this.tubes[0]?.layer.mat as unknown as Store | undefined;
    const eye = this.scene.activeCamera?.globalPosition;
    for (const { src, core, twin, mat, rings } of this.outlines) {
      const on = src.isEnabled(false) && src.isVisible;
      twin.setEnabled(on);
      if (!on) continue;
      twin.position.copyFrom(src.position);
      if (src.rotationQuaternion && twin.rotationQuaternion) twin.rotationQuaternion.copyFrom(src.rotationQuaternion);
      twin.scaling.copyFrom(src.scaling);
      twin.layerMask = src.layerMask;
      const from = core as unknown as Store;
      for (const [k, v] of Object.entries(from._floats)) if (k !== 'dark' && k !== 'multi' && k !== 'grow' && k !== 'spike') mat.setFloat(k, k === 'cutoff' ? v * OUTLINE_CUT : v);
      for (const [k, v] of Object.entries(from._vectors3)) mat.setVector3(k, v);
      for (const [k, v] of Object.entries(from._vectors2)) mat.setVector2(k, v);
      if (eye) mat.setVector3('eye', eye);
      if (rings && tube) {
        mat.setFloat('len', tube._floats.len ?? 0);
        mat.setFloat('rad', tube._floats.rad ?? 1);
        mat.setFloat('eggBack', this.backR);
      }
    }
  }

  origin(): Vector3 {
    return this.anchor.clone();
  }

  end(): Vector3 {
    // (Not yet poured: its front is where it will leave from.)
    return (this.opened ? this.endPt : this.anchor).clone();
  }

  eggTip(): Vector3 {
    return this.eggTipPt.clone();
  }

  /** Its starting egg's tip this frame (BeamHandle.eggTip). */
  private eggTipPt = new Vector3();

  /** Its front this frame (BeamHandle.end). */
  private endPt = new Vector3();
  /** In a clash, how far its front was racing before it met the other's (its pace). */
  private raceTo = 0;

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.fx.options.shake?.(0.28, 380);
    this.fx.useBlur(true);
    this.blurring = true;
    for (const s of this.slashes) s.mesh.setEnabled(true);
    for (const d of this.dust) d.mesh.setEnabled(true);
  }

  release(seconds: number): Promise<void> {
    if (this.finished) return Promise.resolve();
    if (!this.opened) { this.dispose(); return Promise.resolve(); }
    return new Promise((done) => { this.releasing = { t: 0, dur: Math.max(0.05, seconds * RELEASE_SPAN), done }; });
  }

  /**
   * The split: once the beam meets the target, each arc leaves the contact
   * point, goes out round the target — over it or past its side, with
   * ARC_CLEAR room to spare in its own direction (the body is taller than it
   * is wide) — carries on past it, and curves down to the ground behind it.
   * The set holds still.
   */
  private updateArcs(origin: Vector3, aim: Vector3, side: Vector3, up: Vector3, contactAt: number, reach: number,
    beamR: number, width: number, cut: (base: number) => number): void {
    const on = SPLIT_ARCS && this.splitT >= 0 && !this.finished; // a clash does not split (until it is won)
    const g = on ? easeOutCubic((this.time - this.splitT - ARC_DELAY) / ARC_GROW) : 0;
    const contact = origin.add(aim.scale(contactAt));
    const mid = origin.add(aim.scale(reach));
    const Ht = this.shot.targetSize?.() ?? this.H;
    const R = Math.max(reach - contactAt, beamR); // the body's half-width (front to middle)
    const halfUp = 0.55 * Ht; //                    middle to the top of the head
    const ground = mid.y - 0.5 * Ht;
    // A steady thickness (only thinning on release).
    const r = BEAM_R[1] * this.H * ARC_R * (1 - 0.4 * smoothstep(0.4, 1, this.dissolveNow));
    const flat = new Vector3(aim.x, 0, aim.z).normalize();
    // How far the target's body reaches out in each arc's direction (from the
    // beam's line through it) in ANY pose it takes while struck — worked out
    // once, as the beam lands, so the arcs keep clear of its flinch without
    // moving in step with it.
    if (on && !this.reachOut) {
      const reachOut = new Array<number>(ARCS).fill(0);
      const dirs = Array.from({ length: ARCS }, (_, k) => {
        const phi = ARC_FROM + (k / Math.max(1, ARCS - 1)) * (ARC_TO - ARC_FROM);
        return side.scale(Math.cos(phi)).add(up.scale(Math.sin(phi)));
      });
      const v = new Vector3();
      this.shot.targetPoses?.((p) => {
        p.subtractToRef(mid, v);
        for (let k = 0; k < ARCS; k++) reachOut[k] = Math.max(reachOut[k], Vector3.Dot(v, dirs[k]));
      });
      this.reachOut = reachOut;
    }
    const reachOut = this.reachOut ?? new Array<number>(ARCS).fill(0);
    for (const a of this.arcs) {
      a.mesh.setEnabled(g > 0.01);
      if (g <= 0.01) continue;
      const phi = ARC_FROM + (a.k / Math.max(1, ARCS - 1)) * (ARC_TO - ARC_FROM);
      const cs = Math.cos(phi), sn = Math.sin(phi);
      const dir = side.scale(cs).add(up.scale(sn));
      // Room round the body in this direction (an ellipse: narrow sideways, tall).
      // Room round the body: the body-shaped clearance, or more if its pose
      // reaches further out that way (with the arc's own thickness to spare).
      const c0 = Math.max(ARC_CLEAR / Math.sqrt((cs / R) ** 2 + (Math.max(sn, 0) / halfUp) ** 2 + 1e-9),
        (reachOut[a.k] + r * 1.4 + 0.06 * Ht) / 0.95);
      const c = c0; // a steady sweep
      // Higher arcs go further before they come down.
      const far = Ht * (1.3 + 1.1 * Math.max(0, sn));
      const end = mid.add(flat.scale(R * 2 + far)).add(side.scale(cs * c * 1.7));
      end.y = ground + 0.02;
      const m = a.layer.mat;
      // Each arc leaves from the rim of the beam's (opened, full-width) end,
      // spread round it, so together they carry the beam's width on (no neck
      // where it splits, and no bulb of all of them piled on one point).
      const start = contact.add(dir.scale(BEAM_R[1] * this.H * OVAL_MID * 0.7));
      m.setVector3('p0', start);
      m.setVector3('p1', start.add(dir.scale(c * 1.8)).add(aim.scale(R * 0.1)));
      m.setVector3('p2', mid.add(dir.scale(c * 1.9)).add(aim.scale(R * 2.2)));
      m.setVector3('p3', end);
      m.setFloat('alen', R * 2 + far + c * 3);
      m.setFloat('rad', r * a.size);
      m.setFloat('reachU', g);
      m.setFloat('time', this.time + a.k * 0.9 + a.size * 1.7);
      m.setFloat('cutoff', cut(a.layer.cutoff));
    }
  }

  /**
   * A clash: once the beam reaches the clash point, its hemisphere (the half
   * on its side) grows out from that point to wider than the column; the
   * other beam's hemisphere is the other half of the ball.
   */
  private updateClash(origin: Vector3, aim: Vector3, side: Vector3, up: Vector3, contactAt: number,
    cut: (base: number) => number, dissolve: number): void {
    const clash = this.shot.clash;
    // (A ball's half, won, goes at once: it has become the whole ball flying on — RecipeFactory.clashBall.)
    const ended = this.clashEndT >= 0 ? (this.shot.instant ? 1 : clamp01((this.time - this.clashEndT) / CLASH_END)) : 0;
    if (clash && this.frontDone && this.burstT < 0 && clash.burst?.()) {
      this.burstT = this.time;
      const c = clash.at() ?? this.endPt;
      for (let k = 0; k < CLASH_BURST_SPARKS; k++) {
        const d = randomDir();
        this.streamSparks.spawn(c.add(d.scale(0.2 * this.H)), d.scale((2.5 + Math.random() * 3) * this.H), 0.25 + Math.random() * 0.3);
      }
      this.fx.options.shake?.(0.22, 260);
    }
    const bursting = this.burstT >= 0;
    // Bursting, it no longer fades with the beam's release: it swells and disperses on its own clock.
    const g = clash && this.frontDone && !this.finished
      ? easeOutCubic((this.time - this.frontT) / CLASH_GROW) * (bursting ? 1 : 1 - smoothstep(0.3, 1, dissolve)) * (1 - ended) : 0;
    const at = (clash ? clash.at() : null) ?? origin.add(aim.scale(contactAt));
    const toAim = new Quaternion();
    Quaternion.FromUnitVectorsToRef(Y, aim, toAim);
    // (Beam 2: no clash noise — its clash ball its core and outline alone.)
    if (this.shot.clashNoise && !this.clashNoise && clash && clash.ball !== false && this.shot.style !== 2) this.clashNoise = this.shot.clashNoise();
    let noiseR = 0, noiseShow = 0;
    this.hemis.forEach(({ mesh, layer, r, tear }, i) => {
      mesh.setEnabled(g > 0.01 && clash?.ball !== false);
      if (g <= 0.01 || !clash || clash.ball === false) return;
      // (Its noise drawn elsewhere: the skin's size and fade go to that instead.)
      const elsewhere = !!this.clashNoise && i >= BEAM_R.length - 1;
      mesh.position.copyFrom(at);
      mesh.rotationQuaternion!.copyFrom(toAim);
      // The dark noise (the skin, and the other beam's streaks over it) bursts further and lingers.
      const dark = i >= BEAM_R.length - 1;
      let swell = 1, gone = -1;
      if (bursting) {
        const k = clamp01((this.time - this.burstT) / (CLASH_BURST_TIME * (dark ? CLASH_NET_LIFE : 1)));
        swell = 1 + ((dark ? CLASH_NET_BURST : CLASH_BURST) - 1) * easeOutCubic(k);
        gone = smoothstep(0.1, 1, k);
        mesh.setEnabled(gone < 0.999);
      }
      mesh.scaling.setAll(Math.max(1e-3, CLASH_R * r * clash.size * g * swell));
      if (elsewhere) {
        mesh.setEnabled(false);
        if (i === BEAM_R.length - 1) { noiseR = CLASH_R * r * clash.size * g * swell; noiseShow = gone >= 0 ? 1 - gone : 1; }
        return;
      }
      const m = layer.mat;
      m.setVector3('origin', origin); m.setVector3('aim', aim); m.setVector3('side', side); m.setVector3('upv', up);
      m.setFloat('rad', r * this.H);
      m.setFloat('time', this.time + i * 1.7); // as its tube
      const base = layer.cutoff * tear;
      m.setFloat('cutoff', gone >= 0 ? base + (1 - base) * gone : cut(base));
    });
    this.clashNoise?.update(at, aim, noiseR, noiseR > 1e-3 ? noiseShow : 0);
  }

  /**
   * The tip: an egg at the beam's front, fat end toward the target; from
   * contact, its looping burst (shells swelling out, staggered, never quite
   * gone). Released, it all swells and disperses. Not while a clash holds the
   * front (the clash's ball is there instead).
   */
  private updateTip(origin: Vector3, aim: Vector3, side: Vector3, up: Vector3, len: number, dissolve: number,
    heavier: (base: number, layer: number) => number): void {
    const H = this.H;
    const clashing = !!this.shot.clash && this.clashEndT < 0;
    const on = !clashing && !this.finished && !this.shot.bolt; // (a bolt has no tip)
    if (on && this.splitT >= 0 && this.loopT < 0) this.loopT = this.time;
    // Grows in with the front; released, swells out as it disperses (as a ball attack's burst).
    const grownIn = clamp01(len / (SPHERE_R[BEAM_R.length - 1] * H * this.W * 2));
    const out = 1 + (TIP_BURST - 1) * easeOutCubic(dissolve);
    const front = origin.add(aim.scale(len));
    const back = new Quaternion();
    Quaternion.FromUnitVectorsToRef(Y, aim.scale(-1), back); // its narrow end back along the beam
    const rFat = SPHERE_R[BEAM_R.length - 1] * H * this.W * TIP * EGG_BACK * grownIn;
    // The fat end's far side at the front of the beam.
    const centre = front.subtract(aim.scale(rFat * 0.85));
    this.tips.forEach(({ mesh, layer }, i) => {
      mesh.setEnabled(on && grownIn > 0.02);
      if (!mesh.isEnabled(false)) return;
      mesh.position.copyFrom(centre);
      mesh.rotationQuaternion!.copyFrom(back);
      mesh.scaling.setAll(Math.max(1e-3, SPHERE_R[i] * H * this.W * TIP * grownIn * out));
      const m = layer.mat;
      m.setVector3('origin', origin); m.setVector3('aim', aim); m.setVector3('side', side); m.setVector3('upv', up);
      m.setFloat('rad', BEAM_R[i] * H);
      m.setFloat('time', this.time + i * 1.7);
      const base = heavier(layer.cutoff, i);
      m.setFloat('cutoff', base + (1 - base) * smoothstep(0.1, 1, dissolve));
    });
    // The looping burst, from contact.
    const looping = on && this.loopT >= 0;
    this.shells.forEach(({ mesh, layer, i, phase }) => {
      if (!looping) { mesh.setEnabled(false); return; }
      const cycles = (this.time - this.loopT) / TIP_LOOP + phase;
      // Released: no new shell starts; the ones out finish swelling and go.
      const k = this.releasing && Math.floor(cycles) > Math.floor(this.releaseCycles(phase)) ? 1 : cycles - Math.floor(cycles);
      const dark = i === BEAM_R.length - 1;
      const swell = 1 + ((dark ? TIP_NET_BURST : TIP_BURST) - 1) * easeOutCubic(k);
      const base = heavier(layer.cutoff, i);
      const torn = TIP_TEAR * smoothstep(0.2, 1, k) + (1 - TIP_TEAR) * smoothstep(0.1, 1, dissolve);
      mesh.setEnabled(k < 0.999 && torn < 0.999);
      mesh.position.copyFrom(centre);
      mesh.rotationQuaternion!.copyFrom(back);
      mesh.scaling.setAll(Math.max(1e-3, SPHERE_R[i] * H * this.W * TIP * swell));
      const m = layer.mat;
      m.setVector3('origin', origin); m.setVector3('aim', aim); m.setVector3('side', side); m.setVector3('upv', up);
      m.setFloat('rad', BEAM_R[i] * H);
      m.setFloat('time', this.time + i * 1.7 + phase * 3.1);
      m.setFloat('cutoff', base + (1 - base) * torn);
    });
  }

  /**
   * A billowing beam: bursts riding the column from past its starting egg to
   * its front, swelling and tearing as they go (never on the egg itself).
   */
  private updatePuffs(origin: Vector3, aim: Vector3, side: Vector3, up: Vector3, len: number, dissolve: number,
    heavier: (base: number, layer: number) => number): void {
    if (!this.puffs.length) return;
    const H = this.H;
    // Clear of the starting egg: past its drawn-out front.
    const from = this.backR * EGG_FRONT / Math.max(EGG_BACK, 1e-3) + BEAM_R[1] * H;
    const span = len - from;
    this.puffs.forEach(({ mesh, layer, i, phase }) => {
      if (span <= 0.05 * H || this.finished) { mesh.setEnabled(false); return; }
      const k = (this.time / PUFF_RIDE + phase) % 1;
      const along = from + k * span;
      const dark = i === BEAM_R.length - 1;
      const r = BEAM_R[i] * H * this.W * COLUMN * (1 + (PUFF_BURST * (dark ? 1.15 : 1) - 1) * easeOutCubic(k));
      mesh.setEnabled(true);
      mesh.position.copyFrom(origin.add(aim.scale(along)));
      mesh.scaling.setAll(Math.max(1e-3, r));
      const m = layer.mat;
      m.setVector3('origin', origin); m.setVector3('aim', aim); m.setVector3('side', side); m.setVector3('upv', up);
      m.setFloat('rad', BEAM_R[i] * H);
      m.setFloat('time', this.time + i * 1.7 + phase * 5.3);
      const base = heavier(layer.cutoff, i);
      const torn = Math.max(PUFF_TEAR * smoothstep(0.25, 1, k), smoothstep(0.1, 1, dissolve));
      m.setFloat('cutoff', base + (1 - base) * torn);
    });
  }

  /** How many loops a shell had made when the release began. */
  private releaseCycles(phase: number): number {
    if (this.relCycleT < 0) this.relCycleT = this.time;
    return (this.relCycleT - this.loopT) / TIP_LOOP + phase;
  }
  private relCycleT = -1;
  /** Its id among its twins (BeamShot.twin). */
  private readonly id = ++beamIds;
  /** Its thickness (BeamShot.thickness). */
  private get W(): number { return this.shot.thickness ?? 1; }

  private prepare(m: Mesh): void {
    m.isPickable = false;
    m.alwaysSelectAsActiveMesh = true; // shaped in the shader
    m.doNotSyncBoundingInfo = true;
  }

  private setBeamVisible(on: boolean): void {
    // A bolt keeps only its column's heavy noise (BOLT_SKIN), round the bolt, tying it to its egg.
    const skinOnly = !!this.shot.bolt;
    this.tubes.forEach((t, i) => t.mesh.setEnabled(on && (!skinOnly || (i === this.tubes.length - 1 && !this.shot.eggless))));
    for (const s of this.swirls) s.mesh.setEnabled(on && !skinOnly);
  }

  private update(): void {
    this.step();
    if (!this.finished) this.syncOutlines();
  }

  private step(): void {
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
    this.time += dt;
    const H = this.H;

    // The frame: from the mouth to the target's middle.
    const mouth = this.shot.mouth();
    const target = this.shot.target();
    let aim = target.subtract(mouth);
    let dist = aim.length();
    if (this.shot.facing) {
      // Along the attacker's gaze: its yaw, pitched to meet the target's height
      // at the target's distance ahead of it.
      const yaw = this.shot.facing();
      const fwd = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const ahead = Math.max(0.2, Vector3.Dot(aim, fwd));
      aim = fwd.scale(ahead).addInPlace(new Vector3(0, aim.y, 0));
      dist = aim.length();
    }
    aim.scaleInPlace(1 / Math.max(dist, 1e-4));
    const up = UP.subtract(aim.scale(Vector3.Dot(UP, aim)));
    if (up.lengthSquared() < 1e-6) up.set(1, 0, 0);
    up.normalize();
    const side = Vector3.Cross(up, aim).normalize();
    // Its ball sits ROOT ahead of the mouth — further if the attacker's own
    // body reaches out there, so the ball's back (and all of the beam) stays
    // clear of it. Measured every frame, across the widest the ball can get
    // (BALL_MAX_BACK × its height, × its thickness); the most it has reached is kept.
    if (this.shot.bodyAhead) {
      this.bodyClear = Math.max(this.bodyClear, this.shot.bodyAhead(mouth, aim, BALL_MAX_BACK * H * this.W));
    }
    let start = Math.max((this.shot.root ?? ROOT) * H, this.bodyClear + this.backR * 1.05);
    const twin = this.shot.twin;
    if (twin) {
      // Level with its twin: as far forward (along the facing) as either needs.
      const fwd = twin.fwd(), along = Math.max(0.2, Vector3.Dot(aim, fwd)), base = Vector3.Dot(mouth, fwd);
      twin.reach.set(this.id, base + start * along);
      start = Math.max(start, (Math.max(...twin.reach.values()) - base) / along);
    }
    const origin = mouth.add(aim.scale(start));
    this.anchor.copyFrom(origin);
    // From where it actually starts (its ball, however far out) to the target.
    const reach = Math.max(0.2, dist - start);
    // It meets the target on its near side, not at its middle — or, in a
    // clash, the other beam right at the clash point.
    // A clash ends for this beam once it says so (the winner runs on into the loser).
    if (this.shot.clash && this.clashEndT < 0 && this.shot.clash.over?.()) {
      this.clashEndT = this.time;
      if (this.frontDone) this.splitT = this.time;
    }
    const clashing = !!this.shot.clash && this.clashEndT < 0;
    const edge = clashing ? clamp01(this.shot.clash!.edge?.() ?? 0) : this.clashEndT >= 0 ? clamp01(this.shot.clash!.edge?.() ?? 0) : 0;
    // Winning, its torn skin (the last layer) grows heavier.
    const heavier = (base: number, layer: number) => (layer === BEAM_R.length - 1 ? base * (1 - CLASH_EDGE_SKIN * edge) : base);
    const targetR = clashing || this.shot.exactTarget ? 0 : TARGET_BODY * (this.shot.targetSize?.() ?? H);
    const contactAt = Math.max(0.2, reach - targetR);
    // A clash not yet met: the front races at the target; met, it stops where
    // the two fronts crossed (the target is then the clash point), its pace
    // still set by the whole way it was racing (no jump back).
    const met = clashing && !!this.shot.clash!.at();
    if (clashing && !met) this.raceTo = contactAt;

    // Release: everything dissolves (cutoff → 1).
    let dissolve = 0;
    if (this.releasing) {
      this.releasing.t += dt;
      dissolve = clamp01(this.releasing.t / this.releasing.dur);
      // (A bursting clash ball outlives the beam's release until it has dispersed.)
      const burstLeft = this.burstT >= 0 && this.time - this.burstT < CLASH_BURST_TIME * CLASH_NET_LIFE;
      if (dissolve >= 1 && !burstLeft) { this.finish(); return; }
      dissolve = Math.min(dissolve, 1);
    }
    const cut = (base: number) => base + (1 - base) * smoothstep(0, 1, dissolve);
    this.dissolveNow = dissolve;

    // The ball: charging, then the snap and the pop, then the egg the beam pours from.
    let ball: number;
    if (!this.opened) {
      this.chargeT += dt;
      ball = 1.2 * (1 - Math.exp(-this.chargeT / CHARGE_TAU));
    } else {
      this.t += dt;
      ball = this.t < SNAP ? 1.2 * (1 - this.t / SNAP) : easeOutBack((this.t - SNAP) / POP);
    }
    // The ball pulses in size, charging and pouring (not during the snap and pop).
    // It pulses only while charging: once it pours, the egg holds steady (a
    // pulse on it read as the beam surging back and forth).
    const pulse = 1 + BALL_PULSE * Math.sin(this.time * BALL_PULSE_RATE);
    if (!this.opened) ball *= pulse;
    ball *= 1 - smoothstep(0.3, 1, dissolve);
    // The ball's poles lie along the beam, so its stripes run with the beam's.
    const poleToAim = new Quaternion();
    Quaternion.FromUnitVectorsToRef(Y, aim, poleToAim);
    // Pouring: the ball becomes the egg the column runs out of.
    const egg = this.opened ? smoothstep(SNAP + POP, SNAP + POP + EGG_IN, this.t) : 0;
    // How far its ball reaches back toward the attacker (the outermost layer, the egg's back).
    // Winning a clash, its egg swells (CLASH_EDGE_EGG) — not a bolt's: its egg keeps its size.
    const swell = 1 + CLASH_EDGE_EGG * (this.shot.bolt ? 0 : edge);
    this.backR = SPHERE_R[BEAM_R.length - 1] * H * this.W * ball * swell * (1 + (EGG_BACK - 1) * egg);
    // Its tip: the outermost layer's front, drawn out as the ball becomes the egg.
    this.eggTipPt.copyFrom(origin).addInPlace(aim.scale(
      SPHERE_R[BEAM_R.length - 1] * H * this.W * ball * swell * (1 + (EGG_FRONT - 1) * egg)));
    this.balls.forEach(({ mesh, layer }, i) => {
      layer.mat.setFloat('egg', egg);
      mesh.position.copyFrom(origin);
      mesh.scaling.setAll(Math.max(1e-3, SPHERE_R[i] * H * this.W * ball * swell));
      mesh.rotationQuaternion!.copyFrom(poleToAim);
      mesh.setEnabled(ball > 0.02 && !this.shot.eggless);
      const m = layer.mat;
      m.setVector3('origin', origin); m.setVector3('aim', aim); m.setVector3('side', side); m.setVector3('upv', up);
      m.setFloat('rad', BEAM_R[i] * H);
      m.setFloat('time', this.time + i * 1.7); // as its tube
      m.setFloat('cutoff', cut(heavier(layer.cutoff, i) * (i === BEAM_R.length - 1 ? (this.shot.bolt ? BOLT_ROOT_SKIN : ROOT_SKIN) : 1)));
    });
    // A billowing beam's starting egg bursts in a loop once it pours: shells
    // swelling forward from it (their back held at the egg's), tearing as they go.
    this.rootShells.forEach(({ mesh, layer, i, phase }) => {
      const on = this.opened && egg > 0.05 && ball > 0.02 && !this.finished && !this.shot.eggless;
      mesh.setEnabled(on);
      if (!on) return;
      const k = (this.time / TIP_LOOP + phase) % 1;
      const base = SPHERE_R[i] * H * this.W * ball * swell;
      const r = base * (1 + (ROOT_BURST - 1) * easeOutCubic(k));
      layer.mat.setFloat('egg', egg);
      // Forward by however much it has swelled, so its back stays where the egg's is.
      mesh.position.copyFrom(origin.add(aim.scale((r - base) * (1 + (EGG_BACK - 1) * egg))));
      mesh.scaling.setAll(Math.max(1e-3, r));
      mesh.rotationQuaternion!.copyFrom(poleToAim);
      const m = layer.mat;
      m.setVector3('origin', origin); m.setVector3('aim', aim); m.setVector3('side', side); m.setVector3('upv', up);
      m.setFloat('rad', BEAM_R[i] * H);
      m.setFloat('time', this.time + i * 1.7 + phase * 3.1);
      const b0 = heavier(layer.cutoff, i);
      const torn = Math.max(TIP_TEAR * smoothstep(0.2, 1, k), smoothstep(0.1, 1, dissolve));
      m.setFloat('cutoff', b0 + (1 - b0) * torn);
    });

    // Sparks swirling into the ball while it charges.
    if (!this.opened && !this.releasing && !this.shot.eggless) {
      this.owed.charge += CHARGE_RATE * dt;
      for (; this.owed.charge >= 1; this.owed.charge -= 1) {
        const d = randomDir();
        const start = origin.add(d.scale(0.85 * H));
        const tangent = Vector3.Cross(d, aim).normalize();
        this.chargeSparks.spawn(start, d.scale(-1.4 * H).add(tangent.scale(1.6 * H)), 0.32 + Math.random() * 0.12, this.anchor, 26);
      }
    }
    for (const sp of [this.chargeSparks, this.streamSparks]) sp.update(dt);

    // The light follows the beam.
    const light = this.fx.light;
    light.position.copyFrom(origin);
    light.diffuse = new Color3(...(this.col.main.map((x) => Math.min(1, x)) as RGB));
    light.intensity = this.shot.eggless ? 0 : (this.opened ? 2.6 : 1.4 * ball) * (1 - dissolve);
    light.range = 5 * H;

    if (!this.opened) return;
    const t = this.t;

    // Launch: the radial blur from the root.
    if (this.blurring) {
      const k = this.shot.eggless ? 1 : t / BLUR_LIFE;
      if (k >= 1) { this.blurring = false; this.fx.useBlur(false); this.fx.blurStrength = 0; }
      else {
        const cam = this.fx.camera;
        const sp = Vector3.Project(origin, Matrix.IdentityReadOnly, cam.getViewMatrix().multiply(cam.getProjectionMatrix()), cam.viewport.toGlobal(1, 1));
        this.fx.blurCenter.set(sp.x, 1 - sp.y);
        this.fx.blurStrength = 0.09 * Math.sin(Math.PI * Math.min(1, k * 1.4)) * (1 - k);
      }
    }
    // Slashes: squashed rings square to the beam, blowing out and dissolving.
    const toAim = new Quaternion();
    Quaternion.FromUnitVectorsToRef(Y, aim, toAim);
    this.slashes.forEach(({ mesh, layer }, i) => {
      const k = this.shot.eggless ? 1 : t / SLASH_LIFE;
      if (k >= 1) { mesh.setEnabled(false); return; }
      const s = (0.3 + 1.9 * easeOutCubic(k)) * H * (i ? 0.75 : 1);
      mesh.position.copyFrom(origin);
      Quaternion.RotationAxis(side, i ? 0.5 : -0.3).multiplyToRef(toAim, mesh.rotationQuaternion!);
      mesh.scaling.set(s, 0.06 * H, s);
      const m = layer.mat;
      m.setVector3('origin', origin); m.setVector3('aim', aim); m.setVector3('side', side); m.setVector3('upv', up);
      m.setFloat('rad', s * 0.5);
      m.setFloat('time', this.time);
      layer.mat.setFloat('cutoff', 0.3 + 0.7 * smoothstep(0.2, 1, k));
    });
    // Dust round the feet.
    const feet = this.shot.feet ? this.shot.feet() : mouth.subtract(new Vector3(0, H * 0.8, 0));
    this.dust.forEach(({ mesh, mat }, i) => {
      if (t > DUST_LIFE || !feet || this.shot.eggless) { mesh.setEnabled(false); return; }
      const k = easeOutCubic(t / 0.3);
      mesh.position.set(feet.x, feet.y + DUST_H * H * 0.5 * (i ? 0.8 : 1), feet.z);
      mesh.scaling.set(0.4 + 0.6 * k, k, 0.4 + 0.6 * k);
      mat.setFloat('time', this.time);
      mat.setFloat('cutoff', cut(0.25 + 0.75 * smoothstep(DUST_LIFE * 0.45, DUST_LIFE, t)));
    });

    // The beam: the front races out; it holds a steady thickness (no throb).
    // The front races out to the target's near side; the hit lands as it gets there.
    const grow = this.shot.instant ? 1 : easeOutCubic((t - SNAP * 0.5) / GROW);
    const len = clashing
      ? Math.max(0.01, met ? Math.min(contactAt, Math.max(this.raceTo, contactAt) * grow) : contactAt * grow)
      : Math.max(0.01, contactAt * grow);
    const arrived = clashing ? met && len >= contactAt - 1e-3 : grow >= 0.999;
    if (!this.frontDone && arrived) {
      this.frontDone = true; this.resolveFront(); this.frontT = this.time;
      if (!this.shot.clash || this.clashEndT >= 0) this.splitT = this.time;
    }
    const on = grow > 0.001;
    this.endPt.copyFrom(origin).addInPlace(aim.scale(on ? len : 0));
    // A bolt: no column (the caller's bolt runs from its egg to here).
    this.setBeamVisible(on && !this.shot.bolt);
    if (!on) return;
    const width = 1 - 0.4 * smoothstep(0.4, 1, dissolve);
    // How far it has split on the target (the arcs grow out as its end opens).
    const split = SPLIT_ARCS && this.splitT >= 0 ? easeOutCubic((this.time - this.splitT - ARC_DELAY) / ARC_GROW) : 0;
    this.tubes.forEach(({ layer }, i) => {
      const m = layer.mat;
      m.setVector3('origin', origin); m.setVector3('aim', aim); m.setVector3('side', side); m.setVector3('upv', up);
      m.setFloat('len', len); m.setFloat('rad', BEAM_R[i] * H * this.W * width * COLUMN * (this.shot.bolt ? BOLT_SKIN_R : 1));
      m.setFloat('split', split);
      m.setFloat('time', this.time + i * 1.7);
      const billow = this.shot.burstAlong && i === BEAM_R.length - 1 ? BILLOW_SKIN : this.shot.bolt ? BOLT_SKIN : 1;
      m.setFloat('cutoff', cut(heavier(layer.cutoff, i) * billow));
    });
    this.swirls.forEach(({ mat }) => {
      mat.setVector3('origin', origin); mat.setVector3('aim', aim); mat.setVector3('side', side); mat.setVector3('upv', up);
      mat.setFloat('len', len); mat.setFloat('rad', SWIRL_R * H * this.W * width); mat.setFloat('width', SWIRL_W * H * this.W);
      mat.setFloat('time', this.time); mat.setFloat('fade', 1 - dissolve);
      if (SWIRL_TORNADO && this.scene.activeCamera) mat.setVector3('camPos', this.scene.activeCamera.globalPosition);
      if (SWIRL_TORNADO) mat.setFloat('burst', this.shot.burstAlong || TORNADO_BURSTING.has(this.shot.element) ? 1 : 0);
    });
    // Sparks only where the beam meets the target, from the moment it does:
    // splashing back and outward off the contact point, swirling once out of
    // the beam, never past the target.
    const beamR = BEAM_R[2] * H * this.W * width * COLUMN;
    this.streamSparks.field = { origin, dir: aim, front: len, radius: beamR * 1.05, swirl: 5 * H };
    this.updateArcs(origin, aim, side, up, contactAt, reach, beamR, width, cut);
    this.updateClash(origin, aim, side, up, contactAt, cut, dissolve);
    this.updateTip(origin, aim, side, up, len, dissolve, heavier);
    this.updatePuffs(origin, aim, side, up, len, dissolve, heavier);
    if (!this.releasing && this.frontDone) {
      const hit = origin.add(aim.scale(contactAt)); // where it meets the target
      this.owed.stream += CONTACT_RATE * dt;
      for (; this.owed.stream >= 1; this.owed.stream -= 1) {
        const d = randomDir();
        const out = d.subtract(aim.scale(Vector3.Dot(d, aim))); // across the beam
        const back = out.scale(1.2).subtract(aim.scale(0.4 + Math.random() * 0.9)).normalize();
        const at = hit.add(out.scale(beamR * 0.6 * Math.random())).subtract(aim.scale(0.05 * H));
        // Close to the target: slow, heavily dragged and short-lived, they stay round the contact point.
        this.streamSparks.spawn(at, back.scale((2 + Math.random() * 2.4) * H), 0.15 + Math.random() * 0.22);
      }
    }
  }

  private finish(): void {
    this.clashNoise?.dispose();
    this.clashNoise = null;
    const r = this.releasing;
    this.dispose();
    r?.done();
  }

  private dispose(): void {
    if (this.finished) return;
    this.finished = true;
    if (!this.frontDone) { this.frontDone = true; this.resolveFront(); }
    this.scene.onBeforeRenderObservable.remove(this.tick);
    if (this.blurring) { this.blurring = false; this.fx.useBlur(false); }
    this.fx.light.intensity = 0;
    for (const sp of [this.chargeSparks, this.streamSparks]) sp.dispose();
    const meshes = [...this.tubes, ...this.arcs, ...this.balls, ...this.tips, ...this.shells, ...this.puffs, ...this.rootShells, ...this.hemis, ...this.slashes, ...this.swirls, ...this.dust].map((x) => x.mesh);
    for (const m of meshes) { m.material?.dispose(); m.dispose(); }
    for (const o of this.outlines) { o.mat.dispose(); o.twin.dispose(); }
  }
}

