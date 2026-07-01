/** Procedural textures shared across board / vfx (no external assets). */

import { Scene } from '@babylonjs/core/scene';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';

let flare: Texture | null = null;

/** Soft radial white flare, cached per session. */
export function flareTexture(scene: Scene): Texture {
  if (flare) return flare;
  const size = 64;
  const dt = new DynamicTexture('flare', size, scene, false);
  const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  dt.hasAlpha = true;
  dt.update();
  flare = dt;
  return flare;
}
