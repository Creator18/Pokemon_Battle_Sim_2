# Hex Battle Simulator — Unity C# Reference

Unity 2022.3 LTS rebuild of the Hex Battle Simulator.
All game mechanics ported exactly from `hex_battle.py`.

---

## Quick Start

1. Install **Unity 2022.3 LTS** from Unity Hub
2. Create a new project — choose **Universal Render Pipeline (URP)** template
3. Open Package Manager and install every package listed in `Packages/manifest.json`
4. Copy the `Assets/_Project/` folder into your new project's `Assets/` folder
5. Follow the scene setup below

---

## Package List (from manifest.json)

| Package | Version | Purpose |
|---|---|---|
| `com.unity.render-pipelines.universal` | 14.0.8 | URP rendering |
| `com.unity.textmeshpro` | 3.0.8 | All UI text |
| `com.unity.inputsystem` | 1.7.0 | New Input System |
| `com.unity.cinemachine` | 2.9.7 | Isometric camera |
| `com.unity.addressables` | 1.21.19 | Asset loading |
| `com.unity.netcode.gameobjects` | 1.7.1 | Multiplayer (NGO) |
| `com.unity.services.relay` | 1.1.1 | NAT traversal |
| `com.unity.services.lobby` | 1.1.2 | Session codes |
| `com.unity.services.authentication` | 2.7.2 | Anonymous UGS auth |
| `com.unity.visualeffectgraph` | 14.0.8 | Move VFX |
| `com.unity.transport` | 2.1.0 | NGO transport layer |
| `com.unity.services.core` | 1.12.4 | UGS core |

---

## Folder Structure

```
Assets/_Project/Scripts/
  Core/
    Enums.cs                   — All game enums (MoveCategory, TerrainType, etc.)
    GameConstants.cs           — All numeric constants (ported from Python)
    HexGrid.cs                 — Hex math library (axial coords, BFS, LoS)
    TypeChart.cs               — Full Gen 6 18×18 type chart (ported from Python _EFF)
    PokemonState.cs            — Runtime Pokémon state + StatStages + DeclarationPayload
    DamageCalculator.cs        — Damage formula (exact port of Python calc_damage())
    MoveDefinition.cs          — Runtime move data + MoveRegistry singleton

  Data/
    MoveData.cs                — ScriptableObject for each move (41 total)
    SpeciesData.cs             — ScriptableObject for each species (6 total)

  Battle/
    TurnResolver.cs            — Full turn engine: begin/resolve/end + BattleState + TerrainManager
    TurnManager.cs             — MonoBehaviour: owns BattleState, initializes from ScriptableObjects

  Network/
    NetworkManagerSetup.cs     — UGS init + anonymous auth (persistent)
    SessionManager.cs          — Create/join session via Relay + Lobby
    BattleNetworkState.cs      — NetworkBehaviour: all NetworkVariables + RPCs
    (DeclarationData and ResolutionData structs are inside BattleNetworkState.cs)

  Rendering/
    HexTile.cs                 — Per-tile component: highlights, terrain VFX
    HexGridBuilder.cs          — Generates all 61 tiles on Awake
    MoveAnimator.cs            — Plays resolution animations (movement, HP drain, VFX)

  UI/
    BattleUIManager.cs         — HP bars, battle log, turn banner, game over overlay
    TileTooltipUI.cs           — World-space tooltip on hovered tile
    SelectionScreenUI.cs       — Species carousel + 4 move dials
    LobbyUI.cs                 — Create/Join UI for Lobby scene

  Camera/
    IsometricCameraController.cs — Orbit + zoom + snap-to-90° rotation (Cinemachine)

  Input/
    TileInputHandler.cs        — Raycast → tile hover/click events
    BattleInputManager.cs      — Input state machine: move selection → path drawing → confirm
    CustomCursor.cs            — Software cursor: dot + lagging ring

  Pokemon/
    PokemonAnimatorController.cs — 8-directional billboard sprite or 3D model animator
```

---

## Scene Setup

### Lobby Scene

GameObjects required:
- `NetworkManagerSetup` (persistent, DontDestroyOnLoad)
- `NetworkManager` with UnityTransport component
- `SessionManager` (NetworkBehaviour — on the NetworkManager GameObject)
- `Canvas` with `LobbyUI` component
- Status text, Create/Join buttons, code input field

### Battle Scene

GameObjects required:

| GameObject | Component |
|---|---|
| `HexGrid` | `HexGridBuilder` |
| `BattleNetworkState` | `BattleNetworkState` (NetworkObject) |
| `TurnManager` | `TurnManager` |
| `MoveAnimator` | `MoveAnimator` |
| `TileInputHandler` | `TileInputHandler` |
| `BattleInputManager` | `BattleInputManager` |
| `CameraRig` | `IsometricCameraController` |
| `CinemachineVirtualCamera` | CinemachineVirtualCamera |
| `CursorCanvas` (Screen Space Overlay) | `CustomCursor` |
| `BattleUICanvas` (Screen Space Camera) | `BattleUIManager` |
| `TooltipCanvas` (World Space) | `TileTooltipUI` |
| `P1_Pokemon` | `PokemonAnimatorController` |
| `P2_Pokemon` | `PokemonAnimatorController` |
| `GlobalVolume` | Volume with URP overrides |

---

## ScriptableObject Assets to Create

### Species (6 total — create in `ScriptableObjects/Species/`)

| File | speciesName | types | inflatedHp | atk | def | spAtk | spDef | spd | canPassThrough |
|---|---|---|---|---|---|---|---|---|---|
| Species_Pikachu | Pikachu | Electric | 210 | 55 | 40 | 50 | 50 | 90 | false |
| Species_Charizard | Charizard | Fire, Flying | 312 | 84 | 78 | 109 | 85 | 100 | false |
| Species_Gardevoir | Gardevoir | Psychic, Fairy | 285 | 45 | 65 | 125 | 115 | 80 | false |
| Species_Lucario | Lucario | Fighting, Steel | 252 | 110 | 70 | 115 | 70 | 90 | false |
| Species_Absol | Absol | Dark | 240 | 130 | 60 | 75 | 60 | 75 | false |
| Species_Gengar | Gengar | Ghost, Poison | 240 | 65 | 60 | 130 | 75 | 110 | **true** |

All species use Level 50.

### Moves (create in `ScriptableObjects/Moves/`)

Create one `MoveData` asset per move. Refer to `hex_battle.py` move registry for all
41 moves with exact base power, category, type, flags, and cooldown rules.

Key moves to implement first:
- Thunderbolt (Special, Electric, ranged, AoE r1)
- Volt Tackle (Physical, Electric, momentum, recoil 1/3)
- Quick Attack (Physical, Normal, quickPriority)
- Flamethrower (Special, Fire, ranged)
- Shadow Ball (Special, Ghost, ranged, requiresLoS)
- Close Combat (Physical, Fighting, selfDebuffs: -1 Def, -1 SpDef)
- Will-O-Wisp (Terrain, Fire → BurnZone)
- Toxic (Terrain → PoisonTrap)
- Metal Sound (Terrain → ResonanceZone)
- Perish Trap (Terrain → PeishZone)
- Misty Terrain (Terrain → MistZone)

---

## Networking Architecture

```
Player 1 (Host)                    Player 2 (Client)
     │                                    │
     │  CreateSession()                   │
     │  → Unity Relay allocation          │
     │  → Unity Lobby (code embed)        │
     │  → NetworkManager.StartHost()      │
     │                                    │
     │                         JoinSession(code)
     │                         → LobbyService.JoinByCode()
     │                         → RelayService.JoinAllocation()
     │                         → NetworkManager.StartClient()
     │                                    │
     │←══════════ NGO connection ════════→│
     │                                    │
     │  SubmitDeclarationServerRpc ←──────│
     │  (both declared → ResolveTurn())   │
     │  ReceiveResolutionClientRpc ──────→│
     │                                    │
```

The host runs `TurnResolver.ResolveTurn()` server-side. Results are pushed to
clients via `ReceiveResolutionClientRpc`. All NetworkVariables (HP, tile, phase)
are server-write / everyone-read.

---

## URP Post-Processing (GlobalVolume)

Add a Volume component to a GameObject in the Battle scene with these overrides:

```
Bloom:
  Threshold: 0.8  |  Intensity: 1.2  |  Scatter: 0.7

Vignette:
  Intensity: 0.35  |  Smoothness: 0.5  |  Color: black

Color Adjustments:
  Post Exposure: 0.1  |  Contrast: 12
  Color Filter: #FFE8D0  |  Saturation: 8

Shadows Midtones Highlights:
  Shadows: slightly blue-shifted
  Highlights: slightly warm

Chromatic Aberration: Intensity 0.05
Film Grain: Intensity 0.08, Response 0.6
Depth of Field: OFF
```

---

## Lighting Setup

```
Directional Light (Sun):
  Rotation: (45, -30, 0)  |  Color: #FFF8E8  |  Intensity: 1.3
  Shadow Type: Soft  |  Shadow Strength: 0.7

Fill Light (Directional, no shadows):
  Rotation: (-20, 150, 0)  |  Color: #4466AA  |  Intensity: 0.3

Ambient (Gradient):
  Sky: #1A2A44  |  Equator: #0D1A2A  |  Ground: #080C14

Player Point Lights (follow Pokémon each frame):
  P1: Color #FF3B5C  |  Range 8  |  Intensity 1.2
  P2: Color #00C8FF  |  Range 8  |  Intensity 1.2
```

---

## Hex Math Quick Reference

```
Grid: axial (q, r), flat-top, radius 4 → 61 tiles
World pos: x = hexSize * 1.5 * q
           z = hexSize * (sqrt(3)/2 * q + sqrt(3) * r)
Distance:  cube coords, Chebyshev
P1 spawn:  (-3, 0)    P2 spawn: (3, 0)
```

---

## UI Color Reference

| Role | Hex | Usage |
|---|---|---|
| Background | `#0D0D1A` | Panels, overlays |
| Accent | `#EF4444` | Buttons, cursor, P1 highlight |
| Text | `#E8E8F0` | All body text |
| P2 accent | `#00C8FF` | P2 highlight, P2 point light |
| HP green | `#3BDB6E` | HP > 50% |
| HP yellow | `#F7D131` | HP 25-50% |
| HP red | `#F04545` | HP < 25% |

Fonts: **Rajdhani** (headers) · **JetBrains Mono** (data values, HP numbers)
Import both as TextMeshPro font assets via Window → TextMeshPro → Font Asset Creator.

---

## Build Targets

**Windows Standalone:**
- Resolution: 1920×1080, Windowed Fullscreen
- Graphics API: DirectX11

**WebGL:**
- Compression: Brotli
- Use NativeWebSocket package if keeping Python backend in early phases
- NGO + Relay works natively in WebGL builds

---

## File Count Summary

| Folder | Files |
|---|---|
| Core | 7 |
| Data | 2 |
| Battle | 2 |
| Network | 3 |
| Rendering | 3 |
| UI | 4 |
| Camera | 1 |
| Input | 3 |
| Pokemon | 1 |
| **Total** | **26** |
