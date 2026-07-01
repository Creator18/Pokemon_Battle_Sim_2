/** ConnectScreen — room code entry, connect/create/join, waiting state. */

import { el, ensureStyles, clearChildren } from './dom.ts';
import type { ConnectionStatus } from '../net/NetClient.ts';

export interface ConnectCallbacks {
  onJoin: (sessionId: string | undefined) => void;
}

export class ConnectScreen {
  readonly root: HTMLElement;
  private statusLine: HTMLElement;
  private input!: HTMLInputElement;
  private waiting = false;

  constructor(private cb: ConnectCallbacks) {
    ensureStyles();
    this.root = el('div', { class: 'pbw-modal-wrap' });
    this.statusLine = el('div', { class: 'pbw-conn-status' });
    this.render();
  }

  private render(): void {
    clearChildren(this.root);
    this.input = el('input', {
      class: 'pbw-input',
      style: { letterSpacing: '2px', fontWeight: '700', textAlign: 'center' },
    }) as HTMLInputElement;
    this.input.placeholder = 'room code from host';
    this.input.maxLength = 12;

    const panel = el('div', { class: 'pbw-panel', style: { width: '440px' } }, [
      el('div', { class: 'pbw-h1', text: 'Pokémon Hex Battle' }),
      el('div', { class: 'pbw-sub', text: 'Turn-based tactical battles on a hex grid. Open this page in two browser tabs to play.' }),
      el('div', { class: 'pbw-h2', text: 'Host a match' }),
      el('button', {
        class: 'pbw-btn',
        text: 'Create Room',
        title: 'Creates a new room and shows a code to share',
        onclick: () => this.cb.onJoin(undefined),
      }),
      el('div', { class: 'pbw-h2', text: 'Join a match', style: { marginTop: '18px' } }),
      el('div', { class: 'pbw-row' }, [
        this.input,
        el('button', {
          class: 'pbw-btn ghost',
          text: 'Join Room',
          onclick: () => {
            const code = this.input.value.trim().toLowerCase();
            this.cb.onJoin(code || undefined);
          },
        }),
      ]),
      el('div', { class: 'pbw-sub', style: { marginTop: '10px', marginBottom: '0' }, text: 'Tip: leave the code blank and press Join Room for quick-match into any open room.' }),
      this.statusLine,
    ]);
    this.root.append(panel);
  }

  setStatus(status: ConnectionStatus): void {
    if (this.waiting) return;
    const map: Record<ConnectionStatus, [string, string]> = {
      idle: ['#666', 'Not connected'],
      connecting: ['#FBBF24', 'Connecting…'],
      open: ['#34D399', 'Connected'],
      closed: ['#EF4444', 'Disconnected'],
      error: ['#EF4444', 'Connection error — is the server running on :8080?'],
    };
    const [color, text] = map[status];
    clearChildren(this.statusLine);
    this.statusLine.append(
      el('span', { class: 'pbw-dot', style: { background: color } }),
      el('span', { text }),
    );
  }

  showWaiting(sessionId: string): void {
    this.waiting = true;
    clearChildren(this.root);
    const panel = el('div', { class: 'pbw-panel', style: { width: '420px', textAlign: 'center' } }, [
      el('div', { class: 'pbw-h1', text: 'Waiting for opponent' }),
      el('div', { class: 'pbw-sub', text: 'Share this room code with your opponent:' }),
      el('div', {
        class: 'pbw-h1',
        style: { color: 'var(--accent)', letterSpacing: '6px', fontSize: '34px', margin: '10px 0' },
        text: sessionId,
      }),
      el('div', { style: { marginTop: '16px' } }, [el('span', { class: 'pbw-spinner' })]),
    ]);
    this.root.append(panel);
  }

  show(): void {
    this.waiting = false;
    this.render();
    this.root.style.display = 'flex';
  }
  hide(): void {
    this.root.style.display = 'none';
  }
}
