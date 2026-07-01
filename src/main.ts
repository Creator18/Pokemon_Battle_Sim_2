/**
 * Bootstrap: create engine/scene, board, camera, lights, factory, vfx, net
 * client, and the top-level GameController. Runs the render loop + resize.
 */

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Color4 } from '@babylonjs/core/Maths/math.color';

// Side-effect imports required for the tree-shaken feature set.
import '@babylonjs/core/Meshes/meshBuilder';
import '@babylonjs/core/Particles/particleSystemComponent';
import '@babylonjs/core/Culling/ray'; // required by scene pointer picking

import { HexBoard } from './client/render/HexBoard.ts';
import { Environment } from './client/render/Environment.ts';
import { PokemonFactory } from './client/render/PokemonFactory.ts';
import { MoveVfx } from './client/vfx/MoveVfx.ts';
import { BattleCamera } from './client/camera/BattleCamera.ts';
import { NetClient } from './client/net/NetClient.ts';
import { GameController } from './client/GameController.ts';
import { hexToRgb, ENV } from './client/theme.ts';

function boot(): void {
  const canvas = document.getElementById('renderCanvas') as unknown as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui-root') as HTMLElement;

  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true }, true);
  const scene = new Scene(engine);
  const [br, bg, bb] = hexToRgb(ENV.clear);
  scene.clearColor = new Color4(br, bg, bb, 1);
  scene.metadata = {};

  // Camera + lights (shadow generator registered into scene.metadata for board/factory).
  const camera = new BattleCamera(scene, engine, canvas);
  (scene.metadata as { shadowGen?: unknown }).shadowGen = camera.shadows;
  camera.bindKeys();

  const board = new HexBoard(scene);
  // Painterly forest scenery around the arena (non-interactive; isPickable=false
  // so it never intercepts tile clicks). Built after the shadow generator is
  // registered so trees/rocks cast shadows onto the arena.
  const environment = new Environment(scene);
  void environment;
  const factory = new PokemonFactory(scene);
  const vfx = new MoveVfx(scene, camera.camera);

  const net = new NetClient(); // ws://<host>:8080 by default

  const controller = new GameController({ net, board, factory, vfx, camera, uiRoot });
  controller.start();

  engine.runRenderLoop(() => scene.render());
  window.addEventListener('resize', () => engine.resize());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
