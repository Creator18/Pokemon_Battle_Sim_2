/**
 * Beam clashes. Two beams fired at each other in one turn meet head-on; the
 * stronger overall output wins:
 *
 *   output = base power × charge (unused movement, chargeMultiplier)
 *            × type effectiveness of this beam's type against the other beam's
 *
 * Equal outputs: both beams disperse and neither lands. Otherwise the winner's
 * beam pushes through and hits, its damage scaled by how decisively it won
 * (the margin, (winner − loser) / winner); the loser's beam does nothing.
 */

import { MoveDefinition } from './moveDefinition.ts';
import { Pokemon } from '../model/pokemon.ts';
import { TerrainManager } from '../terrain/terrainManager.ts';
import { getTypeEffectiveness } from '../core/typechart.ts';
import { Tile, tileKey, HEX_GRID } from '../core/hex.ts';
import { moveType } from '../data/moves.ts';
import { validateMove } from './execute.ts';

export interface ClashSide {
  playerId: number;
  move: MoveDefinition;
  /** Its charge multiplier (chargeMultiplier). */
  charge: number;
}

export interface ClashOutcome {
  /** The winner's player id; null when it is a tie (both beams disperse). */
  winner: number | null;
  /** Each side's overall output, by player id. */
  outputs: Record<number, number>;
  /** Each side's charge multiplier, by player id. */
  charges: Record<number, number>;
  /** How decisively it was won: (winner − loser) / winner, 0 for a tie. */
  margin: number;
}

/** One beam's overall output against the other beam. */
export function beamOutput(move: MoveDefinition, charge: number, against: MoveDefinition): number {
  return move.basePower * charge * getTypeEffectiveness(moveType(move.name), [moveType(against.name)]);
}

export function resolveClash(a: ClashSide, b: ClashSide): ClashOutcome {
  const oa = beamOutput(a.move, a.charge, b.move);
  const ob = beamOutput(b.move, b.charge, a.move);
  const outputs = { [a.playerId]: oa, [b.playerId]: ob };
  const charges = { [a.playerId]: a.charge, [b.playerId]: b.charge };
  if (Math.abs(oa - ob) < 1e-9) return { winner: null, outputs, charges, margin: 0 };
  const [w, hi, lo] = oa > ob ? [a.playerId, oa, ob] : [b.playerId, ob, oa];
  return { winner: w, outputs, charges, margin: hi > 0 ? (hi - lo) / hi : 0 };
}

/**
 * Do these two beams meet? Both are beams, and each is aimed at the other
 * where it stands now and can reach it (line of sight from where it fires).
 */
export function beamsMeet(
  a: Pokemon,
  aMove: MoveDefinition,
  aTarget: Tile | null,
  b: Pokemon,
  bMove: MoveDefinition,
  bTarget: Tile | null,
  tm: TerrainManager,
  grid: ReadonlySet<string> = HEX_GRID,
): boolean {
  if (!aMove.isBeam || !bMove.isBeam || !aTarget || !bTarget) return false;
  if (!a.isAlive || !b.isAlive) return false;
  const covers = (p: Pokemon, t: Tile) => p.tiles.some((x) => tileKey(x[0], x[1]) === tileKey(t[0], t[1]));
  if (!covers(b, aTarget) || !covers(a, bTarget)) return false;
  const barriers = tm.blockedLosTiles;
  return validateMove(aMove, a, aTarget, 0, barriers, grid).ok && validateMove(bMove, b, bTarget, 0, barriers, grid).ok;
}
