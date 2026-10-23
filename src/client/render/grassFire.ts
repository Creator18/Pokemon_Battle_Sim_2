/**
 * Burning grass (a grass fire, Flamethrower over grass): the tile's own tufts
 * drawn as flame in the beams' torn noise (BeamFx's NOISE), in the colours of
 * the fire that lit it (its owner's Fire: blue for blue flames).
 * The blades stretch up to FLAME_STRETCH × and flicker; their noise races up
 * them, torn away more and more toward the tips; posterized from the dark
 * skin at the torn edges through the body to the hot core, as a beam is.
 * Unlit (it is the light). Two fires can share a tile (a tied beam clash):
 * a plane splits it, side A in one fire's colours, side B in the other's (or
 * no fire there). One material per distinct look, shared by its tiles.
 */
import type { Scene } from '@babylonjs/core/scene';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { Material } from '@babylonjs/core/Materials/material';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { RGB } from '../vfx/auraPalette.ts';
import { NOISE, coloursFor } from '../vfx/beam/BeamFx.ts';

/** How much taller the burning blades stand, and the tallest blade (grass.ts's BLADE_H top) the height reads against. */
const FLAME_STRETCH = 1.9, BLADE_TOP = 0.32;
/** The noise: its scale across and up (world), and how fast it races up (per second). */
const FLAME_SCALE: [number, number] = [7.0, 4.5], FLAME_RISE = 3.2;
/** Torn away from FLAME_CUT at the root to FLAME_CUT_TIP at the tip. */
const FLAME_CUT = 0.3, FLAME_CUT_TIP = 0.72;

Effect.ShadersStore.grassFireVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 world, viewProjection;
uniform float time;
varying vec3 vWorld;
varying float vH;
${NOISE}
void main(void) {
  float h = clamp(position.y / ${BLADE_TOP.toFixed(2)}, 0.0, 1.0);
  vec3 p = position;
  // Taller, flickering, and licking about at the tips.
  vec4 w0 = world * vec4(p, 1.0);
  float flick = vn(vec3(w0.xz * 3.0, time * 3.5));
  p.y *= 1.0 + (${FLAME_STRETCH.toFixed(2)} - 1.0) * (0.6 + 0.6 * flick);
  vec4 w = world * vec4(p, 1.0);
  w.xz += (vec2(vn(vec3(w0.xz * 2.0, time * 2.2)), vn(vec3(w0.zx * 2.0 + 7.0, time * 2.2))) - 0.5) * 0.12 * h * h;
  vWorld = w.xyz;
  vH = h;
  gl_Position = viewProjection * w;
}`;

Effect.ShadersStore.grassFireFragmentShader = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying float vH;
uniform float time;
uniform vec3 hotA, bodyA, skinA, hotB, bodyB, skinB;
uniform vec3 planeP, planeN;
uniform float onA, onB;
${NOISE}
void main(void) {
  vec3 q = vec3(vWorld.x * ${FLAME_SCALE[0].toFixed(2)}, vWorld.y * ${FLAME_SCALE[1].toFixed(2)} - time * ${FLAME_RISE.toFixed(2)}, vWorld.z * ${FLAME_SCALE[0].toFixed(2)});
  // Torn by a second noise, as the beams are.
  vec3 w = vec3(vn(q * 0.55 + vec3(5.3, 0.0, 0.0)), vn(q * 0.55 + vec3(1.7, 8.1, 0.0)), 0.0) - 0.5;
  q += vec3(w.x * 2.6, w.y * 1.3, 0.0);
  // Which fire burns here: side A or B of the split (no split: planeN is zero, all A).
  bool sideB = dot(vWorld - planeP, planeN) > 0.0;
  if ((sideB ? onB : onA) < 0.5) discard;
  vec3 hot = sideB ? hotB : hotA, body = sideB ? bodyB : bodyA, skin = sideB ? skinB : skinA;
  float n = fbm(q);
  float cutoff = mix(${FLAME_CUT.toFixed(2)}, ${FLAME_CUT_TIP.toFixed(2)}, vH);
  if (n < cutoff) discard;
  float t = clamp((n - cutoff) / max(1.0 - cutoff, 1e-3), 0.0, 1.0);
  // Posterized: the dark skin at the torn edges, then the body, the hot core.
  vec3 c = t < 0.18 ? skin : t < 0.55 ? body : hot;
  gl_FragColor = vec4(c, 1.0);
}`;

/**
 * A grass fire's look: fire `a` (an element: 'Fire', 'BlueFire'...), or two
 * fires split by a plane through `planeP` facing `planeN` - `a` behind it,
 * `b` in front; null = no fire on that side.
 */
export interface FireLook { a: string | null; b?: string | null; planeP?: Vector3; planeN?: Vector3 }

/** A look's identity (equal looks share a material). */
export function fireLookKey(look: FireLook): string {
  return `${look.a}|${look.b ?? '-'}|${look.planeP?.toString() ?? ''}|${look.planeN?.toString() ?? ''}`;
}

export function grassFireMaterial(scene: Scene, look: FireLook): ShaderMaterial {
  const mat = new ShaderMaterial(`grassFire_${fireLookKey(look)}`, scene, { vertex: 'grassFire', fragment: 'grassFire' }, {
    attributes: ['position'],
    uniforms: ['world', 'viewProjection', 'time', 'hotA', 'bodyA', 'skinA', 'hotB', 'bodyB', 'skinB', 'planeP', 'planeN', 'onA', 'onB'],
  });
  mat.backFaceCulling = false;
  const side = (s: 'A' | 'B', element: string | null | undefined) => {
    const col = coloursFor(element ?? 'Fire');
    mat.setColor3(`hot${s}`, new Color3(...col.hot));
    mat.setColor3(`body${s}`, new Color3(...col.main));
    mat.setColor3(`skin${s}`, new Color3(...col.dark));
    mat.setFloat(`on${s}`, element ? 1 : 0);
  };
  side('A', look.a);
  side('B', look.planeN ? look.b : look.a);
  mat.setVector3('planeP', look.planeP ?? Vector3.Zero());
  mat.setVector3('planeN', look.planeN ?? Vector3.Zero());
  const start = performance.now();
  mat.onBindObservable.add(() => mat.getEffect()?.setFloat('time', (performance.now() - start) / 1000));
  return mat;
}

// ── Flames that are part of a Pokémon (Charizard's tail, Emboar's collar) ──
//
// The same burning noise as the grass, on the model's own flame shape: a
// plugin on an ordinary unlit StandardMaterial (so the shape is skinned, and
// moves with its bone, exactly as the rest of the model), its colour replaced
// by the noise racing up the flame. The noise lives on the flame itself (its
// own, unposed shape: the model's space, Y up), so it sways with the flame
// rather than the flame sliding through it; sized to the Pokémon (its
// height, in the model's units), torn only a little at the edges so the
// flame's own shape still reads.

/** The noise across a body's flame, × its height: how many licks fit up it; and how fast they rise. */
const BODY_FLAME_SCALE = 18.0, BODY_FLAME_RISE = 0.5;
/** How torn it is (higher: more holes in the shape). */
const BODY_FLAME_CUT = 0.3;

class BodyFlame extends MaterialPluginBase {
  private readonly start = performance.now();
  constructor(material: Material, private readonly col: { hot: RGB; main: RGB; dark: RGB }, private readonly size: number) {
    super(material, 'BodyFlame', 210, { BODYFLAME: false });
    // Its clock goes up on every draw (hardBindForSubMesh), not only when the material rebinds.
    this.registerForExtraEvents = true;
    this._enable(true);
  }
  getClassName(): string { return 'BodyFlame'; }
  prepareDefines(defines: Record<string, unknown>): void { defines.BODYFLAME = true; }
  getUniforms() {
    return {
      ubo: [
        { name: 'bfTime', size: 1, type: 'float' }, { name: 'bfSize', size: 1, type: 'float' },
        { name: 'bfHot', size: 3, type: 'vec3' }, { name: 'bfBody', size: 3, type: 'vec3' }, { name: 'bfSkin', size: 3, type: 'vec3' },
      ],
      fragment: `#ifdef BODYFLAME
        uniform float bfTime; uniform float bfSize; uniform vec3 bfHot; uniform vec3 bfBody; uniform vec3 bfSkin;
      #endif`,
    };
  }
  private bindAll(ubo: UniformBuffer): void {
    ubo.updateFloat('bfTime', (performance.now() - this.start) / 1000);
    ubo.updateFloat('bfSize', this.size);
    ubo.updateFloat3('bfHot', ...this.col.hot);
    ubo.updateFloat3('bfBody', ...this.col.main);
    ubo.updateFloat3('bfSkin', ...this.col.dark);
  }
  bindForSubMesh(ubo: UniformBuffer): void { this.bindAll(ubo); }
  hardBindForSubMesh(ubo: UniformBuffer): void { this.bindAll(ubo); }
  getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `#ifdef BODYFLAME
          varying vec3 bfLocal;
        #endif`,
        // The flame's own point (before skinning): the noise rides with it.
        CUSTOM_VERTEX_MAIN_END: `#ifdef BODYFLAME
          bfLocal = positionUpdated;
        #endif`,
      };
    }
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef BODYFLAME
        varying vec3 bfLocal;
        ${NOISE}
      #endif`,
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `#ifdef BODYFLAME
        {
          vec3 q = bfLocal / max(bfSize, 1e-3) * ${BODY_FLAME_SCALE.toFixed(2)};
          q.y -= bfTime * ${(BODY_FLAME_RISE * BODY_FLAME_SCALE).toFixed(2)};
          // Torn by a second noise, as the beams and the grass fires are.
          vec3 w = vec3(vn(q * 0.55 + vec3(5.3, 0.0, 0.0)), vn(q * 0.55 + vec3(1.7, 8.1, 0.0)), 0.0) - 0.5;
          q += vec3(w.x * 2.6, w.y * 1.3, 0.0);
          float n = fbm(q);
          if (n < ${BODY_FLAME_CUT.toFixed(2)}) discard;
          float t = clamp((n - ${BODY_FLAME_CUT.toFixed(2)}) / ${(1 - BODY_FLAME_CUT).toFixed(2)}, 0.0, 1.0);
          // Posterized: the dark skin at the torn edges, then the body, the hot core.
          // (Its opacity as the mesh has it: an afterimage's flame fades with it.)
          color = vec4(t < 0.16 ? bfSkin : t < 0.5 ? bfBody : bfHot, color.a);
        }
      #endif`,
    };
  }
}

/** A Pokémon's own flame, burning in `element`'s fire colours (blue for blue flames), sized to its height (in the model's units). */
export function bodyFlameMaterial(scene: Scene, element: string, size: number): StandardMaterial {
  const mat = new StandardMaterial(`bodyFlame_${element}`, scene);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  new BodyFlame(mat, coloursFor(element), size);
  return mat;
}
