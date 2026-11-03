/**
 * FieldFx — the look of what covers the whole field: the weather (sun, rain,
 * hail, a sandstorm) and the terrain (Electric, Grassy, Misty, Psychic).
 *
 * The weather changes the world itself: the sky dome's gradient, the fog, the
 * key light and the grade's saturation (a sun in the sky and a bluer, brighter
 * sky; grey cloud and rain; hail in a blue fog; dust in a brown one). A
 * terrain tints the whole world toward its type's hue (the grade's global hue)
 * and fills the ground with its own life: lightning crackling from one spot
 * on the ground to another (Electric), flowers, leaves and green motes rising
 * (Grassy), hearts and fairy motes rising (Misty), small rocks lifted off the
 * ground in a psychic glow (Psychic).
 *
 * Each fades in and out over FADE s (`set` is told what is up now; the
 * board's sync calls it), so a new weather or terrain crossfades the last.
 */

import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { ColorCurves } from '@babylonjs/core/Materials/colorCurves';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import type { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import type { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { GradientMaterial } from '@babylonjs/materials/gradient/gradientMaterial';

import { HEX_GRID, keyToTile } from '../../shared/core/hex.ts';
import { HEX_SIZE, TILE_SCALE } from '../hexWorld.ts';
import type { LightningFx } from './LightningFx.ts';
import type { WindFx, Tornado } from './WindFx.ts';
import { smokeTexture } from '../render/textures.ts';
import { setGrassSnow } from '../render/grass.ts';

/** Seconds a weather or terrain takes to come up (or go). */
const FADE = 1.5;
/** How far over the arena the falling weather covers (world). */
const SPREAD = 13 * TILE_SCALE;
/** The sky dome's radius (Environment's, 400 across). */
const SKY_RADIUS = 200;

// ── the weather's world ──
interface Look { skyTop: Color3; skyBottom: Color3; fog: Color3; fogStart: number; fogEnd: number; light: number; saturation: number }
const LOOKS: Record<string, Omit<Look, 'light'> & { light: number }> = {
  // A bright, bluer sky; the light up, the colours richer.
  sunny_zone: { skyTop: new Color3(0.36, 0.64, 0.97), skyBottom: new Color3(0.8, 0.91, 1.0), fog: new Color3(0.84, 0.9, 0.98),
    fogStart: 40, fogEnd: 110, light: 1.3, saturation: 30 },
  // Grey cloud; the light down, the colours washed out.
  rain_zone: { skyTop: new Color3(0.36, 0.39, 0.44), skyBottom: new Color3(0.58, 0.61, 0.65), fog: new Color3(0.52, 0.55, 0.6),
    fogStart: 30, fogEnd: 85, light: 0.62, saturation: -40 },
  // A pale cold sky, a blue fog closing in.
  hail: { skyTop: new Color3(0.52, 0.64, 0.78), skyBottom: new Color3(0.76, 0.84, 0.93), fog: new Color3(0.58, 0.74, 0.93),
    fogStart: 24, fogEnd: 75, light: 0.8, saturation: -15 },
  // A tan sky, a brown fog closing in.
  sandstorm: { skyTop: new Color3(0.6, 0.47, 0.31), skyBottom: new Color3(0.82, 0.67, 0.46), fog: new Color3(0.68, 0.52, 0.33),
    fogStart: 22, fogEnd: 70, light: 0.78, saturation: -12 },
};

/** Each terrain's hue (degrees, for the grade) and how strongly it tints. */
const TERRAIN_HUE: Record<string, number> = {
  electric_terrain: 55, grassy_terrain: 115, misty_terrain: 330, psychic_terrain: 300,
};
const TERRAIN_TINT = 60; // (the grade's density: below ~40 it barely shows, at 100 it floods)

// ── hail and a sandstorm: the wind's outer tornado round the field ──
/** Each storm's colour. */
const STORM_COLOUR: Record<string, [number, number, number]> = {
  hail: [0.32, 0.58, 1.0],
  sandstorm: [0.5, 0.32, 0.14],
};
/**
 * The shells, outermost first: radius (× the field's) and opacity — more
 * see-through toward the middle (above 1: the shell's streaks are sparse, so
 * its power is pushed past full to be seen).
 */
const STORM_LAYERS = [
  { radius: 1.0, opacity: 1.6 },
  { radius: 0.8, opacity: 1.1 },
  { radius: 0.6, opacity: 0.7 },
  { radius: 0.4, opacity: 0.38 },
];
/**
 * Their height (× the shell's scale: WindFx's whole funnel, 3.4 of it — its
 * scale, and so its width, follows from its height), and how fast they spin.
 */
const STORM_HEIGHT = 3.4, STORM_SPIN = 1.4;

// ── Electric Terrain ──
/** How often a bolt crackles across the ground (s, a random spread), and how long one lasts. */
const ELECTRIC_EVERY: [number, number] = [0.05, 0.18];
/** A crackle's thickness (× the hairline bolt: thick enough to read from the battle camera). */
const ELECTRIC_WIDTH = 0.012 * 3.2;
const ELECTRIC_HOLD: [number, number] = [0.18, 0.45];
/** How many crackle at once. */
const ELECTRIC_AT_ONCE = 2;
// ── Psychic Terrain ──
const ROCKS = 12;
/** A lifted rock's size (× TILE_SCALE; a Pokémon is several times taller) and how high it floats (world). */
const ROCK_SIZE: [number, number] = [0.07, 0.15];
const ROCK_LIFT: [number, number] = [0.55, 1.8];
const PSYCHIC_GLOW = new Color3(1.0, 0.32, 0.86);

export type FieldWeather = 'sunny_zone' | 'rain_zone' | 'hail' | 'sandstorm';
export type FieldTerrain = 'electric_terrain' | 'grassy_terrain' | 'misty_terrain' | 'psychic_terrain';

export interface FieldFxDeps {
  pipeline: DefaultRenderingPipeline;
  sky: GradientMaterial;
  keyLight: DirectionalLight;
  fill: HemisphericLight;
  lightning: LightningFx | null;
  /** The wind (its outer tornado walls hail and a sandstorm in). */
  wind: WindFx | null;
  /** The top of a tile, world (HexBoard.tileTop). */
  tileTop(q: number, r: number): Vector3;
}

interface Rock { mesh: Mesh; shells: Mesh[]; base: Vector3; lift: number; phase: number; spin: Vector3 }

export class FieldFx {
  /** How far each one is up, 0..1, and where it is headed. */
  private level: Record<string, number> = {};
  private target: Record<string, number> = {};
  private time = 0;
  private tick: Observer<Scene>;
  private base: Look;
  /** The base as the board set it, for {@link setAir} to go back to. */
  private boardBase: Look | null = null;
  private readonly curves = new ColorCurves();
  private readonly tiles = [...HEX_GRID].map((k) => keyToTile(k));
  private sun: Mesh | null = null;
  private clouds: Mesh[] = [];
  private systems: Record<string, ParticleSystem[]> = {};
  /** Each system's emit rate with its weather or terrain fully up. */
  private fullRate = new Map<ParticleSystem, number>();
  private nextBolt = 0;
  private rocks: Rock[] = [];
  /** Each storm's tornado shells, outermost first, once made. */
  private storms: Record<string, Tornado[]> = {};
  private readonly weatherSky: { mesh: Mesh; mat: GradientMaterial };

  constructor(private readonly scene: Scene, private readonly d: FieldFxDeps) {
    for (const k of [...Object.keys(LOOKS), ...Object.keys(TERRAIN_HUE)]) { this.level[k] = 0; this.target[k] = 0; }
    // The sky dome lies far past the fog's end, so it shows the fog's colour
    // (left so). A weather's own sky is a second dome inside it, unfogged,
    // faded in as the weather comes: no weather, the sky as it always was.
    this.weatherSky = this.buildWeatherSky();
    this.base = {
      skyTop: scene.fogColor.clone(), skyBottom: scene.fogColor.clone(), fog: scene.fogColor.clone(),
      fogStart: scene.fogStart, fogEnd: scene.fogEnd, light: d.keyLight.intensity, saturation: 0,
    };
    this.baseFill = d.fill.intensity;
    const ip = d.pipeline.imageProcessing;
    ip.colorCurvesEnabled = true;
    ip.colorCurves = this.curves;
    this.tick = scene.onBeforeRenderObservable.add(() => this.update());
  }
  private readonly baseFill: number;

  /** What covers the field now (null: nothing): it fades in, and whatever was up before fades out. */
  set(weather: string | null, terrain: string | null): void {
    for (const k of Object.keys(this.target)) this.target[k] = k === weather || k === terrain ? 1 : 0;
  }

  /** Another ground's own air under the weather (an arena's: its fog's colour, start and end); null, the board's back. */
  setAir(air: { fog: Color3; fogStart: number; fogEnd: number } | null): void {
    this.boardBase ??= this.base;
    this.base = air ? { ...this.boardBase, skyTop: air.fog.clone(), skyBottom: air.fog.clone(), fog: air.fog.clone(), fogStart: air.fogStart, fogEnd: air.fogEnd } : this.boardBase;
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.tick);
    for (const list of Object.values(this.systems)) for (const ps of list) ps.dispose();
    this.sun?.dispose();
    for (const c of this.clouds) c.dispose();
    for (const r of this.rocks) { r.mesh.dispose(); r.shells.forEach((s) => s.dispose()); }
  }

  // ── per frame ──
  private update(): void {
    // (Never takes the render loop down with it: a throw here would stop every frame.)
    try { this.step(); } catch (e) { if (!this.failed) { this.failed = true; console.error('FieldFx', e); } }
  }
  private failed = false;

  private step(): void {
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
    this.time += dt;
    for (const k of Object.keys(this.level)) {
      const t = this.target[k], l = this.level[k];
      this.level[k] = t > l ? Math.min(t, l + dt / FADE) : Math.max(t, l - dt / FADE);
    }
    this.updateWorld();
    this.updateSun();
    this.updateClouds();
    this.updateParticles();
    this.updateElectric(dt);
    this.updateRocks();
    this.updateStorms();
    // Hail leaves a little snow on the grass.
    setGrassSnow(smooth(this.level.hail));
  }

  // ── hail and a sandstorm: the tornado's outer shell round the whole field ──
  /**
   * Concentric shells of the wind's outer tornado (WindFx), the outermost as
   * wide as the field, each one in more see-through than the last; spinning,
   * in the storm's colour.
   */
  private updateStorms(): void {
    const wind = this.d.wind;
    if (!wind) return;
    for (const [k, colour] of Object.entries(STORM_COLOUR)) {
      const l = smooth(this.level[k]);
      let layers = this.storms[k];
      if (l <= 0.001) { for (const t of layers ?? []) { t.power = 0; t.mesh.setEnabled(false); } continue; }
      if (!layers) {
        // The shell's radius is about 2 × `outer` × scale (WindFx's frame): the outermost the field's.
        const scale = this.fieldRadius() / 2;
        const c = colour;
        const style = { dark: c, light: c, glow: c, shell: c };
        // Each shell twice: its near side over the field (drawn in front of it),
        // its far side behind it (hidden by the field and the Pokémon on it).
        layers = STORM_LAYERS.flatMap((s, i) => (['near', 'far'] as const).map((side) =>
          wind.make(new Vector3(0, -0.3 * TILE_SCALE, 0), scale * STORM_HEIGHT, style,
            { inner: 0, outer: s.radius, spin: STORM_SPIN * (1 + 0.25 * i), side })));
        this.storms[k] = layers;
      }
      layers.forEach((t, i) => { t.mesh.setEnabled(true); t.power = STORM_LAYERS[i >> 1].opacity * l; });
    }
  }

  /** How far the field reaches from its middle (the furthest tile's far edge). */
  private fieldRadius(): number {
    let r = 0;
    for (const [q, rr] of this.tiles) { const t = this.d.tileTop(q, rr); r = Math.max(r, Math.hypot(t.x, t.z)); }
    return r + HEX_SIZE;
  }

  /** The sky, fog, light and grade: the base, eased toward each weather by how far up it is; the terrain's hue. */
  private updateWorld(): void {
    const b = this.base;
    const look: Look = { skyTop: b.skyTop.clone(), skyBottom: b.skyBottom.clone(), fog: b.fog.clone(), fogStart: b.fogStart, fogEnd: b.fogEnd, light: 1, saturation: 0 };
    for (const [k, w] of Object.entries(LOOKS)) {
      const l = smooth(this.level[k]);
      if (l <= 0) continue;
      look.skyTop = Color3.Lerp(look.skyTop, w.skyTop, l);
      look.skyBottom = Color3.Lerp(look.skyBottom, w.skyBottom, l);
      look.fog = Color3.Lerp(look.fog, w.fog, l);
      look.fogStart += (w.fogStart - look.fogStart) * l;
      look.fogEnd += (w.fogEnd - look.fogEnd) * l;
      look.light += (w.light - look.light) * l;
      look.saturation += (w.saturation - look.saturation) * l;
    }
    // The weather's sky over the old one, as far in as the weather is up.
    const sky = this.weatherSky;
    let up = 0, top = new Color3(), bottom = new Color3();
    for (const [k, w] of Object.entries(LOOKS)) {
      const l = smooth(this.level[k]);
      if (l <= 0) continue;
      top = top.add(w.skyTop.scale(l)); bottom = bottom.add(w.skyBottom.scale(l)); up += l;
    }
    sky.mesh.setEnabled(up > 0.001);
    if (up > 0.001) {
      // (The gradient takes its colours to linear: given in gamma, they show as written.)
      sky.mat.topColor.copyFrom(top.scale(1 / up).toGammaSpace());
      sky.mat.bottomColor.copyFrom(bottom.scale(1 / up).toGammaSpace());
      sky.mat.topColorAlpha = sky.mat.bottomColorAlpha = Math.min(1, up);
    }
    this.scene.fogColor.copyFrom(look.fog);
    this.scene.fogStart = look.fogStart;
    this.scene.fogEnd = look.fogEnd;
    this.d.keyLight.intensity = b.light * look.light;
    this.d.fill.intensity = this.baseFill * (0.6 + 0.4 * look.light);
    // The terrain's tint: the hue of whichever is most up, as strong as all of them together.
    let hue = 0, most = 0, tint = 0;
    for (const [k, h] of Object.entries(TERRAIN_HUE)) {
      const l = smooth(this.level[k]);
      tint += l;
      if (l > most) { most = l; hue = h; }
    }
    this.curves.globalHue = hue;
    this.curves.globalDensity = TERRAIN_TINT * Math.min(1, tint);
    this.curves.globalSaturation = look.saturation;
  }

  /** The weather's sky: a dome just inside the old one, its gradient from the horizon (0) to overhead (1). */
  private buildWeatherSky(): { mesh: Mesh; mat: GradientMaterial } {
    const mesh = MeshBuilder.CreateSphere('fieldSky', { diameter: 2 * (SKY_RADIUS - 5), segments: 16, sideOrientation: Mesh.BACKSIDE }, this.scene);
    mesh.isPickable = false;
    mesh.infiniteDistance = true;
    const mat = new GradientMaterial('fieldSkyMat', this.scene);
    mat.scale = 1 / (SKY_RADIUS - 5);
    mat.offset = 0.05;
    mat.smoothness = 1;
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.fogEnabled = false;
    mat.topColorAlpha = mat.bottomColorAlpha = 0;
    mesh.material = mat;
    mesh.setEnabled(false);
    return { mesh, mat };
  }

  // ── the sun ──
  private updateSun(): void {
    const l = smooth(this.level.sunny_zone);
    if (l <= 0.001) { this.sun?.setEnabled(false); return; }
    if (!this.sun) {
      const sun = MeshBuilder.CreatePlane('fieldSun', { size: 34 }, this.scene);
      sun.billboardMode = Mesh.BILLBOARDMODE_ALL;
      sun.isPickable = false;
      sun.infiniteDistance = true;
      const tex = radialTexture(this.scene, 'fieldSunTex', 128, [[0, 'rgba(255,255,245,1)'], [0.18, 'rgba(255,250,215,1)'], [0.26, 'rgba(255,236,160,0.85)'], [0.5, 'rgba(255,220,120,0.25)'], [1, 'rgba(255,210,110,0)']]);
      const m = new StandardMaterial('fieldSunMat', this.scene);
      m.disableLighting = true;
      m.emissiveTexture = tex;
      m.opacityTexture = tex;
      m.fogEnabled = false;
      m.alphaMode = Constants.ALPHA_ADD;
      m.disableDepthWrite = true;
      sun.material = m;
      // Up the sky the way the key light comes from, toward the horizon so it shows.
      const from = this.d.keyLight.direction.scale(-1);
      sun.position = new Vector3(from.x, 0.16, from.z).normalize().scale(170);
      this.sun = sun;
    }
    this.sun.setEnabled(true);
    (this.sun.material as StandardMaterial).alpha = l;
  }

  // ── cloud (rain, and some for hail) ──
  private updateClouds(): void {
    const l = Math.max(smooth(this.level.rain_zone), 0.7 * smooth(this.level.hail));
    if (l <= 0.001) { for (const c of this.clouds) c.setEnabled(false); return; }
    if (!this.clouds.length) {
      const tex = radialTexture(this.scene, 'fieldCloudTex', 128, [[0, 'rgba(255,255,255,0.95)'], [0.45, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]);
      const rnd = seeded(77);
      for (let i = 0; i < 22; i++) {
        const c = MeshBuilder.CreatePlane(`fieldCloud${i}`, { size: 1 }, this.scene);
        c.billboardMode = Mesh.BILLBOARDMODE_ALL;
        c.isPickable = false;
        const a = rnd() * Math.PI * 2, r = 50 + rnd() * 110;
        c.position = new Vector3(Math.cos(a) * r, 26 + rnd() * 40, Math.sin(a) * r);
        c.scaling.set(40 + rnd() * 50, 18 + rnd() * 18, 1);
        const m = new StandardMaterial(`fieldCloudMat${i}`, this.scene);
        m.disableLighting = true;
        m.emissiveColor = new Color3(0.6, 0.62, 0.66).scale(0.85 + rnd() * 0.25);
        m.opacityTexture = tex;
        m.fogEnabled = false;
        m.disableDepthWrite = true;
        c.material = m;
        this.clouds.push(c);
      }
    }
    for (const c of this.clouds) {
      c.setEnabled(true);
      (c.material as StandardMaterial).alpha = 0.85 * l;
      c.position.x += 0.6 * this.scene.getEngine().getDeltaTime() / 1000; // drifting
    }
  }

  // ── particles: rain, hail, dust; flowers, leaves, motes, hearts ──
  private updateParticles(): void {
    const want: Record<string, () => ParticleSystem[]> = {
      rain_zone: () => [this.rain()],
      hail: () => [this.hail()],
      sandstorm: () => this.sand(),
      grassy_terrain: () => this.grassy(),
      misty_terrain: () => this.misty(),
    };
    for (const [k, make] of Object.entries(want)) {
      const l = smooth(this.level[k]);
      if (l <= 0.001) {
        for (const ps of this.systems[k] ?? []) ps.emitRate = 0;
        continue;
      }
      if (!this.systems[k]) { this.systems[k] = make(); for (const ps of this.systems[k]) { this.fullRate.set(ps, ps.emitRate); ps.start(); } }
      for (const ps of this.systems[k]) ps.emitRate = (this.fullRate.get(ps) ?? 0) * l;
    }
  }

  private falling(name: string, capacity: number, texture: Texture, height = 16): ParticleSystem {
    const ps = new ParticleSystem(name, capacity, this.scene);
    ps.particleTexture = texture;
    ps.emitter = new Vector3(0, height * TILE_SCALE * 0.6, 0);
    ps.minEmitBox = new Vector3(-SPREAD, 0, -SPREAD);
    ps.maxEmitBox = new Vector3(SPREAD, 2, SPREAD);
    ps.preventAutoStart = true;
    return ps;
  }

  private rain(): ParticleSystem {
    const ps = this.falling('fieldRain', 3000, streakTexture(this.scene));
    ps.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    ps.color1 = new Color4(0.72, 0.82, 1, 0.55);
    ps.color2 = new Color4(0.6, 0.7, 0.92, 0.4);
    ps.colorDead = new Color4(0.6, 0.7, 0.9, 0);
    ps.minSize = 0.035 * TILE_SCALE; ps.maxSize = 0.06 * TILE_SCALE;
    ps.minScaleY = 7; ps.maxScaleY = 12;
    ps.minLifeTime = 0.55; ps.maxLifeTime = 0.8;
    ps.emitRate = 2200;
    ps.direction1 = new Vector3(-0.12, -1, 0.04); ps.direction2 = new Vector3(-0.06, -1, 0.1);
    ps.minEmitPower = 24 * TILE_SCALE * 0.6; ps.maxEmitPower = 30 * TILE_SCALE * 0.6;
    return ps;
  }

  private hail(): ParticleSystem {
    const ps = this.falling('fieldHail', 1400, radialTexture(this.scene, 'fieldHailTex', 32,
      [[0, 'rgba(255,255,255,1)'], [0.55, 'rgba(225,240,255,1)'], [0.75, 'rgba(170,205,245,0.9)'], [1, 'rgba(160,200,240,0)']]));
    ps.color1 = new Color4(1, 1, 1, 1); ps.color2 = new Color4(0.85, 0.93, 1, 0.95);
    ps.colorDead = new Color4(0.85, 0.93, 1, 0);
    ps.minSize = 0.06 * TILE_SCALE; ps.maxSize = 0.13 * TILE_SCALE;
    ps.minLifeTime = 0.9; ps.maxLifeTime = 1.3;
    ps.emitRate = 520;
    ps.direction1 = new Vector3(-0.25, -1, -0.1); ps.direction2 = new Vector3(0.05, -1, 0.15);
    ps.minEmitPower = 12 * TILE_SCALE * 0.6; ps.maxEmitPower = 16 * TILE_SCALE * 0.6;
    ps.gravity = new Vector3(0, -12, 0);
    ps.minAngularSpeed = -4; ps.maxAngularSpeed = 4;
    return ps;
  }

  private sand(): ParticleSystem[] {
    // Drifting clouds of dust, and fine grit whipping along with the wind.
    const dust = new ParticleSystem('fieldDust', 900, this.scene);
    dust.particleTexture = smokeTexture(this.scene);
    dust.blendMode = ParticleSystem.BLENDMODE_STANDARD; // (dust covers; it does not glow)
    dust.emitter = new Vector3(-SPREAD * 0.6, 0, 0);
    dust.minEmitBox = new Vector3(-SPREAD, 0.1, -SPREAD); dust.maxEmitBox = new Vector3(SPREAD * 0.6, 3.5 * TILE_SCALE, SPREAD);
    dust.color1 = new Color4(0.7, 0.53, 0.33, 0.22); dust.color2 = new Color4(0.6, 0.45, 0.28, 0.16);
    dust.colorDead = new Color4(0.6, 0.45, 0.28, 0);
    dust.minSize = 0.25 * TILE_SCALE; dust.maxSize = 0.7 * TILE_SCALE;
    dust.minLifeTime = 2.5; dust.maxLifeTime = 4.5;
    dust.emitRate = 160;
    dust.direction1 = new Vector3(1, 0.05, -0.25); dust.direction2 = new Vector3(1, 0.2, 0.25);
    dust.minEmitPower = 3; dust.maxEmitPower = 6;
    dust.minAngularSpeed = -0.6; dust.maxAngularSpeed = 0.6;
    dust.preventAutoStart = true;
    const grit = new ParticleSystem('fieldGrit', 1600, this.scene);
    grit.particleTexture = radialTexture(this.scene, 'fieldGritTex', 16, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
    grit.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    grit.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    grit.emitter = new Vector3(-SPREAD * 0.8, 0, 0);
    grit.minEmitBox = new Vector3(-SPREAD, 0.05, -SPREAD); grit.maxEmitBox = new Vector3(SPREAD * 0.4, 2.5 * TILE_SCALE, SPREAD);
    grit.color1 = new Color4(0.86, 0.7, 0.46, 0.7); grit.color2 = new Color4(0.72, 0.55, 0.34, 0.55);
    grit.colorDead = new Color4(0.72, 0.55, 0.34, 0);
    grit.minSize = 0.025 * TILE_SCALE; grit.maxSize = 0.05 * TILE_SCALE;
    grit.minScaleY = 3; grit.maxScaleY = 6;
    grit.minLifeTime = 1.2; grit.maxLifeTime = 2;
    grit.emitRate = 700;
    grit.direction1 = new Vector3(1, -0.05, -0.15); grit.direction2 = new Vector3(1, 0.1, 0.15);
    grit.minEmitPower = 10; grit.maxEmitPower = 16;
    grit.preventAutoStart = true;
    return [dust, grit];
  }

  /** Particles rising off the ground from random spots on the board. */
  private rising(name: string, capacity: number, texture: Texture, o: {
    size: [number, number]; rate: number; life: [number, number]; power: [number, number];
    color1: Color4; color2: Color4; spin?: number; add?: boolean;
  }): ParticleSystem {
    const ps = new ParticleSystem(name, capacity, this.scene);
    ps.particleTexture = texture;
    ps.emitter = Vector3.Zero();
    const tiles = this.tiles, top = this.d.tileTop;
    ps.startPositionFunction = (_world, pos) => {
      const [q, r] = tiles[Math.floor(Math.random() * tiles.length)];
      const t = top(q, r);
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * HEX_SIZE * 0.8;
      pos.set(t.x + Math.cos(a) * rr, t.y + 0.04, t.z + Math.sin(a) * rr);
    };
    ps.color1 = o.color1; ps.color2 = o.color2;
    ps.colorDead = new Color4(o.color2.r, o.color2.g, o.color2.b, 0);
    ps.minSize = o.size[0] * TILE_SCALE; ps.maxSize = o.size[1] * TILE_SCALE;
    ps.minLifeTime = o.life[0]; ps.maxLifeTime = o.life[1];
    ps.emitRate = o.rate;
    ps.direction1 = new Vector3(-0.25, 1, -0.25); ps.direction2 = new Vector3(0.25, 1, 0.25);
    ps.minEmitPower = o.power[0]; ps.maxEmitPower = o.power[1];
    ps.gravity = new Vector3(0, 0.08, 0);
    if (o.spin) { ps.minAngularSpeed = -o.spin; ps.maxAngularSpeed = o.spin; ps.minInitialRotation = 0; ps.maxInitialRotation = Math.PI * 2; }
    // Motes glow (added); flowers, leaves and hearts are seen in their own colours.
    ps.blendMode = o.add ? ParticleSystem.BLENDMODE_ADD : ParticleSystem.BLENDMODE_STANDARD;
    ps.preventAutoStart = true;
    return ps;
  }

  private grassy(): ParticleSystem[] {
    return [
      this.rising('fieldFlowers', 900, flowerTexture(this.scene), { size: [0.15, 0.26], rate: 70, life: [2.6, 4.2], power: [0.25, 0.55],
        color1: new Color4(1, 1, 1, 1), color2: new Color4(1, 0.95, 0.95, 0.95), spin: 0.8 }),
      this.rising('fieldLeaves', 1100, leafTexture(this.scene), { size: [0.14, 0.24], rate: 95, life: [2.4, 4], power: [0.3, 0.65],
        color1: new Color4(0.55, 0.92, 0.38, 1), color2: new Color4(0.32, 0.75, 0.26, 0.95), spin: 2.2 }),
      this.rising('fieldGreenMotes', 500, radialTexture(this.scene, 'fieldMoteTex', 32, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]),
        { size: [0.05, 0.12], rate: 220, life: [2, 3.6], power: [0.35, 0.8], color1: new Color4(0.5, 1, 0.42, 0.9), color2: new Color4(0.75, 1, 0.5, 0.7), add: true }),
    ];
  }

  private misty(): ParticleSystem[] {
    return [
      this.rising('fieldHearts', 900, heartTexture(this.scene), { size: [0.15, 0.26], rate: 85, life: [2.6, 4.2], power: [0.25, 0.55],
        color1: new Color4(1, 0.62, 0.84, 1), color2: new Color4(1, 0.78, 0.92, 0.95), spin: 0.5 }),
      this.rising('fieldFairyMotes', 520, radialTexture(this.scene, 'fieldFairyMoteTex', 32, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]),
        { size: [0.05, 0.12], rate: 240, life: [2, 3.6], power: [0.35, 0.8], color1: new Color4(1, 0.58, 0.86, 0.9), color2: new Color4(1, 0.9, 1, 0.75), add: true }),
    ];
  }

  // ── Electric Terrain: lightning from one spot on the ground to another ──
  private updateElectric(dt: number): void {
    const l = this.level.electric_terrain;
    const L = this.d.lightning;
    if (!L || l < 0.3) return;
    this.nextBolt -= dt;
    if (this.nextBolt > 0) return;
    this.nextBolt = rand(ELECTRIC_EVERY) / l;
    for (let n = 0; n < ELECTRIC_AT_ONCE; n++) {
      const [q, r] = this.tiles[Math.floor(Math.random() * this.tiles.length)];
      // To a spot a tile or two away.
      const a = Math.random() * Math.PI * 2, reach = HEX_SIZE * (1.2 + Math.random() * 2.2);
      const from = this.groundAt(this.d.tileTop(q, r));
      const to = this.groundAt(new Vector3(from.x + Math.cos(a) * reach, from.y, from.z + Math.sin(a) * reach));
      L.bolt(() => from, () => to, { width: ELECTRIC_WIDTH * TILE_SCALE, strands: 2, forks: 2, hold: rand(ELECTRIC_HOLD), light: 0.35, quiet: true });
    }
  }

  private groundAt(p: Vector3): Vector3 {
    const j = Math.random() * Math.PI * 2, rr = Math.random() * HEX_SIZE * 0.6;
    return new Vector3(p.x + Math.cos(j) * rr, p.y + 0.05, p.z + Math.sin(j) * rr);
  }

  // ── Psychic Terrain: small rocks lifted off the ground in a psychic glow ──
  private updateRocks(): void {
    const l = smooth(this.level.psychic_terrain);
    if (l <= 0.001) { for (const r of this.rocks) { r.mesh.setEnabled(false); } return; }
    if (!this.rocks.length) this.buildRocks();
    for (const r of this.rocks) {
      r.mesh.setEnabled(true);
      // Up off the ground as it comes, bobbing and turning; back down as it goes.
      const bob = Math.sin(this.time * 1.3 + r.phase) * 0.08 * TILE_SCALE;
      r.mesh.position.set(r.base.x, r.base.y + r.lift * l + bob * l, r.base.z);
      r.mesh.rotation.x += r.spin.x * 0.016; r.mesh.rotation.y += r.spin.y * 0.016; r.mesh.rotation.z += r.spin.z * 0.016;
      const pulse = 0.8 + 0.2 * Math.sin(this.time * 3 + r.phase);
      r.shells.forEach((s, i) => { (s.material as StandardMaterial).alpha = (i === 0 ? 0.42 : 0.18) * pulse * l; });
    }
  }

  private buildRocks(): void {
    const rnd = seeded(4242);
    const used = new Set<number>();
    const rockMat = new StandardMaterial('fieldRockMat', this.scene);
    rockMat.diffuseColor = new Color3(0.55, 0.52, 0.56);
    rockMat.specularColor = new Color3(0.05, 0.05, 0.05);
    rockMat.emissiveColor = PSYCHIC_GLOW.scale(0.18);
    for (let i = 0; i < ROCKS; i++) {
      let t = Math.floor(rnd() * this.tiles.length);
      while (used.has(t)) t = (t + 1) % this.tiles.length;
      used.add(t);
      const [q, r] = this.tiles[t];
      const size = (ROCK_SIZE[0] + (ROCK_SIZE[1] - ROCK_SIZE[0]) * rnd()) * TILE_SCALE;
      const mesh = MeshBuilder.CreatePolyhedron(`fieldRock${i}`, { type: Math.floor(rnd() * 3), size }, this.scene);
      mesh.scaling.set(1, 0.65 + rnd() * 0.4, 0.8 + rnd() * 0.4);
      mesh.material = rockMat;
      mesh.isPickable = false;
      // The psychic coat: two glowing shells round it, the inner brighter.
      const shells = [1.3, 1.7].map((k, j) => {
        const s = mesh.clone(`fieldRockShell${i}_${j}`) as Mesh;
        s.parent = mesh;
        s.position.setAll(0); s.rotation.setAll(0); s.scaling.setAll(k);
        const m = new StandardMaterial(`fieldRockShellMat${i}_${j}`, this.scene);
        m.disableLighting = true;
        m.emissiveColor = PSYCHIC_GLOW;
        m.alphaMode = Constants.ALPHA_ADD;
        m.disableDepthWrite = true;
        m.backFaceCulling = false;
        m.alpha = 0;
        s.material = m;
        s.isPickable = false;
        return s;
      });
      const top = this.d.tileTop(q, r);
      const a = rnd() * Math.PI * 2, rr = rnd() * HEX_SIZE * 0.55;
      this.rocks.push({
        mesh, shells, base: new Vector3(top.x + Math.cos(a) * rr, top.y + size * 0.4, top.z + Math.sin(a) * rr),
        lift: (ROCK_LIFT[0] + (ROCK_LIFT[1] - ROCK_LIFT[0]) * rnd()) * TILE_SCALE, phase: rnd() * Math.PI * 2,
        spin: new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).scale(1.6),
      });
    }
  }
}

// ── helpers ──
const smooth = (x: number) => x * x * (3 - 2 * x);
const rand = ([a, b]: [number, number]) => a + Math.random() * (b - a);
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const textures = new Map<string, DynamicTexture>();
function canvasTexture(scene: Scene, name: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): DynamicTexture {
  const had = textures.get(name);
  if (had && had.getInternalTexture()) return had;
  const t = new DynamicTexture(name, size, scene, true);
  t.hasAlpha = true;
  const g = t.getContext() as unknown as CanvasRenderingContext2D;
  g.clearRect(0, 0, size, size);
  draw(g, size);
  t.update();
  textures.set(name, t);
  return t;
}

function radialTexture(scene: Scene, name: string, size: number, stops: [number, string][]): DynamicTexture {
  return canvasTexture(scene, name, size, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    for (const [at, c] of stops) grad.addColorStop(at, c);
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

/** A raindrop's streak: thin, bright down its middle. */
function streakTexture(scene: Scene): DynamicTexture {
  return canvasTexture(scene, 'fieldStreakTex', 32, (g, s) => {
    const grad = g.createLinearGradient(0, 0, s, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.5, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(s * 0.3, 0, s * 0.4, s);
  });
}

/** A small five-petalled flower: white, pink or yellow petals round a yellow heart. */
function flowerTexture(scene: Scene): DynamicTexture {
  return canvasTexture(scene, 'fieldFlowerTex', 64, (g, s) => {
    const petals = ['#FFFFFF', '#FFB6D9', '#FFE27A'];
    const c = s / 2;
    g.fillStyle = petals[Math.floor(Math.random() * petals.length)];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      g.beginPath();
      g.ellipse(c + Math.cos(a) * s * 0.2, c + Math.sin(a) * s * 0.2, s * 0.17, s * 0.11, a, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#F7B733';
    g.beginPath(); g.arc(c, c, s * 0.1, 0, Math.PI * 2); g.fill();
  });
}

/** A small leaf: a pointed oval with a midrib (white: the particle colours it green). */
function leafTexture(scene: Scene): DynamicTexture {
  return canvasTexture(scene, 'fieldLeafTex', 64, (g, s) => {
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.moveTo(s * 0.5, s * 0.06);
    g.quadraticCurveTo(s * 0.92, s * 0.45, s * 0.5, s * 0.94);
    g.quadraticCurveTo(s * 0.08, s * 0.45, s * 0.5, s * 0.06);
    g.fill();
    g.strokeStyle = 'rgba(0,60,0,0.45)';
    g.lineWidth = s * 0.04;
    g.beginPath(); g.moveTo(s * 0.5, s * 0.12); g.lineTo(s * 0.5, s * 0.88); g.stroke();
  });
}

/** A heart (white: the particle colours it). */
function heartTexture(scene: Scene): DynamicTexture {
  return canvasTexture(scene, 'fieldHeartTex', 64, (g, s) => {
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.moveTo(s * 0.5, s * 0.85);
    g.bezierCurveTo(s * 0.05, s * 0.55, s * 0.12, s * 0.12, s * 0.5, s * 0.32);
    g.bezierCurveTo(s * 0.88, s * 0.12, s * 0.95, s * 0.55, s * 0.5, s * 0.85);
    g.fill();
  });
}
