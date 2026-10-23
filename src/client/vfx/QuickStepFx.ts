/**
 * QuickStepFx — the pieces of a quick step (Quick Attack): the user vanishes
 * in a small hemisphere burst behind it (its dome toward where it is going)
 * and a kick of dust, crosses as streaks of speed with afterimages of its pose
 * (in its own colours, see-through) left fading behind it, and lands its blow
 * in a larger hemisphere burst at the contact point — the bursts in the
 * move's type colour.
 */

import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { Constants } from '@babylonjs/core/Engines/constants';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';

import { smokeTexture } from '../render/textures.ts';

/** The look: a cool white. */
const GLOW = new Color3(0.9, 0.95, 1.0);
/** An afterimage's opacity as it is left, and how long it takes to fade (s). */
const GHOST_ALPHA = 0.95, GHOST_LIFE = 0.45;
/**
 * Afterimages are drawn after everything else (their own rendering group,
 * the depth kept), each behind a depth-only twin of itself: so only its
 * nearest surface shows, see-through — not its insides (the eyes behind its
 * eyelids, the inside of its mouth, its far side) through its skin.
 */
const GHOST_GROUP = 1;
/** A hemisphere burst: how long it lasts (s), and how far it swells past its size. */
const BURST_LIFE = 0.3, BURST_SWELL = 1.6;
/** Speed streaks: how many, and how long they linger after the dash (s). */
const STREAKS = 12, STREAK_LIFE = 0.3;
/** Of them, how many are heavy, through the body's middle. */
const STREAK_HEAVY = 3;

const Y = new Vector3(0, 1, 0);

/** A glowing, see-through, additive material. */
function glowMat(scene: Scene, name: string, alpha: number): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.emissiveColor = GLOW;
  m.alpha = alpha;
  m.alphaMode = Constants.ALPHA_ADD;
  m.disableDepthWrite = true;
  m.backFaceCulling = false;
  return m;
}

/** Runs `step(k)` for k 0 → 1 over `seconds`, then `end`. */
function over(scene: Scene, seconds: number, step: (k: number) => void, end: () => void): void {
  let t = 0;
  const obs = scene.onBeforeRenderObservable.add(() => {
    t += Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
    const k = Math.min(1, t / seconds);
    step(k);
    if (k >= 1) { scene.onBeforeRenderObservable.remove(obs); end(); }
  });
}

export class QuickStepFx {
  /**
   * What an afterimage's twin is drawn with: depth only, exactly where its
   * surface is (the same skinning: equal depths, its own surface passes) —
   * no offset, which would let its insides, a hair behind, through.
   */
  private depthOnly: StandardMaterial | null = null;

  constructor(private readonly scene: Scene) {}

  /**
   * An afterimage: copies of the body's meshes held in its pose of the moment
   * (the factory's: they wear its very materials and textures), see-through,
   * fading out from `alpha`; `dispose` once gone (their frozen skeleton).
   */
  ghost(copies: Mesh[], dispose: () => void, alpha = GHOST_ALPHA): void {
    if (!this.depthOnly) {
      const m = (this.depthOnly = new StandardMaterial('ghostDepth', this.scene));
      m.disableColorWrite = true;
      m.disableLighting = true;
      m.backFaceCulling = false;
      // (Its group draws over what came before, the depth left as it is.)
      this.scene.setRenderingAutoClearDepthStencil(GHOST_GROUP, false, false, false);
    }
    // (A flame needs none: it has no insides to hide, and burns see-through.)
    const flame = (c: Mesh) => {
      const m = c.material as { name?: string; subMaterials?: ({ name: string } | null)[] } | null;
      return !!m && (/^bodyFlame/.test(m.name ?? '') || !!m.subMaterials?.some((s) => !!s && /^bodyFlame/.test(s.name)));
    };
    const twins = copies.filter((c) => !flame(c)).map((c) => {
      const t = c.clone(`${c.name}Depth`, null) as Mesh;
      t.material = this.depthOnly;
      t.isPickable = false;
      t.renderingGroupId = GHOST_GROUP;
      return t;
    });
    for (const c of copies) c.renderingGroupId = GHOST_GROUP;
    for (const c of copies) c.visibility = alpha;
    over(this.scene, GHOST_LIFE, (k) => { for (const c of copies) c.visibility = alpha * (1 - k * k); },
      () => { for (const c of copies) c.dispose(); for (const t of twins) t.dispose(); dispose(); });
  }

  /**
   * A hemisphere burst at `at`, `size` across, its dome facing `dir` (the way
   * the dash goes): it swells out and fades, in `color` (the move's type).
   */
  hemisphere(at: Vector3, dir: Vector3, size: number, color: Color3): void {
    const dome = MeshBuilder.CreateSphere('qsBurst', { diameter: 1, segments: 18, slice: 0.5 }, this.scene);
    dome.isPickable = false;
    // The sphere's slice keeps its top half (+y): turn +y to `dir`.
    const turn = new Quaternion();
    Quaternion.FromUnitVectorsToRef(Y, dir.normalizeToNew(), turn);
    dome.rotationQuaternion = turn;
    dome.position.copyFrom(at);
    const m = glowMat(this.scene, 'qsBurstMat', 0.85);
    m.emissiveColor = color;
    dome.material = m;
    // A brighter inner shell, smaller, for the core of the flash.
    const core = dome.clone('qsBurstCore') as Mesh;
    const cm = glowMat(this.scene, 'qsBurstCoreMat', 0.7);
    cm.emissiveColor = Color3.Lerp(color, GLOW, 0.6);
    core.material = cm;
    over(this.scene, BURST_LIFE, (k) => {
      const e = 1 - (1 - k) * (1 - k) * (1 - k);
      dome.scaling.setAll(Math.max(1e-3, size * (0.35 + (BURST_SWELL - 0.35) * e)));
      core.scaling.setAll(Math.max(1e-3, size * (0.2 + 0.7 * e)));
      m.alpha = 0.85 * (1 - k) * (1 - k);
      cm.alpha = 0.7 * (1 - k) * (1 - k) * (1 - k);
    }, () => { dome.dispose(); m.dispose(); core.dispose(); cm.dispose(); });
  }

  /** A kick of dust at the feet as it goes (or lands). */
  dust(at: Vector3, height: number): void {
    const ps = new ParticleSystem('qsDust', 60, this.scene);
    ps.particleTexture = smokeTexture(this.scene);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.emitter = at.clone();
    ps.minEmitBox = new Vector3(-0.2, 0, -0.2).scale(height); ps.maxEmitBox = new Vector3(0.2, 0.05, 0.2).scale(height);
    ps.color1 = new Color4(0.85, 0.78, 0.62, 0.6); ps.color2 = new Color4(0.75, 0.68, 0.52, 0.45);
    ps.colorDead = new Color4(0.75, 0.68, 0.52, 0);
    ps.minSize = 0.2 * height; ps.maxSize = 0.45 * height;
    ps.minLifeTime = 0.35; ps.maxLifeTime = 0.6;
    ps.direction1 = new Vector3(-1, 0.3, -1); ps.direction2 = new Vector3(1, 0.8, 1);
    ps.minEmitPower = 0.6 * height; ps.maxEmitPower = 1.4 * height;
    ps.manualEmitCount = 24;
    ps.disposeOnStop = true;
    ps.targetStopDuration = 0.7;
    ps.start();
  }

  /**
   * Speed streaks from `from` to `to`: thin lines at heights across the body,
   * drawn out with the dash over `seconds`, lingering and fading after.
   */
  streaks(from: Vector3, to: Vector3, height: number, seconds: number): void {
    const d = to.subtract(from);
    const len = d.length();
    if (len < 1e-3) return;
    const dir = d.scale(1 / len);
    const side = Vector3.Cross(Y, dir).normalize();
    const turn = new Quaternion();
    Quaternion.FromUnitVectorsToRef(Y, dir, turn);
    const fade = this.fadeTexture();
    for (let i = 0; i < STREAKS; i++) {
      // A few heavy ones through the body's middle; the rest finer, round it.
      const heavy = i < STREAK_HEAVY;
      const thick = (heavy ? 0.045 : 0.014 + 0.018 * Math.random()) * height;
      // Tapered to a point at the tail (the cylinder's foot: it lies along the dash, its top forward).
      const line = MeshBuilder.CreateCylinder('qsStreak', { height: 1, diameterTop: thick, diameterBottom: 0, tessellation: 6 }, this.scene);
      line.isPickable = false;
      line.rotationQuaternion = turn.clone();
      const m = glowMat(this.scene, 'qsStreakMat', 0.9);
      m.opacityTexture = fade; // bright at its head, gone at its tail
      line.material = m;
      const spread = heavy ? 0.18 : 0.8;
      const off = side.scale((Math.random() - 0.5) * spread * height)
        .addInPlace(Y.scale((heavy ? 0.35 + 0.3 * Math.random() : 0.1 + 0.85 * Math.random()) * height));
      // A segment of the path riding just behind the dash's front, then
      // running on out to the end and thinning away.
      const share = (heavy ? 0.55 : 0.25 + 0.35 * Math.random()) * len;
      const lag = Math.random() * 0.12;
      const total = seconds + STREAK_LIFE;
      over(this.scene, total, (k) => {
        const t = k * total;
        const front = Math.min(1, Math.max(0, (t - lag * seconds) / seconds)) * len;
        // After the dash the head stops at the end and the tail catches up.
        const after = Math.max(0, (t - seconds) / STREAK_LIFE);
        const back = Math.min(front, Math.max(0, front - share * (1 - after)));
        const L = front - back;
        line.setEnabled(L > 1e-3);
        line.scaling.set(1 - 0.6 * after, Math.max(1e-3, L), 1 - 0.6 * after);
        line.position.copyFrom(from).addInPlace(dir.scale((front + back) / 2)).addInPlace(off);
        m.alpha = 0.9 * (1 - after * after);
      }, () => { line.dispose(); m.dispose(); });
    }
  }

  /** Opacity along a streak (the cylinder's v): full at its head, nothing at its tail. */
  private fadeTex: DynamicTexture | null = null;
  private fadeTexture(): DynamicTexture {
    if (this.fadeTex && this.fadeTex.getInternalTexture()) return this.fadeTex;
    const t = new DynamicTexture('qsStreakFade', { width: 4, height: 64 }, this.scene, false);
    t.hasAlpha = true;
    const g = t.getContext() as unknown as CanvasRenderingContext2D;
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.75)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 64);
    t.update();
    this.fadeTex = t;
    return t;
  }
}
