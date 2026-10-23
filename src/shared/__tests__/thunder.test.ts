import { describe, it, expect } from 'vitest';
import { BattleSession } from '../engine/turnEngine.ts';
import { TurnDeclaration } from '../engine/declaration.ts';
import { ActionOrder, TerrainType } from '../core/enums.ts';
import { HEX_GRID, keyToTile, Tile } from '../core/hex.ts';
import { THUNDER_ACCURACY } from '../core/constants.ts';

const A: Tile = [-2, 3], B: Tile = [1, 3];

/** Pikachu's Thunder at Blastoise on an open row (in the rain, if `rain`): did it miss? */
function thunderMisses(seed: number, rain: boolean): boolean {
  const s = BattleSession.create(seed, 'thunder');
  s.selectPokemon(1, 'Pikachu');
  s.selectMoves(1, ['Thunder', 'Swords Dance']);
  s.selectPokemon(2, 'Blastoise');
  s.selectMoves(2, ['Swords Dance']);
  s.startBattle();
  for (const k of HEX_GRID) s.state.terrain.removeTerrain(keyToTile(k));
  if (rain) s.state.terrain.addTerrain([0, 0], TerrainType.RAIN_ZONE, 1, 5);
  s.state.p1!.moveTo(A);
  s.state.p2!.moveTo(B);
  s.declare(1, new TurnDeclaration('Thunder', ActionOrder.ATTACK_FIRST, B, []));
  s.declare(2, new TurnDeclaration('Swords Dance', ActionOrder.ATTACK_FIRST, null, []));
  const res = s.resolveTurn();
  const missed = res.log.some((l) => l.includes('Thunder! But it missed'));
  expect(missed).toBe(s.state.p2!.currentHp === s.state.p2!.maxHp);
  return missed;
}

describe('Thunder', () => {
  it(`hits about ${THUNDER_ACCURACY * 100}% of the time`, () => {
    const runs = 200;
    let misses = 0;
    for (let seed = 1; seed <= runs; seed++) if (thunderMisses(seed, false)) misses++;
    const rate = 1 - misses / runs;
    expect(rate).toBeGreaterThan(THUNDER_ACCURACY - 0.12);
    expect(rate).toBeLessThan(THUNDER_ACCURACY + 0.12);
  });

  it('never misses in the rain', () => {
    for (let seed = 1; seed <= 60; seed++) expect(thunderMisses(seed, true)).toBe(false);
  });
});
