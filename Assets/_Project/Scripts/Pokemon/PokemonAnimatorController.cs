using UnityEngine;
using HexBattle.Camera;

namespace HexBattle.Pokemon
{
    /// <summary>
    /// Controls a Pokémon's 3D model/sprite in the battle scene.
    ///
    /// For sprite-based rendering (HGSS PMDCollab style) this component
    /// manages a billboard quad that shows the correct 8-directional frame
    /// based on camera angle.
    ///
    /// For full 3D models, this drives the Animator.
    /// </summary>
    public class PokemonAnimatorController : MonoBehaviour
    {
        [Header("Mode")]
        public bool UseSpriteBillboard = true;  // true = 2D HGSS sprite, false = 3D model

        [Header("Sprite Billboard (HGSS mode)")]
        public SpriteRenderer BillboardRenderer;
        public Sprite[]       DirectionSprites;  // 8 sprites, indexed by direction 0-7
        //  Direction index convention (matches PMDCollab):
        //  0=S, 1=SW, 2=W, 3=NW, 4=N, 5=NE, 6=E, 7=SE

        [Header("3D Model")]
        public Animator ModelAnimator;

        [Header("Player Info")]
        public int  PlayerId;   // 1 or 2
        public bool IsOpponent; // used for back-facing logic

        // ── References ────────────────────────────────────────────────────────
        private IsometricCameraController _cam;
        private Transform                 _camTransform;

        // ── Animation hashes (3D mode) ────────────────────────────────────────
        private static readonly int _hashIdle   = Animator.StringToHash("Idle");
        private static readonly int _hashWalk   = Animator.StringToHash("Walk");
        private static readonly int _hashAttack = Animator.StringToHash("Attack");
        private static readonly int _hashHurt   = Animator.StringToHash("Hurt");
        private static readonly int _hashFaint  = Animator.StringToHash("Faint");

        // ── State ─────────────────────────────────────────────────────────────
        private bool    _isWalking;
        private Vector3 _lastPos;

        private void Start()
        {
            _cam          = FindObjectOfType<IsometricCameraController>();
            _camTransform = UnityEngine.Camera.main?.transform;
            _lastPos      = transform.position;
        }

        private void LateUpdate()
        {
            if (UseSpriteBillboard)
                UpdateBillboardFacing();
            else
                UpdateWalkDetection();
        }

        // ── Billboard Facing ──────────────────────────────────────────────────
        private void UpdateBillboardFacing()
        {
            if (BillboardRenderer == null || _cam == null) return;

            // Face camera (always face the camera plane)
            if (_camTransform != null)
            {
                Vector3 dir = _camTransform.forward;
                dir.y = 0;
                if (dir != Vector3.zero)
                    transform.rotation = Quaternion.LookRotation(dir, Vector3.up)
                                       * Quaternion.Euler(0, 180, 0);
            }

            // Determine which of 8 directions to show
            int dirIndex = GetSpriteDirectionIndex();
            if (DirectionSprites != null
             && dirIndex < DirectionSprites.Length
             && DirectionSprites[dirIndex] != null)
                BillboardRenderer.sprite = DirectionSprites[dirIndex];
        }

        private int GetSpriteDirectionIndex()
        {
            if (_cam == null) return IsOpponent ? 4 : 0; // N or S fallback

            Vector2 camFwd = _cam.CameraForwardXZ;

            // Vector from pokemon toward camera projection
            Vector3 towardCam = _camTransform != null
                ? (_camTransform.position - transform.position).normalized
                : Vector3.forward;

            Vector2 flatTowardCam = new Vector2(towardCam.x, towardCam.z);

            // Angle between world south (0,1) and the flat direction
            float angle = Vector2.SignedAngle(Vector2.up, flatTowardCam);
            if (angle < 0) angle += 360f;

            // Quantize to 8 directions (each 45°)
            // 0=S(0°), 1=SW(45°), 2=W(90°), 3=NW(135°), 4=N(180°), 5=NE(225°), 6=E(270°), 7=SE(315°)
            int dir = Mathf.RoundToInt(angle / 45f) % 8;
            return dir;
        }

        // ── Walk Detection (3D mode) ──────────────────────────────────────────
        private void UpdateWalkDetection()
        {
            float moved = Vector3.Distance(transform.position, _lastPos);
            bool  walk  = moved > 0.01f;

            if (walk != _isWalking)
            {
                _isWalking = walk;
                ModelAnimator?.SetBool(_hashWalk, _isWalking);
            }
            _lastPos = transform.position;
        }

        // ── Public Animation Triggers ─────────────────────────────────────────
        public void PlayAttack()
        {
            if (UseSpriteBillboard) StartCoroutine(SpriteAttackFlash());
            else                    ModelAnimator?.SetTrigger(_hashAttack);
        }

        public void PlayHurt()
        {
            if (UseSpriteBillboard) StartCoroutine(SpriteHurtFlash());
            else                    ModelAnimator?.SetTrigger(_hashHurt);
        }

        public void PlayFaint()
        {
            if (UseSpriteBillboard) StartCoroutine(SpriteFaintSequence());
            else                    ModelAnimator?.SetTrigger(_hashFaint);
        }

        // ── Sprite Flash Coroutines ───────────────────────────────────────────
        private System.Collections.IEnumerator SpriteAttackFlash()
        {
            if (BillboardRenderer == null) yield break;
            var orig = BillboardRenderer.color;
            BillboardRenderer.color = Color.yellow;
            yield return new WaitForSeconds(0.1f);
            BillboardRenderer.color = orig;
        }

        private System.Collections.IEnumerator SpriteHurtFlash()
        {
            if (BillboardRenderer == null) yield break;
            for (int i = 0; i < 3; i++)
            {
                BillboardRenderer.color = new Color(1f, 0.3f, 0.3f);
                yield return new WaitForSeconds(0.08f);
                BillboardRenderer.color = Color.white;
                yield return new WaitForSeconds(0.08f);
            }
        }

        private System.Collections.IEnumerator SpriteFaintSequence()
        {
            if (BillboardRenderer == null) yield break;
            float elapsed = 0f;
            const float duration = 0.8f;
            Vector3 origScale = transform.localScale;

            while (elapsed < duration)
            {
                elapsed += Time.deltaTime;
                float t = elapsed / duration;
                BillboardRenderer.color = new Color(1f, 1f, 1f, 1f - t);
                transform.localScale    = origScale * (1f - t * 0.5f);
                yield return null;
            }
            gameObject.SetActive(false);
        }
    }
}
