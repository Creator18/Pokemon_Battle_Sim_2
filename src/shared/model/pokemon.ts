/**
 * Pokemon runtime model (state + methods). Reconstructed faithfully from the
 * Python state schema (set_selection) and all engine usages, since the assembled
 * hex_battle.py did not include the Pokemon class body.
 *
 * All per-turn transient fields (boostMult, tilesShort, straightTilesThisTurn,
 * pathThisTurn) are serialized so replay is deterministic.
 */

import { ActionOrder, PokemonStatus, StatName } from '../core/enums.ts';
import { Tile } from '../core/hex.ts';
import {
  StatStages,
  statStageMultiplier,
  clampStatStage,
  defaultStatStages,
} from '../core/stats.ts';
import {
  DEFAULT_LEVEL,
  SPEED_TILE_DIVISOR,
  MOVE_FIRST_COST,
  EARLY_STOP_BOOST_PER_TILE,
  EARLY_STOP_BOOST_MAX,
  COOLDOWN_ATTACK_FIRST,
  COOLDOWN_MOVE_FIRST,
} from '../core/constants.ts';
import { TerrainAffectable } from '../terrain/terrainManager.ts';
import { TurnDeclaration, TurnDeclarationJSON } from '../engine/declaration.ts';
import { SpeciesDefinition } from '../data/species.ts';

export interface PokemonJSON {
  player_id: number;
  name: string;
  nickname: string;
  types: string[];
  tile: [number, number];
  moves: string[];
  max_hp: number;
  current_hp: number;
  attack: number;
  defense: number;
  sp_atk: number;
  sp_def: number;
  base_speed: number;
  level: number;
  status: string;
  can_pass_through: boolean;
  stat_stages: Record<string, number>;
  boost_mult: number;
  tiles_short: number;
  straight_tiles: number;
  cooldowns: Record<string, number>;
  path_this_turn: [number, number][];
  declaration: TurnDeclarationJSON | null;
}

export interface PokemonInit {
  playerId: number;
  name: string;
  nickname: string;
  types: string[];
  tile: Tile;
  moves: string[];
  maxHp: number;
  currentHp: number;
  attack: number;
  defense: number;
  spAtk: number;
  spDef: number;
  baseSpeed: number;
  level: number;
  status: PokemonStatus;
  canPassThrough: boolean;
  statStages: StatStages;
  boostMult: number;
  tilesShort: number;
  straightTilesThisTurn: number;
  cooldowns: Record<string, number>;
  pathThisTurn: Tile[];
  declaration: TurnDeclaration | null;
}

export class Pokemon implements TerrainAffectable {
  playerId: number;
  name: string;
  nickname: string;
  types: string[];
  tile: Tile;
  moves: string[];
  maxHp: number;
  currentHp: number;
  attack: number;
  defense: number;
  spAtk: number;
  spDef: number;
  baseSpeed: number;
  level: number;
  status: PokemonStatus;
  canPassThrough: boolean;
  statStages: StatStages;
  boostMult: number;
  tilesShort: number;
  straightTilesThisTurn: number;
  cooldowns: Record<string, number>;
  pathThisTurn: Tile[];
  declaration: TurnDeclaration | null;

  constructor(init: PokemonInit) {
    this.playerId = init.playerId;
    this.name = init.name;
    this.nickname = init.nickname;
    this.types = init.types;
    this.tile = init.tile;
    this.moves = init.moves;
    this.maxHp = init.maxHp;
    this.currentHp = init.currentHp;
    this.attack = init.attack;
    this.defense = init.defense;
    this.spAtk = init.spAtk;
    this.spDef = init.spDef;
    this.baseSpeed = init.baseSpeed;
    this.level = init.level;
    this.status = init.status;
    this.canPassThrough = init.canPassThrough;
    this.statStages = init.statStages;
    this.boostMult = init.boostMult;
    this.tilesShort = init.tilesShort;
    this.straightTilesThisTurn = init.straightTilesThisTurn;
    this.cooldowns = init.cooldowns;
    this.pathThisTurn = init.pathThisTurn;
    this.declaration = init.declaration;
  }

  // ── Derived ───────────────────────────────
  get logName(): string {
    return this.nickname && this.nickname.trim() ? this.nickname.trim() : this.name;
  }

  get isAlive(): boolean {
    return this.status !== PokemonStatus.FAINTED && this.currentHp > 0;
  }

  get statStageAttackMult(): number {
    return statStageMultiplier(this.statStages.attack);
  }
  get statStageDefenseMult(): number {
    return statStageMultiplier(this.statStages.defense);
  }
  get statStageSpatkMult(): number {
    return statStageMultiplier(this.statStages.sp_atk);
  }
  get statStageSpdefMult(): number {
    return statStageMultiplier(this.statStages.sp_def);
  }

  /** Effective speed: base × speed-stage mult, halved if paralyzed. */
  get effectiveSpeed(): number {
    const mult = statStageMultiplier(this.statStages.speed);
    let spd = Math.max(1, Math.trunc(this.baseSpeed * mult));
    if (this.status === PokemonStatus.PARALYZED) spd = Math.max(1, Math.trunc(spd / 2));
    return spd;
  }

  get effectiveMoveRange(): number {
    return Math.max(1, Math.floor(this.effectiveSpeed / SPEED_TILE_DIVISOR));
  }

  /** (movePriority, attackPriority) — mirrors compute_effective_priorities. */
  getActionPriorities(): [number, number] {
    const speed = this.effectiveSpeed;
    if (this.declaration === null) return [speed, speed];
    const order = this.declaration.actionOrder;
    const tilesMoved = this.declaration.tilesToMove();
    const movePriority = speed;
    const attackPriority =
      order === ActionOrder.ATTACK_FIRST ? speed : speed - tilesMoved * MOVE_FIRST_COST;
    return [movePriority, attackPriority];
  }

  // ── Mutations ─────────────────────────────
  takeDamage(amount: number): number {
    const before = this.currentHp;
    this.currentHp = Math.max(0, this.currentHp - amount);
    if (this.currentHp === 0) this.status = PokemonStatus.FAINTED;
    return before - this.currentHp;
  }

  moveTo(tile: Tile): void {
    this.tile = [tile[0], tile[1]];
  }

  applyStatStage(stat: StatName, delta: number): { newStage: number; wasClamped: boolean } {
    const old = this.statStages[stat] ?? 0;
    const newStage = clampStatStage(old, delta);
    const wasClamped = old + delta !== newStage;
    this.statStages[stat] = newStage;
    return { newStage, wasClamped };
  }

  /** Returns true if the status was newly applied (not already afflicted). */
  applyStatus(status: PokemonStatus): boolean {
    // Electric types are immune to paralysis (mirrors Thunder Wave / Discharge intent).
    if (status === PokemonStatus.PARALYZED && this.types.includes('Electric')) return false;
    if (
      this.status === PokemonStatus.PARALYZED ||
      this.status === PokemonStatus.BURNED ||
      this.status === PokemonStatus.FAINTED
    ) {
      return false;
    }
    this.status = status;
    return true;
  }

  /** Early-stop boost: boost_mult grows with tiles the pokemon fell short. */
  applyEarlyStop(intendedTiles: number, actualTiles: number): void {
    const short = Math.max(0, intendedTiles - actualTiles);
    this.tilesShort = short;
    this.boostMult = Math.min(
      EARLY_STOP_BOOST_MAX,
      1.0 + short * EARLY_STOP_BOOST_PER_TILE,
    );
  }

  applyCooldown(moveName: string, order: ActionOrder): void {
    const dur = order === ActionOrder.ATTACK_FIRST ? COOLDOWN_ATTACK_FIRST : COOLDOWN_MOVE_FIRST;
    this.cooldowns[moveName] = dur;
  }

  // ── Serialization ─────────────────────────
  toJSON(): PokemonJSON {
    return {
      player_id: this.playerId,
      name: this.name,
      nickname: this.nickname,
      types: [...this.types],
      tile: [this.tile[0], this.tile[1]],
      moves: [...this.moves],
      max_hp: this.maxHp,
      current_hp: this.currentHp,
      attack: this.attack,
      defense: this.defense,
      sp_atk: this.spAtk,
      sp_def: this.spDef,
      base_speed: this.baseSpeed,
      level: this.level,
      status: this.status,
      can_pass_through: this.canPassThrough,
      stat_stages: { ...this.statStages },
      boost_mult: this.boostMult,
      tiles_short: this.tilesShort,
      straight_tiles: this.straightTilesThisTurn,
      cooldowns: { ...this.cooldowns },
      path_this_turn: this.pathThisTurn.map((t) => [t[0], t[1]] as [number, number]),
      declaration: this.declaration ? this.declaration.toJSON() : null,
    };
  }

  static fromJSON(d: PokemonJSON): Pokemon {
    const stages = defaultStatStages();
    for (const k of Object.keys(stages) as StatName[]) {
      stages[k] = d.stat_stages?.[k] ?? 0;
    }
    return new Pokemon({
      playerId: d.player_id,
      name: d.name,
      nickname: d.nickname ?? '',
      types: [...d.types],
      tile: [d.tile[0], d.tile[1]],
      moves: [...(d.moves ?? [])],
      maxHp: d.max_hp,
      currentHp: d.current_hp,
      attack: d.attack,
      defense: d.defense,
      spAtk: d.sp_atk,
      spDef: d.sp_def,
      baseSpeed: d.base_speed,
      level: d.level ?? DEFAULT_LEVEL,
      status: (d.status ?? PokemonStatus.ACTIVE) as PokemonStatus,
      canPassThrough: d.can_pass_through ?? false,
      statStages: stages,
      boostMult: d.boost_mult ?? 1.0,
      tilesShort: d.tiles_short ?? 0,
      straightTilesThisTurn: d.straight_tiles ?? 0,
      cooldowns: { ...(d.cooldowns ?? {}) },
      pathThisTurn: (d.path_this_turn ?? []).map((t) => [t[0], t[1]] as Tile),
      declaration: d.declaration ? TurnDeclaration.fromJSON(d.declaration) : null,
    });
  }

  static fromSpecies(
    species: SpeciesDefinition,
    playerId: number,
    tile: Tile,
    moves: string[],
  ): Pokemon {
    const cooldowns: Record<string, number> = {};
    for (const m of moves) cooldowns[m] = 0;
    return new Pokemon({
      playerId,
      name: species.name,
      nickname: '',
      types: [...species.types],
      tile: [tile[0], tile[1]],
      moves: [...moves],
      maxHp: species.inflatedHp,
      currentHp: species.inflatedHp,
      attack: species.attack,
      defense: species.defense,
      spAtk: species.spAtk,
      spDef: species.spDef,
      baseSpeed: species.speed,
      level: species.level ?? DEFAULT_LEVEL,
      status: PokemonStatus.ACTIVE,
      canPassThrough: species.canPassThrough,
      statStages: defaultStatStages(),
      boostMult: 1.0,
      tilesShort: 0,
      straightTilesThisTurn: 0,
      cooldowns,
      pathThisTurn: [],
      declaration: null,
    });
  }
}
