/** All game-balance constants. Faithful port of hex_battle.py lines ~44-176. */

import type { StatName } from './enums.ts';

export const GRID_RADIUS = 4;
export const DEFAULT_LEVEL = 50;

export const SPEED_TILE_DIVISOR = 20;
export const MOVE_FIRST_COST = 10;
export const MOMENTUM_BONUS_PER_TILE = 0.1;
export const MOMENTUM_CAP = 1.5;

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
