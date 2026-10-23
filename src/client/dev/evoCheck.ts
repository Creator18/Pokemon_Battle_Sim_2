/**
 * Dev check (not part of the game): does an evolution's morph ever show a
 * piece of either surface drifted off the piece it is set into?
 *
 * It runs the morph's own maths (RecipeFactory.evolve: the pairing, the
 * smoothing, the blend) on the two forms as they stand, frame by frame, and
 * measures every tied piece's gap past its leeway (evolution.ts, tiePieces) —
 * as the morph was, and with keepTied holding the pieces on. A piece apart
 * from the body in its own model (made to float) is not tied, so not counted.
 */
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import {
  matchBones, snapshotModel, bonePositions, pairOnto, buildGraph, smoothOver, smoothScratch, tiePieces, keepTied, tieGaps,
} from '../render/evolution.ts';

const FRAMES = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95];
const SMOOTH_STEPS = 8; // as RecipeFactory

export interface MorphCheck {
  /** Tied pieces of each form. */
  pieces: [number, number];
  /** The worst gap past its leeway of any piece in any frame (× the height): without the fix, and with it. */
  before: number;
  after: number;
  /** Frames (0..1) where some piece was off by more than VISIBLE, without the fix. */
  offFrames: number[];
}
/** A gap worth calling off the body (× the height). */
const VISIBLE = 0.004;

export function checkMorph(factory: unknown, a: TransformNode, b: TransformNode): MorphCheck {
  type U = { model: { meshes: AbstractMesh[]; skeleton: Skeleton; height: number } };
  const units = (factory as { units: Map<TransformNode, U> }).units;
  const ua = units.get(a)!, ub = units.get(b)!;
  const skA = ua.model.skeleton, skB = ub.model.skeleton;
  skA.prepare(true); b.computeWorldMatrix(true); skB.prepare(true);
  const sA = snapshotModel(ua.model.meshes, skA), sB = snapshotModel(ub.model.meshes, skB);
  const bA = bonePositions(skA, ua.model.meshes[0]), bB = bonePositions(skB, ub.model.meshes[0]);
  const dA = a.scaling.x * ua.model.height, dB = b.scaling.x * ub.model.height;
  const cell = Math.max(dA, dB) / 30;
  const aTo = pairOnto(sA, skA, bA, sB, skB, bB, matchBones(skA, skB), dB / dA, cell);
  const bFrom = pairOnto(sB, skB, bB, sA, skA, bA, matchBones(skB, skA), dA / dB, cell);
  const gA = buildGraph(sA), gB = buildGraph(sB);
  const tiesA = tiePieces(sA.pos, gA, dA), tiesB = tiePieces(sB.pos, gB, dB);
  const scrA = smoothScratch(gA), scrB = smoothScratch(gB);
  const destA = new Float32Array(sA.pos.length), fromB = new Float32Array(sB.pos.length);
  for (let i = 0; i < aTo.length; i++) destA.set(sB.pos.subarray(aTo[i] * 3, aTo[i] * 3 + 3), i * 3);
  for (let j = 0; j < bFrom.length; j++) fromB.set(sA.pos.subarray(bFrom[j] * 3, bFrom[j] * 3 + 3), j * 3);
  smoothOver(destA, gA, SMOOTH_STEPS, 0.6, scrA);
  smoothOver(fromB, gB, SMOOTH_STEPS, 0.6, scrB);
  const pa = new Float32Array(sA.pos.length), pb = new Float32Array(sB.pos.length);
  const smooth = (x: number) => x * x * (3 - 2 * x);
  let before = 0, after = 0;
  const offFrames: number[] = [];
  for (const x of FRAMES) {
    const e = smooth(x);
    for (let i = 0; i < pa.length; i++) pa[i] = sA.pos[i] + (destA[i] - sA.pos[i]) * e;
    for (let i = 0; i < pb.length; i++) pb[i] = fromB[i] + (sB.pos[i] - fromB[i]) * e;
    const worst = Math.max(0, ...tieGaps(pa, tiesA, dA), ...tieGaps(pb, tiesB, dB));
    before = Math.max(before, worst);
    if (worst > VISIBLE) offFrames.push(x);
    keepTied(pa, tiesA);
    keepTied(pb, tiesB);
    after = Math.max(after, 0, ...tieGaps(pa, tiesA, dA), ...tieGaps(pb, tiesB, dB));
  }
  return { pieces: [tiesA.length, tiesB.length], before, after, offFrames };
}
