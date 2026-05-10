using UnityEngine;
using HexBattle.Rendering;
using HexBattle.UI;

namespace HexBattle.Input
{
    /// <summary>
    /// Raycasts mouse position against the HexTile physics layer each frame.
    /// Fires OnTileHovered and OnTileClicked events consumed by BattleInputManager.
    ///
    /// All hex tile GameObjects must:
    ///   - Have a MeshCollider
    ///   - Be on the Unity Layer named "HexTile"
    /// </summary>
    public class TileInputHandler : MonoBehaviour
    {
        public static TileInputHandler Instance { get; private set; }

        [Header("References")]
        public new UnityEngine.Camera Camera;

        private HexTile  _hoveredTile;
        private int      _hexLayer;

        public event System.Action<HexTile>  OnTileHovered;
        public event System.Action<HexTile>  OnTileUnhovered;
        public event System.Action<HexTile>  OnTileClicked;
        public event System.Action<HexTile>  OnTileRightClicked;

        private void Awake()
        {
            if (Instance != null) { Destroy(gameObject); return; }
            Instance = this;
        }

        private void Start()
        {
            _hexLayer = LayerMask.GetMask("HexTile");
            if (Camera == null) Camera = UnityEngine.Camera.main;
        }

        private void Update()
        {
            Ray ray = Camera.ScreenPointToRay(UnityEngine.Input.mousePosition);

            if (Physics.Raycast(ray, out RaycastHit hit, Mathf.Infinity, _hexLayer))
            {
                var tile = hit.collider.GetComponentInParent<HexTile>();
                if (tile != _hoveredTile)
                {
                    if (_hoveredTile != null) OnTileUnhovered?.Invoke(_hoveredTile);
                    _hoveredTile = tile;
                    if (tile != null)
                    {
                        OnTileHovered?.Invoke(tile);
                        TileTooltipUI.Instance?.ShowForTile(tile);
                    }
                }

                if (UnityEngine.Input.GetMouseButtonDown(0) && tile != null)
                    OnTileClicked?.Invoke(tile);

                if (UnityEngine.Input.GetMouseButtonDown(1) && tile != null)
                    OnTileRightClicked?.Invoke(tile);
            }
            else
            {
                if (_hoveredTile != null)
                {
                    OnTileUnhovered?.Invoke(_hoveredTile);
                    TileTooltipUI.Instance?.Hide();
                    _hoveredTile = null;
                }
            }
        }
    }
}
