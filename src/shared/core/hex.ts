/**
 * Axial hex geometry (pointy-top). Faithful port of hex_battle.py lines ~573-782.
 *
 * A tile is an axial coordinate `[q, r]`. Because JS Sets/Maps use reference
 * equality for arrays, we key tiles by the string `"q,r"` via {@link tileKey}.
 */

import { GRID_RADIUS } from './constants.ts';

export type Tile = readonly [number, number];

export function tileKey(q: number, r: number): string {
  return `${q},${r}`;
}

export function keyToTile(key: string): Tile {
  const [q, r] = key.split(',').map(Number);
  return [q, r];
}

export function tilesEqual(a: Tile, b: Tile): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

// ── Cube coordinates ─────────────────────────────────────────

export function axialToCube(q: number, r: number): [number, number, number] {
  return [q, -q - r, r];
}

export function cubeToAxial(x: number, _y: number, z: number): [number, number] {
  return [x, z];
}

export function cubeRound(
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return [rx, ry, rz];
}

export function hexDistance(q1: number, r1: number, q2: number, r2: number): number {
  const [x1, y1, z1] = axialToCube(q1, r1);
  const [x2, y2, z2] = axialToCube(q2, r2);
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2), Math.abs(z1 - z2));
}

/** The six axial neighbor directions, in canonical source order. */
export const AXIAL_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

export function hexNeighbors(q: number, r: number): Tile[] {
  return AXIAL_DIRECTIONS.map(([dq, dr]) => [q + dq, r + dr] as Tile);
}

// ── Grid generation ──────────────────────────────────────────

export function generateHexGrid(radius: number): Set<string> {
  const tiles = new Set<string>();
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.abs(q) + Math.abs(r) + Math.abs(-q - r) <= 2 * radius) {
        tiles.add(tileKey(q, r));
      }
    }
  }
  return tiles;
}

/** The default battlefield grid. */
export const HEX_GRID: Set<string> = generateHexGrid(GRID_RADIUS);

// ── Line ─────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function hexLineTiles(q1: number, r1: number, q2: number, r2: number): Tile[] {
  const n = hexDistance(q1, r1, q2, r2);
  if (n === 0) return [[q1, r1]];
  const [x1, y1, z1] = axialToCube(q1, r1);
  const [x2, y2, z2] = axialToCube(q2, r2);
  const tiles: Tile[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [rx, ry, rz] = cubeRound(lerp(x1, x2, t), lerp(y1, y2, t), lerp(z1, z2, t));
    tiles.push(cubeToAxial(rx, ry, rz));
  }
  return tiles;
}

/** Returns true if no barrier tile lies on the line (excluding the origin). */
export function hasLineOfSight(
  fromQ: number,
  fromR: number,
  toQ: number,
  toR: number,
  barrierTiles: ReadonlySet<string>,
): { clear: boolean; line: Tile[] } {
  const line = hexLineTiles(fromQ, fromR, toQ, toR);
  for (let i = 1; i < line.length; i++) {
    if (barrierTiles.has(tileKey(line[i][0], line[i][1]))) {
      return { clear: false, line };
    }
  }
  return { clear: true, line };
}

// ── Rings & areas ────────────────────────────────────────────

export function getRing(
  cq: number,
  cr: number,
  radius: number,
  grid: ReadonlySet<string> = HEX_GRID,
): Set<string> {
  const results = new Set<string>();
  if (radius === 0) {
    if (grid.has(tileKey(cq, cr))) results.add(tileKey(cq, cr));
    return results;
  }
  let q = cq + AXIAL_DIRECTIONS[4][0] * radius;
  let r = cr + AXIAL_DIRECTIONS[4][1] * radius;
  for (let i = 0; i < 6; i++) {
    for (let step = 0; step < radius; step++) {
      if (grid.has(tileKey(q, r))) results.add(tileKey(q, r));
      const [dq, dr] = AXIAL_DIRECTIONS[i];
      q += dq;
      r += dr;
    }
  }
  return results;
}

export function getHexArea(
  cq: number,
  cr: number,
  radius: number,
  grid: ReadonlySet<string> = HEX_GRID,
): Set<string> {
  const result = new Set<string>();
  for (let rad = 0; rad <= radius; rad++) {
    for (const k of getRing(cq, cr, rad, grid)) result.add(k);
  }
  if (grid.has(tileKey(cq, cr))) result.add(tileKey(cq, cr));
  return result;
}

// ── Reachability (BFS with step cost) ────────────────────────

export function getReachableTiles(
  startQ: number,
  startR: number,
  moveRange: number,
  blockedTiles: ReadonlySet<string>,
  occupiedTiles: ReadonlySet<string>,
  grid: ReadonlySet<string> = HEX_GRID,
): Set<string> {
  // NOTE: matches the Python source, which counts hops (not step-cost) here.
  const visited = new Map<string, number>();
  visited.set(tileKey(startQ, startR), 0);
  const frontier: Array<[number, number, number]> = [[startQ, startR, 0]];
  const reachable = new Set<string>();
  while (frontier.length > 0) {
    const [q, r, steps] = frontier.shift()!;
    for (const [nq, nr] of hexNeighbors(q, r)) {
      const key = tileKey(nq, nr);
      if (!grid.has(key)) continue;
      if (blockedTiles.has(key)) continue;
      const newSteps = steps + 1;
      if (newSteps > moveRange) continue;
      const prev = visited.get(key);
      if (prev !== undefined && prev <= newSteps) continue;
      visited.set(key, newSteps);
      if (!occupiedTiles.has(key)) reachable.add(key);
      frontier.push([nq, nr, newSteps]);
    }
  }
  return reachable;
}

// ── Path validation ──────────────────────────────────────────

export function isValidPath(
  path: readonly Tile[],
  blockedTiles: ReadonlySet<string>,
  occupiedTiles: ReadonlySet<string>,
  moveRange: number,
  grid: ReadonlySet<string> = HEX_GRID,
): { ok: boolean; reason: string } {
  if (path.length === 0) return { ok: false, reason: 'Empty path' };
  if (path.length - 1 > moveRange) return { ok: false, reason: 'Path too long' };
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1];
    const curr = path[i];
    const key = tileKey(curr[0], curr[1]);
    if (!grid.has(key)) return { ok: false, reason: `Tile ${key} not in grid` };
    if (blockedTiles.has(key)) return { ok: false, reason: `Tile ${key} is blocked` };
    if (occupiedTiles.has(key) && i === path.length - 1) {
      return { ok: false, reason: 'Destination occupied' };
    }
    if (hexDistance(prev[0], prev[1], curr[0], curr[1]) !== 1) {
      return { ok: false, reason: 'Non-adjacent step' };
    }
  }
  return { ok: true, reason: 'OK' };
}

// ── Attackable tiles ─────────────────────────────────────────

export function getAttackableTiles(
  posQ: number,
  posR: number,
  moveRange: number | null,
  isRanged: boolean,
  barrierTiles: ReadonlySet<string>,
  grid: ReadonlySet<string> = HEX_GRID,
): Set<string> {
  const attackable = new Set<string>();
  if (!isRanged) {
    for (const [nq, nr] of hexNeighbors(posQ, posR)) {
      if (grid.has(tileKey(nq, nr))) attackable.add(tileKey(nq, nr));
    }
  } else {
    for (const key of grid) {
      const [tq, tr] = keyToTile(key);
      if (tq === posQ && tr === posR) continue;
      if (moveRange !== null && hexDistance(posQ, posR, tq, tr) > moveRange) continue;
      const { clear } = hasLineOfSight(posQ, posR, tq, tr, barrierTiles);
      if (clear) attackable.add(key);
    }
  }
  return attackable;
}

// ── Attack direction ─────────────────────────────────────────

export function getAttackDirection(
  fromQ: number,
  fromR: number,
  toQ: number,
  toR: number,
): readonly [number, number] {
  const dq = toQ - fromQ;
  const dr = toR - fromR;
  for (const d of AXIAL_DIRECTIONS) {
    if (d[0] === dq && d[1] === dr) return d;
  }
  const targetAngle = Math.atan2(dr, dq);
  let best = AXIAL_DIRECTIONS[0];
  let bestDiff = Infinity;
  for (const d of AXIAL_DIRECTIONS) {
    const angle = Math.atan2(d[1], d[0]);
    const diff = Math.abs(
      Math.atan2(Math.sin(targetAngle - angle), Math.cos(targetAngle - angle)),
    );
    if (diff < bestDiff) {
      bestDiff = diff;
      best = d;
    }
  }
  return best;
}

/** Count straight-line tiles of approach at the tail end of a path. */
export function countStraightApproach(
  path: readonly Tile[],
  attackDir: readonly [number, number],
): number {
  if (path.length < 2) return 0;
  let count = 0;
  for (let i = path.length - 1; i > 0; i--) {
    const dq = path[i][0] - path[i - 1][0];
    const dr = path[i][1] - path[i - 1][1];
    if (dq === attackDir[0] && dr === attackDir[1]) count++;
    else break;
  }
  return count;
}
