import { describe, it, expect } from 'vitest';
import { BattleSession } from '../engine/turnEngine.ts';
import { TurnDeclaration } from '../engine/declaration.ts';
import { ActionOrder } from '../core/enums.ts';
import { HEX_GRID, keyToTile, Tile, hexDistance } from '../core/hex.ts';

/** Garchomp's Dragon Rush at Blastoise on an open row (Blastoise firing off elsewhere), on this seed. */
function rush(seed: number) {
  const s = BattleSession.create(seed, 'dodge');
  s.selectPokemon(1, 'Garchomp'); s.selectMoves(1, ['Dragon Rush']);
  s.selectPokemon(2, 'Blastoise'); s.selectMoves(2, ['Hydro Pump']);
  s.startBattle();
  for (const k of HEX_GRID) s.state.terrain.removeTerrain(keyToTile(k));
  const at1: Tile = [-2, 3], at2: Tile = [1, 3];
  s.state.p1!.moveTo(at1);
  s.state.p2!.moveTo(at2);
  s.declare(1, new TurnDeclaration('Dragon Rush', ActionOrder.ATTACK_FIRST, at2, []));
  s.declare(2, new TurnDeclaration('Hydro Pump', ActionOrder.ATTACK_FIRST, [1, -3], []));
  const r = s.resolveTurn();
  return { s, r, at1, at2 };
}

describe('dodging', () => {
  it('a missed attack is dodged: the target side-steps to a tile beside it, unhurt', () => {
    let misses = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const { s, r, at2 } = rush(seed);
      if (!r.log.some((l) => l.includes('Dragon Rush! But it missed'))) continue;
      misses++;
      expect(r.log.some((l) => l.includes('dodged to'))).toBe(true);
      const t = s.state.p2!.tile;
      expect(hexDistance(t[0], t[1], at2[0], at2[1])).toBe(1);
      expect(t).not.toEqual(s.state.p1!.tile);
      expect(s.state.p2!.currentHp).toBe(s.state.p2!.maxHp);
    }
    // (About a quarter of them miss.)
    expect(misses).toBeGreaterThan(5);
  });

  it('a hit is not dodged', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { r } = rush(seed);
      if (r.log.some((l) => l.includes('Dragon Rush! But it missed'))) continue;
      expect(r.log.some((l) => l.includes('dodged to'))).toBe(false);
    }
  });
});
