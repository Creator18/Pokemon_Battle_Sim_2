// ============================================================
//  HexBattle — Scene Setup Tool
//  Run via:  Tools > HexBattle > Setup Battle Scene
//                                Setup Lobby Scene
// ============================================================
using UnityEngine;
using UnityEditor;
using UnityEditor.SceneManagement;
using Unity.Netcode;
using Unity.Netcode.Transports.UTP;

public static class SceneSetupTool
{
    // ── Helpers ───────────────────────────────────────────────────────────────

    static T AddOrGet<T>(GameObject go) where T : Component
        => go.GetComponent<T>() ?? go.AddComponent<T>();

    static GameObject Require(string name)
    {
        var go = GameObject.Find(name);
        if (go == null)
            Debug.LogError($"[SceneSetup] GameObject '{name}' not found in scene.");
        return go;
    }

    // ── Battle Scene ──────────────────────────────────────────────────────────

    [MenuItem("Tools/HexBattle/Setup Battle Scene")]
    public static void SetupBattleScene()
    {
        EditorSceneManager.OpenScene(
            "Assets/_Project/Scenes/Battle.unity",
            OpenSceneMode.Single);

        var mainCameraGO   = Require("Main Camera");
        var gameManagerGO  = Require("GameManager");
        var networkMgrGO   = Require("NetworkManager");
        var hexGridGO      = Require("HexGrid");
        var battleInputGO  = Require("BattleInput");
        var moveAnimatorGO = Require("MoveAnimator");

        if (mainCameraGO == null || gameManagerGO == null || networkMgrGO == null ||
            hexGridGO    == null || battleInputGO == null || moveAnimatorGO == null)
        {
            Debug.LogError("[SceneSetup] Aborting — fix missing GameObjects first.");
            return;
        }

        // ── Main Camera ───────────────────────────────────────────────────────
        AddOrGet<HexBattle.Camera.IsometricCameraController>(mainCameraGO);

        // ── GameManager ───────────────────────────────────────────────────────
        AddOrGet<HexBattle.Battle.TurnManager>(gameManagerGO);

        // ── NetworkManager ────────────────────────────────────────────────────
        // NetworkObject must be added before any NetworkBehaviour
        AddOrGet<NetworkObject>(networkMgrGO);
        AddOrGet<HexBattle.Network.NetworkManagerSetup>(networkMgrGO);
        AddOrGet<HexBattle.Network.BattleNetworkState>(networkMgrGO);

        // ── HexGrid ───────────────────────────────────────────────────────────
        var hexGridBuilder = AddOrGet<HexBattle.Rendering.HexGridBuilder>(hexGridGO);

        // ── BattleInput ───────────────────────────────────────────────────────
        var bim = AddOrGet<HexBattle.Input.BattleInputManager>(battleInputGO);
        var tih = AddOrGet<HexBattle.Input.TileInputHandler>(battleInputGO);

        // Wire cross-references
        bim.GridBuilder = hexGridBuilder;
        tih.Camera      = mainCameraGO.GetComponent<UnityEngine.Camera>();

        // ── MoveAnimator ──────────────────────────────────────────────────────
        AddOrGet<HexBattle.Rendering.MoveAnimator>(moveAnimatorGO);

        // ── Save ──────────────────────────────────────────────────────────────
        var scene = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
        EditorSceneManager.MarkSceneDirty(scene);
        EditorSceneManager.SaveScene(scene);

        Debug.Log("[SceneSetup] Battle scene setup complete!");
    }

    // ── Lobby Scene ───────────────────────────────────────────────────────────

    [MenuItem("Tools/HexBattle/Setup Lobby Scene")]
    public static void SetupLobbyScene()
    {
        EditorSceneManager.OpenScene(
            "Assets/_Project/Scenes/Lobby.unity",
            OpenSceneMode.Single);

        var networkSetupGO = Require("NetworkManagerSetup");
        var sessionMgrGO   = Require("SessionManager");

        if (networkSetupGO == null || sessionMgrGO == null)
        {
            Debug.LogError("[SceneSetup] Aborting — fix missing GameObjects first.");
            return;
        }

        // ── NGO NetworkManager + Transport ────────────────────────────────────
        var ngoMgr    = AddOrGet<NetworkManager>(networkSetupGO);
        var transport = AddOrGet<UnityTransport>(networkSetupGO);

        // Link transport to NGO NetworkManager
        if (ngoMgr.NetworkConfig != null)
            ngoMgr.NetworkConfig.NetworkTransport = transport;

        AddOrGet<HexBattle.Network.NetworkManagerSetup>(networkSetupGO);

        // ── SessionManager ────────────────────────────────────────────────────
        // SessionManager is a NetworkBehaviour — needs NetworkObject
        AddOrGet<NetworkObject>(sessionMgrGO);
        AddOrGet<HexBattle.Network.SessionManager>(sessionMgrGO);

        // ── Save ──────────────────────────────────────────────────────────────
        var scene = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
        EditorSceneManager.MarkSceneDirty(scene);
        EditorSceneManager.SaveScene(scene);

        Debug.Log("[SceneSetup] Lobby scene setup complete!");
    }
}
