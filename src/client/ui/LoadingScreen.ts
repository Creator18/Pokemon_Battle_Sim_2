/**
 * LoadingScreen — shown between the draft and the battle while both Pokémon
 * are built from the archive data. The battle only appears once both are ready.
 */

import { el, ensureStyles } from './dom.ts';

export class LoadingScreen {
  readonly root: HTMLElement;
  private title: HTMLElement;
  private fill: HTMLElement;
  private pct: HTMLElement;

  constructor() {
    ensureStyles();
    this.title = el('div', { class: 'pbw-sub', style: { marginBottom: '14px' } });
    this.fill = el('div', {
      style: { height: '100%', width: '0%', background: 'var(--accent)', borderRadius: '5px', transition: 'width 0.15s ease-out' },
    });
    this.pct = el('div', { class: 'pbw-sub', style: { marginTop: '10px', marginBottom: '0' }, text: '0%' });
    const bar = el('div', {
      style: { width: '100%', height: '10px', background: 'var(--panel-alt)', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' },
    }, [this.fill]);
    const panel = el('div', { class: 'pbw-panel', style: { width: '420px', textAlign: 'center' } }, [
      el('div', { class: 'pbw-h1', text: 'Preparing the battle' }),
      this.title,
      bar,
      this.pct,
    ]);
    this.root = el('div', { class: 'pbw-modal-wrap' }, [panel]);
    this.root.style.display = 'none';
  }

  show(names: string[]): void {
    this.title.textContent = names.length === 2 ? `${names[0]} vs ${names[1]}` : `Summoning ${names.join(', ')}`;
    this.setProgress(0);
    this.root.style.display = 'flex';
  }

  setProgress(fraction: number): void {
    const p = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    this.fill.style.width = `${p}%`;
    this.pct.textContent = `${p}%`;
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}
