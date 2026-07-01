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

/** Highlight colors used by HexBoard.highlightTiles. */
export const HIGHLIGHT_COLORS = {
  move: '#3B82F6', // blue
  attack: '#EF4444', // red
  path: '#F5F5F5', // white
  aoe: '#F97316', // orange
  target: '#FACC15', // yellow
} as const;

export type HighlightType = keyof typeof HIGHLIGHT_COLORS;
