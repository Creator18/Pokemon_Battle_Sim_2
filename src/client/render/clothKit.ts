/**
 * Cloth, low-poly but soft: what hard furniture is not — finely gridded sheets, smooth-shaded, two-sided, draped and
 * folded by shape functions rather than simulated, wearing woven patterns:
 *
 *  - drape: a sheet laid over a box's top (a quilt on a bed, a cloth on a table), rolling over its edges round a
 *    radius and hanging straight on down, its hanging part rippling into folds that deepen toward its hem, its
 *    corners falling in cones; its top faintly puffed;
 *  - curtain: a panel hung in pleats from a rod, gathered by a tie-back into an hourglass, flaring below it;
 *  - pillow: a rounded, puffed cushion (a squashed superellipsoid, its corners pinched);
 *  - fringe: tassels along a rug's ends;
 *  - fabric: a material of soft woven patterns (a quilt's patches and stitching, stripes, a plain weave).
 */
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';

type RGB = [number, number, number];
const css = (c: RGB, k = 1) => `rgb(${[0, 1, 2].map((i) => Math.round(Math.min(1, c[i] * k) * 255)).join(',')})`;

export type Weave = 'quilt' | 'stripe' | 'plain' | 'check';

/** A woven pattern on a canvas: its base colour `c`, its accent `a`. */
function weaveTexture(scene: Scene, name: string, kind: Weave, c: RGB, a: RGB, size = 256): DynamicTexture {
  const t = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const g = t.getContext() as CanvasRenderingContext2D;
  g.fillStyle = css(c); g.fillRect(0, 0, size, size);
  if (kind === 'quilt') {
    // (Patches, two shades, each stitched round with a dashed seam, a little puffed in its middle.)
    const n = 4, s = size / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const shade = (i + j) % 2 ? 1 : 0.86;
      const grad = g.createRadialGradient((i + 0.5) * s, (j + 0.5) * s, s * 0.05, (i + 0.5) * s, (j + 0.5) * s, s * 0.75);
      grad.addColorStop(0, css((i + j) % 2 ? c : a, shade * 1.06)); grad.addColorStop(1, css((i + j) % 2 ? c : a, shade * 0.86));
      g.fillStyle = grad; g.fillRect(i * s, j * s, s, s);
    }
    g.strokeStyle = css([0.97, 0.97, 1], 1); g.lineWidth = 2; g.setLineDash([6, 5]);
    for (let k = 0; k <= n; k++) { g.beginPath(); g.moveTo(k * s, 0); g.lineTo(k * s, size); g.moveTo(0, k * s); g.lineTo(size, k * s); g.stroke(); }
    g.setLineDash([]);
  } else if (kind === 'stripe') {
    const n = 6, s = size / n;
    for (let k = 0; k < n; k++) if (k % 2) { g.fillStyle = css(a); g.fillRect(k * s, 0, s * 0.55, size); }
  } else if (kind === 'check') {
    g.globalAlpha = 0.45; g.fillStyle = css(a);
    const n = 8, s = size / n;
    for (let k = 0; k < n; k += 2) { g.fillRect(k * s, 0, s, size); g.fillRect(0, k * s, size, s); }
    g.globalAlpha = 1;
  }
  // (The weave itself: fine threads across and along, every texel a touch lighter or darker.)
  const img = g.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const thread = ((x % 4 < 2) !== (y % 4 < 2) ? 1.05 : 0.95) * (0.97 + Math.random() * 0.06);
    for (let k = 0; k < 3; k++) img.data[i + k] = Math.min(255, img.data[i + k] * thread);
  }
  g.putImageData(img, 0, 0);
  t.update();
  t.wrapU = Texture.WRAP_ADDRESSMODE; t.wrapV = Texture.WRAP_ADDRESSMODE;
  return t;
}

/**
 * A fabric material: `kind` of weave in `c` (accent `a`), tiled `tile` times; matte, a faint sheen, both sides drawn
 * (a sheet is seen from under as well as over); its pattern lit as the town's colours are (emissive, by the pattern).
 */
export function fabric(scene: Scene, name: string, kind: Weave, c: RGB, a: RGB = c, tile = 1, glow = 0.4): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  const tex = weaveTexture(scene, `${name}Weave`, kind, c, a);
  tex.uScale = tile; tex.vScale = tile;
  m.diffuseTexture = tex;
  const em = weaveTexture(scene, `${name}Glow`, kind, c, a);
  em.uScale = tile; em.vScale = tile; em.level = glow;
  m.emissiveTexture = em;
  m.specularColor = new Color3(0.06, 0.06, 0.07); m.specularPower = 12;
  m.backFaceCulling = false;
  return m;
}

/** A grid mesh from flat arrays (smooth normals, its UVs `u`, `v`). */
function grid(name: string, scene: Scene, nu: number, nv: number, at: (u: number, v: number) => [number, number, number], uvScale: [number, number] = [1, 1]): Mesh {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv;
    positions.push(...at(u, v)); uvs.push(u * uvScale[0], v * uvScale[1]);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    indices.push(a, b, d, a, d, c);
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const vd = new VertexData();
  vd.positions = positions; vd.indices = indices; vd.normals = normals; vd.uvs = uvs;
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh, true);
  return mesh;
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export interface DrapeOptions {
  /** How far it hangs down past each side (−x, +x, −z, +z): 0 for a side it doesn't fall over (a bed's head). */
  drop: [number, number, number, number];
  /** The radius it rolls over the box's edge round. */
  round?: number;
  /** Its folds: how deep (at its hem), how many per unit along an edge. */
  folds?: number; foldFreq?: number;
  /** How much its top is puffed (a quilt) — and how lumpy. */
  puff?: number;
  /** Its pattern's repeats per unit. */
  tile?: number;
  /** Grid cells per unit (its smoothness). */
  res?: number;
}

/**
 * A sheet draped over the top of a box (x0..x1, z0..z1, its top at y), centred in the world (not parented).
 */
export function drape(name: string, scene: Scene, x0: number, x1: number, z0: number, z1: number, y: number, o: DrapeOptions): Mesh {
  const [dxa, dxb, dza, dzb] = o.drop, R = o.round ?? 0.06, folds = o.folds ?? 0.03, ff = o.foldFreq ?? 3.2, puff = o.puff ?? 0;
  const res = o.res ?? 14, tile = o.tile ?? 1;
  const ext = (d: number) => (d > 0 ? d + R * 0.6 : 0);
  // (Its flat extent: the top, and out past it by as much cloth as rolls over the edge and hangs.)
  const ua = x0 - ext(dxa), ub = x1 + ext(dxb), va = z0 - ext(dza), vb = z1 + ext(dzb);
  const nu = Math.max(8, Math.round((ub - ua) * res)), nv = Math.max(8, Math.round((vb - va) * res));
  return grid(name, scene, nu, nv, (u, v) => {
    const px = ua + (ub - ua) * u, pz = va + (vb - va) * v;
    // How far past the top's edge (radially round its corners), and which way out.
    const qx = Math.min(x1, Math.max(x0, px)), qz = Math.min(z1, Math.max(z0, pz));
    const ox = px - qx, oz = pz - qz, e = Math.hypot(ox, oz);
    if (e < 1e-6) {
      // (On top: faintly puffed, highest in the middle, lumpy.)
      const cx = (px - x0) / (x1 - x0), cz = (pz - z0) / (z1 - z0);
      const dome = Math.sin(Math.PI * cx) * Math.sin(Math.PI * cz);
      const lump = Math.sin(px * 9.1 + pz * 3.7) * Math.sin(pz * 8.3 - px * 2.1);
      return [px, y + puff * (0.6 * dome + 0.4 * lump * dome), pz];
    }
    const dx = ox / e, dz = oz / e;
    // Over the edge round R, then straight down.
    const arc = (Math.PI / 2) * R;
    let out: number, down: number;
    if (e < arc) { const a = e / R; out = R * Math.sin(a); down = R * (1 - Math.cos(a)); }
    else { out = R; down = R + (e - arc); }
    // (Its hem: as far down as that side lets it fall — the corners the lesser of their two sides'.)
    const sideX = dx < 0 ? dxa : dxb, sideZ = dz < 0 ? dza : dzb;
    const maxDrop = Math.max(0.001, Math.abs(dx) > 0.92 ? sideX : Math.abs(dz) > 0.92 ? sideZ : Math.min(sideX, sideZ));
    down = Math.min(down, maxDrop + R);
    // Folds: rippling outward along the edge, deeper toward the hem.
    const along = Math.abs(dx) > Math.abs(dz) ? pz : px;
    const deep = smooth((down - R) / Math.max(0.05, maxDrop));
    const ripple = folds * deep * (Math.sin(along * ff * Math.PI * 2) * 0.7 + Math.sin(along * ff * 5.3 + 1.3) * 0.3);
    return [qx + dx * (out + ripple), y + puff * 0.2 - down, qz + dz * (out + ripple)];
  }, [(ub - ua) * tile, (vb - va) * tile]);
}

export interface CurtainOptions {
  /** How many pleats across it. */
  pleats?: number; depth?: number;
  /** A tie-back: its height up the curtain (0 its hem, 1 its rod), how tight (0..1), toward which side (−1 / +1). */
  tie?: number; tight?: number; gather?: number;
  tile?: number;
}

/** A curtain from its rod (x0..x1 at yTop, hung at z) to its hem (yBottom), pleated, tied back. */
export function curtain(name: string, scene: Scene, x0: number, x1: number, yTop: number, yBottom: number, z: number, o: CurtainOptions = {}): Mesh {
  const pleats = o.pleats ?? 5, depth = o.depth ?? 0.06, tie = o.tie ?? 0.4, tight = o.tight ?? 0.55, gather = o.gather ?? 0, tile = o.tile ?? 1;
  const w = x1 - x0, h = yTop - yBottom;
  const anchor = gather < 0 ? x0 : gather > 0 ? x1 : (x0 + x1) / 2;
  return grid(name, scene, pleats * 8, 22, (u, v) => {
    // v 0 its hem, 1 its rod.
    const y = yBottom + v * h;
    // (Gathered toward its side by the tie: squeezed most at the tie, easing above (to the rod) and below (flaring).)
    const tieT = v >= tie ? (v - tie) / (1 - tie) : (tie - v) / tie;
    const squeeze = gather === 0 ? 0 : tight * (1 - Math.pow(tieT, v >= tie ? 1.4 : 0.8)) * (v >= tie ? 1 : 0.85);
    const x = anchor + (x0 + u * w - anchor) * (1 - squeeze);
    // Pleats: deeper where it's gathered, softer up at the rod's rings, wider at the hem.
    const pleatD = depth * (1 + squeeze * 1.6) * (0.75 + 0.35 * (1 - v));
    const zz = z - pleatD * (0.5 + 0.5 * Math.sin(u * pleats * Math.PI * 2)) - (1 - v) * 0.02;
    // (Its hem a little uneven.)
    const hem = v < 0.06 ? Math.sin(u * pleats * Math.PI * 2 + 0.6) * 0.02 * (1 - v / 0.06) : 0;
    return [x, y + hem, zz];
  }, [w * tile, h * tile]);
}

/** A pillow `w` × `h` × `d` (centred): a puffed rounded box, its corners pinched out a little. */
export function pillow(name: string, scene: Scene, w: number, h: number, d: number): Mesh {
  const m = MeshBuilder.CreateSphere(name, { diameter: 1, segments: 16, updatable: true }, scene);
  const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
  const sgn = (t: number) => (t < 0 ? -1 : 1);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i] * 2, y = pos[i + 1] * 2, z = pos[i + 2] * 2;
    // (Squared off across, rounded through its thickness; its corners pulled out into points.)
    const sx = sgn(x) * Math.pow(Math.abs(x), 0.45), sz = sgn(z) * Math.pow(Math.abs(z), 0.45);
    const corner = Math.pow(Math.abs(sx * sz), 3) * 0.12;
    const sy = sgn(y) * Math.pow(Math.abs(y), 0.9) * (1 - Math.abs(sx * sz) * 0.55);
    pos[i] = (sx * (1 + corner) * w) / 2; pos[i + 1] = (sy * h) / 2; pos[i + 2] = (sz * (1 + corner) * d) / 2;
  }
  m.updateVerticesData(VertexBuffer.PositionKind, pos);
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, m.getIndices()!, normals);
  m.updateVerticesData(VertexBuffer.NormalKind, normals);
  return m;
}

/** Tassels along an edge (from x0 to x1 at z, hanging out `len` past it in direction `dir` along z), at height y. */
export function fringe(name: string, scene: Scene, x0: number, x1: number, y: number, z: number, dir: number, len = 0.1, gap = 0.06): Mesh {
  const parts: Mesh[] = [];
  for (let x = x0 + gap / 2; x < x1; x += gap) {
    const t = MeshBuilder.CreateBox(name, { width: 0.018, height: 0.008, depth: len * (0.85 + ((x * 37) % 1) * 0.3) }, scene);
    t.position.set(x, y, z + dir * len * 0.5); t.rotation.y = (((x * 53) % 1) - 0.5) * 0.25;
    parts.push(t);
  }
  return Mesh.MergeMeshes(parts, true, true)!;
}
