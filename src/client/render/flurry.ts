/**
 * A flurry: a physical attack played as a run of blows — the Pokémon's own
 * two physical clips (its attack, its swipe) cut to their strikes, each
 * strike thrown a random way by the part that leads it (handAttacks'
 * throwForward: aimed, reached out), left and right in turn (the other side
 * its mirror), run fast one into the next (chainClips), kept on the spot and
 * never spun right round (steadyHeading). How strong the move is says how
 * many blows, and how fast (flurryShape). The factory plays it, leaving an
 * afterimage at each blow (RecipeFactory.playFlurry).
 */

import {
  bakeHandAttack, retarget, steadyHeading, throwForward, aimTail, tailJoints, mirrorClip, chainClips, pathOf,
  type Rig, type Retargeted, type Aim,
} from './handAttacks.ts';
import { sampleTrack } from '../recipe/tranm.js';

/** What can lead a strike (and its tail, by its tip: tailTip). */
const PARTS = ['left_hand', 'right_hand', 'left_foot', 'right_foot', 'head'];
/**
 * By what leads it: how fast (× its own, before the move's tempo), how far it
 * is reached out (its elbow, knee or neck opened: 0..1), and its aims (round
 * either way; up and down from its shoulder, hip or neck, degrees).
 */
const BY = {
  hand: { speed: 2.2, extend: 1, yaw: 40, pitch: [-30, 35] },
  foot: { speed: 1.8, extend: 1, yaw: 35, pitch: [-35, 20] },
  head: { speed: 2.0, extend: 0.5, yaw: 25, pitch: [-25, 15] },
  // (A tail's whip is its whole clip, spin and all: aimTail bends it, nothing is reached out.)
  tail: { speed: 2.0, extend: 0, yaw: 20, pitch: [-15, 20] },
} as const;
type By = keyof typeof BY;
const byOf = (part: string): By => (/hand/.test(part) ? 'hand' : /foot/.test(part) ? 'foot' : /tail/.test(part) ? 'tail' : 'head');

/** Its tail's tip: the furthest bone down its longest chain of tail bones (none if it has no tail). */
function tailTip(rig: Rig): string | null {
  const names = rig.bones.map((b) => b.name);
  let best: string | null = null, most = 0;
  names.forEach((n, i) => {
    if (!/^tail/.test(n) || names.some((m, j) => rig.parentIndex[j] === i && /^tail/.test(m))) return;
    const k = tailJoints(rig, n).length;
    if (k > most) { most = k; best = n; }
  });
  return most >= 2 ? best : null;
}
/**
 * A foot leads one only when kicked: raised this much (× its height)
 * towards its hips from where it hangs at rest — not a lunge's stride, nor a
 * pounce (the whole body up, the feet with it).
 */
const KICK_LIFT = 0.12;
/** Each strike: from this many frames before its window (no more than RUN_IN before its blow), to this many after its blow. */
const LEAD = 6, FOLLOW = 16, RUN_IN = 18;
/** Round its blow, where to look for where its part is furthest out (frames before, after). */
const LOOK_BEFORE = 10, LOOK_AFTER = 30;
/** How long each blow runs into the next (s). */
const BLEND = 0.05;
/** What carries the body: its travel taken out (its height's bob kept), so the flurry stays on the spot. */
const CARRIES = /^(waist|hips|spine_01|root)$/;
const STRIDE = 10;

/** How the move's power shapes it: blows at the weakest and the strongest, the power they stand for, and its tempo there (× each blow's speed). */
const WEAK = { power: 40, hits: 2, tempo: 0.7 };
const STRONG = { power: 120, hits: 7, tempo: 1.2 };
/** Never fewer, never more blows. */
const MIN_HITS = 2, MAX_HITS = 8;

/** One of its strikes: which clip, what leads it, the clip baked on itself, its blow (frame), the frames it runs. */
export interface FlurryStrike {
  key: 'attack' | 'swipe';
  part: string;
  by: By;
  clip: Retargeted;
  peak: number;
  from: number;
  to: number;
}

/** Where its strikes come from: each clip (its actions, played end to end), its blow (s), and what the factory's own measure says leads it. */
export interface FlurrySource { key: 'attack' | 'swipe'; actions: string[]; hit: number; told: string | null }

/** A move's flurry by its power: how many blows, and how fast (× each blow's own speed). Stronger: more, faster. */
export function flurryShape(power: number): { hits: number; tempo: number } {
  const k = (power - WEAK.power) / (STRONG.power - WEAK.power);
  const hits = Math.max(MIN_HITS, Math.min(MAX_HITS, Math.round(WEAK.hits + k * (STRONG.hits - WEAK.hits))));
  const tempo = WEAK.tempo + Math.max(0, Math.min(1.25, k)) * (STRONG.tempo - WEAK.tempo);
  return { hits, tempo };
}

/** Its strikes (worked out once a unit, on the ground and in the air): each clip's, by what leads it and where it lands. */
export function flurryStrikes(rig: Rig, height: number, sources: FlurrySource[]): FlurryStrike[] {
  const names = rig.bones.map((b) => b.name);
  const hipsName = ['hips', 'waist', 'spine_01'].find((x) => names.includes(x));
  if (!hipsName) return [];
  const atRest: Retargeted = { fps: 60, frames: 1, poses: [rig.rest], driven: new Set() };
  // The way it faces (its rig's space): level, along a foot to its toes at rest.
  const foot = names.indexOf('left_foot');
  const toe = names.find((x, i) => rig.parentIndex[i] === foot && /foot_(middle|index|toe)/.test(x));
  let fwd: [number, number] = [0, 1];
  if (foot >= 0 && toe) {
    const a = pathOf(rig, atRest, 'left_foot')[0], b = pathOf(rig, atRest, toe)[0];
    const l = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
    fwd = [(b[0] - a[0]) / l, (b[2] - a[2]) / l];
  }
  const restHips = pathOf(rig, atRest, hipsName)[0][1];
  const tip = tailTip(rig);
  const strikes: FlurryStrike[] = [];
  for (const src of sources) {
    const baked = bakeHandAttack(rig, src.actions, sampleTrack, { id: 0, species: '', clip: src.key, hand: 'head', height, hitTime: src.hit });
    if (!baked) continue;
    let own = retarget(baked, rig, height);
    // Kept on the spot: what carries the body keeps its height's bob, not its travel.
    for (const i of own.driven) {
      if (!CARRIES.test(names[i])) continue;
      const o = i * STRIDE;
      for (const P of own.poses) { P[o] = rig.rest[o]; P[o + 2] = rig.rest[o + 2]; }
    }
    const hips = pathOf(rig, own, hipsName);
    // Each part's furthest out ahead of its hips round the blow (a foot only while kicked).
    const furthest = (part: string) => {
      const p = pathOf(rig, own, part), y0 = pathOf(rig, atRest, part)[0][1] - restHips;
      const d = p.map((q, i) => (q[0] - hips[i][0]) * fwd[0] + (q[2] - hips[i][2]) * fwd[1]);
      let at: { part: string; out: number; peak: number } | null = null;
      for (let fr = Math.max(0, baked.hit - LOOK_BEFORE); fr < Math.min(baked.frames, baked.hit + LOOK_AFTER); fr++) {
        if (/foot/.test(part) && p[fr][1] - hips[fr][1] - y0 < KICK_LIFT * height) continue;
        if (!at || d[fr] - d[0] > at.out) at = { part, out: d[fr] - d[0], peak: fr };
      }
      return at;
    };
    // What the factory's own measure says leads it, where it can (not a foot
    // that is never kicked: a lunge's stride); else whichever drives furthest out.
    const has = [...PARTS.filter((x) => names.includes(x)), ...(tip ? [tip] : [])];
    const told = src.told === 'tail' ? tip : src.told;
    let best = told && has.includes(told) ? furthest(told) : null;
    if (!best) for (const part of has) { const at = furthest(part); if (at && (!best || at.out > best.out)) best = at; }
    if (!best) continue;
    const by = byOf(best.part);
    if (by === 'tail') {
      // A tail's whip: the whole clip, its spin kept (the spin is what sweeps the tail round in front).
      strikes.push({ key: src.key, part: best.part, by, clip: own, peak: best.peak, from: 0, to: baked.frames - 1 });
      continue;
    }
    // (Its body never spun right round: a spin is eased to a sway.)
    own = steadyHeading(rig, own);
    const t = throwForward(rig, own, best.part, best.peak);
    const from = Math.max(0, Math.max(Math.min(t.from, best.peak), best.peak - RUN_IN) - LEAD);
    const to = Math.min(baked.frames - 1, best.peak + FOLLOW);
    strikes.push({ key: src.key, part: best.part, by, clip: own, peak: best.peak, from, to });
  }
  return strikes;
}

/** A flurry made: its clip, and when each blow lands (s from its start). */
export interface Flurry { clip: Retargeted; blows: number[] }

/** `hits` blows from its strikes, left and right in turn, each aimed its own way, at `tempo`. */
export function buildFlurry(rig: Rig, strikes: FlurryStrike[], hits: number, tempo: number, rnd = Math.random): Flurry {
  const between = (lo: number, hi: number) => lo + rnd() * (hi - lo);
  const sideOf = (p: string) => (p.startsWith('right') ? 'R' : 'L');
  const parts: { clip: Retargeted; from: number; to: number; speed: number }[] = [];
  const runs: { frames: number; peak: number }[] = [];
  for (let i = 0; i < hits; i++) {
    const s = strikes[Math.floor(rnd() * strikes.length)], k = BY[s.by];
    const aim: Aim = { yaw: between(-k.yaw, k.yaw), pitch: between(k.pitch[0], k.pitch[1]) };
    const aimed = s.by === 'tail' ? aimTail(rig, s.clip, s.part, s.peak, aim).clip : throwForward(rig, s.clip, s.part, s.peak, k.extend, aim).clip;
    // (Left and right in turn: a strike on the other side than its turn is
    // mirrored; a head has no side, its turn's side is the body's lean.)
    const mirrored = sideOf(s.part) !== (i % 2 === 0 ? 'L' : 'R');
    const speed = k.speed * tempo;
    parts.push({ clip: mirrored ? mirrorClip(rig, aimed) : aimed, from: s.from, to: s.to, speed });
    runs.push({ frames: Math.floor((s.to - s.from) / speed) + 1, peak: (s.peak - s.from) / speed });
  }
  const clip = chainClips(parts, 1, BLEND);
  const overlap = Math.round(BLEND * clip.fps);
  let at = 0;
  const blows = runs.map((r) => { const start = at; at += r.frames - overlap; return (start + r.peak) / clip.fps; });
  return { clip, blows };
}
