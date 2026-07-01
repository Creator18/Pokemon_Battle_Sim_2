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
// Side-effect import: registers MeshBuilder.CreateCapsule used by the stylized
// primitive fallbacks below (rounder limbs/bodies than plain cylinders).
import '@babylonjs/core/Meshes/Builders/capsuleBuilder';
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
  // Soft, slightly warm specular reads better on the rounded stylized shapes.
  m.specularColor = new Color3(0.12, 0.12, 0.12);
  m.specularPower = 48;
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

  /**
   * Create a charming eye: a dark pupil sphere plus a tiny white highlight,
   * grouped under a TransformNode positioned at `pos`. Both meshes cast shadows
   * via `add`. Returns the group node (parented under `parent`).
   */
  private addEye(
    parent: TransformNode,
    dark: StandardMaterial,
    highlight: StandardMaterial,
    pos: Vector3,
    size: number,
  ): TransformNode {
    const g = new TransformNode('eye', this.scene);
    g.parent = parent;
    g.position = pos;
    const pupil = MeshBuilder.CreateSphere('eye_pupil', { diameter: size, segments: 8 }, this.scene);
    this.add(g, pupil, dark, Vector3.Zero());
    const glint = MeshBuilder.CreateSphere('eye_glint', { diameter: size * 0.42, segments: 6 }, this.scene);
    this.add(g, glint, highlight, new Vector3(size * 0.18, size * 0.18, size * 0.38));
    return g;
  }

  private buildPikachu(b: TransformNode, accent: string): void {
    const yellow = solidMat(this.scene, 'pk_y', '#F8D030');
    const black = solidMat(this.scene, 'pk_k', '#2A2A2A');
    const red = solidMat(this.scene, 'pk_r', '#E03030', '#802020');
    const brown = solidMat(this.scene, 'pk_b', '#7A4A20');
    const white = solidMat(this.scene, 'pk_wt', '#FFFFFF');
    const nose = solidMat(this.scene, 'pk_n', '#1E1E1E');
    void accent;
    // Rounded pear body via a scaled sphere.
    const body = MeshBuilder.CreateSphere('pk_body', { diameter: 0.85, segments: 14 }, this.scene);
    body.scaling = new Vector3(1, 1.1, 0.95);
    this.add(b, body, yellow, new Vector3(0, 0.55, 0));
    // Two brown back stripes.
    for (const y of [0.62, 0.82]) {
      const stripe = MeshBuilder.CreateBox('pk_stripe', { width: 0.34, height: 0.06, depth: 0.05 }, this.scene);
      this.add(b, stripe, brown, new Vector3(0, y, -0.38));
    }
    const head = MeshBuilder.CreateSphere('pk_head', { diameter: 0.66, segments: 14 }, this.scene);
    head.scaling = new Vector3(1.05, 0.95, 1);
    this.add(b, head, yellow, new Vector3(0, 1.08, 0));
    // Defined snout + nose.
    const snout = MeshBuilder.CreateSphere('pk_snout', { diameter: 0.26, segments: 10 }, this.scene);
    snout.scaling = new Vector3(1.2, 0.8, 0.9);
    this.add(b, snout, yellow, new Vector3(0, 0.98, 0.3));
    const noseM = MeshBuilder.CreateSphere('pk_nose', { diameter: 0.07, segments: 6 }, this.scene);
    this.add(b, noseM, nose, new Vector3(0, 1.03, 0.42));
    // Ears: yellow taper with black tips.
    for (const s of [-1, 1]) {
      const ear = MeshBuilder.CreateCapsule('pk_ear', { radius: 0.08, height: 0.5, tessellation: 8 }, this.scene);
      ear.scaling = new Vector3(0.75, 1, 0.5);
      ear.rotation.z = s * 0.35;
      this.add(b, ear, yellow, new Vector3(s * 0.2, 1.52, -0.02));
      const tip = MeshBuilder.CreateCapsule('pk_eartip', { radius: 0.07, height: 0.2, tessellation: 8 }, this.scene);
      tip.scaling = new Vector3(0.75, 1, 0.5);
      tip.rotation.z = s * 0.35;
      this.add(b, tip, black, new Vector3(s * 0.27, 1.74, -0.02));
    }
    // Big red cheeks.
    for (const s of [-1, 1]) {
      const cheek = MeshBuilder.CreateSphere('pk_cheek', { diameter: 0.24, segments: 10 }, this.scene);
      cheek.scaling = new Vector3(1, 1, 0.6);
      this.add(b, cheek, red, new Vector3(s * 0.28, 0.98, 0.26));
    }
    // Eyes with pupil + highlight.
    for (const s of [-1, 1]) {
      this.addEye(b, black, white, new Vector3(s * 0.16, 1.16, 0.3), 0.13);
    }
    // Arms (short capsules).
    for (const s of [-1, 1]) {
      const arm = MeshBuilder.CreateCapsule('pk_arm', { radius: 0.07, height: 0.28, tessellation: 8 }, this.scene);
      arm.rotation.z = s * 0.7;
      this.add(b, arm, yellow, new Vector3(s * 0.4, 0.6, 0.08));
    }
    // Feet.
    for (const s of [-1, 1]) {
      const foot = MeshBuilder.CreateSphere('pk_foot', { diameter: 0.22, segments: 8 }, this.scene);
      foot.scaling = new Vector3(0.9, 0.6, 1.3);
      this.add(b, foot, yellow, new Vector3(s * 0.22, 0.15, 0.12));
    }
    // Lightning-bolt tail: wider zigzag from angled segments.
    const tail = new TransformNode('pk_tail', this.scene);
    tail.parent = b;
    tail.position = new Vector3(-0.42, 0.55, -0.15);
    const seg = (name: string, w: number, h: number, x: number, y: number, rz: number, mat: StandardMaterial): void => {
      const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: 0.07 }, this.scene);
      m.rotation.z = rz;
      this.add(tail, m, mat, new Vector3(x, y, 0));
    };
    seg('pk_tail1', 0.14, 0.24, 0, 0.02, 0.5, brown);
    seg('pk_tail2', 0.34, 0.14, -0.14, 0.24, -0.35, yellow);
    seg('pk_tail3', 0.16, 0.34, -0.02, 0.5, 0.55, yellow);
    seg('pk_tail4', 0.34, 0.15, 0.16, 0.72, -0.3, yellow);
  }

  private buildCharizard(b: TransformNode, accent: string): void {
    // Official palette: warm orange skin, cream underside, signature teal wing
    // membranes, off-white claws/horns, orange→yellow emissive tail flame.
    const orange = solidMat(this.scene, 'cz_o', '#E88A2D');
    const orangeDk = solidMat(this.scene, 'cz_od', '#D5761F');
    const cream = solidMat(this.scene, 'cz_c', '#F5E0B0');
    const wing = solidMat(this.scene, 'cz_w', '#2E8B84');
    const wingDk = solidMat(this.scene, 'cz_wd', '#2F7D75');
    const flame = solidMat(this.scene, 'cz_f', '#FF7A18', '#FF4400');
    const flameTip = solidMat(this.scene, 'cz_ft', '#FFD24A', '#FFB000');
    const black = solidMat(this.scene, 'cz_k', '#222');
    const white = solidMat(this.scene, 'cz_wt', '#FFFFFF');
    const claw = solidMat(this.scene, 'cz_cl', '#F2ECDC');
    void accent;

    // ── Torso: barrel chest, orange with a layered cream front panel ──
    const body = MeshBuilder.CreateSphere('cz_body', { diameter: 0.92, segments: 16 }, this.scene);
    body.scaling = new Vector3(1, 1.32, 0.92);
    this.add(b, body, orange, new Vector3(0, 0.78, 0));
    // Cream belly/chest panel — tall, sits proud of the orange so it reads
    // clearly from throat down to the lower belly.
    const belly = MeshBuilder.CreateSphere('cz_belly', { diameter: 0.62, segments: 14 }, this.scene);
    belly.scaling = new Vector3(0.84, 1.5, 0.62);
    this.add(b, belly, cream, new Vector3(0, 0.8, 0.27));

    // ── Neck: moderately long, orange, angled forward ──
    const neck = MeshBuilder.CreateCapsule('cz_neck', { radius: 0.16, height: 0.46, tessellation: 12 }, this.scene);
    neck.rotation.x = 0.4;
    this.add(b, neck, orange, new Vector3(0, 1.2, 0.06));

    // ── Head ──
    this.buildCharizardHead(b, { orange, cream, black, white });

    // ── Wings: large membranous focal point ──
    for (const s of [-1, 1]) this.buildCharizardWing(b, s, { orange, orangeDk, wing, wingDk, claw });

    // ── Arms: short, held forward, three white claws each ──
    for (const s of [-1, 1]) {
      const arm = MeshBuilder.CreateCapsule('cz_arm', { radius: 0.09, height: 0.34, tessellation: 8 }, this.scene);
      arm.rotation.z = s * 0.7;
      arm.rotation.x = -0.5;
      this.add(b, arm, orange, new Vector3(s * 0.4, 0.86, 0.18));
      for (const c of [-1, 0, 1]) {
        const cl = MeshBuilder.CreateCylinder('cz_claw', { diameterTop: 0, diameterBottom: 0.035, height: 0.12, tessellation: 6 }, this.scene);
        cl.rotation.x = -1.2;
        this.add(b, cl, claw, new Vector3(s * 0.46 + c * 0.05, 0.66, 0.42));
      }
    }

    // ── Legs: strong digitigrade hind legs, feet with three white toe-claws ──
    for (const s of [-1, 1]) {
      const thigh = MeshBuilder.CreateCapsule('cz_thigh', { radius: 0.15, height: 0.4, tessellation: 10 }, this.scene);
      thigh.scaling = new Vector3(1, 1, 0.9);
      this.add(b, thigh, orange, new Vector3(s * 0.26, 0.44, -0.02));
      const shin = MeshBuilder.CreateCapsule('cz_shin', { radius: 0.11, height: 0.32, tessellation: 8 }, this.scene);
      shin.rotation.x = 0.25;
      this.add(b, shin, orange, new Vector3(s * 0.26, 0.22, 0.08));
      const foot = MeshBuilder.CreateSphere('cz_footpad', { diameter: 0.22, segments: 8 }, this.scene);
      foot.scaling = new Vector3(1, 0.55, 1.4);
      this.add(b, foot, orange, new Vector3(s * 0.26, 0.09, 0.18));
      for (const c of [-1, 0, 1]) {
        const cl = MeshBuilder.CreateCylinder('cz_toeclaw', { diameterTop: 0, diameterBottom: 0.04, height: 0.11, tessellation: 6 }, this.scene);
        cl.rotation.x = -Math.PI / 2;
        this.add(b, cl, claw, new Vector3(s * 0.26 + c * 0.07, 0.06, 0.32));
      }
    }

    // ── Tail: thick base, tapering, curving up/back, flame at tip ──
    const tail1 = MeshBuilder.CreateCapsule('cz_tail1', { radius: 0.16, height: 0.5, tessellation: 10 }, this.scene);
    tail1.rotation.x = 1.15;
    this.add(b, tail1, orange, new Vector3(0, 0.5, -0.44));
    const tail2 = MeshBuilder.CreateCapsule('cz_tail2', { radius: 0.11, height: 0.5, tessellation: 8 }, this.scene);
    tail2.rotation.x = 0.15;
    this.add(b, tail2, orange, new Vector3(0, 0.42, -0.86));
    // Burning flame (orange base + yellow tip), tagged for the animation system.
    const fl = MeshBuilder.CreateSphere('cz_flame', { diameter: 0.34, segments: 10 }, this.scene);
    fl.scaling = new Vector3(1, 1.7, 1);
    this.add(b, fl, flame, new Vector3(0, 0.68, -1.06));
    fl.metadata = { flame: true };
    const flTip = MeshBuilder.CreateSphere('cz_flametip', { diameter: 0.17, segments: 8 }, this.scene);
    flTip.scaling = new Vector3(1, 1.9, 1);
    this.add(b, flTip, flameTip, new Vector3(0, 0.88, -1.06));
  }

  /** Charizard head group: rounded muzzle, nostrils, eyes, back-swept horns. */
  private buildCharizardHead(
    b: TransformNode,
    mats: { orange: StandardMaterial; cream: StandardMaterial; black: StandardMaterial; white: StandardMaterial },
  ): void {
    const { orange, cream, black, white } = mats;
    const head = MeshBuilder.CreateSphere('cz_head', { diameter: 0.5, segments: 14 }, this.scene);
    head.scaling = new Vector3(1, 0.92, 1.15);
    this.add(b, head, orange, new Vector3(0, 1.5, 0.14));
    // Rounded muzzle tapering forward with a slight upper-jaw overhang.
    // Rounded muzzle with a slight upper-jaw overhang toward the front.
    const snout = MeshBuilder.CreateSphere('cz_snout', { diameter: 0.34, segments: 12 }, this.scene);
    snout.scaling = new Vector3(0.85, 0.62, 1.5);
    this.add(b, snout, orange, new Vector3(0, 1.44, 0.46));
    // Nostrils.
    for (const s of [-1, 1]) {
      const nostril = MeshBuilder.CreateSphere('cz_nostril', { diameter: 0.05, segments: 6 }, this.scene);
      this.add(b, nostril, black, new Vector3(s * 0.06, 1.46, 0.62));
    }
    // Two horns sweeping BACKWARD off the back of the skull, slightly upturned.
    for (const s of [-1, 1]) {
      const horn = MeshBuilder.CreateCylinder('cz_horn', { diameterTop: 0, diameterBottom: 0.09, height: 0.34, tessellation: 6 }, this.scene);
      horn.rotation.x = 2.5; // point back and slightly up
      this.add(b, horn, cream, new Vector3(s * 0.14, 1.66, -0.14));
    }
    // Eyes.
    for (const s of [-1, 1]) {
      this.addEye(b, black, white, new Vector3(s * 0.14, 1.54, 0.4), 0.09);
    }
  }

  /**
   * One large membranous Charizard wing (side `s` = ±1). An orange leading-edge
   * "arm bone" (two tapered segments + a small elbow claw) sweeps up and out,
   * with a big teal membrane spanning below/behind it and scalloped trailing
   * points. Grouped under a TransformNode child of `b`.
   */
  private buildCharizardWing(
    b: TransformNode,
    s: number,
    mats: { orange: StandardMaterial; orangeDk: StandardMaterial; wing: StandardMaterial; wingDk: StandardMaterial; claw: StandardMaterial },
  ): void {
    const { orange, orangeDk, wing, wingDk, claw } = mats;
    const g = new TransformNode('cz_winggrp', this.scene);
    g.parent = b;
    g.position = new Vector3(s * 0.34, 1.12, -0.28);
    g.rotation.y = s * 0.7;
    g.rotation.z = s * 0.35;
    g.rotation.x = -0.2;

    // Leading-edge arm bone: upper segment (shoulder→elbow) then forearm.
    const upper = MeshBuilder.CreateCapsule('cz_wingbone1', { radius: 0.05, height: 0.7, tessellation: 8 }, this.scene);
    upper.rotation.z = s * -1.15;
    this.add(g, upper, orange, new Vector3(s * 0.3, 0.28, 0));
    const fore = MeshBuilder.CreateCapsule('cz_wingbone2', { radius: 0.04, height: 0.62, tessellation: 8 }, this.scene);
    fore.rotation.z = s * -0.5;
    this.add(g, fore, orangeDk, new Vector3(s * 0.72, 0.66, 0));
    // Small thumb-claw at the elbow bend.
    const elbowClaw = MeshBuilder.CreateCylinder('cz_wingclaw', { diameterTop: 0, diameterBottom: 0.05, height: 0.14, tessellation: 6 }, this.scene);
    elbowClaw.rotation.z = s * 0.9;
    this.add(g, elbowClaw, claw, new Vector3(s * 0.5, 0.62, 0));

    // Big teal membrane — thin flattened box spanning below/behind the bone.
    const membrane = MeshBuilder.CreateBox('cz_wing', { width: 1.1, height: 0.86, depth: 0.025 }, this.scene);
    this.add(g, membrane, wing, new Vector3(s * 0.5, 0.02, 0.01));
    // 2 shallow scallop points along the trailing (lower) edge; the darker
    // teal reads as the membrane's shaded underside between the fingers.
    for (const fx of [0.32, 0.78]) {
      const scallop = MeshBuilder.CreateCylinder('cz_scallop', { diameterTop: 0, diameterBottom: 0.34, height: 0.3, tessellation: 3 }, this.scene);
      scallop.scaling = new Vector3(1, 1, 0.12);
      scallop.rotation.x = Math.PI; // point downward
      this.add(g, scallop, wingDk, new Vector3(s * fx, -0.42, 0.01));
    }
  }

  private buildGardevoir(b: TransformNode, accent: string): void {
    const white = solidMat(this.scene, 'gv_w', '#F0F0F5');
    const green = solidMat(this.scene, 'gv_g', '#4CAF7D');
    const red = solidMat(this.scene, 'gv_r', '#D03050', '#701828');
    const dark = solidMat(this.scene, 'gv_k', '#3A2530');
    const glint = solidMat(this.scene, 'gv_wt', '#FFFFFF');
    void accent;
    // Flowing floor-length gown: layered cones for a smoother, tiered skirt.
    const skirt1 = MeshBuilder.CreateCylinder('gv_gown1', { diameterTop: 0.28, diameterBottom: 1.02, height: 0.7, tessellation: 16 }, this.scene);
    this.add(b, skirt1, white, new Vector3(0, 0.35, 0));
    const skirt2 = MeshBuilder.CreateCylinder('gv_gown2', { diameterTop: 0.32, diameterBottom: 0.78, height: 0.55, tessellation: 16 }, this.scene);
    this.add(b, skirt2, white, new Vector3(0, 0.72, 0));
    // Rounded skirt hem.
    const hem = MeshBuilder.CreateTorus('gv_hem', { diameter: 0.95, thickness: 0.12, tessellation: 16 }, this.scene);
    hem.scaling = new Vector3(1, 0.5, 1);
    this.add(b, hem, white, new Vector3(0, 0.06, 0));
    const torso = MeshBuilder.CreateSphere('gv_torso', { diameter: 0.4, segments: 12 }, this.scene);
    torso.scaling = new Vector3(0.9, 1.1, 0.85);
    this.add(b, torso, white, new Vector3(0, 1.02, 0));
    // Slender arms.
    for (const s of [-1, 1]) {
      const arm = MeshBuilder.CreateCapsule('gv_arm', { radius: 0.05, height: 0.5, tessellation: 8 }, this.scene);
      arm.rotation.z = s * 0.35;
      this.add(b, arm, white, new Vector3(s * 0.24, 0.9, 0.05));
    }
    // Smoother head.
    const head = MeshBuilder.CreateSphere('gv_head', { diameter: 0.36, segments: 14 }, this.scene);
    this.add(b, head, white, new Vector3(0, 1.36, 0.02));
    // Green hair framing the face (back helmet).
    const hair = MeshBuilder.CreateSphere('gv_hair', { diameter: 0.46, segments: 14 }, this.scene);
    hair.scaling = new Vector3(1.05, 1, 1.1);
    this.add(b, hair, green, new Vector3(0, 1.38, -0.06));
    // Two flowing side locks framing the face.
    for (const s of [-1, 1]) {
      const lock = MeshBuilder.CreateCapsule('gv_lock', { radius: 0.06, height: 0.5, tessellation: 8 }, this.scene);
      lock.rotation.z = s * 0.15;
      this.add(b, lock, green, new Vector3(s * 0.2, 1.18, 0.14));
    }
    // Bangs sweeping over the face.
    const bang = MeshBuilder.CreateSphere('gv_bang', { diameter: 0.34, segments: 10 }, this.scene);
    bang.scaling = new Vector3(1.1, 0.55, 0.8);
    this.add(b, bang, green, new Vector3(0, 1.48, 0.12));
    // Calm eyes.
    for (const s of [-1, 1]) {
      this.addEye(b, dark, glint, new Vector3(s * 0.1, 1.34, 0.19), 0.07);
    }
    // Red chest fin (front) and back fin.
    const finF = MeshBuilder.CreateCylinder('gv_finf', { diameterTop: 0, diameterBottom: 0.42, height: 0.55, tessellation: 3 }, this.scene);
    finF.rotation.x = Math.PI;
    this.add(b, finF, red, new Vector3(0, 0.92, 0.24));
    const finB = MeshBuilder.CreateCylinder('gv_finb', { diameterTop: 0, diameterBottom: 0.36, height: 0.48, tessellation: 3 }, this.scene);
    finB.rotation.x = Math.PI;
    this.add(b, finB, red, new Vector3(0, 0.92, -0.24));
  }

  private buildLucario(b: TransformNode, accent: string): void {
    const blue = solidMat(this.scene, 'lc_b', '#3A6FD0');
    const black = solidMat(this.scene, 'lc_k', '#2A2A38');
    const cream = solidMat(this.scene, 'lc_c', '#E8D8B0');
    const yellow = solidMat(this.scene, 'lc_y', '#F0C040');
    const red = solidMat(this.scene, 'lc_r', '#C03040', '#601018');
    const glint = solidMat(this.scene, 'lc_wt', '#FFFFFF');
    void accent;
    const body = MeshBuilder.CreateCapsule('lc_body', { radius: 0.28, height: 0.85, tessellation: 12 }, this.scene);
    body.scaling = new Vector3(0.95, 1, 0.8);
    this.add(b, body, blue, new Vector3(0, 0.85, 0));
    const chest = MeshBuilder.CreateSphere('lc_chest', { diameter: 0.42, segments: 12 }, this.scene);
    chest.scaling = new Vector3(0.85, 1.1, 0.5);
    this.add(b, chest, cream, new Vector3(0, 0.92, 0.22));
    // Chest spike.
    const chestSpike = MeshBuilder.CreateCylinder('lc_cspike', { diameterTop: 0, diameterBottom: 0.12, height: 0.22 }, this.scene);
    chestSpike.rotation.x = Math.PI / 2;
    this.add(b, chestSpike, black, new Vector3(0, 0.95, 0.4));
    const head = MeshBuilder.CreateSphere('lc_head', { diameter: 0.44, segments: 14 }, this.scene);
    head.scaling = new Vector3(1, 1, 1.2);
    this.add(b, head, blue, new Vector3(0, 1.42, 0.08));
    // Muzzle with nose.
    const muzzle = MeshBuilder.CreateCapsule('lc_muzzle', { radius: 0.1, height: 0.26, tessellation: 8 }, this.scene);
    muzzle.rotation.x = Math.PI / 2;
    this.add(b, muzzle, blue, new Vector3(0, 1.38, 0.34));
    const nose = MeshBuilder.CreateSphere('lc_nose', { diameter: 0.09, segments: 8 }, this.scene);
    this.add(b, nose, black, new Vector3(0, 1.4, 0.48));
    // Eyes.
    for (const s of [-1, 1]) {
      this.addEye(b, red, glint, new Vector3(s * 0.14, 1.48, 0.28), 0.08);
    }
    // Four black dreadlock sensors on the head.
    const dreads: Array<[number, number, number]> = [
      [-0.14, 1.66, -0.02],
      [0.14, 1.66, -0.02],
      [-0.16, 1.5, -0.18],
      [0.16, 1.5, -0.18],
    ];
    for (const [x, y, z] of dreads) {
      const dread = MeshBuilder.CreateCapsule('lc_dread', { radius: 0.05, height: 0.34, tessellation: 8 }, this.scene);
      dread.rotation.x = -0.6;
      dread.rotation.z = x < 0 ? 0.2 : -0.2;
      this.add(b, dread, black, new Vector3(x, y, z));
    }
    // Back spike.
    const backSpike = MeshBuilder.CreateCylinder('lc_bspike', { diameterTop: 0, diameterBottom: 0.13, height: 0.3 }, this.scene);
    backSpike.rotation.x = -Math.PI / 2;
    this.add(b, backSpike, black, new Vector3(0, 0.95, -0.32));
    // Digitigrade legs (thigh + shin capsules) + paws.
    for (const s of [-1, 1]) {
      const thigh = MeshBuilder.CreateCapsule('lc_thigh', { radius: 0.1, height: 0.32, tessellation: 8 }, this.scene);
      thigh.rotation.x = 0.5;
      this.add(b, thigh, blue, new Vector3(s * 0.18, 0.5, -0.02));
      const shin = MeshBuilder.CreateCapsule('lc_shin', { radius: 0.08, height: 0.3, tessellation: 8 }, this.scene);
      shin.rotation.x = -0.3;
      this.add(b, shin, blue, new Vector3(s * 0.18, 0.26, 0.08));
      const paw = MeshBuilder.CreateSphere('lc_paw', { diameter: 0.2, segments: 8 }, this.scene);
      paw.scaling = new Vector3(1, 0.6, 1.4);
      this.add(b, paw, black, new Vector3(s * 0.18, 0.09, 0.18));
    }
    // Arms + paw spikes.
    for (const s of [-1, 1]) {
      const arm = MeshBuilder.CreateCapsule('lc_arm', { radius: 0.08, height: 0.42, tessellation: 8 }, this.scene);
      arm.rotation.z = s * 0.35;
      this.add(b, arm, blue, new Vector3(s * 0.33, 0.82, 0.08));
      const paw = MeshBuilder.CreateSphere('lc_hand', { diameter: 0.16, segments: 8 }, this.scene);
      this.add(b, paw, black, new Vector3(s * 0.42, 0.62, 0.12));
      // Paw spike (back of hand).
      const spike = MeshBuilder.CreateCylinder('lc_hspike', { diameterTop: 0, diameterBottom: 0.08, height: 0.2 }, this.scene);
      spike.rotation.x = Math.PI / 2;
      this.add(b, spike, yellow, new Vector3(s * 0.42, 0.64, 0.24));
    }
    // Tail.
    const tail = MeshBuilder.CreateCapsule('lc_tail', { radius: 0.09, height: 0.4, tessellation: 8 }, this.scene);
    tail.rotation.x = -0.7;
    this.add(b, tail, blue, new Vector3(0, 0.55, -0.28));
  }

  private buildAbsol(b: TransformNode, accent: string): void {
    const white = solidMat(this.scene, 'ab_w', '#EDEDF0');
    const dark = solidMat(this.scene, 'ab_k', '#33333F');
    const red = solidMat(this.scene, 'ab_r', '#C02030', '#600810');
    const blade = solidMat(this.scene, 'ab_bl', '#3A3A46');
    const glint = solidMat(this.scene, 'ab_wt', '#FFFFFF');
    void accent;
    // Head faces +Z (forward); body extends back along -Z. Quadruped stance.
    const body = MeshBuilder.CreateCapsule('ab_body', { radius: 0.26, height: 0.85, tessellation: 12 }, this.scene);
    body.rotation.x = Math.PI / 2;
    body.scaling = new Vector3(1, 1, 0.85);
    this.add(b, body, white, new Vector3(0, 0.6, -0.2));
    // Four legs + paws.
    for (const sx of [-1, 1]) {
      for (const sz of [0.18, -0.55] as const) {
        const leg = MeshBuilder.CreateCapsule('ab_leg', { radius: 0.06, height: 0.42, tessellation: 8 }, this.scene);
        this.add(b, leg, dark, new Vector3(sx * 0.22, 0.24, sz));
        const paw = MeshBuilder.CreateSphere('ab_paw', { diameter: 0.14, segments: 8 }, this.scene);
        paw.scaling = new Vector3(1, 0.7, 1.2);
        this.add(b, paw, dark, new Vector3(sx * 0.22, 0.06, sz + 0.03));
      }
    }
    // Neck + head at front.
    const neck = MeshBuilder.CreateCapsule('ab_neck', { radius: 0.13, height: 0.3, tessellation: 8 }, this.scene);
    neck.rotation.x = 0.7;
    this.add(b, neck, white, new Vector3(0, 0.72, 0.28));
    const head = MeshBuilder.CreateSphere('ab_head', { diameter: 0.4, segments: 12 }, this.scene);
    head.scaling = new Vector3(1, 1, 1.2);
    this.add(b, head, white, new Vector3(0, 0.92, 0.48));
    // Snout.
    const snout = MeshBuilder.CreateSphere('ab_snout', { diameter: 0.2, segments: 8 }, this.scene);
    snout.scaling = new Vector3(0.9, 0.8, 1.3);
    this.add(b, snout, white, new Vector3(0, 0.86, 0.68));
    const nose = MeshBuilder.CreateSphere('ab_nose', { diameter: 0.06, segments: 6 }, this.scene);
    this.add(b, nose, dark, new Vector3(0, 0.88, 0.78));
    // Dark face-fur mane framing the head.
    const mane = MeshBuilder.CreateSphere('ab_mane', { diameter: 0.34, segments: 10 }, this.scene);
    mane.scaling = new Vector3(1.2, 1.1, 0.7);
    this.add(b, mane, dark, new Vector3(0, 0.98, 0.36));
    // Red eyes with pupil.
    for (const s of [-1, 1]) {
      this.addEye(b, red, glint, new Vector3(s * 0.13, 0.96, 0.6), 0.09);
    }
    // Signature single curved scythe-blade on the side of the head.
    const bladeGroup = new TransformNode('ab_bladegrp', this.scene);
    bladeGroup.parent = b;
    bladeGroup.position = new Vector3(0.16, 1.12, 0.4);
    bladeGroup.rotation.z = -0.5;
    // Built from tapered segments that arc, reading as a blade.
    const segs: Array<[number, number, number, number, number]> = [
      // x, y, z, len, rotZ
      [0.0, 0.0, 0, 0.3, 0.2],
      [0.14, 0.24, 0, 0.28, 0.6],
      [0.36, 0.38, 0, 0.26, 1.1],
    ];
    for (let i = 0; i < segs.length; i++) {
      const [x, y, z, len, rz] = segs[i];
      const s = MeshBuilder.CreateCylinder('ab_blade', { diameterTop: i === segs.length - 1 ? 0 : 0.1, diameterBottom: 0.14 - i * 0.03, height: len, tessellation: 6 }, this.scene);
      s.scaling = new Vector3(1, 1, 0.35);
      s.rotation.z = rz;
      this.add(bladeGroup, s, blade, new Vector3(x, y, z));
    }
    // Small back-of-head counter fin.
    const fin = MeshBuilder.CreateCylinder('ab_fin', { diameterTop: 0, diameterBottom: 0.14, height: 0.3, tessellation: 6 }, this.scene);
    fin.rotation.x = 2.4;
    this.add(b, fin, dark, new Vector3(0, 1.05, 0.2));
    // Tuft tail (fanned scythe-like tail).
    const tail = MeshBuilder.CreateCylinder('ab_tail', { diameterTop: 0, diameterBottom: 0.16, height: 0.55, tessellation: 6 }, this.scene);
    tail.scaling = new Vector3(1, 1, 0.4);
    tail.rotation.x = -1.0;
    this.add(b, tail, white, new Vector3(0, 0.75, -0.62));
  }

  private buildGengar(b: TransformNode, accent: string): void {
    const purple = solidMat(this.scene, 'gg_p', '#5A4478', '#1A0F2A');
    const dark = solidMat(this.scene, 'gg_k', '#2A2038');
    const white = solidMat(this.scene, 'gg_w', '#F0F0F0');
    const red = solidMat(this.scene, 'gg_r', '#B01020', '#500810');
    const pupil = solidMat(this.scene, 'gg_pu', '#1A0812');
    void accent;
    // Rounder crouched body.
    const body = MeshBuilder.CreateSphere('gg_body', { diameter: 1.0, segments: 16 }, this.scene);
    body.scaling = new Vector3(1.15, 0.85, 1);
    this.add(b, body, purple, new Vector3(0, 0.68, 0));
    // Head blends into body but slightly domed on top.
    const head = MeshBuilder.CreateSphere('gg_head', { diameter: 0.7, segments: 14 }, this.scene);
    head.scaling = new Vector3(1.1, 0.9, 1);
    this.add(b, head, purple, new Vector3(0, 0.92, 0.04));
    // Full row of back spikes (arched across the back).
    for (let i = 0; i < 7; i++) {
      const t = (i / 6) * 2 - 1; // -1..1
      const spike = MeshBuilder.CreateCylinder('gg_spike', { diameterTop: 0, diameterBottom: 0.16, height: 0.34, tessellation: 6 }, this.scene);
      spike.rotation.x = -Math.PI / 2 - 0.2;
      spike.rotation.z = -t * 0.4;
      this.add(b, spike, dark, new Vector3(t * 0.42, 1.05 - Math.abs(t) * 0.18, -0.4));
    }
    // Ear-like top spikes.
    for (const s of [-1, 1]) {
      const earSpike = MeshBuilder.CreateCylinder('gg_earspike', { diameterTop: 0, diameterBottom: 0.14, height: 0.3, tessellation: 6 }, this.scene);
      earSpike.rotation.z = s * 0.4;
      this.add(b, earSpike, purple, new Vector3(s * 0.3, 1.24, 0));
    }
    // Big toothy grin: upper + lower mouth with a few teeth.
    const mouth = MeshBuilder.CreateSphere('gg_mouth', { diameter: 0.42, segments: 12 }, this.scene);
    mouth.scaling = new Vector3(1.1, 0.5, 0.4);
    this.add(b, mouth, dark, new Vector3(0, 0.66, 0.44));
    for (const [row, yBase, dir] of [['up', 0.74, 1], ['lo', 0.58, -1]] as const) {
      for (const tx of [-0.14, -0.05, 0.05, 0.14]) {
        const tooth = MeshBuilder.CreateCylinder(`gg_tooth_${row}`, { diameterTop: 0, diameterBottom: 0.07, height: 0.12, tessellation: 4 }, this.scene);
        tooth.rotation.x = dir > 0 ? Math.PI : 0;
        this.add(b, tooth, white, new Vector3(tx, yBase, 0.5));
      }
    }
    // Red eyes with pupils.
    for (const s of [-1, 1]) {
      const eyeWhite = MeshBuilder.CreateSphere('gg_eyew', { diameter: 0.18, segments: 10 }, this.scene);
      this.add(b, eyeWhite, red, new Vector3(s * 0.22, 0.98, 0.36));
      const p = MeshBuilder.CreateSphere('gg_pupil', { diameter: 0.08, segments: 6 }, this.scene);
      this.add(b, p, pupil, new Vector3(s * 0.24, 0.96, 0.46));
    }
    // Stubby arms.
    for (const s of [-1, 1]) {
      const arm = MeshBuilder.CreateCapsule('gg_arm', { radius: 0.1, height: 0.24, tessellation: 8 }, this.scene);
      arm.rotation.z = s * 0.9;
      this.add(b, arm, purple, new Vector3(s * 0.5, 0.6, 0.05));
      const hand = MeshBuilder.CreateSphere('gg_hand', { diameter: 0.16, segments: 8 }, this.scene);
      this.add(b, hand, purple, new Vector3(s * 0.62, 0.5, 0.08));
    }
    // Stubby legs + feet.
    for (const s of [-1, 1]) {
      const leg = MeshBuilder.CreateCapsule('gg_leg', { radius: 0.11, height: 0.2, tessellation: 8 }, this.scene);
      this.add(b, leg, purple, new Vector3(s * 0.26, 0.32, 0.08));
      const foot = MeshBuilder.CreateSphere('gg_foot', { diameter: 0.22, segments: 8 }, this.scene);
      foot.scaling = new Vector3(1, 0.6, 1.3);
      this.add(b, foot, purple, new Vector3(s * 0.26, 0.2, 0.16));
    }
    // Float higher (Gengar hovers).
    b.position.y = 0.15;
  }

  private buildGeneric(b: TransformNode, accent: string): void {
    const m = solidMat(this.scene, 'gn_m', accent);
    const dark = solidMat(this.scene, 'gn_k', '#20202A');
    const white = solidMat(this.scene, 'gn_w', '#FFFFFF');
    // Rounded body + head so unknown species still read as a creature.
    const body = MeshBuilder.CreateSphere('gn_body', { diameter: 0.75, segments: 14 }, this.scene);
    body.scaling = new Vector3(1, 1.1, 0.95);
    this.add(b, body, m, new Vector3(0, 0.6, 0));
    const head = MeshBuilder.CreateSphere('gn_head', { diameter: 0.5, segments: 12 }, this.scene);
    this.add(b, head, m, new Vector3(0, 1.1, 0.02));
    for (const s of [-1, 1]) {
      this.addEye(b, dark, white, new Vector3(s * 0.13, 1.14, 0.22), 0.1);
      const arm = MeshBuilder.CreateCapsule('gn_arm', { radius: 0.07, height: 0.3, tessellation: 8 }, this.scene);
      arm.rotation.z = s * 0.6;
      this.add(b, arm, m, new Vector3(s * 0.34, 0.6, 0.05));
      const foot = MeshBuilder.CreateSphere('gn_foot', { diameter: 0.2, segments: 8 }, this.scene);
      foot.scaling = new Vector3(0.9, 0.6, 1.3);
      this.add(b, foot, m, new Vector3(s * 0.2, 0.14, 0.1));
    }
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
