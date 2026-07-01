import { describe, it, expect } from 'vitest';
import { executeMove } from '../moves/execute.ts';
import { getMove } from '../data/moves.ts';
import { getSpecies } from '../data/species.ts';
import { Pokemon } from '../model/pokemon.ts';
import { TerrainManager } from '../terrain/terrainManager.ts';
import { TurnDeclaration } from '../engine/declaration.ts';
import { ActionOrder } from '../core/enums.ts';

function mk(name: string, playerId: number, tile: [number, number]): Pokemon {
  const s = getSpecies(name)!;
  return Pokemon.fromSpecies(s, playerId, tile, s.movePool.slice(0, 4));
}

const noCritRng = () => 0.99; // above every crit / secondary-effect threshold

describe('Sucker Punch conditional', () => {
  it('fails if defender did not declare an attack', () => {
    const absol = mk('Absol', 1, [0, 0]);
    const gengar = mk('Gengar', 2, [1, 0]);
    const sp = getMove('Sucker Punch')!;
    // defender declared a terrain move
    gengar.declaration = new TurnDeclaration('Toxic Spikes', ActionOrder.MOVE_FIRST, [0, 0], []);
    const tm = new TerrainManager();
    const res = executeMove(sp, absol, gengar, tm, noCritRng, {
      targetTile: [1, 0],
      straightTiles: 0,
      defenderDeclaration: gengar.declaration,
    });
    expect(res.suckerPunchFailed).toBe(true);
    expect(res.hit).toBe(false);
  });

  it('succeeds if defender declared a physical/special attack', () => {
    const absol = mk('Absol', 1, [0, 0]);
    const gengar = mk('Gengar', 2, [1, 0]);
    const sp = getMove('Sucker Punch')!;
    gengar.declaration = new TurnDeclaration('Shadow Ball', ActionOrder.ATTACK_FIRST, [0, 0], []);
    const tm = new TerrainManager();
    const res = executeMove(sp, absol, gengar, tm, noCritRng, {
      targetTile: [1, 0],
      straightTiles: 0,
      defenderDeclaration: gengar.declaration,
    });
    expect(res.suckerPunchFailed).toBe(false);
    expect(res.hit).toBe(true);
    expect(res.damageDealt).toBeGreaterThan(0);
  });
});

describe('type immunity', () => {
  it('Normal (Quick Attack) has no effect on Ghost', () => {
    const pika = mk('Pikachu', 1, [0, 0]);
    const gengar = mk('Gengar', 2, [1, 0]);
    const qa = getMove('Quick Attack')!;
    const tm = new TerrainManager();
    const res = executeMove(qa, pika, gengar, tm, noCritRng, {
      targetTile: [1, 0],
      straightTiles: 0,
      actionOrder: ActionOrder.ATTACK_FIRST,
    });
    expect(res.typeMult).toBe(0);
    expect(res.hit).toBe(false);
    expect(res.missReason).toContain('immunity');
  });
});
