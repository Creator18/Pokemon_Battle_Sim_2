/**
 * WASD (or the arrows) steering the player's Pokémon, as the camera sees it:
 * W away from the camera, S toward it, A and D across; it runs, F held to
 * walk; Shift a short dash the way it is going (leaving afterimages: for
 * getting out of an attack's way, timed just before it lands: RealtimeMoves;
 * paid for out of its stamina); Space takes a flier up, or brings it down.
 * Kept inside the arena's bounds; the camera's target can ease after it, so
 * the view follows without jerking. While it is busy (an attack: `hold`) it
 * neither steers nor dashes.
 */
import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { RecipeFactory } from '../render/RecipeFactory.ts';
import { DASH_COST, type Pace, type Stamina } from './Stamina.ts';

/** Its keys, by KeyboardEvent.code: which way each pushes (x across, z away). */
const KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};
/** How far in from the bounds it stops (m); how quickly the camera's target catches up (1/s). */
const EDGE = 0.6, FOLLOW = 4;
/** The dash: how far (m, plus so many of its heights), and how soon after one it can dash again (s). */
const DASH: [number, number] = [2.2, 0.8], DASH_COOLDOWN = 0.6;

export interface WasdOptions {
  /** Where it may go: half the width and depth about the origin. */
  bounds?: { halfW: number; halfD: number };
  /** Ease the camera's target after it (default true). */
  follow?: boolean;
  /** Its stamina: a dash pays for itself out of it (none: dashes are free). */
  stamina?: Stamina;
}

export class WasdControl {
  private readonly held = new Set<string>();
  private walk = false;
  /** The way it last went (or null: never yet — a dash then goes the way it faces). */
  private lastDir: Vector3 | null = null;
  private busy = 0;
  private dashing = false;
  private dashedAt = -Infinity;
  private dashReady = 0;
  /** How it moved this frame (for its stamina). */
  private moved: Pace = 'still';
  private time = 0;
  private readonly tick: Observer<Scene>;
  private readonly onDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.code === 'KeyF') this.walk = true;
    if (KEYS[e.code]) { this.held.add(e.code); e.preventDefault(); }
    if (e.key === 'Shift' && !e.repeat) void this.dash();
    // Space: a flier takes off, or lands.
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat && !this.busy) void this.factory.fly(this.node, !this.factory.isFlying(this.node)); }
  };
  private readonly onUp = (e: KeyboardEvent) => {
    if (e.code === 'KeyF') this.walk = false;
    this.held.delete(e.code);
  };
  private readonly onBlur = () => { this.held.clear(); this.walk = false; };

  constructor(private readonly scene: Scene, private readonly factory: RecipeFactory, private readonly camera: ArcRotateCamera,
    public node: TransformNode, private readonly options: WasdOptions = {}) {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
    this.tick = scene.onBeforeRenderObservable.add(() => this.step());
  }

  /** The way the held keys push it, on the ground as the camera sees it (null: none held). */
  private pushed(): Vector3 | null {
    let ax = 0, az = 0;
    for (const k of this.held) { ax += KEYS[k][0]; az += KEYS[k][1]; }
    if (!ax && !az) return null;
    // The camera's ground forward and right.
    const f = this.camera.target.subtract(this.camera.position); f.y = 0; f.normalize();
    const r = new Vector3(f.z, 0, -f.x); // (Babylon is left-handed: this is screen right.)
    return f.scale(az).addInPlace(r.scale(ax)).normalize();
  }

  private step(): void {
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
    this.time += dt;
    if (!this.busy) {
      const dir = this.pushed();
      if (dir) this.lastDir = dir;
      // (As fast as its stamina lets it.)
      this.factory.steer(this.node, dir, !this.walk, dt, this.options.stamina?.vigour ?? 1);
      this.moved = this.factory.isFlying(this.node) ? 'fly' : !dir ? 'still' : this.walk ? 'walk' : 'run';
    } else this.moved = 'busy';
    this.clamp(this.node.position);
    if (this.options.follow !== false) {
      const t = this.camera.target, p = this.node.position, k = 1 - Math.exp(-FOLLOW * dt);
      this.camera.target = new Vector3(t.x + (p.x - t.x) * k, t.y, t.z + (p.z - t.z) * k);
    }
  }

  private clamp(p: Vector3): Vector3 {
    const b = this.options.bounds;
    if (b) {
      p.x = Math.max(-b.halfW + EDGE, Math.min(b.halfW - EDGE, p.x));
      p.z = Math.max(-b.halfD + EDGE, Math.min(b.halfD - EDGE, p.z));
    }
    return p;
  }

  /** A short quick dash the way it is going (or last went; or faces), its afterimages left behind. */
  private async dash(): Promise<void> {
    if (this.busy || this.time < this.dashReady) return;
    if (this.options.stamina && !this.options.stamina.pay(DASH_COST)) return;
    const yaw = this.node.rotation.y;
    const dir = this.pushed() ?? this.lastDir ?? new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const far = DASH[0] + DASH[1] * this.factory.heightOf(this.node);
    const to = this.clamp(this.node.position.add(dir.scale(far)));
    this.dashing = true;
    this.dashedAt = performance.now() / 1000;
    try { await this.hold(this.factory.playDodge(this.node, to)); } finally { this.dashing = false; }
    this.dashReady = this.time + DASH_COOLDOWN;
  }

  /** Busy till `until` is over (an attack, a dash): no steering, no dashing meanwhile. */
  async hold<T>(until: Promise<T>): Promise<T> {
    this.busy++;
    try { return await until; } finally { this.busy--; }
  }

  /** How it is moving (still, walking, running, flying — or busy: attacking, dashing, flinching), for its stamina. */
  get pace(): Pace { return this.moved; }

  /** Is it mid-dash? */
  get isDashing(): boolean { return this.dashing; }

  /** When its last dash began (performance.now, s; -Infinity: never). */
  get dashStartedAt(): number { return this.dashedAt; }

  /** Is it busy (attacking, dashing)? */
  get isBusy(): boolean { return this.busy > 0; }

  /** Stand it still where it is (its idle). */
  stand(): void { this.factory.steer(this.node, null, false, 0); }

  /** Steer another Pokémon instead: the one let go stands where it is. */
  take(node: TransformNode): void {
    if (node === this.node) return;
    this.factory.steer(this.node, null, false, 0);
    this.node = node;
    this.lastDir = null;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
    this.scene.onBeforeRenderObservable.remove(this.tick);
    this.factory.steer(this.node, null, false, 0);
  }
}
