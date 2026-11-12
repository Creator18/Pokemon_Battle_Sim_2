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
 *   ranged    a beam the way it faces, along its aim — at the first foe its line meets within range, else out to its range;
 *             and for as long as it pours its line is a hit zone: a foe moving into it (flying through, jumping in) is
 *             struck there and then, held for the rest of the pour — and the beam stops on it: its end, the end ball,
 *             drawn back onto the nearest foe in its line (out to its full reach again once none is)
 *   close     a slash where it stands, along its aim (Dragon Claw) — it lands on a foe within reach that way, else misses
 *   mobility  Quick Attack the way it faces — along its aim when aloft (or aimed up off the ground) — QUICK_DIST on,
 *             short of a wall, or up to a foe in the way (struck); or 'Dash', a plain dash with afterimages; or
 *             a teleport (TELEPORTS: 'Teleport', magical, a ring) — gone and there TELEPORT_DIST along its aim
 *             (through a body, not into one or a wall), facing its nearest foe as it arrives; or a strike from
 *             behind (BEHIND_STRIKES: Feint, Sucker Punch, Shadow Sneak) — gone and back right behind the nearest foe
 *             within FEINT_RANGE (at its height, facing it), and a blow at once (none in range: just the vanish)
 *   control   Counter: braced (COUNTER_WINDOW s, glowing) — a blow about to land on it sets it off instead: it takes
 *             none of it — it slips away in speed lines (the blow going on into where it was: a beam pours on into empty
 *             air) and is back behind the striker mid-strike (as Feint), for COUNTER_TURN × what that blow would have
 *             done, its landing cutting the striker's attack off as any blow does; nothing coming: left open COUNTER_WHIFF s. Then not
 *             again for COUNTER_COOL s.
 * Struck, it is held (no moving, no moves) for as long as its flinch lasts — and a beam it was charging or pouring is cut
 * off — pushed back from its striker (PUSH_SPEED), and can't be struck again till HIT_GRACE s after its flinch ends
 * (blinking meanwhile): no blow lands on a fighter twice in a row — no stun-locks; out of HP it faints — and a practice target (`respawn`) stands again after RESPAWN s. A blow's damage: its move's
 * power × its type's effectiveness on the target's types × the same-type bonus (STAB), ÷ DAMAGE_SCALE.
 *
 * Beam duels: a beam takes BEAM_CHARGE s to launch, then its front FRONT_TIME s to cross. Too close to clash (their
 * mouths nearer than CLASH_MIN × their height), the two burst point-blank between them at once, and both are knocked
 * back (KNOCK_SPEED, flinching till they come down), each hurt as near a burst (below). Else, firing at a foe whose
 * beam at it has not launched yet, the two CLASH — however far either would reach alone (a beam's range never
 * decides a clash) — where their fronts would meet, given the head start (the later one's front meets the earlier's
 * nearer its own mouth). Then the STOPPER: each has one press of its ranged key to stop a needle swinging across its
 * meter (METER_PERIOD s a swing; unstopped by METER_TIME s: nothing), its quality q (1 within METER_PERFECT of the
 * middle, down to 0 at the ends) its timing ×(TIMING_MIN … TIMING_MAX). Each beam's power P (base power × STAB) and
 * type effectiveness E on the other (P a special move's base power × STAB × its user's Special Attack ÷ STAT_REF): one ahead on both (neither behind) wins outright — else the higher
 * P × E × timing wins, within CLASH_TIE of each other a tie. The winner pushes through for its beam's damage × its
 * timing; a tie bursts the ball where they met — hurting only a body near it (BURST_NEAR … BURST_FAR × its height,
 * BURST_CHIP of the other's beam's damage, knocked back). Its beam already out, the foe's reaches it before it can
 * fire: it is struck, and its own beam cut off.
 */
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { RecipeFactory } from '../render/RecipeFactory.ts';
import type { BeamPlay } from '../render/unitFactory.ts';
import { beamFor as beamSpecFor } from '../vfx/beam/beamMoves.ts';
import { lightningFor } from '../vfx/lightningMoves.ts';
import type { BeamSpec } from '../vfx/beam/beamMoves.ts';
import { getMove, getTypeEffectiveness, MoveCategory } from '../../shared/index.ts';

/** A platform: its left edge, its top, its width, its depth below its top (world units); `hidden`: solid but not drawn. */
export interface Platform { x: number; top: number; w: number; h: number; hidden?: boolean }

/**
 * Its moves, one per role (U ranged, I close, J mobility, K control for the player). Unset: none in that slot.
 * Ranged: a beam move (beamMoves). Close: a slash (CLOSE_MOVES). Mobility: 'Quick Attack' or 'Dash'. Control: none built yet.
 */
export interface MoveKit { ranged?: string; close?: string; mobility?: string; control?: string }
/** Charizard's, for now. */
export const DEFAULT_KIT: MoveKit = { ranged: 'Flamethrower', close: 'Dragon Claw', mobility: 'Quick Attack', control: 'Counter' };

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
  /** A counter going off: who countered whom, on what attack, for how much. */
  onCounter?(by: Fighter, on: Fighter, move: string, damage: number): void;
  /** A clash's struggle over: who won (none: a tie). */
  onClashEnd?(first: Fighter, second: Fighter, winner: Fighter | null, stops?: { you: number; rival: number; outright: boolean }): void;
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
  // (Counter's blow, as Feint's: arriving already striking, plain.)
  'Counter': { look: 'lines', type: 'Fighting', midStrike: true, plain: true },
  // (Feint arrives already striking: its blow under way as it appears — a plain blow, its attack clip and a burst on
  // contact, no slash drawn, as Quick Attack's.)
  'Feint': { look: 'lines', type: 'Normal', midStrike: true, plain: true },
  'Sucker Punch': { look: 'lines', type: 'Dark' },
  'Shadow Sneak': { look: 'ring', type: 'Ghost' },
};
/**
 * Counter: how long it stays braced (s), how near a foe's attack must start to set it off (× its height), what share
 * of that attack's damage it turns back, how long it is left open when nothing comes (s), its glow while braced.
 */
const COUNTER_WINDOW = 1.0, COUNTER_TURN = 1.5, COUNTER_WHIFF = 0.5;
/** How long after it goes off (or runs out) before it can be braced again (s). */
const COUNTER_COOL = 2.5;
/** A beam on one braced to counter: it goes off this far ahead of the front reaching it (s) — before it lands. */
const COUNTER_SENSE = 0.12;
const COUNTER_GLOW: [number, number, number] = [0.6, 0.8, 1];
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
export const BEAM_REACH = 8;
/**
 * Every beam's longest reach (world units): its own (BeamSpec.range — Flamethrower's 6), else by its kind — a beam 1
 * BEAM_REACH, a beam 2 (the aura beams, the great ones) BEAM2_REACH. Its line, its hit zone, its end ball, no further.
 */
const BEAM2_REACH = 10;
/**
 * Its ranged move as a beam: a beam move's own; a bolt (Thunderbolt) a beam of lightning straight off its body, no egg
 * (as the hex battle's clashes drew it).
 */
export function beamFor(move: string | null | undefined): BeamSpec | null {
  const own = beamSpecFor(move);
  if (own || !move || lightningFor(move)?.kind !== 'bolt') return own;
  return { element: getMove(move)?.moveType ?? 'Electric', bolt: true, eggless: true };
}
export function beamReach(spec: BeamSpec): number { return spec.range ?? (spec.style === 2 ? BEAM2_REACH : BEAM_REACH); }
const FOE_NEAR = 0.3;
/** A blow's damage: power × effectiveness × STAB, ÷ this (HP; a move it doesn't know: DAMAGE_UNKNOWN). */
const DAMAGE_SCALE = 5, DAMAGE_UNKNOWN = 8;
/** A move's power scales with its user's Attack (physical) or Special Attack (special), against this (a stat of 100: × 1). */
const STAT_REF = 100;
/** A beam: its charge before it launches, its front's crossing (s — RecipeFactory's BEAM_CHARGE, BeamFx's GROW). */
const BEAM_CHARGE = 1.1, FRONT_TIME = 0.6;
/** Nearer than CLASH_MIN × their height (mouth to mouth): no clash — a burst in both their faces. */
const CLASH_MIN = 2.4;
/**
 * A clash's stopper: its needle swings −1 … 1 and back in METER_PERIOD s; stopped within METER_PERFECT of the middle,
 * perfect (q 1), else q falling to 0 at the ends; not stopped by METER_TIME s after they meet, q 0. Its timing
 * multiplier TIMING_MIN + (TIMING_MAX − TIMING_MIN) · q.
 */
const METER_PERIOD = 1.6, METER_PERFECT = 0.15, METER_TIME = 2.4, TIMING_MIN = 0.6, TIMING_MAX = 1.6;
/** Scores (P × E × timing) within this ratio: a tie. How long the decided ball takes to swing to the loser before it pushes home (s). */
const CLASH_TIE = 1.08, CLASH_DECIDE = 0.35;
/** A burst (a tie, point-blank): a body within BURST_NEAR × its height of it takes BURST_CHIP of the other beam's damage, falling to none at BURST_FAR. */
const BURST_NEAR = 0.8, BURST_FAR = 1.8, BURST_CHIP = 0.5;

/** A clash's stopper, as one side sees it. */
export interface ClashMeter {
  /** Its one press: stops its needle. */
  press(): void;
  /** Its needle (−1 … 1; none till the beams meet); where it stopped it, and its quality, once it has. */
  needle(): number | null; stopped(): number | null; quality(): number | null;
  /** Its timing multiplier, once stopped (or time up). */
  timing(): number | null;
  /** The outcome for it: 1 won, −1 lost, 0 a tie, none yet; whether it was decided by power and type alone. */
  outcome(): number | null; outright(): boolean;
}
/** Struck: pushed back this fast (world units/s), for this long (s); unhurtable this long after its flinch ends (s). */
const PUSH_SPEED = 7, PUSH_TIME = 0.18, HIT_GRACE = 0.5;
/** Knocked back: how fast it is thrown (world units/s), how high, how long it is out of its own control (s), how quickly the throw dies away (per s). */
const KNOCK_SPEED = 11, KNOCK_UP = 5, KNOCK_TIME = 0.45, KNOCK_DRAG = 3;
/** A practice target: how long it lies fainted before it stands again (s). */
const RESPAWN = 3;

/** A body's reach ahead of where it stands and behind it, along the way it faces (world units). */
interface Reach { front: number; back: number }
/** A beam it is firing: its play, its move and spec, who it is aimed at, when it was pressed, whether it has launched. */
interface Firing { id: number; play: BeamPlay; move: string; spec: BeamSpec; at: Fighter | null; pressedAt: number; launched: boolean;
  /** Its line: from (x, y), the way (unit), how far. */
  from: [number, number]; dir: [number, number]; range: number;
  /** When it launched (its own clock: its front out from then over FRONT_TIME), whether it still pours, and who it has struck. */
  launchedAt: number; pouring: boolean; struck: Set<Fighter>;
  /** Where its end is (the very point the beam pours to — moved, it follows), and how far it reaches at most (to the foe it was fired at, or its range). */
  end: Vector3; reach: number;
  /** Its front on a foe now (a beam 2 forms its end ball only then). */
  connected: boolean;
  /** Who it is on now (its front on that one), none while it strikes nothing. */
  onto: Fighter | null }
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
  /** Unhurtable till this (its own clock; Infinity while it flinches — then HIT_GRACE more). */
  private graceUntil = 0;
  /** Counter braced: till when (its own clock). Left open after a whiff: till when. The arena it is in (for its tells). */
  private counterUntil = -1; private lagUntil = 0; private arenaRef: Arena | null = null; private counterReady = 0;
  /** The move it is telling (about to make), and how many times its attack has been cut off by a counter. */
  telling = ''; interrupted = 0;
  /** Its Attack and Special Attack (its species'): a physical move's power × attack ÷ STAT_REF, a special move's × spAtk ÷ STAT_REF. */
  attack = STAT_REF; spAtk = STAT_REF;
  /** In a clash: its stopper (its ranged key stops its needle). */
  clashing: ClashMeter | null = null;

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
  /** Unhurtable now (just struck, or blinking after). */
  get invulnerable(): boolean { return this.time < this.graceUntil; }
  /** Its boss's tell: flashed `rgb` for `hold` s before it strikes. */
  tell(rgb: [number, number, number], hold: number, move = ''): void {
    this.factory.tell(this.node, rgb, hold);
    this.telling = move;
    // (Moving to attack: a foe braced to counter goes off.)
    if (this.arenaRef) void this.announceAttack(this.arenaRef);
  }

  /** Busy: in a move, mid step, held, or down — it takes no new move. */
  get busy(): boolean { return this.firing || this.quick || this.stunned || this.down || this.dashT > 0 || this.time < this.lagUntil; }
  /** Braced to counter. */
  get countering(): boolean { return this.counterUntil >= 0; }
  /** Where its mouth is (its beams' height). */
  get mouthY(): number { return this.factory.mouthAt(this.node).y; }
  /** Its ranged move's reach. */
  get beamRange(): number { const s = this.moves.ranged ? beamFor(this.moves.ranged) : null; return s ? beamReach(s) : BEAM_REACH; }

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
    this.stunned = false; this.firing = false; this.quick = false; this.clip = ''; this.turnLocks = 0; this.graceUntil = 0; this.clashing = null;
    this.counterUntil = -1; this.lagUntil = 0;
  }

  /** `move` from it against `on`, for a clash: its power P (base power × STAB) and its type effectiveness E. */
  clashTerms(move: string, on: Fighter): { P: number; E: number } {
    const m = getMove(move);
    if (!m) return { P: DAMAGE_UNKNOWN * DAMAGE_SCALE, E: 1 };
    return { P: m.basePower * (this.types.includes(m.moveType) ? 1.5 : 1) * this.statFor(m.category), E: getTypeEffectiveness(m.moveType, on.types) };
  }

  /** A move's stat factor: a special move's, its Special Attack ÷ STAT_REF; a physical move's, its Attack ÷ STAT_REF; else 1. */
  private statFor(category: MoveCategory | string | undefined): number {
    return category === MoveCategory.SPECIAL ? this.spAtk / STAT_REF : category === MoveCategory.PHYSICAL ? this.attack / STAT_REF : 1;
  }

  /** How strong `move` is from it against `on`: power × effectiveness × STAB. */
  strength(move: string, on: Fighter): number {
    const m = getMove(move);
    if (!m) return DAMAGE_UNKNOWN * DAMAGE_SCALE;
    return m.basePower * getTypeEffectiveness(m.moveType, on.types) * (this.types.includes(m.moveType) ? 1.5 : 1) * this.statFor(m.category);
  }

  private foes(arena: Arena): Fighter[] { return arena.fighters.filter((f) => f !== this && f.team !== this.team); }
  private others(arena: Arena): Fighter[] { return arena.fighters.filter((f) => f !== this); }

  // ── a frame ──────────────────────────────
  step(dt: number, intent: Intent, arena: Arena): void {
    if (dt <= 0) return;
    this.time += dt;
    this.arenaRef = arena;
    // Braced, and nothing came: open a moment.
    if (this.countering && this.time > this.counterUntil) {
      this.counterUntil = -1; this.end(); this.lagUntil = this.time + COUNTER_WHIFF; this.counterReady = this.time + COUNTER_COOL;
    }
    this.measure();
    this.quickCool = Math.max(0, this.quickCool - dt);
    this.dashCool = Math.max(0, this.dashCool - dt);
    // (Mid Quick Attack: the step carries it; it neither falls nor runs till it is back.)
    if (this.quick) { this.vx = 0; this.vy = 0; return; }
    const held = this.stunned || this.down;
    const it = held ? IDLE : intent;
    // Its aim: where it looks, and where its moves go (held through a move: it set its line as it began).
    if (!this.down) { this.aim = it.aim; this.factory.setGaze(this.node, this.aim * AIM_ANGLE); }
    // Its beam's line, while it pours, a hit zone: a foe moving into it is struck there and then.
    this.sweepBeam(arena);
    // In a clash: its ranged key stops its needle.
    if (this.clashing && intent.ranged && !this.down) this.clashing.press();
    // Its moves, pressed this frame.
    if (!this.busy) {
      if (it.ranged) this.fire(arena);
      else if (it.close) this.slash(arena);
      else if (it.mobility && this.moves.mobility === 'Quick Attack') this.quickAttack(arena);
      else if (it.control && this.moves.control === 'Counter' && this.time >= this.counterReady) this.brace();
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
    const range = beamReach(spec);
    const from = this.mouth(), dir = this.aimDir();
    // A foe's beam toward it, not yet launched, whose line meets its own: a clash — however far either would reach
    // alone (each line taken out past the other's mouth).
    const span = (f: Fighter) => { const [fx, fy] = f.mouth(); return Math.hypot(fx - from[0], fy - from[1]) + f.H; };
    const rival = this.foes(arena).find((f) => f.beam && !f.beam.launched && !f.down && f.facing === -this.facing
      && Fighter.linesMeet(from, dir, span(f), f.beam.from, f.beam.dir, span(f), (this.H + f.H) * 0.25));
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
    if (this.announceAttack(arena)) { this.dropAttack(); return; }
    // (A beam 2: its end ball full while its front is on a foe, smaller while it strikes nothing.)
    const conn = { on: false, onto: null as Fighter | null };
    const play = this.factory.playBeam(this.node, null, at, spec.style === 2 ? { ...spec, endBall: () => conn.on }
      : spec.bolt ? { ...spec, onto: () => (conn.on && conn.onto && !conn.onto.down ? conn.onto.node : null) } : spec);
    const mine: Firing = { id: ++beamIds, play, move: name, spec, at: ahead, pressedAt: this.time, launched: false, from, dir,
      range: hit ? hit.d + 0.3 : range, launchedAt: Infinity, pouring: true, struck: new Set(), end: at, reach: Math.max(1, range),
      get connected() { return conn.on; }, set connected(v: boolean) { conn.on = v; },
      get onto() { return conn.onto; }, set onto(v: Fighter | null) { conn.onto = v; } };
    this.beam = mine;
    void play.launched?.then(() => { mine.launched = true; mine.launchedAt = this.time; });
    void play.contactEnds.then(() => { mine.pouring = false; });
    if (ahead) {
      void play.hit.then(() => {
        // (Cut off, or gone from its path by the time the beam reaches it — jumped, flown or stepped out: it misses.)
        if (this.beam !== mine || mine.struck.has(ahead) || ahead.down || ahead.invulnerable || Fighter.lineMeets(from, dir, range + 0.5, ahead) === null) return;
        mine.struck.add(ahead);
        if (ahead.takeHit(this, name, play.contactEnds, arena)) { this.factory.holdHitReact(ahead.node, play.contactEnds); this.zap(ahead, name, play.contactEnds); }
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
    const [ax, ay] = this.mouth(), [bx, by] = rival.mouth();
    const at: [number, number] = [(ax + bx) / 2, (ay + by) / 2];
    const away = Math.sign(this.x - rival.x) || -this.facing;
    this.knockBack(away);
    rival.knockBack(-away);
    this.burntBy(rival, theirs.move, at, arena);
    rival.burntBy(this, name, at, arena);
  }

  /**
   * Struck by its lightning (Thunderbolt and any Electric move; Ice Beam's icy, Psybeam's psychic): `on` lit up in that
   * aura, filled and shivering — zapped — till `until` (the bolt lets go).
   */
  zap(on: Fighter, move: string, until: Promise<unknown>): void {
    const type = getMove(move)?.moveType;
    const element = move === 'Ice Beam' ? 'Ice' : move === 'Psybeam' ? 'Psychic' : type === 'Electric' ? 'Electric' : null;
    if (!element || on.down) return;
    const aura = this.factory.aura(on.node, { element, edge: 'smooth', reach: 'body', fill: true, ignite: 0.08, die: 0.35, shiver: true });
    void until.then(() => aura.release());
  }

  /**
   * A burst at `at` (a tie's ball, a point-blank burst) of `by`'s `move`: within BURST_NEAR × its height of it, it
   * takes BURST_CHIP of that beam's damage, falling to none at BURST_FAR (further: nothing). Returns whether it was
   * near enough to be hurt.
   */
  burntBy(by: Fighter, move: string, at: [number, number], arena: Arena): boolean {
    if (this.down || this.invulnerable) return false;
    const [l, r, b, t] = this.box();
    const d = Math.hypot(Math.max(l, Math.min(r, at[0])) - at[0], Math.max(b, Math.min(t, at[1])) - at[1]) / this.H;
    const k = Math.max(0, Math.min(1, (BURST_FAR - d) / (BURST_FAR - BURST_NEAR)));
    if (k <= 0) return false;
    const damage = Math.max(1, Math.round(BURST_CHIP * k * by.strength(move, this) / DAMAGE_SCALE));
    this.hp = Math.max(0, this.hp - damage);
    arena.onHit?.(by, this, move, damage);
    if (this.hp <= 0) {
      this.down = true;
      this.beam?.play.cancel?.(true); this.beam = null; this.firing = false; this.using = '';
      void this.factory.playFaint(this.node).then(() => {
        if (this.respawn) setTimeout(() => { if (this.down) this.restore(); }, RESPAWN * 1000);
      });
    }
    return true;
  }

  /** Pushed back from `by` (a blow): a short shove away from it, along the ground or the air it is in. */
  private pushFrom(by: Fighter): void {
    const dir = Math.sign(this.x - by.x) || -this.facing;
    this.knockT = PUSH_TIME;
    this.vx = dir * PUSH_SPEED;
    if (this.grounded) this.vy = Math.max(this.vy, 2.5);
  }

  /** Counter: braced where it stands, glowing, COUNTER_WINDOW s — held still, waiting for a foe to move. */
  private brace(): void {
    this.begin('Counter');
    this.vx = 0;
    this.counterUntil = this.time + COUNTER_WINDOW;
    this.factory.tell(this.node, COUNTER_GLOW, COUNTER_WINDOW);
  }

  /** It is moving to attack (its tell, or its move begun) — a hook for what answers an attack's start (none now). */
  announceAttack(_arena: Arena): boolean { return false; }

  /** Its attack, just begun, cut off: dropped where it stands. */
  private dropAttack(): void { this.firing = false; this.quick = false; this.using = ''; this.telling = ''; this.clip = ''; }

  /**
   * Counter going off: `attacker`'s blow (`move`) about to land on it. It slips away — the blow goes on into where it
   * was (a beam pouring on into empty air) — and strikes the attacker from behind, for COUNTER_TURN × what that blow
   * would have done; that blow, landing, cuts the attacker's attack off (a beam's pour) as any does.
   */
  private counter(attacker: Fighter, arena: Arena, move: string): void {
    this.counterUntil = -1; this.counterReady = this.time + COUNTER_COOL;
    this.firing = false; this.using = '';
    const damage = Math.max(1, Math.round(COUNTER_TURN * attacker.strength(move, this) / DAMAGE_SCALE));
    // (Its attack goes on — its beam pouring on into where this one was — till the counter's blow lands and cuts it off,
    // as any blow does.)
    arena.onCounter?.(this, attacker, move, damage);
    this.strikeFromBehind(arena, 'Counter', { foe: attacker, damage });
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

  /**
   * Its beam pouring: its line — from its mouth to as far as its front has come (out over FRONT_TIME from its launch,
   * to the foe it stopped on or its range) — a hit zone. A foe in it, not yet struck by it (nor unhurtable), is struck
   * there and then, and held for the rest of the pour.
   */
  private sweepBeam(arena: Arena): void {
    const b = this.beam;
    if (!b || !b.launched || !b.pouring) return;
    const k = Math.min(1, Math.max(0, (this.time - b.launchedAt) / FRONT_TIME));
    const reach = b.range * (1 - (1 - k) * (1 - k) * (1 - k));
    if (reach < 0.2) return;
    // (A foe braced to counter in its line: set off just before the front reaches it — the beam never lands.)
    const ka = Math.min(1, Math.max(0, (this.time + COUNTER_SENSE - b.launchedAt) / FRONT_TIME));
    const reachSoon = b.range * (1 - (1 - ka) * (1 - ka) * (1 - ka));
    for (const f of this.foes(arena)) {
      if (!f.countering || f.down || f.invulnerable || b.struck.has(f)) continue;
      const d = Fighter.lineMeets(b.from, b.dir, Math.min(reachSoon, b.reach + 0.3), f);
      if (d === null) continue;
      b.struck.add(f);
      f.takeHit(this, b.move, b.play.contactEnds, arena);
      if (this.beam !== b) return;
    }
    let nearest = Infinity, onto: Fighter | null = null;
    for (const f of this.foes(arena)) {
      if (f.down) continue;
      // (Its front out — or this one already struck by it — its line runs to its full reach: pushed back, it is still in it.)
      const held = k >= 1 || b.struck.has(f);
      const d = Fighter.lineMeets(b.from, b.dir, held ? b.reach : Math.min(reach, b.reach + 0.3), f);
      if (d === null) continue;
      // (The beam stops on the nearest in its line — struck now, or held in it since.)
      if (d < nearest) { nearest = d; onto = held ? f : d <= reach + 0.05 ? f : null; }
      if (b.struck.has(f) || f.invulnerable) continue;
      b.struck.add(f);
      if (f.takeHit(this, b.move, b.play.contactEnds, arena)) { this.factory.holdHitReact(f.node, b.play.contactEnds); this.zap(f, b.move, b.play.contactEnds); }
    }
    // Its end on that one (its end ball on it) — or, none in its line, out to its full reach again (a beam 2's end ball smaller).
    b.connected = onto !== null;
    b.onto = b.connected ? onto : null;
    const to = Math.max(1, Math.min(b.reach, nearest));
    b.end.set(b.from[0] + b.dir[0] * to, b.from[1] + b.dir[1] * to, 0);
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
    // Each beam's power and type effectiveness on the other.
    const mineT = this.clashTerms(name, rival), itsT = rival.clashTerms(theirs.move, this);
    const ahead = (p: { P: number; E: number }, q: { P: number; E: number }) => p.P >= q.P && p.E >= q.E && (p.P > q.P || p.E > q.E);
    // The stopper: a needle each (its own phase), from when the beams meet; one stop each.
    type Side = { phase: number; stop: number | null; q: number | null };
    const rs: Side = { phase: Math.random() * Math.PI * 2, stop: null, q: null }, ms: Side = { phase: Math.random() * Math.PI * 2, stop: null, q: null };
    let t0 = -1, decidedAt = -1, outcome: number | null = null, outright = false;
    const swing = (s: Side, now: number) => Math.sin(s.phase + (2 * Math.PI * (now - t0)) / (1000 * METER_PERIOD));
    const quality = (x: number) => (Math.abs(x) <= METER_PERFECT ? 1 : Math.max(0, 1 - (Math.abs(x) - METER_PERFECT) / (1 - METER_PERFECT)));
    const timing = (q: number) => TIMING_MIN + (TIMING_MAX - TIMING_MIN) * q;
    const decide = (now: number) => {
      rs.q ??= 0; ms.q ??= 0;
      // (Ahead on both power and type: it wins whatever the timing. Else power × type × timing.)
      if (ahead(itsT, mineT)) { outcome = 1; outright = true; } else if (ahead(mineT, itsT)) { outcome = -1; outright = true; } else {
        const r = (itsT.P * itsT.E * timing(rs.q)) / (mineT.P * mineT.E * timing(ms.q));
        outcome = r > CLASH_TIE ? 1 : r < 1 / CLASH_TIE ? -1 : 0;
      }
      decidedAt = now;
    };
    // Its balance (the rival's way +, this one's −): a tremble while they stop, then swung to the loser.
    const struggle = () => {
      const now = performance.now();
      if (t0 < 0) t0 = now;
      if (outcome === null && ((rs.stop !== null && ms.stop !== null) || now - t0 >= METER_TIME * 1000)) decide(now);
      if (outcome === null) return { balance: 0.05 * Math.sin((now - t0) / 1000 * 11), done: false };
      const k = Math.min(1, (now - decidedAt) / (CLASH_DECIDE * 1000));
      return { balance: outcome * k * k * (3 - 2 * k), done: k >= 1 };
    };
    const meter = (s: Side, sign: number): ClashMeter => ({
      press: () => { if (t0 < 0 || s.stop !== null || outcome !== null) return; const now = performance.now(); s.stop = swing(s, now); s.q = quality(s.stop); },
      needle: () => (t0 < 0 ? null : s.stop ?? (outcome !== null ? null : swing(s, performance.now()))),
      stopped: () => s.stop, quality: () => s.q,
      timing: () => (s.q === null ? null : timing(s.q)),
      outcome: () => (outcome === null ? null : outcome * sign), outright: () => outright,
    });
    rival.clashing = meter(rs, 1);
    this.clashing = meter(ms, -1);
    const play = this.factory.playClash(rival.node, this.node, theirs.spec, spec, null, 0, undefined, fromRival, struggle);
    for (const f of [this, rival]) { f.firing = true; f.using = f === this ? name : theirs.move; f.usingSince = f.time; }
    this.beam = null; rival.beam = null;
    arena.onClash?.(rival, this, null, +fromRival.toFixed(2));
    void play.hit.then(() => {
      this.clashing = null; rival.clashing = null;
      const w = play.winner?.();
      const winner = w === this.node ? this : w === rival.node ? rival : null;
      arena.onClashEnd?.(rival, this, winner, { you: ms.q ?? 0, rival: rs.q ?? 0, outright });
      if (!winner) {
        // A tie: the ball bursts where they met — hurting (and throwing back) only a body near it.
        const p = play.point?.();
        if (!p) return;
        const at: [number, number] = [p.x, p.y];
        if (this.burntBy(rival, theirs.move, at, arena)) this.knockBack(Math.sign(this.x - p.x) || -this.facing);
        if (rival.burntBy(this, name, at, arena)) rival.knockBack(Math.sign(rival.x - p.x) || -rival.facing);
        return;
      }
      const loser = winner === this ? rival : this;
      // (Its beam's damage × its timing.)
      const move = winner === this ? name : theirs.move, q = (winner === this ? ms.q : rs.q) ?? 0;
      const damage = Math.max(1, Math.round(timing(q) * winner.strength(move, loser) / DAMAGE_SCALE));
      if (loser.takeHit(winner, move, () => this.factory.playHitReact(loser.node), arena, damage)) winner.zap(loser, move, play.done);
    });
    void play.done.then(() => { this.clashing = null; rival.clashing = null; this.end(); rival.end(); });
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
      if (f.down || f.invulnerable) return false;
      const [l, r, b, t] = f.box();
      const px = Math.max(l, Math.min(r, cx)), py = Math.max(b, Math.min(t, cy));
      return Math.hypot(px - cx, py - cy) <= rad;
    };
    const near = this.foes(arena).filter(inReach).sort((a, b) => Math.abs(a.x - this.x) - Math.abs(b.x - this.x))[0];
    const at = near ? near.node.position.clone() : new Vector3(this.x + dir[0] * this.H, this.y + dir[1] * this.H, 0);
    this.face(this.facing, true);
    this.begin(name);
    if (this.announceAttack(arena)) { this.dropAttack(); return; }
    void this.factory.playCrossSlash(this.node, at, type, () => {
      // (Asked as the blow falls: still there?)
      if (!near || !inReach(near)) return false;
      return near.takeHit(this, name, () => this.factory.playHitReact(near.node), arena);
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
    const struck = inWay && !inWay.down && !inWay.invulnerable && inWay.team !== this.team ? inWay : null;
    this.face(dir, true);
    if (!this.grounded && !this.flying) this.airDash = false;
    this.quick = true; this.vx = 0; this.vy = 0;
    this.using = 'Quick Attack'; this.usingSince = this.time;
    if (this.announceAttack(arena)) { this.dropAttack(); return; }
    void this.factory.playQuickStep(this.node, at, land, 'attack', 'Normal', !!struck).then(() => {
      if (struck && !struck.down) struck.takeHit(this, 'Quick Attack', () => this.factory.playHitReact(struck.node), arena);
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
  private strikeFromBehind(arena: Arena, move: string, opts: { foe?: Fighter; damage?: number; onBlow?: () => void } = {}): void {
    if (!opts.foe && (this.quickCool > 0 || (!this.grounded && !this.flying && !this.airDash))) return;
    const { look, type, midStrike, plain } = BEHIND_STRIKES[move];
    const foe = opts.foe ?? this.foes(arena).filter((f) => !f.down && Math.hypot(f.x - this.x, f.y - this.y) <= FEINT_RANGE * this.H)
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
    if (!opts.foe && this.announceAttack(arena)) { this.dropAttack(); return; }
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
        if (foe.down || foe.invulnerable || !close) { unlock(); return false; }
        opts.onBlow?.();
        const landed = foe.takeHit(this, move, () => this.factory.playHitReact(foe.node), arena, opts.damage);
        unlock();
        return landed;
      }).then(() => { unlock(); opts.onBlow?.(); this.end(); });
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
      this.quick = false; this.quickCool = TELEPORT_COOL; this.using = '';
      // (Its resting clip, as the teleport eased it in — named so, not played again over it with a snap.)
      this.clip = this.restingClip();
    });
  }

  private dash(): void {
    if (this.dashCool > 0 || !(this.grounded || this.flying || this.airDash)) return;
    this.dashT = DASH_TIME; this.dashCool = DASH_COOL; this.ghostT = 0;
    if (!this.grounded && !this.flying) this.airDash = false;
  }

  private begin(name: string): void { this.firing = true; this.using = name; this.usingSince = this.time; this.telling = ''; }
  private end(): void { this.firing = false; this.using = ''; this.clip = ''; this.face(this.facing, true); }

  /**
   * A blow on it: its HP down, held till `over` (its flinch — or what makes it, called only once the blow lands); out of
   * HP it faints once `over` (a practice target stands again after RESPAWN s). Whether it landed: not on one down,
   * unhurtable, or braced to counter (that one turns it back).
   */
  takeHit(by: Fighter, move: string, flinch: Promise<unknown> | (() => Promise<unknown>), arena: Arena, damageOverride?: number): boolean {
    if (this.down || this.invulnerable) return false;
    // (Braced to counter: the blow sets it off — none of it taken.)
    if (this.countering && by !== this) { this.counter(by, arena, move); return false; }
    const over = typeof flinch === 'function' ? flinch() : flinch;
    // (Unhurtable till its flinch is over and HIT_GRACE after, blinking; pushed back from its striker.)
    this.graceUntil = Infinity;
    void over.then(() => { this.graceUntil = this.time + HIT_GRACE; if (!this.down) this.factory.blink(this.node, HIT_GRACE); });
    this.pushFrom(by);
    const damage = damageOverride ?? Math.max(1, Math.round(by.strength(move, this) / DAMAGE_SCALE));
    // (Struck while braced: the brace is broken — out of it, as if it had run out.)
    if (this.countering) { this.counterUntil = -1; this.firing = false; this.using = ''; this.counterReady = this.time + COUNTER_COOL; }
    // (Its beam, charging or pouring, cut off by the blow — quietly: its flinch, not its idle, takes over.)
    if (this.beam) { this.beam.play.cancel?.(true); this.beam = null; this.firing = false; this.using = ''; }
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
    return true;
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

  /** The clip it would rest in now, as animate names it (in the air: its air idle, or falling). */
  private restingClip(): string {
    return this.flying ? 'airIdle' : !this.grounded ? (this.vy > 0 ? 'jumpUpLoop' : 'jumpDownLoop') : 'idle';
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
