/**
 * The League stadium — a modern Pokémon stadium for the boss battlefield, side on (after the Galar stadiums: football
 * grounds built for Pokémon battles). Only what lies behind the fighters: nothing on the camera's side. Its floor the
 * grass stadium's lawns, a Pokéball painted round the centre circle; behind the pitch, its bowl in flat painted layers,
 * each further back and higher (parallax — the nearer more), the further the hazier, their haze toward the evening sky:
 *
 *   LED boards         ADS_Z      pitch-side, scrolling (the League's marks, Pokéball red and white)
 *   the lower bowl     LOWER      seats in blocks of colour, a crowd in either side's colours — scarves up, flags
 *                                 waving, phones flashing (by turns: CHEER s a frame)
 *   the ribbon board   RIBBON_Z   a scrolling LED strip along the fascia between the bowls
 *   the upper bowl     UPPER      smaller and hazier, its crowd likewise
 *   the scoreboard     SCREEN_Z   hung over the middle, before the upper bowl: a live feed of the fight (a broadcast
 *                                 camera of its own, framing the two fighters close, the stands behind them — follow(a, b)),
 *                                 both sides' names and HP, the clock — scoreboard.update(...) each beat
 *   the roof           ROOF_Z     its canopy's steel trusses, a row of floodlights blazing
 *   the city, the sky  CITY_Z, SKY_Z   a skyline of towers, windows lit; an evening sky
 */
import { groundLit } from '../../vfx/groundLight.ts';
import type { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { grassStadium } from './grassStadium.ts';
import type { Arena } from './grassStadium.ts';
import { seeded, sky, glow, css, mix, hex } from './backdrops.ts';
import type { RGB } from './backdrops.ts';

type Ctx = CanvasRenderingContext2D;

const ADS_Z = 12.4, RIBBON_Z = 23.6, SCREEN_Z = 26.5, ROOF_Z = 44, CITY_Z = 110, SKY_Z = 200;
/** The two bowls: how far back, their height, a tile's width (world units), a seat's width (px), how hazed. */
// (Hazed well back — toward CROWD_HAZE, a muted dusk grey — so the crowd's colours and contrast never swallow a fighter
// in front of them: a bright one or a dark one, a red one or a blue one, it stands out against a soft mid-tone.)
const LOWER = { z: 17, y0: 1.15, y1: 6.4, tile: 16, seat: 30, haze: 0.5 };
const UPPER = { z: 30, y0: 6.8, y1: 13.2, tile: 24, seat: 22, haze: 0.66 };
/** How wide each layer is, as a share of its distance (to fill the widest view from anywhere along the zone). */
const SPAN = 3.2;
const PX = 1024;
/** The crowd's frames: how long each holds (s); how many (bobbing, arms, flags, and the flashes moving on). */
const CHEER = 0.3, FRAMES = 3;
/** The live feed's framing: the margin round its subjects (world units), the nearest it comes (world units). */
const FEED_MARGIN = 1.4, FEED_NEAREST = 6;
/** How often the live feed's list of what it draws is refreshed (s). */
const FEED_LIST = 0.25;
/** The lawns kept from the grass stadium. */
const KEEP = /^stadium(Pitch|Meadow)/;
/** The evening's haze (the sky's low glow), and the floodlights' warm white. */
const HAZE: RGB = hex('#c9b6c8'), FLOOD: RGB = hex('#fff6e0');
/** The crowd's haze: a muted dusk grey, mid-toned — neither light nor dark, so every fighter reads against it. */
const CROWD_HAZE: RGB = hex('#6e7088');
/** Either side's colours (left: the player's red; right: the boss's blue), the League's. */
const RED: RGB = hex('#e2393a'), BLUE: RGB = hex('#2f6fd8'), GOLD: RGB = hex('#f2c14b'), INK: RGB = hex('#14161f');
const SKIN: RGB[] = [hex('#f5cfa8'), hex('#d9a27a'), hex('#9e6e4c'), hex('#6b4632')];
const HAIR: RGB[] = [hex('#26190f'), hex('#5a3a1e'), hex('#d8b25a'), hex('#1a1a20'), hex('#8c3f1f')];

// ── painting ─────────────────────────────────────────────

/**
 * A bowl of seats and its crowd: rows from its foot up, seats in blocks of colour (red, white, a darker band), people
 * in them in either side's colours — the left half mostly red, the right mostly blue — some with scarves held up,
 * some flags; `frame` moves them (bobbing, arms, flags) and moves the phone flashes on.
 */
function paintBowl(c: Ctx, w: number, h: number, seatW: number, haze: number, seed: number, frame: number): void {
  const hz = (col: RGB, a = 1) => css(mix(col, CROWD_HAZE, haze), a);
  const rowH = seatW * 1.2, rows = Math.max(1, Math.floor(h / rowH)), n = Math.floor(w / seatW);
  // The concrete behind, and the seat blocks' colours.
  c.fillStyle = hz(hex('#3b3f4d')); c.fillRect(0, 0, w, h);
  for (let r = 0; r < rows; r++) {
    const foot = h - r * rowH, y0 = foot - rowH;
    // (Seats: the row's band of colour — red blocks and white, a dark stripe every fourth row.)
    for (let k = 0; k < n; k++) {
      const block = Math.floor(k / 8 + r / 3) % 3;
      const seatCol = r % 4 === 3 ? hex('#2a2d38') : block === 0 ? RED : block === 1 ? hex('#e9eaee') : hex('#c22f32');
      c.fillStyle = hz(seatCol); c.fillRect(k * seatW + 1, foot - rowH * 0.34, seatW - 2, rowH * 0.26);
    }
    // An aisle of steps every so often.
    const rnd = seeded(seed * 131 + r * 7);
    for (let k = 0; k < n; k++) {
      const x = k * seatW + seatW / 2 + (r % 2) * seatW * 0.5;
      const v = Array.from({ length: 9 }, () => rnd());
      if (k % 16 === 15) { c.fillStyle = hz(hex('#565b6b')); c.fillRect(x - seatW * 0.45, y0, seatW * 0.9, rowH); continue; }
      if (v[0] < 0.05) continue;
      // (Which side they cheer for: by where they sit, mostly.)
      const side = (x / w + (v[1] - 0.5) * 0.3) < 0.5 ? RED : BLUE;
      const shirt = v[2] < 0.7 ? side : v[2] < 0.85 ? hex('#f3f3f3') : hex('#2a2a30');
      const skin = SKIN[Math.floor(v[3] * SKIN.length)], hair = HAIR[Math.floor(v[4] * HAIR.length)];
      const halfW = seatW * 0.42, bodyH = rowH * 0.42, headR = seatW * 0.22;
      const bob = (frame + Math.floor(v[5] * 3)) % 3 === 0 ? -rowH * 0.07 : 0;
      const seat = foot - rowH * 0.2, top = seat - bodyH + bob;
      const up = v[6] < 0.08 || ((frame + Math.floor(v[6] * 7)) % 3 === 1 && v[6] < 0.35);
      if (up && v[7] < 0.5) {
        // A scarf held up over the head, in its side's colour.
        c.fillStyle = hz(side); c.fillRect(x - seatW * 0.6, top - rowH * 0.42, seatW * 1.2, rowH * 0.13);
        c.fillStyle = hz(hex('#ffffff')); c.fillRect(x - seatW * 0.6, top - rowH * 0.36, seatW * 1.2, rowH * 0.03);
      } else if (up) {
        c.fillStyle = hz(shirt); c.fillRect(x + halfW * 0.5, top - rowH * 0.36, seatW * 0.15, rowH * 0.42);
      }
      c.fillStyle = hz(shirt);
      c.beginPath(); c.roundRect(x - halfW, top, halfW * 2, bodyH - bob, [halfW * 0.7, halfW * 0.7, 2, 2]); c.fill();
      const hy = top - headR * 0.72;
      c.fillStyle = hz(skin); c.beginPath(); c.arc(x, hy, headR, 0, Math.PI * 2); c.fill();
      c.fillStyle = hz(hair); c.beginPath(); c.ellipse(x, hy - headR * 0.32, headR * 1.04, headR * 0.72, 0, Math.PI, Math.PI * 2); c.fill();
      // A flag on a pole, now and then, its cloth swinging with the frame.
      if (v[8] < 0.035) {
        const sw = frame === 1 ? 1 : frame === 2 ? -0.6 : 0.3;
        c.fillStyle = hz(hex('#cccccc')); c.fillRect(x - 1.5, hy - rowH * 1.4, 3, rowH * 1.4);
        c.fillStyle = hz(side);
        c.beginPath(); c.moveTo(x + 1.5, hy - rowH * 1.4); c.quadraticCurveTo(x + seatW * (1 + sw * 0.3), hy - rowH * (1.3 + sw * 0.1), x + seatW * 1.8, hy - rowH * 1.15);
        c.lineTo(x + 1.5, hy - rowH * 0.75); c.closePath(); c.fill();
      }
      // A phone's flash: a few, moving on with each frame.
      if ((Math.floor(v[5] * 997) + frame * 331) % 61 === 0) glow(c, x + halfW * 0.4, top - rowH * 0.1, seatW * 0.7, hex('#ffffff'), 0.7 * (1 - haze * 0.5));
    }
  }
  // The bowl's own shade toward its foot, and the floodlights' wash over its top.
  const s = c.createLinearGradient(0, 0, 0, h);
  s.addColorStop(0, css(FLOOD, 0.12 * (1 - haze))); s.addColorStop(0.6, 'rgba(0,0,0,0)'); s.addColorStop(1, `rgba(10,10,20,${0.28 * (1 - haze)})`);
  c.fillStyle = s; c.fillRect(0, 0, w, h);
}

/** LED boards: a dark housing, panels of the League's marks, bright as screens (scrolled by drifting the texture). */
function paintAds(c: Ctx, w: number, h: number): void {
  c.fillStyle = css(INK); c.fillRect(0, 0, w, h);
  const panels = 4, pw = w / panels;
  const words = ['POKéMON LEAGUE', 'CHAMPION CUP', 'POKé BALL', 'BATTLE TOWER'];
  for (let i = 0; i < panels; i++) {
    const x = i * pw, bg = i % 2 ? RED : hex('#1c2a6b');
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, css(mix(bg, hex('#ffffff'), 0.15))); g.addColorStop(1, css(bg));
    c.fillStyle = g; c.fillRect(x + 4, h * 0.12, pw - 8, h * 0.76);
    // Its mark: a ball, then the word.
    const r = h * 0.26, cx = x + h * 0.55, cy = h * 0.5;
    c.fillStyle = css(i % 2 ? hex('#ffffff') : RED); c.beginPath(); c.arc(cx, cy, r, Math.PI, Math.PI * 2); c.fill();
    c.fillStyle = css(hex('#ffffff')); c.beginPath(); c.arc(cx, cy, r, 0, Math.PI); c.fill();
    c.fillStyle = css(INK); c.fillRect(cx - r, cy - r * 0.12, r * 2, r * 0.24); c.beginPath(); c.arc(cx, cy, r * 0.32, 0, Math.PI * 2); c.fill();
    c.fillStyle = css(hex('#ffffff')); c.beginPath(); c.arc(cx, cy, r * 0.18, 0, Math.PI * 2); c.fill();
    c.fillStyle = css(i % 2 ? hex('#ffffff') : GOLD);
    c.font = `800 ${Math.round(h * 0.42)}px system-ui, sans-serif`; c.textBaseline = 'middle';
    c.fillText(words[i], cx + r * 1.6, cy + h * 0.02, pw - h * 1.2);
  }
  // The LEDs' grain.
  c.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < h; y += 3) c.fillRect(0, y, w, 1);
}

/** The ribbon board: a thin bright strip along the fascia, chevrons and the battle's call in the League's colours. */
function paintRibbon(c: Ctx, w: number, h: number): void {
  c.fillStyle = css(INK); c.fillRect(0, 0, w, h);
  c.fillStyle = css(hex('#0f1a44')); c.fillRect(0, h * 0.15, w, h * 0.7);
  c.font = `900 ${Math.round(h * 0.55)}px system-ui, sans-serif`; c.textBaseline = 'middle';
  for (let x = 0, i = 0; x < w; i++) {
    if (i % 2 === 0) {
      for (let k = 0; k < 4; k++) {
        c.fillStyle = css(k % 2 ? RED : GOLD);
        c.beginPath(); c.moveTo(x + k * h * 0.5, h * 0.2); c.lineTo(x + k * h * 0.5 + h * 0.3, h * 0.5); c.lineTo(x + k * h * 0.5, h * 0.8); c.lineTo(x + k * h * 0.5 + h * 0.15, h * 0.5); c.closePath(); c.fill();
      }
      x += h * 2.4;
    } else {
      const t = ['BATTLE!', 'GO GO GO!', 'CHAMPION CUP'][i % 3];
      c.fillStyle = css(hex('#ffffff')); c.fillText(t, x, h * 0.53);
      x += c.measureText(t).width + h;
    }
  }
  c.fillStyle = 'rgba(0,0,0,0.2)';
  for (let y = 0; y < h; y += 3) c.fillRect(0, y, w, 1);
}

/** The roof: its canopy's underside, steel trusses, a row of floodlight banks blazing, the canopy's red edge. */
function paintRoof(c: Ctx, w: number, h: number): void {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, css(hex('#1f2230'))); g.addColorStop(1, css(hex('#3a3f52')));
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  // Trusses: a top and a bottom chord, the diagonals between.
  c.strokeStyle = css(hex('#7b8196')); c.lineWidth = 3;
  const top = h * 0.12, bot = h * 0.55, bay = 64;
  c.beginPath(); c.moveTo(0, top); c.lineTo(w, top); c.moveTo(0, bot); c.lineTo(w, bot); c.stroke();
  c.lineWidth = 2;
  for (let x = 0; x < w; x += bay) { c.beginPath(); c.moveTo(x, bot); c.lineTo(x + bay / 2, top); c.lineTo(x + bay, bot); c.moveTo(x, bot); c.lineTo(x, top); c.stroke(); }
  // The floodlight banks, under the truss: each a block of lamps, glowing.
  for (let x = 48; x < w; x += 128) {
    glow(c, x, bot + h * 0.16, h * 0.55, FLOOD, 0.45);
    c.fillStyle = css(hex('#2a2d3a')); c.fillRect(x - 30, bot + h * 0.06, 60, h * 0.2);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      c.fillStyle = css(FLOOD); c.beginPath(); c.arc(x - 21 + i * 14, bot + h * 0.11 + j * h * 0.09, 5, 0, Math.PI * 2); c.fill();
    }
  }
  // The canopy's edge.
  c.fillStyle = css(RED); c.fillRect(0, h * 0.86, w, h * 0.06);
  c.fillStyle = css(hex('#f4f4f4')); c.fillRect(0, h * 0.92, w, h * 0.04);
  c.fillStyle = css(INK); c.fillRect(0, h * 0.96, w, h * 0.04);
}

/** The city beyond: towers in silhouette against the evening, windows lit, a few aircraft lights on their tops. */
function paintCity(c: Ctx, w: number, h: number): void {
  const rnd = seeded(77);
  for (let layer = 0; layer < 2; layer++) {
    const col = layer ? hex('#2c2a44') : mix(hex('#3f3a5a'), HAZE, 0.35);
    for (let x = 0; x < w;) {
      const bw = 20 + rnd() * 50, bh = h * (layer ? 0.2 + rnd() * 0.45 : 0.3 + rnd() * 0.5);
      c.fillStyle = css(col); c.fillRect(x, h - bh, bw, bh);
      if (layer) {
        for (let wy = h - bh + 6; wy < h - 4; wy += 8) for (let wx = x + 4; wx < x + bw - 4; wx += 7) {
          if (rnd() < 0.42) { c.fillStyle = css(rnd() < 0.8 ? hex('#ffd98a') : hex('#bfe4ff'), 0.85); c.fillRect(wx, wy, 3, 4); }
        }
        if (rnd() < 0.3) { c.fillStyle = css(hex('#ff4040')); c.beginPath(); c.arc(x + bw / 2, h - bh - 3, 2, 0, Math.PI * 2); c.fill(); }
      }
      x += bw + rnd() * 6;
    }
  }
}

/** A painted layer (as the colosseum's): a vertical plane `z` back, `y0`→`y1`, its canvas(es) repeating every `tile`, square-pixelled; frames shown by turns. */
function layer(scene: Scene, root: TransformNode, name: string, z: number, y0: number, y1: number, tile: number,
  paints: ((c: Ctx, w: number, h: number) => void)[], alpha: boolean, x = 0, width?: number): { mat: StandardMaterial; frames: DynamicTexture[]; plane: AbstractMesh } {
  const wide = width ?? Math.max(60, (z + 30) * SPAN);
  const pxH = Math.min(2048, Math.round(PX * (y1 - y0) / tile));
  const frames = paints.map((paint, i) => {
    const tex = new DynamicTexture(`${name}Tex${i}`, { width: PX, height: pxH }, scene, true);
    const ctx = tex.getContext() as unknown as Ctx;
    ctx.clearRect(0, 0, PX, pxH);
    paint(ctx, PX, pxH);
    tex.update(true);
    tex.hasAlpha = alpha;
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.uScale = wide / tile;
    return tex;
  });
  const mat = new StandardMaterial(`${name}Mat`, scene);
  mat.diffuseTexture = frames[0]; mat.emissiveTexture = frames[0];
  mat.useAlphaFromDiffuseTexture = alpha;
  mat.disableLighting = true; mat.fogEnabled = false;
  mat.specularColor = new Color3(0, 0, 0);
  const plane = MeshBuilder.CreatePlane(name, { width: wide, height: y1 - y0 }, scene);
  plane.position.set(x, (y0 + y1) / 2, z);
  plane.material = mat; plane.parent = root; plane.isPickable = false;
  return { mat, frames, plane };
}

/** One side as the scoreboard shows it. */
export interface BoardSide { name: string; hp: number; max: number }

export interface LeagueStadium extends Arena {
  /** The scoreboard: both sides' names and HP, the clock (s), and a line under them (a result, a call). */
  scoreboard: { update(left: BoardSide, right: BoardSide, clock: number, line?: string): void };
  /** Who the scoreboard's live feed frames (the two fighters). */
  follow(...nodes: { position: Vector3 }[]): void;
}

/** The League stadium, round the middle: its lawns, a Pokéball on the pitch, and behind them its painted bowl and scoreboard. */
export function leagueStadium(scene: Scene): LeagueStadium {
  const base = grassStadium(scene);
  for (const m of base.root.getChildMeshes(false)) if (!KEEP.test(m.name)) m.setEnabled(false);
  const root = new TransformNode('leagueStadium', scene);

  // The sky, the city, the roof.
  layer(scene, root, 'lgSky', SKY_Z, -20, 160, 320, [(c, w, h) => {
    sky(c, w, h, [[0, hex('#141b3c')], [0.45, hex('#3b3567')], [0.72, hex('#8c5a7e')], [0.9, hex('#e39a6e')], [1, HAZE]]);
    const rnd = seeded(3);
    for (let i = 0; i < 70; i++) { c.fillStyle = css(hex('#ffffff'), 0.4 + rnd() * 0.5); c.fillRect(rnd() * w, rnd() * h * 0.45, 2, 2); }
  }], false);
  layer(scene, root, 'lgCity', CITY_Z, 4, 34, 150, [paintCity], true);
  layer(scene, root, 'lgRoof', ROOF_Z, 15.5, 23.5, 40, [paintRoof], true);

  // The bowls, with their frames.
  const upper = layer(scene, root, 'lgUpper', UPPER.z, UPPER.y0, UPPER.y1, UPPER.tile,
    Array.from({ length: FRAMES }, (_, f) => (c: Ctx, w: number, h: number) => paintBowl(c, w, h, UPPER.seat, UPPER.haze, 21, f)), true);
  const ribbon = layer(scene, root, 'lgRibbon', RIBBON_Z, 6.3, 7.1, 14, [paintRibbon], false);
  const lower = layer(scene, root, 'lgLower', LOWER.z, LOWER.y0, LOWER.y1, LOWER.tile,
    Array.from({ length: FRAMES }, (_, f) => (c: Ctx, w: number, h: number) => paintBowl(c, w, h, LOWER.seat, LOWER.haze, 9, f)), true);
  const ads = layer(scene, root, 'lgAds', ADS_Z, -0.05, 1.15, 12, [paintAds], false);

  // A Pokéball painted round the centre circle (flat on the grass, under the fighters).
  const ballTex = new DynamicTexture('lgPitchBall', { width: 1024, height: 1024 }, scene, true);
  {
    const c = ballTex.getContext() as unknown as Ctx, s = 1024, r = s * 0.47;
    c.clearRect(0, 0, s, s);
    c.strokeStyle = 'rgba(255,255,255,0.92)'; c.lineWidth = 16;
    c.beginPath(); c.arc(s / 2, s / 2, r, 0, Math.PI * 2); c.stroke();
    c.fillStyle = 'rgba(225,50,50,0.38)'; c.beginPath(); c.arc(s / 2, s / 2, r - 8, Math.PI, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.92)'; c.fillRect(s / 2 - r, s / 2 - 22, r * 2, 44);
    c.beginPath(); c.arc(s / 2, s / 2, r * 0.27, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(40,120,40,1)'; c.beginPath(); c.arc(s / 2, s / 2, r * 0.18, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.92)'; c.lineWidth = 10; c.beginPath(); c.arc(s / 2, s / 2, r * 0.12, 0, Math.PI * 2); c.stroke();
    ballTex.hasAlpha = true; ballTex.update(true);
  }
  const ballMat = new StandardMaterial('lgPitchBallMat', scene);
  ballMat.diffuseTexture = ballTex; ballMat.useAlphaFromDiffuseTexture = true; ballMat.specularColor = new Color3(0, 0, 0);
  ballMat.zOffset = -2;
  groundLit(ballMat);
  // (Cut finely, to heave with the pitch under it: groundLight's quakes.)
  const ball = MeshBuilder.CreateGround('lgPitchBall', { width: 11, height: 11, subdivisions: 64 }, scene);
  ball.position.set(0, 0.015, 0); ball.material = ballMat; ball.parent = root; ball.isPickable = false;

  // The scoreboard: its housing, a live feed of the fight in its middle, the board's panels drawn round it.
  const BW = 13.5, BH = 4.9, BY = 12.9;
  const boardTex = new DynamicTexture('lgBoard', { width: 1536, height: 560 }, scene, true);
  boardTex.hasAlpha = true;
  const boardMat = new StandardMaterial('lgBoardMat', scene);
  boardMat.diffuseTexture = boardTex; boardMat.emissiveTexture = boardTex; boardMat.useAlphaFromDiffuseTexture = true;
  boardMat.disableLighting = true; boardMat.fogEnabled = false; boardMat.specularColor = new Color3(0, 0, 0);
  const board = MeshBuilder.CreatePlane('lgBoard', { width: BW, height: BH }, scene);
  board.position.set(0, BY, SCREEN_Z); board.material = boardMat; board.parent = root; board.isPickable = false;
  // (Hung from the roof: two cables.)
  for (const sx of [-BW * 0.35, BW * 0.35]) {
    const cable = MeshBuilder.CreateBox('lgCable', { width: 0.08, height: 3, depth: 0.08 }, scene);
    cable.position.set(sx, BY + BH / 2 + 1.5, SCREEN_Z + 0.05); cable.parent = root; cable.isPickable = false;
    const cm = new StandardMaterial('lgCableMat', scene); cm.disableLighting = true; cm.emissiveColor = new Color3(0.12, 0.13, 0.18); cm.fogEnabled = false; cable.material = cm;
  }
  // The live feed: its own camera, nearer in on the fight, rendering all but the stadium itself.
  // (A depth and a stencil buffer of its own — beam 2's cores show over its outlines by the stencil — and the scene's
  // later groups drawn over the earlier with the depth kept, as the main view does: its beams as they are on the field.)
  const feed = new RenderTargetTexture('lgFeed', { width: 640, height: 360 }, scene, false, true, Constants.TEXTURETYPE_UNSIGNED_INT,
    false, Texture.TRILINEAR_SAMPLINGMODE, true, true);
  for (const g of [1, 2, 3]) feed.setRenderingAutoClearDepthStencil(g, false);
  const feedCam = new FreeCamera('lgFeedCam', new Vector3(0, 3, -10), scene);
  feedCam.fov = 0.42; feedCam.minZ = 0.1; feedCam.maxZ = 300;
  // (Its own 16:9, not the window's shape: else its view is the window's — narrower — stretched onto the screen.)
  feedCam.freezeProjectionMatrix(Matrix.PerspectiveFovLH(feedCam.fov, 16 / 9, feedCam.minZ, feedCam.maxZ, scene.getEngine().isNDCHalfZRange));
  feed.activeCamera = feedCam;
  // (All but the board itself — the fighters, the pitch, the stands behind them.)
  const offFeed = new Set<AbstractMesh>();
  // (Refreshed as it goes — FEED_LIST s — so what comes into the scene after it, the fighters first, is on it too.)
  // (Only what a camera of its layers draws: beam 2 keeps its beam-1 layers off every camera's — layerMask 0 — and they
  // must stay off the screen too, or it shows beam 1.)
  const listFeed = () => { feed.renderList = scene.meshes.filter((m) => !offFeed.has(m) && (m.layerMask & feedCam.layerMask) !== 0); };
  feed.refreshRate = 2;
  scene.customRenderTargets.push(feed);
  const feedMat = new StandardMaterial('lgFeedMat', scene);
  feedMat.diffuseTexture = feed; feedMat.emissiveTexture = feed; feedMat.disableLighting = true; feedMat.fogEnabled = false;
  feedMat.specularColor = new Color3(0, 0, 0);
  const FW = BW * 0.44, FH = FW * 9 / 16;
  const feedPlane = MeshBuilder.CreatePlane('lgFeedScreen', { width: FW, height: FH }, scene);
  feedPlane.position.set(0, BY - BH * 0.04, SCREEN_Z - 0.05); feedPlane.material = feedMat; feedPlane.parent = root; feedPlane.isPickable = false;

  offFeed.add(board); offFeed.add(feedPlane);
  for (const m of root.getChildMeshes(false)) if (m.name === 'lgCable') offFeed.add(m);
  // The broadcast camera's subjects (follow): framed both, close, from a little below their heads.
  let subjects: { position: Vector3 }[] = [];
  listFeed();
  let listedAt = 0;
  const pct = (s: BoardSide) => Math.max(0, Math.min(1, s.hp / Math.max(1, s.max)));
  const drawBoard = (left: BoardSide, right: BoardSide, clock: number, line = '') => {
    const c = boardTex.getContext() as unknown as Ctx, W = 1536, H = 560;
    c.clearRect(0, 0, W, H);
    // The housing.
    c.fillStyle = css(hex('#0c0e16')); c.beginPath(); c.roundRect(0, 0, W, H, 24); c.fill();
    c.fillStyle = css(hex('#1b2030')); c.beginPath(); c.roundRect(10, 10, W - 20, H - 20, 18); c.fill();
    // The header: the League's mark.
    const head = c.createLinearGradient(0, 0, W, 0);
    head.addColorStop(0, css(RED)); head.addColorStop(0.5, css(hex('#b0242a'))); head.addColorStop(1, css(RED));
    c.fillStyle = head; c.fillRect(10, 10, W - 20, 70);
    c.fillStyle = css(hex('#ffffff')); c.font = '900 46px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('POKéMON LEAGUE · CHAMPION CUP', W / 2, 46);
    // Either side's panel: its name, its HP bar and number.
    const panel = (s: BoardSide, x: number, col: RGB, alignRight: boolean) => {
      const pw = 380, top = 110;
      c.fillStyle = css(mix(col, hex('#000000'), 0.55)); c.beginPath(); c.roundRect(x, top, pw, 330, 14); c.fill();
      c.fillStyle = css(col); c.fillRect(x, top, pw, 12);
      c.fillStyle = css(hex('#ffffff')); c.font = '800 40px system-ui, sans-serif'; c.textAlign = alignRight ? 'right' : 'left';
      c.fillText(s.name.toUpperCase(), alignRight ? x + pw - 20 : x + 20, top + 60, pw - 40);
      c.font = '600 26px system-ui, sans-serif'; c.fillStyle = css(hex('#c8cede'));
      c.fillText('HP', alignRight ? x + pw - 20 : x + 20, top + 120);
      const k = pct(s), bx = x + 20, bw = pw - 40, by = top + 140;
      c.fillStyle = css(hex('#0a0c12')); c.beginPath(); c.roundRect(bx, by, bw, 34, 10); c.fill();
      c.fillStyle = css(k > 0.5 ? hex('#4ade80') : k > 0.2 ? hex('#facc15') : hex('#ef4444'));
      const fw = bw * k; c.beginPath(); c.roundRect(alignRight ? bx + bw - fw : bx, by, Math.max(1, fw), 34, 10); c.fill();
      c.fillStyle = css(hex('#ffffff')); c.font = '800 64px system-ui, sans-serif';
      c.fillText(`${Math.ceil(s.hp)}`, alignRight ? x + pw - 20 : x + 20, top + 250);
      c.font = '600 28px system-ui, sans-serif'; c.fillStyle = css(hex('#9aa3bb'));
      c.fillText(`/ ${s.max}`, alignRight ? x + pw - 20 - c.measureText(`${Math.ceil(s.hp)}`).width - 160 : x + 20 + 140, top + 262);
    };
    panel(left, 26, RED, false);
    panel(right, W - 26 - 380, BLUE, true);
    // The clock, and the line under the feed.
    const m = Math.floor(clock / 60), sec = Math.floor(clock % 60);
    c.textAlign = 'center'; c.fillStyle = css(GOLD); c.font = '900 52px system-ui, sans-serif';
    c.fillText(`${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`, W / 2, H - 52);
    if (line) { c.fillStyle = css(hex('#ffffff')); c.font = '800 34px system-ui, sans-serif'; c.fillText(line, W / 2, H - 100); }
    c.textAlign = 'left';
    boardTex.update(true);
  };
  drawBoard({ name: '—', hp: 1, max: 1 }, { name: '—', hp: 1, max: 1 }, 0);

  // The crowd cheering, the boards scrolling, the feed's camera following the fight.
  let t = 0;
  const obs = scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
    t += dt;
    for (const [b, phase] of [[lower, 0], [upper, 1]] as const) {
      const f = b.frames[Math.floor(t / CHEER + phase) % FRAMES];
      if (b.mat.diffuseTexture !== f) { b.mat.diffuseTexture = f; b.mat.emissiveTexture = f; }
    }
    ads.frames[0].uOffset += dt * 0.05;
    ribbon.frames[0].uOffset -= dt * 0.08;
    if (t - listedAt > FEED_LIST) { listedAt = t; listFeed(); }
    // (The feed: both its subjects in frame, close — half their spread plus a margin across its 16:9 view.)
    if (subjects.length) {
      const xs = subjects.map((s) => s.position.x), ys = subjects.map((s) => s.position.y);
      const mid = new Vector3((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2 + 1.1, 0);
      const half = (Math.max(...xs) - Math.min(...xs)) / 2 + FEED_MARGIN;
      const dist = Math.max(FEED_NEAREST, half / (Math.tan(feedCam.fov / 2) * 16 / 9));
      const goal = mid.add(new Vector3(0, 0.4, -dist));
      feedCam.position = Vector3.Lerp(feedCam.position, goal, Math.min(1, dt * 6));
      feedCam.setTarget(mid);
    }
  });

  return {
    root,
    bounds: base.bounds,
    air: base.air,
    scoreboard: { update: drawBoard },
    follow: (...nodes: { position: Vector3 }[]) => { subjects = nodes; },
    dispose: () => {
      scene.onBeforeRenderObservable.remove(obs);
      const i = scene.customRenderTargets.indexOf(feed); if (i >= 0) scene.customRenderTargets.splice(i, 1);
      feed.dispose(); feedCam.dispose();
      for (const b of [upper, lower]) for (const f of b.frames) f.dispose();
      root.getChildMeshes(false).forEach((m) => { const mm = m.material as StandardMaterial | null; mm?.diffuseTexture?.dispose(); mm?.dispose(); });
      root.dispose(); base.dispose?.();
    },
  };
}
