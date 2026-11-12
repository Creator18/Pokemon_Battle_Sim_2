/**
 * The colosseum — the grassy boss battlefield, side on. Only what lies behind the fighters: nothing on the camera's
 * side of them (the ground before them is all there is there). Its floor the grass stadium's lawns (the pitch, in its
 * mown greens and white lines, with their short fur grass, and the meadow round it); behind the pitch, the bowl of a
 * colosseum in flat painted layers, each further back and higher than the last — so the camera moving along shifts
 * them against each other, the nearer more (parallax):
 *
 *   the podium            PODIUM_Z   the arena's wall: dressed stone, gold-trimmed, banners, gladiators' gates
 *   three bands of stands BAND_Z     rising and receding — each a walkway's balustrade at its foot and rows of benches
 *                                    packed with a crowd above it, the further the smaller and hazier; in the sun from
 *                                    above, shadowed under each balustrade and toward its foot
 *   the rim               RIM_Z      the bowl's top: its arcades, a cornice, masts and flags along it
 *   hills, sky            HILLS_Z, SKY_Z   far hills over the rim; a sky with its sun and drifting clouds
 *
 * The crowd lives: every band is painted twice (heads bobbing, arms thrown up in turn) and shown by turns, CHEER s
 * a frame, each band out of step with the others. Painted once each (2D canvases, their patterns repeating along
 * them), unlit and out of the fog — their own haze painted in, the further the paler, so the fighters stand out
 * against them.
 */
import type { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { grassStadium } from './grassStadium.ts';
import type { Arena } from './grassStadium.ts';
import { seeded, sky, glow, ridgeAt, ridge, clouds, css, mix, hex } from './backdrops.ts';
import type { RGB } from './backdrops.ts';

type Ctx = CanvasRenderingContext2D;

/** How far back each layer stands (z, world units) — the pitch's back edge is at about 11.7. */
const PODIUM_Z = 12.6, RIM_Z = 54, HILLS_Z = 120, SKY_Z = 200;
/**
 * The three bands of stands, near to far: how far back, from what height to what (its walkway at its foot), a seat's
 * width (px, at PX a tile), how many seats between aisles, how hazed.
 */
// (Each band's foot — its walkway's balustrade — just over the top of the band before it, as seen from about the
// fighters' height: so every walkway shows, the bowl stepping up and back.)
const BANDS: { z: number; y0: number; y1: number; tile: number; seat: number; aisle: number; haze: number }[] = [
  { z: 18, y0: 1.2, y1: 5.6, tile: 16, seat: 30, aisle: 13, haze: 0.3 },
  { z: 29, y0: 5.9, y1: 10.6, tile: 22, seat: 24, aisle: 15, haze: 0.45 },
  { z: 41, y0: 10.4, y1: 15.6, tile: 28, seat: 19, aisle: 17, haze: 0.58 },
];
/** How wide each layer is, as a share of its distance (enough to fill the widest view from anywhere along the zone). */
const SPAN = 3.2;
/** Pixels across one tile of a layer. */
const PX = 1024;
/** How long the crowd holds each of its two frames (s). */
const CHEER = 0.34;
/** The lawns kept from the grass stadium (all else of it goes). */
const KEEP = /^stadium(Pitch|Meadow)/;
/** The haze the farther layers fade into (and the sky's low colour), the sun's warmth on the stone. */
const HAZE: RGB = [0.82, 0.88, 0.93], SUN: RGB = [1.0, 0.93, 0.78];

/** The crowd's colours: shirts, and skin and hair for the heads. */
const SHIRTS: RGB[] = [[0.86, 0.22, 0.2], [0.2, 0.42, 0.85], [0.95, 0.78, 0.2], [0.25, 0.65, 0.35], [0.92, 0.92, 0.9], [0.55, 0.3, 0.7], [0.95, 0.5, 0.2], [0.2, 0.2, 0.25], [0.12, 0.6, 0.72]];
const SKIN: RGB[] = [[0.96, 0.8, 0.66], [0.85, 0.64, 0.48], [0.62, 0.43, 0.3], [0.42, 0.28, 0.2]];
const HAIR: RGB[] = [[0.15, 0.1, 0.08], [0.35, 0.22, 0.12], [0.85, 0.7, 0.35], [0.1, 0.1, 0.12], [0.55, 0.25, 0.12]];
const STONE: RGB = [0.84, 0.76, 0.62], STONE_DARK: RGB = [0.6, 0.52, 0.41], STONE_SHADE: RGB = [0.72, 0.64, 0.52], GOLD: RGB = [0.89, 0.7, 0.23];

/** Rows a person high (× a seat's width). */
const ROW_H = 1.25;

/**
 * A band of the stands: at its foot a walkway's balustrade (a rail on its balusters, the walkway's shadow behind), and
 * above it rows of benches up to its top, a crowd packed on them (wide shoulders, a round head, hair; arms thrown up
 * here and there), aisles of steps every `aisle` seats; in the sun from above, shadowed under the balustrade's lip and
 * toward its foot; hazed by `haze`. `frame` (0, 1): the crowd's own movement — the same people, heads bobbed and arms
 * up or down by turns.
 */
function paintBand(c: Ctx, w: number, h: number, seatW: number, aisle: number, haze: number, seed: number, frame: number): void {
  const hz = (col: RGB, a = 1) => css(mix(col, HAZE, haze), a);
  const rail = Math.max(seatW * 1.3, h * 0.13);
  // The stone behind everything, lit warm at the top.
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, hz(mix(STONE_SHADE, SUN, 0.25))); g.addColorStop(1, hz(mix(STONE_SHADE, STONE_DARK, 0.4)));
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  // Its rows, from just above the rail up.
  const rowH = seatW * ROW_H, rows = Math.max(1, Math.floor((h - rail) / rowH));
  const n = Math.floor(w / seatW);
  for (let r = 0; r < rows; r++) {
    const rnd = seeded(seed * 97 + r * 13);
    const foot = h - rail - r * rowH, y0 = foot - rowH, shift = (r % 2) * seatW * 0.5;
    for (let k = 0; k < n; k++) {
      const x = (k * seatW + seatW / 2 + shift) % w;
      const v = [rnd(), rnd(), rnd(), rnd(), rnd(), rnd(), rnd(), rnd()];
      if (k % aisle === aisle - 1) {
        // An aisle: steps up, no one.
        c.fillStyle = hz(STONE_DARK); c.fillRect(x - seatW * 0.42, y0, seatW * 0.84, rowH);
        c.fillStyle = hz(STONE); c.fillRect(x - seatW * 0.42, y0 + rowH * 0.5, seatW * 0.84, rowH * 0.08);
        continue;
      }
      if (v[0] < 0.06) continue; // an empty seat
      const shirt = SHIRTS[Math.floor(v[1] * SHIRTS.length)], skin = SKIN[Math.floor(v[2] * SKIN.length)], hair = HAIR[Math.floor(v[3] * HAIR.length)];
      const halfW = seatW * (0.4 + v[4] * 0.06), bodyH = rowH * 0.42, headR = seatW * (0.21 + v[5] * 0.04);
      // (Its movement this frame: about half of them bob up; some throw their arms up — a few keep them up always.)
      const bob = frame && v[6] > 0.45 ? -rowH * 0.07 : 0;
      const armsUp = v[7] < 0.1 || (frame === 1 && v[7] < 0.32) || (frame === 0 && v[7] > 0.9);
      const seat = foot - rowH * 0.16, top = seat - bodyH + bob;
      if (armsUp) {
        c.fillStyle = hz(shirt);
        for (const side of v[6] > 0.7 ? [-1, 1] : [v[5] < 0.5 ? -1 : 1]) {
          c.beginPath(); c.roundRect(x + side * halfW * 0.55 - seatW * 0.08, top - rowH * 0.34, seatW * 0.16, rowH * 0.44, seatW * 0.08); c.fill();
          c.fillStyle = hz(skin); c.beginPath(); c.arc(x + side * halfW * 0.55, top - rowH * 0.35, seatW * 0.09, 0, Math.PI * 2); c.fill();
          c.fillStyle = hz(shirt);
        }
      }
      c.fillStyle = hz(shirt);
      c.beginPath(); c.roundRect(x - halfW, top, halfW * 2, bodyH - bob, [halfW * 0.7, halfW * 0.7, 2, 2]); c.fill();
      const hy = top - headR * 0.72;
      c.fillStyle = hz(skin); c.beginPath(); c.arc(x, hy, headR, 0, Math.PI * 2); c.fill();
      c.fillStyle = hz(hair); c.beginPath(); c.ellipse(x, hy - headR * 0.32, headR * 1.04, headR * 0.72, 0, Math.PI, Math.PI * 2); c.fill();
    }
    // The bench they sit on: a thin ledge, lit on top.
    c.fillStyle = hz(mix(STONE, SUN, 0.2)); c.fillRect(0, foot - rowH * 0.18, w, rowH * 0.07);
    c.fillStyle = hz(STONE_DARK); c.fillRect(0, foot - rowH * 0.11, w, rowH * 0.11);
  }
  // Shade toward its foot (the bowl's own shadow), deepest just over the rail.
  const s = c.createLinearGradient(0, h * 0.35, 0, h - rail);
  s.addColorStop(0, 'rgba(40,30,30,0)'); s.addColorStop(1, `rgba(40,30,30,${0.3 * (1 - haze)})`);
  c.fillStyle = s; c.fillRect(0, h * 0.35, w, h * 0.65 - rail);
  // The walkway's balustrade at its foot: a cap, balusters, the shadow behind them.
  c.fillStyle = hz([0.32, 0.26, 0.22]); c.fillRect(0, h - rail, w, rail);
  c.fillStyle = hz(mix(STONE, SUN, 0.3)); c.fillRect(0, h - rail, w, rail * 0.2);
  c.fillStyle = hz(STONE_DARK); c.fillRect(0, h - rail * 0.8, w, rail * 0.06);
  c.fillStyle = hz(STONE);
  const bw = Math.max(4, rail * 0.18);
  for (let x = bw; x < w; x += bw * 2.6) { c.beginPath(); c.roundRect(x, h - rail * 0.78, bw, rail * 0.68, bw * 0.5); c.fill(); }
  c.fillStyle = hz(mix(STONE, SUN, 0.15)); c.fillRect(0, h - rail * 0.12, w, rail * 0.12);
}

/** The podium: dressed stone in the sun, a gold-trimmed cornice, banners, and every third bay a gladiators' gate (a dark arched tunnel, its portcullis), a shadow along its foot. */
function paintPodium(c: Ctx, w: number, h: number): void {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, css(mix(STONE, SUN, 0.3))); g.addColorStop(1, css(mix(STONE, STONE_DARK, 0.5)));
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  // Its courses of stone.
  c.strokeStyle = css(STONE_DARK, 0.5); c.lineWidth = 2;
  for (let y = h * 0.2, i = 0; y < h * 0.9; y += h * 0.15, i++) {
    c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
    for (let x = (i % 2) * 36; x < w; x += 72) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + h * 0.15); c.stroke(); }
  }
  // The cornice, its gold trim.
  c.fillStyle = css(mix([0.93, 0.87, 0.75], SUN, 0.3)); c.fillRect(0, 0, w, h * 0.1);
  c.fillStyle = css(GOLD); c.fillRect(0, h * 0.1, w, h * 0.025);
  c.fillStyle = css(STONE_DARK); c.fillRect(0, h * 0.125, w, h * 0.03);
  const bays = 6, bay = w / bays;
  for (let b = 0; b < bays; b++) {
    const x = (b + 0.5) * bay;
    if (b % 3 === 1) {
      // A gate: its arch, the dark of the tunnel, a portcullis, a keystone.
      const gw = bay * 0.42, top = h * 0.3, foot = h * 0.92;
      c.fillStyle = css(mix(STONE, STONE_DARK, 0.6));
      c.beginPath(); c.moveTo(x - gw * 0.62, foot); c.lineTo(x - gw * 0.62, top + gw * 0.62); c.arc(x, top + gw * 0.62, gw * 0.62, Math.PI, 0); c.lineTo(x + gw * 0.62, foot); c.closePath(); c.fill();
      const tunnel = c.createLinearGradient(0, top, 0, foot);
      tunnel.addColorStop(0, css([0.08, 0.06, 0.06])); tunnel.addColorStop(1, css([0.2, 0.15, 0.12]));
      c.fillStyle = tunnel;
      c.beginPath(); c.moveTo(x - gw / 2, foot); c.lineTo(x - gw / 2, top + gw / 2); c.arc(x, top + gw / 2, gw / 2, Math.PI, 0); c.lineTo(x + gw / 2, foot); c.closePath(); c.fill();
      c.strokeStyle = css([0.3, 0.27, 0.24], 0.9); c.lineWidth = 3;
      for (let k = -3; k <= 3; k++) { c.beginPath(); c.moveTo(x + k * gw / 8, top + gw * 0.2); c.lineTo(x + k * gw / 8, foot); c.stroke(); }
      for (let k = 0; k < 4; k++) { const y = top + gw * 0.3 + k * (foot - top - gw * 0.3) / 4; c.beginPath(); c.moveTo(x - gw / 2, y); c.lineTo(x + gw / 2, y); c.stroke(); }
      c.fillStyle = css(GOLD); c.fillRect(x - gw * 0.09, top - gw * 0.02, gw * 0.18, gw * 0.16);
    } else {
      // A banner: blue, gold-edged, the ball's crest.
      const bw = bay * 0.28, top = h * 0.16, bh = h * 0.62;
      c.fillStyle = css([0.14, 0.25, 0.56]);
      c.beginPath(); c.moveTo(x - bw / 2, top); c.lineTo(x + bw / 2, top); c.lineTo(x + bw / 2, top + bh); c.lineTo(x, top + bh - bw * 0.3); c.lineTo(x - bw / 2, top + bh); c.closePath(); c.fill();
      c.fillStyle = css(GOLD); c.fillRect(x - bw / 2, top, bw, 6); c.fillRect(x - bw / 2, top, 4, bh); c.fillRect(x + bw / 2 - 4, top, 4, bh);
      const cy = top + bh * 0.42, r = bw * 0.28;
      c.fillStyle = css([0.92, 0.25, 0.22]); c.beginPath(); c.arc(x, cy, r, Math.PI, Math.PI * 2); c.fill();
      c.fillStyle = css([0.95, 0.95, 0.92]); c.beginPath(); c.arc(x, cy, r, 0, Math.PI); c.fill();
      c.fillStyle = css([0.12, 0.12, 0.14]); c.fillRect(x - r, cy - 3, r * 2, 6);
      c.beginPath(); c.arc(x, cy, r * 0.32, 0, Math.PI * 2); c.fill();
      c.fillStyle = css([0.95, 0.95, 0.92]); c.beginPath(); c.arc(x, cy, r * 0.18, 0, Math.PI * 2); c.fill();
    }
  }
  // Its plinth, and the shadow along its foot.
  c.fillStyle = css([0.42, 0.37, 0.3]); c.fillRect(0, h * 0.92, w, h * 0.08);
  const sh = c.createLinearGradient(0, h * 0.75, 0, h);
  sh.addColorStop(0, 'rgba(30,24,20,0)'); sh.addColorStop(1, 'rgba(30,24,20,0.35)');
  c.fillStyle = sh; c.fillRect(0, h * 0.75, w, h * 0.25);
}

/** The bowl's rim: two storeys of arcades (arches dark within, lit edges), a cornice, masts with their flags; hazed. */
function paintRim(c: Ctx, w: number, h: number, haze: number): void {
  const hz = (col: RGB, a = 1) => css(mix(col, HAZE, haze), a);
  const top = h * 0.28;
  c.fillStyle = hz(mix(STONE, SUN, 0.2)); c.fillRect(0, top, w, h - top);
  const storeys = 2, sh = (h - top) * 0.78 / storeys, archW = 56;
  for (let s = 0; s < storeys; s++) {
    const y0 = top + (h - top) * 0.22 + s * sh;
    c.fillStyle = hz(STONE_DARK); c.fillRect(0, y0 - 3, w, 5);
    for (let x = archW / 2; x < w; x += archW) {
      c.fillStyle = hz([0.3, 0.24, 0.2]);
      c.beginPath(); c.moveTo(x - archW * 0.3, y0 + sh * 0.95); c.lineTo(x - archW * 0.3, y0 + sh * 0.42);
      c.arc(x, y0 + sh * 0.42, archW * 0.3, Math.PI, 0); c.lineTo(x + archW * 0.3, y0 + sh * 0.95); c.closePath(); c.fill();
      c.fillStyle = hz(mix(STONE, SUN, 0.5)); c.fillRect(x - archW * 0.34, y0 + sh * 0.1, archW * 0.04, sh * 0.85);
    }
  }
  c.fillStyle = hz(mix([0.9, 0.83, 0.7], SUN, 0.3)); c.fillRect(0, top, w, (h - top) * 0.2);
  c.fillStyle = hz(STONE_DARK); c.fillRect(0, top + (h - top) * 0.2 - 3, w, 3);
  const flags: RGB[] = [[0.86, 0.22, 0.2], [0.2, 0.42, 0.85], [0.95, 0.78, 0.2], [0.25, 0.65, 0.35]];
  for (let x = 64, k = 0; x < w; x += 128, k++) {
    c.fillStyle = hz([0.32, 0.27, 0.22]); c.fillRect(x - 2, top - h * 0.24, 4, h * 0.24);
    c.fillStyle = hz(flags[k % flags.length]);
    c.beginPath(); c.moveTo(x + 2, top - h * 0.24); c.quadraticCurveTo(x + 26, top - h * 0.21, x + 44, top - h * 0.19);
    c.quadraticCurveTo(x + 24, top - h * 0.15, x + 2, top - h * 0.13); c.closePath(); c.fill();
  }
}

/** A painted layer: a vertical plane `z` back, from `y0` to `y1`, as wide as SPAN × its distance, its canvas(es) repeating every `tile` world units, square-pixelled. More than one paint: frames shown by turns. */
function layer(scene: Scene, root: TransformNode, name: string, z: number, y0: number, y1: number, tile: number,
  paints: ((c: Ctx, w: number, h: number) => void)[], alpha: boolean): { mat: StandardMaterial; frames: DynamicTexture[] } {
  const width = Math.max(60, (z + 30) * SPAN);
  const pxH = Math.min(2048, Math.round(PX * (y1 - y0) / tile));
  const frames = paints.map((paint, i) => {
    const tex = new DynamicTexture(`${name}Tex${i}`, { width: PX, height: pxH }, scene, true);
    const ctx = tex.getContext() as unknown as Ctx;
    ctx.clearRect(0, 0, PX, pxH);
    paint(ctx, PX, pxH);
    tex.update(true);
    tex.hasAlpha = alpha;
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.uScale = width / tile;
    return tex;
  });
  const mat = new StandardMaterial(`${name}Mat`, scene);
  mat.diffuseTexture = frames[0]; mat.emissiveTexture = frames[0];
  mat.useAlphaFromDiffuseTexture = alpha;
  mat.disableLighting = true; mat.fogEnabled = false;
  mat.specularColor = new Color3(0, 0, 0);
  const plane = MeshBuilder.CreatePlane(name, { width, height: y1 - y0 }, scene);
  plane.position.set(0, (y0 + y1) / 2, z);
  plane.material = mat; plane.parent = root; plane.isPickable = false;
  return { mat, frames };
}

/** The colosseum, round the middle: its lawns, and behind them its painted bowl. */
export function colosseum(scene: Scene): Arena {
  const base = grassStadium(scene);
  // (Only its lawns: all its 3D dressing — curbs, pillars, banners, hedges, trees, flowers, steps — goes.)
  for (const m of base.root.getChildMeshes(false)) if (!KEEP.test(m.name)) m.setEnabled(false);
  const root = new TransformNode('colosseum', scene);
  layer(scene, root, 'colSky', SKY_Z, -20, 160, 320, [(c, w, h) => {
    sky(c, w, h, [[0, hex('#4f86c6')], [0.5, hex('#9cc2e6')], [0.82, hex('#dbe8f2')], [1, HAZE]]);
    glow(c, w * 0.7, h * 0.5, h * 0.3, hex('#fff4d8'), 0.8); glow(c, w * 0.7, h * 0.5, h * 0.05, hex('#ffffff'), 1);
  }], false);
  const cloudLayer = layer(scene, root, 'colClouds', SKY_Z - 10, 25, 110, 280, [(c, w, h) => clouds(c, w, h, 8, 0.15, 0.75, hex('#ffffff'), 0.85, 6)], true);
  layer(scene, root, 'colHills', HILLS_Z, 6, 32, 180, [(c, w, h) => {
    ridge(c, w, h, ridgeAt(w, h, 0.4, 0.3, 7, 1), mix(hex('#6d93b5'), HAZE, 0.5));
    ridge(c, w, h, ridgeAt(w, h, 0.62, 0.22, 17, 0.8), mix(hex('#5a8a5e'), HAZE, 0.45));
  }], true);
  layer(scene, root, 'colRim', RIM_Z, 15.4, 25, 40, [(c, w, h) => paintRim(c, w, h, 0.5)], true);
  // The stands, far to near, each with its two frames.
  const bands = [...BANDS].reverse().map((b, i) => layer(scene, root, `colBand${i}`, b.z, b.y0, b.y1, b.tile,
    [0, 1].map((f) => (c: Ctx, w: number, h: number) => paintBand(c, w, h, b.seat, b.aisle, b.haze, 11 + i * 7, f)), true));
  layer(scene, root, 'colPodium', PODIUM_Z, -0.1, 2.2, 9, [paintPodium], false);
  // The crowd cheering (each band by turns, out of step), the clouds drifting.
  let t = 0;
  const obs = scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
    t += dt;
    bands.forEach((b, i) => {
      const f = b.frames[Math.floor(t / CHEER + i * 0.37) % 2];
      if (b.mat.diffuseTexture !== f) { b.mat.diffuseTexture = f; b.mat.emissiveTexture = f; }
    });
    const ct = cloudLayer.frames[0];
    ct.uOffset += dt * 0.004;
  });
  return {
    root,
    bounds: base.bounds,
    air: base.air,
    dispose: () => {
      scene.onBeforeRenderObservable.remove(obs);
      for (const b of bands) for (const f of b.frames) f.dispose();
      root.getChildMeshes(false).forEach((m) => { (m.material as StandardMaterial | null)?.diffuseTexture?.dispose(); m.material?.dispose(); });
      root.dispose(); base.dispose?.();
    },
  } as Arena;
}
