// Main-thread API: load one Pokémon's decoded recipe (via a worker).
//
//   const data = await loadPokemon('pm0006_00_00', { onProgress: (f) => ... });
//   const model = buildPokemon(BABYLON, scene, data);   // see babylon.js
//
// Each call runs its own worker, so loading two Pokémon decodes both at once.

/** Battle actions -> archive clip names, in order of preference. Shared by all six of ours. */
export const BATTLE_CLIPS = {
  idle: ['battlewait01_loop', 'defaultwait01_loop'],
  walk: ['walk01_loop'],
  run: ['run01_loop'],
  attack: ['attack01'],
  ranged: ['rangeattack01'],
  roar: ['roar01'],
  appeal: ['appeal01'],
  damage: ['damage01'],
  faint: ['down01_start'],
  down: ['down01_loop'],
  glad: ['glad01'],
  turnL: ['turn_l090'],
  turnR: ['turn_r090'],
  // The beam chain: wind-up (mouth shut), the pour (held), the release.
  beamStart: ['rangeattack02_start'],
  beamLoop: ['rangeattack02_loop'],
  beamEnd: ['rangeattack02_end'],
  // The swipe (a claw or slash): wind-up, then the strike, which lands on the
  // end clip's first frame (EFFECTS.md: Charizard's claw→clawEnd). Only some
  // species have one; the rest fall back to attack01.
  swipeStart: ['attack03_start'],
  swipeLoop: ['attack03_loop'],
  swipeEnd: ['attack03_end'],
  // The same actions in the air (200xx clips), for species that fly. Absent
  // for the rest, so nothing extra is fetched for them.
  airIdle: ['air:battlewait01_loop', 'air:defaultwait01_loop'],
  airWalk: ['air:walk01_loop'],
  airRun: ['air:run01_loop'],
  airAttack: ['air:attack01'],
  airRanged: ['air:rangeattack01'],
  airRoar: ['air:roar01'],
  airAppeal: ['air:appeal01'],
  airDamage: ['air:damage01'],
  airGlad: ['air:glad01'],
  airBeamStart: ['air:rangeattack02_start'],
  airBeamLoop: ['air:rangeattack02_loop'],
  airBeamEnd: ['air:rangeattack02_end'],
  airSwipeStart: ['air:attack03_start'],
  airSwipeLoop: ['air:attack03_loop'],
  airSwipeEnd: ['air:attack03_end'],
};

/** Map a species' Pokédex number to its base form id: 6 -> 'pm0006_00_00'. */
export const formId = (dex, form = 0) => `pm${String(dex).padStart(4, '0')}_${String(form).padStart(2, '0')}_00`;

/**
 * @param {string} id  form id, e.g. 'pm0006_00_00'
 * @param {{ base?: string, clips?: Record<string, string[]>, onProgress?: (fraction: number) => void }} [opts]
 * @returns {Promise<any>} decoded recipe data for buildPokemon
 */
export function loadPokemon(id, { base = '', clips = BATTLE_CLIPS, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./decode-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = ({ data }) => {
      if (data.type === 'progress') { onProgress && onProgress(data.total ? data.loaded / data.total : 0); return; }
      w.terminate();
      if (data.type === 'done') resolve(data);
      else reject(new Error(data.message));
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'worker failed')); };
    w.postMessage({ id, base, clips });
  });
}
