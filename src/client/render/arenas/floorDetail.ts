/**
 * The fine surface of a stadium floor, laid over its painted colours as a
 * detail map (as softGrass lays grass): a tile of light and dark about the
 * neutral grey, tiling, in one of a few kinds —
 *  - sand: powder — fine soft grains, a rare bright one;
 *  - crust: a rocky crust — plates, each lit from one side as if raised,
 *    dark seams between, pitted;
 *  - frost: ice — faint cloud and fine skate scratches;
 *  - concrete: grit, bits of aggregate, pores, mottling, hairline cracks.
 */
import type { Scene } from '@babylonjs/core/scene';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { rng } from './stadiumKit.ts';

export type FloorKind = 'sand' | 'crust' | 'frost' | 'concrete';

/** Its tile (texels). */
const SIZE = 512;
/** Per kind: the ground one tile covers (m), how soft (blur, texels), how strongly it shows over the colour (0..1). */
const KINDS: Record<FloorKind, { tile: number; soft: number; strength: number }> = {
  sand: { tile: 0.9, soft: 0.5, strength: 0.9 },
  crust: { tile: 2.6, soft: 0.7, strength: 1 },
  frost: { tile: 3.2, soft: 0.9, strength: 0.6 },
  concrete: { tile: 1.8, soft: 0.6, strength: 0.9 },
};

/** Each texel's shade (128: as the colour is), for each kind. */
function shades(kind: FloorKind, seed: number): Float32Array {
  const v = new Float32Array(SIZE * SIZE).fill(128), rnd = rng(seed);
  const at = (x: number, y: number) => ((((y | 0) % SIZE) + SIZE) % SIZE) * SIZE + ((((x | 0) % SIZE) + SIZE) % SIZE);
  const dot = (x: number, y: number, r: number, dv: number) => {
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx, dy) / r;
      if (d < 1) v[at(x + dx, y + dy)] += dv * (1 - d * d);
    }
  };
  const line = (x: number, y: number, a: number, len: number, dv: number, wobble: number) => {
    for (let s = 0; s < len; s += 0.7) { a += (rnd() - 0.5) * wobble; x += Math.cos(a) * 0.7; y += Math.sin(a) * 0.7; v[at(x, y)] += dv; }
  };
  if (kind === 'sand') {
    // Powder: every texel its own grain, some in pairs, now and then a bright one.
    for (let i = 0; i < v.length; i++) v[i] += (rnd() - 0.5) * 30;
    for (let i = 0; i < 9000; i++) dot(rnd() * SIZE, rnd() * SIZE, 1 + rnd() * 1.2, (rnd() - 0.5) * 34);
    for (let i = 0; i < 500; i++) dot(rnd() * SIZE, rnd() * SIZE, 0.9, 60);
  } else if (kind === 'crust') {
    // Plates (a Voronoi of seeds, wrapped), each lit from the upper left as if raised, seams dark between, pits in them.
    const n = 46, sx: number[] = [], sy: number[] = [], base: number[] = [];
    for (let i = 0; i < n; i++) { sx.push(rnd() * SIZE); sy.push(rnd() * SIZE); base.push((rnd() - 0.5) * 26); }
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      let d1 = 1e9, d2 = 1e9, k = 0, ox = 0, oy = 0;
      for (let i = 0; i < n; i++) {
        let dx = x - sx[i], dy = y - sy[i];
        if (dx > SIZE / 2) dx -= SIZE; else if (dx < -SIZE / 2) dx += SIZE;
        if (dy > SIZE / 2) dy -= SIZE; else if (dy < -SIZE / 2) dy += SIZE;
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; k = i; ox = dx; oy = dy; } else if (d < d2) d2 = d;
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const lit = (-ox - oy) / (Math.sqrt(d1) + 8) * 22;
      v[y * SIZE + x] += base[k] + lit * Math.min(1, edge / 10) - (edge < 2.2 ? 70 * (1 - edge / 2.2) : 0);
    }
    for (let i = 0; i < 1600; i++) dot(rnd() * SIZE, rnd() * SIZE, 1 + rnd() * 2.2, -30 - rnd() * 25);
    for (let i = 0; i < v.length; i++) v[i] += (rnd() - 0.5) * 16;
  } else if (kind === 'frost') {
    // Cloud, faint; fine scratches, a little lighter.
    for (let i = 0; i < 40; i++) dot(rnd() * SIZE, rnd() * SIZE, 30 + rnd() * 60, (rnd() - 0.5) * 18);
    for (let i = 0; i < 90; i++) line(rnd() * SIZE, rnd() * SIZE, rnd() * Math.PI * 2, 40 + rnd() * 160, 9, 0.05);
    for (let i = 0; i < v.length; i++) v[i] += (rnd() - 0.5) * 6;
  } else {
    // Concrete: mottling, grit, aggregate, pores, a few hairline cracks.
    for (let i = 0; i < 30; i++) dot(rnd() * SIZE, rnd() * SIZE, 25 + rnd() * 60, (rnd() - 0.5) * 22);
    for (let i = 0; i < v.length; i++) v[i] += (rnd() - 0.5) * 22;
    for (let i = 0; i < 2600; i++) dot(rnd() * SIZE, rnd() * SIZE, 1 + rnd() * 2.4, (rnd() - 0.5) * 48);
    for (let i = 0; i < 900; i++) dot(rnd() * SIZE, rnd() * SIZE, 0.8 + rnd() * 0.9, -55);
    for (let i = 0; i < 7; i++) line(rnd() * SIZE, rnd() * SIZE, rnd() * Math.PI * 2, 60 + rnd() * 140, -40, 0.5);
  }
  return v;
}

/** Lay `kind` over `mat`, a floor `w` × `d` metres whose UVs run 0..1 across it. Returns the texture (for its owner to dispose). */
export function floorDetail(scene: Scene, mat: StandardMaterial, w: number, d: number, kind: FloorKind, seed = 1): DynamicTexture {
  const { tile, soft, strength } = KINDS[kind];
  const v = shades(kind, seed);
  // Softened (wrapped: the tile drawn round itself, so the blur leaves no seam).
  const raw = document.createElement('canvas');
  raw.width = raw.height = SIZE;
  const rg = raw.getContext('2d')!, img = rg.createImageData(SIZE, SIZE);
  for (let i = 0; i < v.length; i++) { const c = Math.max(0, Math.min(255, Math.round(v[i]))); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = c; img.data[i * 4 + 3] = 255; }
  rg.putImageData(img, 0, 0);
  const sc = document.createElement('canvas');
  sc.width = sc.height = SIZE;
  const sg = sc.getContext('2d')!;
  sg.filter = `blur(${soft}px)`;
  for (const ox of [-SIZE, 0, SIZE]) for (const oy of [-SIZE, 0, SIZE]) sg.drawImage(raw, ox, oy);
  // A detail map's channels: red its shade; green and alpha its normal (level), blue its roughness (as is).
  const out = sg.getImageData(0, 0, SIZE, SIZE), px = out.data;
  for (let i = 0; i < px.length; i += 4) { px[i + 1] = 128; px[i + 2] = 128; px[i + 3] = 128; }
  const tex = new DynamicTexture(`floor_${kind}`, { width: SIZE, height: SIZE }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
  (tex.getContext() as unknown as CanvasRenderingContext2D).putImageData(out, 0, 0);
  tex.update(true, false);
  tex.uScale = w / tile; tex.vScale = d / tile;
  mat.detailMap.texture = tex;
  mat.detailMap.isEnabled = true;
  mat.detailMap.diffuseBlendLevel = strength;
  mat.detailMap.bumpLevel = 0;
  return tex;
}
