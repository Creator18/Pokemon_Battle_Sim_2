using UnityEngine;
using HexBattle.Data;

namespace HexBattle.Data
{
    [CreateAssetMenu(fileName = "Species_New", menuName = "HexBattle/Species")]
    public class SpeciesData : ScriptableObject
    {
        [Header("Identity")]
        public string     speciesName;
        public string[]   types;           // 1 or 2 elements
        [TextArea(2, 3)]
        public string     description;

        [Header("Stats (Level 50)")]
        public int        baseHp;
        public int        inflatedHp;      // hp actually used in battle (inflated for game feel)
        public int        attack;
        public int        defense;
        public int        spAtk;
        public int        spDef;
        public int        speed;
        public int        level = 50;

        [Header("Gameplay Flags")]
        public bool       canPassThrough;  // e.g. Gengar — ghost-pass through tiles

        [Header("Assets")]
        public Sprite     icon;            // 2D sprite for UI cards
        public GameObject modelPrefab;     // 3D model prefab for battlefield

        [Header("Move Pool (all compatible moves)")]
        public MoveData[] compatibleTerrain;
        public MoveData[] compatibleStatus;
        public MoveData[] compatibleRanged;
        public MoveData[] compatiblePhysical;

        public MoveData[] GetFullPool()
        {
            var list = new System.Collections.Generic.List<MoveData>();
            if (compatibleTerrain  != null) list.AddRange(compatibleTerrain);
            if (compatibleStatus   != null) list.AddRange(compatibleStatus);
            if (compatibleRanged   != null) list.AddRange(compatibleRanged);
            if (compatiblePhysical != null) list.AddRange(compatiblePhysical);
            return list.ToArray();
        }

        // ── Computed base range ────────────────────────────────────────────────
        public int BaseRange => Core.GameConstants.BaseRange(speed);
    }

    // ── Concrete species data (hardcoded — mirrors pokemon.json) ──────────────
    // In Unity, fill these via ScriptableObject assets. The values below are for
    // reference only; create one asset per species in ScriptableObjects/Species/.

    /*
    PIKACHU
      types: ["Electric"]
      inflated_hp: 210, attack: 55, defense: 40, sp_atk: 50, sp_def: 50, speed: 90
      level: 50, can_pass_through: false

    CHARIZARD
      types: ["Fire", "Flying"]
      inflated_hp: 312, attack: 84, defense: 78, sp_atk: 109, sp_def: 85, speed: 100
      level: 50, can_pass_through: false

    GARDEVOIR
      types: ["Psychic", "Fairy"]
      inflated_hp: 285, attack: 45, defense: 65, sp_atk: 125, sp_def: 115, speed: 80
      level: 50, can_pass_through: false

    LUCARIO
      types: ["Fighting", "Steel"]
      inflated_hp: 252, attack: 110, defense: 70, sp_atk: 115, sp_def: 70, speed: 90
      level: 50, can_pass_through: false

    ABSOL
      types: ["Dark"]
      inflated_hp: 240, attack: 130, defense: 60, sp_atk: 75, sp_def: 60, speed: 75
      level: 50, can_pass_through: false

    GENGAR
      types: ["Ghost", "Poison"]
      inflated_hp: 240, attack: 65, defense: 60, sp_atk: 130, sp_def: 75, speed: 110
      level: 50, can_pass_through: true   ← ghost-pass
    */
}
