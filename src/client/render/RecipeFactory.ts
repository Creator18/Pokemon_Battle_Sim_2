/**
 * RecipeFactory — the real Pokémon, built at runtime from the Legends Z-A
 * archive data (see src/client/recipe/), skinned, coloured on the GPU and
 * animated with the game's own clips.
 *
 * Every Pokémon is scaled by SQUEEZE: displayed height = A · realHeight^K. With
 * K = 0.5 the size ORDER and feel survive (Pikachu is still clearly the
 * smallest, Gardevoir the tallest) but the spread shrinks from about 3.8x to
 * 1.9x, so all of them read on a hex tile. K = 1 is true size, K = 0 is one
 * height for all.
 *
 * Anything that fails to load (no archives, an unknown form) falls back to the
 * stylized primitive from PokemonFactory, and every call on that unit is
 * passed through to it.
 */

import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import { Quaternion, Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { Bone } from '@babylonjs/core/Bones/bone';
import { Material } from '@babylonjs/core/Materials/material';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';

import type { SpeciesDefinition } from '../../shared/index.ts';
import { loadPokemon, formId } from '../recipe/loader.js';
import { buildPokemon } from '../recipe/babylon.js';
import type { PokemonFactory } from './PokemonFactory.ts';
import type { BeamPlay, CastKind, ClashPlay, UnitFactory } from './unitFactory.ts';
import { arcTo, KNOCK_TIME, KNOCK_ARC, KNOCK_MIN_ARC } from './unitFactory.ts';
import { clashBallRadius, type BeamFx, type BeamClash } from '../vfx/beam/BeamFx.ts';
import { throwBall } from '../vfx/beam/BallFx.ts';
import type { DashRings } from '../vfx/DashRings.ts';
import type { PulseFx, PulseSpec } from '../vfx/PulseFx.ts';
import type { WindFx } from '../vfx/WindFx.ts';
import type { WindSpec } from '../vfx/windMoves.ts';
import type { LightningFx, EarthOptions } from '../vfx/LightningFx.ts';
import type { SlashFx } from '../vfx/SlashFx.ts';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { ClawSpec } from '../vfx/slashMoves.ts';
import type { LightningSpec } from '../vfx/lightningMoves.ts';
import type { BeamSpec } from '../vfx/beam/beamMoves.ts';
import type { BallSpec } from '../vfx/beam/ballMoves.ts';
import type { UnitFx, AuraHandle, AuraOptions } from '../vfx/UnitFx.ts';
import { elementFor } from '../vfx/auraPalette.ts';
import { SkinSampler, VertexSubset } from './skinSampler.ts';
import { BODY_PARTS, BLADES, CLAW_ON_ATTACK, STRIKE_PARTS, partBones, partMeasureBone, regionFlags } from './bodyParts.ts';
import { chestOf, findStrikeRegion, type StrikeRegion, type Peeker } from './strikeRegion.ts';
import { matchBones, snapshotModel, bonePositions, pairOnto, LiveSkin, footVertices, plant, buildGraph, smoothOver, smoothScratch } from './evolution.ts';
import { FOOT_CAP, FOOT_CAP_HUGE, HEX_SIZE, TILE_SCALE } from '../hexWorld.ts';

/** The Babylon classes the recipe builder uses, passed in (it reaches for no global). */
const B = {
  TransformNode, Mesh, VertexData, SubMesh, Quaternion, Vector3, Matrix, Color3, Skeleton, Bone,
  Material, MaterialPluginBase, MultiMaterial, StandardMaterial, RawTexture, Texture,
};

/** displayed height = A * realHeight^K (world units; a hex tile is ~1.7 across). */
export const SQUEEZE = { A: 1.3, K: 0.5 };
export const displayHeight = (realHeight: number) => SQUEEZE.A * Math.pow(Math.max(0.05, realHeight), SQUEEZE.K);

const FLASH_PEAK = 0.85; // how much of the body the flash covers
const FLASH_HOLD = 0.07; // s at full
const FLASH_FADE = 0.22; // s back to normal

/** Seconds a beam keeps pouring after its front has struck. */
const BEAM_HOLD = 0.8;
/** A beam clash: how long the beams hold even before one pushes (s), and how long a bare win takes to push the ball back (s). */
const CLASH_STANDOFF = 0.9, CLASH_PUSH = 2.0;
/** Bones that mark the snout, best first: the beam pours from the mean of the first two found. */
const MOUTH_BONES = ['center_nose', 'nose', 'upper_jaw', 'jaw', 'lower_jaw_02', 'lower_jaw', 'root_jaw'];

const WALK_SPEED = 2.6 * TILE_SCALE; // world units / s (tiles are larger now)
const RUN_SPEED = 4.4 * TILE_SCALE;

/** What buildPokemon returns, as far as this file uses it. */
interface RecipeModel {
  root: TransformNode;
  meshes: Mesh[];
  skeleton: Skeleton;
  height: number;
  restBounds: { min: number[]; max: number[] };
  player: {
    play(action: string, opts?: { loop?: boolean; fade?: number; speed?: number }): Promise<boolean>;
    has(action: string): boolean;
    /** Pose the bones as `action` stands `t` s in, call fn, put the live pose back. */
    peek(action: string, t: number, fn: () => void): void;
    active: { action: string } | null;
    /** Seconds into the active clip. */
    time: number;
    clips: Map<string, { duration: number }>;
  };
  /** Shapes the idle hides (vines, jets, open wings…): the player draws them while a clip turns them on. */
  props: { name: string; mesh: Mesh; boneIndices: Float32Array; boneWeights: Float32Array }[];
  setFlash(rgb: [number, number, number], amount: number): void;
  setLift(y: number): void;
  dispose(): void;
}

interface Unit {
  model: RecipeModel;
  down: boolean;
  skin: SkinSampler;
  /** Hover height above the tile (world units): where it is heading, and where it is now. */
  hoverTarget: number;
  hover: number;
  /** The ground clamp's current lift (world units). */
  clamp: number;
  /** Who it keeps facing, and whether it is walking (then it faces its path). */
  lookAt: TransformNode | null;
  moving: boolean;
  /** Its types (an Electric type crackles to the ground whenever its aura is up). */
  types: readonly string[];
  /** Which body part leads each clip it has struck with (null: the whole body), worked out once. */
  strikeParts: Map<string, string | null>;
  /** Its species' name. */
  species: string;
  /** What strikes in each clip when no limb leads it, to the vertex (strikeRegion.ts), worked out once. */
  strikeRegions: Map<string, StrikeRegion | null>;
  /** How many vertices each part carries (skinOn), worked out once. */
  skinCounts: Map<string, number>;
  /** Its blade's vertex region (bodyParts.BLADES), worked out once. */
  blade?: { key: string; flags: Map<AbstractMesh, Float32Array> };
  /** Its per-frame upkeep (height, facing), removed when it is replaced. */
  upkeep: Observer<Scene> | null;
  /** Its feet (every vertex skinned to a foot or toe bone), if its rig has any: they stand on the ground. */
  feet: VertexSubset | null;
}

/** Evolution: seconds to glow white (and to fade it), and for the surface to flow into the new shape. */
const EVOLVE_GLOW = 0.7, EVOLVE_MORPH = 2.2;
/** How many smoothing steps a morphing surface's destinations get each frame. */
const SMOOTH_STEPS = 8;

/** How fast a unit turns to face its opponent (rad/s). */
const TURN_SPEED = 7;

/** Ground clamp: allowed sink before lifting (world units), and how fast it follows. */
const CLAMP_EPS = 0.01;
const CLAMP_UP = 25; //   per second, toward a deeper sink
const CLAMP_DOWN = 6; //  per second, relaxing back
/** How fast feet settle onto the ground (per second, of the gap). */
const FEET_RATE = 20;
/** Take-off / landing climb rate (world units per second) and the lowest cruise height. */
const CLIMB_SPEED = 2.4;
const MIN_FLIGHT = 0.9;

/** A strike part carrying fewer vertices than this shows nothing worth a coat (its skin is elsewhere). */
const MIN_PART_VERTS = 24;
/** A ball attack charges at least this long (s) before it is let fly. */
const BALL_CHARGE = 1.0;
/** An attack clip's blow lands HIT_AT of the way through it (at most HIT_CAP s in). */
const HIT_AT = 0.45, HIT_CAP = 0.7;
/** What strikes is judged on its swing up to FOLLOW s after the blow (later is follow-through). */
const FOLLOW = 0.15;
/** A swipe's hand: sampled every SWEEP_STEP s; it sweeps if it peaks at SWEEP_MIN × the model's height per second. */
const SWEEP_STEP = 0.05, SWEEP_MIN = 1;
/** …within SWEEP_AROUND s of the blow. */
const SWEEP_AROUND = 0.15;
/** A swipe's blow lands SWIPE_HIT s into its strike clip (on its first frames: EFFECTS.md, clawEnd at phase 0). */
const SWIPE_HIT = 0.03;

/**
 * The motion a strike is measured on: the plain attack clip, or a swipe (its
 * wind-up and its strike, one after the other, looked at as one): how long
 * it runs, when its blow lands, and how to pose the skeleton at any time in it.
 */
interface StrikeClip { key: 'attack' | 'swipe'; duration: number; hit: number; peek(t: number, fn: () => void): void }
/** A claw's swing: how the striking part moves from SWING_BEFORE s before the blow to SWING_AFTER after it. */
const SWING_BEFORE = 0.1, SWING_AFTER = 0.03;

/** An action's airborne twin, when the unit is in the air and has one ('idle' -> 'airIdle'). */
const airName = (action: string) => `air${action[0].toUpperCase()}${action.slice(1)}`;

const sleep = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000));

/** A rig's feet: every vertex skinned to a foot or toe bone (or below one), or null if it has none. */
function feetOf(model: RecipeModel): VertexSubset | null {
  const sk = model.skeleton;
  const roots = sk.bones.filter((b) => /(^|_)(foot|toe)(_|$)/.test(b.name));
  if (!roots.length) return null;
  const set = new Set<number>();
  for (const b of sk.bones) for (let x: Bone | null = b; x; x = x.getParent()) if (roots.includes(x)) { set.add(b.getIndex()); break; }
  const feet = new VertexSubset(model.meshes, sk, set, 0.4);
  return feet.size ? feet : null;
}

/**
 * A part counts as leading a strike if the clip drives it this far forward of
 * the body (× the model's height). Measured on hands (2026-10-17): Machamp
 * 0.38, Gengar 0.33, Charizard 0.22 (a claw), Lucario 0.19 (a punch) — against
 * Gardevoir 0.12, Absol 0.11, Pikachu 0.05, whose attacks are the whole body's.
 */
const STRIKE_REACH = 0.17;
/** A tail leads only if its tip gets this far in front of the body's middle (× height). */
const TAIL_AHEAD = 0.25;

/**
 * Which body part leads a clip (any clip: a punch, a kick, a bite, a tail
 * swipe): looked ahead through it, the part (STRIKE_PARTS) that drives
 * furthest forward (+Z in the model's own frame) in one swing — from the
 * furthest back it had been before (a wind-up first draws it back: Garchomp's
 * claw starts the clip already forward) — up to just after the blow (what
 * swings on afterwards is follow-through, not the strike), less the most the
 * body (the hips) swings — so a lunge or a tackle, which carries everything
 * along, is led by nothing. A chain (a tail) only leads if its tip
 * swings round well in front of the body's middle (TAIL_AHEAD) at some point:
 * a tail tip whips a long way in any attack. Measured: Raichu 1.33, Gyarados
 * 0.99, Onix 0.70, Pikachu 0.38 in front — Lucario's only 0.08 (it punches).
 * Null if no part reaches STRIKE_REACH.
 */
function findStrikePart(model: RecipeModel, clip: StrikeClip | null): string | null {
  if (!clip) return null;
  const sk = model.skeleton;
  const parts = STRIKE_PARTS.map((part) => ({ part, bone: partMeasureBone(sk, part) })).filter((x) => !!x.bone) as { part: string; bone: Bone }[];
  if (!parts.length) return null;
  const body = sk.bones.find((b) => /^(hips|waist|spine_01)$/i.test(b.name)) ?? null;
  const zOf = (b: Bone) => b.getAbsoluteMatrix().getTranslation().z;
  // The furthest back each has been so far, and its biggest forward swing from there.
  const back = new Map<string, number>(), reach = new Map<string, number>(), ahead = new Set<string>();
  let bodyBack = 0, bodyReach = 0;
  clip.peek(0, () => {
    sk.computeAbsoluteMatrices(true);
    bodyBack = body ? zOf(body) : 0;
    parts.forEach(({ part, bone }) => { back.set(part, zOf(bone)); reach.set(part, 0); });
  });
  const STEPS = 24;
  for (let s = 1; s <= STEPS; s++) {
    clip.peek((Math.min(clip.duration, clip.hit + FOLLOW) * s) / STEPS, () => {
      sk.computeAbsoluteMatrices(true);
      const bodyZ = body ? zOf(body) : 0;
      if (body) { bodyBack = Math.min(bodyBack, bodyZ); bodyReach = Math.max(bodyReach, bodyZ - bodyBack); }
      parts.forEach(({ part, bone }) => {
        back.set(part, Math.min(back.get(part)!, zOf(bone)));
        reach.set(part, Math.max(reach.get(part)!, zOf(bone) - back.get(part)!));
        if (zOf(bone) - bodyZ > TAIL_AHEAD * model.height) ahead.add(part);
      });
    });
  }
  let best: string | null = null;
  for (const { part } of parts) {
    if (BODY_PARTS[part]?.measure === 'tip' && !ahead.has(part)) continue;
    if (!best || reach.get(part)! > reach.get(best)!) best = part;
  }
  return best && reach.get(best)! - bodyReach > STRIKE_REACH * model.height ? best : null;
}

export class RecipeFactory implements UnitFactory {
  private readonly units = new WeakMap<TransformNode, Unit>();

  constructor(
    private readonly scene: Scene,
    private readonly fallback: PokemonFactory,
    /** Flash and aura outlines on the silhouettes (optional: the gallery has none). */
    private readonly fx: UnitFx | null = null,
    /** The beam attacks (optional, like fx). */
    private readonly beams: BeamFx | null = null,
    /** The wake rings left by a dash (optional). */
    private readonly dash: DashRings | null = null,
    /** The sonar pulse (optional). */
    private readonly pulses: PulseFx | null = null,
    /** Tornadoes and wind (optional). */
    private readonly wind: WindFx | null = null,
    /** Lightning: earthing strokes and bolts (optional). */
    private readonly lightning: LightningFx | null = null,
    /** Claw marks (optional). */
    private readonly slashes: SlashFx | null = null,
  ) {}

  /** The hand each unit last clawed with (they alternate when the strike part does not say). */
  private lastClaw = new WeakMap<TransformNode, number>();

  async createPokemon(species: SpeciesDefinition, playerId: number, onProgress?: (fraction: number) => void): Promise<TransformNode> {
    try {
      const data = await loadPokemon(species.modelId ?? formId(species.spriteId), { onProgress });
      const shadowGenerator = (this.scene.metadata as { shadowGen?: ShadowGenerator } | undefined)?.shadowGen ?? null;
      const model = buildPokemon(B, this.scene, data, { shadowGenerator }) as unknown as RecipeModel;
      // Squeezed by height; then anything longer or wider than FOOT_CAP on the
      // floor (Steelix, Onix, Kyogre…) shrinks to fit, so it fits on a tile.
      let scale = displayHeight(model.height) / model.height;
      const rb = model.restBounds;
      const foot = Math.max(rb.max[0] - rb.min[0], rb.max[2] - rb.min[2]) * scale;
      // A huge one has a three-tile triangle to fill.
      const cap = species.huge ? FOOT_CAP_HUGE : FOOT_CAP;
      if (foot > cap) scale *= cap / foot;
      model.root.scaling.setAll(scale);
      model.root.metadata = { species: species.name, playerId, facing: 0, recipe: true };
      const u: Unit = { model, down: false, skin: new SkinSampler(model.meshes, model.skeleton), hoverTarget: 0, hover: 0, clamp: 0, lookAt: null, moving: false, types: species.types,
        strikeParts: new Map(), strikeRegions: new Map(), skinCounts: new Map(), species: species.name, upkeep: null, feet: feetOf(model) };
      this.units.set(model.root, u);
      this.fx?.register(model.root, model.meshes, model.skeleton, model.props.map((p) => p.mesh));
      u.upkeep = this.scene.onBeforeRenderObservable.add(() => this.updateHeight(model.root, u));
      void model.player.play('idle', { fade: 0 });
      return model.root;
    } catch (e) {
      console.warn(`[recipe] ${species.name}: ${(e as Error).message} — using the stylized model instead`);
      onProgress?.(1);
      const node = await this.fallback.createPokemon(species, playerId);
      this.fx?.register(node, node.getChildMeshes(), null);
      return node;
    }
  }

  // ── animation ──────────────────────────────

  async playMoveTo(node: TransformNode, worldPath: Vector3[], hover: number[] = []): Promise<void> {
    const u = this.units.get(node);
    if (!u) return this.fallback.playMoveTo(node, worldPath, hover);
    if (worldPath.length === 0) return;
    u.moving = true;
    try { await this.walk(u, node, worldPath, hover); } finally { u.moving = false; }
  }

  private async walk(u: Unit, node: TransformNode, worldPath: Vector3[], hover: number[]): Promise<void> {
    // A flier crossing (or leaving, or heading for) an obstacle flies the whole
    // way, at the height of the tallest one, and lands at the end if it can.
    const canFly = u.model.player.has('airIdle');
    const end = canFly ? (hover[worldPath.length - 1] ?? 0) : 0;
    const fly = canFly && (u.hoverTarget > 0 || hover.some((h) => h > 0));
    if (fly) {
      const cruise = Math.max(MIN_FLIGHT, u.hoverTarget, ...hover);
      if (u.hoverTarget <= 0) void u.model.player.play('airIdle', { fade: 0.2 });
      await this.climbTo(u, cruise);
    }
    const running = worldPath.length > 2 && u.model.player.has(this.act(u, 'run'));
    void u.model.player.play(this.act(u, running ? 'run' : 'walk'), { fade: 0.15 });
    // A run is a dash: it leaves its wake where it set off.
    if (running) this.dash?.spawn(node.position, worldPath[0].subtract(node.position), displayHeight(u.model.height));
    for (const target of worldPath) {
      const to = new Vector3(target.x, node.position.y, target.z);
      this.setFacing(node, Math.atan2(to.x - node.position.x, to.z - node.position.z));
      const dist = Vector3.Distance(node.position, to);
      await this.tween(node, to, dist / (running ? RUN_SPEED : WALK_SPEED));
    }
    if (fly) {
      void u.model.player.play('airIdle', { fade: 0.25 });
      await this.climbTo(u, end);
    }
    if (!u.down) void u.model.player.play(this.act(u, 'idle'), { fade: 0.25 });
  }

  /**
   * Hover `height` above the tile the unit stands on (0 = on it). Called
   * after placing the unit on its tile; snaps there with the matching idle.
   */
  setHover(node: TransformNode, height: number): void {
    const u = this.units.get(node);
    if (!u) return this.fallback.setHover(node, height);
    const h = u.model.player.has('airIdle') ? height : 0;
    const changed = (h > 0) !== (u.hoverTarget > 0);
    u.hoverTarget = u.hover = h;
    if (changed && !u.down) void u.model.player.play(this.act(u, 'idle'), { fade: 0.3 });
  }

  async playAttackLunge(node: TransformNode, targetPos: Vector3, swipe = false): Promise<void> {
    const u = this.units.get(node);
    if (!u) return this.fallback.playAttackLunge(node, targetPos, swipe);
    const start = node.position.clone();
    const dir = targetPos.subtract(start);
    dir.y = 0;
    if (dir.lengthSquared() > 1e-6) {
      dir.normalize();
      this.setFacing(node, Math.atan2(dir.x, dir.z));
    }
    if (swipe && this.strikeKey(u, true) === 'swipe') {
      // A claw or a slash: the swipe — its wind-up, then straight into the
      // strike, whose first frames are the blow; the step in lands with it.
      const player = u.model.player, end = this.act(u, 'swipeEnd');
      const windUp = player.clips.get(this.act(u, 'swipeStart'))!.duration;
      void this.tween(node, start.add(dir.scale(0.45)), Math.max(0.12, windUp)).then(() => this.tween(node, start, 0.35));
      await player.play(this.act(u, 'swipeStart'), { fade: 0.12 });
      void player.play(end, { fade: 0 }).then(() => {
        if (!u.down && player.active?.action === end) void player.play(this.act(u, 'idle'), { fade: 0.25 });
      });
      await sleep(SWIPE_HIT);
      return;
    }
    const hitAt = this.oneShot(u, this.act(u, 'attack'), HIT_AT, HIT_CAP);
    // A short step in and back, alongside the clip's own swing.
    void this.tween(node, start.add(dir.scale(0.45)), 0.18).then(() => this.tween(node, start, 0.3));
    // No wake rings at contact (user): a lunge is just the step in and back.
    await sleep(hitAt);
  }

  async playCast(node: TransformNode, targetPos: Vector3, kind: CastKind): Promise<void> {
    const u = this.units.get(node);
    if (!u) return this.fallback.playCast(node, targetPos, kind);
    const d = targetPos.subtract(node.position);
    if (Math.abs(d.x) + Math.abs(d.z) > 1e-3) this.setFacing(node, Math.atan2(d.x, d.z));
    await sleep(this.oneShot(u, this.act(u, kind), 0.5, 0.8));
  }

  async playHitReact(node: TransformNode, flash?: [number, number, number]): Promise<void> {
    // The flash is drawn after tone mapping, so it is exactly the HP bar's colour.
    if (flash && this.fx?.has(node)) this.fx.flash(node, flash, { peak: FLASH_PEAK, hold: FLASH_HOLD, fade: FLASH_FADE });
    else if (flash) return this.fallback.playHitReact(node, flash);
    const u = this.units.get(node);
    if (!u) return this.fallback.playHitReact(node);
    await sleep(this.oneShot(u, this.act(u, 'damage'), 0.6, 0.45));
  }

  playClaw(node: TransformNode, target: TransformNode | null, spec: ClawSpec): Promise<void> {
    const u = this.units.get(node);
    if (!this.slashes || !u) return this.fallback.playClaw();
    // Cut the way the striking hand swung: the left hand's from upper left to
    // lower right (seen from behind), the right hand's the other way; hands
    // alternate when the strike is not a hand's.
    // Measured on the swipe, where it has one (the motion a claw or a slash plays).
    const key = this.strikeKey(u, true);
    const limb = this.strikePartOf(u, key);
    // A species with a blade of its own cuts with it (Absol: its horn, on its head).
    const part = this.bladeOf(node)?.bone ?? (limb && this.skinOn(u, limb) >= MIN_PART_VERTS ? limb : '');
    const side = part.startsWith('left') ? -1 : part.startsWith('right') ? 1 : -(this.lastClaw.get(node) ?? 1);
    this.lastClaw.set(node, side);
    // With no limb leading, the slash follows what does strike (its region's swing).
    const swing = part ? this.swingOf(node, u, part, key) : this.regionSwing(node, u, key);
    return this.slashes.claw({
      element: this.hueOf(node, spec.element),
      height: displayHeight(u.model.height),
      marks: spec.marks,
      swing,
      side,
      feet: () => node.position,
      facing: () => node.rotation.y,
      target: target ? () => ({ at: target.position, height: this.heightOf(target) }) : undefined,
    });
  }

  /** How many vertices are skinned mostly to `part` (and the bones below it). */
  private skinOn(u: Unit, part: string): number {
    const key = `skin:${part}`;
    if (!u.skinCounts.has(key)) {
      const bones = new Set(partBones(u.model.skeleton, part).map((b) => b.getIndex()));
      let n = 0;
      for (const m of u.model.meshes) {
        const idx = m.getVerticesData('matricesIndices'), w = m.getVerticesData('matricesWeights');
        if (!idx || !w) continue;
        for (let v = 0; v < idx.length / 4; v++) {
          let wt = 0;
          for (let k = 0; k < 4; k++) if (bones.has(idx[v * 4 + k])) wt += w[v * 4 + k];
          if (wt >= 0.5) n++;
        }
      }
      u.skinCounts.set(key, n);
    }
    return u.skinCounts.get(key)!;
  }

  /**
   * What strikes in `action` when no limb leads it, to the vertex
   * (strikeRegion.ts) — worked out once per unit and clip; null if nothing
   * moves enough.
   */
  private strikeRegionOf(u: Unit, key: StrikeClip['key']): StrikeRegion | null {
    if (!u.strikeRegions.has(key)) {
      const clip = this.strikeClip(u, key);
      const peeker: Peeker = { peek: (_action, t, fn) => clip!.peek(t, fn) };
      u.strikeRegions.set(key, clip
        ? findStrikeRegion(u.model.meshes, u.model.skeleton, peeker, key, clip.hit, SWING_BEFORE, SWING_AFTER, u.model.height,
          key === 'swipe' ? 'chest' : 'hips')
        : null);
    }
    return u.strikeRegions.get(key) ?? null;
  }

  /**
   * The limb that leads `key`'s strike, worked out once per unit. An attack:
   * the part that drives furthest forward (findStrikePart). A swipe is an
   * arm's sweep across: both arms swing hard in it, one out to strike and
   * the other drawn back against it, so the striking hand is the one out in
   * front at the blow (Garchomp, Charizard, Gengar, Absol: the left —
   * EFFECTS.md's Charizard swipe is its left hand too), if it is moving. (A
   * head or its fins turning along with the sweep can outpace a hand at
   * their tips, so whole vertices are no guide here.) None for a species
   * with no hands to sweep with.
   */
  private strikePartOf(u: Unit, key: StrikeClip['key']): string | null {
    if (!u.strikeParts.has(key)) u.strikeParts.set(key, key === 'swipe' ? this.sweepingHand(u) : findStrikePart(u.model, this.strikeClip(u, key)));
    return u.strikeParts.get(key) ?? null;
  }

  /** The hand out in front at the swipe's blow (against the hips), if it is sweeping; null if none. */
  private sweepingHand(u: Unit): string | null {
    const clip = this.strikeClip(u, 'swipe'), sk = u.model.skeleton;
    const chest = sk.bones.find((b) => /^(hips|waist|spine_01)$/i.test(b.name)) ?? chestOf(sk);
    const hands = (['left_hand', 'right_hand'] as const)
      .map((part) => ({ part, bone: partMeasureBone(sk, part) }))
      .filter((h): h is { part: 'left_hand' | 'right_hand'; bone: Bone } => !!h.bone && this.skinOn(u, h.part) >= MIN_PART_VERTS);
    if (!clip || !chest || !hands.length) return null;
    const at = (t: number) => {
      let out: Vector3[] = [];
      clip.peek(t, () => {
        sk.computeAbsoluteMatrices(true);
        const inv = chest.getAbsoluteMatrix().clone().invert();
        out = hands.map((h) => h.bone.getAbsoluteMatrix().multiply(inv).getTranslation());
      });
      return out;
    };
    // How fast each sweeps round the blow, and how far forward it is at it.
    const peak = hands.map(() => 0);
    let prev = at(clip.hit - SWEEP_AROUND - SWEEP_STEP);
    for (let t = clip.hit - SWEEP_AROUND; t <= clip.hit + SWEEP_AROUND + 1e-6; t += SWEEP_STEP) {
      const cur = at(t);
      cur.forEach((p, i) => { peak[i] = Math.max(peak[i], Vector3.Distance(p, prev[i]) / SWEEP_STEP); });
      prev = cur;
    }
    const ahead = at(clip.hit).map((p) => p.z);
    sk.prepare(true); // its live pose again
    const best = ahead.indexOf(Math.max(...ahead));
    return peak[best] >= SWEEP_MIN * u.model.height ? hands[best].part : null;
  }

  /** Which strike a unit plays: its swipe for a claw or a slash, where it has one (and its species claws with it); else its attack. */
  private strikeKey(u: Unit, swipe: boolean): StrikeClip['key'] {
    return swipe && !CLAW_ON_ATTACK.has(u.species) && this.strikeClip(u, 'swipe') ? 'swipe' : 'attack';
  }

  /** The motion a strike is measured on (null if the unit has no such clip). */
  private strikeClip(u: Unit, key: StrikeClip['key']): StrikeClip | null {
    const player = u.model.player;
    if (!player.peek) return null;
    if (key === 'attack') {
      const action = this.act(u, 'attack'), clip = player.clips.get(action);
      return clip ? { key, duration: clip.duration, hit: Math.min(HIT_CAP, clip.duration * HIT_AT), peek: (t, fn) => player.peek(action, Math.max(0, Math.min(clip.duration, t)), fn) } : null;
    }
    const a = this.act(u, 'swipeStart'), b = this.act(u, 'swipeEnd');
    const ca = player.clips.get(a), cb = player.clips.get(b);
    if (!ca || !cb) return null;
    return {
      key, duration: ca.duration + cb.duration, hit: ca.duration + SWIPE_HIT,
      peek: (t, fn) => (t < ca.duration ? player.peek(a, Math.max(0, t), fn) : player.peek(b, Math.min(cb.duration, t - ca.duration), fn)),
    };
  }

  /** The swing of what strikes in `key`'s clip (its region's motion), in `node`'s front: x right, y up. */
  private regionSwing(node: TransformNode, u: Unit, key: StrikeClip['key'] = 'attack'): [number, number] | null {
    const r = this.strikeRegionOf(u, key);
    if (!r) return null;
    // The model's own frame to the world's, then onto the unit's right and up.
    const v = Vector3.TransformNormal(r.swing, u.model.meshes[0].getWorldMatrix());
    const yaw = node.rotation.y;
    const x = v.x * Math.cos(yaw) - v.z * Math.sin(yaw), y = v.y;
    return Math.hypot(x, y) > 1e-4 ? [x, y] : null;
  }

  /** The blade `node`'s species cuts with, if it has one of its own (bodyParts.BLADES), with its vertex region. */
  private bladeOf(node: TransformNode): { bone: string; region: { key: string; flags: Map<AbstractMesh, Float32Array> } } | null {
    const u = this.units.get(node);
    const def = BLADES[(node.metadata as { species?: string } | null)?.species ?? ''];
    if (!u || !def) return null;
    if (!u.blade) u.blade = { key: `blade:${def.bone}:${JSON.stringify(def.boxes ?? null)}:${!!def.island}`, flags: regionFlags(u.model.meshes, u.model.skeleton, def, u.model.height) };
    return { bone: def.bone, region: u.blade };
  }

  /**
   * Which way `part` is moving as the attack clip's blow lands (looked ahead
   * through the clip, SWING_BEFORE s before the hit to SWING_AFTER after), in
   * the unit's front: x along its right, y up. Null if it hardly moves there.
   */
  private swingOf(node: TransformNode, u: Unit, part: string, key: StrikeClip['key'] = 'attack'): [number, number] | null {
    const sk = u.model.skeleton, mesh = u.model.meshes[0];
    const clip = this.strikeClip(u, key);
    const bone = partMeasureBone(sk, part);
    if (!clip || !bone) return null;
    const hit = clip.hit;
    const at = (time: number) => {
      const out = new Vector3();
      clip.peek(Math.max(0, Math.min(clip.duration, time)), () => {
        sk.computeAbsoluteMatrices(true);
        bone.getAbsolutePositionToRef(mesh, out);
      });
      return out;
    };
    const v = at(hit + SWING_AFTER).subtract(at(hit - SWING_BEFORE));
    sk.prepare(true); // its live pose again
    const yaw = node.rotation.y;
    const x = v.x * Math.cos(yaw) - v.z * Math.sin(yaw), y = v.y;
    return Math.hypot(x, y) > 0.02 * displayHeight(u.model.height) ? [x, y] : null;
  }

  async playKnockback(node: TransformNode, to: Vector3, flash?: [number, number, number]): Promise<void> {
    const u = this.units.get(node);
    if (!u) return this.fallback.playKnockback(node, to, flash);
    if (flash && this.fx?.has(node)) this.fx.flash(node, flash, { peak: FLASH_PEAK, hold: FLASH_HOLD, fade: FLASH_FADE });
    // Flinching all the way, thrown clear of the heaving ground.
    void u.model.player.play(this.act(u, 'damage'), { fade: 0.06 });
    const h = Math.max(KNOCK_MIN_ARC, KNOCK_ARC * displayHeight(u.model.height));
    await arcTo(node, new Vector3(to.x, to.y, to.z), KNOCK_TIME, h);
    if (!u.down) void u.model.player.play(this.act(u, 'idle'), { fade: 0.3 });
  }

  playBeam(node: TransformNode, target: TransformNode | null, targetPos: Vector3, spec: BeamSpec, holdUntil?: Promise<void>,
    clash?: BeamClash): BeamPlay {
    spec = { ...spec, element: this.hueOf(node, spec.element) };
    if (!this.beams) return this.fallback.playBeam(node, target, targetPos, spec);
    const u = this.units.get(node);
    const d = targetPos.subtract(node.position);
    if (Math.abs(d.x) + Math.abs(d.z) > 1e-3) this.setFacing(node, Math.atan2(d.x, d.z));
    const height = u ? displayHeight(u.model.height) : 1.2;
    const toTarget = target ? () => target.position.add(new Vector3(0, this.heightOf(target) * 0.5, 0)) : () => targetPos;
    // In a clash it aims at the clash point — until it has won, then on into the loser.
    const aimAt = clash ? () => (clash.over?.() ? toTarget() : clash.at()) : toTarget;
    // The charge plays through the wind-up; the launch comes with the loop.
    const beam = this.beams.fire({ ...spec, height, mouth: this.mouthOf(node), target: aimAt,
      // No dust round the feet of a unit in the air.
      feet: () => (u && u.hover > 0.05 ? null : node.position),
      facing: () => node.rotation.y, targetSize: () => (target ? this.heightOf(target) : height),
      targetPoses: target ? (fn) => this.everyStruckPose(target, fn) : undefined, clash,
      // Its own body, so no part of the beam lies over it.
      bodyAhead: u ? (from, aim, radius) => {
        let best = 0;
        const v = new Vector3();
        u.skin.forEachPoint((p) => {
          p.subtractToRef(from, v);
          const along = Vector3.Dot(v, aim);
          if (along > best && v.lengthSquared() - along * along < radius * radius) best = along;
        });
        return best;
      } : undefined });
    let endContact = () => {};
    const contactEnds = new Promise<void>((r) => { endContact = r; });
    const done = (async () => {
      const player = u?.model.player;
      const chain = !!player && ['beamStart', 'beamLoop', 'beamEnd'].every((a) => player.has(this.act(u!, a)));
      if (u && player && chain) {
        // The wind-up draws nothing (the jaw is shut); the channel opens with the loop.
        await player.play(this.act(u, 'beamStart'), { fade: 0.12 });
        void player.play(this.act(u, 'beamLoop'), { fade: 0.06 });
      } else if (u) {
        await sleep(this.oneShot(u, this.act(u, 'ranged'), 0.5, 0.8));
      }
      beam.open();
      await beam.front;
      // It pours a beat past the hit — or for as long as it is held.
      await (holdUntil ?? sleep(BEAM_HOLD));
      let endDur = 0.6;
      if (u && player && chain) {
        const end = this.act(u, 'beamEnd');
        endDur = player.clips.get(end)?.duration ?? endDur;
        void player.play(end, { fade: 0.08 }).then(() => {
          if (!u.down && player.active?.action === end) void player.play(this.act(u, 'idle'), { fade: 0.25 });
        });
      }
      endContact();
      await beam.release(endDur);
    })();
    return { hit: beam.front, contactEnds, done, origin: () => beam.origin() };
  }

  /**
   * A ball attack: the ball charges at the mouth as a beam's does, through
   * the beam wind-up clip (else the ranged clip's), flies at the release and
   * bursts on the target.
   */
  playBall(node: TransformNode, target: TransformNode | null, targetPos: Vector3, spec: BallSpec): BeamPlay {
    spec = { ...spec, element: this.hueOf(node, spec.element) };
    if (!this.beams) return this.fallback.playBall(node, target, targetPos, spec);
    const u = this.units.get(node);
    const d = targetPos.subtract(node.position);
    if (Math.abs(d.x) + Math.abs(d.z) > 1e-3) this.setFacing(node, Math.atan2(d.x, d.z));
    const height = u ? displayHeight(u.model.height) : 1.2;
    const aimAt = target ? () => target.position.add(new Vector3(0, this.heightOf(target) * 0.5, 0)) : () => targetPos;
    const ball = throwBall(this.beams, { element: spec.element, colours: spec.colours, height, from: this.mouthOf(node), target: aimAt,
      targetSize: () => (target ? this.heightOf(target) : height),
      // No wind spiral round the feet of a unit in the air.
      feet: () => (u && u.hover > 0.05 ? null : node.position),
      overlay: this.fx ? (mesh, mat) => this.fx!.addOverlay(mesh, mat) : undefined });
    const done = (async () => {
      const player = u?.model.player;
      const chain = !!player && ['beamStart', 'beamEnd'].every((a) => player.has(this.act(u!, a)));
      if (u && player && chain) {
        // Charged as a beam is, through the wind-up (held at its end until the
        // ball has had BALL_CHARGE to build); let fly with the release.
        const t0 = performance.now();
        await player.play(this.act(u, 'beamStart'), { fade: 0.12 });
        await sleep(Math.max(0, BALL_CHARGE - (performance.now() - t0) / 1000));
        const end = this.act(u, 'beamEnd');
        void player.play(end, { fade: 0.08 }).then(() => {
          if (!u.down && player.active?.action === end) void player.play(this.act(u, 'idle'), { fade: 0.25 });
        });
      } else {
        await sleep(u ? this.oneShot(u, this.act(u, 'ranged'), 0.5, 0.8) : 0.4);
      }
      ball.launch();
      await ball.done;
    })();
    return { hit: ball.hit, contactEnds: ball.hit, done };
  }

  playPulse(node: TransformNode, target: TransformNode | null, targetPos: Vector3, spec: PulseSpec): BeamPlay {
    spec = { ...spec, element: this.hueOf(node, spec.element) };
    if (!this.pulses) return this.fallback.playPulse(node, target, targetPos, spec);
    const u = this.units.get(node);
    const d = targetPos.subtract(node.position);
    if (Math.abs(d.x) + Math.abs(d.z) > 1e-3) this.setFacing(node, Math.atan2(d.x, d.z));
    const height = u ? displayHeight(u.model.height) : 1.2;
    const aimAt = target ? () => target.position.add(new Vector3(0, this.heightOf(target) * 0.5, 0)) : () => targetPos;
    const pulse = this.pulses.fire({ ...spec, height, mouth: this.mouthOf(node), target: aimAt, facing: () => node.rotation.y });
    const done = (async () => {
      const player = u?.model.player;
      const chain = !!player && ['beamStart', 'beamLoop', 'beamEnd'].every((a) => player.has(this.act(u!, a)));
      // The same body as a beam: wind up, hold the pose while it pulses, let go.
      if (u && player && chain) {
        await player.play(this.act(u, 'beamStart'), { fade: 0.12 });
        void player.play(this.act(u, 'beamLoop'), { fade: 0.06 });
      } else if (u) {
        await sleep(this.oneShot(u, this.act(u, 'ranged'), 0.5, 0.8));
      }
      pulse.open();
      await pulse.last;
      if (u && player && chain) {
        const end = this.act(u, 'beamEnd');
        void player.play(end, { fade: 0.08 }).then(() => {
          if (!u.down && player.active?.action === end) void player.play(this.act(u, 'idle'), { fade: 0.25 });
        });
      }
      await pulse.done;
    })();
    return { hit: pulse.front, contactEnds: pulse.last, done };
  }

  playWind(node: TransformNode, target: TransformNode | null, targetPos: Vector3, spec: WindSpec): BeamPlay {
    spec = { ...spec, element: this.hueOf(node, spec.element) };
    if (!this.wind) return this.fallback.playWind(node, target, targetPos, spec);
    const u = this.units.get(node);
    const d = targetPos.subtract(node.position);
    if (Math.abs(d.x) + Math.abs(d.z) > 1e-3) this.setFacing(node, Math.atan2(d.x, d.z));
    const size = u ? displayHeight(u.model.height) : 1.2;
    const where = target ? () => target.position.clone() : () => targetPos.clone();
    // The body: the ranged pose as it lets fly.
    const release = u ? sleep(this.oneShot(u, this.act(u, 'ranged'), 0.5, 0.8)) : Promise.resolve();
    let resolveHit!: () => void, resolveEnd!: () => void;
    const hit = new Promise<void>((r) => { resolveHit = r; });
    const contactEnds = new Promise<void>((r) => { resolveEnd = r; });
    const done = (async () => {
      await release;
      // Both grow up out of the ground on the target's tile, sized to the target.
      const ts = Math.max(target ? this.heightOf(target) : size, 1.2);
      const w = spec.kind === 'gust' ? this.wind!.gust(where, ts, spec.element) : this.wind!.twister(where, ts, spec.element);
      void w.hit.then(resolveHit);
      void w.contactEnds.then(resolveEnd);
      await w.done;
      resolveHit(); resolveEnd();
    })();
    return { hit, contactEnds, done };
  }

  /**
   * Every point of a unit's skin in each pose it takes while struck — as it
   * stands, through its flinch and its idle (looked ahead, not played).
   */
  private everyStruckPose(node: TransformNode, fn: (p: Vector3) => void): void {
    const u = this.units.get(node);
    if (!u) return;
    const player = u.model.player, sk = u.model.skeleton;
    const visit = () => { sk.prepare(true); u.skin.forEachPoint(fn); };
    visit();
    for (const action of [this.act(u, 'damage'), this.act(u, 'idle')]) {
      const clip = player.clips.get(action);
      if (!clip) continue;
      for (let s = 0; s <= 10; s++) player.peek(action, (clip.duration * s) / 10, visit);
    }
    sk.prepare(true); // its live pose again
  }

  /**
   * A beam clash: `a` and `b` fire beams at each other; they meet half-way
   * between their mouths, each ending in a hemisphere on its own side — the
   * two halves of one ball, each in its own beam's colours. With `holdUntil`
   * both keep pouring until it resolves.
   */
  clashBeams(a: TransformNode, b: TransformNode, specA: BeamSpec, specB: BeamSpec, holdUntil?: Promise<void>): [BeamPlay, BeamPlay] {
    const ma = this.mouthOf(a), mb = this.mouthOf(b);
    // The ball's size: the two beams' mean (as each beam sizes itself).
    const beamH = (n: TransformNode) => { const u = this.units.get(n); return u ? displayHeight(u.model.height) : 1.2; };
    const clash = { at: () => Vector3.Center(ma(), mb()), size: (beamH(a) + beamH(b)) / 2 };
    return [
      this.playBeam(a, b, b.position.clone(), specA, holdUntil, { ...clash, other: this.hueOf(b, specB.element) }),
      this.playBeam(b, a, a.position.clone(), specB, holdUntil, { ...clash, other: this.hueOf(a, specA.element) }),
    ];
  }

  /**
   * A beam clash as the battle resolved it. Both beams pour and meet half-way,
   * holding there CLASH_STANDOFF s. A tie: the ball bursts (expands and
   * disperses, as a ball attack's on contact) and both beams fade. Otherwise the
   * winner's egg swells and its noise grows heavier as it pushes the ball
   * back toward the loser (over CLASH_PUSH s, quicker the more decisive the
   * margin): its beam extends as the loser's retracts. When the loser's beam
   * is gone the winner's runs on into it and splits round it — the hit.
   */
  playClash(a: TransformNode, b: TransformNode, specA: BeamSpec, specB: BeamSpec, winner: TransformNode | null, margin: number): ClashPlay {
    const ma = this.mouthOf(a), mb = this.mouthOf(b);
    const beamH = (n: TransformNode) => { const u = this.units.get(n); return u ? displayHeight(u.model.height) : 1.2; };
    const loser = winner === a ? b : winner === b ? a : null;
    // How far the ball is pushed: until its surface meets the loser's beam
    // where it leaves the loser (its ball, kept clear of its body).
    let pa: BeamPlay | null = null, pb: BeamPlay | null = null;
    const loserRoot = () => {
      const [m, o] = loser === a ? [ma(), mb()] : [mb(), ma()];
      const root = (loser === a ? pa : pb)?.origin?.() ?? m;
      return root.add(o.subtract(m).normalize().scale(clashBallRadius((beamH(a) + beamH(b)) / 2)));
    };
    let push = 0, over = false, burst = false;
    const ease = (t: number) => t * t * (3 - 2 * t);
    const at = () => {
      const mid = Vector3.Center(ma(), mb());
      return loser && push > 0 ? Vector3.Lerp(mid, loserRoot(), ease(Math.min(1, push))) : mid;
    };
    const size = (beamH(a) + beamH(b)) / 2;
    const edge = () => Math.min(1, push / 0.35);
    let endA!: () => void, endB!: () => void;
    const holdA = new Promise<void>((r) => { endA = r; }), holdB = new Promise<void>((r) => { endB = r; });
    const clashOf = (self: TransformNode, other: TransformNode, otherSpec: BeamSpec): BeamClash => ({
      at, size, other: this.hueOf(other, otherSpec.element), otherPalette: otherSpec.palette,
      // Only the winner's clash ends (it runs on into the loser); the loser's just dies away.
      over: () => over && self === winner,
      edge: self === winner ? edge : undefined,
      burst: () => burst,
    });
    pa = this.playBeam(a, b, b.position.clone(), specA, holdA, clashOf(a, b, specB));
    pb = this.playBeam(b, a, a.position.clone(), specB, holdB, clashOf(b, a, specA));
    const playA = pa, playB = pb;
    let hitNow!: () => void;
    const hit = new Promise<void>((r) => { hitNow = r; });
    void (async () => {
      await Promise.all([playA.hit, playB.hit]);
      await sleep(CLASH_STANDOFF);
      if (!loser) {
        // Evenly matched: the ball bursts as a ball attack's does, and both beams disperse.
        burst = true;
        await sleep(0.12);
        hitNow(); endA(); endB();
        return;
      }
      const dur = CLASH_PUSH * (1 - 0.5 * Math.min(1, Math.max(0, margin)));
      await new Promise<void>((done) => {
        const obs = this.scene.onBeforeRenderObservable.add(() => {
          push += Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000) / dur;
          if (push >= 1) { push = 1; this.scene.onBeforeRenderObservable.remove(obs); done(); }
        });
      });
      // The loser's beam is gone: it lets go; the winner's runs on into it.
      over = true;
      (loser === a ? endA : endB)();
      await sleep(0.2);
      hitNow();
      await sleep(BEAM_HOLD);
      (winner === a ? endA : endB)();
    })();
    return { hit, done: Promise.all([playA.done, playB.done]).then(() => {}) };
  }

  /** Where the mouth is, from the jaw and nose bones (the head, or the top, if none). */
  private mouthOf(node: TransformNode): () => Vector3 {
    const u = this.units.get(node);
    if (!u) {
      const h = this.heightOf(node);
      return () => node.position.add(new Vector3(0, h * 0.8, 0));
    }
    const bones = u.model.skeleton.bones;
    const pick = MOUTH_BONES.map((n) => bones.find((b) => b.name === n)).filter((b) => !!b);
    const use = pick.length ? pick.slice(0, 2) : bones.filter((b) => b.name === 'head');
    const mesh = u.model.meshes[0];
    const tmp = new Vector3();
    return () => {
      const out = new Vector3();
      for (const b of use) { b!.getAbsolutePositionToRef(mesh, tmp); out.addInPlace(tmp); }
      return use.length ? out.scaleInPlace(1 / use.length) : node.position.add(new Vector3(0, displayHeight(u.model.height) * 0.8, 0));
    };
  }

  private heightOf(node: TransformNode): number {
    const u = this.units.get(node);
    return u ? displayHeight(u.model.height) : 1.0;
  }

  faceEachOther(a: TransformNode, b: TransformNode): void {
    for (const [x, y] of [[a, b], [b, a]]) {
      const u = this.units.get(x);
      if (u) u.lookAt = y;
    }
    // Fallback (primitive) units turn through the primitive factory.
    if (!this.units.has(a) || !this.units.has(b)) this.fallback.faceEachOther(a, b);
  }

  holdHitReact(node: TransformNode, until: Promise<void>): void {
    const u = this.units.get(node);
    if (!u) return this.fallback.holdHitReact(node, until);
    let held = true;
    void until.then(() => { held = false; });
    void (async () => {
      const player = u.model.player;
      while (held && !u.down) {
        const clip = this.act(u, 'damage');
        if (!player.has(clip)) break;
        await player.play(clip, { fade: 0.08 });
      }
      if (!u.down) void player.play(this.act(u, 'idle'), { fade: 0.25 });
    })();
  }

  /** The colours `node`'s move of `element` wears (Mega Charizard X's Fire is blue: auraPalette.elementFor). */
  hueOf(node: TransformNode, element: string): string {
    return elementFor(element, node.metadata?.species);
  }

  aura(node: TransformNode, options: AuraOptions): AuraHandle {
    options = { ...options, element: this.hueOf(node, options.element) };
    // A slash or claw from a species with a blade of its own: only the blade is coated.
    const blade = options.blade ? this.bladeOf(node) : null;
    if (blade) options = { ...options, strike: false, focus: blade.bone, region: blade.region };
    // A strike: the aura coats only the body part that leads it (a punching
    // hand, a kicking foot, a biting head…), whatever the clip.
    const su = options.strike ? this.units.get(node) : undefined;
    if (su && options.strike) {
      // A claw or a slash ('swipe') is measured on the swipe where it has one.
      const action = this.strikeKey(su, options.strike === 'swipe');
      const part = this.strikePartOf(su, action);
      // A part with hardly any skin of its own (Scyther's hand bone: its scythe
      // is skinned to the forearm) would show nothing: then what strikes, to the vertex.
      if (part && this.skinOn(su, part) >= MIN_PART_VERTS) options = { ...options, focus: part };
      else {
        // No limb leads it: whatever does strike, to the vertex (a horn, a
        // scythe, a fist with no hand bone) — never the whole body.
        const region = this.strikeRegionOf(su, action);
        if (region) options = { ...options, focus: su.model.skeleton.bones.find((b) => !b.getParent())!.name, region: { key: `strike:${action}`, flags: region.flags } };
      }
    }
    const handle = this.fx?.has(node) ? this.fx.aura(node, options) : this.fallback.aura(node, options);
    // Electricity reads as such only with strokes earthing off the body
    // (EFFECTS.md Part 2 §4): an Electric aura, or any aura on an Electric type.
    const u = this.units.get(node);
    const electric = options.element === 'Electric' || !!u?.types.includes('Electric');
    if (!this.lightning || !u || !electric) return handle;
    const t0 = performance.now(), ignite = options.ignite ?? 0.5;
    // A charge (Volt Tackle) is a body clad in electricity: more strokes,
    // thicker, and never in the flicker's dead air.
    const charge = options.element === 'Electric' && options.edge === 'tongues';
    const earth = this.earthing(node, {
      power: () => Math.min(1, (performance.now() - t0) / 1000 / ignite) * (options.element === 'Electric' ? 1 : 0.7),
      bolts: charge ? 9 : options.element === 'Electric' ? 6 : 4,
      thick: charge ? 1.3 : 1,
      steady: charge,
    });
    return {
      lit: handle.lit,
      release: () => { earth?.stop(); return handle.release(); },
    };
  }

  /** Earthing strokes off a unit's body, until stopped. */
  private earthing(node: TransformNode, o: EarthOptions): { stop(): void } | null {
    const u = this.units.get(node);
    if (!this.lightning || !u) return null;
    const h = displayHeight(u.model.height);
    const mouth = this.mouthOf(node);
    const head = u.model.skeleton.bones.find((b) => b.name === 'head');
    const headAt = new Vector3();
    return this.lightning.earth({
      count: u.skin.count(),
      pointAt: (i, out) => u.skin.pointAt(i, out),
      root: () => node.position,
      height: h,
      ground: () => node.position.y,
      // Not from the front of the face: near the snout, or on the head's
      // front half (ahead of the head bone along the way it faces).
      avoid: (p) => {
        // Every emitter, whatever its rig: a model with no 'head' bone judges the
        // face from the snout instead (a little further back, as the snout is
        // the front of the face).
        const m = mouth();
        if (Vector3.Distance(p, m) < 0.3 * h) return true;
        const face = new Vector3(Math.sin(node.rotation.y), 0, Math.cos(node.rotation.y));
        if (head) head.getAbsolutePositionToRef(u.model.meshes[0], headAt);
        const d = p.subtract(head ? headAt : m);
        return d.length() < 0.45 * h && Vector3.Dot(d, face) > (head ? -0.02 : -0.15) * h;
      },
    }, o);
  }

  playLightning(node: TransformNode, target: TransformNode | null, targetPos: Vector3, spec: LightningSpec): BeamPlay {
    if (!this.lightning) return this.fallback.playLightning(node, target, targetPos, spec);
    const L = this.lightning;
    const u = this.units.get(node);
    const d = targetPos.subtract(node.position);
    if (Math.abs(d.x) + Math.abs(d.z) > 1e-3) this.setFacing(node, Math.atan2(d.x, d.z));
    const mouth = this.mouthOf(node);
    const chest = () => node.position.add(new Vector3(0, this.heightOf(node) * 0.5, 0));
    const from = () => Vector3.Lerp(mouth(), chest(), 0.35);
    const mid = target ? () => target.position.add(new Vector3(0, this.heightOf(target) * 0.5, 0)) : () => targetPos;
    const feet = target ? () => target.position : () => targetPos;
    // The body: the ranged pose; the lightning leaves at its release.
    const release = u ? this.oneShot(u, this.act(u, 'ranged'), 0.5, 0.8) : 0;
    const W = 0.012 * TILE_SCALE; // a hairline-and-a-bit; thick bolts are multiples
    const play = (() => {
      switch (spec.kind) {
        case 'thunder': // One very thick column out of the sky; it runs out over the tiles round the target.
          return L.thunder(feet, { width: W * 72, hold: 1.0, ring: HEX_SIZE * Math.sqrt(3), delay: release });
        case 'discharge': { // It earths into the tiles round itself and bolts the target.
          // Reaching out to the neighbouring tiles' middles, whatever its size.
          const reach = (HEX_SIZE * Math.sqrt(3) * 0.85) / this.heightOf(node);
          const burst = this.earthing(node, { power: () => 1, bolts: 12, thick: 1.6, spread: reach, steady: true });
          const p = L.bolt(from, mid, { width: W * 3.8, strands: 2, forks: 3, hold: 1.0, delay: release });
          void p.contactEnds.then(() => burst?.stop());
          return p;
        }
        case 'spark': // Thin bolts.
          return L.bolt(from, mid, { width: W * 1.8, strands: 2, forks: 2, hold: 0.6, delay: release, light: 0.8 });
        case 'bolt':
        default: // Thunderbolt: thick.
          return L.bolt(from, mid, { width: W * 7, strands: 2, forks: 4, hold: 0.9, delay: release, light: 2.5 });
      }
    })();
    // (Struck, the target wears the filled Electric aura, which earths off its
    // body — ResolutionPlayback lights it on the hit.)
    return play;
  }

  async playFaint(node: TransformNode): Promise<void> {
    const u = this.units.get(node);
    if (!u) return this.fallback.playFaint(node);
    u.down = true;
    // A flier drops to the ground before it falls over.
    if (u.hoverTarget > 0) await this.climbTo(u, 0, 2);
    await u.model.player.play('faint', { fade: 0.15 });
    if (u.down) void u.model.player.play('down', { fade: 0.2 });
  }

  /**
   * Evolve: the Pokémon glows white, and its surface flows, vertex by vertex,
   * into the next form's shape — each part into its counterpart, while the
   * parts the new form adds unfold out of the old body — until the new form
   * stands there, and the white fades off it. Resolves with the new form's
   * node; the old one is gone. (See evolution.ts.)
   */
  async evolve(node: TransformNode, species: SpeciesDefinition): Promise<TransformNode> {
    const ua = this.units.get(node);
    if (!ua) return node;
    const playerId = (node.metadata as { playerId?: number } | null)?.playerId ?? 1;
    const next = await this.createPokemon(species, playerId);
    const ub = this.units.get(next);
    if (!ub) { next.dispose(); return node; }
    // The new form waits, hidden, where the old one stands.
    next.setEnabled(false);
    this.fx?.unregister(next);
    next.position.copyFrom(node.position);
    this.setFacing(next, node.rotation.y);
    // Evolving in the air: the next form (if it flies) waits at the same height
    // in its in-air battle wait, so the morph ends in that pose.
    ub.hoverTarget = ub.hover = ub.model.player.has('airIdle') ? ua.hoverTarget : 0;
    void ub.model.player.play(this.act(ub, 'idle'), { fade: 0 });
    ub.lookAt = ua.lookAt;
    const smooth = (x: number) => x * x * (3 - 2 * x);

    // 1. Both surfaces as they stand, and where each vertex goes (worked out
    // before anything shows: it takes a moment).
    const skA = ua.model.skeleton, skB = ub.model.skeleton;
    skA.prepare(true);
    next.computeWorldMatrix(true);
    skB.prepare(true);
    const sA = snapshotModel(ua.model.meshes, skA), sB = snapshotModel(ub.model.meshes, skB);
    const bA = bonePositions(skA, ua.model.meshes[0]), bB = bonePositions(skB, ub.model.meshes[0]);
    const dA = node.scaling.x * ua.model.height, dB = next.scaling.x * ub.model.height;
    const cell = Math.max(dA, dB) / 30;
    // Each vertex's partner on the other form (vertex indices).
    const aTo = pairOnto(sA, skA, bA, sB, skB, bB, matchBones(skA, skB), dB / dA, cell);
    const bFrom = pairOnto(sB, skB, bB, sA, skA, bA, matchBones(skB, skA), dA / dB, cell);
    // Both keep playing their battle-wait animation throughout: their surfaces
    // are re-skinned every frame and the morph blends between them.
    const liveA = new LiveSkin(ua.model.meshes, skA), liveB = new LiveSkin(ub.model.meshes, skB);
    const posA = new Float32Array(liveA.count * 3), posB = new Float32Array(liveB.count * 3);
    // Each surface keeps its feet on the ground as it morphs — if its form has
    // feet and stands on the ground (one in the air is left in the air).
    const none = new Int32Array(0);
    const feetA = ua.hover > 0.01 ? none : footVertices(ua.model.meshes, skA);
    const feetB = ub.hover > 0.01 ? none : footVertices(ub.model.meshes, skB);
    const ground = node.position.y;

    // 2. The model glows white.
    await this.over(EVOLVE_GLOW, (k) => this.fx?.setWhite(node, k));

    // 3. The two surfaces, glowing white, flow: the old onto the new shape,
    // the new out of the old one.
    const holder = new TransformNode('evolving', this.scene);
    const mat = new StandardMaterial('evolvingMat', this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = Color3.White();
    mat.backFaceCulling = false;
    // Each surface is one connected mesh the whole way (nothing ever comes
    // apart from the body).
    const surface = (name: string, s: { pos: Float32Array; idx: Uint32Array }) => {
      const m = new Mesh(name, this.scene);
      const vd = new VertexData();
      vd.positions = Array.from(s.pos);
      vd.indices = Array.from(s.idx);
      vd.applyToMesh(m, true);
      m.material = mat;
      m.parent = holder;
      m.isPickable = false;
      return m;
    };
    const mA = surface('evolvingFrom', sA), mB = surface('evolvingTo', sB);
    // Where each surface heads (its partners on the other), smoothed over it.
    const gA = buildGraph(sA), gB = buildGraph(sB);
    const scrA = smoothScratch(gA), scrB = smoothScratch(gB);
    const destA = new Float32Array(sA.pos.length), fromB = new Float32Array(sB.pos.length);
    node.setEnabled(false);
    if (this.fx) {
      this.fx.unregister(node);
      this.fx.register(holder, [mA, mB], null);
      this.fx.setWhite(holder, 1);
    }
    const pa = new Float32Array(sA.pos.length), pb = new Float32Array(sB.pos.length);
    await this.over(EVOLVE_MORPH, (x) => {
      const e = smooth(x);
      liveA.update(posA);
      liveB.update(posB);
      // The old surface heads for its partners on the new one's live pose, the
      // new surface comes out of its partners on the old one's — each
      // destination smoothed over its surface, so both stay whole: the new
      // one starts tucked just inside the old body and unfolds out of it, the
      // old one ends tucked just inside the new body.
      for (let i = 0; i < aTo.length; i++) destA.set(posB.subarray(aTo[i] * 3, aTo[i] * 3 + 3), i * 3);
      for (let j = 0; j < bFrom.length; j++) fromB.set(posA.subarray(bFrom[j] * 3, bFrom[j] * 3 + 3), j * 3);
      smoothOver(destA, gA, SMOOTH_STEPS, 0.6, scrA);
      smoothOver(fromB, gB, SMOOTH_STEPS, 0.6, scrB);
      for (let i = 0; i < pa.length; i++) pa[i] = posA[i] + (destA[i] - posA[i]) * e;
      for (let i = 0; i < pb.length; i++) pb[i] = fromB[i] + (posB[i] - fromB[i]) * e;
      plant(pa, feetA, ground);
      plant(pb, feetB, ground);
      mA.updateVerticesData(VertexBuffer.PositionKind, pa);
      mB.updateVerticesData(VertexBuffer.PositionKind, pb);
      mA.refreshBoundingInfo();
      mB.refreshBoundingInfo();
    });

    // 4. It has the new form's shape: the new form, still white, takes over.
    if (this.fx) {
      this.fx.unregister(holder);
      this.fx.register(next, ub.model.meshes, ub.model.skeleton, ub.model.props.map((p) => p.mesh));
      this.fx.setWhite(next, 1);
    }
    next.setEnabled(true);
    holder.dispose(false, true);
    if (ua.lookAt) { const uo = this.units.get(ua.lookAt); if (uo?.lookAt === node) uo.lookAt = next; }
    if (ua.upkeep) this.scene.onBeforeRenderObservable.remove(ua.upkeep);
    this.units.delete(node);
    ua.model.dispose();

    // 5. The white fades off it.
    await this.over(EVOLVE_GLOW, (k) => this.fx?.setWhite(next, 1 - k));
    this.fx?.setWhite(next, 0);
    return next;
  }

  /** Take a Pokémon off the field for good: its upkeep, its effects slot, its model. */
  remove(node: TransformNode): void {
    const u = this.units.get(node);
    this.fx?.unregister(node);
    if (!u) { node.dispose(); return; }
    if (u.upkeep) this.scene.onBeforeRenderObservable.remove(u.upkeep);
    this.units.delete(node);
    u.model.dispose();
  }

  /** Run fn(t) every frame for `seconds`, t going 0..1 on the render clock. */
  private over(seconds: number, fn: (t: number) => void): Promise<void> {
    return new Promise((resolve) => {
      let t = 0;
      fn(0);
      const obs = this.scene.onBeforeRenderObservable.add(() => {
        // (A long frame — work done in it — advances it by at most a normal frame's step.)
        t = Math.min(1, t + Math.min(0.05, this.scene.getEngine().getDeltaTime() / 1000) / seconds);
        fn(t);
        if (t >= 1) { this.scene.onBeforeRenderObservable.remove(obs); resolve(); }
      });
    });
  }

  lieDown(node: TransformNode): void {
    const u = this.units.get(node);
    if (!u) return this.fallback.lieDown(node);
    if (u.down) return;
    u.down = true;
    u.hoverTarget = u.hover = 0;
    void u.model.player.play('down', { fade: 0.3 });
  }

  isDown(node: TransformNode): boolean {
    const u = this.units.get(node);
    return u ? u.down : this.fallback.isDown(node);
  }

  revive(node: TransformNode): void {
    const u = this.units.get(node);
    if (!u) return this.fallback.revive(node);
    u.down = false;
    void u.model.player.play(this.act(u, 'idle'), { fade: 0.3 });
  }

  setFacing(node: TransformNode, dir: number): void {
    node.rotation.y = dir;
    const meta = node.metadata as { facing?: number } | null;
    if (meta) meta.facing = dir;
  }

  // ── helpers ────────────────────────────────

  /**
   * Play a one-shot clip, return to the battle idle when it ends (unless
   * something else has started meanwhile, or the unit is down), and return
   * how many seconds in its key moment falls: `fraction` of the clip, at most
   * `cap` seconds — so the battle can land the hit without waiting for the
   * whole follow-through.
   */
  private oneShot(u: Unit, action: string, fraction: number, cap: number): number {
    const player = u.model.player;
    if (!player.has(action)) return 0;
    void player.play(action, { fade: 0.12 }).then(() => {
      if (!u.down && player.active && player.active.action === action) void player.play(this.act(u, 'idle'), { fade: 0.25 });
    });
    const dur = player.clips.get(action)?.duration ?? 0.6;
    return Math.min(cap, dur * fraction);
  }

  /** The clip for `action` in the unit's current state: its air twin while it hovers. */
  private act(u: Unit, action: string): string {
    return u.hoverTarget > 0 && u.model.player.has(airName(action)) ? airName(action) : action;
  }

  /** Set the hover height and resolve once the unit has climbed or sunk to it. */
  private climbTo(u: Unit, height: number, speed = 1): Promise<void> {
    u.hoverTarget = height;
    return sleep(Math.abs(height - u.hover) / (CLIMB_SPEED * speed) + 0.05);
  }

  /**
   * Every frame: ease the hover toward its target, and keep the skin out of
   * the floor. Some clips carry the body lower than the rest pose the feet
   * were placed by (a crouch, a lunge, a fall), so the lowest skinned point is
   * measured and the body lifted by whatever has sunk below the tile.
   */
  private updateHeight(root: TransformNode, u: Unit): void {
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
    // Keep facing the opponent (not while walking: then it faces its path).
    if (u.lookAt && !u.moving && !u.down) {
      const d = u.lookAt.position.subtract(root.position);
      if (Math.abs(d.x) + Math.abs(d.z) > 1e-3) {
        const want = Math.atan2(d.x, d.z);
        let diff = want - root.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // the short way round
        const turn = Math.sign(diff) * Math.min(Math.abs(diff), TURN_SPEED * dt);
        this.setFacing(root, root.rotation.y + turn);
      }
    }
    const step = CLIMB_SPEED * dt * (u.down ? 2 : 1);
    const d = u.hoverTarget - u.hover;
    u.hover += Math.abs(d) <= step ? d : Math.sign(d) * step;
    if (u.hover > 0.01) {
      u.clamp = 0;
    } else if (u.feet && !u.down) {
      // On its feet: the lowest point of its feet stands exactly on the tile —
      // lifted if they sink, lowered if they float (some idles hold the body
      // up off the root).
      const off = root.position.y - u.feet.lowestY();
      if (Number.isFinite(off)) u.clamp += off * Math.min(1, FEET_RATE * dt);
    } else {
      // No feet (or lying down): only kept out of the floor.
      const sink = root.position.y - CLAMP_EPS - u.skin.lowestY();
      const want = Math.max(0, u.clamp + sink);
      const rate = want > u.clamp ? CLAMP_UP : CLAMP_DOWN;
      u.clamp += (want - u.clamp) * Math.min(1, rate * dt);
    }
    u.model.setLift((u.hover + u.clamp) / (root.scaling.y || 1));
    this.fx?.setAirborne(root, u.hover > 0.05);
  }

  /** Move a node to `to` over `seconds`, eased, on the render clock. */
  private tween(node: TransformNode, to: Vector3, seconds: number): Promise<void> {
    return new Promise((resolve) => {
      const from = node.position.clone();
      if (seconds <= 0.001) { node.position.copyFrom(to); resolve(); return; }
      let t = 0;
      const obs = this.scene.onBeforeRenderObservable.add(() => {
        t = Math.min(1, t + this.scene.getEngine().getDeltaTime() / 1000 / seconds);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        Vector3.LerpToRef(from, to, e, node.position);
        if (t >= 1) { this.scene.onBeforeRenderObservable.remove(obs); resolve(); }
      });
    });
  }
}
