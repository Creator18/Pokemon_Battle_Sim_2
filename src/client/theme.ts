/**
 * Shared visual theme: colors, type palette, terrain palette.
 * Kept dependency-light (plain hex strings + numeric RGB tuples) so both the
 * DOM UI (CSS) and Babylon (Color3) layers can consume it.
 */

export const THEME = {
  bg: '#0D0D1A',
  panel: '#16162A',
  panelAlt: '#1F1F38',
  accent: '#EF4444',
  accentDim: '#B91C1C',
  text: '#E8E8F0',
  textDim: '#9A9AB8',
  border: '#2E2E4E',
  good: '#34D399',
  warn: '#FBBF24',
  bad: '#EF4444',
} as const;

/** Per-Pokemon-type accent color (hex string). */
export const TYPE_COLORS: Record<string, string> = {
  Normal: '#A8A878',
  Fire: '#F08030',
  Water: '#6890F0',
  Electric: '#F8D030',
  Grass: '#78C850',
  Ice: '#98D8D8',
  Fighting: '#C03028',
  Poison: '#A040A0',
  Ground: '#E0C068',
  Flying: '#A890F0',
  Psychic: '#F85888',
  Bug: '#A8B820',
  Rock: '#B8A038',
  Ghost: '#705898',
  Dragon: '#7038F8',
  Dark: '#705848',
  Steel: '#B8B8D0',
  Fairy: '#EE99AC',
};

export function typeColor(type: string): string {
  return TYPE_COLORS[type] ?? '#8888AA';
}

/** Hex string (#rrggbb) → normalized [r,g,b]. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [r, g, b];
}

/**
 * Warm painterly environment palette (AFK-Journey-style autumn clearing).
 * Consumed by Environment.ts, BattleCamera.ts and HexBoard tile styling.
 */
export const ENV = {
  // Sky / atmosphere
  skyHorizon: '#F4D9B0', // warm cream/peach at horizon
  skyTop: '#8FB8D8', // soft blue overhead
  fog: '#E7D2A8', // warm haze
  clear: '#EAD6AE', // fallback clear color

  // Ground
  grass: '#7C8A4E', // sage/olive meadow
  grassAlt: '#8E9A5A', // lighter patch
  grassDark: '#657043', // shaded patch
  dirtCenter: '#C9A36B', // warm sandy arena center
  dirtEdge: '#A98450', // arena rim

  // Tiles (grassy/earthy tops)
  tileGrass: '#88924F',
  tileGrassAlt: '#7B854A',
  tileEarth: '#A88B58',

  // Scenery
  trunk: '#6B4A2E',
  rock: '#8A8880',
  rockMoss: '#6E7A4A',
  log: '#5E4028',
  bush: '#6E8340',

  // Autumn canopy palette (pick randomly per tree)
  canopy: ['#C9902F', '#E0A83C', '#B9C24B', '#8DA24A', '#D9772E', '#A8B24A'],

  // Lights
  keyLight: '#FFE6BE', // warm golden key
  keySpec: '#FFD9A0',
  skyFill: '#FFE9CC', // warm cream sky bounce
  groundFill: '#5C6B3E', // mossy green ground bounce
} as const;

/** Highlight colors used by HexBoard.highlightTiles. */
export const HIGHLIGHT_COLORS = {
  move: '#3B82F6', // blue
  attack: '#EF4444', // red
  path: '#F5F5F5', // white
  aoe: '#F97316', // orange
  target: '#FACC15', // yellow
} as const;

export type HighlightType = keyof typeof HIGHLIGHT_COLORS;
