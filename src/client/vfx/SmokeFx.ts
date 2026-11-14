/**
 * Smokescreen's smoke: puffs of soft, semi-transparent volume — each a sphere ray-traced in its own fragment shader,
 * after Mikael Lemercier & Fabrice Neyret's fake volumetric cloud sphere (Shadertoy, 2013): the eye's ray into the
 * sphere, its start jittered by 3D noise (a torn, fluffy edge, boiling as it moves); how far the ray runs inside it its
 * opacity (1 - e^(-k * chord): thin at its rim, dense through its middle — with a thinner skin layer, the linear-density
 * profile); the light through it the analytic transmittance N.L / (N.L + N.O), dark where the sun is behind it, lit
 * where it faces it. Smokescreen's ink-dark grey, its lit side a cool grey.
 *
 * A continuous spray out of the mouth — a stream of many thin, overlapping puffs, small at the mouth, widening as they
 * go, merging into one plume and pooling round the target, a little drift upward; it hangs there a while as one
 * cloud, then disperses — each puff breaking into smaller ones drifting apart and up, each of those then thinning away
 * (eroded by noise, its density falling). Nothing of them under the floor.
 *
 * Sources: Lemercier & Neyret's shader (the technique — written here afresh, on this project's own noise);
 * realtimevfx.com stylized-smoke threads; Unity's six-way lighting notes (why games fake smoke's volume).
 */
import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Constants } from '@babylonjs/core/Engines/constants';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Effect } from '@babylonjs/core/Materials/effect';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import '@babylonjs/core/Meshes/Builders/icoSphereBuilder';
import { NOISE } from './beam/BeamFx.ts';

/** Its puffs: how many, how big at most (× the user's height, radius), how small they start (× that). */
const PUFFS = 64, PUFF_R: [number, number] = [0.26, 0.42], START = 0.12;
/** Thrown out: how quickly its throw dies (drag, per s); its upward drift (× H per s). */
const DRAG = 3.2, RISE = 0.08;
/** How far ahead of the mouth it comes out (× the user's height). */
const MOUTH_CLEAR = 0.32;
/** How long it takes them all to leave the mouth (s), to grow to full size (s); how long the cloud hangs (s), erodes (s). */
const EMIT = 0.8, GROW = 0.45, HANG = 3.0, ERODE = 1.1;
/** Its look: lit, shadowed, and the light that comes through it (rim) — ink-dark, a cool grey where the sun reaches. */
const LIT: [number, number, number] = [0.42, 0.43, 0.48], MID: [number, number, number] = [0.2, 0.2, 0.24];
const SHADE: [number, number, number] = [0.07, 0.07, 0.09], RIM: [number, number, number] = [0.55, 0.55, 0.6];
/** The volume: its density (opacity through it), its skin's thickness (x its radius: thinner there), how far its ray
 *  start is jittered by noise (x its radius: its torn edge), that noise's scale and how fast it boils; how much bigger
 *  its mesh is than its sphere (room for the jitter). */
const DENSITY = 1.5, SKIN = 0.18, JITTER = 0.55, JFREQ = 1.6, BOIL = 0.5, BOUND = 1.55;
/** Dispersing: how many smaller puffs each breaks into, their size (× its), how hard they're pushed apart (× its radius
 *  a second, before drag), how long they hold before they dissipate (s). */
const KIDS = 2, KID_R: [number, number] = [0.5, 0.65], KID_PUSH = 1.6, KID_HOLD: [number, number] = [0.12, 0.45];

Effect.ShadersStore.volSmokeVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 world, viewProjection;
varying vec3 vW;
void main(void) {
  vec4 w = world * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = viewProjection * w;
}`;
Effect.ShadersStore.volSmokeFragmentShader = /* glsl */ `
precision highp float;
uniform vec3 sun, eye, centre, lit, mid, shade, rimC;
uniform float radius, time, seed, erode, floorY;
varying vec3 vW;
${NOISE}
vec3 fbm3(vec3 p) { return vec3(fbm(p), fbm(p + vec3(134.6, 0.0, 45.7)), fbm(p + vec3(0.0, 456.8, -123.4))); }
void main(void) {
  // The eye's ray, in the sphere's own units (its centre the origin, its radius 1).
  vec3 rd = normalize(vW - eye);
  vec3 ro = (eye - centre) / radius;
  // Its start jittered by noise read where this pixel crosses the puff: the sphere's edge torn, fluffy, boiling.
  vec3 q = (vW - centre) / radius;
  ro += (fbm3(q * ${JFREQ.toFixed(2)} + vec3(seed, seed * 0.7, time * ${BOIL.toFixed(2)})) - 0.5) * ${(JITTER * 2).toFixed(2)};
  // Into the sphere: where it meets it, and how far it runs inside (its half chord, Rz).
  float b = dot(-ro, rd);
  float det = b * b - dot(ro, ro) + 1.0;
  if (det <= 0.0) discard;
  float Rz = sqrt(det);
  float t = b - Rz;
  vec3 P = ro + rd * max(t, 0.0);
  vec3 N = normalize(P);
  // (Nothing of it under the floor.)
  if ((centre + P * radius).y < floorY) discard;
  // Its skin thinner than its core (the linear-density profile): a chord through the skin only counts for less.
  float h = ${SKIN.toFixed(2)};
  float dH = 1.0 + h * (h - 2.0) / max(Rz * Rz, 1e-4);
  Rz = dH > 0.0 ? Rz * 0.5 * (1.0 + sqrt(dH)) : Rz * 0.5 * (1.0 - sqrt(max(0.0, 1.0 - Rz * Rz))) / h;
  // How opaque: by how far it runs through it.
  float alpha = 1.0 - exp(-${DENSITY.toFixed(2)} * Rz);
  // Thinning away as it goes: eroded by noise, its density falling.
  float n = fbm(N * 2.3 + vec3(seed * 1.3, time * 0.6, seed));
  alpha *= smoothstep(erode - 0.05, erode + 0.12, n) * (1.0 - erode * 0.6);
  if (alpha < 0.01) discard;
  // The light through it (analytic transmittance): toward the sun lit, away from it dark; a glow at its rim where the
  // sun is behind it.
  vec3 L = normalize(sun), O = -rd;
  float NL = clamp(dot(N, L), 0.0, 1.0), NO = clamp(dot(N, O), 0.0, 1.0);
  float tr = NL / (NL + NO + 0.05);
  vec3 c = mix(shade, mid, smoothstep(0.0, 0.35, tr));
  c = mix(c, lit, smoothstep(0.35, 0.85, tr));
  float back = pow(clamp(dot(rd, L), 0.0, 1.0), 4.0) * (1.0 - alpha);
  c += rimC * back * 0.6;
  gl_FragColor = vec4(c, alpha);
}`;

export interface SmokeShot {
  /** Its user's height (it all scales with it). */
  height: number;
  /** Where it comes out (the mouth). */
  from: Vector3;
  /** Where it's thrown (the target, or a point ahead). */
  to: Vector3;
  /** The floor under it (world y). */
  floor: number;
  /** Its colours, if not Smokescreen's dark grey (lit, mid, shadow, rim). */
  look?: { lit: [number, number, number]; mid: [number, number, number]; shade: [number, number, number]; rim: [number, number, number] };
}

export interface SmokePlay {
  /** Resolves as the cloud has gathered at its target (where it takes effect). */
  readonly gathered: Promise<void>;
  /** Where the cloud is (its middle) and how far it spreads, this frame — what it covers. */
  cover(): { at: Vector3; radius: number };
  /** Resolves once it has all eroded away. */
  readonly done: Promise<void>;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

export class SmokeFx {
  /** How long it sprays out of the mouth (s): its user holds its pose that long. */
  static readonly SPRAY = EMIT;
  constructor(private readonly scene: Scene) {}

  private sunDir(): Vector3 {
    const sun = this.scene.lights.find((l) => l instanceof DirectionalLight) as DirectionalLight | undefined;
    return sun ? sun.direction.scale(-1).normalize() : new Vector3(0.5, 0.85, 0.5).normalize();
  }

  play(shot: SmokeShot): SmokePlay {
    const scene = this.scene, H = shot.height;
    const look = shot.look ?? { lit: LIT, mid: MID, shade: SHADE, rim: RIM };
    const aim = shot.to.subtract(shot.from); aim.y *= 0.4;
    const way = aim.normalizeToNew();
    // (It comes out a little ahead of the mouth, clear of the face: MOUTH_CLEAR × its height along the way.)
    const from = shot.from.add(way.scale(MOUTH_CLEAR * H));
    const dist = Math.max(0.5, aim.length() - MOUTH_CLEAR * H);
    // Each puff: where it's thrown (spread round the line to the target, more at its far end), when, how big. A cloud's
    // puff, its time up, breaks into smaller ones (`kid`) drifting apart, which then dissipate.
    type Puff = { mesh: Mesh; mat: ShaderMaterial; born: number; pos: Vector3; vel: Vector3; r: number; start: number; seed: number; spin: number; erodeAt: number; erodeFor: number; kid: boolean; split: boolean };
    const puffs: Puff[] = [];
    const makePuff = (o: Omit<Puff, 'mesh' | 'mat' | 'split'>): Puff => {
      // (Its mesh only its bounds — the sphere itself ray-traced inside it; its front faces only, each pixel once.)
      const mesh = MeshBuilder.CreateIcoSphere('smokePuff', { radius: 1, subdivisions: 2, flat: false }, scene);
      mesh.isPickable = false;
      const mat = new ShaderMaterial('volSmoke', scene, { vertex: 'volSmoke', fragment: 'volSmoke' }, {
        attributes: ['position'],
        uniforms: ['world', 'viewProjection', 'sun', 'eye', 'centre', 'radius', 'lit', 'mid', 'shade', 'rimC', 'time', 'seed', 'erode', 'floorY'],
        needAlphaBlending: true,
      });
      mat.setColor3('lit', new Color3(...look.lit)); mat.setColor3('mid', new Color3(...look.mid));
      mat.setColor3('shade', new Color3(...look.shade)); mat.setColor3('rimC', new Color3(...look.rim));
      mat.setFloat('floorY', shot.floor);
      mat.alphaMode = Constants.ALPHA_COMBINE;
      mat.disableDepthWrite = true;
      mat.backFaceCulling = true;
      mesh.material = mat;
      mesh.setEnabled(false);
      const p: Puff = { ...o, mesh, mat, split: false };
      puffs.push(p);
      return p;
    };
    // A spray, not a throw of balls: a steady stream of small, thin puffs out of the mouth over EMIT s, each carried
    // somewhere along the way to the target (more of them right to it), small where it leaves the mouth and wider the
    // further it goes — so many, so thin and so overlapping they read as one continuous plume, widening into a cloud.
    for (let i = 0; i < PUFFS; i++) {
      const reachK = 0.15 + 1.0 * Math.pow(Math.random(), 0.55);
      const cone = H * (0.12 + 0.5 * reachK);
      const spread = new Vector3(rnd(-0.2, 0.2), rnd(-0.55, 0.35), rnd(-1, 1)).scale(cone);
      const vel = way.scale(dist * reachK * DRAG).add(spread.scale(DRAG));
      const born = (i / PUFFS) * EMIT + rnd(0, 0.02);
      makePuff({ born, pos: from.clone(), vel, r: rnd(...PUFF_R) * H * (0.45 + 0.75 * reachK), start: START,
        seed: rnd(0, 50), spin: rnd(-0.6, 0.6), erodeAt: born + HANG + rnd(0, 0.5), erodeFor: ERODE, kid: false });
    }
    /** Its time up, a puff breaks into KIDS smaller ones, pushed apart from where it was; it goes, they dissipate. */
    const split = (p: Puff, at: number, r: number) => {
      p.split = true;
      p.mesh.setEnabled(false);
      for (let j = 0; j < KIDS; j++) {
        const a = (j / KIDS) * Math.PI * 2 + rnd(-0.4, 0.4);
        const out = new Vector3(Math.cos(a), rnd(-0.2, 0.7), Math.sin(a) * 0.8).normalize();
        makePuff({ born: at, pos: p.pos.add(out.scale(r * 0.45)), vel: out.scale(r * KID_PUSH * DRAG).add(p.vel), r: r * rnd(...KID_R), start: 0.9,
          seed: p.seed + j * 7.1, spin: rnd(-1, 1), erodeAt: at + rnd(...KID_HOLD), erodeFor: ERODE * 0.8, kid: true });
      }
    };
    let t = 0, gatheredYet = false, gRes!: () => void, dRes!: () => void;
    const gathered = new Promise<void>((r) => { gRes = r; });
    const done = new Promise<void>((r) => { dRes = r; });
    const centre = from.add(way.scale(dist));
    const sun = this.sunDir();
    const obs: Observer<Scene> = scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min(0.05, scene.getEngine().getDeltaTime() / 1000);
      t += dt;
      const eye = scene.activeCamera!.globalPosition;
      let alive = 0;
      for (const p of [...puffs]) {
        if (p.split) continue;
        const age = t - p.born;
        if (age < 0) { alive++; continue; }
        const r = p.r * (p.start + (1 - p.start) * easeOut(age / GROW));
        // (A cloud's puff, its time up: broken into smaller ones.)
        if (!p.kid && t >= p.erodeAt) { split(p, t, r); alive++; continue; }
        const erode = Math.max(0, (t - p.erodeAt) / p.erodeFor);
        if (erode >= 1) { if (p.mesh.isEnabled()) p.mesh.setEnabled(false); continue; }
        alive++;
        p.mesh.setEnabled(true);
        // Thrown, slowing (drag), drifting up; sitting on the floor.
        p.pos.addInPlace(p.vel.scale(dt));
        p.vel.scaleInPlace(Math.exp(-DRAG * dt));
        p.pos.y += RISE * H * (p.kid ? 1.8 : 1) * dt;
        const rr = r * (1 + 0.15 * erode);
        // (Sitting on the floor — its foot sunk a little into it, hidden there, not flattened: flat-bottomed, it reads as rock.)
        p.pos.y = Math.max(p.pos.y, shot.floor + rr * 0.35);
        p.mesh.position.copyFrom(p.pos);
        p.mesh.scaling.setAll(rr * BOUND);
        const m = p.mat;
        m.setFloat('time', t); m.setFloat('seed', p.seed); m.setFloat('erode', Math.min(0.99, Math.pow(erode, 0.8)));
        m.setVector3('sun', sun); m.setVector3('eye', eye); m.setVector3('centre', p.pos); m.setFloat('radius', rr);
      }
      if (!gatheredYet && t >= EMIT * 0.6 + GROW * 0.6) { gatheredYet = true; gRes(); }
      if (!alive && t > EMIT) {
        scene.onBeforeRenderObservable.remove(obs);
        for (const p of puffs) { p.mat.dispose(); p.mesh.dispose(); }
        if (!gatheredYet) gRes();
        dRes();
      }
    })!;
    return {
      gathered, done,
      cover: () => {
        const on = puffs.filter((p) => p.mesh.isEnabled() && !p.kid);
        if (!on.length) return { at: centre, radius: 0 };
        const at = on.reduce((a, p) => a.addInPlace(p.pos), new Vector3()).scale(1 / on.length);
        const radius = Math.max(...on.map((p) => Vector3.Distance(p.pos, at) + p.r * 0.8));
        return { at, radius };
      },
    };
  }
}
