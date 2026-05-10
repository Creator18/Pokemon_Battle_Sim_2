using System.Collections;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.SceneManagement;
using TMPro;
using HexBattle.Network;

namespace HexBattle.UI
{
    /// <summary>
    /// Lobby scene UI — Create / Join session flow.
    /// Visual style: #0D0D1A background, #EF4444 accent, #E8E8F0 text.
    /// </summary>
    public class LobbyUI : MonoBehaviour
    {
        [Header("Panels")]
        public GameObject   MainMenuPanel;
        public GameObject   CreatePanel;
        public GameObject   JoinPanel;
        public GameObject   WaitingPanel;

        [Header("Create Panel")]
        public TextMeshProUGUI GeneratedCodeText;
        public Button          CopyCodeButton;

        [Header("Join Panel")]
        public TMP_InputField  JoinCodeInput;
        public Button          JoinConfirmButton;

        [Header("Status")]
        public TextMeshProUGUI StatusText;

        [Header("Buttons")]
        public Button CreateSessionButton;
        public Button JoinSessionButton;
        public Button BackButton;

        [Header("Scene to load")]
        public string BattleSceneName = "Battle";

        private string _myCode;

        private void Start()
        {
            ShowPanel(MainMenuPanel);

            CreateSessionButton?.onClick.AddListener(() =>
            {
                ShowPanel(CreatePanel);
                _ = DoCreate();
            });
            JoinSessionButton?.onClick.AddListener(()  => ShowPanel(JoinPanel));
            JoinConfirmButton?.onClick.AddListener(()  => _ = DoJoin());
            CopyCodeButton?.onClick.AddListener(CopyCode);
            BackButton?.onClick.AddListener(() => ShowPanel(MainMenuPanel));

            // Subscribe to session events
            if (SessionManager.Instance != null)
            {
                SessionManager.Instance.OnSessionCreated += code =>
                {
                    _myCode = code;
                    if (GeneratedCodeText != null)
                        GeneratedCodeText.text = code;
                    ShowPanel(WaitingPanel);
                    SetStatus("Waiting for Player 2…");
                };
                SessionManager.Instance.OnSessionJoined += () =>
                {
                    ShowPanel(WaitingPanel);
                    SetStatus("Connected — loading battle…");
                    StartCoroutine(LoadBattleScene());
                };
                SessionManager.Instance.OnError += msg =>
                    SetStatus($"Error: {msg}", error: true);
                SessionManager.Instance.OnBothPlayersReady += ()
                    => StartCoroutine(LoadBattleScene());
            }
        }

        private async System.Threading.Tasks.Task DoCreate()
        {
            SetStatus("Creating session…");
            await SessionManager.Instance.CreateSession();
        }

        private async System.Threading.Tasks.Task DoJoin()
        {
            string code = JoinCodeInput?.text?.Trim().ToUpper();
            if (string.IsNullOrEmpty(code)) { SetStatus("Enter a lobby code."); return; }
            SetStatus($"Joining {code}…");
            await SessionManager.Instance.JoinSession(code);
        }

        private IEnumerator LoadBattleScene()
        {
            SetStatus("Loading battle…");
            yield return new WaitForSeconds(0.5f);
            SceneManager.LoadScene(BattleSceneName);
        }

        private void CopyCode()
        {
            if (string.IsNullOrEmpty(_myCode)) return;
            GUIUtility.systemCopyBuffer = _myCode;
            SetStatus("Code copied!");
        }

        private void SetStatus(string msg, bool error = false)
        {
            if (StatusText == null) return;
            StatusText.text  = msg;
            StatusText.color = error
                ? new Color(0.94f, 0.27f, 0.27f)  // #EF4444
                : new Color(0.91f, 0.91f, 0.94f);  // #E8E8F0
        }

        private void ShowPanel(GameObject panel)
        {
            foreach (var p in new[] { MainMenuPanel, CreatePanel, JoinPanel, WaitingPanel })
                p?.SetActive(p == panel);
        }
    }
}
