/**
 * executeMove + terrain/status sub-executors. Faithful port of hex_battle.py
 * _execute_terrain_move / _execute_status_move / execute_move (~3229-3768).
 *
 * All randomness threads through the injected RNG.
 */

import { ActionOrder, MoveCategory, PokemonStatus, TerrainType } from '../core/enums.ts';
import { MoveDefinition } from './moveDefinition.ts';
import { Pokemon } from '../model/pokemon.ts';
import { TerrainManager, isGrounded, type GrassFireSplit } from '../terrain/terrainManager.ts';
import { TurnDeclaration } from '../engine/declaration.ts';
import { RNG } from '../rng.ts';
import { isSelfArea, quakeZone, quakeLanding } from './quake.ts';
import { isGrassTile } from '../terrain/grass.ts';
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
  sandSpDefMult,
  terrainPulseType,
  momentumMultiplier,
  chargeMultiplier,
  chargesUp,
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
  TILTED_DURATION,
  GRASS_FIRE_DURATION, ICE_BEAM_FREEZE_CHANCE, FREEZE_RAIN_MULT, FREEZE_MELT_FIRE_MULT, THUNDER_ACCURACY,
  FIELD_DURATION, TERRAIN_PULSE_POWER_MULT } from '../core/constants.ts';

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
  /** A ranged special move's charge from unused movement (chargeMultiplier). */
  chargeMult: number;
  /** A clash won by this beam: how decisively (the margin, 0..1, scaling its damage). 1 = no clash. */
  clashMult: number;
  powerMult: number;
  boostMult: number;
  typeMult: number;
  weatherMult: number;
  crit: boolean;
  qaFailed: boolean;
  suckerPunchFailed: boolean;
  flinched: boolean;
  qaLandedAt: Tile | null;
  /** What firing it cost its user (Steel Beam: half its max HP). */
  selfCost: number;
  /** Thrown off its tile by the attack (Earthquake): where from, where to. */
  knockback: { playerId: number; from: Tile; to: Tile } | null;
  /** The defender dodged it (an accuracy miss): it side-stepped to a tile beside it, out of the way. */
  dodge: { playerId: number; from: Tile; to: Tile } | null;
  missReason: string;
  logLines: string[];
}

export function newResult(): MoveResult {
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
    chargeMult: 1.0,
    clashMult: 1.0,
    powerMult: 1.0,
    boostMult: 1.0,
    typeMult: 1.0,
    weatherMult: 1.0,
    crit: false,
    qaFailed: false,
    suckerPunchFailed: false,
    flinched: false,
    qaLandedAt: null,
    knockback: null,
    dodge: null,
    selfCost: 0,
    missReason: '',
    logLines: [],
  };
}

function totalMultiplier(r: MoveResult): number {
  return r.momentumMult * r.chargeMult * r.clashMult * r.powerMult * r.boostMult * r.typeMult * r.weatherMult;
}

/**
 * Light the grass on the line from `attacker` to `to` (not its own tile):
 * burn zones, the grass scorched away. `upTo` (0..1) stops it that share of
 * the way (a beam held in a clash, up to where the beams meet); `split` marks
 * the fires as half of a tied clash's (GrassFireSplit). A grass fire already
 * on its line, lit by another, becomes this one's (its beam has taken it over).
 */
/**
 * Does the move scale with momentum (its straight run-up before it, +a share
 * a tile up to the cap, no early-stop boost on top)? Every physical attack does
 * — rams among them — and the momentum moves; not a priority move (Quick
 * Attack, Bullet Punch, Sucker Punch…), which strikes first instead.
 */
export function scalesWithMomentum(move: MoveDefinition): boolean {
  if (move.quickPriority) return false;
  return move.needsMomentum || move.isRam || move.category === MoveCategory.PHYSICAL;
}

export function burnGrass(attacker: Pokemon, to: Tile, tm: TerrainManager, grid: ReadonlySet<string>, result: MoveResult,
  opts: { upTo?: number; split?: GrassFireSplit } = {}): void {
  const line = hexLineTiles(attacker.tile[0], attacker.tile[1], to[0], to[1]).slice(1);
  const upTo = opts.upTo ?? 1;
  line.forEach((tile, i) => {
    if ((i + 1) / line.length > upTo + 1e-9) return;
    burnGrassTile(attacker, tile, tm, grid, result, opts.split);
  });
}

/** Set one tile's grass alight (not under its attacker; one already burning is taken over). */
export function burnGrassTile(attacker: Pokemon, tile: Tile, tm: TerrainManager, grid: ReadonlySet<string>, result: MoveResult,
  split?: GrassFireSplit): void {
  const key = tileKey(tile[0], tile[1]);
  if (!grid.has(key) || attacker.tiles.some((t) => t[0] === tile[0] && t[1] === tile[1])) return;
  const there = tm.getTerrain(tile);
  if (there?.grassFire) {
    // Already burning: this fire takes it (unless both halves of a tie meet here).
    if (split) { there.split = split; return; }
    there.owner = attacker.playerId;
    there.split = null;
    return;
  }
  if (!isGrassTile(tile[0], tile[1]) || tm.isScorched(tile) || there) return;
  const fire = tm.addTerrain(tile, TerrainType.BURN_ZONE, attacker.playerId, GRASS_FIRE_DURATION);
  fire.grassFire = true;
  fire.split = split ?? null;
  tm.scorch(tile);
  result.terrainPlaced.push([tile, TerrainType.BURN_ZONE]);
  result.logLines.push(`The grass at ${key} caught fire!`);
}

/** A move that costs its user HP to fire (selfHpCost): pay it, once fired. */
export function payHpCost(move: MoveDefinition, attacker: Pokemon, result: MoveResult): void {
  if (move.selfHpCost <= 0 || !attacker.isAlive) return;
  result.selfCost = attacker.takeDamage(Math.max(1, Math.floor(attacker.maxHp * move.selfHpCost)));
  result.logLines.push(`${attacker.logName} paid ${result.selfCost} HP to fire ${move.name}! HP: ${attacker.currentHp}/${attacker.maxHp}`);
  if (!attacker.isAlive) result.logLines.push(`${attacker.logName} fainted!`);
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

/**
 * Where a double-pass dash (Aerial Ace) pulls up: the tile two short of its
 * target on the straight line it came in on (where it stood, if that is
 * nearer); if that tile is taken, the nearest free one before it on the line,
 * back to its start.
 */
function passLandingTile(
  attackerTile: Tile,
  defenderTile: Tile,
  blockedTiles: ReadonlySet<string>,
  occupiedTiles: ReadonlySet<string>,
  grid: ReadonlySet<string>,
): Tile {
  const line = hexLineTiles(attackerTile[0], attackerTile[1], defenderTile[0], defenderTile[1]);
  for (let i = Math.max(0, line.length - 3); i > 0; i--) {
    const key = tileKey(line[i][0], line[i][1]);
    if (grid.has(key) && !blockedTiles.has(key) && !occupiedTiles.has(key)) return line[i];
  }
  return attackerTile;
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
  // The free neighbour nearest the path it dashed along (the straight line
  // from where it stood to the target); of two as near, the one nearer its start.
  const centre = (t: Tile): [number, number] => [Math.sqrt(3) * (t[0] + t[1] / 2), 1.5 * t[1]];
  const [ax, ay] = centre(attackerTile), [dx, dy] = centre(defenderTile);
  const fromPath = (t: Tile): number => {
    const [px, py] = centre(t);
    const vx = dx - ax, vy = dy - ay, L2 = vx * vx + vy * vy;
    const k = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2)) : 0;
    return Math.hypot(px - (ax + k * vx), py - (ay + k * vy));
  };
  let best = candidates[0];
  let bestPath = fromPath(best), bestDist = hexDistance(attackerTile[0], attackerTile[1], best[0], best[1]);
  for (const c of candidates.slice(1)) {
    const p = fromPath(c), d = hexDistance(attackerTile[0], attackerTile[1], c[0], c[1]);
    if (p < bestPath - 1e-6 || (Math.abs(p - bestPath) <= 1e-6 && d < bestDist)) {
      best = c;
      bestPath = p;
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

/** The tile of `tiles` nearest to `target`. */
function nearestTile(tiles: Tile[], target: Tile): Tile {
  let best = tiles[0], bd = Infinity;
  for (const t of tiles) { const d = hexDistance(t[0], t[1], target[0], target[1]); if (d < bd) { bd = d; best = t; } }
  return best;
}

export function validateMove(
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
  // A huge attacker reaches from its nearest tile.
  const near = nearestTile(attacker.tiles, targetTile);
  if (!move.isRanged && !move.bypassesLos) {
    const dist = hexDistance(near[0], near[1], targetTile[0], targetTile[1]);
    if (dist !== 1) return { ok: false, reason: `${move.name} is melee — must be adjacent (distance=${dist}).` };
  }
  if (move.requiresLos && !move.bypassesLos) {
    const { clear } = hasLineOfSight(
      near[0],
      near[1],
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
  'Stealth Rock': TerrainType.ROCK_TRAP,
  'Toxic Spikes': TerrainType.POISON_TRAP,
  'Smokescreen Field': TerrainType.FOG_ZONE,
  'Perish Trap': TerrainType.PERISH_ZONE,
  'Electro Web': TerrainType.SLOW_ZONE,
};

/** Moves that set a weather or a terrain over the whole field (FIELD_DURATION turns, as in the games). */
const MOVE_TO_FIELD: Record<string, TerrainType> = {
  'Sunny Day': TerrainType.SUNNY_ZONE,
  'Rain Dance': TerrainType.RAIN_ZONE,
  Hail: TerrainType.HAIL,
  Sandstorm: TerrainType.SANDSTORM,
  'Electric Terrain': TerrainType.ELECTRIC_TERRAIN,
  'Grassy Terrain': TerrainType.GRASSY_TERRAIN,
  'Misty Terrain': TerrainType.MISTY_TERRAIN,
  'Psychic Terrain': TerrainType.PSYCHIC_TERRAIN,
};

/**
 * Misty Terrain keeps a grounded Pokémon from any status condition (burn,
 * paralysis, sleep, poison, freeze); Electric Terrain, from falling asleep.
 */
function terrainGuards(tm: TerrainManager, defender: Pokemon, sleep = false): string | null {
  if (!isGrounded(defender)) return null;
  const t = tm.fieldTerrain();
  if (t === TerrainType.MISTY_TERRAIN) return 'Misty Terrain';
  if (sleep && t === TerrainType.ELECTRIC_TERRAIN) return 'Electric Terrain';
  return null;
}

function executeTerrainMove(
  move: MoveDefinition,
  attacker: Pokemon,
  targetTile: Tile | null,
  tm: TerrainManager,
  grid: ReadonlySet<string>,
): MoveResult {
  const result = newResult();
  result.hit = true;

  const field = MOVE_TO_FIELD[move.name];
  if (field !== undefined) {
    tm.addTerrain(attacker.tile, field, attacker.playerId, FIELD_DURATION);
    result.terrainPlaced.push([attacker.tile, field]);
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
  tm: TerrainManager,
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
    const guard = terrainGuards(tm, defender, true);
    if (guard) {
      result.missReason = `${defender.logName} is protected by ${guard}.`;
      result.logLines.push(`${defender.logName} is protected by ${guard}! It won't fall asleep.`);
      return result;
    }
    result.hit = true;
    result.statChanges.push([defender.playerId, 'hypnosis', -2, 'hypnosis']);
    result.logLines.push(`${defender.logName} fell asleep! Movement skipped next turn.`);
    return result;
  }

  if (n === 'Metal Sound') {
    result.hit = true;
    const { newStage } = defender.applyStatStage('sp_def', -2);
    result.statChanges.push([defender.playerId, 'sp_def', -2, newStage]);
    result.logLines.push(`${defender.logName}'s Sp. Def harshly fell! (stage ${newStage})`);
    return result;
  }

  if (n === 'Thunder Wave') {
    const guard = terrainGuards(tm, defender);
    if (guard) {
      result.missReason = `${defender.logName} is protected by ${guard}.`;
      result.logLines.push(`${defender.logName} is protected by ${guard}!`);
      return result;
    }
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
  /** Movement left unused this turn: a ranged special move charges with it (chargeMultiplier). */
  chargeTiles?: number;
  /** Won a beam clash: its damage × this margin (moves/clash.ts). */
  clashMult?: number;
  actionOrder?: ActionOrder | null;
  defenderDeclaration?: TurnDeclaration | null;
  grid?: ReadonlySet<string>;
  /** The battle's turn (1 = its first): Fake Out and First Impression work only then. */
  turnNumber?: number;
  /** A ram that won a ram clash: no landing beside the target and no knockback here (the clash places both). */
  ramClash?: boolean;
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
    return executeStatusMove(move, attacker, defender, tm);
  }

  const result = newResult();
  let targetTile = opts.targetTile;

  // Psychic Terrain: a priority move cannot touch a grounded target.
  if (tm.hasPriority(move) && tm.fieldTerrain() === TerrainType.PSYCHIC_TERRAIN && isGrounded(defender)) {
    result.missReason = `${defender.logName} is protected by Psychic Terrain.`;
    result.logLines.push(`${attacker.logName} used ${n}! But ${defender.logName} is protected by Psychic Terrain!`);
    return result;
  }

  // Fake Out, First Impression: only on the battle's first turn.
  if ((n === 'Fake Out' || n === 'First Impression') && (opts.turnNumber ?? 1) > 1) {
    result.missReason = `${n} works only on the first turn.`;
    result.logLines.push(`${attacker.logName} used ${n}! But it failed.`);
    return result;
  }

  // Upper Hand: only against a target that declared a priority attack.
  if (n === 'Upper Hand') {
    const dm = opts.defenderDeclaration ? getMove(opts.defenderDeclaration.moveName) : undefined;
    if (!dm || dm.category === MoveCategory.STATUS || !tm.hasPriority(dm)) {
      result.missReason = "Upper Hand failed — target didn't declare a priority attack.";
      result.logLines.push(`${attacker.logName} used Upper Hand! But it failed.`);
      return result;
    }
  }

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

  const selfArea = isSelfArea(move);
  // A move centred on its user (Earthquake): no target to pick or check.
  if (selfArea) {
    if (!attacker.isAlive) {
      result.missReason = 'Attacker has fainted.';
      return result;
    }
    targetTile = attacker.tile;
    result.logLines.push(`${attacker.logName} used ${n}! The ground heaves round it.`);
  } else if (n === 'Quick Attack' && actionOrder === ActionOrder.MOVE_FIRST) {
    // QA move-first: auto-target
    const barriers = tm.movementBlockersFor(attacker);
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

  // Fired: it costs its user, hit or miss (Steel Beam).
  payHpCost(move, attacker, result);

  // Flamethrower sets the grass it passes over alight: every grass tile on
  // its line from the user to where it lands, if nothing stands on the tile.
  if (n === 'Flamethrower' && targetTile) burnGrass(attacker, targetTile, tm, grid, result);
  // Fire Spin sets the grass of the tile it spins on alight (only that tile).
  if (n === 'Fire Spin' && targetTile) burnGrassTile(attacker, targetTile, tm, grid, result);

  // Focus Blast accuracy (70%)
  if (n === 'Focus Blast') {
    if (rng() > 0.7) {
      result.missReason = 'Focus Blast missed (70% accuracy).';
      result.logLines.push(`${attacker.logName} used Focus Blast! But it missed!`);
      dodgeAside(attacker, defender, targetTile, tm, grid, result);
      return result;
    }
  }

  // Dragon Rush accuracy (75%).
  if (n === 'Dragon Rush' && rng() > DRAGON_RUSH_ACCURACY) {
    result.missReason = 'Dragon Rush missed (75% accuracy).';
    result.logLines.push(`${attacker.logName} used Dragon Rush! But it missed!`);
    dodgeAside(attacker, defender, targetTile, tm, grid, result);
    return result;
  }

  // Thunder accuracy (70%; it never misses in the rain).
  if (n === 'Thunder' && !tm.isRainy()) {
    if (rng() > THUNDER_ACCURACY) {
      result.missReason = 'Thunder missed (70% accuracy).';
      result.logLines.push(`${attacker.logName} used Thunder! But it missed!`);
      dodgeAside(attacker, defender, targetTile, tm, grid, result);
      return result;
    }
  }

  if (!move.alwaysHits) result.crit = n === 'Zippy Zap' || rollCrit(move, rng);

  // (Every physical attack is a momentum move: its straight run-up powers it — no early-stop boost on top.)
  const momentum = scalesWithMomentum(move);
  result.momentumMult = momentum ? momentumMultiplier(opts.straightTiles) : 1.0;
  result.powerMult = n === 'Quick Attack' ? qaPowerMultiplier(tilesMoved, actionOrder) : 1.0;
  result.chargeMult = chargesUp(move) ? chargeMultiplier(opts.chargeTiles ?? 0) : 1.0;
  result.clashMult = opts.clashMult ?? 1.0;
  // A charged move takes no early-stop boost on top: the unused tiles are its charge.
  result.boostMult = momentum || chargesUp(move) ? 1.0 : attacker.boostMult;
  result.typeMult = getMoveTypeMult(move, defender, tm, attacker);
  result.weatherMult = getWeatherMult(move, tm, attacker, defender);
  // Terrain Pulse under a terrain: the terrain's type (above), doubled.
  if (terrainPulseType(move, tm, attacker)) result.powerMult *= TERRAIN_PULSE_POWER_MULT;

  const hexPower = getHexPower(move, defender, tm);

  // targetTile is guaranteed non-null here (validated above or set to defender.tile).
  const aoe = selfArea ? quakeZone(attacker.tiles, grid) : resolveAoe(move, targetTile as Tile, grid);
  result.tilesHit = aoe;

  // Earthquake shatters the rocks in its zone (other attacks cannot touch
  // them) and fells the trees there, however sturdy.
  if (selfArea) {
    for (const key of aoe) {
      const tile = keyToTile(key);
      const type = tm.getTerrain(tile)?.terrainType;
      if (type !== TerrainType.ROCK && type !== TerrainType.TREE) continue;
      tm.removeTerrain(tile);
      result.terrainDestroyed.push([tile, type]);
      result.logLines.push(type === TerrainType.ROCK ? `The rock at ${key} shattered!` : `The tree at ${key} fell!`);
    }
  }

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

  // The heaved ground is left tilted inward, wherever nothing still stands on it.
  if (selfArea) {
    for (const key of aoe) {
      const tile = keyToTile(key);
      if (tm.hasTerrain(tile)) continue;
      tm.addTerrain(tile, TerrainType.TILTED, attacker.playerId, TILTED_DURATION).origin = attacker.tile;
      result.terrainPlaced.push([tile, TerrainType.TILTED]);
    }
  }

  // Type immunity
  if (result.typeMult === 0.0) {
    result.missReason = 'No effect (type immunity).';
    result.logLines.push(`It had no effect on ${defender.logName}!`);
    return result;
  }

  const defenderKey = tileKey(defender.tile[0], defender.tile[1]);
  // A huge defender is hit if the attack covers any of its tiles.
  const struck = defender.tiles.some((t) => aoe.has(tileKey(t[0], t[1])));
  if (!defender.isAlive) {
    result.missReason = 'Defender already fainted.';
    result.logLines.push(`${defender.logName} already fainted.`);
  } else if (struck) {
    // Frozen when it is hit: the ice breaks (and a Fire move spends some of itself melting it).
    const wasFrozen = defender.isFrozen;
    const fire = moveType(n) === 'Fire';
    const melt = wasFrozen && fire ? FREEZE_MELT_FIRE_MULT : 1;
    const dmg = move.fixedDamage > 0 ? move.fixedDamage : calculateDamage(move, attacker, defender, {
      momentum: result.momentumMult,
      powerMult: result.powerMult * result.chargeMult * result.clashMult * melt,
      boostMult: result.boostMult,
      typeMult: result.typeMult,
      weatherMult: result.weatherMult,
      crit: result.crit,
      hexPower,
      spDefMult: sandSpDefMult(move, tm, defender),
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
    const guarded = terrainGuards(tm, defender) !== null;
    if ((n === 'Fire Fang' || n === 'Flare Blitz') && !guarded && rng() < 0.1) {
      if (defender.applyStatus(PokemonStatus.BURNED)) {
        result.statChanges.push([defender.playerId, 'burned', 0, n === 'Fire Fang' ? 'fire_fang' : 'flare_blitz']);
        result.logLines.push(`${defender.logName} was burned!`);
      }
    }
    if (n === 'Discharge' && !guarded && rng() < 0.3) {
      const immune = getTypeEffectiveness(moveType(n), defender.types) === 0.0;
      if (!immune && defender.applyStatus(PokemonStatus.PARALYZED)) {
        result.statChanges.push([defender.playerId, 'paralyzed', 0, 'discharge']);
        result.logLines.push(`${defender.logName} is paralyzed!`);
      }
    }
    // Any hit ends a freeze: a Fire move melts the ice (in steam), anything else shatters it.
    if (defender.isAlive && wasFrozen) {
      defender.thaw();
      result.statChanges.push([defender.playerId, fire ? 'thawed' : 'shattered', 0, n]);
      result.logLines.push(fire ? `The heat melted ${defender.logName}'s ice!` : `${defender.logName}'s ice shattered!`);
    }
    // (Just broken out of the ice, it is not frozen again by the same hit.)
    const freezable = !wasFrozen;
    if (n === 'Tri Attack') {
      // Fire, electricity or ice: a burn, paralysis or a freeze, one in three each, 20% of the
      // time (Fire types do not burn, Electric types are not paralyzed, Ice types do not freeze).
      const pick = Math.min(2, Math.floor(rng() * 3));
      const chance = pick === 2 ? freezeChance(0.2, tm) : 0.2;
      if (!guarded && rng() < chance && (pick !== 2 || freezable)) {
        const status = [PokemonStatus.BURNED, PokemonStatus.PARALYZED, PokemonStatus.FROZEN][pick];
        const word = ['burned', 'paralyzed', 'frozen'][pick];
        const immune = defender.types.includes(['Fire', 'Electric', 'Ice'][pick]);
        if (defender.isAlive && !immune && defender.applyStatus(status)) {
          result.statChanges.push([defender.playerId, word, 0, 'tri_attack']);
          result.logLines.push(pick === 2 ? `${defender.logName} was frozen solid!` : `${defender.logName} was ${word}!`);
        }
      }
    }
    if (n === 'Ice Beam' && defender.isAlive && freezable && !guarded && rng() < freezeChance(ICE_BEAM_FREEZE_CHANCE, tm)) {
      if (defender.applyStatus(PokemonStatus.FROZEN)) {
        result.statChanges.push([defender.playerId, 'frozen', 0, 'ice_beam']);
        result.logLines.push(`${defender.logName} was frozen solid!`);
      }
    }
    // Flame Charge: its Speed rises a stage.
    if (n === 'Flame Charge') {
      const { newStage } = attacker.applyStatStage('speed', 1);
      result.selfStatChanges.push([attacker.playerId, 'speed', 1, newStage]);
      result.logLines.push(`${attacker.logName}'s Speed rose! (stage ${newStage})`);
    }
    if ((n === 'Fake Out' || n === 'Upper Hand') && defender.isAlive) {
      result.flinched = true;
      result.logLines.push(`${defender.logName} flinched! Movement skipped next turn.`);
    }
    if (n === 'Dragon Rush' && defender.isAlive && rng() < 0.2) {
      result.flinched = true;
      result.logLines.push(`${defender.logName} flinched! Movement skipped next turn.`);
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

    // Recoil (Volt Tackle, Head Smash…): more the more momentum it hit with.
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

    // Thrown out of the quake, to the first free tile just outside it.
    if (selfArea && defender.isAlive) {
      const occupied = new Set(attacker.tiles.map((t) => tileKey(t[0], t[1])));
      const landing = quakeLanding(defender, attacker.tiles, tm.movementBlockersFor(defender), occupied, grid);
      if (landing) {
        const from = defender.tile;
        defender.moveTo(landing);
        result.knockback = { playerId: defender.playerId, from, to: landing };
        result.logLines.push(`${defender.logName} was thrown to ${tileKey(landing[0], landing[1])}!`);
      }
    }
  } else {
    result.missReason = `${defender.logName} not in AOE.`;
    result.logLines.push(`Miss — ${result.missReason}`);
  }

  // A quick dash that made contact: it stops on the free tile beside the
  // target nearest the path it dashed along, and waits there.
  if (move.quickDash && result.hit && !opts.ramClash) {
    const blocked = tm.movementBlockersFor(attacker);
    const occupied = new Set(defender.tiles.map((t) => tileKey(t[0], t[1])));
    const landing = move.doublePass
      ? passLandingTile(attacker.tile, defender.tile, blocked, occupied, grid)
      : qaLandingTile(attacker.tile, defender.tile, blocked, occupied, grid);
    if (landing) {
      attacker.moveTo(landing);
      result.qaLandedAt = landing;
      result.logLines.push(`${attacker.logName} lands at ${tileKey(landing[0], landing[1])}${move.doublePass ? ', two tiles short of its opponent' : ' adjacent to opponent'}.`);
    } else {
      result.logLines.push(`${attacker.logName} could not find adjacent landing tile.`);
    }
  }

  // A ram attack (Flare Blitz, Take Down…): it runs into the target and knocks
  // it back a tile — straight on, or (nothing free there) to a free tile
  // beside it, the farthest from the attacker.
  if (move.isRam && result.hit && defender.isAlive && !defender.huge && !opts.ramClash) {
    const to = rammedTo(attacker, defender, tm, grid);
    if (to) {
      const from = defender.tile;
      defender.moveTo(to);
      result.knockback = { playerId: defender.playerId, from, to };
      result.logLines.push(`${defender.logName} was knocked back to ${tileKey(to[0], to[1])}!`);
    }
  }

  return result;
}

/**
 * An attack missed by its accuracy, its target dodges it: it side-steps to a
 * free tile beside it, out of the attack's way — the one most off to the
 * side of the line from the attacker, never toward it — if it stood where
 * the attack was aimed and can move (alive, not huge). Moves it, and notes
 * the dodge on `result`.
 */
function dodgeAside(attacker: Pokemon, defender: Pokemon, aimed: Tile | null | undefined, tm: TerrainManager,
  grid: ReadonlySet<string>, result: MoveResult): void {
  if (!defender.isAlive || defender.huge) return;
  if (aimed && !defender.tiles.some((t) => t[0] === aimed[0] && t[1] === aimed[1])) return;
  const blocked = tm.movementBlockersFor(defender);
  const theirs = new Set(attacker.tiles.map((t) => tileKey(t[0], t[1])));
  const plane = (t: Tile): [number, number] => [Math.sqrt(3) * (t[0] + t[1] / 2), 1.5 * t[1]];
  const from = defender.tile, pf = plane(from), pa = plane(attacker.tile);
  // The way the attack comes, attacker to target (unit, on the board's plane).
  let wx = pf[0] - pa[0], wy = pf[1] - pa[1];
  const wl = Math.hypot(wx, wy) || 1;
  wx /= wl; wy /= wl;
  let pick: Tile | null = null, best = -Infinity;
  for (const [q, r] of hexNeighbors(from[0], from[1])) {
    const k = tileKey(q, r);
    if (!grid.has(k) || blocked.has(k) || theirs.has(k)) continue;
    const p = plane([q, r]);
    const dx = p[0] - pf[0], dy = p[1] - pf[1];
    const along = dx * wx + dy * wy, aside = Math.abs(dx * wy - dy * wx);
    // (Never back toward the attacker; most to the side, a little on away.)
    if (along < -0.2) continue;
    const score = aside + 0.1 * along;
    if (score > best) { best = score; pick = [q, r]; }
  }
  if (!pick) return;
  defender.moveTo(pick);
  result.dodge = { playerId: defender.playerId, from, to: pick };
  result.logLines.push(`${defender.logName} dodged to ${tileKey(pick[0], pick[1])}!`);
}

/** Dragon Rush's accuracy (as in the games). */
const DRAGON_RUSH_ACCURACY = 0.75;

/** Where a rammed target is knocked to: the tile straight behind it, or else a free one beside it, the farthest from the attacker. */
function rammedTo(attacker: Pokemon, defender: Pokemon, tm: TerrainManager, grid: ReadonlySet<string>): Tile | null {
  const blocked = tm.movementBlockersFor(defender);
  const mine = new Set(attacker.tiles.map((t) => tileKey(t[0], t[1])));
  const free = (t: Tile) => { const k = tileKey(t[0], t[1]); return grid.has(k) && !blocked.has(k) && !mine.has(k); };
  const [dq, dr] = defender.tile, [aq, ar] = attacker.tile;
  // Straight on: one step further along from the attacker (if it stands beside it).
  if (hexDistance(aq, ar, dq, dr) === 1) {
    const behind: Tile = [dq + (dq - aq), dr + (dr - ar)];
    if (free(behind)) return behind;
  }
  let best: Tile | null = null, bestD = -1;
  for (const [nq, nr] of hexNeighbors(dq, dr)) {
    const t: Tile = [nq, nr];
    if (!free(t)) continue;
    const d = hexDistance(aq, ar, nq, nr);
    if (d > bestD) { best = t; bestD = d; }
  }
  return best;
}

/**
 * A move's chance to freeze, as the weather has it: none under the sun
 * (Sunny Day), more in the rain (Rain Dance: × FREEZE_RAIN_MULT).
 */
export function freezeChance(base: number, tm: TerrainManager): number {
  if (tm.isSunny()) return 0;
  return Math.min(1, base * (tm.isRainy() ? FREEZE_RAIN_MULT : 1));
}
