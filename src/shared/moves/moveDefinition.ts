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
  /** A beam: two fired at each other in one turn meet in a clash (moves/clash.ts). */
  readonly isBeam: boolean;
  /** A ball attack: it clashes, as beams do. */
  readonly isBall: boolean;
  /** A pulse attack (Psychic, Dark Pulse — not Dragon Pulse, a beam): it clashes, as beams do. */
  readonly isPulse: boolean;
  /** Fired, it costs its user this share of its max HP, hit or miss (Steel Beam). */
  readonly selfHpCost: number;
  /** Deals exactly this much HP, whatever the stats or boosts (Dragon Rage); 0 = the damage formula. */
  readonly fixedDamage: number;
  readonly quickPriority: boolean;
  /**
   * It dashes in (the quick step), and on contact waits beside the target on
   * its path: every physical priority move, and Flame Charge (no priority).
   */
  readonly quickDash: boolean;
  /** A quick dash that strikes twice (Aerial Ace): through its target, back through it from behind, and stops two tiles short of it on the line it came in on. */
  readonly doublePass: boolean;
  /**
   * A ram attack (Flare Blitz, Take Down, Head Smash…): it charges straight
   * into the target and knocks it back a tile (or aside, with no room).
   */
  readonly isRam: boolean;
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
