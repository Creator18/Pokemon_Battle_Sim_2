/**
 * Stamina: what a Pokémon has to spend on moving and on its moves' charge.
 * The less it moves, the more it has — and the more it has, the faster it
 * moves (vigour: tired, it slows): standing still fills it fastest,
 * walking slower, running (or flying) drains it a little; nothing fills it
 * while it attacks or flinches. A dash costs a lump of it (none left: no
 * dash). A beam held past its first moment drains it, and stops when it is
 * gone; a ram's rush past its first few metres drains it by the metre, and
 * stops short when it is gone. A bar shows it (the player's).
 */
import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';

/** What it is doing, for how stamina fills or drains. */
export type Pace = 'still' | 'walk' | 'run' | 'fly' | 'busy';

/** The most it holds; how fast each pace fills it (+) or drains it (−), a second. */
export const STAMINA_MAX = 100;
const RATE: Record<Pace, number> = { still: 28, walk: 10, run: -4, fly: -3, busy: 0 };
/** What a dash costs; a beam held past its first moment, a second; a rush past its first metres, a metre. */
export const DASH_COST = 22, POUR_COST = 30, RUSH_COST = 9;
/** A rush's first metres, free. */
export const RUSH_FREE = 3;
/** How fast it moves with none left (× its full pace): its pace runs from this, empty, to its full pace, full. */
const SLOWEST = 0.55;

export class Stamina {
  value = STAMINA_MAX;
  private readonly tick: Observer<Scene>;
  private bar: { fill: HTMLElement; root: HTMLElement } | null = null;
  private flashUntil = 0;

  constructor(private readonly scene: Scene, public pace: () => Pace) {
    this.tick = scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
      this.value = Math.max(0, Math.min(STAMINA_MAX, this.value + RATE[this.pace()] * dt));
      this.draw();
    });
  }

  /** Spend `n` if it has it all (true), else nothing (false) — and the bar flashes. */
  pay(n: number): boolean {
    if (this.value < n) { this.flashUntil = performance.now() + 350; return false; }
    this.value -= n;
    return true;
  }

  /** Spend up to `n` (what it has); how much it spent. */
  drain(n: number): number {
    const d = Math.min(this.value, n);
    this.value -= d;
    return d;
  }

  get empty(): boolean { return this.value <= 0.01; }

  /** How fast it can move, with what it has left (× its full pace). */
  get vigour(): number { return SLOWEST + (1 - SLOWEST) * (this.value / STAMINA_MAX); }

  /** Show it as a bar (in `parent`, or along the foot of the screen). */
  show(parent: HTMLElement = document.body): HTMLElement {
    if (this.bar) return this.bar.root;
    const root = document.createElement('div');
    Object.assign(root.style, { width: '360px', height: '10px', borderRadius: '6px', background: 'rgba(20,24,40,0.75)',
      border: '2px solid rgba(255,255,255,0.85)', overflow: 'hidden', boxShadow: '0 2px 6px rgba(0,0,0,0.35)' });
    const fill = document.createElement('div');
    Object.assign(fill.style, { height: '100%', width: '100%', background: '#a3e635', transition: 'background 0.15s' });
    root.append(fill);
    parent.append(root);
    this.bar = { root, fill };
    this.draw();
    return root;
  }

  /** Stop showing its bar. */
  hide(): void {
    this.bar?.root.remove();
    this.bar = null;
  }

  private draw(): void {
    if (!this.bar) return;
    const k = this.value / STAMINA_MAX;
    this.bar.fill.style.width = `${(k * 100).toFixed(1)}%`;
    this.bar.fill.style.background = performance.now() < this.flashUntil ? '#ef4444' : k < 0.25 ? '#f59e0b' : '#a3e635';
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.tick);
    this.bar?.root.remove();
  }
}
