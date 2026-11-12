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
 * Every thought is kept in `log` (what it saw, what it chose), for reading a fight back afterwards.
 */
import type { Intent } from './Fighter.ts';
import { Fighter, IDLE, CLOSE_REACH, QUICK_DIST, AIM_ANGLE } from './Fighter.ts';

/** How often it thinks (s: at least, at most). */
const THINK: [number, number] = [0.22, 0.4];
/** How often it dodges a beam it sees coming, and slashes a foe in reach. */
const DODGE = 0.6, SLASH = 0.75;
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
/** In a clash: how near the middle (of −1 … 1) it waits for its needle to come before it stops it — rolled each clash. */
const AI_STOP: [number, number] = [0.04, 0.6];

export interface Thought { t: number; saw: string; chose: string }

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

  constructor(readonly me: Fighter, readonly foe: Fighter) {}

  private rnd(r: [number, number]): number { return r[0] + Math.random() * (r[1] - r[0]); }

  /** Its intent this frame. */
  think(): Intent {
    const me = this.me, foe = this.foe, t = me.time;
    const dtNow = Math.max(0, t - this.lastT); this.lastT = t;
    const faceFoe = Math.sign(foe.x - me.x) || me.facing;
    if (this.paused || me.down || foe.down) { this.pending = null; return { ...IDLE, face: faceFoe }; }
    // In a struggle: pressing away at it.
    // In a clash: it stops its needle once it comes within its (rolled) band of the middle.
    if (!me.clashing) this.stopWithin = null;
    else {
      const n = me.clashing.needle();
      if (n === null || me.clashing.stopped() !== null) return { ...IDLE, face: faceFoe };
      this.stopWithin ??= this.rnd(AI_STOP);
      return { ...IDLE, face: faceFoe, ranged: Math.abs(n) <= this.stopWithin };
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
    this.next = t + this.rnd(THINK);
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
    const fb = foe.beam;
    const beamAtMe = !!fb && foe.facing === -dir && (Fighter.lineMeets(fb.from, fb.dir, fb.range + 0.5, me) !== null
      || Fighter.linesMeet([mx, my], me.aimDir(aim), me.beamRange, fb.from, fb.dir, fb.range, (me.H + foe.H) * 0.25));
    const charging = beamAtMe && !foe.beam!.launched;
    const saw = `dist ${dist.toFixed(1)} gap ${gap.toFixed(1)} dy ${dy.toFixed(1)}${level ? ' level' : ''}${beamAtMe ? (charging ? ' beam-charging-at-me' : ' beam-at-me') : ''}${foe.firing ? ` foe:${foe.using}` : ''}${me.busy ? ' busy' : ''}`;
    // (Aloft, it keeps about the foe's height: rising on its jump while below it, gliding down off it above.)
    let i: Intent = { ...IDLE, face: dir, aim, jumpHeld: me.flying && dy > -me.H * 0.2 };
    let chose = 'watch';
    if (me.busy) {
      chose = 'busy';
    } else if (charging && facingFoe && level && t >= this.beamReady && me.ready(me.moves.ranged) && Math.random() < CONTEST) {
      // Meet it: a clash.
      i = { ...i, ranged: true };
      this.beamReady = t + this.rnd(BEAM_COOL);
      chose = `ranged: ${me.moves.ranged} (contest)`;
    } else if (beamAtMe && Math.random() < DODGE) {
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
    } else if (dist <= reachClose && Math.abs(dy) < me.H * 0.8) {
      if (facingFoe && me.ready(me.moves.close) && Math.random() < SLASH) { i = { ...i, close: true }; chose = `close: ${me.moves.close}`; }
      else { i = { ...i, want: -dir }; chose = 'back off'; }
    } else if (level && facingFoe && meets(aim, me.beamRange) && t >= this.beamReady && me.ready(me.moves.ranged)) {
      i = { ...i, ranged: true };
      this.beamReady = t + this.rnd(BEAM_COOL);
      chose = `ranged: ${me.moves.ranged}`;
    } else if (facingFoe && level && me.moves.mobility === 'Quick Attack' && me.ready('Quick Attack') && gap <= QUICK_DIST * me.H && gap > 0.6 && Math.random() < 0.5) {
      i = { ...i, mobility: true };
      chose = 'mobility: Quick Attack in';
    } else if (gap > 0.3) {
      i = { ...i, want: dir };
      chose = 'close in';
    }
    // (Its foe braced for Sucker Punch: mostly it waits the brace out rather than walk into it.)
    if ((i.ranged || i.close || i.mobility) && foe.countering && Math.random() < WARY) {
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
