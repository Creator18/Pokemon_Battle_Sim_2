import { describe, it, expect } from 'vitest';
import { BattleSession } from '../engine/turnEngine.ts';
import { getSpecies } from '../data/species.ts';
import { footprint, footprintKeys, anchorRules, tileKey, HEX_GRID } from '../core/hex.ts';

function session(p1: string, p2: string): BattleSession {
  const s = BattleSession.create(777, 'huge');
  s.selectPokemon(1, p1);
  s.selectMoves(1, getSpecies(p1)!.movePool.slice(0, 4));
  s.selectPokemon(2, p2);
  s.selectMoves(2, getSpecies(p2)!.movePool.slice(0, 4));
  s.startBattle();
  return s;
}

describe('huge Pokémon (three-tile footprint)', () => {
  it('flags the tall species as huge and the rest as not', () => {
    expect(getSpecies('Steelix')!.huge).toBe(true);
    expect(getSpecies('Rayquaza')!.huge).toBe(true);
    expect(getSpecies('Pikachu')!.huge).toBe(false);
  });

  it('a footprint is a triangle of three mutually adjacent tiles', () => {
    const f = footprint([0, 0], true);
    expect(f).toHaveLength(3);
    for (const a of f) for (const b of f) {
      if (a === b) continue;
      const d = (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[0] + a[1] - b[0] - b[1])) / 2;
      expect(d).toBe(1);
    }
    expect(footprint([2, 3], false)).toEqual([[2, 3]]);
  });

  it('a huge mover cannot stand where its footprint leaves the board', () => {
    const { blocked } = anchorRules(true, new Set(), new Set());
    for (const key of HEX_GRID) {
      const [q, r] = key.split(',').map(Number);
      const inside = footprint([q, r], true).every((t) => HEX_GRID.has(tileKey(t[0], t[1])));
      expect(blocked.has(key)).toBe(!inside);
    }
  });

  it('a huge mover may not stop where its footprint overlaps the opponent', () => {
    const opp = footprintKeys([0, 0], false);
    const { occupied } = anchorRules(true, new Set(), opp);
    // Anchors whose triangle covers (0,0): (0,0), (-1,0), (0,-1).
    for (const a of ['0,0', '-1,0', '0,-1']) expect(occupied.has(a)).toBe(true);
    expect(occupied.has('1,0')).toBe(false);
  });

  it('nobody can end a move on any tile of a huge opponent', () => {
    const s = session('Pikachu', 'Steelix');
    const st = s.getState();
    const anchor = st.pokemon.p2!.tile as [number, number];
    const reach = new Set(s.getReachableTiles(1));
    for (const t of footprint(anchor, true)) expect(reach.has(tileKey(t[0], t[1]))).toBe(false);
  });

  it('serializes the huge flag', () => {
    const s = session('Steelix', 'Pikachu');
    expect(s.getState().pokemon.p1!.huge).toBe(true);
    expect(BattleSession.fromJSON(s.getState()).getState().pokemon.p1!.huge).toBe(true);
  });
});
