/**
 * Which tiles are grass. The board tints each tile from a hash of its position
 * (five tints, one of them bare earth); the grass grows on the others. The
 * engine and the board share this, so a fire (Flamethrower) catches on
 * exactly the tiles that show grass.
 */
export const TILE_TINTS = 5;
/** The tint that is bare earth (no grass). */
export const EARTH_TINT = 3;

/** The tint index of tile (q, r): the board's per-tile hash. */
export function tileTint(q: number, r: number): number {
  return (((q * 73856093) ^ (r * 19349663)) >>> 0) % TILE_TINTS;
}

export function isGrassTile(q: number, r: number): boolean {
  return tileTint(q, r) !== EARTH_TINT;
}
