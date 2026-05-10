using UnityEngine;
using HexBattle.Core;

namespace HexBattle.Rendering
{
    /// <summary>
    /// Component attached to every hex tile GameObject in the scene.
    /// Handles per-tile visual state: highlights, terrain overlays, terrain VFX.
    /// </summary>
    [RequireComponent(typeof(MeshRenderer))]
    public class HexTile : MonoBehaviour
    {
        // ── Coords ────────────────────────────────────────────────────────────
        public Vector2Int Coords;        // axial (q, r)
        public TerrainType CurrentTerrain { get; private set; } = TerrainType.None;
        public int TurnsLeft  { get; private set; }
        public int Integrity  { get; private set; }    // for rock piles etc.

        // ── Materials ─────────────────────────────────────────────────────────
        [Header("Materials")]
        public Material BaseMaterial;
        public Material MoveHighlightMat;    // blue emissive
        public Material AttackHighlightMat;  // red emissive
        public Material PathHighlightMat;    // white emissive
        public Material AoeMat;             // orange emissive

        // ── Terrain VFX prefabs ───────────────────────────────────────────────
        [Header("Terrain VFX Prefabs")]
        public GameObject BurnZoneVfx;
        public GameObject IceZoneVfx;
        public GameObject PoisonTrapVfx;
        public GameObject ResonanceVfx;
        public GameObject PeishVfx;
        public GameObject MistVfx;
        public GameObject SlowZoneVfx;

        private MeshRenderer _renderer;
        private GameObject   _activeTerrainVfx;

        private void Awake()
        {
            _renderer = GetComponent<MeshRenderer>();
        }

        // ── Highlights ────────────────────────────────────────────────────────
        public void SetHighlight(HighlightType type)
        {
            _renderer.material = type switch
            {
                HighlightType.MoveRange   => MoveHighlightMat,
                HighlightType.AttackRange => AttackHighlightMat,
                HighlightType.Path        => PathHighlightMat,
                HighlightType.AoeRange    => AoeMat,
                _                        => BaseMaterial
            };
        }

        public void ClearHighlight() => SetHighlight(HighlightType.None);

        // ── Terrain ───────────────────────────────────────────────────────────
        public void SetTerrain(TerrainType terrain, int turns = -1)
        {
            CurrentTerrain = terrain;
            TurnsLeft      = turns;

            // Destroy previous VFX
            if (_activeTerrainVfx != null)
                Destroy(_activeTerrainVfx);

            // Spawn correct VFX
            GameObject prefab = terrain switch
            {
                TerrainType.BurnZone      => BurnZoneVfx,
                TerrainType.IceZone       => IceZoneVfx,
                TerrainType.PoisonTrap    => PoisonTrapVfx,
                TerrainType.ResonanceZone => ResonanceVfx,
                TerrainType.PeishZone     => PeishVfx,
                TerrainType.MistZone      => MistVfx,
                TerrainType.SlowZone      => SlowZoneVfx,
                _ => null
            };

            if (prefab != null)
                _activeTerrainVfx = Instantiate(prefab, transform.position,
                    Quaternion.identity, transform);

            // Update base material tint
            if (BaseMaterial != null)
            {
                Color tint = GetTerrainTint(terrain);
                _renderer.material.SetColor("_BaseColor", tint);
            }
        }

        public void ClearTerrain()
        {
            CurrentTerrain = TerrainType.None;
            TurnsLeft      = 0;
            if (_activeTerrainVfx != null) Destroy(_activeTerrainVfx);
        }

        // ── Tooltip data ──────────────────────────────────────────────────────
        public string GetTooltipTitle()
            => $"Hex ({Coords.x}, {Coords.y})";

        public string GetTooltipBody()
        {
            string terrain = CurrentTerrain == TerrainType.None
                ? "Normal"
                : CurrentTerrain.ToString();
            string turns   = TurnsLeft > 0 ? $" ({TurnsLeft}t left)" : "";
            return $"Terrain: {terrain}{turns}\nStep cost: {GetStepCost()}";
        }

        public int GetStepCost()
            => CurrentTerrain == TerrainType.SlowZone ? 2 : 1;

        // ── Helpers ───────────────────────────────────────────────────────────
        private static Color GetTerrainTint(TerrainType t) => t switch
        {
            TerrainType.BurnZone      => new Color(1f, 0.4f, 0.1f, 1f),
            TerrainType.IceZone       => new Color(0.5f, 0.9f, 1f,   1f),
            TerrainType.PoisonTrap    => new Color(0.7f, 0.2f, 0.8f, 1f),
            TerrainType.ResonanceZone => new Color(0.2f, 0.8f, 0.9f, 1f),
            TerrainType.PeishZone     => new Color(0.5f, 0f,   0.7f, 1f),
            TerrainType.MistZone      => new Color(0.8f, 0.9f, 1f,   1f),
            TerrainType.SlowZone      => new Color(0.5f, 0.4f, 0.2f, 1f),
            TerrainType.SunnyZone     => new Color(1f,   0.9f, 0.3f, 1f),
            TerrainType.RainZone      => new Color(0.2f, 0.5f, 1f,   1f),
            _                         => Color.white,
        };
    }
}
