/**
 * A soft grass texture for a flat lawn, laid over its own colour (a pitch's
 * stripes, a meadow's green) as a detail map: many short, soft blades a
 * little lighter and a little darker than it, blurred together, tiling — so
 * up close it reads as grass and from afar keeps the colour it was given.
 */
import type { Scene } from '@babylonjs/core/scene';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';

/** Its tile (texels), how many metres one tile covers. */
const SIZE = 512, TILE_M = 1.6;
/** Its blades: how many, their length and width (texels), how far lighter or darker (of 255), how solid. */
const BLADES = 4200, LEN: [number, number] = [5, 16], WIDTH: [number, number] = [1.2, 2.6], SHADE = 46, ALPHA = 0.32;
/** How soft (blur, texels), and how strongly it shows over the colour (0..1). */
const SOFT = 1.1, STRENGTH = 0.75;

/** The texture (its own: each lawn tiles it at its own size). */
function softGrassTexture(scene: Scene, seed: number): DynamicTexture {
  const tex = new DynamicTexture('softGrass', { width: SIZE, height: SIZE }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
  const raw = document.createElement('canvas');
  raw.width = raw.height = SIZE;
  const g = raw.getContext('2d')!;
  // Neutral grey (a detail map's "no change"), then the blades, each drawn wrapped so the tile repeats seamlessly.
  g.fillStyle = 'rgb(128,128,128)'; g.fillRect(0, 0, SIZE, SIZE);
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  g.lineCap = 'round';
  for (let i = 0; i < BLADES; i++) {
    const x = rnd() * SIZE, y = rnd() * SIZE, a = rnd() * Math.PI * 2;
    const len = LEN[0] + rnd() * (LEN[1] - LEN[0]), v = Math.round(128 + (rnd() * 2 - 1) * SHADE);
    const bend = (rnd() - 0.5) * len * 0.6;
    g.strokeStyle = `rgba(${v},${v},${v},${ALPHA})`;
    g.lineWidth = WIDTH[0] + rnd() * (WIDTH[1] - WIDTH[0]);
    const dx = Math.cos(a) * len, dy = Math.sin(a) * len, cx = -Math.sin(a) * bend, cy = Math.cos(a) * bend;
    for (const ox of [-SIZE, 0, SIZE]) for (const oy of [-SIZE, 0, SIZE]) {
      const x0 = x + ox, y0 = y + oy;
      if (x0 + len < 0 || x0 - len > SIZE || y0 + len < 0 || y0 - len > SIZE) continue;
      g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(x0 + dx / 2 + cx, y0 + dy / 2 + cy, x0 + dx, y0 + dy); g.stroke();
    }
  }
  // Softened: blurred, wrapped (the tile drawn round itself) so the blur leaves no seam.
  const soft = document.createElement('canvas');
  soft.width = soft.height = SIZE;
  const sg = soft.getContext('2d')!;
  sg.filter = `blur(${SOFT}px)`;
  for (const ox of [-SIZE, 0, SIZE]) for (const oy of [-SIZE, 0, SIZE]) sg.drawImage(raw, ox, oy);
  // A detail map's channels: red its shade; green and alpha its normal (level: 0.5 each), blue its roughness (as is: 0.5).
  const img = sg.getImageData(0, 0, SIZE, SIZE), px = img.data;
  for (let i = 0; i < px.length; i += 4) { px[i + 1] = 128; px[i + 2] = 128; px[i + 3] = 128; }
  const out = tex.getContext() as unknown as CanvasRenderingContext2D;
  out.putImageData(img, 0, 0);
  tex.update(true, false);
  return tex;
}

/**
 * Lay soft grass over `mat`, a lawn `w` × `d` metres whose UVs run 0..1 across
 * it. Returns the texture (for its owner to dispose).
 */
export function softGrass(scene: Scene, mat: StandardMaterial, w: number, d: number, seed = 1): DynamicTexture {
  const tex = softGrassTexture(scene, seed);
  tex.uScale = w / TILE_M; tex.vScale = d / TILE_M;
  mat.detailMap.texture = tex;
  mat.detailMap.isEnabled = true;
  mat.detailMap.diffuseBlendLevel = STRENGTH;
  mat.detailMap.bumpLevel = 0;
  return tex;
}
