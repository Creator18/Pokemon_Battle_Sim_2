/**
 * Orbit battle camera + scene lighting rig.
 *
 * ArcRotateCamera looking down at the board center at ~57° elevation.
 * Q/E rotate, wheel zoom (clamped), right-drag orbit. focusOn smooth-lerps
 * the target to a given tile. Sets up a warm directional key light (shadow
 * caster) + hemispheric fill, and an optional bloom pipeline.
 */

import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { Engine } from '@babylonjs/core/Engines/engine';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/core/Rendering/depthRendererSceneComponent';

import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';

import { axialToWorld } from '../hexWorld.ts';
import { ENV, hexToRgb } from '../theme.ts';

function c3(hex: string): Color3 {
  const [r, g, b] = hexToRgb(hex);
  return new Color3(r, g, b);
}

const ELEVATION = Math.PI / 2 - (57 * Math.PI) / 180; // beta from 57° above horizon
const MIN_RADIUS = 12;
const MAX_RADIUS = 34;
const DEFAULT_RADIUS = 25;
const ROTATE_STEP = Math.PI / 12;

export class BattleCamera {
  readonly camera: ArcRotateCamera;
  readonly keyLight: DirectionalLight;
  readonly fill: HemisphericLight;
  readonly shadows: ShadowGenerator;
  private targetLerp: { from: Vector3; to: Vector3; t: number } | null = null;

  constructor(scene: Scene, engine: Engine, canvas: HTMLCanvasElement) {
    this.camera = new ArcRotateCamera(
      'battleCam',
      -Math.PI / 2,
      ELEVATION,
      DEFAULT_RADIUS,
      Vector3.Zero(),
      scene,
    );
    this.camera.lowerRadiusLimit = MIN_RADIUS;
    this.camera.upperRadiusLimit = MAX_RADIUS;
    this.camera.lowerBetaLimit = 0.15;
    this.camera.upperBetaLimit = Math.PI / 2 - 0.12;
    this.camera.wheelDeltaPercentage = 0.02;
    this.camera.panningSensibility = 0; // disable panning; keep board centered
    this.camera.attachControl(canvas, true);
    // Use only right mouse button for orbit so left-click is free for tile picking.
    this.camera.inputs.attached.pointers &&
      ((this.camera.inputs.attached.pointers as unknown as { buttons: number[] }).buttons = [2]);

    // Warm golden-hour key light from a low-ish angle (casts soft shadows).
    this.keyLight = new DirectionalLight('key', new Vector3(-0.55, -0.85, -0.5), scene);
    this.keyLight.position = new Vector3(16, 20, 14);
    this.keyLight.intensity = 1.5;
    this.keyLight.diffuse = c3(ENV.keyLight);
    this.keyLight.specular = c3(ENV.keySpec);

    // Warm hemispheric fill: cream sky, mossy-green ground bounce.
    this.fill = new HemisphericLight('fill', new Vector3(0.2, 1, 0.1), scene);
    this.fill.intensity = 0.7;
    this.fill.diffuse = c3(ENV.skyFill);
    this.fill.groundColor = c3(ENV.groundFill);

    this.shadows = new ShadowGenerator(2048, this.keyLight);
    this.shadows.useBlurExponentialShadowMap = true;
    this.shadows.blurKernel = 48;
    this.shadows.darkness = 0.32; // soft, not murky
    this.keyLight.shadowMinZ = 1;
    this.keyLight.shadowMaxZ = 80;

    const pipeline = new DefaultRenderingPipeline('default', true, scene, [this.camera]);
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.8;
    pipeline.bloomWeight = 0.35;
    pipeline.bloomKernel = 48;
    pipeline.fxaaEnabled = true;
    // Mild ACES tone mapping + warm, bright, inviting grade.
    pipeline.imageProcessing.toneMappingEnabled = true;
    pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    pipeline.imageProcessing.contrast = 1.1;
    pipeline.imageProcessing.exposure = 1.25;
    // Soft vignette.
    pipeline.imageProcessing.vignetteEnabled = true;
    pipeline.imageProcessing.vignetteWeight = 2.2;
    pipeline.imageProcessing.vignetteColor = new Color4(0.05, 0.03, 0.0, 0);
    pipeline.imageProcessing.vignetteCameraFov = 0.7;

    scene.onBeforeRenderObservable.add(() => this.tick(scene));
  }

  private tick(scene: Scene): void {
    if (this.targetLerp) {
      const dt = Math.min(1, scene.getEngine().getDeltaTime() / 1000);
      this.targetLerp.t = Math.min(1, this.targetLerp.t + dt * 4);
      const e = easeOutCubic(this.targetLerp.t);
      this.camera.target = Vector3.Lerp(this.targetLerp.from, this.targetLerp.to, e);
      if (this.targetLerp.t >= 1) this.targetLerp = null;
    }
  }

  rotate(dir: -1 | 1): void {
    this.camera.alpha += dir * ROTATE_STEP;
  }

  /** Smoothly move the orbit target to a tile. */
  focusOn(tile: [number, number]): void {
    const to = axialToWorld(tile[0], tile[1], 0);
    this.targetLerp = { from: this.camera.target.clone(), to, t: 0 };
  }

  /** Register Q/E keyboard rotation. Returns a cleanup function. */
  bindKeys(): () => void {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'q' || e.key === 'Q') this.rotate(-1);
      else if (e.key === 'e' || e.key === 'E') this.rotate(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
