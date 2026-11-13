/**
 * Pallet Town, side-on — FireRed's Pallet Town laid out as a platform level, its south to the left and its north to
 * the right (the way the story runs), on two tiers as the map climbs north:
 *
 *   the sea (Route 21: closed till Surf) · the beach · Prof. Oak's Lab · the garden  (south, the lower tier)
 *   steps up · your house · the rival's house · the gap in the trees north to Route 1, its tall grass  (north, upper)
 *
 * Its buildings cut away (no front wall — seen into from the side, walked into through doorways in their side walls),
 * laid out after FireRed's: your house's living room (the kitchen counter and fridge, the table on its rug, the TV,
 * plants) and, up its stairs in the corner, your bedroom (bed, PC, the TV and its console, bookshelf, plant) — where you
 * start — with a balcony off it, down crates to the lawn: a second way in and out; Prof. Oak's Lab (its bookshelves
 * and a loft along them, up off its tables; its machine; the table with the three Poké Balls); the rival's house (its
 * table, its shelves to climb, the Town Map on its wall). Its gates (the lab's door, Route 1's gate: palletStory).
 *
 * Its grass the stadium's: fur over a soft lawn (grassFur, softGrass) — short in the town, long in Route 1's tall grass.
 * Its collision (`level`: every platform hidden — the town draws its own look) and its scenery (`root`).
 * Lengths in world units (a Pokéball rolls about 0.55 across, hops about 1.4).
 */
import type { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Platform } from '../platformer/Fighter.ts';
import { grassFur } from '../render/arenas/grassFur.ts';
import { softGrass } from '../render/arenas/softGrass.ts';
import { lowPolyTree, treeMaterial } from '../render/lowPolyTrees.ts';
import { bevelBox, bookParts } from '../render/lowPolyKit.ts';
import { curtain, drape, fabric, fringe, pillow } from '../render/clothKit.ts';
import type { TreeKind } from '../render/lowPolyTrees.ts';

// ── its plan (world units) ──────────────────────────────────────────
/** The walk (z 0); how deep the floor and buildings run in front of it, where their back walls stand, the rows behind. */
const FRONT = -2.2, BACK_WALL = 1.9, GARDEN_Z = 3.4, TREES_Z = [6.5, 9];
/** The two tiers: the south (the lab, the garden) and, a low step up, the north (the houses, Route 1). */
const SOUTH_Y = 0, NORTH_Y = 1.2;
/** The town's ends: the shore (past it, the sea — closed till Surf) and the far end of Route 1's grass (closed for now). */
export const SHORE = -38, NORTH = 50;
/** The steps up from the south tier to the north: where they start, how many, how far each runs. */
const STEPS_X = 1.5, STEPS = 3, STEP_W = 0.9;
/** A doorway in a side wall (a Pokéball, or a Pokémon, rolls through); the walls' and the roofs' thickness. */
const DOOR = 1.9, WALL = 0.4, ROOF = 0.5;
/** Route 1's tall grass: as tall as the Pokéball you are is across (its height × 0.7, a small species' height ≈ 0.78). */
const TALL_GRASS = 0.55;
/** How fast a front wall fades away, or back (per s). */
const FACADE_EASE = 7;
/** The buildings: [left, right, floor, roof's underside]; your house's upstairs; its balcony. */
export const LAB = { x0: -24, x1: -10, y: SOUTH_Y, top: 5.6 };
export const HOME = { x0: 8, x1: 19, y: NORTH_Y, top: NORTH_Y + 5.8, up: NORTH_Y + 2.9 };
export const RIVAL = { x0: 23, x1: 32, y: NORTH_Y, top: NORTH_Y + 4.4 };
/**
 * Your house's stairs: floating treads (TREAD thick), rising from its right (by its doorway) to its upstairs floor at
 * its left — each a 0.7 hop above the last, the lowest's underside 0.65 off the floor (a Pokéball, 0.55 across, rolls
 * under them all), 0.6 of floor clear beside it to hop up from.
 */
const TREAD = 0.15;
const STAIRS = [{ x0: 17.2, x1: 18.0, top: 0.8 }, { x0: 16.4, x1: 17.2, top: 1.5 }, { x0: 15.6, x1: 16.4, top: 2.2 }];
/** Route 1: its gate in the gap in the trees, and its tall grass beyond. */
export const ROUTE_GATE = 37, GRASS_FROM = 38;

export interface PalletTown {
  /** Its collision: every platform hidden (its look is the scenery's). */
  level: Platform[];
  /** Where you begin: your bedroom, upstairs, by your bed. */
  start: { x: number; y: number };
  /** Its scenery: buildings, furniture, trees, the sea. */
  root: TransformNode;
  /** Its two gates' doors (meshes), for palletStory to open and close: the lab's (its right-hand doorway), Route 1's. */
  doors: { lab: Mesh; route: Mesh };
  /** Each frame, where you are: a building's front wall fades away while you are in it, and back up when you leave. */
  update(x: number, y: number, dt: number): void;
  dispose(): void;
}

/** A building's two side walls (a doorway at the foot of each, upstairs too where it has an `up`stairs door), its roof. */
function shell(b: { x0: number; x1: number; y: number; top: number }, upDoorLeft?: number): Platform[] {
  const out: Platform[] = [];
  for (const [x, upDoor] of [[b.x0, upDoorLeft], [b.x1 - WALL, undefined]] as const) {
    if (upDoor === undefined) out.push({ x, top: b.top, w: WALL, h: b.top - b.y - DOOR, hidden: true });
    else {
      // (A doorway upstairs too — out onto its balcony: its wall between the two doorways, and above the upper one.)
      out.push({ x, top: upDoor - 0.05, w: WALL, h: upDoor - 0.05 - (b.y + DOOR), hidden: true });
      out.push({ x, top: b.top, w: WALL, h: b.top - (upDoor + DOOR), hidden: true });
    }
  }
  out.push({ x: b.x0 - 0.4, top: b.top + ROOF, w: b.x1 - b.x0 + 0.8, h: ROOF, hidden: true });
  return out;
}

export function palletTown(scene: Scene): PalletTown {
  const H = HOME, L = LAB, RV = RIVAL;
  // ── collision ──────────────────────────────────────────────────────
  const steps: Platform[] = Array.from({ length: STEPS }, (_, i) => ({
    x: STEPS_X + i * STEP_W, top: SOUTH_Y + ((i + 1) * (NORTH_Y - SOUTH_Y)) / STEPS, w: STEP_W + 0.02, h: 1, hidden: true,
  }));
  const level: Platform[] = [
    // The south tier (the beach to the steps) and the north (the steps to Route 1's end), its edge a low stone wall.
    { x: SHORE, top: SOUTH_Y, w: STEPS_X - SHORE, h: 6, hidden: true },
    ...steps,
    { x: STEPS_X + STEPS * STEP_W, top: NORTH_Y, w: NORTH - (STEPS_X + STEPS * STEP_W), h: 6 + NORTH_Y, hidden: true },
    // Its ends: the sea's edge (Surf, later) and Route 1's far end (later): too high to jump.
    { x: SHORE - 1.5, top: 14, w: 1.5, h: 20, hidden: true },
    { x: NORTH, top: 14, w: 2, h: 20, hidden: true },

    // Prof. Oak's Lab: its tables, low enough to hop onto (the middle one, the three Poké Balls), and from them up onto
    // the loft along its bookshelves.
    ...shell(L),
    { x: -22.6, top: L.y + 0.9, w: 2.4, h: 0.9, hidden: true },
    { x: -18.6, top: L.y + 0.95, w: 3.2, h: 0.95, hidden: true },
    { x: -14.0, top: L.y + 0.9, w: 2.2, h: 0.9, hidden: true },
    { x: L.x0 + WALL, top: L.y + 2.2, w: 6.6, h: 0.25, hidden: true },

    // Your house: its stairs up in its right-hand corner, its upstairs floor (your bedroom) — a doorway out of its left
    // wall onto its balcony — a table downstairs; your bed a step up. Its balcony; crates down from it to the lawn.
    ...shell(H, H.up),
    { x: H.x0 + WALL, top: H.up, w: 15.6 - (H.x0 + WALL), h: 0.3, hidden: true },
    // (Its stairs floating treads, open underneath — room to roll right through below them all to its right-hand
    // doorway; going up, a hop from the floor beside the first onto it, and on up a tread at a hop: STAIRS.)
    ...STAIRS.map((t) => ({ x: t.x0, top: H.y + t.top, w: t.x1 - t.x0, h: TREAD, hidden: true })),
    { x: 11.0, top: H.y + 0.75, w: 1.8, h: 0.75, hidden: true },
    { x: H.x0 + WALL + 0.3, top: H.up + 0.6, w: 1.9, h: 0.6, hidden: true },
    { x: H.x0 - 2.6, top: H.up, w: 2.6, h: 0.25, hidden: true },
    { x: H.x0 - 3.7, top: H.y + 0.8, w: 1.1, h: 0.8, hidden: true },
    { x: H.x0 - 2.6, top: H.y + 1.6, w: 0.9, h: 0.8, hidden: true },

    // The rival's house: its table, its shelves (their tops a way across, high), the Town Map on its wall.
    ...shell(RV),
    { x: 27.2, top: RV.y + 0.75, w: 2, h: 0.75, hidden: true },
    { x: 24.0, top: RV.y + 1.15, w: 1.4, h: 1.15, hidden: true },
    { x: 29.4, top: RV.y + 1.15, w: 1.4, h: 1.15, hidden: true },

    // Outside: a bench by the garden.
    { x: -6.4, top: SOUTH_Y + 0.55, w: 1.8, h: 0.55, hidden: true },
  ];

  // ── its look ───────────────────────────────────────────────────────
  const root = new TransformNode('palletTown', scene);
  const owned: { dispose(): void }[] = [];
  const shadowGen = (scene.metadata as { shadowGen?: { addShadowCaster(m: AbstractMesh): void } } | undefined)?.shadowGen;
  const mats = new Map<string, StandardMaterial>();
  const mat = (name: string, c: [number, number, number], glow = 0.45) => {
    let m = mats.get(name);
    if (!m) {
      m = new StandardMaterial(`pallet_${name}`, scene);
      m.diffuseColor = new Color3(...c);
      m.emissiveColor = new Color3(...c).scale(glow);
      m.specularColor = new Color3(0.03, 0.03, 0.03);
      mats.set(name, m);
    }
    return m;
  };
  const place = (mesh: Mesh, m: StandardMaterial, shadow = false) => {
    mesh.material = m; mesh.parent = root; mesh.isPickable = false; mesh.receiveShadows = true;
    if (shadow) shadowGen?.addShadowCaster(mesh);
    return mesh;
  };
  /**
   * A box from (x0, y0, z0) to (x1, y1, z1) — bevelled (lowPolyKit: every edge chamfered, so nothing reads as flat
   * card), a plain box only for the ground's big slabs and the paper-thin.
   */
  const box = (name: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: StandardMaterial, shadow = false) => {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0, least = Math.min(w, h, d);
    const b = Math.max(w, h, d) > 20 || least < 0.01 ? MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene)
      : bevelBox(name, scene, w, h, d, Math.min(0.05, least * 0.22));
    b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return place(b, m, shadow);
  };
  const ball = (name: string, x: number, y: number, z: number, d: number, m: StandardMaterial, seg = 10) => {
    const s = MeshBuilder.CreateSphere(name, { diameter: d, segments: seg }, scene);
    s.position.set(x, y, z);
    return place(s, m);
  };
  const cyl = (name: string, x: number, y0: number, y1: number, z: number, d: number, m: StandardMaterial, dTop = d, sides = 12) => {
    const c = MeshBuilder.CreateCylinder(name, { height: y1 - y0, diameterTop: dTop, diameterBottom: d, tessellation: sides }, scene);
    c.position.set(x, (y0 + y1) / 2, z);
    return place(c, m);
  };

  const C = {
    earth: mat('earth', [0.45, 0.32, 0.2]), stone: mat('stone', [0.62, 0.62, 0.6]), stoneDark: mat('stoneDark', [0.46, 0.46, 0.45]),
    path: mat('path', [0.82, 0.72, 0.5], 0.3), sand: mat('sand', [0.88, 0.78, 0.52], 0.22), sea: mat('sea', [0.2, 0.52, 0.86], 0.6), foam: mat('foam', [0.92, 0.97, 1], 0.7),
    wallHome: mat('wallHome', [0.97, 0.93, 0.83]), trim: mat('trim', [0.6, 0.42, 0.26]), roofRed: mat('roofRed', [0.86, 0.32, 0.22]), roofRedDark: mat('roofRedDark', [0.7, 0.24, 0.17]),
    wallLab: mat('wallLab', [0.9, 0.91, 0.93]), roofLab: mat('roofLab', [0.48, 0.5, 0.6]), roofLabDark: mat('roofLabDark', [0.38, 0.4, 0.5]), window: mat('window', [0.6, 0.82, 0.97], 0.75),
    wood: mat('wood', [0.66, 0.45, 0.27]), woodDark: mat('woodDark', [0.45, 0.29, 0.17]), floor: mat('floor', [0.8, 0.62, 0.42]), floorLight: mat('floorLight', [0.88, 0.72, 0.5]),
    labFloor: mat('labFloor', [0.84, 0.84, 0.8]), white: mat('white', [0.97, 0.97, 0.97]), red: mat('red', [0.88, 0.16, 0.14]),
    black: mat('black', [0.1, 0.1, 0.12], 0.2), green: mat('green', [0.25, 0.58, 0.3]), rug: mat('rug', [0.34, 0.62, 0.52]), rugEdge: mat('rugEdge', [0.95, 0.9, 0.7]),
    leaf: mat('leaf', [0.18, 0.5, 0.25]), leafLight: mat('leafLight', [0.3, 0.62, 0.3]), trunk: mat('trunk', [0.42, 0.28, 0.16]),
    flowerR: mat('flowerR', [0.92, 0.25, 0.3], 0.7), flowerY: mat('flowerY', [0.98, 0.84, 0.25], 0.7), flowerW: mat('flowerW', [0.98, 0.98, 1], 0.7),
    fence: mat('fence', [0.96, 0.96, 0.92]), blue: mat('blue', [0.28, 0.45, 0.82]), sheet: mat('sheet', [0.92, 0.95, 1]), tv: mat('tv', [0.16, 0.18, 0.24], 0.3),
    screen: mat('screen', [0.45, 0.7, 0.95], 0.85), machine: mat('machine', [0.56, 0.6, 0.68]), metal: mat('metal', [0.75, 0.78, 0.82]),
    book: [mat('bookR', [0.75, 0.25, 0.22]), mat('bookB', [0.25, 0.4, 0.75]), mat('bookG', [0.3, 0.6, 0.35]), mat('bookY', [0.9, 0.75, 0.3]),
      mat('bookBrown', [0.5, 0.32, 0.2]), mat('bookPurple', [0.5, 0.32, 0.65]), mat('bookTeal', [0.2, 0.55, 0.58]), mat('bookNavy', [0.16, 0.22, 0.42])],
    pages: mat('pages', [0.96, 0.92, 0.8]), shutter: mat('shutter', [0.3, 0.45, 0.75]), shutterGreen: mat('shutterGreen', [0.3, 0.58, 0.38]), labelRed: mat('labelRed', [0.55, 0.16, 0.14]),
    pot: mat('pot', [0.72, 0.42, 0.28]), lamp: mat('lamp', [1, 0.93, 0.7], 0.9), crate: mat('crate', [0.72, 0.52, 0.3]),
    seam: mat('seam', [0.55, 0.4, 0.26], 0.3), wainscot: mat('wainscot', [0.78, 0.6, 0.42]), labPanel: mat('labPanel', [0.74, 0.78, 0.84]),
    trimDark: mat('trimDark', [0.42, 0.28, 0.17]), plaster: mat('plaster', [0.95, 0.9, 0.8]), curtain: mat('curtain', [0.9, 0.5, 0.45]),
    roofLabLight: mat('roofLabLight', [0.56, 0.58, 0.68]), roofRedLight: mat('roofRedLight', [0.92, 0.42, 0.3]),
    machineDark: mat('machineDark', [0.38, 0.42, 0.5]), door: mat('door', [0.55, 0.36, 0.22]), gold: mat('gold', [0.92, 0.75, 0.3], 0.6),
    flowerP: mat('flowerP', [0.75, 0.45, 0.9], 0.7), potDark: mat('potDark', [0.6, 0.33, 0.22]), soil: mat('soil', [0.3, 0.2, 0.13], 0.3),
    cabinet: mat('cabinet', [0.94, 0.9, 0.8]), cabinetDark: mat('cabinetDark', [0.86, 0.8, 0.68]), tileWall: mat('tileWall', [0.82, 0.9, 0.92]),
    tvDark: mat('tvDark', [0.08, 0.09, 0.12], 0.2), blueDark: mat('blueDark', [0.2, 0.32, 0.65]), consoleGrey: mat('consoleGrey', [0.66, 0.66, 0.72]),
    paper: mat('paper', [0.93, 0.86, 0.74]), paperGreen: mat('paperGreen', [0.82, 0.88, 0.76]),
    fridge: mat('fridge', [0.92, 0.94, 0.96]), counter: mat('counter', [0.86, 0.8, 0.7]), mapGreen: mat('mapGreen', [0.42, 0.7, 0.42]), mapBlue: mat('mapBlue', [0.4, 0.62, 0.9]),
  };

  // Cloth (clothKit): woven fabrics — matte, both sides drawn — for what is draped, hung and stuffed.
  const F = {
    quilt: fabric(scene, 'pallet_quilt', 'quilt', [0.3, 0.48, 0.86], [0.52, 0.68, 0.95], 1.6),
    sheet: fabric(scene, 'pallet_sheet', 'plain', [0.94, 0.95, 0.98], [0.94, 0.95, 0.98], 2),
    pillow: fabric(scene, 'pallet_pillow', 'stripe', [0.98, 0.98, 0.98], [0.86, 0.9, 0.98], 2),
    curtain: fabric(scene, 'pallet_curtain', 'stripe', [0.92, 0.52, 0.46], [0.97, 0.78, 0.68], 2.4),
    curtainGreen: fabric(scene, 'pallet_curtainGreen', 'stripe', [0.48, 0.72, 0.5], [0.8, 0.9, 0.74], 2.4),
    rug: fabric(scene, 'pallet_rug', 'check', [0.34, 0.62, 0.52], [0.95, 0.9, 0.7], 0.8),
    rugRed: fabric(scene, 'pallet_rugRed', 'check', [0.75, 0.32, 0.3], [0.96, 0.86, 0.66], 0.8),
    cloth: fabric(scene, 'pallet_cloth', 'check', [0.97, 0.96, 0.93], [0.86, 0.3, 0.28], 2.2),
    tassel: fabric(scene, 'pallet_tassel', 'plain', [0.95, 0.9, 0.72], [0.95, 0.9, 0.72], 4),
  };
  for (const m of Object.values(F)) owned.push(m);
  const cloth = (mesh: Mesh, m: StandardMaterial, shadow = true) => place(mesh, m, shadow);

  // ── the ground: soft lawn under the stadium's fur grass ──
  const lawnMat = new StandardMaterial('pallet_lawn', scene);
  lawnMat.diffuseColor = new Color3(0.42, 0.7, 0.3);
  lawnMat.specularColor = Color3.Black();
  owned.push(lawnMat, softGrass(scene, lawnMat, 20, 20, 11));
  const lawn = (name: string, x0: number, x1: number, y: number, z0: number, z1: number, seed: number, opts: { height?: number; clump?: number; tile?: number } = {}): void => {
    // (No grass on the path you roll along: its fur would grow up through it, over the Pokéball's foot — the lawn cut
    // either side of it.)
    if (z0 < -PATH_HALF && z1 > PATH_HALF && x0 >= PATH_FROM - 1e-6 && x1 <= PATH_TO + 1e-6) {
      lawn(`${name}Front`, x0, x1, y, z0, -PATH_HALF, seed, opts);
      lawn(`${name}Back`, x0, x1, y, PATH_HALF, z1, seed + 50, opts);
      return;
    }
    const g = MeshBuilder.CreateGround(name, { width: x1 - x0, height: z1 - z0, subdivisions: 2 }, scene);
    g.position.set((x0 + x1) / 2, y + 0.001, (z0 + z1) / 2);
    place(g, lawnMat);
    owned.push(grassFur(scene, g, lawnMat, x1 - x0, z1 - z0, 1, seed, opts));
  };
  const BACK = TREES_Z[1] + 3, FRONT_EDGE = FRONT - 8;
  /** The sandy path along the walk: from the beach to Route 1's tall grass (where the grass is meant to swallow you). */
  const PATH_HALF = 0.9, PATH_FROM = L.x0 - 6, PATH_TO = GRASS_FROM;
  // (The earth under it: the south tier, the north, the stone wall where the north rises from the south.)
  const northX = STEPS_X + STEPS * STEP_W;
  box('southEarth', SHORE, northX, -6, SOUTH_Y, FRONT_EDGE, BACK, C.earth);
  box('northEarth', northX, NORTH + 2, -6, NORTH_Y, FRONT_EDGE, BACK, C.earth);
  box('tierWall', northX - 0.25, northX, SOUTH_Y, NORTH_Y, FRONT_EDGE, BACK, C.stone);
  // (The steps run the tier's whole depth, under the walk and back to the trees.)
  for (const [i, s] of steps.entries()) box(`step${i}`, s.x, s.x + s.w, SOUTH_Y, s.top, FRONT_EDGE, BACK, C.stone);
  // The lawns (not under the buildings: their floors are their own), and Route 1's tall grass.
  lawn('lawnSouthA', -15 + 5, -0.2, SOUTH_Y, FRONT_EDGE, BACK, 3);
  lawn('lawnSouthB', L.x0 - 6, L.x0, SOUTH_Y, FRONT_EDGE, BACK, 4);
  lawn('lawnSouthBack', L.x0, L.x1, SOUTH_Y, BACK_WALL + 0.25, BACK, 6);
  lawn('lawnNorthA', northX, H.x0, NORTH_Y, FRONT_EDGE, BACK, 7);
  lawn('lawnNorthB', H.x1, RV.x0, NORTH_Y, FRONT_EDGE, BACK, 8);
  lawn('lawnNorthBackA', H.x0, H.x1, NORTH_Y, BACK_WALL + 0.25, BACK, 9);
  lawn('lawnNorthBackB', RV.x0, RV.x1, NORTH_Y, BACK_WALL + 0.25, BACK, 10);
  lawn('lawnNorthC', RV.x1, GRASS_FROM, NORTH_Y, FRONT_EDGE, BACK, 12);
  // (And in front of the buildings, a strip of lawn up to their cut-away fronts.)
  lawn('lawnFrontLab', L.x0, L.x1, SOUTH_Y, FRONT_EDGE, FRONT, 14);
  lawn('lawnFrontHome', H.x0, H.x1, NORTH_Y, FRONT_EDGE, FRONT, 15);
  lawn('lawnFrontRival', RV.x0, RV.x1, NORTH_Y, FRONT_EDGE, FRONT, 16);
  // (Route 1's tall grass: the same fur, longer, clumped, a deeper green.)
  const tallMat = new StandardMaterial('pallet_tallGrass', scene);
  tallMat.diffuseColor = new Color3(0.26, 0.56, 0.22);
  tallMat.specularColor = Color3.Black();
  owned.push(tallMat, softGrass(scene, tallMat, 14, 20, 21));
  {
    const x0 = GRASS_FROM, x1 = NORTH + 2, g = MeshBuilder.CreateGround('route1Grass', { width: x1 - x0, height: BACK - FRONT_EDGE, subdivisions: 2 }, scene);
    g.position.set((x0 + x1) / 2, NORTH_Y + 0.001, (FRONT_EDGE + BACK) / 2);
    place(g, tallMat);
    owned.push(grassFur(scene, g, tallMat, x1 - x0, BACK - FRONT_EDGE, 1, 13, { height: TALL_GRASS, clump: 0.15, tile: 1.4 }));
  }
  // A sandy path along the walk, the beach, the sea and its foam.
  box('pathSouth', PATH_FROM, northX, SOUTH_Y - 0.05, SOUTH_Y + 0.004, -0.9, 0.9, C.path);
  box('pathNorth', northX, PATH_TO, NORTH_Y - 0.05, NORTH_Y + 0.004, -0.9, 0.9, C.path);
  box('beach', SHORE, L.x0 - 6, SOUTH_Y - 0.2, SOUTH_Y + 0.002, FRONT_EDGE, BACK, C.sand);
  box('sea', SHORE - 90, SHORE, SOUTH_Y - 1.1, SOUTH_Y - 0.25, -45, 45, C.sea);
  box('seaBed', SHORE - 90, SHORE, -6, SOUTH_Y - 1.1, -45, 45, C.sand);
  for (let z = FRONT_EDGE; z < BACK; z += 1.6) box('foam', SHORE - 0.6, SHORE, SOUTH_Y - 0.3, SOUTH_Y - 0.18, z, z + 1.1, C.foam);
  for (const [x, z, s] of [[-34, -1.6, 0.6], [-31, 3.5, 0.9], [-29, -2.2, 0.45], [-36.5, 6, 1.1]] as const) {
    const r = ball('beachRock', x, SOUTH_Y + s * 0.25, z, s, C.stoneDark, 6); r.scaling.y = 0.6;
  }

  // ── a building: its floor (planked), its back wall (panelled, framed windows), its side walls (doorways), the
  // cut-away front framed in timber, and its roof: a shingled gable, its ridge capped, its gable ends closed ──
  const building = (name: string, b: { x0: number; x1: number; y: number; top: number }, wall: StandardMaterial, tiles: StandardMaterial[],
    floor: StandardMaterial, o: { upDoorLeft?: number; upFloor?: number; windows?: number[]; chimney?: number; paper?: StandardMaterial; panel?: StandardMaterial; curtains?: StandardMaterial } = {}) => {
    box(`${name}Floor`, b.x0, b.x1, b.y - 0.2, b.y + 0.012, FRONT, BACK_WALL, floor);
    // (Its floorboards: a fine seam between each, along the building.)
    for (let z = FRONT + 0.42; z < BACK_WALL - 0.1; z += 0.42) box(`${name}Seam`, b.x0 + WALL, b.x1 - WALL, b.y + 0.007, b.y + 0.009, z, z + 0.025, C.seam);
    box(`${name}Back`, b.x0, b.x1, b.y, b.top, BACK_WALL, BACK_WALL + 0.25, wall, true);
    // Its back wall inside: wainscot panels below a rail, wallpaper stripes above (a house), a moulding under the ceiling
    // — on each storey.
    for (const fy of [b.y, o.upFloor].filter((v): v is number => v !== undefined)) {
      const panel = o.panel ?? C.wainscot;
      box(`${name}Wainscot`, b.x0 + WALL, b.x1 - WALL, fy, fy + 0.85, BACK_WALL - 0.04, BACK_WALL, panel);
      for (let x = b.x0 + WALL + 0.55; x < b.x1 - WALL - 0.3; x += 0.75) box(`${name}PanelLine`, x, x + 0.04, fy + 0.12, fy + 0.75, BACK_WALL - 0.055, BACK_WALL - 0.04, C.trim);
      box(`${name}Rail`, b.x0 + WALL, b.x1 - WALL, fy + 0.85, fy + 0.93, BACK_WALL - 0.08, BACK_WALL, C.trim);
      box(`${name}Skirting`, b.x0 + WALL, b.x1 - WALL, fy, fy + 0.14, BACK_WALL - 0.07, BACK_WALL - 0.04, C.trim);
      if (o.paper) for (let x = b.x0 + WALL + 0.25; x < b.x1 - WALL; x += 0.5) box(`${name}Stripe`, x, x + 0.18, fy + 0.93, fy + 2.6, BACK_WALL - 0.015, BACK_WALL, o.paper);
    }
    box(`${name}Crown`, b.x0 + WALL, b.x1 - WALL, b.top - 0.16, b.top, BACK_WALL - 0.1, BACK_WALL, C.trim);
    for (const [x, upDoor] of [[b.x0, o.upDoorLeft], [b.x1 - WALL, undefined]] as const) {
      const lo = b.y + DOOR;
      if (upDoor === undefined) box(`${name}Side`, x, x + WALL, lo, b.top, FRONT, BACK_WALL + 0.25, wall, true);
      else {
        box(`${name}Side`, x, x + WALL, lo, upDoor - 0.05, FRONT, BACK_WALL + 0.25, wall, true);
        box(`${name}Side`, x, x + WALL, upDoor + DOOR, b.top, FRONT, BACK_WALL + 0.25, wall, true);
      }
      // (Its doorways' frames, front and back of the wall; a doorstep.)
      for (const y0 of [b.y, upDoor].filter((v): v is number => v !== undefined)) {
        box(`${name}Jamb`, x - 0.04, x + WALL + 0.04, y0, y0 + DOOR, FRONT, FRONT + 0.3, C.trim);
        box(`${name}Jamb`, x - 0.04, x + WALL + 0.04, y0, y0 + DOOR, BACK_WALL - 0.3, BACK_WALL + 0.25, C.trim);
        box(`${name}Lintel`, x - 0.08, x + WALL + 0.08, y0 + DOOR - 0.14, y0 + DOOR + 0.04, FRONT, BACK_WALL + 0.25, C.trim);
      }
    }
    // The cut-away front, framed like a dollhouse's: timber posts at its corners, a header beam along its top (and
    // along the upstairs floor's edge).
    for (const x of [b.x0 - 0.06, b.x1 - 0.2]) box(`${name}Post`, x, x + 0.26, b.y, b.top + 0.05, FRONT - 0.12, FRONT + 0.14, C.trimDark, true);
    box(`${name}Header`, b.x0 - 0.06, b.x1 + 0.06, b.top - 0.3, b.top + 0.05, FRONT - 0.12, FRONT + 0.14, C.trimDark, true);
    if (o.upFloor !== undefined) box(`${name}FloorBeam`, b.x0 + 0.2, b.x1 - 0.2, o.upFloor - 0.34, o.upFloor - 0.012, FRONT - 0.08, FRONT + 0.12, C.trimDark);
    roof(name, b, tiles);
    if (o.chimney !== undefined) chimney(name, o.chimney, b.top + ROOF);
    // Its windows in its back wall: framed, a sill, four panes, curtains either side (a house's).
    for (const cx of o.windows ?? []) for (const fy of [b.y, o.upFloor].filter((v): v is number => v !== undefined)) {
      const y0 = fy + 1.25, y1 = fy + 2.25;
      if (y1 > b.top - 0.3) continue;
      box(`${name}WinFrame`, cx - 0.72, cx + 0.72, y0 - 0.1, y1 + 0.1, BACK_WALL - 0.05, BACK_WALL, C.trim);
      box(`${name}Window`, cx - 0.6, cx + 0.6, y0, y1, BACK_WALL - 0.07, BACK_WALL - 0.04, C.window);
      box(`${name}WinBar`, cx - 0.035, cx + 0.035, y0, y1, BACK_WALL - 0.09, BACK_WALL - 0.06, C.trim);
      box(`${name}WinBar`, cx - 0.6, cx + 0.6, (y0 + y1) / 2 - 0.035, (y0 + y1) / 2 + 0.035, BACK_WALL - 0.09, BACK_WALL - 0.06, C.trim);
      box(`${name}Sill`, cx - 0.85, cx + 0.85, y0 - 0.2, y0 - 0.1, BACK_WALL - 0.2, BACK_WALL, C.trim);
      if (o.curtains) for (const side of [-1, 1]) {
        // (A pleated curtain each side, tied back toward its own side; its tie-back a band round the gathered waist.)
        const c0 = cx + side * 0.62 - 0.27, c1 = cx + side * 0.62 + 0.27, tight = 0.5, tieY = y0 - 0.15 + 0.42 * (y1 + 0.27 - (y0 - 0.15));
        cloth(curtain(`${name}Curtain`, scene, c0, c1, y1 + 0.27, y0 - 0.15, BACK_WALL - 0.1, { pleats: 4, depth: 0.05, tie: 0.42, tight, gather: side, tile: 1 }), o.curtains);
        const anchor = side < 0 ? c0 : c1, mid = anchor + ((c0 + c1) / 2 - anchor) * (1 - tight), half = ((c1 - c0) * (1 - tight)) / 2 + 0.03;
        box(`${name}CurtainTie`, mid - half, mid + half, tieY - 0.04, tieY + 0.04, BACK_WALL - 0.26, BACK_WALL - 0.06, C.white);
      }
      box(`${name}Rod`, cx - 0.95, cx + 0.95, y1 + 0.25, y1 + 0.3, BACK_WALL - 0.14, BACK_WALL - 0.1, C.trimDark);
    }
  };
  /**
   * Its roof over `b`: a gable along it (its ridge over its middle, front to back), each slope rows of overlapping
   * shingles (each a bevelled tile, staggered row on row, a little askew, two or three shades), its ridge capped, its
   * fascia and barge boards in timber, its gable ends closed in plaster — merged into one mesh (one shadow caster).
   */
  const roof = (name: string, b: { x0: number; x1: number; top: number }, tiles: StandardMaterial[]) => {
    const x0 = b.x0 - 0.5, x1 = b.x1 + 0.5, zf = FRONT - 0.55, zb = BACK_WALL + 0.75, zm = (zf + zb) / 2, y0 = b.top + ROOF, rise = 1.9;
    // (Its fascia: the board round its eaves, the level roof under the slopes — where the collision's roof is.)
    box(`${name}Fascia`, x0 + 0.05, x1 - 0.05, b.top, y0, zf + 0.05, zb - 0.05, C.trimDark, true);
    const parts: Mesh[] = [];
    const run = zm - zf, len = Math.hypot(run, rise), ang = Math.atan2(rise, run);
    const rows = Math.ceil(len / 0.36);
    let seed = Math.round(b.x0 * 13) + 99;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed % 10000) / 10000; };
    for (const side of [1, -1]) {
      const edge = side === 1 ? zf : zb;
      for (let r = 0; r < rows; r++) {
        // (Each row a little up the slope from the last, overlapping it; staggered by half a tile.)
        const s = ((r + 0.5) / rows) * len;
        const zc = edge + side * Math.cos(ang) * s, yc = y0 + Math.sin(ang) * s + 0.06;
        for (let x = x0 - (r % 2) * 0.3; x < x1 - 0.05;) {
          const w = Math.min(0.5 + rnd() * 0.3, x1 - x);
          const xa = Math.max(x, x0);
          if (x + w - xa > 0.08) {
            const t = bevelBox(`${name}Tile`, scene, x + w - xa - 0.03, 0.07, 0.5, 0.025);
            t.position.set((xa + x + w) / 2, yc + (rnd() - 0.5) * 0.02, zc);
            t.rotation.set(-side * ang + (rnd() - 0.5) * 0.04, 0, (rnd() - 0.5) * 0.05);
            const pick = rnd();
            t.material = tiles[pick < 0.6 ? 0 : pick < 0.88 ? 1 : 2];
            parts.push(t);
          }
          x += w;
        }
      }
      // (Its barge boards: along the slope at each gable end.)
      for (const bx of [x0 - 0.02, x1 + 0.02]) {
        const bb = bevelBox(`${name}Barge`, scene, 0.12, 0.22, len + 0.1, 0.03);
        bb.position.set(bx, y0 + rise / 2 + 0.1, (edge + zm) / 2);
        bb.rotation.x = -side * ang;
        bb.material = C.trimDark; parts.push(bb);
      }
    }
    // Its ridge cap.
    const cap = bevelBox(`${name}Ridge`, scene, x1 - x0 + 0.2, 0.2, 0.42, 0.06);
    cap.position.set((x0 + x1) / 2, y0 + rise + 0.1, zm); cap.material = C.trimDark; parts.push(cap);
    // Its gable ends: plaster triangles under the slopes, a round vent in each.
    for (const gx of [b.x0 + 0.1, b.x1 - 0.1]) {
      const tri = MeshBuilder.CreateCylinder(`${name}Gable`, { height: 0.2, diameter: 1, tessellation: 3 }, scene);
      tri.rotation.z = Math.PI / 2;
      tri.scaling.set(rise / 0.75, 1, (zb - zf - 0.4) / 0.866);
      tri.position.set(gx, y0 + 0.25 * (rise / 0.75) - 0.02, zm);
      tri.material = C.plaster; parts.push(tri);
      const vent = MeshBuilder.CreateCylinder(`${name}Vent`, { height: 0.24, diameter: 0.45, tessellation: 12 }, scene);
      vent.rotation.z = Math.PI / 2; vent.position.set(gx, y0 + rise * 0.42, zm); vent.material = C.trimDark; parts.push(vent);
    }
    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
    merged.name = `${name}Roof`; merged.parent = root; merged.isPickable = false; merged.receiveShadows = true;
    shadowGen?.addShadowCaster(merged);
  };
  /** A chimney through its roof: stone, banded, a cap, a pot. */
  const chimney = (name: string, x: number, y: number) => {
    box(`${name}Chimney`, x, x + 0.85, y, y + 2.3, 0.9, 1.7, C.stone, true);
    for (let k = 0; k < 4; k++) box(`${name}Brick`, x - 0.01, x + 0.86, y + 0.9 + k * 0.38, y + 0.93 + k * 0.38, 0.89, 1.71, C.stoneDark);
    box(`${name}ChimneyCap`, x - 0.1, x + 0.95, y + 2.3, y + 2.45, 0.8, 1.8, C.stoneDark, true);
    cyl(`${name}ChimneyPot`, x + 0.42, y + 2.45, y + 2.75, 1.3, 0.3, C.pot, 0.26, 10);
  };
  // Books (lowPolyKit.bookParts): boards, a cream page block, a rounded spine with gilt bands and a label — each
  // stood (or laid, or leaning) where its shelf puts it; a shelf's books merged into one mesh.
  interface Book { x: number; y: number; z: number; w: number; h: number; d: number; lean?: number; lie?: boolean; turn?: number; k: number }
  const shelfBooks = (name: string, books: Book[]) => {
    if (!books.length) return;
    const parts: Mesh[] = [], pivots: TransformNode[] = [];
    for (const b of books) {
      const pivot = new TransformNode(`${name}BookPivot`, scene);
      // (Leaning: tipped about its foot's far corner, onto the next. Lying: on its side, its spine still out.)
      pivot.position.set(b.x + (b.lean ? -b.w / 2 : 0), b.y, b.z);
      if (b.lie) { pivot.rotation.z = Math.PI / 2; pivot.position.x = b.x; pivot.position.y = b.y + b.w / 2; pivot.position.x -= -b.h / 2; pivot.rotation.y = b.turn ?? 0; }
      else if (b.lean) pivot.rotation.z = b.lean;
      const k = Math.abs(b.k);
      const look = { cover: C.book[k % C.book.length], pages: C.pages, band: (k % 3) ? C.gold : C.pages, label: (k % 2) ? C.pages : C.labelRed, style: k % 3 };
      const ps = bookParts(scene, pivot, b.w, b.h, b.d, look);
      if (b.lean) for (const m of ps) m.position.x += b.w / 2;
      parts.push(...ps); pivots.push(pivot);
    }
    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
    for (const p of pivots) p.dispose();
    merged.name = `${name}Books`; merged.parent = root; merged.isPickable = false; merged.receiveShadows = true;
    shadowGen?.addShadowCaster(merged);
  };
  /** A bookcase: open-fronted (its sides, top, bottom, back and shelf boards), its books — varied, some leaning. */
  const shelf = (name: string, x0: number, x1: number, y0: number, y1: number, z1: number, solid = false) => {
    const z0 = z1 - 0.55, t = 0.07;
    box(`${name}Back`, x0, x1, y0, y1, z1 - 0.04, z1, C.woodDark);
    for (const x of [x0, x1 - t]) box(`${name}Side`, x, x + t, y0, y1 - t, z0, z1, C.wood, true);
    box(`${name}Top`, x0 - 0.04, x1 + 0.04, y1 - t, y1, z0 - 0.04, z1, C.wood, true);
    box(`${name}Plinth`, x0, x1, y0, y0 + 0.1, z0, z1, C.woodDark);
    const rows = Math.max(1, Math.round((y1 - y0) / 0.6));
    const books: Book[] = [];
    for (let r = 0; r < rows; r++) {
      const ry = y0 + 0.1 + (r * (y1 - y0 - 0.17)) / rows, rh = (y1 - y0 - 0.17) / rows;
      if (r > 0) box(`${name}Board`, x0 + t, x1 - t, ry - 0.04, ry, z0, z1, C.wood);
      let x = x0 + t + 0.03, i = r * 7 + Math.abs(Math.round(x0 * 5));
      while (x < x1 - t - 0.1) {
        i++;
        const w = 0.07 + ((i * 37) % 5) * 0.014, hgt = Math.min(rh - 0.08, 0.26 + ((i * 13) % 4) * 0.045), dep = 0.3 + ((i * 7) % 3) * 0.03;
        if ((i * 31) % 11 === 0 && x + 0.42 < x1 - t) {
          // (A short stack lying flat, each a little smaller than the one under it, a touch askew.)
          let sy = ry;
          for (let k = 0; k < 3; k++) {
            const bw = 0.36 - k * 0.035, th = 0.055 + ((i + k) % 2) * 0.015;
            books.push({ x: x + bw / 2, y: sy, z: z1 - 0.08 - (0.3 - k * 0.02) / 2, w: th, h: bw, d: 0.3 - k * 0.02, lie: true, turn: (k - 1) * 0.06, k: i + k });
            sy += th;
          }
          x += 0.42; continue;
        }
        let lean = 0;
        if ((i * 17) % 9 === 0) { lean = -0.2; x += 0.05; }
        books.push({ x: x + w / 2, y: ry, z: z1 - 0.08 - dep / 2, w, h: hgt, d: dep, lean, k: i });
        x += w + 0.006;
      }
    }
    shelfBooks(name, books);
    if (solid) box(`${name}Doors`, x0 + t, x1 - t, y0 + 0.1, y1 - t, z0 - 0.02, z0, C.wood);
  };
  /** A pot plant: a tapered pot (a rim, its soil), leafy faceted clumps. */
  const plant = (name: string, x: number, y: number, z: number, s = 1) => {
    cyl(`${name}Pot`, x, y, y + 0.36 * s, z, 0.3 * s, C.pot, 0.4 * s, 10);
    cyl(`${name}Rim`, x, y + 0.32 * s, y + 0.4 * s, z, 0.45 * s, C.potDark, 0.45 * s, 10);
    cyl(`${name}Soil`, x, y + 0.39 * s, y + 0.41 * s, z, 0.38 * s, C.soil, 0.38 * s, 10);
    const leaves = [[0, 0.75, 0, 0.36], [0.16, 0.62, 0.05, 0.26], [-0.15, 0.6, -0.04, 0.27], [0.04, 0.95, -0.06, 0.22], [-0.05, 0.62, 0.15, 0.22]];
    for (const [k, [dx, dy, dz, r]] of leaves.entries()) {
      const l = MeshBuilder.CreateIcoSphere(`${name}Leaf`, { radius: r * s, subdivisions: 1, flat: true }, scene);
      l.position.set(x + dx * s, y + dy * s, z + dz * s); l.rotation.set(k, k * 2, k * 0.5); l.scaling.y = 0.85;
      place(l, k % 2 ? C.leafLight : C.leaf);
    }
  };
  /** A rug: woven (its check), its edges bound, tassels along its two ends. */
  const rug = (name: string, x0: number, x1: number, y: number, z0: number, z1: number, m: StandardMaterial = F.rug) => {
    box(`${name}Edge`, x0, x1, y + 0.012, y + 0.018, z0, z1, C.rugEdge);
    const top = MeshBuilder.CreateGround(name, { width: x1 - x0 - 0.16, height: z1 - z0 - 0.16 }, scene);
    top.position.set((x0 + x1) / 2, y + 0.024, (z0 + z1) / 2);
    cloth(top, m, false);
    for (const [z, dir] of [[z0, -1], [z1, 1]] as const) cloth(fringe(`${name}Fringe`, scene, x0 + 0.05, x1 - 0.05, y + 0.017, z, dir, 0.12), F.tassel, false);
  };
  /** A tablecloth over a table's top (x0..x1, its top at `top`), hanging `drop` all round, in folds. */
  const tablecloth = (name: string, x0: number, x1: number, top: number, m: StandardMaterial, drop = 0.22) =>
    cloth(drape(name, scene, x0 + 0.02, x1 - 0.02, -0.88, 0.88, top + 0.004, { drop: [drop, drop, drop, drop], round: 0.03, folds: 0.02, foldFreq: 3.5, tile: 1.3 }), m);
  /** A table: its top overhanging an apron, four square legs — its top at `y + top`. */
  const table = (name: string, x0: number, x1: number, y: number, top: number, topM: StandardMaterial = C.wood, legM: StandardMaterial = C.woodDark) => {
    box(`${name}Top`, x0, x1, y + top - 0.1, y + top, -0.9, 0.9, topM, true);
    box(`${name}Apron`, x0 + 0.12, x1 - 0.12, y + top - 0.24, y + top - 0.1, -0.78, 0.78, legM);
    for (const x of [x0 + 0.12, x1 - 0.24]) for (const z of [-0.78, 0.66]) box(`${name}Leg`, x, x + 0.12, y, y + top - 0.1, z, z + 0.12, legM, true);
  };
  /** A chair at (`x`, `z`) — behind the table, off the walk — its back away from it (toward +z). */
  const chair = (name: string, x: number, y: number, z: number) => {
    box(`${name}Seat`, x - 0.25, x + 0.25, y + 0.4, y + 0.47, z - 0.25, z + 0.25, C.wood, true);
    for (const dx of [-0.21, 0.13]) for (const dz of [-0.21, 0.13]) box(`${name}Leg`, x + dx, x + dx + 0.08, y, y + 0.4, z + dz, z + dz + 0.08, C.woodDark);
    const bz = z + 0.22;
    for (const dx of [-0.22, 0.14]) box(`${name}Stile`, x + dx, x + dx + 0.08, y + 0.47, y + 1.05, bz - 0.04, bz + 0.04, C.woodDark);
    box(`${name}BackRail`, x - 0.2, x + 0.2, y + 0.82, y + 1.0, bz - 0.035, bz + 0.035, C.wood);
  };
  /** A crate: its planked sides, a frame round each face, a brace across. */
  const crate = (name: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    box(name, x0 + 0.02, x1 - 0.02, y0, y1 - 0.02, z0 + 0.02, z1 - 0.02, C.crate, true);
    for (const [a, c] of [[x0, x0 + 0.1], [x1 - 0.1, x1]]) box(`${name}Frame`, a, c, y0 + 0.1, y1 - 0.1, z0, z1, C.woodDark);
    box(`${name}Frame`, x0, x1, y1 - 0.1, y1, z0, z1, C.woodDark);
    box(`${name}Frame`, x0, x1, y0, y0 + 0.1, z0, z1, C.woodDark);
    for (let y = y0 + 0.25; y < y1 - 0.15; y += 0.22) box(`${name}Plank`, x0 + 0.1, x1 - 0.1, y, y + 0.015, z0 - 0.005, z0, C.woodDark);
    const brace = bevelBox(`${name}Brace`, scene, Math.hypot(x1 - x0 - 0.2, y1 - y0 - 0.2), 0.09, 0.04, 0.015);
    brace.position.set((x0 + x1) / 2, (y0 + y1) / 2, z0 - 0.02); brace.rotation.z = Math.atan2(y1 - y0 - 0.2, x1 - x0 - 0.2);
    place(brace, C.woodDark);
  };
  /** A signboard on two posts: framed, its face. */
  const sign = (name: string, x0: number, x1: number, y: number, z: number, face: StandardMaterial = C.wood) => {
    for (const x of [x0 + 0.08, x1 - 0.18]) box(`${name}Post`, x, x + 0.1, y, y + 1.25, z, z + 0.1, C.woodDark, true);
    box(`${name}Board`, x0, x1, y + 0.7, y + 1.3, z - 0.06, z, C.woodDark, true);
    box(`${name}Face`, x0 + 0.06, x1 - 0.06, y + 0.76, y + 1.24, z - 0.075, z - 0.06, face);
    box(`${name}Lines`, x0 + 0.18, x1 - 0.3, y + 1.06, y + 1.1, z - 0.08, z - 0.075, C.woodDark);
    box(`${name}Lines`, x0 + 0.18, x1 - 0.5, y + 0.92, y + 0.96, z - 0.08, z - 0.075, C.woodDark);
  };
  /** A mailbox on its post: a rounded top, its flag. */
  const mailbox = (name: string, x: number, y: number) => {
    box(`${name}Post`, x - 0.06, x + 0.06, y, y + 0.85, -1.6, -1.48, C.woodDark, true);
    box(`${name}Box`, x - 0.2, x + 0.2, y + 0.85, y + 1.05, -1.82, -1.3, C.white, true);
    // (Its rounded top: a cylinder along it, half sunk in the box.)
    const top = MeshBuilder.CreateCylinder(`${name}Top`, { height: 0.52, diameter: 0.4, tessellation: 14 }, scene);
    top.rotation.x = Math.PI / 2; top.position.set(x, y + 1.05, -1.56);
    place(top, C.white, true);
    box(`${name}Flag`, x + 0.2, x + 0.24, y + 0.95, y + 1.3, -1.5, -1.44, C.red);
    box(`${name}Flag`, x + 0.2, x + 0.24, y + 1.18, y + 1.3, -1.5, -1.32, C.red);
  };
  /** A lamp post: its base, pole, lantern (a glowing pane in a frame), its cap. */
  const lampPost = (x: number, y: number) => {
    cyl('lampBase', x, y, y + 0.25, -1.8, 0.34, C.black, 0.26, 8);
    cyl('lampPost', x, y + 0.25, y + 2.45, -1.8, 0.12, C.black, 0.09, 8);
    box('lampFrame', x - 0.2, x + 0.2, y + 2.45, y + 2.5, -2.0, -1.6, C.black);
    box('lampGlow', x - 0.16, x + 0.16, y + 2.5, y + 2.9, -1.96, -1.64, C.lamp);
    for (const dx of [-0.2, 0.16]) for (const dz of [-2.0, -1.64]) box('lampBar', x + dx, x + dx + 0.04, y + 2.5, y + 2.9, dz, dz + 0.04, C.black);
    cyl('lampCap', x, y + 2.9, y + 3.12, -1.8, 0.56, C.black, 0.06, 4).rotation.y = Math.PI / 4;
  };

  // ── the buildings' front walls: up while you are outside, faded away while you are in (update) ──
  // (Kept apart from the scenery the camera fades of itself — these fade by where you are, the whole wall at once.)
  const facadeRoot = new TransformNode('palletFacades', scene);
  const facades: { mesh: Mesh; x0: number; x1: number; y0: number; y1: number; vis: number }[] = [];
  interface Storey { y: number; top: number; windows: number[]; wy?: [number, number] }
  const facade = (name: string, b: { x0: number; x1: number; y: number; top: number }, wall: StandardMaterial, storeys: Storey[],
    o: { shutters?: StandardMaterial; boxes?: boolean; sign?: boolean } = {}) => {
    const parts: Mesh[] = [];
    const P = (m: Mesh) => { parts.push(m); return m; };
    // (Its plane just in front of the timber frame; between the corner posts.)
    const z1 = FRONT - 0.12, z0 = z1 - 0.2, X0 = b.x0 + 0.2, X1 = b.x1 - 0.2, hw = 0.6;
    for (const [si, st] of storeys.entries()) {
      const wy0 = st.y + (st.wy?.[0] ?? 1.15), wy1 = st.y + (st.wy?.[1] ?? 2.25);
      P(box(`${name}FacadeLow`, X0, X1, st.y - (si ? 0.35 : 0.2), wy0, z0, z1, wall));
      P(box(`${name}FacadeHigh`, X0, X1, wy1, st.top, z0, z1, wall));
      let cur = X0;
      for (const cx of [...st.windows].sort((a, c) => a - c)) {
        P(box(`${name}FacadePier`, cur, cx - hw, wy0, wy1, z0, z1, wall));
        cur = cx + hw;
        // Its window: a frame, glass, glazing bars, a sill; shutters; a flower box.
        for (const [a, c, d, e] of [[cx - hw - 0.08, cx - hw + 0.04, wy0 - 0.08, wy1 + 0.08], [cx + hw - 0.04, cx + hw + 0.08, wy0 - 0.08, wy1 + 0.08],
          [cx - hw, cx + hw, wy1 - 0.04, wy1 + 0.1], [cx - hw, cx + hw, wy0 - 0.06, wy0 + 0.04]]) P(box(`${name}FacadeFrame`, a, c, d, e, z0 - 0.05, z1 + 0.01, C.trim));
        P(box(`${name}FacadeGlass`, cx - hw, cx + hw, wy0, wy1, z0 + 0.08, z0 + 0.1, C.window));
        P(box(`${name}FacadeBar`, cx - 0.035, cx + 0.035, wy0, wy1, z0 + 0.04, z0 + 0.08, C.trim));
        P(box(`${name}FacadeBar`, cx - hw, cx + hw, (wy0 + wy1) / 2 - 0.035, (wy0 + wy1) / 2 + 0.035, z0 + 0.04, z0 + 0.08, C.trim));
        P(box(`${name}FacadeSill`, cx - hw - 0.15, cx + hw + 0.15, wy0 - 0.16, wy0 - 0.06, z0 - 0.18, z1, C.trim));
        if (o.shutters) for (const side of [-1, 1]) {
          const sx = cx + side * (hw + 0.36);
          P(box(`${name}FacadeShutter`, sx - 0.26, sx + 0.26, wy0, wy1, z0 - 0.06, z0, o.shutters));
          for (let y = wy0 + 0.12; y < wy1 - 0.08; y += 0.16) P(box(`${name}FacadeLouvre`, sx - 0.2, sx + 0.2, y, y + 0.04, z0 - 0.08, z0 - 0.06, C.trimDark));
        }
        if (o.boxes) {
          P(box(`${name}FacadeFlowerBox`, cx - hw, cx + hw, wy0 - 0.42, wy0 - 0.17, z0 - 0.32, z0 - 0.02, C.wood));
          for (let x = cx - hw + 0.1; x < cx + hw - 0.05; x += 0.16) {
            const f = MeshBuilder.CreateSphere(`${name}FacadeFlower`, { diameter: 0.15, segments: 5 }, scene);
            f.position.set(x, wy0 - 0.12, z0 - 0.17); f.material = [C.flowerR, C.flowerY, C.flowerW, C.flowerP][Math.round(x * 6.1) & 3]; P(f);
          }
        }
      }
      P(box(`${name}FacadePier`, cur, X1, wy0, wy1, z0, z1, wall));
      // (A band of trim where each storey meets the next.)
      if (si) P(box(`${name}FacadeBand`, X0 - 0.05, X1 + 0.05, st.y - 0.35, st.y - 0.2, z0 - 0.06, z1, C.trimDark));
    }
    // Its stone plinth along the foot; a sign over the lab's windows.
    P(box(`${name}FacadePlinth`, X0 - 0.06, X1 + 0.06, b.y - 0.2, b.y + 0.42, z0 - 0.07, z1, C.stoneDark));
    if (o.sign) {
      const cx = (b.x0 + b.x1) / 2;
      P(box(`${name}FacadeSign`, cx - 2.2, cx + 2.2, b.top - 1.25, b.top - 0.35, z0 - 0.1, z0, C.trimDark));
      P(box(`${name}FacadeSignFace`, cx - 2.05, cx + 2.05, b.top - 1.12, b.top - 0.48, z0 - 0.12, z0 - 0.1, C.white));
      for (const [dx, w] of [[-1.5, 0.7], [-0.6, 0.9], [0.5, 0.5], [1.3, 0.5]]) P(box(`${name}FacadeLetters`, cx + dx - w / 2, cx + dx + w / 2, b.top - 0.9, b.top - 0.7, z0 - 0.13, z0 - 0.12, C.blue));
    }
    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
    merged.name = `${name}Facade`; merged.parent = facadeRoot; merged.isPickable = false; merged.receiveShadows = true;
    facades.push({ mesh: merged, x0: b.x0, x1: b.x1, y0: b.y - 0.3, y1: b.top + 0.5, vis: 1 });
  };

  // ── Prof. Oak's Lab ──
  building('lab', L, C.wallLab, [C.roofLab, C.roofLabDark, C.roofLabLight], C.labFloor, { windows: [-18, -13.5], chimney: -12.5, panel: C.labPanel });
  // Its bookcases along its back wall, a loft above them (up off its tables: its rail, its posts), a bookcase up there.
  shelf('labShelfA', L.x0 + 0.6, L.x0 + 2.4, L.y, L.y + 1.9, BACK_WALL);
  shelf('labShelfB', L.x0 + 2.6, L.x0 + 4.4, L.y, L.y + 1.9, BACK_WALL);
  shelf('labShelfC', L.x0 + 4.6, L.x0 + 6.4, L.y, L.y + 1.9, BACK_WALL);
  box('labLoft', L.x0 + WALL, L.x0 + 7.0, L.y + 1.95, L.y + 2.2, FRONT + 1.0, BACK_WALL, C.wood, true);
  box('labLoftEdge', L.x0 + WALL, L.x0 + 7.05, L.y + 1.9, L.y + 2.2, FRONT + 0.9, FRONT + 1.0, C.trimDark);
  for (let x = L.x0 + 1.0; x < L.x0 + 7.0; x += 0.45) box('labLoftBaluster', x, x + 0.06, L.y + 2.2, L.y + 2.6, FRONT + 1.0, FRONT + 1.06, C.woodDark);
  box('labLoftRail', L.x0 + 0.9, L.x0 + 7.05, L.y + 2.6, L.y + 2.68, FRONT + 0.98, FRONT + 1.08, C.trimDark);
  box('labLoftPost', L.x0 + 6.9, L.x0 + 7.05, L.y, L.y + 1.9, FRONT + 0.95, FRONT + 1.1, C.trimDark, true);
  shelf('labLoftShelf', L.x0 + 0.8, L.x0 + 4.0, L.y + 2.2, L.y + 3.6, BACK_WALL);
  // Its three tables (white tops, steel legs): a PC on the first, the three Poké Balls on the middle one.
  table('labTable1', -22.6, -20.2, L.y, 0.9, C.white, C.metal);
  table('labTable2', -18.6, -15.4, L.y, 0.95, C.white, C.metal);
  table('labTable3', -14.0, -11.8, L.y, 0.9, C.white, C.metal);
  for (const [k, x] of [-17.8, -17.0, -16.2].entries()) {
    // (The three Poké Balls — Bulbasaur's, Squirtle's, Charmander's: each one yours in small, its button to the front.)
    const pb = pokeballMesh(scene, 0.34);
    pb.name = `labBall${k}`; pb.parent = root; pb.position.set(x, L.y + 0.95 + 0.17, 0); pb.rotation.y = (k - 1) * 0.25;
    pb.receiveShadows = true; shadowGen?.addShadowCaster(pb);
  }
  // (Its machine: a cabinet of panels, its screen, its lights and dials.)
  box('labMachine', -13.8, -11.4, L.y, L.y + 2.4, BACK_WALL - 1.0, BACK_WALL, C.machine, true);
  box('labMachineTop', -13.9, -11.3, L.y + 2.4, L.y + 2.5, BACK_WALL - 1.05, BACK_WALL, C.metal);
  for (const y of [0.35, 0.95]) box('labPanel', -13.6, -11.6, L.y + y, L.y + y + 0.42, BACK_WALL - 1.02, BACK_WALL - 1.0, C.machineDark);
  box('labScreenBezel', -13.5, -11.7, L.y + 1.35, L.y + 2.2, BACK_WALL - 1.03, BACK_WALL - 1.0, C.tv);
  box('labScreen', -13.4, -11.8, L.y + 1.45, L.y + 2.1, BACK_WALL - 1.045, BACK_WALL - 1.03, C.screen);
  for (let i = 0; i < 4; i++) box('labLight', -13.45 + i * 0.45, -13.3 + i * 0.45, L.y + 1.47 - 0.25, L.y + 1.3, BACK_WALL - 1.04, BACK_WALL - 1.0, i % 2 ? C.red : C.flowerY);
  for (const x of [-13.2, -12.0]) cyl('labDial', x, BACK_WALL - 1.06, BACK_WALL - 1.0, L.y + 0.57, 0.22, C.metal).rotation.x = Math.PI / 2;
  // (Its PC: a monitor on a stand, a keyboard; its tower under the table.)
  box('labPC', -21.5, -20.5, L.y + 1.05, L.y + 1.7, 0.1, 0.5, C.machine, true);
  box('labPCScreen', -21.4, -20.6, L.y + 1.13, L.y + 1.62, 0.08, 0.1, C.screen);
  box('labPCStand', -21.1, -20.9, L.y + 0.9, L.y + 1.05, 0.2, 0.4, C.machineDark);
  box('labKeyboard', -21.4, -20.6, L.y + 0.9, L.y + 0.94, -0.45, -0.15, C.machineDark);
  box('labTower', -22.3, -21.9, L.y, L.y + 0.7, 0.1, 0.7, C.machine);
  plant('labPlant', L.x1 - 0.9, L.y, BACK_WALL - 0.5, 1.2);
  plant('labPlant2', L.x0 + 7.6, L.y, BACK_WALL - 0.5, 1.2);
  // Its door (its right-hand doorway — locked till the story opens it: palletStory): panelled, its knob; its sign.
  const labDoor = box('labDoor', L.x1 - WALL + 0.05, L.x1 - 0.05, L.y, L.y + DOOR, FRONT + 0.3, BACK_WALL - 0.3, C.door);
  for (const [z0, z1] of [[FRONT + 0.5, -0.15], [0.15, BACK_WALL - 0.5]]) {
    const pnl = box('labDoorPanel', L.x1 - 0.06, L.x1 - 0.02, L.y + 0.3, L.y + DOOR - 0.3, z0, z1, C.trimDark);
    pnl.parent = labDoor; pnl.position.subtractInPlace(labDoor.position);
  }
  const knob = ball('labDoorKnob', L.x1 + 0.0, L.y + 0.95, -0.05, 0.1, C.gold, 8);
  knob.parent = labDoor; knob.position.subtractInPlace(labDoor.position);
  sign('labSign', L.x1 + 0.6, L.x1 + 1.7, L.y, -1.65, C.white);

  // ── the garden, behind the walk between the lab and the steps: a picket fence, flowers, a bench, a lamp post ──
  const g0 = -8.5, g1 = -1.0;
  for (let x = g0; x <= g1 + 1e-6; x += 0.32) {
    box('gardenPicket', x - 0.06, x + 0.06, SOUTH_Y, SOUTH_Y + 0.66, GARDEN_Z - 1.2, GARDEN_Z - 1.14, C.fence);
    const tip = cyl('gardenPicketTip', x, SOUTH_Y + 0.66, SOUTH_Y + 0.78, GARDEN_Z - 1.17, 0.13, C.fence, 0, 4);
    tip.rotation.y = Math.PI / 4;
  }
  for (const y of [0.18, 0.5]) box('gardenRail', g0, g1, SOUTH_Y + y, SOUTH_Y + y + 0.07, GARDEN_Z - 1.1, GARDEN_Z - 1.05, C.fence);
  const flowers = [C.flowerR, C.flowerY, C.flowerW, C.flowerP];
  for (let x = g0 + 0.3; x < g1; x += 0.42) for (let k = 0; k < 3; k++) {
    const z = GARDEN_Z - 0.6 + k * 0.55, fx = x + k * 0.12, h = 0.26 + ((x * 7 + k) % 0.12);
    cyl('flowerStem', fx, SOUTH_Y, SOUTH_Y + h, z, 0.03, C.green, 0.03, 4);
    const leaf = MeshBuilder.CreateIcoSphere('flowerLeaf', { radius: 0.07, subdivisions: 0, flat: true }, scene);
    leaf.position.set(fx + 0.05, SOUTH_Y + h * 0.4, z); leaf.scaling.set(1.4, 0.5, 0.8); place(leaf, C.leafLight);
    // (Its bloom: petals round a centre.)
    const fm = flowers[(Math.round(x * 4) + k) % flowers.length];
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      const pet = ball('petal', fx + Math.cos(a) * 0.065, SOUTH_Y + h + 0.03, z + Math.sin(a) * 0.065, 0.09, fm, 5);
      pet.scaling.y = 0.5;
    }
    ball('flowerHeart', fx, SOUTH_Y + h + 0.05, z, 0.06, C.flowerY, 5);
  }
  // (Its bench: slatted seat and back, its legs.)
  for (let k = 0; k < 3; k++) box('benchSlat', -6.4, -4.6, SOUTH_Y + 0.47, SOUTH_Y + 0.55, -0.38 + k * 0.26, -0.18 + k * 0.26, C.wood, true);
  for (let k = 0; k < 2; k++) box('benchBackSlat', -6.4, -4.6, SOUTH_Y + 0.65 + k * 0.2, SOUTH_Y + 0.77 + k * 0.2, 0.32, 0.4, C.wood, true);
  for (const x of [-6.35, -4.75]) {
    box('benchLeg', x, x + 0.1, SOUTH_Y, SOUTH_Y + 0.47, -0.35, -0.25, C.black);
    box('benchLeg', x, x + 0.1, SOUTH_Y, SOUTH_Y + 1.0, 0.3, 0.4, C.black);
  }
  lampPost(-3.0, SOUTH_Y); lampPost(21.0, NORTH_Y); lampPost(35.5, NORTH_Y);
  sign('townSign', -0.4, 1.0, SOUTH_Y, -1.65);

  // ── your house ──
  building('home', H, C.wallHome, [C.roofRed, C.roofRedDark, C.roofRedLight], C.floorLight,
    { upDoorLeft: H.up, upFloor: H.up, windows: [11.5, 15.5], chimney: 16.5, paper: C.paper, panel: C.wainscot, curtains: F.curtain });
  // (Its upstairs floor, under your bedroom; its stairs in its right-hand corner — open treads, a stringer, a rail.)
  box('homeUpFloor', H.x0 + WALL, 15.6, H.up - 0.3, H.up, FRONT, BACK_WALL, C.floor, true);
  // (Its treads exactly where they stand — their tops, their undersides — a nosing on each; a stringer up the back
  // wall carrying them, a post under each at the back, off the way through underneath.)
  for (const [i, t] of STAIRS.entries()) {
    box(`homeStep${i}`, t.x0, t.x1 - 0.06, H.y + t.top - TREAD, H.y + t.top, FRONT, BACK_WALL, C.woodDark, true);
    box('homeStepNose', t.x1 - 0.06, t.x1, H.y + t.top - TREAD, H.y + t.top, FRONT - 0.03, BACK_WALL, C.trim);
    box('homeStepPost', (t.x0 + t.x1) / 2 - 0.05, (t.x0 + t.x1) / 2 + 0.05, H.y, H.y + t.top - TREAD, BACK_WALL - 0.3, BACK_WALL - 0.2, C.trimDark);
  }
  const run = 18.0 - 15.6, climb = H.up - H.y;
  const stringer = bevelBox('homeStringer', scene, Math.hypot(run, climb), 0.22, 0.16, 0.04);
  stringer.position.set((18.0 + 15.6) / 2, H.y + climb / 2 - 0.1, BACK_WALL - 0.1); stringer.rotation.z = -Math.atan2(climb, run);
  place(stringer, C.trimDark);
  // Downstairs (the living room): the kitchen — base cabinets, a counter, a sink and tap, wall cupboards, the fridge —
  // the table on its rug and two chairs, the TV on its stand, plants, a clock, a picture.
  const kx0 = H.x0 + WALL, kx1 = H.x0 + 2.4;
  box('homeCabinets', kx0, kx1, H.y, H.y + 0.92, BACK_WALL - 0.68, BACK_WALL, C.cabinet, true);
  for (let x = kx0 + 0.06; x < kx1 - 0.2; x += 0.66) {
    box('homeCabDoor', x, x + 0.58, H.y + 0.12, H.y + 0.85, BACK_WALL - 0.7, BACK_WALL - 0.68, C.cabinetDark);
    box('homeCabHandle', x + 0.45, x + 0.5, H.y + 0.6, H.y + 0.78, BACK_WALL - 0.73, BACK_WALL - 0.7, C.gold);
  }
  box('homeCounterTop', kx0 - 0.02, kx1 + 0.05, H.y + 0.92, H.y + 1.0, BACK_WALL - 0.76, BACK_WALL, C.counter, true);
  box('homeSink', kx0 + 0.6, kx0 + 1.2, H.y + 0.97, H.y + 1.005, BACK_WALL - 0.58, BACK_WALL - 0.18, C.metal);
  cyl('homeTap', kx0 + 0.9, H.y + 1.0, H.y + 1.3, BACK_WALL - 0.12, 0.06, C.metal, 0.05, 8);
  box('homeTapSpout', kx0 + 0.87, kx0 + 0.93, H.y + 1.24, H.y + 1.3, BACK_WALL - 0.35, BACK_WALL - 0.1, C.metal);
  box('homeSplash', kx0, kx1, H.y + 1.0, H.y + 1.45, BACK_WALL - 0.03, BACK_WALL, C.tileWall);
  box('homeUpperCab', kx0, kx1, H.y + 1.75, H.y + 2.45, BACK_WALL - 0.42, BACK_WALL, C.cabinet, true);
  for (let x = kx0 + 0.06; x < kx1 - 0.2; x += 0.66) box('homeUpperDoor', x, x + 0.58, H.y + 1.8, H.y + 2.4, BACK_WALL - 0.44, BACK_WALL - 0.42, C.cabinetDark);
  box('homeFridge', H.x0 + 2.5, H.x0 + 3.35, H.y, H.y + 1.95, BACK_WALL - 0.78, BACK_WALL, C.fridge, true);
  box('homeFridgeSeam', H.x0 + 2.5, H.x0 + 3.35, H.y + 1.28, H.y + 1.3, BACK_WALL - 0.79, BACK_WALL - 0.77, C.metal);
  for (const [y0, y1] of [[0.5, 1.1], [1.4, 1.8]]) box('homeFridgeHandle', H.x0 + 3.2, H.x0 + 3.25, H.y + y0, H.y + y1, BACK_WALL - 0.84, BACK_WALL - 0.78, C.metal);
  rug('homeRug', 10.4, 13.4, H.y, -1.4, 1.4);
  table('homeTable', 11.0, 12.8, H.y, 0.75);
  tablecloth('homeTablecloth', 11.0, 12.8, H.y + 0.75, F.cloth);
  chair('homeChairL', 11.45, H.y, 1.25); chair('homeChairR', 12.35, H.y, 1.25);
  box('homeTVStand', 13.8, 15.2, H.y, H.y + 0.5, BACK_WALL - 0.62, BACK_WALL, C.woodDark, true);
  box('homeTVStandShelf', 13.88, 15.12, H.y + 0.08, H.y + 0.2, BACK_WALL - 0.64, BACK_WALL - 0.62, C.wood);
  const tv = (name: string, x0: number, x1: number, y0: number, y1: number, z1: number) => {
    // (A boxy TV: its cabinet, its bezel, its screen, its knobs, its antennae.)
    box(`${name}`, x0, x1, y0, y1, z1 - 0.48, z1 - 0.05, C.tv, true);
    box(`${name}Bezel`, x0 + 0.06, x1 - 0.22, y0 + 0.08, y1 - 0.08, z1 - 0.5, z1 - 0.48, C.tvDark);
    box(`${name}Screen`, x0 + 0.12, x1 - 0.28, y0 + 0.14, y1 - 0.14, z1 - 0.51, z1 - 0.5, C.screen);
    for (const k of [0, 1]) cyl(`${name}Knob`, x1 - 0.12, z1 - 0.52, z1 - 0.48, y0 + 0.3 + k * 0.22, 0.08, C.metal).rotation.x = Math.PI / 2;
    for (const side of [-1, 1]) {
      const ant = cyl(`${name}Antenna`, (x0 + x1) / 2, y1, y1 + 0.5, z1 - 0.25, 0.025, C.metal, 0.015, 5);
      ant.rotation.z = side * 0.5; ant.position.x += side * 0.12;
    }
  };
  tv('homeTV', 13.95, 15.05, H.y + 0.5, H.y + 1.25, BACK_WALL - 0.05);
  plant('homePlant1', H.x0 + 3.85, H.y, BACK_WALL - 0.4);
  plant('homePlant2', 15.25, H.y, -1.4);
  cyl('homeClock', 13.3, BACK_WALL - 0.07, BACK_WALL, H.y + 2.15, 0.5, C.trimDark, 0.5, 16).rotation.x = Math.PI / 2;
  cyl('homeClockFace', 13.3, BACK_WALL - 0.09, BACK_WALL - 0.06, H.y + 2.15, 0.42, C.white, 0.42, 16).rotation.x = Math.PI / 2;
  box('homeClockHand', 13.28, 13.32, H.y + 2.13, H.y + 2.32, BACK_WALL - 0.1, BACK_WALL - 0.09, C.black);
  box('homeClockHand', 13.28, 13.44, H.y + 2.13, H.y + 2.17, BACK_WALL - 0.1, BACK_WALL - 0.09, C.black);
  // Upstairs (your bedroom): your bed (its frame, headboard, mattress, quilt folded back, pillow), your PC on its desk
  // and its chair, the TV and its console, a bookcase, a plant, a rug.
  const bx0 = H.x0 + WALL + 0.3, bx1 = H.x0 + WALL + 2.2;
  box('homeBedFrame', bx0, bx1, H.up, H.up + 0.3, -1.0, 1.5, C.wood, true);
  box('homeHeadboard', bx0, bx1, H.up, H.up + 1.15, 1.42, 1.58, C.woodDark, true);
  for (const x of [bx0, bx1 - 0.12]) box('homeBedPost', x, x + 0.12, H.up, H.up + 1.25, 1.38, 1.6, C.woodDark);
  // (Its mattress in a fitted sheet; its quilt draped over it — puffed on top, rolling over its sides and foot and
  // hanging in folds — turned down at the head over the sheet, a soft roll where it folds; a puffed pillow.)
  box('homeMattress', bx0 + 0.04, bx1 - 0.04, H.up + 0.3, H.up + 0.5, -0.96, 1.42, C.sheet);
  cloth(drape('homeSheet', scene, bx0 + 0.04, bx1 - 0.04, 0.6, 1.42, H.up + 0.505, { drop: [0.16, 0.16, 0, 0], round: 0.04, folds: 0.012, puff: 0.01, tile: 1 }), F.sheet);
  cloth(drape('homeQuilt', scene, bx0 + 0.04, bx1 - 0.04, -0.96, 0.62, H.up + 0.54, { drop: [0.27, 0.27, 0.27, 0], round: 0.06, folds: 0.03, foldFreq: 2.6, puff: 0.055, tile: 0.9 }), F.quilt);
  const roll = MeshBuilder.CreateCylinder('homeQuiltRoll', { height: bx1 - bx0 - 0.06, diameter: 0.1, tessellation: 14 }, scene);
  roll.rotation.z = Math.PI / 2; roll.position.set((bx0 + bx1) / 2, H.up + 0.56, 0.64); cloth(roll, F.sheet);
  const pil = pillow('homePillow', scene, bx1 - bx0 - 0.5, 0.17, 0.4);
  pil.position.set((bx0 + bx1) / 2, H.up + 0.6, 1.16); pil.rotation.set(-0.12, 0.04, 0.02); cloth(pil, F.pillow);
  rug('homeBedRug', H.x0 + 2.9, H.x0 + 5.0, H.up, -1.2, 0.6);
  box('homeDesk', 11.2, 12.6, H.up + 0.72, H.up + 0.8, BACK_WALL - 0.75, BACK_WALL, C.wood, true);
  for (const x of [11.25, 12.47]) box('homeDeskLeg', x, x + 0.08, H.up, H.up + 0.72, BACK_WALL - 0.72, BACK_WALL - 0.05, C.woodDark);
  box('homeDeskDrawer', 12.0, 12.47, H.up + 0.45, H.up + 0.72, BACK_WALL - 0.74, BACK_WALL - 0.05, C.wood);
  box('homePC', 11.5, 12.3, H.up + 0.9, H.up + 1.5, BACK_WALL - 0.45, BACK_WALL - 0.1, C.machine, true);
  box('homePCScreen', 11.58, 12.22, H.up + 0.98, H.up + 1.42, BACK_WALL - 0.47, BACK_WALL - 0.45, C.screen);
  box('homePCStand', 11.82, 11.98, H.up + 0.8, H.up + 0.9, BACK_WALL - 0.35, BACK_WALL - 0.2, C.machineDark);
  box('homeKeyboard', 11.5, 12.25, H.up + 0.8, H.up + 0.83, BACK_WALL - 0.72, BACK_WALL - 0.52, C.machineDark);
  tv('homeTV2', 13.1, 14.1, H.up, H.up + 0.75, BACK_WALL - 0.05);
  box('homeConsole', 13.25, 13.85, H.up, H.up + 0.12, BACK_WALL - 1.1, BACK_WALL - 0.72, C.consoleGrey);
  box('homeConsoleSlot', 13.35, 13.75, H.up + 0.12, H.up + 0.13, BACK_WALL - 0.98, BACK_WALL - 0.84, C.black);
  box('homePad', 13.4, 13.7, H.up, H.up + 0.05, BACK_WALL - 1.45, BACK_WALL - 1.28, C.consoleGrey);
  shelf('homeShelf', 14.3, 15.45, H.up, H.up + 1.8, BACK_WALL);
  plant('homePlant3', H.x0 + 2.9, H.up, BACK_WALL - 0.4, 0.9);
  // (A picture by the stairs; one over the bed.)
  for (const [x, y, w] of [[15.1, H.y + 1.3, 0.5], [H.x0 + 1.3, H.up + 1.5, 0.7]] as const) {
    box('homePicture', x - w, x + w, y, y + w * 1.1, BACK_WALL - 0.05, BACK_WALL, C.trimDark);
    box('homePictureArt', x - w + 0.08, x + w - 0.08, y + 0.08, y + w * 1.1 - 0.08, BACK_WALL - 0.06, BACK_WALL - 0.05, C.mapGreen);
    box('homePictureSky', x - w + 0.08, x + w - 0.08, y + w * 0.6, y + w * 1.1 - 0.08, BACK_WALL - 0.065, BACK_WALL - 0.06, C.mapBlue);
  }
  // Its balcony off your bedroom (its doorway in the left wall upstairs): decking, balusters, a rail, posts; crates
  // down from it to the lawn.
  box('homeBalcony', H.x0 - 2.6, H.x0, H.up - 0.25, H.up, FRONT + 0.4, BACK_WALL, C.wood, true);
  for (let z = FRONT + 0.6; z < BACK_WALL - 0.1; z += 0.4) box('homeDeckSeam', H.x0 - 2.6, H.x0, H.up, H.up + 0.002, z, z + 0.02, C.seam);
  for (let x = H.x0 - 2.5; x < H.x0; x += 0.3) box('homeBaluster', x, x + 0.06, H.up, H.up + 0.5, FRONT + 0.42, FRONT + 0.48, C.woodDark);
  box('homeBalconyRail', H.x0 - 2.6, H.x0, H.up + 0.5, H.up + 0.58, FRONT + 0.4, FRONT + 0.52, C.trimDark);
  for (const x of [H.x0 - 2.5, H.x0 - 0.3]) box('homeBalconyPost', x, x + 0.14, H.y, H.up - 0.25, FRONT + 0.48, FRONT + 0.62, C.trimDark, true);
  crate('crateLow', H.x0 - 3.7, H.x0 - 2.6, H.y, H.y + 0.8, -0.7, 0.4);
  crate('crateHigh', H.x0 - 2.6, H.x0 - 1.7, H.y, H.y + 1.6, -0.7, 0.4);
  // (A flower box under its back window outside; its mailbox.)
  box('homeFlowerBox', 10.8, 12.2, H.y + 1.05, H.y + 1.25, BACK_WALL + 0.25, BACK_WALL + 0.5, C.wood);
  for (let x = 10.9; x < 12.1; x += 0.22) ball('homeBoxFlower', x, H.y + 1.32, BACK_WALL + 0.38, 0.16, flowers[Math.round(x * 5) % flowers.length], 6);
  mailbox('homeMail', H.x1 + 1.05, H.y);

  // ── the rival's house ──
  building('rival', RV, C.wallHome, [C.roofRed, C.roofRedDark, C.roofRedLight], C.floorLight,
    { windows: [25.5, 28.5], chimney: 30, paper: C.paperGreen, panel: C.wainscot, curtains: F.curtainGreen });
  rug('rivalRug', 26.6, 29.8, RV.y, -1.4, 1.4, F.rugRed);
  table('rivalTable', 27.2, 29.2, RV.y, 0.75);
  tablecloth('rivalTablecloth', 27.2, 29.2, RV.y + 0.75, F.cloth, 0.18);
  // (Its low cabinets — to hop across — its books on top.)
  for (const [x0, x1] of [[24.0, 25.4], [29.4, 30.8]] as const) {
    box('rivalCabinet', x0, x1, RV.y, RV.y + 1.1, BACK_WALL - 2.0, BACK_WALL - 0.02, C.cabinet, true);
    box('rivalCabinetTop', x0 - 0.04, x1 + 0.04, RV.y + 1.1, RV.y + 1.15, BACK_WALL - 2.04, BACK_WALL, C.wood);
    for (const [y0, y1] of [[0.12, 0.5], [0.58, 1.02]]) {
      box('rivalDrawer', x0 + 0.06, x1 - 0.06, RV.y + y0, RV.y + y1, BACK_WALL - 2.02, BACK_WALL - 2.0, C.cabinetDark);
      box('rivalKnob', (x0 + x1) / 2 - 0.08, (x0 + x1) / 2 + 0.08, RV.y + (y0 + y1) / 2 - 0.03, RV.y + (y0 + y1) / 2 + 0.03, BACK_WALL - 2.05, BACK_WALL - 2.02, C.gold);
    }
    shelfBooks('rivalTop', Array.from({ length: 5 }, (_, k) => ({ x: x0 + 0.2 + k * 0.12, y: RV.y + 1.15, z: BACK_WALL - 0.25, w: 0.1, h: 0.3 - (k % 2) * 0.06, d: 0.28, k: k + Math.abs(Math.round(x0)) })));
  }
  // (The Town Map on its wall: framed, its sea, its land, a few towns marked.)
  // (Hung above the windows — clear of their rods and curtains — centred between them, under the ceiling's moulding.)
  const mx = 27.0, my0 = RV.y + 2.72, my1 = RV.y + 4.1;
  box('rivalMapFrame', mx - 1.3, mx + 1.3, my0, my1, BACK_WALL - 0.04, BACK_WALL, C.trimDark);
  box('rivalMap', mx - 1.2, mx + 1.2, my0 + 0.08, my1 - 0.08, BACK_WALL - 0.05, BACK_WALL - 0.04, C.mapBlue);
  box('rivalMapLand', mx - 0.9, mx + 0.8, my0 + 0.22, my1 - 0.2, BACK_WALL - 0.06, BACK_WALL - 0.05, C.mapGreen);
  for (const [dx, dy] of [[-0.5, 0.35], [0.1, 0.85], [0.5, 0.45]]) box('rivalMapTown', mx + dx, mx + dx + 0.1, my0 + dy, my0 + dy + 0.1, BACK_WALL - 0.065, BACK_WALL - 0.06, C.red);
  plant('rivalPlant', RV.x1 - 0.9, RV.y, -1.4);
  plant('rivalPlant2', RV.x0 + 3.0, RV.y, BACK_WALL - 0.4, 0.9);
  mailbox('rivalMail', RV.x1 + 1.05, RV.y);

  // ── Route 1's gap: its gate (closed for now — palletStory), its sign ──
  const routeDoor = box('routeGate', ROUTE_GATE - 0.12, ROUTE_GATE + 0.12, NORTH_Y + 0.1, NORTH_Y + 1.7, FRONT + 0.2, BACK_WALL - 0.2, C.fence);
  for (const y of [0.45, 1.25]) {
    const bar = box('routeGateBar', ROUTE_GATE - 0.15, ROUTE_GATE + 0.15, NORTH_Y + y, NORTH_Y + y + 0.12, FRONT + 0.15, BACK_WALL - 0.15, C.trimDark);
    bar.parent = routeDoor; bar.position.subtractInPlace(routeDoor.position);
  }
  for (const z of [FRONT, BACK_WALL - 0.15]) {
    box('routeGatePost', ROUTE_GATE - 0.2, ROUTE_GATE + 0.2, NORTH_Y, NORTH_Y + 2.1, z, z + 0.3, C.trimDark, true);
    box('routeGatePostCap', ROUTE_GATE - 0.26, ROUTE_GATE + 0.26, NORTH_Y + 2.1, NORTH_Y + 2.2, z - 0.06, z + 0.36, C.trimDark);
  }
  sign('routeSign', ROUTE_GATE - 2.0, ROUTE_GATE - 0.7, NORTH_Y, -1.65);

  facade('lab', L, C.wallLab, [{ y: L.y, top: L.top, windows: [-21.3, -17.3, -13.3], wy: [1.2, 3.1] }], { sign: true });
  facade('home', H, C.wallHome, [{ y: H.y, top: H.up, windows: [10.3, 14.8] }, { y: H.up, top: H.top, windows: [10.3, 12.8, 15.3] }], { shutters: C.shutter, boxes: true });
  facade('rival', RV, C.wallHome, [{ y: RV.y, top: RV.top, windows: [25.3, 29.8], wy: [1.3, 2.6] }], { shutters: C.shutterGreen, boxes: true });

  // ── the trees: rows behind the town, the gap in them north to Route 1 ──
  // (Stylized low-poly trees: lowPolyTrees.ts — Pallet Town's round broadleaves mostly, pines and poplars among them.)
  const treeMat = treeMaterial(scene);
  owned.push(treeMat);
  let rnd = 7;
  const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  let treeN = 0;
  const tree = (x: number, y: number, z: number, s: number, kind: TreeKind) => {
    const t = lowPolyTree(scene, kind, s, ++treeN);
    t.position.set(x, y, z);
    place(t, treeMat, true);
  };
  for (const [row, z] of TREES_Z.entries()) for (let x = SHORE + 1 + row * 1.1; x < NORTH + 4; x += 2.2) {
    if (x > ROUTE_GATE - 1 && x < ROUTE_GATE + 7 && row === 0) continue;
    const y = x < northX ? SOUTH_Y : NORTH_Y;
    const r = rand();
    tree(x, y, z + ((x * 7) % 1.4) - 0.7, 0.95 + rand() * 0.3, r < 0.5 ? 'round' : r < 0.82 ? 'pine' : 'poplar');
  }

  // The sky.
  scene.clearColor = new Color4(0.62, 0.82, 0.97, 1);

  return {
    level,
    start: { x: 13.0, y: H.up },
    root,
    doors: { lab: labDoor, route: routeDoor },
    update: (x: number, y: number, dt: number) => {
      // (In a building — between its walls, from its floor to its roof: its front wall faded away; out: up again.)
      const k = 1 - Math.exp(-dt * FACADE_EASE);
      for (const f of facades) {
        const inside = x > f.x0 + 0.02 && x < f.x1 - 0.02 && y >= f.y0 && y < f.y1;
        // (Snapped home at the end of its fade: a wall left at 0.9999 is drawn as see-through — its parts unsorted, the
        // plaster over the shutters as the camera moves; fully up, it is drawn solid.)
        f.vis += ((inside ? 0 : 1) - f.vis) * k;
        if (f.vis > 0.995) f.vis = 1; else if (f.vis < 0.005) f.vis = 0;
        f.mesh.visibility = f.vis; f.mesh.isVisible = f.vis > 0.02;
      }
    },
    dispose: () => { for (const o of owned) o.dispose(); root.dispose(false, true); facadeRoot.dispose(false, true); for (const m of mats.values()) m.dispose(); },
  };
}

/** The Pokéball you are until you have a Pokémon: red over white, a black band round it, its button. */
export function pokeballMesh(scene: Scene, diameter: number): Mesh {
  const b = MeshBuilder.CreateSphere('pokeball', { diameter, segments: 24 }, scene);
  const pos = b.getVerticesData('position')!;
  const colors: number[] = [];
  const band = diameter * 0.045;
  for (let i = 0; i < pos.length; i += 3) {
    const y = pos[i + 1];
    const c = Math.abs(y) < band ? [0.08, 0.08, 0.1] : y > 0 ? [0.9, 0.12, 0.12] : [0.97, 0.97, 0.97];
    colors.push(c[0], c[1], c[2], 1);
  }
  b.setVerticesData('color', colors);
  const m = new StandardMaterial('pokeballMat', scene);
  m.diffuseColor = new Color3(1, 1, 1);
  m.emissiveColor = new Color3(0.35, 0.35, 0.35);
  m.specularColor = new Color3(0.4, 0.4, 0.4);
  b.material = m;
  // Its button, on the band at its front.
  const ring = MeshBuilder.CreateCylinder('pokeballRing', { height: diameter * 0.06, diameter: diameter * 0.32, tessellation: 20 }, scene);
  ring.rotation.x = Math.PI / 2; ring.position.set(0, 0, -diameter * 0.49); ring.parent = b;
  const rm = new StandardMaterial('pokeballRingMat', scene); rm.diffuseColor = new Color3(0.08, 0.08, 0.1); rm.emissiveColor = new Color3(0.02, 0.02, 0.02); ring.material = rm;
  const button = MeshBuilder.CreateCylinder('pokeballButton', { height: diameter * 0.08, diameter: diameter * 0.2, tessellation: 20 }, scene);
  button.rotation.x = Math.PI / 2; button.position.set(0, 0, -diameter * 0.51); button.parent = b;
  const bm = new StandardMaterial('pokeballButtonMat', scene); bm.diffuseColor = new Color3(0.97, 0.97, 0.97); bm.emissiveColor = new Color3(0.4, 0.4, 0.4); button.material = bm;
  for (const p of [b, ring, button]) p.isPickable = false;
  b.position = new Vector3();
  return b;
}
