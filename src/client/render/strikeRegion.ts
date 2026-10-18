/**
 * What a Pokémon strikes with, to the vertex — for every Pokémon, so its
 * attack's aura coats exactly that (user: Absol's horn glows, not its whole
 * body), even where it is no limb of its own: a horn, a blade, a fin, a
 * fist's knuckles.
 *
 * Looked ahead through the attack clip: every vertex is skinned (on the CPU)
 * just before the blow and just after it, and the body's own motion taken
 * away — where it would be had it been carried rigidly by the hips, turning
 * and all (a whole body pitching into a lunge moves everything in front). What strikes is what then moves fastest out in front of
 * the body: the region grows from the fastest vertex along the mesh,
 * through those moving at least GROW × as fast —
 * hysteresis, so it is one connected piece (the horn, not the horn and a
 * stray toe). Its swing is that piece's mean motion. Tails are left out: a
 * tail whips fastest in almost any attack, and when one really leads, the
 * bone test (findStrikePart, TAIL_AHEAD) already finds it.
 */

import type { Bone } from '@babylonjs/core/Bones/bone';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';

/** The region grows from the fastest vertex through those moving at least GROW × as fast. */
const GROW = 0.62;
/** Nothing strikes if the fastest moves less than MIN_MOVE × the model's height over the window. */
const MIN_MOVE = 0.04;
/** Only what is in front of the body's middle (its hips), past AHEAD × height, can strike (a tail flicks behind). */
const AHEAD = -0.05;

export interface StrikeRegion {
  /** Per mesh: 1 for a vertex in the region, 0 out. */
  flags: Map<AbstractMesh, Float32Array>;
  /** The region's mean motion over the window, in the model's own frame (x right as modelled, y up, z forward). */
  swing: Vector3;
  /** How many vertices it has. */
  size: number;
}

/** A clip player that can pose the skeleton at any time without playing it. */
export interface Peeker {
  peek(action: string, t: number, fn: () => void): void;
}

/** The bone the arms hang from (the shoulders' nearest common ancestor), or null. */
export function chestOf(sk: Skeleton): Bone | null {
  // Machamp's four arms: left_a_shoulder, left_b_shoulder…; Kangaskhan's left_shoulder_a.
  const l = sk.bones.find((b) => /^left(_[a-z])?_(shoulder|arm_01)(_[a-z])?$/.test(b.name)), r = sk.bones.find((b) => /^right(_[a-z])?_(shoulder|arm_01)(_[a-z])?$/.test(b.name));
  if (!l || !r) return null;
  const up = new Set<Bone>();
  for (let x: Bone | null = l.getParent(); x; x = x.getParent()) up.add(x);
  for (let x: Bone | null = r.getParent(); x; x = x.getParent()) if (up.has(x)) return x;
  return null;
}

/** Every vertex of `meshes`, skinned with the skeleton's current pose, in the model's frame. */
function skinAll(meshes: readonly AbstractMesh[], sk: Skeleton): Float32Array[] {
  sk.prepare(true);
  return meshes.map((m) => {
    const pos = m.getVerticesData('position'), idx = m.getVerticesData('matricesIndices'), w = m.getVerticesData('matricesWeights');
    if (!pos) return new Float32Array(0);
    const out = new Float32Array(pos.length);
    if (!idx || !w) { out.set(pos); return out; }
    const bones = sk.getTransformMatrices(m);
    for (let v = 0, n = pos.length / 3; v < n; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      let ax = 0, ay = 0, az = 0;
      for (let j = 0; j < 4; j++) {
        const wt = w[v * 4 + j];
        if (wt <= 0) continue;
        const o = idx[v * 4 + j] * 16;
        ax += wt * (bones[o] * x + bones[o + 4] * y + bones[o + 8] * z + bones[o + 12]);
        ay += wt * (bones[o + 1] * x + bones[o + 5] * y + bones[o + 9] * z + bones[o + 13]);
        az += wt * (bones[o + 2] * x + bones[o + 6] * y + bones[o + 10] * z + bones[o + 14]);
      }
      out[v * 3] = ax; out[v * 3 + 1] = ay; out[v * 3 + 2] = az;
    }
    return out;
  });
}

/** Each mesh's vertex neighbours (by its triangles, seams welded by position). */
function neighbours(m: AbstractMesh): number[][] {
  const pos = m.getVerticesData('position'), ind = m.getIndices();
  const n = pos ? pos.length / 3 : 0;
  const rep = new Int32Array(n);
  const weld = new Map<string, number>();
  for (let v = 0; v < n; v++) {
    const k = `${pos![v * 3].toFixed(4)},${pos![v * 3 + 1].toFixed(4)},${pos![v * 3 + 2].toFixed(4)}`;
    const r = weld.get(k);
    if (r === undefined) { weld.set(k, v); rep[v] = v; } else rep[v] = r;
  }
  const near: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  const link = (a: number, b: number) => { near[rep[a]].add(rep[b]); near[rep[b]].add(rep[a]); };
  if (ind) for (let t = 0; t < ind.length; t += 3) { link(ind[t], ind[t + 1]); link(ind[t + 1], ind[t + 2]); link(ind[t + 2], ind[t]); }
  // Every duplicate shares its representative's neighbours.
  return Array.from({ length: n }, (_, v) => [...near[rep[v]]]);
}

/**
 * The region that strikes in `action` at `hit` s, looking at the motion from
 * `before` s before it to `after` s after it; null if nothing moves enough.
 */
export function findStrikeRegion(
  meshes: readonly AbstractMesh[], sk: Skeleton, player: Peeker, action: string,
  hit: number, before: number, after: number, height: number,
  /**
   * Whose motion is taken away: 'hips' (an attack, the whole body driving in)
   * or 'chest' — where the arms hang from — for a swipe, whose upper body
   * twists and leans into it (so a head swinging along with it is not the strike).
   */
  frame: 'hips' | 'chest' = 'hips',
): StrikeRegion | null {
  const hips = (frame === 'chest' ? chestOf(sk) : null) ?? sk.bones.find((b) => /^(hips|waist|spine_01)$/i.test(b.name)) ?? null;
  const at = (t: number): { pts: Float32Array[]; body: Matrix } => {
    let pts: Float32Array[] = [];
    const body = Matrix.Identity();
    player.peek(action, Math.max(0, t), () => {
      pts = skinAll(meshes, sk);
      // Its absolute matrices lag a step unless worked out afresh.
      sk.computeAbsoluteMatrices(true);
      if (hips) body.copyFrom((hips as Bone).getAbsoluteMatrix());
    });
    return { pts, body };
  };
  const a = at(hit - before), b = at(hit + after);
  sk.prepare(true); // its live pose again
  // Carried rigidly by the hips from before to after (this engine's matrices apply row-vector style: p·M).
  const carry = a.body.clone().invert().multiply(b.body);
  const bodyZ = b.body.getTranslation().z;

  // Each vertex's motion beyond what the body carried it; only in front of the body.
  const moved = (mi: number, v: number, out: Vector3) => {
    const p0 = a.pts[mi], p1 = b.pts[mi];
    Vector3.TransformCoordinatesFromFloatsToRef(p0[v * 3], p0[v * 3 + 1], p0[v * 3 + 2], carry, out);
    return out.set(p1[v * 3] - out.x, p1[v * 3 + 1] - out.y, p1[v * 3 + 2] - out.z);
  };
  const tmp = new Vector3();
  const tail = new Set(sk.bones.filter((x) => /^tail/.test(x.name)).map((x) => x.getIndex()));
  const speed = meshes.map((m, mi) => {
    const p1 = b.pts[mi];
    const s = new Float32Array(p1.length / 3);
    const idx = m.getVerticesData('matricesIndices'), w = m.getVerticesData('matricesWeights');
    for (let v = 0; v < s.length; v++) {
      if (p1[v * 3 + 2] - bodyZ < AHEAD * height) continue;
      if (idx && w) {
        let onTail = 0;
        for (let j = 0; j < 4; j++) if (tail.has(idx[v * 4 + j])) onTail += w[v * 4 + j];
        if (onTail >= 0.5) continue;
      }
      s[v] = moved(mi, v, tmp).length();
    }
    return s;
  });
  let top = 0, topMesh = -1, topV = -1;
  speed.forEach((s, mi) => s.forEach((x, v) => { if (x > top) { top = x; topMesh = mi; topV = v; } }));
  if (top < MIN_MOVE * height || topMesh < 0) return null;

  // Grow from the fastest vertex through the fast ones (one connected piece).
  const flags = new Map<AbstractMesh, Float32Array>();
  meshes.forEach((m, mi) => flags.set(m, new Float32Array(speed[mi].length)));
  const m = meshes[topMesh], s = speed[topMesh], f = flags.get(m)!;
  const near = neighbours(m);
  const stack = [topV];
  f[topV] = 1;
  let size = 0;
  const swing = new Vector3();
  while (stack.length) {
    const v = stack.pop()!;
    size++;
    swing.addInPlace(moved(topMesh, v, tmp));
    for (const u of near[v]) {
      if (f[u] || s[u] < GROW * top) continue;
      f[u] = 1;
      stack.push(u);
    }
  }
  return { flags, swing: swing.scale(1 / Math.max(1, size)), size };
}
