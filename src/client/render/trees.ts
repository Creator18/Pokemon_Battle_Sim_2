/**
 * Low-poly trees for the board: a stylised pine of faceted, jagged tiers on
 * a thick, tapered trunk. Every tree is its own shape (from a seed): the
 * trunk bends a little and flares at its root; each canopy tier is a cone
 * of TIER_SIDES points with an uneven, drooping rim, twisted and nudged off
 * the axis, shaded darker below and lighter toward the top (vertex colour
 * over the canopy material). Inside the tiers a solid core cone fills the
 * canopy, so the gaps between the jagged rims show leaves, never the trunk.
 * Both flat-shaded, for the facets. In the
 * tree's own units (the board scales it to the tile), its foot at the origin.
 */
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';

/** The trunk: sides, its height, its radius at the root flare, just above it, and at the top. */
const TRUNK_SIDES = 7, TRUNK_H = 0.95, ROOT_R = 0.24, BASE_R = 0.15, TOP_R = 0.095;
/** The canopy: tiers (a range), points round each tier, where it starts up the trunk, and its top. */
const TIERS: [number, number] = [4, 5], TIER_SIDES = 11, CANOPY_FROM = 0.62, CANOPY_TOP = 2.05;
/** The widest (lowest) tier's radius; each tier above narrows toward TIER_NARROW of it. */
const TIER_R = 0.62, TIER_NARROW = 0.38;

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finish(name: string, positions: number[], indices: number[], colors: number[] | null, scene: Scene): Mesh {
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  if (colors) vd.colors = colors;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  vd.normals = normals;
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh, true);
  mesh.convertToFlatShadedMesh();
  return mesh;
}

/** A tree's trunk and canopy meshes (materials and placement are the caller's). */
export function lowPolyTree(name: string, seed: number, scene: Scene): { trunk: Mesh; canopy: Mesh } {
  const rand = rng(seed);
  const span = (lo: number, hi: number) => lo + (hi - lo) * rand();

  // ── Trunk: rings up a slightly bent axis, flared at the root.
  const bendA = rand() * Math.PI * 2, bend = span(0.02, 0.07);
  const axis = (y: number): [number, number] => [Math.cos(bendA) * bend * y * y, Math.sin(bendA) * bend * y * y];
  const rings: [number, number][] = [[0, ROOT_R], [0.12, BASE_R * 1.08], [0.4, BASE_R], [0.75, (BASE_R + TOP_R) / 2], [1, TOP_R]];
  const tp: number[] = [], ti: number[] = [];
  rings.forEach(([f, r]) => {
    const y = f * TRUNK_H, [cx, cz] = axis(f);
    for (let k = 0; k < TRUNK_SIDES; k++) {
      const a = (k / TRUNK_SIDES) * Math.PI * 2 + (f ? span(-0.08, 0.08) : 0);
      // The root flare bulges out unevenly (its roots).
      const rr = r * (f === 0 ? span(0.85, 1.25) : span(0.94, 1.06));
      tp.push(cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr);
    }
  });
  const tAt = (i: number, k: number) => i * TRUNK_SIDES + (k % TRUNK_SIDES);
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < TRUNK_SIDES; k++) ti.push(tAt(i, k), tAt(i + 1, k), tAt(i, k + 1), tAt(i, k + 1), tAt(i + 1, k), tAt(i + 1, k + 1));
  }
  const trunk = finish(`${name}_trunk`, tp, ti, null, scene);

  // ── Canopy: jagged tiers, overlapping, narrowing up to the top.
  const cp: number[] = [], ci: number[] = [], cc: number[] = [];
  const tiers = Math.round(span(TIERS[0], TIERS[1]));
  const [topX, topZ] = axis(1);
  const step = (CANOPY_TOP - CANOPY_FROM) / (tiers + 0.6);
  for (let t = 0; t < tiers; t++) {
    const u = t / Math.max(1, tiers - 1);
    const baseY = CANOPY_FROM + t * step * span(0.92, 1.05);
    const tipY = t === tiers - 1 ? CANOPY_TOP : baseY + step * span(1.7, 2.1);
    const r = TIER_R * (1 - (1 - TIER_NARROW) * u) * span(0.9, 1.08);
    const twist = rand() * Math.PI * 2;
    const ox = topX * u + span(-0.04, 0.04), oz = topZ * u + span(-0.04, 0.04);
    const shade = 0.72 + 0.32 * u + span(-0.04, 0.04);
    const col = (s: number) => cc.push(s, s, s, 1);
    const base = cp.length / 3;
    // The rim: TIER_SIDES points, each pushed in or out and drooped by its own amount (jagged).
    for (let k = 0; k < TIER_SIDES; k++) {
      const a = twist + (k / TIER_SIDES) * Math.PI * 2;
      const rr = r * (k % 2 ? span(0.72, 0.86) : span(0.98, 1.12));
      cp.push(ox + Math.cos(a) * rr, baseY - (k % 2 ? 0 : span(0.04, 0.12)), oz + Math.sin(a) * rr);
      col(shade * (k % 2 ? 0.92 : 1));
    }
    // Its tip, and an underside point (so it reads solid from below).
    const tip = cp.length / 3;
    cp.push(ox + span(-0.03, 0.03), tipY, oz + span(-0.03, 0.03));
    col(shade * 1.08);
    const under = cp.length / 3;
    cp.push(ox, baseY + step * 0.35, oz);
    col(shade * 0.7);
    for (let k = 0; k < TIER_SIDES; k++) {
      const a = base + k, b = base + ((k + 1) % TIER_SIDES);
      ci.push(a, tip, b);   // the slope
      ci.push(a, b, under); // the underside
    }
  }
  // The core: a plain cone inside the tiers, from just under the lowest to
  // the top, shaded as the deep inside of the tree.
  {
    const sides = 8, base = cp.length / 3;
    const y0 = CANOPY_FROM - 0.02, r0 = TIER_R * 0.62;
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      cp.push(Math.cos(a) * r0, y0, Math.sin(a) * r0);
      cc.push(0.62, 0.62, 0.62, 1);
    }
    const tip = cp.length / 3;
    cp.push(topX, CANOPY_TOP - 0.05, topZ);
    cc.push(0.8, 0.8, 0.8, 1);
    const mid = cp.length / 3;
    cp.push(0, y0, 0);
    cc.push(0.5, 0.5, 0.5, 1);
    for (let k = 0; k < sides; k++) {
      const a = base + k, b = base + ((k + 1) % sides);
      ci.push(a, tip, b, a, b, mid);
    }
  }
  const canopy = finish(`${name}_canopy`, cp, ci, cc, scene);
  return { trunk, canopy };
}
