/**
 * Static batching: a level's static scenery merged into few meshes, so it draws in few calls — the main cost in a scene
 * of many small pieces (furniture, books, flowers, rocks, trees), each otherwise its own draw (and its own again into
 * the shadow map). Pieces are grouped by where they stand along the level (chunks, so range culling still has
 * something to cull), by their material, by their vertex layout, and by whether they're floor (so the floor rule's
 * name still holds); each group merged into one mesh, casting a shadow if any of its pieces did.
 *
 * Also: merging pieces of several materials into one draw per material (not one per piece).
 */
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Material } from '@babylonjs/core/Materials/material';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial';

/** Pieces of any materials merged into one mesh per material (each one draw), not one sub-draw per piece. */
export function mergeByMaterial(parts: Mesh[], name: string): Mesh[] {
  const groups = new Map<string, Mesh[]>();
  for (const p of parts) {
    const key = `${p.material?.uniqueId ?? 'none'}|${p.getVerticesDataKinds().sort().join(',')}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
  }
  const out: Mesh[] = [];
  for (const g of groups.values()) {
    const mat = g[0].material;
    const m = g.length === 1 ? g[0] : Mesh.MergeMeshes(g, true, true)!;
    m.name = name; m.material = mat;
    out.push(m);
  }
  return out;
}

export interface BatchOptions {
  /** How long a chunk runs along the level (x). */
  chunk: number;
  /** Pieces never batched: they move, toggle, fade on their own, or are looked up by name. */
  exclude: RegExp;
  /** The floor rule's names (a group of floor pieces keeps one such name). */
  floors: RegExp;
  /** Pieces (not floors) standing nearer the camera than this z are left alone: they're what may come between the
   *  eye and the player and be faded — merged, a whole chunk of scenery would fade with them. */
  frontZ?: number;
}

/** Batch `root`'s static scenery. Returns how many meshes went in, how many came out. */
export function batchStatic(scene: Scene, root: TransformNode, o: BatchOptions): { before: number; after: number } {
  const shadowGen = (scene.metadata as { shadowGen?: { getShadowMap(): { renderList: AbstractMesh[] | null }; addShadowCaster(m: AbstractMesh): void; removeShadowCaster(m: AbstractMesh): void } } | undefined)?.shadowGen;
  const casters = new Set(shadowGen?.getShadowMap().renderList ?? []);
  const groups = new Map<string, { parts: Mesh[]; shadow: boolean; floor: boolean; parent: TransformNode | null }>();
  let before = 0;
  for (const m of root.getChildMeshes(false)) {
    if (!(m instanceof Mesh) || o.exclude.test(m.name)) continue;
    // (Only plain static pieces: drawn, no thin instances, no skeleton, no children, not an instance's source, one material.)
    if (!m.isVisible || !m.isEnabled() || m.skeleton || m.thinInstanceCount > 0 || m.getChildren().length || m.instances.length) continue;
    if (!m.material || m.material instanceof MultiMaterial || m.getTotalVertices() === 0 || m.visibility < 1) continue;
    m.computeWorldMatrix(true);
    const c = m.getBoundingInfo().boundingBox.centerWorld;
    const floor = o.floors.test(m.name);
    if (!floor && o.frontZ !== undefined && m.getBoundingInfo().boundingBox.minimumWorld.z < o.frontZ) continue;
    const key = `${Math.floor(c.x / o.chunk)}|${(m.material as Material).uniqueId}|${m.getVerticesDataKinds().sort().join(',')}|${floor}|${m.receiveShadows}`;
    const g = groups.get(key) ?? groups.set(key, { parts: [], shadow: false, floor, parent: m.parent as TransformNode | null }).get(key)!;
    g.parts.push(m); g.shadow ||= casters.has(m);
    before++;
  }
  let after = 0;
  for (const g of groups.values()) {
    if (g.parts.length < 2) { after += g.parts.length; continue; }
    for (const p of g.parts) shadowGen?.removeShadowCaster(p);
    const mat = g.parts[0].material, recv = g.parts[0].receiveShadows;
    const merged = Mesh.MergeMeshes(g.parts, true, true)!;
    merged.name = g.floor ? 'batchFloor' : 'batchProps';
    merged.material = mat; merged.parent = root; merged.isPickable = false; merged.receiveShadows = recv;
    if (g.shadow) shadowGen?.addShadowCaster(merged);
    after++;
  }
  return { before, after };
}
