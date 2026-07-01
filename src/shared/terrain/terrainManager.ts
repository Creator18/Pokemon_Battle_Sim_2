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
}

const PERMANENT = new Set<TerrainType>([TerrainType.ROCK, TerrainType.TREE]);

export class TerrainEntity {
  tile: Tile;
  terrainType: TerrainType;
  owner: number;
  turnsLeft: number;
  integrity: number;
  /** player_id → turns remaining before perish faint. */
  perishCounters: Map<number, number>;

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
    };
  }

  static fromJSON(data: TerrainEntityJSON): TerrainEntity {
    const perish = new Map<number, number>();
    for (const [k, v] of Object.entries(data.perish_counters ?? {})) {
      perish.set(Number(k), Number(v));
    }
    return new TerrainEntity(
      [data.tile[0], data.tile[1]],
      data.terrain_type as TerrainType,
      Number(data.owner ?? 0),
      Number(data.turns_left ?? 4),
      Number(data.integrity ?? 1),
      perish,
    );
  }
}

/** A terrain removed during a tick: [tile | null, typeValue]. null = global. */
export type TerrainRemoval = [Tile | null, string];

export class TerrainManager {
  private entities: Map<string, TerrainEntity> = new Map();
  private globals: Map<string, TerrainEntity> = new Map();

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
      if (terrainType === TerrainType.SUNNY_ZONE) this.globals.delete(TerrainType.RAIN_ZONE);
      else if (terrainType === TerrainType.RAIN_ZONE) this.globals.delete(TerrainType.SUNNY_ZONE);
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

  static fromJSON(list: readonly TerrainEntityJSON[]): TerrainManager {
    const tm = new TerrainManager();
    for (const data of list) {
      const entity = TerrainEntity.fromJSON(data);
      if (entity.isGlobal) tm.globals.set(entity.terrainType, entity);
      else tm.entities.set(tileKey(entity.tile[0], entity.tile[1]), entity);
    }
    return tm;
  }
}
