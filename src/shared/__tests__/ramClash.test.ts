import { describe, it, expect } from 'vitest';
import { BattleSession, ramClashPoint } from '../engine/turnEngine.ts';
import { TurnDeclaration } from '../engine/declaration.ts';
import { ActionOrder } from '../core/enums.ts';
import { HEX_GRID, keyToTile, Tile, hexDistance } from '../core/hex.ts';

/** Two Pokémon on an open row, charging each other with ram attacks. */
function ramClash(p1: string, m1: string, at1: Tile, p2: string, m2: string, at2: Tile) {
  const s = BattleSession.create(3, 'ram');
  s.selectPokemon(1, p1); s.selectMoves(1, [m1]);
  s.selectPokemon(2, p2); s.selectMoves(2, [m2]);
  s.startBattle();
  for (const k of HEX_GRID) s.state.terrain.removeTerrain(keyToTile(k));
  s.state.p1!.moveTo(at1);
  s.state.p2!.moveTo(at2);
  s.declare(1, new TurnDeclaration(m1, ActionOrder.ATTACK_FIRST, at2, []));
  s.declare(2, new TurnDeclaration(m2, ActionOrder.ATTACK_FIRST, at1, []));
  const r = s.resolveTurn();
  return { s, r };
}

describe('ram clashes', () => {
  it('a tie: both a tile back from the clash point, neither hurt', () => {
    const { s, r } = ramClash('Charizard', 'Flare Blitz', [-3, 3], 'Emboar', 'Flare Blitz', [1, 3]);
    expect(r.log.some((l) => l.includes('RAM CLASH'))).toBe(true);
    expect(s.state.p1!.currentHp).toBe(s.state.p1!.maxHp);
    expect(s.state.p2!.currentHp).toBe(s.state.p2!.maxHp);
    const at = ramClashPoint([-3, 3], [1, 3]);
    expect(at.tile).toEqual([-1, 3]);
    expect(s.state.p1!.tile).toEqual(at.step(-1));
    expect(s.state.p2!.tile).toEqual(at.step(1));
  });

  it('a win: the winner a tile past the clash point, the loser three back from it', () => {
    const { s, r } = ramClash('Aggron', 'Head Smash', [-3, 3], 'Kangaskhan', 'Take Down', [1, 3]);
    expect(r.log.some((l) => l.includes('overpowers'))).toBe(true);
    const at = ramClashPoint([-3, 3], [1, 3]);
    expect(s.state.p1!.tile).toEqual(at.step(1));
    expect(s.state.p2!.currentHp).toBeLessThan(s.state.p2!.maxHp);
    const want = at.step(3);
    const t = s.state.p2!.tile;
    // Three back from the clash point where there is room; else a tile beside it.
    expect(hexDistance(t[0], t[1], want[0], want[1])).toBeLessThanOrEqual(1);
  });

  it('a ram and a beam do not clash', () => {
    const { r } = ramClash('Charizard', 'Flare Blitz', [-2, 3], 'Blastoise', 'Hydro Pump', [1, 3]);
    expect(r.log.some((l) => l.includes('CLASH'))).toBe(false);
  });
});
