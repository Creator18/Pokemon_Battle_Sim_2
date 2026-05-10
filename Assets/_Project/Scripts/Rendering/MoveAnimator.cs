using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using HexBattle.Core;
using HexBattle.Network;

namespace HexBattle.Rendering
{
    /// <summary>
    /// Plays all move animations sequentially after a resolution is received.
    /// Sequences: movement tween → projectile → impact VFX → damage number.
    ///
    /// Call PlayResolution() from BattleNetworkState.OnResolutionReceived.
    /// </summary>
    public class MoveAnimator : MonoBehaviour
    {
        public static MoveAnimator Instance { get; private set; }

        [Header("References")]
        public Transform P1Transform;
        public Transform P2Transform;
        public Canvas    WorldCanvas;  // for damage numbers

        [Header("Prefabs")]
        public GameObject DamageNumberPrefab;
        public GameObject ScreenFlashPrefab;
        public GameObject RipplePrefab;

        [Header("Timing")]
        public float MoveTweenDuration    = 0.5f;
        public float ProjectileDuration   = 0.4f;
        public float ImpactHoldDuration   = 0.25f;
        public float DamageNumberDuration = 1.0f;

        private void Awake()
        {
            if (Instance != null) { Destroy(gameObject); return; }
            Instance = this;
        }

        // ── Entry Point ───────────────────────────────────────────────────────
        public void PlayResolution(ResolutionData data)
            => StartCoroutine(PlayResolutionSequence(data));

        private IEnumerator PlayResolutionSequence(ResolutionData data)
        {
            // 1. Move tweens (move Pokémon sprites to new tiles)
            yield return StartCoroutine(
                TweenToTile(P1Transform, data.P1TileAfter, MoveTweenDuration));
            yield return StartCoroutine(
                TweenToTile(P2Transform, data.P2TileAfter, MoveTweenDuration));

            // 2. Small pause before attack animation
            yield return new WaitForSeconds(0.1f);

            // 3. HP drain animations run in parallel
            var p1HpRoutine = StartCoroutine(
                UI.BattleUIManager.Instance.AnimateHpDrain(
                    1, data.P1HpAfter + 50 /* estimate */, data.P1HpAfter,
                    Network.BattleNetworkState.Instance.P1MaxHp.Value));
            var p2HpRoutine = StartCoroutine(
                UI.BattleUIManager.Instance.AnimateHpDrain(
                    2, data.P2HpAfter + 50, data.P2HpAfter,
                    Network.BattleNetworkState.Instance.P2MaxHp.Value));

            yield return p1HpRoutine;
            yield return p2HpRoutine;

            // 4. Spawn damage numbers
            SpawnDamageNumber(P1Transform.position, data.P1HpAfter, isP1: true);
            SpawnDamageNumber(P2Transform.position, data.P2HpAfter, isP1: false);

            yield return new WaitForSeconds(0.3f);

            // 5. Game over flash
            if (data.IsOver)
            {
                yield return StartCoroutine(PlayScreenFlash());
                UI.BattleUIManager.Instance.ShowGameOver(data.Winner);
            }
        }

        // ── Movement Tween ────────────────────────────────────────────────────
        private IEnumerator TweenToTile(
            Transform target, Vector2Int destCoord, float duration)
        {
            if (target == null) yield break;

            Vector3 startPos = target.position;
            Vector3 endPos   = HexGrid.HexToWorld(destCoord, GameConstants.HEX_SIZE);
            endPos.y = startPos.y; // keep Y

            float elapsed = 0f;
            while (elapsed < duration)
            {
                elapsed += Time.deltaTime;
                float t  = Mathf.SmoothStep(0f, 1f, elapsed / duration);
                target.position = Vector3.Lerp(startPos, endPos, t);
                yield return null;
            }
            target.position = endPos;
        }

        // ── Projectile (ranged moves) ─────────────────────────────────────────
        public IEnumerator PlayProjectile(
            GameObject prefab,
            Vector3 from, Vector3 to,
            float duration = 0.4f)
        {
            if (prefab == null) yield break;

            var proj = Instantiate(prefab, from, Quaternion.identity);
            proj.transform.LookAt(to);

            float elapsed = 0f;
            while (elapsed < duration)
            {
                elapsed += Time.deltaTime;
                float t  = elapsed / duration;
                proj.transform.position = Vector3.Lerp(from, to, t);
                yield return null;
            }
            Destroy(proj);
        }

        // ── AoE Flash ─────────────────────────────────────────────────────────
        public IEnumerator PlayAoeFlash(
            IEnumerable<Vector2Int> tiles, Color color, float duration = 0.35f)
        {
            var renderers = new List<MeshRenderer>();
            foreach (var c in tiles)
            {
                var tile = HexGridBuilder.Instance?.GetTile(c);
                if (tile != null)
                {
                    var mr = tile.GetComponent<MeshRenderer>();
                    renderers.Add(mr);
                }
            }

            float elapsed = 0f;
            while (elapsed < duration)
            {
                elapsed += Time.deltaTime;
                float t = elapsed / duration;
                Color c = Color.Lerp(color, Color.clear, t);
                foreach (var mr in renderers)
                    if (mr != null) mr.material.color = c;
                yield return null;
            }
        }

        // ── Damage Number ─────────────────────────────────────────────────────
        private void SpawnDamageNumber(Vector3 worldPos, int hp, bool isP1)
        {
            if (DamageNumberPrefab == null) return;

            var go  = Instantiate(DamageNumberPrefab, worldPos + Vector3.up * 2f,
                Quaternion.identity, WorldCanvas.transform);
            var txt = go.GetComponentInChildren<TMPro.TextMeshProUGUI>();
            if (txt != null)
            {
                txt.text  = hp.ToString();
                txt.color = isP1
                    ? new Color(1f, 0.24f, 0.36f)   // P1 red
                    : new Color(0f, 0.78f, 1f);      // P2 blue
            }
            StartCoroutine(FloatAndFade(go.transform, DamageNumberDuration));
        }

        private IEnumerator FloatAndFade(Transform t, float duration)
        {
            Vector3 start   = t.position;
            var     cg      = t.GetComponent<CanvasGroup>();
            float   elapsed = 0f;

            while (elapsed < duration)
            {
                elapsed        += Time.deltaTime;
                float p         = elapsed / duration;
                t.position      = start + Vector3.up * (p * 1.5f);
                if (cg != null) cg.alpha = 1f - p;
                yield return null;
            }
            Destroy(t.gameObject);
        }

        // ── Screen Flash ──────────────────────────────────────────────────────
        private IEnumerator PlayScreenFlash()
        {
            if (ScreenFlashPrefab == null) yield break;
            var go = Instantiate(ScreenFlashPrefab);
            yield return new WaitForSeconds(0.6f);
            Destroy(go);
        }
    }
}
