/**
 * The grass stadium — a real-time battle arena, low-poly: after Poke2D
 * Arena's grass stage, laid out from its picture (0.02 m a pixel, its middle
 * the origin, +z its south): a mown pitch in two greens with its white lines
 * (touchline, halfway line, centre circle and spot, penalty and goal boxes,
 * penalty marks), a low stone curb round it with posts at its corners; to
 * the north a flight of steps up to a terrace between stone pillars — gold-
 * capped beside the steps, blue Pokéball banners outside them — and box
 * hedges; to the south a paved plaza and steps, pillars, banners and hedges
 * the same; all of it in a meadow, ringed by low-poly pines, flowers in its
 * corners. Flat colours, flat shaded, the lawns in soft grass
 * with short fur grass standing on them; no tiles.
 */
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { lowPolyTree } from '../trees.ts';
import { softGrass } from './softGrass.ts';
import { grassFur } from './grassFur.ts';

/** The pitch (to its touchlines' outer edge) and the strip of grass from them to the curb (m). */
export const PITCH_W = 26.6, PITCH_D = 13.2, PITCH_RUNOFF = 0.7;
/** The curb round it: how thick, how high (m). */
const CURB_T = 0.45, CURB_H = 0.42;
/** Its markings: line width, the centre circle's radius, the penalty and goal boxes (depth, width), the penalty mark's distance in (m). */
const LINE = 0.13, CIRCLE_R = 2.7, BOX: [number, number] = [5.2, 6.8], GOAL_BOX: [number, number] = [1.7, 3.2], MARK_AT = 3.2;
/** Mown stripes across it. */
const STRIPES = 16;
/** The steps and plazas at either end: their width, how deep. */
const STEPS_W = 4.4, NORTH_DEPTH = 2.4, SOUTH_DEPTH = 2.4;
/** The colours. */
const COL = {
  stripeA: '#4fa632', stripeB: '#3f9228', line: '#f2f3ea',
  meadow: '#4a8a30', curb: '#c8c2b2', curbTop: '#d9d4c6', post: '#b3ad9e',
  stone: '#bdb7a8', stoneDark: '#9a9486', gold: '#e2b23a', banner: '#24408f', bannerTrim: '#e2b23a',
  hedge: '#2a6a2a', hedgeTop: '#347d30', paving: '#bdb8ac', pavingDark: '#a29d91',
  trunk: '#6b4a2e', canopy: '#3d8a3a', flowerW: '#f4f1e6', flowerY: '#f2d24a', flowerC: '#f1b52a',
  sky: '#bfe0ef',
};
/** Its fog: where it starts, where it is whole (m). */
const FOG: [number, number] = [55, 120];
/** The whole of it, against the Pokémon: everything above is laid out at 1, then grown by this. */
export const STADIUM_SCALE = 1.6;

export interface Arena {
  root: TransformNode;
  /** Where the play is: half its width and depth inside the curb (m), the ground's height. */
  bounds: { halfW: number; halfD: number; y: number };
  /** Its own air — a far fog (the board's starts too near for a whole stadium in view) — for FieldFx.setAir. */
  air: { fog: Color3; fogStart: number; fogEnd: number };
  /** Its floor's height at (x, z) in the world (none: flat, at 0) — for RecipeFactory.groundAt. */
  heightAt?: (x: number, z: number) => number;
  /** It takes footprints (sand): their colour. */
  footprints?: string;
  dispose(): void;
}

const c3 = (hex: string) => Color3.FromHexString(hex);

export function grassStadium(scene: Scene, at = Vector3.Zero()): Arena {
  const root = new TransformNode('grassStadium', scene);
  root.position.copyFrom(at);
  root.scaling.setAll(STADIUM_SCALE);
  const owned: { dispose(): void }[] = [];
  const mats = new Map<string, StandardMaterial>();
  const flat = (hex: string): StandardMaterial => {
    let m = mats.get(hex);
    if (!m) {
      m = new StandardMaterial(`stadium_${hex}`, scene);
      m.diffuseColor = c3(hex);
      m.specularColor = Color3.Black();
      mats.set(hex, m);
      owned.push(m);
    }
    return m;
  };
  const put = (m: Mesh, mat: StandardMaterial, x: number, y: number, z: number): Mesh => {
    m.material = mat;
    m.position.set(x, y, z);
    m.parent = root;
    m.isPickable = false;
    m.receiveShadows = true;
    owned.push(m);
    return m;
  };
  const box = (name: string, w: number, h: number, d: number, hex: string, x: number, y: number, z: number) =>
    put(MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene), flat(hex), x, y + h / 2, z);

  const innerW = PITCH_W / 2 + PITCH_RUNOFF, innerD = PITCH_D / 2 + PITCH_RUNOFF;

  // ── the meadow, all round ──
  {
    // (Its own material, for its own soft grass: the terrace's lawns share the flat one.)
    const m = new StandardMaterial('stadiumMeadowMat', scene);
    m.diffuseColor = c3(COL.meadow); m.specularColor = Color3.Black();
    owned.push(m, softGrass(scene, m, 90 * STADIUM_SCALE, 70 * STADIUM_SCALE, 3));
    const meadow = put(MeshBuilder.CreateGround('stadiumMeadow', { width: 90, height: 70 }, scene), m, 0, -0.01, 0);
    owned.push(grassFur(scene, meadow, m, 90 * STADIUM_SCALE, 70 * STADIUM_SCALE, STADIUM_SCALE, 9));
  }

  // ── the pitch: its stripes and lines, painted ──
  {
    const tw = 2048, th = Math.round((tw * (innerD * 2)) / (innerW * 2));
    const tex = new DynamicTexture('stadiumPitch', { width: tw, height: th }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    owned.push(tex);
    const g = tex.getContext() as unknown as CanvasRenderingContext2D;
    const px = tw / (innerW * 2); // texels a metre
    const X = (m: number) => (m + innerW) * px, Z = (m: number) => (m + innerD) * px;
    g.fillStyle = COL.stripeA; g.fillRect(0, 0, tw, th);
    const sw = (PITCH_W / STRIPES) * px;
    g.fillStyle = COL.stripeB;
    for (let i = 0; i < STRIPES; i += 2) g.fillRect(X(-PITCH_W / 2) + i * sw, 0, sw, th);
    // (Its run-off mown the darker way.)
    g.fillRect(0, 0, X(-PITCH_W / 2), th); g.fillRect(X(PITCH_W / 2), 0, tw - X(PITCH_W / 2), th);
    g.strokeStyle = COL.line; g.fillStyle = COL.line; g.lineWidth = LINE * px;
    const hw = PITCH_W / 2 - LINE / 2, hd = PITCH_D / 2 - LINE / 2;
    g.strokeRect(X(-hw), Z(-hd), hw * 2 * px, hd * 2 * px);
    g.beginPath(); g.moveTo(X(0), Z(-hd)); g.lineTo(X(0), Z(hd)); g.stroke();
    g.beginPath(); g.arc(X(0), Z(0), CIRCLE_R * px, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(X(0), Z(0), 0.55 * px, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(X(0), Z(0), 0.16 * px, 0, Math.PI * 2); g.fill();
    for (const s of [-1, 1]) {
      const end = s * hw;
      g.strokeRect(Math.min(X(end), X(end - s * BOX[0])), Z(-BOX[1] / 2), BOX[0] * px, BOX[1] * px);
      g.strokeRect(Math.min(X(end), X(end - s * GOAL_BOX[0])), Z(-GOAL_BOX[1] / 2), GOAL_BOX[0] * px, GOAL_BOX[1] * px);
      g.fillRect(X(end - s * MARK_AT) - 0.1 * px, Z(-0.55), 0.2 * px, 1.1 * px);
      // (Its corner arcs.)
      for (const t of [-1, 1]) { g.beginPath(); g.arc(X(end), Z(t * hd), 0.5 * px, 0, Math.PI * 2); g.stroke(); }
    }
    tex.update();
    const m = new StandardMaterial('stadiumPitchMat', scene);
    m.diffuseTexture = tex; m.specularColor = Color3.Black();
    owned.push(m, softGrass(scene, m, innerW * 2 * STADIUM_SCALE, innerD * 2 * STADIUM_SCALE, 1));
    // (Cut finely along its length — the fight's way — so Earthquake's wave can heave it: groundLight's quakes.)
    const pitch = put(MeshBuilder.CreateGround('stadiumPitch', { width: innerW * 2, height: innerD * 2, subdivisionsX: 280, subdivisionsY: 40 }, scene), m, 0, 0, 0);
    owned.push(grassFur(scene, pitch, m, innerW * 2 * STADIUM_SCALE, innerD * 2 * STADIUM_SCALE, STADIUM_SCALE, 5));
  }

  // ── the curb round it, its corner posts, and its gaps for the steps ──
  {
    const y = 0, ow = innerW + CURB_T / 2, od = innerD + CURB_T / 2;
    const runs: [number, number, number, number][] = [ // x0, z0, x1, z1 along its middle
      [-ow, -od, ow, -od], [-ow, od, ow, od], [-ow, -od, -ow, od], [ow, -od, ow, od],
    ];
    for (const [x0, z0, x1, z1] of runs) {
      const len = Math.hypot(x1 - x0, z1 - z0), along = x0 !== x1;
      // In blocks (a stone curb), each with its paler cap.
      const n = Math.max(1, Math.round(len / 1.8)), seg = len / n;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
        const w = along ? seg - 0.04 : CURB_T, d = along ? CURB_T : seg - 0.04;
        box('stadiumCurb', w, CURB_H, d, COL.curb, x, y, z);
        box('stadiumCurbCap', w + 0.04, 0.06, d + 0.04, COL.curbTop, x, y + CURB_H, z);
      }
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      box('stadiumCornerPost', 0.8, 0.7, 0.8, COL.post, sx * ow, y, sz * od);
      box('stadiumCornerCap', 0.9, 0.08, 0.9, COL.curbTop, sx * ow, y + 0.7, sz * od);
    }
  }

  // ── each end: steps (north, up to a terrace) or a plaza (south), pillars, banners, hedges ──
  const banner = (() => {
    const tex = new DynamicTexture('stadiumBanner', { width: 128, height: 256 }, scene, true);
    owned.push(tex);
    const g = tex.getContext() as unknown as CanvasRenderingContext2D;
    g.fillStyle = COL.banner; g.fillRect(0, 0, 128, 256);
    g.fillStyle = COL.bannerTrim; g.fillRect(0, 0, 128, 14); g.fillRect(0, 242, 128, 14);
    g.fillRect(0, 0, 8, 256); g.fillRect(120, 0, 8, 256);
    // A Pokéball, white on the blue: its ring, its band, its button.
    g.strokeStyle = '#f4f4f4'; g.lineWidth = 9;
    g.beginPath(); g.arc(64, 112, 38, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(26, 112); g.lineTo(102, 112); g.stroke();
    g.fillStyle = '#f4f4f4'; g.beginPath(); g.arc(64, 112, 12, 0, Math.PI * 2); g.fill();
    g.fillStyle = COL.banner; g.beginPath(); g.arc(64, 112, 6, 0, Math.PI * 2); g.fill();
    tex.update();
    const m = new StandardMaterial('stadiumBannerMat', scene);
    m.diffuseTexture = tex; m.specularColor = Color3.Black(); m.emissiveColor = new Color3(0.12, 0.12, 0.16);
    m.backFaceCulling = false;
    owned.push(m);
    return m;
  })();
  const pillar = (x: number, z: number, faceZ: number, withBanner: boolean) => {
    box('stadiumPillarBase', 0.95, 0.25, 0.95, COL.stoneDark, x, 0, z);
    box('stadiumPillar', 0.7, 2.1, 0.7, COL.stone, x, 0.25, z);
    if (withBanner) {
      // Its banner hung on its face toward the pitch.
      const b = MeshBuilder.CreatePlane('stadiumBannerCloth', { width: 0.62, height: 1.4 }, scene);
      put(b, banner, x, 1.45, z + faceZ * 0.37);
      b.rotation.y = faceZ > 0 ? Math.PI : 0;
      box('stadiumPillarCap', 0.85, 0.16, 0.85, COL.stoneDark, x, 2.35, z);
    } else {
      // Beside the steps: capped in gold.
      box('stadiumPillarCap', 0.86, 0.14, 0.86, COL.stoneDark, x, 2.35, z);
      box('stadiumPillarGold', 0.55, 0.28, 0.55, COL.gold, x, 2.49, z);
    }
  };
  const hedge = (x0: number, x1: number, z: number) => {
    const w = Math.abs(x1 - x0);
    box('stadiumHedge', w, 0.85, 0.9, COL.hedge, (x0 + x1) / 2, 0, z);
    box('stadiumHedgeTop', w - 0.08, 0.12, 0.82, COL.hedgeTop, (x0 + x1) / 2, 0.85, z);
  };
  for (const end of [-1, 1]) { // -1 north, +1 south
    const edge = end * (innerD + CURB_T);
    const steps = end < 0, depth = steps ? NORTH_DEPTH : SOUTH_DEPTH;
    if (steps) {
      // Steps up to a terrace: each a stone slab, stepping back and up.
      const n = 6, rise = 0.2, run = depth / n;
      for (let i = 0; i < n; i++) box('stadiumStep', STEPS_W, rise * (i + 1), run + 0.02, i % 2 ? COL.stone : COL.curbTop, 0, 0, edge + end * (run * (i + 0.5)));
      // The terrace: paved behind the steps, lawn either side of that.
      box('stadiumTerrace', STEPS_W + 2.4, rise * n, 4, COL.paving, 0, 0, edge + end * (depth + 2));
      for (const sx of [-1, 1]) box('stadiumTerraceLawn', 13, rise * n, 4, COL.meadow, sx * (STEPS_W / 2 + 1.2 + 6.5), 0, edge + end * (depth + 2));
      box('stadiumTerraceFace', 30, rise * n - 0.02, 0.1, COL.stoneDark, 0, 0, edge + end * depth);
    } else {
      // A plaza, paved in a checker, its steps down at its far side.
      const tiles = 6, tw = STEPS_W / tiles;
      for (let i = 0; i < tiles; i++) for (let j = 0; j < 4; j++)
        box('stadiumPaving', tw - 0.03, 0.04, depth / 4 - 0.03, (i + j) % 2 ? COL.paving : COL.pavingDark, -STEPS_W / 2 + tw * (i + 0.5), 0, edge + end * (depth / 4) * (j + 0.5));
      for (let i = 0; i < 3; i++) box('stadiumStepDown', STEPS_W, 0.04, 0.5, i % 2 ? COL.stone : COL.curbTop, 0, -0.12 * (i + 1), edge + end * (depth + 0.25 + i * 0.5));
    }
    // The pillars: gold-capped beside the steps, bannered outside them.
    const pz = edge + end * 0.75;
    for (const sx of [-1, 1]) {
      pillar(sx * (STEPS_W / 2 + 0.6), pz, -end, false);
      pillar(sx * (STEPS_W / 2 + 2.7), pz, -end, true);
      hedge(sx * (STEPS_W / 2 + 3.3), sx * (STEPS_W / 2 + 6.6), pz);
    }
  }

  // ── the pines all round (a handful of shapes, many of each) ──
  {
    const trunkMat = flat(COL.trunk), canopyMat = flat(COL.canopy);
    canopyMat.backFaceCulling = false; canopyMat.twoSidedLighting = true;
    canopyMat.emissiveColor = new Color3(0.06, 0.12, 0.04);
    const kinds = [11, 23, 37, 41, 59, 73].map((seed) => {
      const t = lowPolyTree(`stadiumTree${seed}`, seed, scene);
      t.trunk.material = trunkMat; t.canopy.material = canopyMat;
      for (const m of [t.trunk, t.canopy]) { m.isVisible = false; m.isPickable = false; m.parent = root; owned.push(m); }
      return t;
    });
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const plant = (x: number, z: number) => {
      const k = kinds[Math.floor(rnd() * kinds.length)], s = 1.25 + rnd() * 0.7, ry = rnd() * Math.PI * 2;
      for (const [i, m] of [k.trunk, k.canopy].entries()) {
        const inst = m.createInstance(`stadiumTreeAt${i}`);
        inst.parent = root; inst.isPickable = false;
        inst.position.set(x, 0, z); inst.scaling.setAll(s); inst.rotation.y = ry;
      }
    };
    // Rows down either side, past the curb; and behind each end, leaving its steps clear.
    const sideX = innerW + 2.2;
    for (const sx of [-1, 1]) for (let row = 0; row < 3; row++) for (let z = -innerD - 4; z <= innerD + 4; z += 1.9)
      plant(sx * (sideX + row * 1.9 + rnd() * 0.6), z + rnd() * 0.8);
    for (const end of [-1, 1]) for (let row = 0; row < 2; row++) for (let x = -innerW - 4; x <= innerW + 4; x += 2.0) {
      if (Math.abs(x) < STEPS_W / 2 + 7.5) continue;
      plant(x + rnd() * 0.7, end * (innerD + CURB_T + 2.4 + row * 2.0 + rnd() * 0.5));
    }
    // And a wood behind the terrace, all the way across.
    for (let row = 0; row < 3; row++) for (let x = -innerW - 4; x <= innerW + 4; x += 1.9)
      plant(x + rnd() * 0.7, -(innerD + CURB_T + NORTH_DEPTH + 4.8 + row * 1.9 + rnd() * 0.5));
  }

  // ── flowers in its corners: low-poly blooms, white and yellow ──
  {
    const bloom = (hex: string) => {
      const m = MeshBuilder.CreateCylinder('stadiumBloom', { diameterTop: 0.18, diameterBottom: 0.1, height: 0.08, tessellation: 5 }, scene);
      m.material = flat(hex); m.isVisible = false; m.isPickable = false; m.parent = root; owned.push(m);
      return m;
    };
    const blooms = [bloom(COL.flowerW), bloom(COL.flowerY), bloom(COL.flowerC)];
    let seed = 99;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let i = 0; i < 26; i++) {
      const b = blooms[Math.floor(rnd() * blooms.length)].createInstance('stadiumFlower');
      b.parent = root; b.isPickable = false;
      b.position.set(sx * (innerW + 0.9 + rnd() * 1.1), 0.05, sz * (innerD - 1.5 + rnd() * 3.4));
    }
  }

  return {
    root,
    bounds: { halfW: innerW * STADIUM_SCALE, halfD: innerD * STADIUM_SCALE, y: at.y },
    air: { fog: c3(COL.sky), fogStart: FOG[0] * STADIUM_SCALE, fogEnd: FOG[1] * STADIUM_SCALE },
    dispose: () => { for (const o of owned.reverse()) o.dispose(); root.dispose(); },
  };
}
