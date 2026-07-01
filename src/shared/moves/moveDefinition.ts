/** MoveDefinition type + registry loader. Faithful port of hex_battle.py MoveDefinition. */

import { MoveCategory, StatName } from '../core/enums.ts';

export interface MoveDefinition {
  readonly name: string;
  readonly category: MoveCategory;
  readonly basePower: number;
  readonly moveType: string;
  readonly isRanged: boolean;
  readonly requiresLos: boolean;
  readonly bypassesLos: boolean;
  readonly aoeRadius: number;
  readonly alwaysHits: boolean;
  readonly needsMomentum: boolean;
  readonly quickPriority: boolean;
  readonly recoilFraction: number;
  readonly selfDebuff: Partial<Record<StatName, number>>;
  readonly skipTurnOnHit: boolean;
  readonly terrainTypePlaced: string | null;
  /** status-move-only fields (present when category === STATUS) */
  readonly target?: string;
  readonly effectType?: string;
  readonly statusApplied?: string | null;
  readonly durationTurns?: number;
  readonly range?: number;
  readonly accuracy?: number;
  readonly description: string;
}

export type MoveRegistry = ReadonlyMap<string, MoveDefinition>;
