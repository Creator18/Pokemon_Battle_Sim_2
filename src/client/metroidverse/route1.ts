/**
 * Route 1, side-on: north from Pallet Town (left) to Viridian City (right), as FireRed lays it — a grassy country path
 * climbing gently north over a few rises (a stone step or two up each, within a Pokéball's hop), patches of tall grass
 * where the wild Pokémon live, trees along it, a sign at each end; Viridian City's gate at its far end (closed for now).
 *
 * Its grass the stadium's: fur over a soft lawn — short along the path, tall (TALL) in its patches, as tall as a Pokémon.
 * Its collision (`level`, every platform hidden), its scenery (`root`, under `parent`), its grass patches (`grass`: where
 * the wild ones roam).
 */
import type { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Platform } from '../platformer/Fighter.ts';
import { grassFur } from '../render/arenas/grassFur.ts';
import { softGrass } from '../render/arenas/softGrass.ts';
import { bevelBox } from '../render/lowPolyKit.ts';
import { tallGrassPatch } from '../render/tallGrass.ts';
import { lowPolyTree, treeMaterial } from '../render/lowPolyTrees.ts';
import type { TreeKind } from '../render/lowPolyTrees.ts';

/** The trees' size (× a tree's own): Pallet Town's. */
const TREE_SCALE = 1.5;
/** Its tall grass: how tall (taller than a Pokéball, about a small Pokémon's height). */
export const ROUTE_GRASS = 0.78;
/** Its rises: each stretch's span and ground (x from its start; y its top); the tall-grass patches on each. */
const STRETCHES = [
  { x0: 0, x1: 13, y: 0, grass: [[0.5, 12.5]] },
  { x0: 13, x1: 36, y: 0.6, grass: [[21, 35]] },
  { x0: 36, x1: 62, y: 1.6, grass: [[46, 61]] },
  { x0: 62, x1: 86, y: 1.0, grass: [[65, 82]] },
  { x0: 86, x1: 100, y: 1.0, grass: [] as number[][] },
];
/** The walk's depth (z): its front edge, the trees' rows behind. */
const FRONT = -10, BACK = 12, TREES_Z = [6.5, 9];
/** How far back the land runs, and the forest's further rows on it. */
const FAR_BACK = 46, FAR_TREES = [13.5, 18, 23.5, 30];

export interface Route1 {
  level: Platform[];
  root: TransformNode;
  /** Its tall-grass patches: where wild Pokémon roam (x from, x to, the ground's height). */
  grass: { x0: number; x1: number; y: number }[];
  /** Its far end (Viridian City's gate): x. */
  end: number;
  dispose(): void;
}

export function route1(scene: Scene, parent: TransformNode, startX: number, baseY: number): Route1 {
  const root = new TransformNode('route1', scene);
  root.parent = parent;
  const owned: { dispose(): void }[] = [];
  const shadowGen = (scene.metadata as { shadowGen?: { addShadowCaster(m: AbstractMesh): void } } | undefined)?.shadowGen;
  const mats = new Map<string, StandardMaterial>();
  const mat = (name: string, c: [number, number, number], glow = 0.45) => {
    let m = mats.get(name);
    if (!m) {
      m = new StandardMaterial(`route1_${name}`, scene);
      m.diffuseColor = new Color3(...c); m.emissiveColor = new Color3(...c).scale(glow); m.specularColor = new Color3(0.03, 0.03, 0.03);
      mats.set(name, m);
    }
    return m;
  };
  const C = {
    earth: mat('earth', [0.45, 0.32, 0.2]), stone: mat('stone', [0.62, 0.62, 0.6]), stoneDark: mat('stoneDark', [0.46, 0.46, 0.45]),
    path: mat('path', [0.82, 0.72, 0.5], 0.3), wood: mat('wood', [0.66, 0.45, 0.27]), woodDark: mat('woodDark', [0.45, 0.29, 0.17]),
    fence: mat('fence', [0.96, 0.96, 0.92]), flowerR: mat('flowerR', [0.92, 0.25, 0.3], 0.7), flowerY: mat('flowerY', [0.98, 0.84, 0.25], 0.7),
    flowerW: mat('flowerW', [0.98, 0.98, 1], 0.7), gate: mat('gate', [0.55, 0.36, 0.22]), roof: mat('roof', [0.32, 0.55, 0.42]),
  };
  const place = (m: Mesh, material: StandardMaterial, shadow = false) => {
    m.material = material; m.parent = root; m.isPickable = false; m.receiveShadows = true;
    if (shadow) shadowGen?.addShadowCaster(m);
    return m;
  };
  const box = (name: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, material: StandardMaterial, shadow = false) => {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    const b = Math.max(w, h, d) > 20 || Math.min(w, h, d) < 0.01 ? MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene)
      : bevelBox(name, scene, w, h, d, Math.min(0.05, Math.min(w, h, d) * 0.22));
    b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return place(b, material, shadow);
  };
  // Its grass: a soft lawn under fur — short, and tall in the patches.
  const lawnMat = new StandardMaterial('route1_lawn', scene);
  lawnMat.diffuseColor = new Color3(0.42, 0.7, 0.3); lawnMat.specularColor = Color3.Black();
  const tallMat = new StandardMaterial('route1_tall', scene);
  tallMat.diffuseColor = new Color3(0.26, 0.56, 0.22); tallMat.specularColor = Color3.Black();
  owned.push(lawnMat, tallMat, softGrass(scene, lawnMat, 20, 20, 31), softGrass(scene, tallMat, 14, 20, 32));
  const lawn = (x0: number, x1: number, y: number, z0: number, z1: number, tall: boolean, seed: number) => {
    if (x1 - x0 < 0.05) return;
    const g = MeshBuilder.CreateGround('route1Lawn', { width: x1 - x0, height: z1 - z0, subdivisions: 2 }, scene);
    g.position.set((x0 + x1) / 2, y + 0.001, (z0 + z1) / 2);
    place(g, tall ? tallMat : lawnMat);
    if (!tall) { owned.push(grassFur(scene, g, lawnMat, x1 - x0, z1 - z0, 1, seed)); return; }
    // (Tall grass: tufts of thick strands over the soft lawn, not fur — all of it tall; you're seen through it
    // (tallGrass.seeThrough).)
    tufts(x0, x1, y, z0, z1, ROUTE_GRASS, seed);
  };
  const tufts = (x0: number, x1: number, y: number, z0: number, z1: number, h: number, sd: number) => {
    const t = tallGrassPatch(scene, x0, x1, y, z0, z1, h, sd);
    t.parent = root; t.receiveShadows = true;
  };

  const level: Platform[] = [];
  const grass: Route1['grass'] = [];
  let seed = 40;
  for (const [i, s] of STRETCHES.entries()) {
    const x0 = startX + s.x0, x1 = startX + s.x1, y = baseY + s.y;
    // (Its ground: the collision, and the earth under the lawn.)
    level.push({ x: x0, top: y, w: x1 - x0, h: 6 + y, hidden: true });
    box('route1Earth', x0, x1, -6, y, FRONT, FAR_BACK, C.earth);
    // (The land running on back past the trees: its far edge hidden behind the forest.)
    const far = MeshBuilder.CreateGround('route1LawnFar', { width: x1 - x0, height: FAR_BACK - BACK, subdivisions: 2 }, scene);
    far.position.set((x0 + x1) / 2, y + 0.001, (BACK + FAR_BACK) / 2);
    place(far, lawnMat);
    // The lawn along it, the tall grass in its patches; a sandy path along the walk where the grass isn't tall.
    let cur = x0;
    for (const [g0, g1] of s.grass) {
      const a = startX + g0, b = startX + g1;
      lawn(cur, a, y, FRONT, -0.9, false, seed++); lawn(cur, a, y, 0.9, BACK, false, seed++);
      box('route1Path', cur, a, y - 0.05, y + 0.004, -0.9, 0.9, C.path);
      lawn(a, b, y, FRONT, BACK, true, seed++);
      grass.push({ x0: a, x1: b, y });
      cur = b;
    }
    lawn(cur, x1, y, FRONT, -0.9, false, seed++); lawn(cur, x1, y, 0.9, BACK, false, seed++);
    box('route1Path', cur, x1, y - 0.05, y + 0.004, -0.9, 0.9, C.path);
    // Up (or down) to the next: its face in stone, a step or two at its foot (each within a hop).
    const next = STRETCHES[i + 1];
    if (next) {
      const ny = baseY + next.y, rise = ny - y;
      box('route1Face', x1 - 0.2, x1 + 0.05, Math.min(y, ny) - 0.3, Math.max(y, ny), FRONT, BACK, C.stone);
      const steps = Math.ceil(Math.abs(rise) / 0.6);
      for (let k = 1; k < steps; k++) {
        // (Steps on the lower side, climbing to the higher.)
        // (The highest against the face, each next one a step lower and further from it.)
        const up = rise > 0, top = Math.min(y, ny) + (Math.abs(rise) * (steps - k)) / steps;
        const stx0 = up ? x1 - k * 0.9 : x1 + (k - 1) * 0.9, stx1 = stx0 + 0.9;
        level.push({ x: stx0, top, w: 0.9, h: top - Math.min(y, ny) + 0.2, hidden: true });
        box('route1Step', stx0, stx1, Math.min(y, ny) - 0.05, top, FRONT, BACK, C.stoneDark);
      }
    }
  }
  const end = startX + STRETCHES[STRETCHES.length - 1].x1;
  const endY = baseY + STRETCHES[STRETCHES.length - 1].y;
  // Its far end: Viridian City's gate — a gatehouse, closed for now — and a wall too high to jump.
  level.push({ x: end, top: endY + 14, w: 2, h: 20, hidden: true });
  box('viridianGateWall', end, end + 6, endY, endY + 3.6, -3, 3, mat('gateWall', [0.95, 0.9, 0.8]), true);
  box('viridianGateRoof', end - 0.3, end + 6.3, endY + 3.6, endY + 4.1, -3.3, 3.3, C.roof, true);
  box('viridianGateDoor', end - 0.06, end + 0.02, endY, endY + 2.2, -0.8, 0.8, C.gate);
  // Signs: Route 1's, at its start; Viridian City's, before its gate.
  const sign = (x: number, y: number) => {
    for (const dx of [0.08, 1.12]) box('route1SignPost', x + dx, x + dx + 0.1, y, y + 1.25, -1.6, -1.5, C.woodDark, true);
    box('route1Sign', x, x + 1.3, y + 0.7, y + 1.3, -1.66, -1.6, C.woodDark, true);
    box('route1SignFace', x + 0.06, x + 1.24, y + 0.76, y + 1.24, -1.68, -1.66, C.wood);
  };
  sign(startX + 1, baseY); sign(end - 4, endY);
  // A fence along a stretch, flowers by the path, rocks.
  for (let x = startX + 14; x < startX + 20; x += 0.4) box('route1Picket', x - 0.05, x + 0.05, baseY + 0.6, baseY + 1.25, 2.2, 2.28, C.fence);
  box('route1Rail', startX + 14, startX + 19.8, baseY + 1.0, baseY + 1.07, 2.28, 2.33, C.fence);
  const flowers = [C.flowerR, C.flowerY, C.flowerW];
  for (const [k, x] of [startX + 15, startX + 16.3, startX + 40, startX + 41.5, startX + 63.5, startX + 88].entries()) {
    const s = STRETCHES.find((t) => x >= startX + t.x0 && x < startX + t.x1)!;
    const y = baseY + s.y;
    for (let j = 0; j < 4; j++) {
      const f = MeshBuilder.CreateSphere('route1Flower', { diameter: 0.18, segments: 5 }, scene);
      f.position.set(x + j * 0.25, y + 0.22, 1.4 + (j % 2) * 0.3); place(f, flowers[(k + j) % 3]);
    }
  }
  for (const [x, z, sz] of [[startX + 30, 3, 0.8], [startX + 52, -2.6, 0.6], [startX + 75, 2.8, 1.0], [startX + 92, -2.4, 0.7]] as const) {
    const s = STRETCHES.find((t) => x >= startX + t.x0 && x < startX + t.x1)!;
    const r = MeshBuilder.CreateIcoSphere('route1Rock', { radius: sz / 2, subdivisions: 1, flat: true }, scene);
    r.position.set(x, baseY + s.y + sz * 0.15, z); r.scaling.y = 0.6; place(r, C.stoneDark, true);
  }
  // The trees: rows behind it, a few clumps nearer.
  const tm = treeMaterial(scene);
  owned.push(tm);
  let n = 500;
  const rnd = (() => { let v = 9; return () => { v = (v * 16807) % 2147483647; return v / 2147483647; }; })();
  const tree = (x: number, z: number, s: number, kind: TreeKind) => {
    const st = STRETCHES.find((t) => x >= startX + t.x0 && x < startX + t.x1);
    if (!st) return;
    const t = lowPolyTree(scene, kind, s, ++n);
    t.position.set(x, baseY + st.y, z);
    place(t, tm as unknown as StandardMaterial, true);
  };
  for (const [row, z] of TREES_Z.entries()) for (let x = startX + 0.6 + row * 1.1; x < end - 0.5; x += 2.2) {
    const r = rnd();
    tree(x, z + ((x * 7) % 1.4) - 0.7, TREE_SCALE * (0.95 + rnd() * 0.3), r < 0.55 ? 'round' : r < 0.85 ? 'pine' : 'poplar');
  }
  for (const x of [startX + 19, startX + 57, startX + 84]) tree(x, 4.2, TREE_SCALE * 1.15, 'round');
  // (The forest going on back, deeper and taller row on row: no ground's edge to be seen.)
  for (const [row, z] of FAR_TREES.entries()) for (let x = startX + 0.4 + row * 1.3; x < end + 6; x += 2.6 + row * 0.5) {
    const r = rnd();
    tree(x, z + ((x * 5) % 2) - 1, TREE_SCALE * (1.15 + row * 0.22 + rnd() * 0.35), r < 0.45 ? 'round' : r < 0.85 ? 'pine' : 'poplar');
  }

  return {
    level, root, grass, end,
    dispose: () => { for (const o of owned) o.dispose(); root.dispose(false, true); for (const m of mats.values()) m.dispose(); },
  };
}
