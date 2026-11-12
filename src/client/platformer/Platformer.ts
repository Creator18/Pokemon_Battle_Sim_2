/**
 * The metroidvania prototype: a side-on platformer. Pokémon (Fighters: their real models and clips) run, jump and
 * fight through a level of solid platforms on a single plane (z = 0), seen from the side, the camera following.
 *
 *   A / D or ← / →   run          Space   jump (hold: higher)
 *   Space in the air   fly (one with an air idle: Charizard) — Space held rises, let go it glides down, A / D steer
 *   W / S or ↑ / ↓     look up / down — and its beams, slashes and Quick Attacks (aloft) go that way
 *   U ranged · I close · J mobility · K control    its moves (MoveKit, see Fighter)
 *   R                  a boss fight over: again
 *
 * Its foes: practice targets (they watch, and stand again after fainting) or a boss (`boss`: a BossAI fights back with
 * its own moves). With a boss, both HP bars show, the camera frames the two of them, and the fight ends when one
 * faints. Falling into a pit: back to the start. Nothing hides the fighters: scenery between the camera and them fades.
 */
import type { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { RecipeFactory } from '../render/RecipeFactory.ts';
import type { SpeciesDefinition } from '../../shared/index.ts';
import { Fighter, DEFAULT_KIT, IDLE } from './Fighter.ts';
import type { Arena, Intent, MoveKit, Platform } from './Fighter.ts';
import { BossAI } from './BossAI.ts';
import { backdrop as paintedBackdrop } from '../render/arenas/backdrops.ts';
import type { Backdrop, BackdropName } from '../render/arenas/backdrops.ts';

export type { Platform, MoveKit } from './Fighter.ts';
export { DEFAULT_KIT } from './Fighter.ts';

/** The camera: how far off the plane, how high above the body, how far it leads the way it faces, how quickly it follows. */
const CAM_DIST = 15, CAM_UP = 2.2, CAM_LEAD = 2.5, CAM_EASE = 5;
/** Framing two (a boss fight): pulled back till both fit across its view, with CAM_MARGIN to spare each side (world units); never nearer than CAM_DIST. */
const CAM_MARGIN = 3;
/** The platforms' depth (across the view) and their grass top's thickness. */
const DEPTH = 4, GRASS = 0.18;
/** Below this, it has fallen: back to the start. */
const KILL_Y = -12;
/** How much of their own colour the platforms show unlit. */
const LIT_SELF = 0.55;
/**
 * Nothing hides the fighters: whatever lies between the camera and a fighter (rays from the eye to OCCLUDE_AT of its
 * height) fades to OCCLUDED, easing there and back at OCCLUDE_EASE (per s).
 */
const OCCLUDE_AT = [0.25, 0.6, 0.95], OCCLUDED = 0.2, OCCLUDE_EASE = 8;
/** HP: the player's and a boss's; a practice target's (three Flamethrowers). */
const PLAYER_HP = 100, BOSS_HP = 100, TARGET_HP = 40;

/** The first room: a floor with a pit, steps up to a high ledge, floating platforms, a wall to jump. */
export const FIRST_ROOM: Platform[] = [
  { x: -12, top: 0, w: 34, h: 6 },          // the floor, to the pit
  { x: 26, top: 0, w: 40, h: 6 },           // the floor, past the pit
  { x: 6, top: 1.6, w: 3.5, h: 0.6 },       // steps up
  { x: 11, top: 3.2, w: 3.5, h: 0.6 },
  { x: 16, top: 4.8, w: 4, h: 0.6 },
  { x: 23, top: 3.4, w: 4, h: 0.6 },        // over the pit
  { x: 31, top: 2.6, w: 1.6, h: 2.6 },      // a wall to jump
  { x: 36, top: 2.4, w: 3, h: 0.6 },        // up to the high ledge
  { x: 40, top: 4.4, w: 3, h: 0.6 },
  { x: 44, top: 6.4, w: 9, h: 1.2 },        // the high ledge
  { x: 56, top: 1.4, w: 4, h: 1.4 },        // a block on the far floor
];

/** A boss zone: a flat floor `halfW` each way of the middle, walled at its ends and roofed `high` up — all of it unseen (the stadium is the look). */
export function bossRoom(halfW: number, high = 14): Platform[] {
  return [
    { x: -halfW, top: 0, w: halfW * 2, h: 6, hidden: true },
    { x: -halfW - 4, top: high + 4, w: 4, h: high + 10, hidden: true },
    { x: halfW, top: high + 4, w: 4, h: high + 10, hidden: true },
    { x: -halfW - 4, top: high + 4, w: halfW * 2 + 8, h: 4, hidden: true },
  ];
}

/** A foe: who, where it stands (on a platform's top), and whether it is a boss (it fights back, with `moves`). */
export interface EnemySpot { species: SpeciesDefinition; x: number; y: number; boss?: boolean; moves?: MoveKit }

export interface PlatformerOptions {
  species: SpeciesDefinition;
  level?: Platform[];
  start?: { x: number; y: number };
  enemies?: EnemySpot[];
  /** Its moves (default DEFAULT_KIT). */
  moves?: MoveKit;
  /**
   * Its backdrop: a painted one by name (render/arenas/backdrops: 'forest', 'volcano', 'snowfield' — its platforms in
   * its colours), its own plain sky and far hills (true, the default), or none (false: the caller's scene is the
   * backdrop — a stadium).
   */
  backdrop?: boolean | BackdropName;
  /** The backdrop's meshes, faded when they come between the camera and a fighter (its own platforms and hills always are). */
  scenery?: TransformNode;
}

/** Something that happened in a fight (s from its start). */
export interface FightEvent { t: number; text: string }

/** The stopper's perfect zone, as drawn (Fighter's METER_PERFECT). */
const METER_PERFECT_HUD = 0.15;

export class Platformer {
  readonly player: Fighter;
  readonly fighters: Fighter[];
  readonly boss: Fighter | null;
  readonly ai: BossAI | null;
  /** What happened, in order (blows, faints, the end). */
  readonly events: FightEvent[] = [];
  /** A boss fight's result, once over. */
  result: 'won' | 'lost' | null = null;
  private readonly arena: Arena;
  private readonly meshes: Mesh[] = [];
  private readonly keys = new Set<string>();
  private pressed = new Set<string>();
  private readonly level: Platform[];
  private readonly start: { x: number; y: number };
  private readonly spots: EnemySpot[];
  private readonly camAt = new Vector3();
  private camDist = CAM_DIST;
  private clock = 0;
  private hud: HTMLDivElement | null = null;
  private painted: Backdrop | null = null;
  /**
   * What is faded out of the way: its own visibility (to go back to), and what is drawn faded in its place — itself, or,
   * an instance (whose visibility is its source's, shared by every copy), a copy of its own standing in for it.
   */
  private readonly faded = new Map<AbstractMesh, { own: number; shown: AbstractMesh }>();
  /** Those stand-in copies, back to what they stand for. */
  private readonly standIns = new Map<AbstractMesh, AbstractMesh>();
  private readonly scenery: TransformNode | null;
  private readonly onKey = (e: KeyboardEvent) => this.key(e);
  private readonly obs;

  get node() { return this.player.node; }
  /** How long the fight has gone on (s; restarted with it) — held at its end once it is over. */
  get time(): number { return this.endedAt ?? this.clock; }
  private endedAt: number | null = null;
  get moves(): MoveKit { return this.player.moves; }

  private constructor(private readonly scene: Scene, private readonly factory: RecipeFactory, private readonly camera: Camera,
    player: Fighter, foes: Fighter[], o: PlatformerOptions) {
    this.player = player;
    this.fighters = [player, ...foes];
    this.spots = o.enemies ?? [];
    this.scenery = o.scenery ?? null;
    this.level = o.level ?? FIRST_ROOM;
    this.start = o.start ?? { x: 0, y: 0 };
    const bossAt = this.spots.findIndex((s) => s.boss);
    this.boss = bossAt >= 0 ? foes[bossAt] : null;
    this.ai = this.boss ? new BossAI(this.boss, player) : null;
    this.arena = {
      level: this.level, fighters: this.fighters,
      onHit: (by, on, move, dmg) => {
        this.note(`${by.name} ${move} → ${on.name} −${dmg} (${on.hp}/${on.maxHp})`);
        if (on.hp <= 0) this.note(`${on.name} fainted`);
      },
      onBurst: (a, b, ma, mb) => this.note(`point-blank: ${a.name} ${ma} × ${b.name} ${mb} — both burst, both knocked back`),
      onClash: (a, b, _w, meet) => this.note(`clash: ${a.name} ${a.using} × ${b.name} ${b.using} at ${meet}`),
      onCounter: (by, on, move, dmg, brace = 'Sucker Punch') => this.note(`${brace.toLowerCase()}: ${by.name} on ${on.name}'s ${move} (${dmg})`),
      onClashEnd: (_a, _b, w, s) => this.note(`clash over → ${w ? `${w.name} wins` : 'tie'}${s ? ` (stops ${s.rival.toFixed(2)} / ${s.you.toFixed(2)}${s.outright ? ', outright' : ''})` : ''}`),
    };
    this.build(o.backdrop ?? true);
    this.placeAll();
    if (this.boss) this.buildHud();
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    this.obs = scene.onBeforeRenderObservable.add(() => this.step(Math.min(0.05, scene.getEngine().getDeltaTime() / 1000)));
  }

  /** A side-on level with `o.species` in it, under the player's control. */
  static async start(scene: Scene, factory: RecipeFactory, camera: Camera, o: PlatformerOptions): Promise<Platformer> {
    const node = await factory.createPokemon(o.species, 1);
    const player = new Fighter(node, factory, 1, PLAYER_HP, o.moves ?? DEFAULT_KIT, `${o.species.name} (you)`, o.species.types);
    player.attack = o.species.attack; player.spAtk = o.species.spAtk; player.speed = o.species.speed;
    const foes: Fighter[] = [];
    for (const e of o.enemies ?? []) {
      const n = await factory.createPokemon(e.species, 2);
      foes.push(e.boss
        ? new Fighter(n, factory, 2, BOSS_HP, e.moves ?? DEFAULT_KIT, `${e.species.name} (boss)`, e.species.types)
        : new Fighter(n, factory, 2, TARGET_HP, {}, e.species.name, e.species.types, { x: e.x, y: e.y }));
      foes[foes.length - 1].attack = e.species.attack; foes[foes.length - 1].spAtk = e.species.spAtk; foes[foes.length - 1].speed = e.species.speed;
    }
    return new Platformer(scene, factory, camera, player, foes, o);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    this.scene.onBeforeRenderObservable.remove(this.obs);
    for (const m of this.meshes) m.dispose();
    this.painted?.dispose();
    for (const [m, f] of this.faded) this.unfade(m, f);
    // (Its fighters gone with it: a new level brings its own — a beam one was charging or pouring, gone too.)
    for (const f of this.fighters) { f.beam?.play.cancel?.(true); f.beam = null; this.factory.remove(f.node); }
    this.hud?.remove();
  }

  private note(text: string): void { this.events.push({ t: +this.clock.toFixed(2), text }); }

  private placeAll(): void {
    this.player.place(this.start.x, this.start.y, 1);
    this.fighters.slice(1).forEach((f, i) => f.place(this.spots[i].x, this.spots[i].y, -1));
    this.camAt.set(this.start.x, this.start.y + CAM_UP, 0);
  }

  /** A boss fight again: everyone whole and back in place. */
  restart(): void {
    for (const f of this.fighters) f.restore();
    this.placeAll();
    this.result = null; this.endedAt = null;
    this.events.length = 0; this.clock = 0;
    if (this.ai) this.ai.log.length = 0;
    this.note('fight!');
  }

  // ── the level ──────────────────────────────
  private build(backdrop: boolean | BackdropName): void {
    const scene = this.scene;
    // (A painted backdrop: as wide as the level; its platforms in its colours.)
    if (typeof backdrop === 'string') {
      const xs = this.level.filter((p) => !p.hidden).flatMap((p) => [p.x, p.x + p.w]);
      this.painted = paintedBackdrop(scene, backdrop, Math.min(-10, ...xs), Math.max(10, ...xs));
      scene.clearColor = this.painted.clear;
    }
    const tone = this.painted?.platform;
    const mat = (name: string, c: [number, number, number]) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = new Color3(...c);
      m.emissiveColor = new Color3(...c).scale(LIT_SELF);
      m.specularColor = new Color3(0.02, 0.02, 0.02);
      return m;
    };
    const earth = mat('pfEarth', tone?.body ?? [0.45, 0.31, 0.2]), grass = mat('pfGrass', tone?.top ?? [0.36, 0.66, 0.24]), far = mat('pfFar', [0.42, 0.58, 0.5]);
    for (const [i, p] of this.level.entries()) {
      if (p.hidden) continue;
      const box = MeshBuilder.CreateBox(`pfPlatform${i}`, { width: p.w, height: p.h, depth: DEPTH }, scene);
      box.position.set(p.x + p.w / 2, p.top - p.h / 2, 0);
      box.material = earth;
      box.receiveShadows = true;
      const top = MeshBuilder.CreateBox(`pfGrass${i}`, { width: p.w + 0.04, height: GRASS, depth: DEPTH + 0.04 }, scene);
      top.position.set(p.x + p.w / 2, p.top - GRASS / 2 + 0.01, 0);
      top.material = grass;
      top.receiveShadows = true;
      this.meshes.push(box, top);
    }
    if (backdrop !== true) return;
    for (let k = 0; k < 9; k++) {
      const hill = MeshBuilder.CreateSphere(`pfHill${k}`, { diameter: 18 + (k % 3) * 8, segments: 10 }, scene);
      hill.position.set(-14 + k * 11, -6 + (k % 2) * 2, 28 + (k % 3) * 6);
      hill.scaling.y = 0.6;
      hill.material = far;
      this.meshes.push(hill);
    }
    scene.clearColor = new Color4(0.62, 0.8, 0.95, 1);
  }

  // ── HP bars ──────────────────────────────
  private buildHud(): void {
    const hud = document.createElement('div');
    Object.assign(hud.style, { position: 'fixed', left: '0', right: '0', top: '52px', display: 'flex', justifyContent: 'space-between',
      padding: '0 24px', pointerEvents: 'none', zIndex: '60', font: '600 14px system-ui', color: '#fff' });
    const bar = (f: Fighter, right: boolean) => {
      const box = document.createElement('div');
      Object.assign(box.style, { width: 'min(38vw, 360px)', textAlign: right ? 'right' : 'left', textShadow: '0 1px 2px #000' });
      box.innerHTML = `<div>${f.name}</div><div style="height:12px;background:rgba(20,24,40,.75);border-radius:6px;overflow:hidden;margin-top:4px">
        <div data-fill style="height:100%;width:100%;background:#4ade80;transition:width .2s;${right ? 'margin-left:auto' : ''}"></div></div>`;
      return box;
    };
    hud.append(bar(this.player, false), bar(this.boss!, true));
    // A clash's stopper: STOP U, its needle swinging across its meter (the perfect zone in the middle), then how it went.
    const tug = document.createElement('div');
    tug.dataset.tug = '';
    Object.assign(tug.style, { position: 'fixed', left: '50%', top: '30%', transform: 'translate(-50%,-50%)', display: 'none', textAlign: 'center',
      font: '900 30px system-ui', color: '#fff', textShadow: '0 2px 6px #000' });
    tug.innerHTML = `<div data-tug-say>STOP U!</div><div style="position:relative;width:min(60vw,420px);height:16px;margin:8px auto 0;border-radius:8px;
      background:linear-gradient(90deg,#7f1d1d,#ef4444 25%,#facc15 40%,#4ade80 50%,#facc15 60%,#ef4444 75%,#7f1d1d);box-shadow:0 0 0 2px rgba(0,0,0,.5)">
      <div style="position:absolute;top:-3px;bottom:-3px;left:${50 - 50 * METER_PERFECT_HUD}%;width:${100 * METER_PERFECT_HUD}%;border:2px solid #fff;border-radius:4px"></div>
      <div data-tug-ball style="position:absolute;top:-7px;width:6px;height:30px;margin-left:-3px;border-radius:3px;background:#fff;box-shadow:0 0 8px #fff"></div></div>
      <div data-tug-note style="font-size:16px;margin-top:6px"></div>`;
    hud.append(tug);
    const banner = document.createElement('div');
    banner.dataset.banner = '';
    Object.assign(banner.style, { position: 'fixed', left: '50%', top: '40%', transform: 'translate(-50%,-50%)', font: '800 42px system-ui',
      color: '#fff', textShadow: '0 3px 8px #000', display: 'none', textAlign: 'center' });
    hud.append(banner);
    document.body.append(hud);
    this.hud = hud;
  }

  private updateHud(): void {
    if (!this.hud) return;
    const fills = this.hud.querySelectorAll<HTMLDivElement>('[data-fill]');
    [this.player, this.boss!].forEach((f, i) => {
      const k = f.hp / f.maxHp;
      fills[i].style.width = `${k * 100}%`;
      fills[i].style.background = k > 0.5 ? '#4ade80' : k > 0.2 ? '#facc15' : '#ef4444';
    });
    // (The stopper: your needle, then your stop, then the outcome.)
    const tug = this.hud.querySelector<HTMLDivElement>('[data-tug]')!;
    const c = this.player.clashing, n = c?.needle() ?? null;
    tug.style.display = c && (n !== null || c.outcome() !== null) ? 'block' : 'none';
    if (c) {
      const ball = tug.querySelector<HTMLDivElement>('[data-tug-ball]')!;
      if (n !== null) ball.style.left = `${50 + 50 * n}%`;
      const q = c.quality(), o = c.outcome();
      const grade = q === null ? '' : q >= 1 ? 'PERFECT' : q >= 0.7 ? 'GREAT' : q >= 0.4 ? 'GOOD' : q > 0 ? 'WEAK' : 'MISSED';
      tug.querySelector<HTMLDivElement>('[data-tug-say]')!.textContent = o === null ? (q === null ? 'STOP U!' : grade)
        : o > 0 ? (c.outright() ? 'OVERPOWERED THEM!' : 'YOU WIN THE CLASH!') : o < 0 ? (c.outright() ? 'OVERPOWERED!' : 'CLASH LOST') : 'EVEN — IT BURSTS!';
      tug.querySelector<HTMLDivElement>('[data-tug-note]')!.textContent = q === null ? '' : `${grade} ×${c.timing()!.toFixed(2)}`;
    }
    const banner = this.hud.querySelector<HTMLDivElement>('[data-banner]')!;
    banner.style.display = this.result ? 'block' : 'none';
    banner.innerHTML = this.result === 'won' ? 'You win!<div style="font-size:16px">R: fight again</div>'
      : this.result === 'lost' ? 'Defeated<div style="font-size:16px">R: fight again</div>' : '';
  }

  // ── input ──────────────────────────────
  private key(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    const down = e.type === 'keydown';
    if (['a', 'd', 'w', 's', ' ', 'u', 'i', 'j', 'k', 'l', 'r', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)) e.preventDefault();
    if (down && !this.keys.has(k)) {
      this.pressed.add(k);
      if (k === 'r' && this.result) this.restart();
    }
    if (down) this.keys.add(k); else this.keys.delete(k);
  }

  /** The player's intent this frame, from the keys (presses since the last frame). */
  private playerIntent(): Intent {
    const has = (...ks: string[]) => ks.some((k) => this.keys.has(k));
    const hit = (...ks: string[]) => ks.some((k) => this.pressed.has(k));
    // (Space alone jumps — and, aloft, flies: held it rises, let go it glides down. W / S aim up and down.)
    const i: Intent = {
      want: (has('d', 'arrowright') ? 1 : 0) - (has('a', 'arrowleft') ? 1 : 0),
      jumpHeld: has(' '), jumpPressed: hit(' '), sink: false,
      aim: (has('w', 'arrowup') ? 1 : 0) - (has('s', 'arrowdown') ? 1 : 0),
      ranged: hit('u'), close: hit('i'), mobility: hit('j'), control: hit('k'), mobilityHeld: has('j'), backDash: hit('l'),
    };
    this.pressed.clear();
    return i;
  }

  // ── a frame ──────────────────────────────
  private step(dt: number): void {
    if (dt <= 0) return;
    this.clock += dt;
    const over = !!this.result;
    this.player.step(dt, over ? IDLE : this.playerIntent(), this.arena);
    if (over) this.pressed.clear();
    for (const f of this.fighters.slice(1)) {
      // A boss thinks; a practice target turns to watch the player.
      const intent = f === this.boss && this.ai ? (over ? IDLE : this.ai.think()) : { ...IDLE, face: Math.sign(this.player.x - f.x) || f.facing };
      f.step(dt, intent, this.arena);
    }
    for (const f of this.fighters) {
      if (!f.fellOut(KILL_Y)) continue;
      if (f === this.player) f.place(this.start.x, this.start.y, 1);
      else { const s = this.spots[this.fighters.indexOf(f) - 1]; f.place(s.x, s.y, -1); }
    }
    if (this.boss && !this.result) {
      if (this.boss.down) { this.result = 'won'; this.endedAt = this.clock; this.note('you win'); }
      else if (this.player.down) { this.result = 'lost'; this.endedAt = this.clock; this.note('you lose'); }
    }
    this.updateHud();
    this.follow(dt);
  }

  /** The camera off to the side, level with the player, leading the way it faces — or, in a boss fight, framing both. */
  private follow(dt: number): void {
    const p = this.player.node.position;
    let goal: Vector3, dist = CAM_DIST;
    if (this.boss) {
      const b = this.boss.node.position;
      goal = new Vector3((p.x + b.x) / 2, Math.max(p.y, b.y) * 0.6 + Math.min(p.y, b.y) * 0.4 + CAM_UP, 0);
      // (Both across its view: half of them apart plus a margin, at its horizontal field of view.)
      const cam = this.camera as unknown as { fov?: number };
      const tanH = Math.tan((cam.fov ?? 0.8) / 2) * this.scene.getEngine().getAspectRatio(this.camera);
      dist = Math.max(CAM_DIST, (Math.abs(p.x - b.x) / 2 + CAM_MARGIN) / Math.max(tanH, 0.1));
    } else {
      goal = new Vector3(p.x + this.player.facing * CAM_LEAD, p.y + CAM_UP, 0);
    }
    const k = 1 - Math.exp(-dt * CAM_EASE);
    Vector3.LerpToRef(this.camAt, goal, k, this.camAt);
    this.camDist += (dist - this.camDist) * k;
    const cam = this.camera as unknown as { setTarget?: (v: Vector3) => void; setPosition?: (v: Vector3) => void; position: Vector3 };
    const eye = this.camAt.add(new Vector3(0, 0.6, -this.camDist));
    cam.setTarget?.(this.camAt);
    if (cam.setPosition) cam.setPosition(eye); else cam.position.copyFrom(eye);
    this.occlude(eye, dt);
  }

  /** Whatever stands between the eye and a fighter, faded out of the way; what no longer does, back. */
  private occlude(eye: Vector3, dt: number): void {
    const inWay = new Set<AbstractMesh>();
    // (Scenery only — its own platforms and hills, the backdrop's meshes — never a fighter or an effect; and not the
    // ground the fighters stand on, which a ray to their feet would graze.)
    const own = new Set<AbstractMesh>(this.meshes);
    const scenery = (m: AbstractMesh) => this.standIns.has(m) || (m.isEnabled() && m.isVisible
      && (own.has(m) || (!!this.scenery && m.isDescendantOf(this.scenery))) && m.getBoundingInfo().boundingBox.maximumWorld.y > 0.05);
    for (const f of this.fighters) {
      for (const k of OCCLUDE_AT) {
        const to = f.node.position.add(new Vector3(0, f.H * k, 0));
        const d = to.subtract(eye), len = d.length();
        const hits = this.scene.multiPickWithRay(new Ray(eye, d.scale(1 / len), len - 0.05), scenery) ?? [];
        for (const h of hits) if (h.pickedMesh) inWay.add(this.standIns.get(h.pickedMesh) ?? h.pickedMesh);
      }
    }
    const k = 1 - Math.exp(-dt * OCCLUDE_EASE);
    for (const m of inWay) if (!this.faded.has(m)) this.faded.set(m, { own: m.visibility, shown: this.standInFor(m) });
    for (const [m, f] of this.faded) {
      const to = inWay.has(m) ? Math.min(f.own, OCCLUDED) : f.own;
      f.shown.visibility += (to - f.shown.visibility) * k;
      if (!inWay.has(m) && Math.abs(f.shown.visibility - f.own) < 0.01) { this.unfade(m, f); this.faded.delete(m); }
    }
  }

  /** What to fade for `m`: itself — or, an instance, a copy of its source in its place (it hidden meanwhile). */
  private standInFor(m: AbstractMesh): AbstractMesh {
    if (m.getClassName() !== 'InstancedMesh') return m;
    const inst = m as InstancedMesh;
    const copy = inst.sourceMesh.clone(`${inst.name}Fade`, inst.parent, true);
    copy.position.copyFrom(inst.position);
    copy.scaling.copyFrom(inst.scaling);
    if (inst.rotationQuaternion) copy.rotationQuaternion = inst.rotationQuaternion.clone(); else { copy.rotationQuaternion = null; copy.rotation.copyFrom(inst.rotation); }
    copy.isPickable = false;
    copy.visibility = 1;
    inst.isVisible = false;
    this.standIns.set(copy, inst);
    return copy;
  }

  /** Back as it was: its own visibility — or, an instance, shown again, its stand-in gone. */
  private unfade(m: AbstractMesh, f: { own: number; shown: AbstractMesh }): void {
    if (f.shown === m) { m.visibility = f.own; return; }
    this.standIns.delete(f.shown);
    f.shown.dispose();
    m.isVisible = true;
  }
}
