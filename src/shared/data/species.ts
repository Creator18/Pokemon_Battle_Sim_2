/** Loads pokemon.json into typed SpeciesDefinition[]. Uses inflated_hp as max HP. */

import pokemonData from './raw/pokemon.json' with { type: 'json' };

export interface SpeciesDefinition {
  readonly name: string;
  readonly types: readonly string[];
  readonly hp: number;
  readonly inflatedHp: number;
  readonly attack: number;
  readonly defense: number;
  readonly spAtk: number;
  readonly spDef: number;
  readonly speed: number;
  readonly level: number;
  readonly canPassThrough: boolean;
  readonly spriteId: number;
  readonly description: string;
  readonly compatibleTerrain: readonly string[];
  readonly compatibleStatus: readonly string[];
  readonly compatibleRanged: readonly string[];
  readonly compatiblePhysical: readonly string[];
  /** The full 8-move pool (terrain + status + ranged + physical). */
  readonly movePool: readonly string[];
}

interface RawSpecies {
  name: string;
  types: string[];
  hp: number;
  inflated_hp: number;
  attack: number;
  defense: number;
  sp_atk: number;
  sp_def: number;
  speed: number;
  level: number;
  can_pass_through: boolean;
  sprite_id: number;
  description: string;
  compatible_terrain: string[];
  compatible_status: string[];
  compatible_ranged: string[];
  compatible_physical: string[];
}

function build(r: RawSpecies): SpeciesDefinition {
  return {
    name: r.name,
    types: r.types,
    hp: r.hp,
    inflatedHp: r.inflated_hp,
    attack: r.attack,
    defense: r.defense,
    spAtk: r.sp_atk,
    spDef: r.sp_def,
    speed: r.speed,
    level: r.level,
    canPassThrough: r.can_pass_through,
    spriteId: r.sprite_id,
    description: r.description,
    compatibleTerrain: r.compatible_terrain,
    compatibleStatus: r.compatible_status,
    compatibleRanged: r.compatible_ranged,
    compatiblePhysical: r.compatible_physical,
    movePool: [
      ...r.compatible_terrain,
      ...r.compatible_status,
      ...r.compatible_ranged,
      ...r.compatible_physical,
    ],
  };
}

const raw = (pokemonData as { pokemon: RawSpecies[] }).pokemon;

export const SPECIES_LIST: readonly SpeciesDefinition[] = raw.map(build);

const BY_NAME = new Map<string, SpeciesDefinition>();
for (const s of SPECIES_LIST) BY_NAME.set(s.name, s);

export function getSpecies(name: string): SpeciesDefinition | undefined {
  return BY_NAME.get(name);
}

/** Static type table, keyed by species name (matches POKEMON_TYPES in source). */
export const POKEMON_TYPES: ReadonlyMap<string, readonly string[]> = (() => {
  const m = new Map<string, readonly string[]>();
  for (const s of SPECIES_LIST) m.set(s.name, s.types);
  return m;
})();
