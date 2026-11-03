/**
 * Footprints in sand: each time a foot of a moving Pokémon comes down (it
 * drops back to as low as that foot goes), a print is pressed there — an
 * oval of darker sand, the way it faces, its size by the Pokémon's — and it
 * fades out over PRINT_LIFE. None in the air. A pool of PRINTS prints, the
 * oldest reused first.
 */
import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { RecipeFactory } from '../RecipeFactory.ts';

/** How many prints at once; how long one lasts (s); how dark it starts (its opacity). */
const PRINTS = 120, PRINT_LIFE = 5, PRINT_ALPHA = 0.75;
/** A print's size (× the Pokémon's height): its width and its length, at least so much (m). */
const PRINT_W = 0.08, PRINT_L = 0.13, PRINT_MIN = 0.07;
/** A foot is down within this of as low as it goes, and up again past this (× the Pokémon's height); its lowest forgets itself this fast (m/s). */
const DOWN = 0.012, UP = 0.03, LOW_DRIFT = 0.05;
/** A print's faces across (it lies on the sand's ripples, not through them), and how far over the sand (m). */
const PRINT_SEGS = 4, PRINT_LIFT = 0.008;
/** It is moving if it went this far since the last frame (m/s). */
const MOVING = 0.1;

export class Footprints {
  private readonly pool: { mesh: Mesh; born: number; rest: Float32Array }[] = [];
  private next = 0;
  private time = 0;
  private readonly feet = new Map<TransformNode, { low: number[]; down: boolean[]; last: Vector3 }>();
  private readonly mat: StandardMaterial;
  private readonly tick: Observer<Scene>;

  constructor(private readonly scene: Scene, private readonly factory: RecipeFactory, private readonly nodes: () => TransformNode[],
    private readonly heightAt: (x: number, z: number) => number, color: string) {
    this.mat = new StandardMaterial('footprint', scene);
    this.mat.diffuseColor = Color3.FromHexString(color).scale(0.4);
    this.mat.specularColor = Color3.Black();
    this.mat.zOffset = -2;
    this.mat.disableDepthWrite = true;
    // (Each its own oval of a few faces, laid on the sand where it is pressed: rounded by its texture's alpha.)
    for (let i = 0; i < PRINTS; i++) {
      const m = MeshBuilder.CreateGround(`footprint${i}`, { width: 1, height: 1, subdivisions: PRINT_SEGS, updatable: true }, scene);
      m.material = this.mat;
      m.isPickable = false;
      m.setEnabled(false);
      this.pool.push({ mesh: m, born: -1e9, rest: Float32Array.from(m.getVerticesData('position')!) });
    }
    this.tick = scene.onBeforeRenderObservable.add(() => this.step());
  }

  private step(): void {
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
    this.time += dt;
    for (const node of this.nodes()) {
      const feet = this.factory.feetNow(node);
      if (!feet.length) continue;
      let st = this.feet.get(node);
      if (!st || st.low.length !== feet.length) { st = { low: feet.map(() => Infinity), down: feet.map(() => true), last: node.position.clone() }; this.feet.set(node, st); }
      const moved = Vector3.Distance(node.position, st.last) / Math.max(1e-4, dt);
      st.last.copyFrom(node.position);
      const H = this.factory.heightOf(node);
      const flying = this.factory.isFlying(node);
      feet.forEach((p, i) => {
        const off = p.y - this.heightAt(p.x, p.z);
        // (Its lowest: as low as it has been, drifting slowly up so a change of clip doesn't leave it stale.)
        st!.low[i] = Math.min(off, st!.low[i] + LOW_DRIFT * dt);
        // (Down once it is low, up only once it has lifted clear: a walk's foot hardly lifts.)
        const was = st!.down[i], down = was ? off <= st!.low[i] + UP * H : off <= st!.low[i] + DOWN * H;
        if (down && !was && moved > MOVING && !flying) this.press(p, node.rotation.y, H);
        st!.down[i] = down;
      });
    }
    for (const pr of this.pool) {
      const age = this.time - pr.born;
      if (age > PRINT_LIFE) { if (pr.mesh.isEnabled()) pr.mesh.setEnabled(false); continue; }
      pr.mesh.visibility = PRINT_ALPHA * (1 - age / PRINT_LIFE);
    }
  }

  /** A print where the foot came down, the way it faces. */
  private press(at: Vector3, yaw: number, H: number): void {
    const pr = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    pr.born = this.time;
    const m = pr.mesh, w = Math.max(PRINT_MIN, PRINT_W * H), l = Math.max(PRINT_MIN * 1.6, PRINT_L * H);
    const y0 = this.heightAt(at.x, at.z), c = Math.cos(yaw), s = Math.sin(yaw);
    m.position.set(at.x, y0, at.z);
    m.rotation.y = yaw;
    m.scaling.set(w, 1, l);
    // Laid on the sand: each corner at the sand's height under it (an oval inside the square: its corners pulled in).
    const p = Float32Array.from(pr.rest);
    for (let i = 0; i < p.length; i += 3) {
      let u = p[i], v = p[i + 2];
      const r = Math.hypot(u, v), k = r > 0.5 ? 0.5 / r : 1;
      u *= k; v *= k; p[i] = u; p[i + 2] = v;
      const wx = at.x + c * u * w + s * v * l, wz = at.z - s * u * w + c * v * l;
      p[i + 1] = this.heightAt(wx, wz) - y0 + PRINT_LIFT;
    }
    m.updateVerticesData('position', p);
    m.refreshBoundingInfo();
    m.visibility = PRINT_ALPHA;
    m.setEnabled(true);
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.tick);
    for (const pr of this.pool) pr.mesh.dispose();
    this.mat.dispose();
  }
}
