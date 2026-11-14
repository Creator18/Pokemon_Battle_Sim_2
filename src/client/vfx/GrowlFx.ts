/**
 * Growl's ripple: Earthquake's wave (QuakeFx / groundQuake) taken off the floor and sent through the air — out of the
 * attacker's mouth toward its target. The same wave profile: a crest at its front, a smaller trough and a faint swell
 * behind it, nothing ahead of it, fading out toward its reach. Here each of those a front of its own: a cap of a sphere
 * round the mouth (a cone's worth, turned toward the target), seen side-on as an arc — ")". Its edge-on parts brightest
 * (air seen through more of it), its rim soft. Three of them, one after another, as Earthquake's tremors: the later
 * ones weaker.
 *
 * And what reads as a ripple from any side — the side-on view's above all: the air bending what's behind it. Each front
 * drawn too into a screen-space warp (its normal on screen, by how obliquely the eye sees through it; the crest one
 * way, the trough the other), and the frame bent by that (a post-process) while any front is out. Its lines then a
 * crisp edge over that, not a smear.
 */
import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Effect } from '@babylonjs/core/Materials/effect';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
import type { Camera } from '@babylonjs/core/Cameras/camera';

/** How fast its fronts run (× the user's height a second), and how far they reach at most (× its height). */
const SPEED = 7.5, REACH = 7;
/** Its cone: how far round from the way to its target its fronts spread (radians). */
const SPREAD = 0.62;
/** Its wave's band (× its height): the trough this far behind the crest, the swell twice that. */
const BAND = 0.32;
/** Its ripples: how many, how long between them (s), each later one's strength × the one before. */
const RIPPLES = 3, EVERY = 0.16, LATER = 0.65;
/** How strongly each front shows: crest, trough, swell (the trough darker: shadow, not light). */
const CREST = 0.85, TROUGH = 0.45, SWELL = 0.3;
/** How far out from the mouth a front starts (× its height): clear of the face. */
const FROM = 0.28;
/** The warp: how far it bends what's behind it (of the screen, at its strongest), and its buffer's size (× the screen's). */
const WARP = 0.036, WARP_RATIO = 0.5;
/** Each front's bend: the crest's, the trough's (the other way), the swell's. */
const BEND = [1, -0.7, 0.4];

Effect.ShadersStore.growlRippleVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 world, viewProjection;
uniform float time, wobble;
varying vec3 vN, vW;
varying float vEdge;
void main(void) {
  // (A little unevenness round it: air, not glass.)
  float a = uv.y * 6.2832;
  vec3 p = position * (1.0 + wobble * (sin(a * 5.0 + time * 9.0) * 0.5 + sin(a * 3.0 - time * 6.0) * 0.5) * uv.x);
  vec4 w = world * vec4(p, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(world) * normal);
  vEdge = uv.x;
  gl_Position = viewProjection * w;
}`;
Effect.ShadersStore.growlRippleFragmentShader = /* glsl */ `
precision highp float;
uniform vec3 eye, color;
uniform float alpha, floorY;
varying vec3 vN, vW;
varying float vEdge;
void main(void) {
  // (None of it under the floor: it ends at the ground, fading in just above it.)
  float aboveFloor = smoothstep(floorY, floorY + 0.25, vW.y);
  if (aboveFloor <= 0.0) discard;
  // Edge-on brightest (the line of sight through more of it); face-on all but clear.
  float f = 1.0 - abs(dot(normalize(vN), normalize(eye - vW)));
  float a = pow(f, 5.0) * alpha;
  // Its rim soft, its middle (straight ahead) a touch fainter than its sides.
  a *= (1.0 - smoothstep(0.65, 1.0, vEdge)) * (0.75 + 0.25 * smoothstep(0.0, 0.4, vEdge));
  a *= aboveFloor;
  if (a < 0.004) discard;
  gl_FragColor = vec4(color, a);
}`;

// Its warp: each front's normal on screen, by how obliquely the eye sees through it there — summed into the warp buffer.
Effect.ShadersStore.growlWarpMeshVertexShader = Effect.ShadersStore.growlRippleVertexShader;
Effect.ShadersStore.growlWarpMeshFragmentShader = /* glsl */ `
precision highp float;
uniform vec3 eye;
uniform mat4 view;
uniform float bend, floorY;
varying vec3 vN, vW;
varying float vEdge;
void main(void) {
  // (Not under the floor: drawn with no depth, it would bend the ground in front of it — there, it simply ends.)
  float aboveFloor = smoothstep(floorY, floorY + 0.25, vW.y);
  if (aboveFloor <= 0.0) discard;
  vec3 n = normalize(vN);
  float f = 1.0 - abs(dot(n, normalize(eye - vW)));
  float k = pow(f, 1.25) * bend * (1.0 - smoothstep(0.6, 1.0, vEdge)) * aboveFloor;
  vec2 nv = (view * vec4(n, 0.0)).xy;
  gl_FragColor = vec4(nv * k, 0.0, 1.0);
}`;
// The frame bent by the warp.
Effect.ShadersStore.growlWarpFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler, warpSampler;
uniform float strength;
void main(void) {
  vec2 off = texture2D(warpSampler, vUV).xy * strength;
  gl_FragColor = texture2D(textureSampler, clamp(vUV + off, 0.001, 0.999));
}`;

/** A sphere's cap round +z, out to `spread` radians: uv.x how far out toward its rim (0 middle … 1 rim), uv.y round it. */
function capMesh(scene: Scene, spread: number): Mesh {
  const rings = 14, round = 40, pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const th = (i / rings) * spread;
    for (let j = 0; j <= round; j++) {
      const ph = (j / round) * Math.PI * 2;
      const x = Math.sin(th) * Math.cos(ph), y = Math.sin(th) * Math.sin(ph), z = Math.cos(th);
      pos.push(x, y, z); nor.push(x, y, z); uv.push(i / rings, j / round);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < round; j++) {
    const a = i * (round + 1) + j, b = a + round + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const m = new Mesh('growlCap', scene);
  const vd = new VertexData();
  vd.positions = pos; vd.normals = nor; vd.uvs = uv; vd.indices = idx;
  vd.applyToMesh(m);
  m.isPickable = false;
  return m;
}

export interface GrowlShot {
  /** Its user's height (it all scales with it). */
  height: number;
  /** Where it leaves from (the mouth), each frame. */
  from(): Vector3;
  /** The way it goes (toward the target), each frame — side-on, along x mostly. */
  toward(): Vector3;
  /** How far it reaches (world units; at most REACH × its height). */
  reach?: number;
  /** Its colour (Normal's: white). */
  color?: [number, number, number];
  /** The floor under it (world y), each frame: nothing of it below that. */
  floor?: () => number;
}

export class GrowlFx {
  private warpRT: RenderTargetTexture | null = null;
  private warpPP: PostProcess | null = null;
  private warpCam: Camera | null = null;
  private live = 0;
  constructor(private readonly scene: Scene) {}

  /** The warp pass on (a growl's fronts drawn into its buffer, the frame bent by it) — or off once the last growl is done. */
  private warp(on: boolean, meshes: Mesh[], mats: ShaderMaterial[]): void {
    const scene = this.scene, cam = scene.activeCamera!;
    if (on) {
      if (!this.warpRT) {
        const rt = new RenderTargetTexture('growlWarp', { ratio: WARP_RATIO }, scene, false, true, Constants.TEXTURETYPE_HALF_FLOAT);
        rt.clearColor = new Color4(0, 0, 0, 0);
        rt.renderList = [];
        this.warpRT = rt;
      }
      const rt = this.warpRT;
      if (!scene.customRenderTargets.includes(rt)) scene.customRenderTargets.push(rt);
      rt.activeCamera = cam;
      meshes.forEach((m, i) => { rt.renderList!.push(m); rt.setMaterialForRendering(m, mats[i]); });
      if (!this.warpPP || this.warpCam !== cam) {
        this.warpPP?.dispose(this.warpCam ?? undefined);
        const pp = new PostProcess('growlWarp', 'growlWarp', ['strength'], ['warpSampler'], 1, cam);
        pp.onApply = (e) => { e.setTexture('warpSampler', this.warpRT!); e.setFloat('strength', WARP); };
        this.warpPP = pp; this.warpCam = cam;
      }
      this.live++;
    } else {
      const rt = this.warpRT;
      if (rt) rt.renderList = rt.renderList!.filter((m) => !meshes.includes(m as Mesh));
      if (--this.live <= 0 && rt) {
        this.live = 0;
        const i = scene.customRenderTargets.indexOf(rt);
        if (i >= 0) scene.customRenderTargets.splice(i, 1);
        this.warpPP?.dispose(this.warpCam ?? undefined);
        this.warpPP = null; this.warpCam = null;
      }
    }
  }

  /** A growl, now: its ripples out toward the target. Resolves as the first front reaches its end (`reached`) and once all are gone (`done`). */
  play(shot: GrowlShot): { reached: Promise<void>; done: Promise<void> } {
    const scene = this.scene, H = shot.height;
    const reach = Math.min(shot.reach ?? REACH * H, REACH * H);
    const color = new Color3(...(shot.color ?? [1, 1, 1]));
    const trough = new Color3(0.18, 0.2, 0.26);
    // Each ripple: its crest, its trough, its swell — three fronts, the crest ahead.
    const fronts: { mesh: Mesh; mat: ShaderMaterial; warpMat: ShaderMaterial; ripple: number; behind: number; k: number; bend: number; dark: boolean }[] = [];
    for (let r = 0; r < RIPPLES; r++) {
      const strength = Math.pow(LATER, r);
      for (const [behind, k, dark] of [[0, CREST, false], [1, TROUGH, true], [2, SWELL, false]] as [number, number, boolean][]) {
        const mesh = capMesh(scene, SPREAD);
        const mat = new ShaderMaterial('growlRipple', scene, { vertex: 'growlRipple', fragment: 'growlRipple' }, {
          attributes: ['position', 'normal', 'uv'], uniforms: ['world', 'viewProjection', 'eye', 'color', 'alpha', 'time', 'wobble', 'floorY'], needAlphaBlending: true,
        });
        mat.backFaceCulling = false;
        mat.disableDepthWrite = true;
        mat.alphaMode = dark ? Constants.ALPHA_COMBINE : Constants.ALPHA_ADD;
        mat.setColor3('color', dark ? trough : color);
        mat.setFloat('wobble', 0.035);
        mesh.material = mat;
        mesh.rotationQuaternion = new Quaternion();
        mesh.setEnabled(false);
        // (Its warp: drawn into the warp buffer instead, summed with the others.)
        const warpMat = new ShaderMaterial('growlWarpMesh', scene, { vertex: 'growlWarpMesh', fragment: 'growlWarpMesh' }, {
          attributes: ['position', 'normal', 'uv'], uniforms: ['world', 'view', 'viewProjection', 'eye', 'bend', 'time', 'wobble', 'floorY'], needAlphaBlending: true,
        });
        warpMat.backFaceCulling = false; warpMat.disableDepthWrite = true; warpMat.alphaMode = Constants.ALPHA_ONEONE;
        warpMat.setFloat('wobble', 0.035);
        fronts.push({ mesh, mat, warpMat, ripple: r, behind, k: k * strength, bend: BEND[behind] * strength, dark });
      }
    }
    this.warp(true, fronts.map((f) => f.mesh), fronts.map((f) => f.warpMat));
    let t = 0, reachedRes!: () => void, doneRes!: () => void, reachedYet = false;
    const reached = new Promise<void>((r) => { reachedRes = r; });
    const done = new Promise<void>((r) => { doneRes = r; });
    const life = reach / (SPEED * H) + 2 * BAND / SPEED + (RIPPLES - 1) * EVERY;
    const obs: Observer<Scene> = scene.onBeforeRenderObservable.add(() => {
      t += Math.min(0.05, scene.getEngine().getDeltaTime() / 1000);
      const from = shot.from(), way = shot.toward();
      if (way.lengthSquared() < 1e-6) way.set(1, 0, 0);
      way.normalize();
      const q = new Quaternion();
      Quaternion.FromUnitVectorsToRef(new Vector3(0, 0, 1), way, q);
      const eye = scene.activeCamera!.globalPosition;
      for (const f of fronts) {
        // (Its front: out from the mouth at SPEED, the trough and swell BAND and 2 × BAND behind it.)
        const age = t - f.ripple * EVERY;
        const r = FROM * H + age * SPEED * H - f.behind * BAND * H;
        const on = age > 0 && r > FROM * H * 0.5 && r < reach;
        f.mesh.setEnabled(on);
        if (!on) continue;
        // (Growing in, then fading out toward its reach: as the quake's wave toward its radius.)
        const fadeIn = Math.min(1, (r - FROM * H * 0.5) / (0.6 * H)), fadeOut = 1 - Math.max(0, (r - reach * 0.55) / (reach * 0.45));
        f.mesh.position.copyFrom(from);
        f.mesh.rotationQuaternion!.copyFrom(q);
        f.mesh.scaling.setAll(r);
        f.mat.setVector3('eye', eye);
        f.mat.setFloat('time', t + f.ripple);
        const floorY = shot.floor ? shot.floor() : -1e4;
        f.mat.setFloat('floorY', floorY); f.warpMat.setFloat('floorY', floorY);
        f.mat.setFloat('alpha', f.k * fadeIn * Math.max(0, fadeOut));
        f.warpMat.setVector3('eye', eye);
        f.warpMat.setMatrix('view', scene.activeCamera!.getViewMatrix());
        f.warpMat.setFloat('time', t + f.ripple);
        f.warpMat.setFloat('bend', f.bend * fadeIn * Math.max(0, fadeOut));
      }
      if (!reachedYet && t * SPEED * H >= reach * 0.8) { reachedYet = true; reachedRes(); }
      if (t > life) {
        scene.onBeforeRenderObservable.remove(obs);
        this.warp(false, fronts.map((f) => f.mesh), []);
        for (const f of fronts) { f.mat.dispose(); f.warpMat.dispose(); f.mesh.dispose(); }
        if (!reachedYet) reachedRes();
        doneRes();
      }
    })!;
    return { reached, done };
  }
}
