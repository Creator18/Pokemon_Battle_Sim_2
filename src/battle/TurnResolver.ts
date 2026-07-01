import { GamePhase, MoveCategory, StatusCondition, TerrainType } from '../core/Enums';
import { GameConstants } from '../core/GameConstants';
import { hexDistance, tileKey, Vec2, generateGrid } from '../core/HexGrid';
import { MoveRegistry } from '../core/MoveDefinition';
import { PokemonState } from '../core/PokemonState';
import { calculateDamage } from '../core/DamageCalculator';

export interface BattleState {
  turnNumber: number;
  phase: GamePhase;
  p1: PokemonState;
  p2: PokemonState;
  terrain: Map<string, { type: TerrainType; turnsLeft: number }>;
  winner: number | null;
  isOver: boolean;
}

export interface ResolutionResult {
  log: string[];
  winner: number | null;
  stateSnapshot: BattleState;
}

interface QueuedAction {
  actor: PokemonState;
  target: PokemonState;
  moveId: string;
  priority: number;
  speedTieBreak: number;
}

export function beginTurn(state: BattleState): void {
  state.turnNumber++;
  state.phase = GamePhase.Selection;
  // Clear flinch at start of turn
  state.p1.status.delete(StatusCondition.Flinched);
  state.p2.status.delete(StatusCondition.Flinched);
}

export function resolveTurn(state: BattleState): ResolutionResult {
  const log: string[] = [];
  state.phase = GamePhase.Resolution;

  const p1 = state.p1;
  const p2 = state.p2;

  const actions: QueuedAction[] = [];

  // Build action queue for each player
  for (const actor of [p1, p2]) {
    if (!actor.isAlive || !actor.declaration) continue;
    const decl = actor.declaration;
    const opponent = actor === p1 ? p2 : p1;
    const move = MoveRegistry.get(decl.moveId);
    if (!move) continue;

    // Apply movement first
    if (decl.movePath.length > 0) {
      actor.prevTile = { ...actor.tile };
      actor.tile = { ...decl.movePath[decl.movePath.length - 1] };
      log.push(`${actor.name} moved to (${actor.tile.x},${actor.tile.y}).`);
    }

    const priority = move.quickPriority ? 1 : 0;
    actions.push({
      actor,
      target: opponent,
      moveId: decl.moveId,
      priority,
      speedTieBreak: actor.speed + Math.random() * 0.001,
    });
  }

  // Sort: higher priority first, then higher speed first
  actions.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.speedTieBreak - a.speedTieBreak;
  });

  // Execute moves
  for (const action of actions) {
    if (!action.actor.isAlive) continue;
    if (action.actor.status.has(StatusCondition.Flinched)) {
      log.push(`${action.actor.name} flinched and couldn't move!`);
      continue;
    }
    if (action.actor.status.has(StatusCondition.Paralyzed) && Math.random() < 0.25) {
      log.push(`${action.actor.name} is paralyzed! It can't move!`);
      continue;
    }
    if (action.actor.status.has(StatusCondition.Hypnotized)) {
      log.push(`${action.actor.name} is fast asleep.`);
      if (Math.random() < 0.33) action.actor.status.delete(StatusCondition.Hypnotized);
      continue;
    }

    executeMove(action, state, log);

    // Check KO
    if (!action.target.isAlive) {
      log.push(`${action.target.name} fainted!`);
      break;
    }
  }

  // Clear declarations
  p1.declaration = null;
  p2.declaration = null;

  // Check winner
  let winner: number | null = null;
  if (!p1.isAlive && !p2.isAlive) {
    winner = 0; // draw — player 0
    log.push('Both Pokemon fainted! Draw!');
    state.isOver = true;
  } else if (!p1.isAlive) {
    winner = 2;
    log.push('Player 2 wins!');
    state.isOver = true;
  } else if (!p2.isAlive) {
    winner = 1;
    log.push('Player 1 wins!');
    state.isOver = true;
  }
  state.winner = winner;
  state.phase = state.isOver ? GamePhase.GameOver : GamePhase.EndOfTurn;

  return { log, winner, stateSnapshot: state };
}

function executeMove(action: QueuedAction, state: BattleState, log: string[]): void {
  const { actor, target, moveId } = action;
  const move = MoveRegistry.get(moveId)!;

  log.push(`${actor.name} used ${move.name}!`);

  // Set cooldown
  if (move.category !== MoveCategory.Status && move.category !== MoveCategory.Terrain) {
    actor.cooldowns.set(moveId, GameConstants.AttackFirstCooldown);
  }

  // Apply self buffs/debuffs
  for (const d of move.selfDebuffs) {
    actor.applyStageChange(d.stat, d.delta);
    log.push(`${actor.name}'s ${d.stat} fell!`);
  }
  for (const b of move.selfBuffs) {
    actor.applyStageChange(b.stat, b.delta);
    log.push(`${actor.name}'s ${b.stat} rose!`);
  }

  // Terrain move
  if (move.category === MoveCategory.Terrain && move.terrainType !== undefined) {
    const targetTile = action.actor.declaration?.targetTile ?? actor.tile;
    applyTerrain(state, targetTile, move.terrainType!, move.terrainDuration ?? 3, move.aoeRadius, log);
    return;
  }

  if (move.category === MoveCategory.Status) {
    // Range check
    const dist = hexDistance(actor.tile, target.tile);
    if (dist >= move.minRange && dist <= move.maxRange || move.minRange === 0) {
      if (move.inflictsStatus) {
        applyStatusEffect(target, move.inflictsStatus, log);
      }
    }
    return;
  }

  // Damaging move
  const dist = hexDistance(actor.tile, target.tile);
  const inRange = move.minRange === 0
    ? true
    : (dist >= move.minRange && dist <= move.maxRange);

  if (!inRange && !move.alwaysHits) {
    log.push(`But it missed! (distance ${dist}, range ${move.minRange}-${move.maxRange})`);
    return;
  }

  const result = calculateDamage(actor, target, move, state.terrain);

  if (result.typeMultiplier === 0) {
    log.push(`It doesn't affect ${target.name}...`);
    return;
  }

  if (result.typeMultiplier > 1) log.push("It's super effective!");
  if (result.typeMultiplier < 1 && result.typeMultiplier > 0) log.push("It's not very effective...");
  if (result.isCrit) log.push("A critical hit!");

  target.takeDamage(result.damage);
  log.push(`${target.name} took ${result.damage} damage! (${target.currentHp}/${target.maxHp} HP)`);

  // Recoil
  if (result.recoil > 0) {
    actor.takeDamage(result.recoil);
    log.push(`${actor.name} is hit with recoil! (${result.recoil} damage)`);
  }

  // AoE — apply to opponent tile's neighbors
  if (move.aoeRadius > 0) {
    // AoE already hits primary target; we just note it
    log.push(`The attack hit the surrounding area!`);
  }
}

function applyStatusEffect(target: PokemonState, status: string, log: string[]): void {
  switch (status) {
    case 'burned':
      if (!target.status.has(StatusCondition.Burned)) {
        target.status.add(StatusCondition.Burned);
        log.push(`${target.name} was burned!`);
      }
      break;
    case 'paralyzed':
      if (!target.status.has(StatusCondition.Paralyzed)) {
        target.status.add(StatusCondition.Paralyzed);
        log.push(`${target.name} was paralyzed!`);
      }
      break;
    case 'poisoned':
      log.push(`${target.name} was badly poisoned!`);
      break;
    case 'hypnotized':
      if (!target.status.has(StatusCondition.Hypnotized)) {
        target.status.add(StatusCondition.Hypnotized);
        log.push(`${target.name} fell asleep!`);
      }
      break;
  }
}

function applyTerrain(
  state: BattleState,
  center: Vec2,
  terrainType: TerrainType,
  duration: number,
  radius: number,
  log: string[]
): void {
  const allTiles = generateGrid(GameConstants.GridRadius);
  const validKeys = new Set(allTiles.map(tileKey));

  const tilesToMark: Vec2[] = [center];
  if (radius > 0) {
    for (const tile of allTiles) {
      if (hexDistance(tile, center) <= radius) tilesToMark.push(tile);
    }
  }

  for (const tile of tilesToMark) {
    const key = tileKey(tile);
    if (validKeys.has(key)) {
      state.terrain.set(key, { type: terrainType, turnsLeft: duration });
    }
  }
  log.push(`${TerrainType[terrainType]} appeared for ${duration} turns!`);
}

export function endTurn(state: BattleState): string[] {
  const log: string[] = [];

  // Terrain damage
  for (const actor of [state.p1, state.p2]) {
    if (!actor.isAlive) continue;
    const key = tileKey(actor.tile);
    const terrain = state.terrain.get(key);
    if (terrain) {
      if (terrain.type === TerrainType.BurnZone) {
        const dmg = Math.max(1, Math.floor(actor.maxHp * GameConstants.BurnZoneDamageRatio));
        actor.takeDamage(dmg);
        log.push(`${actor.name} took ${dmg} damage from Burn Zone!`);
      }
      if (terrain.type === TerrainType.PoisonTrap) {
        const dmg = Math.max(1, Math.floor(actor.maxHp / 8));
        actor.takeDamage(dmg);
        log.push(`${actor.name} took ${dmg} damage from Poison Trap!`);
      }
      if (terrain.type === TerrainType.IceZone) {
        const dmg = Math.max(1, Math.floor(actor.maxHp * GameConstants.IceDamageRatio));
        actor.takeDamage(dmg);
        log.push(`${actor.name} took ${dmg} damage from Ice Zone!`);
      }
      if (terrain.type === TerrainType.PerishTrap) {
        if (actor.perishCountdown < 0) actor.perishCountdown = 3;
        actor.perishCountdown--;
        log.push(`${actor.name}'s Perish count is ${actor.perishCountdown}!`);
        if (actor.perishCountdown <= 0) {
          actor.takeDamage(actor.currentHp);
          log.push(`${actor.name} fainted from Perish Song!`);
        }
      }
    }
    // Burn status damage
    if (actor.status.has(StatusCondition.Burned)) {
      const dmg = Math.max(1, Math.floor(actor.maxHp / 16));
      actor.takeDamage(dmg);
      log.push(`${actor.name} is hurt by its burn! (${dmg} dmg)`);
    }
  }

  // Tick down terrain
  for (const [key, t] of state.terrain) {
    t.turnsLeft--;
    if (t.turnsLeft <= 0) {
      state.terrain.delete(key);
      log.push(`${TerrainType[t.type]} on tile ${key} faded.`);
    }
  }

  // Tick down cooldowns
  for (const actor of [state.p1, state.p2]) {
    for (const [moveId, cd] of actor.cooldowns) {
      if (cd > 0) actor.cooldowns.set(moveId, cd - 1);
    }
  }

  return log;
}
