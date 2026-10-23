/** Per-TerrainType property table. Faithful port of hex_battle.py lines ~877-1055. */

import { TerrainType } from '../core/enums.ts';
import type { StatName } from '../core/enums.ts';
import {
  DEFAULT_STEP_COST,
  MAP_ROCK_STEP_COST,
  TILTED_STEP_COST,
  TILTED_DURATION,
  WATER_STEP_COST,
  MAP_TREE_INTEGRITY,
  TERRAIN_DURATION_MINOR,
  TERRAIN_DURATION_MODERATE,
  TERRAIN_DURATION_TRAP,
  ELECTRO_WEB_SPEED_STAGES,
  RESONANCE_SPDEF_DROP,
  FIELD_DURATION,
} from '../core/constants.ts';

export interface TerrainProperties {
  readonly terrainType: TerrainType;
  readonly blocksMovement: boolean;
  readonly blocksLos: boolean;
  readonly speedModifier: number;
  readonly defaultDuration: number;
  readonly defaultIntegrity: number;
  readonly stepCost: number;
  /** Stat-stage change applied on field entry, or null. */
  readonly statEffect: Partial<Record<StatName, number>> | null;
  readonly isGlobal: boolean;
}

function props(p: Partial<TerrainProperties> & { terrainType: TerrainType }): TerrainProperties {
  return {
    blocksMovement: false,
    blocksLos: false,
    speedModifier: 1.0,
    defaultDuration: 4,
    defaultIntegrity: 1,
    stepCost: DEFAULT_STEP_COST,
    statEffect: null,
    isGlobal: false,
    ...p,
  };
}

export const TERRAIN_PROPS: Record<TerrainType, TerrainProperties> = {
  [TerrainType.SLOW_ZONE]: props({
    terrainType: TerrainType.SLOW_ZONE,
    defaultDuration: TERRAIN_DURATION_MODERATE,
    statEffect: { speed: ELECTRO_WEB_SPEED_STAGES },
  }),
  [TerrainType.BARRIER]: props({
    terrainType: TerrainType.BARRIER,
    blocksMovement: true,
    blocksLos: true,
    defaultDuration: TERRAIN_DURATION_MINOR,
    defaultIntegrity: 3,
  }),
  [TerrainType.TRAP]: props({
    terrainType: TerrainType.TRAP,
    defaultDuration: TERRAIN_DURATION_TRAP,
  }),
  [TerrainType.ROCK]: props({
    terrainType: TerrainType.ROCK,
    defaultDuration: 9999,
    defaultIntegrity: 9999,
    stepCost: MAP_ROCK_STEP_COST,
  }),
  [TerrainType.WATER]: props({
    terrainType: TerrainType.WATER,
    defaultDuration: 9999,
    defaultIntegrity: 9999,
    stepCost: WATER_STEP_COST,
  }),
  [TerrainType.TREE]: props({
    terrainType: TerrainType.TREE,
    blocksMovement: true,
    blocksLos: true,
    defaultDuration: 9999,
    defaultIntegrity: MAP_TREE_INTEGRITY,
  }),
  [TerrainType.BURN_ZONE]: props({
    terrainType: TerrainType.BURN_ZONE,
    defaultDuration: TERRAIN_DURATION_MODERATE,
  }),
  [TerrainType.MIST_ZONE]: props({
    terrainType: TerrainType.MIST_ZONE,
    defaultDuration: TERRAIN_DURATION_MINOR,
  }),
  [TerrainType.ROCK_TRAP]: props({
    terrainType: TerrainType.ROCK_TRAP,
    defaultDuration: TERRAIN_DURATION_MINOR,
  }),
  [TerrainType.POISON_TRAP]: props({
    terrainType: TerrainType.POISON_TRAP,
    defaultDuration: TERRAIN_DURATION_MODERATE,
    statEffect: { sp_def: -1 },
  }),
  [TerrainType.SUNNY_ZONE]: props({
    terrainType: TerrainType.SUNNY_ZONE,
    defaultDuration: FIELD_DURATION,
    isGlobal: true,
  }),
  [TerrainType.RAIN_ZONE]: props({
    terrainType: TerrainType.RAIN_ZONE,
    defaultDuration: FIELD_DURATION,
    isGlobal: true,
  }),
  [TerrainType.FOG_ZONE]: props({
    terrainType: TerrainType.FOG_ZONE,
    blocksLos: true,
    defaultDuration: TERRAIN_DURATION_MODERATE,
  }),
  [TerrainType.RESONANCE_ZONE]: props({
    terrainType: TerrainType.RESONANCE_ZONE,
    defaultDuration: TERRAIN_DURATION_MODERATE,
    statEffect: { sp_def: RESONANCE_SPDEF_DROP },
  }),
  [TerrainType.PERISH_ZONE]: props({
    terrainType: TerrainType.PERISH_ZONE,
    defaultDuration: TERRAIN_DURATION_MINOR,
  }),
  [TerrainType.ICE_ZONE]: props({
    terrainType: TerrainType.ICE_ZONE,
    defaultDuration: TERRAIN_DURATION_MODERATE,
  }),
  // Whole-field weather and terrains (FIELD_DURATION turns).
  [TerrainType.HAIL]: props({ terrainType: TerrainType.HAIL, defaultDuration: FIELD_DURATION, isGlobal: true }),
  [TerrainType.SANDSTORM]: props({ terrainType: TerrainType.SANDSTORM, defaultDuration: FIELD_DURATION, isGlobal: true }),
  [TerrainType.ELECTRIC_TERRAIN]: props({ terrainType: TerrainType.ELECTRIC_TERRAIN, defaultDuration: FIELD_DURATION, isGlobal: true }),
  [TerrainType.GRASSY_TERRAIN]: props({ terrainType: TerrainType.GRASSY_TERRAIN, defaultDuration: FIELD_DURATION, isGlobal: true }),
  [TerrainType.MISTY_TERRAIN]: props({ terrainType: TerrainType.MISTY_TERRAIN, defaultDuration: FIELD_DURATION, isGlobal: true }),
  [TerrainType.PSYCHIC_TERRAIN]: props({ terrainType: TerrainType.PSYCHIC_TERRAIN, defaultDuration: FIELD_DURATION, isGlobal: true }),
  [TerrainType.TILTED]: props({
    terrainType: TerrainType.TILTED,
    defaultDuration: TILTED_DURATION,
    stepCost: TILTED_STEP_COST,
  }),
};

export function getTerrainProps(t: TerrainType): TerrainProperties {
  return TERRAIN_PROPS[t] ?? TERRAIN_PROPS[TerrainType.SLOW_ZONE];
}
