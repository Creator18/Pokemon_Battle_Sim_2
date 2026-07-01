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
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import type { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo';
import { flareTexture } from './textures.ts';

import {
  HEX_GRID,
  keyToTile,
  tileKey,
  TerrainType,
  type BattleStateJSON,
  type TerrainEntityJSON,
} from '../../shared/index.ts';
import { axialToWorld, HEX_SIZE } from '../hexWorld.ts';
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
      tile.metadata = { q, r, key };
      this.tiles.set(key, tile);
    }
  }

  /** World position of a tile top surface (for placing units / vfx). */
  tileTop(q: number, r: number): Vector3 {
    return axialToWorld(q, r, TILE_HEIGHT);
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

    let sunny = false;
    let rainy = false;

    for (const t of state.terrain) {
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

  private buildRock(t: TerrainEntityJSON): void {
    const [q, r] = t.tile;
    const key = tileKey(q, r);
    const base = this.tiles.get(key);
    if (base) base.isVisible = true;
    const node = new TransformNode(`rockfeat_${key}`, this.scene);
    const p = this.tileTop(q, r);
    const boulder = MeshBuilder.CreatePolyhedron(`rock_${key}`, { type: 2, size: 0.62 }, this.scene);
    boulder.material = this.mats.rock;
    boulder.position = new Vector3(p.x, TILE_HEIGHT + 0.5, p.z);
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

