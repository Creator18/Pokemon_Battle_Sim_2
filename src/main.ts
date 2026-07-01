import {
  Engine, Scene, HemisphericLight, Vector3, DirectionalLight,
  Color3, Color4, MeshBuilder, StandardMaterial, Mesh
} from '@babylonjs/core';
import { HexGridBuilder } from './rendering/HexGridBuilder';
import { IsometricCamera } from './camera/IsometricCamera';
import { BattleInput } from './input/BattleInput';
import { BattleUI } from './ui/BattleUI';
import { TurnManager } from './battle/TurnManager';
import { initMoveData } from './data/MoveData';
import { MoveCategory } from './core/Enums';
import { tileKey, generateGrid, hexToWorld } from './core/HexGrid';
import { GameConstants } from './core/GameConstants';
import { MoveRegistry } from './core/MoveDefinition';
import type { ResolutionResult } from './battle/TurnResolver';

// ── Bootstrap data ───────────────────────────────────────────────────────────
initMoveData();

// ── Babylon setup ────────────────────────────────────────────────────────────
const canvas = document.getElementById('renderCanvas') as unknown as HTMLCanvasElement;
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.05, 0.05, 0.1, 1);

// Lighting
const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
hemi.intensity = 0.6;
hemi.diffuse = new Color3(0.8, 0.85, 1);
hemi.groundColor = new Color3(0.2, 0.2, 0.35);

const sun = new DirectionalLight('sun', new Vector3(-1, -2, -1), scene);
sun.intensity = 0.7;
sun.diffuse = new Color3(1, 0.95, 0.85);

// ── Subsystems ───────────────────────────────────────────────────────────────
const gridBuilder = new HexGridBuilder(scene);
new IsometricCamera(scene);
const battleInput = new BattleInput(scene, gridBuilder);
const ui = new BattleUI('ui-root');
const turnManager = new TurnManager();

// ── Pokemon mesh placeholders ─────────────────────────────────────────────
let p1Mesh: Mesh | null = null;
let p2Mesh: Mesh | null = null;

function createPokemonMesh(playerId: number, color: Color3): Mesh {
  const mat = new StandardMaterial(`pMat${playerId}`, scene);
  mat.diffuseColor = color;
  mat.emissiveColor = color.scale(0.3);

  const sphere = MeshBuilder.CreateSphere(`pokemon${playerId}`, { diameter: 0.7 }, scene);
  sphere.material = mat;

  const glow = MeshBuilder.CreateCylinder(`pGlow${playerId}`, {
    diameter: 0.85, height: 0.05, tessellation: 16,
  }, scene);
  const glowMat = new StandardMaterial(`pGlowMat${playerId}`, scene);
  glowMat.emissiveColor = color.scale(0.6);
  glowMat.alpha = 0.5;
  glow.material = glowMat;
  glow.parent = sphere;
  glow.position.y = -0.4;

  return sphere;
}

function movePokemonMesh(mesh: Mesh, q: number, r: number): void {
  const { x, z } = hexToWorld(q, r, GameConstants.HexSize);
  mesh.position.set(x, 0.45, z);
}

function placePokemon(): void {
  const p1 = turnManager.state.p1;
  const p2 = turnManager.state.p2;

  if (!p1Mesh) p1Mesh = createPokemonMesh(1, new Color3(0.37, 0.65, 0.98));
  if (!p2Mesh) p2Mesh = createPokemonMesh(2, new Color3(0.97, 0.53, 0.53));

  movePokemonMesh(p1Mesh, p1.tile.x, p1.tile.y);
  movePokemonMesh(p2Mesh, p2.tile.x, p2.tile.y);
}

// ── Game-flow state ──────────────────────────────────────────────────────────
let currentDeclaringPlayer = 1;

// ── Turn resolved ────────────────────────────────────────────────────────────
turnManager.onTurnResolved = (result: ResolutionResult, endLog: string[]) => {
  ui.addLog(result.log);
  if (endLog.length) ui.addLog(endLog);

  gridBuilder.updateTerrain(turnManager.state.terrain);

  if (p1Mesh) movePokemonMesh(p1Mesh, turnManager.state.p1.tile.x, turnManager.state.p1.tile.y);
  if (p2Mesh) movePokemonMesh(p2Mesh, turnManager.state.p2.tile.x, turnManager.state.p2.tile.y);

  ui.updateHP(turnManager.state.p1);
  ui.updateHP(turnManager.state.p2);

  if (turnManager.state.isOver) {
    const w = turnManager.state.winner;
    const txt = w === 0 ? 'Draw!' : `Player ${w} wins!`;
    ui.showGameOver(txt);
    return;
  }

  currentDeclaringPlayer = 1;
  startPlayerDeclaration(1);
};

// ── Input callbacks ───────────────────────────────────────────────────────────
battleInput.callbacks.onTileHovered = (tile) => {
  if (tile) {
    ui.showTooltip(tile.getTooltipText(), scene.pointerX, scene.pointerY);
  } else {
    ui.hideTooltip();
  }
};

battleInput.callbacks.onDeclarationReady = (moveId, targetTile, movePath) => {
  ui.addLog([`Player ${currentDeclaringPlayer} declared: ${MoveRegistry.get(moveId)?.name ?? moveId}`]);

  turnManager.submitDeclaration(currentDeclaringPlayer, {
    moveId,
    targetTile,
    movePath,
    actFirst: false,
  });

  battleInput.reset();

  if (!turnManager.state.isOver && currentDeclaringPlayer === 1 && turnManager.state.p2.isAlive) {
    currentDeclaringPlayer = 2;
    startPlayerDeclaration(2);
  }
};

ui.onMoveSelected = (moveId: string) => {
  const state = turnManager.state;
  const actor = currentDeclaringPlayer === 1 ? state.p1 : state.p2;
  const opponent = currentDeclaringPlayer === 1 ? state.p2 : state.p1;
  const move = MoveRegistry.get(moveId);
  if (!move) return;

  ui.hideMovePanel();

  // Self-targeting moves (range 0) — auto confirm immediately
  if (move.maxRange === 0 && (move.category === MoveCategory.Status || move.category === MoveCategory.Terrain)) {
    battleInput.reset();
    ui.addLog([`Player ${currentDeclaringPlayer} declared: ${move.name}`]);
    turnManager.submitDeclaration(currentDeclaringPlayer, {
      moveId,
      targetTile: actor.tile,
      movePath: [],
      actFirst: false,
    });
    if (!turnManager.state.isOver && currentDeclaringPlayer === 1 && turnManager.state.p2.isAlive) {
      currentDeclaringPlayer = 2;
      startPlayerDeclaration(2);
    }
    return;
  }

  const moveRange = actor.getMoveRange();
  battleInput.beginMoveSelectionWithRange(actor.tile, moveId, opponent.tile, moveRange);

  const color = currentDeclaringPlayer === 1 ? '#60A5FA' : '#F87171';
  ui.setCurrentPlayerLabel(
    `Player ${currentDeclaringPlayer}: Move (blue) then attack (red)`,
    color
  );
};

// ── Start player declaration ─────────────────────────────────────────────────
function startPlayerDeclaration(playerId: number): void {
  const state = turnManager.state;
  if (state.isOver) return;

  const actor = playerId === 1 ? state.p1 : state.p2;
  const color = playerId === 1 ? '#60A5FA' : '#F87171';

  ui.updateTurnBanner(state.turnNumber, 'Selection');
  ui.setCurrentPlayerLabel(`Player ${playerId} (${actor.name}) — choose a move`, color);
  ui.showMovePanel(actor, playerId);

  ui.addLog([`--- Turn ${state.turnNumber}: Player ${playerId} (${actor.name}) ---`]);
}

// ── Species selection screen ─────────────────────────────────────────────────
ui.onSpeciesSelected = (p1Id: string, p2Id: string) => {
  try {
    turnManager.initBattle(p1Id, p2Id);
  } catch (e) {
    console.error('initBattle failed', e);
    alert('Failed to start battle: ' + e);
    return;
  }

  placePokemon();
  ui.updateHP(turnManager.state.p1);
  ui.updateHP(turnManager.state.p2);
  ui.addLog([`Battle started! ${turnManager.state.p1.name} vs ${turnManager.state.p2.name}`]);
  ui.addLog(['Select moves — then choose destination and target tiles.']);

  currentDeclaringPlayer = 1;
  startPlayerDeclaration(1);
};

// ── Render loop ───────────────────────────────────────────────────────────────
engine.runRenderLoop(() => {
  scene.render();
  if (turnManager.state) {
    ui.updateHP(turnManager.state.p1);
    ui.updateHP(turnManager.state.p2);
  }
});

window.addEventListener('resize', () => engine.resize());
