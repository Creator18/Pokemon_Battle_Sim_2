/** QueuedAction + priority queue construction. Port of hex_battle.py _build_queue (~5100). */

import { ActionOrder, ActionType } from '../core/enums.ts';
import { Pokemon } from '../model/pokemon.ts';
import { getMove } from '../data/moves.ts';
import { RNG } from '../rng.ts';
import {
  QA_MOVE_FIRST_SPEED_MULT,
  QA_MOVE_FIRST_PRIORITY_BUMP,
  SPEED_TILE_DIVISOR,
} from '../core/constants.ts';

export interface QueuedAction {
  priority: number;
  playerId: number;
  actionType: ActionType;
  pokemon: Pokemon;
  tiebreak: number;
}

export function qaEffectiveMoveRange(baseSpeed: number): number {
  return Math.max(1, Math.floor((baseSpeed * QA_MOVE_FIRST_SPEED_MULT) / SPEED_TILE_DIVISOR));
}

export function qaAttackPriority(order: ActionOrder): number {
  return order === ActionOrder.MOVE_FIRST ? 9999 + QA_MOVE_FIRST_PRIORITY_BUMP : 9999;
}

/** Sort key: higher priority first, then ascending tiebreak. */
function sortKey(a: QueuedAction): [number, number] {
  return [-a.priority, a.tiebreak];
}

export function buildQueue(p1: Pokemon, p2: Pokemon, rng: RNG): QueuedAction[] {
  const queue: QueuedAction[] = [];

  for (const pokemon of [p1, p2]) {
    if (!pokemon.isAlive || pokemon.declaration === null) continue;
    const decl = pokemon.declaration;
    const move = getMove(decl.moveName);
    if (move === undefined) continue;

    const [mp, ap] = pokemon.getActionPriorities();

    if (move.quickPriority) {
      const order = decl.actionOrder;
      if (order === ActionOrder.ATTACK_FIRST) {
        queue.push({
          priority: qaAttackPriority(ActionOrder.ATTACK_FIRST),
          playerId: pokemon.playerId,
          actionType: ActionType.ATTACK,
          pokemon,
          tiebreak: rng(),
        });
      } else {
        const boosted = qaAttackPriority(ActionOrder.MOVE_FIRST);
        queue.push({
          priority: boosted,
          playerId: pokemon.playerId,
          actionType: ActionType.MOVE,
          pokemon,
          tiebreak: rng(),
        });
        queue.push({
          priority: boosted,
          playerId: pokemon.playerId,
          actionType: ActionType.ATTACK,
          pokemon,
          tiebreak: rng(),
        });
      }
    } else {
      queue.push({
        priority: mp,
        playerId: pokemon.playerId,
        actionType: ActionType.MOVE,
        pokemon,
        tiebreak: rng(),
      });
      queue.push({
        priority: ap,
        playerId: pokemon.playerId,
        actionType: ActionType.ATTACK,
        pokemon,
        tiebreak: rng(),
      });
    }
  }

  queue.sort((a, b) => {
    const [ka0, ka1] = sortKey(a);
    const [kb0, kb1] = sortKey(b);
    if (ka0 !== kb0) return ka0 - kb0;
    return ka1 - kb1;
  });
  return queue;
}
