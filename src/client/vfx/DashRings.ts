/**
 * DashRings — the wake left by fast motion (docs/reference/EFFECTS.md,
 * Part 3 §7, `wake.rs`): two large, pale, see-through hoops standing in the
 * air where a dash began, square to the way it went, made of short filaments
 * that roll round the tube; they open fast and thin away within LIFE.
 *
 * "The beam's discharge and the dash's wake are the same two hoops": the
 * hoops, their opening and fading and the tube's swell are the beam's shock
 * rings (§5), scaled by SCALE. The filaments are a moving Worley field
 * gating the tube (the shipped Gate::Cells):
 *
 *   around = θ/2π · CELLS_A − φ/2π · SHEAR
 *   along  = φ/2π · CELLS_T − age · ROLL          (the pattern rolls round the tube)
 *   f      = cells(around, along, age · BOIL)     (distance to the nearest moving feature point)
 *   cut    = 1 − (1 − FIELD_CUT) · core · left;   kept where f ≥ cut, graded (f − cut)/(1 − cut)
 *
 * with core = 1/(1 + GLOW_FALL·d²) across the tube, and a cool neutral
 * palette ("the moment it takes a hue it becomes smoke"), nothing dark.
 * Translucency is by sparseness, so the scenery shows through.
 *
 * Each hoop is drawn as STRANDS thin bright rings close together, not as a
 * tube round them — the rings are the wake.
 */

import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';

// ── the doc's constants (wake.rs, and beam.rs for the hoops) ──
const LIFE = 0.8; //            s (the doc's 0.6, held a little longer so it reads)
/**
 * Hoops in model heights. The doc's 1.9 (~3.8 heights across) spans three of
 * our tiles and leaves the hoop mostly off-frame; ours is ~2.2 across.
 */
const SCALE = 1.1;
/**
 * Each hoop is a few thin bright ring STRANDS (the rings, not a tube round
 * them): sizes spread by STRAND_R, set apart along the dash by STRAND_AT,
 * each as thick as STRAND_W × the doc's tube, glowing (above 1 blooms).
 */
const STRANDS = 3, STRAND_R = 0.12, STRAND_AT = 0.08, STRAND_W = 0.45, GLOW = 1.7;
const RING_R = 1.0, RING_2 = 0.70, RING_AT = 0.40, RING_W = 0.055, TUBE_SWELL = 2.0;
const RING_EASE = 0.32, RING_OUT = 0.88;
const WAKE_AT = 0.45; //        centred this × height above the feet ("on the feet reads as a puddle")
const CELLS_A = 48, CELLS_T = 2, SHEAR = 1.4, ROLL = 2.0, BOIL = 1.3, FIELD_CUT = 0.26, GLOW_FALL = 2.6;

const SEG = 180, TUBE = 16;

Effect.ShadersStore.dashRingVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 viewProjection;
uniform vec3 center, axis, side, upv;
uniform float big, tube;
varying vec3 vN, vW;
varying vec2 vUV;
void main(void) {
  float th = uv.x * 6.2831853, ph = uv.y * 6.2831853;
  vec3 radial = cos(th) * side + sin(th) * upv;
  vec3 n = radial * cos(ph) + axis * sin(ph);
  vec3 p = center + radial * big + n * tube + position * 0.0;
  vN = n; vW = p; vUV = uv;
  gl_Position = viewProjection * vec4(p, 1.0);
}`;

Effect.ShadersStore.dashRingFragmentShader = /* glsl */ `
precision highp float;
varying vec3 vN, vW;
varying vec2 vUV;
uniform vec3 camPos, tint;
uniform float age, left, strand;
// A wrapped Worley field: feature points walk circles, keyed per cell.
vec2 cellHash(vec2 c) {
  return fract(sin(vec2(dot(c, vec2(127.1, 311.7)), dot(c, vec2(269.5, 183.3)))) * 43758.5453);
}
float cells(vec2 p, float t) {
  vec2 i = floor(p), f = fract(p);
  float best = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 c = i + o;
    c.x = mod(c.x, ${CELLS_A.toFixed(1)}); // seamless round the hoop
    vec2 h = cellHash(c);
    vec2 pt = o + 0.5 + 0.5 * sin(t + 6.2831853 * h);
    best = min(best, length(pt - f));
  }
  return clamp(best, 0.0, 1.0);
}
void main(void) {
  vec3 V = normalize(camPos - vW);
  float ndv = dot(normalize(vN), V);
  // d: 0 down the strand's middle as seen, 1 at its edge — a bright line, soft edges.
  float d = sqrt(max(0.0, 1.0 - ndv * ndv));
  float line = 1.0 - smoothstep(0.35, 1.0, d);
  // The doc's moving cells break each ring into filaments that roll round it;
  // the gaps open up as it fades.
  float around = vUV.x * ${CELLS_A.toFixed(1)} + strand * 7.3 + age * ${ROLL.toFixed(2)} * 3.0; // rolls the other way round (asked for)
  float f = cells(vec2(around, strand * 1.7), age * ${BOIL.toFixed(2)} * 6.2831853);
  float gap = mix(${FIELD_CUT.toFixed(2)} * 0.4, 0.62, 1.0 - left);
  if (f < gap) discard;
  float grade = clamp((f - gap) / max(1.0 - gap, 1e-3), 0.0, 1.0);
  // The cool neutral ramp: v = 0.62 + 0.36c, rgb = v·(236, 242, 255)/255.
  float v = 0.62 + 0.36 * (floor(grade * 3.0 + 0.5) / 3.0);
  vec3 rgb = v * vec3(236.0, 242.0, 255.0) / 255.0 * ${GLOW.toFixed(2)} * tint;
  float a = line * (0.75 + 0.25 * grade) * pow(max(left, 0.0), 0.5);
  if (a < 0.01) discard;
  gl_FragColor = vec4(rgb, a);
}`;

/** The ring-strand look, shared with the sonar pulse (PulseFx). */
export const RING_STRAND = { SEG, TUBE, RING_W, TUBE_SWELL, STRANDS, STRAND_R, STRAND_AT, STRAND_W };

export function grid(cols: number, rows: number): VertexData {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let i = 0; i <= cols; i++) for (let j = 0; j <= rows; j++) { positions.push(0, 0, 0); uvs.push(i / cols, j / rows); }
  const at = (i: number, j: number) => i * (rows + 1) + j;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    indices.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
  }
  const vd = new VertexData();
  vd.positions = positions; vd.uvs = uvs; vd.indices = indices;
  return vd;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

interface Wake {
  hoops: { mesh: Mesh; mat: ShaderMaterial }[];
  age: number;
  feet: Vector3;
  dir: Vector3;
  size: number;
}

export class DashRings {
  private geo = grid(SEG, TUBE);
  private wakes: Wake[] = [];
  private tick: Observer<Scene>;

  constructor(private readonly scene: Scene, private readonly camera: Camera) {
    this.tick = scene.onBeforeRenderObservable.add(() => this.update());
  }

  /**
   * Leave a wake where a dash begins: `feet` where the dasher stands, `dir`
   * the way it goes (the hoops stand square to it), `size` its height.
   */
  spawn(feet: Vector3, dir: Vector3, size: number): void {
    const d = dir.clone();
    d.y = 0;
    if (d.lengthSquared() < 1e-6) return;
    d.normalize();
    const hoops = Array.from({ length: 2 * STRANDS }, (_, i) => {
      const mesh = new Mesh(`dashRing${i}`, this.scene);
      this.geo.applyToMesh(mesh);
      const mat = new ShaderMaterial(`dashRingMat${i}`, this.scene, { vertex: 'dashRing', fragment: 'dashRing' }, {
        attributes: ['position', 'uv'],
        uniforms: ['viewProjection', 'center', 'axis', 'side', 'upv', 'big', 'tube', 'camPos', 'age', 'left', 'strand', 'tint'],
        needAlphaBlending: true,
      });
      mat.backFaceCulling = false;
      mat.disableDepthWrite = true;
      mat.setFloat('strand', i % STRANDS);
      mat.setVector3('tint', new Vector3(1, 1, 1)); // the wake's cool neutral
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true; // shaped in the shader
      mesh.doNotSyncBoundingInfo = true;
      return { mesh, mat };
    });
    this.wakes.push({ hoops, age: 0, feet: feet.clone(), dir: d, size });
  }

  private update(): void {
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
    const cam = this.camera.globalPosition;
    for (const w of this.wakes) {
      w.age += dt / LIFE;
      if (w.age >= 1) continue;
      const age = w.age;
      const open = Math.sin(Math.pow(age, RING_EASE) * Math.PI / 2);
      const left = Math.pow(1 - age, 1.15) * (1 - smoothstep(RING_OUT, 1, age));
      const tube = RING_W * (1 + TUBE_SWELL * open) * left * SCALE * STRAND_W * w.size;
      const center = w.feet.add(new Vector3(0, WAKE_AT * w.size, 0));
      // The hoops stand square to the dash: their axis is the travel direction.
      const side = new Vector3(-w.dir.z, 0, w.dir.x);
      const upv = new Vector3(0, 1, 0);
      w.hoops.forEach(({ mat }, j) => {
        // Hoop i (the big one, then the 70% one ahead), strand k within it.
        const i = Math.floor(j / STRANDS), k = (j % STRANDS) - (STRANDS - 1) / 2;
        // Each ring tapers along the dash: its forward strand (k > 0) is the
        // smallest, its back strand the largest — a cone opening backward.
        const big = (i === 0 ? RING_R : RING_R * RING_2) * open * SCALE * w.size * (1 - STRAND_R * k);
        const off = ((i === 0 ? 0 : RING_AT * open) + STRAND_AT * k) * SCALE * w.size;
        mat.setVector3('center', center.add(w.dir.scale(off)));
        mat.setVector3('axis', w.dir); mat.setVector3('side', side); mat.setVector3('upv', upv);
        mat.setFloat('big', Math.max(1e-3, big)); mat.setFloat('tube', Math.max(1e-4, tube));
        mat.setVector3('camPos', cam);
        mat.setFloat('age', age); mat.setFloat('left', left);
      });
    }
    // Gone at age 1.
    for (const w of this.wakes.filter((x) => x.age >= 1)) {
      for (const h of w.hoops) { h.mat.dispose(); h.mesh.dispose(); }
    }
    this.wakes = this.wakes.filter((x) => x.age < 1);
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.tick);
    for (const w of this.wakes) for (const h of w.hoops) { h.mat.dispose(); h.mesh.dispose(); }
    this.wakes = [];
  }
}
