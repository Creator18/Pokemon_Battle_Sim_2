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
import * as MorphFx from '../vfx/MorphFx.ts';
import { pokeballMesh } from '../metroidverse/palletTown.ts';
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
import { getMove } from '../../shared/index.ts';
import { Fighter, DEFAULT_KIT, IDLE, hpStat, BODY_W } from './Fighter.ts';
import { Hud } from './Hud.ts';
import { TeamHud } from './TeamHud.ts';
import { kitFor } from './speciesMoves.ts';
import { typeColor } from '../theme.ts';
import type { Arena, Intent, MoveKit, Platform } from './Fighter.ts';
import { BossAI } from './BossAI.ts';
import { backdrop as paintedBackdrop } from '../render/arenas/backdrops.ts';
import type { Backdrop, BackdropName } from '../render/arenas/backdrops.ts';

export type { Platform, MoveKit } from './Fighter.ts';
export { DEFAULT_KIT } from './Fighter.ts';

/** Camera shake: how far at most it jolts (world units, at full trauma), how fast trauma dies away (a second). */
/** How long the foe's circles stay after a fight's won or lost (s), before they slide away. */
/**
 * Floors — never faded to show a fighter: ground and earth, paths, lawns (and their grass), building floors, steps and
 * the stone faces between rises, the beach (by their meshes' names).
 */
const FLOORS = /earth|face|step|path|lawn|floor|beach|tier|seam|grass|ground|rug|mat\b/i;
const ENCOUNTER_LINGER = 1.6;
const SHAKE_MAX = 0.45, SHAKE_DECAY = 1.6;
/** The camera: how far off the plane, how high above the body, how far it leads the way it faces, how quickly it follows. */
const CAM_DIST = 15, CAM_UP = 2.2, CAM_LEAD = 2.5, CAM_EASE = 5;
/** Framing two (a boss fight): pulled back till both fit across its view, with CAM_MARGIN to spare each side (world units); never nearer than CAM_DIST. */
const CAM_MARGIN = 3;
/** The platforms' depth (across the view) and their grass top's thickness. */
const DEPTH = 4, GRASS = 0.18;
/** The Pokéball you are (PlatformerOptions.ball): its size (× your species' height). */
const BALL_SIZE = 0.7;
/** Below this, it has fallen: back to the start. */
const KILL_Y = -12;
/** How much of their own colour the platforms show unlit. */
const LIT_SELF = 0.55;
/**
 * Nothing hides the fighters: whatever lies between the camera and a fighter (rays from the eye to OCCLUDE_AT of its
 * height) fades to OCCLUDED, easing there and back at OCCLUDE_EASE (per s).
 */
const OCCLUDE_AT = [0.25, 0.6, 0.95], OCCLUDED = 0.2, OCCLUDE_EASE = 8;

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
  /** You a Pokéball (before your first Pokémon): your species' body hidden, a Pokéball rolling in its place (Fighter.ball). */
  ball?: boolean;
  /** The rest of your party (after `species`, who leads it), in order — up to six in all. */
  team?: SpeciesDefinition[];
  /**
   * Where you may attack (an attack move — any move that deals damage); elsewhere (a town) it's stopped, and
   * `onNoAttack` told. Everywhere, if not given.
   */
  attacksAllowed?: (x: number, y: number) => boolean;
  onNoAttack?: () => void;
  /**
   * A long level (a town and its route): its scenery drawn only within this far of the camera, along the level (world
   * units) — the rest hidden: not drawn, not culled, not cast into the shadow map. Its scenery static: its transforms
   * frozen. Off (everything drawn), if not given.
   */
  cullRange?: number;
  /**
   * The switch to your Pokémon (X) locked till you have one — your starter (unlockForm); `onFormLocked` told when X is
   * pressed while it is.
   */
  formLocked?: boolean;
  onFormLocked?: () => void;
}

/** Something that happened in a fight (s from its start). */
export interface FightEvent { t: number; text: string }


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
  /** Camera shake (Arena.shake): its trauma (0..1, dying away SHAKE_DECAY a second) and its clock. */
  private trauma = 0;
  private shakeT = 0;
  private clock = 0;
  private hud: Hud | null = null;
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
    this.canBall = !!o.ball; this.formLocked = !!o.formLocked; this.onFormLocked = o.onFormLocked;
    this.attacksAllowed = o.attacksAllowed ?? null; this.onNoAttack = o.onNoAttack ?? null;
    if (o.cullRange && o.scenery) this.setUpCulling(o.scenery, o.cullRange);
    // (Your team, top left: you its first, unless you're a Pokéball still — no Pokémon yet: its circles empty.)
    this.team = new TeamHud();
    if (!o.ball) { this.addMember(o.species); for (const sp of o.team ?? []) this.addMember(sp); }
    this.start = o.start ?? { x: 0, y: 0 };
    const bossAt = this.spots.findIndex((s) => s.boss);
    this.boss = bossAt >= 0 ? foes[bossAt] : null;
    // (Faced with a foe — the boss here: its team's circles slide in, top right.)
    const bossOf = o.enemies?.find((e) => e.boss);
    if (bossOf && this.boss) this.encounter([{ species: bossOf.species, fighter: this.boss }]);
    this.bossSpecies = bossOf?.species ?? null;
    this.ai = this.boss ? new BossAI(this.boss, player) : null;
    this.arena = {
      level: this.level, fighters: this.fighters,
      shake: (t) => { this.trauma = Math.min(1, this.trauma + t); },
      onHit: (by, on, move, dmg) => {
        for (const h of this.hitHooks) h(by, on, move, dmg);
        this.note(`${by.name} ${move} → ${on.name} −${dmg} (${on.hp}/${on.maxHp})`);
        this.hud?.hit(by, on, move);
        if (on.hp <= 0) { this.note(`${on.name} fainted`); this.hud?.call('K.O.!', '#f43f5e'); }
      },
      onBurst: (a, b, ma, mb) => {
        this.note(`point-blank: ${a.name} ${ma} × ${b.name} ${mb} — both burst, both knocked back`);
        this.hud?.call('Point blank!', '#fb923c');
      },
      onClash: (a, b, _w, meet) => { this.note(`clash: ${a.name} ${a.using} × ${b.name} ${b.using} at ${meet}`); this.hud?.call('Clash!', '#fbbf24'); },
      onCounter: (by, on, move, dmg, brace = 'Sucker Punch') => {
        this.note(`${brace.toLowerCase()}: ${by.name} on ${on.name}'s ${move} (${dmg})`);
        this.hud?.call(`${brace}!`, brace === 'Counter' ? typeColor('Fighting') : '#a78bfa');
      },
      onClashEnd: (_a, _b, w, s) => this.note(`clash over → ${w ? `${w.name} wins` : 'tie'}${s ? ` (stops ${Math.round(s.rival * 1000)} / ${Math.round(s.you * 1000)}${s.outright ? ', outright' : ''})` : ''}`),
    };
    // (Its boss's mind sees the arena too: the Stone Edge pillars in it.)
    if (this.ai) this.ai.arena = this.arena;
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
    // (Its HP its species' real HP stat at LEVEL.)
    const player = new Fighter(node, factory, 1, hpStat(o.species.hp), o.moves ?? DEFAULT_KIT, `${o.species.name} (you)`, o.species.types);
    player.attack = o.species.attack; player.spAtk = o.species.spAtk; player.speed = o.species.speed;
    player.defense = o.species.defense; player.spDef = o.species.spDef;
    // (A Pokéball: its body the ball's — BALL_SIZE × its species' height across.)
    if (o.ball) player.makeBall(player.H * BALL_SIZE);
    const foes: Fighter[] = [];
    for (const e of o.enemies ?? []) {
      const n = await factory.createPokemon(e.species, 2);
      foes.push(e.boss
        ? new Fighter(n, factory, 2, hpStat(e.species.hp), e.moves ?? DEFAULT_KIT, `${e.species.name} (boss)`, e.species.types)
        : new Fighter(n, factory, 2, hpStat(e.species.hp), {}, e.species.name, e.species.types, { x: e.x, y: e.y }));
      foes[foes.length - 1].attack = e.species.attack; foes[foes.length - 1].spAtk = e.species.spAtk; foes[foes.length - 1].speed = e.species.speed;
      foes[foes.length - 1].defense = e.species.defense; foes[foes.length - 1].spDef = e.species.spDef;
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
    this.hud?.dispose();
    this.team.dispose();
    this.foeTeam?.dispose();
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
    // (Fought again: faced with the boss again.)
    if (this.boss && this.bossSpecies && !this.foeTeam) this.encounter([{ species: this.bossSpecies, fighter: this.boss }]);
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

  // ── the HUD ──────────────────────────────
  private buildHud(): void {
    this.hud = new Hud(this.player, this.boss!);
  }

  private updateHud(dt: number): void {
    this.hud?.update(dt, this.time, this.result);
    this.team.update(dt);
    this.foeTeam?.update(dt);
  }

  // ── input ──────────────────────────────
  private key(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    const down = e.type === 'keydown';
    if (['a', 'd', 'w', 's', ' ', 'u', 'i', 'j', 'k', 'l', 'r', 'q', 'e', 'x', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)) e.preventDefault();
    if (down && !this.keys.has(k)) {
      this.pressed.add(k);
      if (k === 'r' && this.result) this.restart();
      // (Q / E: the previous / next of your party picked, round and round; X: to it — or, it the one out already,
      // and no fight on, into your Pokéball and back.)
      if (k === 'q') this.pick(-1);
      if (k === 'e') this.pick(1);
      if (k === 'x') this.pressX();
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
      ranged: hit('u'), close: hit('i'), mobility: hit('j'), control: hit('k'), dash: hit('l'),
    };
    this.pressed.clear();
    return i;
  }

  // ── a frame ──────────────────────────────
  /** You as a Pokéball (PlatformerOptions.ball): its body (your species' hidden), where it last was (it rolls by how far it went). */
  private pokeball: Mesh | null = null;
  private ballLastX = NaN;
  private makePokeball(): void {
    const node = this.player.node;
    // (Your species' body hidden, and casting no shadow: the Pokéball in its place.)
    const shadowGen = (this.scene.metadata as { shadowGen?: { removeShadowCaster(m: AbstractMesh): void; addShadowCaster(m: AbstractMesh): void } } | undefined)?.shadowGen;
    for (const m of node.getChildMeshes()) { m.isVisible = false; shadowGen?.removeShadowCaster(m); }
    const d = this.player.H;
    this.pokeball = pokeballMesh(this.scene, d);
    shadowGen?.addShadowCaster(this.pokeball);
    this.meshes.push(this.pokeball);
  }
  /** The Pokéball where you are, rolled by how far you went (its surface not slipping on the ground), its button toward the camera. */
  private rollPokeball(): void {
    const b = this.pokeball!, p = this.player.node.position, r = this.player.H / 2;
    // (A hair above where it stands: resting on the floor, never into it.)
    b.position.set(p.x, p.y + r + 0.005, p.z);
    if (!Number.isNaN(this.ballLastX)) b.rotation.z -= (p.x - this.ballLastX) / r;
    this.ballLastX = p.x;
  }

  // ── Pokéball and Pokémon (X) ──────────────────────────────
  /** You may turn Pokéball and back (PlatformerOptions.ball); mid-turn (its light playing: you hold still till it's done). */
  private canBall = false;
  /** Your team's circles, top left (TeamHud): each its Pokémon's sprite, its HP a ring round it. */
  readonly team: TeamHud;
  /** The foe's team's circles, top right — only while you face a trainer or a wild Pokémon (encounter … endEncounter). */
  private foeTeam: TeamHud | null = null;
  private bossSpecies: SpeciesDefinition | null = null;
  /**
   * Faced with a foe — a trainer (its team, in order) or a wild Pokémon (just it): its circles slide in, top right, each
   * with its HP ring (from its fighter, if it's out; else full).
   */
  encounter(team: { species: SpeciesDefinition; fighter?: Fighter }[]): void {
    this.foeTeam?.dispose();
    const hud = this.foeTeam = new TeamHud('right', true);
    for (const m of team) {
      const f = m.fighter;
      hud.add(m.species.name, m.species.spriteId, f ? () => f.hp / f.maxHp : () => 1, m.species.types);
    }
  }
  /** The encounter over (won, lost, fled): the foe's circles slide away. */
  endEncounter(): void { this.foeTeam?.leave(); this.foeTeam = null; }
  /**
   * The camera held on a point (`at`, `dist` back) — the starter's choosing: close on your Pokéball — not following.
   */
  focus: { at: Vector3; dist: number } | null = null;
  /**
   * Your starter: its body yours from now on (`species` — made, hidden in your Pokéball), its stats, and the switch to
   * it (X) unlocked.
   */
  async giveStarter(species: SpeciesDefinition): Promise<void> {
    const p = this.player, old = p.node;
    const node = await this.factory.createPokemon(species, 1);
    const sh = this.shadows();
    if (p.ball) for (const m of node.getChildMeshes()) { m.isVisible = false; sh?.removeShadowCaster(m); }
    p.takeBody(node, `${species.name} (you)`, species.types, hpStat(species.hp));
    p.attack = species.attack; p.spAtk = species.spAtk; p.speed = species.speed;
    p.defense = species.defense; p.spDef = species.spDef;
    p.setMoves(kitFor(species.name));
    this.factory.remove(old);
    this.unlockForm();
    this.activeIdx = this.addMember(species);
    this.team.setActive(this.activeIdx); this.selIdx = this.activeIdx; this.team.select(this.selIdx);
  }
  // ── foes that come and go (wild Pokémon), each with its own mind ──────────────────────────────
  /** Each foe's own mind (a wild one's: wandering, or fighting back), by its fighter. */
  private readonly brains = new Map<Fighter, () => Intent>();
  /** Told of every blow landed (who, on whom, with what, how much). */
  readonly hitHooks: ((by: Fighter, on: Fighter, move: string, dmg: number) => void)[] = [];
  /** A foe into the level (a wild Pokémon), its intent each frame from `brain`. */
  addFoe(f: Fighter, brain: () => Intent): void { this.fighters.push(f); this.brains.set(f, brain); }
  /** A foe gone from the level (caught, or its body despawned). */
  removeFoe(f: Fighter): void {
    const i = this.fighters.indexOf(f);
    if (i > 0) this.fighters.splice(i, 1);
    this.brains.delete(f);
    f.beam?.play.cancel?.(true); f.beam = null;
    this.factory.remove(f.node);
  }
  get foes(): readonly Fighter[] { return this.fighters.slice(1); }
  /** Where the camera looks (its target, before any shake). */
  get focusPoint(): Vector3 { return this.camAt; }
  /** The arena its fighters fight in (for a foe's own AI). */
  get fightArena(): Arena { return this.arena; }
  /** The scene and factory (for what's built round the level: its wild Pokémon). */
  get world(): { scene: Scene; factory: RecipeFactory } { return { scene: this.scene, factory: this.factory }; }

  // ── drawing only what's near ──────────────────────────────
  /** The scenery culled by range: each mesh, its span along the level, whether it's shown now. */
  private culled: { m: AbstractMesh; x0: number; x1: number; on: boolean }[] = [];
  private cullRange = 0;
  private setUpCulling(root: TransformNode, range: number): void {
    this.cullRange = range;
    for (const m of root.getChildMeshes(false)) {
      // (Only what's shown to begin with — never showing what was hidden on purpose.)
      if (!m.isVisible) continue;
      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo().boundingBox;
      this.culled.push({ m, x0: bb.minimumWorld.x, x1: bb.maximumWorld.x, on: true });
      // (Static: its transform worked out once, never again.)
      m.freezeWorldMatrix();
    }
  }
  /** Each frame: the scenery within range of the camera shown, the rest hidden. */
  private cull(): void {
    if (!this.culled.length) return;
    const cx = this.camAt.x, r = this.cullRange;
    for (const c of this.culled) {
      const on = c.x1 > cx - r && c.x0 < cx + r;
      if (on !== c.on) { c.on = on; c.m.isVisible = on; }
    }
  }

  // ── where you may attack ──────────────────────────────
  private attacksAllowed: ((x: number, y: number) => boolean) | null = null;
  private onNoAttack: (() => void) | null = null;
  /** A move that deals damage (an attack): stopped where attacks aren't allowed. */
  private static isAttack(move: string | undefined): boolean {
    if (!move) return false;
    if (move === 'Thunderbolt') return true;
    return (getMove(move)?.basePower ?? 0) > 0;
  }
  /** Its attack buttons let go where attacks aren't allowed (a town) — and Prof. Oak's word on it. */
  private stopAttacks(i: Intent): Intent {
    if (!this.attacksAllowed || this.attacksAllowed(this.player.x, this.player.y)) return i;
    const k = this.player.moves;
    const out = { ...i };
    let stopped = false;
    if (i.ranged && Platformer.isAttack(k.ranged)) { out.ranged = false; stopped = true; }
    if (i.close && Platformer.isAttack(k.close)) { out.close = false; stopped = true; }
    if (i.mobility && Platformer.isAttack(k.mobility)) { out.mobility = false; stopped = true; }
    if (i.control && Platformer.isAttack(k.control)) { out.control = false; stopped = true; }
    if (stopped) this.onNoAttack?.();
    return out;
  }

  // ── your party ──────────────────────────────
  /** Your party, in order: each one's species and its HP (kept while it's not out — the one out's is the fighter's). */
  private party: { species: SpeciesDefinition; hp: number; maxHp: number }[] = [];
  /** The one out (you, now), and the one picked (Q / E). */
  private activeIdx = 0; private selIdx = 0;
  /** One more in your party: its circle filled (its HP ring the fighter's while it's out). Its place, or -1 (full). */
  private addMember(species: SpeciesDefinition): number {
    if (this.party.length >= 6) return -1;
    const max = hpStat(species.hp), m = { species, hp: max, maxHp: max };
    this.party.push(m);
    const i = this.party.length - 1;
    this.team.add(species.name, species.spriteId, () => (i === this.activeIdx ? this.player.hp / this.player.maxHp : m.hp / m.maxHp), species.types);
    return i;
  }
  /** Give you another Pokémon (into your party's next place). */
  addToTeam(species: SpeciesDefinition): number { return this.addMember(species); }
  /** In a fight: faced with a trainer or a wild Pokémon (its circles up), not yet won or lost. */
  get inBattle(): boolean { return !!this.foeTeam && !this.result; }
  /** Q / E: the previous / next one picked, round the party. */
  private pick(step: number): void {
    const n = this.party.length;
    if (n < 2 || this.morphing) return;
    this.selIdx = (this.selIdx + step + n) % n;
    this.team.select(this.selIdx);
  }
  /**
   * X: the one picked sent out in place of the one out (recalled, red, into its ball; the other out of it, white) — or,
   * the one picked the one out already, and no fight on: into your Pokéball, or out of it.
   */
  private pressX(): void {
    if (this.morphing) return;
    if (this.formLocked) { this.onFormLocked?.(); return; }
    if (!this.party.length) return;
    if (this.selIdx !== this.activeIdx) { void this.swapTo(this.selIdx); return; }
    if (this.canBall && !this.inBattle) this.toggleForm();
  }
  /** Send out party member `i` in place of the one out. */
  private async swapTo(i: number): Promise<void> {
    const p = this.player, scene = this.scene, cur = this.party[this.activeIdx], next = this.party[i];
    this.morphing = true;
    const node = await this.factory.createPokemon(next.species, 1);
    const sh = this.shadows();
    const fresh = node.getChildMeshes();
    for (const m of fresh) { m.isVisible = false; sh?.removeShadowCaster(m); }
    const H = this.factory.heightOf(node), W = H * BODY_W;
    const wasBall = p.ball;
    // (No room for it where you are — under a low tread: it stays in its ball.)
    if (!wasBall && !p.fitsBody(this.arena, H, W)) {
      this.factory.remove(node); this.morphing = false;
      MorphFx.flash(scene, this.heart(), p.H * 0.5, 'recall');
      return;
    }
    cur.hp = p.hp; cur.maxHp = p.maxHp;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const backOut = (t: number) => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
    const run = (secs: number, f: (u: number) => void) => new Promise<void>((done) => {
      let t = 0;
      const obs = scene.onBeforeRenderObservable.add(() => {
        t += scene.getEngine().getDeltaTime() / 1000;
        const u = Math.min(1, t / secs); f(u);
        if (u >= 1) { scene.onBeforeRenderObservable.remove(obs); done(); }
      });
    });
    const old = p.node, oldBase = old.scaling.clone();
    if (!wasBall) {
      // The one out recalled: washed red, the light drawing it in, shrinking away.
      const meshes = this.bodyMeshes();
      MorphFx.gather(scene, this.heart(), p.H * 1.1, 0.4, 'recall');
      for (const m of meshes) { m.renderOverlay = true; m.overlayColor = new Color3(1, 0.22, 0.2); m.overlayAlpha = 0; }
      await run(0.25, (u) => { for (const m of meshes) m.overlayAlpha = ease(u); });
      await run(0.22, (u) => old.scaling.copyFrom(oldBase.scale(Math.max(0.02, 1 - ease(u)))));
      MorphFx.flash(scene, this.heart(), p.H * 0.5, 'recall');
    }
    // Its body yours: its HP as it was left, its stats.
    p.takeBody(node, `${next.species.name} (you)`, next.species.types, next.maxHp);
    p.hp = next.hp;
    p.attack = next.species.attack; p.spAtk = next.species.spAtk; p.speed = next.species.speed;
    p.defense = next.species.defense; p.spDef = next.species.spDef;
    p.setMoves(kitFor(next.species.name));
    this.factory.remove(old);
    this.activeIdx = i; this.team.setActive(i);
    if (wasBall) {
      // (Out of your Pokéball as it, the usual way.)
      this.morphing = false;
      this.toggleForm();
      return;
    }
    // The one picked sent out: a white burst, it there white with the light, growing to its size as the light fades.
    const base = node.scaling.clone(), at = () => this.heart(H);
    MorphFx.flash(scene, at(), H * 0.9, 'open');
    for (const m of fresh) { m.isVisible = true; sh?.addShadowCaster(m); m.renderOverlay = true; m.overlayColor = new Color3(1, 1, 1); m.overlayAlpha = 1; }
    node.scaling.copyFrom(base.scale(0.15));
    MorphFx.glow(scene, at, H * 0.6, 0.6, 'open');
    await run(0.5, (u) => { node.scaling.copyFrom(base.scale(0.15 + 0.85 * backOut(u))); for (const m of fresh) m.overlayAlpha = 1 - ease(u); });
    node.scaling.copyFrom(base);
    for (const m of fresh) { m.renderOverlay = false; m.overlayAlpha = 0; }
    this.morphing = false;
  }

  /** No Pokémon yet (your starter not chosen): X does nothing but say so. */
  private formLocked = false;
  private onFormLocked?: () => void;
  /** Your starter chosen: X turns you Pokéball ↔ Pokémon from now on. */
  unlockForm(): void { this.formLocked = false; }
  get formUnlocked(): boolean { return this.canBall && !this.formLocked; }
  private morphing = false;
  /** Your Pokémon's meshes: shown, hidden, washed in light (their overlay) as it comes out or goes back. */
  private bodyMeshes(): AbstractMesh[] { return this.player.node.getChildMeshes(); }
  private shadows(): { removeShadowCaster(m: AbstractMesh): void; addShadowCaster(m: AbstractMesh): void } | undefined {
    return (this.scene.metadata as { shadowGen?: { removeShadowCaster(m: AbstractMesh): void; addShadowCaster(m: AbstractMesh): void } } | undefined)?.shadowGen;
  }
  /** Where the light is: the middle of you as you are now. */
  private heart(h = this.player.H): Vector3 { const p = this.player.node.position; return new Vector3(p.x, p.y + h / 2, p.z); }

  /**
   * Pokéball to Pokémon, or back (X). Out: the ball shakes and glows, light gathering into it — it bursts open in a
   * flash, your Pokémon there in its place, white with the light, growing to its size as the light fades off it.
   * Back: your Pokémon washes red, the light drawing it in, it shrinks away into the ball — closing with a flash. (No
   * room to stand where the ball is — under a low tread: it only fizzles.)
   */
  private toggleForm(): void {
    if (this.morphing || !this.pokeball) return;
    const p = this.player, scene = this.scene;
    const node = p.node, base = node.scaling.clone();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const backOut = (t: number) => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
    const run = (secs: number, f: (u: number) => void) => new Promise<void>((done) => {
      let t = 0;
      const obs = scene.onBeforeRenderObservable.add(() => {
        t += scene.getEngine().getDeltaTime() / 1000;
        const u = Math.min(1, t / secs); f(u);
        if (u >= 1) { scene.onBeforeRenderObservable.remove(obs); done(); }
      });
    });
    const ball = this.pokeball, ballD = p.H;
    if (p.ball) {
      if (!p.unBall(this.arena)) { MorphFx.flash(scene, this.heart(), ballD * 0.5, 'recall'); return; }
      // (Its body back already — its collision the Pokémon's — though you see the ball a moment yet.)
      this.morphing = true;
      const h = p.H, at = () => this.heart(h);
      p.ball = true; // (held a ball for the light's sake: no flight, no dash, till it's out)
      MorphFx.gather(scene, this.heart(ballD), ballD * 1.6, 0.4, 'open');
      // (All its pieces' materials — shell, cap, band, button — glowing white together.)
      const mats = [...new Set([ball, ...ball.getChildMeshes()].map((m) => m.material as StandardMaterial).filter((m) => !!m?.emissiveColor))];
      const glow0 = mats.map((m) => m.emissiveColor.clone());
      void run(0.4, (u) => {
        // (It shakes, swelling a little, glowing white.)
        ball.rotation.x = Math.sin(u * 40) * 0.18 * u;
        ball.scaling.setAll(1 + 0.18 * u * u);
        for (const [k, m] of mats.entries()) m.emissiveColor = Color3.Lerp(glow0[k], Color3.White(), u);
      }).then(() => {
        MorphFx.flash(scene, at(), h * 0.9, 'open');
        ball.setEnabled(false); ball.scaling.setAll(1); ball.rotation.x = 0; for (const [k, m] of mats.entries()) m.emissiveColor = glow0[k];
        const meshes = this.bodyMeshes(), sh = this.shadows();
        for (const m of meshes) { m.isVisible = true; sh?.addShadowCaster(m); m.renderOverlay = true; m.overlayColor = new Color3(1, 1, 1); m.overlayAlpha = 1; }
        node.scaling.copyFrom(base.scale(0.15));
        MorphFx.glow(scene, at, h * 0.6, 0.7, 'open');
        return run(0.55, (u) => {
          node.scaling.copyFrom(base.scale(0.15 + 0.85 * backOut(u)));
          for (const m of meshes) m.overlayAlpha = 1 - ease(u);
        });
      }).then(() => {
        node.scaling.copyFrom(base);
        for (const m of this.bodyMeshes()) { m.renderOverlay = false; m.overlayAlpha = 0; }
        p.ball = false; this.morphing = false;
      });
    } else {
      this.morphing = true;
      const h = p.H, meshes = this.bodyMeshes(), sh = this.shadows();
      const d = (p as unknown as { form?: { H: number } }).form?.H ?? h;
      MorphFx.gather(scene, this.heart(h), h * 1.1, 0.45, 'recall');
      for (const m of meshes) { m.renderOverlay = true; m.overlayColor = new Color3(1, 0.22, 0.2); m.overlayAlpha = 0; }
      void run(0.3, (u) => { for (const m of meshes) m.overlayAlpha = ease(u); })
        .then(() => run(0.25, (u) => { node.scaling.copyFrom(base.scale(Math.max(0.02, 1 - ease(u)))); }))
        .then(() => {
          for (const m of meshes) { m.isVisible = false; m.renderOverlay = false; sh?.removeShadowCaster(m); }
          node.scaling.copyFrom(base);
          p.makeBall(d * BALL_SIZE);
          this.ballLastX = NaN; this.rollPokeball();
          ball.setEnabled(true); ball.scaling.setAll(0.3);
          MorphFx.flash(scene, this.heart(), p.H * 0.6, 'recall');
          return run(0.25, (u) => ball.scaling.setAll(0.3 + 0.7 * backOut(u)));
        })
        .then(() => { ball.scaling.setAll(1); this.morphing = false; });
    }
  }

  private step(dt: number): void {
    if (dt <= 0) return;
    this.clock += dt;
    const over = !!this.result;
    // (Mid-turn — Pokéball to Pokémon or back: held still till its light is done.)
    this.player.step(dt, over || this.morphing ? IDLE : this.stopAttacks(this.playerIntent()), this.arena);
    if (over || this.morphing) this.pressed.clear();
    for (const f of this.fighters.slice(1)) {
      // A boss thinks; a practice target turns to watch the player.
      const brain = this.brains.get(f);
      const intent = brain ? brain() : f === this.boss && this.ai ? (over ? IDLE : this.ai.think()) : { ...IDLE, face: Math.sign(this.player.x - f.x) || f.facing };
      f.step(dt, intent, this.arena);
    }
    for (const f of this.fighters) {
      if (!f.fellOut(KILL_Y)) continue;
      if (f === this.player) f.place(this.start.x, this.start.y, 1);
      else { const s = this.spots[this.fighters.indexOf(f) - 1]; if (s) f.place(s.x, s.y, -1); else f.place(f.x, 4, f.facing); }
    }
    if (this.boss && !this.result) {
      if (this.boss.down) { this.result = 'won'; this.endedAt = this.clock; this.note('you win'); }
      else if (this.player.down) { this.result = 'lost'; this.endedAt = this.clock; this.note('you lose'); }
      // (The fight over: the foe's circles slide away a moment after.)
      if (this.result) { const hud = this.foeTeam; setTimeout(() => { if (this.foeTeam === hud) this.endEncounter(); }, ENCOUNTER_LINGER * 1000); }
    }
    this.updateHud(dt);
    if (this.player.ball && !this.pokeball) this.makePokeball();
    if (this.pokeball?.isEnabled()) this.rollPokeball();
    this.follow(dt);
    this.cull();
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
    } else if (this.focus) {
      goal = this.focus.at.clone(); dist = this.focus.dist;
    } else {
      goal = new Vector3(p.x + this.player.facing * CAM_LEAD, p.y + CAM_UP, 0);
    }
    const k = 1 - Math.exp(-dt * CAM_EASE);
    Vector3.LerpToRef(this.camAt, goal, k, this.camAt);
    this.camDist += (dist - this.camDist) * k;
    const cam = this.camera as unknown as { setTarget?: (v: Vector3) => void; setPosition?: (v: Vector3) => void; position: Vector3 };
    // (Shaken: trauma squared, in smooth noise — target and eye together, the view jolting, not swinging round.)
    this.trauma = Math.max(0, this.trauma - SHAKE_DECAY * dt);
    this.shakeT += dt;
    const amp = this.trauma * this.trauma * SHAKE_MAX;
    const n = (k: number) => Math.sin(this.shakeT * 37 + k) * 0.6 + Math.sin(this.shakeT * 61 + k * 2.3) * 0.4;
    const jolt = new Vector3(n(1.1) * amp, n(4.7) * amp, 0);
    const at = this.camAt.add(jolt);
    const eye = at.add(new Vector3(0, 0.6, -this.camDist));
    cam.setTarget?.(at);
    if (cam.setPosition) cam.setPosition(eye); else cam.position.copyFrom(eye);
    this.occlude(eye, dt);
  }

  /** Whatever stands between the eye and a fighter, faded out of the way; what no longer does, back. */
  private occlude(eye: Vector3, dt: number): void {
    const inWay = new Set<AbstractMesh>();
    // (Scenery only — its own platforms and hills, the backdrop's meshes — never a fighter or an effect; and not the
    // ground the fighters stand on, which a ray to their feet would graze.)
    const own = new Set<AbstractMesh>(this.meshes);
    // (Nor the Pokéball you are: it is a fighter's body, though it is one of the level's own meshes.)
    const ball = this.pokeball;
    const scenery = (m: AbstractMesh) => this.standIns.has(m) || (m !== ball && !(ball && m.isDescendantOf(ball)) && !(m.metadata as { noOcclude?: boolean } | null)?.noOcclude && !FLOORS.test(m.name) && m.isEnabled() && m.isVisible
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
