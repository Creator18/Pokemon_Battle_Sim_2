/**
 * Earthquake: a move centred on its user. The ground heaves in the rings
 * round it (QUAKE_RINGS deep), which are left tilted inward — rough ground —
 * and a Pokémon caught there is hit and thrown out to the first free tile
 * just outside.
 */

import type { MoveDefinition } from './moveDefinition.ts';
import { Tile, tileKey, keyToTile, hexDistance, footprint, footprintDistance, HEX_GRID } from '../core/hex.ts';

/** How many rings round the user heave. */
export const QUAKE_RINGS = 2;

/** A move centred on its user (Earthquake): it hits the rings round it, never a picked tile. */
export function isSelfArea(move: MoveDefinition): boolean {
  return move.target === 'self_area';
}

/** The tiles that heave: rings 1..QUAKE_RINGS round the user's tiles (not its own). */
export function quakeZone(center: readonly Tile[], grid: ReadonlySet<string> = HEX_GRID): Set<string> {
  const out = new Set<string>();
  for (const key of grid) {
    const d = footprintDistance([keyToTile(key)], [...center]);
    if (d >= 1 && d <= QUAKE_RINGS) out.add(key);
  }
  return out;
}

/** Axial → flat plane (for "straight outward"). */
function plane(t: Tile): [number, number] {
  return [t[0] + t[1] / 2, (t[1] * Math.sqrt(3)) / 2];
}

/**
 * Where a Pokémon thrown out of the quake lands: the first free tile just
 * outside the zone (its whole footprint, if huge), nearest to where it stood
 * and, among those, the one most straight out from the centre. Further out
 * only if nothing just outside is free; null if nowhere is.
 */
export function quakeLanding(
  who: { tile: Tile; huge: boolean },
  center: readonly Tile[],
  blocked: ReadonlySet<string>,
  occupied: ReadonlySet<string>,
  grid: ReadonlySet<string> = HEX_GRID,
): Tile | null {
  const mid = center.map(plane).reduce((a, p) => [a[0] + p[0] / center.length, a[1] + p[1] / center.length], [0, 0]);
  const here = plane(who.tile);
  const out: [number, number] = [here[0] - mid[0], here[1] - mid[1]];
  const len = Math.hypot(out[0], out[1]) || 1;
  // Where straight out would put it, one ring past the zone.
  const aim: [number, number] = [mid[0] + (out[0] / len) * (QUAKE_RINGS + 1), mid[1] + (out[1] / len) * (QUAKE_RINGS + 1)];

  let best: Tile | null = null;
  let bestScore: [number, number, number] = [Infinity, Infinity, Infinity];
  for (const key of grid) {
    const anchor = keyToTile(key);
    const feet = footprint(anchor, who.huge);
    if (feet.some((t) => { const k = tileKey(t[0], t[1]); return !grid.has(k) || blocked.has(k) || occupied.has(k); })) continue;
    const ring = footprintDistance(feet, [...center]);
    if (ring <= QUAKE_RINGS) continue;
    const p = plane(anchor);
    const score: [number, number, number] = [
      ring - (QUAKE_RINGS + 1), // just outside first
      hexDistance(anchor[0], anchor[1], who.tile[0], who.tile[1]),
      Math.hypot(p[0] - aim[0], p[1] - aim[1]),
    ];
    if (score[0] < bestScore[0] || (score[0] === bestScore[0]
      && (score[1] < bestScore[1] || (score[1] === bestScore[1] && score[2] < bestScore[2] - 1e-9)))) {
      best = anchor;
      bestScore = score;
    }
  }
  return best;
}
