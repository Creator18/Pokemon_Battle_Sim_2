import { describe, it, expect } from 'vitest';
import { calculateDamage, getHexPower } from '../moves/damage.ts';
import { getMove } from '../data/moves.ts';
import { getSpecies } from '../data/species.ts';
import { Pokemon } from '../model/pokemon.ts';
import { TerrainManager } from '../terrain/terrainManager.ts';
import { TerrainType } from '../core/enums.ts';

function mk(name: string, playerId: number): Pokemon {
  const s = getSpecies(name)!;
  return Pokemon.fromSpecies(s, playerId, [0, 0], s.movePool.slice(0, 4));
}

describe('damage formula (hand-computed cases)', () => {
  it('Thunderbolt: Pikachu vs Charizard = 50 (x2 electric)', () => {
    const pika = mk('Pikachu', 1);
    const zard = mk('Charizard', 2);
    const tbolt = getMove('Thunderbolt')!;
    const dmg = calculateDamage(tbolt, pika, zard, { typeMult: 2.0 });
    expect(dmg).toBe(50);
  });

  it('Night Slash: Absol vs Gengar = 136 (x2 dark)', () => {
    const absol = mk('Absol', 1);
    const gengar = mk('Gengar', 2);
    const ns = getMove('Night Slash')!;
    const dmg = calculateDamage(ns, absol, gengar, { typeMult: 2.0 });
    expect(dmg).toBe(136);
  });

  it('crit multiplies base by 1.5', () => {
    const absol = mk('Absol', 1);
    const gengar = mk('Gengar', 2);
    const ns = getMove('Night Slash')!;
    const normal = calculateDamage(ns, absol, gengar, { typeMult: 1.0 });
    const crit = calculateDamage(ns, absol, gengar, { typeMult: 1.0, crit: true });
    // base (no stages) is 68; crit floor(68*1.5)=102, normal floor(68)=68
    expect(normal).toBe(68);
    expect(crit).toBe(102);
  });

  it('never deals less than 1', () => {
    const pika = mk('Pikachu', 1);
    const zard = mk('Charizard', 2);
    const tbolt = getMove('Thunderbolt')!;
    // type immunity handled elsewhere; a 0.5 mult on a tiny value floors to >=1
    const dmg = calculateDamage(tbolt, pika, zard, { typeMult: 0.001 });
    expect(dmg).toBeGreaterThanOrEqual(1);
  });
});

describe('Hex power doubling', () => {
  it('doubles base power on status terrain, else normal', () => {
    const gengar = mk('Gengar', 1);
    const defender = mk('Pikachu', 2);
    defender.tile = [1, 0];
    const hex = getMove('Hex')!;
    const tm = new TerrainManager();
    expect(getHexPower(hex, defender, tm)).toBe(65);
    tm.addTerrain([1, 0], TerrainType.BURN_ZONE, 1, 4);
    expect(getHexPower(hex, defender, tm)).toBe(130);
  });
});
