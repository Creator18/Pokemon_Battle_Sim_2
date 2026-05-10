using UnityEngine;

namespace HexBattle.Core
{
    public static class GameConstants
    {
        // ── Grid ──────────────────────────────────────────────
        public const int   GRID_RADIUS             = 4;
        public const float HEX_SIZE                = 1.2f;

        // ── Movement / Momentum ───────────────────────────────
        public const float SPEED_TILE_DIVISOR      = 20f;
        public const float MOMENTUM_BONUS_PER_TILE = 0.1f;
        public const float MOMENTUM_CAP            = 1.5f;
        public const int   MOVE_FIRST_COST         = 10;

        // ── Early Stop ────────────────────────────────────────
        public const float EARLY_STOP_PER_TILE     = 0.15f;
        public const float EARLY_STOP_MAX          = 2.0f;

        // ── Quick Attack ──────────────────────────────────────
        public const float QA_MF_SPEED_MULT        = 1.5f;
        public const float QA_AF_POWER_MULT        = 1.20f;
        public const float QA_MF_POWER_PENALTY     = 0.08f;
        public const float QA_MF_POWER_MIN         = 0.30f;

        // ── Cooldowns ─────────────────────────────────────────
        public const int   COOLDOWN_ATTACK_FIRST   = 2;
        public const int   COOLDOWN_MOVE_FIRST     = 1;

        // ── Volt Tackle Recoil ────────────────────────────────
        // recoil_fraction = 1/3 base
        // recoil_momentum_mult = 1.0 + (momentum - 1.0) * DAMP
        public const float VT_RECOIL_BASE              = 1f / 3f;
        public const float VT_RECOIL_MOMENTUM_DAMP     = 0.5f;

        // ── Terrain Damage ────────────────────────────────────
        public const float BURN_ZONE_DAMAGE_PCT        = 0.125f;    // 1/8 max HP/turn
        public const float ICE_CHIP_DAMAGE_PCT         = 0.06f;     // 6% max HP/turn (non-Ice)
        public const float RESONANCE_SPDEF_DROP        = -1f;       // stat stages/turn
        public const int   PERISH_COUNTDOWN_TURNS      = 3;

        // ── Spawn Positions ───────────────────────────────────
        public static readonly Vector2Int P1_START = new Vector2Int(-3,  0);
        public static readonly Vector2Int P2_START = new Vector2Int( 3,  0);

        // ── Selection Phase ───────────────────────────────────
        public const int  MOVES_TO_PICK     = 4;
        public const int  POOL_SIZE         = 8;
        public const bool TERRAIN_REQUIRED  = true;

        // ── Base move range formula ───────────────────────────
        // base_range = max(1, floor(speed / SPEED_TILE_DIVISOR))
        public static int BaseRange(int speed)
            => Mathf.Max(1, Mathf.FloorToInt(speed / SPEED_TILE_DIVISOR));
    }
}
