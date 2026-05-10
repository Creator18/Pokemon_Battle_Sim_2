using System.Collections.Generic;
using UnityEngine;

namespace HexBattle.Core
{
    /// <summary>
    /// Pure-static hex math library — axial coordinate system, flat-top orientation.
    /// Matches Python HexGrid exactly. No MonoBehaviour here.
    /// </summary>
    public static class HexGrid
    {
        public const int GRID_RADIUS = 4;

        // ── Axial ↔ Cube ───────────────────────────────────────────────────────
        public static Vector3Int AxialToCube(int q, int r)
            => new Vector3Int(q, -q - r, r);

        // ── Distance ──────────────────────────────────────────────────────────
        public static int HexDistance(int q1, int r1, int q2, int r2)
        {
            var a = AxialToCube(q1, r1);
            var b = AxialToCube(q2, r2);
            return Mathf.Max(
                Mathf.Abs(a.x - b.x),
                Mathf.Abs(a.y - b.y),
                Mathf.Abs(a.z - b.z));
        }

        public static int HexDistance(Vector2Int a, Vector2Int b)
            => HexDistance(a.x, a.y, b.x, b.y);

        // ── Directions ────────────────────────────────────────────────────────
        public static readonly Vector2Int[] Directions =
        {
            new( 1,  0), new( 1, -1), new( 0, -1),
            new(-1,  0), new(-1,  1), new( 0,  1)
        };

        public static List<Vector2Int> GetNeighbors(int q, int r)
        {
            var result = new List<Vector2Int>(6);
            foreach (var d in Directions)
                result.Add(new Vector2Int(q + d.x, r + d.y));
            return result;
        }

        public static List<Vector2Int> GetNeighbors(Vector2Int c)
            => GetNeighbors(c.x, c.y);

        // ── Grid Generation ───────────────────────────────────────────────────
        /// <summary>
        /// Returns all axial coordinates within <paramref name="radius"/> hex steps.
        /// Radius 4 → 61 tiles.
        /// </summary>
        public static HashSet<Vector2Int> GenerateGrid(int radius = GRID_RADIUS)
        {
            var tiles = new HashSet<Vector2Int>();
            for (int q = -radius; q <= radius; q++)
            for (int r = -radius; r <= radius; r++)
                if (Mathf.Abs(q) + Mathf.Abs(r) + Mathf.Abs(-q - r) <= 2 * radius)
                    tiles.Add(new Vector2Int(q, r));
            return tiles;
        }

        // ── Line of Sight ─────────────────────────────────────────────────────
        /// <summary>
        /// Returns every hex on the straight line from (q1,r1) to (q2,r2),
        /// inclusive. Uses the standard lerp+round approach.
        /// </summary>
        public static List<Vector2Int> HexLine(int q1, int r1, int q2, int r2)
        {
            int n = HexDistance(q1, r1, q2, r2);
            if (n == 0) return new List<Vector2Int> { new(q1, r1) };

            var result = new List<Vector2Int>(n + 1);
            for (int i = 0; i <= n; i++)
            {
                float t  = (float)i / n;
                float fx = q1 + (q2 - q1) * t + 1e-6f;
                float fz = r1 + (r2 - r1) * t + 1e-6f;
                result.Add(CubeRound(fx, -fx - fz, fz));
            }
            return result;
        }

        public static List<Vector2Int> HexLine(Vector2Int a, Vector2Int b)
            => HexLine(a.x, a.y, b.x, b.y);

        static Vector2Int CubeRound(float x, float y, float z)
        {
            int rx = Mathf.RoundToInt(x);
            int ry = Mathf.RoundToInt(y);
            int rz = Mathf.RoundToInt(z);

            float dx = Mathf.Abs(rx - x);
            float dy = Mathf.Abs(ry - y);
            float dz = Mathf.Abs(rz - z);

            if      (dx > dy && dx > dz) rx = -ry - rz;
            else if (dy > dz)            ry = -rx - rz;
            else                         rz = -rx - ry;

            return new Vector2Int(rx, rz);
        }

        // ── LoS Check ─────────────────────────────────────────────────────────
        /// <summary>
        /// True if no tile on the line between <paramref name="from"/> and
        /// <paramref name="to"/> (exclusive of endpoints) is in
        /// <paramref name="blockers"/>.
        /// </summary>
        public static bool HasLineOfSight(
            Vector2Int from, Vector2Int to,
            ICollection<Vector2Int> blockers)
        {
            var line = HexLine(from, to);
            for (int i = 1; i < line.Count - 1; i++)
                if (blockers.Contains(line[i]))
                    return false;
            return true;
        }

        // ── Flood Fill (BFS, respects step costs) ─────────────────────────────
        /// <summary>
        /// Returns all tiles reachable within <paramref name="moveRange"/> steps
        /// from <paramref name="origin"/>. Optionally pass a step-cost function.
        /// </summary>
        public static HashSet<Vector2Int> FloodFill(
            Vector2Int origin,
            int moveRange,
            IEnumerable<Vector2Int> validTiles,
            System.Func<Vector2Int, int> stepCost = null)
        {
            stepCost ??= _ => 1;

            var validSet = new HashSet<Vector2Int>(validTiles);
            var visited  = new HashSet<Vector2Int>();
            var queue    = new Queue<(Vector2Int tile, int cost)>();
            queue.Enqueue((origin, 0));
            visited.Add(origin);

            while (queue.Count > 0)
            {
                var (tile, cost) = queue.Dequeue();
                foreach (var nb in GetNeighbors(tile))
                {
                    if (!validSet.Contains(nb)) continue;
                    if (visited.Contains(nb))      continue;
                    int newCost = cost + stepCost(nb);
                    if (newCost > moveRange)        continue;
                    visited.Add(nb);
                    queue.Enqueue((nb, newCost));
                }
            }
            return visited;
        }

        // ── World Position ────────────────────────────────────────────────────
        /// <summary>
        /// Converts axial (q, r) to Unity world XZ position.
        /// Flat-top hex orientation — matches Python HexGrid.hex_to_world().
        /// </summary>
        public static Vector3 HexToWorld(int q, int r, float hexSize = 1.2f)
        {
            float x = hexSize * (1.5f * q);
            float z = hexSize * (Mathf.Sqrt(3f) / 2f * q + Mathf.Sqrt(3f) * r);
            return new Vector3(x, 0f, z);
        }

        public static Vector3 HexToWorld(Vector2Int coord, float hexSize = 1.2f)
            => HexToWorld(coord.x, coord.y, hexSize);

        // ── Ring ──────────────────────────────────────────────────────────────
        /// <summary>Returns all tiles exactly <paramref name="radius"/> steps away.</summary>
        public static List<Vector2Int> GetRing(Vector2Int center, int radius)
        {
            if (radius <= 0) return new List<Vector2Int> { center };
            var results = new List<Vector2Int>();
            var cur = new Vector2Int(
                center.x + Directions[4].x * radius,
                center.y + Directions[4].y * radius);

            for (int i = 0; i < 6; i++)
            for (int j = 0; j < radius; j++)
            {
                results.Add(cur);
                cur += Directions[i];
            }
            return results;
        }

        // ── Disc (inclusive ring 0..radius) ───────────────────────────────────
        public static List<Vector2Int> GetDisc(Vector2Int center, int radius)
        {
            var results = new List<Vector2Int>();
            for (int r = 0; r <= radius; r++)
                results.AddRange(GetRing(center, r));
            return results;
        }
    }
}
