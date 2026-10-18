/**
 * Evolution morph: one form's surface flows into the next form's.
 *
 * The Z-A rigs name bones alike across a line (`head`, `left_arm_01`,
 * `tail_03`…), so the two forms' bones are matched: by exact name, else
 * along a chain of the same family (`tail_01…06` ↔ `tail_a_01…05`, `neck` ↔
 * `neck_01…03`) by position along it. The matches guide which part of one
 * surface flows into which part of the other (see the surface morph below).
 */

import type { Bone } from '@babylonjs/core/Bones/bone';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';

/** The family a bone belongs to: `tail_a_03` → `tail`, `left_wing_a_04` → `left_wing`. */
function chainOf(name: string): string {
  return name.replace(/_sub$/, '').replace(/(_[a-z])(?=_|$)/g, '').replace(/(_\d+)+$/, '');
}

const depthOf = (b: Bone) => { let d = 0; for (let x = b.getParent(); x; x = x.getParent()) d++; return d; };

/**
 * For each bone of `from`, its counterpart in `to` (or nothing): exact name,
 * else the bone at the same place along the same chain.
 */
export function matchBones(from: Skeleton, to: Skeleton): Map<Bone, Bone> {
  const byName = new Map(to.bones.map((b) => [b.name, b]));
  const chains = (sk: Skeleton) => {
    const m = new Map<string, Bone[]>();
    for (const b of sk.bones) { const k = chainOf(b.name); if (!m.has(k)) m.set(k, []); m.get(k)!.push(b); }
    for (const list of m.values()) list.sort((a, b) => depthOf(a) - depthOf(b) || a.name.localeCompare(b.name));
    return m;
  };
  const fromChains = chains(from), toChains = chains(to);
  const out = new Map<Bone, Bone>();
  // The rigs' top bones are named after their species (pm0004…, pm0005…):
  // they are each other's, whatever the name.
  const toRoot = to.bones.find((b) => !b.getParent());
  for (const b of from.bones) {
    if (!b.getParent() && toRoot) { out.set(b, toRoot); continue; }
    const exact = byName.get(b.name);
    if (exact) { out.set(b, exact); continue; }
    const k = chainOf(b.name);
    const mine = fromChains.get(k), theirs = toChains.get(k);
    if (!mine || !theirs || !theirs.length) continue;
    const i = mine.indexOf(b);
    const j = mine.length > 1 ? Math.round((i * (theirs.length - 1)) / (mine.length - 1)) : 0;
    out.set(b, theirs[Math.min(theirs.length - 1, j)]);
  }
  return out;
}

// ── The surface morph ────────────────────────────────────────────────────
//
// The old form's surface flows, vertex by vertex, onto the new form's body,
// while the new form's surface unfolds from the old one's: every vertex of
// each is paired with a vertex of the other. Both forms keep playing their
// animation the whole while (LiveSkin re-skins them every frame), so the
// surface starts in the old form's moving pose and ends in the new one's. The pairing follows the body
// parts: a vertex is first carried with its bone to where the matching bone
// sits on the other form (scaled to that form's size), then snapped to the
// nearest point of the other form's surface. A new part (wings) is carried
// with the nearest matched bone above it (the shoulder), so it starts folded
// onto the old body there and spreads out.

/** One model's surface as it stands: world positions, triangles, and each vertex's main bone. */
export interface Snapshot {
  pos: Float32Array;
  idx: Uint32Array;
  bone: Int32Array;
}

/** Skin every vertex of the meshes on the CPU, with the skeleton's current matrices (call skeleton.prepare first). */
export function snapshotModel(meshes: AbstractMesh[], sk: Skeleton): Snapshot {
  const pos: number[] = [], idx: number[] = [], bone: number[] = [];
  const v = new Vector3(), acc = new Vector3();
  for (const mesh of meshes) {
    const P = mesh.getVerticesData(VertexBuffer.PositionKind);
    const I = mesh.getVerticesData(VertexBuffer.MatricesIndicesKind);
    const W = mesh.getVerticesData(VertexBuffer.MatricesWeightsKind);
    const T = mesh.getIndices();
    if (!P || !T) continue;
    const world = mesh.computeWorldMatrix(true);
    const M = I && W ? sk.getTransformMatrices(mesh) : null;
    const base = pos.length / 3;
    for (let k = 0; k < P.length / 3; k++) {
      const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2];
      let best = -1, bw = -1;
      if (M && I && W) {
        acc.setAll(0);
        for (let j = 0; j < 4; j++) {
          const wt = W[k * 4 + j];
          if (wt <= 0) continue;
          if (wt > bw) { bw = wt; best = I[k * 4 + j]; }
          const o = I[k * 4 + j] * 16;
          acc.x += wt * (M[o] * x + M[o + 4] * y + M[o + 8] * z + M[o + 12]);
          acc.y += wt * (M[o + 1] * x + M[o + 5] * y + M[o + 9] * z + M[o + 13]);
          acc.z += wt * (M[o + 2] * x + M[o + 6] * y + M[o + 10] * z + M[o + 14]);
        }
      } else acc.set(x, y, z);
      Vector3.TransformCoordinatesToRef(acc, world, v);
      pos.push(v.x, v.y, v.z);
      bone.push(best);
    }
    for (const t of T) idx.push(base + t);
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx), bone: new Int32Array(bone) };
}

/** A uniform grid over points, for nearest-point lookups. */
class PointGrid {
  private cells = new Map<string, number[]>();
  constructor(private readonly p: Float32Array, private readonly size: number) {
    for (let i = 0; i < p.length / 3; i++) {
      const k = this.key(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      let c = this.cells.get(k);
      if (!c) this.cells.set(k, (c = []));
      c.push(i);
    }
  }
  private key(x: number, y: number, z: number) {
    return `${Math.floor(x / this.size)},${Math.floor(y / this.size)},${Math.floor(z / this.size)}`;
  }
  /** Index of the nearest point (searching rings of cells outward). */
  nearest(x: number, y: number, z: number): number {
    const cx = Math.floor(x / this.size), cy = Math.floor(y / this.size), cz = Math.floor(z / this.size);
    let best = -1, bd = Infinity;
    for (let r = 0; r < 64; r++) {
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) {
        if (Math.max(Math.abs(i), Math.abs(j), Math.abs(k)) !== r) continue; // this ring only
        const c = this.cells.get(`${cx + i},${cy + j},${cz + k}`);
        if (!c) continue;
        for (const n of c) {
          const dx = this.p[n * 3] - x, dy = this.p[n * 3 + 1] - y, dz = this.p[n * 3 + 2] - z;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bd) { bd = d; best = n; }
        }
      }
      // Anything in a further ring is at least r cells away.
      if (best >= 0 && Math.sqrt(bd) <= r * this.size) break;
    }
    return best;
  }
}

/** World positions of a skeleton's bones (for a mesh it skins), by bone index. */
export function bonePositions(sk: Skeleton, mesh: AbstractMesh): Vector3[] {
  sk.computeAbsoluteMatrices(true);
  return sk.bones.map((b) => b.getAbsolutePosition(mesh));
}

/**
 * Which vertex of `dst` each vertex of `src` pairs with: carried with its
 * bone to the matched bone (or the nearest matched one above it), scaled by
 * `scale` (dst size / src size), then snapped to the nearest vertex of `dst`.
 */
export function pairOnto(src: Snapshot, srcSk: Skeleton, srcBones: Vector3[], dst: Snapshot, dstSk: Skeleton, dstBones: Vector3[],
  match: Map<Bone, Bone>, scale: number, cell: number): Int32Array {
  const grid = new PointGrid(dst.pos, cell);
  const dstIndex = new Map(dstSk.bones.map((b, i) => [b, i]));
  // For each src bone: the dst bone it travels to (itself or the nearest matched ancestor's).
  const via = srcSk.bones.map((b) => {
    for (let x: Bone | null = b; x; x = x.getParent()) {
      const m = match.get(x);
      if (m) return { from: srcSk.bones.indexOf(x), to: dstIndex.get(m)! };
    }
    return null;
  });
  const out = new Int32Array(src.pos.length / 3);
  const q = new Vector3();
  for (let i = 0; i < src.pos.length / 3; i++) {
    const b = src.bone[i];
    const w = b >= 0 ? via[b] : null;
    q.set(src.pos[i * 3], src.pos[i * 3 + 1], src.pos[i * 3 + 2]);
    if (w) q.subtractInPlace(srcBones[w.from]).scaleInPlace(scale).addInPlace(dstBones[w.to]);
    out[i] = grid.nearest(q.x, q.y, q.z);
  }
  return out;
}

/**
 * A model's surface, re-skinned on the CPU every frame with its animation
 * (in the same vertex order as snapshotModel), so a morph can follow it.
 */
export class LiveSkin {
  private readonly parts: { mesh: AbstractMesh; P: Float32Array | number[]; I: Float32Array | number[] | null; W: Float32Array | number[] | null; base: number }[] = [];
  readonly count: number;
  constructor(meshes: AbstractMesh[], private readonly sk: Skeleton) {
    let base = 0;
    for (const mesh of meshes) {
      const P = mesh.getVerticesData(VertexBuffer.PositionKind);
      if (!P || !mesh.getIndices()) continue;
      this.parts.push({ mesh, P, I: mesh.getVerticesData(VertexBuffer.MatricesIndicesKind), W: mesh.getVerticesData(VertexBuffer.MatricesWeightsKind), base });
      base += P.length / 3;
    }
    this.count = base;
  }
  /** Write this frame's world positions into `out` (count × 3). */
  update(out: Float32Array): void {
    this.sk.prepare(true);
    const acc = new Vector3(), v = new Vector3();
    for (const { mesh, P, I, W, base } of this.parts) {
      const world = mesh.computeWorldMatrix(true);
      const M = I && W ? this.sk.getTransformMatrices(mesh) : null;
      for (let k = 0; k < P.length / 3; k++) {
        const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2];
        if (M && I && W) {
          acc.setAll(0);
          for (let j = 0; j < 4; j++) {
            const wt = W[k * 4 + j];
            if (wt <= 0) continue;
            const o = I[k * 4 + j] * 16;
            acc.x += wt * (M[o] * x + M[o + 4] * y + M[o + 8] * z + M[o + 12]);
            acc.y += wt * (M[o + 1] * x + M[o + 5] * y + M[o + 9] * z + M[o + 13]);
            acc.z += wt * (M[o + 2] * x + M[o + 6] * y + M[o + 10] * z + M[o + 14]);
          }
        } else acc.set(x, y, z);
        Vector3.TransformCoordinatesToRef(acc, world, v);
        const o = (base + k) * 3;
        out[o] = v.x; out[o + 1] = v.y; out[o + 2] = v.z;
      }
    }
  }
}


/**
 * The vertices (in snapshotModel / LiveSkin order) skinned to a foot or toe
 * bone, or anything below one — empty if the rig has no feet (it floats or
 * slithers, and is not planted).
 */
export function footVertices(meshes: AbstractMesh[], sk: Skeleton, minWeight = 0.4): Int32Array {
  const roots = sk.bones.filter((b) => /(^|_)(foot|toe)(_|$)/.test(b.name));
  if (!roots.length) return new Int32Array(0);
  const set = new Set<number>();
  for (const b of sk.bones) for (let x: Bone | null = b; x; x = x.getParent()) if (roots.includes(x)) { set.add(b.getIndex()); break; }
  const out: number[] = [];
  let base = 0;
  for (const mesh of meshes) {
    const P = mesh.getVerticesData(VertexBuffer.PositionKind);
    if (!P || !mesh.getIndices()) continue;
    const I = mesh.getVerticesData(VertexBuffer.MatricesIndicesKind), W = mesh.getVerticesData(VertexBuffer.MatricesWeightsKind);
    if (I && W) {
      for (let k = 0; k < P.length / 3; k++) {
        let w = 0;
        for (let j = 0; j < 4; j++) if (set.has(I[k * 4 + j])) w += W[k * 4 + j];
        if (w >= minWeight) out.push(base + k);
      }
    }
    base += P.length / 3;
  }
  return new Int32Array(out);
}

/** Shift a surface's vertices up or down so the lowest of `feet` stands at `ground` (no feet: left as it is). */
export function plant(verts: Float32Array, feet: Int32Array, ground: number): void {
  if (!feet.length) return;
  let lo = Infinity;
  for (const v of feet) lo = Math.min(lo, verts[v * 3 + 1]);
  const off = ground - lo;
  for (let i = 1; i < verts.length; i += 3) verts[i] += off;
}

/**
 * A surface as one connected whole: its vertices welded where they share a
 * place (the models split them along texture seams), and which welded
 * vertices are neighbours. Used to keep a morph in one piece.
 */
export interface SurfaceGraph {
  /** Each vertex's welded group. */
  group: Int32Array;
  groups: number;
  /** Neighbours of each group: nbr[start[g] .. start[g + 1]). */
  start: Int32Array;
  nbr: Int32Array;
}

export function buildGraph(s: Snapshot): SurfaceGraph {
  const n = s.pos.length / 3;
  const group = new Int32Array(n);
  const byPlace = new Map<string, number>();
  let groups = 0;
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(s.pos[i * 3] * 1e4)},${Math.round(s.pos[i * 3 + 1] * 1e4)},${Math.round(s.pos[i * 3 + 2] * 1e4)}`;
    let g = byPlace.get(k);
    if (g === undefined) byPlace.set(k, (g = groups++));
    group[i] = g;
  }
  const sets: Set<number>[] = Array.from({ length: groups }, () => new Set());
  for (let t = 0; t < s.idx.length; t += 3) {
    const a = group[s.idx[t]], b = group[s.idx[t + 1]], c = group[s.idx[t + 2]];
    sets[a].add(b); sets[a].add(c); sets[b].add(a); sets[b].add(c); sets[c].add(a); sets[c].add(b);
  }
  const start = new Int32Array(groups + 1);
  for (let g = 0; g < groups; g++) start[g + 1] = start[g] + sets[g].size;
  const nbr = new Int32Array(start[groups]);
  sets.forEach((set, g) => { let o = start[g]; for (const x of set) nbr[o++] = x; });
  return { group, groups, start, nbr };
}

/**
 * Smooth a surface's destinations over it (in place, per vertex): welded
 * copies get one destination, then each takes `iters` steps toward its
 * neighbours' average. Neighbouring vertices then head for neighbouring
 * places, so the surface stays whole and unstretched as it moves; and the
 * averaging draws the points a little into the body they head for, so a
 * surface arriving there ends just inside it.
 */
export function smoothOver(target: Float32Array, g: SurfaceGraph, iters: number, lambda: number,
  scratch: { a: Float32Array; b: Float32Array; count: Float32Array }): void {
  const { a, b, count } = scratch;
  a.fill(0); count.fill(0);
  for (let i = 0; i < g.group.length; i++) {
    const k = g.group[i] * 3;
    a[k] += target[i * 3]; a[k + 1] += target[i * 3 + 1]; a[k + 2] += target[i * 3 + 2];
    count[g.group[i]]++;
  }
  for (let q = 0; q < g.groups; q++) { const c = count[q] || 1; a[q * 3] /= c; a[q * 3 + 1] /= c; a[q * 3 + 2] /= c; }
  let src = a, dst = b;
  for (let it = 0; it < iters; it++) {
    for (let q = 0; q < g.groups; q++) {
      const s0 = g.start[q], s1 = g.start[q + 1];
      if (s1 === s0) { dst[q * 3] = src[q * 3]; dst[q * 3 + 1] = src[q * 3 + 1]; dst[q * 3 + 2] = src[q * 3 + 2]; continue; }
      let x = 0, y = 0, z = 0;
      for (let o = s0; o < s1; o++) { const m = g.nbr[o] * 3; x += src[m]; y += src[m + 1]; z += src[m + 2]; }
      const inv = 1 / (s1 - s0);
      dst[q * 3] = src[q * 3] + (x * inv - src[q * 3]) * lambda;
      dst[q * 3 + 1] = src[q * 3 + 1] + (y * inv - src[q * 3 + 1]) * lambda;
      dst[q * 3 + 2] = src[q * 3 + 2] + (z * inv - src[q * 3 + 2]) * lambda;
    }
    const tmp = src; src = dst; dst = tmp;
  }
  for (let i = 0; i < g.group.length; i++) {
    const k = g.group[i] * 3;
    target[i * 3] = src[k]; target[i * 3 + 1] = src[k + 1]; target[i * 3 + 2] = src[k + 2];
  }
}

export function smoothScratch(g: SurfaceGraph) {
  return { a: new Float32Array(g.groups * 3), b: new Float32Array(g.groups * 3), count: new Float32Array(g.groups) };
}
