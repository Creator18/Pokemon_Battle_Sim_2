/**
 * TerrainEntity + TerrainManager. Faithful port of hex_battle.py lines ~1063-1500.
 *
 * Global terrains (sunny/rain) live in a separate map keyed by type value.
 * Tile terrains are keyed by the tile string "q,r".
 */

import { TerrainType, StatName } from '../core/enums.ts';
import { getTerrainProps, TerrainProperties } from './terrainProps.ts';
import { Tile, tileKey, keyToTile } from '../core/hex.ts';
import { getTypeEffectiveness } from '../core/typechart.ts';
import {
  DEFAULT_STEP_COST,
  BURN_ZONE_DAMAGE_PCT,
  ICE_CHIP_DAMAGE_PCT,
  RESONANCE_SPDEF_DROP,
  PERISH_COUNTDOWN_TURNS,
  GRASS_FIRE_SUN_EXTRA,
  WEATHER_CHIP_FRACTION,
} from '../core/constants.ts';

/** Minimal interface a Pokemon must satisfy for terrain per-turn effects. */
export interface TerrainAffectable {
  readonly playerId: number;
  readonly tile: Tile;
  readonly maxHp: number;
  readonly currentHp: number;
  readonly types: readonly string[];
  readonly name: string;
  get isAlive(): boolean;
  takeDamage(amount: number): number;
  applyStatStage(stat: StatName, delta: number): { newStage: number; wasClamped: boolean };
}

export interface TerrainEntityJSON {
  tile: [number, number];
  terrain_type: string;
  owner: number;
  turns_left: number;
  integrity: number;
  perish_counters: Record<string, number>;
  /** Tilted ground: the quake's centre, which the tile leans toward. */
  origin?: [number, number];
  /** A burn zone lit by burning grass (and whether Sunny Day has already held it a turn longer). */
  grass_fire?: boolean;
  sun_extended?: boolean;
  /** A grass fire from a tied beam clash: split across the line between the two beams' users (see GrassFireSplit). */
  split?: GrassFireSplit;
}

/**
 * Two fires meeting on a tile (a tied beam clash): the line runs from `a` to
 * `b` (the two users' tiles) and is split at its middle; on `a`'s side burns
 * player `oa`'s fire, on `b`'s player `ob`'s (-1: no fire on that side).
 */
export interface GrassFireSplit { a: [number, number]; b: [number, number]; oa: number; ob: number }

const PERMANENT = new Set<TerrainType>([TerrainType.ROCK, TerrainType.TREE, TerrainType.WATER]);

export class TerrainEntity {
  tile: Tile;
  terrainType: TerrainType;
  owner: number;
  turnsLeft: number;
  integrity: number;
  /** player_id → turns remaining before perish faint. */
  perishCounters: Map<number, number>;
  /** Tilted ground: the quake's centre, which the tile leans toward. */
  origin: Tile | null = null;
  /** A burn zone lit by burning grass: Sunny Day can hold it GRASS_FIRE_SUN_EXTRA turn longer, once. */
  grassFire = false;
  sunExtended = false;
  /** Fires meeting on it (a tied clash): GrassFireSplit. */
  split: GrassFireSplit | null = null;

  constructor(
    tile: Tile,
    terrainType: TerrainType,
    owner = 0,
    turnsLeft = 4,
    integrity = 1,
    perishCounters?: Map<number, number>,
  ) {
    this.tile = tile;
    this.terrainType = terrainType;
    this.owner = owner;
    this.turnsLeft = turnsLeft;
    this.integrity = integrity;
    this.perishCounters = perishCounters ?? new Map();
  }

  get props(): TerrainProperties {
    return getTerrainProps(this.terrainType);
  }
  get isExpired(): boolean {
    return this.turnsLeft <= 0;
  }
  get isDestroyed(): boolean {
    return this.integrity <= 0;
  }
  get isPermanent(): boolean {
    return PERMANENT.has(this.terrainType);
  }
  get isGlobal(): boolean {
    return this.props.isGlobal;
  }
  get blocksMovement(): boolean {
    return this.props.blocksMovement;
  }
  get blocksLos(): boolean {
    return this.props.blocksLos;
  }
  get speedModifier(): number {
    return this.props.speedModifier;
  }
  get stepCost(): number {
    return this.props.stepCost;
  }
  get statEffect(): Partial<Record<StatName, number>> | null {
    return this.props.statEffect;
  }
  get isStatHazard(): boolean {
    return this.props.statEffect !== null && Object.keys(this.props.statEffect).length > 0;
  }

  tick(): void {
    if (!this.isPermanent) this.turnsLeft = Math.max(0, this.turnsLeft - 1);
  }

  takeDamage(amount = 1): boolean {
    if (this.terrainType === TerrainType.ROCK) return false;
    this.integrity = Math.max(0, this.integrity - amount);
    return this.integrity <= 0;
  }

  toJSON(): TerrainEntityJSON {
    const perish: Record<string, number> = {};
    for (const [k, v] of this.perishCounters) perish[String(k)] = v;
    return {
      tile: [this.tile[0], this.tile[1]],
      terrain_type: this.terrainType,
      owner: this.owner,
      turns_left: this.turnsLeft,
      integrity: this.integrity,
      perish_counters: perish,
      ...(this.origin ? { origin: [this.origin[0], this.origin[1]] as [number, number] } : {}),
      ...(this.grassFire ? { grass_fire: true, sun_extended: this.sunExtended } : {}),
      ...(this.split ? { split: { ...this.split } } : {}),
    };
  }

  static fromJSON(data: TerrainEntityJSON): TerrainEntity {
    const perish = new Map<number, number>();
    for (const [k, v] of Object.entries(data.perish_counters ?? {})) {
      perish.set(Number(k), Number(v));
    }
    const e = new TerrainEntity(
      [data.tile[0], data.tile[1]],
      data.terrain_type as TerrainType,
      Number(data.owner ?? 0),
      Number(data.turns_left ?? 4),
      Number(data.integrity ?? 1),
      perish,
    );
    if (data.origin) e.origin = [data.origin[0], data.origin[1]];
    e.grassFire = !!data.grass_fire;
    e.sunExtended = !!data.sun_extended;
    if (data.split) e.split = { ...data.split };
    return e;
  }
}

/** A terrain removed during a tick: [tile | null, typeValue]. null = global. */
export type TerrainRemoval = [Tile | null, string];

/** The weathers: one at a time (a new one replaces the last). */
export const WEATHERS: readonly TerrainType[] = [TerrainType.SUNNY_ZONE, TerrainType.RAIN_ZONE, TerrainType.HAIL, TerrainType.SANDSTORM];
/** The terrains: one at a time. */
export const FIELD_TERRAINS: readonly TerrainType[] = [
  TerrainType.ELECTRIC_TERRAIN, TerrainType.GRASSY_TERRAIN, TerrainType.MISTY_TERRAIN, TerrainType.PSYCHIC_TERRAIN,
];
/** Each terrain's type (Terrain Pulse takes it; its moves are boosted). */
export const TERRAIN_TYPE_OF: Partial<Record<TerrainType, string>> = {
  [TerrainType.ELECTRIC_TERRAIN]: 'Electric',
  [TerrainType.GRASSY_TERRAIN]: 'Grass',
  [TerrainType.MISTY_TERRAIN]: 'Fairy',
  [TerrainType.PSYCHIC_TERRAIN]: 'Psychic',
};

export class TerrainManager {
  private entities: Map<string, TerrainEntity> = new Map();
  private globals: Map<string, TerrainEntity> = new Map();
  /** Tiles whose grass has burned away ("q,r"): bare, scorched earth for the rest of the battle. */
  private scorched = new Set<string>();

  scorch(tile: Tile): void { this.scorched.add(tileKey(tile[0], tile[1])); }
  isScorched(tile: Tile): boolean { return this.scorched.has(tileKey(tile[0], tile[1])); }
  get scorchedKeys(): string[] { return [...this.scorched]; }

  // ── Add / Remove ──────────────────────────
  addTerrain(
    tile: Tile,
    terrainType: TerrainType,
    owner = 0,
    duration?: number,
    integrity?: number,
  ): TerrainEntity {
    const p = getTerrainProps(terrainType);
    const dur = duration ?? p.defaultDuration;
    const hp = integrity ?? p.defaultIntegrity;
    const entity = new TerrainEntity(tile, terrainType, owner, dur, hp);
    if (p.isGlobal) {
      // One weather and one terrain at a time: a new one replaces the last.
      for (const group of [WEATHERS, FIELD_TERRAINS]) {
        if (group.includes(terrainType)) for (const other of group) this.globals.delete(other);
      }
      this.globals.set(terrainType, entity);
    } else {
      this.entities.set(tileKey(tile[0], tile[1]), entity);
    }
    return entity;
  }

  removeTerrain(tile: Tile): TerrainEntity | undefined {
    const key = tileKey(tile[0], tile[1]);
    const e = this.entities.get(key);
    this.entities.delete(key);
    return e;
  }

  hasTerrain(tile: Tile): boolean {
    return this.entities.has(tileKey(tile[0], tile[1]));
  }

  getTerrain(tile: Tile): TerrainEntity | undefined {
    return this.entities.get(tileKey(tile[0], tile[1]));
  }

  // ── Global accessors ──────────────────────
  getGlobal(t: TerrainType): TerrainEntity | undefined {
    return this.globals.get(t);
  }
  isSunny(): boolean {
    return this.globals.has(TerrainType.SUNNY_ZONE);
  }
  isRainy(): boolean {
    return this.globals.has(TerrainType.RAIN_ZONE);
  }
  isHail(): boolean {
    return this.globals.has(TerrainType.HAIL);
  }
  isSandstorm(): boolean {
    return this.globals.has(TerrainType.SANDSTORM);
  }
  /** The terrain on the field, or null. */
  /**
   * Whether a move strikes first here: a priority move does, Grassy Glide
   * only in Grassy Terrain.
   */
  hasPriority(move: { name: string; quickPriority: boolean }): boolean {
    if (!move.quickPriority) return false;
    return move.name !== 'Grassy Glide' || this.fieldTerrain() === TerrainType.GRASSY_TERRAIN;
  }

  fieldTerrain(): TerrainType | null {
    return FIELD_TERRAINS.find((t) => this.globals.has(t)) ?? null;
  }
  globalFireMult(): number {
    if (this.isSunny()) return 1.3;
    if (this.isRainy()) return 0.7;
    return 1.0;
  }
  globalWaterMult(): number {
    if (this.isRainy()) return 1.3;
    if (this.isSunny()) return 0.7;
    return 1.0;
  }

  // ── Tick ──────────────────────────────────
  tickAll(): TerrainRemoval[] {
    const removed: TerrainRemoval[] = [];
    const toRemove: string[] = [];
    for (const [key, entity] of this.entities) {
      entity.tick();
      // A grass fire burns on a turn longer under the sun (once).
      if (entity.grassFire && entity.isExpired && !entity.sunExtended && this.isSunny()) {
        entity.turnsLeft = GRASS_FIRE_SUN_EXTRA;
        entity.sunExtended = true;
      }
      if (entity.isDestroyed || (entity.isExpired && !entity.isPermanent)) {
        toRemove.push(key);
        removed.push([keyToTile(key), entity.terrainType]);
      }
    }
    for (const key of toRemove) this.entities.delete(key);

    const globalRemove: string[] = [];
    for (const [ttype, entity] of this.globals) {
      entity.tick();
      if (entity.isExpired) {
        globalRemove.push(ttype);
        removed.push([null, ttype]);
      }
    }
    for (const ttype of globalRemove) this.globals.delete(ttype);
    return removed;
  }

  damageTerrainAt(tile: Tile, amount = 1): string[] {
    const key = tileKey(tile[0], tile[1]);
    const entity = this.entities.get(key);
    if (!entity) return [];
    const destroyed = entity.takeDamage(amount);
    if (destroyed) {
      this.entities.delete(key);
      return [entity.terrainType];
    }
    return [];
  }

  // ── Per-turn effects ──────────────────────
  applyBurnDamage(list: readonly TerrainAffectable[]): Array<[number, number]> {
    const results: Array<[number, number]> = [];
    for (const p of list) {
      if (!p.isAlive) continue;
      const entity = this.getTerrain(p.tile);
      if (!entity || entity.terrainType !== TerrainType.BURN_ZONE) continue;
      if (p.types.includes('Fire')) continue;
      const damage = Math.max(1, Math.trunc(p.maxHp * BURN_ZONE_DAMAGE_PCT));
      results.push([p.playerId, p.takeDamage(damage)]);
    }
    return results;
  }

  applyIceDamage(list: readonly TerrainAffectable[]): Array<[number, number]> {
    const results: Array<[number, number]> = [];
    for (const p of list) {
      if (!p.isAlive) continue;
      const entity = this.getTerrain(p.tile);
      if (!entity || entity.terrainType !== TerrainType.ICE_ZONE) continue;
      if (p.types.includes('Ice')) continue;
      const damage = Math.max(1, Math.trunc(p.maxHp * ICE_CHIP_DAMAGE_PCT));
      results.push([p.playerId, p.takeDamage(damage)]);
    }
    return results;
  }

  /**
   * Hail and a sandstorm, at a turn's end: WEATHER_CHIP_FRACTION of max HP
   * off every Pokémon it does not spare (hail: Ice types; sand: Rock, Ground
   * and Steel types). [playerId, damage, 'hail' | 'sandstorm'].
   */
  applyWeatherChip(list: readonly TerrainAffectable[]): Array<[number, number, string]> {
    const results: Array<[number, number, string]> = [];
    const hail = this.isHail(), sand = this.isSandstorm();
    if (!hail && !sand) return results;
    for (const p of list) {
      if (!p.isAlive) continue;
      if (hail && p.types.includes('Ice')) continue;
      if (sand && p.types.some((t) => t === 'Rock' || t === 'Ground' || t === 'Steel')) continue;
      const damage = Math.max(1, Math.trunc(p.maxHp * WEATHER_CHIP_FRACTION));
      results.push([p.playerId, p.takeDamage(damage), hail ? 'hail' : 'sandstorm']);
    }
    return results;
  }

  applyResonanceDrain(
    list: readonly TerrainAffectable[],
  ): Array<[number, StatName, number, number, boolean]> {
    const results: Array<[number, StatName, number, number, boolean]> = [];
    for (const p of list) {
      if (!p.isAlive) continue;
      const entity = this.getTerrain(p.tile);
      if (!entity || entity.terrainType !== TerrainType.RESONANCE_ZONE) continue;
      const { newStage, wasClamped } = p.applyStatStage('sp_def', RESONANCE_SPDEF_DROP);
      results.push([p.playerId, 'sp_def', RESONANCE_SPDEF_DROP, newStage, wasClamped]);
    }
    return results;
  }

  applyPoisonDrain(
    list: readonly TerrainAffectable[],
  ): Array<[number, StatName, number, number, boolean]> {
    const results: Array<[number, StatName, number, number, boolean]> = [];
    for (const p of list) {
      if (!p.isAlive) continue;
      const entity = this.getTerrain(p.tile);
      if (!entity || entity.terrainType !== TerrainType.POISON_TRAP) continue;
      if (p.types.includes('Poison') || p.types.includes('Steel')) continue;
      const { newStage, wasClamped } = p.applyStatStage('sp_def', -1);
      results.push([p.playerId, 'sp_def', -1, newStage, wasClamped]);
    }
    return results;
  }

  tickPerishCountdown(list: readonly TerrainAffectable[]): Array<[number, number]> {
    const results: Array<[number, number]> = [];
    for (const p of list) {
      if (!p.isAlive) continue;
      const entity = this.getTerrain(p.tile);
      const onPerish = entity !== undefined && entity.terrainType === TerrainType.PERISH_ZONE;
      if (onPerish && entity) {
        const pid = p.playerId;
        if (!entity.perishCounters.has(pid)) {
          entity.perishCounters.set(pid, PERISH_COUNTDOWN_TURNS);
        } else {
          entity.perishCounters.set(pid, Math.max(0, entity.perishCounters.get(pid)! - 1));
        }
        const remaining = entity.perishCounters.get(pid)!;
        results.push([pid, remaining]);
        if (remaining === 0) p.takeDamage(p.currentHp);
      }
    }
    return results;
  }

  isMistProtected(tile: Tile): boolean {
    const e = this.getTerrain(tile);
    return e !== undefined && e.terrainType === TerrainType.MIST_ZONE;
  }

  stealthRockDamage(p: TerrainAffectable): number {
    const entity = this.getTerrain(p.tile);
    if (!entity || entity.terrainType !== TerrainType.ROCK_TRAP) return 0;
    const rockMult = getTypeEffectiveness('Rock', p.types.length ? p.types : ['Normal']);
    const damage = Math.max(1, Math.trunc(p.maxHp * 0.125 * rockMult));
    return damage;
  }

  // ── Spatial lookups ───────────────────────
  get blockedMovementTiles(): Set<string> {
    const s = new Set<string>();
    for (const [key, e] of this.entities) if (e.blocksMovement) s.add(key);
    return s;
  }
  /**
   * The tiles `p` cannot walk into. A Flying type flies over rocks and trees
   * (and may stop on them, hovering); everyone else is stopped by them. Line
   * of sight is not affected (see blockedLosTiles).
   */
  movementBlockersFor(p: { types: readonly string[] }): Set<string> {
    return canFly(p) ? new Set<string>() : this.blockedMovementTiles;
  }
  get blockedLosTiles(): Set<string> {
    const s = new Set<string>();
    for (const [key, e] of this.entities) if (e.blocksLos) s.add(key);
    return s;
  }
  get slowTiles(): Set<string> {
    const s = new Set<string>();
    for (const [key, e] of this.entities) if (e.stepCost > DEFAULT_STEP_COST) s.add(key);
    return s;
  }
  get statHazardTiles(): Set<string> {
    const s = new Set<string>();
    for (const [key, e] of this.entities) if (e.isStatHazard) s.add(key);
    return s;
  }

  getStepCost(tile: Tile): number {
    const e = this.getTerrain(tile);
    return e ? e.stepCost : DEFAULT_STEP_COST;
  }
  getStatEffect(tile: Tile): Partial<Record<StatName, number>> | null {
    const e = this.getTerrain(tile);
    return e && e.isStatHazard ? e.statEffect : null;
  }
  getSpeedModifier(tile: Tile): number {
    const e = this.getTerrain(tile);
    return e ? e.speedModifier : 1.0;
  }

  /** Flood-fill contiguous same-type field starting at a tile. */
  getContiguousField(startTile: Tile, terrainType?: TerrainType): Set<string> {
    const entity = this.getTerrain(startTile);
    if (!entity) return new Set();
    const type = terrainType ?? entity.terrainType;
    const visited = new Set<string>();
    const stack: Tile[] = [startTile];
    while (stack.length > 0) {
      const [q, r] = stack.pop()!;
      const key = tileKey(q, r);
      if (visited.has(key)) continue;
      const e = this.entities.get(key);
      if (!e || e.terrainType !== type) continue;
      visited.add(key);
      for (const [dq, dr] of [
        [1, 0],
        [1, -1],
        [0, -1],
        [-1, 0],
        [-1, 1],
        [0, 1],
      ]) {
        stack.push([q + dq, r + dr]);
      }
    }
    return visited;
  }

  // ── Serialization ─────────────────────────
  toJSON(): TerrainEntityJSON[] {
    const list: TerrainEntityJSON[] = [];
    for (const e of this.entities.values()) list.push(e.toJSON());
    for (const e of this.globals.values()) list.push(e.toJSON());
    return list;
  }

  static fromJSON(list: readonly TerrainEntityJSON[], scorched: readonly string[] = []): TerrainManager {
    const tm = new TerrainManager();
    for (const k of scorched) tm.scorched.add(k);
    for (const data of list) {
      const entity = TerrainEntity.fromJSON(data);
      if (entity.isGlobal) tm.globals.set(entity.terrainType, entity);
      else tm.entities.set(tileKey(entity.tile[0], entity.tile[1]), entity);
    }
    return tm;
  }
}

/** Flying types cross movement-blocking terrain (rocks, trees) and can stand on it. */
export function canFly(p: { types: readonly string[] }): boolean {
  return p.types.includes('Flying');
}

/**
 * Touching the ground — what a terrain acts on. Not a Flying type (the only
 * ones that ever hover, over rocks and trees).
 */
export function isGrounded(p: { types: readonly string[] }): boolean {
  return !canFly(p);
}
