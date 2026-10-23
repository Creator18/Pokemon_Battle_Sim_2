/** Damage formula, crit, hex power, weather, type mult. Port of hex_battle.py ~3100-3195. */

import { MoveCategory, TerrainType } from '../core/enums.ts';
import { MoveDefinition } from './moveDefinition.ts';
import { Pokemon } from '../model/pokemon.ts';
import { TerrainManager, TERRAIN_TYPE_OF, isGrounded } from '../terrain/terrainManager.ts';
import { getTypeEffectiveness } from '../core/typechart.ts';
import { moveType } from '../data/moves.ts';
import { RNG } from '../rng.ts';
import {
  MOMENTUM_CAP,
  MOMENTUM_BONUS_PER_TILE,
  CHARGE_CAP,
  CHARGE_BONUS_PER_TILE,
  WATER_BOOST,
  WATER_FIRE_MULT,
  VOLT_TACKLE_RECOIL_MOMENTUM_DAMP,
  TERRAIN_BOOST,
  GRASSY_QUAKE_MULT,
  MISTY_DRAGON_MULT,
  SAND_ROCK_SPDEF_MULT,
} from '../core/constants.ts';

/**
 * Terrain Pulse takes on the terrain's type (its user grounded): the
 * terrain's type, or null when it stays Normal.
 */
export function terrainPulseType(move: MoveDefinition, tm?: TerrainManager, attacker?: { types: readonly string[] }): string | null {
  if (move.name !== 'Terrain Pulse' || !tm || !attacker || !isGrounded(attacker)) return null;
  const t = tm.fieldTerrain();
  return t ? TERRAIN_TYPE_OF[t] ?? null : null;
}

/** A move's type as it is used now (Terrain Pulse under a terrain: the terrain's). */
export function effectiveMoveType(move: MoveDefinition, tm?: TerrainManager, attacker?: { types: readonly string[] }): string {
  return terrainPulseType(move, tm, attacker) ?? moveType(move.name);
}

export function getMoveTypeMult(move: MoveDefinition, defender: Pokemon, tm?: TerrainManager, attacker?: Pokemon): number {
  return getTypeEffectiveness(effectiveMoveType(move, tm, attacker), defender.types);
}

/**
 * The field's say on a move's damage: the weather (sun and rain on Fire and
 * Water), a pond under its user, and the terrain — its own type boosted from
 * a grounded user; Grassy Terrain halving Earthquake and Misty Terrain Dragon
 * moves on a grounded target.
 */
export function getWeatherMult(move: MoveDefinition, tm: TerrainManager, attacker?: Pokemon, defender?: Pokemon): number {
  const t = effectiveMoveType(move, tm, attacker);
  let mult = 1.0;
  // Fired from a pond: Water moves hit harder, Fire moves weaker.
  const inWater = !!attacker && tm.getTerrain(attacker.tile)?.terrainType === TerrainType.WATER;
  if (t === 'Fire') mult *= tm.globalFireMult() * (inWater ? WATER_FIRE_MULT : 1);
  if (t === 'Water') mult *= tm.globalWaterMult() * (inWater ? WATER_BOOST : 1);
  const terrain = tm.fieldTerrain();
  if (terrain) {
    if (attacker && isGrounded(attacker) && TERRAIN_TYPE_OF[terrain] === t && terrain !== TerrainType.MISTY_TERRAIN) mult *= TERRAIN_BOOST;
    if (defender && isGrounded(defender)) {
      if (terrain === TerrainType.GRASSY_TERRAIN && move.name === 'Earthquake') mult *= GRASSY_QUAKE_MULT;
      if (terrain === TerrainType.MISTY_TERRAIN && t === 'Dragon') mult *= MISTY_DRAGON_MULT;
    }
  }
  return mult;
}

/** In a sandstorm a Rock type's Sp. Def is up (SAND_ROCK_SPDEF_MULT): against special moves. */
export function sandSpDefMult(move: MoveDefinition, tm: TerrainManager, defender: Pokemon): number {
  return tm.isSandstorm() && move.category === MoveCategory.SPECIAL && defender.types.includes('Rock') ? SAND_ROCK_SPDEF_MULT : 1;
}

export function isHighCritMove(move: MoveDefinition): boolean {
  return move.name === 'Night Slash' || move.name === 'Psycho Cut';
}

export function rollCrit(move: MoveDefinition, rng: RNG): boolean {
  const rate = isHighCritMove(move) ? 1 / 8 : 1 / 16;
  return rng() < rate;
}

const HEX_STATUS_TERRAIN = new Set<TerrainType>([
  TerrainType.BURN_ZONE,
  TerrainType.SLOW_ZONE,
  TerrainType.POISON_TRAP,
  TerrainType.RESONANCE_ZONE,
]);

/** Hex doubles base power if the defender stands on a status-terrain tile. */
export function getHexPower(move: MoveDefinition, defender: Pokemon, tm: TerrainManager): number {
  if (move.name !== 'Hex') return move.basePower;
  const entity = tm.getTerrain(defender.tile);
  if (entity && HEX_STATUS_TERRAIN.has(entity.terrainType)) return move.basePower * 2;
  return move.basePower;
}

export function momentumMultiplier(straightTiles: number): number {
  return Math.min(MOMENTUM_CAP, 1.0 + straightTiles * MOMENTUM_BONUS_PER_TILE);
}

/** A ranged special move's charge: the movement it left unused, +CHARGE_BONUS_PER_TILE a tile, at most CHARGE_CAP. */
export function chargeMultiplier(unusedTiles: number): number {
  return Math.min(CHARGE_CAP, 1.0 + Math.max(0, unusedTiles) * CHARGE_BONUS_PER_TILE);
}

/** Does `move` charge with unused movement? Ranged special attacks do. */
export function chargesUp(move: MoveDefinition): boolean {
  return move.category === MoveCategory.SPECIAL && move.isRanged;
}

export function voltTackleRecoilMultiplier(momentumMult: number): number {
  return 1.0 + (momentumMult - 1.0) * VOLT_TACKLE_RECOIL_MOMENTUM_DAMP;
}

export interface DamageParams {
  momentum?: number;
  powerMult?: number;
  boostMult?: number;
  typeMult?: number;
  weatherMult?: number;
  crit?: boolean;
  hexPower?: number | null;
  /** The defender's Sp. Def × this (a Rock type in a sandstorm). */
  spDefMult?: number;
}

/**
 * Core damage formula. Faithful port of hex_battle.py calculate_damage (~3152).
 * Python uses int() (trunc toward zero) for A/D; all operands here are
 * non-negative, so Math.floor == Math.trunc.
 */
export function calculateDamage(
  move: MoveDefinition,
  attacker: Pokemon,
  defender: Pokemon,
  params: DamageParams = {},
): number {
  const {
    momentum = 1.0,
    powerMult = 1.0,
    boostMult = 1.0,
    typeMult = 1.0,
    weatherMult = 1.0,
    crit = false,
    hexPower = null,
    spDefMult = 1.0,
  } = params;

  const L = attacker.level;
  const Power = hexPower ?? move.basePower;

  let A: number;
  let D: number;
  if (move.category === MoveCategory.PHYSICAL) {
    A = Math.trunc(attacker.attack * attacker.statStageAttackMult);
    D = Math.max(1, Math.trunc(defender.defense * defender.statStageDefenseMult));
    if (crit) {
      A = Math.max(A, attacker.attack);
      D = Math.min(D, Math.trunc(defender.defense));
    }
  } else {
    A = Math.trunc(attacker.spAtk * attacker.statStageSpatkMult);
    D = Math.max(1, Math.trunc(defender.spDef * defender.statStageSpdefMult * spDefMult));
    if (crit) {
      A = Math.max(A, attacker.spAtk);
      D = Math.min(D, Math.trunc(defender.spDef * spDefMult));
    }
  }

  const inner = Math.floor(((2 * L) / 5 + 2) * Power * (A / D));
  const base = Math.floor(inner / 50) + 2;
  const critMult = crit ? 1.5 : 1.0;
  return Math.max(
    1,
    Math.floor(base * momentum * powerMult * boostMult * typeMult * weatherMult * critMult),
  );
}
