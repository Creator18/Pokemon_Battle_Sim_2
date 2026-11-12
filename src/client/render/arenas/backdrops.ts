/**
 * Backdrops for the side-on levels: flat painted layers, one behind another, each further back and higher — so the
 * camera moving along shifts them against each other, the nearer more (parallax) — painted once on 2D canvases (their
 * patterns repeating along them), unlit and out of the fog, their own haze painted in (the further, the paler). Some
 * drift on their own (clouds, smoke, embers rising, snow falling).
 *
 *   forest     a morning sky and its sun, far blue mountains, green hills, two depths of forest, soft shafts of light
 *   volcano    a smouldering sky, a great volcano (its crater aglow, lava down its sides) under a drifting plume, black
 *              ridges and spires rimmed in its light, embers rising
 *   snowfield  a pale sky and a faint aurora, two ranges of peaks (lit and shadowed sides), snow-capped pines, snow
 *              falling near and far
 *
 * Each also gives its level's platforms their colours (a grass top over earth, ash over basalt, snow over stone).
 */
import type { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';

export type RGB = [number, number, number];
type Ctx = CanvasRenderingContext2D;
export type BackdropName = 'forest' | 'volcano' | 'snowfield';

/** A painted layer: how far back (z), from what height to what (y), how often its pattern repeats along it (world units), how it is painted, whether it is see-through, and how it drifts (tiles per second, across and up). */
interface Layer { name: string; z: number; y0: number; y1: number; tile: number; paint: (c: Ctx, w: number, h: number) => void; alpha: boolean; drift?: [number, number]; vTile?: number }

export interface Backdrop {
  root: TransformNode;
  /** Its platforms' colours: their top (grass, ash, snow) and their body. */
  platform: { top: RGB; body: RGB };
  /** The clear colour behind it all. */
  clear: Color4;
  dispose(): void;
}

/** How wide a layer is, past the level's own width, as a share of its distance (enough to fill the view from anywhere along it). */
const SPAN = 2.6;
/** How far below the ground each scenery layer reaches (so it, not the sky, fills in behind the level's floor). */
const GROUND = -24;
/** Pixels across one tile of a layer. */
const PX = 1024;

export const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
export const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
export const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ── painting ─────────────────────────────────────────────

/** A sky: a vertical gradient through `stops` (0 top → 1 bottom). */
export function sky(c: Ctx, w: number, h: number, stops: [number, RGB][]): void {
  const g = c.createLinearGradient(0, 0, 0, h);
  for (const [t, col] of stops) g.addColorStop(t, css(col));
  c.fillStyle = g; c.fillRect(0, 0, w, h);
}

/** A soft glow (a sun, a fire's light) at (x, y), `r` across, in `col`. */
export function glow(c: Ctx, x: number, y: number, r: number, col: RGB, a = 1): void {
  for (const dx of [-c.canvas.width, 0, c.canvas.width]) {
    const g = c.createRadialGradient(x + dx, y, 0, x + dx, y, r);
    g.addColorStop(0, css(col, a)); g.addColorStop(1, css(col, 0));
    c.fillStyle = g; c.fillRect(x + dx - r, y - r, r * 2, r * 2);
  }
}

/** A ridge line across the canvas (whole waves, so it repeats seamlessly): its height at each x, from `base` (share of h, from the top) rising by up to `amp`. */
export function ridgeAt(w: number, h: number, base: number, amp: number, seed: number, rough = 1): (x: number) => number {
  const rnd = seeded(seed);
  const waves = Array.from({ length: 7 }, (_, i) => ({ f: 1 + Math.floor(rnd() * (2 + i * rough)), p: rnd() * Math.PI * 2, a: (0.5 + rnd()) / (1 + i * 0.6) }));
  const norm = waves.reduce((s, v) => s + v.a, 0);
  return (x) => h * base - h * amp * waves.reduce((s, v) => s + v.a * Math.sin((x / w) * Math.PI * 2 * v.f + v.p), 0) / norm;
}

/** A filled ridge (mountains, hills): `col` below the line, a lighter rim `rim` along its top if given. */
export function ridge(c: Ctx, w: number, h: number, at: (x: number) => number, col: RGB, rim?: RGB, rimW = 3): void {
  c.fillStyle = css(col);
  c.beginPath(); c.moveTo(0, h);
  for (let x = 0; x <= w; x += 4) c.lineTo(x, at(x));
  c.lineTo(w, h); c.closePath(); c.fill();
  if (rim) {
    c.strokeStyle = css(rim); c.lineWidth = rimW;
    c.beginPath();
    for (let x = 0; x <= w; x += 4) x === 0 ? c.moveTo(x, at(x)) : c.lineTo(x, at(x));
    c.stroke();
  }
}

/** Peaks with a lit side and a shadowed one (and snow on their tops, `snow`): `n` across, their tips between `top` and `low` (shares of h). */
function peaks(c: Ctx, w: number, h: number, n: number, top: number, low: number, lit: RGB, shade: RGB, seed: number, snow?: RGB): void {
  const rnd = seeded(seed);
  for (let i = 0; i < n; i++) {
    const cx = (i + 0.2 + rnd() * 0.6) * (w / n), tip = h * (top + rnd() * (low - top)), half = (w / n) * (0.7 + rnd() * 0.6);
    for (const dx of [-w, 0, w]) {
      const x = cx + dx;
      // (Its shadowed right side, then its lit left, each a jagged slope down to the foot.)
      const slope = (side: number) => { const pts: [number, number][] = [[x, tip]]; for (let k = 1; k <= 6; k++) { const t = k / 6; pts.push([x + side * half * t + (rnd() - 0.5) * half * 0.08, tip + (h - tip) * t + (rnd() - 0.5) * h * 0.03]); } return pts; };
      for (const [side, col] of [[1, shade], [-1, lit]] as [number, RGB][]) {
        const pts = slope(side);
        c.fillStyle = css(col);
        c.beginPath(); c.moveTo(x, tip); for (const [px, py] of pts) c.lineTo(px, py); c.lineTo(x, h); c.closePath(); c.fill();
      }
      if (snow) {
        // (A snow cap: the top quarter, ragged at its foot.)
        const capH = (h - tip) * 0.28;
        c.fillStyle = css(snow);
        c.beginPath(); c.moveTo(x, tip);
        for (let k = 0; k <= 8; k++) { const t = k / 8; c.lineTo(x + half * 0.3 * (t * 2 - 1) * 1.0, tip + capH * (0.55 + 0.45 * Math.sin(t * Math.PI * 3 + i)) ); }
        c.closePath(); c.fill();
      }
    }
  }
}

/** A canopy line of round trees (overlapping crowns, `n` across), crowns between `top` and `low` (shares of h), filled down to the foot; trunks if `trunks`. */
function canopy(c: Ctx, w: number, h: number, n: number, top: number, low: number, col: RGB, seed: number, light?: RGB, trunks?: RGB): void {
  const rnd = seeded(seed);
  const crowns = Array.from({ length: n }, (_, i) => ({ x: (i + rnd()) * (w / n), y: h * (top + rnd() * (low - top)), r: (w / n) * (0.7 + rnd() * 0.6) }));
  if (trunks) {
    c.fillStyle = css(trunks);
    for (const t of crowns) for (const dx of [-w, 0, w]) c.fillRect(t.x + dx - t.r * 0.08, t.y, t.r * 0.16, h - t.y);
  }
  c.fillStyle = css(col);
  for (const t of crowns) for (const dx of [-w, 0, w]) {
    for (let k = 0; k < 4; k++) { c.beginPath(); c.arc(t.x + dx + (k - 1.5) * t.r * 0.45, t.y + (k % 2) * t.r * 0.25, t.r * (0.6 + 0.1 * k), 0, Math.PI * 2); c.fill(); }
  }
  c.fillRect(0, h * low + (w / n) * 0.3, w, h);
  if (light) {
    // (Its crowns' lit tops.)
    c.fillStyle = css(light, 0.55);
    for (const t of crowns) for (const dx of [-w, 0, w]) { c.beginPath(); c.arc(t.x + dx - t.r * 0.25, t.y - t.r * 0.25, t.r * 0.45, Math.PI, Math.PI * 1.9); c.fill(); }
  }
}

/** A line of pines (`n` across, tops between `top` and `low`), their snow (if `snow`) on each tier. */
function pines(c: Ctx, w: number, h: number, n: number, top: number, low: number, col: RGB, seed: number, snow?: RGB): void {
  const rnd = seeded(seed);
  for (let i = 0; i < n; i++) {
    const x0 = (i + rnd()) * (w / n), tip = h * (top + rnd() * (low - top)), half = (w / n) * (0.45 + rnd() * 0.35);
    for (const dx of [-w, 0, w]) {
      const x = x0 + dx, tiers = 4;
      for (let k = 0; k < tiers; k++) {
        const t0 = tip + (h - tip) * (k / tiers) * 0.8, t1 = tip + (h - tip) * ((k + 1.4) / tiers) * 0.8, hw = half * ((k + 1) / tiers);
        c.fillStyle = css(col);
        c.beginPath(); c.moveTo(x, t0); c.lineTo(x + hw, t1); c.lineTo(x - hw, t1); c.closePath(); c.fill();
        if (snow) { c.fillStyle = css(snow); c.beginPath(); c.moveTo(x, t0); c.lineTo(x + hw * 0.55, t0 + (t1 - t0) * 0.45); c.lineTo(x - hw * 0.55, t0 + (t1 - t0) * 0.5); c.closePath(); c.fill(); }
      }
      c.fillStyle = css(mix(col, [0, 0, 0], 0.3)); c.fillRect(x - half * 0.06, tip + (h - tip) * 0.85, half * 0.12, h);
    }
  }
}

/** Soft clouds (`n` of them) between `top` and `low` (shares of h). */
export function clouds(c: Ctx, w: number, h: number, n: number, top: number, low: number, col: RGB, a: number, seed: number): void {
  const rnd = seeded(seed);
  for (let i = 0; i < n; i++) {
    const cx = rnd() * w, cy = h * (top + rnd() * (low - top)), s = h * (0.05 + rnd() * 0.07);
    for (const dx of [-w, 0, w]) {
      c.fillStyle = css(col, a);
      for (let k = 0; k < 6; k++) { c.beginPath(); c.ellipse(cx + dx + (k - 2.5) * s * 0.9, cy + Math.abs(k - 2.5) * s * 0.12, s * (1.3 - Math.abs(k - 2.5) * 0.18), s * 0.6, 0, 0, Math.PI * 2); c.fill(); }
    }
  }
}

/** Specks (snow, embers, motes): `n` dots of radius `r` (px, ± half), in `col`, scattered over the whole canvas. */
export function specks(c: Ctx, w: number, h: number, n: number, r: number, col: RGB, a: number, seed: number, glowing = false): void {
  const rnd = seeded(seed);
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = rnd() * h, rr = r * (0.5 + rnd());
    if (glowing) glow(c, x, y, rr * 3, col, a * 0.5);
    c.fillStyle = css(col, a * (0.6 + 0.4 * rnd()));
    c.beginPath(); c.arc(x, y, rr, 0, Math.PI * 2); c.fill();
  }
}

/** Shafts of light slanting down from above (`n`, `a` their strength). */
function shafts(c: Ctx, w: number, h: number, n: number, col: RGB, a: number, seed: number): void {
  const rnd = seeded(seed);
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, bw = w * (0.03 + rnd() * 0.05), lean = w * 0.12;
    for (const dx of [-w, 0, w]) {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, css(col, a)); g.addColorStop(1, css(col, 0));
      c.fillStyle = g;
      c.beginPath(); c.moveTo(x + dx, 0); c.lineTo(x + dx + bw, 0); c.lineTo(x + dx + bw + lean, h); c.lineTo(x + dx + lean - bw * 0.5, h); c.closePath(); c.fill();
    }
  }
}

// ── the themes ─────────────────────────────────────────────

function forest(): { layers: Layer[]; platform: { top: RGB; body: RGB }; clear: RGB } {
  const haze = hex('#dfeadf');
  return {
    clear: hex('#cfe4ef'), platform: { top: hex('#5aa838'), body: hex('#6b4a2e') },
    layers: [
      { name: 'forestSky', z: 200, y0: -30, y1: 160, tile: 400, alpha: false, paint: (c, w, h) => {
        sky(c, w, h, [[0, hex('#6fa8dc')], [0.55, hex('#b9d8ec')], [0.85, hex('#e9efdc')], [1, haze]]);
        glow(c, w * 0.72, h * 0.42, h * 0.32, hex('#fff6d6'), 0.85); glow(c, w * 0.72, h * 0.42, h * 0.06, hex('#ffffff'), 1);
      } },
      { name: 'forestClouds', z: 180, y0: 20, y1: 90, tile: 300, alpha: true, drift: [0.004, 0], paint: (c, w, h) => clouds(c, w, h, 7, 0.2, 0.7, hex('#ffffff'), 0.8, 4) },
      { name: 'forestMountains', z: 140, y0: GROUND, y1: 44, tile: 220, alpha: true, paint: (c, w, h) => {
        ridge(c, w, h, ridgeAt(w, h, 0.42, 0.34, 7, 1.2), mix(hex('#5f82a8'), haze, 0.55));
        ridge(c, w, h, ridgeAt(w, h, 0.62, 0.22, 13, 1.4), mix(hex('#557a96'), haze, 0.4));
      } },
      { name: 'forestHills', z: 85, y0: GROUND, y1: 20, tile: 120, alpha: true, paint: (c, w, h) => {
        ridge(c, w, h, ridgeAt(w, h, 0.5, 0.3, 21, 0.7), mix(hex('#4f8a4a'), haze, 0.35), mix(hex('#86b864'), haze, 0.3), 4);
      } },
      { name: 'forestFar', z: 48, y0: GROUND, y1: 14, tile: 60, alpha: true, paint: (c, w, h) => canopy(c, w, h, 14, 0.25, 0.42, mix(hex('#3a7a44'), haze, 0.38), 31, mix(hex('#7cbc62'), haze, 0.3)) },
      { name: 'forestNear', z: 26, y0: GROUND, y1: 10, tile: 40, alpha: true, paint: (c, w, h) => canopy(c, w, h, 6, 0.3, 0.5, mix(hex('#2e6a36'), haze, 0.12), 41, hex('#6aa850'), hex('#5a4030')) },
      { name: 'forestShafts', z: 20, y0: 0, y1: 18, tile: 40, alpha: true, paint: (c, w, h) => shafts(c, w, h, 4, hex('#fff8dc'), 0.18, 5) },
    ],
  };
}

function volcano(): { layers: Layer[]; platform: { top: RGB; body: RGB }; clear: RGB } {
  const haze = hex('#6a2f2a');
  return {
    clear: hex('#3a1a1e'), platform: { top: hex('#4a3a36'), body: hex('#2a1f1e') },
    layers: [
      { name: 'volcanoSky', z: 200, y0: -30, y1: 160, tile: 400, alpha: false, paint: (c, w, h) => {
        sky(c, w, h, [[0, hex('#1c0d18')], [0.45, hex('#4a1c22')], [0.78, hex('#a8401f')], [1, hex('#d8722c')]]);
        specks(c, w, h * 0.4, 60, 1.2, hex('#ffd9b0'), 0.5, 3);
      } },
      { name: 'volcanoCone', z: 160, y0: GROUND, y1: 70, tile: 260, alpha: true, paint: (c, w, h) => {
        // One great cone, its crater aglow, lava runs down its sides.
        const cx = w * 0.5, top = h * 0.28, half = w * 0.42, crater = w * 0.05;
        glow(c, cx, top, h * 0.35, hex('#ff7a2a'), 0.55);
        c.fillStyle = css(hex('#2a1418'));
        c.beginPath(); c.moveTo(cx - crater, top); c.lineTo(cx + crater, top); c.lineTo(cx + half, h); c.lineTo(cx - half, h); c.closePath(); c.fill();
        c.fillStyle = css(hex('#3a1c1e'));
        c.beginPath(); c.moveTo(cx - crater, top); c.lineTo(cx - crater * 0.2, top); c.lineTo(cx - half * 0.35, h); c.lineTo(cx - half, h); c.closePath(); c.fill();
        c.strokeStyle = css(hex('#ff9a3a')); c.lineCap = 'round';
        const rnd = seeded(9);
        for (let k = 0; k < 6; k++) {
          c.lineWidth = 3 + rnd() * 4;
          let x = cx + (rnd() - 0.5) * crater * 1.6, y = top;
          c.beginPath(); c.moveTo(x, y);
          for (let s = 0; s < 14; s++) { y += (h - top) / 18; x += (x - cx) * 0.06 + (rnd() - 0.5) * 10; c.lineTo(x, y); }
          c.stroke();
        }
        glow(c, cx, top, crater * 2.2, hex('#ffd36a'), 0.9);
      } },
      { name: 'volcanoPlume', z: 150, y0: 30, y1: 110, tile: 260, alpha: true, drift: [0.006, 0], paint: (c, w, h) => {
        const rnd = seeded(17);
        for (let k = 0; k < 40; k++) {
          const t = k / 40, x = w * 0.5 + Math.sin(t * 5) * w * 0.05 + t * w * 0.25, y = h * (0.95 - t * 0.85), r = h * (0.05 + t * 0.12);
          c.fillStyle = css(mix(hex('#3a2a2c'), hex('#6a4a44'), rnd()), 0.35);
          c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
        }
      } },
      { name: 'volcanoRidges', z: 70, y0: GROUND, y1: 18, tile: 110, alpha: true, paint: (c, w, h) => {
        ridge(c, w, h, ridgeAt(w, h, 0.45, 0.35, 23, 1.6), mix(hex('#1e1416'), haze, 0.25), hex('#d8602c'), 3);
        ridge(c, w, h, ridgeAt(w, h, 0.7, 0.2, 29, 2), hex('#181012'), hex('#a84a24'), 2);
      } },
      { name: 'volcanoSpires', z: 26, y0: GROUND, y1: 14, tile: 46, alpha: true, paint: (c, w, h) => {
        const rnd = seeded(37);
        for (let i = 0; i < 5; i++) {
          const x0 = (i + rnd()) * (w / 5), tip = h * (0.15 + rnd() * 0.45), half = (w / 5) * (0.12 + rnd() * 0.12);
          for (const dx of [-w, 0, w]) {
            const x = x0 + dx;
            c.fillStyle = css(hex('#120c0d'));
            c.beginPath(); c.moveTo(x - half * 0.2, tip); c.lineTo(x + half * 0.3, tip + h * 0.04); c.lineTo(x + half, h); c.lineTo(x - half, h); c.closePath(); c.fill();
            // (Rimmed in the volcano's light on its far side, a crack aglow.)
            c.strokeStyle = css(hex('#e0682c'), 0.9); c.lineWidth = 3;
            c.beginPath(); c.moveTo(x - half * 0.2, tip); c.lineTo(x - half, h); c.stroke();
            c.strokeStyle = css(hex('#ffb04a'), 0.7); c.lineWidth = 2;
            c.beginPath(); c.moveTo(x, tip + (h - tip) * 0.3); c.lineTo(x + half * 0.2, tip + (h - tip) * 0.55); c.lineTo(x - half * 0.1, tip + (h - tip) * 0.8); c.stroke();
          }
        }
      } },
      { name: 'volcanoEmbers', z: 14, y0: -1, y1: 15, tile: 18, vTile: 16, alpha: true, drift: [0.02, -0.12], paint: (c, w, h) => specks(c, w, h, 26, 2.2, hex('#ffb04a'), 0.9, 47, true) },
    ],
  };
}

function snowfield(): { layers: Layer[]; platform: { top: RGB; body: RGB }; clear: RGB } {
  const haze = hex('#e4ecf4');
  return {
    clear: hex('#dde7f1'), platform: { top: hex('#f2f6fa'), body: hex('#7d8ea3') },
    layers: [
      { name: 'snowSky', z: 200, y0: -30, y1: 160, tile: 400, alpha: false, paint: (c, w, h) => {
        sky(c, w, h, [[0, hex('#5f7fae')], [0.5, hex('#a9c0dc')], [0.85, hex('#e2eaf3')], [1, haze]]);
        // A faint aurora, high up.
        for (let k = 0; k < 3; k++) {
          c.strokeStyle = css(k === 1 ? hex('#a6f0d0') : hex('#9fd8f0'), 0.18); c.lineWidth = h * 0.04;
          c.beginPath();
          for (let x = 0; x <= w; x += 8) { const y = h * (0.16 + k * 0.05) + Math.sin((x / w) * Math.PI * 4 + k) * h * 0.03; x === 0 ? c.moveTo(x, y) : c.lineTo(x, y); }
          c.stroke();
        }
      } },
      { name: 'snowPeaksFar', z: 150, y0: GROUND, y1: 50, tile: 200, alpha: true, paint: (c, w, h) => peaks(c, w, h, 5, 0.12, 0.45, mix(hex('#c8d6e8'), haze, 0.4), mix(hex('#8ea4c2'), haze, 0.45), 5, mix(hex('#ffffff'), haze, 0.2)) },
      { name: 'snowPeaksNear', z: 80, y0: GROUND, y1: 26, tile: 110, alpha: true, paint: (c, w, h) => peaks(c, w, h, 4, 0.18, 0.5, hex('#dfe8f2'), hex('#8a9fbd'), 11, hex('#ffffff')) },
      { name: 'snowFlakesFar', z: 60, y0: -4, y1: 40, tile: 40, vTile: 40, alpha: true, drift: [0.004, 0.05], paint: (c, w, h) => specks(c, w, h, 120, 2, hex('#ffffff'), 0.8, 19) },
      { name: 'snowPines', z: 34, y0: GROUND, y1: 12, tile: 44, alpha: true, paint: (c, w, h) => pines(c, w, h, 9, 0.1, 0.5, hex('#2f4f4a'), 23, hex('#f4f8fb')) },
      { name: 'snowFlakesNear', z: 14, y0: -2, y1: 16, tile: 18, vTile: 18, alpha: true, drift: [0.01, 0.16], paint: (c, w, h) => specks(c, w, h, 40, 3.2, hex('#ffffff'), 0.95, 29) },
    ],
  };
}

const THEMES: Record<BackdropName, () => { layers: Layer[]; platform: { top: RGB; body: RGB }; clear: RGB }> = { forest, volcano, snowfield };
export const BACKDROPS = Object.keys(THEMES) as BackdropName[];

/**
 * A backdrop behind a level: its layers (each wide enough for the whole level, `x0` to `x1`, and its view from either
 * end), and their drift each frame.
 */
export function backdrop(scene: Scene, name: BackdropName, x0 = -20, x1 = 20): Backdrop {
  const theme = THEMES[name]();
  const root = new TransformNode(`backdrop_${name}`, scene);
  const mid = (x0 + x1) / 2, levelW = x1 - x0;
  const drifting: { tex: Texture; drift: [number, number] }[] = [];
  for (const l of theme.layers) {
    const width = levelW + (l.z + 30) * SPAN;
    const height = l.y1 - l.y0;
    const pxH = Math.min(2048, Math.round(PX * (l.vTile ?? height) / l.tile));
    const tex = new DynamicTexture(`${l.name}Tex`, { width: PX, height: pxH }, scene, true);
    const ctx = tex.getContext() as unknown as Ctx;
    ctx.clearRect(0, 0, PX, pxH);
    if (l.y0 === GROUND && l.y1 > 0) {
      // (Reaching below the ground: painted in its part above it, its foot drawn on down to its bottom.)
      const above = Math.round(pxH * l.y1 / height);
      l.paint(ctx, PX, above);
      ctx.drawImage(ctx.canvas, 0, above - 2, PX, 2, 0, above - 1, PX, pxH - above + 1);
    } else l.paint(ctx, PX, pxH);
    tex.update(true);
    tex.hasAlpha = l.alpha;
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.uScale = width / l.tile;
    if (l.vTile) { tex.wrapV = Texture.WRAP_ADDRESSMODE; tex.vScale = height / l.vTile; }
    const mat = new StandardMaterial(`${l.name}Mat`, scene);
    mat.diffuseTexture = tex; mat.emissiveTexture = tex;
    mat.useAlphaFromDiffuseTexture = l.alpha;
    mat.disableLighting = true; mat.fogEnabled = false;
    mat.specularColor = new Color3(0, 0, 0);
    const plane = MeshBuilder.CreatePlane(l.name, { width, height }, scene);
    plane.position.set(mid, (l.y0 + l.y1) / 2, l.z);
    plane.material = mat; plane.parent = root; plane.isPickable = false;
    if (l.drift) drifting.push({ tex, drift: l.drift });
  }
  const obs = drifting.length ? scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
    for (const d of drifting) { d.tex.uOffset += d.drift[0] * dt; d.tex.vOffset += d.drift[1] * dt; }
  }) : null;
  return {
    root, platform: theme.platform, clear: new Color4(...theme.clear, 1),
    dispose: () => {
      if (obs) scene.onBeforeRenderObservable.remove(obs);
      for (const m of root.getChildMeshes(false)) { (m.material as StandardMaterial | null)?.diffuseTexture?.dispose(); m.material?.dispose(); }
      root.dispose();
    },
  };
}
