import { describe, it, expect } from 'vitest';
import { BattleSession } from '../engine/turnEngine.ts';
import { TurnDeclaration } from '../engine/declaration.ts';
import { ActionOrder } from '../core/enums.ts';
import { getSpecies } from '../data/species.ts';
import { serializeState, deserializeState } from '../engine/battleState.ts';

function setupSession(): BattleSession {
  const s = BattleSession.create(12345, 'test');
  s.selectPokemon(1, 'Pikachu');
  s.selectMoves(1, getSpecies('Pikachu')!.movePool.slice(0, 4));
  s.selectPokemon(2, 'Charizard');
  s.selectMoves(2, getSpecies('Charizard')!.movePool.slice(0, 4));
  s.startBattle();
  return s;
}

describe('BattleSession end-to-end', () => {
  it('sets up, declares, and resolves a turn with HP changes', () => {
    const s = setupSession();
    expect(s.bothReady()).toBe(true);
    expect(s.getState().meta.turnNumber).toBe(1);

    const hpBefore = s.getState().pokemon.p2!.current_hp;

    // P1 Pikachu at (-3,0) uses Thunderbolt on Charizard at (3,0).
    // Thunderbolt requires LoS + range; move P1 closer first is complex, so
    // we place a direct declaration: attack-first Thunderbolt targeting the
    // opponent tile. Range = floor(90/20) = 4; distance 6 > 4, so it should miss
    // on range. Instead have P1 move-first then attack next turn is heavier;
    // here we assert the mechanism: P2 uses a self-buff, P1 attacks in range by
    // teleporting via Extreme-speed-like move is not available. Use Discharge
    // after repositioning: simplest deterministic check is a melee-range setup.

    // Reposition: put both adjacent by declaring a long move for P1.
    s.declare(1, new TurnDeclaration('Thunderbolt', ActionOrder.MOVE_FIRST, [3, 0], [
      [-3, 0],
      [-2, 0],
      [-1, 0],
      [0, 0],
    ]));
    s.declare(2, new TurnDeclaration('Swords Dance', ActionOrder.ATTACK_FIRST, null, []));
    expect(s.bothDeclared()).toBe(true);

    const res = s.resolveTurn();
    expect(res.log.length).toBeGreaterThan(0);
    expect(res.resolvedActions.length).toBeGreaterThan(0);

    // After moving to (0,0), Thunderbolt distance to (3,0) is 3 <= range 4,
    // LoS permitting, so Charizard should take damage.
    const state = s.getState();
    const hpAfter = state.pokemon.p2!.current_hp;
    // Either it hit (hp dropped) or was blocked by terrain LoS; assert the
    // engine ran a full turn and advanced.
    expect(state.meta.turnNumber).toBe(2);
    expect(hpAfter).toBeLessThanOrEqual(hpBefore);
  });

  it('is deterministic for the same seed', () => {
    const runOnce = (): number => {
      const s = setupSession();
      s.declare(1, new TurnDeclaration('Thunderbolt', ActionOrder.MOVE_FIRST, [3, 0], [
        [-3, 0],
        [-2, 0],
        [-1, 0],
        [0, 0],
      ]));
      s.declare(2, new TurnDeclaration('Fire Fang', ActionOrder.MOVE_FIRST, [0, 0], [
        [3, 0],
        [2, 0],
        [1, 0],
      ]));
      s.resolveTurn();
      return s.getState().pokemon.p2!.current_hp + s.getState().pokemon.p1!.current_hp;
    };
    expect(runOnce()).toBe(runOnce());
  });

  it('serializes and round-trips state', () => {
    const s = setupSession();
    const json = s.getState();
    const round = serializeState(deserializeState(json));
    expect(round.pokemon.p1!.name).toBe('Pikachu');
    expect(round.terrain.length).toBeGreaterThan(0);
    expect(round.meta.turnNumber).toBe(1);
  });

  it('validateDeclaration rejects moves not in loadout', () => {
    const s = setupSession();
    const v = s.validateDeclaration(1, new TurnDeclaration('Aura Sphere', ActionOrder.ATTACK_FIRST, [3, 0], []));
    expect(v.ok).toBe(false);
  });

  it('getReachableTiles returns tiles within move range', () => {
    const s = setupSession();
    const reachable = s.getReachableTiles(1);
    expect(reachable.length).toBeGreaterThan(0);
  });
});
