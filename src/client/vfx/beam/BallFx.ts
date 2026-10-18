/**
 * Ball attacks (Shadow Ball, Energy Ball, Sludge Bomb…): the beam clash's ball
 * made whole — one full sphere of one type, the clash's three layers (hot
 * core and body) at ORB_SIZE of the clash sphere's size, with its dark noise
 * torn into a network of strands orbiting above it (the network, below). It forms at the mouth, flies at the target's near side and,
 * on contact, swells to ORB_BURST × and tears itself apart.
 */
import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Effect } from '@babylonjs/core/Materials/effect';
import { Constants } from '@babylonjs/core/Engines/constants';
import '@babylonjs/core/Meshes/Builders/sphereBuilder';
import '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import type { RGB } from '../auraPalette.ts';
import { smoothstep } from '../bolt.ts';
import { GlowSparks } from './GlowSparks.ts';
import type { BallColours } from './ballMoves.ts';
import type { Material } from '@babylonjs/core/Materials/material';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import {
  type BeamFx, BEAM_R, CLASH_R, CLASH_TEAR, ROOT, BALL_PULSE, BALL_PULSE_RATE, CHARGE_TAU, CHARGE_RATE, DUST_R, DUST_H, TARGET_BODY, NOISE, coloursFor,
} from './BeamFx.ts';

const ORB_SIZE = 0.42; //              of the clash sphere
/** Let fly, the charged ball (swollen toward 120%, as a beam's) settles to full size over this, s. */
const ORB_SETTLE = 0.12;
/** The wind spiral at the feet (a beam's dust rings): up over DUST_RISE as the charge starts, held while it charges, gone DUST_FADE after the throw (s). */
const DUST_RISE = 0.3, DUST_FADE = 0.45;
const ORB_SPEED = 9; //                × the attacker's height per second, flying
const ORB_MIN_FLY = 0.22, ORB_MAX_FLY = 0.6; // s
const ORB_BURST = 2.2, ORB_BURST_TIME = 0.42; // the swell on contact, and its dissolve
/** The dark network disperses further on contact — to NET_BURST × — and lingers, NET_LIFE × as long. */
const NET_BURST = 4.5, NET_LIFE = 1.6;
const ORB_SPARKS = 70; //              thrown out of the burst
/**
 * The network: the type's dark noise no longer covers the ball — it is torn
 * into strands that orbit just above the sphere, like the lines of a wireframe
 * globe. RINGS rings each run round the ball on its own tilted plane (a little
 * off the great circle, wobbling), RING_W wide, broken by noise into strands
 * that circle along the ring at its own speed and way round; the planes
 * precess slowly. The dark strands sit NET_OUT × out from the body, a few hot
 * ones (HOT_RINGS) further out still, so the glowing sphere shows between.
 */
const RINGS = 8, RING_W = 0.22, HOT_RINGS = 3, HOT_W = 0.07;
const NET_OUT = 1.3, HOT_OUT = 1.45;

Effect.ShadersStore.ballOrbVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 world, viewProjection;
uniform float time, disp;
varying vec3 vP;
${NOISE}
void main(void) {
  vec3 p = position * (1.0 + disp * (vn(position * 3.0 + vec3(0.0, 0.0, time * 1.3)) - 0.5));
  vP = position;
  gl_Position = viewProjection * world * vec4(p, 1.0);
}`;
Effect.ShadersStore.ballOrbFragmentShader = /* glsl */ `
precision highp float;
varying vec3 vP;
uniform vec3 color, rim;
uniform float time, cutoff, dark, freq, seed, rings, width;
${NOISE}
float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
vec3 turn(vec3 p, vec3 k, float a) { float c = cos(a), s = sin(a); return p * c + cross(k, p) * s + k * dot(k, p) * (1.0 - c); }
// The filled sphere: churning noise, as the beam's body.
float fill(vec3 p) {
  vec3 q = p * freq + vec3(0.0, 0.0, time * 0.9);
  vec3 w = vec3(vn(q * 0.55 + vec3(5.3, 0.0, 0.0)), vn(q * 0.55 + vec3(1.7, 8.1, 0.0)), 0.0) - 0.5;
  return fbm(q + w * 1.6);
}
// The network: the strongest strand of any ring here.
float strands(vec3 p) {
  float best = 0.0;
  for (int k = 0; k < 8; k++) {
    if (float(k) >= rings) break;
    float f = float(k) * 7.31 + seed * 13.7;
    vec3 ax = normalize(vec3(h1(f), h1(f + 1.3), h1(f + 2.7)) - 0.5 + 1e-3);
    ax = turn(ax, normalize(vec3(h1(f + 8.1) - 0.5, 1.0, h1(f + 9.4) - 0.5)), time * 0.6 * (h1(f + 4.2) - 0.5));
    vec3 e1 = normalize(cross(ax, abs(ax.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 e2 = cross(ax, e1);
    float lon = atan(dot(p, e2), dot(p, e1));
    float lat = asin(clamp(dot(p, ax), -1.0, 1.0));
    float off = (h1(f + 7.7) - 0.5) * 0.7 + 0.08 * sin(lon * 3.0 + time * 1.7 + f);
    float d = abs(lat - off) / width;
    if (d > 1.0) continue;
    float speed = mix(1.2, 3.2, h1(f + 5.5)) * (h1(f + 6.6) < 0.5 ? -1.0 : 1.0);
    float l = lon - time * speed;
    // Broken into strands along the ring, thinning to the ring's edges.
    float n = fbm(vec3(cos(l) * freq, sin(l) * freq, d * 1.5 + f));
    best = max(best, n * (1.0 - d * d));
  }
  return best;
}
void main(void) {
  vec3 p = normalize(vP);
  float n = rings > 0.0 ? strands(p) : fill(p);
  if (n < cutoff) discard;
  float t = clamp((n - cutoff) / max(1.0 - cutoff, 1e-3), 0.0, 1.0);
  vec3 col;
  if (dark > 0.5) col = color;
  else {
    float band = floor(t * 3.0 + 0.5) / 3.0;
    col = color * (0.85 + 0.45 * band);
    col = mix(rim, col, smoothstep(0.0, 0.12, t));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export interface BallShot {
  element: string;
  /** Its own colours (ballMoves), over the type's. */
  colours?: BallColours;
  /** The attacker's displayed height (sizes the ball, as a beam's). */
  height: number;
  /** Where the ball forms (the mouth), followed until it is let fly. */
  from(): Vector3;
  /** The target's middle. */
  target(): Vector3;
  /** The target's displayed height: the ball bursts on its near side. */
  targetSize?(): number;
  /** Where the attacker stands, for the wind spiral at its feet; null in the air (none). */
  feet?(): Vector3 | null;
  /** Draw a mesh over the caster's aura (UnitFx.addOverlay), with its mask material; returns the undo. */
  overlay?(mesh: AbstractMesh, maskMaterial: Material): () => void;
}

// The wind spiral in the aura mask: pure blue wherever it shows, so the aura
// leaves it be (UnitFx.addOverlay).
Effect.ShadersStore.ballDustMaskVertexShader = Effect.ShadersStore.beamDustVertexShader;
Effect.ShadersStore.ballDustMaskFragmentShader = Effect.ShadersStore.beamDustFragmentShader
  .replace('gl_FragColor = vec4(color * a, a);', 'if (a < 0.12) discard;\n  gl_FragColor = vec4(0.0, 0.0, 1.0, 1.0);');

export interface BallHandle {
  /** Let it fly (the body's release). */
  launch(): void;
  /** Resolves on contact — where the hit lands. */
  readonly hit: Promise<void>;
  /** Resolves once the burst has dispersed and everything is gone. */
  readonly done: Promise<void>;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
function randomDir(): Vector3 {
  const z = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z);
  return new Vector3(r * Math.cos(a), z, r * Math.sin(a));
}

export function throwBall(fx: BeamFx, shot: BallShot): BallHandle {
  return new Orb(fx, shot);
}

class Orb implements BallHandle {
  readonly hit: Promise<void>;
  readonly done: Promise<void>;
  private resolveHit!: () => void;
  private resolveDone!: () => void;
  private time = 0;
  private formT = 0;
  private launchSize = 1;
  private chargeSize = 0;
  private chargeSparks: GlowSparks;
  private owed = 0;
  private launchT = -1;
  private dust: { mesh: Mesh; mat: ShaderMaterial; mask: ShaderMaterial; undo: () => void }[] = [];
  private flyT = -1;
  private flyDur = 0.4;
  private burstT = -1;
  private start = new Vector3();
  private at = new Vector3();
  private dir = new Vector3(0, 0, 1);
  private layers: { mesh: Mesh; mat: ShaderMaterial; cutoff: number; r: number; burst: number; life: number }[] = [];
  private sparks: GlowSparks;
  private light: Color3;
  private tick: Observer<Scene>;
  private finished = false;

  constructor(private readonly fx: BeamFx, private readonly shot: BallShot) {
    const scene = fx.scene, H = shot.height;
    const col = coloursFor(shot.element);
    this.hit = new Promise((r) => { this.resolveHit = r; });
    this.done = new Promise((r) => { this.resolveDone = r; });
    // The sphere (the clash's hot core and body, torn a little), then the
    // network orbiting above it: the dark strands, and a few hot ones.
    const own = shot.colours;
    const hot = own ? own.fill : col.hot, body = own ? (own.fill.map((x) => x * 0.88) as RGB) : col.main;
    const heavy = own ? own.heavy : col.dark, light = own ? own.light : col.hot;
    this.light = new Color3(...((own ? own.light : col.main).map((x) => Math.min(1, x)) as RGB));
    const defs = [
      { color: hot, rim: hot, dark: 0, freq: 2.2, cutoff: 0.22 * CLASH_TEAR, disp: 0.35, r: BEAM_R[0], rings: 0, width: 0 },
      { color: body, rim: hot, dark: 0, freq: 2.8, cutoff: 0.42 * CLASH_TEAR, disp: 0.5, r: BEAM_R[1], rings: 0, width: 0 },
      { color: heavy, rim: heavy, dark: 1, freq: 2.4, cutoff: 0.32, disp: 0.12, r: BEAM_R[1] * NET_OUT, rings: RINGS, width: RING_W },
      { color: light, rim: light, dark: 0, freq: 2.0, cutoff: 0.5, disp: 0.08, r: BEAM_R[1] * HOT_OUT, rings: HOT_RINGS, width: HOT_W },
    ];
    defs.forEach((l, i) => {
      const mesh = MeshBuilder.CreateSphere(`ballOrb${i}`, { diameter: 2, segments: 24 }, scene);
      const mat = new ShaderMaterial(`ballOrbMat${i}`, scene, { vertex: 'ballOrb', fragment: 'ballOrb' }, {
        attributes: ['position'],
        uniforms: ['world', 'viewProjection', 'time', 'disp', 'color', 'rim', 'cutoff', 'dark', 'freq', 'seed', 'rings', 'width'],
      });
      mat.backFaceCulling = false;
      mat.setColor3('color', new Color3(...l.color));
      mat.setColor3('rim', new Color3(...l.rim));
      mat.setFloat('dark', l.dark);
      mat.setFloat('freq', l.freq);
      mat.setFloat('seed', Math.random() * 10);
      mat.setFloat('disp', l.disp);
      mat.setFloat('rings', l.rings);
      mat.setFloat('width', l.width);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.rotationQuaternion = new Quaternion();
      mesh.setEnabled(false);
      this.layers.push({ mesh, mat, cutoff: l.cutoff, r: l.r, burst: l.dark ? NET_BURST : ORB_BURST, life: l.dark ? NET_LIFE : 1 });
    });
    this.sparks = new GlowSparks(scene, fx.camera, 160, {
      size: 0.016 * H, lengthPerSpeed: 0.04, tint: own ? own.light : col.main, tintMix: shot.element === 'Fire' ? 0.15 : 0.65,
      gravity: 0, drag: 2.5, turbulence: 1.2 * H, splitChance: 0.3, splitCount: 3, secondary: [1, 0.5, 0.3], intensity: 1.1,
    });
    // Charging, as a beam's ball: sparks swirl in.
    this.chargeSparks = new GlowSparks(scene, fx.camera, 90, {
      size: 0.018 * H, lengthPerSpeed: 0.05, tint: own ? own.light : col.main, tintMix: shot.element === 'Fire' ? 0.15 : 0.65,
      gravity: 0, drag: 1.2, turbulence: 1.5 * H, splitChance: 0, splitCount: 3, secondary: [1, 0.5, 0.3], intensity: 1.2,
    });
    // The wind spiral round the feet, as a beam's (BeamFx's dust rings).
    for (let i = 0; i < 2; i++) {
      const rr = DUST_R * H * (i ? 1.25 : 1);
      const mesh = MeshBuilder.CreateCylinder(`ballDust${i}`, {
        height: DUST_H * H * (i ? 0.8 : 1), diameterBottom: rr * 1.2, diameterTop: rr * 2.2, tessellation: 64, cap: 0,
      }, scene);
      const mat = new ShaderMaterial(`ballDustMat${i}`, scene, { vertex: 'beamDust', fragment: 'beamDust' }, {
        attributes: ['position', 'uv'],
        uniforms: ['world', 'viewProjection', 'color', 'time', 'pan', 'cutoff'],
        needAlphaBlending: true,
      });
      mat.backFaceCulling = false;
      mat.disableDepthWrite = true;
      mat.alphaMode = Constants.ALPHA_PREMULTIPLIED;
      mat.setColor3('color', new Color3(0.98, 0.94, 0.86));
      mat.setFloat('pan', i ? -1.6 : 1.2);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      const mask = new ShaderMaterial(`ballDustMask${i}`, scene, { vertex: 'ballDustMask', fragment: 'ballDustMask' }, {
        attributes: ['position', 'uv'],
        uniforms: ['world', 'viewProjection', 'color', 'time', 'pan', 'cutoff'],
        needAlphaBlending: true,
      });
      mask.backFaceCulling = false;
      mask.disableDepthWrite = true;
      mask.alphaMode = Constants.ALPHA_MAXIMIZED;
      mask.setColor3('color', new Color3(1, 1, 1));
      mask.setFloat('pan', i ? -1.6 : 1.2);
      const undo = shot.overlay ? shot.overlay(mesh, mask) : () => {};
      this.dust.push({ mesh, mat, mask, undo });
    }
    this.tick = scene.onBeforeRenderObservable.add(() => this.update());
  }

  launch(): void {
    if (this.flyT >= 0 || this.finished) return;
    this.flyT = 0;
    this.launchSize = this.chargeSize;
    this.launchT = this.time;
    this.start.copyFrom(this.at);
    const end = this.aimPoint(this.start);
    this.flyDur = Math.min(ORB_MAX_FLY, Math.max(ORB_MIN_FLY, Vector3.Distance(this.start, end) / (ORB_SPEED * this.shot.height)));
    this.fx.options.shake?.(0.12, 200);
  }

  /** The point on the target's near side it flies at, this frame. */
  private aimPoint(from: Vector3): Vector3 {
    const t = this.shot.target();
    const d = t.subtract(from);
    const len = d.length();
    const near = TARGET_BODY * (this.shot.targetSize?.() ?? this.shot.height);
    return len > near ? from.add(d.scale((len - near) / len)) : t;
  }

  private update(): void {
    const dt = Math.min(0.1, this.fx.scene.getEngine().getDeltaTime() / 1000);
    this.time += dt;
    const H = this.shot.height;
    let size = 1, dissolve = 0;

    if (this.flyT < 0) {
      // Charging just ahead of the mouth, as a beam's ball does: it swells
      // toward 120%, pulsing, while sparks swirl into it.
      this.formT += dt;
      const from = this.shot.from();
      const to = this.shot.target().subtract(from);
      if (to.lengthSquared() > 1e-6) this.dir.copyFrom(to.normalize());
      this.at.copyFrom(from.add(this.dir.scale(ROOT * H + CLASH_R * ORB_SIZE * BEAM_R[2] * H)));
      size = this.chargeSize = 1.2 * (1 - Math.exp(-this.formT / CHARGE_TAU)) * (1 + BALL_PULSE * Math.sin(this.time * BALL_PULSE_RATE));
      this.owed += CHARGE_RATE * dt;
      for (; this.owed >= 1; this.owed -= 1) {
        const d = randomDir();
        const tangent = Vector3.Cross(d, this.dir).normalize();
        this.chargeSparks.spawn(this.at.add(d.scale(0.85 * H)), d.scale(-1.4 * H).add(tangent.scale(1.6 * H)), 0.32 + Math.random() * 0.12, this.at, 26);
      }
    } else if (this.burstT < 0) {
      // Flying; it follows the target if it moves.
      this.flyT += dt;
      size = this.launchSize + (1 - this.launchSize) * easeOutCubic(this.flyT / ORB_SETTLE);
      const k = clamp01(this.flyT / this.flyDur);
      const prev = this.at.clone();
      Vector3.LerpToRef(this.start, this.aimPoint(this.start), k, this.at);
      const moved = this.at.subtract(prev);
      if (moved.lengthSquared() > 1e-8) this.dir.copyFrom(moved.normalize());
      if (k >= 1) {
        this.burstT = 0;
        this.resolveHit();
        this.fx.options.shake?.(0.22, 260);
        for (let i = 0; i < ORB_SPARKS; i++) {
          const d = randomDir();
          this.sparks.spawn(this.at.add(d.scale(0.2 * H)), d.scale((2.5 + Math.random() * 3) * H), 0.25 + Math.random() * 0.3);
        }
      }
    } else {
      // Contact: it swells and disperses.
      this.burstT += dt;
      dissolve = smoothstep(0.1, 1, clamp01(this.burstT / ORB_BURST_TIME));
      if (this.burstT >= ORB_BURST_TIME * Math.max(...this.layers.map((l) => l.life)) && this.time - this.launchT >= DUST_FADE) {
        this.finish(); return;
      }
    }
    this.sparks.update(dt);
    this.chargeSparks.update(dt);
    // The wind spiral: up round the feet as it starts charging, held while it
    // charges, dying away once the ball is thrown.
    const feet = this.shot.feet ? this.shot.feet() : null;
    const since = this.launchT >= 0 ? this.time - this.launchT : 0;
    this.dust.forEach(({ mesh, mat, mask }, i) => {
      const on = !!feet && since < DUST_FADE;
      mesh.setEnabled(on);
      if (!on || !feet) return;
      const k = easeOutCubic(this.formT / DUST_RISE);
      mesh.position.set(feet.x, feet.y + DUST_H * H * 0.5 * (i ? 0.8 : 1), feet.z);
      mesh.scaling.set(0.4 + 0.6 * k, k, 0.4 + 0.6 * k);
      const cut = 0.25 + 0.75 * smoothstep(0, DUST_FADE, since);
      for (const m of [mat, mask]) { m.setFloat('time', this.time); m.setFloat('cutoff', cut); }
    });

    // Not turned with its flight: the swirl is its own (the noise lives on the sphere).
    this.layers.forEach((l, i) => {
      // Bursting, each layer swells and dissolves on its own clock.
      let sz = size, gone = 0;
      if (this.burstT >= 0) {
        const k = clamp01(this.burstT / (ORB_BURST_TIME * l.life));
        sz = 1 + (l.burst - 1) * easeOutCubic(k);
        gone = smoothstep(0.1, 1, k);
      }
      l.mesh.setEnabled(sz > 0.02 && gone < 0.999);
      l.mesh.position.copyFrom(this.at);
      l.mesh.scaling.setAll(Math.max(1e-3, l.r * CLASH_R * ORB_SIZE * H * Math.max(0, sz)));
      const m = l.mat;
      m.setFloat('time', this.time + i * 1.7);
      m.setFloat('cutoff', l.cutoff + (1 - l.cutoff) * gone);
    });

    const light = this.fx.light;
    light.position.copyFrom(this.at);
    light.diffuse = this.light;
    light.intensity = 1.6 * Math.min(1, size) * (1 - dissolve);
    light.range = 4 * H;
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.resolveHit();
    this.fx.scene.onBeforeRenderObservable.remove(this.tick);
    this.fx.light.intensity = 0;
    this.sparks.dispose();
    this.chargeSparks.dispose();
    for (const d of this.dust) { d.undo(); d.mask.dispose(); }
    for (const l of [...this.layers, ...this.dust]) { l.mat.dispose(); l.mesh.dispose(); }
    this.resolveDone();
  }
}
