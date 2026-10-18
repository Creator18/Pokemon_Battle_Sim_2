/**
 * The lightning field (docs/reference/EFFECTS.md, Part 2 §5.3), transcribed:
 * the flicker `illum`, the drifting `path`, and `wander`, which pushes a
 * stroke's centreline sideways by two fBm's of its axial coordinate. The beam
 * crackle uses them now; the lightning moves will use them next.
 *
 * Value noise in the source's style: GLSL fract(sin(x)·43758.54) hashes with
 * smoothstep fades.
 */

const M = 43758.54;
const fract = (x: number) => x - Math.floor(x);
const hashff = (p: number) => fract(Math.sin(p) * M);
const smooth = (f: number) => f * f * (3 - 2 * f);

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** 1-D value noise. */
function noiseff(p: number): number {
  const i = Math.floor(p);
  const f = smooth(p - i);
  return hashff(i) + (hashff(i + 1) - hashff(i)) * f;
}

/** The source's Hashv2v2 corner hash: fract(sin(dot(c, (37, 39)))·M). */
const hashv2 = (x: number, y: number) => hashff(37 * x + 39 * y);

/** 2-D value noise, as the source's Noisefv2 (mix over y, then x). */
function noisefv2(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hashv2(ix, iy), b = hashv2(ix + 1, iy), c = hashv2(ix, iy + 1), d = hashv2(ix + 1, iy + 1);
  const lo = a + (c - a) * fy, hi = b + (d - b) * fy;
  return lo + (hi - lo) * fx;
}

/** 5 octaves, amplitude ×0.5 and frequency ×2 each, ÷1.9375. */
export function fbm1(p: number): number {
  let f = 0, a = 1;
  for (let i = 0; i < 5; i++) { f += a * noiseff(p); a *= 0.5; p *= 2; }
  return f / 1.9375;
}

/** 4 octaves, amplitude ×1/2.5 and frequency ×2.5 each, ÷ the weights. */
export function fbm2p(x: number, y: number): number {
  let f = 0, a = 1, sum = 0;
  for (let i = 0; i < 4; i++) { f += a * noisefv2(x, y); sum += a; a /= 2.5; x *= 2.5; y *= 2.5; }
  return f / sum;
}

export function smoothBump(lo: number, hi: number, w: number, x: number): number {
  return (1 - smoothstep(hi - w, hi + w, x)) * smoothstep(lo - w, lo + w, x);
}

/** The flicker: fully on or fully off for long stretches (ILLUM_MIN = 0). */
export function illum(t: number): number {
  return smoothstep(0.3, 0.9, fbm1(4 * t));
}

/** Stroke k's drifting offsets into the noise field. */
export function path(k: number, t: number): [number, number, number, number] {
  const f = 0.1 * k;
  return [
    4 + f + (1.5 + f) * t + (0.8 - f) * Math.sin((0.1 + 0.1 * f) * t),
    Math.sin((0.11 + 0.1 * f) * t) + (0.3 + 0.2 * f) * Math.sin((0.17 + 0.5 * f) * t),
    5 + 2 * f + (1.3 - f) * t + (0.5 + 0.3 * f) * Math.sin((0.15 - 0.2 * f) * t),
    Math.sin((0.12 - 0.1 * f) * t) + (0.4 - 0.2 * f) * Math.sin((0.12 + 0.2 * f) * t),
  ];
}

/**
 * The sideways push of stroke k at axial coordinate zc ∈ [−4, 4]: still at
 * the near end (the bump pins it), fraying toward the far end.
 */
export function wander(k: number, zc: number, t: number): [number, number] {
  const p = path(k, t);
  const b = smoothBump(-3.5, 3.9, 0.5, zc);
  return [
    b * (2 * fbm2p(0.4 * zc + p[0], p[1]) - 1),
    b * (2 * fbm2p(0.3 * zc + p[2], p[3]) - 1),
  ];
}
