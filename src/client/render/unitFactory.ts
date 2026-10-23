/**
 * What the game needs from whatever builds and animates its Pokémon. Two
 * implementations: RecipeFactory (the real models, built at runtime from the
 * archive data) and PokemonFactory (stylized primitives, the fallback).
 */

import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AuraHandle, AuraOptions } from '../vfx/UnitFx.ts';
import type { BeamSpec } from '../vfx/beam/beamMoves.ts';
import type { BallSpec } from '../vfx/beam/ballMoves.ts';
import type { PulseSpec } from '../vfx/PulseFx.ts';
import type { WindSpec } from '../vfx/windMoves.ts';
import type { LightningSpec } from '../vfx/lightningMoves.ts';
import type { ClawSpec } from '../vfx/slashMoves.ts';

/**
 * A beam in progress: `hit` when its front reaches the target, `contactEnds`
 * when it lets go of it (the release starts), `done` when it has gone.
 */
export interface BeamPlay {
  hit: Promise<void>; contactEnds: Promise<void>; done: Promise<void>;
  /** Where the beam leaves the attacker, this frame (beams only). */
  origin?: () => Vector3;
  /** Where its front is, this frame (beams and balls in a clash: where they will meet). */
  front?: () => Vector3;
}
/** A beam clash: `met` as the two beams meet, `hit` when the winner's beam lands (or, a tie, as both disperse); `done` once both are gone. */
export interface ClashPlay { met: Promise<void>; hit: Promise<void>; done: Promise<void> }

import { MoveCategory, type MoveDefinition, type SpeciesDefinition } from '../../shared/index.ts';

/** A thrown unit's flight (Earthquake's knockback): how long, and how high its arc peaks (× its height, at least KNOCK_MIN_ARC). */
export const KNOCK_TIME = 0.62, KNOCK_ARC = 0.9, KNOCK_MIN_ARC = 1.1;

/** Fly `node` in an arc to `to` over `seconds`, peaking `height` above the straight line; resolves as it lands. */
export function arcTo(node: TransformNode, to: Vector3, seconds: number, height: number): Promise<void> {
  const scene = node.getScene();
  const from = node.position.clone();
  return new Promise((resolve) => {
    let t = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
      t = Math.min(1, t + Math.min(0.05, scene.getEngine().getDeltaTime() / 1000) / seconds);
      Vector3.LerpToRef(from, to, t, node.position);
      node.position.y += 4 * height * t * (1 - t);
      if (t >= 1) { scene.onBeforeRenderObservable.remove(obs); resolve(); }
    });
  });
}

/** A non-contact move's body animation: a special attack, or a status/terrain call. */
export type CastKind = 'ranged' | 'roar' | 'appeal';

export interface UnitFactory {
  /** `onProgress` gets 0..1 while the model loads (immediately 1 if nothing to load). */
  /** `shiny`: its shiny colours (and, where a shiny's flames differ, their colour in its moves). */
  createPokemon(species: SpeciesDefinition, playerId: number, onProgress?: (fraction: number) => void, opts?: { shiny?: boolean }): Promise<TransformNode>;
  /**
   * Walk the path. `hover[i]` is how high a flier hovers over waypoint i
   * (0 = on the ground; see HexBoard.hoverHeight): a flier crossing an
   * obstacle flies the leg; others ignore it.
   */
  playMoveTo(node: TransformNode, worldPath: Vector3[], hover?: number[]): Promise<void>;
  /** After placing a unit on its tile: hover `height` above it (0 = stand on it). */
  setHover(node: TransformNode, height: number): void;
  /**
   * A contact move. Resolves at the moment of impact; the swing finishes on
   * its own. `swipe`: a claw or a slash — the swipe, where it has one.
   */
  playAttackLunge(node: TransformNode, targetPos: Vector3, swipe?: boolean): Promise<void>;
  /** A physical attack as a flurry of `power`'s many blows (where the factory can); resolves on the last blow. */
  playFlurry?(node: TransformNode, targetPos: Vector3, power: number): Promise<void>;
  /**
   * A quick step into a strike (the priority moves: Quick Attack, Extreme
   * Speed, Shadow Sneak, Sucker Punch): vanish, dash to `land` as streaks
   * and afterimages, reappear as the blow lands; bursts in `element`'s
   * colours, the end one only on `contact` (a Pokémon on the target tile).
   * Resolves at the blow.
   */
  playQuickStep(node: TransformNode, targetPos: Vector3, land: Vector3, strike?: 'attack' | 'swipe', element?: string, contact?: boolean): Promise<void>;
  /**
   * Aerial Ace: a quick step stacked — through `target` (it flinches), round
   * behind it and back through it, on to `stop`, afterimages all the way, then
   * it turns back to face it. `hit` at the second blow, `done` once it faces it.
   */
  playAerialAce(node: TransformNode, target: TransformNode | null, targetPos: Vector3, stop: Vector3, element?: string, jump?: boolean): BeamPlay;
  /** A non-contact move. Resolves at the moment of release. */
  playCast(node: TransformNode, targetPos: Vector3, kind: CastKind): Promise<void>;
  /** Flinch, flashing `flash` (0..1 display RGB: the HP bar's colour) for a moment. */
  playHitReact(node: TransformNode, flash?: [number, number, number]): Promise<void>;
  /** A dodge: a quick side-step to `to` (the tile beside it), leaving an afterimage where it stood. */
  playDodge(node: TransformNode, to: Vector3): Promise<void>;
  /** Missed: it stops, holds its heading until `during` is over and a beat after, then turns (its turn clip) to look at `target`. */
  playMissLook(node: TransformNode, target: TransformNode, during: Promise<void>): Promise<void>;
  /**
   * Thrown (Earthquake): flung in an arc to `to` (where it lands, on the
   * ground), flinching, still facing the way it was; resolves as it lands.
   */
  playKnockback(node: TransformNode, to: Vector3, flash?: [number, number, number]): Promise<void>;
  /**
   * Slash marks off a blow landing now: a claw's three gashes (Dragon Claw) or
   * a blade's one longer cut (Night Slash), at what `node` struck, cut the way
   * its striking part swung; resolves when they have gone.
   */
  playClaw(node: TransformNode, target: TransformNode | null, spec: ClawSpec): Promise<void>;
  /** Fall, then stay down. */
  playFaint(node: TransformNode): Promise<void>;
  /** Put a fainted unit straight into its lying-down state, without the fall. */
  lieDown(node: TransformNode): void;
  isDown(node: TransformNode): boolean;
  revive(node: TransformNode): void;
  setFacing(node: TransformNode, dir: number): void;
  /**
   * Pour a beam from the mouth at `target` (its middle; or at `targetPos` when
   * there is no unit there): wind-up, the pour, held a beat past the hit, the
   * release. With `holdUntil`, it keeps pouring until that resolves.
   */
  playBeam(node: TransformNode, target: TransformNode | null, targetPos: Vector3, spec: BeamSpec, holdUntil?: Promise<void>): BeamPlay;
  /**
   * Send a sonar pulse (rings travelling along the gaze) at the target: `hit`
   * as the first arrives, `contactEnds` as the last does.
   */
  playPulse(node: TransformNode, target: TransformNode | null, targetPos: Vector3, spec: PulseSpec): BeamPlay;
  /** Two beams meet head-on: `winner` pushes the ball back into the other (null: a tie, both disperse). */
  playClash(a: TransformNode, b: TransformNode, specA: BeamSpec, specB: BeamSpec, winner: TransformNode | null, margin: number, standUntil?: Promise<void>): ClashPlay;
  /** A ball attack (Shadow Ball…): a sphere of the type forms at the mouth, flies, and bursts on the target. */
  playBall(node: TransformNode, target: TransformNode | null, targetPos: Vector3, spec: BallSpec): BeamPlay;
  /** Gust / Twister: a whirlwind or a tornado growing out of the ground on the target. */
  playWind(node: TransformNode, target: TransformNode | null, targetPos: Vector3, spec: WindSpec): BeamPlay;
  /** Fire Spin / Whirlpool: rings of `element` spinning up round the target's tile. `hit` once they are up, `contactEnds` as they go. */
  playSpin(node: TransformNode, targetPos: Vector3, element?: string): BeamPlay;
  /** A charge on foot into the target (Flare Blitz): bursts as it sets off and at the impact; resolves at the impact. */
  playRunInto(node: TransformNode, path: Vector3[], targetPos: Vector3, element?: string, pose?: 'run' | 'leap',
    opts?: { land?: boolean }): Promise<void>;
  /** Two ram attacks meeting head-on: both leap to the middle and the contact burst goes off there, looped, for the standoff. */
  playRamClash(a: TransformNode, b: TransformNode, typeA: string, typeB: string, hold?: number, until?: Promise<void>, at?: Vector3,
    onward?: { node: TransformNode; to: Vector3; land?: boolean }, won?: TransformNode | null): Promise<{ onward: Promise<void> }>;
  /** A stat change, momentary: rising round it in red and orange (`up`), or sinking in blue and light blue. */
  playStatChange(node: TransformNode, up: boolean): Promise<void>;
  /** Thunderbolt, Thunder, Discharge, sparks: `hit` as it strikes, `contactEnds` as it lets go. */
  playLightning(node: TransformNode, target: TransformNode | null, targetPos: Vector3, spec: LightningSpec): BeamPlay;
  /**
   * From now on `a` and `b` keep turning to face each other (except while
   * walking, when they face along the path).
   */
  faceEachOther(a: TransformNode, b: TransformNode): void;
  /**
   * Frozen solid: its body slows to a stop where it is, and a block of
   * see-through ice, fitted to its shape, grows up round it (`instant`: it is
   * already so — no animation). Resolves once it is encased.
   */
  freeze(node: TransformNode, instant?: boolean): Promise<void>;
  /** The ice shatters (or, `melt`, melts away in steam: a Fire move) and it moves again; resolves once it is gone. */
  thaw(node: TransformNode, how?: 'shatter' | 'melt'): Promise<void>;
  isFrozen(node: TransformNode): boolean;
  /** Keep the unit flinching (its hit animation, back to back) until `until` resolves. */
  holdHitReact(node: TransformNode, until: Promise<void>): void;
  /** Light an aura outline round the unit (a no-op handle where unsupported). */
  aura(node: TransformNode, options: AuraOptions): AuraHandle;
  /** How it punches: the clip it throws a punch with ('attack', or its 'swipe' where its attack is a kick), and the hand that leads it. */
  punchPlan?(node: TransformNode): { key: 'attack' | 'swipe'; part: string | null };
}

/** Which body animation a move uses: null = a contact strike (lunge + attack). */
export function castKindFor(move: MoveDefinition | undefined): CastKind | null {
  if (!move) return null;
  switch (move.category) {
    case MoveCategory.PHYSICAL: return null;
    case MoveCategory.SPECIAL: return 'ranged';
    case MoveCategory.STATUS: return move.target === 'self' ? 'appeal' : 'roar';
    case MoveCategory.TERRAIN: return 'roar';
    default: return null;
  }
}
