import { describe, it, expect } from 'vitest';
import { BattleSession } from '../engine/turnEngine.ts';
import { TurnDeclaration } from '../engine/declaration.ts';
import { ActionOrder } from '../core/enums.ts';
import { HEX_GRID, keyToTile, Tile, hexDistance } from '../core/hex.ts';
import { isGrassTile } from '../terrain/grass.ts';

describe('Fire Spin', () => {
  it("sets the grass of the target's tile alight", () => {
    // A grass tile two or three away from a free tile to fire from.
    const tiles = [...HEX_GRID].map(keyToTile);
    const at2 = tiles.find((t) => isGrassTile(t[0], t[1]) && tiles.some((u) => hexDistance(u[0], u[1], t[0], t[1]) === 2))!;
    const at1 = tiles.find((u) => hexDistance(u[0], u[1], at2[0], at2[1]) === 2)! as Tile;
    const s = BattleSession.create(3, 'spin');
    s.selectPokemon(1, 'Charizard'); s.selectMoves(1, ['Fire Spin']);
    s.selectPokemon(2, 'Blastoise'); s.selectMoves(2, ['Hydro Pump']);
    s.startBattle();
    for (const k of HEX_GRID) s.state.terrain.removeTerrain(keyToTile(k));
    s.state.p1!.moveTo(at1);
    s.state.p2!.moveTo(at2);
    s.declare(1, new TurnDeclaration('Fire Spin', ActionOrder.ATTACK_FIRST, at2, []));
    s.declare(2, new TurnDeclaration('Hydro Pump', ActionOrder.ATTACK_FIRST, at1, []));
    const r = s.resolveTurn();
    expect(r.log.some((l) => l.includes(`The grass at ${at2[0]},${at2[1]} caught fire`))).toBe(true);
  });
});
