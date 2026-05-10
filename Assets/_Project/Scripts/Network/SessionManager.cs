using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using UnityEngine;
using Unity.Services.Relay;
using Unity.Services.Relay.Models;
using Unity.Services.Lobbies;
using Unity.Services.Lobbies.Models;
using Unity.Netcode;
using Unity.Netcode.Transports.UTP;

namespace HexBattle.Network
{
    /// <summary>
    /// Manages session creation (host) and joining (client) via
    /// Unity Relay + Unity Lobby + Netcode for GameObjects.
    /// Attach to a persistent NetworkManager GameObject.
    /// </summary>
    public class SessionManager : NetworkBehaviour
    {
        public static SessionManager Instance { get; private set; }

        private Lobby  _currentLobby;
        private string _lobbyCode;

        public event Action<string> OnSessionCreated;   // arg: lobby code for P2
        public event Action         OnSessionJoined;
        public event Action         OnBothPlayersReady;
        public event Action<string> OnError;

        private const int  MAX_PLAYERS       = 2;
        private const string RELAY_CODE_KEY  = "RelayCode";

        private void Awake()
        {
            if (Instance != null) { Destroy(gameObject); return; }
            Instance = this;
        }

        // ── HOST: Create session ─────────────────────────────────────────────
        public async Task<string> CreateSession()
        {
            if (!NetworkManagerSetup.ServicesReady)
            {
                OnError?.Invoke("UGS not ready.");
                return null;
            }

            try
            {
                // 1. Allocate Unity Relay slot for 2 players
                Allocation alloc = await RelayService.Instance
                    .CreateAllocationAsync(MAX_PLAYERS);

                // 2. Get the join code clients will use
                string relayCode = await RelayService.Instance
                    .GetJoinCodeAsync(alloc.AllocationId);

                // 3. Configure UnityTransport to use Relay
                var transport = NetworkManager.Singleton
                    .GetComponent<UnityTransport>();
                transport.SetRelayServerData(
                    alloc.RelayServer.IpV4,
                    (ushort)alloc.RelayServer.Port,
                    alloc.AllocationIdBytes,
                    alloc.Key,
                    alloc.ConnectionData);

                // 4. Create a Unity Lobby with relay code embedded
                var opts = new CreateLobbyOptions
                {
                    IsPrivate = false,
                    Data = new Dictionary<string, DataObject>
                    {
                        [RELAY_CODE_KEY] = new DataObject(
                            DataObject.VisibilityOptions.Public,
                            relayCode)
                    }
                };
                _currentLobby = await LobbyService.Instance
                    .CreateLobbyAsync("HexBattle", MAX_PLAYERS, opts);

                _lobbyCode = _currentLobby.LobbyCode;

                // 5. Start host
                NetworkManager.Singleton.StartHost();

                Debug.Log($"[Session] Created. Lobby code: {_lobbyCode}");
                OnSessionCreated?.Invoke(_lobbyCode);
                return _lobbyCode;
            }
            catch (Exception e)
            {
                Debug.LogError($"[Session] CreateSession failed: {e.Message}");
                OnError?.Invoke(e.Message);
                return null;
            }
        }

        // ── CLIENT: Join session ─────────────────────────────────────────────
        public async Task JoinSession(string lobbyCode)
        {
            if (!NetworkManagerSetup.ServicesReady)
            {
                OnError?.Invoke("UGS not ready.");
                return;
            }

            try
            {
                // 1. Find lobby by code
                _currentLobby = await LobbyService.Instance
                    .JoinLobbyByCodeAsync(lobbyCode.ToUpper());

                // 2. Extract relay join code
                string relayCode = _currentLobby.Data[RELAY_CODE_KEY].Value;

                // 3. Join Relay allocation
                JoinAllocation joinAlloc = await RelayService.Instance
                    .JoinAllocationAsync(relayCode);

                // 4. Configure transport
                var transport = NetworkManager.Singleton
                    .GetComponent<UnityTransport>();
                transport.SetRelayServerData(
                    joinAlloc.RelayServer.IpV4,
                    (ushort)joinAlloc.RelayServer.Port,
                    joinAlloc.AllocationIdBytes,
                    joinAlloc.Key,
                    joinAlloc.ConnectionData,
                    joinAlloc.HostConnectionData);

                // 5. Start client
                NetworkManager.Singleton.StartClient();

                Debug.Log($"[Session] Joined lobby {lobbyCode}.");
                OnSessionJoined?.Invoke();
            }
            catch (Exception e)
            {
                Debug.LogError($"[Session] JoinSession failed: {e.Message}");
                OnError?.Invoke(e.Message);
            }
        }

        // ── Heartbeat (prevent Lobby from expiring) ──────────────────────────
        private float _heartbeatTimer;
        private const float HEARTBEAT_INTERVAL = 15f;

        private async void Update()
        {
            if (_currentLobby == null) return;
            if (!IsHost) return;

            _heartbeatTimer += Time.deltaTime;
            if (_heartbeatTimer >= HEARTBEAT_INTERVAL)
            {
                _heartbeatTimer = 0f;
                await LobbyService.Instance
                    .SendHeartbeatPingAsync(_currentLobby.Id);
            }
        }

        public async void LeaveLobby()
        {
            if (_currentLobby == null) return;
            try
            {
                await LobbyService.Instance.RemovePlayerAsync(
                    _currentLobby.Id,
                    AuthenticationService.Instance.PlayerId);
                _currentLobby = null;
            }
            catch { /* ignored on disconnect */ }
        }
    }
}
