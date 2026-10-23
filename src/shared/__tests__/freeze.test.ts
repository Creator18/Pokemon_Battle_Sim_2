import { describe, it, expect } from 'vitest';
import { BattleSession } from '../engine/turnEngine.ts';
import { TurnDeclaration } from '../engine/declaration.ts';
import { ActionOrder, PokemonStatus, TerrainType } from '../core/enums.ts';
import { HEX_GRID, keyToTile, Tile } from '../core/hex.ts';
import { FREEZE_TURNS, FREEZE_RAIN_MULT, ICE_BEAM_FREEZE_CHANCE } from '../core/constants.ts';
import { freezeChance } from '../moves/execute.ts';
import { TerrainManager } from '../terrain/terrainManager.ts';

const A: Tile = [-2, 3], B: Tile = [1, 3];

/** A battle on an open row; P2 frozen solid before the turn unless `frozen` is false. */
function setup(p1: string, p2: string, moves: string[], frozen = true, seed = 777): BattleSession {
  const s = BattleSession.create(seed, 'freeze');
  s.selectPokemon(1, p1);
  s.selectMoves(1, moves);
  s.selectPokemon(2, p2);
  s.selectMoves(2, moves);
  s.startBattle();
  for (const k of HEX_GRID) s.state.terrain.removeTerrain(keyToTile(k));
  s.state.p1!.moveTo(A);
  s.state.p2!.moveTo(B);
  if (frozen) expect(s.state.p2!.applyStatus(PokemonStatus.FROZEN)).toBe(true);
  return s;
}
const act = (move: string, at: Tile | null, path: Tile[] = []) => new TurnDeclaration(move, ActionOrder.ATTACK_FIRST, at, path);
const idle = () => act('Swords Dance', null);

describe('Freeze', () => {
  it('Ice types are never frozen', () => {
    const s = setup('Glaceon', 'Charizard', ['Ice Beam', 'Swords Dance'], false);
    expect(s.state.p1!.applyStatus(PokemonStatus.FROZEN)).toBe(false);
  });

  it('frozen solid, it neither moves nor attacks', () => {
    const s = setup('Charizard', 'Blastoise', ['Swords Dance', 'Hydro Pump']);
    s.declare(1, idle());
    s.declare(2, new TurnDeclaration('Hydro Pump', ActionOrder.MOVE_FIRST, A, [B, [0, 3]]));
    const res = s.resolveTurn();
    expect(s.state.p2!.isFrozen).toBe(true);
    expect(s.state.p2!.tile).toEqual(B);
    expect(s.state.p1!.currentHp).toBe(s.state.p1!.maxHp);
    expect(res.log.some((l) => l.includes('frozen solid'))).toBe(true);
  });

  it(`left alone, it stays frozen through ${FREEZE_TURNS} turns, and breaks free as the next begins`, () => {
    const s = setup('Charizard', 'Blastoise', ['Swords Dance', 'Hydro Pump']);
    for (let t = 1; t <= FREEZE_TURNS; t++) {
      s.declare(1, idle());
      s.declare(2, idle());
      s.resolveTurn();
      expect(s.state.p2!.isFrozen).toBe(true);
    }
    s.declare(1, idle());
    s.declare(2, act('Hydro Pump', A));
    const res = s.resolveTurn();
    expect(s.state.p2!.isFrozen).toBe(false);
    expect(res.log.some((l) => l.includes('broke free'))).toBe(true);
    expect(s.state.p1!.currentHp).toBeLessThan(s.state.p1!.maxHp); // free, it attacks
  });

  it('a frozen Fire type breaks free after one turn, or two in hail', () => {
    for (const [hail, turns] of [[false, 1], [true, 2]] as const) {
      const s = setup('Blastoise', 'Charizard', ['Swords Dance', 'Flamethrower']);
      if (hail) s.state.terrain.addTerrain(B, TerrainType.HAIL, 1, 9);
      let t = 0;
      while (s.state.p2!.isFrozen && t < 5) {
        s.declare(1, idle());
        s.declare(2, idle());
        s.resolveTurn();
        t++;
      }
      expect(t - 1).toBe(turns); // frozen through `turns` turns, free as the next began
    }
  });

  it('any hit shatters the ice: the freeze ends at once', () => {
    const s = setup('Charizard', 'Blastoise', ['Dragon Pulse', 'Swords Dance']);
    s.declare(1, act('Dragon Pulse', B));
    s.declare(2, idle());
    const res = s.resolveTurn();
    expect(s.state.p2!.isFrozen).toBe(false);
    expect(s.state.p2!.currentHp).toBeLessThan(s.state.p2!.maxHp);
    expect(res.log.some((l) => l.includes('ice shattered'))).toBe(true);
    const hit = res.resolvedActions.find((a) => a.playerId === 1 && a.result);
    expect(hit!.result!.statChanges.some(([pid, e]) => pid === 2 && e === 'shattered')).toBe(true);
  });

  it('a Fire move melts the ice instead, its damage reduced', () => {
    const fireOn = (frozen: boolean) => {
      const s = setup('Charizard', 'Blastoise', ['Flamethrower', 'Swords Dance'], frozen);
      s.declare(1, act('Flamethrower', B));
      s.declare(2, idle());
      const res = s.resolveTurn();
      return { s, res, dmg: s.state.p2!.maxHp - s.state.p2!.currentHp };
    };
    const thawed = fireOn(true), plain = fireOn(false);
    expect(thawed.s.state.p2!.isFrozen).toBe(false);
    expect(thawed.res.log.some((l) => l.includes('melted'))).toBe(true);
    expect(thawed.dmg).toBeLessThan(plain.dmg);
    // (×0.5 on the power: with small numbers the formula's flat terms and rounding keep it a little over half.)
    expect(thawed.dmg / plain.dmg).toBeLessThan(0.75);
  });

  it('a frozen beam user does not clash: the other beam just hits (and shatters it)', () => {
    const s = setup('Charizard', 'Blastoise', ['Dragon Pulse', 'Hydro Pump']);
    s.declare(1, act('Dragon Pulse', B));
    s.declare(2, act('Hydro Pump', A));
    const res = s.resolveTurn();
    expect(res.resolvedActions.some((a) => a.clash)).toBe(false);
    expect(s.state.p2!.currentHp).toBeLessThan(s.state.p2!.maxHp);
    expect(s.state.p2!.isFrozen).toBe(false);
  });

  it('nothing freezes under the sun; rain makes it likelier', () => {
    const tm = new TerrainManager();
    expect(freezeChance(ICE_BEAM_FREEZE_CHANCE, tm)).toBeCloseTo(ICE_BEAM_FREEZE_CHANCE);
    tm.addTerrain([0, 0], TerrainType.RAIN_ZONE, 1, 5);
    expect(freezeChance(ICE_BEAM_FREEZE_CHANCE, tm)).toBeCloseTo(ICE_BEAM_FREEZE_CHANCE * FREEZE_RAIN_MULT);
    tm.addTerrain([0, 0], TerrainType.SUNNY_ZONE, 1, 5);
    expect(freezeChance(ICE_BEAM_FREEZE_CHANCE, tm)).toBe(0);
  });

  it('round-trips through JSON', () => {
    const s = setup('Charizard', 'Blastoise', ['Swords Dance']);
    s.state.p2!.frozenTurns = 2;
    const j = s.state.p2!.toJSON();
    expect(j.status).toBe('frozen');
    expect(j.frozen_turns).toBe(2);
  });
});
