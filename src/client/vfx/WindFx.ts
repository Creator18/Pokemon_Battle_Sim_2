/**
 * WindFx — tornadoes and wind, after a Shadertoy fire-tornado shader the user
 * supplied (raymarched, Voronoi-carved column + a see-through outer shell).
 *
 *   inner    the tornado itself: a column whose centre wanders with height
 *            (two fbm sines of y), whose radius flares toward the top
 *            (cos(1.25y + 2) + 0.75 + e^(−10y)), its surface carved by a
 *            Voronoi field laid out in (angle − 4y, y − t) — cells that wind
 *            round it and climb. Shaded by the carving: the rims of the cells
 *            glow (the source's `glow = bump < 0.35`).
 *   outer    the outer tornado: a transparent shell of radius
 *            2 − 0.66·sin(0.75y + 1), with swirling Voronoi streaks in
 *            (angle − 2.5y, y − 2t). On its own it is the wind effect.
 *
 * Both are evaluated per pixel along the view ray inside a bounding cylinder
 * mesh, in the tornado's own unit space (y −1 … TOP, the source's frame), then
 * scaled and placed in the world.
 *
 *   Gust     a whirlwind that grows out of the ground on the target, briefly
 *   Twister  a large tornado that grows out of the ground on the target and holds it
 *   shell    the outer tornado alone, round a Pokémon (wind around it)
 */

import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Matrix, Quaternion, Vector2, Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector';
import { voronoi } from './stripeShape.ts';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Constants } from '@babylonjs/core/Engines/constants';
import '@babylonjs/core/Meshes/Builders/cylinderBuilder';

type RGB = [number, number, number];

/** The source's frame: the column runs y −1 … TOP; the outer shell is at most R_OUT wide. */
const TOP = 2.4, R_OUT = 2.7;

/**
 * A stat change's sweep (WindFx.statChange): a rise's colours (red at its
 * foot into orange at its head), a fall's (light blue at its foot, blue at its
 * head: it sinks from blue into light blue); how tall it stands (× the body),
 * how fast it turns,
 * how tall its band is (the frame's units: 3.4 in all), how long the sweep,
 * and how strongly it shows.
 */
const STAT_UP: [RGB, RGB] = [[1.0, 0.12, 0.05], [1.0, 0.58, 0.08]];
const STAT_DOWN: [RGB, RGB] = [[0.1, 0.32, 1.0], [0.55, 0.85, 1.0]];
const STAT_HEIGHT = 1.35, STAT_SPIN = 5.0, STAT_BAND = 2.0, STAT_TIME = 1.3, STAT_POWER = 2.0, STAT_SHEET = 0.22;
const STEPS = 180;
/**
 * A Flying coat (WindFx.coat): its tones per element (its foot's, its head's),
 * how fast it turns, how fast it follows the body (/s), its fade in and out
 * (s), and how strongly it shows.
 */
const COAT_TONES: Record<string, [RGB, RGB]> = {
  Flying: [[0.35, 0.72, 1.0], [0.72, 0.9, 1.0]], Gold: [[1.0, 0.72, 0.12], [1.0, 0.92, 0.55]],
  Water: [[0.06, 0.36, 0.92], [0.32, 0.72, 1.0]],
  Grass: [[0.22, 0.62, 0.12], [0.6, 0.92, 0.34]],
  Normal: [[0.72, 0.68, 0.56], [0.97, 0.94, 0.84]],
  Bug: [[0.6, 0.62, 0.64], [0.97, 0.97, 0.98]],
  // (Water tornadoes in their own colours: WATERY.)
  Psychic: [[0.88, 0.16, 0.56], [1.0, 0.56, 0.82]],
  Poison: [[0.5, 0.1, 0.68], [0.78, 0.46, 0.96]],
};
/** Coats that are water tornadoes (wavy, foaming, running down): Water's, and Psychic's and Poison's in their own colours. */
export const WATERY = new Set(['Water', 'Psychic', 'Poison', 'Bug']);
const COAT_SPIN = 3.0, COAT_EASE = 9, COAT_FADE = 0.35, COAT_POWER = 2.0;
/** A Flying coat's ends: how far (frame units, 3.4 in all) it blends out at its foot and its head; the widest its shell may be drawn before its frame is widened instead. */
const COAT_SOFT = 1.1, COAT_OUTER = 0.95;
/** A Flying coat's streaks: this many times the source's, round it and up it. */
const COAT_TWIST = 2.5;
const COAT_DENSITY = 1;
/** A Flying coat standing on the ground: its streaks fade out over this far above the ground (frame units, 3.4 in all). */
const COAT_FLOOR_FADE = 1.0; // (a whole number: the noise repeats every 4 cells, and it must close round its axis seamlessly)
/** A Flying coat's change between upright and along the way: how long its wipe (s), and how soft the wipe's front (frame units). */
const COAT_WIPE = 0.6, COAT_WIPE_EDGE = 0.5;
/** A coat's burst (on contact): how far it swells (×), over how long (s), fading out as it goes. */
const COAT_BURST_GROW = 2.0, COAT_BURST_TIME = 0.35;
/** A ball's tornado-sphere noise (WindFx.orb): the angle between its two tornadoes' axes (rad), and how fast they turn. */
const ORB_TILT = Math.PI / 6, ORB_SPIN = 3.0;
/** A cel-shaded shell (its `cel`): where its streak's bands start (in its noise), how wide the ink round each (in it), and how dark (× its shell colour). */
const CEL_BANDS = [0.45, 0.62, 0.8], CEL_INK = 0.04, CEL_INK_DARK = 0.35;
/** A water tornado: how far its streaks ripple round it (rad), and how many ripples up it. */
const WATER_WOB = 0.35, WATER_WAVES = 5.0;
/**
 * A Normal coat's streaks (its `rain`): drifting squares over a rippling glow.
 * Its square cells round it and along it (per unit of angle and height), how
 * fast they drift along the streaks' way, their sizes (× a cell), how fast
 * they turn (rad/s), and the faint haze of the streak under them.
 */
const RAIN_COLS = 5.0, RAIN_ROWS = 4.0, RAIN_FALL = 0.5, RAIN_MIN = 0.3, RAIN_MAX = 0.75, RAIN_SPIN = 0.5, RAIN_HAZE = 0.08;
/** A tornado ball's clash half (WindFx.hemi): how far past its middle it runs, toward the other's half (frame units, 3.4 in all). */
const HEMI_PAST = 0.25, HEMI_SOFT = 0.05;
/**
 * The vertical hemisphere (hemiV): its streaks fade in from its flat side over
 * HEMIV_FADE of its radius, and only the middle HEMIV_KEEP of its height is
 * kept (as much cut from its top as from its bottom).
 */
const HEMIV_FADE = 0.45, HEMIV_KEEP = 0.3;
/**
 * Its shapes by the blow: a claw's (wide, HEMIV_KEEP of its height, three
 * stripes — one a claw) and a single slash's (thinner, one stripe).
 */
export const HEMIV_CLAW = { keep: HEMIV_KEEP, stripes: 3 }, HEMIV_SLASH = { keep: 0.15, stripes: 1 };
/** A wide single slash (X-Scissor's two blades): a claw's width, one stripe — so the stripe itself is the wider. */
export const HEMIV_WIDE_SLASH = { keep: HEMIV_KEEP, stripes: 1 };
export type HemiVShape = { keep: number; stripes: number };
/** Its streaks' rise (the coat's flow: 1 climbs): none — they only move round it, sideways. */
const HEMIV_FLOW = 0;
/** Its wipe's edges: how soft (in its -1 … 1 across). */
const HEMIV_WIPE_SOFT = 0.12;
/** How long it shows at full (s): exactly its shape's count of stripes in view all through it (WindFx.fillThrees). */
const HEMIV_LIFE = 0.3;
/** How many such moments are kept found ahead. */
const THREE_POOL = 18;
/**
 * Fire Spin and Whirlpool (WindFx.spin): its rings' radii (shares of the tile's), how
 * tall (world), how much each widens toward its top (flare) and its foot's
 * size in the frame; the innermost's spin and how much faster each ring out
 * turns; its tones (low, high); how long it spins up, holds and dies down (s).
 */
const SPIN_RINGS = [0.32, 0.5, 0.68, 0.86], SPIN_HEIGHT = 0.7, SPIN_FLARE = 3.0, SPIN_OUTER = 0.35;
const SPIN_SPIN = 1.6, SPIN_FASTER = 1.3;
const SPIN_TONES: Record<string, [RGB, RGB]> = { Fire: [[0.92, 0.16, 0.05], [1.0, 0.55, 0.08]], Water: [[0.06, 0.36, 0.92], [0.32, 0.72, 1.0]] };
const SPIN_UP = 0.35, SPIN_HOLD = 1.2, SPIN_DOWN = 0.45;

/** Where a Flying coat stands: its foot, its axis foot to head (unit), its height and its narrowest radius (world). */
export interface CoatPlace { base: Vector3; axis: Vector3; height: number; radius: number; /** The ground's height under it (world), standing on it. */ floor?: number }

const ROT = new Matrix();
/** The turn that takes straight up onto `axis` (unit), into `q`. */
export function turnUpTo(axis: Vector3, q: Quaternion): void {
  const up = Vector3.Up();
  const d = Vector3.Dot(up, axis);
  if (d > 0.99999) { q.set(0, 0, 0, 1); return; }
  if (d < -0.99999) { q.set(1, 0, 0, 0); return; }
  const c = Vector3.Cross(up, axis).normalize();
  Quaternion.RotationAxisToRef(c, Math.acos(Math.max(-1, Math.min(1, d))), q);
}

Effect.ShadersStore.windVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 world, viewProjection;
varying vec3 vW;
void main(void) {
  vec4 w = world * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = viewProjection * w;
}`;

Effect.ShadersStore.windFragmentShader = /* glsl */ `
precision highp float;
varying vec3 vW;
uniform vec3 camPos, base;      // base: the tornado's foot (world)
uniform float scale, time, power, inner, outer, spin;
uniform float side; // which of the shell: 0 both, 1 its near side only, 2 its far side only
uniform vec2 band;  // the shell shows only between these heights (unit frame, soft-edged): a sweep
uniform float flow; // its streaks run up (1) or down (-1)
uniform float twoTone; // the shell shaded from cShell (low) to cLight (high), not cShell alone
uniform vec3 cDark, cLight, cGlow, cShell;
uniform mat3 axisInv; // world to the tornado's frame (its axis there is +y)
uniform float widen;  // its frame stretched this much across its axis (a shell wider than the bounding mesh would be)
uniform float soft;   // how far (frame units) its shell blends out at its foot and its head
uniform float density; // how many streaks round and up it (1: the source's)
uniform float twist;  // how far its streaks wind round it per unit up (the source's 2.5: lower, they climb steeper)
uniform float sphere; // its shell a sphere round its middle (1), not the source's waisted funnel (0)
uniform vec4 cut;     // shown only on one side of a plane through its middle (xyz: the side's way in its frame, w over 0.5: on)
uniform float cutFade; // how far from that plane (frame units) its streaks fade in: a soft flat side
uniform vec2 keepY;   // shown only between these heights (its frame), cut hard: none outside
uniform float turn;   // its noise turned round its axis by this (rad): where round it its streaks lie
uniform vec4 wipe;    // a wipe across its cut half (xy: the way it sweeps — right of its facing, up — zw: its head and tail, -1 one side to 1 the other, w from its tail)
uniform float fitY;   // its streaks formed in its kept heights (1): its whole height's stripes fitted into keepY, not cropped from it
uniform float rain;   // drifting squares over a glow on its streaks (1), the way the streaks go (a Normal aura's)
uniform float flare;  // its shell widening toward its head (× at its head, over its foot's): a low ring that reads from above
uniform float water;  // a water tornado (1): its streaks wavy, as running water's, their brightest white foam
uniform float cel;    // cel shaded (1): its streaks in flat bands (cShell, cLight, then paler), each outlined dark
uniform float floorY; // the ground, in its frame's height (standing on it, upright): its streaks fade out above it (-1e3: none)

// ── the source's noise ──
vec2 hash2(vec2 p) {
  p = mod(p, 4.0);
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
float fbm1x(float x, float time) {
  float y = sin(x);
  float t = 0.01 * (-time * 130.0);
  y += sin(x * 2.1 + t) * 4.5;
  y += sin(x * 1.72 + t * 1.121) * 4.0;
  y += sin(x * 2.221 + t * 0.437) * 5.0;
  y += sin(x * 3.1122 + t * 4.269) * 2.5;
  return y * 0.06;
}
// Column centre (xz) and radius at height y.
vec3 cylAt(float y, float t) {
  float yf = y + 1.0;
  float s = cos(yf * 1.25 + 2.0) + 0.75 + exp(-10.0 * yf);
  return vec3(vec2(fbm1x(yf, t), fbm1x(yf + 78.233, t)) * (0.5 + 0.2 * yf), 0.5 + s);
}
const float BUMP = 0.3;
const float WALL = 0.18;
const float TOP = ${TOP.toFixed(2)};
#define STEPS ${STEPS}
float world(vec3 p, float t, out float bump) {
  vec3 c = cylAt(p.y, t);
  vec2 q = vec2(atan(p.x - c.x, p.z - c.y) * 4.0 / 6.2831 - p.y * 4.0 + t * spin, p.y - t) * 2.0;
  float n = voronoi(q, t) * BUMP;
  bump = n;
  // A hollow funnel: a wall WALL thick, so you can see down into it and out from inside.
  return abs(length(p.xz - c.xy) - (c.z - n) * inner) - WALL * inner;
}
// Where the ray enters the bounding volume (radius R_OUT, y −1 … TOP); 0 if it starts inside.
float entry(vec3 ro, vec3 rd) {
  float a = dot(rd.xz, rd.xz), b = 2.0 * dot(ro.xz, rd.xz), c = dot(ro.xz, ro.xz) - ${R_OUT.toFixed(2)} * ${R_OUT.toFixed(2)};
  float tr = 0.0;
  if (c > 0.0) { float disc = b * b - 4.0 * a * c; if (disc < 0.0 || a < 1e-6) return -1.0; tr = (-b - sqrt(disc)) / (2.0 * a); }
  float ty = 0.0;
  if (ro.y > TOP) ty = (TOP - ro.y) / rd.y; else if (ro.y < -1.0) ty = (-1.0 - ro.y) / rd.y;
  if (ty < 0.0) return -1.0;
  return max(max(tr, ty), 0.0);
}

// Drifting squares over a rippling glow (after a Shadertoy "noise
// background + rotating rectangles"): along the way the streaks go, a smooth
// fbm glow rippling forward, and small soft-edged squares drifting with it,
// each its own size, turning as it goes, the bigger the brighter. One square
// per cell (not the original's loop of 60). Returns (glow, squares).
float rhash(vec2 p) { return fract(sin(mod(dot(p, vec2(12.9898, 78.233)), 3.14159265)) * 43758.5453); }
float rnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(rhash(i), rhash(i + vec2(1.0, 0.0)), u.x), mix(rhash(i + vec2(0.0, 1.0)), rhash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float rfbm(vec2 uv) {
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  float f = 0.5 * rnoise(uv); uv = m * uv;
  f += 0.25 * rnoise(uv); uv = m * uv;
  f += 0.125 * rnoise(uv); uv = m * uv;
  f += 0.0625 * rnoise(uv);
  return f;
}
vec2 rainAt(vec2 q, float t) {
  // (q: across, along; moving on along as time goes.)
  vec2 m = vec2(q.x, q.y - t * ${RAIN_FALL.toFixed(2)});
  float rip = rfbm(vec2(m.x * 2.0, m.y * 1.0 - t * 0.1)) * 0.4;
  float glow = smoothstep(0.35, 0.8, rfbm(m * 3.0 + rip));
  vec2 g = m * vec2(${RAIN_COLS.toFixed(1)}, ${RAIN_ROWS.toFixed(1)});
  vec2 cell = floor(g);
  float rnd = rhash(cell * 0.37 + 1.3);
  float size = ${RAIN_MIN.toFixed(2)} + (${RAIN_MAX.toFixed(2)} - ${RAIN_MIN.toFixed(2)}) * rnd;
  vec2 at = vec2(0.5) + (vec2(rhash(cell + 4.1), rhash(cell + 7.7)) - 0.5) * (1.0 - size);
  vec2 d = fract(g) - at;
  float a = rnd * 6.2831 + t * ${RAIN_SPIN.toFixed(2)};
  d = mat2(cos(a), -sin(a), sin(a), cos(a)) * d;
  float blur = (${RAIN_MAX.toFixed(2)} - size) * 0.5 + 0.02;
  vec2 e = smoothstep(0.0, blur, vec2(size * 0.5) - abs(d));
  float sq = e.x * e.y * (0.4 + 0.6 * size / ${RAIN_MAX.toFixed(2)}) * step(0.35, rhash(cell + 2.9));
  return vec2(glow, sq);
}

// The shell's crossing (front: i = 0, back: i = 1) and its opacity there.
float shellAt(vec3 ro, vec3 rd, int i, float t0, out float sHit, out vec3 sCol) {
  sHit = -1.0;
  sCol = cShell;
  float s = -1.0;
  vec3 p = vec3(0.0);
  float cutK = 1.0;
  if (sphere > 0.5) {
    // A sphere filling the frame (its foot to its head), round its middle.
    vec3 oc = ro - vec3(0.0, 0.5 * (TOP - 1.0), 0.0);
    float rr = 0.5 * (TOP + 1.0);
    float b = dot(oc, rd), c = dot(oc, oc) - rr * rr;
    float disc = b * b - c;
    if (disc < 0.0) return 0.0;
    s = -b + (i == 0 ? -1.0 : 1.0) * sqrt(disc);
    p = ro + rd * s;
  } else if (flare > 0.0) {
    // Flared (a low ring seen from above): a cone, its radius the source's at
    // its foot, growing in a straight line to (1 + flare) × that at its head.
    float R0 = 1.84 * outer, B = R0 * flare / (TOP + 1.0), A = R0 + B;
    float ry = A + B * ro.y;
    float a = dot(rd.xz, rd.xz) - B * B * rd.y * rd.y;
    float b = 2.0 * dot(ro.xz, rd.xz) - 2.0 * B * rd.y * ry;
    float c = dot(ro.xz, ro.xz) - ry * ry;
    float disc = b * b - 4.0 * a * c;
    if (disc < 0.0 || abs(a) < 1e-6) return 0.0;
    float q = sqrt(disc);
    float s0 = (-b - q) / (2.0 * a), s1 = (-b + q) / (2.0 * a);
    if (s0 > s1) { float tmp = s0; s0 = s1; s1 = tmp; }
    // (Only the crossings on its own, upper nappe and within its height.)
    vec3 p0 = ro + rd * s0, p1 = ro + rd * s1;
    bool ok0 = s0 > 0.0 && p0.y >= -1.0 && p0.y <= TOP && A + B * p0.y > 0.0;
    bool ok1 = s1 > 0.0 && p1.y >= -1.0 && p1.y <= TOP && A + B * p1.y > 0.0;
    if (i == 0) { if (ok0) { s = s0; p = p0; } else if (ok1) { s = s1; p = p1; } else return 0.0; }
    else { if (ok0 && ok1) { s = s1; p = p1; } else return 0.0; }
  } else {
    // The source's shell: radius 2 - 0.66 sin(0.75y + 1), found in two goes.
    float R = (2.0 - 0.66 * 0.5) * outer;
    for (int k = 0; k < 2; k++) {
      float a = dot(rd.xz, rd.xz), b = 2.0 * dot(ro.xz, rd.xz), c = dot(ro.xz, ro.xz) - R * R;
      float disc = b * b - 4.0 * a * c;
      if (disc < 0.0 || a < 1e-5) return 0.0;
      s = (-b + (i == 0 ? -1.0 : 1.0) * sqrt(disc)) / (2.0 * a);
      p = ro + rd * s;
      if (k == 0) R = (2.0 - sin(p.y * 0.75 + 1.0) * 0.66) * outer;
    }
  }
  {
    if (s <= 0.0 || p.y < -1.0 || p.y > TOP) return 0.0;
    // (Cut by a plane through its middle: only its half on the plane's side, the seam soft.)
    if (cut.w > 0.5) {
      float dc = dot(p - vec3(0.0, 0.5 * (TOP - 1.0), 0.0), cut.xyz);
      if (dc <= 0.0) return 0.0;
      // (Fading in from the flat side.)
      cutK = smoothstep(0.0, max(cutFade, 1e-3), dc);
      // (Wiped across it the way the blow swept: shown between its tail and its head.)
      if (dot(wipe.xy, wipe.xy) > 1e-6) {
        float da = mod(atan(p.x, p.z) - atan(cut.x, cut.z) + 3.14159265, 6.2831853) - 3.14159265;
        vec2 at2 = vec2(da / 1.5707963, (p.y - 0.5 * (keepY.x + keepY.y)) / max(0.5 * (keepY.y - keepY.x), 1e-3));
        float sw = dot(at2, normalize(wipe.xy));
        cutK *= smoothstep(wipe.w - ${HEMIV_WIPE_SOFT.toFixed(2)}, wipe.w + ${HEMIV_WIPE_SOFT.toFixed(2)}, sw) * (1.0 - smoothstep(wipe.z - ${HEMIV_WIPE_SOFT.toFixed(2)}, wipe.z + ${HEMIV_WIPE_SOFT.toFixed(2)}, sw));
      }
    }
    // (Only its kept middle, cut hard.)
    if (p.y < keepY.x || p.y > keepY.y) return 0.0;
    sHit = s;
    float ang = atan(p.x, p.z) - turn;
    // (Water: its streaks rippling as they wind, as running water does.)
    // (Its height in its streaks' field: its own — or, fitted, its kept
    // heights stretched to its whole height, so its stripes form whole there.)
    float yn = fitY > 0.5 ? mix(-1.0, TOP, (p.y - keepY.x) / max(keepY.y - keepY.x, 1e-3)) : p.y;
    float wob = water * ${WATER_WOB.toFixed(2)} * sin(yn * ${WATER_WAVES.toFixed(1)} - t0 * 3.0 + ang * 2.0);
    float f = voronoi(vec2(ang + wob - yn * twist - t0 * spin * 0.6, yn - t0 * 2.0 * flow) * 4.0 * density / 6.2831, t0 * 0.1);
    float h = smoothstep(-1.0, 2.0, p.y);
    float v = pow(f, 0.75);
    float a2 = smoothstep(0.4, 0.5, v) * (0.35 + 0.45 * h);
    if (cel > 0.5) {
      // Flat bands, solid, the streak's edge inked: as the inked fire sphere.
      a2 = v < ${CEL_BANDS[0].toFixed(2)} ? 0.0 : 1.0;
      sCol = v < ${(CEL_BANDS[0] + CEL_INK).toFixed(3)} ? cShell * ${CEL_INK_DARK.toFixed(2)}
        : v < ${CEL_BANDS[1].toFixed(2)} ? cShell : v < ${CEL_BANDS[2].toFixed(2)} ? cLight : mix(cLight, vec3(1.0), water > 0.5 ? 0.92 : 0.6);
    }
    if (rain > 0.5) {
      // Its streaks: drifting squares over a glow, along the way they move.
      vec2 way = normalize(vec2(-spin * 0.6, -2.0 * flow));
      vec2 q = vec2(ang, p.y);
      vec2 r = rainAt(vec2(dot(q, vec2(-way.y, way.x)), dot(q, way)), t0);
      // (Only on the streaks; the head white, the rest its palette, dark to light.)
      float on = step(0.36, v);
      // (Cel shaded: its glow in flat steps of its palette, the squares hard
      // edged and flat lighter still, over it, a dark ink round each.)
      float gl = floor(r.x * 3.0 + 0.5) / 3.0;
      float sq = step(0.5, r.y), ink = step(0.12, r.y) - sq;
      sCol = mix(mix(cShell * 0.7, cLight, gl), vec3(1.0), sq * 0.8);
      sCol = mix(sCol, cShell * 0.35, ink);
      a2 = on * (clamp(0.45 * gl + sq + ink, 0.0, 1.0) + ${RAIN_HAZE.toFixed(2)});
    }
    if (twoTone > 0.5 && cel < 0.5) {
      sCol = mix(cShell, cLight, clamp((p.y + 1.0) / (TOP + 1.0), 0.0, 1.0));
      // (A stat change's: a see-through sheet of its colour under the streaks.)
      a2 = max(a2, ${STAT_SHEET.toFixed(2)});
    }
    // (A sweep: only within the band, its edges soft.)
    a2 *= smoothstep(band.x - 0.5, band.x, p.y) * (1.0 - smoothstep(band.y, band.y + 0.5, p.y));
    a2 *= cutK;
    // (Upright on the ground: faded out as it nears the ground, not cut off by it.)
    a2 *= smoothstep(floorY, floorY + ${COAT_FLOOR_FADE.toFixed(2)}, p.y);
    return a2 * smoothstep(-1.0, -1.0 + soft, p.y) * smoothstep(TOP, TOP - soft, p.y);
  }
  return 0.0;
}

void main(void) {
  // The view ray, in the tornado's unit space, from where it enters the bounding mesh.
  vec3 ro = axisInv * ((camPos - base) / scale);
  vec3 rd = axisInv * (vW - camPos);
  ro.xz /= widen; rd.xz /= widen;
  rd = normalize(rd);
  float t0 = time;
  float start = entry(ro, rd);
  if (start < 0.0) discard;
  // A hair inside: a ray entering through the top cap at exactly y = TOP would
  // round to just above it and miss the column for whole rows of pixels.
  start += 0.01;

  // Inner tornado: march.
  vec3 colC = vec3(0.0); float aC = 0.0; float tHit = 1e9;
  if (inner > 0.001) {
    float d = start, dPrev = start;
    for (int i = 0; i < STEPS; i++) {
      vec3 p = ro + rd * d;
      if ((rd.y > 0.0 && p.y > TOP) || (rd.y < 0.0 && p.y < -1.05)) break;
      float bump;
      float s = world(p, t0, bump);
      // (Not the flared foot right at the floor: grazing rays there flickered row by row.)
      // Hit tolerance grows with distance (about a pixel's footprint): rays that
      // run along the leaning inner wall would otherwise hit or miss row by row.
      float eps = 0.004 + 0.012 * (d - start);
      if (s < eps && p.y >= -0.85 && p.y <= TOP + 0.02) {
        // Refine the hit between the last two samples (a stepped hit height
        // shows as bands, the top fade most of all).
        float lo = dPrev, hi = d;
        for (int k = 0; k < 6; k++) {
          float mid = 0.5 * (lo + hi);
          float bm; if (world(ro + rd * mid, t0, bm) < eps) hi = mid; else lo = mid;
        }
        d = hi; p = ro + rd * d; s = world(p, t0, bump);
        vec3 c = cylAt(p.y, t0);
        // How deep the carving is here (0 at the deepest cell, 1 on the crest).
        float b = clamp(1.0 - bump / BUMP, 0.0, 1.0);
        float rim = 1.0 - smoothstep(0.2, 0.42, b);
        float h = clamp((p.y + 1.0) / (TOP + 1.0), 0.0, 1.0);
        colC = mix(mix(cDark, cLight, smoothstep(0.1, 1.0, b)), cGlow, rim * 0.85) * (0.75 + 0.35 * h);
        aC = smoothstep(TOP + 0.05, TOP - 0.35, p.y) * smoothstep(-0.85, -0.45, p.y);
        // Seen from inside (or down into it), the far wall reads a little darker.
        if (length(ro.xz - c.xy) < c.z * inner) colC *= 0.8;
        tHit = d;
        break;
      }
      dPrev = d;
      d += max(s * 0.32, 0.004); // the radius changes fast with height: small steps, or rays skip the wall
      if (d > start + ${(R_OUT * 2 + 1).toFixed(1)}) break;
    }
  }

  // Composite back to front, premultiplied: back of the shell, the column, front of the shell.
  vec4 acc = vec4(0.0);
  if (outer > 0.001 && side != 1.0) {
    float sb; vec3 cb; float ab = shellAt(ro, rd, 1, t0, sb, cb);
    if (sb > 0.0 && sb < tHit) acc = vec4(cb * ab, ab);
  }
  acc = vec4(colC * aC, aC) + acc * (1.0 - aC);
  if (outer > 0.001 && side != 2.0) {
    float sf; vec3 cf; float af = shellAt(ro, rd, 0, t0, sf, cf);
    if (sf > 0.0 && sf < tHit) acc = vec4(cf * af, af) + acc * (1.0 - af);
  }
  acc *= power;
  // (Never more than solid: past 1, the premultiplied blend would take the
  // background away — grass seen through it turning pink.)
  if (acc.a > 1.0) acc /= acc.a;
  if (acc.a < 0.01) discard;
  gl_FragColor = acc;
}`;

export interface WindStyle { dark: RGB; light: RGB; glow: RGB; shell: RGB }


/** Colours per element: the source's grey column with a pale-blue shell, and its fire glow for Fire. */
export function windStyle(element: string): WindStyle {
  switch (element) {
    case 'Fire': return { dark: [0.08, 0.02, 0.0], light: [0.9, 0.35, 0.05], glow: [1.0, 0.75, 0.15], shell: [1.0, 0.55, 0.15] };
    case 'BlueFire': return { dark: [0.0, 0.01, 0.08], light: [0.05, 0.2, 0.9], glow: [0.4, 0.62, 1.0], shell: [0.1, 0.3, 1.0] };
    case 'GhostFire': return { dark: [0.04, 0.02, 0.06], light: [0.55, 0.25, 0.9], glow: [0.8, 0.7, 1.0], shell: [0.6, 0.35, 0.95] };
    case 'Ground': return { dark: [0.3, 0.2, 0.08], light: [0.86, 0.66, 0.36], glow: [1.0, 0.9, 0.66], shell: [0.5, 0.32, 0.12] };
    case 'Dragon': return { dark: [0.12, 0.04, 0.22], light: [0.55, 0.35, 0.9], glow: [0.85, 0.75, 1.0], shell: [0.6, 0.45, 1.0] };
    default: return { dark: [0.45, 0.5, 0.55], light: [0.92, 0.95, 0.98], glow: [1.0, 1.0, 1.0], shell: [0.3, 0.7, 1.0] }; // Flying / wind
  }
}

export interface Tornado {
  mesh: Mesh;
  mat: ShaderMaterial;
  /** The foot (world). */
  base: Vector3;
  /** World units per source unit. */
  scale: number;
  power: number;
  inner: number;
  outer: number;
  /** The way it stands, its foot to its head (world, unit): up, unless laid along a way. */
  axis: Vector3;
  /** Stretched this much across its axis (1: round as drawn). */
  widen: number;
  /** World to its frame, as the shader reads it. */
  axisInv: Float32Array;
  /** Its own clock, ahead of the others by this (s): where in its noise its streaks are. */
  clock?: number;
}

export class WindFx {
  private live = new Set<Tornado>();
  private time = 0;
  private tick: Observer<Scene>;

  constructor(readonly scene: Scene, readonly camera: Camera) {
    this.tick = scene.onBeforeRenderObservable.add(() => this.update());
    // (A vertical hemisphere's moments, found ahead: see fillThrees.)
    this.fillThrees();
  }

  /** A tornado (inner column and/or outer shell), standing at `base`, `height` tall. */
  /**
   * `side`: 'both' (the default: traced on the bounding mesh's inside faces);
   * 'near' — only the shell's near side, traced on the mesh's OUTSIDE faces,
   * so it shows in front of whatever stands inside it (a storm round the
   * field); 'far' — only its far side, on the inside faces, hidden by what
   * stands in front of it.
   */
  make(base: Vector3, height: number, style: WindStyle,
    { inner = 1, outer = 1, spin = 2.2, side = 'both' as 'both' | 'near' | 'far' } = {}): Tornado {
    const scale = height / (TOP + 1);
    // A bounding cylinder over the whole funnel, in the tornado's frame.
    const mesh = MeshBuilder.CreateCylinder('tornado', { height: TOP + 1, diameter: R_OUT * 2, tessellation: 32 }, this.scene);
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    const mat = new ShaderMaterial('tornadoMat', this.scene, { vertex: 'wind', fragment: 'wind' }, {
      attributes: ['position'],
      uniforms: ['world', 'viewProjection', 'camPos', 'base', 'scale', 'time', 'power', 'inner', 'outer', 'spin', 'side', 'cDark', 'cLight', 'cGlow', 'cShell',
        'band', 'flow', 'twoTone', 'axisInv', 'widen', 'soft', 'density', 'twist', 'sphere', 'floorY', 'cel', 'water', 'flare', 'rain', 'cut', 'cutFade', 'keepY', 'turn', 'fitY', 'wipe'],
      needAlphaBlending: true,
    });
    // The bounding mesh's INSIDE faces: they are there whether the camera is
    // outside, inside or above; each pixel's ray is traced once, from where it
    // enters the volume (or from the camera, inside it).
    mat.backFaceCulling = true;
    mat.cullBackFaces = side === 'near';
    mat.disableDepthWrite = true;
    mat.alphaMode = Constants.ALPHA_PREMULTIPLIED;
    const v3 = (c: RGB) => new Vector3(c[0], c[1], c[2]);
    mat.setVector3('cDark', v3(style.dark)); mat.setVector3('cLight', v3(style.light));
    mat.setVector3('cGlow', v3(style.glow)); mat.setVector3('cShell', v3(style.shell));
    mat.setFloat('spin', spin);
    mat.setFloat('side', side === 'near' ? 1 : side === 'far' ? 2 : 0);
    mat.setVector2('band', new Vector2(-10, 10));
    mat.setFloat('flow', 1);
    mat.setFloat('twoTone', 0);
    mat.setFloat('soft', 0.4);
    mat.setFloat('density', 1);
    mat.setFloat('twist', 2.5);
    mat.setFloat('sphere', 0);
    mat.setFloat('floorY', -1e3);
    mat.setFloat('cel', 0);
    mat.setFloat('water', 0);
    mat.setFloat('flare', 0);
    mat.setFloat('rain', 0);
    mat.setVector4('cut', new Vector4(0, 0, 0, 0));
    mat.setFloat('cutFade', 0);
    mat.setVector2('keepY', new Vector2(-10, 10));
    mat.setFloat('turn', 0);
    mat.setFloat('fitY', 0);
    mat.setVector4('wipe', new Vector4(0, 0, 0, 0));
    mesh.material = mat;
    const t: Tornado = { mesh, mat, base: base.clone(), scale, power: 0, inner, outer, axis: Vector3.Up(), widen: 1, axisInv: new Float32Array(9) };
    this.live.add(t);
    this.place(t);
    return t;
  }

  dispose(t: Tornado): void {
    this.live.delete(t);
    t.mat.dispose();
    t.mesh.dispose();
  }

  private place(t: Tornado): void {
    // Its frame turned from straight up onto its axis, about its foot.
    const q = t.mesh.rotationQuaternion ??= new Quaternion();
    turnUpTo(t.axis, q);
    t.mesh.position.copyFrom(t.base).addInPlace(t.axis.scale(((TOP - 1) / 2 + 1) * t.scale));
    t.mesh.scaling.set(t.scale * t.widen, t.scale, t.scale * t.widen);
    Matrix.FromQuaternionToRef(q, ROT);
    // The inverse (its transpose), as a 3x3 laid out as the shader reads it.
    // (Its own array: the material keeps the array, not a copy of it.)
    const m = ROT.m, inv = t.axisInv;
    inv[0] = m[0]; inv[1] = m[4]; inv[2] = m[8];
    inv[3] = m[1]; inv[4] = m[5]; inv[5] = m[9];
    inv[6] = m[2]; inv[7] = m[6]; inv[8] = m[10];
    t.mat.setMatrix3x3('axisInv', inv);
  }

  private update(): void {
    this.time += Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
    const cam = this.camera.globalPosition;
    for (const t of this.live) {
      this.place(t);
      // The shader's frame has its foot at y = −1: shift the base by one unit.
      const m = t.mat;
      m.setVector3('camPos', cam);
      m.setVector3('base', t.base.add(t.axis.scale(t.scale)));
      m.setFloat('scale', t.scale); m.setFloat('time', this.time + (t.clock ?? 0));
      m.setFloat('power', t.power); m.setFloat('inner', t.inner); m.setFloat('outer', t.outer);
      m.setFloat('widen', t.widen);
    }
  }

  // ── the moves ─────────────────────────────────────────────────────────

  /**
   * Gust: a whirlwind grows up out of the ground on the target's tile, whips
   * round it briefly and blows out. `hit` once it has grown; `contactEnds`
   * when it lets go.
   */
  gust(at: () => Vector3, size: number, element = 'Flying'): { hit: Promise<void>; contactEnds: Promise<void>; done: Promise<void> } {
    return this.rising(at, size * 1.3, element, { grow: 1.1, hold: 1.4, fade: 0.5, inner: 0.75, outer: 0.7, spin: 3 });
  }

  /**
   * Twister: a big tornado grows up out of the ground on the target and holds
   * it, then dies.
   */
  twister(at: () => Vector3, size: number, element = 'Dragon'): { hit: Promise<void>; contactEnds: Promise<void>; done: Promise<void> } {
    return this.rising(at, size * 2.2, element, { grow: 1.5, hold: 2.0, fade: 0.6, inner: 0.8, outer: 1, spin: 2.6 });
  }

  /** Sand Tomb: the tornado's outer whirl alone (no column), growing up round the target and holding it. */
  tomb(at: () => Vector3, size: number, element = 'Ground'): { hit: Promise<void>; contactEnds: Promise<void>; done: Promise<void> } {
    // (Two-toned, a sheet of sand under its streaks: a plain shell alone barely shows on the board.)
    return this.rising(at, size * 1.6, element, { grow: 1.0, hold: 1.8, fade: 0.6, inner: 0, outer: 0.9, spin: 3.2, twoTone: true, power: 2.2 });
  }

  /** A tornado that grows up from the ground at `at` (its height scales from 0), holds, and fades. */
  private rising(at: () => Vector3, height: number, element: string,
    o: { grow: number; hold: number; fade: number; inner: number; outer: number; spin: number; twoTone?: boolean; power?: number }) {
    // (A shell alone is drawn in two halves, as the coats are: traced from its
    // bounding mesh's inside faces a pixel sits at its far wall, so a body
    // standing in it would hide its front too. Its far side from the inside
    // faces, its near side from the outside ones, in front of the body.)
    const halves = o.inner > 0 ? null : (['near', 'far'] as const).map((side) =>
      this.make(at(), height, windStyle(element), { inner: 0, outer: o.outer, spin: o.spin, side }));
    const t = halves ? halves[1] : this.make(at(), height, windStyle(element), { inner: o.inner, outer: o.outer, spin: o.spin });
    const near = halves ? halves[0] : null;
    for (const h of halves ?? [t]) if (o.twoTone) h.mat.setFloat('twoTone', 1);
    const full = t.scale;
    let endContact!: () => void;
    const contactEnds = new Promise<void>((r) => { endContact = r; });
    let ended = false;
    const res = this.animate(t, (k, dt, el) => {
      const p = at();
      t.base.set(p.x, p.y, p.z);
      // Out of the ground: the funnel's size rises gradually from nothing (its foot stays on the tile).
      const g = Math.min(1, el / o.grow);
      t.scale = full * Math.max(0.02, g * g * (3 - 2 * g));
      t.power = (o.power ?? 1) * Math.min(1, el / (o.grow * 0.5)) * (1 - Math.max(0, (el - o.grow - o.hold) / o.fade));
      if (near) { near.base.copyFrom(t.base); near.scale = t.scale; near.power = t.power; }
      if (!ended && el >= o.grow + o.hold) { ended = true; endContact(); }
      return { hitNow: el >= o.grow, over: el >= o.grow + o.hold + o.fade };
    });
    void res.done.then(() => { if (!ended) endContact(); if (near) this.dispose(near); });
    return { ...res, contactEnds };
  }

  /** The outer tornado alone, round a Pokémon, for `seconds` (wind around it). */
  shell(at: () => Vector3, size: number, seconds = 1.2, element = 'Flying'): Promise<void> {
    const t = this.make(at(), size * 1.4, windStyle(element), { inner: 0, outer: 0.55, spin: 2 });
    return this.animate(t, (k, dt, el) => {
      const p = at();
      t.base.set(p.x, p.y, p.z);
      t.power = Math.min(1, el / 0.2) * (1 - Math.max(0, (el - seconds + 0.3) / 0.3));
      return { hitNow: false, over: el >= seconds };
    }).done;
  }

  /**
   * A stat change, momentary: the outer tornado round the Pokémon, swept
   * through it — rising from its feet to over its head in red into orange
   * (a rise), or sinking from over its head to its feet in blue into light
   * blue (a fall), its streaks running the same way. Resolves once it is gone.
   */
  /** `size`: its height; `radius`: how far round it the sweep stands (clear of its body). */
  statChange(at: () => Vector3, size: number, up: boolean, radius = size * 0.5): Promise<void> {
    const style: WindStyle = up
      ? { dark: STAT_UP[0], light: STAT_UP[1], glow: STAT_UP[1], shell: STAT_UP[0] }
      : { dark: STAT_DOWN[1], light: STAT_DOWN[0], glow: STAT_DOWN[0], shell: STAT_DOWN[1] };
    const height = size * STAT_HEIGHT;
    // (The shell's radius is about 1.67 × outer × scale in the world.)
    const outer = Math.min(1.3, radius / (1.67 * (height / (TOP + 1))));
    // Two halves, as the storm walls are: the near side on the bounding
    // mesh's outside faces (drawn over the body in front of it), the far side
    // on its inside faces (hidden behind the body) — so it wraps the Pokémon.
    const [t, back] = (['near', 'far'] as const).map((side) => {
      const h = this.make(at(), height, style, { inner: 0, outer, spin: STAT_SPIN, side });
      h.mat.setFloat('flow', up ? 1 : -1);
      h.mat.setFloat('twoTone', 1);
      return h;
    });
    // The band (STAT_BAND tall) sweeps the frame's whole height, y −1 … TOP, and off.
    const from = -1 - STAT_BAND, to = TOP + STAT_BAND;
    // (Timed from when its shaders are ready: the sweep is shorter than a first compile.)
    let since = -1;
    const done = this.animate(t, (k, dt, el) => {
      const p = at();
      for (const h of [t, back]) h.base.set(p.x, p.y, p.z);
      if (since < 0) {
        if (!t.mat.isReady(t.mesh) || !back.mat.isReady(back.mesh)) {
          for (const h of [t, back]) h.mat.setVector2('band', new Vector2(-10, -10));
          return { hitNow: false, over: false };
        }
        since = el;
      }
      const u = Math.min(1, (el - since) / STAT_TIME);
      const e = u * u * (3 - 2 * u);
      const lead = up ? from + (to - from) * e : to - (to - from) * e;
      const band = up ? new Vector2(lead - STAT_BAND, lead) : new Vector2(lead, lead + STAT_BAND);
      for (const h of [t, back]) { h.mat.setVector2('band', band); h.power = STAT_POWER; }
      return { hitNow: false, over: u >= 1 };
    }).done;
    return done.then(() => this.dispose(back));
  }

  /**
   * A see-through outer tornado round a Pokémon for as long as it lasts (a
   * Flying coat): its near half drawn over the body, its far half behind it,
   * its streaks always rising from its foot to its head. Two of them: one
   * upright (`still`), one along the way it goes (`move`), placed by `follow`
   * every frame (each one's foot, axis foot to head, height, and how wide it
   * stands at its narrowest). Only the one for whether it is `moving` shows;
   * on a change the one going wipes away from its foot to its head as the one
   * coming wipes in from its foot to its head, at the same rate.
   */
  /** `shape` 'sphere' (the default): each a sphere round the body, its middle; 'tornado': the source's waisted funnel. */
  /**
   * `cel`: cel shaded (flat bands, inked), its near halves drawn over the
   * auras by `overAuras` (UnitFx.addOver) — the aura between its far side and its near.
   */
  coat(follow: (dt: number) => { moving: boolean; still: CoatPlace; move: CoatPlace }, element = 'Flying',
    shape: 'sphere' | 'tornado' = 'sphere', cel = false, overAuras?: (mesh: Mesh) => () => void,
    underAuras?: (mesh: Mesh) => () => void, alive?: () => boolean): { release: () => Promise<void>; burst: () => Promise<void> } {
    const undos: (() => void)[] = [];
    const st = windStyle(element);
    const tones = COAT_TONES[element];
    const style: WindStyle = { ...st, shell: tones?.[0] ?? st.shell, light: tones?.[1] ?? st.light };
    const f0 = follow(0);
    type Layer = { halves: Tornado[]; place: CoatPlace; state: 'shown' | 'in' | 'out' | 'hidden'; u: number };
    const layer = (p: CoatPlace, shown: boolean): Layer => ({
      halves: (['near', 'far'] as const).map((side) => {
        const h = this.make(p.base, p.height, style, { inner: 0, outer: 1, spin: COAT_SPIN, side });
        h.mat.setFloat('flow', 1);
        // (Its streaks alone, in its colour: no see-through sheet between them.)
        h.mat.setFloat('twoTone', 0);
        h.mat.setFloat('soft', COAT_SOFT);
        h.mat.setFloat('density', COAT_DENSITY);
        h.mat.setFloat('twist', COAT_TWIST);
        h.mat.setFloat('sphere', shape === 'sphere' ? 1 : 0);
        h.mat.setFloat('cel', cel ? 1 : 0);
        // (Water: wavy, foaming, running down round the body.)
        if (WATERY.has(element)) { h.mat.setFloat('water', 1); h.mat.setFloat('flow', -1); }
        // (Normal's: drifting squares on its streaks.)
        if (element === 'Normal') h.mat.setFloat('rain', 1);
        if (cel && side === 'near' && overAuras) undos.push(overAuras(h.mesh));
        // (Its far side in its unit's own back layer — under its aura, over a farther unit's whole stack.)
        if (side === 'far' && underAuras) undos.push(underAuras(h.mesh));
        return h;
      }),
      place: { base: p.base.clone(), axis: p.axis.clone(), height: p.height, radius: p.radius },
      state: shown ? 'shown' : 'hidden', u: 0,
    });
    const still = layer(f0.still, !f0.moving), move = layer(f0.move, f0.moving);
    let moving = f0.moving;
    let fade = 0, letGo = false, gone!: () => void;
    // Burst (on contact: Aqua Jet's): it swells out, torn away, gone over COAT_BURST_TIME s.
    let burstK = -1;
    const over = new Promise<void>((r) => { gone = r; });
    // The wipe's front, in the frame (y -1 ... TOP), from just under its foot to past its head.
    const front = (u: number) => -1 - COAT_WIPE_EDGE + (TOP + 1 + 2 * COAT_WIPE_EDGE) * (u * u * (3 - 2 * u));
    const obs = this.scene.onBeforeRenderObservable.add(() => {
      // (Its wearer gone - taken off the field mid-move, its fight over: gone with it at once, never left standing.)
      if (alive && !alive()) {
        this.scene.onBeforeRenderObservable.remove(obs);
        for (const u of undos) u();
        for (const h of [...still.halves, ...move.halves]) this.dispose(h);
        gone();
        return;
      }
      const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
      const f = follow(dt);
      if (f.moving !== moving) {
        moving = f.moving;
        const [going, coming] = moving ? [still, move] : [move, still];
        if (going.state !== 'hidden') { going.state = 'out'; going.u = 0; }
        coming.state = 'in'; coming.u = 0;
        // (Coming in: laid the way it is going at once, nothing to turn from.)
        const p = moving ? f.move : f.still;
        coming.place.axis.copyFrom(p.axis); coming.place.height = p.height; coming.place.radius = p.radius;
      }
      fade = letGo ? Math.max(0, fade - dt / COAT_FADE) : Math.min(1, fade + dt / COAT_FADE);
      let swell = 1;
      if (burstK >= 0) {
        burstK = Math.min(1, burstK + dt / COAT_BURST_TIME);
        swell = 1 + (COAT_BURST_GROW - 1) * (1 - (1 - burstK) * (1 - burstK));
        fade = Math.min(fade, (1 - burstK) * (1 - burstK));
        if (burstK >= 1) { letGo = true; fade = 0; }
      }
      const k = 1 - Math.exp(-dt * COAT_EASE);
      for (const [L, p] of [[still, f.still], [move, f.move]] as const) {
        if (L.state === 'in' || L.state === 'out') {
          L.u = Math.min(1, L.u + dt / COAT_WIPE);
          if (L.u >= 1) L.state = L.state === 'in' ? 'shown' : 'hidden';
        }
        // Its turn and size eased; where it stands never: kept on the body's
        // middle along its axis as it turns, so it never trails the body.
        const q = L.place;
        if (L.state === 'hidden') { q.axis.copyFrom(p.axis); q.height = p.height; q.radius = p.radius; }
        Vector3.LerpToRef(q.axis, p.axis, k, q.axis);
        if (q.axis.lengthSquared() < 1e-6) q.axis.copyFrom(p.axis);
        q.axis.normalize();
        q.height += (p.height - q.height) * k;
        q.radius += (p.radius - q.radius) * k;
        const centre = p.base.add(p.axis.scale(p.height / 2));
        // (Bursting: swollen round its middle.)
        const qh = q.height * swell;
        const base = centre.subtractInPlace(q.axis.scale(qh / 2));
        q.base.copyFrom(base);
        const scale = qh / (TOP + 1);
        // (The shell's narrowest is 1.34 x outer, in the frame's units; at its
        // widest 2.66 x: past COAT_OUTER it would run out of its bounding mesh,
        // so the frame is widened across its axis instead.)
        const outer = q.radius * swell / (1.34 * scale);
        // (A sphere is round as it is: its frame never widened.)
        const widen = shape === 'sphere' ? 1 : Math.max(1, outer / COAT_OUTER);
        // Wiping in: shown up to the front; wiping out: from the front on.
        const band = L.state === 'in' ? new Vector2(-10, front(L.u))
          : L.state === 'out' ? new Vector2(front(L.u), 10) : new Vector2(-10, 10);
        // (Standing on the ground, upright: where the ground is, in its frame.)
        const floor = p.floor !== undefined && q.axis.y > 0.95 ? (p.floor - q.base.y) / scale - 1 : -1e3;
        for (const h of L.halves) {
          h.mat.setFloat('floorY', floor);
          h.base.copyFrom(base); h.axis.copyFrom(q.axis);
          h.scale = scale; h.outer = outer / widen; h.widen = widen;
          h.power = L.state === 'hidden' ? 0 : COAT_POWER * fade;
          h.mat.setVector2('band', band);
        }
      }
      if (letGo && fade <= 0) {
        this.scene.onBeforeRenderObservable.remove(obs);
        for (const u of undos) u();
        for (const h of [...still.halves, ...move.halves]) this.dispose(h);
        gone();
      }
    });
    return {
      release: () => { letGo = true; return over; },
      burst: () => { if (burstK < 0 && !letGo) burstK = 0; return over; },
    };
  }

  /**
   * A ball's noise as tornado spheres (a Flying ball): two of the coat's
   * sphere-shaped tornadoes round the ball, its heavy noise and its light,
   * their axes ORB_TILT apart (each tipped half that from upright, either
   * way, about the ball's way). Each frame: where the ball is, each one's
   * radius (world) and how strongly it shows (0 gone ... 1).
   */
  orb(heavy: RGB, light: RGB, free?: (mesh: Mesh) => () => void): { update: (at: Vector3, way: Vector3, radii: [number, number], show: [number, number]) => void; dispose: () => void } {
    const undos: (() => void)[] = [];
    const layers = [heavy, light].map((c) => {
      const style: WindStyle = { dark: c, light: c, glow: c, shell: c };
      return (['near', 'far'] as const).map((side) => {
        const h = this.make(Vector3.Zero(), 1, style, { inner: 0, outer: 1, spin: ORB_SPIN, side });
        h.mat.setFloat('flow', 1);
        h.mat.setFloat('twoTone', 0);
        h.mat.setFloat('soft', COAT_SOFT);
        h.mat.setFloat('density', COAT_DENSITY);
        h.mat.setFloat('twist', COAT_TWIST);
        h.mat.setFloat('sphere', 1);
        if (free) undos.push(free(h.mesh));
        return h;
      });
    });
    const tip = new Quaternion();
    return {
      update: (at, way, radii, show) => {
        // Tipped about the level line across its way.
        const across = Vector3.Cross(Vector3.Up(), way);
        if (across.lengthSquared() < 1e-6) across.set(1, 0, 0);
        across.normalize();
        layers.forEach((halves, i) => {
          Quaternion.RotationAxisToRef(across, (i ? -1 : 1) * ORB_TILT / 2, tip);
          const axis = Vector3.Up().applyRotationQuaternion(tip);
          const R = radii[i], height = 2 * R;
          const scale = height / (TOP + 1);
          for (const h of halves) {
            h.base.copyFrom(at.subtract(axis.scale(R)));
            h.axis.copyFrom(axis);
            h.scale = scale; h.widen = 1;
            h.outer = R / (1.34 * scale);
            h.power = COAT_POWER * Math.max(0, Math.min(1, show[i]));
          }
        });
      },
      dispose: () => { for (const u of undos) u(); for (const halves of layers) for (const h of halves) this.dispose(h); },
    };
  }

  /**
   * A tornado ball's half of a clash's ball: the Flying coat's moving
   * tornado (its axis along the way it goes, toward the clash), as a sphere
   * round the clash point — only its half on this side (cut at its middle,
   * soft). Each frame: the clash point, its way in, its radius (world) and
   * how strongly it shows (0 gone ... 1).
   */
  hemi(heavy: RGB, light: RGB): { update: (at: Vector3, aim: Vector3, radius: number, show: number) => void; dispose: () => void } {
    const style: WindStyle = { dark: heavy, light, glow: light, shell: heavy };
    const halves = (['near', 'far'] as const).map((side) => {
      const h = this.make(Vector3.Zero(), 1, style, { inner: 0, outer: 1, spin: ORB_SPIN, side });
      h.mat.setFloat('flow', 1);
      h.mat.setFloat('twoTone', 0);
      // (No fade toward its foot: that is the far pole of its half, and would leave only a band at the seam.)
      h.mat.setFloat('soft', HEMI_SOFT);
      h.mat.setFloat('density', COAT_DENSITY);
      h.mat.setFloat('twist', COAT_TWIST);
      h.mat.setFloat('sphere', 1);
      // Its foot on this side, its head on the other: shown up to just past its middle.
      h.mat.setVector2('band', new Vector2(-10, (TOP - 1) / 2 + HEMI_PAST));
      return h;
    });
    return {
      update: (at, aim, R, show) => {
        const scale = (2 * R) / (TOP + 1);
        for (const h of halves) {
          h.base.copyFrom(at.subtract(aim.scale(R)));
          h.axis.copyFrom(aim);
          h.scale = scale; h.widen = 1;
          h.outer = R / (1.34 * scale);
          h.power = COAT_POWER * Math.max(0, Math.min(1, show));
        }
      },
      dispose: () => { for (const h of halves) this.dispose(h); },
    };
  }

  /**
   * A vertical hemisphere of the standing tornado: the Flying coat's upright
   * tornado sphere (its axis up, its streaks winding round it and climbing),
   * cut in half by a vertical plane — only its half on `toward`'s side shows,
   * its streaks fading out toward the flat side — and only the middle
   * `shape.keep` of its height kept (a claw's wide, a slash's thinner), with
   * exactly `shape.stripes` of the coat's own stripes in view; wiped across, if asked, the way a blow swept
   * (`wipe`: its way in the striker's front — x right, y up — and where its
   * head and tail have got to, -1 one side to 1 the other). Cel shaded as the coat is. Each frame: its middle, the way
   * its half faces (level), its radius (world) and how strongly it shows.
   */
  hemiV(heavy: RGB, light: RGB, shape: HemiVShape = HEMIV_CLAW): {
    update: (at: Vector3, toward: Vector3, radius: number, show: number, wipe?: { way: [number, number]; head: number; tail: number }, roll?: number) => void; dispose: () => void;
  } {
    const style: WindStyle = { dark: heavy, light, glow: light, shell: heavy };
    const halves = (['near', 'far'] as const).map((side) => {
      const h = this.make(Vector3.Zero(), 1, style, { inner: 0, outer: 1, spin: COAT_SPIN, side });
      // (Its streaks only moving round it — sideways — never rising.)
      h.mat.setFloat('flow', HEMIV_FLOW);
      h.mat.setFloat('twoTone', 0);
      h.mat.setFloat('soft', HEMI_SOFT);
      h.mat.setFloat('density', COAT_DENSITY);
      h.mat.setFloat('twist', COAT_TWIST);
      h.mat.setFloat('sphere', 1);
      h.mat.setFloat('cel', 1);
      // (Drawn over what it strikes: a blow lands on the body, never hidden behind it.)
      h.mat.depthFunction = Constants.ALWAYS;
      // (Its flat side fading out, and only its middle `shape.keep` of its height kept.)
      h.mat.setFloat('cutFade', HEMIV_FADE * 0.5 * (TOP + 1));
      const drop = (1 - shape.keep) / 2 * (TOP + 1);
      h.mat.setVector2('keepY', new Vector2(-1 + drop, TOP - drop));
      // (Its stripes formed in that space: the whole tornado's fitted into it.)
      h.mat.setFloat('fitY', 1);
      return h;
    });
    const way = new Vector3();
    let clock: number | null = null;
    return {
      update: (at, toward, R, show, wipe, roll = 0) => {
        const scale = (2 * R) / (TOP + 1);
        way.copyFrom(toward); way.y = 0;
        if (way.lengthSquared() < 1e-8) way.set(0, 0, 1);
        way.normalize();
        // Its streaks: the tornado's own, at a moment in its noise where
        // exactly three of them lie in what shows, all through its life.
        // (Its stripes drift sideways the way it is wiped: right, or left.)
        const dir = wipe && wipe.way[0] < 0 ? -1 : 1;
        if (clock === null) clock = this.takeMoment(dir, shape) - this.time;
        const turn = Math.atan2(way.x, way.z);
        // (Leant by `roll` about the way it faces — toward the striker's right — its band slanting with it: an X-Scissor's two.)
        const axis = Vector3.Up().scale(Math.cos(roll)).addInPlace(new Vector3(way.z, 0, -way.x).scale(Math.sin(roll)));
        for (const h of halves) {
          h.clock = clock;
          // (Its noise turned to face the way it faces: the moment was found facing straight ahead.)
          h.mat.setFloat('turn', turn);
          // (Standing: its foot below its middle, its axis up — or leant, by `roll`.)
          h.base.copyFrom(at.subtract(axis.scale(R)));
          h.axis.copyFrom(axis);
          h.scale = scale; h.widen = 1;
          h.outer = R / (1.34 * scale);
          h.power = COAT_POWER * Math.max(0, Math.min(1, show));
          // (Its frame turns only about the way it faces, so that way is the same in it.)
          h.mat.setVector4('cut', new Vector4(way.x, 0, way.z, 1));
          h.mat.setFloat('spin', COAT_SPIN * dir);
          // (Wiped the way the blow swept, if it was: its head and tail across it.)
          h.mat.setVector4('wipe', wipe ? new Vector4(wipe.way[0], wipe.way[1], wipe.head, wipe.tail) : new Vector4(0, 0, 0, 0));
        }
      },
      dispose: () => { for (const h of halves) this.dispose(h); },
    };
  }

  /**
   * How many of the coat's stripes lie in a vertical hemisphere's shown part
   * (round `angC`, its kept height, clear of its faded flat side) at `time`
   * (its noise's own): its streak field sampled as the shader draws it
   * (WindFx's shell, cel cut), its separate stripes counted (those worth
   * seeing: 2% of what shows or more).
   */
  private stripeCount(time: number, dir = 1, keep = HEMIV_KEEP, angC = 0): number {
    const k = (4 * COAT_DENSITY) / 6.2831, rr = 0.5 * (TOP + 1), yc = 0.5 * (TOP - 1);
    const drop = ((1 - keep) / 2) * (TOP + 1), y0 = -1 + drop, y1 = TOP - drop;
    const fade = HEMIV_FADE * rr;
    const GW = 64, GH = 32;
    const on = new Uint8Array(GW * GH);
    for (let gy = 0; gy < GH; gy++) {
      const y = y0 + ((gy + 0.5) / GH) * (y1 - y0);
      const ring = Math.sqrt(Math.max(0, rr * rr - (y - yc) * (y - yc)));
      for (let gx = 0; gx < GW; gx++) {
        const da = -Math.PI / 2 + ((gx + 0.5) / GW) * Math.PI;
        // (Only where it shows past half its flat side's fade.)
        if (ring * Math.cos(da) < fade * 0.5) continue;
        const ang = angC + da;
        // (Fitted, as the shader: its kept heights stretched to its whole height.)
        const yn = -1 + ((y - y0) / (y1 - y0)) * (TOP + 1);
        const f = voronoi((ang - yn * COAT_TWIST - time * COAT_SPIN * dir * 0.6) * k, (yn - time * 2 * HEMIV_FLOW) * k, time * 0.1);
        on[gy * GW + gx] = Math.pow(f, 0.75) >= CEL_BANDS[0] ? 1 : 0;
      }
    }
    // Its separate stripes (worth seeing: 2% of what shows or more).
    const seen = new Uint8Array(GW * GH), stack: number[] = [];
    let n = 0;
    for (let i = 0; i < on.length; i++) {
      if (!on[i] || seen[i]) continue;
      let size = 0;
      seen[i] = 1; stack.push(i);
      while (stack.length) {
        const c = stack.pop()!; size++;
        const cx = c % GW, cy = (c / GW) | 0;
        for (const nb of [cx > 0 ? c - 1 : -1, cx < GW - 1 ? c + 1 : -1, cy > 0 ? c - GW : -1, cy < GH - 1 ? c + GW : -1]) {
          if (nb >= 0 && on[nb] && !seen[nb]) { seen[nb] = 1; stack.push(nb); }
        }
      }
      if (size >= GW * GH * 0.02) n++;
    }
    return n;
  }

  /**
   * Moments in the coat's noise where exactly a shape's count of its stripes (a claw's three, a slash's one) lie in a
   * vertical hemisphere's shown part all through HEMIV_LIFE s (stripeCount at
   * a few moments through it), found ahead of time — a little at a time in
   * idle moments, one count (about a millisecond and a half) per step, never
   * past the idle time there is, so it never holds up a frame.
   */
  /** Ready moments, by its shape (a claw's, a slash's) and the way its stripes drift (1: toward the striker's right, -1: its left). */
  private threes: { at: number; dir: number; shape: HemiVShape }[] = [];
  private finding = false;
  private cand: { at: number; step: number; dir: number; shape: HemiVShape } | null = null;
  private fillThrees(): void {
    if (this.finding || this.threes.length >= THREE_POOL) return;
    this.finding = true;
    type Idle = { timeRemaining(): number };
    const ric = (globalThis as { requestIdleCallback?: (f: (d: Idle) => void) => void }).requestIdleCallback;
    const later = ric ?? ((f: (d: Idle) => void) => setTimeout(() => f({ timeRemaining: () => 4 }), 30));
    const work = (d: Idle) => {
      while (d.timeRemaining() > 2 && this.threes.length < THREE_POOL) {
        // (Each shape and each way its stripes may drift kept stocked: whichever has fewest ready.)
        const kinds = [HEMIV_CLAW, HEMIV_SLASH, HEMIV_WIDE_SLASH].flatMap((shape) => [1, -1].map((dir) => ({ shape, dir })));
        const have = (k: { shape: HemiVShape; dir: number }) => this.threes.filter((t) => t.shape === k.shape && t.dir === k.dir).length;
        const want = kinds.reduce((a, b) => (have(b) < have(a) ? b : a));
        const c = (this.cand ??= { at: Math.random() * 400, step: 0, ...want });
        if (this.stripeCount(c.at + (c.step / 3) * HEMIV_LIFE, c.dir, c.shape.keep) !== c.shape.stripes) { this.cand = null; continue; }
        if (++c.step === 4) { this.threes.push({ at: c.at, dir: c.dir, shape: c.shape }); this.cand = null; }
      }
      if (this.threes.length < THREE_POOL) later(work);
      else this.finding = false;
    };
    later(work);
  }
  /** One such moment for `shape`, its stripes drifting `dir`, from those found ahead (any moment, if none is ready: never searched for on the spot). */
  private takeMoment(dir: number, shape: HemiVShape): number {
    const i = this.threes.findIndex((t) => t.dir === dir && t.shape === shape);
    const at = i >= 0 ? this.threes.splice(i, 1)[0].at : Math.random() * 400;
    this.finding = false;
    this.fillThrees();
    return at;
  }

  /**
   * Fire Spin (Whirlpool, in Water's tones): concentric low rings of the cel-shaded tornado on a tile,
   * flared so they read from above, all turning the same way, each faster
   * than the one inside it — spinning up, held `seconds`, dying down. `hit`
   * once they are up, `contactEnds` as they start to go.
   */
  spin(at: Vector3, tileR: number, element = 'Fire', seconds = SPIN_HOLD): { hit: Promise<void>; contactEnds: Promise<void>; done: Promise<void> } {
    const tones = SPIN_TONES[element] ?? SPIN_TONES.Fire;
    const style: WindStyle = { ...windStyle(element), shell: tones[0], light: tones[1] };
    const scale = SPIN_HEIGHT / (TOP + 1);
    const rings = SPIN_RINGS.map((k, i) => {
      const t = this.make(at, SPIN_HEIGHT, style, { inner: 0, outer: SPIN_OUTER, spin: SPIN_SPIN + i * SPIN_FASTER, side: 'both' });
      t.widen = (tileR * k) / (1.84 * SPIN_OUTER * (1 + SPIN_FLARE) * scale);
      t.mat.setFloat('cel', 1);
      t.mat.setFloat('flare', SPIN_FLARE);
      t.mat.setFloat('soft', 0.35);
      return t;
    });
    let resolveHit!: () => void, resolveEnd!: () => void, resolveDone!: () => void;
    const hit = new Promise<void>((r) => { resolveHit = r; });
    const contactEnds = new Promise<void>((r) => { resolveEnd = r; });
    const done = new Promise<void>((r) => { resolveDone = r; });
    let el = 0;
    const obs = this.scene.onBeforeRenderObservable.add(() => {
      el += Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
      const up = Math.min(1, el / SPIN_UP), down = Math.max(0, Math.min(1, (el - SPIN_UP - seconds) / SPIN_DOWN));
      // Spinning up from the inside out, dying down from the outside in.
      rings.forEach((t, i) => {
        const k = (i + 1) / rings.length;
        const ringIn = Math.min(1, Math.max(0, (up - k * 0.4) / 0.6));
        const ringOut = Math.min(1, Math.max(0, (down - (1 - k) * 0.4) / 0.6));
        t.power = ringIn * (1 - ringOut);
      });
      if (el >= SPIN_UP) resolveHit();
      if (el >= SPIN_UP + seconds) resolveEnd();
      if (down >= 1) {
        this.scene.onBeforeRenderObservable.remove(obs);
        for (const t of rings) this.dispose(t);
        resolveHit(); resolveEnd(); resolveDone();
      }
    });
    return { hit, contactEnds, done };
  }

  private animate(t: Tornado, step: (k: number, dt: number, elapsed: number) => { hitNow: boolean; over: boolean }) {
    let hitFired = false, resolveHit!: () => void, resolveDone!: () => void;
    const hit = new Promise<void>((r) => { resolveHit = r; });
    const done = new Promise<void>((r) => { resolveDone = r; });
    let el = 0;
    const obs = this.scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
      el += dt;
      const { hitNow, over } = step(0, dt, el);
      if (hitNow && !hitFired) { hitFired = true; resolveHit(); }
      if (over) {
        this.scene.onBeforeRenderObservable.remove(obs);
        this.dispose(t);
        if (!hitFired) resolveHit();
        resolveDone();
      }
    });
    return { hit, done };
  }

  disposeAll(): void {
    this.scene.onBeforeRenderObservable.remove(this.tick);
    for (const t of [...this.live]) this.dispose(t);
  }
}
