/** BattleLog — scrollable list of resolution log lines. */

import { el, ensureStyles } from './dom.ts';

export class BattleLog {
  readonly root: HTMLElement;

  constructor() {
    ensureStyles();
    this.root = el('div', { id: 'pbw-log' });
    this.root.style.display = 'none';
  }

  append(lines: string[]): void {
    for (const line of lines) {
      const isHdr = line.startsWith('===');
      this.root.append(el('div', { class: isHdr ? 'turnhdr' : '', text: line }));
    }
    this.root.scrollTop = this.root.scrollHeight;
  }

  show(): void {
    this.root.style.display = 'block';
  }
  hide(): void {
    this.root.style.display = 'none';
  }
}
