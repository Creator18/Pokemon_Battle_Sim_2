using System.Threading.Tasks;
using UnityEngine;
using Unity.Services.Core;
using Unity.Services.Authentication;

namespace HexBattle.Network
{
    /// <summary>
    /// Bootstraps Unity Gaming Services on startup.
    /// Attach to a persistent GameObject in the Lobby scene.
    /// </summary>
    public class NetworkManagerSetup : MonoBehaviour
    {
        public static NetworkManagerSetup Instance { get; private set; }
        public static bool ServicesReady { get; private set; }

        [SerializeField] private bool _logDebug = true;

        private void Awake()
        {
            if (Instance != null) { Destroy(gameObject); return; }
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }

        private async void Start()
        {
            await InitializeAsync();
        }

        private async Task InitializeAsync()
        {
            try
            {
                await UnityServices.InitializeAsync();

                if (!AuthenticationService.Instance.IsSignedIn)
                    await AuthenticationService.Instance.SignInAnonymouslyAsync();

                string pid = AuthenticationService.Instance.PlayerId;
                if (_logDebug)
                    Debug.Log($"[HexBattle] UGS ready. Player ID: {pid}");

                ServicesReady = true;
            }
            catch (System.Exception e)
            {
                Debug.LogError($"[HexBattle] UGS init failed: {e.Message}");
            }
        }
    }
}
