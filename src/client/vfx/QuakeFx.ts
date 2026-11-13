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
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
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

/**
 * Stone Edge's pillars: how long one takes to burst up (s), how far past its height it overshoots, its stone's colour;
 * the chips flung off it (how many, how fast — × its height a second); how long it takes to crumble (s); its crack's
 * radius (× its width).
 */
const PILLAR_UP = 0.14, PILLAR_OVER = 0.12, PILLAR_COLOR = new Color3(0.6, 0.6, 0.63);
const PILLAR_CHIPS = 7, PILLAR_CHIP_SPEED = 3.2, PILLAR_DOWN = 0.45, PILLAR_CRACK = 1.5;

export interface PillarOptions {
  /** Where it stands (on the floor: x, z; the floor's height there), how tall and how wide (world units); its user's height. */
  x: number; z: number; floor: number; height: number; width: number; H: number;
  /** How long its crack shows before it bursts up (s). */
  tell: number;
  /** Its top each frame as it rises or sinks (world y) — its platform's. */
  onTop?: (top: number) => void;
}

export interface PillarHandle {
  /** Resolves as it has burst up through the floor (its hit). */
  up: Promise<void>;
  /** Shake it, about to go (its warning), for `seconds`. */
  warn(seconds: number): void;
  /** Crumble it: down into the floor in pieces. Resolves once it is gone. */
  crumble(): Promise<void>;
}

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

  /**
   * A Stone Edge pillar: a crack in the floor where it will come up (its tell), then it bursts up — a faceted, flat-topped
   * column of stone, sharp shards round its foot and its rim — overshooting a little, dust and chips flung off it; it
   * stands till crumbled (shaking first, warn), sinking back into the floor in pieces.
   */
  pillar(o: PillarOptions): PillarHandle {
    const scene = this.scene, h = o.height, w = o.width;
    const mat = (this.pillarMat ??= (() => {
      const m = new StandardMaterial('edgePillarMat', scene);
      m.diffuseColor = PILLAR_COLOR; m.specularColor = Color3.Black(); m.emissiveColor = PILLAR_COLOR.scale(0.3);
      return m;
    })());
    // Its body: a stout column of stone — seven-sided, a little narrower at its top, its sides knocked about in rough
    // facets (each ring of its corners pushed in or out its own way), its top flat to stand on.
    const ROWS = 4, SIDES = 7;
    const mesh = MeshBuilder.CreateCylinder('edgePillar', { height: h, diameterTop: w * 0.88, diameterBottom: w * 1.05, tessellation: SIDES, subdivisions: ROWS }, scene);
    const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    const bump = new Map<string, number>();
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      const r = Math.hypot(x, z);
      if (r < 1e-4) continue;
      // (The same corner — shared by its faces — knocked the same way: keyed by where it is.)
      const key = `${Math.round(Math.atan2(z, x) * 100)}:${Math.round(y * 100)}`;
      let k = bump.get(key);
      if (k === undefined) { k = 1 + (Math.random() - 0.5) * 0.16; bump.set(key, k); }
      pos[i] = x * k; pos[i + 2] = z * k;
    }
    mesh.updateVerticesData(VertexBuffer.PositionKind, pos);
    mesh.bakeTransformIntoVertices(Matrix.Translation(0, h / 2, 0));
    mesh.rotation.y = Math.random() * Math.PI;
    mesh.convertToFlatShadedMesh();
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.position.set(o.x, o.floor - h - 0.05, o.z);
    // Its tell: the floor cracking where it will come up.
    const crack = groundQuake();
    const t0 = performance.now();
    let upAt = -1, warnFrom = -1, warnFor = 0, downAt = -1, gone = false;
    let resolveUp!: () => void, resolveDown!: () => void;
    const up = new Promise<void>((r) => { resolveUp = r; });
    const down = new Promise<void>((r) => { resolveDown = r; });
    const chips: { inst: InstancedMesh; v: Vector3; spin: Vector3 }[] = [];
    const fling = (n: number, y: number) => {
      const bases = this.bases();
      for (let i = 0; i < n; i++) {
        const inst = bases[Math.floor(Math.random() * bases.length)].createInstance('edgeChip');
        inst.isPickable = false;
        inst.scaling.setAll(o.H * (0.06 + Math.random() * 0.08));
        const a = Math.random() * Math.PI * 2;
        inst.position.set(o.x + Math.cos(a) * w * 0.5, y, o.z + Math.sin(a) * w * 0.5);
        chips.push({ inst, v: new Vector3(Math.cos(a), 1.2 + Math.random(), Math.sin(a)).scale(PILLAR_CHIP_SPEED * o.H * (0.5 + Math.random() * 0.5)),
          spin: new Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8) });
      }
    };
    const tick = scene.onBeforeRenderObservable.add(() => {
      const t = (performance.now() - t0) / 1000;
      const dt = Math.min(0.05, scene.getEngine().getDeltaTime() / 1000);
      // The crack: opening through its tell, fading after.
      const cr = t < o.tell ? t / o.tell : Math.max(0, 1 - (t - o.tell) / 1.2);
      crack.set(o.x, o.z, w * PILLAR_CRACK, 0, w, cr, w * PILLAR_CRACK);
      let top = o.floor;
      if (downAt >= 0) {
        const k = Math.min(1, (t - downAt) / PILLAR_DOWN);
        mesh.position.y = o.floor - h * k * k - 0.05 * k;
        mesh.scaling.set(1 - 0.25 * k, 1, 1 - 0.25 * k);
        if (k >= 1 && !gone) { gone = true; mesh.setEnabled(false); }
      } else if (t >= o.tell) {
        if (upAt < 0) {
          upAt = t;
          this.puff(new Vector3(o.x, o.floor, o.z), 12, o.H);
          fling(PILLAR_CHIPS, o.floor + 0.1);
          resolveUp();
        }
        const k = Math.min(1, (t - upAt) / PILLAR_UP);
        // (Up with an overshoot, settling back: easeOutBack.)
        const c = 1 + PILLAR_OVER * 14;
        const e = 1 + c * Math.pow(k - 1, 3) + (c - 1) * Math.pow(k - 1, 2);
        mesh.position.y = o.floor - h + h * Math.min(e, 1 + PILLAR_OVER);
        top = o.floor + h * Math.max(0, Math.min(1, e));
        // (Shaking, about to go.)
        if (warnFrom >= 0 && t - warnFrom < warnFor) {
          const sh = 0.035 * o.H * (0.4 + 0.6 * (t - warnFrom) / warnFor);
          mesh.position.x = o.x + Math.sin(t * 61) * sh;
          mesh.position.z = o.z + Math.sin(t * 47 + 1) * sh * 0.5;
          if (Math.random() < 0.15) this.puff(new Vector3(o.x, o.floor + Math.random() * h * 0.7, o.z), 1, o.H * 0.5);
        }
      }
      o.onTop?.(top);
      for (let i = chips.length - 1; i >= 0; i--) {
        const c = chips[i];
        c.v.y -= 9.8 * dt;
        c.inst.position.addInPlace(c.v.scale(dt));
        c.inst.rotation.addInPlace(c.spin.scale(dt));
        if (c.inst.position.y < o.floor - 0.2) { c.inst.dispose(); chips.splice(i, 1); }
      }
      if (gone && !chips.length && cr <= 0) {
        scene.onBeforeRenderObservable.remove(tick);
        crack.dispose();
        mesh.dispose();
        resolveDown();
      }
    });
    return {
      up,
      warn: (seconds) => { warnFrom = (performance.now() - t0) / 1000; warnFor = seconds; },
      crumble: () => {
        if (downAt < 0) {
          downAt = (performance.now() - t0) / 1000;
          if (upAt < 0) { upAt = downAt; resolveUp(); }
          this.puff(new Vector3(o.x, o.floor, o.z), 10, o.H);
          fling(PILLAR_CHIPS + 3, o.floor + h * 0.5);
        }
        return down;
      },
    };
  }
  private pillarMat: StandardMaterial | null = null;

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
