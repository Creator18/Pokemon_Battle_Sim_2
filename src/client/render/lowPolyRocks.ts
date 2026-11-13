/**
 * Low-poly rocks that look like rock: faceted boulders (an icosphere fitted to a box, its surface roughened by layered
 * noise — big lumps, then smaller chips — flat-shaded so every facet catches the light its own way), coloured by their
 * vertices: stone darkening toward its foot, banded with strata, moss settled on whatever faces up. A wall of them for
 * a cliff or an outcrop: boulders packed along it, overlapping, a few big, more small, the top lip mossed and rounded.
 *
 * All in one material (vertex colours); each rock, and each wall, one mesh.
 */
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

type RGB = [number, number, number];
export interface RockLook { stone: RGB; dark: RGB; moss: RGB | null; strata?: number }
export const GREY_ROCK: RockLook = { stone: [0.6, 0.58, 0.54], dark: [0.36, 0.34, 0.31], moss: [0.34, 0.56, 0.26], strata: 0.08 };
export const EARTH_ROCK: RockLook = { stone: [0.56, 0.45, 0.33], dark: [0.34, 0.25, 0.17], moss: [0.36, 0.58, 0.27], strata: 0.1 };

let rockMat: StandardMaterial | null = null;
export function rockMaterial(scene: Scene): StandardMaterial {
  if (rockMat && rockMat.getScene() === scene && scene.materials.includes(rockMat)) return rockMat;
  const m = new StandardMaterial('lowPolyRock', scene);
  m.diffuseColor = new Color3(1, 1, 1); m.emissiveColor = new Color3(0.3, 0.3, 0.3); m.specularColor = new Color3(0.04, 0.04, 0.04);
  rockMat = m;
  return m;
}

const hash3 = (x: number, y: number, z: number) => { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); };
/** Smooth value noise in 3D (its lattice hashed, blended smoothly). */
function noise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const s = (t: number) => t * t * (3 - 2 * t), u = s(xf), v = s(yf), w = s(zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w) * 2 - 1;
}

/** A boulder w × h × d at (x, y, z) (its middle), roughened (its own `seed`), coloured by `look`. */
export function rock(scene: Scene, name: string, x: number, y: number, z: number, w: number, h: number, d: number, seed: number, look: RockLook = GREY_ROCK, detail = 2): Mesh {
  const m = MeshBuilder.CreateIcoSphere(name, { radius: 0.5, subdivisions: detail, flat: true, updatable: true }, scene);
  const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
  const o = seed * 13.37;
  for (let i = 0; i < pos.length; i += 3) {
    const px = pos[i], py = pos[i + 1], pz = pos[i + 2];
    // (Squarer than a ball — a boulder's flats — then lumps, then chips.)
    const k = 1 + 0.32 * noise(px * 2.2 + o, py * 2.2, pz * 2.2) + 0.12 * noise(px * 6 + o, py * 6 + 3, pz * 6);
    const sq = (t: number) => Math.sign(t) * Math.pow(Math.abs(t * 2), 0.75) / 2;
    pos[i] = sq(px) * k * w; pos[i + 1] = sq(py) * k * h; pos[i + 2] = sq(pz) * k * d;
    // (Its foot flattened: it sits.)
    if (pos[i + 1] < -h * 0.38) pos[i + 1] = -h * 0.38 + (pos[i + 1] + h * 0.38) * 0.25;
  }
  m.updateVerticesData(VertexBuffer.PositionKind, pos);
  const idx = m.getIndices()!;
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, idx, normals);
  m.updateVerticesData(VertexBuffer.NormalKind, normals);
  // Its colours: darker toward its foot, strata across it, moss on what faces up (face by face: crisp).
  const cols = new Float32Array((pos.length / 3) * 4);
  for (let f = 0; f < idx.length; f += 3) {
    const [a, b, c] = [idx[f], idx[f + 1], idx[f + 2]];
    const cy = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3, ny = (normals[a * 3 + 1] + normals[b * 3 + 1] + normals[c * 3 + 1]) / 3;
    const t = Math.min(1, Math.max(0, cy / h + 0.5));
    const band = look.strata ? Math.sin((cy + y) * 9 + seed) * look.strata : 0;
    const jitter = 0.92 + hash3(a, b, seed) * 0.16;
    let col: RGB = [0, 1, 2].map((i) => (look.dark[i] + (look.stone[i] - look.dark[i]) * (0.35 + 0.65 * t)) * (1 + band) * jitter) as RGB;
    if (look.moss && ny > 0.55 && t > 0.35 && hash3(c, a, seed + 1) < 0.85) col = look.moss.map((v) => v * (0.85 + hash3(b, c, seed) * 0.3)) as RGB;
    for (const v of [a, b, c]) cols.set([col[0], col[1], col[2], 1], v * 4);
  }
  m.setVerticesData(VertexBuffer.ColorKind, cols);
  m.position.set(x, y, z);
  m.rotation.y = (hash3(seed, 1, 2) - 0.5) * 0.8;
  m.material = rockMaterial(scene);
  return m;
}

/**
 * A rock wall from x0 to x1, y0 to y1, its face at zFront running back to zBack: boulders packed over it — overlapping
 * a little, big ones and small, more in front — and a mossy rounded lip along its top. One mesh.
 */
export function rockWall(scene: Scene, name: string, x0: number, x1: number, y0: number, y1: number, zFront: number, zBack: number, seed: number, look: RockLook = GREY_ROCK): Mesh {
  const parts: Mesh[] = [];
  let s = seed;
  const rnd = () => { s = (s * 16807 + 11) % 2147483647; return (s % 10000) / 10000; };
  const W = x1 - x0, H = y1 - y0, D = zBack - zFront;
  // (Its body: a core of big blocks, so no gap shows through.)
  const core = MeshBuilder.CreateBox(`${name}Core`, { width: W * 0.96, height: H * 0.96, depth: D * 0.9 }, scene);
  core.position.set((x0 + x1) / 2, (y0 + y1) / 2, (zFront + zBack) / 2 + D * 0.04);
  const cc = new Float32Array(core.getTotalVertices() * 4);
  for (let i = 0; i < cc.length; i += 4) cc.set([...look.dark, 1], i);
  core.setVerticesData(VertexBuffer.ColorKind, cc);
  parts.push(core);
  // Boulders over its face, row on row.
  const rows = Math.max(1, Math.round(H / 1.2));
  for (let r = 0; r < rows; r++) {
    const ry = y0 + ((r + 0.5) / rows) * H;
    for (let x = x0 - 0.2 + rnd() * 0.4; x < x1 + 0.1;) {
      const bw = 0.9 + rnd() * 1.3, bh = H / rows * (1.05 + rnd() * 0.45), bd = 0.8 + rnd() * 0.8;
      parts.push(rock(scene, `${name}Boulder`, Math.min(x1 - bw * 0.3, x + bw / 2), ry + (rnd() - 0.5) * 0.3, zFront + bd * 0.3 - rnd() * 0.2, bw, bh, bd, s % 997, look, rnd() < 0.3 ? 2 : 1));
      x += bw * (0.62 + rnd() * 0.2);
    }
  }
  // Its sides, its back, roughened too (seen as the camera moves along).
  for (const sx of [x0, x1]) for (let k = 0; k < Math.ceil(D / 1.4); k++) parts.push(rock(scene, `${name}Side`, sx, y0 + H * (0.3 + rnd() * 0.4), zFront + 0.7 + k * 1.4, 0.9, H * 0.9, 1.5, (s + k) % 991, look, 1));
  // Its lip: mossy rounded stones along the top.
  for (let x = x0 + 0.2; x < x1; x += 0.7 + rnd() * 0.5) parts.push(rock(scene, `${name}Lip`, x, y1 - 0.05, zFront + 0.5 + rnd() * D * 0.6, 0.9 + rnd() * 0.6, 0.45, 0.9 + rnd() * 0.8, (s + 7) % 983, { ...look, moss: look.moss ?? GREY_ROCK.moss }, 1));
  const merged = Mesh.MergeMeshes(parts, true, true)!;
  merged.name = name;
  merged.material = rockMaterial(scene);
  return merged;
}
