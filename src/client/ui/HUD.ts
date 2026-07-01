/**
 * HUD — both players' HP bars, status icons, turn counter, weather indicator.
 * Cooldown pips for the local player's moves live in DeclarationPanel.
 */

import type { BattleStateJSON, PokemonJSON } from '../../shared/index.ts';
import { el, ensureStyles, clearChildren } from './dom.ts';

const STATUS_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  burned: { label: 'BRN', bg: '#F97316', fg: '#2A1000' },
  paralyzed: { label: 'PAR', bg: '#FBBF24', fg: '#2A2000' },
  fainted: { label: 'KO', bg: '#6B7280', fg: '#111' },
};

const EFFECT_STYLE: Record<string, { label: string; bg: string }> = {
  hypnotized: { label: 'SLP', bg: '#7C3AED' },
  flinched: { label: 'FLN', bg: '#94A3B8' },
  taunted: { label: 'TNT', bg: '#EF4444' },
  destiny_bond: { label: 'DBND', bg: '#4C1D95' },
};

export class HUD {
  readonly root: HTMLElement;
  private p1wrap: HTMLElement;
  private p2wrap: HTMLElement;
  private turnBar: HTMLElement;

  constructor(private localPlayerId: number) {
    ensureStyles();
    this.root = el('div', { id: 'pbw-hud' });
    this.p1wrap = el('div', { class: 'pbw-hpwrap' });
    this.p2wrap = el('div', { class: 'pbw-hpwrap right' });
    this.turnBar = el('div', { id: 'pbw-turnbar' });
    this.root.append(this.p1wrap, this.p2wrap);
    this.root.append(this.turnBar);
    this.root.style.display = 'none';
  }

  setLocalPlayer(id: number): void {
    this.localPlayerId = id;
  }

  update(state: BattleStateJSON): void {
    const p1 = state.pokemon.p1;
    const p2 = state.pokemon.p2;
    this.renderSide(this.p1wrap, p1, 1, state.statusEffects.p1);
    this.renderSide(this.p2wrap, p2, 2, state.statusEffects.p2);

    clearChildren(this.turnBar);
    this.turnBar.append(el('span', { text: `Turn ${state.meta.turnNumber}` }));
    const weather = this.weatherLabel(state);
    if (weather) this.turnBar.append(el('span', { class: 'pbw-weather', text: weather }));
  }

  private weatherLabel(state: BattleStateJSON): string | null {
    for (const t of state.terrain) {
      if (t.terrain_type === 'sunny_zone') return '☀ Harsh Sunlight';
      if (t.terrain_type === 'rain_zone') return '🌧 Rain';
    }
    return null;
  }

  private renderSide(wrap: HTMLElement, poke: PokemonJSON | null, pid: number, effects: Record<string, number>): void {
    clearChildren(wrap);
    if (!poke) return;
    const pct = Math.max(0, poke.current_hp / poke.max_hp);
    const color = pct > 0.5 ? 'var(--good)' : pct > 0.22 ? 'var(--warn)' : 'var(--bad)';
    const youTag = pid === this.localPlayerId ? ' (You)' : '';

    const fill = el('div', { class: 'pbw-hpfill', style: { width: `${pct * 100}%`, background: color } });
    const bar = el('div', { class: 'pbw-hpbar' }, [fill]);

    const icons = el('div', { class: 'pbw-statusicons' });
    if (poke.status && STATUS_STYLE[poke.status]) {
      const s = STATUS_STYLE[poke.status];
      icons.append(el('span', { class: 'pbw-status-icon', text: s.label, style: { background: s.bg, color: s.fg } }));
    }
    for (const [eff, turns] of Object.entries(effects)) {
      if ((turns ?? 0) <= 0) continue;
      const s = EFFECT_STYLE[eff];
      if (s) icons.append(el('span', { class: 'pbw-status-icon', text: s.label, style: { background: s.bg, color: '#fff' } }));
    }

    wrap.append(
      el('div', { class: 'pbw-name', text: `P${pid} ${poke.name}${youTag}` }),
      bar,
      el('div', { class: 'pbw-hptext', text: `${poke.current_hp} / ${poke.max_hp} HP` }),
      icons,
    );
  }

  show(): void {
    this.root.style.display = 'flex';
  }
  hide(): void {
    this.root.style.display = 'none';
  }
}
