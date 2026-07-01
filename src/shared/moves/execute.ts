/**
 * executeMove + terrain/status sub-executors. Faithful port of hex_battle.py
 * _execute_terrain_move / _execute_status_move / execute_move (~3229-3768).
 *
 * All randomness threads through the injected RNG.
 */

import { ActionOrder, MoveCategory, PokemonStatus, TerrainType } from '../core/enums.ts';
import { MoveDefinition } from './moveDefinition.ts';
import { Pokemon } from '../model/pokemon.ts';
import { TerrainManager } from '../terrain/terrainManager.ts';
import { TurnDeclaration } from '../engine/declaration.ts';
import { RNG } from '../rng.ts';
import { getMove, moveType } from '../data/moves.ts';
import { getTypeEffectiveness } from '../core/typechart.ts';
import {
  Tile,
  tileKey,
  keyToTile,
  hexDistance,
  hexNeighbors,
  hexLineTiles,
  hasLineOfSight,
  getHexArea,
  HEX_GRID,
} from '../core/hex.ts';
import {
  calculateDamage,
  getHexPower,
  getMoveTypeMult,
  getWeatherMult,
  momentumMultiplier,
  rollCrit,
  voltTackleRecoilMultiplier,
} from './damage.ts';
import {
  QA_MOVE_FIRST_POWER_MIN,
  QA_MOVE_FIRST_POWER_PENALTY,
  QA_ATTACK_FIRST_POWER_MULT,
  TERRAIN_DURATION_MINOR,
  TERRAIN_DURATION_MODERATE,
  ELECTRO_WEB_SPEED_STAGES,
  PERISH_COUNTDOWN_TURNS,
} from '../core/constants.ts';

/** Result of executing a move. */
export interface MoveResult {
  hit: boolean;
  damageDealt: number;
  recoilDealt: number;
  tilesHit: Set<string>;
  terrainPlaced: Array<[Tile, string]>;
  terrainDestroyed: Array<[Tile, string]>;
  /** [playerId, effectOrStat, deltaOrTurns, reasonOrNewStage] */
  statChanges: Array<[number, string, number, string | number]>;
  selfStatChanges: Array<[number, string, number, number]>;
  momentumMult: number;
  powerMult: number;
  boostMult: number;
  typeMult: number;
  weatherMult: number;
  crit: boolean;
  qaFailed: boolean;
  suckerPunchFailed: boolean;
  flinched: boolean;
  qaLandedAt: Tile | null;
  missReason: string;
  logLines: string[];
}

function newResult(): MoveResult {
  return {
    hit: false,
    damageDealt: 0,
    recoilDealt: 0,
    tilesHit: new Set(),
    terrainPlaced: [],
    terrainDestroyed: [],
    statChanges: [],
    selfStatChanges: [],
    momentumMult: 1.0,
    powerMult: 1.0,
    boostMult: 1.0,
    typeMult: 1.0,
    weatherMult: 1.0,
    crit: false,
    qaFailed: false,
    suckerPunchFailed: false,
    flinched: false,
    qaLandedAt: null,
    missReason: '',
    logLines: [],
  };
}

function totalMultiplier(r: MoveResult): number {
  return r.momentumMult * r.powerMult * r.boostMult * r.typeMult * r.weatherMult;
}

// ── QA helpers ───────────────────────────────
export function qaPowerMultiplier(tilesMoved: number, order: ActionOrder | null): number {
  if (order === ActionOrder.ATTACK_FIRST) return QA_ATTACK_FIRST_POWER_MULT;
  return Math.max(QA_MOVE_FIRST_POWER_MIN, 1.0 - tilesMoved * QA_MOVE_FIRST_POWER_PENALTY);
}

function qaCheckStraightLine(
  attackerTile: Tile,
  defenderTile: Tile,
  barrierTiles: ReadonlySet<string>,
): boolean {
  const line = hexLineTiles(attackerTile[0], attackerTile[1], defenderTile[0], defenderTile[1]);
  for (let i = 1; i < line.length; i++) {
    if (barrierTiles.has(tileKey(line[i][0], line[i][1]))) return false;
  }
  return true;
}

function qaLandingTile(
  attackerTile: Tile,
  defenderTile: Tile,
  blockedTiles: ReadonlySet<string>,
  occupiedTiles: ReadonlySet<string>,
  grid: ReadonlySet<string>,
): Tile | null {
  const candidates: Tile[] = [];
  for (const [nq, nr] of hexNeighbors(defenderTile[0], defenderTile[1])) {
    const key = tileKey(nq, nr);
    if (grid.has(key) && !blockedTiles.has(key) && !occupiedTiles.has(key)) {
      candidates.push([nq, nr]);
    }
  }
  if (candidates.length === 0) return null;
  let best = candidates[0];
  let bestDist = hexDistance(attackerTile[0], attackerTile[1], best[0], best[1]);
  for (const c of candidates.slice(1)) {
    const d = hexDistance(attackerTile[0], attackerTile[1], c[0], c[1]);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

function resolveAoe(move: MoveDefinition, targetTile: Tile, grid: ReadonlySet<string>): Set<string> {
  if (move.aoeRadius > 0) return getHexArea(targetTile[0], targetTile[1], move.aoeRadius, grid);
  const key = tileKey(targetTile[0], targetTile[1]);
  return grid.has(key) ? new Set([key]) : new Set();
}

function validateMove(
  move: MoveDefinition,
  attacker: Pokemon,
  targetTile: Tile,
  straightTiles: number,
  barrierTiles: ReadonlySet<string>,
  grid: ReadonlySet<string>,
): { ok: boolean; reason: string } {
  if (!grid.has(tileKey(targetTile[0], targetTile[1]))) {
    return { ok: false, reason: 'Target tile outside battlefield.' };
  }
  if (!attacker.isAlive) return { ok: false, reason: 'Attacker has fainted.' };
  if (!move.isRanged && !move.bypassesLos) {
    const dist = hexDistance(attacker.tile[0], attacker.tile[1], targetTile[0], targetTile[1]);
    if (dist !== 1) return { ok: false, reason: `${move.name} is melee — must be adjacent (distance=${dist}).` };
  }
  if (move.requiresLos && !move.bypassesLos) {
    const { clear } = hasLineOfSight(
      attacker.tile[0],
      attacker.tile[1],
      targetTile[0],
      targetTile[1],
      barrierTiles,
    );
    if (!clear) return { ok: false, reason: 'Line of sight blocked.' };
  }
  if (move.needsMomentum && straightTiles < 1) {
    return { ok: false, reason: `${move.name} requires ≥1 straight tile of approach.` };
  }
  return { ok: true, reason: 'OK' };
}

// ── Terrain moves ────────────────────────────
const MOVE_TO_TERRAIN: Record<string, TerrainType> = {
  'Will-O-Wisp': TerrainType.BURN_ZONE,
  'Misty Terrain': TerrainType.MIST_ZONE,
  'Stealth Rock': TerrainType.ROCK_TRAP,
  'Toxic Spikes': TerrainType.POISON_TRAP,
  'Smokescreen Field': TerrainType.FOG_ZONE,
  'Metal Sound Field': TerrainType.RESONANCE_ZONE,
  'Perish Trap': TerrainType.PERISH_ZONE,
  Hail: TerrainType.ICE_ZONE,
  'Electro Web': TerrainType.SLOW_ZONE,
};

function executeTerrainMove(
  move: MoveDefinition,
  attacker: Pokemon,
  targetTile: Tile | null,
  tm: TerrainManager,
  grid: ReadonlySet<string>,
): MoveResult {
  const result = newResult();
  result.hit = true;

  if (move.name === 'Sunny Day' || move.name === 'Rain Dance') {
    const tt = move.name === 'Sunny Day' ? TerrainType.SUNNY_ZONE : TerrainType.RAIN_ZONE;
    tm.addTerrain(attacker.tile, tt, attacker.playerId, TERRAIN_DURATION_MINOR + 1);
    result.terrainPlaced.push([attacker.tile, tt]);
    result.logLines.push(`${attacker.logName} (P${attacker.playerId}) summoned ${move.name}!`);
    return result;
  }

  const center = targetTile ?? attacker.tile;
  const aoe = resolveAoe(move, center, grid);
  result.tilesHit = aoe;

  const terrainType = MOVE_TO_TERRAIN[move.name];
  if (terrainType === undefined) {
    result.logLines.push(`No terrain mapping for ${move.name}`);
    return result;
  }

  let placed = 0;
  for (const key of aoe) {
    const tile = keyToTile(key);
    const existing = tm.getTerrain(tile);
    if (existing && existing.isPermanent) continue;
    tm.addTerrain(tile, terrainType, attacker.playerId, TERRAIN_DURATION_MODERATE);
    result.terrainPlaced.push([tile, terrainType]);
    placed++;
  }
  result.logLines.push(
    `${attacker.logName} (P${attacker.playerId}) used ${move.name}! Placed ${terrainType} on ${placed} tile(s).`,
  );
  if (move.name === 'Electro Web' && placed > 0) {
    result.logLines.push(`Entering the web field applies ${ELECTRO_WEB_SPEED_STAGES} Speed stage(s).`);
  }
  if (move.name === 'Perish Trap' && placed > 0) {
    result.logLines.push(`Ending a turn in the zone: ${PERISH_COUNTDOWN_TURNS} turns before fainting.`);
  }
  return result;
}

// ── Status moves ─────────────────────────────
function executeStatusMove(
  move: MoveDefinition,
  attacker: Pokemon,
  defender: Pokemon,
): MoveResult {
  const result = newResult();
  const n = move.name;

  if (n === 'Calm Mind' || n === 'Swords Dance' || n === 'Nasty Plot') {
    result.hit = true;
    if (n === 'Swords Dance') {
      const { newStage } = attacker.applyStatStage('attack', 2);
      result.selfStatChanges.push([attacker.playerId, 'attack', 2, newStage]);
      result.logLines.push(`${attacker.logName}'s Attack sharply rose! (stage ${newStage})`);
    } else if (n === 'Nasty Plot') {
      const { newStage } = attacker.applyStatStage('sp_atk', 2);
      result.selfStatChanges.push([attacker.playerId, 'sp_atk', 2, newStage]);
      result.logLines.push(`${attacker.logName}'s Sp. Atk sharply rose! (stage ${newStage})`);
    } else {
      const n1 = attacker.applyStatStage('sp_atk', 1).newStage;
      const n2 = attacker.applyStatStage('sp_def', 1).newStage;
      result.selfStatChanges.push([attacker.playerId, 'sp_atk', 1, n1]);
      result.selfStatChanges.push([attacker.playerId, 'sp_def', 1, n2]);
      result.logLines.push(`${attacker.logName} calmed its mind. Sp. Atk and Sp. Def rose.`);
    }
    return result;
  }

  if (n === 'Hypnosis') {
    result.hit = true;
    result.statChanges.push([defender.playerId, 'hypnosis', -2, 'hypnosis']);
    result.logLines.push(`${defender.logName} fell asleep! Movement skipped next turn.`);
    return result;
  }

  if (n === 'Thunder Wave') {
    result.hit = true;
    const applied = defender.applyStatus(PokemonStatus.PARALYZED);
    if (applied) {
      result.statChanges.push([defender.playerId, 'paralyzed', 0, 'thunder_wave']);
      result.logLines.push(`${defender.logName} is paralyzed! Speed halved.`);
    } else {
      result.logLines.push(`${defender.logName} is already afflicted with a status condition!`);
    }
    return result;
  }

  if (n === 'Taunt') {
    result.hit = true;
    result.statChanges.push([defender.playerId, 'taunted', 2, 'taunt']);
    result.logLines.push(`${defender.logName} fell for the taunt! Only attack moves for 2 turns.`);
    return result;
  }

  if (n === 'Pain Split') {
    result.hit = true;
    const total = attacker.currentHp + defender.currentHp;
    const avg = Math.trunc(total / 2);
    const oldDef = defender.currentHp;
    const oldAtt = attacker.currentHp;
    defender.currentHp = Math.min(defender.maxHp, avg);
    attacker.currentHp = Math.min(attacker.maxHp, avg);
    if (defender.currentHp === 0) defender.status = PokemonStatus.FAINTED;
    if (attacker.currentHp === 0) attacker.status = PokemonStatus.FAINTED;
    result.damageDealt = Math.max(0, oldDef - defender.currentHp);
    result.logLines.push(
      `${attacker.logName} shared the pain! Both HP set to ${avg}. (P${attacker.playerId}: ${oldAtt}->${attacker.currentHp}, P${defender.playerId}: ${oldDef}->${defender.currentHp})`,
    );
    return result;
  }

  if (n === 'Destiny Bond') {
    result.hit = true;
    result.statChanges.push([attacker.playerId, 'destiny_bond', 1, 'destiny_bond']);
    result.logLines.push(`${attacker.logName} bound its fate to the opponent's!`);
    return result;
  }

  result.logLines.push(`Status move ${n} has no handler yet.`);
  return result;
}

// ── Main execute ─────────────────────────────
export interface ExecuteOptions {
  targetTile: Tile | null;
  straightTiles: number;
  tilesMoved?: number;
  actionOrder?: ActionOrder | null;
  defenderDeclaration?: TurnDeclaration | null;
  grid?: ReadonlySet<string>;
}

export function executeMove(
  move: MoveDefinition,
  attacker: Pokemon,
  defender: Pokemon,
  tm: TerrainManager,
  rng: RNG,
  opts: ExecuteOptions,
): MoveResult {
  const grid = opts.grid ?? HEX_GRID;
  const actionOrder = opts.actionOrder ?? null;
  const tilesMoved = opts.tilesMoved ?? 0;
  const n = move.name;

  if (move.category === MoveCategory.TERRAIN) {
    return executeTerrainMove(move, attacker, opts.targetTile, tm, grid);
  }
  if (move.category === MoveCategory.STATUS) {
    return executeStatusMove(move, attacker, defender);
  }

  const result = newResult();
  let targetTile = opts.targetTile;

  // Sucker Punch conditional
  if (n === 'Sucker Punch') {
    const decl = opts.defenderDeclaration ?? null;
    let defenderUsedAttack = false;
    if (decl) {
      const dm = getMove(decl.moveName);
      defenderUsedAttack =
        dm !== undefined &&
        (dm.category === MoveCategory.PHYSICAL || dm.category === MoveCategory.SPECIAL);
    }
    if (!defenderUsedAttack) {
      result.suckerPunchFailed = true;
      result.missReason = "Sucker Punch failed — target didn't declare an attack.";
      result.logLines.push(`${attacker.logName} used Sucker Punch! But it failed.`);
      return result;
    }
  }

  // QA move-first: auto-target
  if (n === 'Quick Attack' && actionOrder === ActionOrder.MOVE_FIRST) {
    const barriers = tm.blockedMovementTiles;
    if (!qaCheckStraightLine(attacker.tile, defender.tile, barriers)) {
      result.qaFailed = true;
      result.missReason = 'Quick Attack (move-first) failed — barrier blocks path.';
      result.logLines.push(`${attacker.logName} used Quick Attack! FAILED — barrier blocks path.`);
      return result;
    }
    targetTile = defender.tile;
    result.logLines.push(`${attacker.logName} used Quick Attack! Dashes toward opponent.`);
  } else {
    if (targetTile === null) {
      result.missReason = 'No target tile declared.';
      result.logLines.push(`${attacker.logName}: ${n} failed — no target.`);
      return result;
    }
    const barriers = tm.blockedLosTiles;
    const { ok, reason } = validateMove(move, attacker, targetTile, opts.straightTiles, barriers, grid);
    if (!ok) {
      result.missReason = reason;
      result.logLines.push(`${attacker.logName}: ${n} failed — ${reason}`);
      return result;
    }
  }

  // Focus Blast accuracy (70%)
  if (n === 'Focus Blast') {
    if (rng() > 0.7) {
      result.missReason = 'Focus Blast missed (70% accuracy).';
      result.logLines.push(`${attacker.logName} used Focus Blast! But it missed!`);
      return result;
    }
  }

  if (!move.alwaysHits) result.crit = rollCrit(move, rng);

  result.momentumMult = move.needsMomentum ? momentumMultiplier(opts.straightTiles) : 1.0;
  result.powerMult = n === 'Quick Attack' ? qaPowerMultiplier(tilesMoved, actionOrder) : 1.0;
  result.boostMult = move.needsMomentum ? 1.0 : attacker.boostMult;
  result.typeMult = getMoveTypeMult(move, defender);
  result.weatherMult = getWeatherMult(move, tm);

  const hexPower = getHexPower(move, defender, tm);

  // targetTile is guaranteed non-null here (validated above or set to defender.tile).
  const aoe = resolveAoe(move, targetTile as Tile, grid);
  result.tilesHit = aoe;

  // Terrain destruction (physical)
  if (move.category === MoveCategory.PHYSICAL) {
    for (const key of aoe) {
      const tile = keyToTile(key);
      if (tm.hasTerrain(tile)) {
        for (const name of tm.damageTerrainAt(tile, 1)) {
          result.terrainDestroyed.push([tile, name]);
          result.logLines.push(`Terrain '${name}' at ${key} destroyed!`);
        }
      }
    }
  }

  // Type immunity
  if (result.typeMult === 0.0) {
    result.missReason = 'No effect (type immunity).';
    result.logLines.push(`It had no effect on ${defender.logName}!`);
    return result;
  }

  const defenderKey = tileKey(defender.tile[0], defender.tile[1]);
  if (!defender.isAlive) {
    result.missReason = 'Defender already fainted.';
    result.logLines.push(`${defender.logName} already fainted.`);
  } else if (aoe.has(defenderKey)) {
    const dmg = calculateDamage(move, attacker, defender, {
      momentum: result.momentumMult,
      powerMult: result.powerMult,
      boostMult: result.boostMult,
      typeMult: result.typeMult,
      weatherMult: result.weatherMult,
      crit: result.crit,
      hexPower,
    });
    const actual = defender.takeDamage(dmg);
    result.hit = true;
    result.damageDealt = actual;
    const total = totalMultiplier(result);
    result.logLines.push(
      `HIT! ${defender.logName} (P${defender.playerId}) took ${actual} dmg${Math.abs(total - 1.0) > 0.01 ? ` x${total.toFixed(2)}` : ''}. HP: ${defender.currentHp}/${defender.maxHp}`,
    );
    if (!defender.isAlive) result.logLines.push(`${defender.logName} fainted!`);

    // ── Secondary effects on hit ──
    if (n === 'Fire Fang' && rng() < 0.1) {
      if (defender.applyStatus(PokemonStatus.BURNED)) {
        result.statChanges.push([defender.playerId, 'burned', 0, 'fire_fang']);
        result.logLines.push(`${defender.logName} was burned!`);
      }
    }
    if (n === 'Discharge' && rng() < 0.3) {
      const immune = getTypeEffectiveness(moveType(n), defender.types) === 0.0;
      if (!immune && defender.applyStatus(PokemonStatus.PARALYZED)) {
        result.statChanges.push([defender.playerId, 'paralyzed', 0, 'discharge']);
        result.logLines.push(`${defender.logName} is paralyzed!`);
      }
    }
    if ((n === 'Air Slash' || n === 'Dark Pulse') && rng() < 0.3) {
      result.flinched = true;
      result.logLines.push(`${defender.logName} flinched! Movement skipped next turn.`);
    }
    if (n === 'Shadow Ball' && rng() < 0.2) {
      if (!tm.isMistProtected(defender.tile)) {
        const { newStage } = defender.applyStatStage('sp_def', -1);
        result.statChanges.push([defender.playerId, 'sp_def', -1, newStage]);
        result.logLines.push(`${defender.logName}'s Sp. Def fell! (stage ${newStage})`);
      }
    }
    if (n === 'Moonblast' && rng() < 0.3) {
      if (!tm.isMistProtected(defender.tile)) {
        const { newStage } = defender.applyStatStage('sp_atk', -1);
        result.statChanges.push([defender.playerId, 'sp_atk', -1, newStage]);
        result.logLines.push(`${defender.logName}'s Sp. Atk fell! (stage ${newStage})`);
      }
    }

    // Recoil (Volt Tackle)
    if (move.recoilFraction > 0 && actual > 0) {
      const recoilMult = voltTackleRecoilMultiplier(result.momentumMult);
      const recoilRaw = Math.floor(actual * move.recoilFraction * recoilMult);
      result.recoilDealt = attacker.takeDamage(Math.max(1, recoilRaw));
      result.logLines.push(
        `${attacker.logName} was hurt by recoil! (-${result.recoilDealt} HP). HP: ${attacker.currentHp}/${attacker.maxHp}`,
      );
      if (!attacker.isAlive) result.logLines.push(`${attacker.logName} fainted from recoil!`);
    }

    // Self-debuff (Close Combat)
    if (Object.keys(move.selfDebuff).length > 0 && result.hit) {
      for (const [stat, delta] of Object.entries(move.selfDebuff)) {
        const { newStage } = attacker.applyStatStage(stat as never, delta);
        result.selfStatChanges.push([attacker.playerId, stat, delta, newStage]);
        result.logLines.push(`${attacker.logName}'s ${stat} fell! (stage ${newStage})`);
      }
    }
  } else {
    result.missReason = `${defender.logName} not in AOE.`;
    result.logLines.push(`Miss — ${result.missReason}`);
  }

  // QA landing
  if (n === 'Quick Attack') {
    const blocked = tm.blockedMovementTiles;
    const occupied = new Set([defenderKey]);
    const landing = qaLandingTile(attacker.tile, defender.tile, blocked, occupied, grid);
    if (landing) {
      attacker.moveTo(landing);
      result.qaLandedAt = landing;
      result.logLines.push(`${attacker.logName} lands at ${tileKey(landing[0], landing[1])} adjacent to opponent.`);
    } else {
      result.logLines.push(`${attacker.logName} could not find adjacent landing tile.`);
    }
  }

  return result;
}
