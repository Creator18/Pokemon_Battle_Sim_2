using System;
using System.Collections.Generic;
using UnityEngine;

namespace HexBattle.Core
{
    /// <summary>
    /// Runtime mutable state for one Pokémon during a battle.
    /// Mirrors the Python Pokemon dataclass fields used by TurnEngine.
    /// This is NOT a MonoBehaviour — it is a plain C# class held by TurnManager.
    /// </summary>
    [Serializable]
    public class PokemonState
    {
        // ── Identity ──────────────────────────────────────────
        public int    PlayerId;
        public string Name;
        public string[] Types;
        public int    Level;

        // ── Base Stats ────────────────────────────────────────
        public int MaxHp;
        public int Attack;
        public int Defense;
        public int SpAtk;
        public int SpDef;
        public int Speed;

        // ── Live State ────────────────────────────────────────
        public int        CurrentHp;
        public Vector2Int Tile;
        public bool       IsAlive => CurrentHp > 0;

        // ── Stat Stages (clamped -6 .. +6) ────────────────────
        public StatStages Stages = new();

        // ── Cooldowns (move name → turns remaining) ───────────
        public Dictionary<string, int> Cooldowns = new();

        // ── Status conditions ─────────────────────────────────
        public bool Taunted;
        public bool Flinched;
        public bool Hypnotized;
        public bool Paralyzed;
        public bool Burned;           // from burn_zone

        // ── Special flags ─────────────────────────────────────
        public bool CanPassThrough;   // e.g. Gengar ghost-pass

        // ── Perish countdown (for perish_zone terrain) ────────
        public int PerishCountdown;   // 0 = not in perish zone; counts down to 0 → faint

        // ── Declaration (set each turn before resolution) ─────
        public DeclarationPayload Declaration;

        // ── Effective speed (after paralysis) ─────────────────
        public int EffectiveSpeed
            => Paralyzed ? Mathf.FloorToInt(Speed * 0.5f) : Speed;

        // ── Momentum helpers ──────────────────────────────────
        /// <summary>
        /// Returns momentum multiplier for a straight-line path of
        /// <paramref name="straightTiles"/> tiles.
        /// Capped at MOMENTUM_CAP.
        /// </summary>
        public static float CalcMomentum(int straightTiles)
            => Mathf.Min(
                GameConstants.MOMENTUM_CAP,
                1f + straightTiles * GameConstants.MOMENTUM_BONUS_PER_TILE);

        // ── Stat stage application ────────────────────────────
        /// <summary>
        /// Applies a stat-stage delta and returns (newStage, wasClamped).
        /// </summary>
        public (int newStage, bool clamped) ApplyStatStage(StatName stat, int delta)
        {
            int before = Stages.Get(stat);
            int after  = Mathf.Clamp(before + delta, -6, 6);
            Stages.Set(stat, after);
            return (after, after == before);
        }

        // ── Priority helpers ──────────────────────────────────
        /// <summary>
        /// Returns (movePriority, attackPriority) for normal (non-QA) moves.
        /// Matches Python Pokemon.get_action_priorities().
        /// </summary>
        public (float movePriority, float attackPriority) GetActionPriorities()
        {
            float speedBase = EffectiveSpeed;

            float mp, ap;
            if (Declaration?.ActionOrder == ActionOrder.AttackFirst)
            {
                ap = speedBase + GameConstants.MOVE_FIRST_COST;
                mp = speedBase;
            }
            else
            {
                mp = speedBase + GameConstants.MOVE_FIRST_COST;
                ap = speedBase;
            }
            return (mp, ap);
        }

        public override string ToString()
            => $"P{PlayerId} {Name} HP:{CurrentHp}/{MaxHp} @{Tile}";
    }

    // ── Stat Stages Container ──────────────────────────────────────────────────
    [Serializable]
    public class StatStages
    {
        public int attack  = 0;
        public int defense = 0;
        public int spAtk   = 0;
        public int spDef   = 0;
        public int speed   = 0;

        public int Get(StatName s) => s switch
        {
            StatName.Attack  => attack,
            StatName.Defense => defense,
            StatName.SpAtk   => spAtk,
            StatName.SpDef   => spDef,
            StatName.Speed   => speed,
            _ => 0
        };

        public void Set(StatName s, int v)
        {
            switch (s)
            {
                case StatName.Attack:  attack  = v; break;
                case StatName.Defense: defense = v; break;
                case StatName.SpAtk:   spAtk   = v; break;
                case StatName.SpDef:   spDef   = v; break;
                case StatName.Speed:   speed   = v; break;
            }
        }
    }

    // ── Declaration (what a player chose this turn) ───────────────────────────
    [Serializable]
    public class DeclarationPayload
    {
        public string       MoveName;
        public ActionOrder  ActionOrder;
        public Vector2Int   TargetTile;
        public Vector2Int[] PlannedPath;
    }
}
