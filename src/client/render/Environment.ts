/**
 * Environment — builds all NON-INTERACTIVE painterly scenery around the hex
 * arena: warm sandy battle floor, sage meadow ground, a framing ring of
 * stylized low-poly autumn trees, scattered mossy rocks / bushes / grass tufts
 * / fallen logs, a gradient sky dome, warm depth fog, and a gentle particle
 * system of drifting leaves + light motes.
 *
 * Everything built here is `isPickable = false` so it never intercepts tile
 * clicks. Meshes are shared/instanced and use a handful of shared materials to
 * keep draw calls low. Scatter is driven by a fixed-seed PRNG so the layout is
 * deterministic and never reshuffles.
 */

import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3, Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { GradientMaterial } from '@babylonjs/materials/gradient/gradientMaterial';

// Side-effect imports for the tree-shaken feature set.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import '@babylonjs/core/Particles/particleSystemComponent';

import { ENV, hexToRgb } from '../theme.ts';
import { flareTexture } from './textures.ts';

/** Tiny deterministic PRNG (mulberry32) so scatter is fixed per session. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function c3(hex: string): Color3 {
  const [r, g, b] = hexToRgb(hex);
  return new Color3(r, g, b);
}

export class Environment {
  private readonly scene: Scene;
  private readonly root: TransformNode;
  private readonly disposables: { dispose(): void }[] = [];
  private beforeRenderObs: ReturnType<Scene['onBeforeRenderObservable']['add']> | null = null;

  /**
   * @param scene       the battle scene
   * @param playRadius  world-space circumradius that encloses the 61 tiles.
   *                    Scenery is kept OUTSIDE this so it never overlaps tiles.
   */
  constructor(scene: Scene, playRadius = 10) {
    this.scene = scene;
    this.root = new TransformNode('environment', scene);
    const rng = makeRng(0x5eed1234);

    this.buildSky();
    this.buildGround(playRadius);
    this.buildArena(playRadius);
    const shared = this.buildSharedMaterials();
    this.buildTreeRing(rng, playRadius, shared);
    this.buildScatterProps(rng, playRadius, shared);
    this.buildAtmosphere();
  }

  // ── Sky dome + fog ──────────────────────────
  private buildSky(): void {
    const sky = MeshBuilder.CreateSphere('skyDome', { diameter: 400, segments: 16, sideOrientation: Mesh.BACKSIDE }, this.scene);
    sky.isPickable = false;
    sky.infiniteDistance = true;
    sky.parent = this.root;

    const gm = new GradientMaterial('skyMat', this.scene);
    gm.topColor = c3(ENV.skyTop);
    gm.bottomColor = c3(ENV.skyHorizon);
    gm.offset = 0.35;
    gm.smoothness = 1.4;
    gm.backFaceCulling = false;
    gm.disableLighting = true;
    sky.material = gm;
    this.disposables.push(gm, sky);

    // Warm depth haze: crisp arena, softly fading tree ring.
    this.scene.fogMode = Scene.FOGMODE_LINEAR;
    this.scene.fogColor = c3(ENV.fog);
    this.scene.fogStart = 16;
    this.scene.fogEnd = 52;
  }

  // ── Meadow ground ───────────────────────────
  private buildGround(playRadius: number): void {
    const ground = MeshBuilder.CreateDisc('meadow', { radius: playRadius * 6, tessellation: 64 }, this.scene);
    ground.rotation.x = Math.PI / 2; // lay flat
    ground.position.y = -0.02;
    ground.isPickable = false;
    ground.receiveShadows = true;
    ground.parent = this.root;

    const gm = new StandardMaterial('meadowMat', this.scene);
    gm.diffuseColor = c3(ENV.grass);
    gm.specularColor = new Color3(0, 0, 0);
    ground.material = gm;
    this.disposables.push(gm, ground);

    // A couple of tinted patches to break up flatness (non-shadow, slightly above).
    const patches: [number, number, number, string][] = [
      [-6, 8, 5, ENV.grassAlt],
      [9, -6, 6, ENV.grassDark],
      [-11, -10, 7, ENV.grassAlt],
      [14, 12, 8, ENV.grassDark],
    ];
    for (let i = 0; i < patches.length; i++) {
      const [x, z, rad, hex] = patches[i];
      const patch = MeshBuilder.CreateDisc(`patch${i}`, { radius: rad, tessellation: 24 }, this.scene);
      patch.rotation.x = Math.PI / 2;
      patch.position = new Vector3(x, -0.01, z);
      patch.isPickable = false;
      patch.receiveShadows = true;
      patch.parent = this.root;
      const pm = new StandardMaterial(`patchMat${i}`, this.scene);
      pm.diffuseColor = c3(hex);
      pm.specularColor = new Color3(0, 0, 0);
      pm.alpha = 0.7;
      patch.material = pm;
      this.disposables.push(pm, patch);
    }
  }

  // ── Battle arena floor (sandy → grass blend) ─
  private buildArena(playRadius: number): void {
    // Outer grassy rim ring.
    const rim = MeshBuilder.CreateCylinder('arenaRim', { diameter: (playRadius + 1.5) * 2, height: 0.16, tessellation: 64 }, this.scene);
    rim.position.y = 0.06;
    rim.isPickable = false;
    rim.receiveShadows = true;
    rim.parent = this.root;
    const rimMat = new StandardMaterial('arenaRimMat', this.scene);
    rimMat.diffuseColor = c3(ENV.dirtEdge);
    rimMat.specularColor = new Color3(0.02, 0.02, 0.02);
    rim.material = rimMat;
    this.disposables.push(rimMat, rim);

    // Inner sandy disc, vertex-colored to fade dirt(center) → dirtEdge(rim).
    const disc = MeshBuilder.CreateDisc('arenaFloor', { radius: playRadius, tessellation: 72 }, this.scene);
    disc.rotation.x = Math.PI / 2;
    disc.position.y = 0.12; // just below tile tops (tile top = 0.4)
    disc.isPickable = false;
    disc.receiveShadows = true;
    disc.parent = this.root;

    const center = c3(ENV.dirtCenter);
    const edge = c3(ENV.dirtEdge);
    const positions = disc.getVerticesData(VertexBuffer.PositionKind);
    if (positions) {
      const colors: number[] = [];
      for (let i = 0; i < positions.length; i += 3) {
        // Disc verts are in local XY (pre-rotation); radius = hypot(x,y).
        const rad = Math.hypot(positions[i], positions[i + 1]) / playRadius;
        const t = Math.min(1, rad);
        colors.push(
          center.r + (edge.r - center.r) * t,
          center.g + (edge.g - center.g) * t,
          center.b + (edge.b - center.b) * t,
          1,
        );
      }
      disc.setVerticesData(VertexBuffer.ColorKind, colors);
    }
    const arenaMat = new StandardMaterial('arenaFloorMat', this.scene);
    arenaMat.diffuseColor = new Color3(1, 1, 1);
    arenaMat.specularColor = new Color3(0.03, 0.03, 0.03);
    disc.material = arenaMat;
    disc.useVertexColors = true;
    this.disposables.push(arenaMat, disc);
  }

  // ── Shared materials (few, reused everywhere) ─
  private buildSharedMaterials(): {
    trunk: StandardMaterial;
    canopy: StandardMaterial[];
    rock: StandardMaterial;
    log: StandardMaterial;
    bush: StandardMaterial;
    tuft: StandardMaterial;
  } {
    const trunk = new StandardMaterial('envTrunk', this.scene);
    trunk.diffuseColor = c3(ENV.trunk);
    trunk.specularColor = new Color3(0, 0, 0);

    const canopy = ENV.canopy.map((hex, i) => {
      const m = new StandardMaterial(`envCanopy${i}`, this.scene);
      m.diffuseColor = c3(hex);
      m.specularColor = new Color3(0.02, 0.02, 0.02);
      // faint self-lit warmth so canopies read lush even in shadow
      const d = m.diffuseColor;
      m.emissiveColor = new Color3(d.r * 0.08, d.g * 0.08, d.b * 0.06);
      return m;
    });

    const rock = new StandardMaterial('envRock', this.scene);
    rock.diffuseColor = c3(ENV.rock);
    rock.specularColor = new Color3(0.05, 0.05, 0.05);

    const log = new StandardMaterial('envLog', this.scene);
    log.diffuseColor = c3(ENV.log);
    log.specularColor = new Color3(0, 0, 0);

    const bush = new StandardMaterial('envBush', this.scene);
    bush.diffuseColor = c3(ENV.bush);
    bush.specularColor = new Color3(0, 0, 0);

    const tuft = new StandardMaterial('envTuft', this.scene);
    tuft.diffuseColor = c3(ENV.grassAlt);
    tuft.specularColor = new Color3(0, 0, 0);

    const all = [trunk, ...canopy, rock, log, bush, tuft];
    for (const m of all) this.disposables.push(m);
    return { trunk, canopy, rock, log, bush, tuft };
  }

  /** Compose a thin-instance world matrix. */
  private static instMatrix(pos: Vector3, scale: Vector3, yaw: number, tilt = 0): Matrix {
    return Matrix.Compose(
      scale,
      Quaternion.RotationYawPitchRoll(yaw, tilt, 0),
      pos,
    );
  }

  // ── Tree ring (template meshes + thin instances) ─
  private buildTreeRing(
    rng: () => number,
    playRadius: number,
    shared: { trunk: StandardMaterial; canopy: StandardMaterial[] },
  ): void {
    // Template trunk (capsule-ish tapered cylinder), disabled; instanced via thin instances.
    const trunkTpl = MeshBuilder.CreateCylinder('treeTrunkTpl', { diameterTop: 0.28, diameterBottom: 0.42, height: 1.6, tessellation: 7 }, this.scene);
    trunkTpl.material = shared.trunk;
    trunkTpl.isPickable = false;
    trunkTpl.setEnabled(true);
    trunkTpl.parent = this.root;
    trunkTpl.receiveShadows = true;

    // One canopy template per autumn color (low-seg sphere = rounded blob).
    const canopyTpls = shared.canopy.map((mat, i) => {
      const s = MeshBuilder.CreateSphere(`canopyTpl${i}`, { diameter: 1, segments: 6 }, this.scene);
      s.material = mat;
      s.isPickable = false;
      s.parent = this.root;
      s.receiveShadows = true;
      return s;
    });

    const trunkMats: Matrix[] = [];
    const canopyMats: Matrix[][] = canopyTpls.map(() => []);

    // Two loose rings; outer ring denser + larger + a touch darker (uses later
    // colors in the palette which are the deeper greens) to frame the scene.
    const rings = [
      { r0: playRadius + 1.5, r1: playRadius + 4, count: 26, scale: [0.85, 1.25] as [number, number] },
      { r0: playRadius + 4, r1: playRadius + 8.5, count: 34, scale: [1.05, 1.7] as [number, number] },
    ];

    for (const ring of rings) {
      for (let i = 0; i < ring.count; i++) {
        const ang = (i / ring.count) * Math.PI * 2 + (rng() - 0.5) * 0.35;
        const rad = ring.r0 + rng() * (ring.r1 - ring.r0);
        const x = Math.cos(ang) * rad;
        const z = Math.sin(ang) * rad;
        const s = ring.scale[0] + rng() * (ring.scale[1] - ring.scale[0]);
        const yaw = rng() * Math.PI * 2;

        // Trunk sits with base on ground.
        const trunkH = 1.6 * s;
        trunkMats.push(Environment.instMatrix(new Vector3(x, trunkH / 2, z), new Vector3(s, s, s), yaw));

        // 1–3 stacked canopy blobs, random color, slight jitter.
        const blobs = 1 + Math.floor(rng() * 3);
        const colIdx = Math.floor(rng() * canopyTpls.length);
        let y = trunkH + 0.5 * s;
        for (let k = 0; k < blobs; k++) {
          const blobScale = s * (1.7 - k * 0.28) * (0.85 + rng() * 0.3);
          const jx = (rng() - 0.5) * 0.3 * s;
          const jz = (rng() - 0.5) * 0.3 * s;
          canopyMats[colIdx].push(
            Environment.instMatrix(new Vector3(x + jx, y, z + jz), new Vector3(blobScale, blobScale * 0.9, blobScale), rng() * Math.PI, (rng() - 0.5) * 0.15),
          );
          y += blobScale * 0.55;
        }
      }
    }

    this.applyThinInstances(trunkTpl, trunkMats);
    canopyTpls.forEach((tpl, i) => this.applyThinInstances(tpl, canopyMats[i]));

    this.registerShadowCaster(trunkTpl);
    canopyTpls.forEach((t) => this.registerShadowCaster(t));

    this.disposables.push(trunkTpl, ...canopyTpls);
  }

  // ── Scatter props: rocks, bushes, grass tufts, logs ─
  private buildScatterProps(
    rng: () => number,
    playRadius: number,
    shared: { rock: StandardMaterial; log: StandardMaterial; bush: StandardMaterial; tuft: StandardMaterial },
  ): void {
    // Rock/boulder template (chunky low-poly polyhedron).
    const rockTpl = MeshBuilder.CreatePolyhedron('rockTpl', { type: 1, size: 0.5 }, this.scene);
    rockTpl.material = shared.rock;
    rockTpl.isPickable = false;
    rockTpl.receiveShadows = true;
    rockTpl.parent = this.root;

    // Bush template (rounded blob).
    const bushTpl = MeshBuilder.CreateSphere('bushTpl', { diameter: 1, segments: 6 }, this.scene);
    bushTpl.material = shared.bush;
    bushTpl.isPickable = false;
    bushTpl.receiveShadows = true;
    bushTpl.parent = this.root;

    // Grass tuft template (tiny cone).
    const tuftTpl = MeshBuilder.CreateCylinder('tuftTpl', { diameterTop: 0, diameterBottom: 0.35, height: 0.5, tessellation: 5 }, this.scene);
    tuftTpl.material = shared.tuft;
    tuftTpl.isPickable = false;
    tuftTpl.parent = this.root;

    // Log template (long capsule).
    const logTpl = MeshBuilder.CreateCylinder('logTpl', { diameter: 0.4, height: 2.2, tessellation: 8 }, this.scene);
    logTpl.material = shared.log;
    logTpl.isPickable = false;
    logTpl.receiveShadows = true;
    logTpl.parent = this.root;

    const rockMats: Matrix[] = [];
    const bushMats: Matrix[] = [];
    const tuftMats: Matrix[] = [];
    const logMats: Matrix[] = [];

    // Scatter within an annulus [playRadius+1.5, playRadius+12], plus a handful
    // right at the arena edge.
    const inner = playRadius + 1.0;
    const outer = playRadius + 8;
    const scatter = (n: number, fn: (x: number, z: number) => void, near = false) => {
      for (let i = 0; i < n; i++) {
        const ang = rng() * Math.PI * 2;
        const rad = near ? playRadius + 0.6 + rng() * 1.2 : inner + rng() * (outer - inner);
        fn(Math.cos(ang) * rad, Math.sin(ang) * rad);
      }
    };

    scatter(22, (x, z) => {
      const s = 0.5 + rng() * 1.4;
      rockMats.push(Environment.instMatrix(new Vector3(x, s * 0.25, z), new Vector3(s, s * (0.6 + rng() * 0.4), s), rng() * Math.PI * 2, (rng() - 0.5) * 0.3));
    });
    scatter(4, (x, z) => {
      // small rocks near arena edge
      const s = 0.4 + rng() * 0.4;
      rockMats.push(Environment.instMatrix(new Vector3(x, s * 0.2, z), new Vector3(s, s * 0.6, s), rng() * Math.PI * 2, 0));
    }, true);

    scatter(20, (x, z) => {
      const s = 0.5 + rng() * 0.7;
      bushMats.push(Environment.instMatrix(new Vector3(x, s * 0.35, z), new Vector3(s, s * 0.7, s), rng() * Math.PI * 2));
    });

    scatter(48, (x, z) => {
      const s = 0.6 + rng() * 0.8;
      tuftMats.push(Environment.instMatrix(new Vector3(x, s * 0.25, z), new Vector3(s, s, s), rng() * Math.PI * 2, (rng() - 0.5) * 0.2));
    });
    scatter(10, (x, z) => {
      const s = 0.4 + rng() * 0.4;
      tuftMats.push(Environment.instMatrix(new Vector3(x, s * 0.2, z), new Vector3(s, s, s), rng() * Math.PI * 2, 0));
    }, true);

    // 2 fallen logs lying on their side.
    for (let i = 0; i < 2; i++) {
      const ang = (i === 0 ? 0.6 : 3.7) + (rng() - 0.5) * 0.4;
      const rad = inner + 1 + rng() * 3;
      const s = 0.9 + rng() * 0.5;
      logMats.push(
        Matrix.Compose(
          new Vector3(s, s, s),
          Quaternion.RotationYawPitchRoll(rng() * Math.PI * 2, 0, Math.PI / 2),
          new Vector3(Math.cos(ang) * rad, 0.2 * s, Math.sin(ang) * rad),
        ),
      );
    }

    this.applyThinInstances(rockTpl, rockMats);
    this.applyThinInstances(bushTpl, bushMats);
    this.applyThinInstances(tuftTpl, tuftMats);
    this.applyThinInstances(logTpl, logMats);

    this.registerShadowCaster(rockTpl);
    this.registerShadowCaster(bushTpl);
    this.registerShadowCaster(logTpl);

    this.disposables.push(rockTpl, bushTpl, tuftTpl, logTpl);
  }

  // ── Atmosphere: drifting leaves + light motes ─
  private buildAtmosphere(): void {
    const ps = new ParticleSystem('motes', 90, this.scene);
    ps.particleTexture = flareTexture(this.scene);
    ps.emitter = new Vector3(0, 6, 0);
    ps.minEmitBox = new Vector3(-14, -2, -14);
    ps.maxEmitBox = new Vector3(14, 4, 14);
    // Warm leaf / mote colors.
    ps.color1 = new Color4(0.95, 0.75, 0.35, 0.85);
    ps.color2 = new Color4(0.85, 0.55, 0.25, 0.7);
    ps.colorDead = new Color4(0.8, 0.6, 0.3, 0);
    ps.minSize = 0.08;
    ps.maxSize = 0.22;
    ps.minLifeTime = 5;
    ps.maxLifeTime = 10;
    ps.emitRate = 14;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    // Gentle downward + sideways drift.
    ps.direction1 = new Vector3(-0.4, -0.5, -0.4);
    ps.direction2 = new Vector3(0.4, -0.2, 0.4);
    ps.minEmitPower = 0.15;
    ps.maxEmitPower = 0.5;
    ps.gravity = new Vector3(0.2, -0.35, 0.1);
    ps.minAngularSpeed = -1.2;
    ps.maxAngularSpeed = 1.2;
    ps.start();
    this.disposables.push(ps);
  }

  // ── Helpers ─────────────────────────────────
  private applyThinInstances(mesh: Mesh, matrices: Matrix[]): void {
    if (matrices.length === 0) {
      mesh.setEnabled(false);
      return;
    }
    const buf = new Float32Array(matrices.length * 16);
    matrices.forEach((m, i) => m.copyToArray(buf, i * 16));
    mesh.thinInstanceSetBuffer('matrix', buf, 16, true);
    mesh.isPickable = false;
    mesh.thinInstanceEnablePicking = false;
  }

  private registerShadowCaster(mesh: Mesh): void {
    const gen = (this.scene.metadata as { shadowGen?: { addShadowCaster: (m: Mesh) => void } } | undefined)?.shadowGen;
    gen?.addShadowCaster(mesh);
  }

  /** Every environment mesh (for excluding from the tile-pick predicate). */
  environmentMeshes(): Mesh[] {
    return this.root.getChildMeshes(false) as Mesh[];
  }

  dispose(): void {
    if (this.beforeRenderObs) {
      this.scene.onBeforeRenderObservable.remove(this.beforeRenderObs);
      this.beforeRenderObs = null;
    }
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.root.dispose();
  }
}
