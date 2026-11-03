/**
 * A stand-in opponent, for something to dodge: it stands its ground, facing
 * the player, and every few seconds lets one of its moves go at where the
 * player stands then (RealtimeMoves) — never while one is still playing, nor
 * while it is flinching.
 */
import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { RealtimeMoves } from './RealtimeMoves.ts';

/** How long it waits between moves (s): at least, and at most. */
const WAIT: [number, number] = [2.5, 4.5];

export class OpponentBot {
  private readonly tick: Observer<Scene>;
  private next: number;
  private time = 0;
  private busy = false;
  /** Paused (it only stands and watches). */
  paused = false;

  constructor(private readonly scene: Scene, private readonly engine: RealtimeMoves, public node: TransformNode,
    public target: TransformNode, readonly moves: string[]) {
    this.next = this.wait();
    this.tick = scene.onBeforeRenderObservable.add(() => this.step());
  }

  private wait(): number {
    return WAIT[0] + Math.random() * (WAIT[1] - WAIT[0]);
  }

  /** It's held still a while (struck): its next move waits till after. */
  hold(until: Promise<unknown>): void {
    this.busy = true;
    void until.finally(() => { this.busy = false; this.next = Math.max(this.next, this.time + 0.8); });
  }

  private step(): void {
    this.time += Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
    if (this.paused || this.busy || this.time < this.next) return;
    const usable = this.moves.filter((m) => this.engine.plays(m));
    if (!usable.length) return;
    const name = usable[Math.floor(Math.random() * usable.length)];
    this.busy = true;
    void this.engine.use(this.node, this.target, name).finally(() => {
      this.busy = false;
      this.next = this.time + this.wait();
    });
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.tick);
  }
}
