using UnityEngine;
using TMPro;
using HexBattle.Rendering;

namespace HexBattle.UI
{
    /// <summary>
    /// World-space tooltip that appears above a hovered hex tile.
    /// Attach to a World Space Canvas child in the Battle scene.
    /// </summary>
    public class TileTooltipUI : MonoBehaviour
    {
        public static TileTooltipUI Instance { get; private set; }

        [Header("UI References")]
        public GameObject          TooltipRoot;
        public TextMeshProUGUI     TitleText;
        public TextMeshProUGUI     BodyText;
        public CanvasGroup         CanvasGroup;

        [Header("Positioning")]
        public float               HeightOffset = 1.8f;   // units above tile center
        public float               FadeSpeed    = 8f;

        private HexTile _targetTile;
        private Camera  _cam;
        private bool    _visible;

        private void Awake()
        {
            if (Instance != null) { Destroy(gameObject); return; }
            Instance = this;
        }

        private void Start()
        {
            _cam = Camera.main;
            Hide();
        }

        private void LateUpdate()
        {
            // Smoothly fade in/out
            if (CanvasGroup != null)
            {
                float target = _visible ? 1f : 0f;
                CanvasGroup.alpha = Mathf.MoveTowards(
                    CanvasGroup.alpha, target,
                    FadeSpeed * Time.deltaTime);
            }

            // Follow tile in world space
            if (_visible && _targetTile != null)
            {
                transform.position = _targetTile.transform.position
                                   + Vector3.up * HeightOffset;

                // Always face camera (billboard)
                if (_cam != null)
                    transform.LookAt(transform.position
                        + _cam.transform.rotation * Vector3.forward,
                        _cam.transform.rotation * Vector3.up);
            }
        }

        public void ShowForTile(HexTile tile)
        {
            if (tile == null) { Hide(); return; }

            _targetTile = tile;
            _visible    = true;
            TooltipRoot?.SetActive(true);

            if (TitleText != null) TitleText.text = tile.GetTooltipTitle();
            if (BodyText  != null) BodyText.text  = tile.GetTooltipBody();
        }

        public void Hide()
        {
            _visible    = false;
            _targetTile = null;
        }
    }
}
