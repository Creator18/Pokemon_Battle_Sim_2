import { MoveCategory, PokemonType, StatName, TerrainType } from './Enums';

export interface StatDelta {
  stat: StatName;
  delta: number;
}

export interface MoveDefinition {
  id: string;
  name: string;
  category: MoveCategory;
  type: PokemonType;
  basePower: number;
  minRange: number;
  maxRange: number;
  requiresLoS: boolean;
  bypassesLoS: boolean;
  alwaysHits: boolean;
  needsMomentum: boolean;
  quickPriority: boolean;
  aoeRadius: number;
  recoilFraction: number;
  skipTurnOnHit: boolean;
  selfDebuffs: StatDelta[];
  selfBuffs: StatDelta[];
  terrainType?: TerrainType;
  terrainDuration?: number;
  inflictsStatus?: string;
}

export const MoveRegistry = new Map<string, MoveDefinition>();
