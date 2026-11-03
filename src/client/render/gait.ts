/**
 * How fast a walk (or a run) carries the body, read off its feet: whichever
 * foot is lowest is the one on the ground, and while it is down it slides
 * back under the hips at just the pace the body must go forward for it to
 * stay put. Moved at that pace, a Pokémon's feet never skate.
 */
import { bakeHandAttack, retarget, pathOf, type Rig } from './handAttacks.ts';
import { sampleTrack } from '../recipe/tranm.js';

/** Down: within this much (× its height) of the lowest any foot goes in the clip. */
const PLANTED = 0.03;
/** Too few planted frames to trust (a hop, a float): no answer. */
const MIN_FRAMES = 4;

/**
 * The ground speed `action` carries its body at (its rig's units a second,
 * at its own pace), or null where it can't be told — no feet, no clip, never
 * planted. `onFours`: it goes on its hands too.
 */
export function gaitSpeed(rig: Rig, height: number, action: string, onFours: boolean): number | null {
  const names = rig.bones.map((b) => b.name);
  const hips = ['hips', 'waist', 'spine_01'].find((x) => names.includes(x));
  // Its feet: the top of each foot's chain — and a four-legged one's front feet, its hands (never an upright one's: they swing low in a run).
  const limb = onFours ? /foot|hand/ : /foot/;
  const feet = names.filter((n, i) => limb.test(n) && !/_sub$/.test(n) && !limb.test(names[rig.parentIndex[i]] ?? ''));
  if (!hips || feet.length < 2) return null;
  const baked = bakeHandAttack(rig, [action], sampleTrack, { id: 0, species: '', clip: 'attack', hand: feet[0], height, hitTime: 0 });
  if (!baked) return null;
  const clip = retarget(baked, rig, height);
  const h = pathOf(rig, clip, hips), paths = feet.map((f) => pathOf(rig, clip, f));
  let low = Infinity;
  for (const p of paths) for (const q of p) low = Math.min(low, q[1]);
  // Its sweep under the hips while down, summed: touching down and lifting off it jitters either way, the sum keeps only the sweep.
  let sx = 0, sz = 0, n = 0;
  for (let f = 0; f + 1 < clip.frames; f++) {
    // The foot down now and next frame: how far it went under the hips.
    let k = 0;
    for (let i = 1; i < paths.length; i++) if (paths[i][f][1] < paths[k][f][1]) k = i;
    const a = paths[k][f], b = paths[k][f + 1];
    if (a[1] > low + PLANTED * height || b[1] > low + PLANTED * height) continue;
    sx += (b[0] - h[f + 1][0]) - (a[0] - h[f][0]);
    sz += (b[2] - h[f + 1][2]) - (a[2] - h[f][2]);
    n++;
  }
  if (n < MIN_FRAMES) return null;
  const v = (Math.hypot(sx, sz) / n) * clip.fps;
  return v > 1e-3 ? v : null;
}
