/**
 * Low-poly grass for the grass tiles: tufts of flat, faceted blades (a few
 * triangles each, leaning out), shaded dark at the root to light at the tip
 * by vertex colour. A handful of PATCH_VARIANTS patches, each scattering
 * TUFTS tufts over a hex top, are built once; every grass tile shows one of
 * them (an instance, turned by a multiple of 60°), so 61 tiles cost a few draws.
 * The blades sway in the wind (GrassWind): bent along the wind by their
 * height, in waves that roll across the board and swell in slow gusts.
 */
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { Material } from '@babylonjs/core/Materials/material';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';

/** Different patches to choose between, tufts in each, and blades in a tuft (a range). */
const PATCH_VARIANTS = 4, TUFTS = 100, BLADES_MIN = 5, BLADES_MAX = 8;
/** A blade's height and base width (world units), and how far it leans out (radians). */
const BLADE_H: [number, number] = [0.16, 0.32], BLADE_W: [number, number] = [0.04, 0.065], LEAN: [number, number] = [0.15, 0.55];
/** Tufts stay this share of the hex's inradius from its middle (clear of the edges). */
const SPREAD = 0.9;
/** Root and tip colours (the tile's grass, deeper at the root and sunlit at the tip). */
const ROOT: [number, number, number] = [0.42, 0.5, 0.2], TIP: [number, number, number] = [0.8, 0.88, 0.42];

/**
 * The wind: a blade's tip moves up to WIND_BEND (world units) along
 * WIND_DIR, its root not at all (by its height, squared, up to BLADE_H's top);
 * waves of it roll across the board at WIND_SPEED, swelling in slow gusts.
 */
const WIND_BEND = 0.07, WIND_DIR: [number, number] = [0.85, 0.5], WIND_SPEED = 1.9;

/** Snow on the grass (hail): how much white lies on the tufts' upper blades, at most. */
const SNOW_MAX = 0.55;
const grassPlugins = new Set<GrassWind>();
/** How snowed-on the grass is, 0..1 (FieldFx, with the hail). */
export function setGrassSnow(amount: number): void {
  for (const p of grassPlugins) p.snow = Math.max(0, Math.min(1, amount));
}

class GrassWind extends MaterialPluginBase {
  time = 0;
  snow = 0;
  private on = true;
  constructor(material: Material) {
    super(material, 'GrassWind', 200, { GRASSWIND: false });
    // Its clock goes up on every draw (hardBindForSubMesh), not only when the material rebinds.
    this.registerForExtraEvents = true;
    this._enable(true);
    grassPlugins.add(this);
  }
  getClassName(): string { return 'GrassWind'; }
  prepareDefines(defines: Record<string, unknown>): void { defines.GRASSWIND = this.on; }
  getUniforms() {
    return {
      ubo: [{ name: 'gwTime', size: 1, type: 'float' }, { name: 'gwSnow', size: 1, type: 'float' }],
      vertex: `#ifdef GRASSWIND
        uniform float gwTime;
      #endif`,
      fragment: `#ifdef GRASSWIND
        uniform float gwSnow;
      #endif`,
    };
  }
  bindForSubMesh(ubo: UniformBuffer): void { ubo.updateFloat('gwTime', this.time); ubo.updateFloat('gwSnow', this.snow); }
  hardBindForSubMesh(ubo: UniformBuffer): void { ubo.updateFloat('gwTime', this.time); ubo.updateFloat('gwSnow', this.snow); }
  getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType === 'fragment') {
      return {
        // (How far up its blade a point is, from the vertex shader.)
        CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef GRASSWIND
          varying float vGwH;
        #endif`,
        // Snow on the upper blades (hail): white settling on the tips, none at the root.
        CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `#ifdef GRASSWIND
          color.rgb = mix(color.rgb, vec3(0.93, 0.96, 1.0), gwSnow * ${SNOW_MAX.toFixed(2)} * smoothstep(0.25, 0.9, vGwH));
        #endif`,
      };
    }
    if (shaderType !== 'vertex') return null;
    return {
      CUSTOM_VERTEX_DEFINITIONS: `#ifdef GRASSWIND
        varying float vGwH;
      #endif`,
      CUSTOM_VERTEX_UPDATE_WORLDPOS: `#ifdef GRASSWIND
        {
          float gwH = clamp(positionUpdated.y / ${BLADE_H[1].toFixed(2)}, 0.0, 1.0);
          vGwH = gwH;
          gwH *= gwH;
          vec2 gwP = worldPos.xz;
          vec2 gwDir = normalize(vec2(${WIND_DIR[0].toFixed(2)}, ${WIND_DIR[1].toFixed(2)}));
          float gwAlong = dot(gwP, gwDir);
          float gwWave = sin(gwAlong * 1.4 - gwTime * ${WIND_SPEED.toFixed(2)}) * 0.7
                       + sin(gwP.x * 2.3 + gwP.y * 1.7 + gwTime * 2.9) * 0.3;
          float gwGust = 0.55 + 0.45 * sin(gwTime * 0.45 + gwAlong * 0.12);
          worldPos.xz += gwDir * (gwWave * 0.6 + 0.4) * gwGust * ${WIND_BEND.toFixed(3)} * gwH;
          worldPos.y -= abs(gwWave) * gwGust * ${(WIND_BEND * 0.3).toFixed(3)} * gwH;
        }
      #endif`,
    };
  }
}

/** A small seeded random, so the patches are the same every load. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The grass patches (hidden sources to instance): each scatters TUFTS tufts
 * inside a flat-top hex of inradius `inR`, on a plane at y = 0.
 */
export function grassPatches(scene: Scene, inR: number): Mesh[] {
  const mat = new StandardMaterial('grassMat', scene);
  mat.diffuseColor = new Color3(1, 1, 1);
  mat.specularColor = new Color3(0.02, 0.02, 0.02);
  mat.backFaceCulling = false;
  // Both faces lit as the front (a blade has no back), with a little ambient so the shade side isn't black.
  mat.twoSidedLighting = true;
  mat.emissiveColor = new Color3(0.12, 0.14, 0.05);
  const wind = new GrassWind(mat);
  const start = performance.now();
  scene.onBeforeRenderObservable.add(() => { wind.time = (performance.now() - start) / 1000; });
  const out: Mesh[] = [];
  for (let v = 0; v < PATCH_VARIANTS; v++) {
    const rand = rng(9173 + v * 7919);
    const lerp = (a: number, b: number) => a + (b - a) * rand();
    const positions: number[] = [], colors: number[] = [], indices: number[] = [];
    const vert = (x: number, y: number, z: number, c: [number, number, number], shade: number) => {
      positions.push(x, y, z);
      colors.push(c[0] * shade, c[1] * shade, c[2] * shade, 1);
      return positions.length / 3 - 1;
    };
    for (let t = 0; t < TUFTS; t++) {
      // Anywhere inside the hex (rejection-sample a point within SPREAD of its inradius).
      let x = 0, z = 0;
      for (let k = 0; k < 20; k++) {
        x = lerp(-1, 1) * inR; z = lerp(-1, 1) * inR;
        if (insideHex(x, z, inR * SPREAD)) break;
      }
      const blades = Math.round(lerp(BLADES_MIN, BLADES_MAX));
      const shade = lerp(0.85, 1.1);
      const turn = rand() * Math.PI * 2;
      for (let b = 0; b < blades; b++) {
        const a = turn + (b / blades) * Math.PI * 2 + lerp(-0.3, 0.3);
        const h = lerp(...BLADE_H), w = lerp(...BLADE_W), lean = lerp(...LEAN);
        const dx = Math.cos(a), dz = Math.sin(a);
        // Its width runs across its lean; the tip leans out and bends a little to one side.
        const px = -dz * w * 0.5, pz = dx * w * 0.5;
        const ox = x + dx * 0.012, oz = z + dz * 0.012;
        const tipOut = Math.sin(lean) * h, tipUp = Math.cos(lean) * h;
        const bend = lerp(-0.4, 0.4) * w;
        const i0 = vert(ox - px, 0, oz - pz, ROOT, shade);
        const i1 = vert(ox + px, 0, oz + pz, ROOT, shade);
        // A faceted blade: a mid ridge point and the tip.
        const mx = ox + dx * tipOut * 0.45 - dz * bend * 0.5, mz = oz + dz * tipOut * 0.45 + dx * bend * 0.5;
        const i2 = vert(mx, tipUp * 0.5, mz, mid(ROOT, TIP), shade);
        const i3 = vert(ox + dx * tipOut - dz * bend, tipUp, oz + dz * tipOut + dx * bend, TIP, shade);
        indices.push(i0, i1, i2, i0, i2, i3, i1, i3, i2);
      }
    }
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.colors = colors;
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    vd.normals = normals;
    const mesh = new Mesh(`grassPatch${v}`, scene);
    vd.applyToMesh(mesh);
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    mesh.isVisible = false; // a source: only its instances show (they need it enabled)
    out.push(mesh);
  }
  return out;
}

/**
 * A meadow (a Grass aura's tile, RecipeFactory.meadow): one patch, denser and
 * taller than the board's grass (MEADOW_DENSE x its tufts, MEADOW_TALL x its
 * blades), with MEADOW_FLOWERS flowers standing over it on stems — five petals
 * round a yellow middle, in a few colours. It sways in the same wind. Hidden:
 * a source to instance.
 */
export function meadowPatch(scene: Scene, inR: number): Mesh {
  const mat = new StandardMaterial('meadowMat', scene);
  mat.diffuseColor = new Color3(1, 1, 1);
  mat.specularColor = new Color3(0.02, 0.02, 0.02);
  mat.backFaceCulling = false;
  mat.twoSidedLighting = true;
  mat.emissiveColor = new Color3(0.13, 0.16, 0.05);
  const wind = new GrassWind(mat);
  const start = performance.now();
  scene.onBeforeRenderObservable.add(() => { wind.time = (performance.now() - start) / 1000; });
  const rand = rng(4421);
  const lerp = (a: number, b: number) => a + (b - a) * rand();
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const vert = (x: number, y: number, z: number, c: [number, number, number], shade: number) => {
    positions.push(x, y, z);
    colors.push(c[0] * shade, c[1] * shade, c[2] * shade, 1);
    return positions.length / 3 - 1;
  };
  const spot = () => {
    let x = 0, z = 0;
    for (let k = 0; k < 20; k++) {
      x = lerp(-1, 1) * inR; z = lerp(-1, 1) * inR;
      if (insideHex(x, z, inR * SPREAD)) break;
    }
    return [x, z];
  };
  // Its grass: as the board's, denser, taller, a little richer.
  for (let t = 0; t < TUFTS * MEADOW_DENSE; t++) {
    const [x, z] = spot();
    const blades = Math.round(lerp(BLADES_MIN, BLADES_MAX));
    const shade = lerp(0.85, 1.1);
    const turn = rand() * Math.PI * 2;
    for (let b = 0; b < blades; b++) {
      const a = turn + (b / blades) * Math.PI * 2 + lerp(-0.3, 0.3);
      const h = lerp(...BLADE_H) * MEADOW_TALL, w = lerp(...BLADE_W), lean = lerp(...LEAN);
      const dx = Math.cos(a), dz = Math.sin(a);
      const px = -dz * w * 0.5, pz = dx * w * 0.5;
      const ox = x + dx * 0.012, oz = z + dz * 0.012;
      const tipOut = Math.sin(lean) * h, tipUp = Math.cos(lean) * h;
      const bend = lerp(-0.4, 0.4) * w;
      const i0 = vert(ox - px, 0, oz - pz, MEADOW_ROOT, shade);
      const i1 = vert(ox + px, 0, oz + pz, MEADOW_ROOT, shade);
      const mx = ox + dx * tipOut * 0.45 - dz * bend * 0.5, mz = oz + dz * tipOut * 0.45 + dx * bend * 0.5;
      const i2 = vert(mx, tipUp * 0.5, mz, mid(MEADOW_ROOT, MEADOW_TIP), shade);
      const i3 = vert(ox + dx * tipOut - dz * bend, tipUp, oz + dz * tipOut + dx * bend, MEADOW_TIP, shade);
      indices.push(i0, i1, i2, i0, i2, i3, i1, i3, i2);
    }
  }
  // Its flowers: a stem, and a head of five petals round a middle, facing up (tilted a little).
  for (let f = 0; f < MEADOW_FLOWERS; f++) {
    const [x, z] = spot();
    const h = lerp(...MEADOW_STEM);
    const petal = MEADOW_PETALS[f % MEADOW_PETALS.length];
    const s0 = vert(x - 0.008, 0, z, MEADOW_ROOT, 1), s1 = vert(x + 0.008, 0, z, MEADOW_ROOT, 1), s2 = vert(x, h, z, MEADOW_TIP, 1);
    indices.push(s0, s1, s2);
    const r = lerp(...MEADOW_HEAD), tilt = lerp(-0.25, 0.25), turn = rand() * Math.PI * 2;
    const c = vert(x, h + 0.01, z, [1.0, 0.86, 0.2], 1);
    for (let p = 0; p < 5; p++) {
      const a0 = turn + (p / 5) * Math.PI * 2, a1 = a0 + 0.5, a2 = a0 - 0.5;
      const tip = vert(x + Math.cos(a0) * r, h + Math.sin(a0) * r * tilt, z + Math.sin(a0) * r, petal, 1.05);
      const l = vert(x + Math.cos(a1) * r * 0.45, h + 0.004, z + Math.sin(a1) * r * 0.45, petal, 0.95);
      const rr = vert(x + Math.cos(a2) * r * 0.45, h + 0.004, z + Math.sin(a2) * r * 0.45, petal, 0.95);
      indices.push(c, l, tip, c, tip, rr);
    }
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.colors = colors;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  vd.normals = normals;
  const mesh = new Mesh('meadowPatch', scene);
  vd.applyToMesh(mesh);
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  mesh.isVisible = false;
  return mesh;
}
/** A meadow: how many times the board's tufts, how much taller its blades, how many flowers, their stems' and heads' sizes (world), their petals' colours. */
const MEADOW_DENSE = 1.8, MEADOW_TALL = 1.6, MEADOW_FLOWERS = 14;
const MEADOW_STEM: [number, number] = [0.58, 0.78], MEADOW_HEAD: [number, number] = [0.09, 0.13];
const MEADOW_PETALS: [number, number, number][] = [[1, 1, 1], [1.0, 0.85, 0.25], [1.0, 0.55, 0.75], [0.75, 0.6, 1.0]];
const MEADOW_ROOT: [number, number, number] = [0.3, 0.52, 0.14], MEADOW_TIP: [number, number, number] = [0.66, 0.92, 0.32];

const mid = (a: [number, number, number], b: [number, number, number]): [number, number, number] =>
  [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/** Inside a flat-top hex of inradius `inR` centred on the origin? */
function insideHex(x: number, z: number, inR: number): boolean {
  for (let k = 0; k < 6; k++) {
    const a = ((k * 60 + 30) * Math.PI) / 180;
    if (x * Math.cos(a) + z * Math.sin(a) > inR) return false;
  }
  return true;
}
