/**
 * Hand attacks: any species' attack thrown with a hand (a punch, a chop, a
 * claw swipe), borrowed by another species. The Legends Z-A rigs share their
 * bone names, so a clip's motion can be carried across:
 *
 *  1. Baked (`bakeHandAttack`): the source clip(s) sampled frame by frame into
 *     each animated bone's local rotation and position.
 *  2. Retargeted (`retarget`): per bone, the source's change from its own rest
 *     pose (rest⁻¹·key) laid on the target's rest pose (rest·change), its
 *     positions' offsets from rest scaled by the two species' heights; bones
 *     only one rig has are left alone (at the target's rest).
 *  3. Kept clear of itself (`keepClear`): the target's body as capsules — one
 *     round each bone's segment (its joint to its child's), as thick as the
 *     skin weighted to that bone — and, frame by frame, wherever a limb's
 *     capsule sinks into another part of the body (an arm into the chest, a
 *     fist into the head, a hand into the other arm), the limb is turned away
 *     at its own joint until it is clear; the turns are then smoothed across
 *     frames so nothing jerks.
 *  4. Played (`toClip`): dense per-frame tracks, as the player plays any clip.
 */

/** x, y, z, w. */
type Q = [number, number, number, number];
type V3 = [number, number, number];

const qmul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qinv = (a: Q): Q => [-a[0], -a[1], -a[2], a[3]];
const qnorm = (a: Q): Q => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l, a[3] / l]; };
const qrot = (q: Q, v: V3): V3 => {
  const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q));
  return [p[0], p[1], p[2]];
};
const qaxis = (axis: V3, ang: number): Q => {
  const l = Math.hypot(...axis) || 1, s = Math.sin(ang / 2);
  return [(axis[0] / l) * s, (axis[1] / l) * s, (axis[2] / l) * s, Math.cos(ang / 2)];
};
/** Normalised lerp, the short way. */
const qlerp = (a: Q, b: Q, t: number): Q => {
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  return qnorm([a[0] + (b[0] * s - a[0]) * t, a[1] + (b[1] * s - a[1]) * t, a[2] + (b[2] * s - a[2]) * t, a[3] + (b[3] * s - a[3]) * t]);
};
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);

const STRIDE = 10; // the player's pose: pos 3, rot 4, scale 3 per bone

/** What the player keeps that this needs (recipe/babylon.js's AnimationPlayer). */
export interface Rig {
  bones: { name: string }[];
  rest: Float32Array;
  parentIndex: Int32Array;
  clips: Map<string, { fps: number; frames: number; duration: number; bind: Bind[] }>;
}
interface Track { kind: string; n: number; keys: Uint16Array | null; values: Float32Array }
interface Bind { bone: number; rot: Track | null; pos: Track | null; scale: Track | null; cr: { k: number }; cp: { k: number }; cs: { k: number } }
type Sampler = (track: Track, frame: number, width: number, out: Float32Array) => void;

/** A hand attack, baked: its frames' local rotation and position for each bone it moves (by name), and its source rig's rest. */
export interface HandAttack {
  /** Hand Attack N: its number in the catalogue. */
  id: number;
  /** Where it came from: the species, and its clip ('attack', or the swipe). */
  species: string;
  clip: 'attack' | 'swipe';
  /** The hand that leads it. */
  hand: string;
  fps: number;
  frames: number;
  /** The frame its blow lands. */
  hit: number;
  /** Per animated bone: its name, its source rest, and per frame its local rotation (4) and position (3). */
  bones: { name: string; restRot: Q; restPos: V3; rot: Float32Array; pos: Float32Array }[];
  /** The source's height (metres): to scale its positions by. */
  height: number;
}

/**
 * Bake `actions` of a rig (one clip, or a swipe's two run end to end) into a
 * hand attack: every bone any of them moves, sampled at its fps.
 */
export function bakeHandAttack(rig: Rig, actions: string[], sample: Sampler, meta: { id: number; species: string; clip: 'attack' | 'swipe'; hand: string; height: number; hitTime: number }): HandAttack | null {
  const clips = actions.map((a) => rig.clips.get(a)).filter((c): c is NonNullable<typeof c> => !!c);
  if (!clips.length) return null;
  const fps = clips[0].fps;
  const lens = clips.map((c) => Math.max(1, Math.round(c.duration * fps)));
  const frames = lens.reduce((a, b) => a + b, 0) + 1;
  const moved = new Set<number>();
  for (const c of clips) for (const b of c.bind) if (b.rot || b.pos) moved.add(b.bone);
  const tmp = new Float32Array(4);
  const bones = [...moved].map((i) => {
    const o = i * STRIDE;
    return {
      name: rig.bones[i].name, index: i,
      restRot: [rig.rest[o + 3], rig.rest[o + 4], rig.rest[o + 5], rig.rest[o + 6]] as Q,
      restPos: [rig.rest[o], rig.rest[o + 1], rig.rest[o + 2]] as V3,
      rot: new Float32Array(frames * 4), pos: new Float32Array(frames * 3),
    };
  });
  for (let f = 0; f < frames; f++) {
    // Which clip, and how far into it.
    let c = 0, local = f;
    while (c < clips.length - 1 && local >= lens[c]) { local -= lens[c]; c++; }
    const clip = clips[c];
    const at = Math.min(local, clip.duration * clip.fps);
    for (const b of bones) {
      const bind = clip.bind.find((x) => x.bone === b.index);
      if (bind?.rot) { sample(bind.rot, at, 4, tmp); b.rot.set([tmp[0], tmp[1], tmp[2], tmp[3]], f * 4); }
      else b.rot.set(b.restRot, f * 4);
      if (bind?.pos && b.name !== 'origin') { sample(bind.pos, at, 3, tmp); b.pos.set([tmp[0], tmp[1], tmp[2]], f * 3); }
      else b.pos.set(b.restPos, f * 3);
    }
  }
  return { ...meta, fps, frames, hit: Math.round(meta.hitTime * fps), bones: bones.map(({ index: _i, ...b }) => b), height: meta.height };
}

/** A hand attack laid on a target rig: per frame, every bone's local rotation and position (the rest where it does not move). */
export interface Retargeted {
  fps: number;
  frames: number;
  /** Per frame: the full local pose (STRIDE per bone), scale at rest. */
  poses: Float32Array[];
  /** Which bones it drives. */
  driven: Set<number>;
}

/** Retarget `a` onto `rig` (its height `height`): each bone's change from the source's rest laid on the target's. */
export function retarget(a: HandAttack, rig: Rig, height: number): Retargeted {
  const index = new Map(rig.bones.map((b, i) => [b.name, i]));
  const k = height / a.height;
  const poses: Float32Array[] = [];
  const driven = new Set<number>();
  const map = a.bones.map((b) => ({ b, i: index.get(b.name) })).filter((x): x is { b: HandAttack['bones'][number]; i: number } => x.i !== undefined);
  for (const { i } of map) driven.add(i);
  for (let f = 0; f < a.frames; f++) {
    const P = rig.rest.slice();
    for (const { b, i } of map) {
      const o = i * STRIDE;
      const restT: Q = [rig.rest[o + 3], rig.rest[o + 4], rig.rest[o + 5], rig.rest[o + 6]];
      const key: Q = [b.rot[f * 4], b.rot[f * 4 + 1], b.rot[f * 4 + 2], b.rot[f * 4 + 3]];
      const q = qnorm(qmul(restT, qmul(qinv(b.restRot), key)));
      P[o + 3] = q[0]; P[o + 4] = q[1]; P[o + 5] = q[2]; P[o + 6] = q[3];
      if (b.name !== 'origin') for (let c = 0; c < 3; c++) P[o + c] = rig.rest[o + c] + (b.pos[f * 3 + c] - b.restPos[c]) * k;
    }
    poses.push(P);
  }
  return { fps: a.fps, frames: a.frames, poses, driven };
}

// ── its body, as capsules ──────────────────────────────────────────────

/** A capsule round one bone's segment: its joint to its child's joint, `r` thick. */
interface Capsule { bone: number; child: number; r: number; chain: string }

/** Which chain a bone belongs to (a limb, or the core), by name: limbs are turned to keep clear; the core never is. */
function chainOf(name: string): string {
  const m = /^(left|right)(?:_[a-z])?_(arm|hand|shoulder|finger|thumb|index|middle|ring|pinky)/.exec(name);
  if (m) return `${m[1]}_arm`;
  const l = /^(left|right)(?:_[a-z])?_(leg|foot|toe)/.exec(name);
  if (l) return `${l[1]}_leg`;
  if (/^tail/.test(name)) return 'tail';
  if (/^(head|neck|jaw|mouth)/.test(name)) return 'head';
  if (/^(hips|waist|spine|chest|body|pelvis)/.test(name)) return 'core';
  return '';
}

/** World (model-space) transforms of every bone in pose P: position and rotation. */
function fk(rig: Rig, P: Float32Array): { pos: V3[]; rot: Q[] } {
  const n = rig.bones.length, pos: V3[] = new Array(n), rot: Q[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * STRIDE, p = rig.parentIndex[i];
    const lp: V3 = [P[o], P[o + 1], P[o + 2]], lq: Q = [P[o + 3], P[o + 4], P[o + 5], P[o + 6]];
    if (p < 0) { pos[i] = lp; rot[i] = lq; continue; }
    pos[i] = add(pos[p], qrot(rot[p], lp));
    rot[i] = qnorm(qmul(rot[p], lq));
  }
  return { pos, rot };
}

/**
 * The body's capsules, from its skin at rest: for each bone of a chain that
 * has a child further along it, a capsule from it to that child, as thick as
 * its own skin reaches round that segment (CAPSULE_PCT of its vertices within).
 */
export function bodyCapsules(rig: Rig, skin: { positions: Float32Array | number[]; indices: Float32Array | number[]; weights: Float32Array | number[] }[]): Capsule[] {
  const { pos } = fk(rig, rig.rest);
  const n = rig.bones.length;
  const near: number[][] = Array.from({ length: n }, () => []);
  // Each bone's own child along its chain (the furthest one, so a hand reaches its fingers' root).
  const childOf = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const p = rig.parentIndex[i];
    if (p < 0 || !chainOf(rig.bones[p].name) || chainOf(rig.bones[i].name) !== chainOf(rig.bones[p].name)) continue;
    if (childOf[p] < 0 || len(sub(pos[i], pos[p])) > len(sub(pos[childOf[p]], pos[p]))) childOf[p] = i;
  }
  for (const s of skin) {
    for (let v = 0; v < s.positions.length / 3; v++) {
      let best = -1, bw = 0;
      for (let k = 0; k < 4; k++) { const w = s.weights[v * 4 + k]; if (w > bw) { bw = w; best = s.indices[v * 4 + k]; } }
      if (best < 0 || bw < 0.5 || childOf[best] < 0) continue;
      const a = pos[best], b = pos[childOf[best]], ab = sub(b, a);
      const pv: V3 = [s.positions[v * 3], s.positions[v * 3 + 1], s.positions[v * 3 + 2]];
      const t = Math.max(0, Math.min(1, dot(sub(pv, a), ab) / Math.max(1e-9, dot(ab, ab))));
      near[best].push(len(sub(pv, add(a, scl(ab, t)))));
    }
  }
  const caps: Capsule[] = [];
  for (let i = 0; i < n; i++) {
    if (childOf[i] < 0 || near[i].length < 8) continue;
    near[i].sort((x, y) => x - y);
    caps.push({ bone: i, child: childOf[i], r: near[i][Math.floor(near[i].length * CAPSULE_PCT)], chain: chainOf(rig.bones[i].name) });
  }
  return caps;
}
/** A capsule is as thick as this share of its skin's vertices reach. */
const CAPSULE_PCT = 0.55;
/** Two parts count as touching only once sunk this far into each other (× the thinner one's radius): skin brushing is fine. */
const SLACK = 0.25;
/** How many passes a frame gets to come clear, and how far its turns are smoothed (frames either side). */
const PASSES = 24, SMOOTH = 3;

/** The closest points of two segments (a0-a1, b0-b1): their parameters along each. */
function closest(a0: V3, a1: V3, b0: V3, b1: V3): [number, number] {
  const d1 = sub(a1, a0), d2 = sub(b1, b0), r = sub(a0, b0);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s = 0, t = 0;
  if (a <= 1e-9 && e <= 1e-9) return [0, 0];
  if (a <= 1e-9) { t = Math.max(0, Math.min(1, f / e)); return [0, t]; }
  const c = dot(d1, r);
  if (e <= 1e-9) { s = Math.max(0, Math.min(1, -c / a)); return [s, 0]; }
  const b = dot(d1, d2), den = a * e - b * b;
  s = den > 1e-9 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
  t = (b * s + f) / e;
  if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); } else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
  return [s, t];
}

/** Do two capsules count as one body part touching another (not neighbours along the body)? */
function apart(rig: Rig, a: Capsule, b: Capsule): boolean {
  if (a.chain === b.chain && a.chain !== 'core') return false;
  // (Joined: one's joint is the other's.)
  if (a.bone === b.child || b.bone === a.child || a.bone === b.bone) return false;
  if (rig.parentIndex[a.bone] === b.bone || rig.parentIndex[b.bone] === a.bone) return false;
  // (A limb against the core it hangs from, at its root: the shoulder in the chest.)
  const limbRoot = (c: Capsule) => rig.parentIndex[c.bone] >= 0 && chainOf(rig.bones[rig.parentIndex[c.bone]].name) !== c.chain;
  if ((a.chain === 'core' && limbRoot(b)) || (b.chain === 'core' && limbRoot(a))) return false;
  return a.chain !== 'core' || b.chain !== 'core';
}

/** How far two capsules sink into each other in a pose (its bones' positions): metres, negative while apart; with the points that touch. */
function depth(pos: V3[], a: Capsule, b: Capsule): { d: number; pa: V3; pb: V3; gap: number } {
  const [s, t] = closest(pos[a.bone], pos[a.child], pos[b.bone], pos[b.child]);
  const pa = add(pos[a.bone], scl(sub(pos[a.child], pos[a.bone]), s)), pb = add(pos[b.bone], scl(sub(pos[b.child], pos[b.bone]), t));
  const gap = len(sub(pa, pb));
  return { d: a.r + b.r - Math.min(a.r, b.r) * SLACK - gap, pa, pb, gap };
}

/**
 * How far each pair of parts already sinks into each other at rest (the
 * species' own shape: its thighs together, its neck in its chest): a pose is
 * only held to keep them no deeper than that.
 */
export function restDepths(rig: Rig, caps: Capsule[]): Map<string, number> {
  const { pos } = fk(rig, rig.rest);
  const m = new Map<string, number>();
  for (let i = 0; i < caps.length; i++) for (let j = 0; j < caps.length; j++) {
    if (i !== j && apart(rig, caps[i], caps[j])) m.set(`${i},${j}`, Math.max(0, depth(pos, caps[i], caps[j]).d));
  }
  return m;
}

/** How deep the worst place one part of the body sinks into another is, per frame, past how deep they sit at rest (metres; 0: clear). */
export function selfOverlap(rig: Rig, caps: Capsule[], poses: Float32Array[], rest = restDepths(rig, caps)): number[] {
  return poses.map((P) => {
    const { pos } = fk(rig, P);
    let worst = 0;
    for (let i = 0; i < caps.length; i++) for (let j = i + 1; j < caps.length; j++) {
      if (!apart(rig, caps[i], caps[j])) continue;
      worst = Math.max(worst, depth(pos, caps[i], caps[j]).d - (rest.get(`${i},${j}`) ?? 0));
    }
    return Math.max(0, worst);
  });
}

/**
 * Keep the retargeted motion clear of itself: frame by frame, where a limb's
 * capsule sinks into another part, turn that limb at its own joint away from
 * the part it sinks into (never the core: the body holds, the limb gives
 * way); then smooth each bone's turns across SMOOTH frames either side.
 */
export function keepClear(rig: Rig, caps: Capsule[], r: Retargeted, rest = restDepths(rig, caps)): Retargeted {
  // Each frame's turns (a correction on top of the retargeted local rotation), per bone.
  const turns: Map<number, Q>[] = r.poses.map(() => new Map());
  r.poses.forEach((P0, f) => {
    const P = P0.slice();
    for (let pass = 0; pass < PASSES; pass++) {
      const { pos, rot } = fk(rig, P);
      let moved = false;
      scan: for (let i = 0; i < caps.length; i++) for (let j = 0; j < caps.length; j++) {
        if (i === j) continue;
        const a = caps[i], b = caps[j];
        // (The limb gives way: `a` is turned, `b` holds — a limb against the core, or the lower one of two limbs.)
        if (a.chain === 'core' || !apart(rig, a, b) || (b.chain !== 'core' && j < i)) continue;
        // (Deeper than they sit at rest: that far too deep.)
        const { d, pa, pb, gap } = depth(pos, a, b);
        const over = d - (rest.get(`${i},${j}`) ?? 0);
        if (over <= 0) continue;
        // Turn the limb at its own joint so the touching point swings away from the other part.
        const joint = pos[a.bone], arm = sub(pa, joint), reach = len(arm);
        if (reach < 1e-4) continue;
        const away = gap > 1e-5 ? scl(sub(pa, pb), 1 / gap) : qrot(rot[a.bone], [0, 0, 1]);
        const axis = cross(arm, away);
        if (len(axis) < 1e-6) continue;
        const ang = Math.min(0.6, over / reach + 0.01);
        // (A turn about a world axis, as a local one: through the parent's rotation.)
        const pRot = rig.parentIndex[a.bone] >= 0 ? rot[rig.parentIndex[a.bone]] : ([0, 0, 0, 1] as Q);
        const localAxis = qrot(qinv(pRot), axis);
        const dq = qaxis(localAxis, ang);
        const o = a.bone * STRIDE;
        const cur: Q = [P[o + 3], P[o + 4], P[o + 5], P[o + 6]];
        const next = qnorm(qmul(dq, cur));
        P[o + 3] = next[0]; P[o + 4] = next[1]; P[o + 5] = next[2]; P[o + 6] = next[3];
        const before = turns[f].get(a.bone) ?? [0, 0, 0, 1];
        turns[f].set(a.bone, qnorm(qmul(dq, before)));
        moved = true;
        // (One turn a pass: its world pose again before the next.)
        break scan;
      }
      if (!moved) break;
    }
  });
  // Smooth each bone's turns across the frames round it, then lay them on the retargeted pose.
  const bonesTurned = new Set<number>();
  for (const t of turns) for (const b of t.keys()) bonesTurned.add(b);
  const poses = r.poses.map((P) => P.slice());
  for (const b of bonesTurned) {
    for (let f = 0; f < poses.length; f++) {
      let acc: Q = [0, 0, 0, 1], wsum = 0;
      for (let d = -SMOOTH; d <= SMOOTH; d++) {
        const g = Math.max(0, Math.min(poses.length - 1, f + d));
        const w = 1 - Math.abs(d) / (SMOOTH + 1);
        const q = turns[g].get(b) ?? ([0, 0, 0, 1] as Q);
        acc = wsum === 0 ? q : qlerp(acc, q, w / (wsum + w));
        wsum += w;
      }
      const o = b * STRIDE;
      const cur: Q = [poses[f][o + 3], poses[f][o + 4], poses[f][o + 5], poses[f][o + 6]];
      const next = qnorm(qmul(acc, cur));
      poses[f][o + 3] = next[0]; poses[f][o + 4] = next[1]; poses[f][o + 5] = next[2]; poses[f][o + 6] = next[3];
    }
  }
  return { ...r, poses, driven: new Set([...r.driven, ...bonesTurned]) };
}

/**
 * keepClear, again and again (its smoothing gives back a little of each
 * round's turns) until no part sinks into another more than CLEAR_TO past
 * rest, or ROUNDS rounds.
 */
export function keepClearFully(rig: Rig, caps: Capsule[], r: Retargeted, rest = restDepths(rig, caps)): Retargeted {
  let out = r;
  for (let round = 0; round < ROUNDS; round++) {
    if (Math.max(...selfOverlap(rig, caps, out.poses, rest)) <= CLEAR_TO) break;
    out = keepClear(rig, caps, out, rest);
  }
  return out;
}
/** Clear enough: no part sunk further into another than this past rest (metres), in at most this many rounds. */
const CLEAR_TO = 0.015, ROUNDS = 6;

/** As a clip the player can play: a dense track for every bone it drives. */
/** A baked clip as the player plays it; `vis`: for each shape the player switches (its `shown`), which frames it is drawn (1) or not (0) — none, its usual. */
export function toClip(r: Retargeted, action: string, shown: unknown[], vis?: (Uint8Array | null)[]): { action: string; name: string; frames: number; fps: number; loop: boolean; duration: number; bind: Bind[]; vis: (Uint8Array | null)[] } {
  const bind: Bind[] = [];
  for (const i of r.driven) {
    const rot = new Float32Array(r.frames * 4), pos = new Float32Array(r.frames * 3);
    r.poses.forEach((P, f) => {
      const o = i * STRIDE;
      rot.set([P[o + 3], P[o + 4], P[o + 5], P[o + 6]], f * 4);
      pos.set([P[o], P[o + 1], P[o + 2]], f * 3);
    });
    bind.push({ bone: i, rot: { kind: 'dynamic', n: r.frames, keys: null, values: rot }, pos: { kind: 'dynamic', n: r.frames, keys: null, values: pos }, scale: null, cr: { k: 0 }, cp: { k: 0 }, cs: { k: 0 } });
  }
  return { action, name: action, frames: r.frames, fps: r.fps, loop: false, duration: Math.max(1, r.frames - 1) / r.fps, bind, vis: shown.map((_, i) => vis?.[i] ?? null) };
}

// ── build: how a body is proportioned ──────────────────────────────────

/**
 * A body's build, measured on its skeleton at rest (metres, and as ratios):
 * its arm (shoulder to hand, along the bones), its leg (hip to foot), its
 * torso (hips to neck), and its height — and the ratios that say what kind of
 * build it is: arm to height, arm to torso, leg to height. Null parts where it
 * has none (no arms: a snake; no legs: a fish).
 */
export interface Build { height: number; arm: number | null; leg: number | null; torso: number | null; armToHeight: number | null; armToTorso: number | null; legToHeight: number | null }

/** The length of a chain of bones from `top` down to `end` (along the bones, at rest), or null if `end` is not below `top`. */
function chainLength(rig: Rig, pos: V3[], top: number, end: number): number | null {
  let len = 0;
  for (let i = end; i !== top; i = rig.parentIndex[i]) {
    const p = rig.parentIndex[i];
    if (p < 0) return null;
    len += Math.hypot(pos[i][0] - pos[p][0], pos[i][1] - pos[p][1], pos[i][2] - pos[p][2]);
  }
  return len;
}

/** Each side's limb, top to end: the first bone matching `top` above the first matching `end`; averaged over both sides. */
function limbLength(rig: Rig, pos: V3[], top: RegExp, end: RegExp): number | null {
  const lens: number[] = [];
  for (const side of ['left', 'right']) {
    const ends = rig.bones.map((b, i) => [b.name, i] as const).filter(([n]) => n.startsWith(side) && end.test(n));
    for (const [, e] of ends) {
      // (Up from its end to the topmost bone of this side's limb that matches `top`.)
      let t = -1;
      for (let i = rig.parentIndex[e]; i >= 0; i = rig.parentIndex[i]) if (rig.bones[i].name.startsWith(side) && top.test(rig.bones[i].name)) t = i;
      const l = t >= 0 ? chainLength(rig, pos, t, e) : null;
      if (l !== null && l > 0) { lens.push(l); break; }
    }
  }
  return lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : null;
}

/** A torso shorter than this (× the height) is not one to measure an arm against. */
const MIN_TORSO = 0.1;

export function buildOf(rig: Rig, height: number): Build {
  const { pos } = fk(rig, rig.rest);
  // (Arm: from its shoulder, or its upper arm where it has no shoulder, to its hand — `left_hand`, `left_a_hand`, `left_hand_a`.)
  const arm = limbLength(rig, pos, /^(left|right)(_[a-z])?_(shoulder|arm_01)(_[a-z])?$|^(left|right)_(shoulder|arm)(_[a-z])?_01$/, /^(left|right)(_[a-z])?_hand(_[a-z])?$/);
  const leg = limbLength(rig, pos, /^(left|right)(_[a-z])?_leg(_[a-z])?_01$/, /^(left|right)(_[a-z])?_foot(_[a-z])?$/);
  const find = (re: RegExp) => rig.bones.findIndex((b) => re.test(b.name));
  const hips = find(/^(hips|waist|spine_01)$/), neck = find(/^neck(_01)?$/) >= 0 ? find(/^neck(_01)?$/) : find(/^head$/);
  const t = hips >= 0 && neck >= 0 ? Math.hypot(pos[neck][0] - pos[hips][0], pos[neck][1] - pos[hips][1], pos[neck][2] - pos[hips][2]) : null;
  // (A torso too short to measure by — the neck all but on the hips: a fish, a ball — counts as none.)
  const torso = t !== null && t >= MIN_TORSO * height ? t : null;
  return {
    height, arm, leg, torso,
    armToHeight: arm !== null ? arm / height : null,
    armToTorso: arm !== null && torso ? arm / torso : null,
    legToHeight: leg !== null ? leg / height : null,
  };
}

/**
 * How unlike two builds are, for sharing an animation: the difference of
 * their ratios (arm to height, arm to torso, leg to height), each taken as a
 * ratio of ratios (log), so twice as long reads the same either way. Infinity
 * if one has arms (or legs) and the other has none.
 */
export function buildDistance(a: Build, b: Build): number {
  let sum = 0, n = 0;
  for (const k of ['armToHeight', 'armToTorso', 'legToHeight'] as const) {
    const x = a[k], y = b[k];
    if ((x === null) !== (y === null)) return Infinity;
    if (x === null || y === null || x <= 0 || y <= 0) continue;
    sum += Math.log(x / y) ** 2; n++;
  }
  return n ? Math.sqrt(sum / n) : Infinity;
}

/** Arms no more than this many times longer (or shorter) for their height than the borrower's. */
export const ARM_MAX = 1.3;
/** And the whole build (buildDistance) no further off than this. */
export const BUILD_MAX = 0.35;

/** Whether `from` is built enough like `to` to lend it a hand animation: arms first (as long for their height), then the build as a whole. */
export function fitsBuild(to: Build, from: Build): boolean {
  const x = to.armToHeight, y = from.armToHeight;
  if (x === null || y === null || x <= 0 || y <= 0) return false;
  return Math.max(x / y, y / x) <= ARM_MAX && buildDistance(to, from) <= BUILD_MAX;
}

// ── aim: a punch thrown forward ────────────────────────────────────────

/** Its punch: the frames round the blow where the fist is out ahead (within this of straight ahead, degrees). */
const AIM_AHEAD = 60;
/** How long the levelling comes in before it and goes out after it (s). */
const AIM_EASE = 0.12;

/** Its arm reached out (`extend`): the elbow straightened to within this of straight (degrees) — never locked dead straight. */
const AIM_BEND = 8;

/** How a punch's arm points: its pitch above the level (degrees), and how far off straight ahead it turns (degrees). */
export interface Aim { pitch: number; yaw: number }

/**
 * Throw `r`'s punch straight ahead, not up: while the fist is out ahead (the
 * frames round its blow, `hit`, where shoulder to fist points within
 * AIM_AHEAD of the way the body faces), the arm led by `hand` turned at the
 * shoulder (its upper arm), frame by frame, only so far as to take out its
 * pitch — shoulder to fist level. Its heading, its bend, and every other bone
 * are left as they are; it eases in and out over AIM_EASE either side, so
 * the wind-up and the recovery are its own. With `extend` (0..1), the arm
 * also reaches out away from the body: its elbow straightened that much of
 * the way (to within AIM_BEND of straight) before it is levelled. With
 * `aim`, it is thrown that way instead of level: `yaw` degrees round from
 * straight ahead (towards its left, positive), `pitch` degrees up.
 */
export function throwForward(rig: Rig, r: Retargeted, hand: string, hit: number, extend = 0, aim?: Aim): { clip: Retargeted; before: Aim[]; after: Aim[]; from: number; to: number } {
  const names = rig.bones.map((b) => b.name);
  const iHand = names.indexOf(hand);
  const iFore = rig.parentIndex[iHand];
  const iUpper = rig.parentIndex[iFore];
  const iAbove = rig.parentIndex[iUpper];
  // The way it faces: level, along its foot to its toes at rest.
  const rest = fk(rig, rig.rest).pos;
  const side = hand.startsWith('right') ? 'right' : 'left';
  const foot = names.indexOf(`${side}_foot`), toe = names.findIndex((n, i) => rig.parentIndex[i] === foot && /foot_(middle|index|toe)/.test(n));
  let fwd: V3 = foot >= 0 && toe >= 0 ? sub(rest[toe], rest[foot]) : [0, 0, 1];
  fwd = [fwd[0], 0, fwd[2]];
  fwd = scl(fwd, 1 / (len(fwd) || 1));
  const aimOf = (P: Float32Array): { v: V3; aim: Aim } => {
    const { pos } = fk(rig, P);
    const v = sub(pos[iHand], pos[iUpper]), l = len(v) || 1;
    const flat: V3 = [v[0], 0, v[2]];
    const yaw = Math.acos(Math.max(-1, Math.min(1, dot(flat, fwd) / (len(flat) || 1))));
    return { v: scl(v, 1 / l), aim: { pitch: (Math.asin(v[1] / l) * 180) / Math.PI, yaw: (yaw * 180) / Math.PI } };
  };
  const aims = r.poses.map(aimOf);
  // Its aim, as a direction: straight ahead turned round by its yaw, then raised by its pitch.
  const y = ((aim?.yaw ?? 0) * Math.PI) / 180, pt = ((aim?.pitch ?? 0) * Math.PI) / 180;
  const round: V3 = qrot(qaxis([0, 1, 0], y), fwd);
  const aimDir: V3 = [round[0] * Math.cos(pt), Math.sin(pt), round[2] * Math.cos(pt)];
  // Its punch: from the blow on (and back to it), while the fist is out ahead.
  const ahead = (f: number) => aims[f].aim.yaw <= AIM_AHEAD;
  let from = Math.max(0, Math.min(r.frames - 1, hit)), to = from;
  while (to + 1 < r.frames && ahead(to + 1)) to++;
  while (from - 1 >= 0 && ahead(from - 1)) from--;
  if (!ahead(from)) from++;
  const ease = AIM_EASE * r.fps;
  const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
  const poses = r.poses.map((P0, f) => {
    const w = f < from ? smooth(1 - (from - f) / ease) : f > to ? smooth(1 - (f - to) / ease) : 1;
    if (w <= 0) return P0;
    const P = P0.slice();
    // Reached out: the forearm turned towards the upper arm's line (the elbow opened).
    if (extend > 0) {
      const { pos, rot } = fk(rig, P);
      const up = sub(pos[iFore], pos[iUpper]), fore = sub(pos[iHand], pos[iFore]);
      const lu = len(up) || 1, lo = len(fore) || 1;
      const bend = Math.acos(Math.max(-1, Math.min(1, dot(up, fore) / (lu * lo))));
      const open = Math.max(0, bend - (AIM_BEND * Math.PI) / 180) * extend * w;
      if (open > 1e-4) {
        const world = qnorm(qmul(qaxis(cross(fore, up), open), rot[iFore]));
        const q = qnorm(qmul(qinv(rot[iUpper]), world));
        const o = iFore * STRIDE;
        P[o + 3] = q[0]; P[o + 4] = q[1]; P[o + 5] = q[2]; P[o + 6] = q[3];
      }
    }
    // The turn that levels it: shoulder to fist onto its own heading (or onto its aim).
    const v = extend > 0 ? aimOf(P).v : aims[f].v, flat: V3 = [v[0], 0, v[2]];
    const lf = len(flat);
    if (lf < 1e-4 && !aim) return P;
    const level = aim ? aimDir : scl(flat, 1 / lf);
    const ang = Math.acos(Math.max(-1, Math.min(1, dot(v, level))));
    if (ang < 1e-4) return P;
    const turn = qaxis(cross(v, level), ang * w);
    const { rot } = fk(rig, P);
    // Its upper arm turned in the world, then back into its parent's frame.
    const world = qnorm(qmul(turn, rot[iUpper]));
    const q = iAbove >= 0 ? qnorm(qmul(qinv(rot[iAbove]), world)) : world;
    const o = iUpper * STRIDE;
    P[o + 3] = q[0]; P[o + 4] = q[1]; P[o + 5] = q[2]; P[o + 6] = q[3];
    return P;
  });
  const clip = { ...r, poses, driven: new Set([...r.driven, iUpper, iFore]) };
  return { clip, before: aims.map((a) => a.aim), after: poses.map((P) => aimOf(P).aim), from, to };
}

// ── mirror: the same move, the other side ──────────────────────────────

/** A bone's opposite: left_… for right_… and back (left_a_hand, left_hair_c, …); itself on the middle line. */
function partnerOf(names: string[], i: number): number {
  const n = names[i];
  const m = n.startsWith('left') ? 'right' + n.slice(4) : n.startsWith('right') ? 'left' + n.slice(5) : null;
  const j = m ? names.indexOf(m) : -1;
  return j >= 0 ? j : i;
}

/**
 * `r` mirrored across the body's middle (its plane between its shoulders):
 * every frame's pose reflected, left and right swapped — what its left hand
 * did, its right does. Each bone takes its opposite's change from rest,
 * reflected, on its own rest (so a rig a little off symmetric still stands
 * as it does at rest).
 */
export function mirrorClip(rig: Rig, r: Retargeted): Retargeted {
  const names = rig.bones.map((b) => b.name), n = names.length;
  const partner = names.map((_, i) => partnerOf(names, i));
  const rest = fk(rig, rig.rest);
  // Its middle: the plane through between its shoulders (else its hips), across them.
  const L = names.findIndex((x) => /^left(_[a-z])?_(arm_01|shoulder)$/.test(x)), R = L >= 0 ? partner[L] : -1;
  let side: V3 = L >= 0 && R !== L ? sub(rest.pos[L], rest.pos[R]) : [1, 0, 0];
  side = [side[0], 0, side[2]];
  side = scl(side, 1 / (len(side) || 1));
  const mid: V3 = L >= 0 && R !== L ? scl(add(rest.pos[L], rest.pos[R]), 0.5) : [0, 0, 0];
  const reflectP = (p: V3): V3 => sub(p, scl(side, 2 * dot(side, sub(p, mid))));
  const reflectV = (v: V3): V3 => sub(v, scl(side, 2 * dot(side, v)));
  // (A rotation reflected: its axis reflected, turned the other way.)
  const reflectQ = (q: Q): Q => { const v = reflectV([q[0], q[1], q[2]]); return [-v[0], -v[1], -v[2], q[3]]; };
  const poses = r.poses.map((P0) => {
    const { pos, rot } = fk(rig, P0);
    // The world pose mirrored: bone i where its opposite was, reflected.
    const wrot: Q[] = new Array(n), wpos: V3[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const j = partner[i];
      // Its opposite's turn from rest (world), reflected, on its own rest.
      const delta = qmul(rot[j], qinv(rest.rot[j]));
      wrot[i] = qnorm(qmul(reflectQ(delta), rest.rot[i]));
      wpos[i] = add(rest.pos[i], reflectV(sub(pos[j], rest.pos[j])));
    }
    // Back to each bone's own frame.
    const P = P0.slice();
    for (let i = 0; i < n; i++) {
      const p = rig.parentIndex[i], o = i * STRIDE;
      const lq = p >= 0 ? qnorm(qmul(qinv(wrot[p]), wrot[i])) : wrot[i];
      P[o + 3] = lq[0]; P[o + 4] = lq[1]; P[o + 5] = lq[2]; P[o + 6] = lq[3];
      // (Where it moves itself — its root, its waist — its place too; elsewhere its bone's length kept.)
      if (r.driven.has(i) && names[i] !== 'origin') {
        const lp = p >= 0 ? qrot(qinv(wrot[p]), sub(wpos[i], wpos[p])) : wpos[i];
        const restLp: V3 = [rig.rest[o], rig.rest[o + 1], rig.rest[o + 2]];
        // Only where it strays from its rest length's place does it take the mirrored place.
        const moved = len(sub([P0[o], P0[o + 1], P0[o + 2]], restLp)) > 1e-5;
        if (moved) { P[o] = lp[0]; P[o + 1] = lp[1]; P[o + 2] = lp[2]; }
      }
    }
    return P;
  });
  const driven = new Set<number>();
  for (const i of r.driven) { driven.add(i); driven.add(partner[i]); }
  return { ...r, poses, driven };
}

// ── chain: moves run one into the next ─────────────────────────────────

/** Two whole poses blended: each bone's turn (the short way) and its place, `t` of the way from `a` to `b`. */
function blendPose(a: Float32Array, b: Float32Array, t: number): Float32Array {
  const P = a.slice();
  for (let o = 0; o < P.length; o += STRIDE) {
    const q = qlerp([a[o + 3], a[o + 4], a[o + 5], a[o + 6]], [b[o + 3], b[o + 4], b[o + 5], b[o + 6]], t);
    P[o + 3] = q[0]; P[o + 4] = q[1]; P[o + 5] = q[2]; P[o + 6] = q[3];
    for (let c = 0; c < 3; c++) P[o + c] = a[o + c] + (b[o + c] - a[o + c]) * t;
  }
  return P;
}

/** A clip's pose at a frame between its frames (blended). */
function poseAt(r: Retargeted, frame: number): Float32Array {
  const f0 = Math.max(0, Math.min(r.frames - 1, Math.floor(frame))), f1 = Math.min(r.frames - 1, f0 + 1);
  return blendPose(r.poses[f0], r.poses[f1], Math.max(0, Math.min(1, frame - f0)));
}

/**
 * Pieces of clips run one into the next as one clip: each from its frame
 * `from` to `to`, `speed` times as fast (or its own `speed`), and each blended into the next over
 * `blend` seconds (the end of one and the start of the next overlapping).
 * Every clip must be on the same rig.
 */
export function chainClips(parts: { clip: Retargeted; from: number; to: number; speed?: number }[], speed = 1, blend = 0.05): Retargeted {
  const fps = parts[0].clip.fps;
  const runs = parts.map(({ clip, from, to, speed: own }) => {
    const out: Float32Array[] = [];
    for (let f = from; f <= to; f += own ?? speed) out.push(poseAt(clip, f));
    return out;
  });
  const overlap = Math.max(0, Math.round(blend * fps));
  const poses: Float32Array[] = [...runs[0]];
  for (const run of runs.slice(1)) {
    const k = Math.min(overlap, poses.length, run.length);
    // The last k frames so far blended into this one's first k.
    for (let i = 0; i < k; i++) {
      const at = poses.length - k + i;
      poses[at] = blendPose(poses[at], run[i], (i + 1) / (k + 1));
    }
    poses.push(...run.slice(k));
  }
  const driven = new Set<number>();
  for (const p of parts) for (const i of p.clip.driven) driven.add(i);
  return { fps, frames: poses.length, poses, driven };
}

/** Where a bone is (its rig's space) on each frame of `r`. */
export function pathOf(rig: Rig, r: Retargeted, bone: string): [number, number, number][] {
  const i = rig.bones.findIndex((b) => b.name === bone);
  return r.poses.map((P) => fk(rig, P).pos[i]);
}

// ── steady: no spinning round ──────────────────────────────────────────

/** How far round its body may turn (degrees): turns within it are kept; past it, eased back to none at half round (a spin becomes a sway). */
const HEADING_MAX = 30;

/**
 * `r` with its body's turning round kept small: on each frame, how far round
 * (about the upright) its `bone` — what carries the body, its waist — is
 * turned from its first frame: within HEADING_MAX, kept (a twist into a
 * blow); past it, eased back down to none as it comes to face right behind
 * (so a spin right round is a sway out and back, ending as it began, never
 * a jump) — the body turned back about the upright by the difference. Its
 * lean, its bank and every limb are its own.
 */
export function steadyHeading(rig: Rig, r: Retargeted, bone = 'waist'): Retargeted {
  const names = rig.bones.map((b) => b.name);
  const i = names.indexOf(bone);
  if (i < 0) return r;
  const parent = rig.parentIndex[i];
  const rest = fk(rig, rig.rest);
  // Its facing at rest (level), turned by its turn from rest.
  const restInv = qinv(rest.rot[i]);
  const headingOf = (rot: Q): number => {
    const v = qrot(qmul(rot, restInv), [0, 0, 1]);
    return Math.atan2(v[0], v[2]);
  };
  const max = (HEADING_MAX * Math.PI) / 180;
  let start = 0;
  const poses = r.poses.map((P0, f) => {
    const { rot } = fk(rig, P0);
    // Its turn from its first frame (−half round … half round).
    const h = headingOf(rot[i]);
    if (f === 0) start = h;
    let w = h - start;
    while (w > Math.PI) w -= 2 * Math.PI;
    while (w < -Math.PI) w += 2 * Math.PI;
    const a = Math.abs(w);
    const want = a <= max ? w : Math.sign(w) * max * Math.cos(((a - max) / (Math.PI - max)) * (Math.PI / 2));
    const back = want - w;
    if (Math.abs(back) < 1e-4) return P0;
    const world = qnorm(qmul(qaxis([0, 1, 0], back), rot[i]));
    const q = parent >= 0 ? qnorm(qmul(qinv(rot[parent]), world)) : world;
    const P = P0.slice(), o = i * STRIDE;
    P[o + 3] = q[0]; P[o + 4] = q[1]; P[o + 5] = q[2]; P[o + 6] = q[3];
    return P;
  });
  const driven = new Set(r.driven); driven.add(i);
  return { ...r, poses, driven };
}

// ── a tail's aim ───────────────────────────────────────────────────────

/** A tail's joints: from where it leaves the body to the one before its tip (each bone named tail…, up from `tip`). */
export function tailJoints(rig: Rig, tip: string): number[] {
  const names = rig.bones.map((b) => b.name);
  const out: number[] = [];
  for (let i = rig.parentIndex[names.indexOf(tip)]; i >= 0 && /tail/.test(names[i]); i = rig.parentIndex[i]) out.unshift(i);
  return out;
}

/**
 * `r`'s tail strike thrown `aim`'s way: while its tip is out ahead (round its
 * blow, `hit`: root to tip within AIM_AHEAD of the way the body faces), the
 * turn that would point root to tip that way spread evenly along the tail —
 * each of its joints turned its share — so it bends there whole, not at one
 * joint; eased in and out over AIM_EASE. Every other bone is its own.
 */
export function aimTail(rig: Rig, r: Retargeted, tip: string, hit: number, aim: Aim): { clip: Retargeted; from: number; to: number } {
  const names = rig.bones.map((b) => b.name);
  const iTip = names.indexOf(tip), joints = tailJoints(rig, tip);
  if (iTip < 0 || !joints.length) return { clip: r, from: hit, to: hit };
  const iRoot = joints[0];
  // The way it faces: level, along a foot to its toes at rest.
  const rest = fk(rig, rig.rest).pos;
  const foot = names.indexOf('left_foot'), toe = names.findIndex((n, i) => rig.parentIndex[i] === foot && /foot_(middle|index|toe)/.test(n));
  let fwd: V3 = foot >= 0 && toe >= 0 ? sub(rest[toe], rest[foot]) : [0, 0, 1];
  fwd = [fwd[0], 0, fwd[2]];
  fwd = scl(fwd, 1 / (len(fwd) || 1));
  const y = (aim.yaw * Math.PI) / 180, pt = (aim.pitch * Math.PI) / 180;
  const round: V3 = qrot(qaxis([0, 1, 0], y), fwd);
  const aimDir: V3 = [round[0] * Math.cos(pt), Math.sin(pt), round[2] * Math.cos(pt)];
  const dirOf = (P: Float32Array): V3 => { const { pos } = fk(rig, P); const v = sub(pos[iTip], pos[iRoot]); return scl(v, 1 / (len(v) || 1)); };
  const ahead = (f: number) => {
    const v = dirOf(r.poses[f]), flat: V3 = [v[0], 0, v[2]];
    return Math.acos(Math.max(-1, Math.min(1, dot(flat, fwd) / (len(flat) || 1)))) <= (AIM_AHEAD * Math.PI) / 180;
  };
  let from = Math.max(0, Math.min(r.frames - 1, hit)), to = from;
  while (to + 1 < r.frames && ahead(to + 1)) to++;
  while (from - 1 >= 0 && ahead(from - 1)) from--;
  const ease = AIM_EASE * r.fps;
  const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
  const poses = r.poses.map((P0, f) => {
    const w = f < from ? smooth(1 - (from - f) / ease) : f > to ? smooth(1 - (f - to) / ease) : 1;
    if (w <= 0) return P0;
    const v = dirOf(P0);
    const ang = Math.acos(Math.max(-1, Math.min(1, dot(v, aimDir))));
    if (ang < 1e-4) return P0;
    const axis = cross(v, aimDir), share = (ang * w) / joints.length;
    const P = P0.slice();
    // Root first: each joint's share on top of those above it.
    for (const j of joints) {
      const { rot } = fk(rig, P);
      const world = qnorm(qmul(qaxis(axis, share), rot[j]));
      const p = rig.parentIndex[j];
      const q = p >= 0 ? qnorm(qmul(qinv(rot[p]), world)) : world;
      const o = j * STRIDE;
      P[o + 3] = q[0]; P[o + 4] = q[1]; P[o + 5] = q[2]; P[o + 6] = q[3];
    }
    return P;
  });
  const driven = new Set(r.driven); for (const j of joints) driven.add(j);
  return { clip: { ...r, poses, driven }, from, to };
}

// ── a part spun on its own ─────────────────────────────────────────────

/** A bone at rest, in its rig's space: where it is, and how it is turned (its frame: a point there is pos + rot · local). */
export function restOf(rig: Rig, bone: string): { pos: V3; rot: Q } | null {
  const i = rig.bones.findIndex((b) => b.name === bone);
  if (i < 0) return null;
  const { pos, rot } = fk(rig, rig.rest);
  return { pos: pos[i], rot: rot[i] };
}

/** A point given in a bone's frame at rest, from the rig's space (`p` there). */
export function toBoneFrame(rest: { pos: V3; rot: Q }, p: V3): V3 {
  return qrot(qinv(rest.rot), sub(p, rest.pos));
}

/**
 * `r` with `bone` (and all it carries) spun about its own `axis` through
 * `pivot` — both in the bone's own frame — by `angles[f]` radians on each
 * frame: on top of whatever the clip does with it, so it is carried as ever
 * while it spins (a shuriken whirling in the hand that holds it).
 */
export function spinBone(rig: Rig, r: Retargeted, bone: string, pivot: V3, axis: V3, angles: number[]): Retargeted {
  const i = rig.bones.findIndex((b) => b.name === bone);
  if (i < 0) return r;
  const o = i * STRIDE;
  const poses = r.poses.map((P0, f) => {
    const a = angles[Math.min(f, angles.length - 1)] ?? 0;
    if (!a) return P0;
    const P = P0.slice();
    const lq: Q = [P0[o + 3], P0[o + 4], P0[o + 5], P0[o + 6]], lp: V3 = [P0[o], P0[o + 1], P0[o + 2]];
    const s = qaxis(axis, a);
    // Its frame turned about the pivot: L · T(c) · R · T(−c).
    const q = qnorm(qmul(lq, s));
    const t = add(lp, qrot(lq, sub(pivot, qrot(s, pivot))));
    P[o] = t[0]; P[o + 1] = t[1]; P[o + 2] = t[2];
    P[o + 3] = q[0]; P[o + 4] = q[1]; P[o + 5] = q[2]; P[o + 6] = q[3];
    return P;
  });
  const driven = new Set(r.driven); driven.add(i);
  return { ...r, poses, driven };
}

/** Where a bone is and how it is turned (its rig's space) on each frame of `r`. */
export function poseOf(rig: Rig, r: Retargeted, bone: string): { pos: V3; rot: Q }[] {
  const i = rig.bones.findIndex((b) => b.name === bone);
  return r.poses.map((P) => { const { pos, rot } = fk(rig, P); return { pos: pos[i], rot: rot[i] }; });
}

/**
 * `r` (a clip on `src`) laid on another rig, `dst`, by how far each bone is
 * turned in the world from its rest — not from its parent — so rigs whose
 * chains differ (bones one has and the other has not: Mega Greninja's
 * waist_a between its waist and its spine) still take the same pose. A bone
 * only `dst` has follows its parent as at rest. Places are `dst`'s own at
 * rest (no travel: the ground stands it where it is).
 */
export function retargetWorld(src: Rig, r: Retargeted, dst: Rig): Retargeted {
  const sNames = new Map(src.bones.map((b, i) => [b.name, i]));
  const sRest = fk(src, src.rest), dRest = fk(dst, dst.rest);
  const n = dst.bones.length;
  const map = dst.bones.map((b) => sNames.get(b.name) ?? -1);
  const driven = new Set<number>();
  map.forEach((j, i) => { if (j >= 0) driven.add(i); });
  const poses = r.poses.map((PS) => {
    const s = fk(src, PS);
    const P = dst.rest.slice();
    const world: Q[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = dst.parentIndex[i], j = map[i];
      const parentW: Q = p >= 0 ? world[p] : [0, 0, 0, 1];
      const o = i * STRIDE;
      const restLocal: Q = [dst.rest[o + 3], dst.rest[o + 4], dst.rest[o + 5], dst.rest[o + 6]];
      // Its turn from rest in the world, the source's; else as at rest under its parent.
      world[i] = j >= 0 ? qnorm(qmul(qmul(s.rot[j], qinv(sRest.rot[j])), dRest.rot[i])) : qnorm(qmul(parentW, restLocal));
      const lq = p >= 0 ? qnorm(qmul(qinv(parentW), world[i])) : world[i];
      P[o + 3] = lq[0]; P[o + 4] = lq[1]; P[o + 5] = lq[2]; P[o + 6] = lq[3];
    }
    return P;
  });
  return { fps: r.fps, frames: r.frames, poses, driven };
}

/**
 * `r` brought round to face straight ahead by its end: how far round its
 * upper body is turned from its rest (its shoulder line, `shoulders`) taken
 * back out at its `bone` (what carries the body, its waist) — none of it on
 * the first frame, all of it on the last, eased between — so whatever
 * follows, facing ahead, follows with no turn left (a throw's
 * follow-through into a backflip). Its lean and its limbs are its own.
 */
export function faceAheadByEnd(rig: Rig, r: Retargeted, bone = 'waist', shoulders: [string, string] = ['left_arm_01', 'right_arm_01']): Retargeted {
  const names = rig.bones.map((b) => b.name);
  const i = names.indexOf(bone), iL = names.indexOf(shoulders[0]), iR = names.indexOf(shoulders[1]);
  if (i < 0 || iL < 0 || iR < 0 || r.frames < 2) return r;
  const parent = rig.parentIndex[i];
  const rest = fk(rig, rig.rest);
  // (Its shoulder line's heading round the upright.)
  const lineHeading = (pos: V3[]) => { const s = sub(pos[iL], pos[iR]); return Math.atan2(s[0], s[2]); };
  const h0 = lineHeading(rest.pos);
  const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
  const poses = r.poses.map((P0, f) => {
    const { pos, rot } = fk(rig, P0);
    let h = lineHeading(pos) - h0;
    while (h > Math.PI) h -= 2 * Math.PI;
    while (h < -Math.PI) h += 2 * Math.PI;
    const back = -h * smooth(f / (r.frames - 1));
    if (Math.abs(back) < 1e-4) return P0;
    const world = qnorm(qmul(qaxis([0, 1, 0], back), rot[i]));
    const q = parent >= 0 ? qnorm(qmul(qinv(rot[parent]), world)) : world;
    const P = P0.slice(), o = i * STRIDE;
    P[o + 3] = q[0]; P[o + 4] = q[1]; P[o + 5] = q[2]; P[o + 6] = q[3];
    return P;
  });
  const driven = new Set(r.driven); driven.add(i);
  return { ...r, poses, driven };
}
