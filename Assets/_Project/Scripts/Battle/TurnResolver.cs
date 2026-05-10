using System;
using System.Collections.Generic;
using UnityEngine;
using HexBattle.Core;

namespace HexBattle.Battle
{
    /// <summary>
    /// Port of Python TurnEngine — resolve_turn(), begin_turn(), end_turn().
    /// Runs server-side (on the NGO host). Pure logic — no MonoBehaviour.
    ///
    /// Usage:
    ///   var resolver = new TurnResolver();
    ///   resolver.ResolveTurn(state);    // fills state.ResolutionLog, mutates HP/tiles
    ///   resolver.EndTurn(state);        // terrain effects, cooldowns, cleanup
    /// </summary>
    public class TurnResolver
    {
        // ── Logging ───────────────────────────────────────────────────────────
        private readonly List<string> _log = new();
        public IReadOnlyList<string>  Log => _log;

        private void L(string msg) => _log.Add(msg);

        // ── Queue Entry ───────────────────────────────────────────────────────
        private class QueuedAction
        {
            public float        Priority;
            public int          PlayerId;
            public ActionType   Type;
            public PokemonState Pokemon;
        }

        // ── Destiny Bond tracking ─────────────────────────────────────────────
        private readonly Dictionary<int, bool> _destinyBond = new();

        // ── Public Entry Points ───────────────────────────────────────────────

        public void BeginTurn(BattleState state)
        {
            _log.Clear();
            _destinyBond.Clear();

            state.TurnNumber++;
            L($"── Turn {state.TurnNumber} begin ──");

            // Clear per-turn flags
            state.P1.Flinched = false;
            state.P2.Flinched = false;
        }

        public void ResolveTurn(BattleState state)
        {
            L("── Resolution phase ──");

            var p1 = state.P1;
            var p2 = state.P2;
            var tm = state.Terrain;

            var queue = BuildQueue(p1, p2);

            L("Priority order:");
            for (int i = 0; i < queue.Count; i++)
                L($"  {i + 1}. P{queue[i].PlayerId} {queue[i].Type} (pri={queue[i].Priority:F1})");

            foreach (var action in queue)
            {
                if (DetermineWinner(p1, p2) != -1) break;

                var other = action.PlayerId == 1 ? p2 : p1;

                if (action.Type == ActionType.Move)
                    ResolveMoveAction(action, tm, other, state);
                else
                    ResolveAttackAction(action, tm, other, state);
            }

            CheckDestinyBond(p1, p2);
        }

        public void EndTurn(BattleState state)
        {
            L("── End of turn ──");

            var p1 = state.P1;
            var p2 = state.P2;
            var tm = state.Terrain;

            if (!state.IsOver)
                ApplyEndOfTurnTerrainEffects(p1, p2, tm, state);

            // Tick cooldowns
            TickCooldowns(p1);
            TickCooldowns(p2);

            // Tick terrain durations, remove expired
            var expired = tm.TickAll();
            foreach (var (tile, name) in expired)
                L(tile == null
                    ? $"  Global weather '{name}' ended."
                    : $"  Terrain '{name}' at {tile} expired.");

            // Check winner (terrain may have caused KO)
            int winner = DetermineWinner(p1, p2);
            if (winner != -1 && !state.IsOver)
            {
                state.Winner = winner;
                state.IsOver = true;
                L(winner >= 0
                    ? $"🏆 Player {winner} wins (terrain KO)!"
                    : "🤝 Draw (terrain KO)!");
            }

            state.TurnNumber++;
            L($"End T{state.TurnNumber}  "
              + $"P1 HP:{p1.CurrentHp}/{p1.MaxHp}@{p1.Tile}  "
              + $"P2 HP:{p2.CurrentHp}/{p2.MaxHp}@{p2.Tile}");
        }

        // ── Queue Building ────────────────────────────────────────────────────
        private List<QueuedAction> BuildQueue(PokemonState p1, PokemonState p2)
        {
            var queue = new List<QueuedAction>();

            foreach (var poke in new[] { p1, p2 })
            {
                if (!poke.IsAlive || poke.Declaration == null) continue;

                var move = MoveRegistry.Get(poke.Declaration.MoveName);
                if (move == null)
                {
                    L($"  ⚠️ P{poke.PlayerId}: move '{poke.Declaration.MoveName}' not in registry — skipped.");
                    continue;
                }

                var (mp, ap) = poke.GetActionPriorities();

                if (move.QuickPriority)
                {
                    // Quick Attack priority scheme
                    float boostedP = QaAttackPriority(poke.EffectiveSpeed,
                                                       poke.Declaration.ActionOrder);
                    if (poke.Declaration.ActionOrder == ActionOrder.AttackFirst)
                    {
                        queue.Add(new QueuedAction
                        {
                            Priority = boostedP,
                            PlayerId = poke.PlayerId,
                            Type     = ActionType.Attack,
                            Pokemon  = poke
                        });
                    }
                    else
                    {
                        // Move-first QA: move and attack both at boosted priority
                        queue.Add(new QueuedAction
                            { Priority = boostedP, PlayerId = poke.PlayerId,
                              Type = ActionType.Move, Pokemon = poke });
                        queue.Add(new QueuedAction
                            { Priority = boostedP, PlayerId = poke.PlayerId,
                              Type = ActionType.Attack, Pokemon = poke });
                    }
                }
                else
                {
                    queue.Add(new QueuedAction
                        { Priority = mp, PlayerId = poke.PlayerId,
                          Type = ActionType.Move, Pokemon = poke });
                    queue.Add(new QueuedAction
                        { Priority = ap, PlayerId = poke.PlayerId,
                          Type = ActionType.Attack, Pokemon = poke });
                }
            }

            queue.Sort((a, b) => b.Priority.CompareTo(a.Priority));
            return queue;
        }

        // ── Priority Helpers ──────────────────────────────────────────────────
        private static float QaAttackPriority(int speed, ActionOrder order)
        {
            float sp = order == ActionOrder.AttackFirst
                ? speed * GameConstants.QA_MF_SPEED_MULT
                : speed;
            return sp + GameConstants.MOVE_FIRST_COST + 100f; // 100 = base QA offset
        }

        // ── Move Action ───────────────────────────────────────────────────────
        private void ResolveMoveAction(
            QueuedAction action, TerrainManager tm,
            PokemonState other, BattleState state,
            int overrideRange = -1)
        {
            var poke = action.Pokemon;
            var decl = poke.Declaration;
            var move = MoveRegistry.Get(decl.MoveName);

            // Flinch / hypnosis checks
            if (poke.Flinched)
            {
                L($"  {poke.Name} is flinched — cannot move!");
                return;
            }
            if (poke.Hypnotized)
            {
                L($"  {poke.Name} is hypnotized — cannot move!");
                return;
            }

            // Taunt blocks terrain/status
            if (poke.Taunted && (move.Category == MoveCategory.Terrain
                               || move.Category == MoveCategory.Status))
            {
                L($"  {poke.Name} is taunted — {decl.MoveName} blocked!");
                return;
            }

            int range = overrideRange >= 0
                ? overrideRange
                : GameConstants.BaseRange(poke.EffectiveSpeed);

            // Truncate path
            var blockers  = tm.GetBlockedTiles();
            var occupied  = new HashSet<Vector2Int> { other.Tile };
            var path      = TruncatePath(
                decl.PlannedPath, blockers, occupied,
                poke.CanPassThrough, range, tm);

            // Apply stat hazards from path
            ApplyMovementStatHazards(poke, path, tm, state);

            // Apply poison trap
            if (path.Count > 1)
                foreach (var tile in path)
                    if (tm.GetTerrainType(tile) == TerrainType.PoisonTrap)
                    {
                        // Poison: not implemented fully here, add status
                        L($"  {poke.Name} stepped on poison trap at {tile}!");
                    }

            // Move Pokémon
            if (path.Count > 0)
                poke.Tile = path[^1];

            L($"  P{poke.PlayerId} moves → {poke.Tile} (path len {path.Count - 1})");
        }

        // ── Attack Action ─────────────────────────────────────────────────────
        private void ResolveAttackAction(
            QueuedAction action, TerrainManager tm,
            PokemonState defender, BattleState state)
        {
            var attacker = action.Pokemon;
            var decl     = attacker.Declaration;
            var move     = MoveRegistry.Get(decl.MoveName);

            if (!attacker.IsAlive || !defender.IsAlive) return;

            if (attacker.Flinched)
            {
                L($"  {attacker.Name} is flinched — cannot attack!");
                return;
            }
            if (attacker.Hypnotized)
            {
                L($"  {attacker.Name} is hypnotized — cannot attack!");
                return;
            }

            // Cooldown check
            if (attacker.Cooldowns.TryGetValue(decl.MoveName, out int cd) && cd > 0)
            {
                L($"  {attacker.Name} {decl.MoveName} on cooldown ({cd} turns) — skipped.");
                return;
            }

            // Range / LoS check
            int dist = HexGrid.HexDistance(attacker.Tile, defender.Tile);

            // Status/terrain moves: use on target tile (no range check vs opponent)
            bool isOffensive = move.Category == MoveCategory.Physical
                            || move.Category == MoveCategory.Special;

            if (isOffensive)
            {
                int attackRange = move.IsRanged
                    ? 8   // ranged: essentially full grid
                    : 1;  // melee: must be adjacent

                if (dist > attackRange)
                {
                    L($"  {attacker.Name} out of range (dist={dist}) — attack whiffs.");
                    return;
                }

                if (move.RequiresLoS && !move.BypassesLoS)
                {
                    var blockers = tm.GetBlockedTiles();
                    if (!HexGrid.HasLineOfSight(attacker.Tile, defender.Tile, blockers))
                    {
                        L($"  {attacker.Name} blocked by terrain — no LoS.");
                        return;
                    }
                }

                // Momentum
                float momentum = CalcMomentum(attacker, decl.PlannedPath);

                // Type effectiveness
                float typeMult = DamageCalculator.TypeEffectiveness(
                    move.Type, defender.Types);

                // Weather modifier from terrain
                float weatherMult = CalcWeatherMult(move.Type, attacker.Tile, defender.Tile, tm);

                // Power modifier (early stop, QA penalty, etc.)
                float powerMult = CalcPowerMult(move, attacker, decl, momentum);

                int damage = DamageCalculator.Calculate(
                    move, attacker, defender,
                    momentum:    momentum,
                    powerMult:   powerMult,
                    typeMult:    typeMult,
                    weatherMult: weatherMult);

                // Recoil
                if (move.RecoilFraction > 0f)
                {
                    int recoil = move.Name == "Volt Tackle"
                        ? DamageCalculator.VoltTackleRecoil(damage, momentum)
                        : Mathf.Max(1, Mathf.FloorToInt(damage * move.RecoilFraction));
                    attacker.CurrentHp -= recoil;
                    attacker.CurrentHp  = Mathf.Max(0, attacker.CurrentHp);
                    L($"  {attacker.Name} takes {recoil} recoil.");
                }

                // Apply damage
                defender.CurrentHp -= damage;
                defender.CurrentHp  = Mathf.Max(0, defender.CurrentHp);

                L($"  {attacker.Name} → {move.Name} → {defender.Name}: "
                  + $"{damage} dmg (type×{typeMult:F2}, mom×{momentum:F2}). "
                  + $"Defender HP: {defender.CurrentHp}/{defender.MaxHp}");

                // Flinch
                if (move.SkipTurnOnHit)
                {
                    defender.Flinched = true;
                    L($"  {defender.Name} flinched!");
                }

                // Self-debuffs (e.g. Close Combat)
                foreach (var (stat, delta) in move.SelfDebuffs)
                {
                    attacker.ApplyStatStage(stat, delta);
                    L($"  {attacker.Name} stat {stat} {delta:+0;-0}");
                }

                // Destiny Bond check
                if (decl.MoveName == "Destiny Bond" && !defender.IsAlive)
                    _destinyBond[attacker.PlayerId] = true;

                // Set cooldown
                SetCooldown(attacker, move);

                // AOE (if applicable)
                if (move.AoeRadius > 0)
                    ApplyAoe(move, attacker, decl.TargetTile, tm, state);
            }
            else
            {
                // Terrain / Status — apply on target tile
                ApplyTerrainOrStatus(move, attacker, decl.TargetTile, tm, state);
                SetCooldown(attacker, move);
            }
        }

        // ── Terrain / Status Move Application ────────────────────────────────
        private void ApplyTerrainOrStatus(
            MoveDefinition move, PokemonState attacker,
            Vector2Int targetTile, TerrainManager tm, BattleState state)
        {
            // Map move name → terrain type
            var terrainMap = new Dictionary<string, TerrainType>
            {
                ["Mud Shot"]    = TerrainType.SlowZone,
                ["Toxic"]       = TerrainType.PoisonTrap,
                ["Will-O-Wisp"] = TerrainType.BurnZone,
                ["Misty Terrain"] = TerrainType.MistZone,
                ["Sunny Day"]   = TerrainType.SunnyZone,
                ["Rain Dance"]  = TerrainType.RainZone,
                ["Metal Sound"] = TerrainType.ResonanceZone,
                ["Perish Trap"] = TerrainType.PeishZone,
                ["Hail"]        = TerrainType.IceZone,
            };

            if (terrainMap.TryGetValue(move.Name, out var tType))
            {
                tm.PlaceTerrain(targetTile, tType, duration: 5);
                L($"  {attacker.Name} placed {tType} at {targetTile}.");
            }
            else
            {
                L($"  {attacker.Name} used {move.Name} at {targetTile} (status effect).");
            }
        }

        // ── AOE ───────────────────────────────────────────────────────────────
        private void ApplyAoe(
            MoveDefinition move, PokemonState attacker,
            Vector2Int center, TerrainManager tm, BattleState state)
        {
            var disc = HexGrid.GetDisc(center, move.AoeRadius);
            foreach (var tile in disc)
                tm.PlaceTerrain(tile, TerrainType.BurnZone, duration: 3);

            L($"  AoE {move.Name} applied to {disc.Count} tiles around {center}.");
        }

        // ── End-of-Turn Terrain Effects ───────────────────────────────────────
        private void ApplyEndOfTurnTerrainEffects(
            PokemonState p1, PokemonState p2,
            TerrainManager tm, BattleState state)
        {
            foreach (var poke in new[] { p1, p2 })
            {
                if (!poke.IsAlive) continue;

                var tType = tm.GetTerrainType(poke.Tile);

                // Burn zone — 1/8 max HP
                if (tType == TerrainType.BurnZone)
                {
                    int dmg = DamageCalculator.BurnZoneDamage(poke);
                    poke.CurrentHp = Mathf.Max(0, poke.CurrentHp - dmg);
                    L($"  {poke.Name} takes {dmg} burn zone damage.");
                }

                // Ice zone — 6% max HP (non-Ice types)
                if (tType == TerrainType.IceZone)
                {
                    int dmg = DamageCalculator.IceChipDamage(poke);
                    if (dmg > 0)
                    {
                        poke.CurrentHp = Mathf.Max(0, poke.CurrentHp - dmg);
                        L($"  {poke.Name} takes {dmg} ice chip damage.");
                    }
                }

                // Resonance zone — -1 SpDef per turn
                if (tType == TerrainType.ResonanceZone)
                {
                    poke.ApplyStatStage(StatName.SpDef, -1);
                    L($"  {poke.Name} SpDef -1 (resonance zone).");
                }

                // Perish zone — countdown
                if (tType == TerrainType.PeishZone)
                {
                    if (poke.PerishCountdown == 0)
                        poke.PerishCountdown = GameConstants.PERISH_COUNTDOWN_TURNS;

                    poke.PerishCountdown--;
                    L($"  {poke.Name} perish countdown: {poke.PerishCountdown}");
                    if (poke.PerishCountdown == 0)
                    {
                        poke.CurrentHp = 0;
                        L($"  {poke.Name} fainted from Perish Trap!");
                    }
                }
                else
                {
                    poke.PerishCountdown = 0; // reset if no longer on tile
                }

                // Burned status (from burn_zone or Will-O-Wisp)
                if (poke.Burned)
                {
                    int dmg = DamageCalculator.BurnZoneDamage(poke);
                    poke.CurrentHp = Mathf.Max(0, poke.CurrentHp - dmg);
                    L($"  {poke.Name} takes {dmg} burn damage.");
                }
            }
        }

        // ── Destiny Bond ──────────────────────────────────────────────────────
        private void CheckDestinyBond(PokemonState p1, PokemonState p2)
        {
            if (_destinyBond.ContainsKey(1) && !p1.IsAlive && p2.IsAlive)
            {
                p2.CurrentHp = 0;
                L("  Destiny Bond: P2 drawn down with P1!");
            }
            if (_destinyBond.ContainsKey(2) && !p2.IsAlive && p1.IsAlive)
            {
                p1.CurrentHp = 0;
                L("  Destiny Bond: P1 drawn down with P2!");
            }
        }

        // ── Winner Determination ──────────────────────────────────────────────
        private static int DetermineWinner(PokemonState p1, PokemonState p2)
        {
            bool p1dead = !p1.IsAlive;
            bool p2dead = !p2.IsAlive;
            if (p1dead && p2dead) return 0; // draw
            if (p1dead)           return 2;
            if (p2dead)           return 1;
            return -1; // still going
        }

        // ── Helpers ───────────────────────────────────────────────────────────
        private static List<Vector2Int> TruncatePath(
            Vector2Int[] path,
            HashSet<Vector2Int> blockers,
            HashSet<Vector2Int> occupied,
            bool canPass, int moveRange,
            TerrainManager tm)
        {
            if (path == null || path.Length == 0)
                return new List<Vector2Int>();

            var result = new List<Vector2Int> { path[0] };
            int cost   = 0;

            for (int i = 1; i < path.Length; i++)
            {
                var tile = path[i];
                if (blockers.Contains(tile)) break;
                if (!canPass && occupied.Contains(tile)) break;

                int stepCost = tm.GetStepCost(tile);
                if (cost + stepCost > moveRange) break;
                cost += stepCost;
                result.Add(tile);
            }
            return result;
        }

        private static float CalcMomentum(PokemonState poke, Vector2Int[] path)
        {
            if (path == null || path.Length < 2) return 1f;
            int straight = CountStraightTiles(path);
            return PokemonState.CalcMomentum(straight);
        }

        private static int CountStraightTiles(Vector2Int[] path)
        {
            if (path.Length < 2) return 0;
            int count = 0;
            var dir   = path[1] - path[0];
            for (int i = 2; i < path.Length; i++)
            {
                if (path[i] - path[i - 1] == dir) count++;
                else break;
            }
            return count;
        }

        private static float CalcPowerMult(
            MoveDefinition move, PokemonState attacker,
            DeclarationPayload decl, float momentum)
        {
            // Quick Attack move-first power penalty
            if (move.QuickPriority && decl.ActionOrder == ActionOrder.MoveFirst)
            {
                float steps  = decl.PlannedPath?.Length - 1 ?? 0;
                float penalty = steps * GameConstants.QA_MF_POWER_PENALTY;
                return Mathf.Max(GameConstants.QA_MF_POWER_MIN,
                                 GameConstants.QA_AF_POWER_MULT - penalty);
            }

            // Early stop: attacker didn't use full movement → power boost
            if (decl.PlannedPath != null)
            {
                int maxRange = GameConstants.BaseRange(attacker.EffectiveSpeed);
                int used     = decl.PlannedPath.Length - 1;
                int stopped  = maxRange - used;
                if (stopped > 0)
                {
                    float boost = Mathf.Min(
                        GameConstants.EARLY_STOP_MAX,
                        1f + stopped * GameConstants.EARLY_STOP_PER_TILE);
                    return boost;
                }
            }

            return 1f;
        }

        private static float CalcWeatherMult(
            string moveType, Vector2Int attackerTile,
            Vector2Int defenderTile, TerrainManager tm)
        {
            var sunTiles  = tm.GetTilesOfType(TerrainType.SunnyZone);
            var rainTiles = tm.GetTilesOfType(TerrainType.RainZone);

            bool inSun  = sunTiles.Contains(attackerTile)  || sunTiles.Contains(defenderTile);
            bool inRain = rainTiles.Contains(attackerTile) || rainTiles.Contains(defenderTile);

            if (inSun)
            {
                if (moveType == "Fire")  return 1.5f;
                if (moveType == "Water") return 0.5f;
            }
            if (inRain)
            {
                if (moveType == "Water") return 1.5f;
                if (moveType == "Fire")  return 0.5f;
            }
            return 1f;
        }

        private static void ApplyMovementStatHazards(
            PokemonState poke, List<Vector2Int> path,
            TerrainManager tm, BattleState state)
        {
            // Applies stat changes from stat-hazard tiles walked through
            var visited = new HashSet<string>();
            foreach (var tile in path)
            {
                var effect = tm.GetStatEffect(tile);
                if (effect == null) continue;
                if (tm.IsMistProtected(tile)) continue;

                string key = $"{tile}";
                if (visited.Contains(key)) continue;
                visited.Add(key);

                foreach (var (stat, delta) in effect)
                    poke.ApplyStatStage(stat, delta);
            }
        }

        private static void SetCooldown(PokemonState poke, MoveDefinition move)
        {
            int cd = move.Category == MoveCategory.Physical
                  || move.Category == MoveCategory.Special
                ? GameConstants.COOLDOWN_ATTACK_FIRST
                : GameConstants.COOLDOWN_MOVE_FIRST;

            poke.Cooldowns[move.Name] = cd;
        }

        private static void TickCooldowns(PokemonState poke)
        {
            var keys = new List<string>(poke.Cooldowns.Keys);
            foreach (var k in keys)
            {
                poke.Cooldowns[k]--;
                if (poke.Cooldowns[k] <= 0)
                    poke.Cooldowns.Remove(k);
            }
        }
    }

    // ── BattleState container ─────────────────────────────────────────────────
    public class BattleState
    {
        public int           TurnNumber;
        public PokemonState  P1;
        public PokemonState  P2;
        public TerrainManager Terrain = new();
        public bool          IsOver;
        public int           Winner = -1; // -1=ongoing, 0=draw, 1=p1, 2=p2
    }

    // ── Stub TerrainManager (implement fully in Rendering/TerrainManager.cs) ──
    public class TerrainManager
    {
        private readonly Dictionary<Vector2Int, (TerrainType type, int duration)> _tiles = new();

        public TerrainType GetTerrainType(Vector2Int tile)
            => _tiles.TryGetValue(tile, out var t) ? t.type : TerrainType.None;

        public void PlaceTerrain(Vector2Int tile, TerrainType type, int duration)
            => _tiles[tile] = (type, duration);

        public HashSet<Vector2Int> GetBlockedTiles()
        {
            var set = new HashSet<Vector2Int>();
            foreach (var kv in _tiles)
                if (kv.Value.type == TerrainType.RockPile
                 || kv.Value.type == TerrainType.TreeObstacle)
                    set.Add(kv.Key);
            return set;
        }

        public int GetStepCost(Vector2Int tile)
            => GetTerrainType(tile) == TerrainType.SlowZone ? 2 : 1;

        public HashSet<Vector2Int> GetTilesOfType(TerrainType type)
        {
            var set = new HashSet<Vector2Int>();
            foreach (var kv in _tiles)
                if (kv.Value.type == type) set.Add(kv.Key);
            return set;
        }

        public (StatName stat, int delta)[] GetStatEffect(Vector2Int tile)
        {
            var t = GetTerrainType(tile);
            return t == TerrainType.ResonanceZone
                ? new[] { (StatName.SpDef, -1) }
                : null;
        }

        public bool IsMistProtected(Vector2Int tile)
            => GetTerrainType(tile) == TerrainType.MistZone;

        public List<(Vector2Int? tile, string name)> TickAll()
        {
            var expired = new List<(Vector2Int? tile, string name)>();
            var toRemove = new List<Vector2Int>();

            foreach (var kv in _tiles)
            {
                int newDur = kv.Value.duration - 1;
                if (newDur <= 0)
                {
                    toRemove.Add(kv.Key);
                    expired.Add((kv.Key, kv.Value.type.ToString()));
                }
                else
                    _tiles[kv.Key] = (kv.Value.type, newDur);
            }
            foreach (var t in toRemove) _tiles.Remove(t);
            return expired;
        }
    }
}
