/**
 * Stylized low-poly trees, built the way stylized-foliage artists build them:
 *
 *  - a round trunk with a root flare and a slight bend, its branches spiralling out round it (golden angle) and up;
 *  - its canopy clumps of faceted leaf balls, one at each branch's end and a few filling the crown — their facets
 *    jittered ("bushiness": a ragged silhouette), their undersides flattened;
 *  - the canopy's normals projected from the crown's whole volume (an ellipsoid round it), blended a little with each
 *    facet's own — so it shades soft and round, as one fluffy mass, while its outline stays faceted;
 *  - coloured by its vertices: lighter up top and out at the crown's skin, darker underneath and deep inside (a cheap
 *    ambient occlusion), each clump a slightly different green.
 *
 * Kinds: 'round' (a broadleaf — Pallet Town's own), 'pine' (tiers of drooping, ragged skirts), 'poplar' (tall, narrow).
 * Each tree one mesh (its parts merged) wearing `treeMaterial` (vertex colours).
 */
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

export type TreeKind = 'round' | 'pine' | 'poplar';
type RGB = [number, number, number];

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** How much of a canopy's normal is the crown's (the rest its facet's own). */
const CROWN_NORMAL = 0.88;
const BARK: RGB = [0.43, 0.29, 0.18];

/** The material every tree wears: its colours its vertices'. */
export function treeMaterial(scene: Scene): StandardMaterial {
  const m = new StandardMaterial('lowPolyTree', scene);
  m.diffuseColor = new Color3(1, 1, 1);
  m.emissiveColor = new Color3(0.3, 0.3, 0.3);
  m.specularColor = new Color3(0.02, 0.02, 0.02);
  return m;
}

/** A seeded random in [0, 1). */
export function seeded(seed: number): () => number {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

/** A value from a position (the same where two faces share a corner: their seams stay closed). */
const hash = (x: number, y: number, z: number) => {
  const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return h - Math.floor(h);
};

/** Its transform baked into its vertices (so its parts can be reshaped and merged in the tree's own space). */
function bake(m: Mesh): Mesh { m.bakeCurrentTransformIntoVertices(); return m; }

function colour(m: Mesh, at: (p: Vector3, n: Vector3) => RGB) {
  const pos = m.getVerticesData(VertexBuffer.PositionKind)!, nor = m.getVerticesData(VertexBuffer.NormalKind)!;
  const cols = new Float32Array((pos.length / 3) * 4);
  const p = new Vector3(), n = new Vector3();
  for (let i = 0, j = 0; i < pos.length; i += 3, j += 4) {
    p.set(pos[i], pos[i + 1], pos[i + 2]); n.set(nor[i], nor[i + 1], nor[i + 2]);
    const c = at(p, n);
    cols[j] = c[0]; cols[j + 1] = c[1]; cols[j + 2] = c[2]; cols[j + 3] = 1;
  }
  m.setVerticesData(VertexBuffer.ColorKind, cols);
}

/** A tube along `path`, `r(t)` its radius (t 0 at its foot, 1 at its tip), its bark coloured, darker at its foot. */
function limb(scene: Scene, path: Vector3[], r: (t: number) => number, sides = 7): Mesh {
  const tube = MeshBuilder.CreateTube('limb', { path, radiusFunction: (i) => r(i / (path.length - 1)), tessellation: sides, cap: Mesh.CAP_END }, scene);
  const y0 = path[0].y, y1 = path[path.length - 1].y;
  colour(tube, (p) => {
    const t = Math.min(1, Math.max(0, (p.y - y0) / Math.max(0.01, y1 - y0)));
    const k = (0.75 + 0.35 * t) * (0.95 + hash(p.x, p.y, p.z) * 0.1);
    return [BARK[0] * k, BARK[1] * k, BARK[2] * k];
  });
  return tube;
}

/** A trunk: from the ground up `h`, bending a little, its foot flared into roots. */
function trunk(scene: Scene, h: number, r0: number, r1: number, rand: () => number, segs = 6, bend = 0.25) {
  const lean = new Vector3((rand() - 0.5) * bend, 0, (rand() - 0.5) * bend);
  const path = Array.from({ length: segs + 1 }, (_, i) => {
    const t = i / segs;
    return new Vector3(lean.x * h * t * t, h * t, lean.z * h * t * t);
  });
  const mesh = limb(scene, path, (t) => r1 + (r0 - r1) * (1 - t) + r0 * 0.9 * Math.pow(Math.max(0, 1 - t * 5), 2), 8);
  return { mesh, path };
}

/**
 * A clump of leaves: a faceted ball, `r` across-ish, its facets jittered, its underside flattened, at `c`; its normals
 * the crown's (`crown`, `radii`), its colours by where it sits in the crown.
 */
function clump(scene: Scene, c: Vector3, r: number, crown: Vector3, radii: Vector3, green: RGB, rand: () => number, detail = 1): Mesh {
  const ball = MeshBuilder.CreateIcoSphere('clump', { radius: r, subdivisions: detail, flat: true, updatable: true }, scene);
  ball.rotation.set(rand() * 6, rand() * 6, rand() * 6);
  ball.scaling.set(1 + (rand() - 0.5) * 0.25, 0.82 + rand() * 0.12, 1 + (rand() - 0.5) * 0.25);
  ball.position.copyFrom(c);
  bake(ball);
  const pos = ball.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < pos.length; i += 3) {
    const dx = pos[i] - c.x, dy = pos[i + 1] - c.y, dz = pos[i + 2] - c.z;
    const k = 1 + (hash(pos[i], pos[i + 1], pos[i + 2]) - 0.5) * 0.42;
    // (Its underside flattened: a stylized canopy sits on a flatter base.)
    const flat = dy < -r * 0.35 ? -r * 0.35 + (dy + r * 0.35) * 0.35 : dy;
    pos[i] = c.x + dx * k; pos[i + 1] = c.y + flat * k; pos[i + 2] = c.z + dz * k;
  }
  ball.updateVerticesData(VertexBuffer.PositionKind, pos);
  // Its facets' own normals, then blended toward the crown's.
  const nor = ball.getVerticesData(VertexBuffer.NormalKind)!;
  const idx = ball.getIndices()!;
  for (let f = 0; f < idx.length; f += 3) {
    const [a, b, d] = [idx[f] * 3, idx[f + 1] * 3, idx[f + 2] * 3];
    const e1 = new Vector3(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]);
    const e2 = new Vector3(pos[d] - pos[a], pos[d + 1] - pos[a + 1], pos[d + 2] - pos[a + 2]);
    // (Babylon winds its faces clockwise: its outward normal e2 × e1.)
    const fn = Vector3.Cross(e2, e1).normalize();
    if (fn.x * (pos[a] - c.x) + fn.y * (pos[a + 1] - c.y) + fn.z * (pos[a + 2] - c.z) < 0) fn.scaleInPlace(-1);
    for (const v of [a, b, d]) {
      const cn = new Vector3((pos[v] - crown.x) / (radii.x * radii.x), (pos[v + 1] - crown.y) / (radii.y * radii.y), (pos[v + 2] - crown.z) / (radii.z * radii.z)).normalize();
      const n = cn.scale(CROWN_NORMAL).addInPlace(fn.scale(1 - CROWN_NORMAL)).normalize();
      nor[v] = n.x; nor[v + 1] = n.y; nor[v + 2] = n.z;
    }
  }
  ball.updateVerticesData(VertexBuffer.NormalKind, nor);
  const shade = 0.92 + rand() * 0.16;
  colour(ball, (p, n) => {
    // How far out in the crown (0 its heart, 1 its skin), how high; facing up or down.
    const out = Math.min(1, Math.hypot((p.x - crown.x) / radii.x, (p.y - crown.y) / radii.y, (p.z - crown.z) / radii.z));
    const up = (p.y - (crown.y - radii.y)) / (2 * radii.y);
    const k = shade * (0.55 + 0.35 * out + 0.25 * up + 0.12 * n.y) * (0.94 + hash(p.x, p.z, p.y) * 0.12);
    // (Its sunlit top a touch yellower.)
    const warm = Math.max(0, up - 0.6) * 0.25;
    return [green[0] * k + warm * 0.25, green[1] * k + warm * 0.12, green[2] * k];
  });
  return ball;
}

/** A broadleaf: a flared trunk, branches spiralling out of its top half, a clump at each one's end, more filling the crown. */
function roundTree(scene: Scene, s: number, rand: () => number): Mesh[] {
  const parts: Mesh[] = [];
  const h = (1.5 + rand() * 0.4) * s;
  const t = trunk(scene, h, 0.2 * s, 0.1 * s, rand);
  parts.push(t.mesh);
  const top = t.path[t.path.length - 1];
  const crown = top.add(new Vector3(0, 0.75 * s, 0)), radii = new Vector3(1.35 * s, 1.05 * s, 1.35 * s);
  const green: RGB = rand() < 0.5 ? [0.3, 0.6, 0.27] : [0.24, 0.55, 0.25];
  const branches = 5 + Math.floor(rand() * 2);
  const ends: Vector3[] = [];
  for (let i = 0; i < branches; i++) {
    const a = i * GOLDEN * 2 + rand() * 0.6, from = 0.55 + (i / branches) * 0.4;
    const base = t.path[Math.round(from * (t.path.length - 1))];
    const reach = (0.7 + rand() * 0.35) * s, rise = (0.5 + rand() * 0.5) * s;
    const end = base.add(new Vector3(Math.cos(a) * reach, rise, Math.sin(a) * reach));
    const mid = Vector3.Lerp(base, end, 0.5).add(new Vector3(0, 0.15 * s, 0));
    parts.push(limb(scene, [base, mid, end], (u) => (0.07 - 0.045 * u) * s, 5));
    ends.push(end);
  }
  for (const e of ends) parts.push(clump(scene, e, (0.66 + rand() * 0.2) * s, crown, radii, green, rand));
  // (The crown filled: its heart, its top, a few between.)
  parts.push(clump(scene, crown.add(new Vector3(0, 0.1 * s, 0)), 0.8 * s, crown, radii, green, rand));
  parts.push(clump(scene, crown.add(new Vector3((rand() - 0.5) * 0.3 * s, 0.7 * s, (rand() - 0.5) * 0.3 * s)), 0.6 * s, crown, radii, green, rand));
  for (let i = 0; i < 3; i++) {
    const a = rand() * Math.PI * 2;
    parts.push(clump(scene, crown.add(new Vector3(Math.cos(a) * 0.7 * s, (0.2 + rand() * 0.4) * s, Math.sin(a) * 0.7 * s)), (0.5 + rand() * 0.15) * s, crown, radii, green, rand));
  }
  return parts;
}

/** A tall, narrow broadleaf: its clumps stacked up a straight trunk. */
function poplarTree(scene: Scene, s: number, rand: () => number): Mesh[] {
  const parts: Mesh[] = [];
  const h = (1.1 + rand() * 0.3) * s;
  const t = trunk(scene, h + 2.2 * s, 0.17 * s, 0.05 * s, rand, 8);
  parts.push(t.mesh);
  const crown = new Vector3(0, h + 1.5 * s, 0), radii = new Vector3(0.75 * s, 1.9 * s, 0.75 * s);
  const green: RGB = [0.22, 0.5, 0.24];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1), a = i * GOLDEN * 2;
    const r = (0.5 + Math.sin(u * Math.PI) * 0.25) * s;
    const c = new Vector3(Math.cos(a) * 0.2 * s, h + 0.2 * s + u * 2.7 * s, Math.sin(a) * 0.2 * s);
    parts.push(clump(scene, c, r, crown, radii, green, rand));
  }
  return parts;
}

/**
 * A pine: a straight trunk under tiers of skirts — each a ragged cone (its rim alternately long and short, its long
 * points drooping), its underside hollowed, twisted from the one below; shaded as one cone, lighter toward each tier's top.
 */
function pineTree(scene: Scene, s: number, rand: () => number): Mesh[] {
  const parts: Mesh[] = [];
  const tiers = 5 + Math.floor(rand() * 2);
  // (A pine stands straight; its trunk ends inside its top tier.)
  const t = trunk(scene, (0.95 + (tiers - 1) * 0.55 + 0.25) * s, 0.18 * s, 0.05 * s, rand, 6, 0);
  parts.push(t.mesh);
  const baseY = 0.95 * s, height = tiers * 0.55 * s + 0.6 * s;
  const green: RGB = rand() < 0.5 ? [0.16, 0.45, 0.24] : [0.13, 0.4, 0.22];
  const points = 9;
  for (let k = 0; k < tiers; k++) {
    const u = k / (tiers - 1);
    const r = (1.25 - u * 0.85) * s, hgt = (0.95 - u * 0.3) * s, y = baseY + k * 0.55 * s;
    const cone = MeshBuilder.CreateCylinder('skirt', { height: hgt, diameterTop: k === tiers - 1 ? 0 : r * 0.5, diameterBottom: 2 * r,
      tessellation: points * 2, updatable: true }, scene);
    cone.rotation.y = k * 0.9 + rand();
    cone.position.set(0, y + hgt / 2, 0);
    const pos = cone.getVerticesData(VertexBuffer.PositionKind)!;
    for (let i = 0; i < pos.length; i += 3) {
      const rr = Math.hypot(pos[i], pos[i + 2]);
      if (pos[i + 1] < -hgt / 2 + 1e-4) {
        if (rr < 1e-4) { pos[i + 1] += hgt * 0.4; continue; } // (its underside hollowed up into it)
        const a = Math.atan2(pos[i + 2], pos[i]);
        const step = Math.round(((a + Math.PI) / (2 * Math.PI)) * points * 2);
        const long = step % 2 === 0;
        const f = long ? 1 + hash(step, k, 1) * 0.12 : 0.72;
        pos[i] *= f; pos[i + 2] *= f;
        pos[i + 1] -= long ? hgt * 0.18 : 0; // (its long points drooping)
      }
    }
    cone.updateVerticesData(VertexBuffer.PositionKind, pos);
    bake(cone);
    // Its normals: the whole tree's cone (out and up), a little of the facet's.
    const p2 = cone.getVerticesData(VertexBuffer.PositionKind)!, n2 = cone.getVerticesData(VertexBuffer.NormalKind)!;
    const slope = (2 * 1.25 * s) / height;
    for (let i = 0; i < p2.length; i += 3) {
      const rr = Math.hypot(p2[i], p2[i + 2]) || 1;
      const cn = new Vector3(p2[i] / rr, slope * 0.8, p2[i + 2] / rr).normalize();
      const fn = new Vector3(n2[i], n2[i + 1], n2[i + 2]);
      const n = cn.scale(0.7).addInPlace(fn.scale(0.3)).normalize();
      n2[i] = n.x; n2[i + 1] = n.y; n2[i + 2] = n.z;
    }
    cone.updateVerticesData(VertexBuffer.NormalKind, n2);
    const shade = 0.92 + rand() * 0.14;
    colour(cone, (p, n) => {
      const inTier = (p.y - y) / hgt, up = (p.y - baseY) / height;
      const k2 = shade * (0.6 + 0.3 * inTier + 0.25 * up + 0.1 * n.y) * (0.94 + hash(p.x, p.z, p.y) * 0.12);
      return [green[0] * k2, green[1] * k2, green[2] * k2];
    });
    parts.push(cone);
  }
  return parts;
}

/** A tree of `kind`, `s` its scale (≈ 1: about 4–5 m tall), at its foot's origin; one mesh. */
export function lowPolyTree(scene: Scene, kind: TreeKind, s: number, seed: number): Mesh {
  const rand = seeded(seed * 7919 + 13);
  const parts = kind === 'pine' ? pineTree(scene, s, rand) : kind === 'poplar' ? poplarTree(scene, s, rand) : roundTree(scene, s, rand);
  const tree = Mesh.MergeMeshes(parts, true, true)!;
  tree.name = `tree_${kind}`;
  tree.rotation.y = rand() * Math.PI * 2;
  return tree;
}

/**
 * A bark tube along `path` (a trunk, a root, a limb): `r(t)` its radius from its foot (t 0) to its tip (1), bark
 * coloured, darker at its foot.
 */
export function barkTube(scene: Scene, path: Vector3[], r: (t: number) => number, sides = 10): Mesh {
  return limb(scene, path, r, sides);
}

/**
 * A clump of leaves (a faceted ball, `r` across-ish, at `c`) shaded as part of a crown round `crown` (`radii`): soft
 * and round as one mass, its outline faceted. Its green `green`.
 */
export function leafClump(scene: Scene, c: Vector3, r: number, crown: Vector3, radii: Vector3, green: [number, number, number], seed: number): Mesh {
  return clump(scene, c, r, crown, radii, green, seeded(seed), 1);
}

export interface BarkLook {
  /** How many ridges round it; how deep its furrows (× its radius). */
  ridges?: number; depth?: number;
  /** Moss up from its foot (how high, as a share of its length), and on what faces up. */
  moss?: number;
  /** Knots: how many. */
  knots?: number;
  seed?: number;
}

/**
 * A bark tube with real grain: `path` resampled fine (rings up it), its surface carved into ridges and furrows that
 * wander as they climb (cut deeper where they're furrows, a few knots swelling out), coloured as wood — dark in the
 * furrows, warm on the ridges, streaked along its length, moss settled up its foot and on whatever faces up.
 */
export function barkWood(scene: Scene, path: Vector3[], r: (t: number) => number, sides = 24, o: BarkLook = {}): Mesh {
  const ridges = o.ridges ?? 9, depth = o.depth ?? 0.16, mossUp = o.moss ?? 0.18, seed = o.seed ?? 1;
  // (Its path resampled: rings close enough for the grain to wander.)
  const fine: Vector3[] = [];
  const rings = Math.max(6, Math.round(path.reduce((a, p, i) => (i ? a + p.subtract(path[i - 1]).length() : 0), 0) / 0.55));
  for (let k = 0; k <= rings; k++) {
    const u = (k / rings) * (path.length - 1), i = Math.min(path.length - 2, Math.floor(u)), f = u - i;
    fine.push(Vector3.Lerp(path[i], path[i + 1], f));
  }
  const tube = MeshBuilder.CreateTube('bark', { path: fine, radiusFunction: (i) => r(i / rings), tessellation: sides, cap: Mesh.CAP_END, updatable: true }, scene);
  const pos = tube.getVerticesData(VertexBuffer.PositionKind)!;
  const per = sides + 1;
  const knots = Array.from({ length: o.knots ?? 3 }, (_, k) => ({ t: 0.25 + ((k * 0.37 + seed * 0.13) % 0.6), a: (k * 2.39 + seed) % (Math.PI * 2) }));
  const grain: number[] = [];
  for (let v = 0; v < pos.length / 3; v++) {
    const ring = Math.min(rings, Math.floor(v / per)), j = v % per, t = ring / rings;
    const c = fine[ring], p = new Vector3(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    const off = p.subtract(c);
    // Its grain round it: ridges wandering as they climb (a slow sway, a little noise); furrows cut in between.
    const a = (j / sides) * Math.PI * 2;
    const sway = Math.sin(t * 5 + seed) * 0.35 + Math.sin(t * 13 + seed * 2) * 0.12;
    const g = Math.pow(Math.abs(Math.cos((a + sway) * ridges * 0.5)), 0.6);
    let k = 1 - depth + depth * g * 1.2 + (hash(ring, j, seed) - 0.5) * 0.04;
    // (Knots: a swelling here and there.)
    for (const kn of knots) {
      const da = Math.atan2(Math.sin(a - kn.a), Math.cos(a - kn.a)), dt = (t - kn.t) * 6;
      k += 0.18 * Math.exp(-(da * da * 5 + dt * dt * 3));
    }
    off.scaleInPlace(k);
    pos[v * 3] = c.x + off.x; pos[v * 3 + 1] = c.y + off.y; pos[v * 3 + 2] = c.z + off.z;
    grain.push(g);
  }
  // Faceted, low-poly: every face flat, its own colour — a furrow's face dark, a ridge's warm, streaked along it; moss
  // on a face here and there at its foot, and on faces turned straight up. (Not blended vertex to vertex: no blur.)
  const idx = tube.getIndices()!;
  const FURROW: [number, number, number] = [0.17, 0.1, 0.06], RIDGE: [number, number, number] = [0.52, 0.35, 0.21], MOSS: [number, number, number] = [0.3, 0.5, 0.22];
  const P: number[] = [], N: number[] = [], Cc: number[] = [], I: number[] = [];
  for (let f = 0; f < idx.length; f += 3) {
    const vs = [idx[f], idx[f + 1], idx[f + 2]];
    const a = new Vector3(pos[vs[0] * 3], pos[vs[0] * 3 + 1], pos[vs[0] * 3 + 2]);
    const b = new Vector3(pos[vs[1] * 3], pos[vs[1] * 3 + 1], pos[vs[1] * 3 + 2]);
    const c = new Vector3(pos[vs[2] * 3], pos[vs[2] * 3 + 1], pos[vs[2] * 3 + 2]);
    let n = Vector3.Cross(c.subtract(a), b.subtract(a)).normalize();
    const mid = a.add(b).add(c).scale(1 / 3), axis = fine[Math.min(rings, Math.floor(vs[0] / per))];
    if (Vector3.Dot(n, mid.subtract(axis)) < 0) n = n.scale(-1);
    // (Coloured by its quad — both its triangles alike — so the bark reads as flutes, not a checkerboard.)
    const rs = vs.map((v) => Math.floor(v / per)), js = vs.map((v) => v % per);
    const cr = Math.min(rings - 1, Math.min(...rs)), cj = Math.max(...js) - Math.min(...js) > 1 ? Math.max(...js) : Math.min(...js);
    const cell = (rr: number, jj: number) => grain[Math.min(rings, rr) * per + Math.min(sides, jj)] ?? 0.5;
    const g = (cell(cr, cj) + cell(cr, cj + 1) + cell(cr + 1, cj) + cell(cr + 1, cj + 1)) / 4, t = cr / rings, j = cj;
    const ring = cr, streak = 0.88 + hash(j, Math.floor(ring / 3), seed) * 0.24;
    let col = [0, 1, 2].map((i) => (FURROW[i] + (RIDGE[i] - FURROW[i]) * Math.pow(g, 1.3)) * streak) as [number, number, number];
    if ((t < mossUp * (0.4 + hash(j, 7, seed) * 0.7) && g > 0.6 && hash(ring, j, seed + 5) < 0.3) || (n.y > 0.88 && g > 0.65 && hash(ring, j, seed + 3) < 0.25)) {
      col = MOSS.map((m) => m * (0.85 + hash(ring, j + 1, seed) * 0.3)) as [number, number, number];
    }
    for (const p of [a, b, c]) { P.push(p.x, p.y, p.z); N.push(n.x, n.y, n.z); Cc.push(col[0], col[1], col[2], 1); I.push(I.length); }
  }
  const vd = new VertexData();
  vd.positions = P; vd.normals = N; vd.colors = Cc; vd.indices = I;
  vd.uvs = new Array((P.length / 3) * 2).fill(0);
  const bark = new Mesh('bark', scene);
  vd.applyToMesh(bark);
  tube.dispose();
  return bark;
}
