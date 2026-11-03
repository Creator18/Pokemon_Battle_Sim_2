/**
 * Short upright grass over a lawn, like fur: SHELLS copies of the lawn
 * stacked a little apart up to GRASS_H, each showing only the blades that
 * reach it (a blade map, alpha-tested at its height) — so the blades thin to
 * their tips as they rise. Each shell wears the lawn's own colours (its
 * stripes, its lines), darker at the roots, nearly its own at the tips; the
 * upper shells drift a little with the wind.
 */
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Material } from '@babylonjs/core/Materials/material';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';

/** How tall (m), in how many shells; how dark at its roots and how light at its tips (× the lawn's colour). */
const GRASS_H = 0.07, SHELLS = 14, ROOT = 0.62, TIP = 0.97;
/** Its blade map (texels) and the ground one tile covers (m); its blades: one to a cell this size (texels), their radius (texels), their heights (0..1). */
const SIZE = 512, TILE_M = 1.1, CELL = 5, RADIUS: [number, number] = [1.4, 2.6], HEIGHT: [number, number] = [0.35, 1];
/** The wind: how far its tips drift (m), how fast it sways (rad/s). */
const SWAY = 0.006, SWAY_RATE = 1.3;

/** Each texel's value: how high the blade standing there reaches (tapered: its middle tallest), 0 between blades. */
function bladeMap(scene: Scene, seed: number, clump: number): DynamicTexture {
  // (No mipmaps: averaged down, its blades would fall under every shell's cut and the fur vanish a few metres off.)
  const tex = new DynamicTexture('grassBlades', { width: SIZE, height: SIZE }, scene, false, Texture.BILINEAR_SAMPLINGMODE);
  tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
  const v = new Float32Array(SIZE * SIZE);
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  // Clumps: a slow swell across the tile (whole waves, so it tiles), taller here, shorter there.
  const T = (2 * Math.PI) / SIZE, ph = [rnd() * 6.3, rnd() * 6.3, rnd() * 6.3];
  const swell = (x: number, y: number) => 0.5 + 0.2 * Math.sin(2 * T * x + ph[0]) * Math.cos(3 * T * y + ph[1]) + 0.3 * Math.sin(T * (x + 2 * y) + ph[2]);
  for (let cy = 0; cy < SIZE; cy += CELL) for (let cx = 0; cx < SIZE; cx += CELL) {
    const x = cx + rnd() * CELL, y = cy + rnd() * CELL;
    const r = RADIUS[0] + rnd() * (RADIUS[1] - RADIUS[0]);
    const h = (HEIGHT[0] + rnd() * (HEIGHT[1] - HEIGHT[0])) * (1 - clump * (1 - Math.max(0, Math.min(1, swell(x, y)))));
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx + (x % 1) - 0.5, dy + (y % 1) - 0.5) / r;
      if (d >= 1) continue;
      // Wrapped, so the tile repeats seamlessly.
      const px = (((Math.floor(x) + dx) % SIZE) + SIZE) % SIZE, py = (((Math.floor(y) + dy) % SIZE) + SIZE) % SIZE;
      const i = py * SIZE + px, val = h * (1 - d * d);
      if (val > v[i]) v[i] = val;
    }
  }
  const g = tex.getContext() as unknown as CanvasRenderingContext2D;
  const img = g.createImageData(SIZE, SIZE);
  for (let i = 0; i < v.length; i++) { const c = Math.round(v[i] * 255); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = c; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  tex.update(true, false);
  tex.getAlphaFromRGB = true;
  return tex;
}

export interface GrassFur { dispose(): void }

/**
 * Grow fur grass on `lawn` (a ground `w` × `d` metres in the world, its UVs
 * 0..1 across it), wearing `mat`'s colours. `scale`: how much its parent
 * grows it (shell heights are given in the world). `opts`: how tall it
 * grows (m), how uneven (0: even; 1: its clumps from nothing to full), and
 * the ground one tile of it covers (m).
 */
export function grassFur(scene: Scene, lawn: Mesh, mat: StandardMaterial, w: number, d: number, scale = 1, seed = 5,
  opts: { height?: number; clump?: number; tile?: number } = {}): GrassFur {
  const height = opts.height ?? GRASS_H, tile = opts.tile ?? TILE_M;
  const blades = bladeMap(scene, seed, opts.clump ?? 0);
  blades.uScale = w / tile; blades.vScale = d / tile;
  const owned: { dispose(): void }[] = [blades];
  const shells: { mesh: Mesh; lift: number }[] = [];
  for (let i = 1; i <= SHELLS; i++) {
    const t = i / SHELLS;
    const m = new StandardMaterial(`${lawn.name}_fur${i}`, scene);
    m.diffuseTexture = mat.diffuseTexture;
    const k = ROOT + (TIP - ROOT) * Math.sqrt(t);
    m.diffuseColor = mat.diffuseColor.scale(k);
    m.specularColor = Color3.Black();
    m.opacityTexture = blades;
    m.transparencyMode = Material.MATERIAL_ALPHATEST;
    // (Just over its height: only blades that reach this shell show on it.)
    m.alphaCutOff = t * 0.98;
    m.backFaceCulling = false;
    const shell = lawn.clone(`${lawn.name}_furShell${i}`, lawn.parent, true) as Mesh;
    shell.material = m;
    shell.position.y = lawn.position.y + (height * t) / scale;
    shell.isPickable = false;
    shell.receiveShadows = true;
    shells.push({ mesh: shell, lift: t });
    owned.push(m, shell);
  }
  // The wind: the higher a shell, the further it drifts.
  let time = 0;
  const x0 = lawn.position.x, z0 = lawn.position.z;
  const tick: Observer<Scene> = scene.onBeforeRenderObservable.add(() => {
    time += Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
    const sx = Math.sin(time * SWAY_RATE), sz = Math.sin(time * SWAY_RATE * 0.71 + 1.3) * 0.6;
    for (const { mesh, lift } of shells) {
      const k = (SWAY * lift * lift) / scale;
      mesh.position.x = x0 + sx * k; mesh.position.z = z0 + sz * k;
    }
  });
  return {
    dispose: () => {
      scene.onBeforeRenderObservable.remove(tick);
      for (const o of owned.reverse()) o.dispose();
    },
  };
}
