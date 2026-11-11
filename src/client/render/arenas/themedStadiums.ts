/**
 * Poke2D Arena's other five stages, low-poly, each round the grass
 * stadium's play (stadiumKit): a forest clearing, a seaside beach, a
 * volcanic floor over lava, an ice rink in the snow, and old ruins. Their
 * pictures are gone with the game: each is built from its name and the
 * backdrop it had (forest #143018, seaside #1a3a48, volcanic #3a140c).
 */
import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Kit, INNER_W, INNER_D, STADIUM_SCALE, c3, rng, type Arena } from './stadiumKit.ts';
import { grassFur } from './grassFur.ts';
import { softGrass } from './softGrass.ts';
import { waterSurface } from '../../vfx/WaterCoat.ts';
import { floorDetail } from './floorDetail.ts';
import { MirrorTexture } from '@babylonjs/core/Materials/Textures/mirrorTexture';
import { Plane } from '@babylonjs/core/Maths/math.plane';

/** The floor, in the world: how wide and deep (m), for its detail's tiling. */
const FLOOR_W = INNER_W * 2 * STADIUM_SCALE, FLOOR_D = INNER_D * 2 * STADIUM_SCALE;
/** The ice's reflection: its texels, and how strongly it shows. */
const ICE_MIRROR = 1024, ICE_SHINE = 0.4;

type Paint = CanvasRenderingContext2D;

/** Soft blotches of `colors` over a canvas `w` × `h`. */
function blotches(g: Paint, w: number, h: number, n: number, r: [number, number], colors: string[], alpha: number, seed: number): void {
  const rnd = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = rnd() * h, rr = r[0] + rnd() * (r[1] - r[0]);
    const grad = g.createRadialGradient(x, y, 0, x, y, rr);
    // (Faded to its own colour, see-through: faded to clear black, its edge would ring dark.)
    const [cr, cg, cb] = c3(colors[Math.floor(rnd() * colors.length)]).asArray().map((v) => Math.round(v * 255));
    grad.addColorStop(0, `rgba(${cr},${cg},${cb},1)`); grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    g.globalAlpha = alpha; g.fillStyle = grad; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  g.globalAlpha = 1;
}

/** A meandering crack from (x, y): `steps` jagged strokes, forking now and then. */
function crack(g: Paint, x: number, y: number, len: number, steps: number, rnd: () => number, width: number, depth = 0): void {
  let a = rnd() * Math.PI * 2;
  g.lineWidth = width; g.beginPath(); g.moveTo(x, y);
  for (let i = 0; i < steps; i++) {
    a += (rnd() - 0.5) * 1.1;
    x += Math.cos(a) * len; y += Math.sin(a) * len;
    g.lineTo(x, y);
    if (depth < 2 && rnd() < 0.18) { g.stroke(); crack(g, x, y, len * 0.8, Math.floor(steps / 2), rnd, width * 0.6, depth + 1); g.lineWidth = width; g.beginPath(); g.moveTo(x, y); }
  }
  g.stroke();
}

/** 1 in the play, easing to 0 over its last `m` metres before the curb (reliefs settle flat at their edges). */
const settle = (x: number, z: number, m = 1.2) => Math.max(0, Math.min(1, (INNER_W - Math.abs(x)) / m, (INNER_D - Math.abs(z)) / m));

/** The forest floor: low mounds and hollows (m). */
const forestGround = (x: number, z: number) => settle(x, z, 2) * (0.07 * Math.sin(x * 0.55 + 1.3) * Math.cos(z * 0.7 - 0.4) + 0.04 * Math.sin(x * 1.3 + z * 1.1) + 0.11);

/** The beach: wind ripples (crests across the wind) over gentle dunes (m). */
const sandGround = (x: number, z: number) => settle(x, z) * (0.024 * Math.sin((x * 0.96 + z * 0.28) * 14 + 3.2 * Math.sin(z * 0.6 + x * 0.15))
  + 0.09 * Math.sin(x * 0.32 + z * 0.21) * Math.cos(z * 0.45 - 0.8) + 0.05);

/** The volcanic crust: plates (a jittered grid of seeds, a metre or so apart), each raised and a little domed, seams sunk between (m). */
const crustGround = (() => {
  const cell = 1.15, rnd = rng(77), seeds = new Map<string, [number, number, number]>();
  const seed = (i: number, j: number) => {
    const key = `${i},${j}`;
    let v = seeds.get(key);
    if (!v) { v = [(i + 0.15 + rnd() * 0.7) * cell, (j + 0.15 + rnd() * 0.7) * cell, 0.045 + rnd() * 0.04]; seeds.set(key, v); }
    return v;
  };
  return (x: number, z: number) => {
    const ci = Math.floor(x / cell), cj = Math.floor(z / cell);
    let d1 = 1e9, d2 = 1e9, top = 0;
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      const [sx, sz, h] = seed(i, j), d = Math.hypot(x - sx, z - sz);
      if (d < d1) { d2 = d1; d1 = d; top = h; } else if (d < d2) d2 = d;
    }
    const edge = d2 - d1;
    // Domed to its middle; sunk at its seam, below the glow beneath.
    const plate = top - 0.025 * Math.min(1, d1 / cell);
    return edge < 0.07 ? -0.05 : edge < 0.14 ? -0.05 + (plate + 0.05) * ((edge - 0.07) / 0.07) : plate;
  };
})();

/** Inside the play (the floor's relief is only there)? */
const inPlay = (x: number, z: number) => Math.abs(x) <= INNER_W && Math.abs(z) <= INNER_D;
/** Stood on a crust, its feet on the plates either side of a seam, not down in it: the highest of it round (x, z). */
const onCrust = (x: number, z: number) => {
  let top = -1;
  for (const [dx, dz] of [[0, 0], [0.18, 0], [-0.18, 0], [0, 0.18], [0, -0.18]]) top = Math.max(top, crustGround(x + dx, z + dz));
  return Math.max(0, top);
};

/** Keep the ends' middles clear (where an entrance would be). */
const clearEnds = (x: number, z: number) => Math.abs(x) < 4 && Math.abs(z) > INNER_D;

// ── the forest: a mossy clearing, a log fence, dark pines thick round it ──
export function forestStadium(scene: Scene, at = Vector3.Zero()): Arena {
  const k = new Kit(scene, 'forestStadium', at);
  const meadow = k.flat('#2f5a24');
  k.ground(90, 70, meadow, -0.01);
  const { mesh, mat } = k.floor((g, X, Z, px) => {
    g.fillStyle = "#4a8a33"; g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    blotches(g, g.canvas.width, g.canvas.height, 90, [0.6 * px, 2.4 * px], ['#6b5232', '#7a6040', '#4d8a34', '#2f6224'], 0.45, 4);
    // A worn path across it, end to end.
    g.globalAlpha = 0.35; g.fillStyle = '#7a6040'; g.fillRect(X(-0.9), 0, 1.8 * px, g.canvas.height); g.globalAlpha = 1;
  }, 'rgba(236,232,206,0.8)', { height: forestGround, segs: 3, smooth: true });
  k.owned.push(softGrass(scene, mat, FLOOR_W, FLOOR_D, 7));
  // Its grass: taller than the stadium's, and uneven — in clumps, rising and dipping with the ground.
  k.owned.push(grassFur(scene, mesh, mat, FLOOR_W, FLOOR_D, STADIUM_SCALE, 17, { height: 0.13, clump: 0.75, tile: 2.2 }));
  // A fence of logs, lying end to end on low stumps.
  k.curb('#6e4a2c', '#8a6440', 0.38, 0.42, 1.6);
  // The wood: dark pines, rows deep, taller the further out.
  k.trees(k.ring(1.6, 5, 1.7, 3, [1.4, 2.6], clearEnds), '#4a321e', '#2d5e26', 31, 0.03);
  const rnd = rng(8);
  for (let i = 0; i < 26; i++) {
    const sx = rnd() < 0.5 ? -1 : 1, sz = rnd() < 0.5 ? -1 : 1;
    const x = sx * (INNER_W + 0.8 + rnd() * 1.2), z = sz * rnd() * (INNER_D + 1);
    const pick = rnd();
    if (pick < 0.35) { // a stump
      const s = k.column(0.28 + rnd() * 0.15, 0.25 + rnd() * 0.2, '#6b4a2e', x, 0, z, 7);
      s.rotation.y = rnd() * 3;
    } else if (pick < 0.7) { // a toadstool: its stalk, its red cap, its spots
      const h = 0.18 + rnd() * 0.14;
      k.column(0.05, h, '#efe9d8', x, 0, z, 6);
      k.rock(0.16 + rnd() * 0.06, '#c0392b', x, h - 0.06, z, i + 50, 0.45);
    } else k.rock(0.3 + rnd() * 0.4, '#5f6b55', x, 0, z, i + 90, 0.6); // a mossy rock
  }
  return k.arena('#35523a', [30, 95], undefined, { height: (x, z) => (inPlay(x, z) ? forestGround(x, z) : 0) });
}

// ── the seaside: a sand pitch on a beach, the sea all round, palms ──
export function seasideStadium(scene: Scene, at = Vector3.Zero()): Arena {
  const k = new Kit(scene, 'seasideStadium', at);
  // The sea: the battles' cel water, out to the fog.
  const sea = waterSurface(scene, 40, [0.2, 0.55, 0.75], true);
  k.owned.push(sea);
  k.ground(140, 110, sea, -0.12);
  // The beach: a wide bank of sand round the play, a little up out of the water.
  const sandMat = k.flat('#e8d4a0');
  k.ground(INNER_W * 2 + 14, INNER_D * 2 + 12, sandMat, -0.02);
  for (const [w, d] of [[INNER_W * 2 + 17, INNER_D * 2 + 15], [INNER_W * 2 + 20, INNER_D * 2 + 18]]) {
    // (Its wet edge, darker, stepping down into the sea.)
    k.ground(w, d, k.flat(w > INNER_W * 2 + 18 ? '#bfa774' : '#d6bf88'), w > INNER_W * 2 + 18 ? -0.08 : -0.05);
  }
  const sand = k.floor((g, X, Z, px) => {
    g.fillStyle = '#f7e9c6'; g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    blotches(g, g.canvas.width, g.canvas.height, 140, [0.6 * px, 2.4 * px], ['#e8d19c', '#f6e8c4', '#e2c993'], 0.16, 12);
    // Ripples blown into it.
    const rnd = rng(5);
    g.strokeStyle = 'rgba(190,160,110,0.35)'; g.lineWidth = 0.05 * px;
    for (let i = 0; i < 160; i++) { const x = rnd() * g.canvas.width, y = rnd() * g.canvas.height, l = (0.6 + rnd()) * px; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l / 2, y - 0.12 * px, x + l, y); g.stroke(); }
  }, 'rgba(255,255,255,0.85)', { height: sandGround, segs: 12, smooth: true });
  k.owned.push(floorDetail(scene, sand.mat, FLOOR_W, FLOOR_D, 'sand', 3));
  // Pebbles and shells lying in it, here and there (none in the middle of the play).
  {
    const rnd = rng(88);
    for (let i = 0; i < 70; i++) {
      const x = (rnd() - 0.5) * INNER_W * 2 * 0.96, z = (rnd() - 0.5) * INNER_D * 2 * 0.94;
      if (Math.abs(x) < 3 && Math.abs(z) < 3) continue;
      const y = sandGround(x, z) - 0.01;
      if (rnd() < 0.6) k.rock(0.03 + rnd() * 0.05, rnd() < 0.5 ? '#9c958a' : '#c4b9a6', x, y, z, 900 + i, 0.55);
      else { const sh = k.shard(0.06 + rnd() * 0.03, 0.03, rnd() < 0.5 ? '#f3d9cf' : '#fbf3e6', x, y, z, 0, rnd() * 6, 0.05, 7); sh.scaling.z = 0.8; }
    }
  }
  // A curb of pale driftwood planks, open at each end.
  k.curb('#b58f62', '#cfae84', 0.34, 0.4, 1.8);
  // Palms round it: a leaning trunk in rings, a crown of fronds.
  const rnd = rng(21);
  const palm = (x: number, z: number) => {
    const lean = (rnd() - 0.5) * 0.5, h = 3 + rnd() * 1.6, ry = rnd() * Math.PI * 2;
    const segs = 6;
    for (let i = 0; i < segs; i++) {
      const y = (h * i) / segs;
      const c = k.column(0.16 - i * 0.012, h / segs + 0.02, i % 2 ? '#8a6a44' : '#9c7a50', x + Math.sin(ry) * lean * y, y, z + Math.cos(ry) * lean * y, 6, 0.15 - i * 0.012);
      c.rotation.set(Math.cos(ry) * lean, 0, -Math.sin(ry) * lean);
    }
    const tx = x + Math.sin(ry) * lean * h, tz = z + Math.cos(ry) * lean * h;
    for (let f = 0; f < 7; f++) {
      const a = (f / 7) * Math.PI * 2 + rnd() * 0.4;
      const fr = k.shard(0.22, 1.9, f % 2 ? '#3f8f3a' : '#4fa244', tx, h - 0.15, tz, 0, 0, 0.05, 4);
      fr.scaling.set(1, 1, 0.25);
      fr.rotation.set(Math.PI / 2 + 0.55, a, 0);
      fr.position.set(tx + Math.sin(a) * 0.8, h - 0.1, tz + Math.cos(a) * 0.8);
    }
  };
  for (const [x, z] of k.ring(2.5, 2, 3.4, 9, [1, 1]).map(([x, z]) => [x, z])) if (!clearEnds(x, z)) palm(x, z);
  // Beach umbrellas and rocks between them; a pier out from the south.
  for (let i = 0; i < 6; i++) {
    const sx = i % 2 ? 1 : -1, x = sx * (INNER_W + 1.6), z = -INNER_D + 1.5 + (i >> 1) * (INNER_D - 1.5);
    k.column(0.03, 1.5, '#f2f2f2', x, 0, z, 5);
    const top = k.shard(0.95, 0.4, i % 3 === 0 ? '#e74c3c' : i % 3 === 1 ? '#f1c40f' : '#3498db', x, 1.35, z, 0, 0, 0.05, 8);
    top.rotation.y = i;
  }
  for (let i = 0; i < 14; i++) k.rock(0.25 + rnd() * 0.5, '#8d8f8a', (rnd() < 0.5 ? -1 : 1) * (INNER_W + 4 + rnd() * 3), 0, (rnd() - 0.5) * INNER_D * 2.4, i + 300, 0.6);
  for (let i = 0; i < 9; i++) k.box(2.6, 0.12, 0.5, i % 2 ? '#a07a52' : '#b58f62', 0, 0.02, INNER_D + 0.6 + i * 0.52);
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) k.column(0.09, 0.9, '#7a5a3a', sx * 1.25, -0.6, INNER_D + 1 + i * 1.8, 6);
  return k.arena('#a9dcea', [50, 130], undefined, { height: (x, z) => (inPlay(x, z) ? sandGround(x, z) : 0), footprints: '#b89c66' });
}

// ── the volcano: a basalt floor cracked with fire, a lava sea, spires of black rock ──
export function volcanicStadium(scene: Scene, at = Vector3.Zero()): Arena {
  const k = new Kit(scene, 'volcanicStadium', at);
  // The lava: glowing, its crust drifting slowly.
  const lavaTex = new DynamicTexture('lava', { width: 512, height: 512 }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  {
    const g = lavaTex.getContext() as unknown as Paint;
    g.fillStyle = '#ff6a14'; g.fillRect(0, 0, 512, 512);
    blotches(g, 512, 512, 70, [20, 70], ['#ffb02e', '#ff3d0a', '#ffd25a'], 0.6, 3);
    const rnd = rng(17);
    g.strokeStyle = 'rgba(60,18,8,0.85)';
    for (let i = 0; i < 26; i++) crack(g, rnd() * 512, rnd() * 512, 14, 12, rnd, 9);
    lavaTex.update();
  }
  lavaTex.wrapU = lavaTex.wrapV = Texture.WRAP_ADDRESSMODE;
  lavaTex.uScale = 10; lavaTex.vScale = 8;
  const lava = new StandardMaterial('lavaMat', scene);
  lava.diffuseColor = Color3.Black(); lava.specularColor = Color3.Black();
  lava.emissiveTexture = lavaTex; lava.disableLighting = true;
  k.owned.push(lavaTex, lava);
  k.ground(140, 110, lava, -0.3);
  // A shelf of black rock round the play, above the lava.
  k.ground(INNER_W * 2 + 8, INNER_D * 2 + 7, k.flat('#2b2422'), -0.02);
  // The floor: a crust of basalt plates, raised, their seams sunk to the fire glowing beneath them.
  const { mat } = k.floor((g, X, Z, px) => {
    g.fillStyle = '#3d3431'; g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    blotches(g, g.canvas.width, g.canvas.height, 120, [0.5 * px, 2 * px], ['#2c2523', '#4a3e3a', '#55332a'], 0.5, 9);
  }, 'rgba(255,170,90,0.8)', { height: crustGround, segs: 9 });
  k.owned.push(floorDetail(scene, mat, FLOOR_W, FLOOR_D, 'crust', 5));
  const under = k.ground(INNER_W * 2, INNER_D * 2, k.flat('#ff6a1a', 1), 0.0);
  (under.material as StandardMaterial).disableLighting = true;
  k.curb('#26201e', '#463a35', 0.45, 0.5, 1.8);
  // Spires of black rock round it, jagged; glowing rocks among them.
  const rnd = rng(41);
  const spots = k.ring(2.2, 3, 2.4, 5, [0.8, 1.8], clearEnds);
  for (const [x, z, s] of spots) {
    k.shard(0.45 * s, 2.2 * s * (0.7 + rnd() * 0.8), rnd() < 0.5 ? '#2a2321' : '#3a2f2b', x, -0.1, z, (rnd() - 0.5) * 0.35, rnd() * 3, 0, 5);
    if (rnd() < 0.3) k.rock(0.25 * s, '#ff5a14', x + 0.6, 0, z + 0.4, Math.floor(x * 31 + z), 0.6, 0.9);
  }
  // The crust drifting on the lava.
  let t = 0;
  const tick: Observer<typeof scene> = scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() / 1000;
    lavaTex.uOffset = t * 0.012; lavaTex.vOffset = Math.sin(t * 0.2) * 0.02;
  });
  return k.arena('#5a2616', [40, 115], () => scene.onBeforeRenderObservable.remove(tick), { height: (x, z) => (inPlay(x, z) ? onCrust(x, z) : 0) });
}

// ── the ice: a rink in the snow, ice blocks round it, snowy pines, crystals ──
export function iceStadium(scene: Scene, at = Vector3.Zero()): Arena {
  const k = new Kit(scene, 'iceStadium', at);
  k.ground(90, 70, k.flat('#dfeaf0'), -0.01);
  const { mesh: rink, mat } = k.floor((g, X, Z, px) => {
    g.fillStyle = '#b7dcec'; g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    blotches(g, g.canvas.width, g.canvas.height, 60, [0.8 * px, 3 * px], ['#e8f6fb', '#b5dcec', '#ffffff'], 0.45, 6);
    // Skate scratches, and snow drifted in at its edges.
    const rnd = rng(14);
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 0.03 * px;
    for (let i = 0; i < 120; i++) { const x = rnd() * g.canvas.width, y = rnd() * g.canvas.height, a = rnd() * Math.PI, l = (1 + rnd() * 2) * px; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 0.3 * px, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    const edge = g.createLinearGradient(0, 0, 0, g.canvas.height);
    edge.addColorStop(0, 'rgba(255,255,255,0.8)'); edge.addColorStop(0.06, 'rgba(255,255,255,0)');
    edge.addColorStop(0.94, 'rgba(255,255,255,0)'); edge.addColorStop(1, 'rgba(255,255,255,0.8)');
    g.fillStyle = edge; g.fillRect(0, 0, g.canvas.width, g.canvas.height);
  }, 'rgba(90,160,205,0.8)');
  // Ice: a hard shine on it, frost in it, and everything over it mirrored faintly in it.
  mat.specularColor = new Color3(0.6, 0.7, 0.75); mat.specularPower = 64;
  // (Half its light, as a relief floor's: lit past full it clips white, its blue and frost washed out.)
  mat.diffuseColor = new Color3(0.55, 0.55, 0.55);
  k.owned.push(floorDetail(scene, mat, FLOOR_W, FLOOR_D, 'frost', 9));
  const mirror = new MirrorTexture('iceMirror', ICE_MIRROR, scene, true);
  mirror.mirrorPlane = new Plane(0, -1, 0, at.y);
  // (Only what the camera itself draws: a mesh kept off its layers — beam 2's hidden beam-1 layers, layerMask 0 —
  // would otherwise show in the ice though nowhere above it.)
  mirror.renderListPredicate = (m) => m !== rink && m.isEnabled() && m.isVisible && m.name !== 'kitGround'
    && (m.layerMask & (scene.activeCamera?.layerMask ?? 0x0fffffff)) !== 0;
  mirror.level = ICE_SHINE;
  mirror.adaptiveBlurKernel = 12;
  mat.reflectionTexture = mirror;
  k.owned.push(mirror);
  // Snow drifted against the curb, all round; chunks of broken ice lying out on the rink.
  {
    const rnd = rng(66);
    for (let i = 0; i < 90; i++) {
      const side = i % 4, t = rnd() * 2 - 1, inset = 0.15 + rnd() * 0.35;
      const x = side < 2 ? t * (INNER_W - 0.3) : (side === 2 ? -1 : 1) * (INNER_W - inset);
      const z = side < 2 ? (side === 0 ? -1 : 1) * (INNER_D - inset) : t * (INNER_D - 0.3);
      if (Math.abs(x) < 2 && Math.abs(z) > INNER_D - 1) continue;
      k.rock(0.22 + rnd() * 0.3, rnd() < 0.7 ? '#f6fafc' : '#e3eef4', x, -0.06, z, 1000 + i, 0.35);
    }
    for (let i = 0; i < 16; i++) {
      const x = (rnd() - 0.5) * INNER_W * 1.8, z = (rnd() - 0.5) * INNER_D * 1.7;
      if (Math.abs(x) < 4 && Math.abs(z) < 3) continue;
      for (let j = 0; j < 2 + Math.floor(rnd() * 3); j++) {
        const c = k.shard(0.08 + rnd() * 0.1, 0.16 + rnd() * 0.22, '#bfe6f6', x + (rnd() - 0.5) * 0.5, 0, z + (rnd() - 0.5) * 0.5, 1.2 + rnd() * 0.5, rnd() * 6, 0.15, 4);
        c.position.y = 0.04;
      }
    }
  }
  k.curb('#6fbde0', '#d8f1fb', 0.5, 0.5, 1.8);
  // Snow-laden pines (pale canopies), snow banks, and crystals of ice, faintly alight.
  k.trees(k.ring(2, 4, 1.9, 7, [1.2, 2.2], clearEnds), '#5a4632', '#6f9787', 53, 0.03);
  const rnd = rng(61);
  for (let i = 0; i < 22; i++) {
    const sx = rnd() < 0.5 ? -1 : 1, x = sx * (INNER_W + 0.9 + rnd() * 1.4), z = (rnd() - 0.5) * (INNER_D * 2 + 2);
    if (rnd() < 0.5) k.rock(0.35 + rnd() * 0.5, '#f4f8fa', x, -0.05, z, i + 400, 0.45);
    else for (let j = 0; j < 3; j++) k.shard(0.16 + rnd() * 0.12, 0.9 + rnd() * 1.2, '#5cc6ef', x + (rnd() - 0.5) * 0.6, 0, z + (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.7, rnd() * 3, 0.35, 6);
  }
  return k.arena('#d7e6ee', [45, 120]);
}

// ── the ruins: old flagstones, a broken wall, columns standing and fallen, arches ──
export function ruinsStadium(scene: Scene, at = Vector3.Zero()): Arena {
  const k = new Kit(scene, 'ruinsStadium', at);
  k.ground(90, 70, k.flat('#56723a'), -0.01);
  let stoneTop: (x: number, z: number) => number = () => 0;
  // The joints: worn mortar, mossed, low between the stones.
  k.floor((g) => {
    g.fillStyle = '#433f35'; g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    blotches(g, g.canvas.width, g.canvas.height, 160, [8, 40], ['#3f6128', '#4d6e30', '#3a372e'], 0.75, 2);
  }, null);
  // The flagstones: each its own block, a little raised, tilted and sized its own way, its own grey — concrete in the grain.
  {
    const rnd = rng(19), s = 1.2, gap = 0.12;
    // (Their own material: a plain white texture to carry the concrete detail — a detail map works on a texture's colour — and half
    // the light, so the sun on them doesn't clip and their tilts show.)
    const stoneMat = new StandardMaterial('ruinStones', scene), white = new DynamicTexture('ruinStoneWhite', { width: 4, height: 4 }, scene, false);
    const wg = white.getContext() as unknown as Paint; wg.fillStyle = '#fff'; wg.fillRect(0, 0, 4, 4); white.update();
    stoneMat.diffuseTexture = white; stoneMat.diffuseColor = new Color3(0.52, 0.52, 0.52); stoneMat.specularColor = Color3.Black();
    k.owned.push(stoneMat, white, floorDetail(scene, stoneMat, s * STADIUM_SCALE, s * STADIUM_SCALE, 'concrete', 13));
    const stones: Mesh[] = [];
    // (Each stone's footprint and top, laid out: what stands on it stands on its top.)
    const tops: [number, number, number, number, number][] = [];
    for (let row = 0, z = -INNER_D; z < INNER_D - 0.05; z += s, row++) for (let x = -INNER_W - (row % 2) * s * 0.5; x < INNER_W - 0.05; x += s) {
      const x0 = Math.max(-INNER_W, x), x1 = Math.min(INNER_W, x + s), z1 = Math.min(INNER_D, z + s);
      if (x1 - x0 < 0.2) continue;
      const v = 0.82 + rnd() * 0.18, c = new Color4(v, v * 0.97, v * 0.9, 1);
      const h = 0.05 + rnd() * 0.04, shrink = gap + rnd() * 0.04;
      const b = MeshBuilder.CreateBox('ruinStone', { width: x1 - x0 - shrink, height: h, depth: z1 - z - shrink, faceColors: [c, c, c, c, c, c] }, scene);
      b.position.set((x0 + x1) / 2, h / 2 - 0.01, (z + z1) / 2);
      b.rotation.set((rnd() - 0.5) * 0.035, (rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.035);
      stones.push(b);
      tops.push([x0 + shrink / 2, x1 - shrink / 2, z + shrink / 2, z1 - shrink / 2, h - 0.01]);
    }
    const merged = Mesh.MergeMeshes(stones, true, true)!;
    k.put(merged, stoneMat, 0, 0, 0);
    // Stood on: the top of the stone under it — over a joint, the higher stone either side (a foot spans it).
    stoneTop = (x, z) => {
      let top = 0;
      for (const [a, b, c, d, t] of tops) if (x >= a - 0.12 && x <= b + 0.12 && z >= c - 0.12 && z <= d + 0.12 && t > top) top = t;
      return top;
    };
  }
  // A low wall, broken: its blocks at all heights, some gone.
  {
    const rnd = rng(27), t = 0.5, ow = INNER_W + t / 2, od = INNER_D + t / 2;
    const course = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.round(len / 1.2), along = x0 !== x1;
      for (let i = 0; i < n; i++) {
        if (rnd() < 0.12) continue;
        const kk = (i + 0.5) / n, x = x0 + (x1 - x0) * kk, z = z0 + (z1 - z0) * kk, h = 0.25 + rnd() * 0.55;
        k.box(along ? len / n - 0.06 : t, h, along ? t : len / n - 0.06, rnd() < 0.5 ? '#a39b88' : '#958e7c', x, 0, z, (rnd() - 0.5) * 0.08);
      }
    };
    for (const sz of [-1, 1]) { course(-ow, sz * od, -2, sz * od); course(2, sz * od, ow, sz * od); }
    for (const sx of [-1, 1]) course(sx * ow, -od, sx * ow, od);
  }
  // Columns round it: some whole, some broken off, some fallen; an arch over each end's way in.
  const rnd = rng(33);
  const spots = k.ring(1.6, 2, 3, 13, [1, 1], clearEnds);
  for (const [x, z] of spots) {
    const r = rnd();
    if (r < 0.45) {
      const h = 1.2 + rnd() * 2.4;
      k.box(0.8, 0.25, 0.8, '#958e7c', x, 0, z);
      k.column(0.28, h, '#b2aa95', x, 0.25, z, 10);
      if (h > 3) k.box(0.85, 0.22, 0.85, '#a39b88', x, 0.25 + h, z);
    } else if (r < 0.7) {
      const c = k.column(0.28, 2.4 + rnd(), '#a8a08b', x, 0, z, 10);
      c.rotation.z = Math.PI / 2; c.rotation.y = rnd() * Math.PI; c.position.y = 0.28;
    } else for (let j = 0; j < 4; j++) k.rock(0.2 + rnd() * 0.3, '#9a937f', x + (rnd() - 0.5) * 1.2, 0, z + (rnd() - 0.5) * 1.2, Math.floor(x * 7 + z * 13 + j), 0.7);
  }
  for (const sz of [-1, 1]) {
    const z = sz * (INNER_D + 1.4);
    for (const sx of [-1, 1]) { k.box(0.9, 0.3, 0.9, '#958e7c', sx * 2, 0, z); k.column(0.32, 3.2, '#b2aa95', sx * 2, 0.3, z, 10); }
    k.box(5.2, 0.5, 0.9, '#a39b88', 0, 3.5, z);
    // Ivy down the arch.
    for (let j = 0; j < 6; j++) k.rock(0.18, '#4f7a32', -1.6 + j * 0.6, 3.3 - (j % 3) * 0.3, z + sz * 0.45, 700 + j, 0.5);
  }
  k.trees(k.ring(6, 2, 2.6, 19, [1.3, 2.2], clearEnds), '#5b4128', '#4e7a34', 71, 0.04);
  return k.arena('#c3ccb2', [45, 120], undefined, { height: (x, z) => stoneTop(x, z) });
}

/** Every stadium by its name (the grass one too: grassStadium.ts). */
export const THEMED_STADIUMS = { forest: forestStadium, seaside: seasideStadium, volcanic: volcanicStadium, ice: iceStadium, ruins: ruinsStadium } as const;
