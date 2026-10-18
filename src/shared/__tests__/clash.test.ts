import { describe, it, expect } from 'vitest';
import { BattleSession } from '../engine/turnEngine.ts';
import { TurnDeclaration } from '../engine/declaration.ts';
import { ActionOrder } from '../core/enums.ts';
import { HEX_GRID, keyToTile, Tile } from '../core/hex.ts';
import { chargeMultiplier } from '../moves/damage.ts';
import { resolveClash, beamOutput } from '../moves/clash.ts';
import { getMove } from '../data/moves.ts';

const A: Tile = [-2, 3], B: Tile = [1, 3]; // three tiles apart on an open row

/** A battle between two Pokémon on an open row (no rocks or trees), each with `moves`. */
function setup(p1: string, p2: string, moves: string[]): BattleSession {
  const s = BattleSession.create(777, 'clash');
  s.selectPokemon(1, p1);
  s.selectMoves(1, moves);
  s.selectPokemon(2, p2);
  s.selectMoves(2, moves);
  s.startBattle();
  for (const k of HEX_GRID) s.state.terrain.removeTerrain(keyToTile(k));
  s.state.p1!.moveTo(A);
  s.state.p2!.moveTo(B);
  return s;
}
const fire = (move: string, at: Tile, path: Tile[] = []) => new TurnDeclaration(move, ActionOrder.ATTACK_FIRST, at, path);

describe('Ranged charge', () => {
  it('adds 10% a tile of unused movement, capped at ×1.5', () => {
    expect(chargeMultiplier(0)).toBe(1);
    expect(chargeMultiplier(3)).toBeCloseTo(1.3);
    expect(chargeMultiplier(9)).toBe(1.5);
  });

  it('a ranged special move that stays put hits harder than one that moved', () => {
    const still = setup('Charizard', 'Blastoise', ['Dragon Pulse', 'Swords Dance']);
    still.declare(1, fire('Dragon Pulse', B));
    still.declare(2, new TurnDeclaration('Swords Dance', ActionOrder.ATTACK_FIRST, null, []));
    const hp0 = still.state.p2!.currentHp;
    still.resolveTurn();
    const dStill = hp0 - still.state.p2!.currentHp;

    const moved = setup('Charizard', 'Blastoise', ['Dragon Pulse', 'Swords Dance']);
    moved.declare(1, new TurnDeclaration('Dragon Pulse', ActionOrder.MOVE_FIRST, B, [A, [-1, 3]]));
    moved.declare(2, new TurnDeclaration('Swords Dance', ActionOrder.ATTACK_FIRST, null, []));
    moved.resolveTurn();
    const dMoved = hp0 - moved.state.p2!.currentHp;
    expect(dStill).toBeGreaterThan(dMoved);
  });
});

describe('Beam clash', () => {
  it('scores output from base power, charge and beam-vs-beam type', () => {
    const ice = getMove('Ice Beam')!, dragon = getMove('Dragon Pulse')!;
    expect(beamOutput(ice, 1.2, dragon)).toBeCloseTo(90 * 1.2 * 2); // Ice is super effective on Dragon
    const o = resolveClash({ playerId: 1, move: ice, charge: 1 }, { playerId: 2, move: dragon, charge: 1 });
    expect(o.winner).toBe(1);
    expect(o.margin).toBeCloseTo((180 - 85) / 180);
  });

  it('a tie disperses both beams: nobody is hit', () => {
    const s = setup('Charizard', 'Charizard', ['Dragon Pulse', 'Ice Beam']);
    s.declare(1, fire('Dragon Pulse', B));
    s.declare(2, fire('Dragon Pulse', A));
    const res = s.resolveTurn();
    const attacks = res.resolvedActions.filter((a) => a.clash);
    expect(attacks.length).toBe(2);
    expect(attacks[0].clash!.winner).toBeNull();
    expect(s.state.p1!.currentHp).toBe(s.state.p1!.maxHp);
    expect(s.state.p2!.currentHp).toBe(s.state.p2!.maxHp);
    expect(res.log.some((l) => l.includes('BEAM CLASH'))).toBe(true);
  });

  it('the stronger beam wins and hits, scaled by its margin; the loser lands nothing', () => {
    const s = setup('Charizard', 'Charizard', ['Dragon Pulse', 'Ice Beam']);
    s.declare(1, fire('Ice Beam', B));
    s.declare(2, fire('Dragon Pulse', A));
    const res = s.resolveTurn();
    const [first, second] = res.resolvedActions.filter((a) => a.clash);
    expect(first.clash!.winner).toBe(1);
    expect(s.state.p1!.currentHp).toBe(s.state.p1!.maxHp);
    expect(s.state.p2!.currentHp).toBeLessThan(s.state.p2!.maxHp);
    const win = [first, second].find((a) => a.playerId === 1)!;
    expect(win.result!.clashMult).toBeCloseTo(first.clash!.margin);
    expect(win.result!.clashMult).toBeLessThan(1);
    // Both are spent.
    expect(s.state.p1!.cooldowns['Ice Beam']).toBeGreaterThan(0);
    expect(s.state.p2!.cooldowns['Dragon Pulse']).toBeGreaterThan(0);
  });

  it('no clash unless both beams are aimed at each other', () => {
    const s = setup('Charizard', 'Charizard', ['Dragon Pulse', 'Ice Beam', 'Swords Dance']);
    s.declare(1, fire('Ice Beam', B));
    s.declare(2, new TurnDeclaration('Swords Dance', ActionOrder.ATTACK_FIRST, null, []));
    const res = s.resolveTurn();
    expect(res.resolvedActions.some((a) => a.clash)).toBe(false);
    expect(s.state.p2!.currentHp).toBeLessThan(s.state.p2!.maxHp);
  });
});

describe('Steel Beam', () => {
  it('costs its user half its max HP when fired, even when it loses a clash', () => {
    const s = setup('Charizard', 'Charizard', ['Steel Beam', 'Ice Beam', 'Swords Dance']);
    s.declare(1, fire('Steel Beam', B));
    s.declare(2, new TurnDeclaration('Swords Dance', ActionOrder.ATTACK_FIRST, null, []));
    s.resolveTurn();
    const p1 = s.state.p1!;
    expect(p1.currentHp).toBe(p1.maxHp - Math.floor(p1.maxHp * 0.5));

    // Steel is resisted by Water: 140 × 0.5 = 70 against Hydro Pump's 110 — it loses, and still pays.
    const c = setup('Charizard', 'Charizard', ['Steel Beam', 'Hydro Pump']);
    c.declare(1, fire('Steel Beam', B));
    c.declare(2, fire('Hydro Pump', A));
    const res = c.resolveTurn();
    expect(res.resolvedActions.find((a) => a.clash)!.clash!.winner).toBe(2);
    const q1 = c.state.p1!;
    // Its cost, and Hydro Pump's hit on top.
    expect(q1.maxHp - q1.currentHp).toBeGreaterThan(Math.floor(q1.maxHp * 0.5));
  });
});

describe('Dragon Rage', () => {
  it('always deals exactly 40 HP', () => {
    const s = setup('Charizard', 'Blastoise', ['Dragon Rage', 'Swords Dance']);
    s.declare(1, fire('Dragon Rage', B));
    s.declare(2, new TurnDeclaration('Swords Dance', ActionOrder.ATTACK_FIRST, null, []));
    s.resolveTurn();
    expect(s.state.p2!.maxHp - s.state.p2!.currentHp).toBe(40);
  });
});
