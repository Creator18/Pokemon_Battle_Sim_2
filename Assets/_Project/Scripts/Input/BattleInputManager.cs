using System.Collections.Generic;
using UnityEngine;
using HexBattle.Core;
using HexBattle.Rendering;
using HexBattle.Network;

namespace HexBattle.Input
{
    /// <summary>
    /// Central input coordinator for the Battle phase.
    ///
    /// State machine:
    ///   Idle → SelectingMove → SelectingTarget → SelectingPath → Confirmed
    ///
    /// Listens to TileInputHandler events and builds a DeclarationData
    /// which is submitted to BattleNetworkState.SubmitDeclarationServerRpc().
    /// </summary>
    public class BattleInputManager : MonoBehaviour
    {
        public static BattleInputManager Instance { get; private set; }

        // ── State ─────────────────────────────────────────────────────────────
        private enum InputPhase
        {
            Idle,
            SelectingMove,
            SelectingTarget,
            DrawingPath,
            Confirmed
        }

        private InputPhase          _phase = InputPhase.Idle;
        private string              _selectedMove;
        private ActionOrder         _selectedOrder;
        private Vector2Int          _targetTile;
        private List<Vector2Int>    _pathTiles = new();
        private Vector2Int          _myCurrentTile;

        // ── References ────────────────────────────────────────────────────────
        [Header("References")]
        public HexGridBuilder GridBuilder;

        [Header("My Player ID (set from NetworkManager on start)")]
        public int MyPlayerId = 1;

        // ── Events ────────────────────────────────────────────────────────────
        public event System.Action<DeclarationData> OnDeclarationReady;

        private void Awake()
        {
            if (Instance != null) { Destroy(gameObject); return; }
            Instance = this;
        }

        private void Start()
        {
            TileInputHandler.Instance.OnTileClicked     += OnTileClicked;
            TileInputHandler.Instance.OnTileHovered     += OnTileHovered;
            TileInputHandler.Instance.OnTileRightClicked+= OnTileRightClicked;

            if (BattleNetworkState.Instance != null)
                BattleNetworkState.Instance.OnResolutionReceived += _ => ResetInputState();
        }

        // ── Public API (called by UI buttons) ─────────────────────────────────
        public void SelectMove(string moveName, ActionOrder order)
        {
            _selectedMove  = moveName;
            _selectedOrder = order;
            _phase         = InputPhase.SelectingTarget;
            ShowMovementRange();
        }

        public void CancelSelection()
        {
            ResetInputState();
            GridBuilder?.ClearAllHighlights();
        }

        // ── Tile Interaction ──────────────────────────────────────────────────
        private void OnTileClicked(HexTile tile)
        {
            switch (_phase)
            {
                case InputPhase.SelectingTarget:
                    _targetTile = tile.Coords;
                    _pathTiles.Clear();
                    _pathTiles.Add(_myCurrentTile);
                    _phase = InputPhase.DrawingPath;
                    ShowAttackRange(_targetTile);
                    break;

                case InputPhase.DrawingPath:
                    // Extend path by one step if adjacent
                    if (_pathTiles.Count > 0)
                    {
                        var last = _pathTiles[^1];
                        int dist = HexGrid.HexDistance(last, tile.Coords);
                        if (dist == 1 && !_pathTiles.Contains(tile.Coords))
                        {
                            _pathTiles.Add(tile.Coords);
                            HighlightPath();
                        }
                    }
                    break;
            }
        }

        private void OnTileHovered(HexTile tile)
        {
            if (_phase == InputPhase.DrawingPath)
            {
                // Preview path up to hovered tile using BFS
                var preview = BfsPath(_myCurrentTile, tile.Coords);
                GridBuilder?.ClearAllHighlights();
                GridBuilder?.SetHighlights(preview, HighlightType.Path, clearFirst: false);
                GridBuilder?.SetHighlights(
                    HexGrid.GetDisc(tile.Coords, 0),
                    HighlightType.Target, clearFirst: false);
            }
        }

        private void OnTileRightClicked(HexTile tile)
        {
            // Right-click removes last path step
            if (_phase == InputPhase.DrawingPath && _pathTiles.Count > 1)
            {
                _pathTiles.RemoveAt(_pathTiles.Count - 1);
                HighlightPath();
            }
        }

        // ── Confirm Declaration ───────────────────────────────────────────────
        public void ConfirmDeclaration()
        {
            if (_phase != InputPhase.DrawingPath && _phase != InputPhase.SelectingTarget)
                return;

            var decl = new DeclarationData
            {
                PlayerId    = MyPlayerId,
                MoveName    = _selectedMove,
                ActionOrder = _selectedOrder,
                TargetTile  = _targetTile,
                PlannedPath = _pathTiles.ToArray()
            };

            BattleNetworkState.Instance?.SubmitDeclarationServerRpc(decl);
            OnDeclarationReady?.Invoke(decl);
            _phase = InputPhase.Confirmed;
            GridBuilder?.ClearAllHighlights();

            UI.BattleUIManager.Instance?.HideDeclarationPanel();
        }

        // ── Helpers ───────────────────────────────────────────────────────────
        private void ShowMovementRange()
        {
            if (GridBuilder == null) return;
            GridBuilder.ClearAllHighlights();

            int speed = GetMySpeed();
            int range = GameConstants.BaseRange(speed);

            var reachable = HexGrid.FloodFill(
                _myCurrentTile, range,
                GridBuilder.Tiles.Keys);

            GridBuilder.SetHighlights(reachable, HighlightType.MoveRange);
        }

        private void ShowAttackRange(Vector2Int center)
        {
            GridBuilder?.SetHighlights(
                new[] { center }, HighlightType.AttackRange, clearFirst: false);
        }

        private void HighlightPath()
        {
            GridBuilder?.ClearAllHighlights();
            GridBuilder?.SetHighlights(_pathTiles, HighlightType.Path);
        }

        private static List<Vector2Int> BfsPath(Vector2Int from, Vector2Int to)
        {
            // Simple BFS — returns shortest path
            var parent  = new Dictionary<Vector2Int, Vector2Int>();
            var queue   = new Queue<Vector2Int>();
            var visited = new HashSet<Vector2Int>();

            queue.Enqueue(from);
            visited.Add(from);
            parent[from] = from;

            while (queue.Count > 0)
            {
                var cur = queue.Dequeue();
                if (cur == to) break;
                foreach (var nb in HexGrid.GetNeighbors(cur))
                {
                    if (visited.Contains(nb)) continue;
                    visited.Add(nb);
                    parent[nb] = cur;
                    queue.Enqueue(nb);
                }
            }

            var path = new List<Vector2Int>();
            if (!parent.ContainsKey(to)) return path;

            var step = to;
            while (step != from)
            {
                path.Add(step);
                step = parent[step];
            }
            path.Add(from);
            path.Reverse();
            return path;
        }

        private void ResetInputState()
        {
            _phase        = InputPhase.Idle;
            _selectedMove = null;
            _pathTiles.Clear();
            GridBuilder?.ClearAllHighlights();
        }

        private int GetMySpeed()
        {
            var state = Battle.TurnManager.Instance?.State;
            if (state == null) return 90;
            return MyPlayerId == 1 ? state.P1.Speed : state.P2.Speed;
        }

        // ── Sync current tile from network state ──────────────────────────────
        private void Update()
        {
            if (BattleNetworkState.Instance == null) return;
            var ns = BattleNetworkState.Instance;
            _myCurrentTile = MyPlayerId == 1
                ? ns.P1Tile.Value
                : ns.P2Tile.Value;
        }
    }
}
