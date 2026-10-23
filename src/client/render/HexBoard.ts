/**
 * HexBoard — builds the 61-tile flat-top hex board with terrain, zone overlays,
 * tile highlighting, and pointer picking.
 */

import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import type { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo';
import { flareTexture, smokeTexture } from './textures.ts';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { pondWaterMaterial } from './waterMaterial.ts';
import { grassPatches } from './grass.ts';
import { lowPolyTree } from './trees.ts';
import { grassFireMaterial, fireLookKey, type FireLook } from './grassFire.ts';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import type { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';

import {
  HEX_GRID,
  hexDistance,
  keyToTile,
  tileKey,
  footprint,
  TerrainType,
  isGrassTile,
  tileTint,
  hexLineTiles,
  type BattleStateJSON,
  type TerrainEntityJSON,
} from '../../shared/index.ts';
import { axialToWorld, HEX_SIZE, HEX_GAP, TILE_SCALE } from '../hexWorld.ts';
import { HIGHLIGHT_COLORS, hexToRgb, ENV, type HighlightType } from '../theme.ts';

const TILE_HEIGHT = 0.4;

function mat(scene: Scene, name: string, hex: string, opts?: Partial<{ emissive: string; alpha: number; specular: number }>): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  const [r, g, b] = hexToRgb(hex);
  m.diffuseColor = new Color3(r, g, b);
  m.specularColor = new Color3(opts?.specular ?? 0.1, opts?.specular ?? 0.1, opts?.specular ?? 0.1);
  if (opts?.emissive) {
    const [er, eg, eb] = hexToRgb(opts.emissive);
    m.emissiveColor = new Color3(er, eg, eb);
  }
  if (opts?.alpha !== undefined) m.alpha = opts.alpha;
  return m;
}

interface ZoneVisual {
  overlay: Mesh;
  props: TransformNode;
  particles?: ParticleSystem;
}

/** Gap between an obstacle's top and a hovering flier's root (its legs hang below it). */
const HOVER_CLEAR = 0.55;

/**
 * Earthquake: each heaved tile bounces once (QUAKE_LIFT high, up over
 * QUAKE_UP s, down over QUAKE_DOWN s, a small rebound over QUAKE_SETTLE s),
 * the outer ring QUAKE_RING_DELAY s after the inner, and settles tilted
 * inward by QUAKE_TILT rad — its surface leaning toward the quake's centre.
 */
const QUAKE_LIFT = 0.55, QUAKE_UP = 0.16, QUAKE_DOWN = 0.2, QUAKE_SETTLE = 0.22, QUAKE_RING_DELAY = 0.12;
const QUAKE_TILT = 0.13;
/** A felled tree: falls over (TREE_FALL rad, outward) in TREE_TOPPLE s, lies TREE_LIE s, sinks away in TREE_SINK s. */
const TREE_FALL = Math.PI / 2 - 0.08, TREE_TOPPLE = 0.7, TREE_LIE = 0.5, TREE_SINK = 0.6;
const easeOutCubic = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const easeInQuad = (x: number) => Math.min(1, Math.max(0, x)) ** 2;

/** A grass fire's smoke: puffs a second off each tile, and how opaque each starts (thin: just for effect). */
const SMOKE_RATE = 6, SMOKE_ALPHA = 0.95;

/** Triangles along each side of a pond tile's surface (the waves rise on its vertices). */
const POND_DIVS = 18;
/** How far in from a shore side (× the tile's circumradius) the waves reach full height. */
const POND_SHORE = 0.35;

/**
 * A pond tile's surface: a flat-top hex of circumradius `R` cut into a fine
 * triangle grid (POND_DIVS a side), each vertex carrying a `fade` — 0 on any
 * side facing land (`shore[k]`: the side from corner k to k + 1), rising to 1
 * POND_SHORE × R in — so the waves stand up inside and lie flat at the shore.
 * Its corners sit where a 6-sided cylinder's do, so neighbours meet exactly.
 */
function pondMesh(name: string, R: number, shore: readonly boolean[], scene: Scene): Mesh {
  const corner = (k: number): [number, number] => [R * Math.cos((k * Math.PI) / 3), R * Math.sin((k * Math.PI) / 3)];
  const inR = (R * Math.sqrt(3)) / 2;
  const fadeAt = (x: number, z: number): number => {
    let f = 1;
    for (let k = 0; k < 6; k++) {
      if (!shore[k]) continue;
      const a = ((k * 60 + 30) * Math.PI) / 180;
      const d = inR - (x * Math.cos(a) + z * Math.sin(a)); // in from side k
      const t = Math.min(1, Math.max(0, d / (POND_SHORE * R)));
      f = Math.min(f, t * t * (3 - 2 * t));
    }
    return f;
  };
  const positions: number[] = [], fade: number[] = [], indices: number[] = [];
  const N = POND_DIVS;
  for (let k = 0; k < 6; k++) {
    const [ax, az] = corner(k), [bx, bz] = corner(k + 1);
    const base = positions.length / 3;
    const at = (i: number, j: number) => base + (i * (i + 1)) / 2 + j; // row i (0 = centre) has i + 1 points
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= i; j++) {
        // From the centre out to row i, across from corner k to corner k + 1.
        const u = i / N, v = i ? j / i : 0;
        const x = u * (ax + (bx - ax) * v), z = u * (az + (bz - az) * v);
        positions.push(x, 0, z);
        fade.push(fadeAt(x, z));
      }
    }
    for (let i = 0; i < N; i++) {
      for (let j = 0; j <= i; j++) {
        indices.push(at(i, j), at(i + 1, j + 1), at(i + 1, j));
        if (j < i) indices.push(at(i, j), at(i, j + 1), at(i + 1, j + 1));
      }
    }
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh);
  mesh.setVerticesData('fade', fade, false, 1);
  // Shaped in the shader: never culled for its flat bounds.
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}

/**
 * A rock cut to its hex: a faceted, low-poly boulder of a random shape on a
 * hex tile of circumradius `R`, never past the tile. Its surface is ROCK_RINGS
 * rings of ROCK_POINTS points; at every point the hex's own outline (scaled
 * by ROCK_FOOT) is the limit, and the rock fills some share of it: a profile
 * up its height (a foot, a random waist, a crown drawn in), cut into by a
 * few random lumps and clefts round it (low-frequency waves in angle, their
 * phases drifting with height), leaning a little one way. The crown is an
 * uneven, off-centre peak. All of it from `seed`, so each rock keeps its own
 * shape. Flat-shaded, for the facets.
 */
const ROCK_FOOT = 0.94, ROCK_HEIGHT: [number, number] = [0.5, 0.85], ROCK_RINGS = 6, ROCK_POINTS = 24;
function hexRock(name: string, R: number, seed: number, scene: Scene): Mesh {
  let s = seed || 1;
  const rand = () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return s / 4294967296; };
  const span = (lo: number, hi: number) => lo + (hi - lo) * rand();
  const h = R * span(ROCK_HEIGHT[0], ROCK_HEIGHT[1]);
  // The hex's edge at angle a (flat-top: corners at multiples of 60°).
  const edge = (a: number) => {
    const t = ((a % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3) - Math.PI / 6;
    return (R * Math.cos(Math.PI / 6)) / Math.cos(t);
  };
  // Its lumps and clefts: a few waves round it, of random count, size and phase.
  const waves = Array.from({ length: 4 }, (_, i) => ({ n: 2 + i + Math.floor(rand() * 2), amp: span(0.04, 0.13) / (1 + i * 0.4), ph: rand() * 6.283, drift: span(-2, 2) }));
  const bump = (a: number, y: number) => waves.reduce((acc, w) => acc + w.amp * Math.sin(w.n * a + w.ph + w.drift * y), 0);
  // Its profile up the height: the foot full, a random waist, the crown drawn in.
  const waist = span(0.3, 0.6), waistOut = span(0.95, 1.0), crown = span(0.35, 0.6), round = span(1.1, 1.8);
  const profile = (y: number) => y < waist
    ? 1 + (waistOut - 1) * (y / waist)
    : waistOut + (crown - waistOut) * Math.pow((y - waist) / (1 - waist), round);
  const leanA = rand() * 6.283, lean = span(0, 0.12) * R;
  const positions: number[] = [], indices: number[] = [];
  const at = (i: number, k: number) => i * ROCK_POINTS + (k % ROCK_POINTS);
  for (let i = 0; i < ROCK_RINGS; i++) {
    const y = i / (ROCK_RINGS - 1) * 0.9; // the last ring sits under the crown
    for (let k = 0; k < ROCK_POINTS; k++) {
      const a = (k / ROCK_POINTS) * Math.PI * 2 + (i ? span(-0.06, 0.06) : 0);
      const limit = edge(a) * ROCK_FOOT;
      const fill = Math.min(1, Math.max(0.35, profile(y) * (1 - Math.max(0, bump(a, y))) + (i ? span(-0.03, 0.03) : 0)));
      let x = Math.cos(a) * limit * fill, z = Math.sin(a) * limit * fill;
      // Lean the upper rings, then pull back inside the hex if the lean pushed out.
      x += Math.cos(leanA) * lean * y; z += Math.sin(leanA) * lean * y;
      const r = Math.hypot(x, z), cap = edge(Math.atan2(z, x)) * ROCK_FOOT;
      if (r > cap) { x *= cap / r; z *= cap / r; }
      positions.push(x, i ? h * y * span(0.92, 1.08) : 0, z);
    }
  }
  for (let i = 0; i < ROCK_RINGS - 1; i++) {
    for (let k = 0; k < ROCK_POINTS; k++) indices.push(at(i, k), at(i, k + 1), at(i + 1, k), at(i, k + 1), at(i + 1, k + 1), at(i + 1, k));
  }
  // The crown: an uneven, off-centre peak.
  const top = positions.length / 3;
  positions.push(Math.cos(leanA) * lean + span(-0.12, 0.12) * R, h * span(0.95, 1.05), Math.sin(leanA) * lean + span(-0.12, 0.12) * R);
  const last = ROCK_RINGS - 1;
  for (let k = 0; k < ROCK_POINTS; k++) indices.push(at(last, k), at(last, k + 1), top);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  vd.normals = normals;
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh, true);
  mesh.convertToFlatShadedMesh();
  return mesh;
}

export class HexBoard {
  readonly root: TransformNode;
  private readonly scene: Scene;
  private readonly tiles = new Map<string, Mesh>();
  private readonly highlights = new Map<string, Mesh>();
  private readonly zones = new Map<string, ZoneVisual>();
  private terrainProps = new Map<string, TransformNode>(); // rock/tree feature nodes keyed by "q,r"
  private weatherParticles: ParticleSystem | null = null;
  /** The pond surface (made on the first pond), and each pond tile's surface mesh by "q,r". */
  private pondMat: ShaderMaterial | null = null;
  private ponds = new Map<string, Mesh>();
  /** Grass on fire: the burning copy of each burning tile's grass, by "q,r", and their material (made on the first fire). */
  private flames = new Map<string, Mesh>();
  /** The thin smoke rising off each burning tile. */
  private smokes = new Map<string, ParticleSystem>();
  private fireMats = new Map<string, ShaderMaterial>();
  /** The fire colour (an element: 'Fire', 'BlueFire'…) of the player whose fire lit a tile (setFireHue). */
  private fireHue: (owner: number) => string = () => 'Fire';

  /** How to colour a grass fire by who lit it (its owner's Fire: blue for blue flames). */
  setFireHue(fn: (owner: number) => string): void { this.fireHue = fn; }

  /** Told the weather and the terrain on the field at every sync (FieldFx.set). */
  private fieldListener: ((weather: string | null, terrain: string | null) => void) | null = null;
  onField(fn: (weather: string | null, terrain: string | null) => void): void { this.fieldListener = fn; }

  private mats: {
    tiles: StandardMaterial[]; // shared grassy/earthy tile tints (per-tile jitter)
    rock: StandardMaterial;
    trunk: StandardMaterial;
    canopy: StandardMaterial;
    edge: StandardMaterial;
    /** Grass burned away: charred earth. */
    scorched: StandardMaterial;
  };

  /** Ends the quake animation running, if any (its promises resolve; the state sync then sets the tiles). */
  private stopQuake: (() => void) | null = null;

  private tileHoverCb: ((tile: [number, number]) => void) | null = null;
  private tilePickCb: ((tile: [number, number]) => void) | null = null;
  private lastHover: string | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
    this.root = new TransformNode('board', scene);

    // A small palette of shared grassy/earthy tile tints. Per-tile jitter is
    // achieved by deterministically picking + micro-perturbing one of these,
    // so we keep a handful of materials rather than 61 unique ones.
    const tileHexes = [ENV.tileGrass, ENV.tileGrassAlt, ENV.tileGrass, ENV.tileEarth, ENV.tileGrassAlt];
    const tileMats = tileHexes.map((hex, i) => {
      const m = mat(scene, `tile${i}`, hex, { specular: 0.03 });
      // gentle per-material green/tan jitter to avoid a uniform look
      const j = (i * 0.017) % 0.05;
      m.diffuseColor.g = Math.min(1, m.diffuseColor.g + j);
      m.diffuseColor.r = Math.max(0, m.diffuseColor.r - j * 0.5);
      return m;
    });

    this.mats = {
      tiles: tileMats,
      rock: mat(scene, 'rock', ENV.rock, { specular: 0.15 }),
      trunk: mat(scene, 'trunk', ENV.trunk),
      canopy: mat(scene, 'canopy', ENV.canopy[3], { emissive: '#152608' }),
      edge: mat(scene, 'edge', ENV.dirtEdge),
      scorched: mat(scene, 'scorched', '#3D3128', { specular: 0.02 }),
    };

    // Leaves are open fans of triangles: drawn and lit from both faces.
    this.mats.canopy.backFaceCulling = false;
    this.mats.canopy.twoSidedLighting = true;

    this.buildTiles();
    this.plantGrass();
    this.installPicking();
  }

  private buildTiles(): void {
    for (const key of HEX_GRID) {
      const [q, r] = keyToTile(key);
      const pos = axialToWorld(q, r, 0);
      // Deterministic per-tile hash for stable material + tiny thickness jitter.
      const h = ((q * 73856093) ^ (r * 19349663)) >>> 0;
      // Its tint (shared with the engine: grass grows on all but the earth tint, and burns).
      const matIdx = tileTint(q, r);
      // Tiny thickness jitter for a natural, hand-placed feel. We keep the TOP
      // surface fixed at TILE_HEIGHT (so tileTop world coords are unchanged and
      // pokémon still land on centers); only the bottom sinks a hair.
      const extra = ((h >> 8) % 100) / 100 * 0.08; // 0..0.08
      const height = TILE_HEIGHT + extra;
      const tile = MeshBuilder.CreateCylinder(
        `tile_${key}`,
        { diameter: HEX_SIZE * 2, height, tessellation: 6 },
        this.scene,
      );
      tile.rotation.y = 0; // flat-top: edges meet neighbors (share sides, not vertices)
      // Center so the top surface stays exactly at TILE_HEIGHT.
      tile.position = new Vector3(pos.x, TILE_HEIGHT - height / 2, pos.z);
      tile.material = this.mats.tiles[matIdx];
      tile.receiveShadows = true;
      tile.parent = this.root;
      tile.metadata = { q, r, key, material: tile.material };
      // Turned about its top's middle (a tilt keeps that point, where a Pokémon stands, in place).
      tile.setPivotPoint(new Vector3(0, height / 2, 0));
      tile.rotationQuaternion = Quaternion.Identity();
      this.tiles.set(key, tile);
    }
  }

  /**
   * Low-poly grass on every grass-coloured tile (not the earthy ones): one of
   * a few grass patches (grass.ts), instanced on the tile's top and turned by
   * a multiple of 60° — on the tile, so it rides any heave. syncTerrain and
   * setTilt hide it where the ground is bare (a pond, a rock, tilted earth).
   */
  private plantGrass(): void {
    const patches = grassPatches(this.scene, (HEX_SIZE * Math.sqrt(3)) / 2);
    for (const [key, tile] of this.tiles) {
      const [q, r] = keyToTile(key);
      if (!isGrassTile(q, r)) continue;
      const h = ((q * 83492791) ^ (r * 2654435761)) >>> 0;
      const grass = patches[h % patches.length].createInstance(`grass_${key}`);
      grass.parent = tile;
      const height = tile.getBoundingInfo().boundingBox.extendSize.y * 2;
      grass.position.set(0, height / 2, 0);
      grass.rotation.y = ((h >> 4) % 6) * (Math.PI / 3);
      grass.isPickable = false;
      tile.metadata.grass = grass;
    }
  }

  /**
   * A tile's grass on fire: a copy of its grass patch (same blades, same
   * place) in the flame material (grassFire.ts), on the tile so it rides any
   * heave, in its fire's look (`look`). The tile's ordinary grass is hidden
   * while it burns (it is `bare`).
   */
  private setGrassAlight(key: string, tile: Mesh, look: FireLook): void {
    const grass = tile.metadata.grass as InstancedMesh | undefined;
    if (!grass) return;
    const id = fireLookKey(look);
    if (!this.fireMats.has(id)) this.fireMats.set(id, grassFireMaterial(this.scene, look));
    // Burning already: it just takes the new look.
    const lit = this.flames.get(key);
    if (lit) { lit.material = this.fireMats.get(id)!; return; }
    const flame = new Mesh(`grassFire_${key}`, this.scene, null, grass.sourceMesh, false, false);
    flame.isVisible = true;
    flame.material = this.fireMats.get(id)!;
    flame.parent = tile;
    flame.position.copyFrom(grass.position);
    flame.rotation.copyFrom(grass.rotation);
    flame.isPickable = false;
    flame.alwaysSelectAsActiveMesh = true;
    this.flames.set(key, flame);
    this.smokes.set(key, this.makeSmoke(key, tile));
  }

  /**
   * A thin smoke off a burning tile, just for effect (never enough to cloud
   * the board): SMOKE_RATE soft grey puffs a second rising slowly from the
   * flames, swelling as they climb and fading out, drifting with the wind.
   */
  private makeSmoke(key: string, tile: Mesh): ParticleSystem {
    const ps = new ParticleSystem(`grassSmoke_${key}`, 40, this.scene);
    ps.particleTexture = smokeTexture(this.scene);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    const top = tile.getBoundingInfo().boundingBox.extendSize.y;
    ps.emitter = tile;
    const r = HEX_SIZE * 0.55;
    // Off the flames themselves, from in among the grass.
    ps.minEmitBox = new Vector3(-r, top - 0.02, -r);
    ps.maxEmitBox = new Vector3(r, top + 0.06, r);
    // Dark grey: fades in off the flames, holds, then thins away as it climbs.
    ps.addColorGradient(0, new Color4(0.12, 0.12, 0.12, 0));
    ps.addColorGradient(0.15, new Color4(0.14, 0.14, 0.14, SMOKE_ALPHA));
    ps.addColorGradient(0.55, new Color4(0.2, 0.2, 0.2, SMOKE_ALPHA * 0.7));
    ps.addColorGradient(1, new Color4(0.26, 0.26, 0.26, 0));
    ps.addSizeGradient(0, 0.5);
    ps.addSizeGradient(1, 1.8);
    ps.minLifeTime = 2.6;
    ps.maxLifeTime = 3.8;
    ps.emitRate = SMOKE_RATE;
    ps.direction1 = new Vector3(-0.08, 1, -0.08);
    ps.direction2 = new Vector3(0.08, 1, 0.08);
    ps.minEmitPower = 0.35;
    ps.maxEmitPower = 0.55;
    // Drifts off with the grass's wind (grass.ts's WIND_DIR, roughly).
    ps.gravity = new Vector3(0.09, 0.02, 0.05);
    ps.minAngularSpeed = -0.4;
    ps.maxAngularSpeed = 0.4;
    ps.minInitialRotation = 0;
    ps.maxInitialRotation = Math.PI * 2;
    ps.start();
    return ps;
  }

  /**
   * Set alight, now, the grass fires `state` has that are not burning yet —
   * as a Flamethrower lands, before the turn's full sync (syncTerrain) at
   * its end. Only the fires: nothing else of the new state is shown early.
   */
  lightGrassFires(state: BattleStateJSON): void {
    // Fires burning on the board that the state has not (a Flamethrower that
    // lost its clash): put out, the grass back as it was.
    const burning = new Set(state.terrain
      .filter((t) => t.terrain_type === TerrainType.BURN_ZONE && t.grass_fire)
      .map((t) => tileKey(t.tile[0], t.tile[1])));
    for (const key of [...this.flames.keys()]) {
      if (burning.has(key)) continue;
      this.flames.get(key)!.dispose();
      this.flames.delete(key);
      this.smokes.get(key)?.dispose(false);
      this.smokes.delete(key);
      const tile = this.tiles.get(key);
      if (tile) { tile.metadata.bare = false; this.showGrass(tile, true); }
    }
    for (const t of state.terrain) {
      if (t.terrain_type !== TerrainType.BURN_ZONE || !t.grass_fire) continue;
      const key = tileKey(t.tile[0], t.tile[1]);
      const tile = this.tiles.get(key);
      if (!tile) continue;
      tile.metadata.bare = true;
      this.showGrass(tile, true);
      // New fires light; ones already burning take their final look (a clash's winner, or its split).
      this.setGrassAlight(key, tile, this.fireLook(t));
    }
  }

  /**
   * A beam clash holding: the grass between the two beams' users burns now,
   * each half in its own beam's fire (`fire`: whether that side's beam is a
   * fire), on every grass tile there that `before` (the state the turn began
   * from) had unburnt and bare of anything else. As the clash resolves,
   * lightGrassFires gives them the outcome: recoloured, kept, or put out.
   */
  lightClashFires(before: BattleStateJSON, a: { tile: [number, number]; pid: number; fire: boolean }, b: { tile: [number, number]; pid: number; fire: boolean }): void {
    if (!a.fire && !b.fire) return;
    const scorched = new Set(before.scorched ?? []);
    const taken = new Set(before.terrain.map((t) => tileKey(t.tile[0], t.tile[1])));
    const look = this.splitLook({ a: a.tile, b: b.tile, oa: a.fire ? a.pid : -1, ob: b.fire ? b.pid : -1 });
    const line = hexLineTiles(a.tile[0], a.tile[1], b.tile[0], b.tile[1]).slice(1, -1); // between the two
    for (const [q, r] of line) {
      const key = tileKey(q, r);
      const tile = this.tiles.get(key);
      if (!tile || !isGrassTile(q, r) || scorched.has(key) || taken.has(key)) continue;
      tile.metadata.bare = true;
      this.showGrass(tile, true);
      this.setGrassAlight(key, tile, look);
    }
  }

  /** How a grass fire looks: its lighter's fire, or a tied clash's two fires split at the middle. */
  private fireLook(t: TerrainEntityJSON): FireLook {
    return t.split ? this.splitLook(t.split) : { a: this.fireHue(t.owner) };
  }

  /** Two fires split across the middle of the line from `a` to `b` (owner -1: no fire on that side). */
  private splitLook(s: { a: [number, number]; b: [number, number]; oa: number; ob: number }): FireLook {
    const pa = this.tileTop(s.a[0], s.a[1]), pb = this.tileTop(s.b[0], s.b[1]);
    const n = pb.subtract(pa);
    n.y = 0;
    return {
      a: s.oa >= 0 ? this.fireHue(s.oa) : null,
      b: s.ob >= 0 ? this.fireHue(s.ob) : null,
      planeP: Vector3.Center(pa, pb),
      planeN: n.normalize(),
    };
  }

  /** Show a tile's grass unless its ground is bare (`tile.metadata.bare`) or tilted. */
  private showGrass(tile: Mesh, flat: boolean): void {
    tile.metadata.grass?.setEnabled(flat && !tile.metadata.bare);
  }

  /**
   * Where a Pokémon at anchor (q, r) stands: its tile's top, or for a huge one
   * the middle of its three-tile triangle.
   */
  standPoint(q: number, r: number, huge = false): Vector3 {
    const feet = footprint([q, r], huge);
    const p = new Vector3(0, 0, 0);
    for (const [fq, fr] of feet) p.addInPlace(this.tileTop(fq, fr));
    return p.scaleInPlace(1 / feet.length);
  }

  /** The hover height over a whole footprint (a huge flier clears its tallest obstacle). */
  hoverOver(q: number, r: number, huge = false): number {
    return Math.max(...footprint([q, r], huge).map(([fq, fr]) => this.hoverHeight(fq, fr)));
  }

  /** World position of a tile top surface (for placing units / vfx). */
  tileTop(q: number, r: number): Vector3 {
    return axialToWorld(q, r, TILE_HEIGHT);
  }

  /**
   * How high a flier hovers over this tile, above its top: clear of the rock
   * or tree standing on it (plus HOVER_CLEAR for the hanging legs), or 0 for
   * a tile with nothing on it.
   */
  hoverHeight(q: number, r: number): number {
    const prop = this.terrainProps.get(tileKey(q, r));
    if (!prop) return 0;
    let top = -Infinity;
    for (const m of prop.getChildMeshes()) {
      m.computeWorldMatrix(true);
      top = Math.max(top, m.getBoundingInfo().boundingBox.maximumWorld.y);
    }
    return Number.isFinite(top) ? Math.max(0, top - TILE_HEIGHT) + HOVER_CLEAR : 0;
  }

  getTileMesh(key: string): Mesh | undefined {
    return this.tiles.get(key);
  }

  // ── Terrain sync ──────────────────────────
  syncTerrain(state: BattleStateJSON): void {
    // Clear feature/zone visuals, then rebuild from state.
    for (const node of this.terrainProps.values()) node.dispose();
    this.terrainProps.clear();
    for (const z of this.zones.values()) {
      z.overlay.dispose();
      z.props.dispose();
      z.particles?.dispose(false); // (the texture is shared)
    }
    this.zones.clear();
    for (const m of this.ponds.values()) m.dispose();
    this.ponds.clear();
    for (const m of this.flames.values()) m.dispose();
    this.flames.clear();
    for (const p of this.smokes.values()) p.dispose(false); // (the texture is shared)
    this.smokes.clear();

    // Tilted ground (Earthquake's aftermath) leans in toward its quake's centre;
    // every other tile lies flat.
    this.stopQuake?.();
    const tilted = new Map<string, [number, number]>();
    for (const t of state.terrain) {
      if (t.terrain_type === TerrainType.TILTED && t.origin) tilted.set(tileKey(t.tile[0], t.tile[1]), t.origin);
    }
    // Bare ground (no grass): ponds, rocks, and grass burned away (scorched:
    // charred earth). Grass still burning shows as flame (its own tufts), on
    // its tint until the fire is out.
    const fires = new Map(state.terrain
      .filter((t) => t.terrain_type === TerrainType.BURN_ZONE && t.grass_fire)
      .map((t) => [tileKey(t.tile[0], t.tile[1]), t] as [string, TerrainEntityJSON]));
    const scorched = new Set(state.scorched ?? []);
    const bare = new Set([...scorched, ...state.terrain
      .filter((t) => t.terrain_type === TerrainType.WATER || t.terrain_type === TerrainType.ROCK)
      .map((t) => tileKey(t.tile[0], t.tile[1]))]);
    for (const [key, tile] of this.tiles) {
      tile.metadata.bare = bare.has(key);
      tile.metadata.material = scorched.has(key) && !fires.has(key) ? this.mats.scorched : this.mats.tiles[tileTint(...keyToTile(key))];
      if (fires.has(key)) this.setGrassAlight(key, tile, this.fireLook(fires.get(key)!));
    }
    for (const [key, tile] of this.tiles) {
      const origin = tilted.get(key);
      this.setTilt(tile, origin ? this.tiltToward(key, origin) : Quaternion.Identity(), 0);
    }

    let sunny = false;
    let rainy = false;
    let weather: string | null = null;
    let fieldTerrain: string | null = null;
    const waterKeys = new Set(state.terrain.filter((t) => t.terrain_type === TerrainType.WATER).map((t) => tileKey(t.tile[0], t.tile[1])));

    for (const t of state.terrain) {
      if (t.terrain_type === TerrainType.TILTED) continue; // the tilt is its look
      if (t.terrain_type === TerrainType.BURN_ZONE && t.grass_fire) continue; // its burning grass is its look
      const type = t.terrain_type as TerrainType;
      if (type === TerrainType.SUNNY_ZONE) {
        sunny = true;
        weather = type;
        continue;
      }
      if (type === TerrainType.RAIN_ZONE) {
        rainy = true;
        weather = type;
        continue;
      }
      // The rest of the field-wide effects: their look is FieldFx's.
      if (type === TerrainType.HAIL || type === TerrainType.SANDSTORM) { weather = type; continue; }
      if (type === TerrainType.ELECTRIC_TERRAIN || type === TerrainType.GRASSY_TERRAIN
        || type === TerrainType.MISTY_TERRAIN || type === TerrainType.PSYCHIC_TERRAIN) { fieldTerrain = type; continue; }
      if (type === TerrainType.WATER) this.buildPond(t, waterKeys);
      else if (type === TerrainType.ROCK) this.buildRock(t);
      else if (type === TerrainType.TREE) this.buildTree(t);
      else this.buildZone(t);
    }

    this.applyWeather(sunny, rainy);
    this.fieldListener?.(weather, fieldTerrain);
  }

  /**
   * A pond tile: the water surface (waterMaterial) laid over the tile's top,
   * on the tile itself so it rides any heave. It spans the tile's whole cell,
   * gap and all, so neighbouring water tiles join with no seam (the cells show
   * only when highlighted); all ponds share one material, so the waves run on
   * unbroken across them.
   */
  private buildPond(t: TerrainEntityJSON, water: ReadonlySet<string>): void {
    const [q, r] = t.tile;
    const key = tileKey(q, r);
    const tile = this.tiles.get(key);
    if (!tile) return;
    if (!this.pondMat) this.pondMat = pondWaterMaterial(this.scene);
    // Which of its six sides face land: the waves calm to flat along those.
    const here = axialToWorld(q, r, 0);
    const shore = [false, false, false, false, false, false];
    for (const [dq, dr] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) {
      const d = axialToWorld(q + dq, r + dr, 0).subtract(here);
      const side = (Math.round((Math.atan2(d.z, d.x) * 180 / Math.PI - 30) / 60) % 6 + 6) % 6;
      if (!water.has(tileKey(q + dq, r + dr))) shore[side] = true;
    }
    const surface = pondMesh(`pond_${key}`, HEX_SIZE + HEX_GAP, shore, this.scene);
    surface.parent = tile;
    const height = tile.getBoundingInfo().boundingBox.extendSize.y * 2;
    surface.position.set(0, height / 2 + 0.006, 0);
    surface.material = this.pondMat;
    surface.isPickable = false;
    this.ponds.set(key, surface);
  }

  /** A tile's tilt: its surface leaning toward `origin`'s tile by QUAKE_TILT. */
  private tiltToward(key: string, origin: readonly [number, number]): Quaternion {
    const [q, r] = keyToTile(key);
    const d = axialToWorld(origin[0], origin[1], 0).subtract(axialToWorld(q, r, 0));
    d.y = 0;
    if (d.lengthSquared() < 1e-6) return Quaternion.Identity();
    // Rotating up toward the centre lowers the tile's inner edge and raises its outer one.
    const axis = Vector3.Cross(Vector3.Up(), d.normalize()).normalize();
    return Quaternion.RotationAxis(axis, QUAKE_TILT);
  }

  /** Sets a tile's turn and lift; upturned (bare earth) while tilted. */
  private setTilt(tile: Mesh, rot: Quaternion, lift: number): void {
    tile.rotationQuaternion!.copyFrom(rot);
    const height = tile.getBoundingInfo().boundingBox.extendSize.y * 2;
    tile.position.y = TILE_HEIGHT - height / 2 + lift;
    const flat = Math.abs(rot.w) > 0.99999;
    tile.material = flat ? tile.metadata.material : this.mats.edge;
    this.showGrass(tile, flat);
  }

  /**
   * Earthquake round `origin`: every tile of `keys` bounces once — the inner
   * ring first — and settles tilted in toward the centre. `landed` resolves as
   * the first ring comes down, `done` once every tile has settled;
   * `heaves(key)` is how long (s) after the start that tile starts to rise.
   * What stands on the `breaking` tiles goes down: a rock is thrown up with
   * its tile and shatters, a tree topples outward and sinks into the ground.
   */
  quake(origin: readonly [number, number], keys: readonly string[], breaking: ReadonlySet<string> = new Set()):
    { landed: Promise<void>; done: Promise<void>; heaves(key: string): number } {
    this.stopQuake?.();
    const parts = keys.flatMap((key) => {
      const tile = this.tiles.get(key);
      if (!tile) return [];
      const [q, r] = keyToTile(key);
      const ring = Math.max(1, hexDistance(origin[0], origin[1], q, r));
      // What breaks here: a rock is lifted with its tile, shrinking away as it
      // shatters; a tree falls over away from the centre (about its foot).
      const prop = breaking.has(key) ? this.terrainProps.get(key) ?? null : null;
      const top = this.tileTop(q, r);
      prop?.setPivotPoint(new Vector3(top.x, top.y, top.z));
      const isTree = !!prop?.name.startsWith('treefeat_');
      let fall: Quaternion | null = null;
      if (prop && isTree) {
        const out = top.subtract(axialToWorld(origin[0], origin[1], TILE_HEIGHT));
        out.y = 0;
        if (out.lengthSquared() < 1e-6) out.set(1, 0, 0);
        fall = Quaternion.RotationAxis(Vector3.Cross(Vector3.Up(), out.normalize()).normalize(), TREE_FALL);
        prop.rotationQuaternion = Quaternion.Identity();
      }
      return [{ tile, key, rock: isTree ? null : prop, tree: isTree ? prop : null, fall,
        delay: (ring - 1) * QUAKE_RING_DELAY, end: this.tiltToward(key, origin) }];
    });
    const felled = parts.some((p) => p.tree) ? TREE_TOPPLE + TREE_LIE + TREE_SINK : 0;
    const span = Math.max(0, ...parts.map((p) => p.delay)) + Math.max(QUAKE_UP + QUAKE_DOWN + QUAKE_SETTLE, felled);
    let resolveLanded!: () => void, resolveDone!: () => void;
    const landed = new Promise<void>((r) => { resolveLanded = r; });
    const done = new Promise<void>((r) => { resolveDone = r; });
    const t0 = performance.now();
    const flat = Quaternion.Identity(), rot = new Quaternion();
    let obs: Observer<Scene> | null = null;
    const stop = () => {
      if (obs) this.scene.onBeforeRenderObservable.remove(obs);
      obs = null;
      if (this.stopQuake === stop) this.stopQuake = null;
      resolveLanded(); resolveDone();
    };
    obs = this.scene.onBeforeRenderObservable.add(() => {
      const t = (performance.now() - t0) / 1000;
      if (t >= QUAKE_UP + QUAKE_DOWN) resolveLanded();
      for (const p of parts) {
        const k = t - p.delay;
        let lift = 0, tilt = 0;
        if (k <= 0) { lift = 0; tilt = 0; }
        else if (k < QUAKE_UP) { lift = QUAKE_LIFT * easeOutCubic(k / QUAKE_UP); }
        else if (k < QUAKE_UP + QUAKE_DOWN) {
          const u = (k - QUAKE_UP) / QUAKE_DOWN;
          lift = QUAKE_LIFT * (1 - easeInQuad(u));
          tilt = easeOutCubic(u);
        } else {
          // One small rebound as it settles, already leaning in.
          const u = Math.min(1, (k - QUAKE_UP - QUAKE_DOWN) / QUAKE_SETTLE);
          lift = QUAKE_LIFT * 0.14 * Math.sin(Math.PI * u);
          tilt = 1;
        }
        Quaternion.SlerpToRef(flat, p.end, tilt, rot);
        this.setTilt(p.tile, rot, lift);
        if (p.rock) {
          const s = 1 - Math.min(1, Math.max(0, (k - QUAKE_UP * 0.5) / (QUAKE_UP + QUAKE_DOWN * 0.5)));
          p.rock.position.y = lift + (1 - s) * 0.6;
          p.rock.scaling.setAll(Math.max(0.001, s));
          if (s <= 0) { p.rock.dispose(); this.terrainProps.delete(p.key); p.rock = null; }
        }
        if (p.tree && p.fall) {
          // Toppling (gathering speed, from the heave), lying a moment, then sinking away.
          const f = Math.max(0, k) / TREE_TOPPLE;
          Quaternion.SlerpToRef(flat, p.fall, Math.min(1, f * f), p.tree.rotationQuaternion!);
          const sink = Math.min(1, Math.max(0, (k - TREE_TOPPLE - TREE_LIE) / TREE_SINK));
          p.tree.position.y = lift - sink * 0.9;
          p.tree.scaling.setAll(TILE_SCALE * (1 - 0.3 * sink));
          if (sink >= 1) { p.tree.dispose(); this.terrainProps.delete(p.key); p.tree = null; }
        }
      }
      if (t >= span) stop();
    });
    this.stopQuake = stop;
    const heaves = (key: string) => {
      const [q, r] = keyToTile(key);
      return (Math.max(1, hexDistance(origin[0], origin[1], q, r)) - 1) * QUAKE_RING_DELAY;
    };
    return { landed, done, heaves };
  }

  private buildRock(t: TerrainEntityJSON): void {
    const [q, r] = t.tile;
    const key = tileKey(q, r);
    const base = this.tiles.get(key);
    if (base) base.isVisible = true;
    const node = new TransformNode(`rockfeat_${key}`, this.scene);
    const p = this.tileTop(q, r);
    // A boulder cut to its hex (hexRock), its own shape per tile.
    const boulder = hexRock(`rock_${key}`, HEX_SIZE, ((q * 73856093) ^ (r * 19349663)) >>> 0, this.scene);
    boulder.material = this.mats.rock;
    boulder.position = new Vector3(p.x, TILE_HEIGHT, p.z);
    boulder.parent = node;
    boulder.receiveShadows = true;
    this.castShadow(boulder);
    node.parent = this.root;
    this.terrainProps.set(key, node);
  }

  private buildTree(t: TerrainEntityJSON): void {
    const [q, r] = t.tile;
    const key = tileKey(q, r);
    const node = new TransformNode(`treefeat_${key}`, this.scene);
    const p = this.tileTop(q, r);
    // A low-poly pine of its own shape (trees.ts), turned at random.
    const { trunk, canopy } = lowPolyTree(`tree_${key}`, ((q * 2654435761) ^ (r * 40503) ^ 0x5bd1e995) >>> 0, this.scene);
    trunk.material = this.mats.trunk;
    canopy.material = this.mats.canopy;
    for (const m of [trunk, canopy]) {
      m.position = new Vector3(p.x, TILE_HEIGHT, p.z);
      m.parent = node;
      m.receiveShadows = true;
      this.castShadow(m);
    }
    node.parent = this.root;
    // Sized to the tile: scaled about its foot.
    node.setPivotPoint(new Vector3(p.x, TILE_HEIGHT, p.z));
    node.scaling.setAll(TILE_SCALE);
    this.terrainProps.set(key, node);
  }

  private zoneStyle(type: TerrainType): { color: string; emissive: string; particle?: 'ember' | 'haze' | 'crystal' | 'pulse'; height: number } {
    switch (type) {
      case TerrainType.BURN_ZONE:
        return { color: '#F97316', emissive: '#F97316', particle: 'ember', height: 0.08 };
      case TerrainType.ICE_ZONE:
        return { color: '#67E8F9', emissive: '#0EA5E9', particle: 'crystal', height: 0.1 };
      case TerrainType.POISON_TRAP:
        return { color: '#A855F7', emissive: '#7E22CE', particle: 'haze', height: 0.06 };
      case TerrainType.FOG_ZONE:
        return { color: '#9CA3AF', emissive: '#111827', particle: 'haze', height: 0.5 };
      case TerrainType.MIST_ZONE:
        return { color: '#F9A8D4', emissive: '#EC4899', height: 0.12 };
      case TerrainType.RESONANCE_ZONE:
        return { color: '#CBD5E1', emissive: '#64748B', height: 0.08 };
      case TerrainType.PERISH_ZONE:
        return { color: '#4C1D95', emissive: '#2E1065', particle: 'pulse', height: 0.06 };
      case TerrainType.SLOW_ZONE:
        return { color: '#3B82F6', emissive: '#1E3A8A', height: 0.04 };
      case TerrainType.ROCK_TRAP:
        return { color: '#B8A038', emissive: '#5C4A10', height: 0.05 };
      default:
        return { color: '#7C3AED', emissive: '#4C1D95', height: 0.06 };
    }
  }

  private buildZone(t: TerrainEntityJSON): void {
    const [q, r] = t.tile;
    const key = tileKey(q, r);
    const type = t.terrain_type as TerrainType;
    const style = this.zoneStyle(type);
    const p = this.tileTop(q, r);
    const propsNode = new TransformNode(`zone_${key}`, this.scene);

    const overlay = MeshBuilder.CreateCylinder(`zoneov_${key}`, { diameter: HEX_SIZE * 1.85, height: style.height, tessellation: 6 }, this.scene);
    overlay.rotation.y = Math.PI / 6;
    overlay.position = new Vector3(p.x, TILE_HEIGHT + style.height / 2 + 0.01, p.z);
    overlay.material = mat(this.scene, `zonemat_${key}`, style.color, { emissive: style.emissive, alpha: type === TerrainType.FOG_ZONE ? 0.4 : 0.55 });
    overlay.isPickable = false;
    overlay.parent = this.root;

    let particles: ParticleSystem | undefined;
    if (style.particle) particles = this.makeZoneParticles(key, new Vector3(p.x, TILE_HEIGHT + 0.1, p.z), style);

    this.zones.set(key, { overlay, props: propsNode, particles });
  }

  private makeZoneParticles(key: string, origin: Vector3, style: { color: string; particle?: string }): ParticleSystem {
    const ps = new ParticleSystem(`zonep_${key}`, 60, this.scene);
    ps.particleTexture = flareTexture(this.scene);
    const [r, g, b] = hexToRgb(style.color);
    ps.color1 = new Color4(r, g, b, 0.8);
    ps.color2 = new Color4(r, g, b, 0.3);
    ps.colorDead = new Color4(r, g, b, 0);
    ps.emitter = origin;
    ps.minEmitBox = new Vector3(-0.6, 0, -0.6);
    ps.maxEmitBox = new Vector3(0.6, 0.1, 0.6);
    ps.minSize = 0.08;
    ps.maxSize = 0.22;
    ps.minLifeTime = 0.6;
    ps.maxLifeTime = 1.4;
    ps.emitRate = style.particle === 'haze' ? 12 : 20;
    ps.direction1 = new Vector3(-0.1, 1, -0.1);
    ps.direction2 = new Vector3(0.1, 1.5, 0.1);
    ps.minEmitPower = 0.3;
    ps.maxEmitPower = 0.9;
    ps.gravity = new Vector3(0, style.particle === 'ember' ? 0.4 : 0.1, 0);
    ps.start();
    return ps;
  }

  private applyWeather(sunny: boolean, rainy: boolean): void {
    // (The weather's look — rain, sun, hail, sand — is FieldFx's.)
    this.currentWeather = sunny ? 'sunny' : rainy ? 'rain' : 'none';
  }

  currentWeather: 'sunny' | 'rain' | 'none' = 'none';

  private castShadow(_m: Mesh): void {
    // Shadow generator is owned by BattleCamera; register lazily via global hook.
    const gen = (this.scene.metadata as { shadowGen?: { addShadowCaster: (m: Mesh) => void } } | undefined)?.shadowGen;
    gen?.addShadowCaster(_m);
  }

  // ── Highlights ────────────────────────────
  highlightTiles(keys: string[], type: HighlightType): void {
    const color = HIGHLIGHT_COLORS[type];
    const [r, g, b] = hexToRgb(color);
    for (const key of keys) {
      const base = this.tiles.get(key);
      if (!base) continue;
      const existing = this.highlights.get(key + ':' + type);
      if (existing) continue;
      const ring = MeshBuilder.CreateCylinder(`hl_${type}_${key}`, { diameter: HEX_SIZE * 1.9, height: 0.06, tessellation: 6 }, this.scene);
      ring.rotation.y = 0; // match tile orientation
      const p = base.position;
      ring.position = new Vector3(p.x, TILE_HEIGHT + 0.03 + this.highlightLayer(type), p.z);
      const m = new StandardMaterial(`hlm_${type}_${key}`, this.scene);
      m.diffuseColor = new Color3(r, g, b);
      // Strong emissive so the colored overlay glows and pops against the warm
      // earthy tiles (feeds bloom). Full-emissive keeps hue readable in shadow.
      m.emissiveColor = new Color3(r, g, b);
      m.disableLighting = true;
      m.alpha = type === 'target' ? 0.8 : 0.55;
      m.specularColor = new Color3(0, 0, 0);
      ring.material = m;
      ring.isPickable = false;
      ring.parent = this.root;
      this.highlights.set(key + ':' + type, ring);
    }
  }

  private highlightLayer(type: HighlightType): number {
    // Stack order so path/target read above move/attack.
    return { move: 0, attack: 0.005, aoe: 0.01, path: 0.015, target: 0.02 }[type];
  }

  clearHighlights(type?: HighlightType): void {
    for (const [k, mesh] of [...this.highlights]) {
      if (type && !k.endsWith(':' + type)) continue;
      mesh.dispose();
      this.highlights.delete(k);
    }
  }

  // ── Picking ───────────────────────────────
  onTilePicked(cb: (tile: [number, number]) => void): void {
    this.tilePickCb = cb;
  }
  onTileHovered(cb: (tile: [number, number]) => void): void {
    this.tileHoverCb = cb;
  }

  private installPicking(): void {
    this.scene.onPointerObservable.add((info) => {
      if (info.type === PointerEventTypes.POINTERMOVE) {
        const tile = this.pickTile(info.pickInfo);
        if (tile) {
          const key = tileKey(tile[0], tile[1]);
          if (key !== this.lastHover) {
            this.lastHover = key;
            this.tileHoverCb?.(tile);
          }
        }
      } else if (info.type === PointerEventTypes.POINTERPICK) {
        const ev = info.event as PointerEvent;
        if (ev.button !== 0) return; // left-click only
        const tile = this.pickTile(info.pickInfo);
        if (tile) this.tilePickCb?.(tile);
      }
    });
  }

  private pickTile(pick: PickingInfo | null | undefined): [number, number] | null {
    if (!pick || !pick.hit || !pick.pickedMesh) return null;
    const md = pick.pickedMesh.metadata as { q: number; r: number } | undefined;
    if (md && typeof md.q === 'number') return [md.q, md.r];
    return null;
  }
}

