/**
 * FireFx — flames rising up off a Pokémon, after XorDev's "3D Fire"
 * (Shadertoy; the turbulence technique: https://mini.gmshaders.com/p/turbulence).
 *
 * The source as it is: a ray marched through a hollow cone of fire, twisted
 * round its upright axis and opening out as it climbs, its surface torn by
 * the turbulence loop (waves of ever higher frequency shifting the point,
 * racing on in time); each step adds its colour, sin(z / 3 + (7, 2, 3)) + 1.1,
 * over its distance to the flame, and the sum is tone mapped by tanh.
 *
 * Here the cone stands on the Pokémon — its foot at the body's feet, as wide
 * as the body and taller than it — traced inside a bounding cylinder that
 * follows the body; drawn as light over the frame (UnitFx.addLight: after
 * tone mapping, the bodies hiding what is behind them).
 */

import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Matrix, Quaternion, Vector2, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { turnUpTo } from './WindFx.ts';
import type { RGB } from './auraPalette.ts';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Constants } from '@babylonjs/core/Engines/constants';
import '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import '@babylonjs/core/Meshes/Builders/sphereBuilder';

/** The source's frame: the flame from y = FOOT up to y = HEAD, at most R_OUT across (its units). */
const FOOT = -2.0, HEAD = 2.6, R_OUT = 2.0;
/** Raymarch steps (the source's 50). */
const STEPS = 50;
/** The glow's sum brought into tanh's range (the source's 1e3), and how bright it is drawn. */
const NORM = 1000.0, GAIN = 0.55;
/** Cel shading: the heat (its glow's mean, 0..1) where each of its three bands begins (the flame's edge first), and how solid they are. */
const CEL = [0.18, 0.4, 0.62], CEL_ALPHA = 0.95;
/** How many of the source's turbulence waves it keeps (its 6: the rest is fine, realistic tearing). */
const OCTAVES = 3;
/** How fast it fades in and out (s). */
const FADE = 0.45;

Effect.ShadersStore.risingFireVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 world, viewProjection;
varying vec3 vW;
void main(void) {
  vec4 w = world * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = viewProjection * w;
}`;

Effect.ShadersStore.risingFireFragmentShader = /* glsl */ `
precision highp float;
varying vec3 vW;
uniform vec3 camPos, base;   // base: the flame's foot (world)
uniform float scale;         // world units per source unit
uniform float width;         // the cone widened this much across (to the body)
uniform float time, power, tone, seed;
uniform mat3 axisInv;        // world to its frame (its axis there is up)
const float FOOT = ${FOOT.toFixed(2)}, HEAD = ${HEAD.toFixed(2)};

// Its colour for flames not of the ordinary kind: 1 blue, 2 ghostly violet.
vec3 toneOf(vec3 c) {
  if (tone > 1.5) return vec3(c.r * 0.7 + c.b * 0.3, c.b * 0.5 + c.g * 0.2, c.r);
  if (tone > 0.5) return c.bgr;
  return c;
}
vec3 tanh3(vec3 x) { vec3 e = exp(-2.0 * clamp(x, 0.0, 20.0)); return (1.0 - e) / (1.0 + e); }

// Where the ray enters the bounding cylinder (0 if it starts inside, -1 if it misses).
float entry(vec3 ro, vec3 rd) {
  float R = ${R_OUT.toFixed(2)};
  float a = dot(rd.xz, rd.xz), b = 2.0 * dot(ro.xz, rd.xz), c = dot(ro.xz, ro.xz) - R * R;
  float tr = 0.0;
  if (c > 0.0) { float disc = b * b - 4.0 * a * c; if (disc < 0.0 || a < 1e-6) return -1.0; tr = (-b - sqrt(disc)) / (2.0 * a); }
  float ty = 0.0;
  if (ro.y > HEAD) ty = (HEAD - ro.y) / rd.y; else if (ro.y < FOOT) ty = (FOOT - ro.y) / rd.y;
  if (ty < 0.0) return -1.0;
  return max(max(tr, ty), 0.0);
}

void main(void) {
  // The view ray in the source's frame (its foot at FOOT, standing on base).
  vec3 ro = axisInv * ((camPos - base) / scale) + vec3(0.0, FOOT, 0.0);
  ro.xz /= width;
  vec3 rd = axisInv * (vW - camPos);
  rd.xz /= width;
  rd = normalize(rd);
  float s0 = entry(ro, rd);
  if (s0 < 0.0) discard;
  // (Its own moment: flames side by side never in step.)
  float t = time + seed;
  vec4 O = vec4(0.0);
  // (z: the source's depth, from a camera five units off, which colours it.)
  float z = 0.0, d = 0.0;
  for (int i = 0; i < ${STEPS}; i++) {
    vec3 p = ro + rd * (s0 + z);
    if (p.y > HEAD + 0.2 || p.y < FOOT - 0.2 || length(p.xz) > ${(R_OUT + 0.2).toFixed(2)}) break;
    // Twist and turn round the upright axis, opening out as it climbs.
    p.xz *= mat2(cos(p.y * 0.5 + vec4(0.0, 33.0, 11.0, 0.0))) / max(p.y * 0.1 + 1.0, 0.1);
    // The turbulence: waves of rising frequency, racing on.
    d = 2.0;
    // (Only its first, broadest waves: bold cartoon tongues, none of the fine tearing that looks real.)
    for (int k = 0; k < ${OCTAVES}; k++) { p += cos((p.yzx - vec3(t / 0.1, t, d)) * d) / d; d /= 0.6; }
    // Its distance to the hollow cone of fire.
    d = 0.01 + abs(length(p.xz) + p.y * 0.3 - 0.5) / 7.0;
    z += d;
    O += (sin((z + 5.0) / 3.0 + vec4(7.0, 2.0, 3.0, 0.0)) + 1.1) / d;
  }
  vec3 g = tanh3(O.rgb / ${NORM.toFixed(1)} * ${GAIN.toFixed(2)});
  // Cel shaded, cartoon fire: how hot it is here, in three flat bands with
  // hard edges (its edge red, then orange, its core yellow).
  float heat = (g.r + g.g + g.b) / 3.0;
  if (heat < ${CEL[0].toFixed(2)}) discard;
  vec3 c = heat < ${CEL[1].toFixed(2)} ? vec3(0.92, 0.16, 0.05)
    : heat < ${CEL[2].toFixed(2)} ? vec3(1.0, 0.52, 0.06)
    : vec3(1.0, 0.86, 0.22);
  // (Linear: the light layer gives it back its gamma, so the bands land exactly.)
  c = pow(toneOf(c), vec3(2.2));
  float a = ${CEL_ALPHA.toFixed(2)} * power;
  gl_FragColor = vec4(c, a);
}`;

/** Where the flame stands: its foot (world), how tall, how wide round (world radius), and the way it goes (unit; up if none). */
export interface FirePlace { base: Vector3; height: number; radius: number; axis?: Vector3 }

export class RisingFire {
  private readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  private readonly start = performance.now();
  private power = 0;
  private letGo = false;
  private gone!: () => void;
  private readonly over = new Promise<void>((r) => { this.gone = r; });
  private readonly tick: () => void;
  private readonly turn = new Quaternion();
  private readonly rot = new Matrix();
  private readonly inv = new Float32Array(9);

  /**
   * `follow`: where it stands each frame; `tone`: 0 ordinary flame, 1 blue,
   * 2 ghostly; `light`: how it is drawn over the frame (UnitFx.addLight),
   * returning its undo.
   */
  constructor(private readonly scene: Scene, private readonly follow: () => FirePlace,
    tone: number, light?: (mesh: Mesh) => () => void, seed = 0) {
    this.mesh = MeshBuilder.CreateCylinder('risingFire', { height: HEAD - FOOT, diameter: R_OUT * 2, tessellation: 32 }, scene);
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mat = new ShaderMaterial('risingFireMat', scene, { vertex: 'risingFire', fragment: 'risingFire' }, {
      attributes: ['position'],
      uniforms: ['world', 'viewProjection', 'camPos', 'base', 'scale', 'width', 'time', 'power', 'tone', 'seed', 'axisInv'],
      needAlphaBlending: true,
    });
    // (Its inside faces: there whether the camera is outside it or in it.)
    this.mat.backFaceCulling = true;
    this.mat.cullBackFaces = false;
    this.mat.disableDepthWrite = true;
    // (Into the light layer, its alpha kept: the composite adds it on as light.)
    this.mat.alphaMode = Constants.ALPHA_COMBINE;
    this.mat.setFloat('tone', tone);
    this.mat.setFloat('seed', seed);
    this.mesh.material = this.mat;
    const undo = light?.(this.mesh);
    const obs = scene.onBeforeRenderObservable.add(() => this.update());
    this.tick = () => { scene.onBeforeRenderObservable.remove(obs); undo?.(); this.mat.dispose(); this.mesh.dispose(); };
    this.update();
  }

  private update(): void {
    const dt = Math.min(0.05, this.scene.getEngine().getDeltaTime() / 1000);
    this.power = this.letGo ? Math.max(0, this.power - dt / FADE) : Math.min(1, this.power + dt / FADE);
    const f = this.follow();
    const scale = f.height / (HEAD - FOOT);
    // (The cone is about 1.1 of its units across its foot: widened to the body.)
    const width = Math.max(0.5, f.radius / (1.1 * scale));
    // Turned from straight up onto the way it goes, about its foot.
    const axis = f.axis ?? Vector3.Up();
    turnUpTo(axis, this.turn);
    this.mesh.rotationQuaternion = this.turn;
    this.mesh.position.copyFrom(f.base).addInPlace(axis.scale((HEAD - FOOT) / 2 * scale));
    this.mesh.scaling.set(scale * width, scale, scale * width);
    Matrix.FromQuaternionToRef(this.turn, this.rot);
    const r = this.rot.m, inv = this.inv;
    inv[0] = r[0]; inv[1] = r[4]; inv[2] = r[8];
    inv[3] = r[1]; inv[4] = r[5]; inv[5] = r[9];
    inv[6] = r[2]; inv[7] = r[6]; inv[8] = r[10];
    const m = this.mat;
    const cam = this.scene.activeCamera;
    if (cam) m.setVector3('camPos', cam.globalPosition);
    m.setVector3('base', f.base);
    m.setMatrix3x3('axisInv', this.inv);
    m.setFloat('scale', scale);
    m.setFloat('width', width);
    m.setFloat('time', (performance.now() - this.start) / 1000);
    const e = this.power * this.power * (3 - 2 * this.power);
    m.setFloat('power', e);
    if (this.letGo && this.power <= 0) { this.tick(); this.gone(); }
  }

  /** Let it die down; resolves when it is out. */
  release(): Promise<void> {
    this.letGo = true;
    return this.over;
  }
}

/**
 * Fire in a sphere round a Pokémon (as the Flying aura's tornado is): its
 * near side drawn over the body, its far side behind it, cel-shaded flames
 * climbing its surface — the source's turbulence laid round the sphere's
 * upright axis (seamless all round), hottest low down and thinning as they
 * climb — and, standing on the ground, fading out near it.
 */
const SPH_OCTAVES = 3;
/** Its flames: how many round it, how tall up it, how fast they climb and race (its units). */
const SPH_ROUND = 2.2, SPH_UP = 3.0, SPH_CLIMB = 2.4, SPH_RACE = 3.0;
/** Cel bands of its heat (where each begins: its edge first), how solid, and its fade above the ground (× its radius). */
const SPH_CEL = [0.5, 0.66, 0.8], SPH_ALPHA = 0.95, SPH_FLOOR = 0.5;
/** A fire sphere's cel bands' colours, coolest to hottest: the Fire aura's red, orange and yellow. */
/** Inked (FireSphere's `ink`): how wide its tongues' outline is (in heat), and how dark (× its coolest band). */
const SPH_INK = 0.035, SPH_INK_DARK = 0.3;
/**
 * A lattice sphere (FireSphere's `lattice`): how many cells across (per unit
 * of the sphere), where its web is (in the Voronoi gap), how far its panels'
 * dark edge runs, and how see-through its panels are (their opacity).
 */
const LAT_SCALE = 3.2, LAT_WEB = 0.07, LAT_EDGE = 0.05, LAT_PANEL = 0.45;
/** Its crystals: how hard the cells' height bends its surface, the step it is measured over (unit sphere), and how strongly its sharp bends are edged dark. */
const LAT_BUMP = 0.9, LAT_EPS = 0.004, LAT_CREASE = 0.02;
/** Its lattice cel shaded (`latCel`): where its light's bands change (shadow | steel | sheen), and how solid it is. */
const LCEL = [0.45, 0.78], LCEL_A = 0.9;
const SPH_BANDS: [RGB, RGB, RGB] = [[0.92, 0.16, 0.05], [1.0, 0.52, 0.06], [1.0, 0.86, 0.22]];

Effect.ShadersStore.fireSphereVertexShader = Effect.ShadersStore.risingFireVertexShader;
Effect.ShadersStore.fireSphereFragmentShader = /* glsl */ `
precision highp float;
varying vec3 vW;
uniform vec3 camPos, centre;
uniform vec3 cLow, cMid, cHigh; // its cel bands' colours, coolest to hottest
uniform float ink;              // more cartoon (1): solid bands, each tongue outlined dark
uniform float latCel;           // its lattice cel shaded (1): flat bands of its steels, hard glints, its crystals' facets inked in a darker steel
uniform float lattice;          // a web lattice instead of flames (1): Shane's "Perspex Web Lattice" — a dark web over see-through panels
uniform float side;             // which of it this mesh draws: both (0), its near side only (1), its far side only (2)
uniform float radius, time, power, tone, seed, floorY;
uniform mat3 rollInv;  // a crystal sphere's roll: world to its rolled surface (its pattern turns with it)
uniform mat3 axisInv;  // world to its flames' frame (the way its tongues go there is up)
uniform vec2 band;     // shown only between these heights along its tongues (unit: -1 foot .. 1 tip), soft-edged: a wipe

vec3 toneOf(vec3 c) {
  if (tone > 1.5) return vec3(c.r * 0.7 + c.b * 0.3, c.b * 0.5 + c.g * 0.2, c.r);
  if (tone > 0.5) return c.bgr;
  return c;
}
// Its flames' heat at a point on the sphere (unit sphere coordinates), 0..1.
float heatAt(vec3 n, float t) {
  float u = atan(n.x, n.z);
  // (Round the upright axis on a circle: seamless all the way round.)
  vec3 q = vec3(cos(u) * ${SPH_ROUND.toFixed(2)}, n.y * ${SPH_UP.toFixed(2)} - t * ${SPH_CLIMB.toFixed(2)}, sin(u) * ${SPH_ROUND.toFixed(2)});
  float d = 2.0;
  for (int k = 0; k < ${SPH_OCTAVES}; k++) { q += cos((q.yzx - vec3(t * ${SPH_RACE.toFixed(2)}, t, d)) * d) / d; d /= 0.6; }
  float h = 0.5 + 0.5 * sin(q.x * 1.6 + q.z * 1.6 + q.y * 0.4);
  // Hottest low down, thinning as it climbs.
  return h * mix(1.25, 0.55, clamp((n.y + 1.0) * 0.5, 0.0, 1.0));
}
// The lattice (after Shane's "Perspex Web Lattice"): his animated
// second-order Voronoi (the gap between the nearest and next-nearest cell),
// laid on the sphere three ways (tri-planar) so it has no seam.
vec2 lhash(vec2 p, float t) {
  float n = sin(dot(p, vec2(41.0, 289.0)));
  p = fract(vec2(262144.0, 32768.0) * n);
  return sin(p * 6.2831853 + t) * 0.45 + 0.5;
}
float lvoronoi(vec2 p, float t) {
  vec2 g = floor(p), o; p -= g;
  vec3 d = vec3(1.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    o = vec2(float(x), float(y));
    o += lhash(g + o, t) - p;
    d.z = dot(o, o);
    d.y = max(d.x, min(d.y, d.z));
    d.x = min(d.x, d.z);
  }
  return max(d.y / 1.2 - d.x, 0.0) / 1.2;
}
float latticeAt(vec3 n, float t) {
  vec3 w = max(abs(n) - 0.2, 0.001);
  w /= w.x + w.y + w.z;
  vec3 q = n * ${LAT_SCALE.toFixed(1)};
  return lvoronoi(q.yz, t) * w.x + lvoronoi(q.zx + 3.1, t) * w.y + lvoronoi(q.xy + 7.7, t) * w.z;
}
// Its crystals: see-through, shaded by the pattern, their facets catching
// the light; open gaps between them; a soft moving sheen over it all.
// The height of its surface there, as his: the cells raised (crystals), the web sunk below them.
float latticeH(vec3 n, float t) {
  float c = latticeAt(n, t);
  return c < ${LAT_WEB.toFixed(3)} ? smoothstep(0.7, 1.0, 1.0 - c) * 0.2 - 0.2 : c;
}
vec4 latticeColour(vec3 n, vec3 p, vec3 rd, float t) {
  float c = latticeAt(n, t);
  // Its crystals: the surface bent by the height of the cells (his height map),
  // and edged dark where it bends sharply (his edge detection, rolled into
  // the normal: how far the height strays from the average either side).
  vec3 N0 = normalize(p - centre);
  vec3 nT = normalize(cross(abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), n)), nB = cross(n, nT);
  float e = ${LAT_EPS.toFixed(4)};
  float h0 = latticeH(n, t);
  float hx1 = latticeH(normalize(n + nT * e), t), hx2 = latticeH(normalize(n - nT * e), t);
  float hy1 = latticeH(normalize(n + nB * e), t), hy2 = latticeH(normalize(n - nB * e), t);
  float crease = smoothstep(0.0, 1.0, sqrt((abs(hx1 + hx2 - 2.0 * h0) + abs(hy1 + hy2 - 2.0 * h0)) / e * ${LAT_CREASE.toFixed(3)}));
  // (Its frame turned back to the world: the bend in the world's terms.)
  vec3 gT = nT * rollInv, gB = nB * rollInv;
  vec3 N = normalize(N0 - (gT * (hx1 - hx2) + gB * (hy1 - hy2)) / (2.0 * e) * ${LAT_BUMP.toFixed(3)});
  vec3 L = normalize(vec3(0.3, 0.8, -0.5));
  float df = max(dot(L, N), 0.0);
  float sp = pow(max(dot(reflect(-L, N), -rd), 0.0), 32.0);
  vec3 R = reflect(rd, N);
  float env = smoothstep(0.55, 1.0, 0.5 + 0.5 * sin(R.x * 4.0 + R.y * 3.0 - t * 0.6) * sin(R.z * 5.0 + t * 0.4));
  // (No web: the gaps between the crystals left open.)
  if (c < ${LAT_WEB.toFixed(3)}) return vec4(0.0);
  float shade = clamp(c * 4.0, 0.0, 1.0) * 0.8 + 0.2;
  vec3 col = cMid * shade * (df * 0.5 + 0.75) + vec3(1.0, 0.97, 0.92) * sp + cHigh * env * 0.5;
  if (latCel > 0.5) {
    // Cel shaded: its light in three flat bands (shadow, its steel, its
    // sheen), a hard white glint, the bends of its facets inked in a darker
    // steel, solid.
    float lit = df * 0.55 + shade * 0.45 + env * 0.3;
    col = lit < ${LCEL[0].toFixed(2)} ? cMid * 0.55 : lit < ${LCEL[1].toFixed(2)} ? cMid : cHigh;
    if (sp > 0.45) col = vec3(1.0);
    if (crease > 0.35) col = cMid * 0.35;
    return vec4(col * ${LCEL_A.toFixed(2)}, ${LCEL_A.toFixed(2)});
  }
  // (No dark lines: neither round the crystals nor along their bends — the bends only catch the light.)
  float a = ${LAT_PANEL.toFixed(2)} + 0.3 * crease;
  return vec4(col * a, a);
}
// The sphere's crossing (front 0, back 1) and its colour there (premultiplied).
vec4 shellAt(vec3 ro, vec3 rd, int i, float t) {
  vec3 oc = ro - centre;
  float b = dot(oc, rd), c = dot(oc, oc) - radius * radius;
  float disc = b * b - c;
  if (disc < 0.0) return vec4(0.0);
  float s = -b + (i == 0 ? -1.0 : 1.0) * sqrt(disc);
  if (s <= 0.0) return vec4(0.0);
  vec3 p = ro + rd * s;
  vec3 n = axisInv * ((p - centre) / radius);
  if (lattice > 0.5) {
    // (Its crystals on its rolled surface: they turn as it rolls along.)
    vec4 lc = latticeColour(rollInv * ((p - centre) / radius), p, rd, t);
    float fade = smoothstep(band.x - 0.25, band.x, n.y) * (1.0 - smoothstep(band.y, band.y + 0.25, n.y))
      * smoothstep(floorY, floorY + ${SPH_FLOOR.toFixed(2)} * radius, p.y) * power;
    return lc * fade;
  }
  float heat = heatAt(n, t);
  // (A wipe: only within its band along the tongues, its edges soft.)
  heat *= smoothstep(band.x - 0.25, band.x, n.y) * (1.0 - smoothstep(band.y, band.y + 0.25, n.y));
  // (Standing on the ground: faded out as it nears it.)
  heat *= smoothstep(floorY, floorY + ${SPH_FLOOR.toFixed(2)} * radius, p.y);
  if (heat < ${SPH_CEL[0].toFixed(2)}) return vec4(0.0);
  vec3 col = heat < ${SPH_CEL[1].toFixed(2)} ? cLow : heat < ${SPH_CEL[2].toFixed(2)} ? cMid : cHigh;
  // (Inked: a dark line round each tongue's edge.)
  if (ink > 0.5 && heat < ${SPH_CEL[0].toFixed(2)} + ${SPH_INK.toFixed(3)}) col = cLow * ${SPH_INK_DARK.toFixed(2)};
  // (Linear: the light layer gives it back its gamma. Inked, it is drawn as it is, off that layer.)
  col = ink > 0.5 ? toneOf(col) : pow(toneOf(col), vec3(2.2));
  float a = (ink > 0.5 ? 1.0 : ${SPH_ALPHA.toFixed(2)}) * power;
  return vec4(col * a, a);
}
void main(void) {
  vec3 rd = normalize(vW - camPos);
  float t = time + seed;
  // Its far side, then its near side over it.
  vec4 back = side > 0.5 && side < 1.5 ? vec4(0.0) : shellAt(camPos, rd, 1, t);
  vec4 front = side > 1.5 ? vec4(0.0) : shellAt(camPos, rd, 0, t);
  vec4 acc = front + back * (1.0 - front.a);
  if (acc.a < 0.004) discard;
  gl_FragColor = vec4(acc.rgb / acc.a, acc.a);
}`;

/**
 * Where the sphere stands: its middle (world), its radius, the ground under
 * it (world height; none in the air), the way its tongues go (unit; up if
 * none), and the band along them it shows in (a wipe; all of it if none).
 */
export interface SpherePlace { centre: Vector3; radius: number; floor?: number; axis?: Vector3; band?: [number, number];
  /** How it has rolled (a crystal sphere: its surface turned by this, world). */
  roll?: Quaternion }

export class FireSphere {
  private readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  private readonly start = performance.now();
  private power = 0;
  private letGo = false;
  private gone!: () => void;
  private readonly over = new Promise<void>((r) => { this.gone = r; });
  private readonly stop: () => void;
  private readonly turn = new Quaternion();
  private readonly rot = new Matrix();
  private readonly inv = new Float32Array(9);
  private readonly rollM = new Matrix();
  private readonly rollInv = new Float32Array(9);
  /** Inked: its near side drawn on its own, on the sphere's outside faces (see the constructor). */
  private near: { mesh: Mesh; mat: ShaderMaterial } | null = null;

  /**
   * `bands`: its cel bands' colours, coolest to hottest (SPH_BANDS, the Fire
   * aura's, if none); `ink`: more cartoon — solid bands, each tongue outlined
   * dark; `over`, inked: draws its near side over the auras (UnitFx.addOver),
   * so a body's aura lies between its far side and its near.
   */
  constructor(private readonly scene: Scene, private readonly follow: () => SpherePlace, tone: number, light?: (mesh: Mesh) => () => void,
    bands: [RGB, RGB, RGB] = SPH_BANDS, ink = false, over?: (mesh: Mesh) => () => void, lattice = false,
    back?: (mesh: Mesh) => () => void) {
    this.mesh = MeshBuilder.CreateSphere('fireSphere', { diameter: 2, segments: 24 }, scene);
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mat = new ShaderMaterial('fireSphereMat', scene, { vertex: 'fireSphere', fragment: 'fireSphere' }, {
      attributes: ['position'],
      uniforms: ['world', 'viewProjection', 'camPos', 'centre', 'radius', 'time', 'power', 'tone', 'seed', 'floorY', 'axisInv', 'band', 'cLow', 'cMid', 'cHigh', 'ink', 'side', 'lattice', 'latCel', 'rollInv'],
      needAlphaBlending: true,
    });
    // (Its inside faces: there whether the camera is outside it or in it; both its sides traced from them.)
    this.mat.backFaceCulling = true;
    this.mat.cullBackFaces = false;
    this.mat.disableDepthWrite = true;
    this.mat.alphaMode = Constants.ALPHA_COMBINE;
    this.mat.setFloat('tone', tone);
    this.mat.setFloat('seed', 0);
    (['cLow', 'cMid', 'cHigh'] as const).forEach((u, i) => this.mat.setVector3(u, new Vector3(...bands[i])));
    this.mat.setFloat('ink', ink ? 1 : 0);
    this.mat.setFloat('lattice', lattice ? 1 : 0);
    // (A crystal sphere is always cel shaded.)
    this.mat.setFloat('latCel', lattice ? 1 : 0);
    this.mat.setFloat('side', 0);
    this.mesh.material = this.mat;
    if (ink) {
      // Inked it is drawn as it is (off the light layer), depth-tested: traced
      // from the inside faces, a pixel stands at the sphere's far wall, so a
      // body in front of that would hide its near side too. So the inside
      // faces draw only its far side, and its outside faces — in front of the
      // body — its near side.
      this.mat.setFloat('side', 2);
      const mesh = this.mesh.clone('fireSphereNear', null)!;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      const mat = this.mat.clone('fireSphereNearMat');
      mat.cullBackFaces = true;
      mat.setFloat('side', 1);
      mesh.material = mat;
      this.near = { mesh, mat };
    }
    const undo = light?.(this.mesh);
    const undoOver = this.near && over ? over(this.near.mesh) : undefined;
    // (Inked, its far side in its unit's own back layer too — UnitFx.addBack — so two units' stacks overlap by distance.)
    const undoBack = this.near && back ? back(this.mesh) : undefined;
    // (Placed once everything else has moved this frame, just before it is
    // drawn: never a frame behind a body on the move.)
    const obs = scene.onBeforeActiveMeshesEvaluationObservable.add(() => this.update());
    this.stop = () => {
      scene.onBeforeActiveMeshesEvaluationObservable.remove(obs); undo?.(); undoOver?.(); undoBack?.(); this.mat.dispose(); this.mesh.dispose();
      if (this.near) { this.near.mat.dispose(); this.near.mesh.dispose(); }
    };
    this.update();
  }

  /** Its wearer still there (set by its maker): once not - taken off the field mid-move, its fight over - gone at once. */
  alive?: () => boolean;

  private update(): void {
    if (this.alive && !this.alive()) { this.stop(); this.gone(); this.alive = undefined; return; }
    const dt = Math.min(0.05, this.scene.getEngine().getDeltaTime() / 1000);
    this.power = this.letGo ? Math.max(0, this.power - dt / FADE) : Math.min(1, this.power + dt / FADE);
    const f = this.follow();
    this.mesh.position.copyFrom(f.centre);
    // (A little past the sphere: its inside faces always round it.)
    this.mesh.scaling.setAll(f.radius * 1.02);
    if (this.near) { this.near.mesh.position.copyFrom(f.centre); this.near.mesh.scaling.setAll(f.radius * 1.02); }
    for (const m of this.near ? [this.mat, this.near.mat] : [this.mat]) this.uniforms(m, f);
    if (this.letGo && this.power <= 0) { this.stop(); this.gone(); }
  }

  private uniforms(m: ShaderMaterial, f: SpherePlace): void {
    const cam = this.scene.activeCamera;
    if (cam) m.setVector3('camPos', cam.globalPosition);
    // (Its roll's inverse — the transpose — laid out as the shader reads it.)
    Matrix.FromQuaternionToRef(f.roll ?? Quaternion.Identity(), this.rollM);
    const rm = this.rollM.m, ri = this.rollInv;
    ri[0] = rm[0]; ri[1] = rm[4]; ri[2] = rm[8];
    ri[3] = rm[1]; ri[4] = rm[5]; ri[5] = rm[9];
    ri[6] = rm[2]; ri[7] = rm[6]; ri[8] = rm[10];
    m.setMatrix3x3('rollInv', ri);
    m.setVector3('centre', f.centre);
    m.setFloat('radius', f.radius);
    m.setFloat('floorY', f.floor ?? -1e6);
    turnUpTo(f.axis ?? Vector3.Up(), this.turn);
    Matrix.FromQuaternionToRef(this.turn, this.rot);
    const r = this.rot.m, inv = this.inv;
    inv[0] = r[0]; inv[1] = r[4]; inv[2] = r[8];
    inv[3] = r[1]; inv[4] = r[5]; inv[5] = r[9];
    inv[6] = r[2]; inv[7] = r[6]; inv[8] = r[10];
    m.setMatrix3x3('axisInv', inv);
    const band = f.band ?? [-10, 10];
    m.setVector2('band', new Vector2(band[0], band[1]));
    m.setFloat('time', (performance.now() - this.start) / 1000);
    m.setFloat('power', this.power * this.power * (3 - 2 * this.power));
  }

  /** Let it die down; resolves when it is out. */
  release(): Promise<void> {
    this.letGo = true;
    return this.over;
  }
}
