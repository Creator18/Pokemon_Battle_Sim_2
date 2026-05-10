using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using TMPro;
using HexBattle.Data;
using HexBattle.Network;

namespace HexBattle.UI
{
    /// <summary>
    /// Selection screen — Pokémon carousel + 4-dial move selection.
    ///
    /// Flow:
    ///   Phase 1: Scroll through species carousel → Confirm species
    ///   Phase 2: 4 sequential move dials → Confirm moves
    ///   Phase 3: Submit selection to server via BattleNetworkState.SubmitSelectionServerRpc
    /// </summary>
    public class SelectionScreenUI : MonoBehaviour
    {
        public static SelectionScreenUI Instance { get; private set; }

        // ── Species Carousel ──────────────────────────────────────────────────
        [Header("Species Carousel")]
        public ScrollRect          CarouselScroll;
        public Transform           CarouselContent;
        public GameObject          SpeciesCardPrefab;
        public SpeciesData[]       AvailableSpecies;
        public Button              ConfirmSpeciesButton;
        public TextMeshProUGUI     ConfirmSpeciesLabel;

        // ── Move Dials ────────────────────────────────────────────────────────
        [Header("Move Selection (4 dials)")]
        public GameObject          MoveSelectionPanel;
        public ScrollRect[]        DialScrollRects;   // 4 dials
        public Transform[]         DialContents;      // 4 content transforms
        public GameObject          MoveButtonPrefab;
        public TextMeshProUGUI[]   SelectedMoveLabels;// 4 labels showing locked choices
        public Button              ConfirmMovesButton;

        // ── State ─────────────────────────────────────────────────────────────
        private SpeciesData        _selectedSpecies;
        private List<MoveData>     _selectedMoves = new();
        private int                _currentDialIndex;

        // ── Carousel state ────────────────────────────────────────────────────
        private int                _carouselIndex = 0;
        private List<GameObject>   _cards         = new();

        private void Awake()
        {
            if (Instance != null) { Destroy(gameObject); return; }
            Instance = this;
        }

        private void Start()
        {
            BuildCarousel();
            MoveSelectionPanel?.SetActive(false);
            ConfirmSpeciesButton?.onClick.AddListener(OnSpeciesConfirmed);
            ConfirmMovesButton?.onClick.AddListener(OnMovesConfirmed);
        }

        // ── Carousel ──────────────────────────────────────────────────────────
        private void BuildCarousel()
        {
            if (CarouselContent == null || SpeciesCardPrefab == null) return;

            foreach (Transform child in CarouselContent)
                Destroy(child.gameObject);
            _cards.Clear();

            for (int i = 0; i < AvailableSpecies.Length; i++)
            {
                int idx     = i;
                var species = AvailableSpecies[i];
                var card    = Instantiate(SpeciesCardPrefab, CarouselContent);
                _cards.Add(card);

                // Populate card UI
                var nameText = card.GetComponentInChildren<TextMeshProUGUI>();
                if (nameText != null) nameText.text = species.speciesName;

                var icon = card.GetComponentInChildren<Image>();
                if (icon != null && species.icon != null)
                    icon.sprite = species.icon;

                card.GetComponent<Button>()?.onClick.AddListener(
                    () => SelectSpecies(idx));
            }

            SelectSpecies(0);
        }

        private void SelectSpecies(int idx)
        {
            _carouselIndex   = idx;
            _selectedSpecies = AvailableSpecies[idx];

            for (int i = 0; i < _cards.Count; i++)
            {
                var cg = _cards[i].GetComponent<CanvasGroup>();
                if (cg != null) cg.alpha = (i == idx) ? 1f : 0.5f;
                _cards[i].transform.localScale =
                    (i == idx) ? Vector3.one * 1.1f : Vector3.one;
            }

            if (ConfirmSpeciesLabel != null)
                ConfirmSpeciesLabel.text = $"Choose {_selectedSpecies.speciesName}";
        }

        private void OnSpeciesConfirmed()
        {
            if (_selectedSpecies == null) return;

            // Transition to move selection
            MoveSelectionPanel?.SetActive(true);
            _selectedMoves.Clear();
            _currentDialIndex = 0;
            PopulateDial(0);
        }

        // ── Move Dials ────────────────────────────────────────────────────────
        /// <summary>
        /// Populates dial <paramref name="dialIdx"/> with available moves,
        /// sorted terrain → status → ranged → physical, excluding already-chosen moves.
        /// Slot 4 (index 3) only shows terrain moves if none chosen yet.
        /// </summary>
        private void PopulateDial(int dialIdx)
        {
            if (dialIdx >= DialContents.Length) return;

            var content = DialContents[dialIdx];
            foreach (Transform child in content) Destroy(child.gameObject);

            var pool    = BuildFilteredPool(dialIdx);
            var already = new HashSet<string>();
            foreach (var m in _selectedMoves) already.Add(m.moveName);

            foreach (var move in pool)
            {
                if (already.Contains(move.moveName)) continue;

                var btn  = Instantiate(MoveButtonPrefab, content);
                var lbl  = btn.GetComponentInChildren<TextMeshProUGUI>();
                if (lbl != null) lbl.text = move.moveName;

                var captured = move;
                btn.GetComponent<Button>()?.onClick.AddListener(
                    () => OnMoveSelected(captured, dialIdx));
            }
        }

        private List<MoveData> BuildFilteredPool(int dialIdx)
        {
            if (_selectedSpecies == null) return new();

            // Slot 4 (index 3): only terrain moves if 0 terrain chosen
            bool needsTerrain = dialIdx == 3 && !Core.GameConstants.TERRAIN_REQUIRED
                ? false
                : dialIdx == 3;

            var result = new List<MoveData>();
            if (_selectedSpecies.compatibleTerrain != null)
                result.AddRange(_selectedSpecies.compatibleTerrain);

            if (!needsTerrain)
            {
                if (_selectedSpecies.compatibleStatus != null)
                    result.AddRange(_selectedSpecies.compatibleStatus);
                if (_selectedSpecies.compatibleRanged != null)
                    result.AddRange(_selectedSpecies.compatibleRanged);
                if (_selectedSpecies.compatiblePhysical != null)
                    result.AddRange(_selectedSpecies.compatiblePhysical);
            }

            return result;
        }

        private void OnMoveSelected(MoveData move, int dialIdx)
        {
            // Lock in this move
            if (_selectedMoves.Count <= dialIdx)
                _selectedMoves.Add(move);
            else
                _selectedMoves[dialIdx] = move;

            if (SelectedMoveLabels != null && dialIdx < SelectedMoveLabels.Length)
                SelectedMoveLabels[dialIdx].text = move.moveName;

            // Advance to next dial
            _currentDialIndex = dialIdx + 1;
            if (_currentDialIndex < DialContents.Length)
                PopulateDial(_currentDialIndex);
            else
                ConfirmMovesButton?.gameObject.SetActive(true);
        }

        private void OnMovesConfirmed()
        {
            if (_selectedSpecies == null || _selectedMoves.Count < 4) return;

            // Submit to server
            BattleNetworkState.Instance?.SubmitSelectionServerRpc(
                new Unity.Collections.FixedString64Bytes(_selectedSpecies.speciesName));

            gameObject.SetActive(false);
        }
    }
}
