import { describe, it, expect } from 'vitest';
import {
  hexDistance,
  hexNeighbors,
  hexLineTiles,
  generateHexGrid,
  countStraightApproach,
  getAttackDirection,
  AXIAL_DIRECTIONS,
} from '../core/hex.ts';
import { TOTAL_TILES, GRID_RADIUS } from '../core/constants.ts';

describe('hex geometry', () => {
  it('distance', () => {
    expect(hexDistance(0, 0, 0, 0)).toBe(0);
    expect(hexDistance(-3, 0, 3, 0)).toBe(6);
    expect(hexDistance(0, 0, 1, -1)).toBe(1);
  });

  it('has 6 neighbors in canonical order', () => {
    const n = hexNeighbors(0, 0);
    expect(n).toHaveLength(6);
    expect(n.map((t) => [t[0], t[1]])).toEqual(AXIAL_DIRECTIONS.map((d) => [d[0], d[1]]));
  });

  it('grid has the expected tile count', () => {
    const grid = generateHexGrid(GRID_RADIUS);
    expect(grid.size).toBe(TOTAL_TILES);
    expect(TOTAL_TILES).toBe(61);
  });

  it('line from (-3,0) to (3,0) is a straight 7-tile row', () => {
    const line = hexLineTiles(-3, 0, 3, 0);
    expect(line).toHaveLength(7);
    expect(line[0]).toEqual([-3, 0]);
    expect(line[6]).toEqual([3, 0]);
  });

  it('counts straight approach on the tail of a path', () => {
    // path moving in +q direction then attacking +q
    const path: Array<[number, number]> = [
      [-3, 0],
      [-2, 0],
      [-1, 0],
      [0, 0],
    ];
    const dir = getAttackDirection(0, 0, 1, 0);
    expect([dir[0], dir[1]]).toEqual([1, 0]);
    expect(countStraightApproach(path, dir)).toBe(3);
  });
});
