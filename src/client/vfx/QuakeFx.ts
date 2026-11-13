/**
 * Earthquake's wave: a stamp, and the ground heaving out from it radially, a ring on the floor out to its radius — an
 * area round the user (groundQuake: the floor and its grass lifted in a ring at the front, a trough behind, cracks
 * radiating out in its wake), rock chunks bursting up just behind the front at irregular spots over the disc — not in a
 * neat ring along it — and crumbling back down, dust kicked up where each breaks through (hiding where rock meets floor).
 */
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import '@babylonjs/core/Meshes/Builders/polyhedronBuilder';
import '@babylonjs/core/Meshes/instancedMesh';
import { smokeTexture } from '../render/textures.ts';
import { groundQuake } from './groundLight.ts';

/** The wave: how fast its front runs (× the user's height a second), how high it lifts (× its height), how wide its band (× its height). */
const SPEED = 9, LIFT = 0.16, WIDTH = 0.55;
/** How long its cracks take to open (s), and to fade once its front is out (s). */
const CRACK_IN = 0.25, CRACK_OUT = 1.4;
/** Its rocks: how many over its disc (per unit of its radius, in units of its height), their size (× its height); none nearer the camera than ROCK_NEAR (z, world units) — over the fighters' feet. */
const ROCK_DENSITY = 9, ROCK_SIZE: [number, number] = [0.12, 0.3], ROCK_NEAR = -0.5;
/** A rock's life: bursting up (s), standing (s), sinking back (s); how far behind the front it bursts (× the band's width). */
const ROCK_UP = 0.09, ROCK_HOLD = 0.3, ROCK_DOWN = 0.45, ROCK_BEHIND = 0.35;
const ROCK_COLOR = new Color3(0.45, 0.36, 0.27);

export interface QuakeOptions {
  /** Where it was stamped: on the floor, its x and z; the floor's height there. */
  x: number; z: number; floor: number;
  /** Its user's height (it all scales with it). */
  height: number;
  /** How far out it reaches, all round (world units). */
  radius: number;
  /** Its front now, each frame (world units out from x) — the hit's timing. */
  onFront?: (front: number) => void;
}

export class QuakeFx {
  private rockBases: Mesh[] | null = null;
  private dust: ParticleSystem | null = null;
  private dustAt: Vector3[] = [];
  constructor(private readonly scene: Scene) {}

  /** A few faceted rock shapes to stamp out: each a polyhedron, its corners pushed about, flat-shaded. */
  private bases(): Mesh[] {
    if (this.rockBases) return this.rockBases;
    const mat = new StandardMaterial('quakeRockMat', this.scene);
    mat.diffuseColor = ROCK_COLOR;
    mat.specularColor = Color3.Black();
    mat.emissiveColor = ROCK_COLOR.scale(0.35);
    this.rockBases = [1, 2, 3, 5].map((type, k) => {
      const m = MeshBuilder.CreatePolyhedron(`quakeRock${k}`, { type, size: 0.5 }, this.scene);
      const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
      for (let i = 0; i < pos.length; i += 3) {
        const s = 0.75 + 0.5 * Math.abs(Math.sin(pos[i] * 12.9898 + pos[i + 1] * 78.233 + pos[i + 2] * 37.719 + k) * 43758.5453 % 1);
        pos[i] *= s; pos[i + 1] *= s * 1.25; pos[i + 2] *= s;
      }
      m.updateVerticesData(VertexBuffer.PositionKind, pos);
      m.convertToFlatShadedMesh();
      m.material = mat;
      m.isPickable = false;
      // (Kept enabled — an instance shows only while its source does — but out of sight, far below the floor.)
      m.position.set(0, -1000, 0);
      return m;
    });
    return this.rockBases;
  }

  /** The dust: one system, its puffs started wherever a rock breaks through (dustAt). */
  private dustSystem(): ParticleSystem {
    if (this.dust) return this.dust;
    const ps = new ParticleSystem('quakeDust', 600, this.scene);
    ps.particleTexture = smokeTexture(this.scene);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.emitter = Vector3.Zero();
    ps.startPositionFunction = (_m, pos) => { const p = this.dustAt.shift(); if (p) pos.copyFrom(p); };
    ps.color1 = new Color4(0.78, 0.7, 0.56, 0.85);
    ps.color2 = new Color4(0.66, 0.58, 0.46, 0.8);
    ps.colorDead = new Color4(0.6, 0.55, 0.47, 0);
    ps.minLifeTime = 0.45; ps.maxLifeTime = 0.9;
    ps.direction1 = new Vector3(-0.8, 1.4, -0.4);
    ps.direction2 = new Vector3(0.8, 2.4, 0.6);
    ps.minEmitPower = 0.6; ps.maxEmitPower = 1.4;
    ps.gravity = new Vector3(0, -1.2, 0);
    ps.minAngularSpeed = -1; ps.maxAngularSpeed = 1;
    ps.emitRate = 0;
    ps.manualEmitCount = 0;
    ps.start();
    this.dust = ps;
    return ps;
  }

  /** Puffs of dust, `n` of them, at `at`, sized for a user `h` tall. */
  private puff(at: Vector3, n: number, h: number): void {
    const ps = this.dustSystem();
    ps.minSize = 0.25 * h; ps.maxSize = 0.55 * h;
    for (let i = 0; i < n; i++) this.dustAt.push(at.add(new Vector3((Math.random() - 0.5) * 0.25 * h, 0.05, (Math.random() - 0.5) * 0.25 * h)));
    ps.manualEmitCount = Math.max(0, ps.manualEmitCount) + n;
  }

  /** The quake: its wave run out to its reach each way, its rocks up and down, its dust; resolves once it has all settled. */
  quake(o: QuakeOptions): Promise<void> {
    const H = o.height, speed = SPEED * H, width = WIDTH * H;
    const far = o.radius;
    const wave = groundQuake();
    // Its rocks, laid out ahead of time: scattered over its disc (evenly by area, irregular), smaller further out —
    // none in front of the fighters' feet, nearer the camera.
    type Rock = { d: number; x: number; z: number; ux: number; size: number; at: number; inst: InstancedMesh | null; spin: Vector3; tilt: number };
    const rocks: Rock[] = [];
    const n = Math.round(ROCK_DENSITY * far / H);
    for (let i = 0; i < n * 3 && rocks.length < n; i++) {
      const d = Math.sqrt(Math.random()) * far, a = Math.random() * Math.PI * 2;
      if (d < 0.35 * H) continue;
      const x = o.x + Math.cos(a) * d, z = o.z + Math.sin(a) * d;
      if (z < o.z + ROCK_NEAR) continue;
      rocks.push({ d, x, z, ux: Math.cos(a), size: H * (ROCK_SIZE[0] + Math.random() * (ROCK_SIZE[1] - ROCK_SIZE[0])) * (1 - 0.45 * d / far),
        at: -1, inst: null, spin: new Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6), tilt: (Math.random() - 0.5) * 0.9 });
    }
    const bases = this.bases();
    this.puff(new Vector3(o.x, o.floor, o.z), 10, H);
    const t0 = performance.now();
    let outAt = -1;
    return new Promise((resolve) => {
      const tick = this.scene.onBeforeRenderObservable.add(() => {
        const t = (performance.now() - t0) / 1000;
        const front = Math.min(far + width * 2, speed * t);
        o.onFront?.(front);
        // Its lift: up at once, dying away as it runs out.
        const lift = LIFT * H * Math.min(1, t / 0.06) * Math.max(0, 1 - 0.65 * front / Math.max(far, 1e-3));
        if (front >= far + width * 2 && outAt < 0) outAt = t;
        const crack = Math.min(1, t / CRACK_IN) * (outAt < 0 ? 1 : Math.max(0, 1 - (t - outAt) / CRACK_OUT));
        wave.set(o.x, o.z, front, outAt < 0 ? lift : 0, width, crack, far);
        // Its rocks: each bursting up as the front passes it (a little behind it), standing, sinking back.
        let busy = false;
        for (const r of rocks) {
          if (r.at < 0 && front >= r.d + width * ROCK_BEHIND) {
            r.at = t;
            const inst = bases[Math.floor(Math.random() * bases.length)].createInstance('quakeRock');
            inst.isPickable = false;
            inst.rotation.copyFrom(r.spin);
            inst.scaling.setAll(r.size);
            r.inst = inst;
            this.puff(new Vector3(r.x, o.floor, r.z), 2, H);
          }
          if (r.at < 0) { busy = true; continue; }
          const k = t - r.at;
          if (!r.inst) continue;
          if (k > ROCK_UP + ROCK_HOLD + ROCK_DOWN) { r.inst.dispose(); r.inst = null; continue; }
          busy = true;
          const up = k < ROCK_UP ? k / ROCK_UP : k < ROCK_UP + ROCK_HOLD ? 1 : 1 - (k - ROCK_UP - ROCK_HOLD) / ROCK_DOWN;
          const e = up * up * (3 - 2 * up);
          // (Up out of the floor, leaning out the way the wave went; sinking, crumbling smaller.)
          r.inst.position.set(r.x, o.floor - r.size * 0.55 + e * r.size * 0.85, r.z);
          r.inst.rotation.z = r.spin.z + Math.sign(r.ux || 1) * r.tilt * e;
          r.inst.scaling.setAll(r.size * (k < ROCK_UP + ROCK_HOLD ? 1 : 0.55 + 0.45 * e));
        }
        if (!busy && outAt >= 0 && crack <= 0) {
          this.scene.onBeforeRenderObservable.remove(tick);
          wave.dispose();
          resolve();
        }
      });
    });
  }
}
