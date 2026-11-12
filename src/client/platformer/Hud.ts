/**
 * The boss fight's HUD — DOM over the canvas, in two faces: Teko (condensed display: names, the clock, callouts,
 * banners) and Rajdhani (numbers and labels, tabular figures).
 *
 *   top         two slanted HP bars, mirrored, draining toward the middle — each with its name, its type badges, its HP
 *               in figures, ticks every tenth, and a damage trail: the HP just lost held a beat, then drained after it;
 *               a hit shakes it, low HP pulses. Between them the clock.
 *   bottom-left the move bar: U I J K L — each slot its key, its move, in its type's colour; cooling down, a radial
 *               sweep and the seconds left; ready again, a flash; its abuse (heat) in pips; a brace held, it glows.
 *   middle      a clash's stopper (STOP U!, the needle across its gauge, the perfect zone; then a grade stamped, and
 *               how it went); callouts (COUNTER!, SUPER EFFECTIVE!, CLASH!…); the result, across a band.
 *   bottom-right the controls, as key caps.
 */
import { getMove, getTypeEffectiveness } from '../../shared/index.ts';
import { typeColor } from '../theme.ts';
import type { Fighter } from './Fighter.ts';
import type { ClashMeter } from './Fighter.ts';

/** The fonts (Google Fonts, SIL OFL). */
const FONTS = 'https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Teko:wght@500;600;700&display=swap';
/** The damage trail: how long it holds before draining (s), how fast it drains (share of the bar per s). */
const TRAIL_HOLD = 0.45, TRAIL_DRAIN = 0.9;
/** A callout's life (s). */
const CALL_LIFE = 1.15;

const CSS = `
.mvh { position: fixed; inset: 0; pointer-events: none; z-index: 60; color: #fff; font-family: Rajdhani, system-ui, sans-serif;
  --ink: #f8fafc; --dim: rgba(226,232,240,.72); --plate: rgba(9,11,24,.78); --edge: rgba(255,255,255,.85); }
.mvh * { box-sizing: border-box; }
.mvh-top { position: absolute; left: 0; right: 0; top: 14px; display: flex; align-items: flex-start; justify-content: center; gap: 18px; padding: 0 22px; }
.mvh-side { flex: 1 1 0; max-width: 460px; display: flex; flex-direction: column; gap: 4px; }
.mvh-side.r { align-items: flex-end; }
.mvh-plate { display: flex; align-items: center; gap: 8px; }
.mvh-side.r .mvh-plate { flex-direction: row-reverse; }
.mvh-name { font: 600 30px/0.9 Teko, sans-serif; letter-spacing: .5px; text-transform: uppercase; text-shadow: 0 2px 0 rgba(0,0,0,.55), 0 0 12px rgba(0,0,0,.5); }
.mvh-role { font: 700 11px/1 Rajdhani, sans-serif; letter-spacing: 1.5px; padding: 3px 7px 2px; border-radius: 3px; background: var(--edge); color: #0b1020; transform: skewX(-12deg); }
.mvh-side.r .mvh-role { background: #f43f5e; color: #fff; }
.mvh-types { display: flex; gap: 4px; }
.mvh-type { font: 700 10px/1 Rajdhani, sans-serif; letter-spacing: 1px; text-transform: uppercase; padding: 3px 6px 2px; border-radius: 3px;
  background: var(--c); color: #fff; text-shadow: 0 1px 1px rgba(0,0,0,.45); box-shadow: inset 0 -2px 0 rgba(0,0,0,.25); }
.mvh-bar { position: relative; width: 100%; height: 22px; transform: skewX(-18deg); background: var(--plate);
  border: 2px solid var(--edge); border-radius: 3px; overflow: hidden; box-shadow: 0 4px 14px rgba(0,0,0,.45); }
.mvh-side.r .mvh-bar { transform: skewX(18deg); }
.mvh-trail, .mvh-fill { position: absolute; top: 0; bottom: 0; left: 0; }
.mvh-side.r .mvh-trail, .mvh-side.r .mvh-fill { left: auto; right: 0; }
.mvh-trail { background: linear-gradient(180deg, #fff 0%, #fda4af 40%, #e11d48 100%); }
.mvh-fill { background: linear-gradient(180deg, color-mix(in srgb, var(--hp) 55%, #fff) 0%, var(--hp) 45%, color-mix(in srgb, var(--hp) 70%, #000) 100%); transition: background-color .3s; }
.mvh-ticks { position: absolute; inset: 0; background: repeating-linear-gradient(90deg, transparent 0 calc(10% - 2px), rgba(0,0,0,.35) calc(10% - 2px) 10%); }
.mvh-shine { position: absolute; left: 0; right: 0; top: 0; height: 40%; background: rgba(255,255,255,.18); }
.mvh-hp { font: 700 15px/1 Rajdhani, sans-serif; font-variant-numeric: tabular-nums; letter-spacing: .5px; color: var(--dim); text-shadow: 0 1px 2px #000; padding: 0 6px; }
.mvh-hp b { color: var(--ink); font-size: 19px; }
.mvh-side.hit .mvh-bar { animation: mvh-shake .28s; }
.mvh-side.low .mvh-bar { animation: mvh-low 0.8s ease-in-out infinite; }
@keyframes mvh-shake { 0%,100% { translate: 0 0 } 20% { translate: -5px 1px } 40% { translate: 4px -1px } 60% { translate: -3px 0 } 80% { translate: 2px 0 } }
@keyframes mvh-low { 50% { box-shadow: 0 0 0 2px #ef4444, 0 0 18px #ef4444; } }
.mvh-clock { flex: none; min-width: 74px; margin-top: 4px; text-align: center; padding: 6px 12px 2px; background: var(--plate); border: 2px solid var(--edge);
  clip-path: polygon(12% 0, 88% 0, 100% 50%, 88% 100%, 12% 100%, 0 50%); font: 600 34px/0.95 Teko, sans-serif; font-variant-numeric: tabular-nums; }
.mvh-moves { position: absolute; left: 22px; bottom: 20px; display: flex; gap: 10px; align-items: flex-end; }
.mvh-slot { position: relative; width: 78px; height: 78px; border-radius: 12px; background: var(--plate); border: 2px solid rgba(255,255,255,.28);
  box-shadow: 0 6px 16px rgba(0,0,0,.45), inset 0 3px 0 var(--c); overflow: hidden; transition: border-color .15s, transform .15s; }
.mvh-slot.small { width: 62px; height: 62px; }
.mvh-slot.none { opacity: .35; }
.mvh-slot::before { content: ''; position: absolute; inset: 0; background: radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--c) 45%, transparent), transparent 70%); }
.mvh-key { position: absolute; left: 6px; top: 7px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 4px; background: #f8fafc; color: #0b1020;
  font: 700 13px/20px Rajdhani, sans-serif; text-align: center; box-shadow: 0 2px 0 #94a3b8; }
.mvh-mtype { position: absolute; right: 6px; top: 9px; font: 700 9px/1 Rajdhani, sans-serif; letter-spacing: 1px; text-transform: uppercase; color: var(--c);
  filter: brightness(1.35); }
.mvh-mname { position: absolute; left: 5px; right: 5px; bottom: 9px; font: 700 12px/1.05 Rajdhani, sans-serif; text-transform: uppercase; letter-spacing: .4px;
  text-align: center; text-shadow: 0 1px 2px #000; }
.mvh-slot.small .mvh-mname { font-size: 10.5px; bottom: 7px; }
.mvh-slot.long .mvh-mname { font-size: 10px; letter-spacing: 0; }
.mvh-sweep { position: absolute; inset: 0; background: conic-gradient(rgba(5,7,18,.78) var(--p, 0deg), transparent 0); }
.mvh-secs { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font: 600 30px/1 Teko, sans-serif;
  font-variant-numeric: tabular-nums; text-shadow: 0 2px 4px #000; }
.mvh-heat { position: absolute; left: 8px; right: 8px; bottom: 3px; display: flex; gap: 3px; }
.mvh-heat i { flex: 1; height: 3px; border-radius: 2px; background: rgba(255,255,255,.14); }
.mvh-heat i.on { background: #fbbf24; } .mvh-heat i.on.hot { background: #f97316; } .mvh-heat i.on.max { background: #ef4444; }
.mvh-slot.cool { border-color: rgba(255,255,255,.14); }
.mvh-slot.using { border-color: #fff; transform: translateY(-4px); }
.mvh-slot.ready { animation: mvh-ready .45s ease-out; }
.mvh-slot.buff { border-color: #f9a8d4; box-shadow: 0 0 0 2px #ec4899, 0 0 22px #ec4899, inset 0 3px 0 var(--c); }
.mvh-slot.buff .mvh-secs { color: #fbcfe8; }
.mvh-slot.braced { border-color: #93c5fd; box-shadow: 0 0 0 2px #60a5fa, 0 0 22px #3b82f6, inset 0 3px 0 var(--c); }
@keyframes mvh-ready { 0% { box-shadow: 0 0 0 0 #fff, inset 0 3px 0 var(--c); } 40% { box-shadow: 0 0 0 4px rgba(255,255,255,.9), 0 0 24px #fff, inset 0 3px 0 var(--c); } 100% { box-shadow: 0 6px 16px rgba(0,0,0,.45), inset 0 3px 0 var(--c); } }
.mvh-legend { position: absolute; right: 22px; bottom: 22px; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px 14px; max-width: 46vw;
  font: 600 13px/1 Rajdhani, sans-serif; color: var(--dim); text-shadow: 0 1px 2px #000; }
.mvh-legend span { display: inline-flex; align-items: center; gap: 5px; }
.mvh-cap { display: inline-block; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 4px; background: rgba(248,250,252,.92); color: #0b1020;
  font: 700 12px/20px Rajdhani, sans-serif; text-align: center; box-shadow: 0 2px 0 #94a3b8; }
.mvh-clash { position: absolute; left: 50%; top: 27%; transform: translate(-50%, -50%); display: none; flex-direction: column; align-items: center; gap: 8px; }
.mvh-say { font: 700 58px/0.9 Teko, sans-serif; font-style: italic; letter-spacing: 1px; text-transform: uppercase;
  -webkit-text-stroke: 2px #0b1020; paint-order: stroke fill; text-shadow: 0 4px 0 #0b1020, 0 0 24px rgba(251,191,36,.75); }
.mvh-gauge { position: relative; width: min(64vw, 480px); height: 24px; transform: skewX(-14deg); border: 3px solid #fff; border-radius: 4px;
  background: linear-gradient(90deg, #450a0a, #dc2626 22%, #f59e0b 38%, #22c55e 50%, #f59e0b 62%, #dc2626 78%, #450a0a);
  box-shadow: 0 0 0 3px #0b1020, 0 8px 24px rgba(0,0,0,.55); }
.mvh-zone { position: absolute; top: -6px; bottom: -6px; border: 3px solid #fff; border-radius: 3px; box-shadow: 0 0 14px #86efac, inset 0 0 10px rgba(134,239,172,.6); }
.mvh-needle { position: absolute; top: -12px; bottom: -12px; width: 8px; margin-left: -4px; background: #fff; border-radius: 3px; box-shadow: 0 0 0 2px #0b1020, 0 0 16px #fff; }
.mvh-note { font: 700 18px/1 Rajdhani, sans-serif; letter-spacing: 2px; text-transform: uppercase; text-shadow: 0 2px 3px #000; }
.mvh-stamp { animation: mvh-stamp .35s cubic-bezier(.2, 1.6, .4, 1); }
@keyframes mvh-stamp { from { transform: scale(1.8) rotate(-6deg); opacity: 0; } to { transform: none; opacity: 1; } }
.mvh-calls { position: absolute; left: 50%; top: 38%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 2px; }
.mvh-call { font: 700 46px/0.95 Teko, sans-serif; font-style: italic; text-transform: uppercase; letter-spacing: 1px; white-space: nowrap;
  -webkit-text-stroke: 2px #0b1020; paint-order: stroke fill; text-shadow: 0 3px 0 #0b1020, 0 0 22px var(--g, #fff);
  animation: mvh-call ${CALL_LIFE}s ease-out forwards; }
.mvh-call.small { font-size: 30px; }
@keyframes mvh-call { 0% { transform: scale(1.6); opacity: 0; } 12% { transform: scale(1); opacity: 1; } 75% { opacity: 1; } 100% { transform: translateY(-14px); opacity: 0; } }
.mvh-band { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); display: none; flex-direction: column; align-items: center; padding: 18px 0 16px;
  background: linear-gradient(90deg, transparent, rgba(9,11,24,.86) 18%, rgba(9,11,24,.86) 82%, transparent);
  border-top: 2px solid var(--b, #fff); border-bottom: 2px solid var(--b, #fff); animation: mvh-band .5s cubic-bezier(.2, 1.4, .4, 1); }
.mvh-band h1 { margin: 0; font: 700 112px/0.85 Teko, sans-serif; font-style: italic; letter-spacing: 3px; text-transform: uppercase; color: var(--b, #fff);
  text-shadow: 0 6px 0 rgba(0,0,0,.5), 0 0 40px var(--b, #fff); }
.mvh-band p { margin: 8px 0 0; font: 600 16px/1 Rajdhani, sans-serif; letter-spacing: 2px; text-transform: uppercase; color: var(--dim); }
@keyframes mvh-band { from { transform: translateY(-50%) scaleY(0); } to { transform: translateY(-50%) scaleY(1); } }
`;

/** The fonts and the stylesheet, put in once. */
export function ensureHudStyle(): void {
  if (document.querySelector('[data-mvh-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = FONTS; link.dataset.mvhFont = '';
  const style = document.createElement('style');
  style.dataset.mvhStyle = ''; style.textContent = CSS;
  document.head.append(link, style);
}

/** The controls as key caps (bottom right): pairs of [keys, what]. */
export function keyLegend(items: [string[], string][]): HTMLDivElement {
  ensureHudStyle();
  const el = document.createElement('div');
  el.className = 'mvh-legend';
  el.innerHTML = items.map(([keys, what]) => `<span>${keys.map((k) => `<i class="mvh-cap">${k}</i>`).join('')} ${what}</span>`).join('');
  return el;
}

interface Side { root: HTMLDivElement; fill: HTMLDivElement; trail: HTMLDivElement; hp: HTMLDivElement; shown: number; trailK: number; holdUntil: number; hitUntil: number }
interface Slot { el: HTMLDivElement; sweep: HTMLDivElement; secs: HTMLDivElement; pips: HTMLElement[]; move: string; wasReady: boolean }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** Moves not in the attack table (status moves, the back dash): their types. */
const OTHER_TYPES: Record<string, string> = { 'Agility': 'Psychic', 'Teleport': 'Psychic', 'Back Dash': 'Normal', 'Dash': 'Normal' };
const moveType = (move: string) => getMove(move)?.moveType ?? OTHER_TYPES[move] ?? 'Normal';

export class Hud {
  readonly root: HTMLDivElement;
  private sides: Side[] = [];
  private slots: Slot[] = [];
  private clock: HTMLDivElement;
  private clash: HTMLDivElement; private say: HTMLDivElement; private needle: HTMLDivElement; private note: HTMLDivElement;
  private calls: HTMLDivElement;
  private band: HTMLDivElement;
  private lastGrade = ''; private lastResult: string | null = null;

  constructor(private readonly player: Fighter, private readonly boss: Fighter, meterPerfect: number) {
    ensureHudStyle();
    const root = this.root = document.createElement('div');
    root.className = 'mvh';
    // Top: the two bars, the clock between.
    const top = document.createElement('div');
    top.className = 'mvh-top';
    const left = this.side(player, false), right = this.side(boss, true);
    this.clock = document.createElement('div'); this.clock.className = 'mvh-clock'; this.clock.textContent = '0:00';
    top.append(left.root, this.clock, right.root);
    this.sides = [left, right];
    // The move bar.
    const moves = document.createElement('div');
    moves.className = 'mvh-moves';
    const kit = player.moves;
    for (const [key, move, small] of [['U', kit.ranged], ['I', kit.close], ['J', kit.mobility], ['K', kit.control], ['L', 'Dash', true]] as [string, string | undefined, boolean?][]) {
      const s = this.slot(key, move, !!small); moves.append(s.el); this.slots.push(s);
    }
    // The clash's stopper.
    this.clash = document.createElement('div'); this.clash.className = 'mvh-clash';
    this.clash.innerHTML = `<div class="mvh-say">STOP U!</div><div class="mvh-gauge"><div class="mvh-zone" style="left:${50 - 50 * meterPerfect}%;width:${100 * meterPerfect}%"></div>`
      + `<div class="mvh-needle"></div></div><div class="mvh-note"></div>`;
    this.say = this.clash.querySelector('.mvh-say')!; this.needle = this.clash.querySelector('.mvh-needle')!; this.note = this.clash.querySelector('.mvh-note')!;
    this.calls = document.createElement('div'); this.calls.className = 'mvh-calls';
    this.band = document.createElement('div'); this.band.className = 'mvh-band';
    root.append(top, moves, this.clash, this.calls, this.band);
    document.body.append(root);
  }

  private side(f: Fighter, right: boolean): Side {
    const root = document.createElement('div');
    root.className = `mvh-side${right ? ' r' : ''}`;
    const types = f.types.map((t) => `<span class="mvh-type" style="--c:${typeColor(t)}">${esc(t)}</span>`).join('');
    const name = f.name.replace(/\s*\((you|boss)\)\s*$/i, '');
    root.innerHTML = `<div class="mvh-plate"><span class="mvh-role">${right ? 'BOSS' : 'YOU'}</span><span class="mvh-name">${esc(name)}</span>`
      + `<span class="mvh-types">${types}</span></div><div class="mvh-bar"><div class="mvh-trail"></div><div class="mvh-fill"></div>`
      + `<div class="mvh-shine"></div><div class="mvh-ticks"></div></div><div class="mvh-hp"></div>`;
    return { root, fill: root.querySelector('.mvh-fill')!, trail: root.querySelector('.mvh-trail')!, hp: root.querySelector('.mvh-hp')!,
      shown: f.hp / f.maxHp, trailK: f.hp / f.maxHp, holdUntil: 0, hitUntil: 0 };
  }

  private slot(key: string, move: string | undefined, small: boolean): Slot {
    const el = document.createElement('div');
    const type = move ? moveType(move) : 'Normal';
    el.className = `mvh-slot${small ? ' small' : ''}${move ? '' : ' none'}${move && move.length > 10 ? ' long' : ''}`;
    el.style.setProperty('--c', typeColor(type));
    el.innerHTML = `<div class="mvh-sweep"></div><span class="mvh-key">${key}</span>${move && !small ? `<span class="mvh-mtype">${esc(type)}</span>` : ''}`
      + `<span class="mvh-mname">${esc(move ?? '—')}</span><div class="mvh-secs"></div><div class="mvh-heat"><i></i><i></i><i></i><i></i></div>`;
    return { el, sweep: el.querySelector('.mvh-sweep')!, secs: el.querySelector('.mvh-secs')!, pips: [...el.querySelectorAll<HTMLElement>('.mvh-heat i')], move: move ?? '', wasReady: true };
  }

  /** A callout in the middle (COUNTER!, SUPER EFFECTIVE!…), in `glow`'s colour. */
  call(text: string, glow = '#fff', small = false): void {
    const el = document.createElement('div');
    el.className = `mvh-call${small ? ' small' : ''}`;
    el.style.setProperty('--g', glow);
    el.textContent = text;
    this.calls.append(el);
    while (this.calls.children.length > 3) this.calls.firstElementChild!.remove();
    setTimeout(() => el.remove(), CALL_LIFE * 1000);
  }

  /** A blow landed: its side shaken; super / not very effective called. */
  hit(by: Fighter, on: Fighter, move: string): void {
    const s = this.sides[on === this.player ? 0 : 1];
    s.hitUntil = performance.now() + 280; s.root.classList.remove('hit'); void s.root.offsetWidth; s.root.classList.add('hit');
    const m = getMove(move);
    if (!m) return;
    const e = getTypeEffectiveness(m.moveType, on.types);
    if (e >= 2) this.call('Super effective!', '#fbbf24');
    else if (e > 0 && e < 1) this.call('Not very effective…', '#94a3b8', true);
    else if (e === 0) this.call('No effect', '#94a3b8', true);
    void by;
  }

  /** Each frame: the bars, the clock, the move bar, the stopper, the result. */
  update(dt: number, clock: number, result: string | null): void {
    // The bars: the fill at once; the trail held a beat, then drained after it.
    const now = performance.now();
    [this.player, this.boss].forEach((f, i) => {
      const s = this.sides[i];
      const k = Math.max(0, f.hp / f.maxHp);
      if (k < s.shown) s.holdUntil = now + TRAIL_HOLD * 1000;
      if (k > s.trailK) s.trailK = k;
      s.shown = k;
      if (now > s.holdUntil && s.trailK > k) s.trailK = Math.max(k, s.trailK - TRAIL_DRAIN * dt);
      s.fill.style.width = `${k * 100}%`;
      s.trail.style.width = `${s.trailK * 100}%`;
      s.fill.style.setProperty('--hp', k > 0.5 ? '#22c55e' : k > 0.25 ? '#eab308' : '#ef4444');
      s.hp.innerHTML = `<b>${Math.ceil(f.hp)}</b> / ${f.maxHp}`;
      s.root.classList.toggle('low', k > 0 && k <= 0.25);
      if (now > s.hitUntil) s.root.classList.remove('hit');
    });
    const sec = Math.floor(clock);
    this.clock.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    // The move bar.
    const p = this.player;
    for (const s of this.slots) {
      if (!s.move) continue;
      // (The dash button's: its dash's or its back dash's cooldown, whichever is longer to run.)
      const moves = s.move === 'Dash' ? ['Dash', 'Back Dash'] : [s.move];
      const leftOf = (m: string) => Math.max(0, (p.readyAt.get(m) ?? 0) - p.time);
      const m = moves.reduce((a, b) => (leftOf(b) > leftOf(a) ? b : a));
      const left = leftOf(m), len = p.coolLen.get(m) ?? 0;
      const cooling = left > 0.02 && len > 0;
      // (Agility's boost on: its slot lit, the boost's seconds left in it, not its cooldown.)
      const buff = s.move === 'Agility' && p.zippy;
      s.el.classList.toggle('buff', buff);
      s.sweep.style.setProperty('--p', cooling && !buff ? `${(left / len) * 360}deg` : '0deg');
      s.secs.textContent = buff ? p.zippyLeft.toFixed(1) : cooling && left >= 0.25 ? left.toFixed(left < 1 ? 1 : 0) : '';
      s.el.classList.toggle('cool', cooling);
      if (!cooling && !s.wasReady) { s.el.classList.remove('ready'); void s.el.offsetWidth; s.el.classList.add('ready'); }
      s.wasReady = !cooling;
      const heat = p.heatOf(s.move);
      s.pips.forEach((pip, j) => { const on = heat > j + 0.25; pip.className = on ? `on${heat > 2.5 ? ' max' : heat > 1.5 ? ' hot' : ''}` : ''; });
      s.el.classList.toggle('using', p.using === s.move && !p.countering);
      s.el.classList.toggle('braced', p.countering && s.move === p.moves.control);
    }
    this.updateClash(p.clashing);
    // The result.
    if (result !== this.lastResult) {
      this.lastResult = result;
      this.band.style.display = result ? 'flex' : 'none';
      if (result) {
        const won = result === 'won';
        this.band.style.setProperty('--b', won ? '#fbbf24' : '#f43f5e');
        this.band.innerHTML = `<h1>${won ? 'Victory' : 'Defeated'}</h1><p>Press <i class="mvh-cap">R</i> to fight again</p>`;
      }
    }
  }

  private updateClash(c: ClashMeter | null): void {
    const n = c?.needle() ?? null;
    const on = !!c && (n !== null || c.outcome() !== null);
    this.clash.style.display = on ? 'flex' : 'none';
    if (!c || !on) { this.lastGrade = ''; return; }
    if (n !== null) this.needle.style.left = `${50 + 50 * n}%`;
    const q = c.quality(), o = c.outcome();
    const grade = q === null ? '' : q >= 1 ? 'PERFECT' : q >= 0.7 ? 'GREAT' : q >= 0.4 ? 'GOOD' : q > 0 ? 'WEAK' : 'MISSED';
    const say = o === null ? (q === null ? 'STOP U!' : `${grade}!`)
      : o > 0 ? (c.outright() ? 'Overpowered them!' : 'Clash won!') : o < 0 ? (c.outright() ? 'Overpowered!' : 'Clash lost') : 'Even — it bursts!';
    if (say !== this.lastGrade) {
      this.lastGrade = say;
      this.say.textContent = say;
      this.say.classList.remove('mvh-stamp'); void this.say.offsetWidth; this.say.classList.add('mvh-stamp');
      this.say.style.color = o !== null ? (o > 0 ? '#fde047' : o < 0 ? '#fda4af' : '#fff') : grade === 'PERFECT' ? '#86efac' : '#fff';
    }
    this.note.textContent = q === null ? 'Stop the needle in the middle' : `${grade} ×${c.timing()!.toFixed(2)}`;
  }

  dispose(): void { this.root.remove(); }
}
