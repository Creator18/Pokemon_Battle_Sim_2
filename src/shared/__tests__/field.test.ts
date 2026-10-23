import { describe, it, expect } from 'vitest';
import { BattleSession } from '../engine/turnEngine.ts';
import { TurnDeclaration } from '../engine/declaration.ts';
import { ActionOrder, TerrainType } from '../core/enums.ts';
import { HEX_GRID, keyToTile, Tile } from '../core/hex.ts';
import { TerrainManager } from '../terrain/terrainManager.ts';
import { getMove } from '../data/moves.ts';
import { effectiveMoveType, getWeatherMult } from '../moves/damage.ts';
import { resolveClash } from '../moves/clash.ts';
import { FIELD_DURATION, TERRAIN_BOOST, WEATHER_CHIP_FRACTION, GRASSY_HEAL_FRACTION } from '../core/constants.ts';
import type { Pokemon } from '../model/pokemon.ts';

const A: Tile = [-2, 3], B: Tile = [1, 3];

/** Two Pokémon on an open row, with `field` (a weather or terrain) up. */
function setup(p1: string, m1: string[], p2: string, m2: string[], field?: TerrainType): BattleSession {
  const s = BattleSession.create(777, 'field');
  s.selectPokemon(1, p1);
  s.selectMoves(1, m1);
  s.selectPokemon(2, p2);
  s.selectMoves(2, m2);
  s.startBattle();
  for (const k of HEX_GRID) s.state.terrain.removeTerrain(keyToTile(k));
  if (field) s.state.terrain.addTerrain([0, 0], field, 1, FIELD_DURATION);
  s.state.p1!.moveTo(A);
  s.state.p2!.moveTo(B);
  return s;
}
const act = (move: string, at: Tile | null, order = ActionOrder.ATTACK_FIRST) => new TurnDeclaration(move, order, at, []);
const idle = () => act('Swords Dance', null);
const like = (types: string[]) => ({ types, tile: [0, 0] as Tile }) as unknown as Pokemon;

describe('Weather and terrains', () => {
  it('one weather and one terrain at a time, each for 5 turns', () => {
    const tm = new TerrainManager();
    tm.addTerrain([0, 0], TerrainType.SUNNY_ZONE, 1, FIELD_DURATION);
    tm.addTerrain([0, 0], TerrainType.SANDSTORM, 1, FIELD_DURATION);
    expect(tm.isSunny()).toBe(false);
    expect(tm.isSandstorm()).toBe(true);
    tm.addTerrain([0, 0], TerrainType.ELECTRIC_TERRAIN, 1, FIELD_DURATION);
    tm.addTerrain([0, 0], TerrainType.PSYCHIC_TERRAIN, 1, FIELD_DURATION);
    expect(tm.fieldTerrain()).toBe(TerrainType.PSYCHIC_TERRAIN);
    expect(tm.isSandstorm()).toBe(true); // a terrain leaves the weather be
    for (let t = 0; t < FIELD_DURATION; t++) tm.tickAll();
    expect(tm.fieldTerrain()).toBeNull();
    expect(tm.isSandstorm()).toBe(false);
  });

  it('a terrain boosts its own type from a grounded user only', () => {
    const tm = new TerrainManager();
    tm.addTerrain([0, 0], TerrainType.ELECTRIC_TERRAIN, 1, FIELD_DURATION);
    const tb = getMove('Thunderbolt')!;
    expect(getWeatherMult(tb, tm, like(['Electric']))).toBeCloseTo(TERRAIN_BOOST);
    expect(getWeatherMult(tb, tm, like(['Electric', 'Flying']))).toBe(1);
  });

  it('Misty Terrain halves Dragon moves on a grounded target; Grassy Terrain, Earthquake', () => {
    const tm = new TerrainManager();
    tm.addTerrain([0, 0], TerrainType.MISTY_TERRAIN, 1, FIELD_DURATION);
    expect(getWeatherMult(getMove('Dragon Pulse')!, tm, like(['Dragon']), like(['Normal']))).toBeCloseTo(0.5);
    expect(getWeatherMult(getMove('Dragon Pulse')!, tm, like(['Dragon']), like(['Flying']))).toBe(1);
    tm.addTerrain([0, 0], TerrainType.GRASSY_TERRAIN, 1, FIELD_DURATION);
    expect(getWeatherMult(getMove('Earthquake')!, tm, like(['Ground']), like(['Normal']))).toBeCloseTo(0.5);
  });

  it('Misty and Electric Terrain keep a grounded Pokémon awake; not a Flying one', () => {
    for (const field of [TerrainType.MISTY_TERRAIN, TerrainType.ELECTRIC_TERRAIN]) {
      const s = setup('Gardevoir', ['Hypnosis', 'Calm Mind'], 'Pikachu', ['Swords Dance'], field);
      s.declare(1, act('Hypnosis', B));
      s.declare(2, idle());
      expect(s.resolveTurn().log.some((l) => l.includes("won't fall asleep"))).toBe(true);
    }
    const s = setup('Gardevoir', ['Hypnosis', 'Calm Mind'], 'Charizard', ['Swords Dance'], TerrainType.MISTY_TERRAIN);
    s.declare(1, act('Hypnosis', B));
    s.declare(2, idle());
    expect(s.resolveTurn().log.some((l) => l.includes('fell asleep'))).toBe(true);
  });

  it('Psychic Terrain: a priority move cannot touch a grounded target', () => {
    const s = setup('Pikachu', ['Quick Attack', 'Swords Dance'], 'Gardevoir', ['Calm Mind'], TerrainType.PSYCHIC_TERRAIN);
    s.declare(1, act('Quick Attack', B));
    s.declare(2, act('Calm Mind', null));
    s.resolveTurn();
    expect(s.state.p2!.currentHp).toBe(s.state.p2!.maxHp);
  });

  it('Grassy Terrain heals the grounded at the turn\'s end; hail and sandstorm chip', () => {
    const s = setup('Pikachu', ['Swords Dance'], 'Charizard', ['Swords Dance'], TerrainType.GRASSY_TERRAIN);
    const pk = s.state.p1!, cz = s.state.p2!;
    pk.currentHp = pk.maxHp - 50; cz.currentHp = cz.maxHp - 50;
    s.declare(1, idle()); s.declare(2, idle());
    s.resolveTurn();
    expect(pk.currentHp).toBe(pk.maxHp - 50 + Math.trunc(pk.maxHp * GRASSY_HEAL_FRACTION));
    expect(cz.currentHp).toBe(cz.maxHp - 50); // flying: not on the ground

    const h = setup('Pikachu', ['Swords Dance'], 'Glaceon', ['Swords Dance'], TerrainType.HAIL);
    h.declare(1, idle()); h.declare(2, idle());
    h.resolveTurn();
    expect(h.state.p1!.currentHp).toBe(h.state.p1!.maxHp - Math.trunc(h.state.p1!.maxHp * WEATHER_CHIP_FRACTION));
    expect(h.state.p2!.currentHp).toBe(h.state.p2!.maxHp); // Ice types are spared
  });

  it('Terrain Pulse takes the terrain\'s type, doubled — in a clash too', () => {
    const tm = new TerrainManager();
    const tp = getMove('Terrain Pulse')!;
    expect(tp.isPulse).toBe(true);
    expect(effectiveMoveType(tp, tm, like(['Normal']))).toBe('Normal');
    tm.addTerrain([0, 0], TerrainType.PSYCHIC_TERRAIN, 1, FIELD_DURATION);
    expect(effectiveMoveType(tp, tm, like(['Normal']))).toBe('Psychic');
    expect(effectiveMoveType(tp, tm, like(['Flying']))).toBe('Normal');
    const psybeam = getMove('Psybeam')!;
    const c = resolveClash(
      { playerId: 1, move: tp, charge: 1, type: 'Psychic', powerMult: 2 },
      { playerId: 2, move: psybeam, charge: 1 },
    );
    expect(c.outputs[1]).toBeCloseTo(50 * 2 * 0.5); // Psychic on Psychic: ×0.5
  });
});
