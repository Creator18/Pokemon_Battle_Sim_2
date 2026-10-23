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
  tilesEqual,
  hexDistance,
  hexNeighbors,
  hexLineTiles,
  getHexArea,
  getReachableTiles,
  getAttackableTiles,
  isValidPath,
  getAttackDirection,
  countStraightApproach,
  HEX_GRID,
  footprint,
  footprintKeys,
  anchorRules,
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
  MAP_WATER_PONDS,
  MAP_WATER_POND_SIZE,
  COOLDOWN_ATTACK_FIRST,
  COOLDOWN_MOVE_FIRST, FREEZE_TURNS, FREEZE_TURNS_FIRE, FREEZE_TURNS_FIRE_HAIL, GRASSY_HEAL_FRACTION
} from '../core/constants.ts';
import { RNG, makeRng, shuffle } from '../rng.ts';
import { TERRAIN_PULSE_POWER_MULT } from '../core/constants.ts';
import { Pokemon } from '../model/pokemon.ts';
import { TerrainManager, isGrounded } from '../terrain/terrainManager.ts';
import { getSpecies } from '../data/species.ts';
import { getMove } from '../data/moves.ts';
import { MoveCategory } from '../core/enums.ts';
import { TurnDeclaration } from './declaration.ts';
import { QueuedAction, buildQueue, qaEffectiveMoveRange } from './queue.ts';
import { executeMove, payHpCost, burnGrass, newResult, MoveResult, scalesWithMomentum } from '../moves/execute.ts';
import { chargeMultiplier, chargesUp, effectiveMoveType, terrainPulseType } from '../moves/damage.ts';
import { beamsMeet, resolveClash, ClashOutcome } from '../moves/clash.ts';
import type { MoveDefinition } from '../moves/moveDefinition.ts';
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
  /** A beam clash this attack took part in (both sides' actions carry it, the initiator's first). */
  clash?: (ClashOutcome & { players: [number, number] }) | null;
}

export interface TurnResolution {
  log: string[];
  resolvedActions: ResolvedAction[];
  /** playerId → set of tile keys hit by that player's attack. */
  aoeTiles: Record<number, string[]>;
}

/** A ram clash's loser is knocked this many tiles back from the clash point. */
const RAM_CLASH_KNOCK = 3;

/**
 * Where two rams from `a` and `b` meet: the tile midway along the line between
 * them, and steps from it along the way from a to b (the hex direction nearest
 * it) — negative back toward a.
 */
export function ramClashPoint(a: Tile, b: Tile): { tile: Tile; step: (k: number) => Tile } {
  const line = hexLineTiles(a[0], a[1], b[0], b[1]);
  const tile = line[Math.floor((line.length - 1) / 2)];
  const plane = (t: Tile): [number, number] => [Math.sqrt(3) * (t[0] + t[1] / 2), 1.5 * t[1]];
  const pa = plane(a), pb = plane(b);
  const way: [number, number] = [pb[0] - pa[0], pb[1] - pa[1]];
  let dir: Tile = [1, 0], best = -Infinity;
  for (const d of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as Tile[]) {
    const p = plane(d);
    const dot = p[0] * way[0] + p[1] * way[1];
    if (dot > best) { best = dot; dir = d; }
  }
  return { tile, step: (k) => [tile[0] + dir[0] * k, tile[1] + dir[1] * k] };
}

/**
 * `who` placed on `target` if it is free there — on the board, open to it, and
 * clear of `others` and of `taken` tiles — or else on a free tile beside
 * `target`, the farthest from `away` (its foes); null with nowhere.
 */
function placeNear(target: Tile, who: Pokemon, away: Pokemon[], tm: TerrainManager, taken: Tile[] = [], others: Pokemon[] = away): Tile | null {
  const blocked = tm.movementBlockersFor(who);
  const shut = new Set([...others.flatMap((p) => p.tiles), ...taken].map((t) => tileKey(t[0], t[1])));
  const free = (t: Tile) => { const k = tileKey(t[0], t[1]); return HEX_GRID.has(k) && !blocked.has(k) && !shut.has(k); };
  if (free(target)) return target;
  const foes = away.length ? away.map((p) => p.tile) : others.map((p) => p.tile);
  let pick: Tile | null = null, pd = -1;
  for (const [q, r] of hexNeighbors(target[0], target[1])) {
    const t: Tile = [q, r];
    if (!free(t)) continue;
    const d = foes.length ? Math.min(...foes.map((f) => hexDistance(f[0], f[1], q, r))) : 0;
    if (d > pd) { pd = d; pick = t; }
  }
  return pick;
}

/** How many turns `p` stays frozen, left alone (FREEZE_TURNS; a Fire type FREEZE_TURNS_FIRE, or _HAIL in hail). */
export function frozenFor(p: Pokemon, tm: TerrainManager): number {
  if (!p.types.includes('Fire')) return FREEZE_TURNS;
  return tm.isHail() ? FREEZE_TURNS_FIRE_HAIL : FREEZE_TURNS_FIRE;
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

  // Ponds: each grown from a free tile into its free neighbours.
  const taken = new Set<string>(excluded);
  for (let p = 0; p < MAP_WATER_PONDS; p++) {
    const free = shuffle([...grid].filter((k) => !taken.has(k)), rng);
    if (!free.length) break;
    const pond = [free[0]];
    taken.add(free[0]);
    while (pond.length < MAP_WATER_POND_SIZE) {
      const edge = shuffle(pond.flatMap((k) => {
        const [q, r] = keyToTile(k);
        return hexNeighbors(q, r).map(([nq, nr]) => tileKey(nq, nr)).filter((n) => grid.has(n) && !taken.has(n));
      }), rng);
      if (!edge.length) break;
      pond.push(edge[0]);
      taken.add(edge[0]);
    }
    for (const k of pond) tm.addTerrain(keyToTile(k), TerrainType.WATER, 0, 9999, 9999);
  }

  const eligible = [...grid].filter((k) => !taken.has(k));
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
  /** Who has already fired this turn (a clash resolves both sides at once). */
  private attacked = new Set<number>();

  /** Movement left unused this turn: what it has moved, else what it plans to. */
  private unusedTiles(p: Pokemon, tm: TerrainManager): number {
    const path = p.pathThisTurn.length > 1 ? p.pathThisTurn : (p.declaration?.plannedPath ?? []);
    const cost = path.slice(1).reduce((sum, t) => sum + tm.getStepCost(t), 0);
    return Math.max(0, p.effectiveMoveRange - cost);
  }

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

    if (pokemon.isFrozen) {
      this.log.push(`${pokemon.logName} is frozen solid! Movement skipped this turn.`);
      pokemon.pathThisTurn = [pokemon.tile];
      this.resolvedActions.push(this.moveResolved(pokemon, pokemon.tile, pokemon.tile, [pokemon.tile], true));
      return;
    }
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
    // Thrown off its tile earlier this turn (Earthquake): its planned path no longer starts where it is.
    if (path && path.length >= 2 && !tilesEqual(path[0], pokemon.tile)) {
      this.log.push(`${pokemon.logName} was thrown off its course! Movement skipped this turn.`);
      pokemon.pathThisTurn = [pokemon.tile];
      this.resolvedActions.push(this.moveResolved(pokemon, pokemon.tile, pokemon.tile, [pokemon.tile], true));
      return;
    }
    if (!path || path.length < 2) {
      this.log.push(`${pokemon.logName} (P${pokemon.playerId}) stays in place.`);
      pokemon.pathThisTurn = [pokemon.tile];
      this.resolvedActions.push(this.moveResolved(pokemon, pokemon.tile, pokemon.tile, [pokemon.tile], false));
      return;
    }

    const { blocked, occupied } = moveRules(pokemon, other, tm);
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
    if (wasStoppedEarly && move && !scalesWithMomentum(move)) {
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

    // Frozen solid: it cannot attack (nor does its beam meet anything).
    if (pokemon.isFrozen) {
      this.log.push(`${pokemon.logName} is frozen solid! It can't use ${move.name}.`);
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

    // Already fired, in a clash the other side started.
    if (this.attacked.has(pokemon.playerId)) return;

    // Momentum moves (every physical attack): force boost_mult = 1.0
    if (scalesWithMomentum(move)) pokemon.boostMult = 1.0;

    // Two beams fired at each other: they meet in a clash, resolved here for both.
    const defMove = defender.declaration ? getMove(defender.declaration.moveName) : undefined;
    if (defMove && !this.attacked.has(defender.playerId) && !defender.isFrozen &&
        beamsMeet(pokemon, move, decl.targetTile, defender, defMove, defender.declaration!.targetTile, tm)) {
      this.resolveClashAction(pokemon, move, defender, defMove, tm, state, rng);
      return;
    }
    this.attacked.add(pokemon.playerId);

    const result = executeMove(move, pokemon, defender, tm, rng, {
      targetTile: decl.targetTile,
      straightTiles: pokemon.straightTilesThisTurn,
      tilesMoved: decl.tilesToMove(),
      chargeTiles: chargesUp(move) ? this.unusedTiles(pokemon, tm) : 0,
      actionOrder: decl.actionOrder,
      defenderDeclaration: defender.declaration,
      turnNumber: state.meta.turnNumber,
    });
    this.finishAttack(pokemon, defender, move, result, state, null);
  }

  /** Record an attack's result: its log, status effects, cooldown and resolved action. */
  private finishAttack(
    pokemon: Pokemon,
    defender: Pokemon,
    move: MoveDefinition,
    result: MoveResult,
    state: BattleState,
    clash: ResolvedAction['clash'],
  ): void {
    const decl = pokemon.declaration!;
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
      clash,
    });
  }

  /**
   * A beam clash between `a` (firing now) and `b` (who had yet to): the
   * stronger output wins and hits, scaled by its margin; a tie disperses both.
   * Both sides are spent either way (cooldowns), and both actions are recorded,
   * `a`'s first, each carrying the clash.
   */
  private resolveClashAction(
    a: Pokemon,
    aMove: MoveDefinition,
    b: Pokemon,
    bMove: MoveDefinition,
    tm: TerrainManager,
    state: BattleState,
    rng: RNG,
  ): void {
    this.attacked.add(a.playerId);
    this.attacked.add(b.playerId);
    if (aMove.isRam && bMove.isRam) { this.resolveRamClash(a, aMove, b, bMove, tm, state, rng); return; }
    const outcome = resolveClash(
      // (Terrain Pulse under a terrain clashes in the terrain's type, doubled.)
      { playerId: a.playerId, move: aMove, charge: chargeMultiplier(this.unusedTiles(a, tm)),
        type: effectiveMoveType(aMove, tm, a), powerMult: terrainPulseType(aMove, tm, a) ? TERRAIN_PULSE_POWER_MULT : 1 },
      { playerId: b.playerId, move: bMove, charge: chargeMultiplier(this.unusedTiles(b, tm)),
        type: effectiveMoveType(bMove, tm, b), powerMult: terrainPulseType(bMove, tm, b) ? TERRAIN_PULSE_POWER_MULT : 1 },
    );
    const clash = { ...outcome, players: [a.playerId, b.playerId] as [number, number] };
    const fmt = (p: Pokemon) => `${p.logName} ${outcome.outputs[p.playerId].toFixed(1)}`;
    this.log.push(`BEAM CLASH! ${aMove.name} meets ${bMove.name} — ${fmt(a)} vs ${fmt(b)}.`);
    if (outcome.winner === null) this.log.push('The beams are evenly matched — both disperse!');

    // A Flamethrower in the clash burns the grass under its own beam while the
    // beams hold (the board shows it), but only a tie leaves those fires: each
    // keeps its half, split at the middle. A Flamethrower that loses is put
    // out, its grass unburnt; one that wins burns its whole line with its hit.
    const fireA = aMove.name === 'Flamethrower', fireB = bMove.name === 'Flamethrower';
    if ((fireA || fireB) && outcome.winner === null) {
      const split = { a: [a.tile[0], a.tile[1]] as [number, number], b: [b.tile[0], b.tile[1]] as [number, number],
        oa: fireA ? a.playerId : -1, ob: fireB ? b.playerId : -1 };
      const lit = newResult();
      if (fireA) burnGrass(a, b.tile, tm, HEX_GRID, lit, { upTo: 0.5, split });
      if (fireB) burnGrass(b, a.tile, tm, HEX_GRID, lit, { upTo: 0.5, split });
      this.log.push(...lit.logLines);
    }

    for (const [self, other, move] of [[a, b, aMove], [b, a, bMove]] as Array<[Pokemon, Pokemon, MoveDefinition]>) {
      const decl = self.declaration!;
      if (outcome.winner === self.playerId) {
        this.log.push(`${self.logName}'s ${move.name} overpowers it (margin ${(outcome.margin * 100).toFixed(0)}%)!`);
        const result = executeMove(move, self, other, tm, rng, {
          targetTile: decl.targetTile,
          straightTiles: self.straightTilesThisTurn,
          tilesMoved: decl.tilesToMove(),
          chargeTiles: this.unusedTiles(self, tm),
          clashMult: outcome.margin,
          actionOrder: decl.actionOrder,
          defenderDeclaration: other.declaration,
        });
        this.finishAttack(self, other, move, result, state, clash);
      } else {
        // Overpowered, or dispersed: spent, nothing lands (but it was fired: Steel Beam still costs).
        self.applyCooldown(decl.moveName, decl.actionOrder);
        const spent = { logLines: [] as string[], selfCost: 0 } as unknown as MoveResult;
        payHpCost(move, self, spent);
        this.log.push(...spent.logLines);
        this.resolvedActions.push({
          playerId: self.playerId,
          actionType: ActionType.ATTACK,
          moveName: decl.moveName,
          actionOrder: decl.actionOrder,
          fromTile: self.tile,
          toTile: other.tile,
          path: [],
          result: null,
          qaLandedAt: null,
          skippedMovement: false,
          skippedAttack: false,
          clash,
        });
      }
    }
  }

  /**
   * Two ram attacks charged at each other: they meet head-on between them.
   * The stronger (power × type effectiveness, as a beam clash) wins: its hit
   * lands (× the margin, as a beam clash's), it takes the loser's tile, and
   * the loser is knocked RAM_CLASH_KNOCK tiles back (or aside, with no room).
   * A tie: neither lands, and both are knocked a tile back from the other.
   */
  private resolveRamClash(a: Pokemon, aMove: MoveDefinition, b: Pokemon, bMove: MoveDefinition, tm: TerrainManager, state: BattleState, rng: RNG): void {
    const outcome = resolveClash(
      { playerId: a.playerId, move: aMove, charge: 1, type: effectiveMoveType(aMove, tm, a) },
      { playerId: b.playerId, move: bMove, charge: 1, type: effectiveMoveType(bMove, tm, b) },
    );
    const clash = { ...outcome, players: [a.playerId, b.playerId] as [number, number] };
    const at = ramClashPoint(a.tile, b.tile);
    const fmt = (p: Pokemon) => `${p.logName} ${outcome.outputs[p.playerId].toFixed(1)}`;
    this.log.push(`RAM CLASH! ${aMove.name} meets ${bMove.name} head-on — ${fmt(a)} vs ${fmt(b)}.`);
    // (Each action keeps where it charged from and at: the clash point is between them.)
    const was = { [a.playerId]: a.tile, [b.playerId]: b.tile };
    const spent = (self: Pokemon, other: Pokemon, result: MoveResult | null) => {
      const decl = self.declaration!;
      self.applyCooldown(decl.moveName, decl.actionOrder);
      this.resolvedActions.push({
        playerId: self.playerId, actionType: ActionType.ATTACK, moveName: decl.moveName, actionOrder: decl.actionOrder,
        fromTile: was[self.playerId], toTile: was[other.playerId], path: [], result, qaLandedAt: null,
        skippedMovement: false, skippedAttack: false, clash,
      });
    };
    if (outcome.winner === null) {
      // A tie: both rebound a tile, away from each other.
      this.log.push('The rams are evenly matched — both are knocked back!');
      // Each a tile back from the clash point, on its own side.
      const toA = a.huge ? null : placeNear(at.step(-1), a, [b], tm);
      const toB = b.huge ? null : placeNear(at.step(1), b, toA ? [a] : [a], tm, toA ? [toA] : []);
      for (const [self, other, to] of [[a, b, toA], [b, a, toB]] as Array<[Pokemon, Pokemon, Tile | null]>) {
        const r = newResult();
        if (to && tileKey(to[0], to[1]) !== tileKey(self.tile[0], self.tile[1])) {
          const from = self.tile;
          self.moveTo(to);
          r.knockback = { playerId: self.playerId, from, to };
          this.log.push(`${self.logName} is knocked back to ${tileKey(to[0], to[1])}!`);
        }
        spent(self, other, r);
      }
      return;
    }
    const [win, winMove, lose] = outcome.winner === a.playerId ? [a, aMove, b] : [b, bMove, a];
    // Steps from the clash point toward the loser's side.
    const ahead = win === a ? 1 : -1;
    this.log.push(`${win.logName}'s ${winMove.name} overpowers it (margin ${(outcome.margin * 100).toFixed(0)}%)!`);
    const decl = win.declaration!;
    const loserAt = lose.tile;
    const result = executeMove(winMove, win, lose, tm, rng, {
      targetTile: decl.targetTile, straightTiles: win.straightTilesThisTurn, tilesMoved: decl.tilesToMove(),
      clashMult: outcome.margin, actionOrder: decl.actionOrder, defenderDeclaration: lose.declaration, ramClash: true,
    });
    if (result.hit) {
      // The winner drives on a tile past the clash point; the loser is thrown
      // RAM_CLASH_KNOCK tiles back from it (or, no room, to a tile beside where it would land).
      const loseTo = lose.huge || !lose.isAlive ? null : placeNear(at.step(ahead * RAM_CLASH_KNOCK), lose, [win], tm);
      // (Ahead may be where the loser stood: it is gone from there.)
      const winTo = win.huge ? null : placeNear(at.step(ahead), win, [], tm, loseTo ? [loseTo] : lose.tiles, []);
      if (loseTo) {
        lose.moveTo(loseTo);
        result.knockback = { playerId: lose.playerId, from: loserAt, to: loseTo };
        this.log.push(`${lose.logName} is thrown back to ${tileKey(loseTo[0], loseTo[1])}!`);
      }
      if (winTo) result.qaLandedAt = winTo;
    }
    // (Its action records where it charged from: it moves on after.)
    this.finishAttack(win, lose, winMove, result, state, clash);
    if (result.qaLandedAt) win.moveTo(result.qaLandedAt);
    spent(lose, win, null);
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
    // The weather: hail and a sandstorm buffet everyone they do not spare.
    for (const [pid, dmg, kind] of tm.applyWeatherChip(list)) {
      const poke = pid === 1 ? p1 : p2;
      this.log.push(kind === 'hail' ? `${poke.logName} is buffeted by the hail! -${dmg} HP.` : `${poke.logName} is buffeted by the sandstorm! -${dmg} HP.`);
      if (!poke.isAlive) this.log.push(`${poke.logName} fainted from the ${kind}!`);
    }
    // Grassy Terrain heals the grounded.
    if (tm.fieldTerrain() === TerrainType.GRASSY_TERRAIN) {
      for (const poke of list) {
        if (!poke.isAlive || !isGrounded(poke) || poke.currentHp >= poke.maxHp) continue;
        const heal = Math.min(poke.maxHp - poke.currentHp, Math.max(1, Math.trunc(poke.maxHp * GRASSY_HEAL_FRACTION)));
        poke.currentHp += heal;
        this.log.push(`${poke.logName} is healed by the grassy terrain! +${heal} HP.`);
      }
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
    this.attacked = new Set();

    const p1 = state.p1!;
    const p2 = state.p2!;
    const tm = state.terrain;

    // Left alone, the frozen break free as the turn begins once they have been
    // frozen through their turns (FREEZE_TURNS; a Fire type sooner, unless in hail).
    for (const p of [p1, p2]) {
      if (!p.isAlive || !p.isFrozen) continue;
      p.frozenTurns += 1;
      if (p.frozenTurns > frozenFor(p, tm)) {
        p.thaw();
        this.log.push(`${p.logName} broke free of the ice!`);
      }
    }

    if (!state.meta.battleOver) {
      const queue = buildQueue(p1, p2, rng, tm);
      for (const action of queue) {
        if (this.determineWinner(p1, p2) !== -1) break;
        const other = action.playerId === 1 ? p2 : p1;
        if (action.actionType === ActionType.MOVE) {
          const move = getMove(action.pokemon.declaration!.moveName);
          if (move && tm.hasPriority(move) && action.pokemon.declaration!.actionOrder === ActionOrder.MOVE_FIRST) {
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
    const { blocked, occupied } = moveRules(self, other, this.state.terrain);
    return [
      ...getReachableTiles(self.tile[0], self.tile[1], self.effectiveMoveRange, blocked, occupied, undefined, this.stepCost),
    ];
  }

  getAttackableTiles(playerId: number, moveId: string, fromTile?: Tile): string[] {
    const { self } = this.pokemonAndOther(playerId);
    const move = getMove(moveId);
    if (!move) throw new Error(`Unknown move '${moveId}'.`);
    const from = fromTile ?? self.tile;
    const barriers = move.bypassesLos ? new Set<string>() : this.state.terrain.blockedLosTiles;
    const range = self.effectiveMoveRange;
    // A huge Pokémon attacks from any of its three tiles (never onto its own).
    const own = footprint(from, self.huge);
    const ownKeys = new Set(own.map((t) => tileKey(t[0], t[1])));
    const out = new Set<string>();
    for (const t of own) {
      for (const k of getAttackableTiles(t[0], t[1], move.isRanged ? range : null, move.isRanged, barriers)) {
        if (!ownKeys.has(k)) out.add(k);
      }
    }
    return [...out];
  }

  /** What entering a tile costs (rough ground, rocks: more), as the move resolves it. */
  private readonly stepCost = (key: string): number => this.state.terrain.getStepCost(keyToTile(key));

  validateDeclaration(playerId: number, decl: TurnDeclaration): { ok: boolean; reason: string } {
    const { self, other } = this.pokemonAndOther(playerId);
    const move = getMove(decl.moveName);
    if (!move) return { ok: false, reason: `Unknown move '${decl.moveName}'.` };
    if (!self.moves.includes(decl.moveName)) return { ok: false, reason: 'Move not in loadout.' };
    if ((self.cooldowns[decl.moveName] ?? 0) > 0) return { ok: false, reason: 'Move on cooldown.' };
    // Path validation
    if (decl.plannedPath.length > 1) {
      const { blocked, occupied } = moveRules(self, other, this.state.terrain);
      const { ok, reason } = isValidPath(decl.plannedPath, blocked, occupied, self.effectiveMoveRange, undefined, this.stepCost);
      if (!ok) return { ok: false, reason };
    }
    return { ok: true, reason: 'OK' };
  }
}

/**
 * Movement rules for `self` against `other`: the anchors it may not enter
 * (blocked) and may pass but not stop on (occupied) — footprints counted on
 * both sides, so huge Pokémon need room for all three tiles.
 */
function moveRules(self: Pokemon, other: Pokemon, tm: TerrainManager): { blocked: Set<string>; occupied: Set<string> } {
  const occupiedTiles = other.isAlive ? footprintKeys(other.tile, other.huge) : new Set<string>();
  return anchorRules(self.huge, tm.movementBlockersFor(self), occupiedTiles);
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
