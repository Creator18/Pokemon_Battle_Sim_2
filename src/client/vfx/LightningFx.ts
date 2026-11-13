/**
 * LightningFx — electricity, from dr2's "Tesla's Laboratory" (2018), via
 * docs/reference/EFFECTS.md Part 2 §4–5.
 *
 * The source's bolt is a hairline cylinder 8 units long whose centreline is
 * pushed sideways by two fBm's of its axial coordinate zc ∈ [−4, 4]:
 *
 *   q.xy −= SmoothBump(−3.5, 3.9, 0.5, zc) · (2·(Fbm2p(0.4zc + pth.xy), Fbm2p(0.3zc + pth.zw)) − 1)
 *
 * with pth drifting in time and a global flicker illum = smoothstep(0.3, 0.9,
 * Fbm1(4t)) that is fully on or fully off for long stretches; its colour is
 * (0.9, 0.9, 0.6)·clamp(2·(0.1 + 0.9·illum)·(1 − 0.3·Fbm1(5zc)) − 0.2, 0, 1).
 * All of that is bolt.ts, transcribed. Each stroke here samples that field
 * at KNOTS points between two ends (scaled so the wander is WANDER × its
 * length) and draws it as a camera-facing ribbon: a white-hot core in a
 * yellow-to-amber halo (amber so it reads on the pale tiles).
 *
 * What it draws:
 * - `earth(…)`: the doc's earthing discharge (Wild Charge) — BOLTS writhing
 *   hairlines from points on a body down to the ground, each living LIFE and
 *   replaced from a new body point, an amber pool where each lands. The foot
 *   stays on the ground while the head rides the pose, so a moving body
 *   stretches its own lightning.
 * - `bolt(…)`: a thick bolt from one point to another, re-striking every
 *   RESTRIKE with forks breaking off it (Thunderbolt, Discharge, sparks).
 * - `thunder(…)`: many bolts falling out of the sky onto a point and the
 *   ground round it (Thunder).
 */

import { groundLight, type GroundLight } from './groundLight.ts';
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Constants } from '@babylonjs/core/Engines/constants';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { illum, wander, fbm1, smoothstep } from './bolt.ts';
import { TILE_SCALE } from '../hexWorld.ts';

// ── the doc's constants (bolt.rs, §5.5) ──
const BOLTS = 6; //               earthing strokes at once
const KNOTS = 64; //              field samples along a stroke
const WANDER = 0.125; //          lateral wander / stroke length (the source's 1 unit over 8)
const LIFE = 0.28; //             s, an earthing stroke's life
const BOW = 1.6, BOW_EARLY = 0.28, BOW_LATE = 0.68;
const SPRAY = 0.3, REACH = 1.0, SPREAD = 0.75; // footing, in body heights
const TRAIL = 1.1, TRAIL_MIN = 0.35;
/** Pressing in a clash (EarthBody.press): how far its strokes are thrown back behind it, and out to either side (body heights, at most) — out past its aura, grown and stretched back as it is in a clash. */
const PRESS_BACK = 1.9, PRESS_SIDE = 1.3;
const GIRTH_CUT = 0.52, GIRTH_RATE = 2.6;
/**
 * The pools of light lightning casts on the ground: their size, and how bright (0: none — seen side-on, a pool smears
 * in behind the bolt as a muddy amber band over the grass; they were for the hex board's tiles, seen from above).
 */
const POOL_R = 0.3, POOL_GAIN = 0;
/**
 * Where an earthing stroke meets the ground: a slight glow, in the stroke's own colour, laid on as light (added — it
 * brightens what is there, never darkens it to mud): EARTH_GLOW_R × the body's height across, EARTH_GLOW strong — lit
 * in the floor's own shading (groundLight), so the grass there glows too and feet standing in it stay in front of it.
 */
const POOL_MAX = 4;
const EARTH_GLOW = 2.2, EARTH_GLOW_R = 0.22;
/** How fast the field drifts (the source's tCur is seconds; lightning writhes faster). */
const WRITHE = 1.6;

// ── ours: how strokes look in the arena ──
/** Core half-width of a hairline (world units; the source's 0.015 would vanish at our distance). */
const HAIR = 0.016 * TILE_SCALE;
/** Body-to-ground strokes are this × the hairline. */
const EARTH_THIN = 0.5;
/** Earthing strokes scale with the body's height (÷ 1.3, a mid-sized Pokémon), within these bounds. */
const EARTH_SIZE_MIN = 0.45, EARTH_SIZE_MAX = 2.6;
/** The ribbon is this many times the core's width: the rest is halo. */
const HALO = 4;
/**
 * Thunder: how many bolts fall, how far apart they come in (s), how often
 * each strikes somewhere new (s), and how high (and how far off upright) the
 * sky they fall from is (× TILE_SCALE).
 */
/** Converging forks (bolt o.converge): their ends spread round the target by the bolt's length, no longer than this counts (world units). */
const CONVERGE_SPAN = 7;
const THUNDER_BOLTS = 7, THUNDER_STAGGER = 0.07, THUNDER_RESEAT = 0.3;
/** On a hit, how many of Thunder's bolts strike the target. */
const THUNDER_ON_TARGET = 3;
const THUNDER_SKY = 14, THUNDER_SLANT = 0.6;
/** Thick bolts re-strike (a new path) this often, s. */
const RESTRIKE = 0.075;
/** Above 1 blooms. */
const GLOW = 1.3;
/** Zigzag: a corner every CORNER knots, jogging up to JAG × the wander. */
const CORNER = 5, JAG = 0.55;

Effect.ShadersStore.boltVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 color;
uniform mat4 viewProjection;
varying vec2 vUV;
varying vec4 vHot;
void main(void) {
  vUV = uv; vHot = color;
  gl_Position = viewProjection * vec4(position, 1.0);
}`;

Effect.ShadersStore.boltFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUV;
varying vec4 vHot;
uniform float lit;
uniform vec3 arc, halo, outer;
// (Its shape an aura's — in a silhouette, wide: the aura's fill and outline its whole look — drawn nothing itself, or its
// edges would show through as faint lines inside the fill.)
uniform float ghost;
void main(void) {
  if (ghost > 0.5) discard;
  // across: 0 down the middle, 1 at the halo's edge; the core is the inner 1/HALO.
  float a = abs(vUV.y * 2.0 - 1.0);
  float x = a * ${HALO.toFixed(1)};
  // Defined, not blurred, in the Electric aura's own colours (auraPalette GLOWS): a hairline of its white-hot line
  // down the middle, a solid body of its yellow inner glow, an edge of its amber outer glow — all solid, no faint halo
  // outside it (half-seen amber over the grass reads as mud, not light).
  // The source's colour line: brightness along the stroke is coverage — here, as width: dimming (its flicker, its
  // ends, dying away) it thins, staying solid, never half see-through (amber half over the grass reads as mud).
  float hot = vHot.x * lit;
  if (hot < 0.04) discard;
  float w = clamp(hot * 1.4, 0.2, 1.0);
  float xw = x / w;
  float core = 1.0 - smoothstep(0.08, 0.16, xw);
  float body = 1.0 - smoothstep(0.98, 1.1, xw);
  float edge = 1.0 - smoothstep(1.3, 1.45, xw);
  vec3 rgb = mix(mix(outer, halo, body), arc, core) * mix(1.0, ${GLOW.toFixed(2)}, core);
  float alpha = edge;
  if (alpha < 0.01) discard;
  // (Premultiplied — Porter-Duff over: where strokes cross, the nearer laid over the farther, never summed past
  // full cover; summed, the pass over the auras divides its colour down to dark olive there.)
  gl_FragColor = vec4(rgb * alpha, alpha);
}`;

// A stroke in a unit's silhouette mask (UnitFx.addToMask), in the unit's mask colour: its core only (so the aura's
// outline wraps the bolt itself, not its halo) — or, `wide`, the whole ribbon as it is drawn (its edge, thinning as
// it dims): the aura's outline then wraps all of it, the ribbon filling it in.
Effect.ShadersStore.boltMaskFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUV;
varying vec4 vHot;
uniform float lit;
uniform float wide;
uniform vec4 maskColor;
// (Its last stretch — from from2 of the way along on — in a second silhouette instead, maskColor2 (its target's: the
// bolt let go by its firer's aura and taken in by its target's, each end one aura's alone), both a little either side
// of from2 so no gap opens between them. None: all zero, the whole of it its own.)
uniform vec4 maskColor2;
uniform float from2;
void main(void) {
  float x = abs(vUV.y * 2.0 - 1.0) * ${HALO.toFixed(1)};
  float hot = vHot.x * lit;
  // (Wide: the ribbon as it is drawn — out to its edge, thinning as it dims — the aura round it and filling it.)
  float lim = wide > 0.5 ? 1.45 * clamp(hot * 1.4, 0.2, 1.0) : 1.0;
  if (x > lim || hot < 0.05) discard;
  // (Where along the whole bolt it is — the same for every strand of it, forks too — so the halves part in one place.)
  float u = vHot.y;
  gl_FragColor = u < from2 - 0.03 ? maskColor : u < from2 + 0.03 ? max(maskColor, maskColor2) : maskColor2;
}`;

Effect.ShadersStore.boltPoolVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 viewProjection;
uniform vec3 center;
uniform float radius;
varying vec2 vUV;
void main(void) {
  vUV = uv * 2.0 - 1.0;
  vec3 p = center + vec3(vUV.x, 0.0, vUV.y) * radius + position * 0.0;
  gl_Position = viewProjection * vec4(p, 1.0);
}`;

Effect.ShadersStore.boltPoolFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform float pool;
uniform vec3 tint;
void main(void) {
  float r2 = dot(vUV, vUV);
  float a = pool * max(0.0, 1.0 - r2) * (1.0 - r2);
  if (a < 0.01) discard;
  // Its colour (the stroke's own), hotter — whiter — at the middle; added on as light.
  vec3 rgb = mix(tint, vec3(1.0), 0.6 * max(0.0, 1.0 - 4.0 * r2));
  gl_FragColor = vec4(rgb * a, a);
}`;

/** The arc's colour (the source's (0.9, 0.9, 0.6), brightened) and the amber halo round it. */
/** Its colours, the Electric aura's (auraPalette GLOWS): a white-hot core, a yellow glow, amber at the glow's outer edge. */
const ARC = new Vector3(1.0, 1.0, 0.93);
const YELLOW = new Vector3(1.0, 0.88, 0.25);
const AMBER = new Vector3(1.0, 0.56, 0.02);

/** A bolt's (or earthing stroke's) colours: its core, its halo, and the light it casts. */
export interface BoltColors { arc: Vector3; halo: Vector3; light: Color3 }
/** Icy lightning (Ice Beam): a white-cyan core in an ice-blue halo. */
/** Psychic lightning (Psybeam): a pale pink core in a magenta-violet halo. */
export const PSY_BOLT: BoltColors = {
  arc: new Vector3(1.0, 0.86, 0.98),
  halo: new Vector3(0.92, 0.2, 0.78),
  light: new Color3(1.0, 0.55, 0.9),
};
/** Blue lightning (Zeraora's): an ice-white core in a deep blue-cyan halo. */
export const BLUE_BOLT: BoltColors = {
  arc: new Vector3(0.88, 0.97, 1.0),
  halo: new Vector3(0.18, 0.6, 1.0),
  light: new Color3(0.5, 0.78, 1.0),
};
export const ICE_BOLT: BoltColors = {
  arc: new Vector3(0.86, 0.97, 1.0),
  halo: new Vector3(0.15, 0.55, 1.0),
  light: new Color3(0.6, 0.85, 1.0),
};

const hash = (n: number) => { const s = Math.sin(n) * 43758.5453; return s - Math.floor(s); };

export interface StrokeOpts {
  from: () => Vector3;
  to: () => Vector3;
  /** Core half-width, world units. */
  width: number;
  /** Lateral wander as a share of the length (default WANDER). */
  wander?: number;
  /** Bow vector (world) and where it peaks along the stroke. */
  bow?: Vector3;
  peak?: number;
  /** Pin the far end too (it must touch its target). */
  pinEnd?: boolean;
  /** Field key (which stroke of the source). */
  k: number;
  /**
   * The whole bolt's line (its first stroke's ends), for where along it each point of this stroke is — the same for every
   * stroke of it, its forks too (each point's share of the way from the one end to the other, in its colour's green).
   * Unset: along this stroke's own length.
   */
  chord?: () => [Vector3, Vector3];
  /**
   * A tube along it — TUBE_SIDES round — in place of the ribbon square to the view: a bolt drawn as an aura (its mask
   * its whole look), so seen end on, running toward the camera, it stays as thin as it is, not folding into a lump.
   */
  tube?: boolean;
}

/** A tube stroke's sides round it. */
const TUBE_SIDES = 6;
/** A tube stroke's radius (× its width): the ribbon's in its mask at full brightness, steady. */
const TUBE_WIDTH = 1.45;

/** One ribbon. */
class Stroke {
  readonly mesh: Mesh;
  readonly mat: ShaderMaterial;
  /** Its vertices at each knot: 2 (a ribbon's edges), or TUBE_SIDES round (a tube's ring). */
  private readonly ring: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly pts: Vector3[] = Array.from({ length: KNOTS }, () => new Vector3());
  /** 0..1 how bright it is now (illum × power × its own share). */
  lit = 0;
  /** Its copy's material in a unit's silhouette mask, if it is in one (maskIn). */
  private maskMat: ShaderMaterial | null = null;
  private unmask: (() => void) | null = null;

  /**
   * Put the stroke in a unit's silhouette (its aura's outline then wraps the
   * bolt with the body, as one shape): `add` is UnitFx.addToMask for the unit.
   */
  maskIn(scene: Scene, color: Color4, add: (mesh: Mesh, mat: ShaderMaterial) => () => void, wide = false): void {
    this.maskMat = new ShaderMaterial('boltMaskMat', scene, { vertex: 'bolt', fragment: 'boltMask' }, {
      attributes: ['position', 'uv', 'color'],
      uniforms: ['viewProjection', 'lit', 'wide', 'maskColor', 'maskColor2', 'from2'],
    });
    this.maskMat.backFaceCulling = false;
    this.maskMat.setColor4('maskColor', color);
    this.maskMat.setFloat('wide', wide ? 1 : 0);
    // (Wide: the aura's fill and outline are the whole of it — the ribbon itself drawn nothing.)
    this.mat.setFloat('ghost', wide ? 1 : 0);
    this.maskMat.setColor4('maskColor2', new Color4(0, 0, 0, 0));
    this.maskMat.setFloat('from2', 2);
    this.unmask = add(this.mesh, this.maskMat);
  }

  constructor(scene: Scene, public o: StrokeOpts) {
    this.mesh = new Mesh('bolt', scene);
    this.ring = o.tube ? TUBE_SIDES : 2;
    this.pos = new Float32Array(KNOTS * this.ring * 3);
    this.col = new Float32Array(KNOTS * this.ring * 4);
    const uvs: number[] = [], idx: number[] = [];
    if (o.tube) {
      // (A tube: every point of it at the ribbon's middle — uv.y 0.5 — its width its rings' radius.)
      const R = this.ring;
      for (let i = 0; i < KNOTS; i++) { const u = i / (KNOTS - 1); for (let k = 0; k < R; k++) uvs.push(u, 0.5); }
      for (let i = 0; i < KNOTS - 1; i++) {
        for (let k = 0; k < R; k++) {
          const a = i * R + k, b = i * R + ((k + 1) % R), c = a + R, d = b + R;
          idx.push(a, c, d, a, d, b);
        }
      }
    } else {
      for (let i = 0; i < KNOTS; i++) { const u = i / (KNOTS - 1); uvs.push(u, 0, u, 1); }
      for (let i = 0; i < KNOTS - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    }
    const vd = new VertexData();
    vd.positions = Array.from(this.pos); vd.uvs = uvs; vd.indices = idx; vd.colors = Array.from(this.col);
    vd.applyToMesh(this.mesh, true);
    this.mat = new ShaderMaterial('boltMat', scene, { vertex: 'bolt', fragment: 'bolt' }, {
      attributes: ['position', 'uv', 'color'],
      uniforms: ['viewProjection', 'lit', 'arc', 'halo', 'outer', 'ghost'],
      needAlphaBlending: true,
    });
    this.mat.backFaceCulling = false;
    // (Drawn — set here, not left unset: every stroke shares one shader program, which keeps a uniform's last value, so
    // a stroke that never set it drew nothing after one drawn as an aura's had.)
    this.mat.setFloat('ghost', 0);
    this.mat.disableDepthWrite = true;
    this.mat.alphaMode = Constants.ALPHA_PREMULTIPLIED_PORTERDUFF;
    this.mat.setVector3('arc', ARC);
    this.mat.setVector3('halo', YELLOW);
    this.mat.setVector3('outer', AMBER);
    this.mesh.material = this.mat;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.doNotSyncBoundingInfo = true;
    this.mesh.hasVertexAlpha = true;
  }

  /** A point on the current centreline, u ∈ [0, 1]. */
  at(u: number): Vector3 {
    const f = u * (KNOTS - 1), i = Math.min(KNOTS - 2, Math.floor(f));
    return Vector3.Lerp(this.pts[i], this.pts[i + 1], f - i);
  }

  /** Lay the stroke along the field at time t, facing `cam`. */
  update(t: number, cam: Vector3): void {
    const { o } = this;
    const from = o.from(), to = o.to();
    const chord = to.subtract(from);
    const run = chord.length();
    // (Drawn over the auras — UnitFx owns its isVisible there — it shows and hides by being enabled.)
    const show = (on: boolean) => { if (this.unover) this.mesh.setEnabled(on); else this.mesh.isVisible = on; };
    if (run < 1e-4) { show(false); return; }
    show(this.lit > 0.01);
    const dir = chord.scale(1 / run);
    // Two axes across the chord.
    const ref = Math.abs(dir.y) < 0.9 ? Vector3.Up() : Vector3.Right();
    const ax = Vector3.Cross(dir, ref).normalize();
    const ay = Vector3.Cross(dir, ax).normalize();
    // (Every bolt's zigzag flat on the screen as it is seen now: across its line on the screen — square to both its
    // line and the view — never toward or away from the camera, so it never folds back on itself into a heap. Its line
    // pointing at the camera, with no way across it on the screen: the screen's left and right.)
    const camera = this.mesh.getScene().activeCamera;
    const toCam = cam.subtract(Vector3.Lerp(from, to, 0.5)).normalize();
    let flatAx = Vector3.Cross(toCam, dir);
    if (flatAx.lengthSquared() < 0.04) {
      const right = camera ? camera.getDirection(Vector3.Right()) : Vector3.Right();
      flatAx = right.subtract(dir.scale(Vector3.Dot(right, dir)));
    }
    flatAx.normalize();
    const side = (o.wander ?? WANDER) * run;
    const peak = o.peak ?? 0.5;
    // Ours: corners. The source's field is smooth, which over a long bolt
    // reads as a wavy string; every CORNER knots the path kinks by a random
    // jog (new each re-strike), straight between — lightning's zigzag.
    // The first corner is the start itself, so the stroke leaves from its point.
    const jog = (c: number, axis: number) => c === 0 ? 0 : (hash(o.k * 131.7 + c * 17.3 + axis * 5.1) - 0.5) * 2 * JAG * side;
    for (let i = 0; i < KNOTS; i++) {
      const u = i / (KNOTS - 1), zc = (u - 0.5) * 8;
      const [w0, w1] = wander(o.k, zc, t * WRITHE);
      const pin = o.pinEnd ? 1 - smoothstep(0.82, 1, u) : 1;
      const c0 = Math.floor(i / CORNER), f = (i % CORNER) / CORNER;
      const jx = jog(c0, 0) * (1 - f) + jog(c0 + 1, 0) * f;
      const jy = jog(c0, 1) * (1 - f) + jog(c0 + 1, 1) * f;
      const p = this.pts[i];
      p.copyFrom(from).addInPlace(chord.scale(u));
      if (o.bow) p.addInPlace(o.bow.scale(smoothstep(0, peak, u) * (1 - smoothstep(peak, 1, u))));
      p.addInPlace(flatAx.scale(((w0 + w1) * 0.7 * side + (jx + jy) * 0.7) * pin));
    }
    // (Each point's share of the way along the whole bolt — the bolt's line, the same for every stroke of it — else along its own.)
    const ch = o.chord?.();
    const ab = ch ? ch[1].subtract(ch[0]) : null, ab2 = ab ? Math.max(1e-8, ab.lengthSquared()) : 1;
    const along = (q: Vector3, u: number) => (ch && ab ? Math.min(1, Math.max(0, Vector3.Dot(q.subtract(ch[0]), ab) / ab2)) : u);
    // The ribbon, square to the view at every knot; swellings fatten the thread
    // (a thick column only a little: it is already all glow).
    const thick = Math.min(1, o.width / (HAIR * 8));
    const span = 1 + Math.round(5 * thick);
    const swellGain = 1.2 - 0.95 * thick;
    for (let i = 0; i < KNOTS; i++) {
      const u = i / (KNOTS - 1), zc = (u - 0.5) * 8;
      const p = this.pts[i];
      // A wide ribbon takes its edge direction over more knots, or its edges
      // fold into long spikes at the zigzag's corners.
      const tan = this.pts[Math.min(KNOTS - 1, i + span)].subtract(this.pts[Math.max(0, i - span)]);
      const swell = smoothstep(GIRTH_CUT, 1, fbm1(3 * zc + GIRTH_RATE * t + 13 * o.k));
      // Thins to a point at the far end of an unpinned stroke.
      const tip = o.pinEnd ? 1 : 1 - 0.6 * smoothstep(0.85, 1, u);
      const half = o.width * HALO * (1 + swellGain * swell) * tip;
      if (this.ring > 2) {
        // A tube: a ring round its line, as wide as the ribbon's mask would show it here (its middle out to the edge it
        // keeps as it dims — boltMask's wide), the same from any side.
        // (Steady: no swellings running along it, no flicker of its brightness in its width — painted as an aura's fill,
        // those read as the fill breathing. Only its tip thinning off, an unpinned stroke's.)
        const hot = 1;
        const r = o.width * TUBE_WIDTH * tip;
        if (tan.lengthSquared() < 1e-10) tan.copyFrom(dir);
        tan.normalize();
        const n = Vector3.Cross(tan, Math.abs(tan.y) < 0.9 ? Vector3.Up() : Vector3.Right()).normalize();
        const b = Vector3.Cross(tan, n);
        const R = this.ring, at = along(p, u);
        for (let k = 0; k < R; k++) {
          const a = (k / R) * Math.PI * 2, ca = Math.cos(a) * r, sa = Math.sin(a) * r;
          const j = (i * R + k) * 3, c = (i * R + k) * 4;
          this.pos[j] = p.x + n.x * ca + b.x * sa; this.pos[j + 1] = p.y + n.y * ca + b.y * sa; this.pos[j + 2] = p.z + n.z * ca + b.z * sa;
          this.col[c] = hot; this.col[c + 1] = at; this.col[c + 2] = 0; this.col[c + 3] = 1;
        }
        continue;
      }
      const view = cam.subtract(p);
      let s = Vector3.Cross(tan, view);
      if (s.lengthSquared() < 1e-10) s = ax.clone();
      s.normalize();
      const j = i * 6;
      this.pos[j] = p.x - s.x * half; this.pos[j + 1] = p.y - s.y * half; this.pos[j + 2] = p.z - s.z * half;
      this.pos[j + 3] = p.x + s.x * half; this.pos[j + 4] = p.y + s.y * half; this.pos[j + 5] = p.z + s.z * half;
      // The source's colour line (its brightness along the stroke).
      const hot = Math.min(1, Math.max(0, 2 * (0.1 + 0.9 * this.lit) * (1 - 0.3 * fbm1(5 * zc + o.k)) - 0.2)) + 0.4 * swell;
      const c = i * 8;
      this.col[c] = hot; this.col[c + 4] = hot;
      // (Where along the whole bolt this point is: its share of the way from its first end to its last.)
      this.col[c + 1] = this.col[c + 5] = along(p, u);
      this.col[c + 3] = 1; this.col[c + 7] = 1;
    }
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.pos);
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, this.col);
    this.mat.setFloat('lit', this.lit);
    // (A tube's mask steady — its flicker not in its shape — shown while it is lit at all.)
    this.maskMat?.setFloat('lit', this.ring > 2 ? (this.lit > 0.01 ? 1 : 0) : this.lit);
  }

  /**
   * Drawn over the auras (UnitFx.addOver: its own pass, after the scene's — so without the scene's tone mapping,
   * which bleaches its yellow to cream): its colours come out as they are, as the auras' do.
   */
  overAuras(add: (mesh: Mesh) => () => void): void { this.unover = add(this.mesh); }
  private unover: (() => void) | null = null;

  /** Its last stretch (from `from` of the way along) in a second silhouette instead — `color` (null: none, all its own). */
  maskAlso(color: Color4 | null, from: number): void {
    this.maskMat?.setColor4('maskColor2', color ?? new Color4(0, 0, 0, 0));
    this.maskMat?.setFloat('from2', color ? from : 2);
  }

  dispose(): void { this.unmask?.(); this.unover?.(); this.maskMat?.dispose(); this.mat.dispose(); this.mesh.dispose(); }
}

/** The amber dome of light where a stroke lands. */
class Pool {
  readonly mesh: Mesh;
  readonly mat: ShaderMaterial;
  constructor(scene: Scene) {
    this.mesh = new Mesh('boltPool', scene);
    const vd = new VertexData();
    vd.positions = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    vd.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
    vd.indices = [0, 1, 2, 0, 2, 3];
    vd.applyToMesh(this.mesh);
    this.mat = new ShaderMaterial('boltPoolMat', scene, { vertex: 'boltPool', fragment: 'boltPool' }, {
      attributes: ['position', 'uv'],
      uniforms: ['viewProjection', 'center', 'radius', 'pool', 'tint'],
      needAlphaBlending: true,
    });
    this.mat.backFaceCulling = false;
    this.mat.disableDepthWrite = true;
    // (Added on as light: it brightens the ground and grass under it, never laid over them as paint.)
    // (One plus one: its colour comes out already scaled by its strength — ALPHA_ADD would scale it by that again.)
    this.mat.alphaMode = Constants.ALPHA_ONEONE;
    this.mat.setVector3('tint', new Vector3(1.0, 0.82, 0.3));
    this.mesh.material = this.mat;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.doNotSyncBoundingInfo = true;
  }
  /** Its own centre: the material keeps the vector it is given, not a copy — one shared by many pools put them all in one place. */
  private readonly center = new Vector3();
  set(center: Vector3, radius: number, pool: number): void {
    this.mesh.isVisible = pool > 0.05;
    this.mat.setVector3('center', this.center.copyFrom(center));
    this.mat.setFloat('radius', radius);
    // (Over 1 allowed: light added on, through the tone mapping, needs it to read.)
    this.mat.setFloat('pool', Math.min(POOL_MAX, pool));
  }
  dispose(): void { this.mat.dispose(); this.mesh.dispose(); }
}

/** A body the earthing runs from. */
export interface EarthBody {
  /** Sampled skin points: how many, and point i in world space now (false if hidden). */
  count: number;
  pointAt(i: number, out: Vector3): boolean;
  /** Where it stands (its root) and how tall it is. */
  root: () => Vector3;
  height: number;
  /** The floor under it (world Y). */
  ground: () => number;
  /** Body points no stroke may start from (the front of the face). */
  avoid?: (p: Vector3) => boolean;
  /**
   * A way it is pressing (unit, level), or null: held in a clash, the way to
   * the other. Its strokes are then thrown back behind it and out to its
   * sides, away from what it presses against, as if blown off it.
   */
  press?: () => Vector3 | null;
  /** Draw a stroke over the auras (UnitFx.addLight: laid on as light after them), returning the undo — so a stroke out past its aura shows whole. */
  overAura?: (mesh: Mesh) => () => void;
}

export interface EarthOptions {
  /** 0..1, read every frame (the discharge's drive). */
  power: () => number;
  bolts?: number;
  /** Width × the hairline. */
  thick?: number;
  /** Extra outward reach, in body heights (a discharge reaching the tiles round it). */
  spread?: number;
  /** Ignore the flicker's dead air (always on, flickering only in brightness). */
  steady?: boolean;
  /** Its colours (default: the white-hot arc in its amber halo). */
  colors?: BoltColors;
}

export interface LightningPlay { hit: Promise<void>; contactEnds: Promise<void>; done: Promise<void> }

type Job = (dt: number, t: number, cam: Vector3) => boolean; // false when finished

export class LightningFx {
  private jobs: Job[] = [];
  private time = 0;
  private tick: Observer<Scene>;
  private serial = 0;

  constructor(private readonly scene: Scene, private readonly camera: Camera,
    private readonly opts: { shake?: (magnitude: number, ms: number) => void } = {}) {
    this.tick = scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
      this.time += dt;
      const cam = this.camera.globalPosition;
      this.jobs = this.jobs.filter((j) => j(dt, this.time, cam));
    });
  }

  /**
   * The earthing discharge: strokes from points on `body` down to the floor,
   * for as long as the handle is not stopped.
   */
  /**
   * A glow of light laid on the ground (added on, so the ground and the grass tips there brighten in `tint`): placed
   * and dimmed each frame by its owner — the glow under a Pokémon wearing lightning (an Electric aura, or zapped).
   */
  groundGlow(tint: Vector3): { set(center: Vector3, radius: number, strength: number): void; dispose(): void } {
    const g = groundLight(), col = tint.clone();
    return { set: (c, r, k) => g.set(c, r, col, k), dispose: () => g.dispose() };
  }

  earth(body: EarthBody, o: EarthOptions): { stop(): void } {
    const n = o.bolts ?? BOLTS;
    const h = body.height;
    // Earthing strokes are finer than the bolts (asked for: thinner).
    // In proportion to the body (a big Pokémon's strokes as thick, for its size, as a small one's).
    const width = HAIR * EARTH_THIN * (o.thick ?? 1) * Math.min(EARTH_SIZE_MAX, Math.max(EARTH_SIZE_MIN, h / 1.3));
    const slots: { s: Stroke; pool: GroundLight; idx: number; head: Vector3; foot: Vector3; born: number; share: number; undoOver?: () => void }[] = [];
    let last = body.root().clone(), vel = new Vector3();
    let stopped = false, fade = 1;
    const born = this.time;
    const base = (this.serial++ % 97) * 1.31;
    const seat = (k: number, t: number) => {
      const slot = slots[k];
      // A real point of the body, picked by the doc's seed.
      const seed = Math.floor(t * 1000) * 31 + k * 7919;
      // (Not off the front of the face: picked again, a few tries.)
      for (let tries = 0; tries < 12; tries++) {
        slot.idx = Math.floor(hash(seed + tries * 101.3) * body.count) % Math.max(1, body.count);
        body.pointAt(slot.idx, slot.head);
        if (!body.avoid?.(slot.head)) break;
      }
      const root = body.root();
      const ground = body.ground();
      const drop = Math.max(0, slot.head.y - ground);
      const sideV = new Vector3(slot.head.x - root.x, 0, slot.head.z - root.z);
      const lat = sideV.length() / h;
      const out = (lat * SPRAY + SPREAD * (1 - Math.min(1, drop / h / REACH))) * h
        + (o.spread ?? 0) * h * (0.75 + 0.35 * hash(seed + 9)); // a discharge reaches out whatever the drop
      const dir = lat > 1e-3 ? sideV.normalize() : new Vector3(Math.cos(hash(seed + 3) * 6.283), 0, Math.sin(hash(seed + 3) * 6.283));
      // Moving: laid down behind it, so it stretches as the body goes on.
      const speed = vel.length();
      const trail = speed > 1e-3 ? vel.scale(-1 / speed).scale(TRAIL * Math.min(1, speed / (4.4 * TILE_SCALE)) * h * 0.25 * (TRAIL_MIN + (1 - TRAIL_MIN) * hash(seed + 5))) : Vector3.Zero();
      slot.foot.set(slot.head.x, ground + 0.01, slot.head.z).addInPlace(dir.scale(out)).addInPlace(trail);
      // (Pressing in a clash: thrown back behind it and out to either side.)
      const press = body.press?.();
      if (press) {
        const side = new Vector3(press.z, 0, -press.x);
        slot.foot.addInPlace(press.scale(-PRESS_BACK * h * (0.5 + 0.5 * hash(seed + 11))))
          .addInPlace(side.scale((hash(seed + 13) - 0.5) * 2 * PRESS_SIDE * h));
      }
      slot.born = t;
      slot.share = 0.55 + 0.45 * hash(977 * (k + base) + 61);
      slot.s.o.k = (k + base + Math.floor(t / LIFE) * 3.7) % 40;
      slot.s.o.bow = new Vector3(slot.head.x - root.x, 0, slot.head.z - root.z).scale(BOW * 0.5);
      slot.s.o.peak = hash(6151 * k + 7 + seed) < 0.5 ? BOW_EARLY : BOW_LATE;
    };
    for (let k = 0; k < n; k++) {
      const head = new Vector3(), foot = new Vector3();
      const s = new Stroke(this.scene, {
        from: () => (body.pointAt(slots[k].idx, head) ? head : head),
        to: () => foot, width, k,
      });
      if (o.colors) { s.mat.setVector3('arc', o.colors.arc); s.mat.setVector3('halo', o.colors.halo); s.mat.setVector3('outer', o.colors.halo); }
      const undoOver = body.overAura?.(s.mesh);
      const pool = groundLight();
      // (Its glow in the stroke's own colour: its halo's — yellow, or Zeraora's blue.)
      slots.push({ s, pool, idx: 0, head, foot, born: -1, share: 1, undoOver });
      // Stagger the first ones so they do not all go out together.
      seat(k, this.time - hash(k * 17.1) * LIFE);
    }
    this.jobs.push((dt, t, cam) => {
      const root = body.root();
      vel = root.subtract(last).scale(1 / Math.max(dt, 1e-3));
      last = root.clone();
      if (stopped) fade = Math.max(0, fade - dt / 0.12);
      const power = o.power() * fade * Math.min(1, (t - born) / 0.08);
      const flicker = o.steady ? 0.7 + 0.3 * illum(t + base) : illum(t + base);
      for (let k = 0; k < n; k++) {
        const slot = slots[k];
        if (t - slot.born >= LIFE) seat(k, t);
        const age = (t - slot.born) / LIFE;
        slot.s.lit = power * flicker * slot.share;
        slot.s.update(t, cam);
        // (Where it meets the ground: a slight glow over the grass's tips, with the stroke — as it lights, as it dies.)
        slot.pool.set(slot.foot, EARTH_GLOW_R * h, o.colors?.halo ?? YELLOW, slot.s.lit * (1 - age) * EARTH_GLOW);
      }
      if (stopped && fade <= 0) { for (const sl of slots) { sl.undoOver?.(); sl.s.dispose(); sl.pool.dispose(); } return false; }
      return true;
    });
    return { stop: () => { stopped = true; } };
  }

  /**
   * A bolt from `from` to `to`: `strands` thick strokes re-striking every
   * RESTRIKE, forks breaking off them, held `hold` s after it strikes.
   * `hit` as it first strikes, `contactEnds` as it lets go.
   */
  bolt(from: () => Vector3, to: () => Vector3, o: { width: number; strands?: number; forks?: number; hold: number; delay?: number; light?: number; wander?: number;
    /** Its colours (default: the white-hot arc in its amber halo), and its light's. */
    colors?: BoltColors;
    /** Held until this resolves (then it lets go), in place of `hold` s. */
    holdUntil?: Promise<void>;
    /** No camera shake as it strikes (Electric Terrain's crackle over the ground). */
    quiet?: boolean;
    /** The unit whose silhouette the bolt joins (its aura wraps body and bolt as one): its mask colour and UnitFx.addToMask. */
    mask?: { color: Color4; add: (mesh: Mesh, mat: ShaderMaterial) => () => void;
      /** The whole ribbon in the silhouette, forks too (the aura's outline round all of it, the ribbon filling it), not its core only. */
      wide?: boolean;
      /** Its last stretch (from `alsoFrom` of the way along each stroke) in its target's silhouette instead, each frame: the target's mask colour (null: none). */
      also?: () => Color4 | null; alsoFrom?: number };
    /** Drawn over the auras, without the scene's tone mapping (UnitFx.addOver): its colours as they are. */
    over?: (mesh: Mesh) => () => void;
    /** Its forks converging on its target (Thunderbolt): each breaks off the main and ends on `to` (jittered a little), none straying off into the air. */
    converge?: boolean }): LightningPlay {
    const strands = o.strands ?? 2;
    const forks = o.forks ?? 3;
    let resolveHit!: () => void, resolveEnd!: () => void, resolveDone!: () => void;
    const hit = new Promise<void>((r) => { resolveHit = r; });
    const contactEnds = new Promise<void>((r) => { resolveEnd = r; });
    const done = new Promise<void>((r) => { resolveDone = r; });
    const base = (this.serial++ % 97) * 2.17;
    // (The whole bolt's line, for where along it each stroke's every point is: one split for all of them.)
    const chord = (): [Vector3, Vector3] => [from(), to()];
    // (Drawn as an aura — its mask its whole look: tubes, the same from any side.)
    const tube = !!o.mask?.wide;
    const mains = Array.from({ length: strands }, (_, i) => new Stroke(this.scene, {
      from, to, width: o.width * (i === 0 ? 1 : 0.55), wander: (o.wander ?? WANDER) * (i === 0 ? 1 : 1.4), pinEnd: true, k: base + i, chord, tube,
    }));
    const forkEnds = Array.from({ length: forks }, () => ({ at: 0.3, end: new Vector3(), host: 0, off: new Vector3() }));
    const forkStrokes = forkEnds.map((f, i) => new Stroke(this.scene, {
      // (Converging: its end on the target — where the target is now, jittered — and held there, not thinning off.)
      from: () => mains[f.host].at(f.at), to: o.converge ? () => to().add(f.off) : () => f.end, width: o.width * 0.35, k: base + 10 + i,
      pinEnd: !!o.converge, chord, tube,
    }));
    if (o.colors) for (const s of [...mains, ...forkStrokes]) { s.mat.setVector3('arc', o.colors.arc); s.mat.setVector3('halo', o.colors.halo); s.mat.setVector3('outer', o.colors.halo); }
    if (o.mask) for (const s of o.mask.wide ? [...mains, ...forkStrokes] : mains) s.maskIn(this.scene, o.mask.color, o.mask.add, o.mask.wide);
    if (o.over) for (const s of [...mains, ...forkStrokes]) s.overAuras(o.over);
    const light = new PointLight('boltLight', Vector3.Zero(), this.scene);
    light.diffuse = o.colors?.light ?? new Color3(1, 0.92, 0.6);
    light.range = 3.5 * TILE_SCALE;
    light.intensity = 0;
    const start = this.time + (o.delay ?? 0);
    let lastStrike = -1, struck = false, ended = false;
    // Held until told to let go (then for as long as it had been on).
    let hold = o.holdUntil ? Infinity : o.hold;
    void o.holdUntil?.then(() => { hold = Math.max(0, this.time - start); });
    const FADE = 0.15;
    const reFork = (t: number) => {
      const a = from(), b = to();
      const chord = b.subtract(a);
      const len = chord.length();
      forkEnds.forEach((f, i) => {
        const s = Math.floor(t * 1000) + i * 131;
        f.host = Math.floor(hash(s) * strands) % strands;
        f.at = 0.15 + 0.7 * hash(s + 1);
        const p = mains[f.host].at(f.at);
        // (Converging: a fork breaks off in the main's later half, to run in onto the target close by the main — a
        // little off its own end — so the strands stay a bundle, not a fan with gaps between them.)
        if (o.converge) {
          f.at = 0.45 + 0.35 * hash(s + 1);
          // (Its spread scaled by the bolt's length, but no further than CONVERGE_SPAN: a long bolt out of the sky lands
          // its forks on the body too, not a body's height off it in the air.)
          const span = Math.min(len, CONVERGE_SPAN);
          f.off.set((hash(s + 2) - 0.5) * 0.03 * span, (hash(s + 3) - 0.5) * 0.06 * span, (hash(s + 4) - 0.5) * 0.03 * span);
          return;
        }
        const off = new Vector3(hash(s + 2) - 0.5, hash(s + 3) - 0.75, hash(s + 4) - 0.5).normalize();
        f.end.copyFrom(p).addInPlace(chord.scale((0.08 + 0.12 * hash(s + 5)))).addInPlace(off.scale(len * (0.1 + 0.15 * hash(s + 6))));
      });
    };
    this.jobs.push((_dt, t, cam) => {
      const el = t - start;
      if (el < 0) { for (const s of [...mains, ...forkStrokes]) s.mesh.isVisible = false; return true; }
      if (!struck) { struck = true; resolveHit(); if (!o.quiet) this.opts.shake?.(o.width * 2, 140); }
      if (!ended && el >= hold) { ended = true; resolveEnd(); }
      const out = el >= hold ? 1 - (el - hold) / FADE : 1;
      if (out <= 0) {
        for (const s of [...mains, ...forkStrokes]) s.dispose();
        light.dispose();
        resolveDone();
        return false;
      }
      // Re-strike: a new path through the field, and new forks.
      const restrike = t - lastStrike >= RESTRIKE;
      if (restrike) {
        lastStrike = t;
        mains.forEach((s, i) => { s.o.k = (base + i + Math.floor(t / RESTRIKE) * 5.3) % 40; });
        forkStrokes.forEach((s, i) => { s.o.k = (base + 10 + i + Math.floor(t / RESTRIKE) * 2.9) % 40; });
      }
      const flick = 0.75 + 0.25 * illum(t * 3 + base);
      const strike = 1 - 0.35 * ((t - lastStrike) / RESTRIKE); // each strike flares, then dims
      // (Its last stretch in its target's silhouette too, whoever that is now.)
      if (o.mask?.also) { const c2 = o.mask.also(); for (const s of [...mains, ...forkStrokes]) s.maskAlso(c2, o.mask.alsoFrom ?? 0.5); }
      mains.forEach((s) => { s.lit = out * flick * strike; s.update(t, cam); });
      if (restrike) reFork(t);
      forkStrokes.forEach((s, i) => { s.lit = out * strike * (hash(Math.floor(t / RESTRIKE) + i * 7) < 0.7 ? 0.8 : 0); s.update(t, cam); });
      light.position.copyFrom(Vector3.Lerp(from(), to(), 0.7));
      light.intensity = 0.35 * (o.light ?? 1.5) * out * strike * flick;
      return true;
    });
    return { hit, contactEnds, done };
  }

  /**
   * Thunder: `count` Thunderbolt-thick bolts falling out of the sky, one after
   * another (THUNDER_STAGGER apart), over the ground round `at` (the target)
   * out to `ring` (the tiles round it), each landing in an amber pool and
   * striking somewhere new every THUNDER_RESEAT. A hit: THUNDER_ON_TARGET of
   * them strike the target, one after another (the first of them first of
   * all). A miss (`miss`): none touches it — the rest land at least `clear`
   * off it, leaning away from it, unforked.
   */
  thunder(at: () => Vector3, o: { width: number; hold: number; ring: number; clear: number; delay?: number; count?: number; miss?: boolean }): LightningPlay {
    const n = Math.max(o.count ?? THUNDER_BOLTS, THUNDER_ON_TARGET + 1);
    const delay = o.delay ?? 0;
    const base = this.serial * 3.1;
    // Which bolts strike the target: every other one from the first, on a hit.
    const onTarget = (i: number) => !o.miss && i % 2 === 0 && i / 2 < THUNDER_ON_TARGET;
    const clear = Math.min(o.clear, o.ring * 0.9);
    // Where bolt i lands now, and which way off the target (its angle).
    const seat = (i: number) => {
      const k = Math.floor((this.time + i * 0.137) / THUNDER_RESEAT) * 5.77 + i * 13.1 + base;
      return { a: (i / n + 0.4 * hash(k)) * 6.283, r: clear + (o.ring - clear) * Math.sqrt(hash(k + 1)) };
    };
    const landing = (i: number) => {
      const p = at();
      if (onTarget(i)) return p;
      const { a, r } = seat(i);
      return new Vector3(p.x + Math.cos(a) * r, p.y + 0.02, p.z + Math.sin(a) * r);
    };
    // The sky it falls from: off to one side — leaning away from the target,
    // for one that misses it.
    const skyOf = (i: number) => {
      const p = landing(i);
      const a = onTarget(i) ? hash(base + i * 7.7) * 6.283 : seat(i).a;
      return new Vector3(p.x + Math.cos(a) * THUNDER_SLANT * TILE_SCALE, p.y + THUNDER_SKY * TILE_SCALE, p.z + Math.sin(a) * THUNDER_SLANT * TILE_SCALE);
    };
    // The first holds `hold` (its hit is the target's zap, if it is on it);
    // the rest fall in after it and hold as long. Unforked when missing, so
    // no fork reaches the target.
    const forks = (i: number) => (o.miss ? 0 : i === 0 ? 4 : 3);
    const main = this.bolt(() => skyOf(0), () => landing(0), { width: o.width, strands: 2, forks: forks(0), hold: o.hold, delay, light: 3 });
    const rest = Array.from({ length: n - 1 }, (_, j) => this.bolt(() => skyOf(j + 1), () => landing(j + 1), {
      width: o.width, strands: 2, forks: forks(j + 1), hold: 0, holdUntil: main.contactEnds, delay: delay + (j + 1) * THUNDER_STAGGER, light: 0.8,
    }));
    // An amber pool where each of the rest lands.
    void main.hit.then(() => {
      const pools = rest.map(() => new Pool(this.scene));
      const struck = this.time;
      let stop = false, fade = 1;
      void main.contactEnds.then(() => { stop = true; });
      this.jobs.push((dt, t) => {
        if (stop) fade -= dt / 0.15;
        if (fade <= 0) { pools.forEach((p) => p.dispose()); return false; }
        pools.forEach((pool, j) => {
          const on = t - struck >= (j + 1) * THUNDER_STAGGER ? 1 : 0;
          pool.set(landing(j + 1), POOL_R * 1.4 * TILE_SCALE, on * fade * (0.6 + 0.4 * illum(t * 2 + j)) * POOL_GAIN * 0.6);
        });
        return true;
      });
    });
    return { hit: main.hit, contactEnds: main.contactEnds, done: Promise.all([main.done, ...rest.map((r) => r.done)]).then(() => {}) };
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.tick);
    this.jobs = [];
  }
}
