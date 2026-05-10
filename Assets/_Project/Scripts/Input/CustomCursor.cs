using UnityEngine;
using UnityEngine.UI;

namespace HexBattle.Input
{
    /// <summary>
    /// Software cursor — red dot + trailing ring, GPU-accurate.
    /// Attach to a Screen Space - Overlay Canvas with two RectTransform children:
    ///   DotTransform  (10px circle, #EF4444)
    ///   RingTransform (38px ring, #EF4444 border)
    ///
    /// Mirrors the web version's custom cursor behaviour.
    /// </summary>
    public class CustomCursor : MonoBehaviour
    {
        [Header("References")]
        public RectTransform DotTransform;
        public RectTransform RingTransform;
        public Image         DotImage;
        public Image         RingImage;

        [Header("Lag (0 = instant, 1 = fully static)")]
        [Range(0f, 1f)]
        public float RingLag = 0.35f;   // fraction of remaining distance closed per frame

        [Header("Colors")]
        public Color NormalColor  = new(0.937f, 0.267f, 0.267f, 1f);  // #EF4444
        public Color HoverColor   = new(1f,     0.878f, 0.157f, 1f);  // #FFE028
        public Color ClickColor   = new(1f,     0.878f, 0.157f, 1f);  // #FFE028

        [Header("Scale on Click")]
        public float DotClickScale  = 1.6f;
        public float RingClickScale = 0.82f;
        public float ScaleLerpSpeed = 0.28f;

        // ── State ─────────────────────────────────────────────────────────────
        private Vector2 _mousePos;
        private Vector2 _ringPos;
        private float   _dotScaleCurrent  = 1f;
        private float   _dotScaleTarget   = 1f;
        private float   _ringScaleCurrent = 1f;
        private float   _ringScaleTarget  = 1f;
        private bool    _isDown;

        private void Start()
        {
            Cursor.visible = false;

            _mousePos = UnityEngine.Input.mousePosition;
            _ringPos  = _mousePos;
        }

        private void Update()
        {
            // ── Position ──────────────────────────────────────────────────────
            _mousePos = UnityEngine.Input.mousePosition;
            _ringPos  = Vector2.Lerp(_ringPos, _mousePos,
                (1f - RingLag) * 60f * Time.deltaTime);

            if (DotTransform  != null) DotTransform.position  = _mousePos;
            if (RingTransform != null) RingTransform.position = _ringPos;

            // ── Click scale ───────────────────────────────────────────────────
            bool clicking = UnityEngine.Input.GetMouseButton(0);
            if (clicking != _isDown)
            {
                _isDown = clicking;
                if (clicking)
                {
                    _dotScaleTarget  = DotClickScale;
                    _ringScaleTarget = RingClickScale;
                    if (DotImage  != null) DotImage.color  = ClickColor;
                    if (RingImage != null) RingImage.color = ClickColor;
                }
                else
                {
                    _dotScaleTarget  = 1f;
                    _ringScaleTarget = 1f;
                    if (DotImage  != null) DotImage.color  = NormalColor;
                    if (RingImage != null) RingImage.color = NormalColor;
                    SpawnRipple(_mousePos);
                }
            }

            // Lerp scales
            _dotScaleCurrent  = Mathf.Lerp(_dotScaleCurrent,
                _dotScaleTarget, ScaleLerpSpeed);
            _ringScaleCurrent = Mathf.Lerp(_ringScaleCurrent,
                _ringScaleTarget, ScaleLerpSpeed);

            if (DotTransform  != null)
                DotTransform.localScale  = Vector3.one * _dotScaleCurrent;
            if (RingTransform != null)
                RingTransform.localScale = Vector3.one * _ringScaleCurrent;
        }

        private void OnDisable()
        {
            Cursor.visible = true;
        }

        // ── Ripple on release ─────────────────────────────────────────────────
        [Header("Ripple")]
        public GameObject RipplePrefab;

        private void SpawnRipple(Vector2 screenPos)
        {
            if (RipplePrefab == null) return;
            var go = Instantiate(RipplePrefab, transform.parent);
            go.GetComponent<RectTransform>().position = screenPos;
            Destroy(go, 0.5f);
        }
    }
}
