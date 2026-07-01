/** Public API for the pure, deterministic hex-battle engine. */

// RNG
export { type RNG, mulberry32, makeRng, seedFromString, shuffle } from './rng.ts';

// Core
export * from './core/enums.ts';
export * from './core/constants.ts';
export * from './core/hex.ts';
export { getTypeEffectiveness } from './core/typechart.ts';
export {
  type StatStages,
  statStageMultiplier,
  clampStatStage,
  defaultStatStages,
} from './core/stats.ts';

// Terrain
export { TERRAIN_PROPS, getTerrainProps, type TerrainProperties } from './terrain/terrainProps.ts';
export {
  TerrainEntity,
  TerrainManager,
  type TerrainAffectable,
  type TerrainEntityJSON,
  type TerrainRemoval,
} from './terrain/terrainManager.ts';

// Moves
export { type MoveDefinition, type MoveRegistry } from './moves/moveDefinition.ts';
export {
  calculateDamage,
  getHexPower,
  getMoveTypeMult,
  getWeatherMult,
  isHighCritMove,
  rollCrit,
  momentumMultiplier,
  voltTackleRecoilMultiplier,
  type DamageParams,
} from './moves/damage.ts';
export { executeMove, qaPowerMultiplier, type MoveResult, type ExecuteOptions } from './moves/execute.ts';

// Data
export {
  SPECIES_LIST,
  POKEMON_TYPES,
  getSpecies,
  type SpeciesDefinition,
} from './data/species.ts';
export { MOVE_REGISTRY, MOVE_TYPE_MAP, getMove, moveType } from './data/moves.ts';

// Model
export { Pokemon, type PokemonJSON, type PokemonInit } from './model/pokemon.ts';

// Engine
export { TurnDeclaration, type TurnDeclarationJSON } from './engine/declaration.ts';
export {
  type BattleState,
  type BattleStateJSON,
  type StatusEffects,
  createEmptyState,
  serializeState,
  deserializeState,
} from './engine/battleState.ts';
export { type QueuedAction, buildQueue, qaEffectiveMoveRange, qaAttackPriority } from './engine/queue.ts';
export {
  BattleSession,
  TurnEngine,
  type ResolvedAction,
  type TurnResolution,
} from './engine/turnEngine.ts';

// Protocol
export * from './protocol/messages.ts';
