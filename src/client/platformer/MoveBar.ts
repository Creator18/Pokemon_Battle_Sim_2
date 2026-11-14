/**
 * The move bar, bottom centre: shown as long as your Pokémon is out in the world (not while you're a Poké Ball).
 * U I J K L — each slot its move's type on a band across its top, its name, its key on a cap at its foot; cooling
 * down, a radial sweep and the seconds left; ready again, a flash; its abuse (heat) in pips; in use, raised; a brace
 * held, it glows; Agility's boost on, lit with the boost's seconds. Rebuilt when your moves change (a swap, a new
 * body). While it's up, the text boxes and prompts sit above it.
 */
import { getMove } from '../../shared/index.ts';
import { typeColor } from '../theme.ts';
import { ensureGameUi, cap } from '../ui/gameUi.ts';
import type { Fighter } from './Fighter.ts';

/** Moves not in the attack table (status moves, the dashes): their types. */
const OTHER_TYPES: Record<string, string> = { 'Agility': 'Psychic', 'Teleport': 'Psychic', 'Back Dash': 'Normal', 'Dash': 'Normal' };
export const moveType = (move: string) => getMove(move)?.moveType ?? OTHER_TYPES[move] ?? 'Normal';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

interface Slot { el: HTMLDivElement; sweep: HTMLDivElement; secs: HTMLDivElement; pips: HTMLElement[]; move: string; wasReady: boolean }

export class MoveBar {
  readonly el: HTMLDivElement;
  private slots: Slot[] = [];
  private kitKey = '';
  private shown = false;

  /** `blocked`: whether a move can't be used here (an attack, in town) — its slot greyed. */
  constructor(private readonly player: Fighter, private readonly blocked: (move: string) => boolean = () => false) {
    ensureGameUi();
    this.el = document.createElement('div');
    this.el.className = 'gui gui-moves off';
    document.body.append(this.el);
  }

  private build(): void {
    const kit = this.player.moves;
    this.el.innerHTML = '';
    this.slots = [];
    for (const [key, move, small] of [['U', kit.ranged], ['I', kit.close], ['J', kit.mobility], ['K', kit.control], ['L', 'Dash', true]] as [string, string | undefined, boolean?][]) {
      const el = document.createElement('div');
      const type = move ? moveType(move) : 'Normal';
      const len = move?.length ?? 0;
      el.className = `gui-slot${small ? ' small' : ''}${move ? '' : ' none'}${len > 12 ? ' xlong' : len > 9 ? ' long' : ''}`;
      el.style.setProperty('--c', move ? typeColor(type) : '#475569');
      el.innerHTML = `<div class="band">${small || !move ? '' : esc(type)}</div><div class="heat"><i></i><i></i><i></i><i></i></div>`
        + `<div class="name">${esc(move ?? '—')}</div><div class="sweep"></div><div class="secs"></div><span class="key">${cap(key)}</span>`;
      this.el.append(el);
      this.slots.push({ el, sweep: el.querySelector('.sweep')!, secs: el.querySelector('.secs')!, pips: [...el.querySelectorAll<HTMLElement>('.heat i')], move: move ?? '', wasReady: true });
    }
  }

  update(): void {
    const p = this.player;
    // Shown while your Pokémon is out; the text boxes lifted above it meanwhile.
    const show = !p.ball;
    if (show !== this.shown) {
      this.shown = show;
      this.el.classList.toggle('off', !show);
      document.documentElement.style.setProperty('--gui-bar-h', show ? `${this.el.offsetHeight + 10}px` : '0px');
    }
    const k = p.moves; const key = [k.ranged, k.close, k.mobility, k.control].join('|');
    if (key !== this.kitKey) {
      this.kitKey = key; this.build();
      if (show) requestAnimationFrame(() => document.documentElement.style.setProperty('--gui-bar-h', `${this.el.offsetHeight + 10}px`));
    }
    if (!show) return;
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
      // (In town, the attacks greyed: there's a time and place.)
      s.el.classList.toggle('blocked', this.blocked(s.move));
    }
  }

  dispose(): void {
    this.el.remove();
    document.documentElement.style.setProperty('--gui-bar-h', '0px');
  }
}
