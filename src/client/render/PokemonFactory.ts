/**
 * PokemonFactory — builds a display node per species. First attempts to load
 * `assets/models/${speciesId}.glb`; on failure, falls back to a stylized
 * primitive model unique per species. Also owns animation helpers.
 *
 * To override a species with a real model: drop a GLB at
 * `public/assets/models/<speciesId>.glb` where <speciesId> is the lowercase
 * species name (e.g. `pikachu.glb`). It will be auto-loaded and centered;
 * the primitive fallback is skipped.
 */

import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { Animation } from '@babylonjs/core/Animations/animation';

import type { SpeciesDefinition } from '../../shared/index.ts';
import { typeColor, hexToRgb } from '../theme.ts';

function solidMat(scene: Scene, name: string, hex: string, emissive?: string): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  const [r, g, b] = hexToRgb(hex);
  m.diffuseColor = new Color3(r, g, b);
  m.specularColor = new Color3(0.15, 0.15, 0.15);
  if (emissive) {
    const [er, eg, eb] = hexToRgb(emissive);
    m.emissiveColor = new Color3(er, eg, eb);
  }
  return m;
}

export interface PokemonNodeMeta {
  species: string;
  playerId: number;
  facing: number;
  idle?: () => void;
}

export class PokemonFactory {
  private readonly scene: Scene;
  private shadowGen?: { addShadowCaster: (m: Mesh) => void };

  private loaderReady: Promise<boolean> | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
    this.shadowGen = (scene.metadata as { shadowGen?: { addShadowCaster: (m: Mesh) => void } } | undefined)?.shadowGen;
  }

  /**
   * Lazily register the glTF loader plugin if `@babylonjs/loaders` is available.
   * The package is optional: if it's not installed, GLB loading is skipped and
   * we fall back to stylized primitives. Kept as a dynamic import guarded by
   * try/catch so the client builds without the dependency.
   */
  private ensureGltfLoader(): Promise<boolean> {
    if (!this.loaderReady) {
      this.loaderReady = (async () => {
        try {
          // Optional dependency; specifier kept in a variable so the compiler
          // does not require the module to be present at build time.
          const spec = '@babylonjs/loaders/glTF';
          await import(/* @vite-ignore */ spec);
          return true;
        } catch {
          return false;
        }
      })();
    }
    return this.loaderReady;
  }

  private cast(mesh: Mesh): void {
    this.shadowGen?.addShadowCaster(mesh);
  }

  /** Build a display node for a species (async: tries GLB then primitives). */
  async createPokemon(species: SpeciesDefinition, playerId: number): Promise<TransformNode> {
    const root = new TransformNode(`poke_${species.name}_${playerId}`, this.scene);
    root.metadata = { species: species.name, playerId, facing: 0 } as PokemonNodeMeta;

    const url = `assets/models/${species.name.toLowerCase()}.glb`;
    let loaded = false;
    try {
      const hasLoader = await this.ensureGltfLoader();
      if (!hasLoader) throw new Error('glTF loader unavailable');
      const result = await SceneLoader.ImportMeshAsync('', '', url, this.scene);
      if (result.meshes.length > 0) {
        const container = new TransformNode(`glb_${species.name}`, this.scene);
        for (const m of result.meshes) {
          if (!m.parent) m.parent = container;
          if (m instanceof Mesh) this.cast(m);
        }
        container.parent = root;
        loaded = true;
      }
    } catch {
      loaded = false;
    }

    if (!loaded) this.buildPrimitive(species, root);

    this.addBlobShadow(root);
    this.addIdleBob(root);
    return root;
  }

  private addBlobShadow(root: TransformNode): void {
    const disc = MeshBuilder.CreateDisc('blob', { radius: 0.55, tessellation: 24 }, this.scene);
    disc.rotation.x = Math.PI / 2;
    disc.position.y = 0.02;
    const m = new StandardMaterial('blobmat', this.scene);
    m.diffuseColor = new Color3(0, 0, 0);
    m.specularColor = new Color3(0, 0, 0);
    m.alpha = 0.35;
    disc.material = m;
    disc.isPickable = false;
    disc.parent = root;
  }

  private addIdleBob(root: TransformNode): void {
    // Bob only the visual body (children except blob shadow at index handled by name).
    const body = root.getChildTransformNodes(true).find((n) => n.name.startsWith('body_'));
    const target = body ?? root;
    const baseY = target.position.y;
    let t = Math.random() * Math.PI * 2;
    this.scene.onBeforeRenderObservable.add(() => {
      t += this.scene.getEngine().getDeltaTime() / 1000;
      target.position.y = baseY + Math.sin(t * 2) * 0.05;
    });
  }

  private buildPrimitive(species: SpeciesDefinition, root: TransformNode): void {
    const body = new TransformNode(`body_${species.name}`, this.scene);
    body.parent = root;
    body.position.y = 0;
    const accent = typeColor(species.types[0] ?? 'Normal');
    switch (species.name) {
      case 'Pikachu':
        this.buildPikachu(body, accent);
        break;
      case 'Charizard':
        this.buildCharizard(body, accent);
        break;
      case 'Gardevoir':
        this.buildGardevoir(body, accent);
        break;
      case 'Lucario':
        this.buildLucario(body, accent);
        break;
      case 'Absol':
        this.buildAbsol(body, accent);
        break;
      case 'Gengar':
        this.buildGengar(body, accent);
        break;
      default:
        this.buildGeneric(body, accent);
    }
  }

  private add(parent: TransformNode, mesh: Mesh, mat: StandardMaterial, pos: Vector3): Mesh {
    mesh.material = mat;
    mesh.position = pos;
    mesh.parent = parent;
    this.cast(mesh);
    return mesh;
  }

  private buildPikachu(b: TransformNode, accent: string): void {
    const yellow = solidMat(this.scene, 'pk_y', '#F8D030');
    const black = solidMat(this.scene, 'pk_k', '#2A2A2A');
    const red = solidMat(this.scene, 'pk_r', '#E03030', '#802020');
    const brown = solidMat(this.scene, 'pk_b', '#7A4A20');
    void accent;
    const body = MeshBuilder.CreateSphere('pk_body', { diameter: 0.85, segments: 12 }, this.scene);
    body.scaling = new Vector3(1, 1.1, 0.95);
    this.add(b, body, yellow, new Vector3(0, 0.55, 0));
    const head = MeshBuilder.CreateSphere('pk_head', { diameter: 0.62, segments: 12 }, this.scene);
    this.add(b, head, yellow, new Vector3(0, 1.05, 0));
    // Ears
    for (const s of [-1, 1]) {
      const ear = MeshBuilder.CreateCylinder('pk_ear', { diameterTop: 0.03, diameterBottom: 0.16, height: 0.55, tessellation: 8 }, this.scene);
      ear.rotation.z = s * 0.35;
      this.add(b, ear, yellow, new Vector3(s * 0.18, 1.5, 0));
      const tip = MeshBuilder.CreateCylinder('pk_eartip', { diameterTop: 0.03, diameterBottom: 0.12, height: 0.18, tessellation: 8 }, this.scene);
      tip.rotation.z = s * 0.35;
      this.add(b, tip, black, new Vector3(s * 0.22, 1.72, 0));
    }
    // Cheeks
    for (const s of [-1, 1]) {
      const cheek = MeshBuilder.CreateSphere('pk_cheek', { diameter: 0.2 }, this.scene);
      this.add(b, cheek, red, new Vector3(s * 0.26, 0.98, 0.22));
    }
    // Eyes
    for (const s of [-1, 1]) {
      const eye = MeshBuilder.CreateSphere('pk_eye', { diameter: 0.1 }, this.scene);
      this.add(b, eye, black, new Vector3(s * 0.15, 1.12, 0.28));
    }
    // Lightning tail (angular boxes)
    const t1 = MeshBuilder.CreateBox('pk_tail1', { width: 0.12, height: 0.3, depth: 0.08 }, this.scene);
    t1.rotation.z = 0.6;
    this.add(b, t1, brown, new Vector3(-0.45, 0.6, -0.1));
    const t2 = MeshBuilder.CreateBox('pk_tail2', { width: 0.28, height: 0.12, depth: 0.08 }, this.scene);
    this.add(b, t2, yellow, new Vector3(-0.62, 0.85, -0.1));
  }

  private buildCharizard(b: TransformNode, accent: string): void {
    const orange = solidMat(this.scene, 'cz_o', '#F08030');
    const cream = solidMat(this.scene, 'cz_c', '#F5DEB3');
    const wing = solidMat(this.scene, 'cz_w', '#2E7D6E');
    const flame = solidMat(this.scene, 'cz_f', '#FF6A00', '#FF3D00');
    const black = solidMat(this.scene, 'cz_k', '#222');
    void accent;
    const body = MeshBuilder.CreateSphere('cz_body', { diameter: 0.9, segments: 12 }, this.scene);
    body.scaling = new Vector3(1, 1.3, 0.9);
    this.add(b, body, orange, new Vector3(0, 0.7, 0));
    const belly = MeshBuilder.CreateSphere('cz_belly', { diameter: 0.6 }, this.scene);
    belly.scaling = new Vector3(0.8, 1.2, 0.5);
    this.add(b, belly, cream, new Vector3(0, 0.65, 0.28));
    const head = MeshBuilder.CreateSphere('cz_head', { diameter: 0.5 }, this.scene);
    head.scaling = new Vector3(1, 0.9, 1.2);
    this.add(b, head, orange, new Vector3(0, 1.35, 0.1));
    // Horns
    for (const s of [-1, 1]) {
      const horn = MeshBuilder.CreateCylinder('cz_horn', { diameterTop: 0, diameterBottom: 0.08, height: 0.28 }, this.scene);
      horn.rotation.x = -0.4;
      this.add(b, horn, cream, new Vector3(s * 0.12, 1.6, -0.05));
    }
    for (const s of [-1, 1]) {
      const eye = MeshBuilder.CreateSphere('cz_eye', { diameter: 0.08 }, this.scene);
      this.add(b, eye, black, new Vector3(s * 0.13, 1.4, 0.35));
    }
    // Wings
    for (const s of [-1, 1]) {
      const w = MeshBuilder.CreateBox('cz_wing', { width: 0.9, height: 0.55, depth: 0.04 }, this.scene);
      w.rotation.y = s * 0.5;
      w.rotation.z = s * 0.2;
      this.add(b, w, wing, new Vector3(s * 0.7, 1.0, -0.35));
    }
    // Tail + flame
    const tail = MeshBuilder.CreateCylinder('cz_tail', { diameterTop: 0.12, diameterBottom: 0.22, height: 0.7 }, this.scene);
    tail.rotation.x = 0.9;
    this.add(b, tail, orange, new Vector3(0, 0.45, -0.5));
    const fl = MeshBuilder.CreateSphere('cz_flame', { diameter: 0.28 }, this.scene);
    fl.scaling = new Vector3(1, 1.6, 1);
    this.add(b, fl, flame, new Vector3(0, 0.6, -0.85));
    fl.metadata = { flame: true };
  }

  private buildGardevoir(b: TransformNode, accent: string): void {
    const white = solidMat(this.scene, 'gv_w', '#F0F0F5');
    const green = solidMat(this.scene, 'gv_g', '#4CAF7D');
    const red = solidMat(this.scene, 'gv_r', '#D03050', '#701828');
    void accent;
    // Gown (cone skirt)
    const gown = MeshBuilder.CreateCylinder('gv_gown', { diameterTop: 0.25, diameterBottom: 1.0, height: 1.0, tessellation: 16 }, this.scene);
    this.add(b, gown, white, new Vector3(0, 0.5, 0));
    const torso = MeshBuilder.CreateSphere('gv_torso', { diameter: 0.4 }, this.scene);
    this.add(b, torso, white, new Vector3(0, 1.05, 0));
    // Green hair-helmet
    const hair = MeshBuilder.CreateSphere('gv_hair', { diameter: 0.5 }, this.scene);
    hair.scaling = new Vector3(1, 1, 1.15);
    this.add(b, hair, green, new Vector3(0, 1.35, 0));
    const face = MeshBuilder.CreateSphere('gv_face', { diameter: 0.34 }, this.scene);
    this.add(b, face, white, new Vector3(0, 1.32, 0.14));
    // Red chest fin
    const fin = MeshBuilder.CreateCylinder('gv_fin', { diameterTop: 0, diameterBottom: 0.4, height: 0.5, tessellation: 3 }, this.scene);
    fin.rotation.x = Math.PI;
    this.add(b, fin, red, new Vector3(0, 0.95, 0.22));
    // Arm-hair sweeps
    for (const s of [-1, 1]) {
      const sweep = MeshBuilder.CreateCylinder('gv_sweep', { diameterTop: 0, diameterBottom: 0.18, height: 0.7 }, this.scene);
      sweep.rotation.z = s * 0.4;
      this.add(b, sweep, green, new Vector3(s * 0.32, 1.0, 0));
    }
  }

  private buildLucario(b: TransformNode, accent: string): void {
    const blue = solidMat(this.scene, 'lc_b', '#3A6FD0');
    const black = solidMat(this.scene, 'lc_k', '#2A2A38');
    const cream = solidMat(this.scene, 'lc_c', '#E8D8B0');
    void accent;
    const body = MeshBuilder.CreateSphere('lc_body', { diameter: 0.7 }, this.scene);
    body.scaling = new Vector3(0.85, 1.3, 0.7);
    this.add(b, body, blue, new Vector3(0, 0.75, 0));
    const chest = MeshBuilder.CreateSphere('lc_chest', { diameter: 0.45 }, this.scene);
    chest.scaling = new Vector3(0.8, 1, 0.5);
    this.add(b, chest, cream, new Vector3(0, 0.85, 0.22));
    const head = MeshBuilder.CreateSphere('lc_head', { diameter: 0.44 }, this.scene);
    head.scaling = new Vector3(1, 1, 1.25);
    this.add(b, head, blue, new Vector3(0, 1.4, 0.08));
    const muzzle = MeshBuilder.CreateCylinder('lc_muzzle', { diameterTop: 0.1, diameterBottom: 0.22, height: 0.24 }, this.scene);
    muzzle.rotation.x = Math.PI / 2;
    this.add(b, muzzle, black, new Vector3(0, 1.38, 0.32));
    // Ear appendages
    for (const s of [-1, 1]) {
      const ear = MeshBuilder.CreateCylinder('lc_ear', { diameterTop: 0.02, diameterBottom: 0.12, height: 0.4 }, this.scene);
      ear.rotation.z = s * 0.3;
      this.add(b, ear, black, new Vector3(s * 0.16, 1.7, 0));
    }
    // Back spikes + hand spikes
    const backSpike = MeshBuilder.CreateCylinder('lc_bspike', { diameterTop: 0, diameterBottom: 0.12, height: 0.3 }, this.scene);
    backSpike.rotation.x = -Math.PI / 2;
    this.add(b, backSpike, black, new Vector3(0, 0.9, -0.35));
    for (const s of [-1, 1]) {
      const hand = MeshBuilder.CreateCylinder('lc_hspike', { diameterTop: 0, diameterBottom: 0.09, height: 0.22 }, this.scene);
      hand.rotation.x = Math.PI / 2;
      this.add(b, hand, black, new Vector3(s * 0.32, 0.7, 0.15));
    }
  }

  private buildAbsol(b: TransformNode, accent: string): void {
    const white = solidMat(this.scene, 'ab_w', '#EDEDF0');
    const dark = solidMat(this.scene, 'ab_k', '#33333F');
    const red = solidMat(this.scene, 'ab_r', '#C02030', '#600810');
    void accent;
    // Quadruped body
    const body = MeshBuilder.CreateSphere('ab_body', { diameter: 0.6 }, this.scene);
    body.scaling = new Vector3(1.6, 0.9, 0.8);
    this.add(b, body, white, new Vector3(0, 0.55, 0));
    // Legs
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = MeshBuilder.CreateCylinder('ab_leg', { diameter: 0.12, height: 0.4 }, this.scene);
        this.add(b, leg, dark, new Vector3(sx * 0.35, 0.2, sz * 0.22));
      }
    }
    const head = MeshBuilder.CreateSphere('ab_head', { diameter: 0.42 }, this.scene);
    head.scaling = new Vector3(1, 1, 1.2);
    this.add(b, head, dark, new Vector3(0.55, 0.75, 0));
    const faceWhite = MeshBuilder.CreateSphere('ab_facew', { diameter: 0.3 }, this.scene);
    this.add(b, faceWhite, white, new Vector3(0.62, 0.8, 0));
    // Curved scythe-horn
    const horn = MeshBuilder.CreateTorus('ab_horn', { diameter: 0.55, thickness: 0.09, tessellation: 12 }, this.scene);
    horn.scaling = new Vector3(1, 1, 0.4);
    horn.rotation.z = Math.PI / 2;
    this.add(b, horn, white, new Vector3(0.55, 1.05, -0.2));
    // Red eye
    const eye = MeshBuilder.CreateSphere('ab_eye', { diameter: 0.1 }, this.scene);
    this.add(b, eye, red, new Vector3(0.72, 0.82, 0.18));
    // Tail
    const tail = MeshBuilder.CreateCylinder('ab_tail', { diameterTop: 0, diameterBottom: 0.14, height: 0.5 }, this.scene);
    tail.rotation.z = Math.PI / 2.5;
    this.add(b, tail, white, new Vector3(-0.55, 0.6, 0));
  }

  private buildGengar(b: TransformNode, accent: string): void {
    const purple = solidMat(this.scene, 'gg_p', '#5A4478', '#1A0F2A');
    const dark = solidMat(this.scene, 'gg_k', '#2A2038');
    const white = solidMat(this.scene, 'gg_w', '#F0F0F0');
    const red = solidMat(this.scene, 'gg_r', '#B01020', '#500810');
    void accent;
    const body = MeshBuilder.CreateSphere('gg_body', { diameter: 0.95, segments: 14 }, this.scene);
    body.scaling = new Vector3(1.1, 0.95, 1);
    this.add(b, body, purple, new Vector3(0, 0.75, 0));
    // Spiky back cones
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI - Math.PI / 2;
      const spike = MeshBuilder.CreateCylinder('gg_spike', { diameterTop: 0, diameterBottom: 0.14, height: 0.3 }, this.scene);
      spike.rotation.x = -Math.PI / 2 + Math.sin(ang) * 0.3;
      this.add(b, spike, dark, new Vector3(Math.cos(ang) * 0.35, 1.0 + Math.abs(Math.sin(ang)) * 0.1, -0.35));
    }
    // Wide grin
    const grin = MeshBuilder.CreateTorus('gg_grin', { diameter: 0.4, thickness: 0.06, tessellation: 16 }, this.scene);
    grin.scaling = new Vector3(1, 0.5, 0.3);
    this.add(b, grin, white, new Vector3(0, 0.62, 0.42));
    for (const s of [-1, 1]) {
      const eye = MeshBuilder.CreateSphere('gg_eye', { diameter: 0.16 }, this.scene);
      this.add(b, eye, red, new Vector3(s * 0.22, 0.9, 0.38));
    }
    // Legs stubs
    for (const s of [-1, 1]) {
      const foot = MeshBuilder.CreateSphere('gg_foot', { diameter: 0.2 }, this.scene);
      this.add(b, foot, purple, new Vector3(s * 0.25, 0.3, 0.1));
    }
    // Float higher (Gengar hovers)
    b.position.y = 0.15;
  }

  private buildGeneric(b: TransformNode, accent: string): void {
    const m = solidMat(this.scene, 'gn_m', accent);
    const body = MeshBuilder.CreateSphere('gn_body', { diameter: 0.8 }, this.scene);
    this.add(b, body, m, new Vector3(0, 0.6, 0));
  }

  // ── Animation helpers ─────────────────────
  private animateVec(node: TransformNode, prop: 'position', to: Vector3, frames: number, onEnd?: () => void): void {
    const anim = new Animation(`anim_${prop}_${node.name}_${Math.random()}`, prop, 60, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
    const cur = (node[prop] as Vector3).clone();
    anim.setKeys([{ frame: 0, value: cur }, { frame: frames, value: to }]);
    this.scene.beginDirectAnimation(node, [anim], 0, frames, false, 1, onEnd);
  }

  /** Tween a unit along a world-space path (list of tile-top positions). */
  playMoveTo(node: TransformNode, worldPath: Vector3[]): Promise<void> {
    return new Promise((resolve) => {
      if (worldPath.length === 0) return resolve();
      let i = 0;
      const step = () => {
        if (i >= worldPath.length) return resolve();
        const target = worldPath[i];
        this.setFacing(node, Math.atan2(target.x - node.position.x, target.z - node.position.z));
        this.animateVec(node, 'position', new Vector3(target.x, node.position.y, target.z), 12, () => {
          i++;
          step();
        });
      };
      step();
    });
  }

  playAttackLunge(node: TransformNode, targetPos: Vector3): Promise<void> {
    return new Promise((resolve) => {
      const start = node.position.clone();
      const dir = targetPos.subtract(start);
      dir.y = 0;
      dir.normalize();
      this.setFacing(node, Math.atan2(dir.x, dir.z));
      const lungePos = start.add(dir.scale(0.5));
      this.animateVec(node, 'position', lungePos, 6, () => {
        this.animateVec(node, 'position', start, 8, () => resolve());
      });
    });
  }

  playHitReact(node: TransformNode): Promise<void> {
    return new Promise((resolve) => {
      const body = node.getChildTransformNodes(true).find((n) => n.name.startsWith('body_')) ?? node;
      const orig = body.scaling.clone();
      const anim = new Animation('hit', 'scaling', 60, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
      anim.setKeys([
        { frame: 0, value: orig },
        { frame: 4, value: orig.scale(0.82) },
        { frame: 10, value: orig },
      ]);
      this.scene.beginDirectAnimation(body, [anim], 0, 10, false, 1, () => resolve());
    });
  }

  playFaint(node: TransformNode): Promise<void> {
    return new Promise((resolve) => {
      const anim = new Animation('faint', 'scaling', 60, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
      const cur = node.scaling.clone();
      anim.setKeys([{ frame: 0, value: cur }, { frame: 18, value: new Vector3(0.01, 0.01, 0.01) }]);
      const rot = new Animation('faintrot', 'rotation.x', 60, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
      rot.setKeys([{ frame: 0, value: node.rotation.x }, { frame: 18, value: Math.PI / 2 }]);
      this.scene.beginDirectAnimation(node, [anim, rot], 0, 18, false, 1, () => {
        node.setEnabled(false);
        resolve();
      });
    });
  }

  revive(node: TransformNode): void {
    node.setEnabled(true);
    node.scaling = new Vector3(1, 1, 1);
    node.rotation.x = 0;
  }

  setFacing(node: TransformNode, dir: number): void {
    node.rotation.y = dir;
    (node.metadata as PokemonNodeMeta).facing = dir;
  }
}
