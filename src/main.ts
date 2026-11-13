/**
 * Bootstrap — Pokémon Metroidverse: create the engine and scene, the camera and its lights, the model factory and
 * every move's effects; then into the game — the boss battlefield by default (?zone=room: the first room). Runs the
 * render loop and the resize.
 *
 * (The hex-board battle game this grew from — its board, lobby and netcode — is no longer started.)
 */

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';

// Side-effect imports required for the tree-shaken feature set.
import '@babylonjs/core/Meshes/meshBuilder';
import '@babylonjs/core/Particles/particleSystemComponent';
import '@babylonjs/core/Culling/ray'; // required by scene picking (the camera's occlusion rays)

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
import { startBossZone, startFirstRoom, startPalletTown } from './client/metroidverse/zones.ts';
import type { Zone } from './client/metroidverse/zones.ts';

async function boot(): Promise<void> {
  const canvas = document.getElementById('renderCanvas') as unknown as HTMLCanvasElement;

  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true }, true);
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.05, 0.05, 0.1, 1);
  scene.metadata = {};

  // Camera + lights (the shadow generator registered into scene.metadata for the factory). Its own keys stay unbound:
  // the game's are the player's.
  const camera = new BattleCamera(scene, engine, canvas);
  (scene.metadata as { shadowGen?: unknown }).shadowGen = camera.shadows;

  // The real models, built at runtime from the archive data; the stylized primitives stand in for any Pokémon that
  // cannot be loaded. Every move's effects.
  const fx = new UnitFx(scene, camera.camera); // hit flash + aura outlines
  const vfx = new MoveVfx(scene, camera.camera);
  const beams = new BeamFx(scene, camera.camera, { shake: (m, ms) => vfx.shake(m, ms) });
  const dash = new DashRings(scene, camera.camera);
  const pulses = new PulseFx(scene, camera.camera);
  const wind = new WindFx(scene, camera.camera);
  const lightning = new LightningFx(scene, camera.camera, { shake: (m, ms) => vfx.shake(m, ms) });
  const slashes = new SlashFx(scene, camera.camera);
  const factory = new RecipeFactory(scene, new PokemonFactory(scene), fx, beams, dash, pulses, wind, lightning, slashes);

  // (A zone's air — for the demo scripts, which set it as the old field did.)
  const field = {
    setAir: (air: { fog: Color3; fogStart: number; fogEnd: number } | null) => {
      if (!air) { scene.fogMode = 0; return; }
      scene.fogMode = 3; scene.fogColor = air.fog; scene.fogStart = air.fogStart; scene.fogEnd = air.fogEnd;
    },
  };

  engine.runRenderLoop(() => scene.render());
  window.addEventListener('resize', () => engine.resize());

  // Dev-only inspection handle (scene, camera, models, effects) for debugging and scripted checks — and the demo
  // scripts; stripped from production builds.
  const deps = { scene, factory, camera: camera.camera };
  if (import.meta.env.DEV) {
    (window as unknown as { __pbw?: unknown }).__pbw = { scene, camera, factory, vfx, fx, beams, dash, pulses, wind, lightning, slashes, field,
      startBossZone: (o?: Parameters<typeof startBossZone>[1]) => startBossZone(deps, o), startFirstRoom: (o?: Parameters<typeof startFirstRoom>[1]) => startFirstRoom(deps, o),
      startPalletTown: (o?: Parameters<typeof startPalletTown>[1]) => startPalletTown(deps, o) };
  }

  // Into the game.
  const which = new URLSearchParams(location.search).get('zone');
  const zone: Zone = which === 'room' ? await startFirstRoom(deps) : which === 'pallet' ? await startPalletTown(deps) : await startBossZone(deps);
  if (import.meta.env.DEV) {
    const w = window as unknown as { __zone?: Zone; __pf?: unknown; __arena?: unknown };
    w.__zone = zone; w.__pf = zone.pf; w.__arena = zone.arena;
  }
  canvas.focus();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { void boot(); });
} else {
  void boot();
}
