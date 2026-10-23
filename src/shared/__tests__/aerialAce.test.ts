import { describe, it, expect } from 'vitest';
import { BattleSession } from '../engine/turnEngine.ts';
import { TurnDeclaration } from '../engine/declaration.ts';
import { ActionOrder } from '../core/enums.ts';
import { HEX_GRID, keyToTile, Tile, hexDistance, hexLineTiles } from '../core/hex.ts';

/** Talonflame's Aerial Ace at Blastoise `gap` tiles along an open row (Blastoise firing off elsewhere). */
function ace(gap: number) {
  const s = BattleSession.create(7, 'ace');
  s.selectPokemon(1, 'Talonflame'); s.selectMoves(1, ['Aerial Ace']);
  s.selectPokemon(2, 'Blastoise'); s.selectMoves(2, ['Hydro Pump']);
  s.startBattle();
  for (const k of HEX_GRID) s.state.terrain.removeTerrain(keyToTile(k));
  const at1: Tile = [-2, 0], at2: Tile = [-2 + gap, 0];
  s.state.p1!.moveTo(at1);
  s.state.p2!.moveTo(at2);
  s.declare(1, new TurnDeclaration('Aerial Ace', ActionOrder.ATTACK_FIRST, at2, []));
  s.declare(2, new TurnDeclaration('Hydro Pump', ActionOrder.ATTACK_FIRST, [1, -3], []));
  const r = s.resolveTurn();
  return { s, r, at1, at2 };
}

describe('Aerial Ace', () => {
  it('hits, and pulls up two tiles short of its target on the line it came in on', () => {
    const { s, at1, at2 } = ace(4);
    expect(s.state.p2!.currentHp).toBeLessThan(s.state.p2!.maxHp);
    const t = s.state.p1!.tile;
    expect(hexDistance(t[0], t[1], at2[0], at2[1])).toBe(2);
    expect(hexLineTiles(at1[0], at1[1], at2[0], at2[1])).toContainEqual(t);
  });

  it('from closer than two tiles, it ends back where it started', () => {
    const { s, at1 } = ace(1);
    expect(s.state.p2!.currentHp).toBeLessThan(s.state.p2!.maxHp);
    expect(s.state.p1!.tile).toEqual(at1);
  });
});
