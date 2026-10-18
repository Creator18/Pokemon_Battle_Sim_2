/**
 * Body parts, by the rigs' bone names. The Legends Z-A rigs name their bones
 * the same way across species — `head`, `left_hand` (Machamp: `left_a_hand`,
 * `left_b_hand`), `right_foot`, `tail` or `tail_01…`, `left_wing_a_01…`,
 * `left_arm_01…`, `left_leg_01…` — so a part is found by name: the bones that
 * start it (the topmost that match) and every bone below them.
 *
 * A part can also be named by any exact bone name.
 */

import type { Bone } from '@babylonjs/core/Bones/bone';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';

interface PartDef {
  /** Bones of this part (its top ones are where it starts). */
  re: RegExp;
  /**
   * Which bone tells how the part moves: 'root' for a compact part (a hand,
   * the head: its tips only wobble), 'tip' for a chain (a tail, a wing).
   */
  measure: 'root' | 'tip';
}

export const BODY_PARTS: Record<string, PartDef> = {
  head: { re: /^head$/, measure: 'root' },
  left_hand: { re: /^left(_[a-z])?_hand$/, measure: 'root' },
  right_hand: { re: /^right(_[a-z])?_hand$/, measure: 'root' },
  left_arm: { re: /^left(_[a-z])?_arm_01$/, measure: 'root' },
  right_arm: { re: /^right(_[a-z])?_arm_01$/, measure: 'root' },
  left_foot: { re: /^left_foot$/, measure: 'root' },
  right_foot: { re: /^right_foot$/, measure: 'root' },
  left_leg: { re: /^left_leg_01$/, measure: 'root' },
  right_leg: { re: /^right_leg_01$/, measure: 'root' },
  tail: { re: /^tail(_\d+)?$/, measure: 'tip' },
  left_wing: { re: /^left_wing/, measure: 'tip' },
  right_wing: { re: /^right_wing/, measure: 'tip' },
  // Both sides at once.
  hands: { re: /^(left|right)(_[a-z])?_hand$/, measure: 'root' },
  feet: { re: /^(left|right)_foot$/, measure: 'root' },
  wings: { re: /^(left|right)_wing/, measure: 'tip' },
};

/**
 * A part with no bone of its own — Absol's horn is skinned to its head — as
 * a region of its bone's vertices: those weighted mostly to `bone` (or below
 * it) inside any of `boxes`, measured from that bone in the bind pose in
 * units of the model's height (x: its left−/right+ as modelled, y: up, z:
 * forward; a missing range is unbounded; no boxes: all of them). With
 * `island`, only the pieces of the mesh that are the bone's own — not joined
 * to the rest of the body (Garchomp's nail, a separate piece on its hand).
 */
export interface RegionDef { bone: string; boxes?: { x?: [number, number]; y?: [number, number]; z?: [number, number] }[]; island?: boolean }

/**
 * The blade a species cuts with in a slash or claw move, where it is no
 * limb of its own (user: Absol's horn glows, not its whole body).
 */
export const BLADES: Record<string, RegionDef> = {
  // The skull tops out 0.2 over the head bone; above that is only the horn,
  // and below it the horn runs down one side, out past where the skull's
  // other side ends (measured on its face mesh) — the top of the head is not it.
  Absol: { bone: 'head', boxes: [{ y: [0.2, 9] }, { x: [-9, -0.16], y: [-0.05, 9] }] },
  // The nail near the fin (user), not its feet: the white claw, a piece of its
  // own on the hand that strikes in its swipe (the left: far out in front and
  // sweeping across at the blow, while the right is drawn back).
  Garchomp: { bone: 'left_hand', island: true },
};

/**
 * Species whose claws and slashes play their plain attack (attack01) rather
 * than their swipe (attack03), which every other species uses for them (user:
 * Charizard's attack01 is its claw).
 */
export const CLAW_ON_ATTACK = new Set(['Charizard']);

/** A region's vertex flags, per mesh (1 in, 0 out). */
export function regionFlags(meshes: readonly AbstractMesh[], sk: Skeleton, def: RegionDef, height: number): Map<AbstractMesh, Float32Array> {
  const out = new Map<AbstractMesh, Float32Array>();
  const bones = new Set(partBones(sk, def.bone).map((b) => b.getIndex()));
  const root = partRoots(sk, def.bone)[0];
  if (!root) return out;
  const bind = root.getAbsoluteInverseBindMatrix().clone().invert().getTranslation();
  const within = (r: [number, number] | undefined, v: number) => !r || (v >= r[0] * height && v <= r[1] * height);
  const inside = (x: number, y: number, z: number) => !def.boxes || def.boxes.some((b) => within(b.x, x) && within(b.y, y) && within(b.z, z));
  for (const m of meshes) {
    const pos = m.getVerticesData('position'), idx = m.getVerticesData('matricesIndices'), w = m.getVerticesData('matricesWeights');
    if (!pos || !idx || !w) continue;
    const flags = new Float32Array(pos.length / 3);
    for (let v = 0; v < flags.length; v++) {
      let weight = 0;
      for (let k = 0; k < 4; k++) if (bones.has(idx[v * 4 + k])) weight += w[v * 4 + k];
      if (weight >= 0.5 && inside(pos[v * 3] - bind.x, pos[v * 3 + 1] - bind.y, pos[v * 3 + 2] - bind.z)) flags[v] = 1;
    }
    if (def.island) keepIslands(m, flags);
    out.set(m, flags);
  }
  return out;
}

/** Clear the flags of every piece of `m` (connected by its triangles, seams welded) that is not wholly flagged. */
function keepIslands(m: AbstractMesh, flags: Float32Array): void {
  const pos = m.getVerticesData('position')!, ind = m.getIndices();
  const n = flags.length;
  const weld = new Map<string, number>(), rep = new Int32Array(n);
  for (let v = 0; v < n; v++) {
    const k = `${pos[v * 3].toFixed(4)},${pos[v * 3 + 1].toFixed(4)},${pos[v * 3 + 2].toFixed(4)}`;
    const r = weld.get(k);
    if (r === undefined) { weld.set(k, v); rep[v] = v; } else rep[v] = r;
  }
  const par = Int32Array.from({ length: n }, (_, i) => i);
  const find = (x: number) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const join = (a: number, b: number) => { const x = find(rep[a]), y = find(rep[b]); if (x !== y) par[x] = y; };
  if (ind) for (let t = 0; t < ind.length; t += 3) { join(ind[t], ind[t + 1]); join(ind[t + 1], ind[t + 2]); }
  const partial = new Set<number>();
  for (let v = 0; v < n; v++) if (!flags[v]) partial.add(find(rep[v]));
  for (let v = 0; v < n; v++) if (flags[v] && partial.has(find(rep[v]))) flags[v] = 0;
}

/** The parts that can lead a strike, in no particular order. */
export const STRIKE_PARTS = ['left_hand', 'right_hand', 'left_foot', 'right_foot', 'head', 'tail'];

/** The bones a part starts from (none if the rig has no such part). */
export function partRoots(sk: Skeleton, part: string): Bone[] {
  const exact = sk.bones.find((b) => b.name === part);
  if (exact) return [exact];
  const def = BODY_PARTS[part];
  if (!def) return [];
  return sk.bones.filter((b) => def.re.test(b.name) && !(b.getParent() && def.re.test(b.getParent()!.name)));
}

/** Every bone of a part: its roots and all below them. */
export function partBones(sk: Skeleton, part: string): Bone[] {
  const roots = new Set(partRoots(sk, part));
  if (!roots.size) return [];
  return sk.bones.filter((b) => {
    for (let x: Bone | null = b; x; x = x.getParent()) if (roots.has(x)) return true;
    return false;
  });
}

/** The bone that tells how a part moves (see PartDef.measure), or null. */
export function partMeasureBone(sk: Skeleton, part: string): Bone | null {
  const roots = partRoots(sk, part);
  if (!roots.length) return null;
  const def = BODY_PARTS[part];
  if (!def || def.measure === 'root') return roots[0];
  // A chain: its deepest bone that still belongs to the part by name.
  const depth = (b: Bone) => { let d = 0; for (let x = b.getParent(); x; x = x.getParent()) d++; return d; };
  let tip = roots[0];
  for (const b of partBones(sk, part)) if (def.re.test(b.name) && depth(b) > depth(tip)) tip = b;
  return tip;
}
