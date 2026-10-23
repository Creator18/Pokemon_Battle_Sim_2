/** All game-balance constants. Faithful port of hex_battle.py lines ~44-176. */

import type { StatName } from './enums.ts';

export const GRID_RADIUS = 4;
export const DEFAULT_LEVEL = 50;

export const SPEED_TILE_DIVISOR = 20;
export const MOVE_FIRST_COST = 10;
export const MOMENTUM_BONUS_PER_TILE = 0.1;
export const MOMENTUM_CAP = 1.5;
/** A ranged special move charges with the movement it leaves unused: +CHARGE_BONUS_PER_TILE a tile, at most CHARGE_CAP. */
export const CHARGE_BONUS_PER_TILE = 0.1;
export const CHARGE_CAP = 1.5;

export const EARLY_STOP_BOOST_PER_TILE = 0.15;
export const EARLY_STOP_BOOST_MAX = 2.0;

export const QA_MOVE_FIRST_SPEED_MULT = 1.5;
export const QA_MOVE_FIRST_PRIORITY_BUMP = 10;
export const QA_MOVE_FIRST_POWER_PENALTY = 0.08;
export const QA_MOVE_FIRST_POWER_MIN = 0.3;
export const QA_ATTACK_FIRST_POWER_MULT = 1.2;

export const COOLDOWN_ATTACK_FIRST = 2;
export const COOLDOWN_MOVE_FIRST = 1;

export const TERRAIN_DURATION_MINOR = 6;
export const TERRAIN_DURATION_MODERATE = 4;
export const TERRAIN_DURATION_TRAP = 2;

/** Volt Tackle recoil: floor(dmg * BASE * (1 + (momentum-1) * DAMP)). */
export const VOLT_TACKLE_RECOIL_BASE = 1 / 3;
export const VOLT_TACKLE_RECOIL_MOMENTUM_DAMP = 0.5;

export const PERISH_COUNTDOWN_TURNS = 3;
export const ICE_CHIP_DAMAGE_PCT = 0.06;
export const RESONANCE_SPDEF_DROP = -1;
export const BURN_ZONE_DAMAGE_PCT = 0.125;

export const MAP_ROCK_CENTER: readonly [number, number] = [0, 0];
export const MAP_ROCK_RADIUS = 1;
export const MAP_TREE_COUNT = 6;
export const MAP_TREE_INTEGRITY = 2;
export const MAP_SPAWN_EXCLUSION = 2;

export const DEFAULT_STEP_COST = 1;
export const MAP_ROCK_STEP_COST = 2;

/** Earthquake's tilted ground: rough to cross (step cost), for 3 turns after the quake's (it ticks once at that turn's end). */
export const TILTED_STEP_COST = 2;
export const TILTED_DURATION = 4;

/**
 * Ponds: MAP_WATER_PONDS of MAP_WATER_POND_SIZE joined tiles on each map,
 * WATER_STEP_COST to wade into. A Water move fired from one × WATER_BOOST,
 * a Fire move × WATER_FIRE_MULT.
 */
export const MAP_WATER_PONDS = 2;
export const MAP_WATER_POND_SIZE = 3;
export const WATER_STEP_COST = 2;
export const WATER_BOOST = 1.2;
export const WATER_FIRE_MULT = 0.8;

/**
 * A grass fire (Flamethrower over grass): a burn zone for 2 turns (it ticks
 * once at the end of the turn it is lit), held GRASS_FIRE_SUN_EXTRA turn
 * longer if Sunny Day is up when it would go out. The grass is gone for good.
 */
export const GRASS_FIRE_DURATION = 3;
export const GRASS_FIRE_SUN_EXTRA = 1;

export const STAT_STAGE_MIN = -6;
export const STAT_STAGE_MAX = 6;
export const STAT_STAGE_NAMES: readonly StatName[] = [
  'attack',
  'defense',
  'sp_atk',
  'sp_def',
  'speed',
];

export const ELECTRO_WEB_SPEED_STAGES = -1;

export const SELECTION_MOVES_TO_PICK = 4;
export const SELECTION_POOL_SIZE = 8;
export const TERRAIN_MOVE_REQUIRED = true;

export const P1_START: readonly [number, number] = [-3, 0];
export const P2_START: readonly [number, number] = [3, 0];

/** Derived: total tiles on the grid. */
export const TOTAL_TILES = 3 * GRID_RADIUS * GRID_RADIUS + 3 * GRID_RADIUS + 1;

// ── Freeze ──
/** Ice Beam's chance to freeze what it hits (from the games). */
export const ICE_BEAM_FREEZE_CHANCE = 0.1;
/** Left alone, it stays frozen through this many turns after the one it froze in. */
export const FREEZE_TURNS = 2;
/** A frozen Fire type breaks free sooner: this many turns (FREEZE_TURNS_FIRE_HAIL standing in hail). */
export const FREEZE_TURNS_FIRE = 1;
export const FREEZE_TURNS_FIRE_HAIL = 2;
/** Rain makes freezing likelier: every chance to freeze × this. (Nothing freezes under the sun.) */
export const FREEZE_RAIN_MULT = 2;
/** A Fire move on a frozen Pokémon melts the ice, spending some of itself: its damage × this. */
export const FREEZE_MELT_FIRE_MULT = 0.5;
/** Thunder's accuracy (from the games); in the rain it never misses. */
export const THUNDER_ACCURACY = 0.7;

// ── Weather and terrains (as in the main games) ──
/** How long a weather (sun, rain, hail, sandstorm) or a terrain lasts, turns. */
export const FIELD_DURATION = 5;
/** Hail and a sandstorm chip this share of max HP at each turn's end (hail: not Ice types; sand: not Rock, Ground or Steel). */
export const WEATHER_CHIP_FRACTION = 1 / 16;
/** In a sandstorm, a Rock type's Sp. Def × this. */
export const SAND_ROCK_SPDEF_MULT = 1.5;
/** A terrain boosts its own type's moves by a grounded user × this (Electric, Grassy, Psychic). */
export const TERRAIN_BOOST = 1.3;
/** Grassy Terrain heals the grounded this share of max HP at each turn's end. */
export const GRASSY_HEAL_FRACTION = 1 / 16;
/** Grassy Terrain: Earthquake on a grounded target × this. Misty Terrain: Dragon moves on one × this. */
export const GRASSY_QUAKE_MULT = 0.5;
export const MISTY_DRAGON_MULT = 0.5;
/** Terrain Pulse under a terrain (its user grounded): its power × this, in the terrain's type. */
export const TERRAIN_PULSE_POWER_MULT = 2;
