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
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { Engine } from '@babylonjs/core/Engines/engine';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/core/Rendering/depthRendererSceneComponent';

import { axialToWorld } from '../hexWorld.ts';

const ELEVATION = Math.PI / 2 - (57 * Math.PI) / 180; // beta from 57° above horizon
const MIN_RADIUS = 8;
const MAX_RADIUS = 26;
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
      16,
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

    // Warm key light (casts shadows).
    this.keyLight = new DirectionalLight('key', new Vector3(-0.6, -1.1, -0.4), scene);
    this.keyLight.position = new Vector3(12, 22, 10);
    this.keyLight.intensity = 1.35;
    this.keyLight.diffuse = new Color3(1.0, 0.95, 0.85);
    this.keyLight.specular = new Color3(1.0, 0.9, 0.75);

    // Cool hemispheric fill.
    this.fill = new HemisphericLight('fill', new Vector3(0, 1, 0), scene);
    this.fill.intensity = 0.55;
    this.fill.diffuse = new Color3(0.7, 0.75, 0.95);
    this.fill.groundColor = new Color3(0.15, 0.15, 0.28);

    this.shadows = new ShadowGenerator(2048, this.keyLight);
    this.shadows.useBlurExponentialShadowMap = true;
    this.shadows.blurKernel = 32;
    this.shadows.darkness = 0.55;

    const pipeline = new DefaultRenderingPipeline('default', true, scene, [this.camera]);
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.75;
    pipeline.bloomWeight = 0.45;
    pipeline.bloomKernel = 48;
    pipeline.fxaaEnabled = true;
    pipeline.imageProcessing.contrast = 1.15;
    pipeline.imageProcessing.exposure = 1.05;

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
