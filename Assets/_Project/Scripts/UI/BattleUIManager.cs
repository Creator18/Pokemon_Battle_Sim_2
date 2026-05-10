using System.Collections;
using UnityEngine;
using UnityEngine.UI;
using TMPro;
using HexBattle.Network;

namespace HexBattle.UI
{
    /// <summary>
    /// Central UI manager for the Battle scene.
    /// Manages: player panels, HP bars, battle log, turn banner, game over overlay.
    ///
    /// Color palette matches the original web version:
    ///   Background: #0D0D1A  |  Accent: #EF4444  |  Text: #E8E8F0
    ///   Data font: JetBrains Mono  |  Header font: Rajdhani
    /// </summary>
    public class BattleUIManager : MonoBehaviour
    {
        public static BattleUIManager Instance { get; private set; }

        // ── Player panels ─────────────────────────────────────────────────────
        [Header("P1 Panel")]
        public TextMeshProUGUI P1NameText;
        public TextMeshProUGUI P1HpText;
        public Slider          P1HpBar;
        public Image           P1HpFill;
        public TextMeshProUGUI P1StagesText;
        public TextMeshProUGUI P1StatusText;

        [Header("P2 Panel")]
        public TextMeshProUGUI P2NameText;
        public TextMeshProUGUI P2HpText;
        public Slider          P2HpBar;
        public Image           P2HpFill;
        public TextMeshProUGUI P2StagesText;
        public TextMeshProUGUI P2StatusText;

        // ── Turn banner ───────────────────────────────────────────────────────
        [Header("Turn Banner")]
        public GameObject      TurnBanner;
        public TextMeshProUGUI TurnBannerText;
        public float           BannerDisplayTime = 1.8f;

        // ── Battle log ────────────────────────────────────────────────────────
        [Header("Battle Log")]
        public ScrollRect      BattleLogScroll;
        public TextMeshProUGUI BattleLogText;
        private const int      MAX_LOG_LINES = 120;
        private System.Text.StringBuilder _logBuffer = new();

        // ── Declaration panel ─────────────────────────────────────────────────
        [Header("Declaration Panel")]
        public GameObject      DeclarationPanel;
        public Button[]        MoveButtons;          // 4 buttons
        public Button          ConfirmButton;
        public TextMeshProUGUI SelectedMoveSummary;

        // ── Game over overlay ─────────────────────────────────────────────────
        [Header("Game Over")]
        public GameObject      GameOverOverlay;
        public TextMeshProUGUI GameOverText;
        public Button          RematchButton;

        // ── HP bar colors ─────────────────────────────────────────────────────
        private static readonly Color HpGreen  = new(0.23f, 0.86f, 0.43f);
        private static readonly Color HpYellow = new(0.97f, 0.82f, 0.19f);
        private static readonly Color HpRed    = new(0.94f, 0.27f, 0.27f);

        private void Awake()
        {
            if (Instance != null) { Destroy(gameObject); return; }
            Instance = this;
        }

        private void Start()
        {
            // Subscribe to network events
            if (BattleNetworkState.Instance != null)
            {
                BattleNetworkState.Instance.OnBattleLogEntry   += AppendLog;
                BattleNetworkState.Instance.OnResolutionReceived += OnResolution;
            }

            GameOverOverlay?.SetActive(false);
            TurnBanner?.SetActive(false);
        }

        // ── HP Bar Drain Animation ────────────────────────────────────────────
        /// <summary>
        /// Animates an HP bar from <paramref name="fromHp"/> to
        /// <paramref name="toHp"/>.  Matches Python animation timing (0.7s, ease-in).
        /// </summary>
        public IEnumerator AnimateHpDrain(
            int playerId, int fromHp, int toHp, int maxHp)
        {
            var slider  = playerId == 1 ? P1HpBar   : P2HpBar;
            var fill    = playerId == 1 ? P1HpFill  : P2HpFill;
            var hpText  = playerId == 1 ? P1HpText  : P2HpText;

            float duration = 0.7f;
            float fastFrac = 0.7f;   // first 70% of time covers 90% of drop
            float fastPct  = 0.9f;
            float drop     = fromHp - toHp;
            float elapsed  = 0f;

            while (elapsed < duration)
            {
                elapsed += Time.deltaTime;
                float progress = elapsed / duration;
                float current;

                if (progress <= fastFrac)
                {
                    float p2    = progress / fastFrac;
                    float eased = p2 * p2; // ease-in-quad
                    current = fromHp - drop * fastPct * eased;
                }
                else
                {
                    float p2 = (progress - fastFrac) / (1f - fastFrac);
                    current  = (fromHp - drop * fastPct) - drop * (1f - fastPct) * p2;
                }

                current = Mathf.Max(toHp, current);

                float frac    = current / maxHp;
                if (slider != null) slider.value = frac;
                if (fill   != null) fill.color   = HpColor(frac);
                if (hpText != null) hpText.text  = $"{Mathf.CeilToInt(current)}/{maxHp}";

                yield return null;
            }

            float finalFrac = (float)toHp / maxHp;
            if (slider != null) slider.value = finalFrac;
            if (fill   != null) fill.color   = HpColor(finalFrac);
            if (hpText != null) hpText.text  = $"{toHp}/{maxHp}";
        }

        // ── Battle Log ────────────────────────────────────────────────────────
        public void AppendLog(string line)
        {
            _logBuffer.AppendLine(line);

            // Trim to max lines
            var lines = _logBuffer.ToString().Split('\n');
            if (lines.Length > MAX_LOG_LINES)
            {
                _logBuffer.Clear();
                for (int i = lines.Length - MAX_LOG_LINES; i < lines.Length; i++)
                    _logBuffer.AppendLine(lines[i]);
            }

            if (BattleLogText != null)
                BattleLogText.text = _logBuffer.ToString();

            // Auto-scroll to bottom
            if (BattleLogScroll != null)
                Canvas.ForceUpdateCanvases();
            StartCoroutine(ScrollToBottom());
        }

        private IEnumerator ScrollToBottom()
        {
            yield return new WaitForEndOfFrame();
            if (BattleLogScroll != null)
                BattleLogScroll.verticalNormalizedPosition = 0f;
        }

        // ── Turn Banner ───────────────────────────────────────────────────────
        public void ShowTurnBanner(int turnNumber)
        {
            if (TurnBanner == null) return;
            if (TurnBannerText != null)
                TurnBannerText.text = $"TURN {turnNumber}";
            StartCoroutine(ShowBannerRoutine());
        }

        private IEnumerator ShowBannerRoutine()
        {
            TurnBanner.SetActive(true);
            yield return new WaitForSeconds(BannerDisplayTime);
            TurnBanner.SetActive(false);
        }

        // ── Resolution handler ────────────────────────────────────────────────
        private void OnResolution(ResolutionData data)
        {
            ShowTurnBanner(data.TurnNumber);
        }

        // ── Game Over ─────────────────────────────────────────────────────────
        public void ShowGameOver(int winner)
        {
            GameOverOverlay?.SetActive(true);
            if (GameOverText == null) return;

            GameOverText.text = winner switch
            {
                1 => "PLAYER 1 WINS!",
                2 => "PLAYER 2 WINS!",
                _ => "DRAW!"
            };
        }

        // ── Declaration panel ─────────────────────────────────────────────────
        public void ShowDeclarationPanel(string[] moveNames, bool isMyTurn)
        {
            DeclarationPanel?.SetActive(isMyTurn);
            if (!isMyTurn) return;

            for (int i = 0; i < MoveButtons.Length; i++)
            {
                bool hasMoveHere = i < moveNames.Length;
                MoveButtons[i].gameObject.SetActive(hasMoveHere);
                if (hasMoveHere)
                {
                    var label = MoveButtons[i].GetComponentInChildren<TextMeshProUGUI>();
                    if (label != null) label.text = moveNames[i];
                }
            }
        }

        public void HideDeclarationPanel()
            => DeclarationPanel?.SetActive(false);

        // ── Stat stages display ───────────────────────────────────────────────
        public void UpdateStages(int playerId, Core.StatStages stages)
        {
            var txt = playerId == 1 ? P1StagesText : P2StagesText;
            if (txt == null) return;

            var parts = new System.Collections.Generic.List<string>();
            if (stages.attack  != 0) parts.Add($"ATK {stages.attack:+0;-0}");
            if (stages.defense != 0) parts.Add($"DEF {stages.defense:+0;-0}");
            if (stages.spAtk   != 0) parts.Add($"SPA {stages.spAtk:+0;-0}");
            if (stages.spDef   != 0) parts.Add($"SPD {stages.spDef:+0;-0}");
            if (stages.speed   != 0) parts.Add($"SPE {stages.speed:+0;-0}");

            txt.text = string.Join(" | ", parts);
        }

        // ── Helpers ───────────────────────────────────────────────────────────
        private static Color HpColor(float fraction)
            => fraction > 0.5f ? HpGreen
             : fraction > 0.25f ? HpYellow
             : HpRed;
    }
}
