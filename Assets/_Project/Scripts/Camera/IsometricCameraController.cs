using UnityEngine;
using Cinemachine;

namespace HexBattle.Camera
{
    /// <summary>
    /// Isometric camera controller — rotate around the battlefield,
    /// zoom in/out, snap to 4 cardinal angles.
    ///
    /// Requires a Cinemachine Virtual Camera with a Follow target
    /// set to the grid center.
    /// </summary>
    public class IsometricCameraController : MonoBehaviour
    {
        [Header("Cinemachine")]
        public CinemachineVirtualCamera VirtualCamera;

        [Header("Rotation")]
        public float RotationSpeed    = 120f;   // deg/sec
        public bool  SnapToAngles     = true;
        public float SnapAngle        = 90f;    // snap every 90°
        public float SnapLerpSpeed    = 8f;

        [Header("Zoom")]
        public float ZoomSpeed        = 5f;
        public float MinOrthoSize     = 6f;
        public float MaxOrthoSize     = 16f;
        public float CurrentOrthoSize = 10f;

        [Header("Orbit")]
        public Transform OrbitTarget;           // grid center pivot
        public float     OrbitRadius    = 18f;
        public float     OrbitElevation = 60f;  // degrees above horizontal

        // ── Runtime state ─────────────────────────────────────────────────────
        private float  _currentAngle  = 0f;
        private float  _targetAngle   = 0f;
        private bool   _snapping      = false;

        private void Start()
        {
            if (OrbitTarget == null)
            {
                var go = new GameObject("CameraOrbitTarget");
                OrbitTarget = go.transform;
            }

            UpdateCameraPosition();

            if (VirtualCamera != null)
                VirtualCamera.m_Lens.OrthographicSize = CurrentOrthoSize;
        }

        private void Update()
        {
            HandleRotation();
            HandleZoom();
            UpdateCameraPosition();
        }

        // ── Rotation ──────────────────────────────────────────────────────────
        private void HandleRotation()
        {
            float axis = 0f;

            // Keyboard: Q / E
            if (UnityEngine.InputSystem.Keyboard.current != null)
            {
                if (UnityEngine.InputSystem.Keyboard.current.qKey.isPressed) axis -= 1f;
                if (UnityEngine.InputSystem.Keyboard.current.eKey.isPressed) axis += 1f;
            }

            // Mouse right-drag
            if (Input.GetMouseButton(1))
                axis += Input.GetAxis("Mouse X") * 0.5f;

            if (Mathf.Abs(axis) > 0.01f)
            {
                _currentAngle += axis * RotationSpeed * Time.deltaTime;
                _targetAngle   = _currentAngle;
                _snapping      = false;
            }
            else if (SnapToAngles && !_snapping)
            {
                // Snap to nearest 90° when released
                _targetAngle = Mathf.Round(_currentAngle / SnapAngle) * SnapAngle;
                _snapping    = true;
            }

            if (_snapping)
                _currentAngle = Mathf.LerpAngle(
                    _currentAngle, _targetAngle,
                    SnapLerpSpeed * Time.deltaTime);
        }

        // ── Zoom ──────────────────────────────────────────────────────────────
        private void HandleZoom()
        {
            float scroll = Input.GetAxis("Mouse ScrollWheel");
            if (Mathf.Abs(scroll) > 0.001f)
            {
                CurrentOrthoSize = Mathf.Clamp(
                    CurrentOrthoSize - scroll * ZoomSpeed,
                    MinOrthoSize, MaxOrthoSize);

                if (VirtualCamera != null)
                    VirtualCamera.m_Lens.OrthographicSize = CurrentOrthoSize;
            }
        }

        // ── Position ──────────────────────────────────────────────────────────
        private void UpdateCameraPosition()
        {
            if (OrbitTarget == null) return;

            float radY = _currentAngle * Mathf.Deg2Rad;
            float radX = OrbitElevation * Mathf.Deg2Rad;

            Vector3 offset = new Vector3(
                Mathf.Sin(radY) * Mathf.Cos(radX),
                Mathf.Sin(radX),
                Mathf.Cos(radY) * Mathf.Cos(radX)) * OrbitRadius;

            transform.position = OrbitTarget.position + offset;
            transform.LookAt(OrbitTarget.position);
        }

        // ── Public API ────────────────────────────────────────────────────────
        /// <summary>Current camera yaw in degrees (0 = north-facing).</summary>
        public float CurrentAngleDeg => _currentAngle;

        /// <summary>Camera forward direction as unit XZ vector (for sprite facing).</summary>
        public Vector2 CameraForwardXZ
        {
            get
            {
                float rad = _currentAngle * Mathf.Deg2Rad;
                return new Vector2(Mathf.Sin(rad), Mathf.Cos(rad));
            }
        }
    }
}
