using System;
using Unity.Collections;
using Unity.Netcode;
using UnityEngine;
using HexBattle.Core;

namespace HexBattle.Network
{
    /// <summary>
    /// NetworkBehaviour that owns all synchronized game state.
    /// Lives on a NetworkObject in the Battle scene (server-authoritative).
    /// </summary>
    public class BattleNetworkState : NetworkBehaviour
    {
        public static BattleNetworkState Instance { get; private set; }

        // ── Synchronized Variables ────────────────────────────────────────────
        public readonly NetworkVariable<int> TurnNumber = new(
            0, NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);

        public readonly NetworkVariable<GamePhase> Phase = new(
            GamePhase.Waiting,
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);

        // HP
        public readonly NetworkVariable<int> P1CurrentHp = new(
            0, NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        public readonly NetworkVariable<int> P1MaxHp = new(
            0, NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        public readonly NetworkVariable<int> P2CurrentHp = new(
            0, NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        public readonly NetworkVariable<int> P2MaxHp = new(
            0, NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);

        // Tile positions
        public readonly NetworkVariable<Vector2Int> P1Tile = new(
            new Vector2Int(-3, 0),
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        public readonly NetworkVariable<Vector2Int> P2Tile = new(
            new Vector2Int(3, 0),
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);

        // Species names (for UI)
        public readonly NetworkVariable<FixedString64Bytes> P1SpeciesName = new(
            new FixedString64Bytes(""),
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        public readonly NetworkVariable<FixedString64Bytes> P2SpeciesName = new(
            new FixedString64Bytes(""),
            NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);

        // Declaration ready flags
        public readonly NetworkVariable<bool> P1Declared = new(
            false, NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);
        public readonly NetworkVariable<bool> P2Declared = new(
            false, NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);

        // Winner (-1=ongoing, 0=draw, 1=p1, 2=p2)
        public readonly NetworkVariable<int> Winner = new(
            -1, NetworkVariableReadPermission.Everyone,
            NetworkVariableWritePermission.Server);

        // ── Events (client-side) ──────────────────────────────────────────────
        public event Action<ResolutionData>  OnResolutionReceived;
        public event Action<string>          OnBattleLogEntry;
        public event Action<SelectionData>   OnSelectionConfirmed;

        // ── Server-side declaration storage ──────────────────────────────────
        private DeclarationData? _p1Declaration;
        private DeclarationData? _p2Declaration;

        private void Awake()
        {
            if (Instance != null) { Destroy(gameObject); return; }
            Instance = this;
        }

        // ── RPCs ─────────────────────────────────────────────────────────────

        /// <summary>Client → Server: submit Pokémon selection.</summary>
        [ServerRpc(RequireOwnership = false)]
        public void SubmitSelectionServerRpc(
            FixedString64Bytes speciesName,
            ServerRpcParams rpc = default)
        {
            ulong clientId  = rpc.Receive.SenderClientId;
            int   playerId  = clientId == NetworkManager.ServerClientId ? 1 : 2;

            if (playerId == 1) P1SpeciesName.Value = speciesName;
            else               P2SpeciesName.Value = speciesName;

            // Check if both selected
            if (P1SpeciesName.Value.Length > 0 && P2SpeciesName.Value.Length > 0)
            {
                Phase.Value = GamePhase.Declaration;
                var data = new SelectionData
                {
                    P1Species = P1SpeciesName.Value.ToString(),
                    P2Species = P2SpeciesName.Value.ToString()
                };
                ReceiveSelectionClientRpc(data);
            }
        }

        /// <summary>Client → Server: submit turn declaration.</summary>
        [ServerRpc(RequireOwnership = false)]
        public void SubmitDeclarationServerRpc(
            DeclarationData decl,
            ServerRpcParams rpc = default)
        {
            ulong clientId = rpc.Receive.SenderClientId;
            int   pid      = clientId == NetworkManager.ServerClientId ? 1 : 2;

            if (pid == 1) { _p1Declaration = decl; P1Declared.Value = true; }
            else          { _p2Declaration = decl; P2Declared.Value = true; }

            // Both declared → run resolution
            if (_p1Declaration.HasValue && _p2Declaration.HasValue)
                ResolveTurn();
        }

        /// <summary>Server → All clients: broadcast selection result.</summary>
        [ClientRpc]
        private void ReceiveSelectionClientRpc(SelectionData data)
            => OnSelectionConfirmed?.Invoke(data);

        /// <summary>Server → All clients: broadcast resolution result.</summary>
        [ClientRpc]
        public void ReceiveResolutionClientRpc(ResolutionData data)
        {
            Phase.Value = GamePhase.EndOfTurn;
            OnResolutionReceived?.Invoke(data);
        }

        /// <summary>Server → All clients: single battle log line.</summary>
        [ClientRpc]
        public void AppendLogClientRpc(FixedString128Bytes line)
            => OnBattleLogEntry?.Invoke(line.ToString());

        // ── Server-side turn resolution ───────────────────────────────────────
        [Server]
        private void ResolveTurn()
        {
            if (!IsServer) return;

            Phase.Value = GamePhase.Resolution;

            // Pull live state from NetworkVariables into BattleState
            var state = Battle.TurnManager.Instance.State;
            state.P1.Declaration = ToPayload(_p1Declaration.Value, 1);
            state.P2.Declaration = ToPayload(_p2Declaration.Value, 2);

            var resolver = new Battle.TurnResolver();
            resolver.BeginTurn(state);
            resolver.ResolveTurn(state);

            // Sync results back to NetworkVariables
            P1CurrentHp.Value = state.P1.CurrentHp;
            P2CurrentHp.Value = state.P2.CurrentHp;
            P1Tile.Value      = state.P1.Tile;
            P2Tile.Value      = state.P2.Tile;

            // Build resolution payload
            var res = new ResolutionData
            {
                P1HpAfter    = state.P1.CurrentHp,
                P2HpAfter    = state.P2.CurrentHp,
                P1TileAfter  = state.P1.Tile,
                P2TileAfter  = state.P2.Tile,
                TurnNumber   = state.TurnNumber,
                IsOver       = state.IsOver,
                Winner       = state.Winner
            };

            // Push log
            foreach (var line in resolver.Log)
                AppendLogClientRpc(new FixedString128Bytes(
                    line.Length > 126 ? line[..126] : line));

            ReceiveResolutionClientRpc(res);

            // Clear declarations
            _p1Declaration = null;
            _p2Declaration = null;
            P1Declared.Value = false;
            P2Declared.Value = false;

            if (state.IsOver)
            {
                Winner.Value = state.Winner;
                Phase.Value  = GamePhase.GameOver;
            }
            else
            {
                resolver.EndTurn(state);
                TurnNumber.Value++;
                Phase.Value = GamePhase.Declaration;
            }
        }

        private static DeclarationPayload ToPayload(
            DeclarationData d, int playerId)
            => new()
            {
                MoveName    = d.MoveName.ToString(),
                ActionOrder = d.ActionOrder,
                TargetTile  = d.TargetTile,
                PlannedPath = d.PlannedPath
            };
    }

    // ── Network-serializable structs ──────────────────────────────────────────

    public struct DeclarationData : INetworkSerializable
    {
        public int                 PlayerId;
        public FixedString64Bytes  MoveName;
        public ActionOrder         ActionOrder;
        public Vector2Int          TargetTile;
        public Vector2Int[]        PlannedPath;

        public void NetworkSerialize<T>(BufferSerializer<T> s)
            where T : IReaderWriter
        {
            s.SerializeValue(ref PlayerId);
            s.SerializeValue(ref MoveName);
            s.SerializeValue(ref ActionOrder);
            s.SerializeValue(ref TargetTile);

            int len = PlannedPath?.Length ?? 0;
            s.SerializeValue(ref len);
            if (s.IsReader) PlannedPath = new Vector2Int[len];
            for (int i = 0; i < len; i++)
                s.SerializeValue(ref PlannedPath[i]);
        }
    }

    public struct ResolutionData : INetworkSerializable
    {
        public int        P1HpAfter;
        public int        P2HpAfter;
        public Vector2Int P1TileAfter;
        public Vector2Int P2TileAfter;
        public int        TurnNumber;
        public bool       IsOver;
        public int        Winner;

        public void NetworkSerialize<T>(BufferSerializer<T> s)
            where T : IReaderWriter
        {
            s.SerializeValue(ref P1HpAfter);
            s.SerializeValue(ref P2HpAfter);
            s.SerializeValue(ref P1TileAfter);
            s.SerializeValue(ref P2TileAfter);
            s.SerializeValue(ref TurnNumber);
            s.SerializeValue(ref IsOver);
            s.SerializeValue(ref Winner);
        }
    }

    public struct SelectionData : INetworkSerializable
    {
        public string P1Species;
        public string P2Species;

        public void NetworkSerialize<T>(BufferSerializer<T> s)
            where T : IReaderWriter
        {
            FixedString64Bytes p1 = P1Species ?? "";
            FixedString64Bytes p2 = P2Species ?? "";
            s.SerializeValue(ref p1);
            s.SerializeValue(ref p2);
            P1Species = p1.ToString();
            P2Species = p2.ToString();
        }
    }
}
