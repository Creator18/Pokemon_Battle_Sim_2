using UnityEngine;
using HexBattle.Core;
using HexBattle.Data;

namespace HexBattle.Battle
{
    /// <summary>
    /// MonoBehaviour that owns the authoritative BattleState and initializes
    /// PokemonStates from SpeciesData ScriptableObjects.
    /// Attach to a persistent GameObject in the Battle scene (server + client).
    /// </summary>
    public class TurnManager : MonoBehaviour
    {
        public static TurnManager Instance { get; private set; }

        [Header("Species Assets (set in Inspector)")]
        public SpeciesData[] AllSpecies;

        // ── Runtime State ─────────────────────────────────────────────────────
        public BattleState State { get; private set; }

        private void Awake()
        {
            if (Instance != null) { Destroy(gameObject); return; }
            Instance = this;
        }

        private void Start()
        {
            // Register all MoveData assets into MoveRegistry
            foreach (var species in AllSpecies)
            foreach (var move in species.GetFullPool())
                if (move != null)
                    MoveRegistry.Register(MoveDefinition.FromScriptableObject(move));

            Debug.Log($"[TurnManager] {MoveRegistry.Count()} moves registered.");
        }

        /// <summary>
        /// Called by the host once both species are selected.
        /// Initializes BattleState with correct stats.
        /// </summary>
        public void InitBattle(string p1SpeciesName, string p2SpeciesName)
        {
            var p1Species = FindSpecies(p1SpeciesName);
            var p2Species = FindSpecies(p2SpeciesName);

            if (p1Species == null || p2Species == null)
            {
                Debug.LogError("[TurnManager] Species not found in AllSpecies array.");
                return;
            }

            State = new BattleState
            {
                TurnNumber = 0,
                P1 = MakePokemon(p1Species, playerId: 1,
                     startTile: GameConstants.P1_START),
                P2 = MakePokemon(p2Species, playerId: 2,
                     startTile: GameConstants.P2_START),
            };

            Debug.Log($"[TurnManager] Battle initialized: "
                    + $"{p1Species.speciesName} vs {p2Species.speciesName}");
        }

        private static PokemonState MakePokemon(
            SpeciesData sd, int playerId, Vector2Int startTile)
            => new()
            {
                PlayerId       = playerId,
                Name           = sd.speciesName,
                Types          = sd.types,
                Level          = sd.level,
                MaxHp          = sd.inflatedHp,
                CurrentHp      = sd.inflatedHp,
                Attack         = sd.attack,
                Defense        = sd.defense,
                SpAtk          = sd.spAtk,
                SpDef          = sd.spDef,
                Speed          = sd.speed,
                Tile           = startTile,
                CanPassThrough = sd.canPassThrough,
            };

        private SpeciesData FindSpecies(string name)
        {
            foreach (var s in AllSpecies)
                if (string.Equals(s.speciesName, name,
                    System.StringComparison.OrdinalIgnoreCase))
                    return s;
            return null;
        }
    }
}
