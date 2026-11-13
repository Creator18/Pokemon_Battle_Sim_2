/**
 * A boss's mind: what its fighter wants each frame against one foe (the player), from the same moves and body the
 * player has. It thinks every THINK s (a little late, as a person would), and holds that thought till the next:
 *
 *   - the foe's beam charging at it (not launched yet): fires back to meet it in a clash (CONTEST of the time, its own
 *     beam cooled down) — the later it is, the nearer its mouth they meet
 *   - a beam coming at it (charging or out, level with it): it jumps — or, aloft, rises — out of the way (DODGE of the time)
 *   - the foe close (in its slash's reach): slashes (SLASH of the time), else backs off a step
 *   - its beam's line (aimed up, level or down — whichever points nearest the foe and meets it) meeting the foe within
 *     range: fires (its beam cooled down: BEAM_COOL s)
 *   - the foe further: closes in — running, or with Quick Attack when that would bring it into reach
 *   - the foe high above it (flying, on a ledge): takes off after it; aloft, it keeps about the foe's height (rising
 *     on its jump, gliding down off it), and over a grounded foe sinks back down
 *   - it always looks (aims) the way that points nearest the foe
 *
 * And with the rest of its kit, by what it holds:
 *   - Earthquake (close): stamped while the foe is on the ground in its area; the foe's Earthquake wound up near it — it
 *     jumps clear of it
 *   - Stone Edge (ranged): raised at a grounded foe at mid range — or, a beam charging at it, raised as a wall; the
 *     foe's Stone Edge on its way — it jumps it (its pillar too wide to step out of in time)
 *   - a beam into a Stone Edge pillar: held — over it (up) or, with Earthquake, shattering it
 *   - Detect (control): braced as a blow comes at it (a tell in reach, a beam charging at it) — DETECT of the time
 *   - its foe braced (Sucker Punch, Counter, Detect): waited out (WARY), then punished while its brace cools (PUNISH s)
 *
 * Every thought is kept in `log` (what it saw, what it chose), for reading a fight back afterwards.
 */
import type { Intent, Arena } from './Fighter.ts';
import { Fighter, IDLE, CLOSE_REACH, QUICK_DIST, AIM_ANGLE, QUAKE_RADIUS, EDGE_RANGE, BRACES, isBall, isRamMove, isQuickStrike, RAM_DIST } from './Fighter.ts';

/** How often it thinks (s: at least, at most). */
const THINK: [number, number] = [0.22, 0.4];
/** How often it dodges a beam it sees coming, and slashes a foe in reach. */
const DODGE = 0.6, SLASH = 0.75;
/** A foe's ball: seen coming this far ahead of it (world units). */
const BALL_SEE = 3.2;
/** How often it fires back at a beam charging at it (a clash). */
const CONTEST = 0.55;
/** Its beam's cooldown (s: at least, at most). */
const BEAM_COOL: [number, number] = [2.2, 3.6];
/** A foe this far above it (× its height) is "above": it flies up after it. */
const ABOVE = 0.9;
/**
 * Its tells — before each attack it flashes (orange: dodge it; blue: a blow at hand, Sucker Punch it) and holds a beat
 * (s): a beam, a slash, a Quick Attack, a beam fired back to meet yours. After each, it recovers (s): an opening.
 */
const TELL: Record<string, { rgb: [number, number, number]; hold: number; recover: number }> = {
  ranged: { rgb: [1, 0.5, 0.08], hold: 0.45, recover: 0.9 },
  close: { rgb: [0.3, 0.6, 1], hold: 0.3, recover: 0.5 },
  mobility: { rgb: [1, 0.5, 0.08], hold: 0.3, recover: 0.4 },
  contest: { rgb: [1, 0.5, 0.08], hold: 0.2, recover: 0.9 },
};
/** Its foe braced for Sucker Punch (glowing): how often it holds off attacking till the brace runs out (then it punishes the whiff). */
const WARY = 0.75;
/** Its own Detect: how often it braces against a blow it sees coming. Its foe's Earthquake: how often it jumps it. */
const DETECT = 0.6, JUMP_QUAKE = 0.8;
/** Its foe's brace just over (its cooldown running): how long it presses its attacks, not waiting (s). */
const PUNISH = 2.5;
/** Stone Edge: raised at a foe this far off (world units: nearer, further), and as a wall against a beam this often. */
const EDGE_AT: [number, number] = [3, EDGE_RANGE * 0.85];
const EDGE_WALL = 0.5;
/** In a clash: how near the top (of its number's run, as a share: 0 … 1) it waits for it to come before it stops it — rolled each clash. */
const AI_STOP: [number, number] = [0.04, 0.6];

export interface Thought { t: number; saw: string; chose: string }

/**
 * A fighting style: any of its mind's leanings, in place of the defaults — how often it thinks (s), dodges a beam,
 * slashes a foe in reach, meets a beam with its own, braces Detect, jumps an Earthquake, waits out a brace, how long
 * its beams cool (s), how often it raises Stone Edge as a wall, how near the top it stops its clash number.
 */
export interface AIStyle {
  think: [number, number]; dodge: number; slash: number; contest: number; detect: number; jumpQuake: number;
  wary: number; beamCool: [number, number]; edgeWall: number; aiStop: [number, number];
}

export class BossAI {
  readonly log: Thought[] = [];
  private next = 0;
  private hold: Intent = IDLE;
  private beamReady = 0;
  /** A tell under way: the attack it will make, and when; the recovery after its last, till when; its last frame's clock. */
  private pending: { intent: Intent; at: number; kind: string; cut: number } | null = null;
  private recovering = 0; private lastKind = ''; private wasBusy = false; private lastT = 0; private stopWithin: number | null = null;
  /** Paused: it only stands and watches. */
  paused = false;
  /** The arena it fights in (Platformer sets it): the Stone Edge pillars standing in it. */
  arena: Arena | null = null;
  /** Its foe braced last frame; when its brace ended (its cooldown then running: punished till PUNISH s after). */
  private foeBraced = false; private punishTill = -1;

  /** Its style (AIStyle): the defaults, or a style of its own. */
  readonly style: AIStyle;
  constructor(readonly me: Fighter, readonly foe: Fighter, style: Partial<AIStyle> = {}) {
    this.style = { think: THINK, dodge: DODGE, slash: SLASH, contest: CONTEST, detect: DETECT, jumpQuake: JUMP_QUAKE,
      wary: WARY, beamCool: BEAM_COOL, edgeWall: EDGE_WALL, aiStop: AI_STOP, ...style };
  }

  private rnd(r: [number, number]): number { return r[0] + Math.random() * (r[1] - r[0]); }

  /** Its intent this frame. */
  think(): Intent {
    const me = this.me, foe = this.foe, t = me.time;
    const dtNow = Math.max(0, t - this.lastT); this.lastT = t;
    const faceFoe = Math.sign(foe.x - me.x) || me.facing;
    if (this.paused || me.down || foe.down) { this.pending = null; return { ...IDLE, face: faceFoe }; }
    // In a struggle: pressing away at it.
    // In a clash: it stops its number once it comes within its (rolled) band of the top.
    if (!me.clashing) this.stopWithin = null;
    else {
      const n = me.clashing.needle();
      if (n === null || me.clashing.stopped() !== null) return { ...IDLE, face: faceFoe };
      this.stopWithin ??= this.rnd(this.style.aiStop);
      return { ...IDLE, face: faceFoe, ranged: n >= 1 - this.stopWithin };
    }
    // Its move just over: it recovers (an opening).
    if (this.wasBusy && !me.busy && this.lastKind) { this.recovering = t + TELL[this.lastKind].recover; this.lastKind = ''; }
    this.wasBusy = me.busy;
    if (t < this.recovering && !me.busy) return { ...IDLE, face: faceFoe };
    // A tell under way: held still, then the attack.
    // (Countered while telling: the attack it was winding up is gone.)
    if (this.pending && me.interrupted !== this.pending.cut) this.pending = null;
    if (this.pending) {
      if (t < this.pending.at) return { ...IDLE, face: this.pending.intent.face, aim: this.pending.intent.aim };
      const go = this.pending.intent; this.lastKind = this.pending.kind; this.pending = null;
      this.log.push({ t: +t.toFixed(2), saw: '', chose: 'strike' });
      return go;
    }
    // (Presses last one frame; held keys last till its next thought.)
    if (t < this.next) return { ...this.hold, ranged: false, close: false, mobility: false, jumpPressed: false };
    this.next = t + this.rnd(this.style.think);
    const dx = foe.x - me.x, dir = Math.sign(dx) || me.facing, dist = Math.abs(dx);
    const dy = foe.y - me.y;
    const gap = dist - (me.reachOf().front + foe.reachOf().front);
    // Its aim: of up, level and down, the one pointing nearest the foe — preferring one whose line meets it.
    const [mx, my] = me.mouth();
    const want = Math.atan2(foe.y + foe.H * 0.5 - my, Math.abs(foe.x - mx));
    const aims = [1, 0, -1].sort((a, b) => Math.abs(a * AIM_ANGLE - want) - Math.abs(b * AIM_ANGLE - want));
    const meets = (a: number, range: number) => Fighter.lineMeets([mx, my], me.aimDir(a), range, foe) !== null;
    const aim = aims.find((a) => meets(a, me.beamRange)) ?? aims[0];
    const level = meets(aim, Infinity);
    const facingFoe = me.facing === dir;
    const reachClose = (me.H + foe.H * 0.5) * CLOSE_REACH;
    // (The foe's beam coming at it: pouring its ranged move, facing it, level with it.)
    // (Its beam toward it: aimed at it, or able to meet its own — as far apart as both reaches.)
    // (A ball charging counts as a beam charging: met — a clash — or dodged alike.)
    const fb = foe.beam ?? foe.ballCharge;
    const beamAtMe = !!fb && foe.facing === -dir && (Fighter.lineMeets(fb.from, fb.dir, fb.range + 0.5, me) !== null
      || Fighter.linesMeet([mx, my], me.aimDir(aim), me.beamRange, fb.from, fb.dir, fb.range, (me.H + foe.H) * 0.25));
    const charging = beamAtMe && !fb!.launched;
    // (Its kit.)
    const kit = me.moves;
    const hasQuake = kit.close === 'Earthquake', hasEdge = kit.ranged === 'Stone Edge', hasDetect = kit.control === 'Detect';
    const beamRanged = !!kit.ranged && !hasEdge;
    // (Its foe's brace: waited out; once over — its cooldown running — pressed while it can't brace again.)
    if (this.foeBraced && !foe.countering && foe.moves.control && !foe.ready(foe.moves.control)) this.punishTill = t + PUNISH;
    this.foeBraced = foe.countering;
    const punishing = t < this.punishTill;
    // (Its foe's move on its way: wound up — telling — or begun.)
    const foeMove = foe.telling || (foe.firing ? foe.using : '');
    // (A pillar in its beam's line, short of the foe: its beam would stop there.)
    const wall = beamRanged && this.arena ? Fighter.pillarAlong(this.arena, [mx, my], me.aimDir(aim), Math.min(dist + 1, me.beamRange)) : null;
    const walled = wall !== null && wall < dist - foe.reachOf().front;
    // (A foe's ball flying at it — level with it, coming its way, near: BALL_SEE ahead of it.)
    const ballAtMe = foe.balls.find((b) => {
      if (!b.launched || b.done || !b.play.position) return false;
      const p = b.play.position();
      const ahead = (me.x - p.x) * Math.sign(me.x - foe.x || 1);
      return b.homing === me || (ahead > -me.H * 0.3 && ahead < BALL_SEE && Math.abs(p.y - (me.y + me.H * 0.5)) < me.H);
    });
    const hasRam = isRamMove(kit.close);
    const saw0 = `dist ${dist.toFixed(1)} gap ${gap.toFixed(1)} dy ${dy.toFixed(1)}${level ? ' level' : ''}${beamAtMe ? (charging ? ' beam-charging-at-me' : ' beam-at-me') : ''}${foe.firing ? ` foe:${foe.using}` : ''}${me.busy ? ' busy' : ''}`;
    const saw = `${saw0}${walled ? ' walled' : ''}${punishing ? ' punishing' : ''}`;
    // (Aloft, it keeps about the foe's height: rising on its jump while below it, gliding down off it above.)
    let i: Intent = { ...IDLE, face: dir, aim, jumpHeld: me.flying && dy > -me.H * 0.2 };
    let chose = 'watch';
    if (me.busy) {
      chose = 'busy';
    } else if (hasDetect && me.ready('Detect') && !me.countering && Math.random() < this.style.detect
      && ((foeMove && foeMove !== 'Earthquake' && !BRACES.has(foeMove) && !isBall(foeMove) && (foeMove === 'Stone Edge' || dist <= foe.reachWith(foeMove) + me.reachOf().back + 0.3)) || charging)) {
      // (Stone Edge too, wherever it is: its pillar comes up under it — braced, it zips clear as it strikes.)
      // A blow (or a beam) coming at it: braced — Detect zips it out of reach as it lands.
      i = { ...i, control: true };
      chose = `control: Detect (${foeMove || 'beam'} coming)`;
    } else if (ballAtMe && hasDetect && me.ready('Detect') && !me.countering && Math.random() < this.style.detect) {
      // A ball flying at it: braced — Detect zips it clear as it touches.
      i = { ...i, control: true };
      chose = `control: Detect (${ballAtMe.move} coming)`;
    } else if (ballAtMe && !ballAtMe.homing && Math.random() < this.style.dodge) {
      // A ball flying at it: over it.
      i = { ...i, jumpPressed: true, jumpHeld: true };
      chose = `dodge: jump the ${ballAtMe.move}`;
    } else if (foeMove === 'Earthquake' && me.grounded && dist <= QUAKE_RADIUS + 0.5 && Math.random() < this.style.jumpQuake) {
      // Its foe stamping an Earthquake: off the ground as the wave comes.
      i = { ...i, jumpPressed: true, jumpHeld: true };
      chose = 'dodge: jump the quake';
    } else if (foeMove === 'Stone Edge' && me.grounded && Math.random() < this.style.dodge) {
      // Its foe's Stone Edge coming up under it: up over it (its pillar too wide to step out of in time — above its top,
      // it misses).
      i = { ...i, jumpPressed: true, jumpHeld: true };
      chose = 'dodge: jump the stone edge';
    } else if (hasEdge && charging && me.grounded && me.ready('Stone Edge') && dist > 3 && Math.random() < this.style.edgeWall) {
      // A beam charging at it: a wall of stone in its way.
      i = { ...i, ranged: true };
      chose = 'ranged: Stone Edge (wall)';
    } else if (charging && facingFoe && level && t >= this.beamReady && me.ready(me.moves.ranged) && Math.random() < this.style.contest) {
      // Meet it: a clash.
      i = { ...i, ranged: true };
      this.beamReady = t + this.rnd(this.style.beamCool);
      chose = `ranged: ${me.moves.ranged} (contest)`;
    } else if (beamAtMe && Math.random() < this.style.dodge) {
      // Out of the beam's way: up.
      i = { ...i, jumpPressed: true, jumpHeld: true };
      chose = me.grounded ? 'dodge: jump' : 'dodge: rise';
    } else if (dy > me.H * ABOVE) {
      // After a foe above: up (a jump, then on into flight).
      i = { ...i, want: Math.abs(dx) > 2 ? dir : 0, jumpPressed: true, jumpHeld: true };
      chose = 'chase up';
    } else if (me.flying && dy < -me.H * 0.4) {
      i = { ...i, want: Math.abs(dx) > 3 ? dir : 0, sink: true };
      chose = 'sink to foe';
    } else if (hasQuake && me.grounded && foe.grounded && !foe.down && dist <= QUAKE_RADIUS * 0.9 && me.ready('Earthquake') && facingFoe) {
      // Its foe on the ground in its area: stamped.
      i = { ...i, close: true };
      chose = 'close: Earthquake';
    } else if (walled && hasQuake && me.grounded && wall! <= QUAKE_RADIUS * 0.85 && me.ready('Earthquake')) {
      // A pillar between: shattered.
      i = { ...i, close: true };
      chose = 'close: Earthquake (shatter the pillar)';
    } else if (walled && (me.grounded || me.flying)) {
      // A pillar between: over it.
      i = { ...i, want: dir, jumpPressed: true, jumpHeld: true };
      chose = 'over the pillar';
    } else if (hasRam && facingFoe && (me.grounded || me.flying) && Math.abs(dy) < me.H * 0.6 && gap <= RAM_DIST * me.H * 0.9
      && me.ready(kit.close) && Math.random() < this.style.slash) {
      // A ram: in at it, the further the harder.
      i = { ...i, close: true };
      chose = `close: ${kit.close} (ram)`;
    } else if (dist <= reachClose && Math.abs(dy) < me.H * 0.8 && !hasRam) {
      if (facingFoe && me.ready(me.moves.close) && Math.random() < this.style.slash) { i = { ...i, close: true }; chose = `close: ${me.moves.close}`; }
      else { i = { ...i, want: -dir }; chose = 'back off'; }
    } else if (hasEdge && facingFoe && foe.grounded && me.grounded && dist >= EDGE_AT[0] && dist <= EDGE_AT[1] && t >= this.beamReady && me.ready('Stone Edge')) {
      i = { ...i, ranged: true };
      this.beamReady = t + this.rnd(this.style.beamCool);
      chose = 'ranged: Stone Edge';
    } else if (beamRanged && level && facingFoe && meets(aim, me.beamRange) && t >= this.beamReady && me.ready(me.moves.ranged)) {
      i = { ...i, ranged: true };
      this.beamReady = t + this.rnd(this.style.beamCool);
      chose = `ranged: ${me.moves.ranged}`;
    } else if (me.moves.mobility === 'Teleport' && me.ready('Teleport') && gap > reachClose && foe.facing === -dir && Math.random() < 0.35) {
      // Teleport: behind it, while it faces this way — its back to it.
      i = { ...i, mobility: true };
      chose = 'mobility: Teleport behind';
    } else if (facingFoe && level && isQuickStrike(me.moves.mobility) && me.ready(me.moves.mobility) && gap <= QUICK_DIST * me.H && gap > 0.6 && Math.random() < 0.5) {
      i = { ...i, mobility: true };
      chose = `mobility: ${me.moves.mobility} in`;
    } else if (gap > 0.3) {
      i = { ...i, want: dir };
      chose = 'close in';
    }
    // (Its foe braced for Sucker Punch: mostly it waits the brace out rather than walk into it.)
    if ((i.ranged || i.close || i.mobility) && foe.countering && !punishing && Math.random() < this.style.wary) {
      i = { ...IDLE, face: i.face, aim: i.aim };
      chose = 'wait out the sucker punch';
    }
    // (An attack: told first — it flashes and holds — then made.)
    const kind = i.ranged ? (chose.includes('contest') ? 'contest' : 'ranged') : i.close ? 'close' : i.mobility ? 'mobility' : '';
    if (kind) {
      const tell = TELL[kind];
      const move = kind === 'close' ? me.moves.close : kind === 'mobility' ? me.moves.mobility : me.moves.ranged;
      this.pending = { intent: i, at: t + tell.hold, kind, cut: me.interrupted };
      me.tell(tell.rgb, tell.hold, move ?? '');
      i = { ...IDLE, face: i.face, aim: i.aim };
      chose = `tell ${kind} → ${chose}`;
    }
    this.hold = i;
    this.log.push({ t: +t.toFixed(2), saw, chose });
    if (this.log.length > 400) this.log.shift();
    return i;
  }
}
