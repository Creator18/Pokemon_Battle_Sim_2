export type Vec2 = { x: number; y: number };
export type CubeCoord = { x: number; y: number; z: number };

export function axialToCube(q: number, r: number): CubeCoord {
  return { x: q, y: -q - r, z: r };
}

export function cubeDistance(a: CubeCoord, b: CubeCoord): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
}

export function hexDistance(a: Vec2, b: Vec2): number {
  return cubeDistance(axialToCube(a.x, a.y), axialToCube(b.x, b.y));
}

const DIRECTIONS: Vec2[] = [
  { x: 1, y: 0 }, { x: 1, y: -1 }, { x: 0, y: -1 },
  { x: -1, y: 0 }, { x: -1, y: 1 }, { x: 0, y: 1 },
];

export function getNeighbors(tile: Vec2): Vec2[] {
  return DIRECTIONS.map(d => ({ x: tile.x + d.x, y: tile.y + d.y }));
}

/** Flat-top hex → world XZ */
export function hexToWorld(q: number, r: number, size: number): { x: number; z: number } {
  const x = size * (3 / 2) * q;
  const z = size * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r);
  return { x, z };
}

/** World XZ → nearest axial hex */
export function worldToHex(wx: number, wz: number, size: number): Vec2 {
  const q = (2 / 3) * wx / size;
  const r = (-1 / 3) * wx / size + (Math.sqrt(3) / 3) * wz / size;
  return hexRound(q, r);
}

function hexRound(q: number, r: number): Vec2 {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { x: rq, y: rr };
}

export function generateGrid(radius: number): Vec2[] {
  const tiles: Vec2[] = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      tiles.push({ x: q, y: r });
    }
  }
  return tiles;
}

export function tileKey(v: Vec2): string {
  return `${v.x},${v.y}`;
}

export function floodFill(
  origin: Vec2,
  moveRange: number,
  validTiles: Set<string>,
  stepCost?: (from: Vec2, to: Vec2) => number
): Set<string> {
  const reached = new Set<string>();
  const queue: Array<{ tile: Vec2; cost: number }> = [{ tile: origin, cost: 0 }];
  reached.add(tileKey(origin));

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const nb of getNeighbors(current.tile)) {
      const key = tileKey(nb);
      if (!validTiles.has(key)) continue;
      const cost = current.cost + (stepCost ? stepCost(current.tile, nb) : 1);
      if (cost <= moveRange && !reached.has(key)) {
        reached.add(key);
        queue.push({ tile: nb, cost });
      }
    }
  }
  return reached;
}

export function hexLine(a: Vec2, b: Vec2): Vec2[] {
  const n = hexDistance(a, b);
  if (n === 0) return [a];
  const ca = axialToCube(a.x, a.y);
  const cb = axialToCube(b.x, b.y);
  const results: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const lq = ca.x + (cb.x - ca.x) * t;
    const lr = ca.z + (cb.z - ca.z) * t;
    results.push(hexRound(lq, lr));
  }
  return results;
}
