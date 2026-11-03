/**
 * The player's moves, as Poke2D Arena has them: four, on 1–4. Pressing a
 * move's key arms it (again: disarms it); a left click lets the armed one go
 * at the opponent (RealtimeMoves) — a beam pours on for as long as the
 * button is held. While it plays, the player neither steers nor dashes
 * (WasdControl.hold). A bar along the foot of the screen shows the four, the
 * armed one lit.
 */
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { ensureStyles, el } from '../ui/dom.ts';
import type { WasdControl } from './WasdControl.ts';
import type { RealtimeMoves } from './RealtimeMoves.ts';

/** Its keys, by KeyboardEvent.code, in slot order. */
const SLOT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];

export class MoveControl {
  private armed = -1;
  private readonly bar: HTMLElement;
  private readonly slots: HTMLElement[] = [];
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.repeat) return;
    const i = SLOT_KEYS.indexOf(e.code);
    if (i >= 0 && i < this.moves.length) this.arm(this.armed === i ? -1 : i);
  };
  /** Is the left button down (a beam pours on while it is)? */
  private down = false;
  private readonly onClick = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.down = true;
    void this.release();
  };
  private readonly onLift = (e: PointerEvent) => { if (e.button === 0) this.down = false; };
  private readonly onBlur = () => { this.down = false; };

  constructor(private readonly engine: RealtimeMoves, private readonly wasd: WasdControl, public opponent: TransformNode,
    private readonly canvas: HTMLCanvasElement, readonly moves: string[]) {
    ensureStyles();
    this.bar = el('div', { style: { position: 'fixed', left: '50%', bottom: '18px', transform: 'translateX(-50%)', display: 'flex', gap: '10px', zIndex: '60' } });
    moves.forEach((name, i) => {
      const b = el('button', { class: 'pbw-btn', text: `${i + 1}  ${name}`, onclick: () => this.arm(this.armed === i ? -1 : i) });
      b.style.transition = 'outline-color 0.1s, transform 0.1s';
      b.style.outline = '3px solid transparent';
      b.style.outlineOffset = '2px';
      b.style.borderRadius = '10px';
      this.slots.push(b);
      this.bar.append(b);
    });
    document.body.append(this.bar);
    window.addEventListener('keydown', this.onKey);
    canvas.addEventListener('pointerdown', this.onClick);
    window.addEventListener('pointerup', this.onLift);
    window.addEventListener('blur', this.onBlur);
  }

  /** Arm slot `i` (-1: none). */
  arm(i: number): void {
    this.armed = i;
    this.slots.forEach((s, k) => {
      s.style.outlineColor = k === i ? '#facc15' : 'transparent';
      s.style.transform = k === i ? 'translateY(-6px)' : '';
    });
  }

  /** Let the armed move go at the opponent (nothing armed, or still busy: nothing). */
  async release(): Promise<void> {
    if (this.armed < 0 || this.wasd.isBusy) return;
    const name = this.moves[this.armed];
    this.arm(-1);
    const me = this.wasd.node;
    // (Stood still first: its attack plays from its stance, not its run.)
    this.wasd.stand();
    await this.wasd.hold(this.engine.use(me, this.opponent, name, () => this.down));
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.canvas.removeEventListener('pointerdown', this.onClick);
    window.removeEventListener('pointerup', this.onLift);
    window.removeEventListener('blur', this.onBlur);
    this.bar.remove();
  }
}
