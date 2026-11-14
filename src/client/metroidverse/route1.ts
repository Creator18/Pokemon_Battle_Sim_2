/**
 * Route 1, side-on: north from Pallet Town (left) to Viridian City (right) — a forest route built to need both your
 * forms, after Nintendo's teach → test → twist → finish:
 *
 *   1 Meadow       open tall grass: Pidgey, Bellsprout to fight and catch (they fight back only when struck)
 *   2 Ledge        a cliff too high for a Pokéball's hop — your Pokémon's jump (and double jump) takes it (teach)
 *   3 Great Root   a giant old tree across the way, far too tall to jump or fly over, a burrow under its roots only a
 *                  Pokéball fits (teach)
 *   4 Rootstone    a cliff, a narrow shelf at its top, a low arch of roots on from it: up as your Pokémon, down to a
 *                  Pokéball on the shelf, through (test)
 *   5 The Hollow   in through a burrow (a Pokéball, so the aggressive Spinarak in its grass leave you be); out up a
 *                  high ledge — your Pokémon, at the wall, with them all round (twist)
 *   6 Old Tree     branches up its side (your Pokémon's jumps) to a knothole at the top only a Pokéball fits: a nook
 *                  hidden in its crown (its reward to come); the way on along the ground beneath
 *   7 Hilltop      ledge, burrow, ledge — up to Viridian City's gatehouse (finish)
 *
 * Every gate's numbers measured off the two forms: a Pokéball hops 1.4 and is 0.55 across; your Pokémon jumps about
 * 2.7, about 4 with its double jump, and stands 0.72–1.1 — so a ledge is 2.4, a burrow 0.66 high, and every ball-only
 * wall reaches far higher than anything can fly. Down every ledge and back through every burrow, the way home is open.
 *
 * Its grass the stadium's fur along the path; its tall grass tufts of thick strands (tallGrass.ts).
 */
import type { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Platform } from '../platformer/Fighter.ts';
import { furField } from '../render/arenas/grassFur.ts';
import { softGrass } from '../render/arenas/softGrass.ts';
import { bevelBox } from '../render/lowPolyKit.ts';
import { tallGrassPatch } from '../render/tallGrass.ts';
import { lowPolyTree, treeMaterial, barkTube, barkWood, leafClump } from '../render/lowPolyTrees.ts';
import { rock, rockWall, rockMaterial, GREY_ROCK, EARTH_ROCK } from '../render/lowPolyRocks.ts';
import type { RockLook } from '../render/lowPolyRocks.ts';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh as BMesh } from '@babylonjs/core/Meshes/mesh';
import type { TreeKind } from '../render/lowPolyTrees.ts';

/** The trees' size (× a tree's own): Pallet Town's. */
const TREE_SCALE = 1.5;
/** Its tall grass: how tall (taller than a Pokéball, about a small Pokémon's height). */
export const ROUTE_GRASS = 0.78;
/** A burrow's height (a Pokéball's 0.55 fits; no Pokémon of yours does); a ledge's (over a hop, under a jump). */
const BURROW = 0.66, LEDGE = 2.4;
/** How high a ball-only wall reaches above its burrow (higher than anything flies). */
const WALL_UP = 22;

/** Its ground, stretch by stretch (x from its start, to; its top above Pallet's north). */
const GROUND: [number, number, number][] = [
  [0, 16, 0],                // 1 Meadow
  [16, 48, LEDGE],           // 2 Ledge, 3 Great Root, the calm after
  [48, 63.2, LEDGE * 2],     // 4 Rootstone: shelf, root arch, plateau; the Hollow's burrow, its shelf
  [63.2, 78, 1.6],           // 5 The Hollow
  [78, 108, 4.0],            // 6 Old Tree
  [108, 120, 6.4],           // 7 Hilltop: its burrow
  [120, 128, 8.8],           //   the gatehouse's rise
];
/** Ball-only walls: from x, to x — standing on the ground there, a burrow under. */
const WALLS: [number, number, string][] = [[30, 36, 'greatRoot'], [49.6, 54, 'rootstone'], [60, 62, 'hollowMouth'], [112, 116, 'hillBurrow']];
/** The Old Tree: where it stands; its branches (x from, to, height above its ground); its nook (x from, to, height). */
/** (Each branch clear of the one above where you jump from it — up right, up left, up right — the top one running on
 * into the nook.) */
const OLD_TREE = { x: 98, branches: [[99, 101.5, 2.2], [95, 97.5, 4.4], [98.5, 101, 6.6]] as [number, number, number][], nook: [101, 104.8, 6.6] as [number, number, number] };
/** Its tall grass (x from, to): the species that live in each (default: the route's own). */
const PATCHES: { x0: number; x1: number; only?: string }[] = [
  { x0: 1, x1: 15 }, { x0: 19.5, x1: 27 }, { x0: 37, x1: 46.5 }, { x0: 64.5, x1: 77, only: 'Spinarak' }, { x0: 79.5, x1: 90 },
];
/** Its signs: where, what they say (a hint the first time you meet an idea; none for the tests). */
const SIGNS: [number, string][] = [
  [1, 'ROUTE 1 — Pallet Town ⇄ Viridian City'],
  [13, 'Too high to hop? Let your Pokémon out — X.'],
  [27.6, 'Only something small could slip under those roots…'],
  [122.5, 'VIRIDIAN CITY — ahead.'],
];
/** The walk's depth (z): its front edge, the trees' rows behind; how far back the land runs, the forest's further rows. */
const FRONT = -10, BACK = 12, TREES_Z = [6.5, 9];
const FAR_BACK = 46, FAR_TREES = [13.5, 18, 23.5, 30];
/** How far the land runs toward the camera (past it): its near edge out of sight. */
const NEAR = -34;
/** How near the camera a cliff's boulders run (z): out past the view's edge. */
const CLIFF_FROM = FRONT - 4;

export interface Route1 {
  level: Platform[];
  root: TransformNode;
  /** Its tall-grass patches: where wild Pokémon roam (x from, x to, the ground's height; who, if only one kind). */
  grass: { x0: number; x1: number; y: number; only?: string }[];
  /** Its signs (where, what they say). */
  signs: { x: number; y: number; text: string }[];
  /** The Old Tree's hidden nook: its middle. */
  secret: { x: number; y: number };
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
    rock: mat('rock', [0.52, 0.5, 0.47]), rockDark: mat('rockDark', [0.36, 0.35, 0.33]), moss: mat('moss', [0.33, 0.55, 0.26]),
    path: mat('path', [0.82, 0.72, 0.5], 0.3), wood: mat('wood', [0.66, 0.45, 0.27]), woodDark: mat('woodDark', [0.45, 0.29, 0.17]),
    bark: mat('bark', [0.42, 0.28, 0.17]), barkDark: mat('barkDark', [0.28, 0.18, 0.11]), burrow: mat('burrow', [0.08, 0.06, 0.05], 0.1),
    web: mat('web', [0.95, 0.95, 0.98], 0.7), glow: mat('glow', [1, 0.86, 0.4], 0.95),
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
  const cyl = (name: string, x: number, y: number, z: number, h: number, d0: number, d1: number, material: StandardMaterial, tilt = 0, yaw = 0, shadow = true) => {
    const c = MeshBuilder.CreateCylinder(name, { height: h, diameterBottom: d0, diameterTop: d1, tessellation: 14 }, scene);
    c.position.set(x, y, z); c.rotation.set(0, yaw, tilt);
    return place(c, material, shadow);
  };
  const ball = (name: string, x: number, y: number, z: number, r: number, material: StandardMaterial, sy = 1, shadow = true) => {
    const s = MeshBuilder.CreateIcoSphere(name, { radius: r, subdivisions: 2, flat: true }, scene);
    s.position.set(x, y, z); s.scaling.y = sy;
    return place(s, material, shadow);
  };
  // Its grass: a soft lawn under fur along the path; tufts of thick strands where it's tall.
  const lawnMat = new StandardMaterial('route1_lawn', scene);
  lawnMat.diffuseColor = new Color3(0.42, 0.7, 0.3); lawnMat.specularColor = Color3.Black();
  const tallMat = new StandardMaterial('route1_tall', scene);
  tallMat.diffuseColor = new Color3(0.26, 0.56, 0.22); tallMat.specularColor = Color3.Black();
  owned.push(lawnMat, tallMat, softGrass(scene, lawnMat, 20, 20, 31), softGrass(scene, tallMat, 14, 20, 32));
  /** The short lawns, their fur grown over them all at once at the end (furField: a few draws, not 14 per lawn). */
  const lawns: BMesh[] = [];
  const lawn = (x0: number, x1: number, y: number, z0: number, z1: number, tall: boolean, seed: number) => {
    if (x1 - x0 < 0.05) return;
    const g = MeshBuilder.CreateGround('route1Lawn', { width: x1 - x0, height: z1 - z0, subdivisions: 2 }, scene);
    g.position.set((x0 + x1) / 2, y + 0.001, (z0 + z1) / 2);
    place(g, tall ? tallMat : lawnMat);
    if (!tall) { lawns.push(g); return; }
    const t = tallGrassPatch(scene, x0, x1, y, z0, z1, ROUTE_GRASS, seed);
    t.parent = root; t.receiveShadows = true;
  };

  /** A merged set of meshes (one draw), cast as shadow, under `root`, named `name` (floors-named never fade). */
  const merged = (name: string, parts: BMesh[], shadow = true) => {
    const m = BMesh.MergeMeshes(parts, true, true)!;
    m.name = name; m.material = rockMaterial(scene);
    m.parent = root; m.isPickable = false; m.receiveShadows = true;
    if (shadow) shadowGen?.addShadowCaster(m);
    return m;
  };
  /**
   * A cliff at x (from lo up to hi), its low side `dir` (−1: left): boulders banked up its face, row on row, along the
   * depth the camera sees; a mossy rounded lip at its top; stones fallen at its foot.
   */
  const cliff = (x: number, lo: number, hi: number, dir: number, sd: number) => {
    const parts: BMesh[] = [];
    let v = sd;
    const r = () => { v = (v * 16807 + 3) % 2147483647; return (v % 10000) / 10000; };
    const rows = Math.max(1, Math.round((hi - lo) / 0.85));
    for (let row = 0; row < rows; row++) {
      const ry = lo + ((row + 0.5) / rows) * (hi - lo);
      for (let z = CLIFF_FROM + r() * 0.4; z < 8; z += 0.9 + r() * 0.6) {
        // (Kept back of the walk at z ≈ 0, where you climb: only a thin facing there.)
        const nearWalk = Math.abs(z) < 1.1;
        const bw = nearWalk ? 0.35 : 0.7 + r() * 0.6, bh = (hi - lo) / rows * (1.1 + r() * 0.4), bd = 0.9 + r() * 0.7;
        parts.push(rock(scene, 'route1FaceBoulder', x + dir * (bw * 0.35) - 0.1, ry, z, bw, bh, bd, v % 997, row === rows - 1 ? GREY_ROCK : { ...GREY_ROCK, moss: null }, 1));
      }
    }
    for (let z = CLIFF_FROM + 0.1; z < 7; z += 1.1 + r() * 0.5) parts.push(rock(scene, 'route1FaceLip', x - dir * 0.15, hi + 0.02, z, 0.9 + r() * 0.5, 0.35, 0.9 + r() * 0.5, v % 991, GREY_ROCK, 1));
    for (let k = 0; k < 4; k++) {
      const z = -4 + k * 3 + r();
      if (Math.abs(z) < 1.2) continue;
      parts.push(rock(scene, 'route1FaceStone', x + dir * (0.7 + r() * 0.8), lo + 0.15, z, 0.45 + r() * 0.4, 0.35, 0.45 + r() * 0.3, v % 983, GREY_ROCK, 1));
    }
    merged('route1FaceRocks', parts);
  };
  const X = (x: number) => startX + x;
  const groundAt = (x: number) => baseY + (GROUND.find(([a, b]) => x >= a && x < b) ?? GROUND[GROUND.length - 1])[2];
  const level: Platform[] = [];
  const grass: Route1['grass'] = [];
  let seed = 40;

  // ── the ground, stretch by stretch: its collision, its earth, its lawn and path, its tall grass, the cliff up (or
  // down) to the next ──
  for (const [i, [a, b, h]] of GROUND.entries()) {
    const x0 = X(a), x1 = X(b), y = baseY + h;
    // (Its ground runs on toward the camera at its own height, past it — never cut short, no section of it seen.)
    const zf = FRONT;
    level.push({ x: x0, top: y, w: x1 - x0, h: 6 + y, hidden: true });
    box('route1Earth', x0, x1, -6, y, NEAR, FAR_BACK, C.earth);
    const near = MeshBuilder.CreateGround('route1LawnNear', { width: x1 - x0, height: FRONT - NEAR, subdivisions: 2 }, scene);
    near.position.set((x0 + x1) / 2, y + 0.001, (NEAR + FRONT) / 2); place(near, lawnMat);
    const far = MeshBuilder.CreateGround('route1LawnFar', { width: x1 - x0, height: FAR_BACK - BACK, subdivisions: 2 }, scene);
    far.position.set((x0 + x1) / 2, y + 0.001, (BACK + FAR_BACK) / 2); place(far, lawnMat);
    // (Its tall grass where a patch lies on it; short lawn, and the path, between.)
    let cur = x0;
    for (const p of PATCHES.filter((q) => q.x0 >= a && q.x1 <= b)) {
      const pa = X(p.x0), pb = X(p.x1);
      lawn(cur, pa, y, zf, -0.9, false, seed++); lawn(cur, pa, y, 0.9, BACK, false, seed++);
      box('route1Path', cur, pa, y - 0.05, y + 0.004, -0.9, 0.9, C.path);
      lawn(pa, pb, y, zf, BACK, true, seed++);
      grass.push({ x0: pa, x1: pb, y, only: p.only });
      cur = pb;
    }
    lawn(cur, x1, y, zf, -0.9, false, seed++); lawn(cur, x1, y, 0.9, BACK, false, seed++);
    box('route1Path', cur, x1, y - 0.05, y + 0.004, -0.9, 0.9, C.path);
    // (Its cliff to the next: boulders banked along it — stacked, overlapping, mossed on top — the earth face behind,
    // a few loose stones fallen at its foot.)
    const next = GROUND[i + 1];
    if (next) {
      const ny = baseY + next[2], lo = Math.min(y, ny), hi = Math.max(y, ny);
      box('route1Face', x1 - 0.35, x1 + 0.1, lo - 0.3, hi, NEAR, BACK, C.earth);
      cliff(x1, lo, hi, ny > y ? -1 : 1, i * 31 + 7);
    }
  }
  const end = X(GROUND[GROUND.length - 1][1]);
  const endY = baseY + GROUND[GROUND.length - 1][2];
  // (The land nearest the camera, all along: low, the route's lowest ground — running on under the camera, its near
  // edge never in view.)
  box('route1EarthNear', end, end + 8, -6, baseY, NEAR, FAR_BACK, C.earth);
  const nearLawn = MeshBuilder.CreateGround('route1LawnNear', { width: 8, height: FRONT - NEAR, subdivisions: 2 }, scene);
  nearLawn.position.set(end + 4, baseY + 0.001, (NEAR + FRONT) / 2); place(nearLawn, lawnMat);

  // ── the ball-only walls: each standing on its ground, a burrow under it (BURROW high), reaching far above ──
  for (const [a, b, kind] of WALLS) {
    const x0 = X(a), x1 = X(b), y = groundAt(a);
    level.push({ x: x0, top: y + WALL_UP, w: x1 - x0, h: WALL_UP - BURROW, hidden: true });
    // (The burrow's dark inside: its back wall, its roof's underside.)
    box('route1BurrowBack', x0, x1, y, y + BURROW + 0.05, 0.6, 1.4, C.burrow);
    box('route1BurrowRoof', x0, x1, y + BURROW, y + BURROW + 0.08, -0.9, 1.0, C.barkDark);
    if (kind === 'greatRoot') {
      // A great old tree across the way: its trunk vast, flaring into buttress roots that arch over the burrow at its
      // foot and grip the ground either side; its bark ridged; its crown up out of sight.
      const cx = (x0 + x1) / 2, R = (x1 - x0) / 2, base = y + BURROW;
      const parts: BMesh[] = [];
      // (Its trunk in grained bark — deep ridges wandering up it, knots, moss up its foot.)
      parts.push(barkWood(scene, [0, 0.25, 0.5, 0.75, 1].map((t) => new Vector3(cx + Math.sin(t * 2) * 0.3, base + t * 16, 0.5)),
        (t) => R * (0.82 + 0.5 * Math.pow(1 - t, 5)), 30, { ridges: 15, depth: 0.14, moss: 0.12, knots: 5, seed: 3 }));
      // (Its buttress roots: arching out and down from its foot — over the burrow's mouth at front and back, gripping
      // the ground either side.)
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2 + 0.3, ax = Math.cos(a), az = Math.sin(a) * 0.85, len = 2.0 + (k % 3) * 0.6;
        // (High on the trunk, curving out — bulging over the burrow at front and back — and down into the ground.)
        const p0 = new Vector3(cx + ax * R * 0.75, base + 2.6 + (k % 2) * 0.5, 0.5 + az * R * 0.75);
        const p1 = new Vector3(cx + ax * (R + 0.35), base + 1.1, 0.5 + az * (R + 0.35));
        const p2 = new Vector3(cx + ax * (R + len * 0.55), y + 0.35, 0.5 + az * (R + len * 0.5));
        const p3 = new Vector3(cx + ax * (R + len), y - 0.15, 0.5 + az * (R + len * 0.9));
        parts.push(barkWood(scene, [p0, p1, p2, p3], (t) => (0.95 - (k % 3) * 0.1) * Math.pow(1 - t * 0.85, 0.9), 16, { ridges: 7, depth: 0.16, moss: 0.1, knots: 1, seed: 10 + k }));
      }
      merged('route1GreatTree', parts).material = treeMaterial(scene);
      // Its crown: clumps of leaves high up, round it.
      const crown = new Vector3(cx, base + 17, 0.5), radii = new Vector3(6, 3.5, 5);
      const leaves: BMesh[] = [];
      for (let k = 0; k < 14; k++) {
        const a = k * 2.4, rr = 2 + (k % 4) * 1.1;
        leaves.push(leafClump(scene, crown.add(new Vector3(Math.cos(a) * rr, (k % 3) * 0.9 - 0.6, Math.sin(a) * rr * 0.8)), 1.8 + (k % 3) * 0.4, crown, radii, [0.26, 0.55, 0.25], 300 + k));
      }
      merged('route1GreatCrown', leaves).material = treeMaterial(scene);
    } else {
      // A rock outcrop (its boulders banked up and mossed; roots hanging over the burrow's mouth; a stone arch round the
      // mouth; a tree or two on top) — on the hilltop, earthier.
      const look: RockLook = kind === 'hillBurrow' ? EARTH_ROCK : GREY_ROCK;
      const top = y + 8.5;
      const wall = rockWall(scene, 'route1Outcrop', x0, x1, y + BURROW, top, -2.6, 3.4, Math.round(x0 * 17), look);
      wall.parent = root; wall.isPickable = false; wall.receiveShadows = true; shadowGen?.addShadowCaster(wall);
      // (The mouth's arch: stones framing it at front and back, clear of the walk.)
      const arch: BMesh[] = [];
      for (const z of [-2.2, 2.6]) for (const [dx, h] of [[-0.25, 1.2], [0.25, 1.2]] as const) {
        arch.push(rock(scene, 'route1ArchStone', (dx < 0 ? x0 : x1) + dx, y + h / 2, z, 0.7, h, 0.8, Math.round(x0 + z * 7 + dx * 30), look, 1));
      }
      merged('route1Arch', arch);
      // (Roots hanging over the mouth: thin, curling, a few long.)
      const roots: BMesh[] = [];
      for (let k = 0; k < Math.round((x1 - x0) / 0.4); k++) {
        const rx = x0 + 0.25 + k * 0.4, len = 0.35 + ((k * 7) % 5) * 0.12, sway = ((k * 13) % 5 - 2) * 0.05;
        roots.push(barkTube(scene, [new Vector3(rx, y + BURROW + 0.15, -2.45), new Vector3(rx + sway, y + BURROW - len * 0.5, -2.5), new Vector3(rx + sway * 2, y + BURROW - len, -2.48)],
          (t) => 0.05 * (1 - t * 0.7), 5));
      }
      merged('route1Roots', roots, false).material = treeMaterial(scene);
      for (const dx of [0.3, 0.75]) {
        const t = lowPolyTree(scene, kind === 'hillBurrow' ? 'pine' : 'round', TREE_SCALE * 0.9, 900 + Math.round(x0 * 3 + dx * 10));
        t.position.set(x0 + (x1 - x0) * dx, top + 0.2, 0.8); place(t, treeMaterial(scene) as unknown as StandardMaterial, true);
      }
    }
  }

  // ── the Hollow: webs strung between its trees, tied down to the ground ──
  {
    const hx0 = X(64.5), y = groundAt(70);
    // (Its trees: young trunks behind the path, close enough to string webs between — their bark grained, leaves up
    // top; each web between two of them.)
    const TRUNK_Z = 2.8, trunkR = (t: number) => 0.26 * (1 - 0.5 * t) + 0.12 * Math.pow(1 - t, 6);
    const trunkXs = [hx0 + 0.1, hx0 + 3.4, hx0 + 7.2, hx0 + 11.7];
    const wood: BMesh[] = [], leaves: BMesh[] = [];
    const lean = (k: number) => [0.18, -0.12, 0.1, -0.16][k];
    /** Where trunk `k` is at height `h` (its middle): it leans a little as it climbs. */
    const trunkAt = (k: number, h: number) => new Vector3(trunkXs[k] + lean(k) * (h / 4.6), y + h, TRUNK_Z);
    for (const [k, tx] of trunkXs.entries()) {
      wood.push(barkWood(scene, [0, 0.3, 0.6, 1].map((t) => trunkAt(k, -0.1 + t * 4.7)), trunkR, 14, { ridges: 7, depth: 0.12, moss: 0.2, knots: 2, seed: 60 + k }));
      // (A limb or two reaching out from it, up where the leaves start.)
      for (const side of [-1, 1]) {
        const from = trunkAt(k, 3.1 + (side > 0 ? 0.3 : 0));
        wood.push(barkTube(scene, [from, from.add(new Vector3(side * 0.7, 0.55, (k % 2 ? 0.3 : -0.3))), from.add(new Vector3(side * 1.25, 0.8, (k % 2 ? 0.5 : -0.4)))], (t) => 0.09 * (1 - 0.6 * t), 6));
      }
      const crown = trunkAt(k, 4.6), radii = new Vector3(1.5, 1.1, 1.4);
      for (let c = 0; c < 6; c++) {
        const a = c * 2.4 + k, rr = c ? 0.85 : 0;
        leaves.push(leafClump(scene, crown.add(new Vector3(Math.cos(a) * rr, (c % 2) * 0.45 - (c ? 0.25 : -0.2), Math.sin(a) * rr * 0.8)), 0.9 + (c % 3) * 0.2, crown, radii, [0.25, 0.53, 0.24], 700 + k * 10 + c));
      }
      void tx;
    }
    merged('route1HollowTrees', [...wood, ...leaves]).material = treeMaterial(scene);
    // The webs: each a ring of frame threads, spokes out to it, a spiral wound round; tied by anchor lines to the
    // trunks either side, and guy lines down to the ground (sagging a little: silk).
    const threads: BMesh[] = [];
    const silk = (name: string, path: Vector3[], r = 0.007) => threads.push(MeshBuilder.CreateTube(name, { path, radius: r, tessellation: 3 }, scene));
    const sag = (p: Vector3, q: Vector3, by = 0.05) => [p, Vector3.Lerp(p, q, 0.5).add(new Vector3(0, -by, 0)), q];
    for (let k = 0; k < trunkXs.length - 1; k++) {
      const left = trunkAt(k, 1.4), right = trunkAt(k + 1, 1.4);
      const cx = (left.x + right.x) / 2 + (k - 1) * 0.15, cy = y + 1.35 + k * 0.15, cz = TRUNK_Z - 0.05;
      const R = 0.8 + k * 0.08, spokes = 9;
      // (Its frame: an uneven ring of threads round it.)
      const frame: Vector3[] = [];
      for (let r = 0; r < spokes; r++) {
        const a = (r / spokes) * Math.PI * 2 + 0.2, rr = R * (1 + 0.12 * Math.sin(r * 2.3 + k));
        frame.push(new Vector3(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, cz));
      }
      silk('route1WebFrame', [...frame, frame[0]], 0.008);
      for (const f of frame) silk('route1WebSpoke', [new Vector3(cx, cy, cz), f]);
      const spiral: Vector3[] = [];
      for (let t = 0; t < 5.5 * spokes; t++) {
        const a = (t / spokes) * Math.PI * 2 + 0.2, rr = 0.1 + (t / (5.5 * spokes)) * (R * 0.9 - 0.12);
        spiral.push(new Vector3(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr - 0.01 * Math.sin(t), cz));
      }
      silk('route1WebSpiral', spiral, 0.006);
      // (Its anchor lines: from the frame's points nearest each trunk to that trunk's bark, high and low.)
      const byX = [...frame].sort((p, q) => p.x - q.x);
      for (const [side, pts] of [[k, byX.slice(0, 3)], [k + 1, byX.slice(-3)]] as [number, Vector3[]][]) {
        for (const pt of pts) {
          const at = trunkAt(side, pt.y - y + (pt.y > cy ? 0.35 : -0.15));
          const toward = Math.sign(pt.x - at.x);
          silk('route1WebAnchor', sag(pt, at.add(new Vector3(toward * trunkR((at.y - y) / 4.7) * 0.85, 0, -0.04)), 0.03));
        }
      }
      // (Its guy lines: from the lowest frame points down to the ground, splayed.)
      const low = [...frame].sort((p, q) => p.y - q.y).slice(0, 2);
      for (const pt of low) silk('route1WebGuy', sag(pt, new Vector3(pt.x + (pt.x - cx) * 0.6, y + 0.02, cz - 0.35), 0.02));
    }
    const web = BMesh.MergeMeshes(threads, true, true)!;
    web.name = 'route1Webs'; place(web, C.web);
  }

  // ── the Old Tree: its trunk behind the path (not in the way), its branches out over it (to stand on), its crown,
  // its hidden nook up in it — walled but for a knothole a Pokéball fits ──
  const ot = OLD_TREE, oy = groundAt(ot.x);
  // (Its trunk: ridged bark, a flared foot gripping the ground with its roots.)
  const oldParts: BMesh[] = [];
  oldParts.push(barkWood(scene, [0, 0.3, 0.6, 1].map((t) => new Vector3(X(ot.x) + Math.sin(t * 3) * 0.25, oy + t * 15, 2.6)), (t) => 1.15 * (0.75 + 0.55 * Math.pow(1 - t, 4)), 28, { ridges: 12, depth: 0.13, moss: 0.12, knots: 4, seed: 21 }));
  for (const [ax, az] of [[-1, 0], [1, 0], [-0.5, 0.9], [0.6, 0.8], [0, -0.7]] as const) {
    oldParts.push(barkWood(scene, [new Vector3(X(ot.x) + ax * 0.6, oy + 1.4, 2.6 + az * 0.6), new Vector3(X(ot.x) + ax * 1.4, oy + 0.4, 2.6 + az * 1.2), new Vector3(X(ot.x) + ax * 2.1, oy - 0.05, 2.6 + az * 1.6)],
      (t) => 0.45 * (1 - t * 0.7), 12, { ridges: 5, depth: 0.16, moss: 0.12, knots: 0, seed: 30 + Math.round(ax * 10) }));
  }
  merged('route1OldTree', oldParts).material = treeMaterial(scene);
  for (const [a, b, h] of ot.branches) {
    level.push({ x: X(a), top: oy + h, w: b - a, h: 0.3, hidden: true });
    // (Its branch a round limb out from the trunk — its top where you stand — curving up a touch at its tip; moss and
    // leaves along it.)
    const far = Math.abs(X(a) - X(ot.x)) > Math.abs(X(b) - X(ot.x)) ? X(a) : X(b);
    const limb = barkWood(scene, [new Vector3(X(ot.x), oy + h - 0.32, 2.2), new Vector3((X(ot.x) + far) / 2, oy + h - 0.3, 1.0), new Vector3(far, oy + h - 0.22, 0)],
      (t) => 0.42 - t * 0.14, 16, { ridges: 6, depth: 0.12, moss: 0, knots: 1, seed: 40 + Math.round(h * 10) });
    merged('route1Branch', [limb]).material = treeMaterial(scene);
    const leaves: BMesh[] = [];
    const lc = new Vector3(far, oy + h + 0.3, -0.1);
    // (A spray of leaves at its tip, out past where you stand, and a few along it behind.)
    const out = far > X(ot.x) ? 1 : -1;
    for (let k = 0; k < 7; k++) {
      const along = k < 4 ? 0.3 + k * 0.35 : -0.8 - (k - 4) * 0.9;
      leaves.push(leafClump(scene, lc.add(new Vector3(out * along, (k % 2) * 0.45 + (k < 4 ? 0.1 : -0.2), k < 4 ? (k - 1.5) * 0.45 : 1.1)), 0.75 + (k % 3) * 0.18, lc, new Vector3(2, 1.2, 1.6), [0.28, 0.56, 0.26], 400 + k + Math.round(h * 10)));
    }
    merged('route1BranchLeaves', leaves).material = treeMaterial(scene);
  }
  const [na, nb, nh] = ot.nook;
  const nx0 = X(na), nx1 = X(nb), ny = oy + nh;
  level.push({ x: nx0, top: ny, w: nx1 - nx0, h: 0.3, hidden: true });
  level.push({ x: nx0, top: ny + 3.4, w: 0.4, h: 3.4 - BURROW, hidden: true });
  level.push({ x: nx1 - 0.4, top: ny + 3.4, w: 0.4, h: 3.4, hidden: true });
  level.push({ x: nx0, top: ny + 3.9, w: nx1 - nx0, h: 0.5, hidden: true });
  // The nook: a hollow burl on the tree — its shell of bark (knobbly, mossed), its floor a thick limb, a knothole at its
  // left a Pokéball fits, its crown of leaves over it.
  const BARK: RockLook = { stone: [0.5, 0.34, 0.21], dark: [0.28, 0.18, 0.11], moss: [0.33, 0.55, 0.26], strata: 0.05 };
  const burl: BMesh[] = [];
  burl.push(rock(scene, 'route1NookFloor', (nx0 + nx1) / 2, ny - 0.25, 0.2, nx1 - nx0 + 0.3, 0.5, 2.6, 71, BARK, 2));
  burl.push(rock(scene, 'route1NookLeft', nx0 + 0.2, ny + BURROW + (3.4 - BURROW) / 2, 0.2, 0.55, 3.4 - BURROW + 0.2, 2.6, 72, BARK, 2));
  burl.push(rock(scene, 'route1NookRight', nx1 - 0.2, ny + 1.7, 0.2, 0.6, 3.6, 2.6, 73, BARK, 2));
  burl.push(rock(scene, 'route1NookRoof', (nx0 + nx1) / 2, ny + 3.65, 0.2, nx1 - nx0 + 0.6, 0.7, 2.8, 74, BARK, 2));
  burl.push(rock(scene, 'route1NookBack', (nx0 + nx1) / 2, ny + 1.7, 1.45, nx1 - nx0, 3.5, 0.5, 75, { ...BARK, moss: null }, 1));
  merged('route1Nook', burl);
  // (The knothole's dark rim.)
  const hole = MeshBuilder.CreateTorus('route1Knothole', { diameter: 0.62, thickness: 0.12, tessellation: 18 }, scene);
  hole.rotation.z = Math.PI / 2; hole.position.set(nx0 + 0.02, ny + 0.33, 0); place(hole, C.barkDark);
  const crownC = new Vector3((nx0 + nx1) / 2, ny + 4.7, 0.6), crownR = new Vector3(3.2, 1.8, 2.6);
  const nookLeaves: BMesh[] = [];
  for (let k = 0; k < 9; k++) {
    const a = k * 2.3, rr = 0.6 + (k % 3) * 0.8;
    nookLeaves.push(leafClump(scene, crownC.add(new Vector3(Math.cos(a) * rr * 1.3, (k % 2) * 0.6 - 0.2, Math.sin(a) * rr)), 1.0 + (k % 3) * 0.3, crownC, crownR, [0.27, 0.56, 0.26], 500 + k));
  }
  merged('route1NookCrown', nookLeaves).material = treeMaterial(scene);
  // (Its treasure, to come: a glow in the nook for now.)
  const secret = { x: (nx0 + nx1) / 2 + 0.3, y: ny + 0.5 };
  ball('route1Secret', secret.x, secret.y, 0, 0.22, C.glow, 1, false);

  // ── its far end: Viridian City's gatehouse (closed for now) and a wall too high to jump ──
  level.push({ x: end, top: endY + 14, w: 2, h: 20, hidden: true });
  box('viridianGateWall', end, end + 6, endY, endY + 3.6, -3, 3, mat('gateWall', [0.95, 0.9, 0.8]), true);
  box('viridianGateRoof', end - 0.3, end + 6.3, endY + 3.6, endY + 4.1, -3.3, 3.3, C.roof, true);
  box('viridianGateDoor', end - 0.06, end + 0.02, endY, endY + 2.2, -0.8, 0.8, C.gate);

  // ── its signs ──
  const signs: Route1['signs'] = [];
  for (const [sx, text] of SIGNS) {
    const x = X(sx), y = groundAt(sx);
    for (const dx of [0.08, 1.12]) box('route1SignPost', x + dx, x + dx + 0.1, y, y + 1.25, -1.6, -1.5, C.woodDark, true);
    box('route1Sign', x, x + 1.3, y + 0.7, y + 1.3, -1.66, -1.6, C.woodDark, true);
    box('route1SignFace', x + 0.06, x + 1.24, y + 0.76, y + 1.24, -1.68, -1.66, C.wood);
    signs.push({ x: x + 0.65, y, text });
  }
  // A fence, flowers by the path, rocks.
  for (let x = X(3); x < X(9); x += 0.4) box('route1Picket', x - 0.05, x + 0.05, baseY, baseY + 0.65, 2.2, 2.28, C.fence);
  box('route1Rail', X(3), X(8.8), baseY + 0.4, baseY + 0.47, 2.28, 2.33, C.fence);
  const flowers = [C.flowerR, C.flowerY, C.flowerW];
  for (const [k, sx] of [10.5, 17.5, 28.5, 40, 55.5, 84, 104, 117].entries()) {
    const y = groundAt(sx);
    for (let j = 0; j < 4; j++) {
      const f = MeshBuilder.CreateSphere('route1Flower', { diameter: 0.18, segments: 5 }, scene);
      f.position.set(X(sx) + j * 0.25, y + 0.22, 1.4 + (j % 2) * 0.3); place(f, flowers[(k + j) % 3]);
    }
  }

  // ── the trees: rows behind it, deeper rows on back (the ground's far edge never seen) ──
  const tm = treeMaterial(scene);
  owned.push(tm);
  let n = 500;
  const rnd = (() => { let v = 9; return () => { v = (v * 16807) % 2147483647; return v / 2147483647; }; })();
  const blocked = (x: number) => WALLS.some(([a, b]) => x > X(a) - 1 && x < X(b) + 1) || Math.abs(x - X(ot.x)) < 3;
  const tree = (x: number, z: number, s: number, kind: TreeKind) => {
    if (x >= end || (z < 10 && blocked(x))) return;
    const t = lowPolyTree(scene, kind, s, ++n);
    t.position.set(x, groundAt(x - startX), z);
    place(t, tm as unknown as StandardMaterial, true);
  };
  for (const [row, z] of TREES_Z.entries()) for (let x = X(0.6) + row * 1.1; x < end - 0.5; x += 2.2) {
    const r = rnd();
    tree(x, z + ((x * 7) % 1.4) - 0.7, TREE_SCALE * (0.95 + rnd() * 0.3), r < 0.55 ? 'round' : r < 0.85 ? 'pine' : 'poplar');
  }
  for (const [row, z] of FAR_TREES.entries()) for (let x = X(0.4) + row * 1.3; x < end + 6; x += 2.6 + row * 0.5) {
    const r = rnd();
    tree(x, z + ((x * 5) % 2) - 1, TREE_SCALE * (1.15 + row * 0.22 + rnd() * 0.35), r < 0.45 ? 'round' : r < 0.85 ? 'pine' : 'poplar');
  }

  owned.push(furField(scene, lawns, lawnMat, { seed: 31 }));
  return {
    level, root, grass, signs, secret, end,
    dispose: () => { for (const o of owned) o.dispose(); root.dispose(false, true); for (const m of mats.values()) m.dispose(); },
  };
}
