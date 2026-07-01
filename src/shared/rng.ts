/**
 * Seedable deterministic PRNG.
 *
 * The engine NEVER calls Math.random(). All randomness is threaded through
 * an `RNG` instance so a server can replay/verify a battle from a seed.
 *
 * `RNG` is a `() => number` callable returning a float in [0, 1), matching
 * Python's `random.random()` usage in the source engine.
 */

export type RNG = () => number;

/**
 * mulberry32 — a small, fast, well-distributed 32-bit PRNG.
 * Returns a float in [0, 1).
 */
export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derive a numeric seed from an arbitrary string (e.g. a session id).
 * Deterministic FNV-1a style hash.
 */
export function seedFromString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Create an RNG from a numeric or string seed. */
export function makeRng(seed: number | string): RNG {
  const s = typeof seed === 'string' ? seedFromString(seed) : seed;
  return mulberry32(s);
}

/**
 * Fisher-Yates shuffle using an injected RNG. Returns a new array;
 * does not mutate the input. Replaces Python's `random.shuffle`.
 */
export function shuffle<T>(items: readonly T[], rng: RNG): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}
