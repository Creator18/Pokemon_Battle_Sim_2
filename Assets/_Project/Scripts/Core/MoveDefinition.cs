using HexBattle.Core;

namespace HexBattle.Core
{
    /// <summary>
    /// Runtime-only move definition used by TurnResolver.
    /// Populated from MoveData ScriptableObjects at scene load.
    /// Plain C# — no Unity dependency so TurnResolver can run headless.
    /// </summary>
    public class MoveDefinition
    {
        public string       Name;
        public MoveCategory Category;
        public string       Type;
        public int          BasePower;

        public bool         IsRanged;
        public bool         RequiresLoS;
        public bool         BypassesLoS;
        public int          AoeRadius;
        public bool         AlwaysHits;
        public bool         NeedsMomentum;
        public bool         QuickPriority;
        public float        RecoilFraction;
        public bool         SkipTurnOnHit;

        // Stat changes applied to self on use (e.g. Close Combat)
        public (StatName stat, int delta)[] SelfDebuffs
            = System.Array.Empty<(StatName, int)>();

        public static MoveDefinition FromScriptableObject(
            Data.MoveData asset)
        {
            var m = new MoveDefinition
            {
                Name           = asset.moveName,
                Category       = asset.category,
                Type           = asset.moveType,
                BasePower      = asset.basePower,
                IsRanged       = asset.isRanged,
                RequiresLoS    = asset.requiresLoS,
                BypassesLoS    = asset.bypassesLoS,
                AoeRadius      = asset.aoeRadius,
                AlwaysHits     = asset.alwaysHits,
                NeedsMomentum  = asset.needsMomentum,
                QuickPriority  = asset.quickPriority,
                RecoilFraction = asset.recoilFraction,
                SkipTurnOnHit  = asset.skipTurnOnHit,
            };

            if (asset.selfDebuffs != null && asset.selfDebuffs.Length > 0)
            {
                m.SelfDebuffs = new (StatName, int)[asset.selfDebuffs.Length];
                for (int i = 0; i < asset.selfDebuffs.Length; i++)
                    m.SelfDebuffs[i] = (asset.selfDebuffs[i].stat,
                                        asset.selfDebuffs[i].delta);
            }
            return m;
        }
    }

    /// <summary>
    /// Singleton registry of all moves — populated at scene load from MoveData assets.
    /// </summary>
    public static class MoveRegistry
    {
        private static readonly System.Collections.Generic.Dictionary<string, MoveDefinition>
            _moves = new();

        public static void Register(MoveDefinition def)
            => _moves[def.Name] = def;

        public static MoveDefinition Get(string name)
            => _moves.TryGetValue(name, out var d) ? d : null;

        public static void Clear() => _moves.Clear();

        public static int Count() => _moves.Count;
    }
}
