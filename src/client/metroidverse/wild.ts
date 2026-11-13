/**
 * Wild Pokémon: roaming the tall grass, picked by how common each is there. Seen, not fought, till you strike one —
 * then it fights back (and so does any other you strike: strike several and several come for you). An unusually
 * aggressive species (AGGRESSIVE) comes for you when you come near, struck or not; none bother a Pokéball, and one
 * left far behind gives up. While any fights you, its circles (and any others') are up, top right.
 *
 * Beaten, it lies there a while (CATCH_WINDOW): press F to catch it — drawn into a Poké Ball, into your party — before
 * its body fades and is gone.
 */
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Platformer } from '../platformer/Platformer.ts';
import { Fighter, IDLE, hpStat } from '../platformer/Fighter.ts';
import type { Intent } from '../platformer/Fighter.ts';
import { BossAI } from '../platformer/BossAI.ts';
import { kitFor, AGGRESSIVE } from '../platformer/speciesMoves.ts';
import { getSpecies } from '../../shared/index.ts';
import type { SpeciesDefinition } from '../../shared/index.ts';
import * as MorphFx from '../vfx/MorphFx.ts';

/** How long a beaten one lies there to be caught (s); how long of that its body takes to fade at the end. */
const CATCH_WINDOW = 7, FADE = 2;
/** How near an aggressive one notices you; how far you go before one fighting you gives up. */
const NOTICE = 4.5, GIVE_UP = 18;
/** How many roam at once; how long between one appearing and the next (s); never nearer you than this when it does. */
const MAX_WILD = 7, SPAWN_EVERY: [number, number] = [2.5, 6], SPAWN_CLEAR = 7;
/** Its fighting (BossAI's style): quick to answer, a touch wary. */
const WILD_STYLE = { think: [0.22, 0.4] as [number, number], wary: 0.5, dodge: 0.5, detect: 0.4 };

export interface WildArea { x0: number; x1: number; y: number }
export interface WildOptions {
  /** Where they roam: the tall grass. */
  grass: WildArea[];
  /** Who: each species and how common (its weight among them). */
  table: { species: string; weight: number }[];
  /** Spoken (caught: "Gotcha!"). */
  say: (text: string, secs?: number) => void;
}

interface Wild {
  f: Fighter; sp: SpeciesDefinition; area: WildArea;
  ai: BossAI | null;
  /** Its wandering: which way, till when; resting till when. */
  dir: number; walkUntil: number; restUntil: number;
  /** When it was beaten (null: not yet). */
  downAt: number | null;
}

export function wildPokemon(pf: Platformer, o: WildOptions): { dispose(): void; wilds: () => readonly Wild[] } {
  const { scene, factory } = pf.world;
  const wilds: Wild[] = [];
  let nextSpawn = 1, t = 0, spawning = false, catching = false, shownKey = '';
  const rand = (a: number, b: number) => a + Math.random() * (b - a);

  // ── who appears, where ──
  const table = o.table.map((e) => ({ sp: getSpecies(e.species), w: e.weight })).filter((e): e is { sp: SpeciesDefinition; w: number } => !!e.sp);
  const pickSpecies = () => {
    let r = Math.random() * table.reduce((a, e) => a + e.w, 0);
    for (const e of table) { r -= e.w; if (r <= 0) return e.sp; }
    return table[0].sp;
  };
  const spawn = async () => {
    const p = pf.player;
    // (A patch, by its size; a spot in it well clear of you.)
    const areas = o.grass.filter((a) => a.x1 - a.x0 > 1.5);
    let area: WildArea | null = null, x = 0;
    for (let tries = 0; tries < 12 && !area; tries++) {
      const total = areas.reduce((s, a) => s + (a.x1 - a.x0), 0);
      let r = Math.random() * total;
      const a = areas.find((c) => (r -= c.x1 - c.x0) <= 0) ?? areas[0];
      const cx = rand(a.x0 + 0.5, a.x1 - 0.5);
      if (Math.abs(cx - p.x) > SPAWN_CLEAR) { area = a; x = cx; }
    }
    if (!area) return;
    const sp = pickSpecies();
    const node = await factory.createPokemon(sp, 2);
    const max = hpStat(sp.hp);
    const f = new Fighter(node, factory, 2, max, kitFor(sp.name), sp.name, sp.types);
    f.attack = sp.attack; f.spAtk = sp.spAtk; f.speed = sp.speed; f.defense = sp.defense; f.spDef = sp.spDef;
    f.place(x, area.y + 0.05, Math.random() < 0.5 ? -1 : 1);
    const w: Wild = { f, sp, area, ai: null, dir: f.facing, walkUntil: 0, restUntil: t + rand(0.5, 2), downAt: null };
    wilds.push(w);
    pf.addFoe(f, () => brain(w));
  };

  // ── its mind ──
  const fightBack = (w: Wild) => {
    if (w.ai || w.downAt !== null) return;
    w.ai = new BossAI(w.f, pf.player, WILD_STYLE);
    w.ai.arena = pf.fightArena;
  };
  const brain = (w: Wild): Intent => {
    const p = pf.player, f = w.f;
    if (w.downAt !== null) return IDLE;
    const d = Math.abs(p.x - f.x) + Math.abs(p.y - f.y) * 0.5;
    // (None bother a Pokéball; one left far behind gives up.)
    if (w.ai && (p.ball || d > GIVE_UP)) w.ai = null;
    if (!w.ai && AGGRESSIVE.has(w.sp.name) && !p.ball && d < NOTICE) fightBack(w);
    if (w.ai) return w.ai.think();
    // Wandering its patch: a few steps one way, a rest, a few steps (turned back at its edges).
    if (t < w.restUntil) return { ...IDLE, face: w.dir };
    if (t >= w.walkUntil) {
      if (w.walkUntil > 0) { w.restUntil = t + rand(1, 3.2); w.walkUntil = 0; return { ...IDLE, face: w.dir }; }
      w.dir = Math.random() < 0.5 ? -1 : 1; w.walkUntil = t + rand(0.4, 1.3);
    }
    if (f.x < w.area.x0 + 0.3) w.dir = 1;
    if (f.x > w.area.x1 - 0.3) w.dir = -1;
    return { ...IDLE, want: w.dir, face: w.dir };
  };
  // Struck by you: it fights back.
  const hook = (by: Fighter, on: Fighter) => {
    if (by !== pf.player) return;
    const w = wilds.find((x) => x.f === on);
    if (w) fightBack(w);
  };
  pf.hitHooks.push(hook);

  // ── the catch prompt ──
  const prompt = document.createElement('div');
  prompt.style.cssText = 'position:fixed;left:50%;bottom:16%;transform:translateX(-50%);display:none;z-index:28;pointer-events:none;'
    + 'padding:9px 16px 11px;border-radius:12px;background:rgba(10,16,30,.82);border:1.5px solid rgba(255,255,255,.35);color:#fff;'
    + 'font:600 16px/1.3 system-ui,sans-serif;text-align:center;box-shadow:0 6px 18px rgba(0,0,0,.35)';
  const label = document.createElement('div');
  const bar = document.createElement('div');
  bar.style.cssText = 'height:4px;margin-top:7px;border-radius:2px;background:linear-gradient(90deg,#ef4444,#f8fafc);transform-origin:left';
  prompt.append(label, bar);
  document.body.append(prompt);

  // ── F: caught ──
  const catchable = () => {
    const p = pf.player;
    let best: Wild | null = null;
    for (const w of wilds) {
      if (w.downAt === null || t - w.downAt > CATCH_WINDOW) continue;
      if (!best || Math.abs(w.f.x - p.x) < Math.abs(best.f.x - p.x)) best = w;
    }
    return best;
  };
  const capture = async (w: Wild) => {
    catching = true;
    const f = w.f, node = f.node, base = node.scaling.clone(), meshes = node.getChildMeshes();
    const at = () => node.position.add(new Vector3(0, f.H / 2, 0));
    // (Drawn into a Poké Ball: washed red, the light drawing it in, shrinking away; a flash as the ball shuts.)
    MorphFx.gather(scene, at(), f.H * 1.2, 0.45, 'recall');
    for (const m of meshes) { m.renderOverlay = true; m.overlayColor = new Color3(1, 0.22, 0.2); m.overlayAlpha = 0; m.visibility = 1; }
    await new Promise<void>((done) => {
      let u = 0;
      const obs = scene.onBeforeRenderObservable.add(() => {
        u = Math.min(1, u + scene.getEngine().getDeltaTime() / 1000 / 0.55);
        for (const m of meshes) m.overlayAlpha = Math.min(1, u * 2);
        node.scaling.copyFrom(base.scale(Math.max(0.02, 1 - Math.pow(Math.max(0, u - 0.35) / 0.65, 2))));
        if (u >= 1) { scene.onBeforeRenderObservable.remove(obs); done(); }
      });
    });
    MorphFx.flash(scene, at(), 0.5, 'recall');
    drop(w);
    if (pf.addToTeam(w.sp) >= 0) o.say(`Gotcha! ${w.sp.name} was caught!`, 2.8);
    else o.say(`Your party is full — ${w.sp.name} got away.`, 2.8);
    catching = false;
  };
  const drop = (w: Wild) => {
    const i = wilds.indexOf(w);
    if (i >= 0) wilds.splice(i, 1);
    pf.removeFoe(w.f);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() !== 'f' || e.repeat || catching) return;
    const w = catchable();
    if (w) void capture(w);
  };
  window.addEventListener('keydown', onKey);

  // ── each frame: new ones appearing; the beaten lying there, then fading; the fight's circles ──
  const obs = scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000;
    t += dt;
    if (!spawning && t >= nextSpawn && wilds.length < MAX_WILD && table.length) {
      spawning = true;
      void spawn().finally(() => { spawning = false; nextSpawn = t + rand(...SPAWN_EVERY); });
    }
    for (const w of [...wilds]) {
      if (w.f.down && w.downAt === null) { w.downAt = t; w.ai = null; }
      if (w.downAt === null) continue;
      const left = CATCH_WINDOW - (t - w.downAt);
      // (Fading as its time runs out; gone at its end.)
      if (left < FADE && !catching) for (const m of w.f.node.getChildMeshes()) m.visibility = Math.max(0, left / FADE);
      if (left <= 0 && !catching) drop(w);
    }
    // The prompt over the nearest one beaten.
    const c = catching ? null : catchable();
    if (c) {
      label.innerHTML = `<b style="border:1px solid rgba(255,255,255,.6);border-radius:4px;padding:0 6px;margin-right:6px">F</b>Catch ${c.sp.name}`;
      bar.style.transform = `scaleX(${Math.max(0, 1 - (t - c.downAt!) / CATCH_WINDOW)})`;
      prompt.style.display = 'block';
    } else prompt.style.display = 'none';
    // The circles of those fighting you (and those beaten by you, lying there), top right.
    const fighting = wilds.filter((w) => w.ai || (w.downAt !== null && t - w.downAt <= CATCH_WINDOW));
    const key = fighting.map((w) => wilds.indexOf(w) + ':' + w.sp.name).join(',');
    if (key !== shownKey) {
      shownKey = key;
      if (fighting.length) pf.encounter(fighting.map((w) => ({ species: w.sp, fighter: w.f })));
      else pf.endEncounter();
    }
  });

  return {
    wilds: () => wilds,
    dispose() {
      scene.onBeforeRenderObservable.remove(obs);
      window.removeEventListener('keydown', onKey);
      const i = pf.hitHooks.indexOf(hook); if (i >= 0) pf.hitHooks.splice(i, 1);
      for (const w of [...wilds]) drop(w);
      prompt.remove();
    },
  };
}
