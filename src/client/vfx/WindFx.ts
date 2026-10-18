/**
 * WindFx — tornadoes and wind, after a Shadertoy fire-tornado shader the user
 * supplied (raymarched, Voronoi-carved column + a see-through outer shell).
 *
 *   inner    the tornado itself: a column whose centre wanders with height
 *            (two fbm sines of y), whose radius flares toward the top
 *            (cos(1.25y + 2) + 0.75 + e^(−10y)), its surface carved by a
 *            Voronoi field laid out in (angle − 4y, y − t) — cells that wind
 *            round it and climb. Shaded by the carving: the rims of the cells
 *            glow (the source's `glow = bump < 0.35`).
 *   outer    the outer tornado: a transparent shell of radius
 *            2 − 0.66·sin(0.75y + 1), with swirling Voronoi streaks in
 *            (angle − 2.5y, y − 2t). On its own it is the wind effect.
 *
 * Both are evaluated per pixel along the view ray inside a bounding cylinder
 * mesh, in the tornado's own unit space (y −1 … TOP, the source's frame), then
 * scaled and placed in the world.
 *
 *   Gust     a whirlwind that grows out of the ground on the target, briefly
 *   Twister  a large tornado that grows out of the ground on the target and holds it
 *   shell    the outer tornado alone, round a Pokémon (wind around it)
 */

import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Constants } from '@babylonjs/core/Engines/constants';
import '@babylonjs/core/Meshes/Builders/cylinderBuilder';

type RGB = [number, number, number];

/** The source's frame: the column runs y −1 … TOP; the outer shell is at most R_OUT wide. */
const TOP = 2.4, R_OUT = 2.7;
const STEPS = 180;

Effect.ShadersStore.windVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 world, viewProjection;
varying vec3 vW;
void main(void) {
  vec4 w = world * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = viewProjection * w;
}`;

Effect.ShadersStore.windFragmentShader = /* glsl */ `
precision highp float;
varying vec3 vW;
uniform vec3 camPos, base;      // base: the tornado's foot (world)
uniform float scale, time, power, inner, outer, spin;
uniform vec3 cDark, cLight, cGlow, cShell;

// ── the source's noise ──
vec2 hash2(vec2 p) {
  p = mod(p, 4.0);
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}
float voronoi(vec2 x, float t) {
  vec2 n = floor(x), f = fract(x);
  float md = 5.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = 0.5 + 0.5 * sin(t + 6.2831 * hash2(n + g));
    vec2 r = g + o - f;
    md = min(md, dot(r, r));
  }
  return md;
}
float fbm1x(float x, float time) {
  float y = sin(x);
  float t = 0.01 * (-time * 130.0);
  y += sin(x * 2.1 + t) * 4.5;
  y += sin(x * 1.72 + t * 1.121) * 4.0;
  y += sin(x * 2.221 + t * 0.437) * 5.0;
  y += sin(x * 3.1122 + t * 4.269) * 2.5;
  return y * 0.06;
}
// Column centre (xz) and radius at height y.
vec3 cylAt(float y, float t) {
  float yf = y + 1.0;
  float s = cos(yf * 1.25 + 2.0) + 0.75 + exp(-10.0 * yf);
  return vec3(vec2(fbm1x(yf, t), fbm1x(yf + 78.233, t)) * (0.5 + 0.2 * yf), 0.5 + s);
}
const float BUMP = 0.3;
const float WALL = 0.18;
const float TOP = ${TOP.toFixed(2)};
#define STEPS ${STEPS}
float world(vec3 p, float t, out float bump) {
  vec3 c = cylAt(p.y, t);
  vec2 q = vec2(atan(p.x - c.x, p.z - c.y) * 4.0 / 6.2831 - p.y * 4.0 + t * spin, p.y - t) * 2.0;
  float n = voronoi(q, t) * BUMP;
  bump = n;
  // A hollow funnel: a wall WALL thick, so you can see down into it and out from inside.
  return abs(length(p.xz - c.xy) - (c.z - n) * inner) - WALL * inner;
}
// Where the ray enters the bounding volume (radius R_OUT, y −1 … TOP); 0 if it starts inside.
float entry(vec3 ro, vec3 rd) {
  float a = dot(rd.xz, rd.xz), b = 2.0 * dot(ro.xz, rd.xz), c = dot(ro.xz, ro.xz) - ${R_OUT.toFixed(2)} * ${R_OUT.toFixed(2)};
  float tr = 0.0;
  if (c > 0.0) { float disc = b * b - 4.0 * a * c; if (disc < 0.0 || a < 1e-6) return -1.0; tr = (-b - sqrt(disc)) / (2.0 * a); }
  float ty = 0.0;
  if (ro.y > TOP) ty = (TOP - ro.y) / rd.y; else if (ro.y < -1.0) ty = (-1.0 - ro.y) / rd.y;
  if (ty < 0.0) return -1.0;
  return max(max(tr, ty), 0.0);
}

// The shell's crossing (front: i = 0, back: i = 1) and its opacity there.
float shellAt(vec3 ro, vec3 rd, int i, float t0, out float sHit) {
  sHit = -1.0;
  float R = (2.0 - 0.66 * 0.5) * outer;
  for (int k = 0; k < 2; k++) {
    float a = dot(rd.xz, rd.xz), b = 2.0 * dot(ro.xz, rd.xz), c = dot(ro.xz, ro.xz) - R * R;
    float disc = b * b - 4.0 * a * c;
    if (disc < 0.0 || a < 1e-5) return 0.0;
    float s = (-b + (i == 0 ? -1.0 : 1.0) * sqrt(disc)) / (2.0 * a);
    vec3 p = ro + rd * s;
    if (k == 0) { R = (2.0 - sin(p.y * 0.75 + 1.0) * 0.66) * outer; continue; }
    if (s <= 0.0 || p.y < -1.0 || p.y > TOP) return 0.0;
    sHit = s;
    float ang = atan(p.x, p.z);
    float f = voronoi(vec2(ang - p.y * 2.5 - t0 * spin * 0.6, p.y - t0 * 2.0) * 4.0 / 6.2831, t0 * 0.1);
    float h = smoothstep(-1.0, 2.0, p.y);
    float a2 = smoothstep(0.4, 0.5, pow(f, 0.75)) * (0.35 + 0.45 * h);
    return a2 * smoothstep(-1.0, -0.6, p.y) * smoothstep(TOP, TOP - 0.6, p.y);
  }
  return 0.0;
}

void main(void) {
  // The view ray, in the tornado's unit space, from where it enters the bounding mesh.
  vec3 ro = (camPos - base) / scale;
  vec3 rd = normalize(vW - camPos);
  float t0 = time;
  float start = entry(ro, rd);
  if (start < 0.0) discard;
  // A hair inside: a ray entering through the top cap at exactly y = TOP would
  // round to just above it and miss the column for whole rows of pixels.
  start += 0.01;

  // Inner tornado: march.
  vec3 colC = vec3(0.0); float aC = 0.0; float tHit = 1e9;
  if (inner > 0.001) {
    float d = start, dPrev = start;
    for (int i = 0; i < STEPS; i++) {
      vec3 p = ro + rd * d;
      if ((rd.y > 0.0 && p.y > TOP) || (rd.y < 0.0 && p.y < -1.05)) break;
      float bump;
      float s = world(p, t0, bump);
      // (Not the flared foot right at the floor: grazing rays there flickered row by row.)
      // Hit tolerance grows with distance (about a pixel's footprint): rays that
      // run along the leaning inner wall would otherwise hit or miss row by row.
      float eps = 0.004 + 0.012 * (d - start);
      if (s < eps && p.y >= -0.85 && p.y <= TOP + 0.02) {
        // Refine the hit between the last two samples (a stepped hit height
        // shows as bands, the top fade most of all).
        float lo = dPrev, hi = d;
        for (int k = 0; k < 6; k++) {
          float mid = 0.5 * (lo + hi);
          float bm; if (world(ro + rd * mid, t0, bm) < eps) hi = mid; else lo = mid;
        }
        d = hi; p = ro + rd * d; s = world(p, t0, bump);
        vec3 c = cylAt(p.y, t0);
        // How deep the carving is here (0 at the deepest cell, 1 on the crest).
        float b = clamp(1.0 - bump / BUMP, 0.0, 1.0);
        float rim = 1.0 - smoothstep(0.2, 0.42, b);
        float h = clamp((p.y + 1.0) / (TOP + 1.0), 0.0, 1.0);
        colC = mix(mix(cDark, cLight, smoothstep(0.1, 1.0, b)), cGlow, rim * 0.85) * (0.75 + 0.35 * h);
        aC = smoothstep(TOP + 0.05, TOP - 0.35, p.y) * smoothstep(-0.85, -0.45, p.y);
        // Seen from inside (or down into it), the far wall reads a little darker.
        if (length(ro.xz - c.xy) < c.z * inner) colC *= 0.8;
        tHit = d;
        break;
      }
      dPrev = d;
      d += max(s * 0.32, 0.004); // the radius changes fast with height: small steps, or rays skip the wall
      if (d > start + ${(R_OUT * 2 + 1).toFixed(1)}) break;
    }
  }

  // Composite back to front, premultiplied: back of the shell, the column, front of the shell.
  vec4 acc = vec4(0.0);
  if (outer > 0.001) {
    float sb; float ab = shellAt(ro, rd, 1, t0, sb);
    if (sb > 0.0 && sb < tHit) acc = vec4(cShell * ab, ab);
  }
  acc = vec4(colC * aC, aC) + acc * (1.0 - aC);
  if (outer > 0.001) {
    float sf; float af = shellAt(ro, rd, 0, t0, sf);
    if (sf > 0.0 && sf < tHit) acc = vec4(cShell * af, af) + acc * (1.0 - af);
  }
  acc *= power;
  if (acc.a < 0.01) discard;
  gl_FragColor = acc;
}`;

export interface WindStyle { dark: RGB; light: RGB; glow: RGB; shell: RGB }

/** Colours per element: the source's grey column with a pale-blue shell, and its fire glow for Fire. */
export function windStyle(element: string): WindStyle {
  switch (element) {
    case 'Fire': return { dark: [0.08, 0.02, 0.0], light: [0.9, 0.35, 0.05], glow: [1.0, 0.75, 0.15], shell: [1.0, 0.55, 0.15] };
    case 'BlueFire': return { dark: [0.0, 0.01, 0.08], light: [0.05, 0.2, 0.9], glow: [0.4, 0.62, 1.0], shell: [0.1, 0.3, 1.0] };
    case 'Dragon': return { dark: [0.12, 0.04, 0.22], light: [0.55, 0.35, 0.9], glow: [0.85, 0.75, 1.0], shell: [0.6, 0.45, 1.0] };
    default: return { dark: [0.45, 0.5, 0.55], light: [0.92, 0.95, 0.98], glow: [1.0, 1.0, 1.0], shell: [0.3, 0.7, 1.0] }; // Flying / wind
  }
}

export interface Tornado {
  mesh: Mesh;
  mat: ShaderMaterial;
  /** The foot (world). */
  base: Vector3;
  /** World units per source unit. */
  scale: number;
  power: number;
  inner: number;
  outer: number;
}

export class WindFx {
  private live = new Set<Tornado>();
  private time = 0;
  private tick: Observer<Scene>;

  constructor(readonly scene: Scene, readonly camera: Camera) {
    this.tick = scene.onBeforeRenderObservable.add(() => this.update());
  }

  /** A tornado (inner column and/or outer shell), standing at `base`, `height` tall. */
  make(base: Vector3, height: number, style: WindStyle, { inner = 1, outer = 1, spin = 2.2 } = {}): Tornado {
    const scale = height / (TOP + 1);
    // A bounding cylinder over the whole funnel, in the tornado's frame.
    const mesh = MeshBuilder.CreateCylinder('tornado', { height: TOP + 1, diameter: R_OUT * 2, tessellation: 32 }, this.scene);
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    const mat = new ShaderMaterial('tornadoMat', this.scene, { vertex: 'wind', fragment: 'wind' }, {
      attributes: ['position'],
      uniforms: ['world', 'viewProjection', 'camPos', 'base', 'scale', 'time', 'power', 'inner', 'outer', 'spin', 'cDark', 'cLight', 'cGlow', 'cShell'],
      needAlphaBlending: true,
    });
    // The bounding mesh's INSIDE faces: they are there whether the camera is
    // outside, inside or above; each pixel's ray is traced once, from where it
    // enters the volume (or from the camera, inside it).
    mat.backFaceCulling = true;
    mat.cullBackFaces = false;
    mat.disableDepthWrite = true;
    mat.alphaMode = Constants.ALPHA_PREMULTIPLIED;
    const v3 = (c: RGB) => new Vector3(c[0], c[1], c[2]);
    mat.setVector3('cDark', v3(style.dark)); mat.setVector3('cLight', v3(style.light));
    mat.setVector3('cGlow', v3(style.glow)); mat.setVector3('cShell', v3(style.shell));
    mat.setFloat('spin', spin);
    mesh.material = mat;
    const t: Tornado = { mesh, mat, base: base.clone(), scale, power: 0, inner, outer };
    this.live.add(t);
    this.place(t);
    return t;
  }

  dispose(t: Tornado): void {
    this.live.delete(t);
    t.mat.dispose();
    t.mesh.dispose();
  }

  private place(t: Tornado): void {
    t.mesh.position.set(t.base.x, t.base.y + ((TOP - 1) / 2 + 1) * t.scale, t.base.z);
    t.mesh.scaling.setAll(t.scale);
  }

  private update(): void {
    this.time += Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
    const cam = this.camera.globalPosition;
    for (const t of this.live) {
      this.place(t);
      // The shader's frame has its foot at y = −1: shift the base by one unit.
      const m = t.mat;
      m.setVector3('camPos', cam);
      m.setVector3('base', t.base.add(new Vector3(0, t.scale, 0)));
      m.setFloat('scale', t.scale); m.setFloat('time', this.time);
      m.setFloat('power', t.power); m.setFloat('inner', t.inner); m.setFloat('outer', t.outer);
    }
  }

  // ── the moves ─────────────────────────────────────────────────────────

  /**
   * Gust: a whirlwind grows up out of the ground on the target's tile, whips
   * round it briefly and blows out. `hit` once it has grown; `contactEnds`
   * when it lets go.
   */
  gust(at: () => Vector3, size: number, element = 'Flying'): { hit: Promise<void>; contactEnds: Promise<void>; done: Promise<void> } {
    return this.rising(at, size * 1.3, element, { grow: 1.1, hold: 1.4, fade: 0.5, inner: 0.75, outer: 0.7, spin: 3 });
  }

  /**
   * Twister: a big tornado grows up out of the ground on the target and holds
   * it, then dies.
   */
  twister(at: () => Vector3, size: number, element = 'Dragon'): { hit: Promise<void>; contactEnds: Promise<void>; done: Promise<void> } {
    return this.rising(at, size * 2.2, element, { grow: 1.5, hold: 2.0, fade: 0.6, inner: 0.8, outer: 1, spin: 2.6 });
  }

  /** A tornado that grows up from the ground at `at` (its height scales from 0), holds, and fades. */
  private rising(at: () => Vector3, height: number, element: string,
    o: { grow: number; hold: number; fade: number; inner: number; outer: number; spin: number }) {
    const t = this.make(at(), height, windStyle(element), { inner: o.inner, outer: o.outer, spin: o.spin });
    const full = t.scale;
    let endContact!: () => void;
    const contactEnds = new Promise<void>((r) => { endContact = r; });
    let ended = false;
    const res = this.animate(t, (k, dt, el) => {
      const p = at();
      t.base.set(p.x, p.y, p.z);
      // Out of the ground: the funnel's size rises gradually from nothing (its foot stays on the tile).
      const g = Math.min(1, el / o.grow);
      t.scale = full * Math.max(0.02, g * g * (3 - 2 * g));
      t.power = Math.min(1, el / (o.grow * 0.5)) * (1 - Math.max(0, (el - o.grow - o.hold) / o.fade));
      if (!ended && el >= o.grow + o.hold) { ended = true; endContact(); }
      return { hitNow: el >= o.grow, over: el >= o.grow + o.hold + o.fade };
    });
    void res.done.then(() => { if (!ended) endContact(); });
    return { ...res, contactEnds };
  }

  /** The outer tornado alone, round a Pokémon, for `seconds` (wind around it). */
  shell(at: () => Vector3, size: number, seconds = 1.2, element = 'Flying'): Promise<void> {
    const t = this.make(at(), size * 1.4, windStyle(element), { inner: 0, outer: 0.55, spin: 2 });
    return this.animate(t, (k, dt, el) => {
      const p = at();
      t.base.set(p.x, p.y, p.z);
      t.power = Math.min(1, el / 0.2) * (1 - Math.max(0, (el - seconds + 0.3) / 0.3));
      return { hitNow: false, over: el >= seconds };
    }).done;
  }

  private animate(t: Tornado, step: (k: number, dt: number, elapsed: number) => { hitNow: boolean; over: boolean }) {
    let hitFired = false, resolveHit!: () => void, resolveDone!: () => void;
    const hit = new Promise<void>((r) => { resolveHit = r; });
    const done = new Promise<void>((r) => { resolveDone = r; });
    let el = 0;
    const obs = this.scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
      el += dt;
      const { hitNow, over } = step(0, dt, el);
      if (hitNow && !hitFired) { hitFired = true; resolveHit(); }
      if (over) {
        this.scene.onBeforeRenderObservable.remove(obs);
        this.dispose(t);
        if (!hitFired) resolveHit();
        resolveDone();
      }
    });
    return { hit, done };
  }

  disposeAll(): void {
    this.scene.onBeforeRenderObservable.remove(this.tick);
    for (const t of [...this.live]) this.dispose(t);
  }
}
