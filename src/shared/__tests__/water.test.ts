import { describe, it, expect } from 'vitest';
import { BattleSession } from '../engine/turnEngine.ts';
import { TerrainType } from '../core/enums.ts';
import { HEX_GRID, keyToTile, tileKey, hexNeighbors } from '../core/hex.ts';
import { getWeatherMult } from '../moves/damage.ts';
import { getMove } from '../data/moves.ts';
import { getSpecies } from '../data/species.ts';
import { Pokemon } from '../model/pokemon.ts';
import { TerrainManager } from '../terrain/terrainManager.ts';
import { MAP_WATER_PONDS, MAP_WATER_POND_SIZE, WATER_BOOST, WATER_FIRE_MULT, WATER_STEP_COST } from '../core/constants.ts';

function started(seed: number): BattleSession {
  const s = BattleSession.create(seed, 'water');
  s.selectPokemon(1, 'Pikachu');
  s.selectMoves(1, getSpecies('Pikachu')!.movePool.slice(0, 4));
  s.selectPokemon(2, 'Charizard');
  s.selectMoves(2, getSpecies('Charizard')!.movePool.slice(0, 4));
  s.startBattle();
  return s;
}

describe('Ponds', () => {
  it('each map has its ponds, joined tiles, clear of rocks, trees and spawns', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const s = started(seed);
      const water = [...HEX_GRID].filter((k) => s.state.terrain.getTerrain(keyToTile(k))?.terrainType === TerrainType.WATER);
      expect(water.length).toBe(MAP_WATER_PONDS * MAP_WATER_POND_SIZE);
      // Every water tile touches another (ponds, not scattered puddles).
      const set = new Set(water);
      for (const k of water) {
        const [q, r] = keyToTile(k);
        expect(hexNeighbors(q, r).some(([nq, nr]) => set.has(tileKey(nq, nr)))).toBe(true);
      }
      for (const p of [s.state.p1!, s.state.p2!]) expect(set.has(tileKey(p.tile[0], p.tile[1]))).toBe(false);
    }
  });

  it('costs WATER_STEP_COST to wade into, and outlasts the battle', () => {
    const tm = new TerrainManager();
    tm.addTerrain([1, 1], TerrainType.WATER, 0, 9999, 9999);
    expect(tm.getStepCost([1, 1])).toBe(WATER_STEP_COST);
    expect(tm.getTerrain([1, 1])!.isPermanent).toBe(true);
  });

  it('a Water move fired from a pond hits harder, a Fire move weaker', () => {
    const tm = new TerrainManager();
    tm.addTerrain([0, 1], TerrainType.WATER, 0, 9999, 9999);
    const s = getSpecies('Blastoise')!;
    const wet = Pokemon.fromSpecies(s, 1, [0, 1], s.movePool.slice(0, 4));
    const dry = Pokemon.fromSpecies(s, 1, [2, 1], s.movePool.slice(0, 4));
    const hydro = getMove('Hydro Pump')!, flame = getMove('Flamethrower')!, ice = getMove('Ice Beam')!;
    expect(getWeatherMult(hydro, tm, wet)).toBeCloseTo(WATER_BOOST);
    expect(getWeatherMult(hydro, tm, dry)).toBe(1);
    expect(getWeatherMult(flame, tm, wet)).toBeCloseTo(WATER_FIRE_MULT);
    expect(getWeatherMult(ice, tm, wet)).toBe(1);
  });
});
