/**
 * SkinSampler — where a skinned Pokémon's skin actually is this frame.
 *
 * Babylon skins on the GPU, so on the CPU a skinned mesh only knows its rest
 * pose. This keeps a spread of each mesh's vertices with their skin weights
 * and skins just those with the current bone matrices: a few thousand
 * multiply-adds, enough to find the lowest point (the ground clamp) and the
 * on-screen silhouette (the aura's box) to within a pixel or two.
 */

import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';

const SAMPLES_PER_MESH = 700;

interface Sample { pos: Float32Array; idx: Float32Array | null; wgt: Float32Array | null }

/** Every n-th vertex of a mesh, with its skin weights. */
function sampleVertices(mesh: AbstractMesh): Sample {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const idx = mesh.getVerticesData(VertexBuffer.MatricesIndicesKind);
  const wgt = mesh.getVerticesData(VertexBuffer.MatricesWeightsKind);
  if (!pos) return { pos: new Float32Array(0), idx: null, wgt: null };
  const n = pos.length / 3;
  const step = Math.max(1, Math.floor(n / SAMPLES_PER_MESH));
  const m = Math.ceil(n / step);
  const out: Sample = { pos: new Float32Array(m * 3), idx: idx ? new Float32Array(m * 4) : null, wgt: wgt ? new Float32Array(m * 4) : null };
  for (let k = 0, v = 0; v < n; k++, v += step) {
    out.pos.set([pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]], k * 3);
    if (idx && out.idx) out.idx.set([idx[v * 4], idx[v * 4 + 1], idx[v * 4 + 2], idx[v * 4 + 3]], k * 4);
    if (wgt && out.wgt) out.wgt.set([wgt[v * 4], wgt[v * 4 + 1], wgt[v * 4 + 2], wgt[v * 4 + 3]], k * 4);
  }
  return out;
}

export class SkinSampler {
  private samples: Sample[] | null = null;
  private readonly v = new Vector3();
  private readonly acc = new Vector3();

  constructor(private readonly meshes: AbstractMesh[], private readonly skeleton: Skeleton | null) {}

  /** Call `fn` with each sampled skin point in world space (the vector is reused). */
  forEachPoint(fn: (p: Vector3) => void): void {
    if (!this.samples) this.samples = this.meshes.map(sampleVertices);
    const { v, acc } = this;
    this.meshes.forEach((mesh, mi) => {
      if (!mesh.isEnabled()) return;
      const smp = this.samples![mi];
      const world = mesh.getWorldMatrix();
      const bones = this.skeleton && smp.idx ? this.skeleton.getTransformMatrices(mesh) : null;
      if (!bones) {
        // Not skinned (the stylized fallback): the bounds are exact.
        for (const c of mesh.getBoundingInfo().boundingBox.vectorsWorld) fn(c);
        return;
      }
      const P = smp.pos, I = smp.idx!, W = smp.wgt!;
      for (let k = 0, n = P.length / 3; k < n; k++) {
        acc.setAll(0);
        const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2];
        for (let j = 0; j < 4; j++) {
          const wt = W[k * 4 + j];
          if (wt <= 0) continue;
          const o = I[k * 4 + j] * 16;
          acc.x += wt * (bones[o] * x + bones[o + 4] * y + bones[o + 8] * z + bones[o + 12]);
          acc.y += wt * (bones[o + 1] * x + bones[o + 5] * y + bones[o + 9] * z + bones[o + 13]);
          acc.z += wt * (bones[o + 2] * x + bones[o + 6] * y + bones[o + 10] * z + bones[o + 14]);
        }
        Vector3.TransformCoordinatesToRef(acc, world, v);
        fn(v);
      }
    });
  }

  /** How many sampled points there are (over every mesh). */
  count(): number {
    if (!this.samples) this.samples = this.meshes.map(sampleVertices);
    return this.samples.reduce((n, s) => n + s.pos.length / 3, 0);
  }

  /** Sampled point `i` (0 ≤ i < count()) in world space this frame, into `out`; false if its mesh is hidden. */
  pointAt(i: number, out: Vector3): boolean {
    if (!this.samples) this.samples = this.meshes.map(sampleVertices);
    let mi = 0;
    while (mi < this.samples.length && i >= this.samples[mi].pos.length / 3) { i -= this.samples[mi].pos.length / 3; mi++; }
    const mesh = this.meshes[mi], smp = this.samples[mi];
    if (!mesh || !mesh.isEnabled()) return false;
    const P = smp.pos, x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const bones = this.skeleton && smp.idx ? this.skeleton.getTransformMatrices(mesh) : null;
    const acc = this.acc;
    if (!bones) acc.set(x, y, z);
    else {
      acc.setAll(0);
      const I = smp.idx!, W = smp.wgt!;
      for (let j = 0; j < 4; j++) {
        const wt = W[i * 4 + j];
        if (wt <= 0) continue;
        const o = I[i * 4 + j] * 16;
        acc.x += wt * (bones[o] * x + bones[o + 4] * y + bones[o + 8] * z + bones[o + 12]);
        acc.y += wt * (bones[o + 1] * x + bones[o + 5] * y + bones[o + 9] * z + bones[o + 13]);
        acc.z += wt * (bones[o + 2] * x + bones[o + 6] * y + bones[o + 10] * z + bones[o + 14]);
      }
    }
    Vector3.TransformCoordinatesToRef(acc, mesh.getWorldMatrix(), out);
    return true;
  }

  /** The lowest world Y of the skin this frame. */
  lowestY(): number {
    let lo = Infinity;
    this.forEachPoint((p) => { if (p.y < lo) lo = p.y; });
    return lo;
  }
}

/**
 * Every vertex skinned mostly to some bones (all of them, not a sample), for
 * an exact lowest point: a Pokémon's feet, which must touch the ground.
 */
export class VertexSubset {
  private readonly parts: { mesh: AbstractMesh; pos: Float32Array; idx: Float32Array; wgt: Float32Array }[] = [];
  readonly size: number;

  constructor(meshes: AbstractMesh[], private readonly skeleton: Skeleton, bones: ReadonlySet<number>, minWeight = 0.5) {
    let size = 0;
    for (const mesh of meshes) {
      const P = mesh.getVerticesData(VertexBuffer.PositionKind);
      const I = mesh.getVerticesData(VertexBuffer.MatricesIndicesKind);
      const W = mesh.getVerticesData(VertexBuffer.MatricesWeightsKind);
      if (!P || !I || !W) continue;
      const keep: number[] = [];
      for (let k = 0; k < P.length / 3; k++) {
        let w = 0;
        for (let j = 0; j < 4; j++) if (bones.has(I[k * 4 + j])) w += W[k * 4 + j];
        if (w >= minWeight) keep.push(k);
      }
      if (!keep.length) continue;
      const pos = new Float32Array(keep.length * 3), idx = new Float32Array(keep.length * 4), wgt = new Float32Array(keep.length * 4);
      keep.forEach((k, n) => {
        pos.set([P[k * 3], P[k * 3 + 1], P[k * 3 + 2]], n * 3);
        idx.set([I[k * 4], I[k * 4 + 1], I[k * 4 + 2], I[k * 4 + 3]], n * 4);
        wgt.set([W[k * 4], W[k * 4 + 1], W[k * 4 + 2], W[k * 4 + 3]], n * 4);
      });
      this.parts.push({ mesh, pos, idx, wgt });
      size += keep.length;
    }
    this.size = size;
  }

  /** The lowest world Y of these vertices this frame (Infinity if none). */
  lowestY(): number {
    let lo = Infinity;
    const acc = new Vector3(), v = new Vector3();
    // (Hidden meshes count too: an evolving Pokémon's next form must already
    // stand right when it is revealed.)
    for (const { mesh, pos, idx, wgt } of this.parts) {
      const M = this.skeleton.getTransformMatrices(mesh);
      const world = mesh.getWorldMatrix();
      for (let k = 0; k < pos.length / 3; k++) {
        const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2];
        acc.setAll(0);
        for (let j = 0; j < 4; j++) {
          const wt = wgt[k * 4 + j];
          if (wt <= 0) continue;
          const o = idx[k * 4 + j] * 16;
          acc.x += wt * (M[o] * x + M[o + 4] * y + M[o + 8] * z + M[o + 12]);
          acc.y += wt * (M[o + 1] * x + M[o + 5] * y + M[o + 9] * z + M[o + 13]);
          acc.z += wt * (M[o + 2] * x + M[o + 6] * y + M[o + 10] * z + M[o + 14]);
        }
        Vector3.TransformCoordinatesToRef(acc, world, v);
        if (v.y < lo) lo = v.y;
      }
    }
    return lo;
  }
}
