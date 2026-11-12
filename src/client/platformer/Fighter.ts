/**
 * A fighter in the side-on platformer: one Pokémon's body (its real model and clips) on the plane z = 0 — how it runs,
 * jumps, flies and is pushed about — and its moves (MoveKit), each played by the factory, landing on the fighters of
 * the other side. The player steers one with the keys; a BossAI steers another; a practice target only watches.
 *
 * Every frame it is handed an Intent (which way it wants to go, its jump, the moves pressed this frame) and moves by it:
 * running eases to RUN_SPEED; a jump launches at JUMP_SPEED and is cut short when let go early (JUMP_CUT); COYOTE s of
 * grace after running off a ledge, and a press up to BUFFER s before landing still jumps. Gravity GRAVITY, falling no
 * faster than FALL_MAX. Its box against the level is BODY_W × its height wide; against other fighters it is its real
 * body (its skin's reach ahead and behind, wings and tail and all): two bodies never overlap.
 *
 * Its aim (Intent.aim: up +1, level 0, down −1 — W / S for the player): it looks that way (its neck and head turned
 * AIM_ANGLE up or down, RecipeFactory.setGaze), and its moves that need a way go that way.
 * In the air (jumping or flying) its clips are its air clips, its moves and flinches too (RecipeFactory.setAirborne) —
 * never a standing pose aloft.
 *
 * Its moves, one per role:
 *   ranged    a beam the way it faces, along its aim — at the first foe its line meets within range, else out to its range
 *   close     a slash where it stands, along its aim (Dragon Claw) — it lands on a foe within reach that way, else misses
 *   mobility  Quick Attack the way it faces — along its aim when aloft (or aimed up off the ground) — QUICK_DIST on,
 *             short of a wall, or up to a foe in the way (struck); or 'Dash', a plain dash with afterimages; or
 *             a teleport (TELEPORTS: 'Teleport', magical, a ring) — gone and there TELEPORT_DIST along its aim
 *             (through a body, not into one or a wall), facing its nearest foe as it arrives; or a strike from
 *             behind (BEHIND_STRIKES: Feint, Sucker Punch, Shadow Sneak) — gone and back right behind the nearest foe
 *             within FEINT_RANGE (at its height, facing it), and a blow at once (none in range: just the vanish)
 *   control   a buff, debuff or status (none yet)
 * Struck, it is held (no moving, no moves) for as long as its flinch lasts — and a beam it was charging or pouring is cut
 * off; out of HP it faints — and a practice target (`respawn`) stands again after RESPAWN s. A blow's damage: its move's
 * power × its type's effectiveness on the target's types × the same-type bonus (STAB), ÷ DAMAGE_SCALE.
 *
 * Beam duels: a beam takes BEAM_CHARGE s to launch, then its front FRONT_TIME s to cross. Too close to clash (their
 * mouths nearer than CLASH_MIN × their height), the two burst point-blank between them at once, and both are knocked
 * back (KNOCK_SPEED, flinching till they come down). Else, firing at a foe whose beam at it has not launched yet, the
 * two CLASH — where their fronts would meet, given the head start (the later one's front
 * meets the earlier's nearer its own mouth) — and the stronger (power × effectiveness × STAB) pushes through
 * (CLASH_TIE: within this share of each other, a tie: both burst). Its beam already out, the foe's reaches it before it
 * can fire: it is struck, and its own beam cut off.
 */
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { RecipeFactory } from '../render/RecipeFactory.ts';
import type { BeamPlay } from '../render/unitFactory.ts';
import { beamFor } from '../vfx/beam/beamMoves.ts';
import type { BeamSpec } from '../vfx/beam/beamMoves.ts';
import { getMove, getTypeEffectiveness } from '../../shared/index.ts';

/** A platform: its left edge, its top, its width, its depth below its top (world units); `hidden`: solid but not drawn. */
export interface Platform { x: number; top: number; w: number; h: number; hidden?: boolean }

/**
 * Its moves, one per role (U ranged, I close, J mobility, K control for the player). Unset: none in that slot.
 * Ranged: a beam move (beamMoves). Close: a slash (CLOSE_MOVES). Mobility: 'Quick Attack' or 'Dash'. Control: none built yet.
 */
export interface MoveKit { ranged?: string; close?: string; mobility?: string; control?: string }
/** Charizard's, for now. */
export const DEFAULT_KIT: MoveKit = { ranged: 'Flamethrower', close: 'Dragon Claw', mobility: 'Quick Attack' };

/**
 * What it wants this frame: which way (−1, 0, 1), its jump (held; pressed this frame — flying: held, it rises; let go, it
 * glides down; `sink`, it drops faster), where it aims (up +1, level 0, down −1), the moves pressed this frame, and which
 * way to face when it isn't going anywhere.
 */
export interface Intent {
  want: number; jumpHeld: boolean; jumpPressed: boolean; sink: boolean; aim: number;
  ranged: boolean; close: boolean; mobility: boolean; control: boolean;
  face?: number;
}
export const IDLE: Intent = { want: 0, jumpHeld: false, jumpPressed: false, sink: false, aim: 0, ranged: false, close: false, mobility: false, control: false };

/** What a fighter lives in: its level, every fighter in it, and who is told of each blow. */
export interface Arena {
  level: Platform[];
  fighters: Fighter[];
  /** A blow landed: who by, on whom, with what, for how much. */
  onHit?(by: Fighter, on: Fighter, move: string, damage: number): void;
  /** Two beams met: the earlier one's, the later one's, who wins (none: a tie), where (the earlier's share of the way). */
  onClash?(first: Fighter, second: Fighter, winner: Fighter | null, meet: number): void;
  /** Two beams let go too close to clash: both burst point-blank (who, with what). */
  onBurst?(a: Fighter, b: Fighter, moveA: string, moveB: string): void;
}

/** Movement (world units, seconds): run speed and how fast it is reached, jump, gravity, fastest fall. */
const RUN_SPEED = 7, RUN_ACCEL = 40, AIR_ACCEL = 22, JUMP_SPEED = 13.5, GRAVITY = 34, FALL_MAX = 24;
/** A jump let go early: its rise cut to this much. Grace after a ledge, and a press remembered before landing (s). */
const JUMP_CUT = 0.45, COYOTE = 0.1, BUFFER = 0.12;
/** Its box against the level: its width (× its height). */
export const BODY_W = 0.45;
/** Flying: its speed across, how fast it rises and sinks, and how quickly it gets to them. */
const FLY_SPEED = 9, FLY_RISE = 7, FLY_SINK = 8, FLY_GLIDE = 2.6, FLY_ACCEL = 30;
/** Its aim up or down (radians from level, at full aim). */
export const AIM_ANGLE = 0.6;
/** A dash: how fast, how long (s), how long before the next; its afterimages — how often (s), how strong. */
const DASH_SPEED = 24, DASH_TIME = 0.18, DASH_COOL = 0.35, DASH_GHOST_EVERY = 0.03, DASH_GHOST = 0.55;
/** Quick Attack: how far it goes (× its height), how long before the next (s), and the gap it leaves before a foe (world units). */
export const QUICK_DIST = 3.2;
const QUICK_COOL = 0.4, QUICK_GAP = 0.08;
/** A teleport: how far (× its height), how long before the next (s). */
const TELEPORT_DIST = 3.6, TELEPORT_COOL = 0.5;
/**
 * The moves that play as a teleport, and their look: magical — a ring and a flare ('ring': Teleport) — or physical —
 * a vanish into flickering speed lines along the way it goes, back in along the way it will face ('lines').
 */
export const TELEPORTS: Record<string, 'lines' | 'ring'> = { 'Teleport': 'ring' };
/**
 * The moves that vanish and strike from behind: their teleport's look (its ring in their type's colours), and their
 * blow's type. Feint and Sucker Punch physical (speed lines), Shadow Sneak a Ghost's ring. Every one catches its foe
 * unawares: it can't turn round to face its striker till the blow has landed (turnLocks).
 */
export const BEHIND_STRIKES: Record<string, { look: 'lines' | 'ring'; type: string; midStrike?: boolean; plain?: boolean }> = {
  // (Feint arrives already striking: its blow under way as it appears — a plain blow, its attack clip and a burst on
  // contact, no slash drawn, as Quick Attack's.)
  'Feint': { look: 'lines', type: 'Normal', midStrike: true, plain: true },
  'Sucker Punch': { look: 'lines', type: 'Dark' },
  'Shadow Sneak': { look: 'ring', type: 'Ghost' },
};
/** A strike from behind: how far off a foe may be for it to vanish to behind it (× its height), and the gap it leaves behind it (world units). */
const FEINT_RANGE = 5, FEINT_GAP = 0.1;
/** Landing in a body, how much further it may go to land past it (× its reach). */
const TELEPORT_PAST = 1.6;
/** Bodies: measured over BODY_FRAMES frames after BODY_SETTLE (its skin first drawn where it was made), a reach at most BODY_MAX × its height. */
const BODY_FRAMES = 20, BODY_SETTLE = 4, BODY_MAX = 1.6;
/** The close moves it knows how to play: their type (the slash's colours). */
const CLOSE_MOVES: Record<string, string> = { 'Dragon Claw': 'Dragon' };
/** A close move's reach ahead (× its height plus half the foe's): how far its slash lands. */
export const CLOSE_REACH = 0.9;
/** A beam's reach when it has none of its own (world units); a foe's near side from its middle (× its height): where a level beam stops on it. */
export const BEAM_REACH = 14;
const FOE_NEAR = 0.3;
/** A blow's damage: power × effectiveness × STAB, ÷ this (HP; a move it doesn't know: DAMAGE_UNKNOWN). */
const DAMAGE_SCALE = 5, DAMAGE_UNKNOWN = 8;
/** A beam: its charge before it launches, its front's crossing (s — RecipeFactory's BEAM_CHARGE, BeamFx's GROW). */
const BEAM_CHARGE = 1.1, FRONT_TIME = 0.6;
/** A clash within this share of each other's strength: a tie. Nearer than CLASH_MIN × their height (mouth to mouth): no clash — a burst in both their faces. */
const CLASH_TIE = 0.1, CLASH_MIN = 2.4;
/** Knocked back: how fast it is thrown (world units/s), how high, how long it is out of its own control (s), how quickly the throw dies away (per s). */
const KNOCK_SPEED = 11, KNOCK_UP = 5, KNOCK_TIME = 0.45, KNOCK_DRAG = 3;
/** A practice target: how long it lies fainted before it stands again (s). */
const RESPAWN = 3;

/** A body's reach ahead of where it stands and behind it, along the way it faces (world units). */
interface Reach { front: number; back: number }
/** A beam it is firing: its play, its move and spec, who it is aimed at, when it was pressed, whether it has launched. */
interface Firing { id: number; play: BeamPlay; move: string; spec: BeamSpec; at: Fighter | null; pressedAt: number; launched: boolean;
  /** Its line: from (x, y), the way (unit), how far. */
  from: [number, number]; dir: [number, number]; range: number }
let beamIds = 0;

export class Fighter {
  readonly H: number; readonly W: number;
  readonly moves: MoveKit;
  hp: number; down = false;
  vx = 0; vy = 0; grounded = false; facing = 1; flying = false;
  /** Its aim now (up +1, level 0, down −1). */
  aim = 0;
  /** Using a move (a beam pouring, a slash: it holds its ground); mid Quick Attack (the step moves it); held by a blow. */
  firing = false; quick = false; stunned = false;
  /** What it is using now (its name), and since when (s, its own clock). */
  using = ''; usingSince = 0;
  time = 0;
  private sinceGround = 0; private sinceJumpPress = Infinity; private jumpHeld = false;
  private clip = ''; private landing = 0;
  private readonly canFly: boolean;
  private dashT = 0; private dashCool = 0; private ghostT = 0; private airDash = true; private quickCool = 0;
  private reach: Reach | null = null; private measured = 0;
  /** Its beam out now (charging or pouring), if any. */
  beam: Firing | null = null;
  /** Thrown back (s left): out of its own control, the throw dying away. */
  private knockT = 0;
  /** Caught unawares (a strike from behind on it, till its blow lands): it can't turn round to face its striker. */
  turnLocks = 0;

  constructor(readonly node: TransformNode, private readonly factory: RecipeFactory, readonly team: number,
    readonly maxHp: number, moves: MoveKit, readonly name: string, readonly types: readonly string[],
    readonly respawn: { x: number; y: number } | null = null) {
    this.moves = { ...moves };
    this.hp = maxHp;
    this.H = factory.heightOf(node);
    this.W = this.H * BODY_W;
    this.canFly = !!factory.playerOf(node)?.has('airIdle');
  }

  get x(): number { return this.node.position.x; }
  get y(): number { return this.node.position.y; }
  /** Busy: in a move, mid step, held, or down — it takes no new move. */
  get busy(): boolean { return this.firing || this.quick || this.stunned || this.down || this.dashT > 0; }
  /** Where its mouth is (its beams' height). */
  get mouthY(): number { return this.factory.mouthAt(this.node).y; }
  /** Its ranged move's reach. */
  get beamRange(): number { const s = this.moves.ranged ? beamFor(this.moves.ranged) : null; return s?.range ?? BEAM_REACH; }

  /** Put somewhere, still, facing `dir`. */
  place(x: number, y: number, dir: number): void {
    this.node.position.set(x, y, 0);
    this.vx = 0; this.vy = 0; this.flying = false; this.dashT = 0;
    this.face(dir, true);
  }

  /** Whole again (a new round): its HP back, standing. */
  restore(): void {
    this.hp = this.maxHp;
    if (this.down) { this.down = false; this.factory.revive(this.node); }
    this.beam?.play.cancel?.(); this.beam = null;
    this.stunned = false; this.firing = false; this.quick = false; this.clip = ''; this.turnLocks = 0;
  }

  /** How strong `move` is from it against `on`: power × effectiveness × STAB. */
  strength(move: string, on: Fighter): number {
    const m = getMove(move);
    if (!m) return DAMAGE_UNKNOWN * DAMAGE_SCALE;
    return m.basePower * getTypeEffectiveness(m.moveType, on.types) * (this.types.includes(m.moveType) ? 1.5 : 1);
  }

  private foes(arena: Arena): Fighter[] { return arena.fighters.filter((f) => f !== this && f.team !== this.team); }
  private others(arena: Arena): Fighter[] { return arena.fighters.filter((f) => f !== this); }

  // ── a frame ──────────────────────────────
  step(dt: number, intent: Intent, arena: Arena): void {
    if (dt <= 0) return;
    this.time += dt;
    this.measure();
    this.quickCool = Math.max(0, this.quickCool - dt);
    this.dashCool = Math.max(0, this.dashCool - dt);
    // (Mid Quick Attack: the step carries it; it neither falls nor runs till it is back.)
    if (this.quick) { this.vx = 0; this.vy = 0; return; }
    const held = this.stunned || this.down;
    const it = held ? IDLE : intent;
    // Its aim: where it looks, and where its moves go (held through a move: it set its line as it began).
    if (!this.down) { this.aim = it.aim; this.factory.setGaze(this.node, this.aim * AIM_ANGLE); }
    // Its moves, pressed this frame.
    if (!this.busy) {
      if (it.ranged) this.fire(arena);
      else if (it.close) this.slash(arena);
      else if (it.mobility && this.moves.mobility === 'Quick Attack') this.quickAttack(arena);
      else if (it.mobility && this.moves.mobility === 'Dash') this.dash();
      else if (it.mobility && this.moves.mobility && BEHIND_STRIKES[this.moves.mobility]) this.strikeFromBehind(arena, this.moves.mobility);
      else if (it.mobility && this.moves.mobility && TELEPORTS[this.moves.mobility]) this.teleport(arena, TELEPORTS[this.moves.mobility]);
    }
    const want = it.want;
    // (Turned only once it fits: turning by another would swing its tail into it — it steps away first, then turns.)
    const turnTo = want || it.face || 0;
    if (turnTo && !this.firing && !held && !this.turnLocks && (turnTo === this.facing || this.canTurn(turnTo, arena))) this.face(turnTo);
    if (it.jumpPressed) this.sinceJumpPress = 0;
    this.jumpHeld = it.jumpHeld;
    this.sinceGround = this.grounded ? 0 : this.sinceGround + dt;
    this.sinceJumpPress += dt;
    if (this.knockT > 0) {
      // Thrown back: carried by the throw, dying away; it falls (flying, it just drifts).
      this.knockT -= dt;
      this.vx *= Math.exp(-dt * KNOCK_DRAG);
      if (this.flying) this.vy *= Math.exp(-dt * KNOCK_DRAG);
      else this.vy = Math.max(-FALL_MAX, this.vy - GRAVITY * dt);
    } else if (this.firing || held) {
      // In a move, or held: it holds its ground (flying, it hovers; else it still falls).
      this.vx = 0;
      if (this.flying) this.vy = 0;
      else this.vy = Math.max(-FALL_MAX, this.vy - GRAVITY * dt);
    } else if (this.dashT > 0) {
      this.dashT -= dt;
      this.vx = this.facing * DASH_SPEED; this.vy = 0;
      this.ghostT -= dt;
      if (this.ghostT <= 0) { this.factory.afterimage(this.node, DASH_GHOST); this.ghostT = DASH_GHOST_EVERY; }
      if (this.dashT <= 0) this.vx = this.facing * (this.flying ? FLY_SPEED : RUN_SPEED) * (want ? 1 : 0.3);
    } else if (this.flying) {
      const ease = (v: number, to: number, a: number) => v + Math.max(-a * dt, Math.min(a * dt, to - v));
      this.vx = ease(this.vx, want * FLY_SPEED, AIR_ACCEL);
      this.vy = ease(this.vy, this.jumpHeld ? FLY_RISE : it.sink ? -FLY_SINK : -FLY_GLIDE, FLY_ACCEL);
    } else {
      const accel = this.grounded ? RUN_ACCEL : AIR_ACCEL;
      this.vx += Math.max(-accel * dt, Math.min(accel * dt, want * RUN_SPEED - this.vx));
      // (Stepping away from one it can't yet turn its back on: at once at full pace, so it turns as soon as it can.)
      if (want && want !== this.facing) this.vx = want * Math.max(Math.abs(this.vx), RUN_SPEED);
      // Taking off: jump pressed in the air (past its grace off a ledge), if it can fly.
      if (this.canFly && !this.grounded && this.sinceGround > COYOTE && this.sinceJumpPress <= dt + 1e-6) {
        this.flying = true; this.sinceJumpPress = Infinity; this.vy = Math.max(this.vy, 0);
      }
      if (this.sinceJumpPress <= BUFFER && this.sinceGround <= COYOTE) {
        this.vy = JUMP_SPEED; this.grounded = false; this.sinceGround = Infinity; this.sinceJumpPress = Infinity;
      }
      if (!this.flying) {
        if (!this.jumpHeld && this.vy > 0) this.vy *= Math.pow(JUMP_CUT, dt * 12);
        this.vy = Math.max(-FALL_MAX, this.vy - GRAVITY * dt);
      }
    }
    // Moved, sideways then up and down, each against the platforms; then out of every other body.
    const p = this.node.position;
    p.x += this.vx * dt;
    for (const s of arena.level) {
      if (!this.overlaps(p.x, p.y, s)) continue;
      p.x = this.vx > 0 ? s.x - this.W / 2 - 1e-4 : s.x + s.w + this.W / 2 + 1e-4;
      this.vx = 0;
    }
    const wasGrounded = this.grounded;
    this.grounded = false;
    p.y += this.vy * dt;
    for (const s of arena.level) {
      if (!this.overlaps(p.x, p.y, s)) continue;
      if (this.vy <= 0) { p.y = s.top; this.grounded = true; }
      else p.y = s.top - s.h - this.H - 1e-4;
      this.vy = 0;
    }
    this.unblock(arena);
    if (this.grounded && !wasGrounded) this.landing = 0.14;
    if (this.grounded) { this.flying = false; this.airDash = true; }
    this.landing = Math.max(0, this.landing - dt);
    p.z = 0;
    // (Aloft, every clip — its moves', its flinches' — its air one.)
    this.factory.setAirborne(this.node, !this.grounded);
    // (In a move, held or down: the move's or the blow's own clips play — but off the ground, never its standing one.)
    if (!this.firing && !held && (this.quickCool <= 0 || !this.grounded)) this.animate();
  }

  /** Off the level (fallen into a pit). */
  fellOut(killY: number): boolean { return this.node.position.y < killY; }

  // ── its moves ──────────────────────────────
  /** The way its aim points (unit, x then y): the way it faces, tilted up or down. */
  aimDir(aim = this.aim): [number, number] {
    const a = aim * AIM_ANGLE;
    return [this.facing * Math.cos(a), Math.sin(a)];
  }

  /** Where its body is, as a box: left, right, bottom, top. */
  box(): [number, number, number, number] { const [lo, hi] = this.span(); return [lo, hi, this.y, this.y + this.H]; }

  /**
   * How far along a line (from `from`, the way `dir`, at most `range`) it first meets `f`'s body — its box drawn in by
   * FOE_NEAR of its height across (where a beam stops on it) — or null if it misses.
   */
  static lineMeets(from: [number, number], dir: [number, number], range: number, f: Fighter): number | null {
    if (f.down) return null;
    const [l0, r0, b, t] = f.box(), inset = Math.min((r0 - l0) * 0.3, f.H * FOE_NEAR * 0.5);
    const l = l0 + inset, r = r0 - inset;
    let t0 = 0, t1 = range;
    for (const [o, d, lo, hi] of [[from[0], dir[0], l, r], [from[1], dir[1], b, t]] as const) {
      if (Math.abs(d) < 1e-6) { if (o < lo || o > hi) return null; continue; }
      let a = (lo - o) / d, c = (hi - o) / d;
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      if (t0 > t1) return null;
    }
    return t0;
  }

  /** Where its mouth is (x, y). */
  mouth(): [number, number] { const m = this.factory.mouthAt(this.node); return [m.x, m.y]; }

  /** The nearest foe its beam's line would meet (along its aim, within `range`), and how far. */
  beamTarget(arena: Arena, range: number, aim = this.aim): { f: Fighter; d: number } | null {
    const from = this.mouth(), dir = this.aimDir(aim);
    let best: { f: Fighter; d: number } | null = null;
    for (const f of this.foes(arena)) {
      const d = Fighter.lineMeets(from, dir, range, f);
      if (d !== null && (!best || d < best.d)) best = { f, d };
    }
    return best;
  }

  /** Its ranged move (a beam), the way it faces, level: to the nearest foe ahead in range at its mouth's height, else out to its range. */
  private fire(arena: Arena): void {
    if (!this.moves.ranged) return;
    const spec = beamFor(this.moves.ranged);
    if (!spec) return;
    const name = this.moves.ranged;
    this.face(this.facing, true);
    const range = spec.range ?? BEAM_REACH;
    const from = this.mouth(), dir = this.aimDir();
    // A foe's beam toward it, not yet launched, whose line meets its own (each within its reach): a clash — whether
    // or not either would reach the other alone.
    const rival = this.foes(arena).find((f) => f.beam && !f.beam.launched && !f.down && f.facing === -this.facing
      && Fighter.linesMeet(from, dir, range, f.beam.from, f.beam.dir, f.beam.range, (this.H + f.H) * 0.25));
    if (rival) {
      // (Too close to hold a clash: both burst in their faces.)
      const [rx, ry] = rival.mouth();
      if (Math.hypot(rx - from[0], ry - from[1]) < CLASH_MIN * (this.H + rival.H) / 2) this.faceBurst(rival, name, spec, arena);
      else this.clash(rival, name, spec, arena);
      return;
    }
    const hit = this.beamTarget(arena, range);
    const ahead = hit?.f ?? null;
    const reach = hit ? hit.d : range;
    const at = new Vector3(from[0] + dir[0] * Math.max(1, reach), from[1] + dir[1] * Math.max(1, reach), 0);
    this.begin(name);
    const play = this.factory.playBeam(this.node, null, at, spec);
    const mine: Firing = { id: ++beamIds, play, move: name, spec, at: ahead, pressedAt: this.time, launched: false, from, dir, range };
    this.beam = mine;
    void play.launched?.then(() => { mine.launched = true; });
    if (ahead) {
      void play.hit.then(() => {
        // (Cut off, or gone from its path by the time the beam reaches it — jumped, flown or stepped out: it misses.)
        if (this.beam !== mine || ahead.down || Fighter.lineMeets(from, dir, range + 0.5, ahead) === null) return;
        this.factory.holdHitReact(ahead.node, play.contactEnds);
        ahead.takeHit(this, name, play.contactEnds, arena);
      });
    }
    void play.done.then(() => { if (this.beam === mine) { this.beam = null; this.end(); } });
  }

  /**
   * Too close to clash: `rival`'s beam (still charging) and its own, let go point-blank, burst between them at once —
   * and both are knocked back, away from each other.
   */
  private faceBurst(rival: Fighter, name: string, spec: BeamSpec, arena: Arena): void {
    const theirs = rival.beam!;
    theirs.play.cancel?.();
    rival.beam = null; rival.firing = false; rival.using = '';
    this.factory.playFaceBurst(this.node, rival.node, spec.element, theirs.spec.element);
    arena.onBurst?.(this, rival, name, theirs.move);
    const away = Math.sign(this.x - rival.x) || -this.facing;
    this.knockBack(away);
    rival.knockBack(-away);
  }

  /** Thrown back `dir` (−1, 1): carried off fast and up a little, out of its own control and flinching till it is down again. */
  knockBack(dir: number): void {
    if (this.down) return;
    this.beam?.play.cancel?.(); this.beam = null;
    this.firing = false; this.using = '';
    this.knockT = KNOCK_TIME;
    this.vx = dir * KNOCK_SPEED;
    this.vy = this.flying ? KNOCK_UP * 0.3 : Math.max(this.vy, KNOCK_UP);
    this.grounded = false;
    this.stunned = true;
    void this.factory.playHitReact(this.node).then(() => { this.stunned = false; this.clip = ''; });
  }

  /** Whether two lines (each from a point, a way, a length) come within `near` of each other. */
  static linesMeet(a: [number, number], da: [number, number], la: number, b: [number, number], db: [number, number], lb: number, near: number): boolean {
    // (Closest points of two segments, in the plane.)
    const ex = da[0] * la, ey = da[1] * la, fx = db[0] * lb, fy = db[1] * lb;
    const rx = a[0] - b[0], ry = a[1] - b[1];
    const A = ex * ex + ey * ey, E = fx * fx + fy * fy, F = fx * rx + fy * ry, C = ex * rx + ey * ry, B = ex * fx + ey * fy;
    const den = A * E - B * B;
    let s = den > 1e-9 ? Math.max(0, Math.min(1, (B * F - C * E) / den)) : 0;
    let t = (B * s + F) / E;
    if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -C / A)); } else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (B - C) / A)); }
    const dx = rx + ex * s - fx * t, dy = ry + ey * s - fy * t;
    return Math.hypot(dx, dy) <= near;
  }

  /**
   * A clash: `rival`'s beam at it, still charging, cut off, and both played again as one clash — meeting where their
   * fronts would have, given its head start (the rival's front out sooner, it meets this one's nearer this mouth); the
   * stronger pushes through into the other (a tie: both burst).
   */
  private clash(rival: Fighter, name: string, spec: BeamSpec, arena: Arena): void {
    const theirs = rival.beam!;
    theirs.play.cancel?.();
    rival.beam = null;
    // Its head start (s): how much sooner its front would have launched. Their fronts meet where both have come as far
    // as the time allows — the rival's share of the way (from its mouth) 1/2 + head / (2 · FRONT_TIME).
    const head = Math.max(0, Math.min(FRONT_TIME, rival.time - theirs.pressedAt));
    const fromRival = Math.min(0.85, 0.5 + head / (2 * FRONT_TIME));
    const mine = this.strength(name, rival), its = rival.strength(theirs.move, this);
    const margin = Math.abs(mine - its) / Math.max(mine, its, 1e-6);
    const winner = margin < CLASH_TIE ? null : mine > its ? this : rival;
    const play = this.factory.playClash(rival.node, this.node, theirs.spec, spec, winner ? winner.node : null, margin, undefined, fromRival);
    for (const f of [this, rival]) { f.firing = true; f.using = f === this ? name : theirs.move; f.usingSince = f.time; }
    this.beam = null; rival.beam = null;
    arena.onClash?.(rival, this, winner, +fromRival.toFixed(2));
    void play.hit.then(() => {
      if (!winner) return;
      const loser = winner === this ? rival : this;
      loser.takeHit(winner, winner === this ? name : theirs.move, this.factory.playHitReact(loser.node), arena);
    });
    void play.done.then(() => { this.end(); rival.end(); });
  }

  /** Its close move (a slash), where it stands: on the nearest foe within CLOSE_REACH ahead, level with it — else a miss (no burst). */
  private slash(arena: Arena): void {
    if (!this.moves.close) return;
    const type = CLOSE_MOVES[this.moves.close];
    if (!type) return;
    const name = this.moves.close;
    // (Its slash sweeps a disc out along its aim from its middle: a foe whose body that disc touches is struck.)
    const dir = this.aimDir(), R = this.H * CLOSE_REACH;
    const cx = this.x + dir[0] * R * 0.75, cy = this.y + this.H * 0.5 + dir[1] * R * 0.75, rad = R * 0.7;
    const inReach = (f: Fighter) => {
      if (f.down) return false;
      const [l, r, b, t] = f.box();
      const px = Math.max(l, Math.min(r, cx)), py = Math.max(b, Math.min(t, cy));
      return Math.hypot(px - cx, py - cy) <= rad;
    };
    const near = this.foes(arena).filter(inReach).sort((a, b) => Math.abs(a.x - this.x) - Math.abs(b.x - this.x))[0];
    const at = near ? near.node.position.clone() : new Vector3(this.x + dir[0] * this.H, this.y + dir[1] * this.H, 0);
    this.face(this.facing, true);
    this.begin(name);
    void this.factory.playCrossSlash(this.node, at, type, () => {
      // (Asked as the blow falls: still there?)
      if (!near || !inReach(near)) return false;
      near.takeHit(this, name, this.factory.playHitReact(near.node), arena);
      return true;
    }, true).then(() => this.end());
  }

  /** Quick Attack, the way it faces: QUICK_DIST × its height on, short of a wall, or up to the nearest body in its way (a foe there struck). */
  private quickAttack(arena: Arena): void {
    if (this.quickCool > 0 || (!this.grounded && !this.flying && !this.airDash)) return;
    const p = this.node.position, dir = this.facing;
    // (Along its aim when aloft, or aimed up off the ground — level otherwise: it can't go down into the ground.)
    const tilt = !this.grounded || this.aim > 0 ? this.aim * AIM_ANGLE : 0;
    const ux = Math.cos(tilt), uy = Math.sin(tilt);
    let reach = QUICK_DIST * this.H;
    const stepLen = 0.05;
    for (let d = stepLen; d <= reach; d += stepLen) {
      if (arena.level.some((s) => this.overlaps(p.x + dir * ux * d, p.y + uy * d + 1e-3, s))) { reach = d - stepLen; break; }
    }
    const upTo = (f: Fighter) => {
      const [lo, hi] = f.span();
      const gapX = dir > 0 ? lo - this.reachOf().front - QUICK_GAP - p.x : p.x - (hi + this.reachOf().front + QUICK_GAP);
      return gapX / Math.max(ux, 0.2);
    };
    const inWay = this.others(arena).filter((f) => {
      const dx = (f.x - p.x) * dir;
      if (dx <= 0 || upTo(f) > reach) return false;
      // (Level with it where it would get to it.)
      const y = p.y + uy * Math.max(0, upTo(f));
      return f.y < y + this.H && f.y + f.H > y;
    }).sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
    if (inWay) reach = Math.max(0, Math.min(reach, upTo(inWay)));
    const land = new Vector3(p.x + dir * ux * reach, Math.max(0, p.y + uy * reach), 0);
    const at = inWay ? inWay.node.position.clone() : land.add(new Vector3(dir, 0, 0));
    const struck = inWay && !inWay.down && inWay.team !== this.team ? inWay : null;
    this.face(dir, true);
    if (!this.grounded && !this.flying) this.airDash = false;
    this.quick = true; this.vx = 0; this.vy = 0;
    this.using = 'Quick Attack'; this.usingSince = this.time;
    void this.factory.playQuickStep(this.node, at, land, 'attack', 'Normal', !!struck).then(() => {
      if (struck && !struck.down) struck.takeHit(this, 'Quick Attack', this.factory.playHitReact(struck.node), arena);
      this.quick = false; this.quickCool = QUICK_COOL; this.using = '';
      setTimeout(() => { if (!this.firing && !this.quick) this.clip = ''; }, 350);
    });
  }

  /**
   * A teleport, TELEPORT_DIST × its height along its aim (aimed down on the ground: level) — through anything between,
   * but never into a body or a wall: drawn back along the way till it fits. Arriving, it faces its nearest foe.
   */
  /** Whether its body would fit standing at (x, y): clear of the level and of every other body. */
  private fitsAt(arena: Arena, x: number, y: number, dir = this.facing): boolean {
    return y >= 0 && !arena.level.some((s) => this.overlaps(x, y + 1e-3, s))
      && !this.others(arena).some((f) => {
        const [lo, hi] = this.span(x, dir), [flo, fhi] = f.span();
        return y < f.y + f.H && y + this.H > f.y && hi > flo && lo < fhi;
      });
  }

  /**
   * A strike from behind (Feint, Sucker Punch, Shadow Sneak): the nearest foe within FEINT_RANGE × its height — gone
   * (its teleport, in the move's look) and back right behind it, at its height, facing it (behind it blocked: before
   * it), and a blow at once in the move's type. None in range: just the vanish, along its aim.
   */
  private strikeFromBehind(arena: Arena, move: string): void {
    if (this.quickCool > 0 || (!this.grounded && !this.flying && !this.airDash)) return;
    const { look, type, midStrike, plain } = BEHIND_STRIKES[move];
    const foe = this.foes(arena).filter((f) => !f.down && Math.hypot(f.x - this.x, f.y - this.y) <= FEINT_RANGE * this.H)
      .sort((a, b) => Math.hypot(a.x - this.x, a.y - this.y) - Math.hypot(b.x - this.x, b.y - this.y))[0];
    if (!foe) { this.teleport(arena, look, type); return; }
    // Behind it (its far side from here), facing back at it; that blocked, before it.
    const side = Math.sign(foe.x - this.x) || this.facing;
    const spot = (s: number) => {
      const [flo, fhi] = foe.span();
      // (Facing it from side s: its front toward the foe.)
      const x = s > 0 ? fhi + this.reachOf().front + FEINT_GAP : flo - this.reachOf().front - FEINT_GAP;
      return { x, dir: -s };
    };
    let at = spot(side);
    if (!this.fitsAt(arena, at.x, foe.y, at.dir)) at = spot(-side);
    if (!this.fitsAt(arena, at.x, foe.y, at.dir)) { this.teleport(arena, look, type); return; }
    const to = new Vector3(at.x, foe.y, 0);
    if (!this.grounded && !this.flying) this.airDash = false;
    this.quick = true; this.vx = 0; this.vy = 0;
    this.using = move; this.usingSince = this.time;
    // (Caught unawares: it can't turn round till the blow has landed — struck from behind.)
    foe.turnLocks++;
    let unlocked = false;
    const unlock = () => { if (!unlocked) { unlocked = true; foe.turnLocks = Math.max(0, foe.turnLocks - 1); } };
    // The blow — if it is still there to take it: at once on arriving, or (midStrike) as it arrives, already under way.
    const strike = () => {
      this.begin(move);
      const play = plain
        ? (onBlow: () => boolean) => this.factory.playStrike(this.node, foe.node.position.clone(), type, onBlow)
        : (onBlow: () => boolean) => this.factory.playCrossSlash(this.node, foe.node.position.clone(), type, onBlow, true);
      void play(() => {
        const [l, r, b, t] = foe.box(), [ml, mr] = this.span();
        const close = Math.min(Math.abs(l - mr), Math.abs(ml - r)) < this.H * 0.6 && this.y < t && this.y + this.H > b;
        if (foe.down || !close) { unlock(); return false; }
        foe.takeHit(this, move, this.factory.playHitReact(foe.node), arena);
        unlock();
        return true;
      }).then(() => { unlock(); this.end(); });
    };
    void this.factory.playTeleport(this.node, to, {
      look, element: type, face: at.dir > 0 ? Math.PI / 2 : -Math.PI / 2,
      onArrive: midStrike ? () => { this.face(at.dir, true); strike(); } : undefined,
    }).then(() => {
      this.face(at.dir, true);
      this.grounded = this.y <= 1e-3;
      // (Aloft by its foe's side: held there for the blow, as if flying.)
      if (!this.grounded) this.flying = this.canFly || this.flying;
      this.quick = false; this.quickCool = TELEPORT_COOL;
      if (!midStrike) { this.clip = ''; strike(); }
    });
  }

  private teleport(arena: Arena, look: 'lines' | 'ring', element?: string): void {
    if (this.quickCool > 0 || (!this.grounded && !this.flying && !this.airDash)) return;
    const p = this.node.position, dir = this.facing;
    const tilt = !this.grounded || this.aim > 0 ? this.aim * AIM_ANGLE : 0;
    const ux = dir * Math.cos(tilt), uy = Math.sin(tilt);
    const fits = (x: number, y: number) => y >= 0 && !arena.level.some((s) => this.overlaps(x, y + 1e-3, s))
      && !this.others(arena).some((f) => {
        const [lo, hi] = this.span(x), [flo, fhi] = f.span();
        return y < f.y + f.H && y + this.H > f.y && hi > flo && lo < fhi;
      });
    // (Landing in a body: on past it first — behind it — up to TELEPORT_PAST further; else drawn back till it fits.)
    const full = TELEPORT_DIST * this.H;
    let d = full;
    if (!fits(p.x + ux * d, p.y + uy * d)) {
      let on = d;
      while (on < full * TELEPORT_PAST && !fits(p.x + ux * on, p.y + uy * on)) on += 0.1;
      if (on < full * TELEPORT_PAST) d = on;
      else { while (d > 0.2 && !fits(p.x + ux * d, p.y + uy * d)) d -= 0.1; }
    }
    if (d <= 0.2) return;
    const to = new Vector3(p.x + ux * d, p.y + uy * d, 0);
    if (!this.grounded && !this.flying) this.airDash = false;
    this.quick = true; this.vx = 0; this.vy = 0;
    this.using = this.moves.mobility ?? 'Teleport'; this.usingSince = this.time;
    // (There, it will face its nearest foe — behind it, it turns round; it comes in already facing so.)
    const foe = this.foes(arena).sort((a, b) => Math.abs(a.x - to.x) - Math.abs(b.x - to.x))[0];
    const faceThere = foe ? Math.sign(foe.x - to.x) || dir : dir;
    void this.factory.playTeleport(this.node, to, { look, element, face: faceThere > 0 ? Math.PI / 2 : -Math.PI / 2 }).then(() => {
      this.face(faceThere, true);
      this.grounded = this.y <= 1e-3;
      this.quick = false; this.quickCool = TELEPORT_COOL; this.using = ''; this.clip = '';
    });
  }

  private dash(): void {
    if (this.dashCool > 0 || !(this.grounded || this.flying || this.airDash)) return;
    this.dashT = DASH_TIME; this.dashCool = DASH_COOL; this.ghostT = 0;
    if (!this.grounded && !this.flying) this.airDash = false;
  }

  private begin(name: string): void { this.firing = true; this.using = name; this.usingSince = this.time; }
  private end(): void { this.firing = false; this.using = ''; this.clip = ''; this.face(this.facing, true); }

  /** A blow on it: its HP down, held till `over` (its flinch); out of HP it faints once `over` (a practice target stands again after RESPAWN s). */
  takeHit(by: Fighter, move: string, over: Promise<unknown>, arena: Arena): void {
    if (this.down) return;
    const damage = Math.max(1, Math.round(by.strength(move, this) / DAMAGE_SCALE));
    // (Its beam, charging or pouring, cut off by the blow.)
    if (this.beam) { this.beam.play.cancel?.(); this.beam = null; this.firing = false; this.using = ''; }
    this.hp = Math.max(0, this.hp - damage);
    arena.onHit?.(by, this, move, damage);
    this.stunned = true;
    const fainted = this.hp <= 0;
    if (fainted) this.down = true;
    void over.then(() => {
      this.stunned = false; this.clip = '';
      if (!fainted) return;
      void this.factory.playFaint(this.node).then(() => {
        if (!this.respawn) return;
        setTimeout(() => { if (this.down) this.restore(); }, RESPAWN * 1000);
      });
    });
  }

  // ── its body ──────────────────────────────
  private measure(): void {
    if (this.measured >= BODY_SETTLE + BODY_FRAMES) return;
    if (++this.measured <= BODY_SETTLE) return;
    const r0 = this.factory.reachAlong(this.node);
    if (!r0) return;
    const most = this.H * BODY_MAX;
    const r = { front: Math.min(r0.front, most), back: Math.min(r0.back, most) };
    this.reach = this.reach ? { front: Math.max(this.reach.front, r.front), back: Math.max(this.reach.back, r.back) } : r;
  }

  reachOf(): Reach { return this.reach ?? { front: this.W / 2, back: this.W / 2 }; }

  /** Where its body spans across (x, left to right), standing at `x`, facing `dir`. */
  span(x = this.x, dir = this.facing): [number, number] {
    const r = this.reachOf();
    return dir > 0 ? [x - r.back, x + r.front] : [x - r.front, x + r.back];
  }

  private levelWith(f: Fighter): boolean { return this.y < f.y + f.H && this.y + this.H > f.y; }

  private canTurn(dir: number, arena: Arena): boolean {
    const [lo, hi] = this.span(this.x, dir);
    return !this.others(arena).some((f) => {
      if (!this.levelWith(f)) return false;
      const [flo, fhi] = f.span();
      return hi > flo && lo < fhi;
    });
  }

  /** Out of every other body: pushed back out to the side it stands on, its run stopped. */
  private unblock(arena: Arena): void {
    const p = this.node.position;
    for (const f of this.others(arena)) {
      if (!this.levelWith(f)) continue;
      const [lo, hi] = this.span(), [flo, fhi] = f.span();
      if (hi <= flo || lo >= fhi) continue;
      p.x += p.x < f.x ? flo - hi - 1e-4 : fhi - lo + 1e-4;
      this.vx = 0; this.dashT = 0;
    }
  }

  private overlaps(x: number, y: number, s: Platform): boolean {
    return x + this.W / 2 > s.x && x - this.W / 2 < s.x + s.w && y + this.H > s.top - s.h && y < s.top;
  }

  face(dir: number, force = false): void {
    if (!force && dir === this.facing && this.clip) return;
    this.facing = dir;
    this.factory.setFacing(this.node, dir > 0 ? Math.PI / 2 : -Math.PI / 2);
  }

  private animate(): void {
    const want = this.flying ? (Math.abs(this.vx) > 0.6 ? 'airRun' : 'airIdle')
      : this.dashT > 0 ? (this.grounded ? 'run' : 'jumpDownLoop')
        : !this.grounded ? (this.vy > 0 ? 'jumpUpLoop' : 'jumpDownLoop')
          : this.landing > 0 ? 'land' : Math.abs(this.vx) > 0.6 ? 'run' : 'idle';
    if (want === this.clip) return;
    const player = this.factory.playerOf(this.node);
    if (!player) return;
    const name = player.has(want) ? want : want === 'airRun' && player.has('airWalk') ? 'airWalk' : want.startsWith('air') && player.has('airIdle') ? 'airIdle'
      : want === 'land' ? 'idle' : player.has('idle') ? 'idle' : want;
    this.clip = want;
    void player.play(name, { fade: want === 'land' ? 0.06 : 0.12, loop: want !== 'land' });
  }
}
