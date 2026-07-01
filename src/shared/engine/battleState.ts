/**
 * BattleState — a fully serializable plain object holding all battle state.
 * Replaces the Python SQLite-coupled state. No DB, no side channels.
 */

import { GamePhase, StatusEffectName } from '../core/enums.ts';
import { Pokemon, PokemonJSON } from '../model/pokemon.ts';
import { TerrainManager, TerrainEntityJSON } from '../terrain/terrainManager.ts';

/** Per-player status-effect counters: effectName → turns remaining. */
export type StatusEffects = Partial<Record<StatusEffectName, number>>;

export interface BattleStateJSON {
  meta: {
    sessionId: string;
    turnNumber: number;
    phase: string;
    battleOver: boolean;
    winner: number | null;
    rngState: number;
    selectedP1: string | null;
    selectedP2: string | null;
  };
  pokemon: {
    p1: PokemonJSON | null;
    p2: PokemonJSON | null;
  };
  terrain: TerrainEntityJSON[];
  statusEffects: {
    p1: StatusEffects;
    p2: StatusEffects;
  };
  lastTurnResults: {
    p1: unknown | null;
    p2: unknown | null;
  };
  battleLog: string[];
}

/**
 * Runtime BattleState. `pokemon`/`terrain` are hydrated objects; call
 * {@link serializeState} to obtain a plain JSON snapshot.
 */
export interface BattleState {
  meta: BattleStateJSON['meta'];
  p1: Pokemon | null;
  p2: Pokemon | null;
  terrain: TerrainManager;
  statusEffects: { p1: StatusEffects; p2: StatusEffects };
  lastTurnResults: { p1: unknown | null; p2: unknown | null };
  battleLog: string[];
}

export function createEmptyState(sessionId: string, rngSeed: number): BattleState {
  return {
    meta: {
      sessionId,
      turnNumber: 0,
      phase: GamePhase.SELECTING,
      battleOver: false,
      winner: null,
      rngState: rngSeed >>> 0,
      selectedP1: null,
      selectedP2: null,
    },
    p1: null,
    p2: null,
    terrain: new TerrainManager(),
    statusEffects: { p1: {}, p2: {} },
    lastTurnResults: { p1: null, p2: null },
    battleLog: [],
  };
}

export function serializeState(s: BattleState): BattleStateJSON {
  return {
    meta: { ...s.meta },
    pokemon: {
      p1: s.p1 ? s.p1.toJSON() : null,
      p2: s.p2 ? s.p2.toJSON() : null,
    },
    terrain: s.terrain.toJSON(),
    statusEffects: {
      p1: { ...s.statusEffects.p1 },
      p2: { ...s.statusEffects.p2 },
    },
    lastTurnResults: { ...s.lastTurnResults },
    battleLog: [...s.battleLog],
  };
}

export function deserializeState(j: BattleStateJSON): BattleState {
  return {
    meta: { ...j.meta },
    p1: j.pokemon.p1 ? Pokemon.fromJSON(j.pokemon.p1) : null,
    p2: j.pokemon.p2 ? Pokemon.fromJSON(j.pokemon.p2) : null,
    terrain: TerrainManager.fromJSON(j.terrain),
    statusEffects: {
      p1: { ...j.statusEffects.p1 },
      p2: { ...j.statusEffects.p2 },
    },
    lastTurnResults: { ...j.lastTurnResults },
    battleLog: [...j.battleLog],
  };
}

// ── Status-effect helpers ────────────────────
function effectsFor(s: BattleState, playerId: number): StatusEffects {
  return playerId === 1 ? s.statusEffects.p1 : s.statusEffects.p2;
}

export function getStatusEffects(s: BattleState, playerId: number): StatusEffects {
  return effectsFor(s, playerId);
}

export function setStatusEffect(
  s: BattleState,
  playerId: number,
  effect: StatusEffectName,
  turns: number,
): void {
  effectsFor(s, playerId)[effect] = turns;
}

export function clearStatusEffect(s: BattleState, playerId: number, effect: StatusEffectName): void {
  delete effectsFor(s, playerId)[effect];
}

export function hasStatusEffect(s: BattleState, playerId: number, effect: StatusEffectName): boolean {
  return (effectsFor(s, playerId)[effect] ?? 0) > 0;
}

/** Decrement all counters; remove those that reach 0. */
export function tickStatusEffects(s: BattleState): void {
  for (const key of ['p1', 'p2'] as const) {
    const effects = s.statusEffects[key];
    for (const k of Object.keys(effects) as StatusEffectName[]) {
      const v = effects[k] ?? 0;
      if (v <= 1) delete effects[k];
      else effects[k] = v - 1;
    }
  }
}

export function tickCooldowns(s: BattleState): void {
  for (const p of [s.p1, s.p2]) {
    if (!p) continue;
    for (const m of Object.keys(p.cooldowns)) {
      p.cooldowns[m] = Math.max(0, p.cooldowns[m] - 1);
    }
  }
}
