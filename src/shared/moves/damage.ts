/** Damage formula, crit, hex power, weather, type mult. Port of hex_battle.py ~3100-3195. */

import { MoveCategory, TerrainType } from '../core/enums.ts';
import { MoveDefinition } from './moveDefinition.ts';
import { Pokemon } from '../model/pokemon.ts';
import { TerrainManager } from '../terrain/terrainManager.ts';
import { getTypeEffectiveness } from '../core/typechart.ts';
import { moveType } from '../data/moves.ts';
import { RNG } from '../rng.ts';
import {
  MOMENTUM_CAP,
  MOMENTUM_BONUS_PER_TILE,
  VOLT_TACKLE_RECOIL_MOMENTUM_DAMP,
} from '../core/constants.ts';

export function getMoveTypeMult(move: MoveDefinition, defender: Pokemon): number {
  return getTypeEffectiveness(moveType(move.name), defender.types);
}

export function getWeatherMult(move: MoveDefinition, tm: TerrainManager): number {
  const t = moveType(move.name);
  if (t === 'Fire') return tm.globalFireMult();
  if (t === 'Water') return tm.globalWaterMult();
  return 1.0;
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
    D = Math.max(1, Math.trunc(defender.spDef * defender.statStageSpdefMult));
    if (crit) {
      A = Math.max(A, attacker.spAtk);
      D = Math.min(D, Math.trunc(defender.spDef));
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
