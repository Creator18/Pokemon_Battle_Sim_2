using UnityEngine;
using HexBattle.Core;

namespace HexBattle.Data
{
    [CreateAssetMenu(fileName = "Move_New", menuName = "HexBattle/Move")]
    public class MoveData : ScriptableObject
    {
        [Header("Identity")]
        public string       moveName;
        public MoveCategory category;
        public string       moveType;       // "Electric", "Fire", etc.
        [TextArea(2, 4)]
        public string       description;

        [Header("Power & Range")]
        public int          basePower;
        public bool         isRanged;
        public int          aoeRadius;     // 0 = single target

        [Header("Targeting Flags")]
        public bool         requiresLoS;
        public bool         bypassesLoS;
        public bool         alwaysHits;

        [Header("Move Mechanics")]
        public bool         needsMomentum;  // only does full damage with momentum
        public bool         quickPriority;  // Quick Attack: priority over normal moves
        public float        recoilFraction; // fraction of damage dealt as recoil (0 = none)
        public bool         skipTurnOnHit;  // Flinch / skip opponent next turn

        [Header("Self Stat Changes")]
        public StatChange[] selfDebuffs;    // e.g. Close Combat: -1 Def, -1 SpDef

        [Header("VFX")]
        public GameObject   projectilePrefab;
        public GameObject   impactVfxPrefab;
        public Color        aoeColor = Color.white;
    }

    [System.Serializable]
    public struct StatChange
    {
        public StatName stat;
        public int      delta;  // positive = buff, negative = debuff
    }
}
