/**
 * A low-poly kit for buildings and furniture, after stylized-environment practice:
 *
 *  - bevelled (chamfered) boxes — every edge cut, every corner a small facet — so nothing reads as flat cardboard,
 *    each edge catching a sliver of light (flat-shaded: the facets stay crisp, low-poly);
 *  - (the rest built of them: shingled roofs, panelled walls, furniture — palletTown.ts.)
 */
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Material } from '@babylonjs/core/Materials/material';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

/**
 * A box `w` × `h` × `d`, centred on its origin, its every edge chamfered by `bevel` (clamped to under half its least
 * side): 6 faces, 12 edge strips, 8 corner facets — flat-shaded.
 */
export function bevelBox(name: string, scene: Scene, w: number, h: number, d: number, bevel: number): Mesh {
  const half = [w / 2, h / 2, d / 2];
  const b = Math.max(0, Math.min(bevel, Math.min(w, h, d) * 0.45));
  // A corner's three points (signs sx, sy, sz): its point on the x-face, on the y-face, on the z-face.
  const pt = (s: number[], axis: number) => {
    const p = [0, 1, 2].map((k) => s[k] * (k === axis ? half[k] : half[k] - b));
    return new Vector3(p[0], p[1], p[2]);
  };
  const signs: number[][] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) signs.push([sx, sy, sz]);
  const polys: Vector3[][] = [];
  // The six faces: the four corners on that side, each one's point on it.
  for (let axis = 0; axis < 3; axis++) for (const side of [-1, 1]) polys.push(signs.filter((s) => s[axis] === side).map((s) => pt(s, axis)));
  // The twelve edge strips: along `along`, between faces `a` and `c` — the two corners' points on each.
  for (let along = 0; along < 3; along++) {
    const [a, c] = [0, 1, 2].filter((k) => k !== along);
    for (const sa of [-1, 1]) for (const sc of [-1, 1]) {
      const cs = signs.filter((s) => s[a] === sa && s[c] === sc);
      polys.push([pt(cs[0], a), pt(cs[0], c), pt(cs[1], c), pt(cs[1], a)]);
    }
  }
  // The eight corner facets.
  for (const s of signs) polys.push([pt(s, 0), pt(s, 1), pt(s, 2)]);

  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (const poly of polys) {
    const c = poly.reduce((acc, p) => acc.addInPlace(p), new Vector3()).scaleInPlace(1 / poly.length);
    // Its outward normal (the box is convex round its centre: the polygon's centre points out).
    let n = Vector3.Cross(poly[1].subtract(poly[0]), poly[2].subtract(poly[0]));
    if (n.lengthSquared() < 1e-12 && poly.length > 3) n = Vector3.Cross(poly[2].subtract(poly[0]), poly[3].subtract(poly[0]));
    if (n.lengthSquared() < 1e-12) continue; // (a facet of no size: no bevel there)
    n.normalize();
    if (Vector3.Dot(n, c) < 0) n.scaleInPlace(-1);
    // Its points in order round it (by angle about its normal), a fan of triangles.
    const u = poly[0].subtract(c).normalize(), v = Vector3.Cross(n, u);
    const sorted = [...poly].sort((p, q) => {
      const ap = Math.atan2(Vector3.Dot(p.subtract(c), v), Vector3.Dot(p.subtract(c), u));
      const aq = Math.atan2(Vector3.Dot(q.subtract(c), v), Vector3.Dot(q.subtract(c), u));
      return ap - aq;
    });
    const base = positions.length / 3;
    // (Its UVs projected off its dominant axis — so it can be textured, and merged with meshes that carry UVs.)
    const ax = Math.abs(n.x) > Math.abs(n.y) && Math.abs(n.x) > Math.abs(n.z) ? 0 : Math.abs(n.y) > Math.abs(n.z) ? 1 : 2;
    for (const p of sorted) {
      positions.push(p.x, p.y, p.z); normals.push(n.x, n.y, n.z);
      uvs.push(ax === 0 ? p.z : p.x, ax === 1 ? p.z : p.y);
    }
    // (Babylon's front faces wind clockwise as seen: counter-clockwise about the normal, reversed.)
    for (let i = 1; i < sorted.length - 1; i++) indices.push(base, base + i + 1, base + i);
  }
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = positions; vd.normals = normals; vd.uvs = uvs; vd.indices = indices;
  vd.applyToMesh(mesh);
  return mesh;
}

export interface BookLook {
  cover: Material; pages: Material; band: Material; label: Material;
  /** Its spine's style: 0 two bands and a label, 1 a band top and bottom only, 2 a label only. */
  style?: number;
}

/**
 * A book standing on its foot, `w` thick, `h` tall, `d` deep, its spine toward −z: its two boards (a touch proud of
 * its pages all round), its cream page block, its rounded spine, gilt bands across it and a label — parts positioned
 * about `pivot` (its foot's centre), to be merged.
 */
export function bookParts(scene: Scene, pivot: TransformNode, w: number, h: number, d: number, look: BookLook): Mesh[] {
  const parts: Mesh[] = [];
  const ct = Math.min(0.012, w * 0.16), lip = 0.012;
  const add = (m: Mesh, mat: Material) => { m.parent = pivot; m.material = mat; parts.push(m); return m; };
  // Its boards, either side.
  for (const side of [-1, 1]) {
    const b = add(bevelBox('bookBoard', scene, ct, h, d, ct * 0.3), look.cover);
    b.position.set(side * (w / 2 - ct / 2), h / 2, 0);
  }
  // Its pages: inset from the boards' edges top, bottom and fore-edge.
  const pg = add(bevelBox('bookPages', scene, w - 2 * ct, h - 2 * lip, d - lip - 0.006, 0.004), look.pages);
  pg.position.set(0, h / 2, lip / 2);
  // Its spine: rounded out a little past the boards' fronts.
  const sp = add(MeshBuilder.CreateCylinder('bookSpine', { height: h, diameter: w, tessellation: 10, arc: 0.5, enclose: true }, scene), look.cover);
  sp.rotation.y = Math.PI; sp.scaling.z = 0.45; sp.position.set(0, h / 2, -d / 2 + 0.004);
  const face = -d / 2 - w * 0.225 + 0.002;
  const style = look.style ?? 0;
  // Gilt bands across the spine; a label between.
  if (style !== 2) for (const y of [h * 0.12, h * 0.86]) {
    const band = add(MeshBuilder.CreateBox('bookBand', { width: w * 0.9, height: Math.max(0.008, h * 0.035), depth: 0.006 }, scene), look.band);
    band.position.set(0, y, face);
  }
  if (style !== 1) {
    const lab = add(MeshBuilder.CreateBox('bookLabel', { width: w * 0.62, height: h * 0.2, depth: 0.006 }, scene), look.label);
    lab.position.set(0, h * 0.58, face - 0.001);
  }
  return parts;
}
