/** GameOverOverlay — winner banner + play again. */

import { el, ensureStyles, clearChildren } from './dom.ts';

export class GameOverOverlay {
  readonly root: HTMLElement;

  constructor(private onPlayAgain: () => void) {
    ensureStyles();
    this.root = el('div', { class: 'pbw-modal-wrap' });
    this.root.style.display = 'none';
  }

  show(winner: number | null, localPlayerId: number): void {
    clearChildren(this.root);
    let title: string;
    let color: string;
    if (winner === null) {
      title = 'Draw!';
      color = 'var(--warn)';
    } else if (winner === localPlayerId) {
      title = 'Victory!';
      color = 'var(--good)';
    } else {
      title = 'Defeat';
      color = 'var(--bad)';
    }
    const panel = el('div', { class: 'pbw-panel', style: { width: '380px', textAlign: 'center' } }, [
      el('div', { class: 'pbw-winner', style: { color }, text: title }),
      el('div', { class: 'pbw-sub', text: winner === null ? 'Both Pokémon fainted.' : `Player ${winner} wins the battle.` }),
      el('button', { class: 'pbw-btn', text: 'Play Again', onclick: () => this.onPlayAgain() }),
    ]);
    this.root.append(panel);
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}
