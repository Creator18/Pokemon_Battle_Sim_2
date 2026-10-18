/**
 * PulseFx — the sonar pulse: a ranged attack (Psychic, Water Pulse) made of
 * the dash rings (DashRings), reversed front to back and with a larger ring
 * added in front.
 *
 * One pulse is three hoops along the attacker's gaze, growing toward the
 * target — small at the back, larger, largest in front — and each hoop
 * tapers the other way to the dash's, its strands widening forward: the
 * whole set flares open toward the target. The attacker sends them in a
 * rhythm (PULSES, every PERIOD s); each one travels to the target in TRAVEL s,
 * widening as it goes, and fades as it arrives — never past it.
 *
 * The hit lands as the first pulse arrives; contact lasts until the last one
 * has.
 */

import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';

import { RING_STRAND, grid } from './DashRings.ts';

type RGB = [number, number, number];

const PULSES = 6; //            pulses per attack
const PERIOD = 0.17; //         s between them
const TRAVEL = 0.55; //         s for one to cross from the mouth to the target
/** On arrival a pulse disperses in DISPERSE s (under PERIOD: gone before the next arrives), bursting to DISPERSE_GROW × its size. */
const DISPERSE = 0.14, DISPERSE_GROW = 2.2;
const DECEL = 3.2; //           ease-out power: higher = leaves faster, slows more at the end
const ROOT = 0.3; //            they leave this far along the gaze from the mouth (model heights)
/** A pulse's hoops: radii (× the pulse's size), back to front, and their spacing (× size). */
const HOOPS = [0.85, 1.0, 1.45], SPACING = 0.5;
/** A pulse's size (model heights) as it leaves, and as it reaches the target. */
const SIZE_NEAR = 0.22, SIZE_FAR = 0.62;

export interface PulseSpec {
  element: string;
  /** How much larger than normal its rings are (default 1). */
  scale?: number;
}

export const PULSE_MOVES: Record<string, PulseSpec> = {
  Psychic: { element: 'Psychic' },
  'Water Pulse': { element: 'Water' },
  'Dark Pulse': { element: 'Dark' },
  // A blast of sound: the same pulse with far larger rings.
  Boomburst: { element: 'Normal', scale: 2.5 },
};

export function pulseFor(moveName: string | null | undefined): PulseSpec | null {
  return (moveName && PULSE_MOVES[moveName]) || null;
}

/** A strand's tint (the shader glows it; above 1 blooms). */
function tintFor(element: string, strand: number): RGB {
  switch (element) {
    // Black and red: a red core strand between two black ones (alpha-blended, so black shows).
    case 'Dark': return strand === 1 ? [1.25, 0.12, 0.1] : [0.04, 0.0, 0.01];
    case 'Psychic': return [1.15, 0.42, 0.95];
    case 'Water': return [0.4, 0.78, 1.25];
    case 'Normal': return [1.2, 1.12, 0.98];
    default: return [1, 1, 1];
  }
}

export interface PulseShot {
  element: string;
  scale?: number;
  height: number;
  mouth(): Vector3;
  target(): Vector3;
  /** The attacker's yaw: the pulses travel along its gaze. */
  facing?(): number;
}

export interface PulseHandle {
  /** Start sending pulses (the attack's moment of release). */
  open(): void;
  /** The first pulse reaches the target. */
  readonly front: Promise<void>;
  /** The last pulse reaches the target. */
  readonly last: Promise<void>;
  /** All gone. */
  readonly done: Promise<void>;
}

const UP = new Vector3(0, 1, 0);
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export class PulseFx {
  private geo = grid(RING_STRAND.SEG, RING_STRAND.TUBE);
  constructor(readonly scene: Scene, readonly camera: Camera) {}

  fire(shot: PulseShot): PulseHandle {
    return new Pulse(this.scene, this.camera, shot, this.geo);
  }
}

interface Wave { age: number; strands: { mesh: Mesh; mat: ShaderMaterial }[] }

class Pulse implements PulseHandle {
  readonly front: Promise<void>;
  readonly last: Promise<void>;
  readonly done: Promise<void>;
  private resolveFront!: () => void;
  private resolveLast!: () => void;
  private resolveDone!: () => void;
  private opened = false;
  private sent = 0;
  private sinceSend = PERIOD;
  private arrived = 0;
  private time = 0;
  private waves: Wave[] = [];
  private tick: Observer<Scene>;

  constructor(private readonly scene: Scene, private readonly camera: Camera, private readonly shot: PulseShot,
    private readonly geo: ReturnType<typeof grid>) {
    this.front = new Promise((r) => { this.resolveFront = r; });
    this.last = new Promise((r) => { this.resolveLast = r; });
    this.done = new Promise((r) => { this.resolveDone = r; });
    this.tick = scene.onBeforeRenderObservable.add(() => this.update());
  }

  open(): void { this.opened = true; }

  private spawnWave(): void {
    const strands = [];
    for (let i = 0; i < HOOPS.length * RING_STRAND.STRANDS; i++) {
      const mesh = new Mesh(`pulseRing${i}`, this.scene);
      this.geo.applyToMesh(mesh);
      const mat = new ShaderMaterial(`pulseRingMat${i}`, this.scene, { vertex: 'dashRing', fragment: 'dashRing' }, {
        attributes: ['position', 'uv'],
        uniforms: ['viewProjection', 'center', 'axis', 'side', 'upv', 'big', 'tube', 'camPos', 'age', 'left', 'strand', 'tint'],
        needAlphaBlending: true,
      });
      mat.backFaceCulling = false;
      mat.disableDepthWrite = true;
      mat.setFloat('strand', i % RING_STRAND.STRANDS);
      mat.setVector3('tint', new Vector3(...tintFor(this.shot.element, i % RING_STRAND.STRANDS)));
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.doNotSyncBoundingInfo = true;
      strands.push({ mesh, mat });
    }
    this.waves.push({ age: 0, strands });
  }

  private update(): void {
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
    this.time += dt;
    if (!this.opened) return;
    const H = this.shot.height;

    // Send the rhythm.
    if (this.sent < PULSES) {
      this.sinceSend += dt;
      if (this.sinceSend >= PERIOD) { this.sinceSend = 0; this.sent++; this.spawnWave(); }
    }

    // The frame: along the attacker's gaze, pitched to the target's middle.
    const mouth = this.shot.mouth();
    let aim = this.shot.target().subtract(mouth);
    if (this.shot.facing) {
      const yaw = this.shot.facing();
      const fwd = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      aim = fwd.scale(Math.max(0.2, Vector3.Dot(aim, fwd))).addInPlace(new Vector3(0, aim.y, 0));
    }
    const dist = aim.length();
    aim.scaleInPlace(1 / Math.max(dist, 1e-4));
    const origin = mouth.add(aim.scale(ROOT * H));
    const reach = Math.max(0.2, dist - ROOT * H);
    const up = UP.subtract(aim.scale(Vector3.Dot(UP, aim)));
    if (up.lengthSquared() < 1e-6) up.set(1, 0, 0);
    up.normalize();
    const side = Vector3.Cross(up, aim).normalize();
    const cam = this.camera.globalPosition;
    const { STRANDS, STRAND_R, STRAND_AT, STRAND_W, RING_W, TUBE_SWELL } = RING_STRAND;

    for (const w of this.waves) {
      w.age += dt / TRAVEL;
      const k = Math.min(1, w.age);
      if (w.age >= 1 && !('hit' in w)) {
        (w as Wave & { hit?: true }).hit = true;
        this.arrived++;
        if (this.arrived === 1) this.resolveFront();
        if (this.arrived === PULSES) this.resolveLast();
      }
      // Out from the mouth fast, decelerating hard as it nears the target
      // (ease-out, power DECEL), widening as it goes. On arrival it disperses:
      // its rings burst wider and break apart, gone before the next arrives.
      const travelled = reach * (1 - Math.pow(1 - k, DECEL));
      const burst = w.age > 1 ? Math.min(1, (w.age - 1) / (DISPERSE / TRAVEL)) : 0;
      const spread = 1 + (DISPERSE_GROW - 1) * (1 - Math.pow(1 - burst, 3));
      const size = (SIZE_NEAR + (SIZE_FAR - SIZE_NEAR) * k) * H * (this.shot.scale ?? 1) * spread;
      const appear = smoothstep(0, 0.12, w.age);
      const left = appear * Math.pow(1 - burst, 1.4);
      // Strand thickness grows only with the square root of the move's scale:
      // big rings stay crisp lines, not walls.
      const sc = this.shot.scale ?? 1;
      const tube = RING_W * (1 + TUBE_SWELL * 0.6) * STRAND_W * (size / sc) * Math.sqrt(sc) * 1.6 * Math.max(left, 0.05);
      w.strands.forEach(({ mesh, mat }, j) => {
        const i = Math.floor(j / STRANDS), s = (j % STRANDS) - (STRANDS - 1) / 2;
        // Reversed from the dash: hoops grow toward the target, and each
        // hoop's strands widen forward.
        // Never past the target: the rings ahead pile up at the contact point.
        const along = Math.min(reach, travelled + ((i - 1) * SPACING + STRAND_AT * s) * size / spread);
        mesh.setEnabled(left > 0.01);
        const big = HOOPS[i] * size * (1 + STRAND_R * 1.5 * s);
        mat.setVector3('center', origin.add(aim.scale(along)));
        mat.setVector3('axis', aim); mat.setVector3('side', side); mat.setVector3('upv', up);
        mat.setFloat('big', Math.max(1e-3, big)); mat.setFloat('tube', Math.max(1e-4, tube));
        mat.setVector3('camPos', cam);
        mat.setFloat('age', this.time * 0.8 + j * 0.01); // keeps the filaments rolling
        mat.setFloat('left', left);
      });
    }
    const end = 1 + DISPERSE / TRAVEL;
    for (const w of this.waves.filter((x) => x.age >= end)) for (const st of w.strands) { st.mat.dispose(); st.mesh.dispose(); }
    this.waves = this.waves.filter((x) => x.age < end);
    if (this.sent >= PULSES && this.waves.length === 0) this.finish();
  }

  private finish(): void {
    this.scene.onBeforeRenderObservable.remove(this.tick);
    this.resolveFront(); this.resolveLast(); this.resolveDone();
  }
}
