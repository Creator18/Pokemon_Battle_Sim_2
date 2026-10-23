import { describe, it, expect } from 'vitest';
import { BattleSession } from '../engine/turnEngine.ts';
import { TurnDeclaration } from '../engine/declaration.ts';
import { ActionOrder } from '../core/enums.ts';
import { HEX_GRID, keyToTile, Tile } from '../core/hex.ts';

/** Charizard's Flare Blitz at Blastoise on an open row, moving `path` first (straight at it, or not at all). */
function blitz(path: Tile[]) {
  const s = BattleSession.create(11, 'ram');
  s.selectPokemon(1, 'Charizard'); s.selectMoves(1, ['Flare Blitz']);
  s.selectPokemon(2, 'Blastoise'); s.selectMoves(2, ['Hydro Pump']);
  s.startBattle();
  for (const k of HEX_GRID) s.state.terrain.removeTerrain(keyToTile(k));
  s.state.p1!.moveTo(path[0]);
  s.state.p2!.moveTo([2, 0]);
  s.declare(1, new TurnDeclaration('Flare Blitz', path.length > 1 ? ActionOrder.MOVE_FIRST : ActionOrder.ATTACK_FIRST, [2, 0], path));
  s.declare(2, new TurnDeclaration('Hydro Pump', ActionOrder.ATTACK_FIRST, [-3, 3], []));
  const r = s.resolveTurn();
  const hit = r.log.find((l) => l.includes('Blastoise (P2) took'));
  return Number(hit?.match(/took (\d+)/)?.[1] ?? 0);
}

describe('ram momentum', () => {
  it('a ram hits harder after a straight run-up', () => {
    const still = blitz([[-2, 0]]);
    const run = blitz([[-2, 0], [-1, 0], [0, 0]]);
    expect(still).toBeGreaterThan(0);
    expect(run).toBeGreaterThan(still);
  });
});
