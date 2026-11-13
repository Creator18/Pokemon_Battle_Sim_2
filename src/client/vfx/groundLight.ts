/**
 * Light on the ground: soft glows cast onto the floor by lightning (an earthing stroke where it lands, a Pokémon
 * wearing lightning standing over it). Not a sheet laid over the floor — that hides the feet standing in it — but
 * light added in the floor's own shading (GroundGlowPlugin), at each point of the surface the camera actually sees:
 * the ground, the grass blades (their tips catching more of it, being nearer), the painted lines. Whatever stands in
 * front of the floor is in front of the glow too.
 *
 * Up to MAX glows at once, shared by every floor material that wears the plugin (groundLit).
 */
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { Material } from '@babylonjs/core/Materials/material';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';

/** How many glows at once (more are not lit); how far up off its floor a glow still reaches (m — the grass's height and more). */
const MAX = 16, REACH_UP = 0.35;

/** Each glow: (x, y, z, radius) and (r, g, b, strength). */
const where = new Float32Array(MAX * 4), tint = new Float32Array(MAX * 4);
const used = new Array<boolean>(MAX).fill(false);

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

class GroundGlowPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, 'GroundGlow', 210, { GROUNDGLOW: false });
    // (Bound on every draw: the glows move every frame, the material itself unchanged.)
    this.registerForExtraEvents = true;
    this._enable(true);
  }
  getClassName(): string { return 'GroundGlowPlugin'; }
  prepareDefines(defines: Record<string, unknown>): void { defines.GROUNDGLOW = true; }
  getUniforms() {
    return {
      ubo: [{ name: 'ggWhere', size: 4, type: 'vec4', arraySize: MAX }, { name: 'ggTint', size: 4, type: 'vec4', arraySize: MAX }],
      fragment: `#ifdef GROUNDGLOW
        uniform vec4 ggWhere[${MAX}];
        uniform vec4 ggTint[${MAX}];
      #endif`,
    };
  }
  private bind(ubo: UniformBuffer): void { ubo.updateFloatArray('ggWhere', where); ubo.updateFloatArray('ggTint', tint); }
  bindForSubMesh(ubo: UniformBuffer): void { this.bind(ubo); }
  hardBindForSubMesh(ubo: UniformBuffer): void { this.bind(ubo); }
  getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== 'fragment') return null;
    return {
      // Each glow's light added on where this point of the floor is: brightest under its middle, soft to its rim,
      // whiter at the heart; less the further up off the floor (a grass blade's tip a little more lit than its root
      // would be, from a glow just above it — not a sheet on top).
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
      #endif`,
    };
  }
}

const lit = new WeakSet<Material>();
/** Let `material` (a floor's: ground, grass, painted lines) take the glows on the ground. */
export function groundLit(material: Material): void {
  if (lit.has(material)) return;
  lit.add(material);
  new GroundGlowPlugin(material);
}
