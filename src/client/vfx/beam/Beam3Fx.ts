/**
 * Beam 3: a "kamehameha" blast, after a Shadertoy sketch of one drawn with 3D signed distance fields — in place of a
 * beam 2, which runs unseen under it (its charge, pour, reach, hits, clashes and release; BeamShot.unseen):
 *
 * - its blast: a body raymarched in its own fragment shader (on a bounding cylinder along the beam), an egg
 *   from a little ahead of the mouth to the front: an egg turned round — broad and domed at the mouth, its sides full
 *   a long way, tapering to a rounded narrow end toward the target;
 *   lit by lights spinning round it very fast, each thresholded into hard bands — so its colours crackle between its
 *   type's (its dark, its main, its hot, white) as it pours;
 * - its aura outline, as beam 2's round its core and built as beam 2 builds it: a tube mesh round the egg, its vertices
 *   pushed out by beam 2's own spikes, sheared forward toward the target, torn by its noise, only its far side drawn;
 * - a double ring at the mouth, square to the beam: two tori, the nearer larger, bursting out as it's let go (fast, then
 *   slowing, as the sketch's) and thinning away as they spread, banded dark where a light catches them.
 *
 * In order, one body as beam 2's: its wind-up ball is the egg itself, round, building at the start of the beam (its beam
 * 2 unseen throughout); let go, its rings burst out round it and it stretches into the egg out to the target - its
 * thick end where the ball was, its narrow end on the beam's front, kept well rounded however far it reaches. Its aura
 * outline round it throughout. All of it fades as the beam lets go.
 */
import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Effect } from '@babylonjs/core/Materials/effect';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Material } from '@babylonjs/core/Materials/material';
import '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import '@babylonjs/core/Meshes/Builders/torusBuilder';
import '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { coloursFor, NOISE, SPIKE_GLSL, OUTLINE_GROW, MASTER_FRAG, RIPPLE, SPIKE, SPIKE_LEAN as B2_LEAN, OUTLINE_CUT, FLOW, CORE_STENCIL_BITS, BALL_OUTLINE_GROUP, type BeamPalette } from './BeamFx.ts';
import { Mesh as BMesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Vector2 } from '@babylonjs/core/Maths/math.vector';

/** Its egg's base girth (× the attacker's height, radius): its broad end EGG_BROAD × this (at the mouth), its narrow end
 *  EGG_NARROW × (toward the target); how long its sides stay full before they taper (power: above 1, fuller longer). */
const BLAST_R = 0.18, EGG_BROAD = 2.3, EGG_NARROW = 0.7, EGG_FULL = 1.8;
/** Its double ring: the nearer ring's radius at its widest (× BLAST_R), the further's; how far apart (× BLAST_R); its pulse (s). */
const RING_A = 2.1, RING_B = 1.5, RING_GAP = 0.5;
/** Its rings' burst as it's let go: how long they live (s), how far they spread (x their size). */
const RING_LIFE = 0.7, RING_SPREAD = 1.9;
/** Its wind-up ball - the egg itself, before it is let go: its size (x BLAST_R), how fast it builds (s). */
const BALL_R = 0.95, BALL_TAU = 0.3;
/** Its egg's roundness: its broad end's radius, × its length — kept so however long it reaches. */
const EGG_ROUND = 0.22;
/** How far ahead of the mouth the rings sit (× BLAST_R). */
const RING_AHEAD = 0.3;
/** How far ahead of the mouth it starts (× the attacker's height). */
const MOUTH_GAP = 0.3;
/** Its aura outline (beam 2's, round its core): the egg grown OUTLINE_GROW x; its spikes - beam 2's own (spikeAtF) -
 *  rising SPIKE_H x the egg's girth there, how fine (beam 2's spikeFine), and leaning forward, toward the target, SPIKE_LEAN
 *  x that girth at a spike's full height. */
const SPIKE_H = 0.75, SPIKE_FINE = 1, SPIKE_LEAN = 1.6;
/** Its bounds' girth (x the egg's): room for the outline and its spikes. */
const SKIN_R = OUTLINE_GROW + SPIKE_H;
/** Its aura outline (the tube twin): its band (x the egg's girth), its spikes' rise (x it). */
const AURA_GROW = 1.35, AURA_SPIKE = 0.5;

/** Fading out, letting go (s). */
const FADE = 0.25;

/** Its egg's girth along it (GLSL; uniforms len, rad, ballR, time): shared by its traced egg and its outline. */
const EGG_PROF = /* glsl */ `
float prof(float u, float grow) {
  float rb = rad * ${EGG_BROAD.toFixed(2)} * grow, rn = rad * ${EGG_NARROW.toFixed(2)} * grow;
  // (Its thick end fitted to its ball: it begins at the ball's equator, the ball's own width there, and swells out
  // from it - the ball its rounded back end.)
  float r0 = max(ballR, rad * 0.2) * grow;
  float back = min(rb, len * 0.45);
  float k = clamp((u - back) / max(len - back, 1e-3), 0.0, 1.0);
  float r = mix(rb, rn, pow(k, ${EGG_FULL.toFixed(2)}));
  float db = clamp(u / max(back, 1e-3), 0.0, 1.0);
  r = mix(r0, r, sqrt(max(0.0, 1.0 - (1.0 - db) * (1.0 - db))));
  float cap = min(rn * 1.6, len * 0.3);
  float df = clamp((len - u) / max(cap, 1e-3), 0.0, 1.0);
  r *= sqrt(max(0.0, 1.0 - (1.0 - df) * (1.0 - df)));
  return r * (1.0 + 0.03 * sin(time * 18.0));
}
`;

Effect.ShadersStore.beam3BlastVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 world, viewProjection;
varying vec3 vW;
void main(void) {
  vec4 w = world * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = viewProjection * w;
}`;
Effect.ShadersStore.beam3BlastFragmentShader = /* glsl */ `
#extension GL_EXT_frag_depth : enable
precision highp float;
uniform mat4 viewProjection;
uniform vec3 eye, origin, aim, cDark, cMain, cHot, cSkin, cRim;
uniform float len, rad, time, fade, ballR;
varying vec3 vW;
${NOISE}
// Its shape: an egg turned round, its broad end at the mouth and its narrow end toward the target — a round dome at its
// broad end (as wide as it is there), its sides full a long way before they taper (EGG_FULL: a real egg's bulge, not a
// cone's straight taper), its narrow end rounded off too; flickering a little.
${EGG_PROF}
float eggAt(vec3 p, float grow) {
  vec3 r = p - origin;
  float u = dot(r, aim);
  float q = length(r - aim * u);
  // (Behind its start, nothing: its open back is the ball's.)
  if (u < 0.0) return length(vec2(max(q - max(ballR, rad * 0.2) * grow, 0.0), u));
  if (u > len) return length(vec2(q, u - len));
  // (Not an exact distance where it curves: scaled down, so the march never oversteps it.)
  return (q - prof(u, grow)) * 0.6;
}
float body(vec3 p) { return eggAt(p, 1.0); }
vec3 normalAt(vec3 p) {
  float e = rad * 0.02;
  return normalize(vec3(body(p + vec3(e, 0, 0)) - body(p - vec3(e, 0, 0)), body(p + vec3(0, e, 0)) - body(p - vec3(0, e, 0)),
    body(p + vec3(0, 0, e)) - body(p - vec3(0, 0, e))));
}
// (Its depth: its surface's own, where it was marched to - not its bounds' - so the ball and rings hide behind it only
// where it is really in front of them.)
void depthAt(vec3 p) {
  vec4 c = viewProjection * vec4(p, 1.0);
  gl_FragDepthEXT = clamp(c.z / c.w * 0.5 + 0.5, 0.0, 1.0);
}
mat3 spin(vec3 k, float a) { float c = cos(a), s = sin(a); return mat3(c + k.x*k.x*(1.0-c), k.y*k.x*(1.0-c) + k.z*s, k.z*k.x*(1.0-c) - k.y*s,
  k.x*k.y*(1.0-c) - k.z*s, c + k.y*k.y*(1.0-c), k.z*k.y*(1.0-c) + k.x*s, k.x*k.z*(1.0-c) + k.y*s, k.y*k.z*(1.0-c) - k.x*s, c + k.z*k.z*(1.0-c)); }
void main(void) {
  // Marched in from where the eye's ray meets its bounds: to its egg - or, missing it, to its aura outline round it.
  vec3 rd = normalize(vW - eye);
  vec3 p = vW;
  float d = 1e9;
  float far = len + rad * 14.0;
  for (int i = 0; i < 48; i++) {
    d = body(p);
    if (d < rad * 0.01) break;
    p += rd * d * 0.9;
    if (dot(p - vW, rd) > far) break;
  }
  if (d > rad * 0.03) discard;
  vec3 n = normalAt(p);
  float along = dot(p - origin, aim) / rad;
  // Lights spinning round it, very fast, each thresholded into hard bands: its colours crackling as it pours.
  vec3 l1 = spin(normalize(vec3(0.3, 1.0, 0.2)), time * 14.0) * vec3(0.0, 0.0, 1.0);
  vec3 c = dot(n, l1) > 0.5 * sin(along * 1.6 + 3.5 * time) ? cMain : cDark;
  vec3 l2 = spin(normalize(vec3(1.0, 0.2, 0.4)), -time * 11.0) * vec3(0.0, 1.0, 0.0);
  float d2 = dot(n, l2);
  if (d2 < 0.5 * sin(along * 1.6 + 3.5 * time)) c = mix(c, cDark, 0.35);
  else if (d2 < 0.7) c = cHot;
  // (Its white core: lit toward whoever looks at it, wobbling - seen from any side, not only one.)
  vec3 l3 = normalize(-rd * 7.0 + vec3(-5.0 * sin(time * 30.0), -sin(time), 0.0) * 0.6);
  // (Its bands a set spacing along it, drifting slowly - not the sketch's cos(along * time), whose bands crowd ever
  // closer the longer it fires.)
  // (Its white beads travelling on along it - smoothly: a soft edge, not a hard switch that steps as they go.)
  float bead = 0.82 + 0.12 * cos(along * 0.9 - time * 3.2);
  c = mix(c, vec3(0.95), smoothstep(bead - 0.035, bead + 0.035, dot(n, l3)));
  if (fade < 0.999 && fract(sin(dot(p, vec3(12.9, 78.2, 37.7))) * 43758.5) > fade) discard;
  depthAt(p);
  gl_FragColor = vec4(c, 1.0);
}`;

// Its aura outline: beam 2's own outline twin, built the way beam 2 builds it - a tube mesh round its core (TUBE_ALONG
// x TUBE_AROUND, as beam 2's), each vertex pushed out to OUTLINE_GROW x the core's girth there plus beam 2's spikes
// (spikeAt, SPIKE), the core's ripple noise on it (disp, RIPPLE), its spikes' tips moved forward, toward the target
// (beam 2's SPIKE_LEAN x the core's radius x the spike): sheared, not stood up; only its far side drawn (vFace), behind
// the core; drawn through beam 2's own master fragment (torn by the core's noise, a little less). Its girth the egg's,
// not beam 2's column's.
Effect.ShadersStore.beam3AuraVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 viewProjection, view;
uniform vec3 origin, aim, side, upv;
uniform float len, rad, ballR, time, disp, pan, grow, spike, groundY;
varying float vAlong, vTh, vFace;
varying vec3 vSeamW;
${NOISE}
${SPIKE_GLSL}
${EGG_PROF}
vec3 viewEye() { vec3 t = view[3].xyz; return -vec3(dot(view[0].xyz, t), dot(view[1].xyz, t), dot(view[2].xyz, t)); }
void main(void) {
  float u = uv.x, th = uv.y * 6.2831853;
  vec3 n = cos(th) * side + sin(th) * upv;
  float along = u * len;
  float r = prof(along, 1.0);
  r *= 1.0 + disp * (vn(vec3(along / rad * 0.9 - time * pan, cos(th) * 2.0, sin(th) * 2.0 + time * ${RIPPLE.toFixed(2)})) - 0.5);
  vAlong = along / rad; vTh = th;
  float sk = spike > 0.0 ? spikeAt(along, th, rad, time) : 0.0;
  float g = max(grow, 1.0) + spike * sk;
  float lean = spike > 0.0 ? ${B2_LEAN.toFixed(2)} * rad * sk : 0.0;
  vec3 drawnAt = origin + aim * (along + lean) + n * r * g;
  drawnAt.y = max(drawnAt.y, groundY + 0.01);
  gl_Position = viewProjection * vec4(drawnAt, 1.0);
  vSeamW = drawnAt;
  vFace = dot(n, normalize(viewEye() - (origin + aim * along + n * r)));
}`;
Effect.ShadersStore.beam3AuraFragmentShader = MASTER_FRAG;

// Its rings and its core: banded dark where a light catches them (the sketch's look), lit in their own colour.
Effect.ShadersStore.beam3RingVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
uniform mat4 world, viewProjection;
varying vec3 vN, vW;
void main(void) {
  vec4 w = world * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(world) * normal);
  gl_Position = viewProjection * w;
}`;
Effect.ShadersStore.beam3RingFragmentShader = /* glsl */ `
precision highp float;
uniform vec3 color, light, band;
uniform float time, alpha, banded;
varying vec3 vN, vW;
void main(void) {
  float dt = dot(normalize(vN), normalize(light));
  vec3 c = dt > 0.5 + 0.2 * sin(vW.x * 10.0 + 10.0 * time) ? (banded > 0.5 ? band : color * 0.18) : color;
  // (Solid, drawn into the depth: a ring's near side over the ball, its far side behind it. Fading, dissolved away.)
  if (alpha < 0.999 && fract(sin(dot(vW, vec3(12.9, 78.2, 37.7))) * 43758.5) > alpha) discard;
  gl_FragColor = vec4(c, 1.0);
}`;

export interface Beam3Source {
  /** Where the beam leaves the attacker, this frame. */
  origin(): Vector3;
  /** Where its front is, this frame. */
  end(): Vector3;
  /** Resolves as it is let go (its wind-up over): its rings burst then, and its egg is released. */
  launched?: Promise<void>;
}

const smoothstep01 = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** A tube's grid, as beam 2's: uv.x along it (0..1), uv.y round it (0..1). */
function tubeGrid(along: number, around: number): VertexData {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= along; i++) for (let j = 0; j <= around; j++) { pos.push(0, 0, 0); uv.push(i / along, j / around); }
  for (let i = 0; i < along; i++) for (let j = 0; j < around; j++) {
    const a = i * (around + 1) + j, b = a + around + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const vd = new VertexData(); vd.positions = pos; vd.uvs = uv; vd.indices = idx;
  return vd;
}

export class Beam3Fx {
  /** Each blast's own stencil bit, in turn (CORE_STENCIL_BITS). */
  private static ids = 0;
  /** Held (for a look at it): as the beam lets go it stays — where it last was, still crackling and churning — till this
   *  is turned off again and it is let go. */
  persist = false;
  constructor(private readonly scene: Scene) {}

  /** Its blast, rings and core on `beam`, in `element`'s colours, sized to `height`. `release()` fades it all and is done. */
  attach(beam: Beam3Source, o: { element: string; palette?: BeamPalette; height: number; thickness?: number }): { release(): Promise<void> } {
    const scene = this.scene;
    const col = coloursFor(o.element, o.palette);
    const R = BLAST_R * o.height * (o.thickness ?? 1);
    const c3 = (c: number[]) => new Color3(c[0], c[1], c[2]);
    // The blast: raymarched inside a bounding cylinder along the beam.
    const bound = MeshBuilder.CreateCylinder('beam3Bound', { height: 1, diameter: 2, tessellation: 20 }, scene);
    bound.isPickable = false;
    bound.rotationQuaternion = new Quaternion();
    const blast = new ShaderMaterial('beam3Blast', scene, { vertex: 'beam3Blast', fragment: 'beam3Blast' }, {
      attributes: ['position'], uniforms: ['world', 'viewProjection', 'eye', 'origin', 'aim', 'len', 'rad', 'time', 'fade', 'cDark', 'cMain', 'cHot', 'cSkin', 'cRim', 'ballR'],
    });
    // (Its bands in its type's colours, kept saturated — a beam's hot and main run past white, for its bloom: the blast
    // would wash out. Its skin's dark, a strong middle between that and its main, its main for its hot; white only in
    // flashes.)
    const clamp1 = (c: number[]) => c.map((x) => Math.min(1, x) * 0.92);
    const mixC = (a: number[], b: number[], k: number) => a.map((x, i) => x + (b[i] - x) * k);
    blast.setColor3('cDark', c3(col.dark)); blast.setColor3('cMain', c3(mixC(col.dark, clamp1(col.main), 0.55))); blast.setColor3('cHot', c3(clamp1(col.main)));
    // (Its aura outline in beam 2's outline colour - its type's dark - its spikes' tips a little lighter.)
    blast.setColor3('cSkin', c3(col.dark)); blast.setColor3('cRim', c3(clamp1(col.main)));
    blast.backFaceCulling = true;
    bound.material = blast;
    // The double ring (solid: in the depth with the ball, so each ring's near side shows over it, its far side behind).
    const ringMat = (name: string, color: Color3) => {
      const m = new ShaderMaterial(name, scene, { vertex: 'beam3Ring', fragment: 'beam3Ring' }, {
        attributes: ['position', 'normal'], uniforms: ['world', 'viewProjection', 'color', 'light', 'time', 'alpha', 'band', 'banded'],
      });
      m.setColor3('color', color);
      m.backFaceCulling = false;
      return m;
    };
    const clampMain = mixC(col.dark, clamp1(col.main), 0.7);
    const rings = [0, 1].map((i) => {
      const mesh = MeshBuilder.CreateTorus(`beam3Ring${i}`, { diameter: 2, thickness: 0.1, tessellation: 56 }, scene);
      mesh.isPickable = false;
      mesh.rotationQuaternion = new Quaternion();
      mesh.material = ringMat(`beam3RingMat${i}`, c3(clampMain));
      return mesh;
    });
    // Its aura outline: beam 2's outline twin, as a tube mesh round the egg (see beam3Aura).
    const aura = new BMesh('beam3Aura', scene);
    tubeGrid(96, 28).applyToMesh(aura);
    aura.isPickable = false; aura.alwaysSelectAsActiveMesh = true; aura.doNotSyncBoundingInfo = true;
    const auraMat = new ShaderMaterial('beam3AuraMat', scene, { vertex: 'beam3Aura', fragment: 'beam3Aura' }, {
      attributes: ['position', 'uv'],
      uniforms: ['viewProjection', 'view', 'origin', 'aim', 'side', 'upv', 'len', 'rad', 'ballR', 'time', 'disp', 'pan', 'grow', 'spike', 'groundY',
        'spikeFine', 'color', 'rim', 'color2', 'color3', 'cutoff', 'dark', 'multi', 'nscale', 'ghost', 'seamP', 'seamN', 'seamOn', 'soft', 'whole'],
      defines: ['#define OUTLINE_TWIN'],
    });
    // (As beam 2's outline of its core: its type's dark, flat; torn by the core's noise, a little less (OUTLINE_CUT); its
    // spikes beam 2's; only its far side.)
    auraMat.backFaceCulling = false;
    auraMat.setColor3('color', c3(col.dark)); auraMat.setColor3('rim', c3(col.dark));
    auraMat.setColor3('color2', c3(col.dark)); auraMat.setColor3('color3', c3(col.dark));
    auraMat.setFloat('dark', 1); auraMat.setFloat('multi', 0); auraMat.setFloat('ghost', 0); auraMat.setFloat('soft', 0); auraMat.setFloat('whole', 0);
    auraMat.setFloat('seamOn', 0); auraMat.setVector3('seamP', Vector3.Zero()); auraMat.setVector3('seamN', new Vector3(1, 0, 0));
    auraMat.setFloat('cutoff', 0.22 * OUTLINE_CUT); auraMat.setFloat('pan', 13 * FLOW); auraMat.setVector2('nscale', new Vector2(0.75, 1.6));
    // (Thinner than beam 2's column outline, its spikes finer - beam 2's long egg's spikeFine: closer, each ring broken into
    // thin points.)
    auraMat.setFloat('disp', 0.35); auraMat.setFloat('grow', AURA_GROW); auraMat.setFloat('spike', AURA_SPIKE); auraMat.setFloat('spikeFine', 1);
    aura.material = auraMat;
    aura.setEnabled(false);
    // Its core always over its outline, from any side (as beam 2's: coreOverBallOutline): its egg marks a
    // stencil bit wherever they're drawn; its outline, in a later group that keeps the depth and stencil drawn so far,
    // drawn whole (both sides), shows only where neither is - still hidden by whatever really stands in front of it.
    const bit = CORE_STENCIL_BITS[(Beam3Fx.ids++) % CORE_STENCIL_BITS.length];
    const writes = (m: Material) => {
      const st = m.stencil;
      st.enabled = true;
      st.func = Constants.ALWAYS; st.funcRef = bit; st.funcMask = 0xff; st.mask = bit;
      st.opStencilFail = Constants.KEEP; st.opDepthFail = Constants.KEEP; st.opStencilDepthPass = Constants.REPLACE;
    };
    writes(blast);
    scene.setRenderingAutoClearDepthStencil(BALL_OUTLINE_GROUP, false, false, false);
    aura.renderingGroupId = BALL_OUTLINE_GROUP;
    auraMat.setFloat('whole', 1);
    {
      const st = auraMat.stencil;
      st.enabled = true;
      st.func = Constants.NOTEQUAL; st.funcRef = bit; st.funcMask = bit; st.mask = 0x00;
      st.opStencilFail = Constants.KEEP; st.opDepthFail = Constants.KEEP; st.opStencilDepthPass = Constants.KEEP;
    }
    const meshes: Mesh[] = [bound, ...rings, aura];
    for (const m of rings) m.setEnabled(false);
    bound.setEnabled(false);

    let t = 0, fadeT = -1, launchT = -1, held = false, doneRes!: () => void;
    const lastMouth = new Vector3(), lastFront = new Vector3();
    // (Its wind-up is beam 2's own ball, at the mouth; let go, its rings burst and its egg is released.)
    if (beam.launched) void beam.launched.then(() => { launchT = t; }); else launchT = 0;
    const done = new Promise<void>((r) => { doneRes = r; });
    const q = new Quaternion();
    const Y = new Vector3(0, 1, 0);
    const obs: Observer<Scene> = scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min(0.05, scene.getEngine().getDeltaTime() / 1000);
      t += dt;
      const fade = fadeT < 0 ? 1 : Math.max(0, 1 - (t - fadeT) / FADE);
      const since = launchT < 0 ? -1 : t - launchT;
      // (From a little ahead of the mouth, along the way to its front.)
      // (Held, its beam let go: where it last was.)
      if (!held) { lastMouth.copyFrom(beam.origin()); lastFront.copyFrom(beam.end()); }
      const mouth = lastMouth, front = lastFront;
      const way0 = front.subtract(mouth);
      const dist = way0.length();
      const aim = dist > 1e-4 ? way0.scale(1 / dist) : new Vector3(1, 0, 0);
      Quaternion.FromUnitVectorsToRef(Y, aim, q);
      const start = mouth.add(aim.scale(Math.min(MOUTH_GAP * o.height, dist * 0.5)));
      // One body, as beam 2's: its wind-up ball is the egg itself - a round ball at the start, building as it winds up,
      // pulsing - stretched, as it's let go, into the egg out to the beam's front: its thick end where the ball was, its
      // narrow end out toward the target. No second part.
      const charge = 1 - Math.exp(-t / BALL_TAU);
      const br = R * BALL_R * charge * (1 + 0.06 * Math.sin(t * 14));
      const back = start.subtract(aim.scale(br));
      const ballFront = start.add(aim.scale(br));
      const reach = since < 0 ? 0 : Math.max(0, Vector3.Dot(front.subtract(ballFront), aim));
      const len = 2 * br + reach;
      // (Its girth: the ball's while it's short; in proportion to its length once it reaches further - a well-rounded egg,
      // never squashed, never drawn out thin. Its broad end's radius EGG_ROUND x its length, at least the ball's.)
      const Rk = Math.max(br / EGG_BROAD, (len * EGG_ROUND) / EGG_BROAD);
      bound.setEnabled(br > R * 0.03 && fade > 0);
      bound.position.copyFrom(back.add(aim.scale(len * 0.5)));
      bound.rotationQuaternion!.copyFrom(q);
      bound.scaling.set(Rk * EGG_BROAD * SKIN_R * 1.25, len + Rk * EGG_BROAD * SKIN_R * 2.2, Rk * EGG_BROAD * SKIN_R * 1.25);
      blast.setVector3('eye', scene.activeCamera!.globalPosition);
      blast.setVector3('origin', back); blast.setVector3('aim', aim);
      blast.setFloat('len', len); blast.setFloat('rad', Math.max(Rk, 1e-3)); blast.setFloat('time', t); blast.setFloat('fade', fade);
      blast.setFloat('ballR', 0);
      // (Its outline round it: the same egg, the same clock.)
      aura.setEnabled(bound.isEnabled());
      {
        let side = Vector3.Cross(aim, Vector3.Up());
        if (side.lengthSquared() < 1e-6) side = new Vector3(0, 0, 1);
        side.normalize();
        const upv = Vector3.Cross(side, aim).normalize();
        auraMat.setVector3('origin', back); auraMat.setVector3('aim', aim); auraMat.setVector3('side', side); auraMat.setVector3('upv', upv);
        auraMat.setFloat('len', len); auraMat.setFloat('rad', Math.max(Rk, 1e-3)); auraMat.setFloat('time', t);
        auraMat.setFloat('groundY', -1e4); auraMat.setFloat('ballR', 0);
        auraMat.setMatrix('view', scene.activeCamera!.getViewMatrix());
      }
      // Its rings, as it's let go: bursting out of the mouth (the sketch's ease - fast, then slowing), the further one
      // behind the nearer and smaller; thinning away as they spread, gone by RING_LIFE.
      const k = since < 0 ? 0 : Math.min(1, since / RING_LIFE);
      const grow = Math.sin((Math.PI / 2) * Math.sqrt(Math.sqrt(k)));
      rings.forEach((m, i) => {
        m.setEnabled(since >= 0 && k < 1);
        if (since < 0 || k >= 1) return;
        const r = R * (i ? RING_B : RING_A) * (0.25 + RING_SPREAD * grow);
        m.position.copyFrom(start.add(aim.scale(R * (RING_AHEAD - i * RING_GAP))));
        m.rotationQuaternion!.copyFrom(q);
        m.scaling.setAll(r);
        const mat = m.material as ShaderMaterial;
        mat.setVector3('light', new Vector3(Math.sin(t * 5), 1, -1 + Math.sin(t)));
        mat.setFloat('time', t); mat.setFloat('alpha', fade * (1 - smoothstep01(0.45, 1, k)));
      });
      if (fadeT >= 0 && fade <= 0) {
        scene.onBeforeRenderObservable.remove(obs);
        for (const m of meshes) { m.material?.dispose(); m.dispose(); }
        doneRes();
      }
    })!;
    const letGo = () => { if (fadeT < 0) fadeT = t; };
    // (Held: kept as it is until persist is turned off, then let go.)
    const holdOn = () => { held = true; const w = setInterval(() => { if (!this.persist) { clearInterval(w); letGo(); } }, 200); };
    return { release: () => { if (this.persist) holdOn(); else letGo(); return done; } };
  }
}
