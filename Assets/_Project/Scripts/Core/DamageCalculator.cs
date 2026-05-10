using UnityEngine;

namespace HexBattle.Core
{
    /// <summary>
    /// Exact port of hex_battle.py calc_damage().
    /// All integer truncation matches Python's int() calls.
    /// </summary>
    public static class DamageCalculator
    {
        /// <summary>
        /// Calculates final damage dealt. Returns at least 1.
        /// </summary>
        public static int Calculate(
            MoveDefinition  move,
            PokemonState    attacker,
            PokemonState    defender,
            float           momentum    = 1f,
            float           powerMult   = 1f,   // early-stop boost, QA penalty, etc.
            float           boostMult   = 1f,   // special move self-buffs
            float           typeMult    = 1f,   // pre-computed type effectiveness
            float           weatherMult = 1f,   // sunny/rain zone modifier
            bool            crit        = false,
            int             hexPower    = -1)   // overrides move.BasePower when >= 0
        {
            int L     = attacker.Level;
            int Power = hexPower >= 0 ? hexPower : move.BasePower;

            int A, D;
            if (move.Category == MoveCategory.Physical)
            {
                A = Mathf.FloorToInt(attacker.Attack
                    * StatStageMult(attacker.Stages.attack));
                D = Mathf.Max(1, Mathf.FloorToInt(defender.Defense
                    * StatStageMult(defender.Stages.defense)));
            }
            else
            {
                A = Mathf.FloorToInt(attacker.SpAtk
                    * StatStageMult(attacker.Stages.spAtk));
                D = Mathf.Max(1, Mathf.FloorToInt(defender.SpDef
                    * StatStageMult(defender.Stages.spDef)));
            }

            // Critical hit: ignore negative attacker stages / positive defender stages
            if (crit)
            {
                if (move.Category == MoveCategory.Physical)
                {
                    A = Mathf.Max(A, attacker.Attack);
                    D = Mathf.Min(D, defender.Defense);
                }
                else
                {
                    A = Mathf.Max(A, attacker.SpAtk);
                    D = Mathf.Min(D, defender.SpDef);
                }
            }

            // Standard Gen 5+ damage formula
            float inner   = Mathf.Floor((2f * L / 5f + 2f) * Power * A / D);
            float baseDmg = Mathf.Floor(inner / 50f) + 2f;
            float critMlt = crit ? 1.5f : 1f;

            int result = Mathf.Max(1, Mathf.FloorToInt(
                baseDmg * momentum * powerMult * boostMult
                * typeMult * weatherMult * critMlt));

            return result;
        }

        /// <summary>
        /// Stat stage multiplier — matches Python stat_stage_mult().
        /// Stage clamped to [-6, +6].
        /// </summary>
        public static float StatStageMult(int stage)
        {
            stage = Mathf.Clamp(stage, -6, 6);
            return stage >= 0
                ? (2f + stage) / 2f
                : 2f / (2f + Mathf.Abs(stage));
        }

        /// <summary>
        /// Type effectiveness against a (possibly dual-type) defender.
        /// </summary>
        public static float TypeEffectiveness(string attackType, string[] defTypes)
            => TypeChart.GetCombined(attackType, defTypes);

        // ── Terrain-specific damage helpers ───────────────────────────────────

        /// <summary>
        /// Burn zone / burn status — deals 1/8 of the Pokémon's max HP.
        /// </summary>
        public static int BurnZoneDamage(PokemonState poke)
            => Mathf.Max(1, Mathf.FloorToInt(
                poke.MaxHp * GameConstants.BURN_ZONE_DAMAGE_PCT));

        /// <summary>
        /// Ice zone — deals 6% of max HP to non-Ice types.
        /// </summary>
        public static int IceChipDamage(PokemonState poke)
        {
            foreach (var t in poke.Types)
                if (t == "Ice") return 0;
            return Mathf.Max(1, Mathf.FloorToInt(
                poke.MaxHp * GameConstants.ICE_CHIP_DAMAGE_PCT));
        }

        /// <summary>
        /// Volt Tackle recoil. momentum is the momentum multiplier used in the attack.
        /// recoil = damage * VT_RECOIL_BASE * (1 + (momentum-1) * DAMP)
        /// </summary>
        public static int VoltTackleRecoil(int damage, float momentum)
        {
            float mDamp = 1f + (momentum - 1f)
                          * GameConstants.VT_RECOIL_MOMENTUM_DAMP;
            return Mathf.Max(1, Mathf.FloorToInt(
                damage * GameConstants.VT_RECOIL_BASE * mDamp));
        }
    }
}
