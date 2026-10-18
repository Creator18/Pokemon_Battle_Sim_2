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
import { RecipeFactory } from './client/render/RecipeFactory.ts';
import { MoveVfx } from './client/vfx/MoveVfx.ts';
import { UnitFx } from './client/vfx/UnitFx.ts';
import { BeamFx } from './client/vfx/beam/BeamFx.ts';
import { DashRings } from './client/vfx/DashRings.ts';
import { PulseFx } from './client/vfx/PulseFx.ts';
import { WindFx } from './client/vfx/WindFx.ts';
import { LightningFx } from './client/vfx/LightningFx.ts';
import { SlashFx } from './client/vfx/SlashFx.ts';
import { BattleCamera } from './client/camera/BattleCamera.ts';
import { NetClient } from './client/net/NetClient.ts';
import { GameController } from './client/GameController.ts';
import { hexToRgb, ENV } from './client/theme.ts';
import { TILE_SCALE } from './client/hexWorld.ts';

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
  const environment = new Environment(scene, 10 * TILE_SCALE);
  void environment;
  // The real models, built at runtime from the archive data; the stylized
  // primitives stand in for any Pokémon that cannot be loaded.
  const fx = new UnitFx(scene, camera.camera); // hit flash + aura outlines
  const vfx = new MoveVfx(scene, camera.camera);
  const beams = new BeamFx(scene, camera.camera, { shake: (m, ms) => vfx.shake(m, ms) }); // beam attacks
  const dash = new DashRings(scene, camera.camera); // wake rings left by a dash
  const pulses = new PulseFx(scene, camera.camera); // the sonar pulse (Psychic, Water Pulse)
  const wind = new WindFx(scene, camera.camera); // tornadoes and wind (Gust, Twister)
  const lightning = new LightningFx(scene, camera.camera, { shake: (m, ms) => vfx.shake(m, ms) }); // bolts and earthing
  const slashes = new SlashFx(scene, camera.camera); // claw marks
  const factory = new RecipeFactory(scene, new PokemonFactory(scene), fx, beams, dash, pulses, wind, lightning, slashes);

  const net = new NetClient(); // ws://<host>:8080 by default

  const controller = new GameController({ net, board, factory, vfx, camera, uiRoot });
  controller.start();

  // Dev-only inspection handle (scene, camera, models) for debugging and
  // scripted checks; stripped from production builds.
  if (import.meta.env.DEV) {
    (window as unknown as { __pbw?: unknown }).__pbw = { scene, camera, factory, board, vfx, fx, beams, dash, pulses, wind, lightning, slashes, net, controller };
  }

  engine.runRenderLoop(() => scene.render());
  window.addEventListener('resize', () => engine.resize());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
