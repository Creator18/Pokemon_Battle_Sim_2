/**
 * Frozen solid: a block of see-through ice round a Pokémon, built as the
 * board's boulders are (hexRock) — stacked rings of points, faceted, flat-
 * shaded, with a few random lumps and an uneven, off-centre crown — but where
 * a boulder's rings are limited by its hex, the ice's follow the Pokémon:
 * at each ring's height, each of its points sits just outside the furthest
 * part of the body in that direction. So the block takes the body's shape
 * (a tail out one way, a head up high), only cut in facets and fattened.
 *
 * The ice is glossy: bright, tight highlights on its facets, its edges
 * (seen side-on) more opaque and whiter than its faces, which you see the
 * Pokémon through.
 */
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { FresnelParameters } from '@babylonjs/core/Materials/fresnelParameters';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { smokeTexture } from './textures.ts';

/** Rings up its height, and points round each ring (low-poly: few of each). */
const ICE_RINGS = 7, ICE_POINTS = 14;
/** How far it stands off the body, × the body's height. */
const ICE_MARGIN = 0.07;
/** Its lumps: at most this × the body's height, outward only (never into the body). */
const ICE_LUMP = 0.06;
/** A direction with nothing of the body in it is still this × the height out (none of it needle-thin). */
const ICE_MIN_R = 0.16;
/** Its neighbours hold each point out to at least this share of theirs (smoother, rockier outlines). */
const ICE_SPREAD = 0.62;
/** How opaque it is (see-through: the Pokémon shows inside). */
export const ICE_ALPHA = 0.34;

export interface IceBlock {
  mesh: Mesh;
  mat: StandardMaterial;
  /** The body's height (the block's own units). */
  height: number;
  /**
   * Its shape `t` of the way (0..1) from frozen onto the body — each point
   * on the body's surface where it reaches (pulled in to the middle where
   * nothing of it does) — out to the block.
   */
  form(t: number): void;
}

/**
 * A block of ice round `points` — the body's surface, in the space the block
 * will live in (y up) — from `seed`, so each keeps its own shape. Its origin
 * is at the middle of its foot, at the body's lowest point.
 */
export function iceBlock(name: string, points: readonly Vector3[], seed: number, scene: Scene): IceBlock {
  let s = seed || 1;
  const rand = () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return s / 4294967296; };
  const span = (lo: number, hi: number) => lo + (hi - lo) * rand();

  // The body's extent: its foot, its top, and its middle (round which the rings go).
  let lo = Infinity, hi = -Infinity, cx = 0, cz = 0;
  for (const p of points) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); cx += p.x; cz += p.z; }
  cx /= Math.max(1, points.length); cz /= Math.max(1, points.length);
  const H = Math.max(1e-3, hi - lo);
  const gap = H / (ICE_RINGS - 1);

  // At each ring, the body's furthest reach in each of the ring's directions:
  // every point counts for the rings within a gap of it (so the facets between
  // two rings never cut into it), and for the two directions either side of it,
  // pushed out by the facet's sag between them.
  const sag = 1 / Math.cos(Math.PI / ICE_POINTS);
  const reach = Array.from({ length: ICE_RINGS }, () => new Array<number>(ICE_POINTS).fill(0));
  for (const p of points) {
    const x = p.x - cx, z = p.z - cz, y = p.y - lo;
    const r = Math.hypot(x, z) * sag;
    const a = ((Math.atan2(z, x) / (Math.PI * 2)) + 1) % 1 * ICE_POINTS;
    const k0 = Math.floor(a) % ICE_POINTS, k1 = (k0 + 1) % ICE_POINTS;
    const i0 = Math.max(0, Math.floor(y / gap)), i1 = Math.min(ICE_RINGS - 1, Math.ceil(y / gap));
    for (const i of [i0, i1]) {
      if (reach[i][k0] < r) reach[i][k0] = r;
      if (reach[i][k1] < r) reach[i][k1] = r;
    }
  }
  // (How far the body itself reaches, before any of that: where the ice first forms.)
  const body = reach.map((ring) => [...ring]);
  // Nowhere needle-thin, and each point held out toward its neighbours'.
  for (const ring of reach) {
    const was = [...ring];
    for (let k = 0; k < ICE_POINTS; k++) {
      const n = Math.max(was[(k + ICE_POINTS - 1) % ICE_POINTS], was[(k + 1) % ICE_POINTS]);
      ring[k] = Math.max(was[k], n * ICE_SPREAD, ICE_MIN_R * H);
    }
  }

  // Its lumps: a few waves round it, of random count, size and phase (outward only).
  const waves = Array.from({ length: 3 }, (_, i) => ({ n: 2 + i + Math.floor(rand() * 2), amp: span(0.5, 1) / (1 + i * 0.5), ph: rand() * 6.283, drift: span(-3, 3) }));
  const lump = (a: number, y: number) => ICE_LUMP * H * Math.max(0, waves.reduce((acc, w) => acc + w.amp * Math.sin(w.n * a + w.ph + w.drift * y), 0) / 1.6);

  // Each point as the block has it, and where it first forms (`inner`: on the body).
  const positions: number[] = [], inner: number[] = [], indices: number[] = [];
  const at = (i: number, k: number) => i * ICE_POINTS + (k % ICE_POINTS);
  const margin = ICE_MARGIN * H;
  for (let i = 0; i < ICE_RINGS; i++) {
    const y = i * gap;
    for (let k = 0; k < ICE_POINTS; k++) {
      const a = (k / ICE_POINTS) * Math.PI * 2;
      const r = reach[i][k] + margin + lump(a, y / H) + span(0, 0.02) * H;
      // (Its foot flat on the ground; the rings above it a little uneven.)
      const yy = i ? y + span(-0.12, 0.12) * gap : 0;
      positions.push(Math.cos(a) * r, yy, Math.sin(a) * r);
      const r0 = body[i][k] > 0 ? body[i][k] * 0.9 : ICE_MIN_R * 0.3 * H;
      inner.push(Math.cos(a) * r0, yy, Math.sin(a) * r0);
    }
  }
  for (let i = 0; i < ICE_RINGS - 1; i++) {
    for (let k = 0; k < ICE_POINTS; k++) indices.push(at(i, k), at(i, k + 1), at(i + 1, k), at(i, k + 1), at(i + 1, k + 1), at(i + 1, k));
  }
  // The crown: an uneven, off-centre peak over the top.
  const top = positions.length / 3;
  positions.push(span(-0.08, 0.08) * H, H + margin * span(1.4, 2.2), span(-0.08, 0.08) * H);
  inner.push(0, H * 0.97, 0);
  const last = ICE_RINGS - 1;
  for (let k = 0; k < ICE_POINTS; k++) indices.push(at(last, k), at(last, k + 1), top);
  // Its foot, closed.
  const foot = positions.length / 3;
  positions.push(0, 0, 0);
  inner.push(0, 0, 0);
  for (let k = 0; k < ICE_POINTS; k++) indices.push(at(0, k + 1), at(0, k), foot);

  // Flat-shaded: every triangle its own three vertices (wound as the
  // boulders are: their outsides face out), the block's and the body's.
  const flat = (src: number[]) => Float32Array.from(indices.flatMap((v) => [src[v * 3], src[v * 3 + 1], src[v * 3 + 2]]));
  const outer = flat(positions), onBody = flat(inner);
  const order = indices.map((_, j) => j);
  const vd = new VertexData();
  vd.positions = outer;
  vd.indices = order;
  const normals: number[] = [];
  VertexData.ComputeNormals(outer, order, normals);
  vd.normals = normals;
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh, true);
  const live = new Float32Array(outer.length), liveN: number[] = [];
  const form = (t: number) => {
    for (let j = 0; j < live.length; j++) live[j] = onBody[j] + (outer[j] - onBody[j]) * t;
    VertexData.ComputeNormals(live, order, liveN);
    mesh.updateVerticesData(VertexBuffer.PositionKind, live);
    mesh.updateVerticesData(VertexBuffer.NormalKind, liveN);
  };
  mesh.position.set(cx, lo, cz);
  mesh.isPickable = false;
  const mat = iceMaterial(`${name}Mat`, scene);
  mesh.material = mat;
  // Drawn after the body, its own facets sorted.
  mesh.alphaIndex = 10;
  return { mesh, mat, height: H, form };
}

/** See-through, glossy ice: bright white highlights on its facets, whiter at its edges. */
function iceMaterial(name: string, scene: Scene): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  // Lit mostly by the light (so each facet takes its own shade), barely by itself.
  m.diffuseColor = new Color3(0.4, 0.68, 1.0);
  m.emissiveColor = new Color3(0.02, 0.07, 0.17);
  m.specularColor = new Color3(1.3, 1.3, 1.3);
  m.specularPower = 40;
  m.alpha = ICE_ALPHA;
  // Its facets seen side-on glow white (the sheen of ice); face-on, nothing added.
  m.emissiveFresnelParameters = new FresnelParameters();
  m.emissiveFresnelParameters.leftColor = new Color3(0.55, 0.8, 1);
  m.emissiveFresnelParameters.rightColor = new Color3(0, 0, 0);
  m.emissiveFresnelParameters.power = 3;
  return m;
}

/**
 * The block shatters: its facets fly apart (out from its middle and up,
 * then down), spinning down to nothing as they go, the whole fading; resolves
 * when it is gone (and disposed).
 */
export function shatterIce(block: IceBlock, scene: Scene, seconds = 0.9): Promise<void> {
  const { mesh, mat, height: H } = block;
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!pos) { mesh.dispose(); mat.dispose(); return Promise.resolve(); }
  const base = Float32Array.from(pos);
  const n = base.length / 9; // triangles (flat-shaded: three vertices each, none shared)
  const shards = Array.from({ length: n }, (_, t) => {
    const o = t * 9;
    const c = new Vector3((base[o] + base[o + 3] + base[o + 6]) / 3, (base[o + 1] + base[o + 4] + base[o + 7]) / 3, (base[o + 2] + base[o + 5] + base[o + 8]) / 3);
    const out = new Vector3(c.x, 0, c.z);
    const len = out.length();
    if (len > 1e-4) out.scaleInPlace(1 / len);
    const speed = H * (1.2 + Math.random() * 1.6);
    const vel = out.scale(speed).addInPlace(new Vector3(0, H * (0.8 + 1.4 * Math.random()) * (0.4 + c.y / H), 0));
    return { o, c, vel, spin: (Math.random() - 0.5) * 12 };
  });
  const live = new Float32Array(base.length);
  const g = -9.8 * Math.max(0.4, H);
  const alpha0 = mat.alpha;
  let t = 0;
  return new Promise((resolve) => {
    const obs = scene.onBeforeRenderObservable.add(() => {
      t += Math.min(0.05, scene.getEngine().getDeltaTime() / 1000);
      const k = Math.min(1, t / seconds);
      for (const { o, c, vel, spin } of shards) {
        const shrink = 1 - k * 0.85;
        const cs = Math.cos(spin * t), sn = Math.sin(spin * t);
        const mx = c.x + vel.x * t, my = c.y + vel.y * t + 0.5 * g * t * t, mz = c.z + vel.z * t;
        for (let v = 0; v < 3; v++) {
          const j = o + v * 3;
          // Each shard turns about the vertical through its middle as it flies, and shrinks.
          const dx = (base[j] - c.x) * shrink, dy = (base[j + 1] - c.y) * shrink, dz = (base[j + 2] - c.z) * shrink;
          live[j] = mx + dx * cs - dz * sn;
          live[j + 1] = Math.max(-c.y * 0.2, my + dy);
          live[j + 2] = mz + dx * sn + dz * cs;
        }
      }
      mesh.updateVerticesData(VertexBuffer.PositionKind, live);
      mat.alpha = alpha0 * (1 - k * k);
      if (k >= 1) {
        scene.onBeforeRenderObservable.remove(obs);
        mesh.dispose();
        mat.dispose();
        resolve();
      }
    });
  });
}

/**
 * The block melts (a Fire move on it): it slumps back down onto the body
 * (its shape running back the way it formed) and clears, while a little steam
 * puffs off it — white wisps rising and spreading as they thin away. Resolves
 * when it is gone (and disposed); the steam drifts on a moment and goes.
 */
export function meltIce(block: IceBlock, scene: Scene, seconds = 1.0): Promise<void> {
  const { mesh, mat } = block;
  mesh.computeWorldMatrix(true);
  mesh.refreshBoundingInfo();
  const box = mesh.getBoundingInfo().boundingBox;
  const centre = box.centerWorld.clone(), half = box.extendSizeWorld.clone();
  const Hw = half.y * 2;
  // The steam: off the whole block, briefly.
  const ps = new ParticleSystem('iceSteam', 120, scene);
  ps.particleTexture = smokeTexture(scene);
  ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  ps.emitter = centre;
  ps.minEmitBox = new Vector3(-half.x * 0.8, -half.y * 0.6, -half.z * 0.8);
  ps.maxEmitBox = new Vector3(half.x * 0.8, half.y * 0.9, half.z * 0.8);
  ps.addColorGradient(0, new Color4(0.95, 0.97, 1, 0));
  ps.addColorGradient(0.15, new Color4(0.95, 0.97, 1, STEAM_ALPHA));
  ps.addColorGradient(1, new Color4(0.9, 0.92, 0.95, 0));
  ps.addSizeGradient(0, 0.18 * Hw);
  ps.addSizeGradient(1, 0.55 * Hw);
  ps.minLifeTime = 0.9;
  ps.maxLifeTime = 1.5;
  ps.emitRate = STEAM_RATE;
  ps.direction1 = new Vector3(-0.3, 1, -0.3);
  ps.direction2 = new Vector3(0.3, 1, 0.3);
  ps.minEmitPower = 0.5 * Hw;
  ps.maxEmitPower = 0.9 * Hw;
  ps.gravity = new Vector3(0, 0.3 * Hw, 0);
  ps.minAngularSpeed = -0.8;
  ps.maxAngularSpeed = 0.8;
  ps.minInitialRotation = 0;
  ps.maxInitialRotation = Math.PI * 2;
  ps.targetStopDuration = seconds * 0.7;
  ps.disposeOnStop = false;
  ps.start();
  // (Not disposing its texture: it is the shared, cached smoke.)
  setTimeout(() => ps.dispose(false), (seconds + 2) * 1000);
  const alpha0 = mat.alpha;
  let t = 0;
  return new Promise((resolve) => {
    const obs = scene.onBeforeRenderObservable.add(() => {
      t += Math.min(0.05, scene.getEngine().getDeltaTime() / 1000);
      const k = Math.min(1, t / seconds);
      block.form(1 - k * (2 - k));
      mat.alpha = alpha0 * (1 - Math.max(0, (k - 0.3) / 0.7));
      if (k >= 1) {
        scene.onBeforeRenderObservable.remove(obs);
        mesh.dispose();
        mat.dispose();
        resolve();
      }
    });
  });
}

/** The melt's steam: puffs a second while it lasts, and how opaque (just a little steam). */
const STEAM_RATE = 70, STEAM_ALPHA = 0.5;
