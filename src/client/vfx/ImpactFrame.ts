/**
 * The impact frame (after Ascii City's `impact.rs`, a four-pass Shadertoy
 * chain with Inigo Quilez's value noise, MIT): for a moment the whole picture
 * turns into a hard two-tone stencil — white shards on black — the shards
 * radial streaks converging on the point of the hit, as a manga impact panel.
 * It fades in from the picture, holds, and fades back out. Bare ground never
 * turns white.
 *
 *   A  tone = (r + g + b) / 3 + vnoise(cell) / DITHER      (a dither: a stipple whose density is its brightness)
 *   B  cut  = step(CUT_SCENE, A), bare ground → 0
 *   C  the mean of TAPS taps of B at focus + (uv − focus) · s, s = ZOOM_FROM … ZOOM_FROM + ZOOM_BY   (an inward zoom)
 *   D  lit  = step(CUT_BLUR, C) and not bare
 *   out = c + ((lit ? 240 : 0) / 255 − c) · power(age)
 *
 * Its cells: the noise's lattice is one step per cell, the original's frame
 * CELLS cells across. Bare ground here: whatever lies at the board's grass
 * height or below (from the depth map) — there are no cell kinds to read.
 */
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { Vector3, Matrix, Vector2 } from '@babylonjs/core/Maths/math.vector';
import { Effect } from '@babylonjs/core/Materials/effect';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
import { PassPostProcess } from '@babylonjs/core/PostProcesses/passPostProcess';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { DepthRenderer } from '@babylonjs/core/Rendering/depthRenderer';
import '@babylonjs/core/Rendering/depthRendererSceneComponent';

/** Its life (s): the four-point burst's, as the original's. */
export const IMPACT_LIFE = 0.85;
/** Threshold softness, the scene's and the blur's thresholds, the zoom's taps and range, the noise's divisor. */
const SOFT = 0.0001, CUT_SCENE = 0.3, CUT_BLUR = 0.4, TAPS = 20, ZOOM_FROM = 1.0, ZOOM_BY = 0.1, DITHER = 5.0;
/** The original's frame width in cells (its dot-fine grid): one noise lattice step per cell. */
const CELLS = 512;
/** Its white (of 255). */
const WHITE = 240;
/** Bare ground: up to this far above the board's top (world): its grass. */
const BARE_ABOVE = 0.32;

/**
 * Its envelope, the burst's own: rising to full by 0.15 s, held to 0.30 s,
 * then falling — 0.76 at 0.46 s, 0.1 at 0.52 s, gone by 0.59 s (the shape
 * derived from the original's `power(age)`; its rise/slow/fall remap is not
 * written out in full, so this follows the derived points).
 */
const ENVELOPE: [number, number][] = [[0, 0.17], [0.15, 1], [0.30, 1], [0.46, 0.76], [0.52, 0.1], [0.59, 0], [IMPACT_LIFE, 0]];
export function impactPower(age: number): number {
  if (age < 0 || age >= IMPACT_LIFE) return 0;
  for (let i = 1; i < ENVELOPE.length; i++) {
    const [t1, v1] = ENVELOPE[i], [t0, v0] = ENVELOPE[i - 1];
    if (age <= t1) {
      const u = (age - t0) / (t1 - t0);
      return v0 + (v1 - v0) * u * u * (3 - 2 * u);
    }
  }
  return 0;
}

// (Bare ground: the world height at a pixel, from the depth map's linear depth.)
const BARE = /* glsl */ `
uniform sampler2D depthSampler;
uniform mat4 invViewProj;
uniform vec3 camPos;
uniform vec2 clipRange;
uniform float bareY;
float bareAt(vec2 uv) {
  // (The depth map holds camera-space Z: how far along the view.)
  float z = texture2D(depthSampler, uv).r;
  if (z <= clipRange.x || z >= clipRange.y * 0.99) return 0.0;
  vec4 far = invViewProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(far.xyz / far.w - camPos);
  vec3 fwd = normalize((invViewProj * vec4(0.0, 0.0, 1.0, 1.0)).xyz / (invViewProj * vec4(0.0, 0.0, 1.0, 1.0)).w - camPos);
  vec3 p = camPos + dir * (z / max(dot(dir, fwd), 1e-3));
  return p.y <= bareY ? 1.0 : 0.0;
}`;

Effect.ShadersStore.impactCutFragmentShader = /* glsl */ `
precision highp float;
precision highp int;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 screenSize;
${BARE}
// Inigo Quilez's integer hash (32-bit wrapping) and value noise.
float ihash(int px, int py) {
  uint n = uint(px) * 3u + uint(py) * 113u;
  n = (n << 13u) ^ n;
  n = n * (n * n * 15731u + 789221u) + 1376312589u;
  return -1.0 + 2.0 * float(n & 0x0fffffffu) / float(0x0fffffff);
}
float vnoise(vec2 x) {
  vec2 i = floor(x), f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  int ix = int(i.x), iy = int(i.y);
  float a = ihash(ix, iy), b = ihash(ix + 1, iy), c = ihash(ix, iy + 1), d = ihash(ix + 1, iy + 1);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float stencil(float l, float at) { return smoothstep(at - ${(SOFT / 2).toFixed(6)}, at + ${(SOFT / 2).toFixed(6)}, l); }
void main(void) {
  vec3 c = texture2D(textureSampler, vUV).rgb;
  float tone = (c.r + c.g + c.b) / 3.0;
  // (One lattice step per cell, CELLS cells across.)
  vec2 cell = vUV * screenSize * (${CELLS.toFixed(1)} / screenSize.x) + 0.5;
  float cut = stencil(tone + vnoise(cell) / ${DITHER.toFixed(1)}, ${CUT_SCENE.toFixed(2)}) > 0.5 ? 1.0 : 0.0;
  if (bareAt(vUV) > 0.5) cut = 0.0;
  gl_FragColor = vec4(vec3(cut), 1.0);
}`;

Effect.ShadersStore.impactApplyFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler; // the cut (B)
uniform sampler2D sceneSampler;   // the picture
uniform vec2 focus;
uniform float power;
${BARE}
float stencil(float l, float at) { return smoothstep(at - ${(SOFT / 2).toFixed(6)}, at + ${(SOFT / 2).toFixed(6)}, l); }
void main(void) {
  // (An inward zoom: each tap gathers from further out than it sits, so the streaks converge on the focus.)
  float sum = 0.0;
  for (int k = 0; k < ${TAPS}; k++) {
    float s = ${ZOOM_FROM.toFixed(2)} + float(k) * ${(ZOOM_BY / (TAPS - 1)).toFixed(6)};
    sum += texture2D(textureSampler, clamp(focus + (vUV - focus) * s, 0.0, 1.0)).r;
  }
  float lit = stencil(sum / ${TAPS.toFixed(1)}, ${CUT_BLUR.toFixed(2)}) > 0.5 && bareAt(vUV) < 0.5 ? 1.0 : 0.0;
  vec3 c = texture2D(sceneSampler, vUV).rgb;
  gl_FragColor = vec4(c + (vec3(lit * ${(WHITE / 255).toFixed(4)}) - c) * power, 1.0);
}`;

export class ImpactFrame {
  private passes: PostProcess[] | null = null;
  private depth: DepthRenderer | null = null;
  private born = -1;
  private focus = new Vector2(0.5, 0.5);
  private readonly inv = new Matrix();

  private boardY = 0;

  constructor(private readonly scene: Scene, private readonly camera: Camera) {}

  /**
   * A blow landing at `at` (world): the frame fires, centred there, for
   * IMPACT_LIFE s. `boardY`: the board's top there (world) — bare ground up to
   * its grass above that.
   */
  fire(at: Vector3, boardY: number): void {
    this.boardY = boardY;
    const eng = this.scene.getEngine();
    const w = eng.getRenderWidth(), h = eng.getRenderHeight();
    const p = Vector3.Project(at, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(w, h));
    // (Its screen point in uv, bottom up.)
    this.focus.set(Math.min(1, Math.max(0, p.x / w)), Math.min(1, Math.max(0, 1 - p.y / h)));
    this.born = performance.now();
    if (!this.passes) this.attach();
  }

  private attach(): void {
    const scene = this.scene, cam = this.camera;
    // (Camera-space Z, in full float: the ground test rebuilds world positions from it.)
    this.depth = scene.enableDepthRenderer(cam, false, true, undefined, true);
    const depthMap = this.depth.getDepthMap();
    const bare = (e: Effect) => {
      e.setTexture('depthSampler', depthMap);
      cam.getViewMatrix().multiplyToRef(cam.getProjectionMatrix(), this.inv);
      this.inv.invert();
      e.setMatrix('invViewProj', this.inv);
      e.setVector3('camPos', cam.globalPosition);
      e.setFloat2('clipRange', cam.minZ, cam.maxZ);
      e.setFloat('bareY', this.boardY + BARE_ABOVE);
    };
    const bareUniforms = ['invViewProj', 'camPos', 'clipRange', 'bareY'];
    const keep = new PassPostProcess('impactScene', 1.0, cam);
    const cut = new PostProcess('impactCut', 'impactCut', ['screenSize', ...bareUniforms], ['depthSampler'], 1.0, cam, Texture.BILINEAR_SAMPLINGMODE);
    cut.onApply = (e) => { e.setFloat2('screenSize', cut.width, cut.height); bare(e); };
    const apply = new PostProcess('impactApply', 'impactApply', ['focus', 'power', ...bareUniforms], ['sceneSampler', 'depthSampler'], 1.0, cam);
    apply.onApply = (e) => {
      e.setTextureFromPostProcessOutput('sceneSampler', keep);
      e.setFloat2('focus', this.focus.x, this.focus.y);
      e.setFloat('power', impactPower((performance.now() - this.born) / 1000));
      bare(e);
    };
    this.passes = [keep, cut, apply];
    // Gone once its life is over.
    const obs = scene.onAfterRenderObservable.add(() => {
      if ((performance.now() - this.born) / 1000 < IMPACT_LIFE) return;
      scene.onAfterRenderObservable.remove(obs);
      this.detach();
    });
  }

  private detach(): void {
    for (const pp of this.passes ?? []) { this.camera.detachPostProcess(pp); pp.dispose(this.camera); }
    this.passes = null;
    this.scene.disableDepthRenderer(this.camera);
    this.depth = null;
  }
}
