/**
 * CrescentFx — the crescent cut, rebuilt from how game slashes are made (realtimevfx breakdowns, the "slash shape
 * fundamentals"), laid on a sphere round the attacker's middle (the anime slash's bubble).
 *
 *  - Its path: the striking part's way from the attacker's middle, frame by frame — a path on that sphere — its
 *    cutting edge (its rim) running along it, its body filling in from there toward the middle. So it follows the swing
 *    however it goes: across, up, down, toward the camera or away. (No part to follow: a set sweep, swept by the clock.)
 *  - Its shape: a flag, not a lens — its leading head (on the part) the fullest part, rounded off to a point; its tail
 *    long and tapering to nothing behind it (the time that has passed). Its rim one clean curve; its inner edge torn
 *    into speed lines.
 *  - Its body: two noises multiplied, stretched along it — streaks — scrolled back along it fast as it is cut, easing
 *    off after (the scroll speed keyed over its life).
 *  - Its end: once its swing is over, held at its full shape a beat (HOLD: a frame or two at speed), then eroded by
 *    noise, tail first toward its head, the eroding edge burning white-hot as it goes (FADE s).
 *  - Its layers: a white-hot edge line seated on its rim (one piece with it); a soft glow round it (added light).
 *  - Its volume: two sheets bowed apart across it, meeting at its rim and its inner edge — tapering as its width does.
 *
 * Cel shaded: from its rim in, a thin ink line, its white-hot core along the edge that cut, its type's fill (its
 * strongest streaks a band lighter), its type's outline colour, ink at its torn inner edge; its volume a band darker
 * away from its ridge. Particles: shards shed off its head as it sweeps, embers flaking off its eroding edge, sparks
 * where it strikes. Lengths are × the attacker's height (H).
 */
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Effect } from '@babylonjs/core/Materials/effect';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { auraGlow, type RGB } from './auraPalette.ts';
import { NOISE } from './beam/BeamFx.ts';
import { GlowSparks } from './beam/GlowSparks.ts';

// ── timing (s) ──────────────────────────────────────────────────────
/** The wipe along its arc (a set sweep's swing), the hold at its full shape, the erosion. */
const SWING = 0.09, HOLD = 0.05, FADE = 0.3;
/** Its tail creeping up behind the head as it erodes (of its length, by the end). */
const TAIL_CREEP = 0.45;
/** Its streaks' scroll back along it: how far in all (× its noise's period), and how fast that eases off (s). */
const SCROLL = 3.2, SCROLL_EASE = 0.07;

// ── shape (× H) ─────────────────────────────────────────────────────
/** Its sphere's radius (a set sweep's; a followed part sets its own, as its swing begins), its width at its fullest. */
const RADIUS = 0.8, WIDTH = 0.5;
/** A set sweep (radians round the attacker's middle, in its side plane) — from behind and above, over, to in front. */
const SWEEP: [number, number] = [2.3, -0.5];
/** Its flag: where along it (tail 0 → head 1) it is fullest, and how sharply its head rounds off to its point. */
const FULLEST = 0.74, HEAD_ROUND = 0.6;
/** Its inner edge torn: how far in its speed lines cut (of its width, at most). */
const TEAR = 0.5;
/** Its leading tip as it is wiped out: its rim ahead of its inner edge (× the wipe's length). */
const TIP_LEAD = 0.07;
/**
 * Its thickness: its body two sheets bowed apart, front and back, meeting at its rim and its inner edge (a blade's
 * section) — at most THICK × its width there, so tapering as its width does: fullest toward its head, to nothing at its
 * tips; across it, fullest mid-way, closing to an edge. Lit soft: its ridge brighter, its sides falling off by SHADE.
 */
const THICK = 0.38, SHADE = 0.35;

// ── following the part ──────────────────────────────────────────────
/**
 * Its sphere's radius: the part's distance from the middle as its swing begins, no nearer than MIN_R nor further than
 * MAX_R (× H). Its path no shorter than MIN_SWEEP (radians: carried on back behind where it began, the way it set off).
 * A new point on its path only once the part has gone STEP (radians) round. Its swing over once the part, past its
 * fastest (at least FAST rad/s), slows under END_SPEED of that, or turns back on itself (its way turned more than
 * END_TURN radians), or after its trace.
 */
const MIN_R = 0.6, MAX_R = 1.15, MIN_SWEEP = 2.2, STEP = 0.02, FAST = 3, END_SPEED = 0.15, END_TURN = 2.0;
/**
 * As it forms: its sphere grows from GROW_FROM of its size to the whole of it, and pushes out from the attacker's
 * middle toward its foe (CrescentShot.toward) by PUSH × H — over GROW_T s, eased out (fast, then settling). Its push
 * mostly across: its height's share of the way to its foe only PUSH_UP of it.
 */
const GROW_FROM = 0.55, GROW_T = 0.16, PUSH = 0.35, PUSH_UP = 0.3;
/** Its front half: how far round from straight ahead (radians, up or down) all of its path is kept; how fast its turn there eases (per s). */
const FRONT = 1.35, TURN_EASE = 30;

// ── its look ────────────────────────────────────────────────────────
/** The eroding edge's burning band (of the noise's range), white-hot. */
const BURN = 0.08;
/** Its edge line: seated on its rim (× its radius: just touching it, no gap), its width (× its own). */
const EDGE_OUT = 1.01, EDGE_W = 0.12;
/** Its glow: out past its rim (× its radius), its width (× its own), how strong. */
const GLOW_OUT = 1.04, GLOW_W = 1.7, GLOW_GAIN = 0.6;
/** Its cel bands, from its rim (1) in to its inner edge (0): ink, white-hot core, fill, outline colour, ink. */
const BAND_INK_OUT = 0.95, BAND_CORE = 0.68, BAND_FILL = 0.28, BAND_LINE = 0.1;
/** Its volume in cel steps: where its light falls below this, a band darker (× DARK). */
const LIT_STEP = 0.84, DARK = 0.72;
/**
 * Its particles. Shards shed off its head as it sweeps: how many a second, how fast (× H/s), how long they live (s).
 * Embers flaking off its eroding edge: how many a second, how fast they drift out, how long they live.
 */
const SHARDS = 260, SHARD_SPEED: [number, number] = [1.6, 3.6], SHARD_LIFE: [number, number] = [0.18, 0.38];
const EMBERS = 140, EMBER_SPEED: [number, number] = [0.4, 1.2], EMBER_LIFE: [number, number] = [0.3, 0.6];
/** Sparks off where it strikes: how many, how fast (× H/s), how long they live (s). */
const SPARKS = 22, SPARK_SPEED: [number, number] = [2.4, 5.2], SPARK_LIFE: [number, number] = [0.2, 0.45];

/** Its mesh: faces along it and across it. */
const SEGS = 96, ACROSS = 10;

// Placed on the CPU each frame (its path moves): the shader only passes it through, its light by how far across it is.
Effect.ShadersStore.crescentCutVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 viewProjection;
varying vec2 vUV;
varying float vLit;
void main(void) {
  vUV = uv;
  // (Its light: its ridge, mid-way across, brighter; its sides falling away toward its edges.)
  vLit = 1.0 - ${SHADE.toFixed(2)} * (1.0 - sin(3.14159265 * uv.y));
  gl_Position = viewProjection * vec4(position, 1.0);
}`;

Effect.ShadersStore.crescentCutFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUV;
varying float vLit;
uniform vec3 ink, line, fill, core;
uniform float head, tail, erode, scroll, seed, mode, gain;
${NOISE}
void main(void) {
  float u = vUV.x, v = vUV.y;
  // Wiped out between its tail and its head — its leading tip shaped, its rim ahead of its inside.
  if (u < tail) discard;
  if (u > head - (1.0 - v) * ${TIP_LEAD.toFixed(3)}) discard;
  if (mode > 1.5) {
    // Its glow: soft, strongest along its middle, fading as it erodes.
    float a = (1.0 - abs(v - 0.5) * 2.0) * gain * (1.0 - erode);
    if (a < 0.01) discard;
    gl_FragColor = vec4(fill * a, a);
    return;
  }
  if (mode > 0.5) {
    // Its edge line: white-hot, solid — eroded with its body, as its body's rim is (the same noise there).
    float er = fbm(vec3(u * 12.0, 4.0, seed + 9.1));
    if (er < erode * (1.3 - 0.7 * u)) discard;
    gl_FragColor = vec4(core, 1.0);
    return;
  }
  // Its streaks: two noises multiplied, stretched along it, scrolled back along it.
  float n1 = fbm(vec3(u * 22.0 + scroll, v * 2.2, seed));
  float n2 = vn(vec3(u * 7.0 + scroll * 0.4, v * 1.1, seed + 3.7));
  float streak = clamp(n1 * n2 * 2.4, 0.0, 1.0);
  // Its inner edge torn into speed lines; its rim clean.
  float inner = ${TEAR.toFixed(2)} * streak;
  if (v < inner) discard;
  float d = (v - inner) / max(1.0 - inner, 1e-3);
  // Eroded tail first, toward its head; its eroding edge burning white-hot.
  float en = fbm(vec3(u * 12.0, v * 4.0, seed + 9.1));
  float thr = erode * (1.3 - 0.7 * u);
  if (en < thr) discard;
  bool burn = erode > 0.0 && en < thr + ${BURN.toFixed(2)};
  // Cel bands, rim in: a thin ink line, its white-hot core along the edge that cut, its type's fill, its outline
  // colour, ink at its torn inner edge.
  vec3 c = d > ${BAND_INK_OUT.toFixed(2)} ? ink : d > ${BAND_CORE.toFixed(2)} ? core : d > ${BAND_FILL.toFixed(2)} ? fill : d > ${BAND_LINE.toFixed(2)} ? line : ink;
  // (Its strongest streaks a band lighter through its fill: speed lines.)
  if (d > ${BAND_FILL.toFixed(2)} && d <= ${BAND_CORE.toFixed(2)} && streak > 0.74) c = core;
  // (Its volume in a cel step: its sides, away from its ridge, a band darker - not its ink.)
  if (vLit < ${LIT_STEP.toFixed(2)} && d > ${BAND_LINE.toFixed(2)} && d <= ${BAND_INK_OUT.toFixed(2)}) c *= ${DARK.toFixed(2)};
  // (Its eroding edge burning white-hot.)
  if (burn) c = core;
  gl_FragColor = vec4(c, 1.0);
}`;

export interface CrescentShot {
  /** The type whose colours it wears (auraPalette.auraGlow). */
  element: string;
  /** The attacker's height (H): it is sized to it. */
  height: number;
  /** Its sphere's centre (the attacker's middle), this frame. */
  centre(): Vector3;
  /** Which way the attacker faces: +1 (right) or −1 (left). */
  facing(): number;
  /** A set sweep (radians round its middle in its side plane, for one facing right: 0 straight ahead, up positive). */
  sweep?: [number, number];
  /** A set sweep's tilt toward the camera (radians about the vertical): a little depth. */
  tilt?: number;
  /** Its size (× WIDTH, and a set sweep's RADIUS). */
  scale?: number;
  /** Held at its full shape until this resolves (a look at it, still), then eroded as ever. */
  hold?: Promise<void>;
  /**
   * The striking part, each frame (world; null: none this frame): followed round its sphere — its head on the part,
   * its tail where the swing began — for `trace` s at most, or till its swing is over. Unset: its set sweep.
   */
  sample?: () => Vector3 | null;
  /** Where its foe is (its middle), each frame: it pushes out toward it as it forms. */
  toward?: () => Vector3;
  trace?: number;
}

export interface CrescentPlay {
  /** Resolves as its head passes in front of the attacker (where a blow lands), or as its swing ends. */
  readonly hit: Promise<void>;
  /** Resolves when it and its particles are gone. */
  readonly done: Promise<void>;
}

const easeOutCubic = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const easeIn = (x: number) => { const k = Math.min(1, Math.max(0, x)); return k * k; };
/** Its flag's width along it (0..1): rising slowly from its tail, fullest at FULLEST, rounding off to a point at its head. */
const flag = (u: number) => {
  u = Math.min(1, Math.max(0, u));
  return u < FULLEST ? Math.pow(u / FULLEST, 1.25) : Math.pow(Math.max(0, 1 - (u - FULLEST) / (1 - FULLEST)), HEAD_ROUND);
};
/** The angle between two unit vectors. */
const angleOf = (a: Vector3, b: Vector3) => Math.acos(Math.min(1, Math.max(-1, Vector3.Dot(a, b))));

/** Its mesh: a strip, uv.x along it, uv.y across it (0 its inner edge, 1 its rim) — its points placed each frame. */
function strip(scene: Scene, name: string): Mesh {
  const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
  for (let i = 0; i <= SEGS; i++) for (let j = 0; j <= ACROSS; j++) { pos.push(0, 0, 0); uvs.push(i / SEGS, j / ACROSS); }
  const row = ACROSS + 1;
  for (let i = 0; i < SEGS; i++) for (let j = 0; j < ACROSS; j++) {
    const a = i * row + j, b = a + row;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = pos; vd.uvs = uvs; vd.indices = idx;
  vd.applyToMesh(mesh, true);
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true; // its points set each frame
  return mesh;
}

/**
 * A path on the unit sphere (ways from its centre), measured along: where it is `s` of the way along (0 its tail, 1
 * its head), and the way it runs there.
 */
class SpherePath {
  readonly dirs: Vector3[] = [];
  private cum: number[] = [];
  get length(): number { return this.cum.length ? this.cum[this.cum.length - 1] : 0; }
  set(dirs: Vector3[]): void {
    this.dirs.length = 0; this.cum.length = 0;
    let c = 0;
    dirs.forEach((d, i) => { if (i) c += angleOf(dirs[i - 1], d); this.dirs.push(d); this.cum.push(c); });
  }
  at(s: number): Vector3 {
    const n = this.dirs.length;
    if (n === 1) return this.dirs[0].clone();
    const want = Math.min(1, Math.max(0, s)) * this.length;
    let i = 1;
    while (i < n - 1 && this.cum[i] < want) i++;
    const span = this.cum[i] - this.cum[i - 1];
    const k = span > 1e-6 ? (want - this.cum[i - 1]) / span : 0;
    return Vector3.Lerp(this.dirs[i - 1], this.dirs[i], k).normalize();
  }
  way(s: number): Vector3 {
    const e = 1 / SEGS;
    const w = this.at(Math.min(1, s + e)).subtract(this.at(Math.max(0, s - e)));
    return w.lengthSquared() > 1e-12 ? w.normalize() : new Vector3(0, -1, 0);
  }
}

export class CrescentFx {
  constructor(private readonly scene: Scene, private readonly camera: Camera) {}

  /** A crescent cut, now. */
  cut(shot: CrescentShot): CrescentPlay {
    const scene = this.scene;
    const H = shot.height;
    const W = WIDTH * H * (shot.scale ?? 1);
    const [, , lineC, fillC] = auraGlow(shot.element);
    const core: RGB = fillC.map((x) => 0.4 * x + 0.6) as RGB;
    const ink: RGB = lineC.map((x) => x * 0.25) as RGB;
    const seed = Math.random() * 50;
    // Its layers: glow (under), body (its back sheet and its front), edge line — each its radius (× its sphere's), its
    // width (× its own), its sheet (its thickness: −1 back, +1 front, 0 flat).
    const layers = ([['Glow', 2, GLOW_OUT, GLOW_W, 0], ['BodyBack', 0, 1, 1, -1], ['Body', 0, 1, 1, 1], ['Edge', 1, EDGE_OUT, EDGE_W, 0]] as const)
      .map(([name, mode, out, wide, sheet]) => {
        const mesh = strip(scene, `crescent${name}`);
        const mat = new ShaderMaterial(`crescent${name}Mat`, scene, { vertex: 'crescentCut', fragment: 'crescentCut' }, {
          attributes: ['position', 'uv'],
          uniforms: ['viewProjection', 'ink', 'line', 'fill', 'core', 'head', 'tail', 'erode', 'scroll', 'seed', 'mode', 'gain'],
          needAlphaBlending: mode === 2,
        });
        mat.backFaceCulling = false;
        // (Its glow added; its body and edge line solid - cel, drawn with the scene's solids.)
        if (mode === 2) { mat.alphaMode = Constants.ALPHA_ONEONE; mat.disableDepthWrite = true; }
        mat.setColor3('ink', new Color3(...ink)); mat.setColor3('line', new Color3(...lineC));
        mat.setColor3('fill', new Color3(...fillC)); mat.setColor3('core', new Color3(...core));
        mat.setFloat('seed', seed); mat.setFloat('mode', mode); mat.setFloat('gain', GLOW_GAIN);
        // (Its moving values set from the first: never drawn with one unset.)
        for (const k of ['head', 'tail', 'erode', 'scroll']) mat.setFloat(k, 0);
        mesh.material = mat;
        mesh.setEnabled(false);
        return { mesh, mat, mode, out, wide, sheet, pos: new Float32Array((SEGS + 1) * (ACROSS + 1) * 3) };
      });
    // Its shards and embers: glowing, light, drifting - no fall to speak of.
    const shards = new GlowSparks(scene, this.camera, 120, {
      size: 0.012 * H, lengthPerSpeed: 0.05, tint: fillC, tintMix: 0.55, gravity: 0.4 * H, drag: 3.0,
      turbulence: 0.5 * H, splitChance: 0.1, splitCount: 2, secondary: core, intensity: 1.4,
    });
    const embers = new GlowSparks(scene, this.camera, 120, {
      size: 0.014 * H, lengthPerSpeed: 0.02, tint: fillC, tintMix: 0.8, gravity: -0.3 * H, drag: 1.6,
      turbulence: 0.9 * H, splitChance: 0, splitCount: 1, secondary: lineC, intensity: 1.1,
    });
    const sparks = new GlowSparks(scene, this.camera, SPARKS + 6, {
      size: 0.015 * H, lengthPerSpeed: 0.04, tint: fillC, tintMix: 0.7, gravity: 2.5 * H, drag: 2.2,
      turbulence: 0.6 * H, splitChance: 0.25, splitCount: 2, secondary: core, intensity: 1.3,
    });
    let shardOwed = 0, emberOwed = 0;

    // Its path round its sphere, and its sphere's radius.
    const path = new SpherePath();
    let R = RADIUS * H * (shot.scale ?? 1);
    // A set sweep: its arc in the side plane (mirrored to face its way, tilted a little), laid on its sphere.
    const sweepPath = () => {
      const [s0, s1] = shot.sweep ?? SWEEP;
      const dir = shot.facing() >= 0 ? 1 : -1;
      const tilt = Quaternion.RotationAxis(Vector3.Up(), (shot.tilt ?? 0.25) * dir);
      const dirs: Vector3[] = [];
      for (let i = 0; i <= 32; i++) {
        const a = s0 + (s1 - s0) * (i / 32);
        dirs.push(new Vector3(Math.cos(a) * dir, Math.sin(a), 0).applyRotationQuaternion(tilt).normalize());
      }
      path.set(dirs);
    };
    // Its front: the way to its foe across the ground (or, none given, the way it faces).
    const frontWay = (c0: Vector3, facing: number) => {
      const to = shot.toward ? shot.toward().subtract(c0) : new Vector3(facing, 0, 0);
      to.y = 0;
      return to.lengthSquared() > 1e-8 ? to.normalize() : new Vector3(facing, 0, 0);
    };
    // Following the part: the ways it has gone from the middle (from where its swing began), its swing's speed.
    const followed: Vector3[] = [];
    let following = !!shot.sample, fastest = 0, lastWay: Vector3 | null = null;
    // (Its turn onto its front half: eased toward what it needs.)
    let turn = 0;
    const traceEnd = shot.trace ?? 0.6;
    if (!following) sweepPath();

    let resolveHit!: () => void, resolveDone!: () => void;
    const hit = new Promise<void>((r) => { resolveHit = r; });
    const done = new Promise<void>((r) => { resolveDone = r; });
    let t0 = performance.now();
    // (When it began forming: its growth and its push, from then.)
    const born = t0;
    // (Its sphere's radius as drawn this frame: grown as it forms.)
    let Rd = R;
    let last = t0, struck = false, closest = Infinity;
    // (Held at its full shape: its clock stopped there till let go — then on from there.)
    const FULL = SWING + HOLD * 0.5;
    let holding = !!shot.hold;
    void shot.hold?.then(() => { holding = false; t0 = performance.now() - FULL * 1000; });
    let obs: Observer<Scene> | null = null;
    let gone = false;
    const end = () => {
      if (gone) return;
      gone = true;
      if (obs) scene.onBeforeRenderObservable.remove(obs);
      for (const { mesh, mat } of layers) { mat.dispose(); mesh.dispose(); }
      sparks.dispose(); shards.dispose(); embers.dispose();
      resolveHit();
      resolveDone();
    };

    /** A point of it (u along it, v across it: 1 its rim), in the world: its sphere's centre `c`; out by `out`, `wide`. */
    const pointAt = (c: Vector3, u: number, v: number, out = 1, wide = 1, sheet = 0) => {
      const d = path.at(u);
      const w = W * wide * flag(u);
      // (Its rim on its sphere, through the part; its body in from there toward the middle.)
      const r = Rd * out - w * (1 - v);
      const p = c.add(d.scale(r));
      if (sheet) {
        // (Its thickness: across it, square to its way and to the middle — a lens, tapering with its width.)
        const n = Vector3.Cross(d, path.way(u));
        if (n.lengthSquared() > 1e-10) p.addInPlace(n.normalize().scale(sheet * THICK * w * Math.pow(Math.max(0, Math.sin(Math.PI * v)), 0.7)));
      }
      return p;
    };

    const rowD: Vector3[] = [], rowN: Vector3[] = [], rowF: number[] = [];
    // (Anything going wrong in a frame — its attacker gone, say: all of it gone at once, never left half made.)
    const frame = () => { try { step(); } catch (e) { end(); throw e; } };
    const step = () => {
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
      // (Held, or following the part: its clock stopped at its full shape — wiped out to its head — till let go.)
      const t = holding ? Math.min(FULL, (now - t0) / 1000) : following ? Math.min(SWING, (now - t0) / 1000) : (now - t0) / 1000;
      last = now;
      // (The attacker's middle: the part's way measured from here — where it is drawn, pushed out from it, below.)
      const c0 = shot.centre();
      const facing = shot.facing() >= 0 ? 1 : -1;
      // Following the part: its way from the middle, a new point on its path as it goes round.
      if (following) {
        const p = shot.sample!();
        if (p) {
          const off = p.subtract(c0);
          if (off.lengthSquared() > 1e-8) {
            const way = off.normalize();
            if (!followed.length) {
              followed.push(way);
              // (Its sphere: as far out as the part is as its swing begins.)
              R = Math.min(MAX_R * H, Math.max(MIN_R * H, p.subtract(c0).length())) * (shot.scale ?? 1);
            } else {
              const prev = followed[followed.length - 1], step = angleOf(prev, way);
              if (step >= STEP) {
                const going = way.subtract(prev).normalize();
                // (Turned back on itself, or slowed right down past its fastest: its swing is over.)
                const turned = lastWay && angleOf(lastWay, going) > END_TURN;
                const speed = step / Math.max(dt, 1e-3);
                if (turned) following = false;
                else { followed.push(way); lastWay = going; fastest = Math.max(fastest, speed); }
              } else if (fastest > FAST && step / Math.max(dt, 1e-3) < END_SPEED * fastest) following = false;
            }
          }
        }
        if ((now - t0) / 1000 >= traceEnd) following = false;
        // Its path: where the part has been — no shorter than MIN_SWEEP, carried on back behind where it began.
        if (followed.length >= 2) {
          const run = followed.reduce((a, d, i) => (i ? a + angleOf(followed[i - 1], d) : 0), 0);
          const dirs = followed.slice();
          if (run < MIN_SWEEP) {
            const axis = Vector3.Cross(followed[1], followed[0]);
            if (axis.lengthSquared() > 1e-10) {
              axis.normalize();
              const back = MIN_SWEEP - run, n = Math.ceil(back / 0.05);
              for (let k = 1; k <= n; k++) dirs.unshift(followed[0].applyRotationQuaternion(Quaternion.RotationAxis(axis, (back * k) / n)).normalize());
            }
          }
          // Kept on its front half, the side facing its foe: the whole path turned about its side axis (square to its
          // front and to the vertical) — the least turn that puts all of it within FRONT of straight ahead (a path
          // wider than that: centred on it). A turn, not a mirror: its swing keeps its way round (top to bottom,
          // clockwise or not) and its shape, only set at its foe. Eased frame to frame (TURN_EASE), never jumping.
          const front = frontWay(c0, facing), up = Vector3.Up(), axisSide = Vector3.Cross(front, up).normalize();
          let lo = Infinity, hi = -Infinity, phi = 0;
          dirs.forEach((d, i) => {
            const a = Math.atan2(Vector3.Dot(d, up), Vector3.Dot(d, front));
            // (Unwrapped along it: a path passing round behind stays one run of angles.)
            phi = i ? phi + (((a - phi) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI : a;
            lo = Math.min(lo, phi); hi = Math.max(hi, phi);
          });
          const want = hi - lo > 2 * FRONT ? -(lo + hi) / 2 : hi > FRONT ? FRONT - hi : lo < -FRONT ? -FRONT - lo : 0;
          turn += (want - turn) * Math.min(1, dt * TURN_EASE);
          const q = Quaternion.RotationAxis(axisSide, turn);
          path.set(dirs.map((d) => d.applyRotationQuaternion(q).normalize()));
        }
        // (Its swing over: its clock on from its full shape — held a beat, then eroded.)
        if (!following) t0 = now - SWING * 1000;
      }
      const ready = path.dirs.length >= 2;
      // Forming: grown, and pushed out toward its foe.
      const formK = easeOutCubic((now - born) / 1000 / GROW_T);
      Rd = R * (GROW_FROM + (1 - GROW_FROM) * formK);
      let c = c0;
      if (shot.toward) {
        const to = shot.toward().subtract(c0);
        to.y *= PUSH_UP;
        if (to.lengthSquared() > 1e-8) c = c0.add(to.normalize().scale(PUSH * H * formK));
      }
      const head = easeOutCubic(t / SWING);
      const fadeK = Math.max(0, (t - SWING - HOLD) / FADE);
      const erode = Math.min(1, fadeK);
      const tail = TAIL_CREEP * easeIn(fadeK);
      const scroll = SCROLL * (1 - Math.exp(-t / SCROLL_EASE));
      // Its points, each layer: on its sphere, along its path. (Its path's way, and the square across it, worked out once
      // a frame at each step along it, for every layer.)
      if (ready) for (let i = 0; i <= SEGS; i++) {
        const u = i / SEGS, d = path.at(u), n = Vector3.Cross(d, path.way(u));
        rowD[i] = d; rowN[i] = n.lengthSquared() > 1e-10 ? n.normalize() : n; rowF[i] = flag(u);
      }
      for (const L of layers) {
        L.mesh.setEnabled(ready);
        if (!ready) continue;
        let k = 0;
        for (let i = 0; i <= SEGS; i++) {
          const d = rowD[i], n = rowN[i], w = W * L.wide * rowF[i];
          for (let j = 0; j <= ACROSS; j++) {
            const v = j / ACROSS, r = Rd * L.out - w * (1 - v);
            const z = L.sheet ? L.sheet * THICK * w * Math.pow(Math.max(0, Math.sin(Math.PI * v)), 0.7) : 0;
            L.pos[k++] = c.x + d.x * r + n.x * z; L.pos[k++] = c.y + d.y * r + n.y * z; L.pos[k++] = c.z + d.z * r + n.z * z;
          }
        }
        L.mesh.updateVerticesData(VertexBuffer.PositionKind, L.pos);
        L.mat.setFloat('head', head);
        L.mat.setFloat('tail', tail);
        L.mat.setFloat('erode', erode);
        L.mat.setFloat('scroll', scroll);
      }
      const along = (u: number) => pointAt(c, Math.min(1, u + 0.01), 1).subtract(pointAt(c, Math.max(0, u - 0.01), 1)).normalize();
      // Shards shed off its head as it sweeps (or follows the part): flung on along the swing and out off its rim.
      if (ready && (head < 1 || following) && !holding) {
        shardOwed += SHARDS * dt;
        for (; shardOwed >= 1; shardOwed -= 1) {
          const u = head * (0.92 + Math.random() * 0.08), p = pointAt(c, u, 0.55 + Math.random() * 0.45);
          const out = p.subtract(c).normalize();
          const v = along(u).scale(0.6 + Math.random() * 0.6).add(out.scale(0.4 + Math.random() * 0.8));
          const speed = (SHARD_SPEED[0] + Math.random() * (SHARD_SPEED[1] - SHARD_SPEED[0])) * H;
          shards.spawn(p, v.normalize().scale(speed), SHARD_LIFE[0] + Math.random() * (SHARD_LIFE[1] - SHARD_LIFE[0]));
        }
      }
      // Embers flaking off its eroding edge - where it is being eaten now, tail first toward its head: drifting out.
      if (ready && erode > 0 && erode < 1) {
        emberOwed += EMBERS * dt;
        // (Where its erosion has reached along it: tail first, its threshold 1.3 - 0.7 u passing the noise's middle.)
        const front = Math.min(1, Math.max(tail, (1.3 - 0.5 / Math.max(erode, 1e-3)) / 0.7));
        for (; emberOwed >= 1; emberOwed -= 1) {
          const u = Math.min(1, Math.max(tail, front - 0.25 + Math.random() * 0.5));
          const p = pointAt(c, u, Math.random());
          const out = p.subtract(c).normalize();
          const speed = (EMBER_SPEED[0] + Math.random() * (EMBER_SPEED[1] - EMBER_SPEED[0])) * H;
          embers.spawn(p, out.add(along(u).scale(-0.4)).normalize().scale(speed), EMBER_LIFE[0] + Math.random() * (EMBER_LIFE[1] - EMBER_LIFE[0]));
        }
      }
      shards.update(dt); embers.update(dt);
      // Its blow: as its head passes in front of the attacker — nearest straight ahead, then past it — or as its swing
      // ends: sparks off its rim there, out along the swing.
      if (!struck && ready) {
        const headWay = path.at(head);
        const off = angleOf(headWay, new Vector3(facing, 0, 0));
        const passed = off > closest + 0.02 && closest < 0.9;
        closest = Math.min(closest, off);
        if (passed || (!following && head >= 1 && closest < 0.9) || (!following && shot.sample)) {
          struck = true;
          resolveHit();
          const at = pointAt(c, head, 1);
          const way = along(head);
          for (let n = 0; n < SPARKS; n++) {
            const out = way.scale(0.8 + Math.random() * 0.6).add(new Vector3(facing * (Math.random() * 0.9 - 0.2), 0, (Math.random() - 0.5) * 0.8));
            const speed = (SPARK_SPEED[0] + Math.random() * (SPARK_SPEED[1] - SPARK_SPEED[0])) * H;
            sparks.spawn(at, out.normalize().scale(speed), SPARK_LIFE[0] + Math.random() * (SPARK_LIFE[1] - SPARK_LIFE[0]));
          }
        }
      }
      sparks.update(dt);
      if (!following && t >= SWING + HOLD + FADE + Math.max(SPARK_LIFE[1], EMBER_LIFE[1])) end();
    };
    frame();
    obs = scene.onBeforeRenderObservable.add(frame);
    return { hit, done };
  }
}
