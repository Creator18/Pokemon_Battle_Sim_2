/**
 * Aura outline palettes (docs/reference/EFFECTS.md, Part 2 §1.5 and §1.7).
 *
 * Sixteen steps from the pale "inner" end (pal[0], used for the film) to the
 * deep "outer" end (pal[15]). As drawn (checked on the Electric aura), pal[0]
 * sits against the body and pal[15] on the band's outer edge. Each step: v = 1 − (1 − floor)·u, channel =
 * tanh(c·v·GAIN), with c running inner → outer. Fire takes its colour off the
 * fire wheel instead. The doc lists Fire, Dragon, Normal, Water, Grass and
 * electric; the other types are filled in by eye with the same formula.
 */

export type RGB = [number, number, number];

const STEPS = 16;
const GAIN = 1.5;
/** The renderer draws a glowing palette entry at ×0.92 (flier::EMISSIVE). */
export const EMISSIVE = 0.92;

function pair(inner: RGB, outer: RGB, floor: number): RGB[] {
  const out: RGB[] = [];
  for (let s = 0; s < STEPS; s++) {
    const u = s / (STEPS - 1);
    const v = 1 - (1 - floor) * u;
    out.push([0, 1, 2].map((k) => Math.tanh((inner[k] + (outer[k] - inner[k]) * u) * v * GAIN)) as RGB);
  }
  return out;
}

/** Fire: fire::tint(φ) = (sin(φ+7)+1.1, sin(φ+2)+1.1, sin(φ+3)+1.1), φ swept from→to. */
function fireWheel(from: number, to: number, floor: number): RGB[] {
  const out: RGB[] = [];
  for (let s = 0; s < STEPS; s++) {
    const u = s / (STEPS - 1);
    const v = 1 - (1 - floor) * u;
    const phi = from + (to - from) * u;
    const c: RGB = [Math.sin(phi + 7) + 1.1, Math.sin(phi + 2) + 1.1, Math.sin(phi + 3) + 1.1];
    out.push(c.map((x) => Math.tanh(x * v * GAIN)) as RGB);
  }
  return out;
}

const PAIRS: Record<string, [RGB, RGB, number]> = {
  // From the doc.
  Dragon: [[0.80, 0.62, 1.00], [0.44, 0.10, 0.82], 0.62],
  Normal: [[0.86, 0.86, 0.80], [0.92, 0.84, 0.52], 0.70],
  Water: [[0.62, 0.90, 1.00], [0.00, 0.34, 0.92], 0.66],
  // Blue flames (see elementFor): a deeper blue than Water.
  BlueFire: [[0.42, 0.62, 1.00], [0.00, 0.08, 0.72], 0.60],
  // Ghostly fire (the Litwick line's): Ghost's colours, burning as fire.
  GhostFire: [[0.80, 0.70, 1.00], [0.36, 0.18, 0.66], 0.58],
  Grass: [[0.92, 1.00, 0.66], [0.26, 0.78, 0.10], 0.66],
  // Glows like the lightning (LightningFx): the bolts' amber halo on the
  // outer edge, their white-hot core against the body, and no dimming
  // toward the body (floor 1), as the core is the brightest part of a bolt.
  Electric: [[1.00, 0.98, 0.85], [1.00, 0.50, 0.00], 1.0],
  // By eye, same formula.
  Ice: [[0.84, 0.97, 1.00], [0.30, 0.74, 0.96], 0.70],
  // A red outline round a blue fill (asked for), the steps blue toward red.
  Fighting: [[0.62, 0.80, 1.00], [0.86, 0.10, 0.08], 0.60],
  Poison: [[0.92, 0.70, 1.00], [0.62, 0.14, 0.76], 0.62],
  Ground: [[1.00, 0.90, 0.64], [0.78, 0.54, 0.22], 0.66],
  Flying: [[0.88, 0.90, 1.00], [0.52, 0.58, 0.98], 0.70],
  Psychic: [[1.00, 0.76, 0.90], [0.96, 0.22, 0.56], 0.64],
  Bug: [[0.90, 1.00, 0.60], [0.56, 0.72, 0.10], 0.66],
  Rock: [[0.96, 0.90, 0.70], [0.66, 0.54, 0.24], 0.66],
  Ghost: [[0.80, 0.70, 1.00], [0.36, 0.18, 0.66], 0.58],
  Dark: [[0.78, 0.66, 0.74], [0.34, 0.12, 0.34], 0.55],
  Steel: [[0.90, 0.92, 0.98], [0.54, 0.60, 0.74], 0.70],
  Fairy: [[1.00, 0.86, 0.96], [0.96, 0.44, 0.70], 0.68],
  // Golden (Brave Bird's: a Flying aura in gold).
  Gold: [[1.00, 0.95, 0.70], [0.95, 0.62, 0.05], 0.70],
};

/**
 * How an aura is drawn (UnitFx): a filled shape. The outline is a hot line in
 * the type's colour, glowing the way the lightning does; the fill inside it
 * is a lighter shade of that colour (Fire: a red outline, an orange fill).
 * Full-strength display colours, as [outline, fill].
 */
const OUTLINE_FILL: Record<string, [RGB, RGB]> = {
  Fire: [[1.0, 0.18, 0.03], [1.0, 0.6, 0.12]],
  Water: [[0.0, 0.35, 1.0], [0.45, 0.78, 1.0]],
  Grass: [[0.15, 0.7, 0.1], [0.55, 0.95, 0.35]],
  Ice: [[0.2, 0.65, 0.95], [0.75, 0.96, 1.0]],
  Poison: [[0.6, 0.12, 0.75], [0.88, 0.55, 1.0]],
  Ground: [[0.72, 0.48, 0.18], [0.98, 0.82, 0.5]],
  Flying: [[0.45, 0.55, 1.0], [0.8, 0.85, 1.0]],
  Psychic: [[0.95, 0.18, 0.55], [1.0, 0.6, 0.85]],
  Bug: [[0.5, 0.7, 0.08], [0.82, 0.95, 0.4]],
  Rock: [[0.6, 0.48, 0.2], [0.92, 0.82, 0.55]],
  Steel: [[0.45, 0.52, 0.66], [0.82, 0.86, 0.94]],
  Fairy: [[0.95, 0.4, 0.7], [1.0, 0.8, 0.92]],
  Normal: [[0.8, 0.72, 0.45], [1.0, 0.95, 0.78]],
  // The special cases (asked for).
  Ghost: [[0.04, 0.02, 0.06], [0.55, 0.25, 0.9]], //   black outline, purple fill
  Dragon: [[0.3, 0.05, 0.6], [0.75, 0.6, 1.0]], //     dark purple outline, light purple fill
  Dark: [[0.04, 0.0, 0.02], [0.85, 0.08, 0.1]], //     black outline, red fill
  Fighting: [[0.88, 0.06, 0.05], [0.25, 0.5, 1.0]], //  red outline, blue fill
  // Blue flames (see elementFor): a deeper blue than Water's, both outline and fill.
  BlueFire: [[0.0, 0.06, 0.78], [0.12, 0.36, 1.0]],
  GhostFire: [[0.04, 0.02, 0.06], [0.55, 0.25, 0.9]], // as Ghost: black outline, purple fill
  Gold: [[1.0, 0.62, 0.04], [1.0, 0.9, 0.45]], //      deep gold outline, bright gold fill (Brave Bird)
};

/** Pokémon whose flames are blue: their Fire wears BlueFire's colours. */
const BLUE_FLAMES = new Set(['Mega Charizard X']);
/** …and those whose flames are blue only when shiny. */
const SHINY_BLUE_FLAMES = new Set(['Emboar']);
/** Pokémon whose flames are ghostly (violet, as on their bodies): their Fire wears GhostFire's colours. */
const GHOST_FLAMES = new Set(['Litwick', 'Lampent', 'Chandelure', 'Mega Chandelure']);

/**
 * The colours a Pokémon's move of `element` wears: its type's, except where
 * it has its own (Mega Charizard X's Fire is blue flame, deeper than Water).
 */
export function elementFor(element: string, species?: string | null, shiny = false): string {
  if (element !== 'Fire' || !species) return element;
  if (GHOST_FLAMES.has(species)) return 'GhostFire';
  const blue = BLUE_FLAMES.has(species) || (shiny && SHINY_BLUE_FLAMES.has(species));
  return blue ? 'BlueFire' : element;
}

/** Fire of any colour (for the effects drawn as flame: a licking aura edge). */
export function isFire(element: string): boolean {
  return element === 'Fire' || element === 'BlueFire' || element === 'GhostFire';
}

/**
 * [outer glow, inner glow, line, fill] for a type. Electric keeps the
 * lightning's own look (LightningFx): an amber and yellow glow round a
 * white-hot line, filled white-hot.
 */
const GLOWS: Record<string, [RGB, RGB, RGB, RGB]> = {
  Electric: [[1.0, 0.56, 0.02], [1.0, 0.88, 0.25], [1.0, 1.0, 0.93], [1.0, 1.0, 0.93]],
  // Evolving: all white, a faint blue in the outer glow.
  Evolution: [[0.82, 0.9, 1.0], [0.95, 0.98, 1.0], [1.0, 1.0, 1.0], [1.0, 1.0, 1.0]],
};

const glowCache = new Map<string, [RGB, RGB, RGB, RGB]>();

export function auraGlow(element: string): [RGB, RGB, RGB, RGB] {
  let g = glowCache.get(element) ?? GLOWS[element];
  if (!g) {
    const [line, fill] = OUTLINE_FILL[element] ?? OUTLINE_FILL.Normal;
    const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    // The outline glows in its own colour, a little toward the fill nearer it.
    g = [line, mix(line, fill, 0.25), line, fill];
  }
  glowCache.set(element, g);
  return g;
}

const cache = new Map<string, RGB[]>();

/** The 16-step palette for a type (0..1 display RGB, before ×EMISSIVE). */
export function auraPalette(element: string): RGB[] {
  let pal = cache.get(element);
  if (!pal) {
    if (element === 'Fire') {
      // Warm band (start 0.55, sweep 1.70), redness 0, floor EMBER = 0.55.
      pal = fireWheel(0.55, 0.55 + 1.70, 0.55);
    } else {
      const p = PAIRS[element] ?? PAIRS.Normal;
      pal = pair(p[0], p[1], p[2]);
    }
    cache.set(element, pal);
  }
  return pal;
}

/**
 * The hue the body and the film are tinted toward: the chroma-weighted mean
 * of the palette, so a near-white entry does not wash it out (§1.5).
 */
export function auraHue(pal: RGB[]): RGB {
  const sum: RGB = [0, 0, 0];
  let w = 0;
  for (const c of pal) {
    const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const chroma = Math.hypot(c[0] - L, c[1] - L, c[2] - L);
    sum[0] += c[0] * chroma; sum[1] += c[1] * chroma; sum[2] += c[2] * chroma;
    w += chroma;
  }
  if (w < 1e-6) {
    const n = pal.length;
    return [0, 1, 2].map((k) => pal.reduce((a, c) => a + c[k], 0) / n) as RGB;
  }
  return [sum[0] / w, sum[1] / w, sum[2] / w];
}
