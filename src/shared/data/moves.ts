/**
 * Loads the 4 move JSON files into a single MoveRegistry, and exposes
 * MOVE_TYPE_MAP (move name → type). Faithful port of hex_battle.py load_move_registry.
 *
 * Note: "Electro Web" appears in both spatk_moves.json (special) and
 * terrain_moves.json (terrain). The terrain entry wins (it is loaded later and
 * carries base_power 40 + terrain_type_placed), matching the Python source where
 * the terrain file overwrites the earlier special entry in the registry.
 */

import atkMoves from './raw/atk_moves.json' with { type: 'json' };
import spatkMoves from './raw/spatk_moves.json' with { type: 'json' };
import terrainMoves from './raw/terrain_moves.json' with { type: 'json' };
import statusMoves from './raw/status_moves.json' with { type: 'json' };

import { MoveCategory, StatName } from '../core/enums.ts';
import type { MoveDefinition, MoveRegistry } from '../moves/moveDefinition.ts';

interface RawMove {
  category?: string;
  base_power?: number;
  move_type?: string;
  is_ranged?: boolean;
  requires_los?: boolean;
  bypasses_los?: boolean;
  aoe_radius?: number;
  always_hits?: boolean;
  needs_momentum?: boolean;
  quick_priority?: boolean;
  recoil_fraction?: number;
  self_debuff?: Record<string, number>;
  skip_turn_on_hit?: boolean;
  terrain_type_placed?: string | null;
  target?: string;
  effect_type?: string;
  status_applied?: string | null;
  duration_turns?: number;
  range?: number;
  accuracy?: number;
  description?: string;
}

interface RawMoveFile {
  moves: Record<string, RawMove>;
}

function parseCategory(raw: string | undefined, fallback: MoveCategory): MoveCategory {
  switch (raw) {
    case 'physical':
      return MoveCategory.PHYSICAL;
    case 'special':
      return MoveCategory.SPECIAL;
    case 'terrain':
      return MoveCategory.TERRAIN;
    case 'status':
      return MoveCategory.STATUS;
    default:
      return fallback;
  }
}

function buildMove(name: string, d: RawMove, fallback: MoveCategory): MoveDefinition {
  return {
    name,
    category: parseCategory(d.category, fallback),
    basePower: d.base_power ?? 0,
    moveType: d.move_type ?? 'Normal',
    isRanged: d.is_ranged ?? false,
    requiresLos: d.requires_los ?? false,
    bypassesLos: d.bypasses_los ?? false,
    aoeRadius: d.aoe_radius ?? 0,
    alwaysHits: d.always_hits ?? false,
    needsMomentum: d.needs_momentum ?? false,
    quickPriority: d.quick_priority ?? false,
    recoilFraction: d.recoil_fraction ?? 0.0,
    selfDebuff: (d.self_debuff ?? {}) as Partial<Record<StatName, number>>,
    skipTurnOnHit: d.skip_turn_on_hit ?? false,
    terrainTypePlaced: d.terrain_type_placed ?? null,
    target: d.target,
    effectType: d.effect_type,
    statusApplied: d.status_applied ?? null,
    durationTurns: d.duration_turns,
    range: d.range,
    accuracy: d.accuracy,
    description: d.description ?? '',
  };
}

function loadRegistry(): MoveRegistry {
  const registry = new Map<string, MoveDefinition>();
  const sources: Array<[RawMoveFile, MoveCategory]> = [
    [atkMoves as RawMoveFile, MoveCategory.PHYSICAL],
    [spatkMoves as RawMoveFile, MoveCategory.SPECIAL],
    [terrainMoves as RawMoveFile, MoveCategory.TERRAIN],
    [statusMoves as RawMoveFile, MoveCategory.STATUS],
  ];
  for (const [file, fallback] of sources) {
    for (const [name, data] of Object.entries(file.moves)) {
      registry.set(name, buildMove(name, data, fallback));
    }
  }
  return registry;
}

export const MOVE_REGISTRY: MoveRegistry = loadRegistry();

/** Move name → attacking type. Built from the registry's move_type fields. */
export const MOVE_TYPE_MAP: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [name, def] of MOVE_REGISTRY) m.set(name, def.moveType);
  return m;
})();

export function getMove(name: string): MoveDefinition | undefined {
  return MOVE_REGISTRY.get(name);
}

export function moveType(name: string): string {
  return MOVE_TYPE_MAP.get(name) ?? 'Normal';
}
