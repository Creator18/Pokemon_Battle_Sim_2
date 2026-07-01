/** All enums for the hex battle engine. Faithful port of hex_battle.py. */

export enum GamePhase {
  WAITING = 'waiting',
  SELECTING = 'selecting',
  DECLARING = 'declaring',
  RESOLVING = 'resolving',
  ANIMATING = 'animating',
  GAME_OVER = 'game_over',
}

export enum ActionOrder {
  ATTACK_FIRST = 'ATTACK_FIRST',
  MOVE_FIRST = 'MOVE_FIRST',
}

export enum MoveCategory {
  PHYSICAL = 'physical',
  SPECIAL = 'special',
  TERRAIN = 'terrain',
  STATUS = 'status',
}

export enum PokemonStatus {
  ACTIVE = 'active',
  FAINTED = 'fainted',
  BURNED = 'burned',
  PARALYZED = 'paralyzed',
}

export enum TerrainType {
  SLOW_ZONE = 'slow_zone',
  BARRIER = 'barrier',
  TRAP = 'trap',
  ROCK = 'rock',
  TREE = 'tree',
  BURN_ZONE = 'burn_zone',
  MIST_ZONE = 'mist_zone',
  ROCK_TRAP = 'rock_trap',
  POISON_TRAP = 'poison_trap',
  SUNNY_ZONE = 'sunny_zone',
  RAIN_ZONE = 'rain_zone',
  FOG_ZONE = 'fog_zone',
  RESONANCE_ZONE = 'resonance_zone',
  PERISH_ZONE = 'perish_zone',
  ICE_ZONE = 'ice_zone',
}

export enum ActionType {
  MOVE = 'move',
  ATTACK = 'attack',
}

/** Pokemon type names (Gen 6 18-type set relevant to this roster). */
export type PokemonTypeName =
  | 'Normal'
  | 'Fire'
  | 'Water'
  | 'Electric'
  | 'Grass'
  | 'Ice'
  | 'Fighting'
  | 'Poison'
  | 'Ground'
  | 'Flying'
  | 'Psychic'
  | 'Bug'
  | 'Rock'
  | 'Ghost'
  | 'Dragon'
  | 'Dark'
  | 'Steel'
  | 'Fairy';

/** The five stats that have a stage system. */
export type StatName = 'attack' | 'defense' | 'sp_atk' | 'sp_def' | 'speed';

/** Status effect flags tracked per-turn on the battle state. */
export type StatusEffectName =
  | 'hypnotized'
  | 'flinched'
  | 'taunted'
  | 'destiny_bond';
