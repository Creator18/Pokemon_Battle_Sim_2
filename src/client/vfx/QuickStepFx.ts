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
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
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
/** A teleport: how much wider its body's copy is drawn as it squeezes to a line; its ring's and flare's lives (s), how many flare lines. */
const SQUASH_WIDE = 0.9, RING_LIFE = 0.28, FLARE_LIFE = 0.22, FLARE_LINES = 10;
/** A teleport's flickering speed lines: how many, how long each blinks (s). */
const SPEED_LINES = 22, SPEED_BLINK = 0.05;

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

  /**
   * A teleport's vanishing (or, `appearing`, its arrival), on copies of the body held in its pose (frozenCopy): squeezed
   * about `centre` into a thin line along `axis` — drawn out along it, flattened across it, gone — over `seconds` (or,
   * arriving, opened back out of one into the body); then `done` (and the copies are freed).
   */
  squash(copies: Mesh[], dispose: () => void, centre: Vector3, appearing: boolean, seconds: number, done?: () => void,
    axis?: Vector3): void {
    const pivot = new TransformNode('tpPivot', this.scene);
    pivot.position.copyFrom(centre);
    // (Squeezed along `axis` — the way it goes, or comes in facing: its local x laid along it, so it is drawn out along
    // that way and flattened across it. Unset: the world's level.)
    if (axis && axis.lengthSquared() > 1e-8) {
      const turn = new Quaternion();
      Quaternion.FromUnitVectorsToRef(new Vector3(1, 0, 0), axis.normalizeToNew(), turn);
      pivot.rotationQuaternion = turn;
      pivot.computeWorldMatrix(true);
    }
    for (const c of copies) { c.setParent(pivot); c.visibility = 1; c.isPickable = false; }
    over(this.scene, seconds, (k) => {
      // (Vanishing: k from whole to a line; arriving: the other way round.)
      const e = appearing ? 1 - k : k;
      const q = e * e * (3 - 2 * e);
      pivot.scaling.set(1 + SQUASH_WIDE * q, Math.max(0.02, 1 - 0.98 * q), 1 + SQUASH_WIDE * q);
      const fade = appearing ? Math.min(1, k * 3) : 1 - Math.max(0, (k - 0.7) / 0.3);
      for (const c of copies) c.visibility = fade;
    }, () => { for (const c of copies) c.dispose(); pivot.dispose(); dispose(); done?.(); });
  }

  /** A flat ring bursting out round `at`, facing the camera, `size` across at its widest. */
  ring(at: Vector3, size: number, color: Color3 = GLOW): void {
    const ring = MeshBuilder.CreateTorus('tpRing', { diameter: 1, thickness: 0.06, tessellation: 40 }, this.scene);
    ring.isPickable = false;
    ring.position.copyFrom(at);
    // (Its round face toward the camera.)
    const cam = this.scene.activeCamera;
    const toCam = cam ? cam.globalPosition.subtract(at).normalize() : new Vector3(0, 0, -1);
    const turn = new Quaternion();
    Quaternion.FromUnitVectorsToRef(Y, toCam, turn);
    ring.rotationQuaternion = turn;
    const m = glowMat(this.scene, 'tpRingMat', 0.95);
    m.emissiveColor = color;
    ring.material = m;
    over(this.scene, RING_LIFE, (k) => {
      const e = 1 - (1 - k) * (1 - k);
      const r = size * (0.2 + 0.8 * e);
      ring.scaling.set(r, r * (1 - 0.6 * k), r);
      m.alpha = 0.95 * (1 - k);
    }, () => { ring.dispose(); m.dispose(); });
  }

  /** Short lines flaring out from `at` across the screen's plane (`n` of them, `size` their reach), quick and gone. */
  flare(at: Vector3, size: number, n = FLARE_LINES, color: Color3 = GLOW): void {
    const cam = this.scene.activeCamera;
    const toCam = cam ? cam.globalPosition.subtract(at).normalize() : new Vector3(0, 0, -1);
    const a = Vector3.Cross(toCam, Y).normalize(), b = Vector3.Cross(a, toCam).normalize();
    const fade = this.fadeTexture();
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const dir = a.scale(Math.cos(th)).addInPlace(b.scale(Math.sin(th)));
      const line = MeshBuilder.CreateCylinder('tpFlare', { height: 1, diameterTop: 0.03 * size, diameterBottom: 0, tessellation: 5 }, this.scene);
      line.isPickable = false;
      const turn = new Quaternion();
      Quaternion.FromUnitVectorsToRef(Y, dir, turn);
      line.rotationQuaternion = turn;
      const m = glowMat(this.scene, 'tpFlareMat', 0.9);
      m.emissiveColor = color;
      m.opacityTexture = fade;
      line.material = m;
      const reach = size * (0.6 + 0.5 * Math.random()), len = size * (0.25 + 0.2 * Math.random());
      over(this.scene, FLARE_LIFE, (k) => {
        const e = 1 - (1 - k) * (1 - k);
        const head = size * 0.25 + reach * e;
        line.scaling.set(1 - 0.7 * k, Math.max(1e-3, len * (1 - 0.5 * k)), 1 - 0.7 * k);
        line.position.copyFrom(at).addInPlace(dir.scale(head - len * 0.5));
        m.alpha = 0.9 * (1 - k * k);
      }, () => { line.dispose(); m.dispose(); });
    }
  }

  /**
   * Speed lines flickering round a body (a teleport's, in place of a ring): SPEED_LINES thin tapered lines, all along
   * `dir` (heads forward), spread through the body round `centre` (`height` tall), each on and off by turns
   * (SPEED_BLINK s), sliding a little along `dir`, thinning and gone over `seconds`.
   */
  speedFlicker(centre: Vector3, dir: Vector3, height: number, seconds: number): void {
    const way = dir.lengthSquared() > 1e-8 ? dir.normalizeToNew() : new Vector3(1, 0, 0);
    // (Across the way, two axes: one in the view, one toward the camera — the lines spread through the body's bulk.)
    const cam = this.scene.activeCamera;
    const toCam = cam ? cam.globalPosition.subtract(centre).normalize() : new Vector3(0, 0, -1);
    let across = Vector3.Cross(toCam, way);
    if (across.lengthSquared() < 1e-6) across = Vector3.Cross(Y, way);
    across.normalize();
    const deep = Vector3.Cross(way, across).normalize();
    const turn = new Quaternion();
    Quaternion.FromUnitVectorsToRef(Y, way, turn);
    const fade = this.fadeTexture();
    for (let i = 0; i < SPEED_LINES; i++) {
      const heavy = i < 5;
      const thick = (heavy ? 0.065 : 0.022 + 0.025 * Math.random()) * height;
      const line = MeshBuilder.CreateCylinder('tpLine', { height: 1, diameterTop: thick, diameterBottom: 0, tessellation: 5 }, this.scene);
      line.isPickable = false;
      line.rotationQuaternion = turn.clone();
      const m = glowMat(this.scene, 'tpLineMat', 1);
      m.opacityTexture = fade;
      line.material = m;
      const len = height * (heavy ? 1.5 : 0.6 + 0.8 * Math.random());
      const off = across.scale((Math.random() - 0.5) * (heavy ? 0.6 : 1.3) * height)
        .addInPlace(deep.scale((Math.random() - 0.5) * 0.8 * height))
        .addInPlace(way.scale((Math.random() - 0.5) * 0.6 * height));
      const slide = height * (0.3 + 0.5 * Math.random());
      // (Its own blinking: a phase of its own, on more than off.)
      const phase = Math.random(), blink = SPEED_BLINK * (0.7 + 0.6 * Math.random());
      let t = 0;
      over(this.scene, seconds, (k) => {
        t = k * seconds;
        const on = ((t / blink + phase) % 1) < 0.62;
        line.setEnabled(on && k < 0.98);
        line.scaling.set(1 - 0.5 * k, Math.max(1e-3, len * (1 - 0.3 * k)), 1 - 0.5 * k);
        line.position.copyFrom(centre).addInPlace(off).addInPlace(way.scale(slide * k));
        m.alpha = 1 - k * k;
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
