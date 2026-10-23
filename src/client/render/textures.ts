/** Procedural textures shared across board / vfx (no external assets). */

import { Scene } from '@babylonjs/core/scene';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';

let flare: Texture | null = null;

/** Soft radial white flare, cached per session. */
export function flareTexture(scene: Scene): Texture {
  // (Rebuilt if something disposed it: a particle system disposes its texture unless told not to.)
  if (flare && flare.getInternalTexture()) return flare;
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

let smoke: Texture | null = null;

/** A soft, lumpy puff of smoke (a few overlapping blurs, white: tinted by the particles), cached per session. */
export function smokeTexture(scene: Scene): Texture {
  if (smoke && smoke.getInternalTexture()) return smoke;
  const size = 64;
  const dt = new DynamicTexture('smokePuff', size, scene, false);
  const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  const blobs: [number, number, number, number][] = [[32, 34, 22, 1], [22, 28, 14, 0.8], [42, 26, 13, 0.8], [30, 42, 12, 0.7], [40, 40, 11, 0.65]];
  for (const [x, y, r, a] of blobs) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  dt.hasAlpha = true;
  dt.update();
  smoke = dt;
  return smoke;
}
