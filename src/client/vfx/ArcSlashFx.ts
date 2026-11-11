/**
 * ArcSlashFx — the anime weapon slash, as it is built in games (a slice of a
 * disk round the attacker, its shape and its reveal in a shader): a crescent
 * in front of the attacker, centred on its body, tilted across it; thickest
 * mid-way along, tapering to points at both ends. Wiped out along its arc as
 * the blow swings (tail to tip, SWING s), held a beat, then eroded from its
 * tail toward its tip while a noise dissolve tears it apart.
 *
 * Drawn as beam 2 is (cel): from its edge in, its type's dark outline, a
 * white-hot band along its leading (outer) edge, then its body in its type's
 * lighter colour — its inner, trailing edge torn by panning noise, as a
 * smear. Two thinner arcs ride with it, a little later, at their own tilts
 * and sizes. Resolves when the main arc's sweep reaches its middle (`hit`)
 * and when it is all gone (`done`).
 */
import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Effect } from '@babylonjs/core/Materials/effect';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { auraGlow, type RGB } from './auraPalette.ts';
import { NOISE } from './beam/BeamFx.ts';

/** Its timing (s): the swing (the wipe tail to tip), the hold, the erosion and dissolve. */
const SWING = 0.12, HOLD = 0.08, FADE = 0.32;
/** Its mesh: faces along the arc and across it. */
const SEGS = 96, ACROSS = 8;
/** Its shape (× the attacker's height): how far out its outer edge reaches, how wide it is at its fullest. */
const RADIUS = 1.05, WIDTH = 0.32;
/** How much of its width (at that point) its white edge takes; its outline's width (of its full width); its tear. */
const CORE = 0.32, LINE = 0.09, TEAR = 0.35;
/**
 * The secondary arcs: [delay (s), radius, width, sweep — each × the main's; how far off the main's plane, along its
 * normal (× the attacker's height)]. All in the main's tilt — parallel planes, stacked apart — so they never cross it
 * (tilted each its own way about one line, they would all meet along it: an X at the contact point).
 */
/**
 * Its flames (the fire sphere's, FireFx): how much (0 none - the plain torn crescent - to 1); how much of its width
 * stays solid, the rest its tongues'; how far they lick (× the rest, at their longest); its turbulence's waves along it and
 * across it, how fast they race back along it and stream off it; its tongues' outer band (× their reach, from the
 * solid's edge) and the heat that flares white in them.
 */
const FIRE = 1, FIRE_SOLID = 0.4, FIRE_LICK = 0.95, FIRE_ALONG = 16, FIRE_ACROSS = 2.0, FIRE_RACE = 8, FIRE_CHURN = 4;
/** How far back along it (toward its tail, the way it came: × its length) its tongues lean, from their root to their tip. */
const FIRE_SWEEP = 0.2;
/**
 * Its tongues, along it: how many along its length; how fast they stream back toward its tail (tongues/s); how much
 * the turbulence shifts them; each one's length (× its flames' reach: least, most); how sharply it tapers from its
 * root to its tip, where along it its root rounds off (of its own length); and the turbulence's flicker on its edge.
 */
/**
 * A thrown C (throwArc): its blade's reach and its depth (× the thrower's height: deep, for its flame trail), how far
 * round it sweeps (radians); its trail's tongues — how many along it, how pointed; how far past its mark it may go.
 */
const THROW_RADIUS = 0.62, THROW_DEPTH = 0.55, THROW_SWEEP = 2.9, THROW_TONGUES = 7, THROW_TAPER = 0.9;
const FIRE_TONGUES = 9, FIRE_STREAM = 2.5, FIRE_WIGGLE = 0.35, FIRE_LEN: [number, number] = [0.55, 1.05], FIRE_TAPER = 1.4, FIRE_ROOT = 0.8, FIRE_FLICK = 0.25;
const FIRE_OUTER = 0.45, FIRE_FLARE = 0.8;
const SECONDARY: [number, number, number, number, number][] = [[0.03, 1, 0.6, 1, 0.16], [0.06, 1, 0.6, 1, -0.16]];

Effect.ShadersStore.arcSlashVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV;
void main(void) { vUV = uv; gl_Position = worldViewProjection * vec4(position, 1.0); }`;

// The slash's look, wherever it is drawn (its ribbon's faces, or its sphere's): slashAt(u, v).
const SLASH_GLSL = /* glsl */ `
uniform vec3 line, body, core;
uniform float head, tail, cut, time, seed, fire;
uniform float trailing; // its tongues out of its hollow, across it, behind it (1: a thrown C's flame trail), or along it (0)
${NOISE}
// Its flames' heat here (0..1): the fire sphere's turbulence (FireFx, after XorDev's 3D Fire, its first waves only),
// laid along it and across it - its tongues swept back, toward its tail (the way it came), and streaming that way,
// churning where they are (never drifting across it: on a sphere, that would make them rise to its top).
float heatAt(float u, float v, float t) {
  vec3 q = vec3((u + (1.0 - v) * ${FIRE_SWEEP.toFixed(2)}) * ${FIRE_ALONG.toFixed(2)} + t * ${FIRE_RACE.toFixed(2)}, (1.0 - v) * ${FIRE_ACROSS.toFixed(2)}, seed + t * ${FIRE_CHURN.toFixed(2)});
  float d = 2.0;
  for (int k = 0; k < 3; k++) { q += cos((q.yzx - vec3(0.0, 0.0, d)) * d) / d; d /= 0.6; }
  return 0.5 + 0.5 * sin(q.x * 1.6 + q.z * 1.6 + q.y * 0.4);
}
// Its colour at (u, v) - u: along it, tail 0 -> tip 1, v: across it, inner 0 -> outer 1 - or discarded.
vec3 slashAt(float u, float v) {
  // Its width here (of its full width): a crescent - fullest mid-way, a point at each end - its inner edge torn.
  float tear = vn(vec3(u * 7.0 - time * 3.0 + seed, v * 2.0, seed)) - 0.5;
  float w = pow(sin(3.14159265 * clamp(u, 0.0, 1.0)), 0.65) * (1.0 + ${TEAR.toFixed(2)} * tear * (1.0 - fire));
  // On fire: its solid part narrower, the rest of its width its flames' - tongues licking out of its trailing edge.
  float heat = heatAt(u, v, time);
  float reach = max(w * ${(1 - FIRE_SOLID).toFixed(2)}, 1e-3);
  // Its tongues laid along it: each its root (its widest) toward its head, where it is going, tapering to its tip
  // toward its tail, where it came from - a row of them streaming back along it, each its own length, the turbulence
  // wiggling them.
  float cell = u * ${FIRE_TONGUES.toFixed(1)} + time * ${FIRE_STREAM.toFixed(2)} + (heat - 0.5) * ${FIRE_WIGGLE.toFixed(2)};
  float id = floor(cell), x = fract(cell);
  float len = mix(${FIRE_LEN[0].toFixed(2)}, ${FIRE_LEN[1].toFixed(2)}, fract(sin(id * 12.9898 + seed * 7.13) * 43758.5453));
  float tongue = len * pow(x, ${FIRE_TAPER.toFixed(2)}) * (1.0 - smoothstep(${FIRE_ROOT.toFixed(2)}, 1.0, x));
  // Trailing (a thrown C): a row of tongues out of its hollow instead - each rooted along its blade, pointing back
  // the way it came, its tip at its middle, each its own length, flickering with the turbulence.
  float xc = fract(u * ${THROW_TONGUES.toFixed(1)} + (heat - 0.5) * ${FIRE_WIGGLE.toFixed(2)});
  float idc = floor(u * ${THROW_TONGUES.toFixed(1)} + (heat - 0.5) * ${FIRE_WIGGLE.toFixed(2)});
  float lenC = mix(${FIRE_LEN[0].toFixed(2)}, ${FIRE_LEN[1].toFixed(2)}, fract(sin(idc * 12.9898 + seed * 7.13) * 43758.5453)) * (0.75 + 0.5 * heat);
  tongue = mix(tongue, lenC * pow(1.0 - abs(2.0 * xc - 1.0), ${THROW_TAPER.toFixed(2)}), trailing);
  float fromIn = (w - reach * fire) - (1.0 - v) + fire * (tongue * ${FIRE_LICK.toFixed(2)} + (heat - 0.5) * ${FIRE_FLICK.toFixed(2)}) * reach;
  // How far inside it this point is (in widths): from its inner (torn, or burning) edge, and its wiped ends.
  float inside = min(fromIn, min((head - u) * 6.0, (u - tail) * 6.0));
  if (inside <= 0.0) discard;
  // Torn apart as it goes.
  float n = vn(vec3(u * 18.0 + seed, v * 6.0, time * 2.0)) * 0.6 + vn(vec3(u * 40.0, v * 14.0, seed)) * 0.4;
  if (n < cut) discard;
  // Cel bands, edge in: its outline, the white-hot leading edge (its flames licking it too), its body - and, on fire,
  // its tongues' outer band a deeper colour, the hottest of them flaring white.
  vec3 c = body;
  if (fire > 0.0 && fromIn < ${FIRE_OUTER.toFixed(2)} * reach) c = mix(body, line, 0.75);
  if (fire > 0.0 && heat > ${FIRE_FLARE.toFixed(2)} && fromIn > ${FIRE_OUTER.toFixed(2)} * reach && fromIn < 1.3 * reach) c = core;
  if ((1.0 - v) < ${CORE.toFixed(2)} * w * (1.0 - 0.35 * fire + fire * (heat - 0.5) * 0.9)) c = core;
  if (inside < ${LINE.toFixed(2)} || v > 1.0 - ${LINE.toFixed(2)} * 0.6) c = line;
  return c;
}`;

Effect.ShadersStore.arcSlashFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUV;
${SLASH_GLSL}
void main(void) { gl_FragColor = vec4(slashAt(vUV.x, vUV.y), 1.0); }`;

export interface ArcSlashOptions {
  /** Its type (its colours: auraPalette), or the hue a Pokémon wears it in. */
  element: string;
  /** Where its centre is (the attacker's middle), which way it faces (yaw, radians; 0 = +Z). */
  at: Vector3;
  yaw: number;
  /** The attacker's height (it is sized by it). */
  height: number;
  /** Its tilt across the body (radians: 0 flat, + its right side up); how far round it sweeps (radians). */
  tilt?: number;
  sweep?: number;
  /** Which way it swings: +1 left to right, -1 right to left (as seen from behind). */
  dir?: 1 | -1;
}

export interface ArcSlashPlay { hit: Promise<void>; done: Promise<void> }

/** Where the striking part is this frame: its cutting edge (`tip`) and the ribbon's inner edge (`base`), in the world. */
export type TrailSample = () => { tip: Vector3; base: Vector3 } | null;

export interface TrailSlashOptions {
  element: string;
  /** The attacker's height (its stack's spacing is sized by it). */
  height: number;
  /** Where the striking part is, each frame. */
  sample: TrailSample;
  /** How long it is traced at most (s): the swing, from wind-up's end to just past the blow. */
  trace: number;
  /**
   * Drawn on a sphere (the anime slash's bubble): one sphere, its centre (`centre()`, the attacker's middle) and its
   * radius fixed as the swing begins (`radius`, or as far out as the part is then); the part's path seen from that
   * centre, and the sphere's own shader drawing the band along it on its surface; its stacked layers on spheres
   * round the same centre a little larger and smaller; a faint bubble, rim-lit about the path.
   */
  sphere?: { centre: () => Vector3; radius?: number; across?: Vector3; contact?: Vector3 };
  /**
   * On a sphere, the mirror image of another slash (the second of a cross): `of`'s path reflected across the plane
   * through its centre whose normal is `across` (the attacker's right: left and right swapped), on `of`'s own sphere —
   * drawn in step with this one's part (its swing `speed` times quicker than `of`'s), which still says when it ends.
   */
  mirror?: { of: TrailSlashPlay; across: Vector3; speed?: number };
  /**
   * On a sphere, thrown (a ranged slash: Air Slash): once its swing is over, its sphere — slash and all — flies at
   * `to` at `speed` (world units/s), and it lands (`hit`) as its front reaches it; then it goes. `appear` (s): it is
   * never seen forming — its part's swing traced unseen, for its shape — but shown only as it is thrown, already
   * facing its mark, faded in (dissolved in) over that long. `blade`: thrown as a flying blade — not its traced
   * shape but a crescent swept across the front of its sphere, tipped forward toward its mark (BLADE_TILT) so its
   * width runs along its flight: its smooth cutting edge leading, at its mark, its flames trailing back at its
   * thrower; `lean` (radians) rolls it about its flight (each throw its own way).
   */
  fly?: { to: Vector3; speed: number; appear?: number; blade?: { lean?: number } };
}

/**
 * A cross's slash, on its sphere: the great circle it lies on (unit ways from its centre: e1 at angle 0, e2 at a
 * quarter turn on), where its tail is on it, how far round its swing has come, and how far round it goes in all.
 */
export interface SlashArc { e1: Vector3; e2: Vector3; a0: number; head: number; target: number }

/** A traced slash in play: its hit and its end, and `end()` to finish it now (another arm is in the swing). */
export interface TrailSlashPlay extends ArcSlashPlay {
  end(): void;
  /** On a sphere: its path so far (the part's ways from its centre), its centre and radius, and how long its swing took (s). */
  path(): { dirs: Vector3[]; centre: Vector3 | null; radius: number; secs: number; arc: SlashArc | null };
}

/** A traced slash: how many points along it at most; its layers' spacing off its own plane (× the attacker's height). */
const TRAIL_POINTS = 48, TRAIL_STACK: [number, number][] = [[0.03, 0.12], [0.06, -0.12]];
/**
 * A traced slash is only its swing: it stops growing the moment its part, past its top speed, falls under END_SPEED
 * of it — its swipe's endpoint (so the arm pulling back draws no second slash). It stays, whole, while the arm pulls
 * back, and goes once the arm comes to rest — slow for END_HOLD — (or at its trace's end, or when told): over TRAIL_FADE.
 */
const END_SPEED = 0.1, END_HOLD = 0.08, TRAIL_FADE = 0.2;
/** Its swing's end, besides all but stopping: its way turned back more than END_TURN (radians) from one frame to the next, or picking up after slowing under END_LULL of its top speed. */
const END_TURN = 1.9, END_LULL = 0.4;

/**
 * On a sphere: its band's width (× the attacker's height); how much of it lies outside the part's path (its cutting
 * edge, out beyond it); its layers' radii off the main's (× their spacing above); the least radius (× height); the
 * most points along its path (its shader's); its spheres' segments; its bubble — how far about the path it lights
 * (× the band's width), how strong its rim is and its face, its most points along.
 */
const SPH_WIDTH = 0.34, SPH_EDGE = 0.25, SPH_STACK = 0.5, SPH_MIN_R = 0.45, SPH_PTS = 48, SPH_SEGS = 48;
/** Its least sweep round its sphere (radians, its path's length on the unit sphere) and the step a short one is carried on back in. */
const SPH_MIN_SWEEP = 1.5, SPH_STEP = 0.06;
/** A cross's slash carried on along its arc past the attacker's middle: how far past (radians round its sphere). */
const CROSS_PAST = 0.25;
/**
 * A cross's arc: how many points before its circle is set (from its second to its latest), how far apart they must
 * be (on the unit sphere) to set it; how fast its follow-through sweeps on (radians/s), and how long past its trace it
 * may take at most (s); how far behind its stacked layers run while it grows (radians per second of their lag).
 */
/** A thrown slash: how long past its trace it may fly at most (s) before it goes anyway. */
const FLY_MAX = 2;
/** A thrown slash: how long it takes to turn to face its mark as it sets off (s). */
const FLY_TURN = 0.12;
/** A thrown blade (fly `blade`): how far round its sphere it sweeps (radians), and how far it is tipped forward toward its mark. */
const BLADE_SPAN = 2.0, BLADE_TILT = 0.6;
const ARC_FIT_POINTS = 4, ARC_FIT_MIN = 0.06, ARC_FOLLOW = 9, ARC_FOLLOW_MAX = 0.4, ARC_LAG = 6;
const BUBBLE_NEAR = 1.8, BUBBLE_RIM = 0.75, BUBBLE_FACE = 0.1, BUBBLE_PTS = 24;

Effect.ShadersStore.arcBubbleVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 world, viewProjection;
varying vec3 vW;
void main(void) { vec4 w = world * vec4(position, 1.0); vW = w.xyz; gl_Position = viewProjection * w; }`;

// The bubble: lit only near the slash's path (its points' directions from its centre), brightest at its rim,
// in cel steps.
Effect.ShadersStore.arcBubbleFragmentShader = /* glsl */ `
precision highp float;
varying vec3 vW;
uniform vec3 eye, centre, col;
uniform vec3 pts[${BUBBLE_PTS}];
uniform float count, width, alpha;
float segDist(vec3 d, vec3 a, vec3 b) { vec3 ab = b - a; float h = clamp(dot(d - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0); return length(d - a - ab * h); }
void main(void) {
  vec3 d = normalize(vW - centre);
  float md = 10.0;
  for (int i = 0; i < ${BUBBLE_PTS - 1}; i++) { if (float(i) < count - 1.0) md = min(md, segDist(d, pts[i], pts[i + 1])); }
  float near = 1.0 - smoothstep(width * 0.3, width, md);
  float fr = pow(1.0 - abs(dot(normalize(eye - vW), d)), 2.5);
  float a = near * (${BUBBLE_FACE.toFixed(2)} + fr * ${BUBBLE_RIM.toFixed(2)});
  a = a > 0.4 ? 0.55 : a > 0.14 ? 0.28 : a > 0.05 ? 0.1 : 0.0;
  a *= alpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}`;

// The slash on its sphere: each point of the sphere's surface placed along the part's path (its nearest point on it,
// seen from the centre: u by the distance along it) and across it (v: its cutting edge, SPH_EDGE out beyond the
// path, at 1), and drawn as the ribbon is there.
Effect.ShadersStore.arcSphereFragmentShader = /* glsl */ `
precision highp float;
varying vec3 vW;
uniform vec3 centre;
uniform vec3 pts[${SPH_PTS}];
uniform float cum[${SPH_PTS}];
uniform float count, bandW, wk, sgn;
${SLASH_GLSL}
void main(void) {
  vec3 d = normalize(vW - centre);
  float best = 10.0, bu = 0.0, bs = 0.0;
  for (int i = 0; i < ${SPH_PTS - 1}; i++) {
    if (float(i) < count - 1.0) {
      vec3 a = pts[i], ab = pts[i + 1] - a;
      float h = clamp(dot(d - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
      vec3 q = a + ab * h;
      float dist = length(d - q);
      if (dist < best) {
        best = dist;
        bu = mix(cum[i], cum[i + 1], h);
        bs = dot(d - q, normalize(cross(q, ab)) * sgn);
      }
    }
  }
  if (best > bandW * 1.5) discard;
  float v = 1.0 - (bandW * ${SPH_EDGE.toFixed(2)} - bs) / (bandW * wk);
  if (v > 1.0 || v < 0.0) discard;
  gl_FragColor = vec4(slashAt(bu, v), 1.0);
}`;

/** A crescent mesh in its own XZ plane, centred on its origin, facing +Z: `sweep` round, `r0` to `r1` out. */
function crescent(scene: Scene, r0: number, r1: number, sweep: number, dir: 1 | -1): Mesh {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= SEGS; i++) {
    const u = i / SEGS, a = dir * (-sweep / 2 + u * sweep);
    for (let j = 0; j <= ACROSS; j++) {
      const v = j / ACROSS, r = r0 + (r1 - r0) * v;
      pos.push(Math.sin(a) * r, 0, Math.cos(a) * r);
      uv.push(u, v);
    }
  }
  const row = ACROSS + 1;
  for (let i = 0; i < SEGS; i++) for (let j = 0; j < ACROSS; j++) {
    const a = i * row + j, b = a + row;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const m = new Mesh('arcSlash', scene);
  const vd = new VertexData();
  vd.positions = pos; vd.uvs = uv; vd.indices = idx;
  vd.applyToMesh(m);
  m.isPickable = false;
  m.alwaysSelectAsActiveMesh = true;
  return m;
}

export class ArcSlashFx {
  constructor(private readonly scene: Scene) {
    // Its shader compiled now, not on its first slash (which would be over before it was ready to draw).
    const warm = crescent(scene, 0.5, 1, 1, 1);
    const mat = ArcSlashFx.material(scene);
    warm.material = mat;
    mat.forceCompilation(warm, () => { warm.dispose(); mat.dispose(); });
    const warmS = MeshBuilder.CreateSphere('arcSlashWarm', { diameter: 2, segments: 4 }, scene);
    const matS = ArcSlashFx.material(scene, true);
    warmS.material = matS; warmS.isVisible = false;
    matS.forceCompilation(warmS, () => { warmS.dispose(); matS.dispose(); });
  }

  private static material(scene: Scene, sphere = false): ShaderMaterial {
    const look = ['line', 'body', 'core', 'head', 'tail', 'cut', 'time', 'seed', 'fire', 'trailing'];
    const mat = sphere
      ? new ShaderMaterial('arcSphereMat', scene, { vertex: 'arcBubble', fragment: 'arcSphere' }, {
        attributes: ['position'], uniforms: ['world', 'viewProjection', 'centre', 'pts', 'cum', 'count', 'bandW', 'wk', 'sgn', ...look],
      })
      : new ShaderMaterial('arcSlashMat', scene, { vertex: 'arcSlash', fragment: 'arcSlash' }, {
        attributes: ['position', 'uv'], uniforms: ['worldViewProjection', ...look],
      });
    mat.backFaceCulling = false;
    mat.setFloat('fire', FIRE); mat.setFloat('trailing', 0);
    return mat;
  }

  /**
   * A slash that flows along the striking part's path: each frame of its
   * swing, where the part is (`sample`) is laid down as the ribbon's next
   * stretch — its cutting edge through the part, its inner edge toward the
   * body — the same crescent bands, torn inner edge and taper as the arc's;
   * two thinner layers stacked off its own plane, each a beat behind. Traced,
   * it holds, then is eroded from its tail and torn away.
   */
  trail(o: TrailSlashOptions): TrailSlashPlay {
    const [, , lineC, fillC] = auraGlow(o.element);
    const scene = this.scene;
    const tips: Vector3[] = [], bases: Vector3[] = [];
    // On a sphere: its centre and radius (fixed at its first point), the part's way from that centre at each point.
    const sph = o.sphere, rows = 2;
    const dirs: Vector3[] = [];
    let centre: Vector3 | null = null, radius = SPH_MIN_R * o.height;
    // When its first point was laid and when it stopped growing (its swing's length); mirroring another: its path reflected.
    let firstT = -1, grownT = -1;
    // Thrown (o.fly): on its way, and landed.
    let flying = false, landed = false;
    // Thrown, turned to face its mark: its path turned (over FLY_TURN) so its middle is its sphere's front — the
    // crescent bulging at its mark, its points trailing back.
    let turnFull: Quaternion | null = null, turnK = 0, appearK = 0;
    // Thrown as a blade: its crescent (unit ways from its centre) and the way its cutting edge leads (at its mark).
    let blade: Vector3[] | null = null, leadWay: Vector3 | null = null;
    const turned = (path: Vector3[]): Vector3[] => {
      if (!turnFull || turnK <= 0) return path;
      const q = Quaternion.Slerp(Quaternion.Identity(), turnFull, turnK);
      return path.map((d) => d.rotateByQuaternionToRef(q, new Vector3()));
    };
    const mir = sph && o.mirror ? o.mirror : null;
    const src = mir ? mir.of.path() : null;
    const srcDirs = src ? src.dirs.map((d) => d.subtract(mir!.across.scale(2 * Vector3.Dot(d, mir!.across)))) : [];
    const srcSecs = src ? Math.max(0.05, src.secs / (mir!.speed ?? 1)) : 0;
    const bubble = sph ? this.bubble(lineC) : null;
    // Its layers: the main ribbon, and its stacked companions (each laid a few frames behind, off its plane).
    const layers = [{ lag: 0, off: 0, wk: 1 }, ...TRAIL_STACK.map(([lag, off]) => ({ lag, off, wk: 0.6 }))].map((l, k) => {
      const pos = new Float32Array(TRAIL_POINTS * rows * 3), uv: number[] = [], idx: number[] = [];
      for (let i = 0; i < TRAIL_POINTS; i++) for (let j = 0; j < rows; j++) uv.push(i / (TRAIL_POINTS - 1), j / (rows - 1));
      for (let i = 0; i < TRAIL_POINTS - 1; i++) for (let j = 0; j < rows - 1; j++) {
        const a = i * rows + j, b = a + rows;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
      let mesh: Mesh, mat: ShaderMaterial;
      if (sph) {
        mesh = MeshBuilder.CreateSphere('arcSlashTrail', { diameter: 2, segments: SPH_SEGS }, scene);
        mat = ArcSlashFx.material(scene, true);
        mat.setFloat('wk', l.wk);
      } else {
        mesh = new Mesh('arcSlashTrail', scene);
        const vd = new VertexData(); vd.positions = pos; vd.uvs = uv; vd.indices = idx;
        vd.applyToMesh(mesh, true);
        mat = ArcSlashFx.material(scene);
      }
      mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = true;
      mat.setColor3('line', new Color3(...lineC)); mat.setColor3('body', new Color3(...fillC)); mat.setColor3('core', new Color3(1.25, 1.22, 1.15));
      mat.setFloat('seed', k * 3.7 + Math.random() * 10); mat.setFloat('head', 1.02); mat.setFloat('tail', 0); mat.setFloat('cut', 0);
      mesh.material = mat; mesh.setEnabled(false);
      return { ...l, mesh, mat, pos };
    });
    let hitNow!: () => void, doneNow!: () => void;
    const hit = new Promise<void>((r) => { hitNow = r; }), done = new Promise<void>((r) => { doneNow = r; });
    let t = 0, hitSent = false;
    // When its swing ended (its arm at its endpoint: -1 not yet), and its part's top speed so far.
    let endT = -1, peak = 0, peakT = 0, slowSince = -1, grown = false, lastTip: Vector3 | null = null;
    // Its swing's way at its top speed, and its slowest since (for the swing's endpoint: turned back, or picking up again).
    let lastWay: Vector3 | null = null, lull = Infinity;
    // Lay a layer's ribbon over its points: `upTo` of them (its lag), each its edge pair, off its plane by `off`.
    const lay = (l: (typeof layers)[number], upTo: number) => {
      const n = Math.min(tips.length, upTo);
      if (n < 2) { l.mesh.setEnabled(false); return; }
      if (sph) {
        // (A cross's arc: each layer as far round as it has caught up — a beat behind while it grows.)
        if (across) {
          if (!arc) { l.mesh.setEnabled(false); return; }
          const to = grown ? shown : Math.max(arc.a0 + SPH_STEP, shown - l.lag * ARC_LAG);
          laySphere(l, arcPath(arc, to));
        } else laySphere(l, blade ?? swept(n));
        return;
      }
      for (let i = 0; i < TRAIL_POINTS; i++) {
        // (Its points spread along the whole ribbon: the traced ones, stretched over all its faces.)
        const f = (i / (TRAIL_POINTS - 1)) * (n - 1), j = Math.min(n - 2, Math.floor(f)), k = f - j;
        const tip = Vector3.Lerp(tips[j], tips[j + 1], k), base0 = Vector3.Lerp(bases[j], bases[j + 1], k);
        // Thinner layers: their inner edge nearer the cutting one.
        const base = Vector3.Lerp(tip, base0, l.wk);
        if (l.off) {
          const along = tips[j + 1].subtract(tips[j]), across = tip.subtract(base0);
          const nrm = Vector3.Cross(along, across);
          if (nrm.lengthSquared() > 1e-10) { nrm.normalize().scaleInPlace(l.off * o.height); tip.addInPlace(nrm); base.addInPlace(nrm); }
        }
        l.pos.set([base.x, base.y, base.z, tip.x, tip.y, tip.z], i * 6);
      }
      l.mesh.updateVerticesData('position', l.pos);
      l.mesh.setEnabled(true);
    };
    // On its sphere: its path (the part's ways from the centre, as far as this layer has caught up, at most SPH_PTS of
    // them) and the distance along it handed to the sphere's shader, which draws the band. Its cutting edge on the
    // outside of the swing's curve (one way for the whole band, so it never flips point to point).
    const flatPts = new Array(SPH_PTS * 3).fill(0), flatCum = new Array(SPH_PTS).fill(0);
    // Its path, at least SPH_MIN_SWEEP round (radians): a short swing (a thrust more than a sweep, as Scizor's) carried
    // on back from its tail along its own great circle — the way it came — so it is a slash, not a patch.
    // A cross's slash (sphere `across`: the attacker's right): a clean arc on its sphere — the great circle its swing
    // follows, set once from its first few frames (from its second: past the jolt its first can give) and held, so it
    // never swings onto another path as it grows; along it, its swing laid as far as its part has come; carried on, as
    // its follow-through, CROSS_PAST beyond the plane down the attacker's middle (every great circle crosses it, so it
    // always can, unbent) — its mirror image, made alike, meets it there: an X. At least SPH_MIN_SWEEP round.
    const across = sph?.across;
    let arc: SlashArc | null = null, shown = 0;
    const arcAt = (c: SlashArc, a: number) => c.e1.scale(Math.cos(a)).addInPlace(c.e2.scale(Math.sin(a)));
    const angOn = (c: SlashArc, d: Vector3) => Math.atan2(Vector3.Dot(d, c.e2), Vector3.Dot(d, c.e1));
    // (Where its circle crosses the attacker's middle — two places, half a turn apart — the one nearest a0..head.)
    const crossing = (c: SlashArc) => {
      const A = Vector3.Dot(c.e1, across!), B = Vector3.Dot(c.e2, across!), base = Math.atan2(-A, B);
      let best = Infinity, ac = 0;
      for (let m = -3; m <= 3; m++) {
        const x = base + m * Math.PI, off = x < c.a0 ? c.a0 - x : x > c.head ? x - c.head : 0;
        if (off < best) { best = off; ac = x; }
      }
      return ac;
    };
    // (With a contact point — where the blow lands — its circle runs from its swing's start through the way to it
    // from the centre, laid on the attacker's middle: its mirror's runs through it too, so they cross there.)
    const contactWay = (): Vector3 | null => {
      if (!sph?.contact || !centre) return null;
      const c = sph.contact.subtract(centre);
      c.subtractInPlace(across!.scale(Vector3.Dot(c, across!)));
      return c.lengthSquared() < 1e-8 ? null : c.normalize();
    };
    const fitArc = (): SlashArc | null => {
      const n = dirs.length, d1 = dirs[1], cw = contactWay(), end = cw ?? dirs[n - 1];
      const axis = Vector3.Cross(d1, end);
      if (axis.lengthSquared() < ARC_FIT_MIN * ARC_FIT_MIN) return null;
      axis.normalize();
      const e1 = d1.subtract(axis.scale(Vector3.Dot(d1, axis))).normalize();
      const c: SlashArc = { e1, e2: Vector3.Cross(axis, e1), a0: 0, head: 0, target: 0 };
      c.head = cw ? Math.max(0, angOn(c, dirs[n - 1])) : angOn(c, end);
      // (Its tail carried back to its crossing, if that is behind it; then on back to make its least sweep.)
      const ac = cw ? angOn(c, cw) : crossing(c);
      c.a0 = Math.min(c.a0, ac - CROSS_PAST);
      c.target = Math.max(c.head, ac + CROSS_PAST);
      c.a0 = Math.min(c.a0, c.target - SPH_MIN_SWEEP);
      return c;
    };
    const arcPath = (c: SlashArc, to: number): Vector3[] => {
      const steps = Math.max(2, Math.ceil((to - c.a0) / SPH_STEP)), out: Vector3[] = [];
      for (let i = 0; i <= steps; i++) out.push(arcAt(c, c.a0 + ((to - c.a0) * i) / steps));
      return out;
    };
    const swept = (upTo: number): Vector3[] => {
      const path = dirs.slice(0, upTo), n = path.length;
      if (n < 3) return path;
      let arc = 0;
      for (let i = 1; i < n; i++) arc += Vector3.Distance(path[i], path[i - 1]);
      const extra = SPH_MIN_SWEEP - arc;
      if (extra <= 0) return path;
      const d0 = path[0], back = d0.subtract(path[2]);
      back.subtractInPlace(d0.scale(Vector3.Dot(back, d0)));
      if (back.lengthSquared() < 1e-10) return path;
      back.normalize();
      const k = Math.ceil(extra / SPH_STEP), pre: Vector3[] = [];
      for (let i = k; i >= 1; i--) { const a = (extra * i) / k; pre.push(d0.scale(Math.cos(a)).addInPlace(back.scale(Math.sin(a)))); }
      return pre.concat(path);
    };
    const laySphere = (l: (typeof layers)[number], path0: Vector3[]) => {
      const path = turned(path0), n = path.length;
      if (!centre || n < 2) { l.mesh.setEnabled(false); return; }
      const m = Math.min(SPH_PTS, n), pick = (i: number) => path[Math.round((i / (m - 1)) * (n - 1))];
      const mean = Vector3.Zero();
      for (let i = 0; i < n; i++) mean.addInPlace(path[i]);
      mean.normalize();
      let out = 0, run = 0;
      for (let i = 0; i < m; i++) {
        const d = pick(i);
        flatPts[i * 3] = d.x; flatPts[i * 3 + 1] = d.y; flatPts[i * 3 + 2] = d.z;
        if (i > 0) {
          const step = d.subtract(pick(i - 1));
          run += step.length();
          out += Vector3.Dot(Vector3.Cross(d, step), d.subtract(mean));
        }
        flatCum[i] = run;
      }
      for (let i = 0; i < m; i++) flatCum[i] /= Math.max(run, 1e-6);
      const R = radius + l.off * SPH_STACK * o.height;
      l.mat.setArray3('pts', flatPts); l.mat.setFloats('cum', flatCum); l.mat.setFloat('count', m);
      let sgn = out >= 0 ? 1 : -1;
      // (A thrown blade: its cutting edge on the side that leads, toward its mark.)
      if (leadWay && n >= 3) {
        const k = Math.floor(n / 2), side = Vector3.Cross(path[k], path[k + 1].subtract(path[k - 1]));
        sgn = Vector3.Dot(side, leadWay) >= 0 ? 1 : -1;
      }
      l.mat.setFloat('sgn', sgn); l.mat.setFloat('bandW', (SPH_WIDTH * o.height) / R);
      l.mat.setVector3('centre', centre);
      l.mesh.position.copyFrom(centre); l.mesh.scaling.setAll(R);
      l.mesh.setEnabled(true);
    };
    const obs: Observer<Scene> = scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min(0.05, scene.getEngine().getDeltaTime() / 1000);
      t += dt;
      for (const l of layers) l.mat.setFloat('time', t);
      if (endT < 0) {
        const smp = o.sample();
        if (smp) {
          // Its part's speed: at its swipe's endpoint (fallen well under its top speed, once past it), its swing is over.
          const step = lastTip ? smp.tip.subtract(lastTip) : Vector3.Zero();
          const v = step.length() / Math.max(dt, 1e-3);
          lastTip = smp.tip.clone();
          if (v > peak) { peak = v; peakT = t; lull = Infinity; }
          // Its swing's endpoint (only well past its top speed: a swing's start can stutter) — the first of: all but
          // stopped; reversed (the arm pulling back: its way, frame to frame, turned more than END_TURN — a swing's
          // arc turns smoothly, a turn back is sudden); or, having slowed under END_LULL of its top speed, picking up
          // again (the slowest moment was the end).
          const past = tips.length > 3 && t - peakT > 0.03;
          const slow = past && v < END_SPEED * peak;
          const way = v > 1e-4 ? step.normalizeToNew() : null;
          const turned = past && !!way && !!lastWay && Vector3.Dot(way, lastWay) < Math.cos(END_TURN);
          if (way) lastWay = way;
          const again = past && lull < END_LULL * peak && v > lull * 1.5;
          if (past) lull = Math.min(lull, v);
          if (!grown && (slow || turned || again)) { grown = true; grownT = t; }
          if (mir && src && src.centre) {
            // A mirror image: the other's reflected path laid as this one's part swings (all of it once its swing ends).
            if (!centre) { centre = src.centre.clone(); radius = src.radius; firstT = t; }
            const want = grown ? srcDirs.length : Math.min(srcDirs.length, Math.ceil((srcDirs.length * (t - firstT + dt)) / srcSecs));
            while (dirs.length < want) { dirs.push(srcDirs[dirs.length]); tips.push(smp.tip.clone()); bases.push(smp.base.clone()); }
            if (across && !arc && src.arc) {
              const R = (d: Vector3) => d.subtract(mir!.across.scale(2 * Vector3.Dot(d, mir!.across)));
              arc = { e1: R(src.arc.e1), e2: R(src.arc.e2), a0: src.arc.a0, head: src.arc.a0, target: src.arc.target };
              shown = arc.a0;
            }
            // (Swept round in step with its part: the other's whole arc over the other's swing, at this one's pace.)
            if (arc) arc.head = arc.a0 + (arc.target - arc.a0) * Math.min(1, (t - firstT + dt) / srcSecs);
          } else if (!grown) {
            tips.push(smp.tip.clone()); bases.push(smp.base.clone());
            if (firstT < 0) firstT = t;
            if (sph) {
              // (Its sphere fixed at its first point: centred there, as big as asked, or as far out as the part is.)
              if (!centre) { centre = sph.centre().clone(); radius = Math.max(radius, sph.radius ?? smp.tip.subtract(centre).length()); }
              dirs.push(smp.tip.subtract(centre).normalize());
              if (across) {
                if (!arc && dirs.length >= ARC_FIT_POINTS) { arc = fitArc(); if (arc) shown = arc.a0; }
                else if (arc) {
                  // (Its swing on round its held circle: never back.)
                  const a = angOn(arc, dirs[dirs.length - 1]);
                  if (a > arc.head && a < arc.head + Math.PI / 2) { arc.head = a; arc.target = Math.max(arc.target, a); }
                }
              }
            }
          }
          // At rest (slow, and staying so — not the arm pulling back): it goes.
          const through = (!arc || shown >= arc.target - 1e-3) && (!o.fly || landed);
          if (grown && slow) { if (slowSince < 0) slowSince = t; if (t - slowSince >= END_HOLD && through) endT = t; }
          else slowSince = -1;
        }
        if (t >= o.trace && (!arc || shown >= arc.target - 1e-3 || t >= o.trace + ARC_FOLLOW_MAX) && (!o.fly || landed || t >= o.trace + FLY_MAX)) endT = t;
      }
      if (arc) {
        // (While its part swings, as far round as it has come — mirrored, in step with it; its swing over, on round.)
        shown = Math.max(shown, arc.head);
        if (grown) shown += ARC_FOLLOW * dt;
        shown = Math.min(shown, arc.target);
      }
      // Each layer laid as far as it has caught up (its lag, in frames at this rate).
      // (Its swing drawn whole, the stacked layers catch up: no lag once it has stopped growing.)
      for (const l of layers) lay(l, grown ? tips.length : tips.length - Math.round(l.lag / Math.max(dt, 1e-3)));
      // (Shown only as it is thrown: unseen till then.)
      const unseen = o.fly?.appear !== undefined && !flying;
      if (unseen) for (const l of layers) l.mesh.setEnabled(false);
      // Thrown: its swing over (and its follow-through), its sphere flies at its mark; it lands as its front reaches it.
      if (o.fly && sph && centre && !landed) {
        if (!flying && (grown || t >= o.trace) && (!arc || shown >= arc.target - 1e-3)) {
          flying = true;
          if (o.fly.blade) {
            // Its blade: a crescent through its sphere's sides, its middle tipped forward toward its mark.
            const fw = o.fly.to.subtract(centre).normalize();
            let rt = Vector3.Cross(Vector3.Up(), fw);
            if (rt.lengthSquared() < 1e-6) rt = new Vector3(1, 0, 0);
            rt.normalize();
            let up = Vector3.Cross(fw, rt).normalize();
            if (Vector3.Dot(up, Vector3.Up()) < 0) up = up.scale(-1);
            const lean = o.fly.blade.lean ?? 0;
            if (lean) { const q = Quaternion.RotationAxis(fw, lean); rt = rt.rotateByQuaternionToRef(q, new Vector3()); up = up.rotateByQuaternionToRef(q, new Vector3()); }
            const mid = up.scale(Math.cos(BLADE_TILT)).addInPlace(fw.scale(Math.sin(BLADE_TILT)));
            const steps = Math.ceil(BLADE_SPAN / SPH_STEP);
            blade = [];
            for (let i = 0; i <= steps; i++) { const a = -BLADE_SPAN / 2 + (BLADE_SPAN * i) / steps; blade.push(rt.scale(Math.sin(a)).addInPlace(mid.scale(Math.cos(a)))); }
            leadWay = fw;
          }
          // (The turn that brings its middle round to face its mark.)
          const path = arc ? arcPath(arc, shown) : swept(tips.length);
          const mid = path.reduce((m, d) => m.addInPlace(d), Vector3.Zero());
          const to = o.fly.to.subtract(centre);
          if (!blade && mid.lengthSquared() > 1e-8 && to.lengthSquared() > 1e-8) {
            mid.normalize(); to.normalize();
            const axis = Vector3.Cross(mid, to), ang = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(mid, to))));
            turnFull = axis.lengthSquared() > 1e-10 ? Quaternion.RotationAxis(axis.normalize(), ang) : Quaternion.Identity();
          }
        }
        if (flying) {
          turnK = o.fly.appear !== undefined ? 1 : Math.min(1, turnK + dt / FLY_TURN);
          if (o.fly.appear !== undefined) appearK = Math.min(1, appearK + dt / Math.max(o.fly.appear, 1e-3));
        }
        if (flying) {
          const way = o.fly.to.subtract(centre), left = way.length();
          if (left <= radius) { landed = true; hitSent = true; hitNow(); if (endT < 0) endT = t; }
          else centre.addInPlace(way.scaleInPlace(Math.min(1, (o.fly.speed * dt) / left)));
        }
      }
      if (!o.fly && !hitSent && (endT >= 0 || t >= o.trace * 0.8)) { hitSent = true; hitNow(); }
      // Its swing over: gone over TRAIL_FADE — eroded from its tail and torn away.
      const f = endT < 0 ? 0 : (t - endT) / TRAIL_FADE;
      // (Faded in as it is thrown, if it is shown only then: dissolved in, the way it is torn away.)
      const fadeIn = o.fly?.appear !== undefined ? 1 - appearK : 0;
      for (const l of layers) { l.mat.setFloat('tail', Math.min(1.05, f * f * 1.05)); l.mat.setFloat('cut', Math.max(fadeIn, Math.min(1, f * 1.1))); }
      if (bubble) bubble.set(blade ?? turned(arc ? arcPath(arc, shown) : across ? [] : swept(tips.length)), centre ?? undefined, radius, (SPH_WIDTH * o.height * BUBBLE_NEAR) / radius,
        unseen ? 0 : Math.max(0, 1 - f) * (o.fly?.appear !== undefined ? appearK : 1));
      if (f >= 1) {
        scene.onBeforeRenderObservable.remove(obs);
        for (const l of layers) { l.mat.dispose(); l.mesh.dispose(); }
        bubble?.dispose();
        if (!hitSent) hitNow();
        doneNow();
      }
    });
    return {
      hit, done, end: () => { if (endT < 0) endT = t; },
      path: () => ({ dirs, centre, radius, secs: firstT < 0 ? 0 : (grownT >= 0 ? grownT : t) - firstT, arc }),
    };
  }

  /** A slash's bubble: a sphere lit near its path (`set` each frame: its points' ways, its centre, radius, how far about the path, how strong). */
  private bubble(col: RGB): { set(dirs: Vector3[], centre: Vector3 | undefined, radius: number, width: number, alpha: number): void; dispose(): void } {
    const scene = this.scene;
    const mesh = MeshBuilder.CreateSphere('arcSlashBubble', { diameter: 2, segments: 32 }, scene);
    mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = true; mesh.setEnabled(false);
    const mat = new ShaderMaterial('arcBubbleMat', scene, { vertex: 'arcBubble', fragment: 'arcBubble' }, {
      attributes: ['position'], uniforms: ['world', 'viewProjection', 'eye', 'centre', 'col', 'pts', 'count', 'width', 'alpha'], needAlphaBlending: true,
    });
    mat.backFaceCulling = false; mat.disableDepthWrite = true;
    mat.setColor3('col', new Color3(...col));
    mesh.material = mat;
    const flat = new Array(BUBBLE_PTS * 3).fill(0);
    return {
      set: (dirs, centre, radius, width, alpha) => {
        if (!centre || dirs.length < 2 || alpha <= 0) { mesh.setEnabled(false); return; }
        const n = Math.min(BUBBLE_PTS, dirs.length);
        for (let i = 0; i < n; i++) { const d = dirs[Math.round((i / (n - 1)) * (dirs.length - 1))]; flat[i * 3] = d.x; flat[i * 3 + 1] = d.y; flat[i * 3 + 2] = d.z; }
        mat.setArray3('pts', flat); mat.setFloat('count', n);
        mat.setFloat('width', width); mat.setFloat('alpha', alpha);
        mesh.position.copyFrom(centre); mesh.scaling.setAll(radius * 0.97);
        mat.setVector3('centre', centre);
        const cam = scene.activeCamera; if (cam) mat.setVector3('eye', cam.globalPosition);
        mesh.setEnabled(true);
      },
      dispose: () => { mat.dispose(); mesh.dispose(); },
    };
  }

  /**
   * A thrown C (a ranged slash: Air Slash) — a flat crescent from `from` at `to`, standing upright on its way (rolled
   * `lean` about it): its blade (its cutting edge) leading, at its mark, its hollow toward its thrower, and its flames
   * coming out of its hollow, trailing back at its thrower. Faded (dissolved) in over `appear` as it sets off; lands
   * (`hit`) as its blade reaches its mark, and is torn away there.
   */
  throwArc(o: { element: string; height: number; from: Vector3; to: Vector3; speed: number; appear?: number; lean?: number }): ArcSlashPlay {
    const scene = this.scene;
    const [, , lineC, fillC] = auraGlow(o.element);
    const r1 = THROW_RADIUS * o.height, r0 = r1 - THROW_DEPTH * o.height;
    const mesh = crescent(scene, r0, r1, THROW_SWEEP, 1);
    // Its frame: +Z its way (its blade's middle there), its plane upright (through its way and up), rolled by lean.
    const fw = o.to.subtract(o.from).normalize();
    let rt = Vector3.Cross(Vector3.Up(), fw);
    if (rt.lengthSquared() < 1e-6) rt = new Vector3(1, 0, 0);
    rt.normalize();
    if (o.lean) rt = rt.rotateByQuaternionToRef(Quaternion.RotationAxis(fw, o.lean), new Vector3());
    const root = new TransformNode('arcSlashThrow', scene);
    root.rotationQuaternion = Quaternion.RotationQuaternionFromAxis(Vector3.Cross(rt, fw), rt, fw);
    root.position.copyFrom(o.from);
    mesh.parent = root;
    const mat = ArcSlashFx.material(scene);
    mat.setColor3('line', new Color3(...lineC)); mat.setColor3('body', new Color3(...fillC)); mat.setColor3('core', new Color3(1.25, 1.22, 1.15));
    mat.setFloat('seed', Math.random() * 10); mat.setFloat('head', 1.02); mat.setFloat('tail', 0); mat.setFloat('cut', 1);
    mat.setFloat('trailing', 1);
    mesh.material = mat;
    let hitNow!: () => void, doneNow!: () => void;
    const hit = new Promise<void>((r) => { hitNow = r; }), done = new Promise<void>((r) => { doneNow = r; });
    let t = 0, landT = -1;
    const appear = Math.max(1e-3, o.appear ?? 0.12), far = Vector3.Distance(o.from, o.to) + r1;
    const obs: Observer<Scene> = scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min(0.05, scene.getEngine().getDeltaTime() / 1000);
      t += dt;
      mat.setFloat('time', t);
      if (landT < 0) {
        root.position.addInPlace(fw.scale(o.speed * dt));
        // (Landed: its blade at its mark — or, gone that far, past it.)
        const ahead = Vector3.Dot(o.to.subtract(root.position.add(fw.scale(r1))), fw);
        if (ahead <= 0 || o.speed * t >= far) { landT = t; hitNow(); }
      }
      const f = landT < 0 ? 0 : (t - landT) / TRAIL_FADE;
      mat.setFloat('tail', Math.min(1.05, f * f * 1.05));
      mat.setFloat('cut', Math.max(1 - Math.min(1, t / appear), Math.min(1, f * 1.1)));
      if (f >= 1) {
        scene.onBeforeRenderObservable.remove(obs);
        mat.dispose(); mesh.dispose(); root.dispose();
        doneNow();
      }
    });
    return { hit, done };
  }

  /** A slash: the main arc and its two thinner companions. */
  play(o: ArcSlashOptions): ArcSlashPlay {
    const tilt = o.tilt ?? -0.45, sweep = o.sweep ?? 2.6, dir = o.dir ?? 1;
    const [, , lineC, fillC] = auraGlow(o.element);
    const arcs = [this.one(o, 0, 1, 1, tilt, sweep, dir, lineC, fillC, 0)];
    SECONDARY.forEach(([delay, r, w, s, off], i) => arcs.push(this.one(o, delay, r, w, tilt, sweep * s, dir, lineC, fillC, i + 1, off)));
    return { hit: arcs[0].hit, done: Promise.all(arcs.map((a) => a.done)).then(() => {}) };
  }

  private one(o: ArcSlashOptions, delay: number, rk: number, wk: number, tilt: number, sweep: number, dir: 1 | -1,
    lineC: RGB, fillC: RGB, seed: number, offset = 0): ArcSlashPlay {
    const scene = this.scene;
    const r1 = RADIUS * o.height * rk, r0 = r1 - WIDTH * o.height * wk;
    const mesh = crescent(scene, r0, r1, sweep, dir);
    const root = new TransformNode('arcSlashRoot', scene);
    root.rotationQuaternion = Quaternion.RotationYawPitchRoll(o.yaw, 0, tilt);
    // (Off the main's plane along its normal — its own local up.)
    const normal = Vector3.Up().rotateByQuaternionToRef(root.rotationQuaternion, new Vector3());
    root.position.copyFrom(o.at).addInPlace(normal.scale(offset * o.height));
    mesh.parent = root;
    const mat = ArcSlashFx.material(scene);
    mat.setColor3('line', new Color3(...lineC));
    mat.setColor3('body', new Color3(...fillC));
    mat.setColor3('core', new Color3(1.25, 1.22, 1.15));
    mat.setFloat('seed', seed * 3.7 + Math.random() * 10);
    mat.setFloat('head', 0); mat.setFloat('tail', 0); mat.setFloat('cut', 0);
    mesh.material = mat;
    mesh.setEnabled(false);
    let hitNow!: () => void, doneNow!: () => void;
    const hit = new Promise<void>((r) => { hitNow = r; }), done = new Promise<void>((r) => { doneNow = r; });
    let t = -delay, hitSent = false;
    const ease = (x: number) => 1 - (1 - x) * (1 - x) * (1 - x);
    const obs: Observer<Scene> = scene.onBeforeRenderObservable.add(() => {
      t += Math.min(0.05, scene.getEngine().getDeltaTime() / 1000);
      mat.setFloat('time', t);
      if (t < 0) return;
      mesh.setEnabled(true);
      // The swing: its head out along the arc, tail to tip.
      const head = Math.min(1.08, 1.08 * ease(Math.min(1, t / SWING)));
      mat.setFloat('head', head);
      if (!hitSent && head >= 0.5) { hitSent = true; hitNow(); }
      // Then: eroded from its tail, torn apart.
      const f = Math.max(0, (t - SWING - HOLD) / FADE);
      mat.setFloat('tail', Math.min(1.05, f * f * 1.05));
      mat.setFloat('cut', Math.min(1, f * 1.1));
      if (f >= 1) {
        scene.onBeforeRenderObservable.remove(obs);
        mat.dispose(); mesh.dispose(); root.dispose();
        if (!hitSent) hitNow();
        doneNow();
      }
    });
    return { hit, done };
  }
}
