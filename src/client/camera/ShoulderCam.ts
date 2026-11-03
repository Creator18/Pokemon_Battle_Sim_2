/**
 * The real-time battle's camera: third person, over the player's shoulder,
 * always looking at the opponent. It sits behind the player on the line from
 * the opponent through them, a little to one side and up, and looks at the
 * opponent's middle (and rises with the player when it flies) — so the player is always in the near corner of the view
 * and the opponent ahead. Only the Pokémon moving moves it (the mouse never
 * does); it eases after them so it never jerks.
 */
import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

/** Behind the player, to its side and above it: a base (m) plus so many of the player's heights. */
const BACK: [number, number] = [3.2, 1.8], SIDE: [number, number] = [0.5, 0.45], UP: [number, number] = [1.0, 0.75];
/** It looks at the opponent this far up it (× its height). */
const LOOK_UP = 0.45;
/** How quickly it catches up with where it should be (1/s): its place, where it looks. */
const CATCH = 6, CATCH_LOOK = 8;
/** Closer than this (m), the line between them can't be trusted: it keeps the last way. */
const NEAR = 0.3;

export class ShoulderCam {
  private readonly tick: Observer<Scene>;
  private readonly way = new Vector3(0, 0, -1);
  private pos: Vector3 | null = null;
  private look: Vector3 | null = null;
  /** Its shoulder: +1 over the right, -1 over the left. */
  side = 1;

  constructor(private readonly scene: Scene, private readonly camera: ArcRotateCamera,
    public player: TransformNode, public opponent: TransformNode,
    private readonly heightOf: (node: TransformNode) => number,
    private readonly liftOf: (node: TransformNode) => number = () => 0) {
    camera.detachControl();
    camera.inertia = 0;
    camera.lowerRadiusLimit = camera.upperRadiusLimit = null;
    camera.lowerBetaLimit = 0.01; camera.upperBetaLimit = Math.PI - 0.01;
    this.tick = scene.onBeforeRenderObservable.add(() => this.step());
    this.step(true);
  }

  private step(snap = false): void {
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
    const p = this.player.position, o = this.opponent.position;
    const d = p.subtract(o); d.y = 0;
    if (d.length() > NEAR) this.way.copyFrom(d.normalize());
    const h = this.heightOf(this.player), ho = this.heightOf(this.opponent);
    // (Left-handed: with the way back from the opponent, this is the camera's right.)
    const right = new Vector3(-this.way.z, 0, this.way.x);
    const want = p.add(this.way.scale(BACK[0] + BACK[1] * h))
      .addInPlace(right.scale(this.side * (SIDE[0] + SIDE[1] * h)))
      .addInPlace(new Vector3(0, UP[0] + UP[1] * h + this.liftOf(this.player), 0));
    const at = o.add(new Vector3(0, ho * LOOK_UP, 0));
    const k = snap ? 1 : 1 - Math.exp(-CATCH * dt), kl = snap ? 1 : 1 - Math.exp(-CATCH_LOOK * dt);
    this.pos = this.pos ? Vector3.Lerp(this.pos, want, k) : want;
    this.look = this.look ? Vector3.Lerp(this.look, at, kl) : at;
    this.camera.setTarget(this.look.clone());
    this.camera.setPosition(this.pos.clone());
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.tick);
  }
}
