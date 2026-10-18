/**
 * GlowSparks — sparks after two shaders the user supplied:
 *
 *  • "Sparks" (the ORIGINAL_SPARKS preset): each spark is a streak — a
 *    capsule along its velocity, `cylinder(pos, -v̂, |v|·LENGTH_FACTOR)` — so
 *    fast sparks are long and slow ones shrink to dots; outside the core it
 *    glows by 1/(1 + 100·d³); its colour cools with age,
 *        f = 1 − age·0.05,  rgb = (0.5f + 0.4, 0.5f² + 0.05, 0.2f²),  a = min(2f, 1)
 *    (gold to ember red); and it flies ballistically.
 *  • BigWings' "HAPPY 2016!" sparkler: brightness = size / distance², a
 *    burst on birth (size 10 → 0.5 over the first 20% of life, then fading),
 *    gravity, and sub-sparkles — some sparks split, part way through their
 *    life, into NUM_SUB_SPARKLES that explode outward in the secondary
 *    colour (1, 0.5, 0.3).
 *
 * One camera-facing quad per spark, stretched along its velocity; the
 * fragment shader measures the distance to the streak's segment and
 * shades core, glow and colour. Additive, so where they gather they bloom.
 */

import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Constants } from '@babylonjs/core/Engines/constants';

type RGB = [number, number, number];

Effect.ShadersStore.glowSparkVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;   // the spark's head
attribute vec4 motion;     // xyz = velocity direction (unit), w = streak length (world)
attribute vec4 params;     // x = age 0..1, y = size (core radius, world), z = corner along (-1|1), w = corner across (-1|1)
attribute vec3 tint;
uniform mat4 viewProjection;
uniform vec3 camPos;
uniform float glowK;
varying vec2 vLocal;       // world units: x along the streak from the head (back = +), y across
varying float vLen, vSize, vAge;
varying vec3 vTint;
void main(void) {
  vec3 dir = motion.xyz;
  float len = motion.w;
  float size = params.y;
  float pad = size * glowK; // the glow reaches this far
  vec3 view = normalize(camPos - position);
  vec3 across = cross(dir, view);
  if (dot(across, across) < 1e-8) across = cross(vec3(0.0, 1.0, 0.0), view);
  across = normalize(across);
  // The quad spans the streak (head → tail) plus the glow round it.
  float a = params.z < 0.0 ? -pad : len + pad;
  float b = params.w * pad;
  vec3 p = position - dir * a + across * b;
  vLocal = vec2(a, b); vLen = len; vSize = size; vAge = params.x; vTint = tint;
  gl_Position = viewProjection * vec4(p, 1.0);
}`;

Effect.ShadersStore.glowSparkFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vLocal;
varying float vLen, vSize, vAge;
varying vec3 vTint;
uniform float tintMix, intensity;
void main(void) {
  // Distance to the streak's segment, in core radii.
  float x = clamp(vLocal.x, 0.0, vLen);
  float d = length(vec2(vLocal.x - x, vLocal.y)) / max(vSize, 1e-5);
  // The colour cools with age (the sparks shader's color(age)); tinted toward the element.
  float f = 1.0 - vAge;
  vec3 hot = vec3(0.5 * f + 0.4, 0.5 * f * f + 0.05, 0.2 * f * f);
  vec3 c = mix(hot, vTint * (0.45 + 0.55 * f), tintMix);
  float alpha = min(f * 2.0, 1.0);
  // Solid core, then the 1/(1 + 100 d³) glow (d rescaled so the halo is a few radii).
  float core = 1.0 - smoothstep(0.7, 1.0, d);
  float dg = max(d - 1.0, 0.0) * 0.18;
  float glow = 1.0 / (1.0 + 100.0 * dg * dg * dg) * 0.55;
  // The head burns hotter than the tail.
  float head = 1.0 - 0.45 * clamp(x / max(vLen, 1e-4), 0.0, 1.0);
  float light = (core * 1.6 + glow) * head * alpha * intensity;
  if (light < 0.004) discard;
  // White-hot in the core.
  vec3 rgb = mix(c, vec3(1.0, 0.95, 0.85), core * 0.55 * f);
  gl_FragColor = vec4(rgb * light, light);
}`;

export interface GlowSparkStyle {
  /** Core radius at the size envelope's 1.0 (world units). */
  size: number;
  /** Streak length per unit speed (s) — the sparks shader's LENGTH_FACTOR, in time. */
  lengthPerSpeed: number;
  /** Element tint, and how far the gold→ember ramp is pulled toward it (0 = the shader's own). */
  tint: RGB;
  tintMix: number;
  /** Gravity (world units / s², downward), drag (fraction of speed per s), turbulence (world / s²). */
  gravity: number;
  drag: number;
  turbulence: number;
  /** Sub-sparkles: the share of sparks that split, and into how many. */
  splitChance: number;
  splitCount: number;
  /** Secondary colour for the split pieces (the sparkler's SECONDARY_PARTICLE_COLOR). */
  secondary: RGB;
  intensity: number;
}

/**
 * The beam the sparks belong to, set each frame: they never pass its front
 * (the contact point), and once one is out of its radius it swirls round
 * its axis on a random, curling path.
 */
export interface SparkField {
  origin: Vector3;
  dir: Vector3; //    unit, attacker → target
  front: number; //   distance along dir where the beam meets the target
  radius: number; //  the beam's radius: inside it sparks stream straight
  swirl: number; //   tangential acceleration once outside (world / s²)
}

interface Spark {
  alive: boolean;
  spin: number; // its own swirl direction and rate (−1.6 … 1.6, never near 0)
  p: Vector3;
  v: Vector3;
  life: number;
  age: number;
  seed: number;
  splitAt: number; // age fraction at which it splits (> 1 = never)
  tint: RGB;
  child: boolean;
  pull: Vector3 | null;
  pullStrength: number;
}

export class GlowSparks {
  readonly mesh: Mesh;
  /** The beam's frame, when these sparks belong to one. */
  field: SparkField | null = null;
  private mat: ShaderMaterial;
  private sparks: Spark[] = [];
  private pos: Float32Array;
  private motion: Float32Array;
  private params: Float32Array;
  private tint: Float32Array;
  private time = 0;

  constructor(scene: Scene, private readonly camera: Camera, private readonly max: number, readonly style: GlowSparkStyle) {
    for (let i = 0; i < max; i++) {
      this.sparks.push({
        alive: false, spin: 1, p: new Vector3(), v: new Vector3(), life: 1, age: 0, seed: 0, splitAt: 2,
        tint: style.tint, child: false, pull: null, pullStrength: 0,
      });
    }
    const n = max * 4;
    this.pos = new Float32Array(n * 3);
    this.motion = new Float32Array(n * 4);
    this.params = new Float32Array(n * 4);
    this.tint = new Float32Array(n * 3);
    const idx: number[] = [];
    for (let i = 0; i < max; i++) {
      const a = i * 4;
      idx.push(a, a + 1, a + 2, a, a + 2, a + 3);
      // Corners: (-,-) (+,-) (+,+) (-,+) in (along, across).
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      corners.forEach(([ca, cb], k) => { this.params[(a + k) * 4 + 2] = ca; this.params[(a + k) * 4 + 3] = cb; });
    }
    this.mesh = new Mesh('glowSparks', scene);
    const vd = new VertexData();
    vd.positions = this.pos; vd.indices = idx;
    vd.applyToMesh(this.mesh, true);
    this.mesh.setVerticesData('motion', this.motion, true, 4);
    this.mesh.setVerticesData('params', this.params, true, 4);
    this.mesh.setVerticesData('tint', this.tint, true, 3);
    this.mat = new ShaderMaterial('glowSparksMat', scene, { vertex: 'glowSpark', fragment: 'glowSpark' }, {
      attributes: ['position', 'motion', 'params', 'tint'],
      uniforms: ['viewProjection', 'camPos', 'glowK', 'tintMix', 'intensity'],
      needAlphaBlending: true,
    });
    this.mat.backFaceCulling = false;
    this.mat.disableDepthWrite = true;
    this.mat.alphaMode = Constants.ALPHA_ONEONE; // premultiplied-additive: it adds light
    this.mat.setFloat('glowK', 6);
    this.mat.setFloat('tintMix', style.tintMix);
    this.mat.setFloat('intensity', style.intensity);
    this.mesh.material = this.mat;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.doNotSyncBoundingInfo = true;
  }

  /** A spark at `p` moving at `v`, living `life` s; optionally drawn toward `pull`. */
  spawn(p: Vector3, v: Vector3, life: number, pull: Vector3 | null = null, pullStrength = 0): void {
    this.add(p, v, life, false, this.style.tint, pull, pullStrength);
  }

  private add(p: Vector3, v: Vector3, life: number, child: boolean, tint: RGB, pull: Vector3 | null = null, pullStrength = 0): void {
    const s = this.sparks.find((x) => !x.alive);
    if (!s) return;
    s.alive = true;
    s.p.copyFrom(p);
    s.v.copyFrom(v);
    s.life = life;
    s.age = 0;
    s.seed = Math.random() * 100;
    s.spin = (Math.random() < 0.5 ? -1 : 1) * (0.7 + Math.random() * 0.9);
    s.child = child;
    s.tint = tint;
    // The sparkler: a share of the sparks split part way through their life.
    s.splitAt = !child && Math.random() < this.style.splitChance ? 0.35 + Math.random() * 0.35 : 2;
    s.pull = pull;
    s.pullStrength = pullStrength;
  }

  update(dt: number): void {
    this.time += dt;
    const st = this.style;
    const tmp = new Vector3();
    for (const s of this.sparks) {
      if (!s.alive) continue;
      s.age += dt;
      const t = s.age / s.life;
      if (t >= 1) { s.alive = false; continue; }
      if (t >= s.splitAt) {
        // Sub-sparkles: explode outward from here, in the secondary colour.
        s.alive = false;
        const speed = s.v.length();
        for (let k = 0; k < st.splitCount; k++) {
          const d = randomDir();
          this.add(s.p, s.v.scale(0.35).add(d.scale(0.6 * speed + 0.4)), s.life * (0.45 + Math.random() * 0.25), true, st.secondary);
        }
        continue;
      }
      // Ballistic, with drag, a little turbulence, an optional pull.
      const k = s.seed, tt = this.time, p = s.p;
      let jitter = st.turbulence;
      const fl = this.field;
      if (fl) {
        p.subtractToRef(fl.origin, tmp);
        const along = Vector3.Dot(tmp, fl.dir);
        // Never past the contact point.
        if (along > fl.front) { s.alive = false; continue; }
        // Out of the beam: swirl round its axis, curling more the further out.
        const radial = tmp.subtract(fl.dir.scale(along));
        const r = radial.length();
        if (r > fl.radius && r > 1e-5) {
          const out = Math.min(3, r / fl.radius - 1);
          const tangent = Vector3.Cross(fl.dir, radial).scaleInPlace(1 / r);
          s.v.addInPlace(tangent.scaleInPlace(fl.swirl * s.spin * (0.6 + out) * dt));
          // A little pull back in, so it orbits rather than flying off.
          s.v.addInPlace(radial.scaleInPlace(-fl.swirl * 0.35 * dt / r));
          jitter *= 2.5 + out * 2;
        }
      }
      tmp.set(Math.sin(p.y * 3 + tt * 11 + k), Math.sin(p.z * 3 + tt * 13 + k * 2), Math.sin(p.x * 3 + tt * 9 + k * 3));
      s.v.addInPlace(tmp.scaleInPlace(jitter * dt));
      s.v.y -= st.gravity * dt;
      if (s.pull) {
        s.pull.subtractToRef(p, tmp);
        s.v.addInPlace(tmp.scaleInPlace(s.pullStrength * dt));
      }
      s.v.scaleInPlace(Math.max(0, 1 - st.drag * dt));
      p.addInPlace(s.v.scale(dt));
    }
    this.write();
  }

  private write(): void {
    const st = this.style;
    const { pos, motion, params, tint } = this;
    this.sparks.forEach((s, i) => {
      for (let c = 0; c < 4; c++) {
        const v = i * 4 + c;
        if (!s.alive) { params[v * 4 + 1] = 0; motion[v * 4 + 3] = 0; continue; }
        const t = s.age / s.life;
        // The sparkler's envelope: a burst on birth, then a slow fade.
        const burst = s.child ? 0.1 : 0.2;
        const size = (2.2 - 1.6 * smooth(0, burst, t)) * smooth(1, 0.2, t) * st.size * (s.child ? 0.7 : 1);
        const speed = s.v.length();
        const dir = speed > 1e-5 ? s.v.scale(1 / speed) : Vector3.Up();
        pos[v * 3] = s.p.x; pos[v * 3 + 1] = s.p.y; pos[v * 3 + 2] = s.p.z;
        motion[v * 4] = dir.x; motion[v * 4 + 1] = dir.y; motion[v * 4 + 2] = dir.z;
        motion[v * 4 + 3] = speed * st.lengthPerSpeed;
        params[v * 4] = t; params[v * 4 + 1] = size;
        tint[v * 3] = s.tint[0]; tint[v * 3 + 1] = s.tint[1]; tint[v * 3 + 2] = s.tint[2];
      }
    });
    this.mat.setVector3('camPos', this.camera.globalPosition);
    this.mesh.updateVerticesData('position', pos);
    this.mesh.updateVerticesData('motion', motion);
    this.mesh.updateVerticesData('params', params);
    this.mesh.updateVerticesData('tint', tint);
  }

  dispose(): void {
    this.mat.dispose();
    this.mesh.dispose();
  }
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function randomDir(): Vector3 {
  const z = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z);
  return new Vector3(r * Math.cos(a), z, r * Math.sin(a));
}
