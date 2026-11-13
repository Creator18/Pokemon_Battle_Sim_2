/**
 * Shadows for a long side-on level: the sun's shadow box (its orthographic window) a fixed size round where the camera
 * looks, the sun moved along with it — so the shadow map's texels are spent on what's in view (sharp, dark enough to
 * see) wherever along the level you are, not spread thin over all of it. Put back as it was when done.
 */
import type { Scene } from '@babylonjs/core/scene';
import type { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

/** The window's half-width and half-height round the camera's target (world units); how far back the sun sits. */
const HALF = 26, BACK = 60;

export function followShadows(scene: Scene, at: () => Vector3): () => void {
  const gen = (scene.metadata as { shadowGen?: ShadowGenerator } | undefined)?.shadowGen;
  const light = gen?.getLight() as DirectionalLight | undefined;
  if (!gen || !light || light.getClassName() !== 'DirectionalLight') return () => {};
  const was = {
    esm: gen.useBlurExponentialShadowMap, pcf: gen.usePercentageCloserFiltering, quality: gen.filteringQuality, bias: gen.bias, dark: gen.darkness,
    pos: light.position.clone(), auto: light.autoUpdateExtends, autoZ: light.autoCalcShadowZBounds,
    ortho: [light.orthoLeft, light.orthoRight, light.orthoTop, light.orthoBottom], minZ: light.shadowMinZ, maxZ: light.shadowMaxZ,
  };
  light.autoUpdateExtends = false; light.autoCalcShadowZBounds = false;
  light.orthoLeft = -HALF; light.orthoRight = HALF; light.orthoTop = HALF; light.orthoBottom = -HALF;
  light.shadowMinZ = 1; light.shadowMaxZ = BACK * 2.2;
  // (Filtered by PCF — crisp contact shadows, soft-edged: the blurred exponential map loses its precision over a sun
  // this far back, and its shadows wash out.)
  gen.useBlurExponentialShadowMap = false; gen.usePercentageCloserFiltering = true;
  gen.filteringQuality = 1; gen.bias = 0.0015; gen.darkness = 0.18;
  const dir = light.direction.clone().normalize();
  const obs = scene.onBeforeRenderObservable.add(() => {
    // (The sun BACK along its own direction from where the camera looks: the window centred there.)
    light.position.copyFrom(at().subtract(dir.scale(BACK)));
  });
  return () => {
    scene.onBeforeRenderObservable.remove(obs);
    light.position.copyFrom(was.pos); light.autoUpdateExtends = was.auto; light.autoCalcShadowZBounds = was.autoZ;
    [light.orthoLeft, light.orthoRight, light.orthoTop, light.orthoBottom] = was.ortho;
    light.shadowMinZ = was.minZ; light.shadowMaxZ = was.maxZ;
    gen.usePercentageCloserFiltering = was.pcf; gen.useBlurExponentialShadowMap = was.esm;
    gen.filteringQuality = was.quality; gen.bias = was.bias; gen.darkness = was.dark;
  };
}
