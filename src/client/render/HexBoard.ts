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
import { flareTexture } from './textures.ts';

import {
  HEX_GRID,
  hexDistance,
  keyToTile,
  tileKey,
  footprint,
  TerrainType,
  type BattleStateJSON,
  type TerrainEntityJSON,
} from '../../shared/index.ts';
import { axialToWorld, HEX_SIZE, TILE_SCALE } from '../hexWorld.ts';
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

export class HexBoard {
  readonly root: TransformNode;
  private readonly scene: Scene;
  private readonly tiles = new Map<string, Mesh>();
  private readonly highlights = new Map<string, Mesh>();
  private readonly zones = new Map<string, ZoneVisual>();
  private terrainProps = new Map<string, TransformNode>(); // rock/tree feature nodes keyed by "q,r"
  private weatherParticles: ParticleSystem | null = null;

  private mats: {
    tiles: StandardMaterial[]; // shared grassy/earthy tile tints (per-tile jitter)
    rock: StandardMaterial;
    trunk: StandardMaterial;
    canopy: StandardMaterial;
    edge: StandardMaterial;
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
    };

    this.buildTiles();
    this.installPicking();
  }

  private buildTiles(): void {
    for (const key of HEX_GRID) {
      const [q, r] = keyToTile(key);
      const pos = axialToWorld(q, r, 0);
      // Deterministic per-tile hash for stable material + tiny thickness jitter.
      const h = ((q * 73856093) ^ (r * 19349663)) >>> 0;
      const matIdx = h % this.mats.tiles.length;
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
      z.particles?.dispose();
    }
    this.zones.clear();

    // Tilted ground (Earthquake's aftermath) leans in toward its quake's centre;
    // every other tile lies flat.
    this.stopQuake?.();
    const tilted = new Map<string, [number, number]>();
    for (const t of state.terrain) {
      if (t.terrain_type === TerrainType.TILTED && t.origin) tilted.set(tileKey(t.tile[0], t.tile[1]), t.origin);
    }
    for (const [key, tile] of this.tiles) {
      const origin = tilted.get(key);
      this.setTilt(tile, origin ? this.tiltToward(key, origin) : Quaternion.Identity(), 0);
    }

    let sunny = false;
    let rainy = false;

    for (const t of state.terrain) {
      if (t.terrain_type === TerrainType.TILTED) continue; // the tilt is its look
      const type = t.terrain_type as TerrainType;
      if (type === TerrainType.SUNNY_ZONE) {
        sunny = true;
        continue;
      }
      if (type === TerrainType.RAIN_ZONE) {
        rainy = true;
        continue;
      }
      if (type === TerrainType.ROCK) this.buildRock(t);
      else if (type === TerrainType.TREE) this.buildTree(t);
      else this.buildZone(t);
    }

    this.applyWeather(sunny, rainy);
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
    const boulder = MeshBuilder.CreatePolyhedron(`rock_${key}`, { type: 2, size: 0.62 * TILE_SCALE }, this.scene);
    boulder.material = this.mats.rock;
    boulder.position = new Vector3(p.x, TILE_HEIGHT + 0.5 * TILE_SCALE, p.z);
    boulder.rotation = new Vector3(Math.random(), Math.random() * Math.PI, Math.random());
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
    const trunk = MeshBuilder.CreateCylinder(`trunk_${key}`, { diameterTop: 0.16, diameterBottom: 0.24, height: 0.7, tessellation: 6 }, this.scene);
    trunk.material = this.mats.trunk;
    trunk.position = new Vector3(p.x, TILE_HEIGHT + 0.35, p.z);
    trunk.parent = node;
    this.castShadow(trunk);
    // Layered canopy cones.
    for (let k = 0; k < 3; k++) {
      const cone = MeshBuilder.CreateCylinder(`canopy_${key}_${k}`, { diameterTop: 0, diameterBottom: 0.9 - k * 0.18, height: 0.5, tessellation: 6 }, this.scene);
      cone.material = this.mats.canopy;
      cone.position = new Vector3(p.x, TILE_HEIGHT + 0.75 + k * 0.28, p.z);
      cone.parent = node;
      this.castShadow(cone);
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
    this.weatherParticles?.dispose();
    this.weatherParticles = null;
    if (rainy) {
      const ps = new ParticleSystem('rain', 1200, this.scene);
      ps.particleTexture = flareTexture(this.scene);
      ps.color1 = new Color4(0.6, 0.75, 1, 0.6);
      ps.color2 = new Color4(0.5, 0.6, 0.9, 0.4);
      ps.emitter = new Vector3(0, 14, 0);
      ps.minEmitBox = new Vector3(-12, 0, -12);
      ps.maxEmitBox = new Vector3(12, 0, 12);
      ps.minSize = 0.05;
      ps.maxSize = 0.12;
      ps.minLifeTime = 0.8;
      ps.maxLifeTime = 1.2;
      ps.emitRate = 900;
      ps.direction1 = new Vector3(-0.2, -1, -0.2);
      ps.direction2 = new Vector3(0.2, -1, 0.2);
      ps.minEmitPower = 14;
      ps.maxEmitPower = 20;
      ps.gravity = new Vector3(0, -30, 0);
      ps.start();
      this.weatherParticles = ps;
    }
    // Sunny: tint handled by caller via getWeatherTint(); we expose flags.
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

