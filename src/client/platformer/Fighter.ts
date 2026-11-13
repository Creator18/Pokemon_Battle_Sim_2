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
 * A second jump in the air: a flier takes off into flight; else one light enough (canDoubleJump: its weight and its
 * model's size) jumps again (AIR_JUMP), once till it lands; else nothing. Flying, it goes no higher than FLY_CAP above
 * its nearest foe. Struck in flight, it may be knocked out of the sky — likelier the nearer the ground (FALL_LOW …
 * FALL_HIGH). Down out of the sky, knocked or by choice, it can't take off again for FLY_RELOCK s after landing —
 * unless a mobility move aimed up carries it there.
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
 *             'Agility', a movement move — zips in speed lines the way it is held, again and again while J is held; or
 *             a teleport (TELEPORTS: 'Teleport', magical, a ring) — gone and there TELEPORT_DIST along its aim
 *             (through a body, not into one or a wall), facing its nearest foe as it arrives; or a strike from
 *             behind (BEHIND_STRIKES: Feint, Shadow Sneak) — gone and back right behind the nearest foe
 *             within FEINT_RANGE (at its height, facing it), and a blow at once (none in range: just the vanish)
 *   control   Sucker Punch (or Counter, BRACES: physical blows only, back in at the front): braced (COUNTER_WINDOW s, glowing) — a blow about to land on it sets it off instead: it takes
 *             none of it — it slips away in speed lines (the blow going on into where it was: a beam pours on into empty
 *             air) and is back behind the striker mid-strike (as Feint), for COUNTER_TURN × what that blow would have
 *             done, its landing cutting the striker's attack off as any blow does; nothing coming: left open COUNTER_WHIFF s. Then not
 *             again for COUNTER_COOL s.
 * Struck, it is held (no moving, no moves) for as long as its flinch lasts — and a beam it was charging or pouring is cut
 * off — pushed back from its striker (PUSH_SPEED), and can't be struck again till HIT_GRACE s after its flinch ends
 * (blinking meanwhile): no blow lands on a fighter twice in a row — no stun-locks; out of HP it faints — and a practice target (`respawn`) stands again after RESPAWN s. A blow's damage: its move's
 * the main series' (damageTo): its user's and its target's real stats at LEVEL (from their base stats — perfect IVs,
 * their EVs, a neutral nature), ⌊⌊22 × power × A / D⌋ / 50⌋ + 2, × the same-type bonus (STAB) × its type's effectiveness.
 *
 * Beam duels: a beam takes BEAM_CHARGE s to launch, then its front FRONT_TIME s to cross. Too close to clash (nearer
 * than CLASH_MIN — the stadium's painted Pokéball across), the two burst point-blank between them at once, and both are knocked
 * back (KNOCK_SPEED, flinching till they come down), each hurt as near a burst (below). Else, firing at a foe whose
 * beam at it has not launched yet, the two CLASH — however far either would reach alone (a beam's range never
 * decides a clash) — where their fronts would meet, given the head start (the later one's front meets the earlier's
 * nearer its own mouth). Then the STOPPER: each has one press of its ranged key to stop a needle swinging across its
 * meter — its number running up and down between 0 and METER_MAX (up and back in METER_PERIOD s) — the number N it
 * stops on its multiplier ×(1 + N / METER_MAX); unstopped by METER_TIME s, N 0 (×1). Each beam's power P (base power × STAB) and
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
import { ballFor, type BallSpec } from '../vfx/beam/ballMoves.ts';
import { clawFor } from '../vfx/slashMoves.ts';
import { QUICK_COATED, isPunch, coatOf } from '../vfx/moveCoats.ts';
import { canDoubleJump } from '../../shared/data/weights.ts';

/** A platform: its left edge, its top, its width, its depth below its top (world units); `hidden`: solid but not drawn. */
/**
 * A platform: its left edge, its top, how wide, how deep (down from its top); unseen (the stadium's floor and walls).
 * `pillar`: a Stone Edge pillar — solid to all (runs, dashes, teleports: gone over, not through), but a Ghost type passes it.
 */
export interface Platform { x: number; top: number; w: number; h: number; hidden?: boolean; pillar?: boolean }

/** A Stone Edge pillar standing in the arena: where it is, its platform, its user; crumbling it (at once). */
export interface Pillar { x: number; plat: Platform; owner: Fighter; crumble(): void }

/**
 * Its moves, one per role (U ranged, I close, J mobility, K control for the player). Unset: none in that slot.
 * Ranged: a beam move (beamMoves). Close: a slash (CLOSE_MOVES). Mobility: 'Quick Attack' or 'Dash'. Control: none built yet.
 */
export interface MoveKit { ranged?: string; close?: string; mobility?: string; control?: string }
/** Charizard's, for now. */
/**
 * The braces (control): Sucker Punch — any blow sets it off, and it is back behind its striker; Counter — a physical
 * blow only (a special one lands, breaking it), gone backwards as a back dash and back in at its striker's front.
 */
export const BRACES = new Set(['Sucker Punch', 'Counter', 'Detect']);
/** The braces that end in a lunge at the foe (Sucker Punch, Counter): mobility moves too. Detect only gets away. */
const LUNGING_BRACES = new Set(['Sucker Punch', 'Counter']);
export const DEFAULT_KIT: MoveKit = { ranged: 'Flamethrower', close: 'Dragon Claw', mobility: 'Quick Attack', control: 'Detect' };
/**
 * One mobility move at a time: a lunging brace (Sucker Punch, Counter — each ends in a lunge at the foe) is a mobility move too,
 * so a kit with a mobility move holds no brace (with both, a fighter could wait a blow out and toggle between the two to
 * get at its foe). With both, the mobility move is kept.
 */
export function oneMobility(kit: MoveKit): MoveKit {
  return kit.mobility && kit.control && LUNGING_BRACES.has(kit.control) ? { ...kit, control: undefined } : { ...kit };
}

/**
 * What it wants this frame: which way (−1, 0, 1), its jump (held; pressed this frame — flying: held, it rises; let go, it
 * glides down; `sink`, it drops faster), where it aims (up +1, level 0, down −1), the moves pressed this frame, and which
 * way to face when it isn't going anywhere.
 */
export interface Intent {
  want: number; jumpHeld: boolean; jumpPressed: boolean; sink: boolean; aim: number;
  ranged: boolean; close: boolean; mobility: boolean; control: boolean;
  /**
   * Its dash (anyone's, whatever its moves): the way it is held (`want`) — a dash; held neither way, a back dash (gone
   * backwards in speed lines, still facing forwards). Under Agility, both zippy dashes, further.
   */
  dash?: boolean;
  face?: number;
}
export const IDLE: Intent = { want: 0, jumpHeld: false, jumpPressed: false, sink: false, aim: 0, ranged: false, close: false, mobility: false, control: false };

/** What a fighter lives in: its level, every fighter in it, and who is told of each blow. */
export interface Arena {
  /** A status come on a fighter (confused): for the log. */
  onStatus?: (on: Fighter, status: string, seconds: number) => void;
  level: Platform[];
  fighters: Fighter[];
  /** A blow landed: who by, on whom, with what, for how much. */
  onHit?(by: Fighter, on: Fighter, move: string, damage: number): void;
  /** Two beams met: the earlier one's, the later one's, who wins (none: a tie), where (the earlier's share of the way). */
  onClash?(first: Fighter, second: Fighter, winner: Fighter | null, meet: number): void;
  /** A counter going off: who countered whom, on what attack, for how much. */
  onCounter?(by: Fighter, on: Fighter, move: string, damage: number, brace?: string): void;
  /** A clash's struggle over: who won (none: a tie). */
  onClashEnd?(first: Fighter, second: Fighter, winner: Fighter | null, stops?: { you: number; rival: number; outright: boolean }): void;
  /** Every Stone Edge pillar standing in it (Fighter.stoneEdge). */
  pillars?: Pillar[];
  /** The camera shaken: `trauma` added (0..1; its shake the square of what it holds, dying away). */
  shake?(trauma: number): void;
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
/** A double jump (the light ones, canDoubleJump): its launch (× JUMP_SPEED). */
const AIR_JUMP = 0.85;
/** Flying: how far above its nearest foe's feet it can go (world units) — no flying off out of reach for good. */
export const FLY_CAP = 6;
/** Grounded (out of the sky — knocked down, or landed): how long before it can take off again (s), but for a mobility move aimed up. */
export const FLY_RELOCK = 3;
/** Struck in flight: its chance to be knocked out of the sky — FALL_LOW right by the ground, down to FALL_HIGH at FLY_CAP up and above. */
const FALL_LOW = 0.9, FALL_HIGH = 0.2;
/** Its aim up or down (radians from level, at full aim). */
export const AIM_ANGLE = 0.6;
/** A dash: how fast, how long (s), how long before the next; its afterimages — how often (s), how strong. */
const DASH_SPEED = 24, DASH_TIME = 0.18, DASH_COOL = 0.35, DASH_GHOST_EVERY = 0.03, DASH_GHOST = 0.55;
/** Quick Attack: how far it goes (× its height), how long before the next (s), and the gap it leaves before a foe (world units). */
export const QUICK_DIST = 3.2;
const QUICK_COOL = 0.4, QUICK_GAP = 0.08;
/** A teleport: how far (× its height), how long before the next (s). */
const TELEPORT_DIST = 3.6, TELEPORT_COOL = 0.5;
/** Teleport: its foe, caught unawares, can't turn round for this long after it appears behind it (s). */
const TELEPORT_UNAWARE = 0.45;
/** Agility, a movement move — zips in speed lines the way it is held, one after another: how soon the next (s). */
const AGILITY_COOL = 0.08;
/**
 * Agility: not a move of its own now but a boost — for AGILITY_TIME s its dash and back dash are zippy dashes (gone in
 * speed lines and back, ZIP_GAIN × as far as a plain one goes). Its own cooldown counts from when it is used.
 */
const AGILITY_TIME = 4, ZIP_GAIN = 1.35;
/** Agility's boost: the flash it gives as it takes hold. */
const AGILITY_GLOW: [number, number, number] = [1, 0.45, 0.75];
/** A back dash: how far (× TELEPORT_DIST), how soon the next (s). */
const BACK_DASH_DIST = 0.7, BACK_DASH_COOL = 0.35;
/** The Pokéball painted on the League stadium's pitch: its outer ring's radius (0.94 of its 11-unit square across, halved). */
const POKEBALL_R = (11 * 0.94) / 2;
/**
 * Earthquake: how long after the stamp begins its wave sets off (s); how hard it throws a foe up (world units/s); the
 * camera's jolt at the stamp and its rumble each frame the wave runs (trauma, 0..1).
 */
const QUAKE_DELAY = 0.22, QUAKE_POP = 7, QUAKE_JOLT = 0.55, QUAKE_RUMBLE = 0.02;
/**
 * Stone Edge: how far out its target pillar can come up (world units), none nearer it than EDGE_NEAR; a pillar's width
 * (stout), and how much of it the wall's pillars need each (EDGE_FIT: they may just touch); the wall's heights, stepped up toward the foe (world units — a
 * jump reaches about 2.7); the target's; how long a crack shows first (s), each next one later by EDGE_STAGGER — one,
 * two, three; how long they
 * stand (s), shaking EDGE_WARN s before; how hard the foe is thrown up off its pillar (world units/s).
 */
export const EDGE_RANGE = 11;
const EDGE_NEAR = 1.4, EDGE_W = 2.0, EDGE_FIT = 0.95;
const EDGE_HEIGHTS = [2.1, 2.6, 3.1], EDGE_TARGET_H = 1.6;
const EDGE_TELL = 0.4, EDGE_STAGGER = 0.28, EDGE_LIFE = 10, EDGE_WARN = 0.9, EDGE_POP = 3.5;
/** Earthquake: how long it holds its charging pose (s); from the air, how long it is gone between going up and coming down (s). */
const QUAKE_POSE = 0.6, QUAKE_AIR_GAP = 0.4;
/** Earthquake's tremors: how many waves it sends out (its blow shared among them), and how far apart (s). */
const QUAKE_PULSES = 3, QUAKE_PULSE_GAP = 0.35;
/** Earthquake's area: its radius round the user (world units) — 10% more than the pitch's painted Pokéball's. */
export const QUAKE_RADIUS = POKEBALL_R * 1.1;
/** Detect going off: how far clear of the attack's reach it stops (world units), and the least it goes (× its height). */
const DETECT_CLEAR = 0.6, DETECT_MIN = 0.5;
/**
 * The moves that play as a teleport, and their look: magical — a ring and a flare ('ring': Teleport) — or physical —
 * a vanish into flickering speed lines along the way it goes, back in along the way it will face ('lines').
 */
export const TELEPORTS: Record<string, 'lines' | 'ring'> = { 'Teleport': 'ring', 'Agility': 'lines' };
/**
 * The moves that vanish and strike from behind: their teleport's look (its ring in their type's colours), and their
 * blow's type. Feint physical (speed lines), Shadow Sneak a Ghost's ring; Sucker Punch's the blow of its brace going off. Every one catches its foe
 * unawares: it can't turn round to face its striker till the blow has landed (turnLocks).
 */
export const BEHIND_STRIKES: Record<string, { look: 'lines' | 'ring'; type: string; midStrike?: boolean; plain?: boolean }> = {
  // (Sucker Punch's blow — its brace gone off — as Feint's: arriving already striking, plain, in speed lines.)
  'Sucker Punch': { look: 'lines', type: 'Dark', midStrike: true, plain: true },
  // (Feint arrives already striking: its blow under way as it appears — a plain blow, its attack clip and a burst on
  // contact, no slash drawn, as Quick Attack's.)
  'Feint': { look: 'lines', type: 'Normal', midStrike: true, plain: true },
  'Shadow Sneak': { look: 'ring', type: 'Ghost' },
};
/**
 * Sucker Punch (its brace): how long it stays braced (s), how near a foe's attack must start to set it off (× its height), what share
 * of that attack's damage it turns back, how long it is left open when nothing comes (s), its glow while braced.
 */
const COUNTER_WINDOW = 1.0, COUNTER_TURN = 1.5, COUNTER_WHIFF = 0.5;
/** Counter (its own brace, physical blows only): what share of the blow it turns back — twice it, as the move's own. */
const COUNTER_DOUBLE = 2;
/**
 * Cooldowns — every move's, started only once it has gone as it should (one cut off — struck, countered, its beam
 * cancelled, its clash lost or burst — starts none): its base (BASE_COOL by move, else SLOT_COOL by its slot) ×
 *   its Speed:  √(STAT_REF / Speed), within SPEED_K — faster, sooner;
 *   its power:  √(base power / POWER_REF), within POWER_K — weaker, sooner (no power of its own: 1);
 *   its abuse:  1 + ABUSE_STEP × its heat — each use of it adds 1 heat, halving every ABUSE_HALF s.
 */
const SLOT_COOL = { ranged: 1.2, close: 0.45, mobility: 0.5, control: 2.5 } as const;
const BASE_COOL: Record<string, number> = { 'Quick Attack': 0.4, 'Agility': 9, 'Dash': 0.5, 'Back Dash': 0.5, 'Teleport': 7,
  // (The braces turn back the blow that comes — their strength the incoming move's — so they cool longer, and gone off,
  // by the power of the move they turned back: cooldownFor.)
  'Sucker Punch': 5, 'Counter': 5, 'Detect': 5,
  // (The heavy area moves: Earthquake's tremors over the whole Pokéball; Stone Edge's pillars standing 7 s.)
  'Earthquake': 3.5, 'Stone Edge': 4 };
const SPEED_K: [number, number] = [0.6, 1.5], POWER_REF = 80, POWER_K: [number, number] = [0.5, 1.6];
const ABUSE_HALF = 3, ABUSE_STEP = 0.6;
/** Counter's blow coming in mid-swing: its clip begun this far (s) short of the blow as it opens out of its teleport. */
const COUNTER_LEAD = 0.14;
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
 * BEAM_REACH, a beam 2 (the aura beams, the great ones) BEAM2_REACH — the pitch's painted Pokéball's radius. Its line,
 * its hit zone, no further.
 */
const BEAM2_REACH = POKEBALL_R;
/**
 * A ball (Shadow Ball, Moonblast, Focus Blast…): how far it flies (world units), how near it must come to a body to
 * strike it (× its thrower's height). Charged as a beam is; let go, its thrower is free at once — it flies on straight
 * along the aim by itself (jump it), bursting on the first foe it meets, a Stone Edge pillar, or at its reach. Aura
 * Sphere (never misses) homes on its foe instead, round anything between.
 */
export const BALL_REACH = 8;
const BALL_TOUCH = 0.22;
/** A beam's line: how near a ball must come to it to meet it (× the beam's firer's height). */
const BEAM_TOUCH = 0.25;
/**
 * A ram (Flare Blitz, Brave Bird, Sky Attack, Head Smash…), its close move: coated, it runs at RAM_SPEED straight in, up
 * to RAM_DIST × its height, into the first foe in its way — its damage by how far it ran (RAM_MOMENTUM at a standing
 * start, whole at its full run: momentum), the foe thrown back, the move's recoil on itself.
 */
export const RAM_DIST = 3.2;
const RAM_SPEED = 13, RAM_MOMENTUM = 0.7, RAM_CONTACT = 0.12;
/** Thrash, Outrage: its rampage over, it is confused — every way it is told to go turned round — this long (s). */
const RAMPAGES = new Set(['Thrash', 'Outrage']);
export const CONFUSE_TIME = 3.5;
const CONFUSE_GLOW: [number, number, number] = [0.75, 0.35, 1];
/** Its ranged move a ball. */
export const isBall = (move?: string | null): boolean => !!ballFor(move);
/** A ram (its close move: a charge on foot or wing). */
export const isRamMove = (move?: string | null): boolean => !!move && !!getMove(move)?.isRam;
/**
 * A priority dash (Quick Attack, Aqua Jet, Accelerock, Bullet Punch, Mach Punch, Ice Shard, Zippy Zap…): Quick Attack's
 * step in its own type — not a brace (Sucker Punch) nor a strike from behind (Shadow Sneak, Feint).
 */
export const isQuickStrike = (move?: string | null): boolean => {
  const m = move ? getMove(move) : null;
  return !!m && m.quickPriority && m.category === MoveCategory.PHYSICAL && !m.isRam && !BRACES.has(move!) && !BEHIND_STRIKES[move!];
};
/** A slash or a claw (Dragon Claw, Night Slash, Slash, Cut, X-Scissor, Leaf Blade…): its type, as the marks wear it. */
const slashType = (move: string): string | null => CLOSE_MOVES[move] ?? clawFor(move)?.element ?? null;
/** A plain contact blow (Close Combat, Thrash, Outrage, Iron Tail, Fire Fang…): a flurry, more and faster blows the stronger. */
export const isFlurry = (move?: string | null): boolean => {
  const m = move ? getMove(move) : null;
  return !!m && m.category === MoveCategory.PHYSICAL && m.basePower > 0 && !m.isRam && !m.quickPriority && !slashType(move!)
    && move !== 'Earthquake' && move !== 'Stone Edge';
};

/** A ball out: charging at its mouth, or let go and flying. */
interface Thrown {
  play: BeamPlay; move: string; homing: Fighter | null;
  /** Its line (from its mouth, along its aim), when it was pressed (its own clock), and its look as a clash's half. */
  from: [number, number]; dir: [number, number]; pressedAt: number; spec: BeamSpec;
  launched: boolean; done: boolean;
  /** Those it has passed through (unhurtable, or braced): never struck by it after. */
  passed: Set<Fighter>;
}
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
/** A beam move not in the move table: its type (for a clash's type effectiveness), from its look. */
const BEAM_TYPES: Record<string, string> = {};
/** A blow's damage: power × effectiveness × STAB, ÷ this (HP; a move it doesn't know: DAMAGE_UNKNOWN). */
const DAMAGE_SCALE = 5, DAMAGE_UNKNOWN = 8;
/**
 * Every fighter at LEVEL 100, perfect IVs (IV), its EVs maxed out (EV_TOTAL in all, no stat over EV_MAX) — players
 * will reallot them (how: later); till then spread evenly (EV_EVEN in each). A Pokémon grows stronger by evolving and
 * learning moves, not by levelling. Its real stats from its base stats by the main series' formulas (a neutral nature).
 */
/** Damage as dealt: rounded, at least 1 — but none (0) where the move does none (an immunity). */
const hurt = (x: number) => (x <= 0 ? 0 : Math.max(1, Math.round(x)));
export const LEVEL = 100, IV = 31, EV_TOTAL = 510, EV_MAX = 252, EV_EVEN = 85;
/** An EV spread: HP, Attack, Defense, Special Attack, Special Defense, Speed. */
export interface Evs { hp: number; atk: number; def: number; spa: number; spd: number; spe: number }
export const EVEN_EVS: Evs = { hp: EV_EVEN, atk: EV_EVEN, def: EV_EVEN, spa: EV_EVEN, spd: EV_EVEN, spe: EV_EVEN };
/** A real stat from its base and its EVs at LEVEL: HP's, and the others'. */
export const hpStat = (base: number, ev = EV_EVEN, level = LEVEL) => Math.floor(((2 * base + IV + Math.floor(ev / 4)) * level) / 100) + level + 10;
export const realStat = (base: number, ev = EV_EVEN, level = LEVEL) => Math.floor(((2 * base + IV + Math.floor(ev / 4)) * level) / 100) + 5;
/** A move's power scales with its user's Attack (physical) or Special Attack (special), against this (a stat of 100: × 1). */
const STAT_REF = 100;
/** A beam: its charge before it launches, its front's crossing (s — RecipeFactory's BEAM_CHARGE, BeamFx's GROW). */
const BEAM_CHARGE = 1.1, FRONT_TIME = 0.6;
/**
 * Nearer than CLASH_MIN (world units, the two of them centre to centre): no clash — a burst in both their faces. As
 * far apart as the Pokéball painted on the League stadium's pitch is across (its outer ring: 0.94 of its 11-unit
 * square), each at its edge: from there, a clash.
 */
const CLASH_MIN = POKEBALL_R * 2;
/**
 * A clash's stopper: its number runs up from 0 to METER_MAX and back down, steadily, in METER_PERIOD s (each side from
 * its own point in the run); stopped on N, its multiplier is 1 + N / METER_MAX (×1 … ×2); not stopped by METER_TIME s
 * after they meet, N 0 (×1).
 */
export const METER_MAX = 1000;
const METER_PERIOD = 1.6, METER_TIME = 2.4;
/** Scores (P × E × timing) within this ratio: a tie. How long the decided ball takes to swing to the loser before it pushes home (s). */
const CLASH_TIE = 1.08, CLASH_DECIDE = 0.35;
/** A burst (a tie, point-blank): a body within BURST_NEAR × its height of it takes BURST_CHIP of the other beam's damage, falling to none at BURST_FAR. */
const BURST_NEAR = 0.8, BURST_FAR = 1.8, BURST_CHIP = 0.5;

/** A clash's stopper, as one side sees it. */
export interface ClashMeter {
  /** Its one press: stops its number. */
  press(): void;
  /** Its number (0 … METER_MAX, running; none till the beams meet), as a share of METER_MAX (0 … 1). */
  needle(): number | null;
  /** Its number itself, running or stopped (none till the beams meet). */
  value(): number | null;
  /** The number it stopped on (time up: 0), and that as a share of METER_MAX, once it has. */
  stopped(): number | null; quality(): number | null;
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
  readonly canFly: boolean;
  /** Light enough to double jump (a flier's second jump takes it into flight instead). */
  readonly doubleJumps: boolean;
  /** Its air jump used (till it lands). */
  private airJumped = false;
  /** Can take off again from this (its own clock): out of the sky, FLY_RELOCK s after it lands (Infinity till it has). */
  flyReadyAt = 0;
  private dashT = 0; private dashCool = 0; private ghostT = 0; private airDash = true; private quickCool = 0;
  private reach: Reach | null = null; private measured = 0;
  /** Its beam out now (charging or pouring), if any. */
  beam: Firing | null = null;
  /** Its balls out (charging, or flying on their own). */
  balls: Thrown[] = [];
  /** Its ram under way: lit and running (`go`), how far it has run, its coat. */
  private ramming: { move: string; k: number; dir: number; go: boolean; ran: number; coat: { release(): Promise<void> }; ghostT: number } | null = null;
  /** Caught unawares (a Teleport behind it) till this (its own clock): it can't turn round. */
  unawareUntil = -1;
  /** Its ball still charging, as a beam charging is (its line, when pressed, its look in a clash): a clash's other half. */
  get ballCharge(): { play: BeamPlay; move: string; spec: BeamSpec; pressedAt: number; from: [number, number]; dir: [number, number]; range: number; launched: false; ball: Thrown } | null {
    const t = this.balls.find((b) => !b.launched && !b.done);
    return t ? { play: t.play, move: t.move, spec: t.spec, pressedAt: t.pressedAt, from: t.from, dir: t.dir, range: BALL_REACH, launched: false, ball: t } : null;
  }
  /** Its charging beam or ball, as a clash's rival: whichever it has. */
  chargeOf(): { from: [number, number]; dir: [number, number] } | null {
    return this.beam && !this.beam.launched ? this.beam : this.ballCharge;
  }
  /** Its charge taken into a clash (or a burst): gone from it — the clash plays it from here. */
  private seize(): { play: BeamPlay; move: string; spec: BeamSpec; pressedAt: number } {
    if (this.beam) { const b = this.beam; this.beam = null; return b; }
    const c = this.ballCharge!;
    c.ball.done = true;
    this.balls = this.balls.filter((b) => b !== c.ball);
    return c;
  }
  /** Confused (Thrash, Outrage) till this (its own clock): every way it is told turned round. */
  confusedUntil = -1;
  get confused(): boolean { return this.time < this.confusedUntil; }
  /** Thrown back (s left): out of its own control, the throw dying away. */
  private knockT = 0;
  /** Caught unawares (a strike from behind on it, till its blow lands): it can't turn round to face its striker. */
  turnLocks = 0;
  /** Unhurtable till this (its own clock; Infinity while it flinches — then HIT_GRACE more). */
  private graceUntil = 0;
  /** Sucker Punch braced: till when (its own clock). Left open after a whiff: till when. The arena it is in (for its tells). */
  private counterUntil = -1; private lagUntil = 0; private arenaRef: Arena | null = null;
  /** The move it is telling (about to make), and how many times its attack has been cut off by a counter. */
  telling = ''; interrupted = 0;
  /** Its Attack and Special Attack (its species'): a physical move's power × attack ÷ STAT_REF, a special move's × spAtk ÷ STAT_REF. */
  /** Its base stats (the species'): Attack, Special Attack, Speed, Defense, Special Defense. */
  attack = STAT_REF; spAtk = STAT_REF; speed = STAT_REF; defense = STAT_REF; spDef = STAT_REF;
  /** Its EV spread (EVEN_EVS till players reallot it). */
  evs: Evs = { ...EVEN_EVS };
  /** Its moves' cooldowns: when each is ready again, and how hot each is (its abuse: heat, as of when). */
  readonly readyAt = new Map<string, number>();
  /** How long each move's last cooldown was (s): the HUD's sweep. */
  readonly coolLen = new Map<string, number>();
  private heat = new Map<string, { h: number; at: number }>();
  /** The move under way that will cool down once it has gone as it should (cut off: cleared, no cooldown). */
  private run: { move: string; k: number } | null = null; private runSeq = 0; private braceK = -1;
  /** Agility's boost: till when (its own clock). A plain dash under way: its cooldown's key. */
  private agilityUntil = -1; private dashK = -1;
  /** A brace gone off: the move it turned back — its cooldown's power, not its own. */
  private braceAgainst: string | null = null;
  /** Its beam's line, as a gaze (radians above level), while it pours: its head held on it. */
  private lineGaze: number | null = null;
  /** Agility's boost on: its dashes zippy. */
  get zippy(): boolean { return this.time < this.agilityUntil; }
  /** Agility's boost: how long it has left (s). */
  get zippyLeft(): number { return Math.max(0, this.agilityUntil - this.time); }
  /** In a clash: its stopper (its ranged key stops its needle). */
  clashing: ClashMeter | null = null;

  constructor(readonly node: TransformNode, private readonly factory: RecipeFactory, readonly team: number,
    readonly maxHp: number, moves: MoveKit, readonly name: string, readonly types: readonly string[],
    readonly respawn: { x: number; y: number } | null = null) {
    this.moves = oneMobility(moves);
    this.hp = maxHp;
    this.H = factory.heightOf(node);
    this.W = this.H * BODY_W;
    this.canFly = !!factory.playerOf(node)?.has('airIdle');
    // (Its species by its name — less its label: "Pikachu (you)", "Charizard (boss)".)
    this.doubleJumps = canDoubleJump(name.replace(/ \((you|boss)\)$/, ''), factory.restVolume(node) ?? Infinity);
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
  get busy(): boolean { return this.firing || this.quick || !!this.ramming || this.stunned || this.down || this.dashT > 0 || this.time < this.lagUntil; }
  /** Braced to counter. */
  get countering(): boolean { return this.counterUntil >= 0; }
  /** Where its mouth is (its beams' height). */
  get mouthY(): number { return this.factory.mouthAt(this.node).y; }
  /** Its ranged move's reach. */
  get beamRange(): number {
    if (isBall(this.moves.ranged)) return BALL_REACH;
    const s = this.moves.ranged ? beamFor(this.moves.ranged) : null; return s ? beamReach(s) : BEAM_REACH;
  }

  /** Put somewhere, still, facing `dir`. */
  place(x: number, y: number, dir: number): void {
    this.node.position.set(x, y, 0);
    // (Set down aloft: not on the ground — its first frame there falls or flies, never stands.)
    this.vx = 0; this.vy = 0; this.flying = false; this.dashT = 0; this.grounded = y <= 1e-3; this.airJumped = false;
    this.face(dir, true);
  }

  /** Whole again (a new round): its HP back, standing. */
  restore(): void {
    this.hp = this.maxHp;
    // (Its Stone Edge pillars gone with the fight.)
    for (const pl of [...this.pillars]) pl.crumble();
    if (this.down) { this.down = false; this.factory.revive(this.node); }
    this.beam?.play.cancel?.(); this.beam = null;
    this.dropBalls(true); this.stopRam(); this.confusedUntil = -1;
    this.stunned = false; this.firing = false; this.quick = false; this.clip = ''; this.turnLocks = 0; this.graceUntil = 0; this.clashing = null;
    this.counterUntil = -1; this.lagUntil = 0; this.flyReadyAt = 0;
    this.readyAt.clear(); this.coolLen.clear(); this.heat.clear(); this.run = null; this.agilityUntil = -1;
  }

  /** `move` ready (its cooldown over). */
  ready(move?: string): boolean { return !move || this.time >= (this.readyAt.get(move) ?? -Infinity); }
  /** The ready time of its brace (its control move's cooldown). */
  private get counterReady(): number { return this.readyAt.get(this.moves.control ?? '') ?? 0; }
  private set counterReady(v: number) { if (this.moves.control) this.readyAt.set(this.moves.control, v); }
  /** `move`'s heat now (its abuse, halving every ABUSE_HALF s). */
  heatOf(move: string): number {
    const e = this.heat.get(move);
    return e ? e.h * Math.pow(0.5, (this.time - e.at) / ABUSE_HALF) : 0;
  }
  /** `move`'s cooldown were it done now: its base × its Speed × its power × its abuse. */
  cooldownFor(move: string): number {
    const slot = (Object.keys(SLOT_COOL) as (keyof typeof SLOT_COOL)[]).find((k) => this.moves[k] === move);
    const base = BASE_COOL[move] ?? (slot ? SLOT_COOL[slot] : SLOT_COOL.mobility);
    const clamp = (v: number, [lo, hi]: [number, number]) => Math.max(lo, Math.min(hi, v));
    const speedK = clamp(Math.sqrt(STAT_REF / Math.max(1, this.speed)), SPEED_K);
    // (A brace gone off: by the power of the move it turned back.)
    const bp = getMove(BRACES.has(move) && this.braceAgainst ? this.braceAgainst : move)?.basePower ?? 0;
    const powerK = bp > 0 ? clamp(Math.sqrt(bp / POWER_REF), POWER_K) : 1;
    return base * speedK * powerK * (1 + ABUSE_STEP * this.heatOf(move));
  }
  /** A move begun that will cool down once it has gone as it should. */
  private startRun(move: string): number { const k = ++this.runSeq; this.run = { move, k }; return k; }
  /** That move gone as it should: its cooldown begun, its heat up one (cut off since: nothing). */
  private finishRun(k: number): void {
    if (this.run?.k !== k) return;
    const m = this.run.move; this.run = null;
    const cd = this.cooldownFor(m);
    this.readyAt.set(m, this.time + cd); this.coolLen.set(m, cd);
    this.heat.set(m, { h: this.heatOf(m) + 1, at: this.time });
  }
  /** Its move under way cut off: no cooldown for it. */
  private interruptRun(): void { this.run = null; }
  /** Its move under way gone as it should, here and now: its cooldown begun. */
  private completeRun(): void { if (this.run) this.finishRun(this.run.k); }

  /**
   * `move` from it against `against` (the move it clashes with), for a clash: its power P (base power × STAB × its
   * stat) and its type effectiveness E — its type's on the other move's type, the two moves weighed against each other
   * (not on the Pokémon behind it).
   */
  clashTerms(move: string, against: string): { P: number; E: number } {
    const m = getMove(move);
    if (!m) return { P: DAMAGE_UNKNOWN * DAMAGE_SCALE, E: 1 };
    const theirs = getMove(against)?.moveType ?? BEAM_TYPES[against];
    return { P: m.basePower * (this.types.includes(m.moveType) ? 1.5 : 1) * this.statFor(m.category), E: theirs ? getTypeEffectiveness(m.moveType, [theirs]) : 1 };
  }

  /** A move's stat factor: a special move's, its Special Attack ÷ STAT_REF; a physical move's, its Attack ÷ STAT_REF; else 1. */
  private statFor(category: MoveCategory | string | undefined): number {
    return category === MoveCategory.SPECIAL ? this.spAtk / STAT_REF : category === MoveCategory.PHYSICAL ? this.attack / STAT_REF : 1;
  }

  /**
   * The damage `move` from it does `on` (HP, before any share of it — a burst's, a counter's): the main series'
   * formula at LEVEL — its Attack on the target's Defense (a special move: Special Attack on Special Defense), real
   * stats from base — × STAB × type effectiveness. No random roll, no critical hits.
   */
  damageTo(move: string, on: Fighter): number {
    const m = getMove(move);
    if (!m) return DAMAGE_UNKNOWN;
    const special = m.category === MoveCategory.SPECIAL;
    const A = special ? realStat(this.spAtk, this.evs.spa) : realStat(this.attack, this.evs.atk);
    const D = special ? realStat(on.spDef, on.evs.spd) : realStat(on.defense, on.evs.def);
    const base = Math.floor(Math.floor((Math.floor((2 * LEVEL) / 5) + 2) * m.basePower * A / D) / 50) + 2;
    return base * (this.types.includes(m.moveType) ? 1.5 : 1) * getTypeEffectiveness(m.moveType, on.types);
  }

  /** Can take off now: a flier not out of the sky (or its FLY_RELOCK s since landing over). */
  get mayFly(): boolean { return this.canFly && this.time >= this.flyReadyAt; }

  /** How high it may fly: FLY_CAP above its nearest foe's feet (none: no cap). */
  private flyCap(arena: Arena): number {
    const foe = this.foes(arena).filter((f) => !f.down).sort((a, b) => Math.abs(a.x - this.x) - Math.abs(b.x - this.x))[0];
    return foe ? foe.y + FLY_CAP : Infinity;
  }

  /** How far above the ground below it (the highest platform top under it; over a pit, FLY_CAP and more). */
  private heightOverGround(arena: Arena): number {
    const below = arena.level.filter((s) => this.x >= s.x && this.x <= s.x + s.w && s.top <= this.y + 1e-3);
    return below.length ? this.y - Math.max(...below.map((s) => s.top)) : Infinity;
  }

  /**
   * Struck in flight: knocked out of the sky by chance — FALL_LOW right by the ground, falling off to FALL_HIGH at
   * FLY_CAP up and above. Knocked out, it falls, and can't take off again till FLY_RELOCK s after it lands.
   */
  private shaken(arena: Arena): void {
    if (!this.flying || this.grounded) return;
    const k = Math.min(1, this.heightOverGround(arena) / FLY_CAP);
    if (Math.random() < FALL_LOW + (FALL_HIGH - FALL_LOW) * k) { this.flying = false; this.flyReadyAt = Infinity; }
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
      this.counterUntil = -1; this.end(); this.lagUntil = this.time + COUNTER_WHIFF; this.finishRun(this.braceK);
    }
    this.measure();
    this.quickCool = Math.max(0, this.quickCool - dt);
    this.dashCool = Math.max(0, this.dashCool - dt);
    // Its balls in flight: each meets what it meets.
    this.flyBalls(arena);
    // (Mid Quick Attack: the step carries it; it neither falls nor runs till it is back.)
    if (this.quick) { this.vx = 0; this.vy = 0; return; }
    const held = this.stunned || this.down;
    // (Confused: every way it is told — left and right, up and down its aim, the way it faces — turned round.)
    const told = held ? IDLE : intent;
    const it = this.confused ? { ...told, want: -told.want, aim: -told.aim, face: told.face ? -told.face : told.face } : told;
    // Its aim: where it looks, and where its moves go (held through a move: it set its line as it began).
    // (Its beam pouring, or held in a clash: its gaze kept on the beam's line, wherever the aim key goes since.)
    if (!this.down) { this.aim = it.aim; this.factory.setGaze(this.node, this.firing && this.lineGaze !== null ? this.lineGaze : this.aim * AIM_ANGLE); }
    // Its beam's line, while it pours, a hit zone: a foe moving into it is struck there and then.
    this.sweepBeam(arena);
    // In a clash: its ranged key stops its needle.
    if (this.clashing && intent.ranged && !this.down) this.clashing.press();
    // Its moves, pressed this frame.
    if (!this.busy) {
      if (it.ranged && this.ready(this.moves.ranged)) this.fire(arena);
      else if (it.close && this.ready(this.moves.close)) this.slash(arena);
      else if (it.mobility && isQuickStrike(this.moves.mobility)) this.quickAttack(arena, this.moves.mobility!);
      else if (it.control && BRACES.has(this.moves.control ?? '') && this.ready(this.moves.control)) this.brace();
      else if (it.mobility && this.moves.mobility === 'Dash') this.dash();
      else if (it.mobility && this.moves.mobility && BEHIND_STRIKES[this.moves.mobility]) this.strikeFromBehind(arena, this.moves.mobility);
      else if (it.dash) this.dashButton(arena, it.want);
      else if (it.mobility && this.moves.mobility === 'Agility') this.agility();
      else if (it.mobility && this.moves.mobility === 'Teleport' && this.ready('Teleport')) this.teleportBehind(arena);
      else if (it.mobility && this.moves.mobility && TELEPORTS[this.moves.mobility]) this.teleport(arena, TELEPORTS[this.moves.mobility]);
    }
    const want = it.want;
    // (Turned only once it fits: turning by another would swing its tail into it — it steps away first, then turns.)
    const turnTo = want || it.face || 0;
    if (turnTo && !this.firing && !held && !this.turnLocks && this.time >= this.unawareUntil && (turnTo === this.facing || this.canTurn(turnTo, arena))) this.face(turnTo);
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
    } else if (this.ramming && !held) {
      this.ramStep(dt, arena);
    } else if (this.dashT > 0) {
      this.dashT -= dt;
      this.vx = this.facing * DASH_SPEED; this.vy = 0;
      this.ghostT -= dt;
      if (this.ghostT <= 0) { this.factory.afterimage(this.node, DASH_GHOST); this.ghostT = DASH_GHOST_EVERY; }
      if (this.dashT <= 0) { this.vx = this.facing * (this.flying ? FLY_SPEED : RUN_SPEED) * (want ? 1 : 0.3); this.finishRun(this.dashK); }
    } else if (this.flying) {
      const ease = (v: number, to: number, a: number) => v + Math.max(-a * dt, Math.min(a * dt, to - v));
      this.vx = ease(this.vx, want * FLY_SPEED, AIR_ACCEL);
      this.vy = ease(this.vy, this.jumpHeld ? FLY_RISE : it.sink ? -FLY_SINK : -FLY_GLIDE, FLY_ACCEL);
      // (No higher than FLY_CAP over its nearest foe: held there — above it, eased back down to it.)
      const cap = this.flyCap(arena);
      if (this.y >= cap) this.vy = Math.min(this.vy, (cap - this.y) * 4);
    } else {
      const accel = this.grounded ? RUN_ACCEL : AIR_ACCEL;
      this.vx += Math.max(-accel * dt, Math.min(accel * dt, want * RUN_SPEED - this.vx));
      // (Stepping away from one it can't yet turn its back on: at once at full pace, so it turns as soon as it can.)
      if (want && want !== this.facing) this.vx = want * Math.max(Math.abs(this.vx), RUN_SPEED);
      // Its second jump, pressed in the air (past its grace off a ledge): a flier takes off — once it may again (out
      // of the sky, not for FLY_RELOCK s after it lands); else a light one jumps again, once till it lands.
      if (!this.grounded && this.sinceGround > COYOTE && this.sinceJumpPress <= dt + 1e-6) {
        if (this.mayFly) { this.flying = true; this.sinceJumpPress = Infinity; this.vy = Math.max(this.vy, 0); }
        else if (this.doubleJumps && !this.airJumped) { this.airJumped = true; this.vy = JUMP_SPEED * AIR_JUMP; this.sinceJumpPress = Infinity; }
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
    const wasX = p.x, wasY = p.y;
    const hw = this.W / 2;
    // (Clear of every solid, standing at (x, y).)
    const free = (x: number, y: number) => !this.solids(arena).some((o) => this.overlaps(x, y, o));
    p.x += this.vx * dt;
    for (const s of this.solids(arena)) {
      if (!this.overlaps(p.x, p.y, s)) continue;
      // (Only just under its top — its feet sunk into a floor: for the fall's pass to stand it on it, not to be thrown
      // out sideways off its end.)
      if (p.y > s.top - 0.25) continue;
      const leftX = s.x - hw - 1e-4, rightX = s.x + s.w + hw + 1e-4;
      // (Moved into it: back out the side it came from.)
      if (wasX + hw <= s.x + 1e-3) p.x = leftX;
      else if (wasX - hw >= s.x + s.w - 1e-3) p.x = rightX;
      else {
        // (Already in it — a Stone Edge pillar come up where it stood, a push: out a side that is clear — the nearer one
        // first, never into another solid (the arena's wall beyond: through it, out of the arena); neither clear: up onto
        // its top, if that is within its height; else left for the fall's pass.)
        const near = p.x - s.x < s.x + s.w - p.x ? [leftX, rightX] : [rightX, leftX];
        const out = near.find((x) => free(x, p.y));
        if (out !== undefined) p.x = out;
        else if (s.top - p.y <= this.H && free(p.x, s.top)) { p.y = s.top; this.vy = Math.max(this.vy, 0); }
      }
      this.vx = 0;
    }
    const wasGrounded = this.grounded;
    this.grounded = false;
    p.y += this.vy * dt;
    for (const s of this.solids(arena)) {
      if (!this.overlaps(p.x, p.y, s)) continue;
      const bottom = s.top - s.h;
      if (this.vy > 0 && wasY + this.H <= bottom + 1e-3) {
        // (Rising into it from below: its head against its underside.)
        p.y = bottom - this.H - 1e-4;
      } else if (this.vy <= 0 || s.top - p.y <= this.H) {
        // (Down onto it — or in it with its top within its height: a Stone Edge pillar rising under it as it jumps —
        // stood on its top. Never put under it: a pillar's underside is the floor, and under that, out of the world.)
        p.y = s.top; this.grounded = true;
      } else {
        // (Deep in it, its top far above: out a clear side instead.)
        const leftX = s.x - hw - 1e-4, rightX = s.x + s.w + hw + 1e-4;
        const near = p.x - s.x < s.x + s.w - p.x ? [leftX, rightX] : [rightX, leftX];
        p.x = near.find((x) => free(x, p.y)) ?? p.x;
      }
      this.vy = 0;
    }
    this.unblock(arena);
    if (this.grounded && !wasGrounded) this.landing = 0.14;
    if (this.grounded) {
      // (Down out of the sky — by choice or knocked out of it: not up again for FLY_RELOCK s.)
      if (this.flying || this.flyReadyAt === Infinity) this.flyReadyAt = this.time + FLY_RELOCK;
      this.flying = false; this.airDash = true; this.airJumped = false;
    }
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
  static lineMeets(from: [number, number], dir: [number, number], range: number, f: Fighter, evenDown = false): number | null {
    if (f.down && !evenDown) return null;
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

  /**
   * How far along a line (from `from`, the way `dir` — a unit — at most `range`) it first meets a Stone Edge pillar
   * standing in `arena`, or null: a beam stopped there.
   */
  /**
   * How far along a line (from, along dir, within range) it first meets the ground — the floor (y 0) or a platform's top,
   * coming down onto it from above; null: never. A beam or a ball fired down stops there, not on into it.
   */
  static groundAlong(arena: Arena, from: [number, number], dir: [number, number], range: number): number | null {
    if (dir[1] >= -1e-6) return null;
    let best: number | null = null;
    const meet = (top: number, lo: number, hi: number) => {
      if (from[1] < top - 1e-3) return;
      const t = (top - from[1]) / dir[1];
      if (t < 0 || t > range) return;
      const x = from[0] + dir[0] * t;
      if (x >= lo && x <= hi && (best === null || t < best)) best = t;
    };
    meet(0, -Infinity, Infinity);
    for (const s of arena.level) if (!s.hidden) meet(s.top, s.x, s.x + s.w);
    return best;
  }
  /** The nearer of two stops along a line (either may be none). */
  static nearer(a: number | null, b: number | null): number | null { return a === null ? b : b === null ? a : Math.min(a, b); }

  static pillarAlong(arena: Arena, from: [number, number], dir: [number, number], range: number): number | null {
    let best: number | null = null;
    for (const s of arena.level) {
      if (!s.pillar) continue;
      // (Its box, x across and y down from its top: where the line is inside both at once.)
      let t0 = 0, t1 = range;
      const slab = (o: number, d: number, lo: number, hi: number) => {
        if (Math.abs(d) < 1e-6) { if (o < lo || o > hi) t1 = -1; return; }
        let a = (lo - o) / d, b = (hi - o) / d;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      };
      slab(from[0], dir[0], s.x, s.x + s.w);
      slab(from[1], dir[1], s.top - s.h, s.top);
      if (t1 >= t0 && (best === null || t0 < best)) best = t0;
    }
    return best;
  }

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
    if (this.moves.ranged === 'Stone Edge') { this.stoneEdge(arena); return; }
    const ball = ballFor(this.moves.ranged);
    if (ball) { this.throwBall(arena, this.moves.ranged, ball); return; }
    const spec = beamFor(this.moves.ranged);
    if (!spec) return;
    const name = this.moves.ranged;
    this.face(this.facing, true);
    const range = beamReach(spec);
    const from = this.mouth(), dir = this.aimDir();
    // (Its head on its beam's line — a clash's too, which begins nothing new.)
    this.lineGaze = Math.atan2(dir[1], Math.abs(dir[0]));
    // A foe's beam toward it, not yet launched, whose line meets its own: a clash — however far either would reach
    // alone (each line taken out past the other's mouth).
    const span = (f: Fighter) => { const [fx, fy] = f.mouth(); return Math.hypot(fx - from[0], fy - from[1]) + f.H; };
    const rival = this.rivalFor(arena, from, dir);
    if (rival) {
      // (Its beam begun — the clash, or the burst, is how it goes: its cooldown counts from its end.)
      this.startRun(name);
      // (Too close to hold a clash: both burst in their faces.)
      if (Math.hypot(rival.x - this.x, rival.y - this.y) < CLASH_MIN) this.faceBurst(rival, name, spec, arena);
      else this.clash(rival, name, spec, arena);
      return;
    }
    // (Stopped by a Stone Edge pillar in its way: short of it, nothing beyond it struck.)
    const wall = Fighter.nearer(Fighter.pillarAlong(arena, from, dir, range), Fighter.groundAlong(arena, from, dir, range));
    const found = this.beamTarget(arena, range);
    const hit = found && (wall === null || found.d < wall) ? found : null;
    const ahead = hit?.f ?? null;
    const reach = hit ? hit.d : wall ?? range;
    const at = new Vector3(from[0] + dir[0] * Math.max(1, reach), from[1] + dir[1] * Math.max(1, reach), 0);
    this.begin(name);
    // (Its head held on its beam's line while it pours.)
    this.lineGaze = Math.atan2(dir[1], Math.abs(dir[0]));
    if (this.announceAttack(arena)) { this.dropAttack(); return; }
    // (A beam 2: one long egg — its starting egg drawn out the length of the beam, no shaft or end ball — on a foe or
    // not. A bolt ends on the foe it connects with.)
    // (In contact from the first frame if a foe is in its line as it fires.)
    const conn = { on: !!ahead, onto: null as Fighter | null };
    // (A bolt first, whatever its style — Ice Beam's, Psybeam's are beam 2s: it ends on the foe it is on, run into its
    // body and taken into its aura, as Thunderbolt's.)
    // (Its outline kept above the arena's floor — not the height it stands at: fired down off a platform or from the air,
    // it goes down with its core.)
    const floored: BeamSpec = { ...spec, groundY: 0 };
    const play = this.factory.playBeam(this.node, null, at, spec.bolt ? { ...floored, onto: () => (conn.on && conn.onto && !conn.onto.down ? conn.onto.node : null) }
      : spec.style === 2 ? { ...floored, endBall: () => conn.on } : floored);
    const mine: Firing = { id: ++beamIds, play, move: name, spec, at: ahead, pressedAt: this.time, launched: false, from, dir,
      range: hit ? hit.d + 0.3 : wall ?? range, launchedAt: Infinity, pouring: true, struck: new Set(), end: at, reach: Math.max(1, range),
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
    const k = this.startRun(name);
    void play.done.then(() => { if (this.beam === mine) { this.beam = null; this.finishRun(k); this.end(); } });
  }

  /**
   * Too close to clash: `rival`'s beam (still charging) and its own, let go point-blank, burst between them at once — a
   * body near enough to the burst hurt and knocked back, away from the other; one further off just loses its beam.
   */
  private faceBurst(rival: Fighter, name: string, spec: BeamSpec, arena: Arena): void {
    const theirs = rival.seize();
    // (A burst is no interruption: both beams cool down — its own, let go just now, and the rival's — before any
    // knock back.)
    this.completeRun();
    rival.completeRun();
    theirs.play.cancel?.();
    rival.firing = false; rival.using = '';
    this.factory.playFaceBurst(this.node, rival.node, spec.element, theirs.spec.element);
    arena.onBurst?.(this, rival, name, theirs.move);
    const [ax, ay] = this.mouth(), [bx, by] = rival.mouth();
    const at: [number, number] = [(ax + bx) / 2, (ay + by) / 2];
    // (As a tie's burst: only a body near enough to it is hurt — and thrown back; one further off just loses its beam.)
    const away = Math.sign(this.x - rival.x) || -this.facing;
    if (this.burntBy(rival, theirs.move, at, arena)) this.knockBack(away);
    if (rival.burntBy(this, name, at, arena)) rival.knockBack(-away);
  }

  /**
   * Struck by its lightning (Thunderbolt and any Electric move; Ice Beam's icy, Psybeam's psychic): `on` lit up in that
   * aura, filled and shivering — zapped — till `until` (the bolt lets go).
   */
  zap(on: Fighter, move: string, until: Promise<unknown>): void {
    const type = getMove(move)?.moveType;
    const plain = move === 'Ice Beam' ? 'Ice' : move === 'Psybeam' ? 'Psychic' : type === 'Electric' ? 'Electric' : null;
    if (!plain || on.down) return;
    // (In its striker's lightning's colours — Zeraora's blue — not the struck one's own.)
    const element = this.factory.hueOf(this.node, plain);
    // (As tight to the body as its firer's: the bolt's far half, taken into its silhouette, then wears the same band
    // as its near half — both ends joined alike — not a body-wide aura swelling over the whole of it.)
    const aura = this.factory.aura(on.node, { element, edge: 'smooth', reach: 'tight', fill: true, ignite: 0.08, die: 0.35, shiver: true });
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
    const damage = hurt(BURST_CHIP * k * by.damageTo(move, this));
    this.shaken(arena);
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

  /** Sucker Punch: braced where it stands, glowing, COUNTER_WINDOW s — held still, waiting for a foe to move. */
  private brace(): void {
    this.begin(this.moves.control ?? 'Sucker Punch');
    this.braceK = this.startRun(this.moves.control ?? 'Sucker Punch');
    this.vx = 0;
    this.counterUntil = this.time + COUNTER_WINDOW;
    this.factory.tell(this.node, COUNTER_GLOW, COUNTER_WINDOW);
  }

  /** It is moving to attack (its tell, or its move begun) — a hook for what answers an attack's start (none now). */
  announceAttack(_arena: Arena): boolean { return false; }

  /** Its attack, just begun, cut off: dropped where it stands. */
  private dropAttack(): void { this.interruptRun(); this.firing = false; this.quick = false; this.using = ''; this.telling = ''; this.clip = ''; }

  /**
   * Sucker Punch going off: `attacker`'s blow (`move`) about to land on it. It slips away — the blow goes on into where it
   * was (a beam pouring on into empty air) — and strikes the attacker from behind, for COUNTER_TURN × what that blow
   * would have done; that blow, landing, cuts the attacker's attack off (a beam's pour) as any does.
   */
  private counter(attacker: Fighter, arena: Arena, move: string): void {
    this.counterUntil = -1;
    this.braceAgainst = move; this.finishRun(this.braceK); this.braceAgainst = null;
    this.firing = false; this.using = '';
    if (this.moves.control === 'Detect') { this.detectAway(attacker, arena, move); return; }
    const counter = this.moves.control === 'Counter';
    const damage = hurt((counter ? COUNTER_DOUBLE : COUNTER_TURN) * attacker.damageTo(move, this));
    // (Its attack goes on — its beam pouring on into where this one was — till the counter's blow lands and cuts it off,
    // as any blow does.)
    arena.onCounter?.(this, attacker, move, damage, counter ? 'Counter' : 'Sucker Punch');
    if (counter) this.strikeFromFront(arena, attacker, damage);
    else this.strikeFromBehind(arena, 'Sucker Punch', { foe: attacker, damage });
  }

  /**
   * Detect going off: `attacker`'s blow about to land, it zips away backwards — a back dash's vanish, facing the attacker
   * — the blow going on into where it was. Its back to a wall (no room for a back dash's full way): out at the other end
   * of the map instead, against the far wall, coming in forwards and facing the attacker.
   */
  private detectAway(attacker: Fighter, arena: Arena, move: string): void {
    const away = Math.sign(this.x - attacker.x) || -this.facing;
    const half = (BODY_W * this.H) / 2 + 0.1;
    // Just out of that attack's reach — a short one, a short way back; a long one (a beam), a long way — at least a hop
    // (DETECT_MIN).
    const need = away * (attacker.x - this.x) + attacker.reachWith(move) + this.reachOf().back + DETECT_CLEAR;
    const back = Math.max(DETECT_MIN * this.H, need) * away;
    const room = this.roomAlong(arena, away) - half;
    // (No room for it — a wall behind: out at the other end of the map instead, behind the attacker.)
    const to = Math.abs(back) <= room ? this.x + back : this.x - away * (this.roomAlong(arena, -away) - half);
    // (Out at the far end: gone backwards, but in forwards facing the attacker — not a back dash's drop back in.)
    const wrap = Math.abs(back) > room;
    this.teleport(arena, 'lines', undefined, { dir: away, face: wrap ? Math.sign(attacker.x - to) || away : -away, backward: true, arriveForward: wrap,
      cool: BACK_DASH_COOL, dist: BACK_DASH_DIST * (this.zippy ? ZIP_GAIN : 1), name: 'Detect Zip', force: true, toX: to });
  }

  /**
   * How far `move` of its reaches from its middle (world units): a beam its range past its front, a lunge (Quick Attack)
   * its way on and a blow, a close blow its swing (CLOSE_REACH, the disc it sweeps), anything else as a close blow.
   */
  reachWith(move: string): number {
    const spec = beamFor(move);
    if (spec && move === this.moves.ranged) return beamReach(spec) + this.reachOf().front;
    if (isBall(move)) return BALL_REACH + this.reachOf().front;
    if (isRamMove(move)) return RAM_DIST * this.H + this.reachOf().front;
    if (isQuickStrike(move)) return QUICK_DIST * this.H + this.reachOf().front;
    return this.H * CLOSE_REACH * 1.45;
  }

  /** How far it can go along `dir` (−1, 1) at its height before a wall (world units). */
  private roomAlong(arena: Arena, dir: number): number {
    const p = this.node.position;
    let open = 0;
    while (open < 200 && !this.solids(arena).some((s) => this.overlaps(p.x + dir * (open + 0.1), p.y + 1e-3, s))) open += 0.1;
    return open;
  }

  /** Whether `move` sets its brace off: any blow, Sucker Punch's and Detect's; a physical one only, Counter's. */
  setsOff(move: string): boolean {
    return this.moves.control !== 'Counter' || getMove(move)?.category === MoveCategory.PHYSICAL;
  }

  /**
   * Counter's blow: gone backwards (a back dash's vanish — facing `foe`, dropping back in its jump-down pose, its lines
   * streaking away from it) and back in at its front — on its own side, facing it, opening out mid-swing (its clip
   * COUNTER_LEAD s short of the blow), the blow landing as it is whole (Fighting, plain).
   */
  private strikeFromFront(arena: Arena, foe: Fighter, damage: number): void {
    const side = Math.sign(this.x - foe.x) || -foe.facing;
    const [flo, fhi] = foe.span();
    const front = this.reachOf().front + FEINT_GAP;
    let x = side > 0 ? fhi + front : flo - front;
    if (!this.fitsAt(arena, x, foe.y, -side)) x = this.x;
    const to = new Vector3(x, foe.y, 0);
    this.quick = true; this.vx = 0; this.vy = 0;
    this.using = 'Counter'; this.usingSince = this.time;
    this.face(-side, true);
    const strike = () => {
      this.begin('Counter');
      void this.factory.playStrike(this.node, foe.node.position.clone(), 'Fighting', () => {
        const [l, r, b, t] = foe.box(), [ml, mr] = this.span();
        const close = Math.min(Math.abs(l - mr), Math.abs(ml - r)) < this.H * 0.6 && this.y < t && this.y + this.H > b;
        if (foe.down || foe.invulnerable || !close) return false;
        return foe.takeHit(this, 'Counter', () => this.factory.playHitReact(foe.node), arena, damage);
      }, { lead: COUNTER_LEAD }).then(() => this.end());
    };
    void this.factory.playTeleport(this.node, to, {
      look: 'lines', element: 'Fighting', face: side < 0 ? Math.PI / 2 : -Math.PI / 2,
      backward: true, arriveForward: true, going: new Vector3(side, 0, 0),
      onArrive: () => { this.face(-side, true); strike(); },
    }).then(() => {
      this.grounded = this.y <= 1e-3;
      if (!this.grounded) this.flying = this.flying || this.mayFly;
      this.quick = false; this.quickCool = TELEPORT_COOL;
    });
  }

  /** Thrown back `dir` (−1, 1): carried off fast and up a little, out of its own control and flinching till it is down again. */
  knockBack(dir: number): void {
    if (this.down) return;
    this.interruptRun();
    this.beam?.play.cancel?.(); this.beam = null;
    this.dropBalls(); this.stopRam();
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
    // (A Stone Edge pillar in its line — standing there from the first, or come up since: it goes no further, nothing
    // past it struck.)
    const wall = Fighter.nearer(Fighter.pillarAlong(arena, b.from, b.dir, b.reach), Fighter.groundAlong(arena, b.from, b.dir, b.reach));
    const full = wall === null ? b.reach : Math.min(b.reach, wall);
    const k = Math.min(1, Math.max(0, (this.time - b.launchedAt) / FRONT_TIME));
    const reach = Math.min(full, b.range * (1 - (1 - k) * (1 - k) * (1 - k)));
    if (reach < 0.2) return;
    // (A foe braced to counter in its line: set off just before the front reaches it — the beam never lands.)
    const ka = Math.min(1, Math.max(0, (this.time + COUNTER_SENSE - b.launchedAt) / FRONT_TIME));
    const reachSoon = b.range * (1 - (1 - ka) * (1 - ka) * (1 - ka));
    for (const f of this.foes(arena)) {
      if (!f.countering || f.down || f.invulnerable || b.struck.has(f) || !f.setsOff(b.move)) continue;
      const d = Fighter.lineMeets(b.from, b.dir, Math.min(reachSoon, full + 0.3), f);
      if (d === null) continue;
      b.struck.add(f);
      f.takeHit(this, b.move, b.play.contactEnds, arena);
      if (this.beam !== b) return;
    }
    let nearest = Infinity, onto: Fighter | null = null, inLine = false, aimAt = Infinity;
    for (const f of this.foes(arena)) {
      // (Its end — where its front is going — on the nearest foe in its line within its full reach, from the first: so
      // its front runs to that one and stops on it, never on past it and back.)
      if (!f.down) { const da = Fighter.lineMeets(b.from, b.dir, full, f); if (da !== null && da < aimAt) aimAt = da; }
      // (Its look — contact or not — by whether a foe is in its line at all, within its full reach: so a beam on its
      // way to one already looks as it will on it, and one it struck still counts down. Its blows still wait for its front.)
      if ((!f.down || b.struck.has(f)) && Fighter.lineMeets(b.from, b.dir, full, f, true) !== null) inLine = true;
      if (f.down) continue;
      // (Its front out — or this one already struck by it — its line runs to its full reach: pushed back, it is still in it.)
      const held = k >= 1 || b.struck.has(f);
      const d = Fighter.lineMeets(b.from, b.dir, held ? full : Math.min(reach, full + 0.3), f);
      if (d === null) continue;
      // (The beam stops on the nearest in its line — struck now, or held in it since.)
      if (d < nearest) { nearest = d; onto = held ? f : d <= reach + 0.05 ? f : null; }
      if (b.struck.has(f) || f.invulnerable) continue;
      b.struck.add(f);
      if (f.takeHit(this, b.move, b.play.contactEnds, arena)) { this.factory.holdHitReact(f.node, b.play.contactEnds); this.zap(f, b.move, b.play.contactEnds); }
    }
    // Its end on that one (its end ball on it) — or, none in its line, out to its full reach again (a beam 2's end ball smaller).
    b.connected = inLine;
    b.onto = onto;
    const to = Math.max(Math.min(1, full), Math.min(full, nearest, aimAt));
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
    // (Its rival's beam — or ball — charging: taken into the clash, played from here, a ball as its half of the ball.)
    const theirs = rival.seize();
    theirs.play.cancel?.();
    // Its head start (s): how much sooner its front would have launched. Their fronts meet where both have come as far
    // as the time allows — the rival's share of the way (from its mouth) 1/2 + head / (2 · FRONT_TIME).
    const head = Math.max(0, Math.min(FRONT_TIME, rival.time - theirs.pressedAt));
    const fromRival = Math.min(0.85, 0.5 + head / (2 * FRONT_TIME));
    // Each beam's power, and its type's effectiveness on the other beam's type.
    const mineT = this.clashTerms(name, theirs.move), itsT = rival.clashTerms(theirs.move, name);
    const ahead = (p: { P: number; E: number }, q: { P: number; E: number }) => p.P >= q.P && p.E >= q.E && (p.P > q.P || p.E > q.E);
    // The stopper: a number each, running up and down (from its own point in the run), from when the beams meet; one
    // stop each — the number stopped on N, its multiplier 1 + N / METER_MAX.
    type Side = { phase: number; stop: number | null; q: number | null };
    const rs: Side = { phase: Math.random(), stop: null, q: null }, ms: Side = { phase: Math.random(), stop: null, q: null };
    let t0 = -1, decidedAt = -1, outcome: number | null = null, outright = false;
    const run = (s: Side, now: number) => {
      const x = (s.phase + (now - t0) / (1000 * METER_PERIOD)) % 1;
      return Math.round(METER_MAX * (x < 0.5 ? 2 * x : 2 - 2 * x));
    };
    const timing = (q: number) => 1 + q;
    const decide = (now: number) => {
      // (Not stopped in time: 0.)
      rs.stop ??= 0; ms.stop ??= 0; rs.q ??= 0; ms.q ??= 0;
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
      press: () => { if (t0 < 0 || s.stop !== null || outcome !== null) return; s.stop = run(s, performance.now()); s.q = s.stop / METER_MAX; },
      value: () => (t0 < 0 ? null : s.stop ?? (outcome !== null ? null : run(s, performance.now()))),
      needle: () => { const v = t0 < 0 ? null : s.stop ?? (outcome !== null ? null : run(s, performance.now())); return v === null ? null : v / METER_MAX; },
      stopped: () => s.stop, quality: () => s.q,
      timing: () => (s.q === null ? null : timing(s.q)),
      outcome: () => (outcome === null ? null : outcome * sign), outright: () => outright,
    });
    rival.clashing = meter(rs, 1);
    this.clashing = meter(ms, -1);
    // (Every bolt — Thunderbolt off the body, Ice Beam, Psybeam — clashes on beam 2's clash ball, the one made for them,
    // never beam 1's.)
    const onBall = (s: BeamSpec): BeamSpec => ({ ...(s.bolt && s.style !== 2 ? { ...s, style: 2 as const } : s), groundY: 0 });
    const play = this.factory.playClash(rival.node, this.node, onBall(theirs.spec), onBall(spec), null, 0, undefined, fromRival, struggle);
    for (const f of [this, rival]) { f.firing = true; f.using = f === this ? name : theirs.move; f.usingSince = f.time; }
    this.beam = null; rival.beam = null;
    arena.onClash?.(rival, this, null, +fromRival.toFixed(2));
    let won: Fighter | null = null;
    void play.hit.then(() => {
      this.clashing = null; rival.clashing = null;
      const w = play.winner?.();
      const winner = w === this.node ? this : w === rival.node ? rival : null;
      // (Its beam's cooldown: the winner's, once its beam is done; a tie — both burst — both now: a burst is no
      // interruption, each beam went as it should.)
      won = winner;
      if (!winner) { this.completeRun(); rival.completeRun(); }
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
      const damage = hurt(timing(q) * winner.damageTo(move, loser));
      if (loser.takeHit(winner, move, () => this.factory.playHitReact(loser.node), arena, damage)) winner.zap(loser, move, play.done);
    });
    void play.done.then(() => { this.clashing = null; rival.clashing = null; if (won?.run) won.finishRun(won.run.k); this.end(); rival.end(); });
  }

  /** Its close move (a slash), where it stands: on the nearest foe within CLOSE_REACH ahead, level with it — else a miss (no burst). */
  private slash(arena: Arena): void {
    if (!this.moves.close) return;
    if (this.moves.close === 'Earthquake') { this.quake(arena); return; }
    if (isRamMove(this.moves.close)) { this.ram(arena); return; }
    if (isFlurry(this.moves.close)) { this.flurry(arena); return; }
    const type = slashType(this.moves.close);
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
    const k = this.startRun(name);
    void this.factory.playCrossSlash(this.node, at, type, () => {
      // (Asked as the blow falls: still there?)
      if (!near || !inReach(near)) return false;
      return near.takeHit(this, name, () => this.factory.playHitReact(near.node), arena);
    }, true).then(() => { this.finishRun(k); this.end(); });
  }

  /**
   * Earthquake: it stamps where it stands — from the air, gone straight up and back in on the ground under it, coming
   * straight down, to stamp there — and its wave runs out radially round it, an area
   * QUAKE_RADIUS round it (QuakeFx, QUAKE_DELAY s after the stamp begins) — every foe on the ground in it struck and
   * thrown up (QUAKE_POP) as its ring reaches it; one in the air as it passes, missed. The camera jolted at the stamp,
   * rumbling as it runs.
   */
  private quake(arena: Arena): void {
    const name = this.moves.close!;
    // From the air: gone straight up, and back in on the ground right under where it was, coming straight down — in its
    // charging pose — stamping as it lands.
    if (!this.grounded) {
      const floor = this.floorBelow(arena);
      this.begin(name);
      this.quick = true; this.vx = 0; this.vy = 0;
      const to = new Vector3(this.x, floor, 0);
      void this.factory.playTeleport(this.node, to, { look: 'lines', going: new Vector3(0, 1, 0), arriveWay: new Vector3(0, -1, 0),
        arriveClip: 'charge', gap: QUAKE_AIR_GAP, face: this.facing > 0 ? Math.PI / 2 : -Math.PI / 2 }).then(() => {
        this.quick = false; this.flying = false; this.vy = 0;
        this.grounded = true;
        this.stamp(arena, name);
      });
      return;
    }
    this.begin(name);
    this.vx = 0;
    this.stamp(arena, name);
  }

  /** The floor right under it (world y): the top of the highest platform below its feet, else the ground (0). */
  private floorBelow(arena: Arena): number {
    let y = this.y;
    while (y > 0 && !arena.level.some((s) => this.overlaps(this.x, y - 0.02, s))) y -= 0.02;
    return Math.max(0, y);
  }

  /**
   * Stone Edge: pillars of stone burst up out of the floor in a row from just ahead of it out to its foe (EDGE_RANGE at
   * most) — four, room allowing — one after another, each after its crack shows (EDGE_TELL s, the nearer first): the one
   * under the foe struck it and threw it up onto its top; the ones between, a wall — stepped up toward the foe
   * (EDGE_HEIGHTS), too tall to jump from the floor at their top. They stand EDGE_LIFE s as platforms (shaking EDGE_WARN s
   * before they go), then crumble; a beam stops at them. One set at a time: a new one crumbles the old. Earthquake
   * shatters them; nothing goes through them — run, dash or teleport: over them — but a Ghost type, which passes them.
   */
  private stoneEdge(arena: Arena): void {
    const name = this.moves.ranged!;
    const foe = this.foes(arena).filter((f) => !f.down).sort((a, b) => Math.abs(a.x - this.x) - Math.abs(b.x - this.x))[0];
    const dir = foe ? Math.sign(foe.x - this.x) || this.facing : this.facing;
    this.face(dir, true);
    const reach = Math.min(EDGE_RANGE, foe ? Math.abs(foe.x - this.x) : EDGE_RANGE, this.roomAlong(arena, dir) - EDGE_W);
    if (reach < EDGE_NEAR) return;
    this.begin(name);
    this.vx = 0;
    const k = this.startRun(name);
    // (Its old set gone first.)
    for (const old of [...this.pillars]) old.crumble();
    const floor = this.grounded ? this.y : 0;
    // Where they come up: under its foe (its target), and the wall between — none within EDGE_NEAR of it.
    // (As many of the wall's as there is room for between — EDGE_HEIGHTS.length at most — side by side, each its own.)
    const room = reach - EDGE_W / 2 - EDGE_NEAR;
    const between = Math.max(0, Math.min(EDGE_HEIGHTS.length, Math.floor(room / (EDGE_W * EDGE_FIT))));
    const spots: { x: number; h: number; hit: boolean }[] = [];
    for (let i = 0; i < between; i++) {
      const d = EDGE_NEAR + (room * (i + 0.5)) / between;
      spots.push({ x: this.x + dir * d, h: EDGE_HEIGHTS[EDGE_HEIGHTS.length - between + i], hit: false });
    }
    spots.push({ x: this.x + dir * reach, h: EDGE_TARGET_H, hit: true });
    void this.factory.playAttackLunge(this.node, new Vector3(this.x + dir * reach, floor, 0)).then(() => { if (this.using === name) this.end(); });
    const struck = new Set<Fighter>();
    const list = (arena.pillars ??= []);
    spots.forEach((at, i) => {
      const plat: Platform = { x: at.x - EDGE_W / 2, top: floor, w: EDGE_W, h: 0, hidden: true, pillar: true };
      let added = false, done = false;
      // (A foe it bursts up under rides its top up — carried, not pushed out its side — and is thrown up off it once it
      // is all the way up.)
      const riding = new Set<Fighter>();
      const handle = this.factory.playPillar({ x: at.x, z: 0, floor, height: at.h, width: EDGE_W, H: this.H, tell: EDGE_TELL + i * EDGE_STAGGER,
        onTop: (top) => {
          plat.top = top; plat.h = top - floor;
          if (!added && top > floor + 0.05 && !done) { added = true; arena.level.push(plat); }
          // (Held on its middle — the blow's shove cancelled — so it comes back down on its top.)
          for (const f of riding) {
            f.node.position.x = at.x; f.node.position.y = Math.max(f.y, top); f.vy = Math.max(f.vy, 0); f.vx = 0; f.knockT = 0;
            if (top >= floor + at.h - 1e-3) { riding.delete(f); f.vy = EDGE_POP; f.grounded = false; }
          }
        } });
      const pillar: Pillar = { x: at.x, plat, owner: this, crumble: () => {
        if (done) return;
        done = true;
        const li = arena.level.indexOf(plat); if (li >= 0) arena.level.splice(li, 1);
        const pi = list.indexOf(pillar); if (pi >= 0) list.splice(pi, 1);
        const mi = this.pillars.indexOf(pillar); if (mi >= 0) this.pillars.splice(mi, 1);
        void handle.crumble();
      } };
      list.push(pillar); this.pillars.push(pillar);
      void handle.up.then(() => {
        if (done) return;
        // Bursting up under a foe: struck, and thrown up onto its top.
        for (const f of this.foes(arena)) {
          if (struck.has(f) || f.down || f.invulnerable) continue;
          if (Math.abs(f.x - at.x) > EDGE_W / 2 + f.W / 2 || f.y > floor + at.h) continue;
          struck.add(f);
          // (Onto its middle, to ride it up.)
          if (f.takeHit(this, name, () => this.factory.playHitReact(f.node), arena)) { f.node.position.x = at.x; riding.add(f); }
        }
        // (Gone off as it should with its first pillar up: its cooldown from now.)
        if (i === 0) this.finishRun(k);
      });
      setTimeout(() => handle.warn(EDGE_WARN), (EDGE_TELL + i * EDGE_STAGGER + EDGE_LIFE - EDGE_WARN) * 1000);
      setTimeout(() => pillar.crumble(), (EDGE_TELL + i * EDGE_STAGGER + EDGE_LIFE) * 1000);
    });
  }
  /** Its Stone Edge pillars standing now. */
  private pillars: Pillar[] = [];

  /** Earthquake's stamp where it stands, on the ground: its charging pose, its wave let go from it. */
  private stamp(arena: Arena, name: string): void {
    const k = this.startRun(name);
    // (Its charging pose, the wave let go from it.)
    void this.factory.playChargePose(this.node, QUAKE_POSE).then(() => { if (this.using === name) this.end(); });
    const x0 = this.x, floor = this.y;
    // Its tremors: QUAKE_PULSES waves out from it, QUAKE_PULSE_GAP s apart, each a share of the blow to a foe on the
    // ground as it reaches it — in the air as one passes, that one missed (a jump timed well dodges some, or all). Only
    // the last throws it up (thrown by an earlier one, the rest would miss it).
    const tremor = (n: number) => {
      const last = n === QUAKE_PULSES - 1;
      const passed = new Set<Fighter>();
      arena.shake?.(n === 0 ? QUAKE_JOLT : QUAKE_JOLT * 0.5);
      const radius = QUAKE_RADIUS;
      void this.factory.playQuake({ x: x0, z: 0, floor, height: this.H, radius, ripple: n > 0,
        onFront: (front) => {
          arena.shake?.(QUAKE_RUMBLE);
          // (Its wave shatters any Stone Edge pillar it reaches.)
          for (const pl of [...(arena.pillars ?? [])]) if (Math.abs(pl.x - x0) <= Math.min(front, radius)) pl.crumble();
          for (const f of this.foes(arena)) {
            // (Its area: within its radius, as its ring reaches it.)
            if (passed.has(f) || Math.abs(f.x - x0) > Math.min(front, radius)) continue;
            passed.add(f);
            // (In the air as it passes: missed.)
            if (!f.grounded || f.down || (f.invulnerable && n === 0)) continue;
            const share = Math.max(1, Math.round(this.damageTo(name, f) / QUAKE_PULSES));
            // (Its later tremors strike through the grace the first one's blow left: one quake, several blows.)
            if (f.takeHit(this, name, () => this.factory.playHitReact(f.node), arena, share, n > 0) && last) { f.vy = Math.max(f.vy, QUAKE_POP); f.grounded = false; }
          }
        } });
      // (Gone off as it should once its first tremor is out: its cooldown from now — not left to its last, which a move
      // begun meanwhile would rob of its finish, and so of any cooldown at all.)
      if (n === 0) this.finishRun(k);
    };
    for (let n = 0; n < QUAKE_PULSES; n++) setTimeout(() => tremor(n), (QUAKE_DELAY + n * QUAKE_PULSE_GAP) * 1000);
  }

  /** Quick Attack, the way it faces: QUICK_DIST × its height on, short of a wall, or up to the nearest body in its way (a foe there struck). */
  private quickAttack(arena: Arena, move = 'Quick Attack'): void {
    if (!this.ready(move) || (!this.grounded && !this.flying && !this.airDash)) return;
    const type = getMove(move)?.moveType ?? 'Normal';
    const p = this.node.position, dir = this.facing;
    // (Along its aim when aloft, or aimed up off the ground — level otherwise: it can't go down into the ground.)
    const tilt = !this.grounded || this.aim > 0 ? this.aim * AIM_ANGLE : 0;
    const ux = Math.cos(tilt), uy = Math.sin(tilt);
    let reach = QUICK_DIST * this.H;
    const stepLen = 0.05;
    for (let d = stepLen; d <= reach; d += stepLen) {
      if (this.solids(arena).some((s) => this.overlaps(p.x + dir * ux * d, p.y + uy * d + 1e-3, s))) { reach = d - stepLen; break; }
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
    this.using = move; this.usingSince = this.time;
    if (this.announceAttack(arena)) { this.dropAttack(); return; }
    const k = this.startRun(move);
    // (Coated head to toe — Aqua Jet, Zippy Zap, Grassy Glide: its water bursting off it as the blow lands. A punch
    // thrown with its arm.)
    const coat = QUICK_COATED.has(move) ? this.factory.aura(this.node, coatOf(move, type)) : null;
    const strike = isPunch(move) && this.factory.punchPlan?.(this.node).key === 'swipe' ? 'swipe' : 'attack';
    void this.factory.playQuickStep(this.node, at, land, strike, type, !!struck).then(() => {
      if (coat) void (struck && coat.burst ? coat.burst() : coat.release());
      if (struck && !struck.down) struck.takeHit(this, move, () => this.factory.playHitReact(struck.node), arena);
      if (this.canFly && this.aim > 0 && this.y > 1e-3) this.flying = true;
      this.quick = false; this.quickCool = QUICK_COOL; this.using = ''; this.finishRun(k);
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
    if (!opts.foe && (!this.ready(move) || (!this.grounded && !this.flying && !this.airDash))) return;
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
    const k = opts.foe ? -1 : this.startRun(move);
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
      }).then(() => { unlock(); opts.onBlow?.(); this.finishRun(k); this.end(); });
    };
    void this.factory.playTeleport(this.node, to, {
      look, element: type, face: at.dir > 0 ? Math.PI / 2 : -Math.PI / 2,
      onArrive: midStrike ? () => { this.face(at.dir, true); strike(); } : undefined,
    }).then(() => {
      this.face(at.dir, true);
      this.grounded = this.y <= 1e-3;
      // (Aloft by its foe's side: held there for the blow, as if flying.)
      if (!this.grounded) this.flying = this.flying || this.mayFly;
      this.quick = false; this.quickCool = TELEPORT_COOL;
      if (!midStrike) { this.clip = ''; strike(); }
    });
  }

  /**
   * Teleport: gone in its ring and back right behind its nearest foe, facing its back — its foe, caught unawares, held
   * from turning round TELEPORT_UNAWARE s: its chance. No room behind it: before it. No foe: along its aim, as ever.
   */
  private teleportBehind(arena: Arena): void {
    const foe = this.foes(arena).filter((f) => !f.down)
      .sort((a, b) => Math.hypot(a.x - this.x, a.y - this.y) - Math.hypot(b.x - this.x, b.y - this.y))[0];
    if (!foe) { this.teleport(arena, 'ring'); return; }
    // (Behind it: on the side it faces away from.)
    const spot = (s: number) => {
      const [flo, fhi] = foe.span();
      return { x: s > 0 ? fhi + this.reachOf().front + FEINT_GAP : flo - this.reachOf().front - FEINT_GAP, dir: -s };
    };
    let at = spot(-foe.facing);
    if (!this.fitsAt(arena, at.x, foe.y, at.dir)) at = spot(foe.facing);
    if (!this.fitsAt(arena, at.x, foe.y, at.dir)) { this.teleport(arena, 'ring'); return; }
    this.quick = true; this.vx = 0; this.vy = 0;
    this.using = 'Teleport'; this.usingSince = this.time;
    const k = this.startRun('Teleport');
    void this.factory.playTeleport(this.node, new Vector3(at.x, foe.y, 0), {
      look: 'ring', element: 'Psychic', face: at.dir > 0 ? Math.PI / 2 : -Math.PI / 2,
      onArrive: () => {
        this.face(at.dir, true);
        // (Caught unawares: it can't turn round for a moment.)
        foe.unawareUntil = foe.time + TELEPORT_UNAWARE;
      },
    }).then(() => {
      this.face(at.dir, true);
      this.grounded = this.y <= 1e-3;
      if (!this.grounded) this.flying = this.flying || this.mayFly;
      this.quick = false; this.quickCool = TELEPORT_COOL; this.using = ''; this.clip = '';
      this.finishRun(k);
    });
  }

  /** Agility: its boost — AGILITY_TIME s of zippy dashes — a flash as it takes hold; its cooldown from now. */
  private agility(): void {
    if (!this.ready('Agility')) return;
    const k = this.startRun('Agility');
    this.agilityUntil = this.time + AGILITY_TIME;
    this.factory.tell(this.node, AGILITY_GLOW, 0.35);
    this.finishRun(k);
  }

  /**
   * Its dash button (L): held a way (`want`), a dash that way — a plain one (fast, its zippy dash's springing pose,
   * afterimages), or under Agility a zippy dash, gone in speed lines and back ZIP_GAIN × as far; held neither way, a
   * back dash (under Agility ZIP_GAIN × as far).
   */
  private dashButton(arena: Arena, want: number): void {
    if (!want) { this.backDash(arena); return; }
    if (!this.ready('Dash')) return;
    if (want !== this.facing) this.face(want, true);
    if (this.zippy) this.teleport(arena, 'lines', undefined, { cool: AGILITY_COOL, face: want, name: 'Dash', dist: ZIP_GAIN * DASH_SPEED * DASH_TIME / (TELEPORT_DIST * this.H) });
    else this.dash();
  }

  /**
   * A back dash: gone backwards in speed lines, BACK_DASH_DIST × a teleport's way (under Agility ZIP_GAIN × that), level
   * (along its aim aloft), still facing forwards — dropping back in its jump-down pose as it goes.
   */
  private backDash(arena: Arena): void {
    if (!this.ready('Back Dash')) return;
    this.teleport(arena, 'lines', undefined, { cool: BACK_DASH_COOL, dir: -this.facing, face: this.facing, backward: true,
      dist: BACK_DASH_DIST * (this.zippy ? ZIP_GAIN : 1), name: 'Back Dash' });
  }

  /**
   * `o`: how soon the next (s; TELEPORT_COOL), the way it goes (its facing), the way it arrives facing (its nearest
   * foe), backwards (a back dash's look), how far (× TELEPORT_DIST).
   */
  private teleport(arena: Arena, look: 'lines' | 'ring', element?: string,
    o: { cool?: number; dir?: number; face?: number; backward?: boolean; arriveForward?: boolean; dist?: number; name?: string; force?: boolean; toX?: number } = {}): void {
    const name = o.name ?? this.moves.mobility ?? 'Teleport';
    // (`force`: whatever its readiness or the air — Detect going off. `toX`: straight there, level — its far end.)
    if (!o.force && (!this.ready(name) || (!this.grounded && !this.flying && !this.airDash))) return;
    const p = this.node.position, dir = o.dir ?? this.facing;
    const tilt = !this.grounded || this.aim > 0 ? this.aim * AIM_ANGLE : 0;
    const ux = dir * Math.cos(tilt), uy = Math.sin(tilt);
    const fits = (x: number, y: number) => y >= 0 && !arena.level.some((s) => this.overlaps(x, y + 1e-3, s))
      && !this.others(arena).some((f) => {
        const [lo, hi] = this.span(x), [flo, fhi] = f.span();
        return y < f.y + f.H && y + this.H > f.y && hi > flo && lo < fhi;
      });
    // (Through bodies, never through a wall: no further than the level lets it go along the way — the ground below
    // aside, as an aim down along it would graze it.)
    // (Never through a Stone Edge pillar either — a wall, gone over, not through — but for a Ghost type, which passes it.)
    const wallAt = (d: number) => this.solids(arena).some((s) => this.overlaps(p.x + ux * d, Math.max(0, p.y + uy * d) + 1e-3, s));
    let open = 0;
    const reach = TELEPORT_DIST * (o.dist ?? 1) * this.H;
    while (open < reach * TELEPORT_PAST && !wallAt(open + 0.1)) open += 0.1;
    // (Landing in a body: on past it first — behind it — up to TELEPORT_PAST further; else drawn back till it fits.)
    const full = Math.min(reach, open);
    let d = o.toX !== undefined ? Math.abs(o.toX - p.x) : full;
    const ux2 = o.toX !== undefined ? Math.sign(o.toX - p.x) || dir : 0;
    if (o.toX !== undefined) {
      // (Its far end: back from the wall till it fits there.)
      while (d > 0.2 && !fits(p.x + ux2 * d, p.y)) d -= 0.1;
    } else if (!fits(p.x + ux * d, p.y + uy * d)) {
      let on = d;
      while (on < Math.min(full * TELEPORT_PAST, open) && !fits(p.x + ux * on, p.y + uy * on)) on += 0.1;
      if (on < Math.min(full * TELEPORT_PAST, open) || fits(p.x + ux * on, p.y + uy * on)) d = on;
      else { while (d > 0.2 && !fits(p.x + ux * d, p.y + uy * d)) d -= 0.1; }
    }
    if (d <= 0.2) return;
    const to = o.toX !== undefined ? new Vector3(p.x + ux2 * d, p.y, 0) : new Vector3(p.x + ux * d, p.y + uy * d, 0);
    if (!this.grounded && !this.flying) this.airDash = false;
    this.quick = true; this.vx = 0; this.vy = 0;
    this.using = name; this.usingSince = this.time;
    const k = this.startRun(name);
    // (There, it will face its nearest foe — behind it, it turns round; it comes in already facing so.)
    const foe = this.foes(arena).sort((a, b) => Math.abs(a.x - to.x) - Math.abs(b.x - to.x))[0];
    const faceThere = o.face ?? (foe ? Math.sign(foe.x - to.x) || dir : dir);
    void this.factory.playTeleport(this.node, to, { look, element, face: faceThere > 0 ? Math.PI / 2 : -Math.PI / 2, backward: o.backward, arriveForward: o.arriveForward }).then(() => {
      this.face(faceThere, true);
      this.grounded = this.y <= 1e-3;
      // (Aimed up, a flier is carried into the sky — even out of it for now: the way up past its wait.)
      if (!this.grounded && this.canFly && this.aim > 0) this.flying = true;
      this.quick = false; this.quickCool = o.cool ?? TELEPORT_COOL; this.using = ''; this.finishRun(k);
      // (Its resting clip, as the teleport eased it in — named so, not played again over it with a snap.)
      this.clip = this.restingClip();
    });
  }

  private dash(): void {
    if (this.dashCool > 0 || !this.ready('Dash') || !(this.grounded || this.flying || this.airDash)) return;
    this.dashT = DASH_TIME; this.dashCool = DASH_COOL; this.ghostT = 0;
    this.dashK = this.startRun('Dash');
    if (!this.grounded && !this.flying) this.airDash = false;
  }

  /**
   * Its ranged move a ball: charged at its mouth as a beam is (struck meanwhile: gone), let go along its aim — and its
   * thrower free at once, the ball flying on by itself (flyBalls). Aura Sphere homes on the nearest foe ahead in reach.
   */
  private throwBall(arena: Arena, name: string, spec: BallSpec): void {
    this.face(this.facing, true);
    const from = this.mouth(), dir = this.aimDir();
    const homing = getMove(name)?.alwaysHits
      ? this.foes(arena).filter((f) => !f.down && Math.sign(f.x - this.x) === this.facing && Math.hypot(f.x - this.x, f.y - this.y) <= BALL_REACH)
        .sort((a, b) => Math.abs(a.x - this.x) - Math.abs(b.x - this.x))[0] ?? null
      : null;
    // (Straight: to its reach, or the Stone Edge pillar in its way.)
    const far = homing ? BALL_REACH : Fighter.nearer(Fighter.pillarAlong(arena, from, dir, BALL_REACH), Fighter.groundAlong(arena, from, dir, BALL_REACH)) ?? BALL_REACH;
    const end = new Vector3(from[0] + dir[0] * far, from[1] + dir[1] * far, 0);
    // (Its look in a clash: the clash's half a ball's, in its colours.)
    const clashSpec: BeamSpec = { element: spec.element, ball: spec.colours ?? true, tornado: spec.tornado };
    // A foe's beam or ball charging at it, their lines meeting: a clash, as two beams'.
    const rival = this.rivalFor(arena, from, dir);
    if (rival) {
      // (As a beam's: the clash takes both into it — or the burst, point-blank, leaves both free. Not begun here: begun,
      // a burst would leave it held in its throw for good.)
      this.startRun(name);
      if (Math.hypot(rival.x - this.x, rival.y - this.y) < CLASH_MIN) this.faceBurst(rival, name, clashSpec, arena);
      else this.clash(rival, name, clashSpec, arena);
      return;
    }
    this.begin(name);
    this.lineGaze = Math.atan2(dir[1], Math.abs(dir[0]));
    if (this.announceAttack(arena)) { this.dropAttack(); return; }
    const k = this.startRun(name);
    const play = this.factory.playBall(this.node, homing?.node ?? null, end, spec, { point: !homing });
    const t: Thrown = { play, move: name, homing, launched: false, done: false, passed: new Set(), from, dir, pressedAt: this.time, spec: clashSpec };
    this.balls.push(t);
    void play.launched?.then(() => {
      if (!this.balls.includes(t)) return;
      t.launched = true;
      // Let go: its cooldown from now, and free at once — the ball flies on by itself.
      this.finishRun(k);
      if (this.firing && this.using === name) this.end();
    });
    void play.hit.then(() => {
      // (Aura Sphere at the end of its flight with nothing met on the way: on its foe — it never misses.)
      if (!t.done && t.launched && homing && !homing.down && !t.passed.has(homing) && this.balls.includes(t)) {
        t.done = true;
        homing.takeHit(this, name, () => this.factory.playHitReact(homing.node), arena);
      }
      t.done = true;
    });
    void play.done.then(() => { this.balls = this.balls.filter((b) => b !== t); });
  }

  /** Its balls in flight, this frame: one touching a foe strikes it and bursts there; one in a Stone Edge pillar bursts on it. */
  private flyBalls(arena: Arena): void {
    for (const t of this.balls) {
      if (!t.launched || t.done || !t.play.position) continue;
      const p = t.play.position(), r = BALL_TOUCH * this.H;
      if (!t.homing && arena.level.some((s) => s.pillar && p.x > s.x - r && p.x < s.x + s.w + r && p.y < s.top + r && p.y > s.top - s.h - r)) {
        t.done = true; t.play.burst?.(); continue;
      }
      // Another's ball met on its way, in the air: the stronger flies on, the other bursts (even: both).
      const met = this.foes(arena).flatMap((f) => f.balls.filter((o) => o.launched && !o.done && o.play.position).map((o) => ({ f, o })))
        .find(({ f, o }) => { const q = o.play.position!(); return Math.hypot(q.x - p.x, q.y - p.y) < r + BALL_TOUCH * f.H; });
      if (met) {
        const won = this.outweighs(t.move, met.f, met.o.move);
        if (won <= 0) { t.done = true; t.play.burst?.(); }
        if (won >= 0) { met.o.done = true; met.o.play.burst?.(); }
        arena.onStatus?.(won > 0 ? this : won < 0 ? met.f : this, `ball clash: ${t.move} vs ${met.o.move} — ${won > 0 ? t.move : won < 0 ? met.o.move : 'even'}`, 0);
        if (t.done) continue;
      }
      // A foe's beam pouring across its way: the stronger goes on — the ball bursting on it, or the beam cut off.
      const across = this.foes(arena).find((f) => {
        const b = f.beam;
        if (!b || !b.launched || !b.pouring) return false;
        const along = Math.max(0, Math.min(b.range, (p.x - b.from[0]) * b.dir[0] + (p.y - b.from[1]) * b.dir[1]));
        return Math.hypot(p.x - (b.from[0] + b.dir[0] * along), p.y - (b.from[1] + b.dir[1] * along)) < r + BEAM_TOUCH * f.H;
      });
      if (across) {
        const b = across.beam!, won = this.outweighs(t.move, across, b.move);
        if (won <= 0) { t.done = true; t.play.burst?.(); }
        if (won >= 0) { b.play.cancel?.(); across.beam = null; across.firing = false; across.using = ''; across.completeRun(); }
        arena.onStatus?.(won > 0 ? this : across, `ball vs beam: ${t.move} vs ${b.move} — ${won > 0 ? t.move : won < 0 ? b.move : 'even'}`, 0);
        if (t.done) continue;
      }
      for (const f of this.foes(arena)) {
        if (f.down || t.passed.has(f)) continue;
        const [l, rr, b, tp] = f.box();
        if (Math.hypot(Math.max(l, Math.min(rr, p.x)) - p.x, Math.max(b, Math.min(tp, p.y)) - p.y) > r) continue;
        t.passed.add(f);
        // (Unhurtable, or braced and gone — Detect, Sucker Punch: it flies on through where it was.)
        if (f.takeHit(this, t.move, () => this.factory.playHitReact(f.node), arena)) { t.done = true; t.play.burst?.(); break; }
      }
    }
  }

  /** A foe (facing it) whose beam or ball, charging, has a line meeting its own (from, along dir): a clash. */
  private rivalFor(arena: Arena, from: [number, number], dir: [number, number]): Fighter | null {
    const span = (f: Fighter) => { const [fx, fy] = f.mouth(); return Math.hypot(fx - from[0], fy - from[1]) + f.H; };
    return this.foes(arena).find((f) => {
      const c = f.chargeOf();
      return !!c && !f.down && f.facing === -this.facing && Fighter.linesMeet(from, dir, span(f), c.from, c.dir, span(f), (this.H + f.H) * 0.25);
    }) ?? null;
  }

  /**
   * Its `move` against `other`'s `theirs`, met in the air (a ball and a ball, or a ball and a beam): power × type
   * effectiveness each (clashTerms), as a clash weighs them — 1 its own the stronger, −1 the other's, 0 even.
   */
  private outweighs(move: string, other: Fighter, theirs: string): number {
    const a = this.clashTerms(move, theirs), b = other.clashTerms(theirs, move);
    const k = (a.P * a.E) / (b.P * b.E);
    return k > CLASH_TIE ? 1 : k < 1 / CLASH_TIE ? -1 : 0;
  }

  /** Its balls still charging gone (all of them, `all`: those in flight too, struck nothing more). Whether one was charging. */
  private dropBalls(all = false): boolean {
    let charging = false;
    for (const t of this.balls) {
      if (!t.launched) { charging = true; t.play.cancel?.(); }
      t.done = true;
    }
    this.balls = all ? [] : this.balls.filter((t) => t.launched);
    if (charging) this.interruptRun();
    return charging;
  }

  /** Its close move a ram: coated (in its coat's colours), then the run (ramStep). On the ground or flying only. */
  private ram(arena: Arena): void {
    const name = this.moves.close!;
    if (!this.grounded && !this.flying) return;
    const type = getMove(name)?.moveType ?? 'Normal';
    this.face(this.facing, true);
    this.vx = 0;
    this.using = name; this.usingSince = this.time;
    if (this.announceAttack(arena)) { this.dropAttack(); return; }
    const k = this.startRun(name);
    const coat = this.factory.aura(this.node, coatOf(name, type));
    const r = { move: name, k, dir: this.facing, go: false, ran: 0, coat, ghostT: 0 };
    this.ramming = r;
    void coat.lit.then(() => {
      if (this.ramming !== r) return;
      r.go = true;
      this.factory.ramBurst(this.node, coatOf(name, type).element, 'launch', r.dir);
    });
  }

  /** Its ram, this frame: lit, it runs on — into the first foe ahead (the blow), a wall, or its full run (a miss). */
  private ramStep(dt: number, arena: Arena): void {
    const r = this.ramming!;
    this.vy = this.flying ? 0 : Math.max(-FALL_MAX, this.vy - GRAVITY * dt);
    if (!r.go) { this.vx = 0; return; }
    const front = this.reachOf().front;
    const foe = this.foes(arena).filter((f) => {
      if (f.down) return false;
      const [lo, hi] = f.span();
      const gap = r.dir > 0 ? lo - (this.x + front) : this.x - front - hi;
      return gap <= RAM_CONTACT * this.H + RAM_SPEED * dt && gap > -this.H && f.y < this.y + this.H && f.y + f.H > this.y;
    })[0];
    const full = RAM_DIST * this.H;
    if (foe) { this.ramInto(foe, arena); return; }
    const was = this.x;
    this.vx = r.dir * RAM_SPEED;
    r.ghostT -= dt;
    if (r.ghostT <= 0) { this.factory.afterimage(this.node, DASH_GHOST); r.ghostT = DASH_GHOST_EVERY; }
    r.ran += RAM_SPEED * dt;
    // (Its full run out — or a wall: a miss, its cooldown spent all the same.)
    if (r.ran >= full || (r.ran > 0.3 && Math.abs(was - this.lastX) < 1e-4)) { this.finishRun(r.k); this.stopRam(); }
    this.lastX = was;
  }
  private lastX = NaN;

  /** Its ram on `foe`: the blow — by how far it ran — the foe thrown back, its recoil on itself. */
  private ramInto(foe: Fighter, arena: Arena): void {
    const r = this.ramming!;
    const name = r.move;
    this.factory.ramBurst(this.node, coatOf(name, getMove(name)?.moveType ?? 'Normal').element, 'hit', r.dir);
    const run = Math.min(1, r.ran / (RAM_DIST * this.H));
    const damage = hurt(this.damageTo(name, foe) * (RAM_MOMENTUM + (1 - RAM_MOMENTUM) * run));
    this.finishRun(r.k);
    this.stopRam();
    if (foe.takeHit(this, name, () => this.factory.playHitReact(foe.node), arena, damage)) {
      foe.knockBack(r.dir);
      this.recoil(hurt((getMove(name)?.recoilFraction ?? 0) * damage), name, arena);
    }
  }

  /** Its ram over (struck, missed, or landed): stopped, its coat let go. */
  private stopRam(): void {
    const r = this.ramming;
    if (!r) return;
    this.ramming = null;
    this.vx = 0; this.using = ''; this.lastX = NaN;
    void r.coat.release();
  }

  /** Its own move's recoil: `damage` off its HP (a faint if none left), told as `<move> recoil`. */
  private recoil(damage: number, move: string, arena: Arena): void {
    if (this.down || damage <= 0) return;
    this.hp = Math.max(0, this.hp - damage);
    arena.onHit?.(this, this, `${move} recoil`, damage);
    void this.factory.playHitReact(this.node);
    if (this.hp <= 0) {
      this.down = true;
      this.dropBalls(); this.firing = false; this.using = '';
      void this.factory.playFaint(this.node).then(() => {
        if (this.respawn) setTimeout(() => { if (this.down) this.restore(); }, RESPAWN * 1000);
      });
    }
  }

  /**
   * Its close move a plain contact blow (Close Combat, Thrash, Outrage…): a flurry where it stands, more and faster
   * blows the stronger it is, its damage shared out over them (each on a foe still in reach; after the first, through
   * its grace). Thrash and Outrage leave it confused (CONFUSE_TIME s).
   */
  private flurry(arena: Arena): void {
    const name = this.moves.close!;
    const dir = this.aimDir(), R = this.H * CLOSE_REACH;
    const inReach = (f: Fighter) => {
      if (f.down) return false;
      const cx = this.x + dir[0] * R * 0.75, cy = this.y + this.H * 0.5 + dir[1] * R * 0.75;
      const [l, r, b, t] = f.box();
      return Math.hypot(Math.max(l, Math.min(r, cx)) - cx, Math.max(b, Math.min(t, cy)) - cy) <= R * 0.75;
    };
    const near = this.foes(arena).filter(inReach).sort((a, b) => Math.abs(a.x - this.x) - Math.abs(b.x - this.x))[0];
    const at = near ? near.node.position.clone() : new Vector3(this.x + this.facing * this.H, this.y, 0);
    this.face(this.facing, true);
    this.begin(name);
    if (this.announceAttack(arena)) { this.dropAttack(); return; }
    const k = this.startRun(name);
    let landed = 0;
    const blow = (i: number, of: number) => {
      if (this.down || this.using !== name || !near || !inReach(near)) return;
      if (landed === 0 && near.invulnerable) return;
      const share = Math.max(1, Math.round(this.damageTo(name, near) / of));
      if (near.takeHit(this, name, () => this.factory.playHitReact(near.node), arena, share, landed > 0, i === of - 1)) landed++;
      void i;
    };
    const play = this.factory.playFlurry ? this.factory.playFlurry(this.node, at, getMove(name)?.basePower ?? 60, blow) : Promise.resolve();
    void play.then(() => {
      if (this.using !== name) return;
      this.finishRun(k); this.end();
      if (RAMPAGES.has(name)) this.confuse(CONFUSE_TIME);
    });
  }

  /** Confused for `seconds`: every way it is told turned round; a violet glow while it lasts. */
  confuse(seconds: number): void {
    if (this.down) return;
    this.confusedUntil = this.time + seconds;
    this.factory.tell(this.node, CONFUSE_GLOW, seconds);
    this.arenaRef?.onStatus?.(this, 'confused', seconds);
  }

  private begin(name: string): void { this.firing = true; this.using = name; this.usingSince = this.time; this.telling = ''; this.lineGaze = null; }
  private end(): void { this.firing = false; this.using = ''; this.clip = ''; this.lineGaze = null; this.face(this.facing, true); }

  /**
   * A blow on it: its HP down, held till `over` (its flinch — or what makes it, called only once the blow lands); out of
   * HP it faints once `over` (a practice target stands again after RESPAWN s). Whether it landed: not on one down,
   * unhurtable, or braced to counter (that one turns it back).
   */
  takeHit(by: Fighter, move: string, flinch: Promise<unknown> | (() => Promise<unknown>), arena: Arena, damageOverride?: number,
    /** A later blow of one move that strikes more than once (Earthquake's tremors): through its grace after the first. */
    through = false,
    /** Pushed back from its striker (not by a flurry's blows before its last: it stays in reach of the rest). */
    push = true): boolean {
    // (Nor from one down: a blow wound up before its striker fainted lands nothing.)
    if (this.down || (this.invulnerable && !through) || (by !== this && by.down)) return false;
    // (Braced to counter: the blow sets it off — none of it taken.)
    if (this.countering && by !== this && this.setsOff(move)) { this.counter(by, arena, move); return false; }
    // (Immune — its type unaffected by the move's: no damage, no flinch, no push; only told so.)
    const damage = damageOverride ?? hurt(by.damageTo(move, this));
    if (damage <= 0) { arena.onHit?.(by, this, move, 0); return false; }
    const over = typeof flinch === 'function' ? flinch() : flinch;
    this.shaken(arena);
    // (Unhurtable till its flinch is over and HIT_GRACE after, blinking; pushed back from its striker.)
    this.graceUntil = Infinity;
    void over.then(() => { this.graceUntil = this.time + HIT_GRACE; if (!this.down) this.factory.blink(this.node, HIT_GRACE); });
    if (push) this.pushFrom(by);
    // (Struck while braced: the brace is broken — out of it, as if it had run out.)
    // (Its move under way cut off by the blow: no cooldown for it — nor for a brace broken so.)
    this.interruptRun();
    if (this.countering) { this.counterUntil = -1; this.firing = false; this.using = ''; }
    // (Its beam, charging or pouring, cut off by the blow — quietly: its flinch, not its idle, takes over.)
    if (this.beam) { this.beam.play.cancel?.(true); this.beam = null; this.firing = false; this.using = ''; }
    // (Its ball still charging: gone with it. Its ram: stopped where it is.)
    if (this.dropBalls()) { this.firing = false; this.using = ''; }
    this.stopRam();
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
    // (Its skin not yet drawn — the page hidden, no frame rendered: no reading at all. Measured again next frame, never
    // taken as NaN: one NaN reach would spread to its place, its foe's, the camera.)
    if (!Number.isFinite(r0.front) || !Number.isFinite(r0.back)) { this.measured--; return; }
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
      // (Out of its body — but never into a wall: stopped at the wall's face, and what is left of the way out the other
      // one takes instead, stopped at its own walls.)
      const shift = p.x < f.x ? flo - hi - 1e-4 : fhi - lo + 1e-4;
      const from = p.x;
      p.x = this.wallStop(arena, from, from + shift);
      const left = shift - (p.x - from);
      if (Math.abs(left) > 1e-4) f.node.position.x = f.wallStop(arena, f.x, f.x - left);
      this.vx = 0; this.dashT = 0;
    }
  }

  /** Moving sideways from `from` to `to` where it stands: as far as it gets before a wall's face (its body against the level). */
  private wallStop(arena: Arena, from: number, to: number): number {
    const y = this.y + 1e-3, hw = this.W / 2;
    for (const s of this.solids(arena)) {
      if (!(y + this.H > s.top - s.h && y < s.top)) continue;
      if (to > from && from + hw <= s.x + 1e-3 && to + hw > s.x) to = s.x - hw - 1e-4;
      else if (to < from && from - hw >= s.x + s.w - 1e-3 && to - hw < s.x + s.w) to = s.x + s.w + hw + 1e-4;
    }
    return to;
  }

  /** What it can't pass: the level — but not a Stone Edge pillar, for a Ghost type (it passes through). */
  private solids(arena: Arena): Platform[] {
    return this.types.includes('Ghost') ? arena.level.filter((s) => !s.pillar) : arena.level;
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
      : this.dashT > 0 ? 'zipPose'
        : !this.grounded ? (this.vy > 0 ? 'jumpUpLoop' : 'jumpDownLoop')
          : this.landing > 0 ? 'land' : Math.abs(this.vx) > 0.6 ? 'run' : 'idle';
    if (want === this.clip) return;
    const player = this.factory.playerOf(this.node);
    if (!player) return;
    // (A dash: its zippy dash's springing pose — its jump up, else its fast flight, else its run.)
    const zip = want === 'zipPose' ? ['jumpUpLoop', 'jumpUpStart', 'airRun', 'airWalk', 'run'].find((c) => player.has(c)) : undefined;
    const name = zip ?? (player.has(want) ? want : want === 'airRun' && player.has('airWalk') ? 'airWalk' : want.startsWith('air') && player.has('airIdle') ? 'airIdle'
      : want === 'land' ? 'idle' : player.has('idle') ? 'idle' : want);
    this.clip = want;
    void player.play(name, { fade: want === 'land' ? 0.06 : 0.12, loop: want !== 'land' });
  }
}
