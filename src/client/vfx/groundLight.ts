/**
 * Light on the ground, and the ground heaving: soft glows cast onto the floor by lightning (an earthing stroke where it
 * lands, a Pokémon wearing lightning standing over it), and Earthquake's wave running out along it. Neither is a sheet
 * laid over the floor — that hides the feet standing in it — but done in the floor's own shading (GroundGlowPlugin), at
 * each point of the surface: the ground, the grass blades, the painted lines.
 *
 *   glows   light added at each point (up to MAX at once).
 *   quakes  the floor lifted in a ring at each wave's front, running out radially from where it began; brighter on its
 *           crest, darker in the trough behind; cracks radiating out behind it (up to QUAKES at once).
 *
 * Shared by every floor material that wears the plugin (groundLit). A floor heaves only as finely as its mesh is cut.
 */
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { Material } from '@babylonjs/core/Materials/material';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';

/** How many glows at once (more are not lit); how far up off its floor a glow still reaches (m — the grass's height and more). */
const MAX = 16, REACH_UP = 0.35;
/** How many quakes at once; how many cracks each radiates; how far its slabs between the cracks stand off level at most (world units). */
const QUAKES = 8, CRACKS = 11, FAULT = 0.07;

/** Each glow: (x, y, z, radius) and (r, g, b, strength). */
const where = new Float32Array(MAX * 4), tint = new Float32Array(MAX * 4);
const used = new Array<boolean>(MAX).fill(false);
/** Each quake: (x, z, front, lift) and (width, crack, its seed, its radius — none past it). */
const quakeA = new Float32Array(QUAKES * 4), quakeB = new Float32Array(QUAKES * 4);
const quakeUsed = new Array<boolean>(QUAKES).fill(false);

export interface GroundLight {
  /** Put it at `center` (on the floor), `radius` across, in `color`, `strength` bright (0: off). */
  set(center: Vector3, radius: number, color: Vector3, strength: number): void;
  dispose(): void;
}

/** A glow on the floor (off until set), or a dummy when all MAX are in use. */
export function groundLight(): GroundLight {
  const i = used.indexOf(false);
  if (i < 0) return { set: () => {}, dispose: () => {} };
  used[i] = true;
  tint[i * 4 + 3] = 0;
  let gone = false;
  return {
    set: (c, r, col, k) => {
      if (gone) return;
      where[i * 4] = c.x; where[i * 4 + 1] = c.y; where[i * 4 + 2] = c.z; where[i * 4 + 3] = Math.max(1e-3, r);
      tint[i * 4] = col.x; tint[i * 4 + 1] = col.y; tint[i * 4 + 2] = col.z; tint[i * 4 + 3] = Math.max(0, k);
    },
    dispose: () => { if (gone) return; gone = true; tint[i * 4 + 3] = 0; used[i] = false; },
  };
}

export interface GroundQuake {
  /**
   * Its wave now: begun at (`x`, `z`), its front a ring `front` out from it (world units), lifting the floor `lift` high
   * there in a band `width` wide; its cracks `crack` open (0 none … 1 full); nothing past `radius`.
   */
  set(x: number, z: number, front: number, lift: number, width: number, crack: number, radius: number): void;
  dispose(): void;
}

/** A quake's wave on the floor (still until set), or a dummy when all QUAKES are in use. */
export function groundQuake(): GroundQuake {
  const i = quakeUsed.indexOf(false);
  if (i < 0) return { set: () => {}, dispose: () => {} };
  quakeUsed[i] = true;
  quakeA[i * 4 + 3] = 0; quakeB[i * 4 + 1] = 0;
  quakeB[i * 4 + 2] = Math.random() * 100;
  let gone = false;
  return {
    set: (x, z, front, lift, width, crack, radius) => {
      if (gone) return;
      quakeA[i * 4] = x; quakeA[i * 4 + 1] = z; quakeA[i * 4 + 2] = front; quakeA[i * 4 + 3] = lift;
      quakeB[i * 4] = Math.max(1e-3, width); quakeB[i * 4 + 1] = crack; quakeB[i * 4 + 3] = Math.max(1e-3, radius);
    },
    dispose: () => { if (gone) return; gone = true; quakeA[i * 4 + 3] = 0; quakeB[i * 4 + 1] = 0; quakeUsed[i] = false; },
  };
}

/** The wave's lift at a point (GLSL): a ring — a crest at the front, a smaller trough and swell behind it, none ahead of it — fading out to its radius. */
const QUAKE_GLSL = `
float ggWaveAt(vec2 p, vec4 a, vec4 b) {
  if (a.w <= 0.0) return 0.0;
  float r = length(p - a.xy);
  float d = r - a.z;
  float s = d / b.x;
  float crest = exp(-s * s * 2.2);
  float behind = d < 0.0 ? sin(-s * 2.6) * exp(s * 0.9) * -0.45 : 0.0;
  float edge = 1.0 - smoothstep(b.w * 0.8, b.w * 1.05, r);
  return a.w * (crest + behind) * edge;
}
float ggHash(float n) { return fract(sin(n) * 43758.5453); }
float ggNoise(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(ggHash(i), ggHash(i + 1.0), f); }
// Its cracks: CRACKS rays out from where it was stamped, crack c at this angle (wandering a little with how far out), and
// this long.
float ggCrackAngle(int c, float r, float seed) {
  return float(c) * ${(2 * Math.PI / CRACKS).toFixed(4)} + (ggHash(seed + float(c) * 3.7) - 0.5) * 0.4
    + 0.22 * (ggNoise(r * 2.4 + seed + float(c) * 5.0) - 0.5);
}
float ggCrackLen(int c, vec4 b) { return b.w * (0.55 + 0.45 * ggHash(b.z * 1.3 + float(c))); }
// The ground between its cracks broken into slabs, each set at its own height while they are open (b.y): uneven at every
// seam. Which slab a point is in — how many cracks lie below its angle — and that slab's height; settling flat toward
// the cracks' far ends and at its middle, and behind its front only.
float ggFaultAt(vec2 p, vec4 a, vec4 b) {
  if (b.y <= 0.0) return 0.0;
  vec2 v = p - a.xy;
  float r = length(v);
  if (r > a.z || r > b.w) return 0.0;
  float ang = atan(v.y, v.x);
  float slab = 0.0;
  for (int c = 0; c < ${CRACKS}; c++) {
    float th = ggCrackAngle(c, r, b.z);
    th = th - 6.2832 * floor((th + 3.1416) / 6.2832);
    if (th < ang) slab += 1.0;
  }
  if (slab >= ${CRACKS}.0) slab = 0.0;
  float settle = smoothstep(0.15, 0.6, r) * (1.0 - smoothstep(b.w * 0.45, b.w * 0.9, r));
  return (ggHash(b.z * 0.7 + slab * 11.3) - 0.5) * 2.0 * ${FAULT.toFixed(3)} * b.y * settle;
}
`;

class GroundGlowPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, 'GroundGlow', 210, { GROUNDGLOW: false });
    // (Bound on every draw: the glows and waves move every frame, the material itself unchanged.)
    this.registerForExtraEvents = true;
    this._enable(true);
  }
  getClassName(): string { return 'GroundGlowPlugin'; }
  prepareDefines(defines: Record<string, unknown>): void { defines.GROUNDGLOW = true; }
  getUniforms() {
    return {
      ubo: [
        { name: 'ggWhere', size: 4, type: 'vec4', arraySize: MAX }, { name: 'ggTint', size: 4, type: 'vec4', arraySize: MAX },
        { name: 'ggQuakeA', size: 4, type: 'vec4', arraySize: QUAKES }, { name: 'ggQuakeB', size: 4, type: 'vec4', arraySize: QUAKES },
      ],
      vertex: `#ifdef GROUNDGLOW
        uniform vec4 ggQuakeA[${QUAKES}];
        uniform vec4 ggQuakeB[${QUAKES}];
      #endif`,
      fragment: `#ifdef GROUNDGLOW
        uniform vec4 ggWhere[${MAX}];
        uniform vec4 ggTint[${MAX}];
        uniform vec4 ggQuakeA[${QUAKES}];
        uniform vec4 ggQuakeB[${QUAKES}];
      #endif`,
    };
  }
  private bind(ubo: UniformBuffer): void {
    ubo.updateFloatArray('ggWhere', where); ubo.updateFloatArray('ggTint', tint);
    ubo.updateFloatArray('ggQuakeA', quakeA); ubo.updateFloatArray('ggQuakeB', quakeB);
  }
  bindForSubMesh(ubo: UniformBuffer): void { this.bind(ubo); }
  hardBindForSubMesh(ubo: UniformBuffer): void { this.bind(ubo); }
  getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `#ifdef GROUNDGLOW
          varying float vGgLift;
          ${QUAKE_GLSL}
        #endif`,
        // The floor lifted where a wave is (its grass with it, shell by shell).
        CUSTOM_VERTEX_UPDATE_WORLDPOS: `#ifdef GROUNDGLOW
          {
            float ggLift = 0.0;
            for (int q = 0; q < ${QUAKES}; q++) ggLift += ggWaveAt(worldPos.xz, ggQuakeA[q], ggQuakeB[q]) + ggFaultAt(worldPos.xz, ggQuakeA[q], ggQuakeB[q]);
            worldPos.y += ggLift;
            vGgLift = ggLift;
          }
        #endif`,
      };
    }
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef GROUNDGLOW
        varying float vGgLift;
        ${QUAKE_GLSL}
      #endif`,
      // Each glow's light added on where this point of the floor is: brightest under its middle, soft to its rim,
      // whiter at the heart; less the further up off the floor. The quakes: their crests catching the light, their
      // troughs in shadow, their cracks dark behind them.
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `#ifdef GROUNDGLOW
        for (int gg = 0; gg < ${MAX}; gg++) {
          vec4 ggT = ggTint[gg];
          if (ggT.w <= 0.0) continue;
          vec4 ggW = ggWhere[gg];
          vec2 ggD = (vPositionW.xz - ggW.xz) / ggW.w;
          float ggR2 = dot(ggD, ggD);
          if (ggR2 >= 1.0) continue;
          float ggUp = clamp(abs(vPositionW.y - ggW.y) / ${REACH_UP.toFixed(2)}, 0.0, 1.0);
          float ggK = ggT.w * (1.0 - ggR2) * (1.0 - ggR2) * (1.0 - ggUp);
          color.rgb += mix(ggT.rgb, vec3(1.0), 0.5 * max(0.0, 1.0 - 4.0 * ggR2)) * ggK;
        }
        color.rgb *= 1.0 + clamp(vGgLift * 2.2, -0.35, 0.35);
        for (int q = 0; q < ${QUAKES}; q++) {
          vec4 qa = ggQuakeA[q], qb = ggQuakeB[q];
          if (qb.y <= 0.0) continue;
          vec2 qv = vPositionW.xz - qa.xy;
          float qr = length(qv);
          if (qr > min(qa.z, qb.w) || qr < 0.25) continue;
          // Jagged cracks radiating out from where it was stamped, opening behind the front (thin at their far ends).
          float qang = atan(qv.y, qv.x);
          for (int c = 0; c < ${CRACKS}; c++) {
            float th = ggCrackAngle(c, qr, qb.z);
            float da = qang - th;
            da = da - 6.2832 * floor((da + 3.1416) / 6.2832);
            float off = abs(qr * sin(da));
            if (cos(da) < 0.0) continue;
            float len = ggCrackLen(c, qb);
            if (qr > len) continue;
            float w = 0.06 * qb.y * (1.0 - qr / len * 0.8) * (0.6 + 0.8 * ggNoise(qr * 3.0 + float(c)));
            float on = 1.0 - smoothstep(w * 0.6, w, off);
            color.rgb = mix(color.rgb, color.rgb * 0.18, on);
          }
        }
      #endif`,
    };
  }
}

const lit = new WeakSet<Material>();
/** Let `material` (a floor's: ground, grass, painted lines) take the glows on the ground, and heave with its quakes. */
export function groundLit(material: Material): void {
  if (lit.has(material)) return;
  lit.add(material);
  new GroundGlowPlugin(material);
}
