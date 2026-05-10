using System.Collections.Generic;
using UnityEngine;
using HexBattle.Core;
using HexBattle.Rendering;

namespace HexBattle.Rendering
{
    /// <summary>
    /// Generates and manages all 61 hex tile GameObjects in the Battle scene.
    /// Run on Awake so tiles exist before any other system needs them.
    /// </summary>
    public class HexGridBuilder : MonoBehaviour
    {
        public static HexGridBuilder Instance { get; private set; }

        [Header("Tile Prefabs")]
        public GameObject GrassTilePrefab;
        public GameObject RockTilePrefab;

        [Header("Decoration Prefabs")]
        public GameObject TreePrefab;
        public GameObject RockPilePrefab;

        [Header("Settings")]
        public float HexSize = GameConstants.HEX_SIZE;

        // ── Tile registry ─────────────────────────────────────────────────────
        private readonly Dictionary<Vector2Int, HexTile> _tiles = new();
        public IReadOnlyDictionary<Vector2Int, HexTile>  Tiles => _tiles;

        // ── Random decoration seed ────────────────────────────────────────────
        [Header("Decoration")]
        [Range(0f, 1f)] public float TreeChance     = 0.08f;
        [Range(0f, 1f)] public float RockPileChance = 0.05f;
        public int                  RandomSeed      = 42;

        private void Awake()
        {
            if (Instance != null) { Destroy(gameObject); return; }
            Instance = this;

            BuildGrid();
        }

        // ── Grid Building ─────────────────────────────────────────────────────
        private void BuildGrid()
        {
            var rng  = new System.Random(RandomSeed);
            var grid = HexGrid.GenerateGrid(HexGrid.GRID_RADIUS);

            foreach (var coord in grid)
            {
                Vector3 world = HexGrid.HexToWorld(coord, HexSize);

                // Choose prefab
                bool spawnRock = (rng.NextDouble() < RockPileChance)
                              && coord != GameConstants.P1_START
                              && coord != GameConstants.P2_START;

                var prefab = spawnRock ? RockTilePrefab : GrassTilePrefab;
                var go     = Instantiate(prefab, world, Quaternion.identity, transform);
                go.name    = $"HexTile_{coord.x}_{coord.y}";
                go.layer   = LayerMask.NameToLayer("HexTile");

                var tile   = go.GetComponent<HexTile>();
                tile.Coords = coord;

                if (spawnRock)
                    tile.SetTerrain(TerrainType.RockPile);

                _tiles[coord] = tile;

                // Add tree decoration (non-blocking, just visual)
                if (!spawnRock && rng.NextDouble() < TreeChance
                               && TreePrefab != null)
                {
                    var tree = Instantiate(TreePrefab,
                        world + Vector3.up * 0.5f,
                        Quaternion.Euler(0, rng.Next(0, 360), 0),
                        go.transform);
                    tree.transform.localScale *= 0.6f + (float)rng.NextDouble() * 0.4f;
                }
            }

            Debug.Log($"[HexGrid] Built {_tiles.Count} tiles.");
        }

        // ── Public API ────────────────────────────────────────────────────────
        public HexTile GetTile(Vector2Int coord)
            => _tiles.TryGetValue(coord, out var t) ? t : null;

        public HexTile GetTile(int q, int r)
            => GetTile(new Vector2Int(q, r));

        public bool IsValid(Vector2Int coord)
            => _tiles.ContainsKey(coord);

        /// <summary>
        /// Highlights a set of tiles with the given type.
        /// Clears all other highlights first.
        /// </summary>
        public void SetHighlights(
            IEnumerable<Vector2Int> tiles, HighlightType type,
            bool clearFirst = true)
        {
            if (clearFirst) ClearAllHighlights();
            foreach (var c in tiles)
                GetTile(c)?.SetHighlight(type);
        }

        public void ClearAllHighlights()
        {
            foreach (var tile in _tiles.Values)
                tile.ClearHighlight();
        }

        /// <summary>
        /// Sync terrain state from server to tile visuals (called on client).
        /// </summary>
        public void ApplyTerrainState(
            Dictionary<Vector2Int, (TerrainType type, int turns)> terrainMap)
        {
            // First clear all
            foreach (var tile in _tiles.Values)
                tile.ClearTerrain();

            // Apply new state
            foreach (var kv in terrainMap)
            {
                var tile = GetTile(kv.Key);
                tile?.SetTerrain(kv.Value.type, kv.Value.turns);
            }
        }
    }
}
