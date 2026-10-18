import { describe, it, expect } from 'vitest';
import { executeMove } from '../moves/execute.ts';
import { quakeZone, quakeLanding, QUAKE_RINGS } from '../moves/quake.ts';
import { getMove } from '../data/moves.ts';
import { getSpecies } from '../data/species.ts';
import { Pokemon } from '../model/pokemon.ts';
import { TerrainManager } from '../terrain/terrainManager.ts';
import { TerrainType } from '../core/enums.ts';
import { tileKey, hexDistance, getReachableTiles, isValidPath, Tile } from '../core/hex.ts';
import { TILTED_DURATION } from '../core/constants.ts';

function mk(name: string, playerId: number, tile: [number, number]): Pokemon {
  const s = getSpecies(name)!;
  return Pokemon.fromSpecies(s, playerId, tile, s.movePool.slice(0, 4));
}
const noCritRng = () => 0.99;
const quake = getMove('Earthquake')!;

describe('Earthquake', () => {
  it('heaves rings 1 and 2 round its user, not its own tile', () => {
    const zone = quakeZone([[0, 0]]);
    expect(zone.size).toBe(6 + 12);
    expect(zone.has('0,0')).toBe(false);
    for (const k of zone) {
      const [q, r] = k.split(',').map(Number);
      const d = hexDistance(0, 0, q, r);
      expect(d >= 1 && d <= QUAKE_RINGS).toBe(true);
    }
  });

  it('hits a Pokémon in the zone and throws it to the first free tile just outside', () => {
    const user = mk('Marowak', 1, [0, 0]);
    const foe = mk('Blastoise', 2, [2, 0]);
    const tm = new TerrainManager();
    const res = executeMove(quake, user, foe, tm, noCritRng, { targetTile: null, straightTiles: 0 });
    expect(res.hit).toBe(true);
    expect(res.damageDealt).toBeGreaterThan(0);
    expect(foe.isAlive).toBe(true);
    expect(res.knockback).not.toBeNull();
    // Straight out: from (2,0) to (3,0), one ring past the zone.
    expect(res.knockback!.from).toEqual([2, 0]);
    expect(res.knockback!.to).toEqual([3, 0]);
    expect(foe.tile).toEqual([3, 0]);
  });

  it('leaves the zone tilted toward its centre, for 3 turns of rough ground', () => {
    const user = mk('Marowak', 1, [-1, 0]);
    const foe = mk('Pikachu', 2, [3, 0]);
    const tm = new TerrainManager();
    const res = executeMove(quake, user, foe, tm, noCritRng, { targetTile: null, straightTiles: 0 });
    expect(res.hit).toBe(false); // out of reach
    expect(res.terrainPlaced.length).toBe(quakeZone([[-1, 0]]).size);
    const t = tm.getTerrain([0, 0])!;
    expect(t.terrainType).toBe(TerrainType.TILTED);
    expect(t.origin).toEqual([-1, 0]);
    expect(t.turnsLeft).toBe(TILTED_DURATION);
    expect(tm.getStepCost([0, 0])).toBe(2);
    // Survives the JSON round trip, origin and all.
    const back = TerrainManager.fromJSON(tm.toJSON()).getTerrain([0, 0])!;
    expect(back.origin).toEqual([-1, 0]);
    // Ticked at the quake's turn end, then gone after 3 more turns.
    for (let i = 0; i < TILTED_DURATION - 1; i++) tm.tickAll();
    expect(tm.getTerrain([0, 0])?.terrainType).toBe(TerrainType.TILTED);
    tm.tickAll();
    expect(tm.getTerrain([0, 0])).toBeUndefined();
  });

  it('fells the trees in its zone, and tilts their tiles', () => {
    const user = mk('Marowak', 1, [0, 0]);
    const foe = mk('Pikachu', 2, [4, 0]);
    const tm = new TerrainManager();
    tm.addTerrain([1, 0], TerrainType.TREE, 0, 9999, 2);
    tm.addTerrain([3, 0], TerrainType.TREE, 0, 9999, 2); // out of reach
    const res = executeMove(quake, user, foe, tm, noCritRng, { targetTile: null, straightTiles: 0 });
    expect(res.terrainDestroyed).toContainEqual([[1, 0], TerrainType.TREE]);
    expect(tm.getTerrain([1, 0])!.terrainType).toBe(TerrainType.TILTED);
    expect(tm.getTerrain([3, 0])!.terrainType).toBe(TerrainType.TREE);
  });

  it('does not tilt a tile something still stands on (a barrier survives a hit)', () => {
    const user = mk('Marowak', 1, [0, 0]);
    const foe = mk('Pikachu', 2, [4, 0]);
    const tm = new TerrainManager();
    tm.addTerrain([1, 0], TerrainType.BARRIER, 0, 6, 3);
    executeMove(quake, user, foe, tm, noCritRng, { targetTile: null, straightTiles: 0 });
    expect(tm.getTerrain([1, 0])!.terrainType).toBe(TerrainType.BARRIER);
    expect(tm.getTerrain([0, 1])!.terrainType).toBe(TerrainType.TILTED);
  });

  it('breaks the rocks in its zone, and tilts their tiles', () => {
    const user = mk('Marowak', 1, [-2, 0]);
    const foe = mk('Pikachu', 2, [4, 0]);
    const tm = new TerrainManager();
    tm.addTerrain([0, 0], TerrainType.ROCK, 0, 9999, 9999); // ring 2
    tm.addTerrain([1, 0], TerrainType.ROCK, 0, 9999, 9999); // ring 3: out of reach
    const res = executeMove(quake, user, foe, tm, noCritRng, { targetTile: null, straightTiles: 0 });
    expect(res.terrainDestroyed).toContainEqual([[0, 0], TerrainType.ROCK]);
    expect(tm.getTerrain([0, 0])!.terrainType).toBe(TerrainType.TILTED);
    expect(tm.getTerrain([1, 0])!.terrainType).toBe(TerrainType.ROCK);
  });

  it('a Flying type is immune: no hit, no throw, but the ground still tilts', () => {
    const user = mk('Marowak', 1, [0, 0]);
    const foe = mk('Charizard', 2, [1, 0]);
    const tm = new TerrainManager();
    const res = executeMove(quake, user, foe, tm, noCritRng, { targetTile: null, straightTiles: 0 });
    expect(res.hit).toBe(false);
    expect(res.knockback).toBeNull();
    expect(foe.tile).toEqual([1, 0]);
    expect(tm.getTerrain([0, 1])!.terrainType).toBe(TerrainType.TILTED);
  });

  it('lands round a blocked tile, never inside the zone', () => {
    const blocked = new Set([tileKey(3, 0)]);
    const to = quakeLanding({ tile: [2, 0], huge: false }, [[0, 0]], blocked, new Set())!;
    expect(hexDistance(0, 0, to[0], to[1])).toBe(QUAKE_RINGS + 1);
    expect(hexDistance(2, 0, to[0], to[1])).toBe(1);
    expect(tileKey(to[0], to[1])).not.toBe('3,0');
  });

  it('a huge Pokémon lands with its whole footprint outside', () => {
    const to = quakeLanding({ tile: [1, 0], huge: true }, [[0, 0]], new Set(), new Set())!;
    const feet: Tile[] = [to, [to[0] + 1, to[1]], [to[0], to[1] + 1]];
    for (const f of feet) expect(hexDistance(0, 0, f[0], f[1])).toBeGreaterThan(QUAKE_RINGS);
  });
});

describe('Rough ground costs more to cross', () => {
  it('reachability and path checks count step cost', () => {
    const cost = (k: string) => (k === '1,0' ? 2 : 1);
    const reach = getReachableTiles(0, 0, 2, new Set(), new Set(), undefined, cost);
    expect(reach.has('1,0')).toBe(true);
    expect(reach.has('2,0')).toBe(false); // through it costs 3, round it 3 steps
    const straight: Tile[] = [[0, 0], [1, 0], [2, 0]];
    expect(isValidPath(straight, new Set(), new Set(), 2, undefined, cost).ok).toBe(false);
    expect(isValidPath(straight, new Set(), new Set(), 3, undefined, cost).ok).toBe(true);
    // Without costs, the old hop count.
    expect(isValidPath(straight, new Set(), new Set(), 2).ok).toBe(true);
    expect(getReachableTiles(0, 0, 2, new Set(), new Set()).has('2,0')).toBe(true);
  });

  it('a fainted Pokémon is not thrown', () => {
    const user = mk('Marowak', 1, [0, 0]);
    const foe = mk('Pikachu', 2, [2, 0]);
    foe.takeDamage(foe.currentHp - 1);
    const res = executeMove(quake, user, foe, new TerrainManager(), noCritRng, { targetTile: null, straightTiles: 0 });
    expect(res.hit).toBe(true);
    expect(foe.isAlive).toBe(false);
    expect(res.knockback).toBeNull();
  });
});
