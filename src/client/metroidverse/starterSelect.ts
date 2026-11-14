/**
 * Choosing your starter, in Prof. Oak's lab. Roll up onto his table, in front of one of the three Poké Balls, and the
 * camera closes in on you (all the while you're on the table), a hologram of the ball's Pokémon turning slowly
 * above it, its current stats (at level 100, as every Pokémon here is) on the right. Roll on to the next ball and the hologram and stats are its;
 * F chooses — its ball flares and is gone, its light drawn into yours, and it is your Pokémon (X calls it out).
 */
import { ensureGameUi, cap } from '../ui/gameUi.ts';
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { RecipeFactory } from '../render/RecipeFactory.ts';
import type { Platformer } from '../platformer/Platformer.ts';
import { hpStat, realStat } from '../platformer/Fighter.ts';
import { getSpecies } from '../../shared/index.ts';
import type { SpeciesDefinition } from '../../shared/index.ts';
import { typeColor } from '../theme.ts';
import * as MorphFx from '../vfx/MorphFx.ts';
import { STARTER_TABLE } from './palletTown.ts';
import type { PalletTown } from './palletTown.ts';

/** How near a ball (along the table) you must be to have it in view; the camera then, how far back, how high. */
const NEAR = 0.42, FOCUS_DIST = 4.2, FOCUS_UP = 0.85;
/** The hologram: how far left of you, how tall, how fast it turns (rad/s). */
const HOLO_H = 0.8, HOLO_SPIN = 0.7;
/** The hologram's space at its narrowest (across). */
const HOLO_SPACE = 0.95;
/** How high its feet are off the table's top: over its ball, and over yours in front of it. */
const HOLO_UP = 0.78;
/** How strongly its cyan light washes over it (its flicker on top). */
const HOLO_TINT = 0.5;
/**
 * What's hidden while you're on the table: what would stand between you and the camera, close as it comes — the lab's
 * loft, its post, rail and shelf.
 */
const HIDE_WHILE_CHOOSING = 'labLoft';
/** The stat bars' full length (a stat of this fills one). */
const BAR_MAX = 350;

export interface StarterSelect {
  /** Your starter's name, once chosen. */
  readonly chosen: string | null;
  dispose(): void;
}

export function starterSelect(scene: Scene, factory: RecipeFactory, pf: Platformer, town: PalletTown,
  o: { active: () => boolean; say: (text: string, secs?: number) => void; onChosen?: (name: string) => void }): StarterSelect {
  let chosen: string | null = null;
  let viewing = -1, busy = false;
  let holo: { node: TransformNode; meshes: AbstractMesh[]; parts: Mesh[]; mats: StandardMaterial[]; base: Vector3; H: number } | null = null;
  let holoFor = -1, holoToken = 0, t = 0;
  const holoOwned: Material[] = [];

  // ── the stats card (right) ──
  const card = document.createElement('div');
  // (The UI kit's card: its panel, its type — the name in the display face, the figures tabular.)
  ensureGameUi();
  card.className = 'gui gui-card';
  card.style.cssText = 'position:fixed;right:max(16px,5%);top:50%;transform:translateY(-50%);width:clamp(250px,26vw,330px);padding:16px 18px 14px;'
    + 'z-index:25;display:none;pointer-events:none';
  document.body.append(card);
  const fill = (sp: SpeciesDefinition) => {
    const stats: [string, number][] = [
      ['HP', hpStat(sp.hp)], ['Attack', realStat(sp.attack)], ['Defense', realStat(sp.defense)],
      ['Sp. Atk', realStat(sp.spAtk)], ['Sp. Def', realStat(sp.spDef)], ['Speed', realStat(sp.speed)],
    ];
    const total = stats.reduce((a, [, v]) => a + v, 0);
    card.innerHTML = '';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px';
    const nm = document.createElement('div'); nm.textContent = sp.name.toUpperCase(); nm.className = 'gui-title';
    const no = document.createElement('div'); no.textContent = `No. ${String(sp.spriteId).padStart(3, '0')}`; no.style.cssText = 'opacity:.65;font-variant-numeric:tabular-nums';
    head.append(nm, no);
    const types = document.createElement('div'); types.style.cssText = 'display:flex;gap:6px;margin-bottom:10px';
    for (const ty of sp.types) {
      const chip = document.createElement('span'); chip.textContent = ty.toUpperCase();
      chip.className = 'gui-chip'; chip.style.setProperty('--c', typeColor(ty));
      types.append(chip);
    }
    const lvl = document.createElement('div'); lvl.textContent = 'Lv. 100'; lvl.style.cssText = 'opacity:.7;margin:-4px 0 8px';
    card.append(head, types, lvl);
    for (const [label, v] of stats) {
      const row = document.createElement('div'); row.style.cssText = 'display:grid;grid-template-columns:4.6em 2.6em 1fr;align-items:center;gap:8px;margin:5px 0';
      const l = document.createElement('span'); l.textContent = label; l.style.cssText = 'opacity:.8';
      const n = document.createElement('span'); n.textContent = String(v); n.style.cssText = 'font-weight:900;text-align:right;font-variant-numeric:tabular-nums';
      const bar = document.createElement('div'); bar.style.cssText = 'height:7px;border-radius:4px;background:rgba(120,200,255,.14);overflow:hidden';
      const b = document.createElement('div');
      b.style.cssText = `height:100%;width:${Math.min(100, (v / BAR_MAX) * 100)}%;border-radius:4px;background:linear-gradient(90deg,#4fd3ff,#9ff3c6);box-shadow:0 0 8px rgba(110,220,255,.6)`;
      bar.append(b); row.append(l, n, bar); card.append(row);
    }
    const tot = document.createElement('div'); tot.style.cssText = 'display:flex;justify-content:space-between;margin-top:8px;padding-top:7px;border-top:1px solid rgba(255,255,255,.2)';
    tot.innerHTML = `<span style="opacity:.8">Total</span><span style="font-weight:900">${total}</span>`;
    const hint = document.createElement('div'); hint.style.cssText = 'margin-top:12px;display:flex;gap:16px;align-items:center';
    hint.innerHTML = `<span>${cap('F')} choose</span><span>${cap('A')} ${cap('D')} another ball</span>`;
    card.append(tot, hint);
  };

  // ── the hologram (left) ──
  const holoMat = (name: string, c: Color3, alpha: number) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = Color3.Black(); m.specularColor = Color3.Black(); m.emissiveColor = c; m.disableLighting = true;
    m.alpha = alpha; m.alphaMode = Constants.ALPHA_ADD; m.backFaceCulling = false;
    return m;
  };
  const dropHolo = () => {
    if (!holo) return;
    for (const p of holo.parts) p.dispose();
    for (const m of holo.mats) m.dispose();
    for (const m of holoOwned.splice(0)) m.dispose();
    factory.remove(holo.node);
    holo = null; holoFor = -1;
  };
  const showHolo = async (i: number) => {
    if (holoFor === i) return;
    dropHolo();
    holoFor = i;
    const token = ++holoToken;
    const sp = getSpecies(town.starters[i].species)!;
    const node = await factory.createPokemon(sp, 1);
    if (token !== holoToken) { factory.remove(node); return; }
    const sh = (scene.metadata as { shadowGen?: { removeShadowCaster(m: AbstractMesh): void } } | undefined)?.shadowGen;
    const meshes = node.getChildMeshes();
    // (Light, not flesh: washed in cyan, see-through, casting no shadow, touched by nothing.)
    for (const m of meshes) {
      sh?.removeShadowCaster(m); m.isPickable = false;
      // (Solid — never see-through, not its body through its shell nor the room through it: a hologram by its light,
      // washed in cyan.)
      m.renderOverlay = true; m.overlayColor = new Color3(0.3, 0.85, 1); m.overlayAlpha = HOLO_TINT; m.visibility = 1;
    }
    const s = HOLO_H / Math.max(0.05, factory.heightOf(node));
    node.scaling.scaleInPlace(s);
    const ball = town.starters[i];
    // (Above its Poké Ball, projected up out of it — clear over your own ball in front of it.)
    const bp = ball.mesh.position;
    const base = new Vector3(bp.x, STARTER_TABLE.top + HOLO_UP, bp.z);
    node.position.copyFrom(base);
    // (Its space sized to it: as wide as the farthest it reaches from its middle as it turns — tail, arms, flame — and
    // as tall as it stands, a margin round both; never smaller than HOLO_SPACE.)
    // (Only what's drawn of it — no helper meshes — its bones applied, not its rest pose.)
    node.computeWorldMatrix(true);
    const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const m of meshes) {
      if (!m.isVisible || !m.isEnabled() || m.getTotalVertices() === 0) continue;
      m.computeWorldMatrix(true);
      m.refreshBoundingInfo(true, true);
      const bb = m.getBoundingInfo().boundingBox;
      min.minimizeInPlace(bb.minimumWorld); max.maximizeInPlace(bb.maximumWorld);
    }
    if (!Number.isFinite(min.x)) { min.copyFrom(base); max.copyFrom(base.add(new Vector3(0, HOLO_H, 0))); }
    const reach = Math.max(Math.hypot(Math.max(max.x - base.x, base.x - min.x), Math.max(max.z - base.z, base.z - min.z)), 0.1);
    const W = Math.max(HOLO_SPACE, 2 * reach * 1.06 + 0.06), Hc = Math.max(HOLO_H, max.y - base.y) * 1.12 + 0.12;
    // (Its projection: a glowing ring at its feet, a column of light round it, scan rings climbing it.)
    const mats = [holoMat('holoRing', new Color3(0.4, 0.9, 1), 0.85), holoMat('holoCone', new Color3(0.25, 0.7, 1), 0.12), holoMat('holoScan', new Color3(0.5, 0.95, 1), 0.5)];
    const ring = MeshBuilder.CreateTorus('holoRing', { diameter: W, thickness: 0.035, tessellation: 48 }, scene);
    ring.position.set(base.x, base.y - 0.04, base.z); ring.material = mats[0];
    const disc = MeshBuilder.CreateDisc('holoDisc', { radius: W / 2, tessellation: 48 }, scene);
    disc.rotation.x = Math.PI / 2; disc.position.set(base.x, base.y - 0.035, base.z); disc.material = mats[1];
    const cone = MeshBuilder.CreateCylinder('holoCone', { height: Hc, diameterTop: W * 1.06, diameterBottom: W, tessellation: 40, cap: Mesh.NO_CAP }, scene);
    cone.position.set(base.x, base.y - 0.04 + Hc / 2, base.z); cone.material = mats[1];
    const scans = [0, 1, 2].map(() => {
      const r = MeshBuilder.CreateTorus('holoScan', { diameter: W * 1.02, thickness: 0.012, tessellation: 48 }, scene);
      r.material = mats[2]; return r;
    });
    const parts = [ring, disc, cone, ...scans];
    for (const p of parts) p.isPickable = false;
    holo = { node, meshes, parts, mats, base, H: Hc };
  };

  // ── the zoom: the camera close on you while you're on the table (no blur: the room as it is) ──
  const hidden = scene.meshes.filter((m) => m.name.startsWith(HIDE_WHILE_CHOOSING));
  let zoomed = false;
  /** The camera close on (`x` along the table) — the lab's loft, nearer than you, out of its way — or back to following. */
  const zoom = (x: number | null) => {
    if (x === null) {
      if (zoomed) { pf.focus = null; for (const m of hidden) m.setEnabled(true); zoomed = false; }
      return;
    }
    if (!zoomed) { for (const m of hidden) m.setEnabled(false); zoomed = true; }
    pf.focus = { at: new Vector3(x, STARTER_TABLE.top + FOCUS_UP, 0), dist: FOCUS_DIST };
  };
  /** At ball `i` (its hologram and stats up), or none (-1: both away). */
  const view = (i: number) => {
    viewing = i;
    if (i < 0) { card.style.display = 'none'; dropHolo(); holoToken++; return; }
    fill(getSpecies(town.starters[i].species)!);
    card.style.display = 'block';
    void showHolo(i);
  };

  // ── F: chosen ──
  const choose = async () => {
    if (busy || viewing < 0 || chosen) return;
    busy = true;
    const ball = town.starters[viewing], sp = getSpecies(ball.species)!;
    o.say(`You chose ${sp.name}!`, 2.6);
    // Its ball flares and is gone; its hologram's light drawn into yours.
    const at = ball.mesh.getAbsolutePosition().clone();
    MorphFx.flash(scene, at, 0.35, 'open');
    ball.mesh.setEnabled(false);
    const mine = pf.player.node.position.add(new Vector3(0, pf.player.H / 2, 0));
    if (holo) MorphFx.flash(scene, holo.node.position.add(new Vector3(0, HOLO_H / 2, 0)), 0.6, 'open');
    dropHolo();
    MorphFx.gather(scene, mine, 1.2, 0.6, 'open');
    await pf.giveStarter(sp);
    MorphFx.flash(scene, mine, 0.4, 'open');
    chosen = sp.name;
    view(-1); zoom(null);
    o.say(`${sp.name} is yours! Press X to call it out.`, 3.4);
    o.onChosen?.(sp.name);
    busy = false;
  };
  const onKey = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 'f' && !e.repeat) void choose(); };
  window.addEventListener('keydown', onKey);

  // ── each frame: which ball you're at; the hologram turning, flickering; the lens on you ──
  const obs = scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000;
    t += dt;
    if (!busy) {
      const p = pf.player;
      let at = -1;
      const onTable = !chosen && o.active() && p.ball && Math.abs(p.y - STARTER_TABLE.top) < 0.06 && p.x > STARTER_TABLE.x0 && p.x < STARTER_TABLE.x1;
      // (On the table: the camera close — on the ball you're at, else on you.)
      if (onTable) {
        let best = NEAR;
        for (const [i, b] of town.starters.entries()) {
          if (!b.mesh.isEnabled()) continue;
          const d = Math.abs(b.x - p.x);
          if (d < best) { best = d; at = i; }
        }
      }
      if (at !== viewing) view(at);
      zoom(onTable ? (at >= 0 ? town.starters[at].x : p.x) : null);
    }
    if (holo) {
      holo.node.rotation.y += HOLO_SPIN * dt;
      // (A hologram's flicker: a soft shimmer, now and then a glitch.)
      const glitch = Math.sin(t * 7.3) > 0.985 ? 0.3 : 0;
      for (const m of holo.meshes) m.overlayAlpha = HOLO_TINT + 0.06 * Math.sin(t * 23) + glitch;
      holo.node.position.y = holo.base.y + Math.sin(t * 1.6) * 0.025;
      const [ring] = holo.parts, scans = holo.parts.slice(3, 6);
      ring.rotation.y += dt * 1.5;
      for (const [k, r] of scans.entries()) {
        const u = (t * 0.45 + k / scans.length) % 1;
        r.position.set(holo.base.x, holo.base.y - 0.04 + u * holo.H, holo.base.z);
        r.scaling.setAll(1 + u * 0.06);
        (r.material as StandardMaterial).alpha = 0.5;
        r.visibility = Math.sin(u * Math.PI);
      }
    }
  });

  return {
    get chosen() { return chosen; },
    dispose() {
      scene.onBeforeRenderObservable.remove(obs);
      window.removeEventListener('keydown', onKey);
      view(-1); zoom(null); card.remove();
    },
  };
}
