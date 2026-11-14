/**
 * Ember: Flamethrower's starting egg, small, shot at the foe. The same three layers as a beam's starting egg (hot
 * core, bright body, torn dark skin, in the beam's own shader and Fire's colours), shaped into its egg — but turned
 * round as it flies: its full, round end leading, toward what it's shot at; its drawn-out, narrowing end trailing
 * back behind it, its flame streaming back along it. Winding up, a small ball of it charges at the mouth (a beam's
 * wind-up ball, smaller: pulsing, sparks swirling in); let go, the ball becomes the egg and flies; on contact the egg
 * itself bursts — its layers swelling and tearing apart, each on its own clock, sparks thrown off — and is gone.
 *
 * The same handle as a ball attack's (BallHandle): thrown through RecipeFactory.playBall, so the side-on fighter's
 * aim, contact and cooldown are a ball's.
 */
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Vector3, Vector2, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { type BeamFx, BEAM_R, TARGET_BODY, FLOW, BALL_PULSE, BALL_PULSE_RATE, CHARGE_TAU, coloursFor } from './BeamFx.ts';
import { GlowSparks } from './GlowSparks.ts';
import type { BallHandle } from './BallFx.ts';

/** Its size: × a Flamethrower's starting egg's. */
const EMBER_SIZE = 0.55;
/** A beam's ball layer over its tube's (BeamFx BALL_OVER): the egg's layers' radii, × the attacker's height. */
const EGG_R = BEAM_R.map((r) => r * 1.45 * EMBER_SIZE);
/** Its trailing end drawn out this far (× its radius; a starting egg's is 2.2): a longer tail, streaming back. */
const TAIL = 2.6;
/** Winding up: its ball (× the egg's size), how many sparks swirl into it a second. Let go: how long the ball takes to
 *  become the egg (s); how fast it flies (× the attacker's height a second), its flight's shortest and longest. */
const WIND_BALL = 0.8, CHARGE_SPARKS = 45, TO_EGG = 0.07, SPEED = 11, MIN_FLY = 0.12, MAX_FLY = 0.9;
/** Bursting: each layer swells to BURST × (its skin further, SKIN_BURST ×) and tears away over BURST_T × its own life
 *  (s); its egg rounds out as it goes; sparks thrown off. */
/** How far clear of the attacker's mouth its back is kept (× the attacker's height): past the snout, which reaches on ahead of the mouth (a ball attack forms ROOT, 0.45, out). */
const CLEAR = 0.3;
/** How far its noise can swell it past its radius (its skin's displacement: up to ×1.3). */
const NOISE_REACH = 1.3;
const BURST = 1.9, SKIN_BURST = 2.6, BURST_T = 0.3, BURST_LIFE = [0.8, 1, 1.35], BURST_SPARKS = 26;
/** Its flicker: a light wobble in its size as it flies. */
const FLICKER = 0.08, FLICKER_RATE = 23;

export interface EmberShot {
  /** The type whose colours it wears (Fire). */
  element: string;
  /** The attacker's displayed height: it is sized to it. */
  height: number;
  /** Where it forms (the mouth), followed until it's let go. */
  from(): Vector3;
  /** What it flies at (the target's middle, or a point along the aim). */
  target(): Vector3;
  /** The target's height (it strikes its near side); 0: a point, flown right to. */
  targetSize?(): number;
  /** Its size, × the usual. */
  scale?: number;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
const Y = new Vector3(0, 1, 0);

export function throwEmber(fx: BeamFx, shot: EmberShot): BallHandle {
  const scene: Scene = fx.scene;
  const H = shot.height, S = shot.scale ?? 1;
  const col = coloursFor(shot.element);
  // (A starting egg's layers: hot core, bright body, torn dark skin — each its own pan and noise scale.)
  const LAYERS = [
    { color: col.hot, rim: col.hot, dark: 0, pan: 13.0, nscale: [0.75, 1.6], cutoff: 0.22, disp: 0.35 },
    { color: col.main, rim: col.hot, dark: 0, pan: 9.0, nscale: [0.5, 2.1], cutoff: 0.42, disp: 0.5 },
    { color: col.dark, rim: col.dark, dark: 1, pan: 5.5, nscale: [0.28, 3.0], cutoff: (col.skinCut ?? 0.58) * 1.08, disp: 0.6 },
  ];
  const layers = LAYERS.map((l, i) => {
    const mesh = MeshBuilder.CreateSphere(`ember${i}`, { diameter: 2, segments: 18 }, scene);
    const mat = new ShaderMaterial(`emberMat${i}`, scene, { vertex: 'beamMesh', fragment: 'beamMesh' }, {
      attributes: ['position', 'uv'],
      uniforms: ['world', 'viewProjection', 'origin', 'aim', 'side', 'upv', 'rad', 'egg', 'eggFront', 'time', 'disp', 'pan', 'grow', 'spike',
        'spikeFine', 'spikeForward', 'windup', 'fwdNoise', 'color', 'rim', 'cutoff', 'dark', 'nscale', 'color2', 'color3', 'multi', 'ghost'],
    });
    mat.backFaceCulling = false;
    mat.setColor3('color', new Color3(...l.color)); mat.setColor3('rim', new Color3(...l.rim));
    mat.setFloat('dark', l.dark); mat.setFloat('pan', l.pan * FLOW); mat.setFloat('disp', l.disp);
    mat.setVector2('nscale', new Vector2(l.nscale[0], l.nscale[1]));
    mat.setFloat('egg', 1); mat.setFloat('eggFront', TAIL);
    mat.setFloat('grow', 1); mat.setFloat('spike', 0); mat.setFloat('spikeFine', 0); mat.setFloat('spikeForward', 0); mat.setFloat('windup', 0);
    // (Its noise streaming back, along its tail — never bulging forward, ahead of it.)
    mat.setFloat('fwdNoise', 1);
    mat.setFloat('multi', 0); mat.setFloat('ghost', 0);
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.rotationQuaternion = new Quaternion();
    mesh.setEnabled(false);
    return { mesh, mat, cutoff: l.cutoff, r: EGG_R[i] };
  });

  // Sparks: swirling in while it winds up; thrown off as it bursts (Fire's own gold → ember).
  const sparkStyle = { lengthPerSpeed: 0.05, tint: col.main, tintMix: 0.15, gravity: 0, turbulence: 1.2 * H, splitCount: 3, secondary: [1, 0.5, 0.3] as [number, number, number] };
  const chargeSparks = new GlowSparks(scene, fx.camera, 40, { ...sparkStyle, size: 0.014 * H, drag: 1.2, splitChance: 0, intensity: 1.1 });
  const sparks = new GlowSparks(scene, fx.camera, 60, { ...sparkStyle, size: 0.013 * H, drag: 2.5, splitChance: 0.3, intensity: 1.1 });
  let owed = 0;

  let time = 0, formT = 0, flyT = -1, burstT = -1, flyDur = 0, finished = false;
  const at = new Vector3(), start = new Vector3(), dir = new Vector3(1, 0, 0);
  /** Its outermost layer's radius at full size (world). */
  const outerR = () => EGG_R[2] * H * S;
  // (The wind-up ball's size as it's let go: the egg grows on from there.)
  let launchSize = 1;
  const size0 = () => WIND_BALL * (1 - Math.exp(-formT / CHARGE_TAU));
  let resolveHit!: () => void, resolveDone!: () => void;
  const hit = new Promise<void>((r) => { resolveHit = r; });
  const done = new Promise<void>((r) => { resolveDone = r; });

  /** The point it flies at: the target's near side (a point: right to it). */
  const aimPoint = (from: Vector3) => {
    const t = shot.target(), d = t.subtract(from), len = d.length();
    const near = TARGET_BODY * (shot.targetSize?.() ?? H);
    return near > 0 && len > near ? from.add(d.scale((len - near) / len)) : t;
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    resolveHit();
    scene.onBeforeRenderObservable.remove(tick);
    fx.light.intensity = 0;
    for (const l of layers) { l.mat.dispose(); l.mesh.dispose(); }
    chargeSparks.dispose(); sparks.dispose();
    resolveDone();
  };
  const pop = () => {
    if (burstT >= 0 || finished) return;
    burstT = 0;
    resolveHit();
    // (The egg itself bursts — no other burst on what it strikes: sparks thrown off it, mostly onward.)
    for (let i = 0; i < BURST_SPARKS; i++) {
      const z = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      const d = new Vector3(r * Math.cos(a), z, r * Math.sin(a)).add(dir.scale(0.6)).normalize();
      sparks.spawn(at.add(d.scale(0.1 * H * S)), d.scale((2 + Math.random() * 2.5) * H * S), 0.22 + Math.random() * 0.25);
    }
    fx.options.shake?.(0.08, 140);
  };

  const tick: Observer<Scene> = scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
    time += dt;
    let size = 1, egg = 1;
    /** Each layer's swell and tear (bursting; else 1 and 0). */
    const swell = [1, 1, 1], gone = [0, 0, 0];
    if (flyT < 0) {
      // Winding up: a small ball of it just ahead of the mouth, swelling as it charges, pulsing; sparks swirling in.
      formT += dt;
      const from = shot.from(), to = shot.target().subtract(from);
      if (to.lengthSquared() > 1e-6) dir.copyFrom(to.normalize());
      // (Its back clear of the mouth: the whole ball ahead of the face, never in it.)
      at.copyFrom(from.add(dir.scale(outerR() * size0() * NOISE_REACH + CLEAR * H)));
      size = WIND_BALL * (1 - Math.exp(-formT / CHARGE_TAU)) * (1 + BALL_PULSE * Math.sin(time * BALL_PULSE_RATE));
      egg = 0;
      owed += CHARGE_SPARKS * dt;
      for (; owed >= 1; owed -= 1) {
        const z = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z);
        const d = new Vector3(r * Math.cos(a), z, r * Math.sin(a));
        const tangent = Vector3.Cross(d, dir).normalize();
        chargeSparks.spawn(at.add(d.scale(0.45 * H * S)), d.scale(-0.9 * H * S).add(tangent.scale(1.0 * H * S)), 0.28 + Math.random() * 0.1, at, 26);
      }
    } else if (burstT < 0) {
      // Let go: the ball becomes the egg, and flies straight at it (following it, if it moves).
      flyT += dt;
      const k = clamp01(flyT / flyDur);
      const prev = at.clone();
      Vector3.LerpToRef(start, aimPoint(start), k, at);
      const moved = at.subtract(prev);
      if (moved.lengthSquared() > 1e-8) dir.copyFrom(moved.normalize());
      const into = easeOut(flyT / TO_EGG);
      size = (launchSize + (1 - launchSize) * into) * (1 + FLICKER * Math.sin(time * FLICKER_RATE));
      egg = into;
      if (k >= 1) pop();
    } else {
      // Bursting: each layer swelling and tearing away on its own clock, the egg rounding out as it goes.
      burstT += dt;
      let all = true;
      for (let i = 0; i < 3; i++) {
        const k = clamp01(burstT / (BURST_T * BURST_LIFE[i]));
        swell[i] = 1 + ((i === 2 ? SKIN_BURST : BURST) - 1) * easeOut(k);
        gone[i] = Math.min(1, Math.pow(k, 0.8) * 1.05);
        if (k < 1) all = false;
      }
      egg = 1 - easeOut(burstT / (BURST_T * 0.6));
      if (all) { finish(); return; }
    }
    // Never in the attacker's body: its trailing end — drawn out back behind it as it becomes the egg — kept ahead of
    // the mouth (its middle pushed on, if need be, the way it flies).
    if (burstT < 0) {
      const mouth = shot.from(), ahead = Vector3.Dot(at.subtract(mouth), dir);
      // (× NOISE_REACH: its noise swells it out past its radius here and there.)
      const reachBack = outerR() * size * NOISE_REACH * (1 + (TAIL - 1) * egg) + CLEAR * H;
      if (ahead < reachBack) {
        at.addInPlace(dir.scale(reachBack - ahead));
        // (Flying: its flight on from there, not dragged back to where it set off.)
        if (flyT >= 0) start.addInPlace(dir.scale(reachBack - ahead));
      }
    }
    chargeSparks.update(dt); sparks.update(dt);
    // Turned round: its egg's drawn-out end (its +y pole) trailing back, against its flight; its round end leading.
    const back = dir.scale(-1);
    const q = new Quaternion();
    Quaternion.FromUnitVectorsToRef(Y, back, q);
    let side = Vector3.Cross(back, Vector3.Up());
    if (side.lengthSquared() < 1e-6) side = new Vector3(1, 0, 0);
    side.normalize();
    const upv = Vector3.Cross(side, back).normalize();
    layers.forEach((l, i) => {
      const radius = Math.max(1e-3, l.r * H * S * size * swell[i]);
      l.mesh.setEnabled(size > 0.02 && gone[i] < 0.999);
      l.mesh.position.copyFrom(at);
      l.mesh.scaling.setAll(radius);
      l.mesh.rotationQuaternion!.copyFrom(q);
      const m = l.mat;
      // (Its noise bulging the way it streams: back along its tail as it flies — but winding up, forward, away from the
      // face it forms in front of, never back into it.)
      m.setVector3('origin', at); m.setVector3('aim', flyT < 0 ? dir : back); m.setVector3('side', side); m.setVector3('upv', upv);
      m.setFloat('rad', BEAM_R[i] * H * S * EMBER_SIZE);
      m.setFloat('time', time + i * 1.7);
      m.setFloat('egg', egg);
      m.setFloat('cutoff', l.cutoff + (1 - l.cutoff) * gone[i]);
    });
    const light = fx.light;
    light.position.copyFrom(at);
    light.diffuse = new Color3(...col.hot);
    light.intensity = 1.1 * Math.min(1, size) * (1 - gone[1]);
    light.range = 2.5 * H;
  })!;

  return {
    hit, done,
    launch() {
      if (flyT >= 0 || finished) return;
      flyT = 0;
      launchSize = Math.max(size0(), 0.05);
      start.copyFrom(at);
      flyDur = Math.min(MAX_FLY, Math.max(MIN_FLY, Vector3.Distance(start, aimPoint(start)) / (SPEED * H)));
    },
    position: () => at.clone(),
    vanish: finish,
    burst() { if (flyT >= 0) pop(); },
  };
}
