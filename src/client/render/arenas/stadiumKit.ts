/**
 * What the stadiums are built of: one stadium's root (laid out at 1, grown
 * by STADIUM_SCALE), its flat-coloured materials, boxes and low-poly shapes,
 * its painted floor, a curb round the play, scattered props — and the Arena
 * it hands back. Every stadium shares the grass stadium's play: a pitch of
 * PITCH_W × PITCH_D with PITCH_RUNOFF to its curb.
 */
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { lowPolyTree } from '../trees.ts';
import { PITCH_W, PITCH_D, PITCH_RUNOFF, STADIUM_SCALE, type Arena } from './grassStadium.ts';

export { STADIUM_SCALE, type Arena };
/** The play inside the curb: half its width and depth (laid out at 1). */
export const INNER_W = PITCH_W / 2 + PITCH_RUNOFF, INNER_D = PITCH_D / 2 + PITCH_RUNOFF;

export const c3 = (hex: string) => Color3.FromHexString(hex);
/** A relief floor's light (× its colour): low enough that the sun on flat ground doesn't clip. */
const RELIEF_LIGHT = 0.5;

/** A seeded random 0..1. */
export function rng(seed: number): () => number {
  let s = Math.max(1, Math.floor(seed)) % 2147483647;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

export class Kit {
  readonly root: TransformNode;
  readonly owned: { dispose(): void }[] = [];
  private readonly mats = new Map<string, StandardMaterial>();

  constructor(readonly scene: Scene, name: string, at = Vector3.Zero()) {
    this.root = new TransformNode(name, scene);
    this.root.position.copyFrom(at);
    this.root.scaling.setAll(STADIUM_SCALE);
  }

  /** A flat colour (shared by everything of that colour); `glow`: it lights itself (lava, crystal). */
  flat(hex: string, glow = 0): StandardMaterial {
    const key = `${hex}|${glow}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new StandardMaterial(`${this.root.name}_${hex}`, this.scene);
      m.diffuseColor = c3(hex);
      m.specularColor = Color3.Black();
      if (glow) { m.emissiveColor = c3(hex).scale(glow); }
      this.mats.set(key, m);
      this.owned.push(m);
    }
    return m;
  }

  put<M extends Mesh>(m: M, mat: StandardMaterial, x: number, y: number, z: number): M {
    m.material = mat;
    m.position.set(x, y, z);
    m.parent = this.root;
    m.isPickable = false;
    m.receiveShadows = true;
    this.owned.push(m);
    return m;
  }

  box(w: number, h: number, d: number, hex: string, x: number, y: number, z: number, ry = 0): Mesh {
    const m = this.put(MeshBuilder.CreateBox('kitBox', { width: w, height: h, depth: d }, this.scene), this.flat(hex), x, y + h / 2, z);
    m.rotation.y = ry;
    return m;
  }

  /** A low-poly lump (a rock, a boulder, a snow bank): an icosphere squashed and jostled, flat shaded. */
  rock(r: number, hex: string, x: number, y: number, z: number, seed: number, squash = 0.7, glow = 0): Mesh {
    const rnd = rng(seed);
    const m = MeshBuilder.CreateIcoSphere('kitRock', { radius: r, subdivisions: 1, flat: true, updatable: true }, this.scene);
    const p = m.getVerticesData('position')!;
    for (let i = 0; i < p.length; i += 3) { const k = 0.8 + rnd() * 0.4; p[i] *= k; p[i + 1] *= k * squash; p[i + 2] *= k; }
    m.updateVerticesData('position', p);
    m.refreshBoundingInfo();
    m.convertToFlatShadedMesh();
    m.rotation.y = rnd() * Math.PI * 2;
    return this.put(m, this.flat(hex, glow), x, y + r * squash * 0.55, z);
  }

  /** A spike or shard (a crystal, a jag of rock): a few-sided cone, tipped. */
  shard(r: number, h: number, hex: string, x: number, y: number, z: number, tilt = 0, ry = 0, glow = 0, sides = 5): Mesh {
    const m = MeshBuilder.CreateCylinder('kitShard', { diameterTop: 0, diameterBottom: r * 2, height: h, tessellation: sides }, this.scene);
    m.convertToFlatShadedMesh();
    const s = this.put(m, this.flat(hex, glow), x, y + h / 2, z);
    s.rotation.set(tilt, ry, 0);
    return s;
  }

  /** A column (a pillar, a trunk, a post): `sides` round. */
  column(r: number, h: number, hex: string, x: number, y: number, z: number, sides = 8, top = r): Mesh {
    const m = MeshBuilder.CreateCylinder('kitColumn', { diameterTop: top * 2, diameterBottom: r * 2, height: h, tessellation: sides }, this.scene);
    m.convertToFlatShadedMesh();
    return this.put(m, this.flat(hex), x, y + h / 2, z);
  }

  /** A ground of `w` × `d` (laid out) at `y`, flat colour or its own material. */
  ground(w: number, d: number, mat: StandardMaterial, y = 0, x = 0, z = 0): Mesh {
    return this.put(MeshBuilder.CreateGround('kitGround', { width: w, height: d }, this.scene), mat, x, y, z);
  }

  /**
   * The floor of the play, painted: `paint` draws on a canvas `tw` texels a
   * metre (its origin the play's middle, +x across, +z its south), the
   * stadium's markings over it in `line` (its touchline, halfway line and
   * centre circle) unless `line` is null. `relief`: its height at each
   * point (laid out, m) — a real surface, `segs` faces a metre, flat shaded
   * (low-poly facets) unless `smooth`.
   */
  floor(paint: (g: CanvasRenderingContext2D, X: (m: number) => number, Z: (m: number) => number, px: number) => void, line: string | null,
    relief?: { height: (x: number, z: number) => number; segs: number; smooth?: boolean }): { mesh: Mesh; mat: StandardMaterial } {
    const tw = 2048, th = Math.round((tw * INNER_D) / INNER_W);
    const tex = new DynamicTexture(`${this.root.name}Floor`, { width: tw, height: th }, this.scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    this.owned.push(tex);
    const g = tex.getContext() as unknown as CanvasRenderingContext2D;
    const px = tw / (INNER_W * 2);
    const X = (m: number) => (m + INNER_W) * px, Z = (m: number) => (m + INNER_D) * px;
    paint(g, X, Z, px);
    if (line) {
      g.strokeStyle = line; g.fillStyle = line; g.lineWidth = 0.13 * px;
      const hw = PITCH_W / 2, hd = PITCH_D / 2;
      g.strokeRect(X(-hw), Z(-hd), hw * 2 * px, hd * 2 * px);
      g.beginPath(); g.moveTo(X(0), Z(-hd)); g.lineTo(X(0), Z(hd)); g.stroke();
      g.beginPath(); g.arc(X(0), Z(0), 2.7 * px, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(X(0), Z(0), 0.16 * px, 0, Math.PI * 2); g.fill();
    }
    tex.update();
    const mat = new StandardMaterial(`${this.root.name}FloorMat`, this.scene);
    mat.diffuseTexture = tex; mat.specularColor = Color3.Black();
    this.owned.push(mat);
    if (!relief) return { mesh: this.ground(INNER_W * 2, INNER_D * 2, mat), mat };
    // (Half its light: the sun and the sky together light flat ground past full, and it clips — every slope as bright as
    // the flat, no relief to see. Halved, flat ground comes to full, slopes turned from the sun fall darker.)
    mat.diffuseColor = new Color3(RELIEF_LIGHT, RELIEF_LIGHT, RELIEF_LIGHT);
    const m = MeshBuilder.CreateGround('kitGround', { width: INNER_W * 2, height: INNER_D * 2,
      subdivisionsX: Math.round(INNER_W * 2 * relief.segs), subdivisionsY: Math.round(INNER_D * 2 * relief.segs), updatable: true }, this.scene);
    const p = m.getVerticesData('position')!;
    for (let i = 0; i < p.length; i += 3) p[i + 1] = relief.height(p[i], p[i + 2]);
    m.updateVerticesData('position', p);
    const normals: number[] = [];
    VertexData.ComputeNormals(p, m.getIndices()!, normals);
    m.updateVerticesData('normal', normals);
    if (!relief.smooth) m.convertToFlatShadedMesh();
    m.refreshBoundingInfo();
    return { mesh: this.put(m, mat, 0, 0, 0), mat };
  }

  /**
   * A curb round the play: blocks of `hex` capped in `cap`, `h` high, `t`
   * thick, a post at each corner; `gap`: half-width of an opening in the
   * middle of each end (0: none).
   */
  curb(hex: string, cap: string, h = 0.42, t = 0.45, gap = 0): void {
    const ow = INNER_W + t / 2, od = INNER_D + t / 2;
    const run = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0), along = x0 !== x1;
      const n = Math.max(1, Math.round(len / 1.8)), seg = len / n;
      for (let i = 0; i < n; i++) {
        const k = (i + 0.5) / n, x = x0 + (x1 - x0) * k, z = z0 + (z1 - z0) * k;
        const w = along ? seg - 0.04 : t, d = along ? t : seg - 0.04;
        this.box(w, h, d, hex, x, 0, z);
        this.box(w + 0.04, 0.06, d + 0.04, cap, x, h, z);
      }
    };
    for (const sz of [-1, 1]) {
      if (gap > 0) { run(-ow, sz * od, -gap, sz * od); run(gap, sz * od, ow, sz * od); }
      else run(-ow, sz * od, ow, sz * od);
    }
    for (const sx of [-1, 1]) run(sx * ow, -od, sx * ow, od);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      this.box(0.8, h + 0.28, 0.8, hex, sx * ow, 0, sz * od);
      this.box(0.9, 0.08, 0.9, cap, sx * ow, h + 0.28, sz * od);
    }
  }

  /**
   * Trees by the hundred: a handful of low-poly shapes (lowPolyTree), each
   * planted many times as instances, coloured `trunk` and `canopy`, at
   * `spots` (x, z, scale).
   */
  trees(spots: [number, number, number][], trunk: string, canopy: string, seed = 11, emissive = 0.05): void {
    const trunkMat = this.flat(trunk), canopyMat = this.flat(canopy);
    canopyMat.backFaceCulling = false; canopyMat.twoSidedLighting = true;
    canopyMat.emissiveColor = c3(canopy).scale(emissive * 2);
    const kinds = [0, 1, 2, 3, 4, 5].map((i) => {
      const t = lowPolyTree(`${this.root.name}Tree${i}`, seed + i * 13, this.scene);
      t.trunk.material = trunkMat; t.canopy.material = canopyMat;
      for (const m of [t.trunk, t.canopy]) { m.isVisible = false; m.isPickable = false; m.parent = this.root; this.owned.push(m); }
      return t;
    });
    const rnd = rng(seed * 7);
    for (const [x, z, s] of spots) {
      const k = kinds[Math.floor(rnd() * kinds.length)], ry = rnd() * Math.PI * 2;
      for (const m of [k.trunk, k.canopy]) {
        const inst = m.createInstance(`${this.root.name}TreeAt`);
        inst.parent = this.root; inst.isPickable = false;
        inst.position.set(x, 0, z); inst.scaling.setAll(s); inst.rotation.y = ry;
      }
    }
  }

  /** Spots in a ring round the play: `rows` deep from `from` past the curb, `every` apart, jostled; none inside `keep` (x, z → true: keep clear). */
  ring(from: number, rows: number, every: number, seed: number, scale: [number, number], keep?: (x: number, z: number) => boolean): [number, number, number][] {
    const rnd = rng(seed), out: [number, number, number][] = [];
    for (let row = 0; row < rows; row++) {
      const ow = INNER_W + from + row * every, od = INNER_D + from + row * every;
      const per = 2 * (ow * 2 + od * 2);
      const n = Math.round(per / every);
      for (let i = 0; i < n; i++) {
        let s = (i / n) * per, x: number, z: number;
        if (s < ow * 2) { x = -ow + s; z = -od; } else if ((s -= ow * 2) < od * 2) { x = ow; z = -od + s; }
        else if ((s -= od * 2) < ow * 2) { x = ow - s; z = od; } else { s -= ow * 2; x = -ow; z = od - s; }
        x += (rnd() - 0.5) * every * 0.7; z += (rnd() - 0.5) * every * 0.7;
        if (keep?.(x, z)) continue;
        out.push([x, z, scale[0] + rnd() * (scale[1] - scale[0])]);
      }
    }
    return out;
  }

  /**
   * The Arena it makes, with its air (fog colour, where the fog starts and is
   * whole, laid out); `floor`: its floor's height at a point (laid out, m —
   * given in the world by the Arena), and the colour of footprints in it.
   */
  arena(fog: string, fogAt: [number, number], extra?: () => void, floor?: { height?: (x: number, z: number) => number; footprints?: string }): Arena {
    const at = this.root.position, h = floor?.height;
    return {
      heightAt: h ? (x, z) => at.y + h((x - at.x) / STADIUM_SCALE, (z - at.z) / STADIUM_SCALE) * STADIUM_SCALE : undefined,
      footprints: floor?.footprints,
      root: this.root,
      bounds: { halfW: INNER_W * STADIUM_SCALE, halfD: INNER_D * STADIUM_SCALE, y: this.root.position.y },
      air: { fog: c3(fog), fogStart: fogAt[0] * STADIUM_SCALE, fogEnd: fogAt[1] * STADIUM_SCALE },
      dispose: () => { extra?.(); for (const o of this.owned.reverse()) o.dispose(); this.root.dispose(); },
    };
  }
}
