/**
 * The light of a Poké Ball opening or closing — you turning from a Poké Ball into your Pokémon, or back:
 *
 *  - gather: sparks drawn in from round it, spiralling into its middle (the ball about to burst open; the Pokémon
 *    being called back), the light there swelling;
 *  - flash: a burst — a bright bloom swelling and fading, a ring thrown out round it, sparkles flung out and drifting
 *    down, a flash of light on everything near;
 *  - glow: a soft halo that hangs on and fades (round the Pokémon as its white light fades off it).
 *
 * All additive light, white at heart, tinted (`tint`): white-blue to open, red to recall.
 */
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Constants } from '@babylonjs/core/Engines/constants';

/** A soft round light (white at its heart, fading to nothing at its rim), shared by every spark and bloom. */
let glowTex: DynamicTexture | null = null;
function glowTexture(scene: Scene): DynamicTexture {
  if (glowTex && glowTex.getScene() === scene) return glowTex;
  const t = new DynamicTexture('morphGlow', { width: 64, height: 64 }, scene, false);
  const g = t.getContext() as CanvasRenderingContext2D;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.25)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  t.hasAlpha = true; t.update();
  glowTex = t;
  return t;
}

/** A ring's texture: a thin bright band round a soft edge. */
let ringTex: DynamicTexture | null = null;
function ringTexture(scene: Scene): DynamicTexture {
  if (ringTex && ringTex.getScene() === scene) return ringTex;
  const t = new DynamicTexture('morphRing', { width: 128, height: 128 }, scene, false);
  const g = t.getContext() as CanvasRenderingContext2D;
  const grad = g.createRadialGradient(64, 64, 34, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.55, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.5)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  t.hasAlpha = true; t.update();
  ringTex = t;
  return t;
}

export type MorphTint = 'open' | 'recall';
const TINTS: Record<MorphTint, { a: Color4; b: Color4; light: Color3 }> = {
  open: { a: new Color4(1, 1, 1, 1), b: new Color4(0.55, 0.85, 1, 1), light: new Color3(0.85, 0.95, 1) },
  recall: { a: new Color4(1, 0.85, 0.85, 1), b: new Color4(1, 0.2, 0.18, 1), light: new Color3(1, 0.35, 0.3) },
};

/** A particle system of soft sparks, additive, not taking the shared texture with it when it goes. */
function sparks(scene: Scene, name: string, capacity: number, at: Vector3): ParticleSystem {
  const ps = new ParticleSystem(name, capacity, scene);
  ps.particleTexture = glowTexture(scene);
  ps.emitter = at.clone();
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.disposeOnStop = true;
  const dispose = ps.dispose.bind(ps);
  ps.dispose = () => dispose(false);
  return ps;
}

/** A billboard of light at `at`, `size` across — its material its own (faded on its own), its texture shared. */
function bloom(scene: Scene, name: string, at: Vector3, size: number, color: Color3, tex: DynamicTexture): { mesh: Mesh; mat: StandardMaterial } {
  const mesh = MeshBuilder.CreatePlane(name, { size: 1 }, scene);
  mesh.position.copyFrom(at); mesh.scaling.setAll(size);
  mesh.billboardMode = Mesh.BILLBOARDMODE_ALL; mesh.isPickable = false;
  const mat = new StandardMaterial(`${name}Mat`, scene);
  mat.diffuseColor = Color3.Black(); mat.specularColor = Color3.Black();
  mat.emissiveColor = color; mat.disableLighting = true;
  mat.opacityTexture = tex; mat.alphaMode = Constants.ALPHA_ADD; mat.backFaceCulling = false;
  mesh.material = mat;
  return { mesh, mat };
}

/** Ease `f(t)` over `secs`, each frame, then `done`. */
function tween(scene: Scene, secs: number, f: (t: number) => void, done?: () => void): void {
  let t = 0;
  const obs = scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() / 1000;
    const u = Math.min(1, t / secs);
    f(u);
    if (u >= 1) { scene.onBeforeRenderObservable.remove(obs); done?.(); }
  });
}

/** Sparks drawn in from round `at` (`radius` out) to its middle over `secs`, the light there swelling. */
export function gather(scene: Scene, at: Vector3, radius: number, secs: number, tint: MorphTint): void {
  const c = TINTS[tint];
  const ps = sparks(scene, 'morphGather', 160, at);
  ps.createSphereEmitter(radius, 0);
  // (Flying inward: thrown "out" with a negative push, living just long enough to reach the middle.)
  ps.minEmitPower = -radius * 2.6; ps.maxEmitPower = -radius * 3.4;
  ps.minLifeTime = 0.28; ps.maxLifeTime = 0.36;
  ps.minSize = radius * 0.07; ps.maxSize = radius * 0.16;
  ps.color1 = c.a; ps.color2 = c.b; ps.colorDead = new Color4(c.b.r, c.b.g, c.b.b, 0);
  ps.emitRate = 420; ps.targetStopDuration = secs;
  ps.minAngularSpeed = -4; ps.maxAngularSpeed = 4;
  ps.start();
  // The light at its heart swelling.
  const b = bloom(scene, 'morphHeart', at, radius * 0.4, new Color3(c.a.r, c.a.g, c.a.b), glowTexture(scene));
  tween(scene, secs, (u) => { b.mesh.scaling.setAll(radius * (0.4 + 1.6 * u * u)); b.mat.alpha = 0.4 + 0.6 * u; },
    () => { b.mesh.dispose(); b.mat.dispose(); });
}

/** A burst at `at`, `radius` its reach: a bloom, a ring, sparkles flung out, a flash of light. */
export function flash(scene: Scene, at: Vector3, radius: number, tint: MorphTint): void {
  const c = TINTS[tint];
  // Sparkles flung out every way, slowing, drifting down, fading.
  const ps = sparks(scene, 'morphBurst', 220, at);
  ps.createSphereEmitter(radius * 0.15, 1);
  ps.minEmitPower = radius * 3.5; ps.maxEmitPower = radius * 7;
  ps.minLifeTime = 0.35; ps.maxLifeTime = 0.8;
  ps.minSize = radius * 0.05; ps.maxSize = radius * 0.14;
  ps.color1 = c.a; ps.color2 = c.b; ps.colorDead = new Color4(c.b.r, c.b.g, c.b.b, 0);
  ps.gravity = new Vector3(0, -radius * 3, 0);
  ps.addVelocityGradient(0, 1); ps.addVelocityGradient(1, 0.15);
  ps.addSizeGradient(0, 1); ps.addSizeGradient(1, 0.3);
  ps.manualEmitCount = 200; ps.targetStopDuration = 0.9;
  ps.start();
  // A bloom swelling and fading.
  const b = bloom(scene, 'morphBloom', at, radius, new Color3(1, 1, 1), glowTexture(scene));
  tween(scene, 0.45, (u) => { b.mesh.scaling.setAll(radius * (1.2 + 3 * Math.sqrt(u))); b.mat.alpha = 1 - u; },
    () => { b.mesh.dispose(); b.mat.dispose(); });
  // A ring thrown out round it.
  const r = bloom(scene, 'morphRing', at, radius, c.light, ringTexture(scene));
  tween(scene, 0.5, (u) => { r.mesh.scaling.setAll(radius * (1 + 5 * u)); r.mat.alpha = (1 - u) * 0.9; },
    () => { r.mesh.dispose(); r.mat.dispose(); });
  // A flash of light on what's near.
  const light = new PointLight('morphLight', at.clone(), scene);
  light.diffuse = c.light; light.specular = Color3.Black(); light.range = radius * 14;
  tween(scene, 0.5, (u) => { light.intensity = 3 * (1 - u) * (1 - u); }, () => light.dispose());
}

/** A soft halo at `at` that hangs on, `secs`, fading. */
export function glow(scene: Scene, at: () => Vector3, radius: number, secs: number, tint: MorphTint): void {
  const c = TINTS[tint];
  const b = bloom(scene, 'morphGlow', at(), radius * 2.4, new Color3(c.b.r, c.b.g, c.b.b), glowTexture(scene));
  tween(scene, secs, (u) => { b.mesh.position.copyFrom(at()); b.mat.alpha = 0.7 * (1 - u); },
    () => { b.mesh.dispose(); b.mat.dispose(); });
}
