import { describe, it, expect } from 'vitest';
import { BattleSession } from '../engine/turnEngine.ts';
import { TurnDeclaration } from '../engine/declaration.ts';
import { ActionOrder, TerrainType } from '../core/enums.ts';
import { HEX_GRID, keyToTile, tileKey, hexLineTiles, Tile } from '../core/hex.ts';
import { isGrassTile } from '../terrain/grass.ts';
import { serializeState, deserializeState } from '../engine/battleState.ts';
import { GRASS_FIRE_DURATION } from '../core/constants.ts';

/** A clear board (no map terrain), Charizard and a target on a row. */
function setup(a: Tile, b: Tile): BattleSession {
  const s = BattleSession.create(4242, 'fire');
  s.selectPokemon(1, 'Charizard');
  s.selectMoves(1, ['Flamethrower', 'Sunny Day', 'Swords Dance']);
  s.selectPokemon(2, 'Blastoise');
  s.selectMoves(2, ['Swords Dance', 'Sunny Day']);
  s.startBattle();
  for (const k of HEX_GRID) s.state.terrain.removeTerrain(keyToTile(k));
  s.state.p1!.moveTo(a);
  s.state.p2!.moveTo(b);
  return s;
}
const wait = (s: BattleSession, pid: number, move = 'Swords Dance') =>
  s.declare(pid, new TurnDeclaration(move, ActionOrder.ATTACK_FIRST, null, []));

describe('Grass fires', () => {
  const A: Tile = [-3, 3], B: Tile = [1, 3];
  const line = hexLineTiles(A[0], A[1], B[0], B[1]).slice(1);

  it('Flamethrower lights every grass tile on its line (not its own), scorching it', () => {
    const s = setup(A, B);
    s.declare(1, new TurnDeclaration('Flamethrower', ActionOrder.ATTACK_FIRST, B, []));
    wait(s, 2);
    s.resolveTurn();
    for (const t of line) {
      const e = s.state.terrain.getTerrain(t);
      if (isGrassTile(t[0], t[1])) {
        expect(e?.terrainType).toBe(TerrainType.BURN_ZONE);
        expect(e?.grassFire).toBe(true);
        expect(s.state.terrain.isScorched(t)).toBe(true);
      } else {
        expect(e).toBeUndefined();
      }
    }
    expect(s.state.terrain.isScorched(A)).toBe(false);
    // Scorched ground survives the state's JSON round trip.
    const back = deserializeState(JSON.parse(JSON.stringify(serializeState(s.state))));
    for (const t of line) expect(back.terrain.isScorched(t)).toBe(isGrassTile(t[0], t[1]));
  });

  it('burns for 2 turns; a third if Sunny Day is up', () => {
    const grass = line.filter((t) => isGrassTile(t[0], t[1]));
    expect(grass.length).toBeGreaterThan(0);
    const g = grass[0];
    expect(GRASS_FIRE_DURATION).toBe(3);

    const plain = setup(A, B);
    plain.declare(1, new TurnDeclaration('Flamethrower', ActionOrder.ATTACK_FIRST, B, []));
    wait(plain, 2);
    plain.resolveTurn(); // lit
    for (let turn = 1; turn <= 2; turn++) {
      expect(plain.state.terrain.getTerrain(g)?.terrainType).toBe(TerrainType.BURN_ZONE);
      wait(plain, 1); wait(plain, 2); plain.resolveTurn();
    }
    expect(plain.state.terrain.getTerrain(g)).toBeUndefined();
    expect(plain.state.terrain.isScorched(g)).toBe(true); // the grass stays gone

    const sunny = setup(A, B);
    sunny.declare(1, new TurnDeclaration('Flamethrower', ActionOrder.ATTACK_FIRST, B, []));
    sunny.declare(2, new TurnDeclaration('Sunny Day', ActionOrder.ATTACK_FIRST, null, []));
    sunny.resolveTurn(); // lit, the sun out
    for (let turn = 1; turn <= 3; turn++) {
      expect(sunny.state.terrain.getTerrain(g)?.terrainType).toBe(TerrainType.BURN_ZONE);
      wait(sunny, 1); wait(sunny, 2); sunny.resolveTurn();
    }
    expect(sunny.state.terrain.getTerrain(g)).toBeUndefined();
  });

  it('only one grass tint of five is earth', () => {
    const earth = [...HEX_GRID].filter((k) => { const [q, r] = keyToTile(k); return !isGrassTile(q, r); });
    expect(earth.length).toBeGreaterThan(0);
    expect(earth.length).toBeLessThan(HEX_GRID.size / 2);
    void tileKey;
  });
});

describe('Grass fires in a beam clash', () => {
  const A: Tile = [-3, 3], B: Tile = [1, 3]; // four apart: the middle tile is (-1,3)
  const line = hexLineTiles(A[0], A[1], B[0], B[1]);
  const grassBetween = line.slice(1, -1).filter((t) => isGrassTile(t[0], t[1]));

  function clash(p1Move: string, p2Move: string, p2Moves = [p2Move]): BattleSession {
    const s = BattleSession.create(4242, 'clashfire');
    s.selectPokemon(1, 'Charizard'); s.selectMoves(1, [p1Move]);
    s.selectPokemon(2, 'Charizard'); s.selectMoves(2, p2Moves);
    s.startBattle();
    for (const k of HEX_GRID) s.state.terrain.removeTerrain(keyToTile(k));
    s.state.p1!.moveTo(A); s.state.p2!.moveTo(B);
    s.declare(1, new TurnDeclaration(p1Move, ActionOrder.ATTACK_FIRST, B, []));
    s.declare(2, new TurnDeclaration(p2Move, ActionOrder.ATTACK_FIRST, A, []));
    return s;
  }

  it('a tie: each side burns its half, in its own fire, the line marked split', () => {
    const s = clash('Flamethrower', 'Flamethrower');
    const res = s.resolveTurn();
    expect(res.resolvedActions.find((x) => x.clash)!.clash!.winner).toBeNull();
    for (const t of grassBetween) {
      const e = s.state.terrain.getTerrain(t)!;
      expect(e.grassFire).toBe(true);
      // Oriented from whichever side fired first; either way each side's own fire is on its side.
      const sp = e.split!;
      const ownerAt = (tile: Tile) => (tile[0] === A[0] && tile[1] === A[1] ? 1 : 2);
      expect(sp.oa).toBe(ownerAt(sp.a));
      expect(sp.ob).toBe(ownerAt(sp.b));
      const i = line.findIndex((x) => x[0] === t[0] && x[1] === t[1]);
      if (i < 2) expect(e.owner).toBe(1);
      if (i > 2) expect(e.owner).toBe(2);
    }
    // Neither user's tile burns (neither beam got through).
    expect(s.state.terrain.getTerrain(A)).toBeUndefined();
    expect(s.state.terrain.getTerrain(B)).toBeUndefined();
  });

  it("a Flamethrower that loses a clash is put out: its grass is left unburnt", () => {
    // Flamethrower vs Hydro Pump: Water wins (×2 against Fire's ×0.5).
    const w = clash('Flamethrower', 'Hydro Pump');
    expect(w.resolveTurn().resolvedActions.find((x) => x.clash)!.clash!.winner).toBe(2);
    for (const t of line) {
      expect(w.state.terrain.getTerrain(t)).toBeUndefined();
      expect(w.state.terrain.isScorched(t)).toBe(false);
    }
  });

  it("a fire winning a clash burns on over the loser's half, recolouring its fires", () => {
    // Two Flamethrowers, both standing still: the faster Charizard has more movement left
    // unused than the slower Emboar, so the bigger charge, and wins.
    const s = BattleSession.create(4242, 'clashfire2');
    s.selectPokemon(1, 'Charizard'); s.selectMoves(1, ['Flamethrower']);
    s.selectPokemon(2, 'Emboar'); s.selectMoves(2, ['Flamethrower']);
    s.startBattle();
    for (const k of HEX_GRID) s.state.terrain.removeTerrain(keyToTile(k));
    s.state.p1!.moveTo(A); s.state.p2!.moveTo(B);
    expect(s.state.p1!.effectiveMoveRange).toBeGreaterThan(s.state.p2!.effectiveMoveRange);
    s.declare(1, new TurnDeclaration('Flamethrower', ActionOrder.ATTACK_FIRST, B, []));
    s.declare(2, new TurnDeclaration('Flamethrower', ActionOrder.ATTACK_FIRST, A, []));
    const res = s.resolveTurn();
    const c = res.resolvedActions.find((x) => x.clash)!.clash!;
    expect(c.winner).toBe(1); // P1 kept its movement: charged
    for (const t of line.slice(1)) {
      if (!isGrassTile(t[0], t[1])) continue;
      const e = s.state.terrain.getTerrain(t)!;
      expect(e.owner).toBe(1);
      expect(e.split).toBeNull();
    }
  });
});

