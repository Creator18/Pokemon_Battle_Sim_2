/**
 * Turn engine + public BattleSession API. Faithful port of hex_battle.py
 * TurnEngine (~5080-5910), decoupled from SQLite: all state lives in a plain
 * serializable BattleState and randomness threads through an injected RNG.
 */

import {
  ActionOrder,
  ActionType,
  GamePhase,
  PokemonStatus,
  TerrainType,
} from '../core/enums.ts';
import {
  Tile,
  tileKey,
  keyToTile,
  hexDistance,
  hexNeighbors,
  getHexArea,
  getReachableTiles,
  getAttackableTiles,
  isValidPath,
  getAttackDirection,
  countStraightApproach,
  HEX_GRID,
} from '../core/hex.ts';
import { statStageMultiplier } from '../core/stats.ts';
import {
  P1_START,
  P2_START,
  MAP_ROCK_CENTER,
  MAP_ROCK_RADIUS,
  MAP_TREE_COUNT,
  MAP_TREE_INTEGRITY,
  MAP_SPAWN_EXCLUSION,
  COOLDOWN_ATTACK_FIRST,
  COOLDOWN_MOVE_FIRST,
} from '../core/constants.ts';
import { RNG, makeRng, shuffle } from '../rng.ts';
import { Pokemon } from '../model/pokemon.ts';
import { TerrainManager } from '../terrain/terrainManager.ts';
import { getSpecies } from '../data/species.ts';
import { getMove } from '../data/moves.ts';
import { MoveCategory } from '../core/enums.ts';
import { TurnDeclaration } from './declaration.ts';
import { QueuedAction, buildQueue, qaEffectiveMoveRange } from './queue.ts';
import { executeMove, MoveResult } from '../moves/execute.ts';
import {
  BattleState,
  createEmptyState,
  serializeState,
  deserializeState,
  BattleStateJSON,
  getStatusEffects,
  setStatusEffect,
  clearStatusEffect,
  hasStatusEffect,
  tickStatusEffects,
  tickCooldowns,
} from './battleState.ts';

export interface ResolvedAction {
  playerId: number;
  actionType: ActionType;
  moveName: string | null;
  actionOrder: ActionOrder | null;
  fromTile: Tile | null;
  toTile: Tile | null;
  path: Tile[];
  result: MoveResult | null;
  qaLandedAt: Tile | null;
  skippedMovement: boolean;
  skippedAttack: boolean;
}

export interface TurnResolution {
  log: string[];
  resolvedActions: ResolvedAction[];
  /** playerId → set of tile keys hit by that player's attack. */
  aoeTiles: Record<number, string[]>;
}

// ── Map generation (RNG-injected) ────────────
function generateBattlefieldTerrain(tm: TerrainManager, rng: RNG, grid = HEX_GRID): void {
  const rockTiles = getHexArea(MAP_ROCK_CENTER[0], MAP_ROCK_CENTER[1], MAP_ROCK_RADIUS, grid);
  for (const key of rockTiles) {
    tm.addTerrain(keyToTile(key), TerrainType.ROCK, 0, 9999, 9999);
  }

  const excluded = new Set<string>(rockTiles);
  for (const spawn of [P1_START, P2_START]) {
    excluded.add(tileKey(spawn[0], spawn[1]));
    for (const [nq, nr] of hexNeighbors(spawn[0], spawn[1])) {
      if (grid.has(tileKey(nq, nr))) excluded.add(tileKey(nq, nr));
    }
    for (const [nq, nr] of hexNeighbors(spawn[0], spawn[1])) {
      for (const [n2q, n2r] of hexNeighbors(nq, nr)) {
        if (grid.has(tileKey(n2q, n2r)) && hexDistance(spawn[0], spawn[1], n2q, n2r) <= MAP_SPAWN_EXCLUSION) {
          excluded.add(tileKey(n2q, n2r));
        }
      }
    }
  }

  const eligible = [...grid].filter((k) => !excluded.has(k));
  const shuffled = shuffle(eligible, rng);
  const treeCount = Math.min(MAP_TREE_COUNT, shuffled.length);
  for (let i = 0; i < treeCount; i++) {
    tm.addTerrain(keyToTile(shuffled[i]), TerrainType.TREE, 0, 9999, MAP_TREE_INTEGRITY);
  }
}

export class TurnEngine {
  private log: string[] = [];
  private moveResults: Record<number, MoveResult> = {};
  private aoeTiles: Record<number, Set<string>> = {};
  resolvedActions: ResolvedAction[] = [];
  private destinyBond: Record<number, boolean> = {};

  private truncatePath(
    path: readonly Tile[],
    blocked: ReadonlySet<string>,
    occupied: ReadonlySet<string>,
    canPass: boolean,
    moveRange: number,
    tm: TerrainManager,
  ): Tile[] {
    const result: Tile[] = [path[0]];
    let cumulative = 0;
    for (let i = 1; i < path.length; i++) {
      const tile = path[i];
      const key = tileKey(tile[0], tile[1]);
      if (blocked.has(key)) break;
      if (!canPass && occupied.has(key)) break;
      const stepCost = tm.getStepCost(tile);
      if (cumulative + stepCost > moveRange) break;
      cumulative += stepCost;
      result.push(tile);
    }
    return result;
  }

  private applyMovementStatHazards(pokemon: Pokemon, actualPath: readonly Tile[], tm: TerrainManager): void {
    const visitedFields: Array<Set<string>> = [];
    for (let i = 1; i < actualPath.length; i++) {
      const tile = actualPath[i];
      const effect = tm.getStatEffect(tile);
      if (effect === null) continue;
      if (tm.isMistProtected(tile)) {
        this.log.push(`${pokemon.logName} is protected by Misty Terrain — stat drop blocked!`);
        continue;
      }
      const key = tileKey(tile[0], tile[1]);
      if (visitedFields.some((f) => f.has(key))) continue;
      const entity = tm.getTerrain(tile);
      if (!entity) continue;
      visitedFields.push(tm.getContiguousField(tile, entity.terrainType));
      for (const [statName, delta] of Object.entries(effect)) {
        pokemon.applyStatStage(statName as never, delta as number);
        this.log.push(`${pokemon.logName} entered a hazard field! ${statName} changed by ${delta}.`);
      }
    }
  }

  private applyStealthRockEntry(pokemon: Pokemon, tm: TerrainManager): void {
    const entity = tm.getTerrain(pokemon.tile);
    if (!entity || entity.terrainType !== TerrainType.ROCK_TRAP) return;
    const dmg = tm.stealthRockDamage(pokemon);
    if (dmg <= 0) return;
    const actual = pokemon.takeDamage(dmg);
    this.log.push(`${pokemon.logName} was hurt by Stealth Rock! -${actual} HP.`);
    if (!pokemon.isAlive) this.log.push(`${pokemon.logName} fainted from Stealth Rock!`);
  }

  private resolveMoveAction(
    action: QueuedAction,
    tm: TerrainManager,
    other: Pokemon,
    state: BattleState,
    overrideRange: number | null = null,
  ): void {
    const pokemon = action.pokemon;
    const decl = pokemon.declaration;
    if (!pokemon.isAlive || !decl) return;

    if (hasStatusEffect(state, pokemon.playerId, 'flinched')) {
      this.log.push(`${pokemon.logName} flinched! Movement skipped this turn.`);
      clearStatusEffect(state, pokemon.playerId, 'flinched');
      this.resolvedActions.push(this.moveResolved(pokemon, pokemon.tile, pokemon.tile, [pokemon.tile], true));
      return;
    }
    if (hasStatusEffect(state, pokemon.playerId, 'hypnotized')) {
      this.log.push(`${pokemon.logName} is asleep! Movement skipped this turn.`);
      clearStatusEffect(state, pokemon.playerId, 'hypnotized');
      this.resolvedActions.push(this.moveResolved(pokemon, pokemon.tile, pokemon.tile, [pokemon.tile], true));
      return;
    }

    const path = decl.plannedPath;
    if (!path || path.length < 2) {
      this.log.push(`${pokemon.logName} (P${pokemon.playerId}) stays in place.`);
      pokemon.pathThisTurn = [pokemon.tile];
      this.resolvedActions.push(this.moveResolved(pokemon, pokemon.tile, pokemon.tile, [pokemon.tile], false));
      return;
    }

    const blocked = tm.blockedMovementTiles;
    const occupied = other.isAlive ? new Set([tileKey(other.tile[0], other.tile[1])]) : new Set<string>();
    const moveRange = overrideRange ?? pokemon.effectiveMoveRange;

    const actualPath = this.truncatePath(path, blocked, occupied, pokemon.canPassThrough, moveRange, tm);
    const destination = actualPath[actualPath.length - 1];
    const actualTiles = actualPath.length - 1;
    const intendedTiles = path.length - 1;
    const fromTile = actualPath[0];
    const actualCost = actualPath.slice(1).reduce((sum, t) => sum + tm.getStepCost(t), 0);
    const wasStoppedEarly = actualTiles < intendedTiles && actualCost < moveRange;

    pokemon.pathThisTurn = actualPath;
    if (actualTiles > 0) {
      pokemon.moveTo(destination);
      this.log.push(
        `${pokemon.logName} (P${pokemon.playerId}) moved ${actualTiles} tile(s) (cost ${actualCost}) -> ${tileKey(destination[0], destination[1])}.`,
      );
    } else {
      this.log.push(`${pokemon.logName} (P${pokemon.playerId}) blocked — cannot move.`);
    }

    this.applyMovementStatHazards(pokemon, actualPath, tm);
    this.applyStealthRockEntry(pokemon, tm);

    const move = getMove(decl.moveName);
    if (wasStoppedEarly && move && !move.needsMomentum) {
      pokemon.applyEarlyStop(intendedTiles, actualTiles);
      this.log.push(
        `Early stop! ${pokemon.logName} blocked after ${actualTiles}/${intendedTiles} tiles. Attack boost x${pokemon.boostMult.toFixed(2)}.`,
      );
    }

    const target = decl.targetTile;
    if (target !== null && actualTiles > 0) {
      const dir = getAttackDirection(destination[0], destination[1], target[0], target[1]);
      pokemon.straightTilesThisTurn = countStraightApproach(actualPath, dir);
    } else {
      pokemon.straightTilesThisTurn = 0;
    }

    this.resolvedActions.push({
      playerId: pokemon.playerId,
      actionType: ActionType.MOVE,
      moveName: null,
      actionOrder: null,
      fromTile,
      toTile: destination,
      path: actualPath,
      result: null,
      qaLandedAt: null,
      skippedMovement: false,
      skippedAttack: false,
    });
  }

  private moveResolved(
    pokemon: Pokemon,
    from: Tile,
    to: Tile,
    path: Tile[],
    skipped: boolean,
  ): ResolvedAction {
    return {
      playerId: pokemon.playerId,
      actionType: ActionType.MOVE,
      moveName: null,
      actionOrder: null,
      fromTile: from,
      toTile: to,
      path,
      result: null,
      qaLandedAt: null,
      skippedMovement: skipped,
      skippedAttack: false,
    };
  }

  private resolveAttackAction(
    action: QueuedAction,
    tm: TerrainManager,
    other: Pokemon,
    state: BattleState,
    rng: RNG,
  ): void {
    const pokemon = action.pokemon;
    const defender = other;
    const decl = pokemon.declaration;
    if (!pokemon.isAlive || !decl) return;

    const move = getMove(decl.moveName);
    if (!move) return;

    // Taunt blocks terrain/status moves
    if (
      hasStatusEffect(state, pokemon.playerId, 'taunted') &&
      (move.category === MoveCategory.TERRAIN || move.category === MoveCategory.STATUS)
    ) {
      this.log.push(`${pokemon.logName} is taunted! Can't use ${move.name}.`);
      this.resolvedActions.push({
        playerId: pokemon.playerId,
        actionType: ActionType.ATTACK,
        moveName: decl.moveName,
        actionOrder: decl.actionOrder,
        fromTile: pokemon.tile,
        toTile: null,
        path: [],
        result: null,
        qaLandedAt: null,
        skippedMovement: false,
        skippedAttack: true,
      });
      return;
    }

    if (decl.moveName === 'Destiny Bond') this.destinyBond[pokemon.playerId] = true;

    // Volt Tackle: force boost_mult = 1.0
    if (move.needsMomentum) pokemon.boostMult = 1.0;

    const result = executeMove(move, pokemon, defender, tm, rng, {
      targetTile: decl.targetTile,
      straightTiles: pokemon.straightTilesThisTurn,
      tilesMoved: decl.tilesToMove(),
      actionOrder: decl.actionOrder,
      defenderDeclaration: defender.declaration,
    });

    this.log.push(...result.logLines);
    this.moveResults[pokemon.playerId] = result;
    this.aoeTiles[pokemon.playerId] = result.tilesHit;

    // Status effects from move result
    for (const [pid, effect, turns] of result.statChanges) {
      if (effect === 'hypnosis') setStatusEffect(state, pid, 'hypnotized', 1);
      else if (effect === 'taunted' || effect === 'taunt') setStatusEffect(state, pid, 'taunted', turns || 2);
      else if (effect === 'destiny_bond') setStatusEffect(state, pokemon.playerId, 'destiny_bond', 1);
    }
    if (result.flinched) {
      setStatusEffect(state, defender.playerId, 'flinched', 1);
    }

    // Cooldown
    pokemon.applyCooldown(decl.moveName, decl.actionOrder);
    const cd = decl.actionOrder === ActionOrder.ATTACK_FIRST ? COOLDOWN_ATTACK_FIRST : COOLDOWN_MOVE_FIRST;
    this.log.push(`${move.name} cooldown: ${cd} turn(s).`);

    this.resolvedActions.push({
      playerId: pokemon.playerId,
      actionType: ActionType.ATTACK,
      moveName: decl.moveName,
      actionOrder: decl.actionOrder,
      fromTile: pokemon.tile,
      toTile: defender.tile,
      path: [],
      result,
      qaLandedAt: result.qaLandedAt,
      skippedMovement: false,
      skippedAttack: false,
    });
  }

  private checkDestinyBond(p1: Pokemon, p2: Pokemon): void {
    for (const [attacker, defender] of [
      [p1, p2],
      [p2, p1],
    ] as Array<[Pokemon, Pokemon]>) {
      if (this.destinyBond[attacker.playerId] && !attacker.isAlive && defender.isAlive) {
        defender.takeDamage(defender.currentHp);
        this.log.push(`Destiny Bond triggered! ${defender.logName} faints along with ${attacker.logName}!`);
      }
    }
  }

  private applyEndOfTurnTerrain(p1: Pokemon, p2: Pokemon, tm: TerrainManager): void {
    const list = [p1, p2].filter((p) => p.isAlive);
    for (const [pid, dmg] of tm.applyBurnDamage(list)) {
      const poke = pid === 1 ? p1 : p2;
      this.log.push(`${poke.logName} is hurt by burn zone! -${dmg} HP.`);
      if (!poke.isAlive) this.log.push(`${poke.logName} fainted from burn!`);
    }
    for (const [pid, dmg] of tm.applyIceDamage(list)) {
      const poke = pid === 1 ? p1 : p2;
      this.log.push(`${poke.logName} is pelted by hail! -${dmg} HP.`);
      if (!poke.isAlive) this.log.push(`${poke.logName} fainted from hail!`);
    }
    for (const [pid, , , newStage, clamped] of tm.applyResonanceDrain(list)) {
      const poke = pid === 1 ? p1 : p2;
      this.log.push(clamped ? `${poke.logName}'s Sp. Def can't go lower!` : `${poke.logName} resonance drain! Sp. Def ${newStage}`);
    }
    for (const [pid, , , newStage, clamped] of tm.applyPoisonDrain(list)) {
      if (clamped) continue;
      const poke = pid === 1 ? p1 : p2;
      this.log.push(`${poke.logName} drained by toxic spikes! Sp. Def ${newStage}`);
    }
    for (const [pid, countdown] of tm.tickPerishCountdown(list)) {
      const poke = pid === 1 ? p1 : p2;
      this.log.push(
        countdown > 0
          ? `${poke.logName} perish countdown: ${countdown} turn(s) remaining!`
          : `${poke.logName}'s perish countdown reached 0! It fainted!`,
      );
    }
  }

  /** -1 = continues, null = draw, 1/2 = winner. */
  private determineWinner(p1: Pokemon, p2: Pokemon): number | null | -1 {
    if (p1.isAlive && p2.isAlive) return -1;
    if (!p1.isAlive && !p2.isAlive) return null;
    if (!p1.isAlive) return 2;
    return 1;
  }

  // ── Lifecycle ─────────────────────────────
  beginTurn(state: BattleState): void {
    state.meta.turnNumber += 1;
    state.meta.phase = GamePhase.DECLARING;
    state.battleLog.push(`=== Turn ${state.meta.turnNumber} ===`);
    tickCooldowns(state);
    tickStatusEffects(state);
    state.meta.phase = GamePhase.RESOLVING;
  }

  resolveTurn(state: BattleState, rng: RNG): TurnResolution {
    this.log = [];
    this.moveResults = {};
    this.aoeTiles = {};
    this.resolvedActions = [];
    this.destinyBond = {};

    const p1 = state.p1!;
    const p2 = state.p2!;
    const tm = state.terrain;

    if (!state.meta.battleOver) {
      const queue = buildQueue(p1, p2, rng);
      for (const action of queue) {
        if (this.determineWinner(p1, p2) !== -1) break;
        const other = action.playerId === 1 ? p2 : p1;
        if (action.actionType === ActionType.MOVE) {
          const move = getMove(action.pokemon.declaration!.moveName);
          if (move && move.quickPriority && action.pokemon.declaration!.actionOrder === ActionOrder.MOVE_FIRST) {
            const override = qaEffectiveMoveRange(action.pokemon.effectiveSpeed);
            this.resolveMoveAction(action, tm, other, state, override);
          } else {
            this.resolveMoveAction(action, tm, other, state);
          }
        } else {
          this.resolveAttackAction(action, tm, other, state, rng);
        }
      }
      this.checkDestinyBond(p1, p2);

      // record results
      for (const [pid, r] of Object.entries(this.moveResults)) {
        state.lastTurnResults[pid === '1' ? 'p1' : 'p2'] = serializeMoveResult(r);
      }
      state.battleLog.push(...this.log);

      const winner = this.determineWinner(p1, p2);
      if (winner !== -1) {
        state.meta.battleOver = true;
        state.meta.winner = winner;
        state.meta.phase = GamePhase.GAME_OVER;
        state.battleLog.push(winner === null ? 'Draw!' : `Player ${winner} wins!`);
      }
    }

    return {
      log: [...this.log],
      resolvedActions: [...this.resolvedActions],
      aoeTiles: this.aoeSnapshot(),
    };
  }

  endTurn(state: BattleState): void {
    this.log = [];
    const p1 = state.p1!;
    const p2 = state.p2!;
    const tm = state.terrain;

    if (!state.meta.battleOver) {
      this.applyEndOfTurnTerrain(p1, p2, tm);
      const winner = this.determineWinner(p1, p2);
      if (winner !== -1) {
        state.meta.battleOver = true;
        state.meta.winner = winner;
        state.meta.phase = GamePhase.GAME_OVER;
        this.log.push(winner === null ? 'Draw (terrain KO)!' : `Player ${winner} wins (terrain KO)!`);
      }
    }

    const expired = tm.tickAll();
    for (const [tile, name] of expired) {
      this.log.push(tile === null ? `Global weather '${name}' ended.` : `Terrain '${name}' at ${tileKey(tile[0], tile[1])} expired.`);
    }

    state.battleLog.push(...this.log);

    // clear per-turn fields + declarations
    for (const p of [p1, p2]) {
      p.pathThisTurn = [];
      p.boostMult = 1.0;
      p.tilesShort = 0;
      p.straightTilesThisTurn = 0;
      p.declaration = null;
    }
  }

  private aoeSnapshot(): Record<number, string[]> {
    const out: Record<number, string[]> = {};
    for (const [pid, tiles] of Object.entries(this.aoeTiles)) out[Number(pid)] = [...tiles];
    return out;
  }
}

function serializeMoveResult(r: MoveResult): unknown {
  return {
    hit: r.hit,
    damage_dealt: r.damageDealt,
    recoil_dealt: r.recoilDealt,
    tiles_hit: [...r.tilesHit],
    crit: r.crit,
    flinched: r.flinched,
    qa_failed: r.qaFailed,
    qa_landed_at: r.qaLandedAt,
    miss_reason: r.missReason,
  };
}

// ─────────────────────────────────────────────
// PUBLIC IN-MEMORY SESSION API
// ─────────────────────────────────────────────

export class BattleSession {
  readonly state: BattleState;
  private rng: RNG;
  private readonly seed: number;
  private readonly engine = new TurnEngine();

  private constructor(state: BattleState, seed: number) {
    this.state = state;
    this.seed = seed >>> 0;
    this.rng = makeRng(this.seed);
    // fast-forward rng to persisted position not tracked here (single-run use).
  }

  static create(rngSeed: number | string, sessionId = 'local'): BattleSession {
    const seed = typeof rngSeed === 'string' ? hashSeed(rngSeed) : rngSeed >>> 0;
    const state = createEmptyState(sessionId, seed);
    return new BattleSession(state, seed);
  }

  static fromJSON(j: BattleStateJSON): BattleSession {
    const state = deserializeState(j);
    return new BattleSession(state, j.meta.rngState);
  }

  // ── Selection ─────────────────────────────
  selectPokemon(playerId: number, species: string): void {
    if (playerId === 1) this.state.meta.selectedP1 = species;
    else this.state.meta.selectedP2 = species;
  }

  selectMoves(playerId: number, moveIds: string[]): void {
    const speciesName = playerId === 1 ? this.state.meta.selectedP1 : this.state.meta.selectedP2;
    if (!speciesName) throw new Error(`Player ${playerId} has not selected a species.`);
    const species = getSpecies(speciesName);
    if (!species) throw new Error(`Unknown species '${speciesName}'.`);
    const tile: Tile = playerId === 1 ? [P1_START[0], P1_START[1]] : [P2_START[0], P2_START[1]];
    const pokemon = Pokemon.fromSpecies(species, playerId, tile, moveIds);
    if (playerId === 1) this.state.p1 = pokemon;
    else this.state.p2 = pokemon;
  }

  bothReady(): boolean {
    return this.state.p1 !== null && this.state.p2 !== null;
  }

  startBattle(): void {
    if (!this.bothReady()) throw new Error('Both players must select pokemon + moves first.');
    generateBattlefieldTerrain(this.state.terrain, this.rng);
    this.state.p1!.moveTo([P1_START[0], P1_START[1]]);
    this.state.p2!.moveTo([P2_START[0], P2_START[1]]);
    this.state.meta.phase = GamePhase.DECLARING;
    // beginTurn advances to turn 1.
    this.engine.beginTurn(this.state);
  }

  // ── Declaration ───────────────────────────
  declare(playerId: number, decl: TurnDeclaration): void {
    const p = playerId === 1 ? this.state.p1 : this.state.p2;
    if (!p) throw new Error(`Player ${playerId} has no pokemon.`);
    p.declaration = decl;
  }

  bothDeclared(): boolean {
    return this.state.p1?.declaration != null && this.state.p2?.declaration != null;
  }

  // ── Resolution ────────────────────────────
  resolveTurn(): TurnResolution {
    const res = this.engine.resolveTurn(this.state, this.rng);
    this.engine.endTurn(this.state);
    if (!this.state.meta.battleOver) this.engine.beginTurn(this.state);
    return res;
  }

  // ── Queries ───────────────────────────────
  getState(): BattleStateJSON {
    return serializeState(this.state);
  }

  isOver(): boolean {
    return this.state.meta.battleOver;
  }

  get winner(): number | null {
    return this.state.meta.winner;
  }

  private pokemonAndOther(playerId: number): { self: Pokemon; other: Pokemon } {
    const self = playerId === 1 ? this.state.p1 : this.state.p2;
    const other = playerId === 1 ? this.state.p2 : this.state.p1;
    if (!self || !other) throw new Error('Battle not fully initialized.');
    return { self, other };
  }

  getReachableTiles(playerId: number): string[] {
    const { self, other } = this.pokemonAndOther(playerId);
    const blocked = this.state.terrain.blockedMovementTiles;
    const occupied = other.isAlive ? new Set([tileKey(other.tile[0], other.tile[1])]) : new Set<string>();
    return [
      ...getReachableTiles(self.tile[0], self.tile[1], self.effectiveMoveRange, blocked, occupied),
    ];
  }

  getAttackableTiles(playerId: number, moveId: string, fromTile?: Tile): string[] {
    const { self } = this.pokemonAndOther(playerId);
    const move = getMove(moveId);
    if (!move) throw new Error(`Unknown move '${moveId}'.`);
    const from = fromTile ?? self.tile;
    const barriers = move.bypassesLos ? new Set<string>() : this.state.terrain.blockedLosTiles;
    const range = self.effectiveMoveRange;
    return [...getAttackableTiles(from[0], from[1], move.isRanged ? range : null, move.isRanged, barriers)];
  }

  validateDeclaration(playerId: number, decl: TurnDeclaration): { ok: boolean; reason: string } {
    const { self, other } = this.pokemonAndOther(playerId);
    const move = getMove(decl.moveName);
    if (!move) return { ok: false, reason: `Unknown move '${decl.moveName}'.` };
    if (!self.moves.includes(decl.moveName)) return { ok: false, reason: 'Move not in loadout.' };
    if ((self.cooldowns[decl.moveName] ?? 0) > 0) return { ok: false, reason: 'Move on cooldown.' };
    // Path validation
    if (decl.plannedPath.length > 1) {
      const blocked = this.state.terrain.blockedMovementTiles;
      const occupied = other.isAlive ? new Set([tileKey(other.tile[0], other.tile[1])]) : new Set<string>();
      const { ok, reason } = isValidPath(decl.plannedPath, blocked, occupied, self.effectiveMoveRange);
      if (!ok) return { ok: false, reason };
    }
    return { ok: true, reason: 'OK' };
  }
}

function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Re-export utilities that reference statStageMultiplier for effective speed queries.
export { statStageMultiplier };
