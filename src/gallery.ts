/**
 * Model gallery — a standalone dev page (served at /gallery.html) that renders
 * all species' stylized primitive models side by side for quick visual review.
 * Not part of the game; drop a `.glb` into public/assets/models to preview it too.
 */
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';

import { PokemonFactory } from './client/render/PokemonFactory.ts';
import { SPECIES_LIST } from './shared/index.ts';

const canvas = document.getElementById('c') as unknown as HTMLCanvasElement;
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.07, 0.07, 0.12, 1);

const cam = new ArcRotateCamera('cam', -Math.PI / 2, 1.15, 9, new Vector3(0, 0.9, 0), scene);
cam.attachControl(canvas, true);
cam.lowerRadiusLimit = 3;
cam.upperRadiusLimit = 20;
cam.wheelPrecision = 40;

const hemi = new HemisphericLight('h', new Vector3(0, 1, 0), scene);
hemi.intensity = 0.75;
hemi.groundColor = new Color3(0.25, 0.25, 0.35);
const sun = new DirectionalLight('sun', new Vector3(-1, -2, -1), scene);
sun.intensity = 0.9;
sun.position = new Vector3(6, 12, 6);
const shadow = new ShadowGenerator(1024, sun);
shadow.useBlurExponentialShadowMap = true;
scene.metadata = { shadowGen: shadow };

const ground = MeshBuilder.CreateGround('g', { width: 24, height: 8 }, scene);
const gmat = new StandardMaterial('gm', scene);
gmat.diffuseColor = new Color3(0.16, 0.17, 0.24);
gmat.specularColor = new Color3(0, 0, 0);
ground.material = gmat;
ground.receiveShadows = true;

const factory = new PokemonFactory(scene);
const labels = document.getElementById('labels')!;
const spinNodes: TransformNode[] = [];

(async () => {
  const list = SPECIES_LIST;
  const span = 15;
  const step = span / list.length;
  const start = -span / 2 + step / 2;
  for (let i = 0; i < list.length; i++) {
    const node = await factory.createPokemon(list[i], (i % 2) + 1);
    node.position.x = start + i * step;
    spinNodes.push(node);
    const lbl = document.createElement('div');
    lbl.textContent = list[i].name;
    labels.appendChild(lbl);
  }
})();

scene.onBeforeRenderObservable.add(() => {
  const dt = engine.getDeltaTime() / 1000;
  for (const n of spinNodes) n.rotation.y += dt * 0.6;
});

engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());
