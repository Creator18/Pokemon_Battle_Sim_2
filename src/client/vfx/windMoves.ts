/** Which moves are wind/tornado effects (WindFx), and how. */

export interface WindSpec {
  /** They grow out of the ground on the target: 'gust' small and brief, 'twister' big and held, 'tomb' its outer whirl alone, held. */
  kind: 'gust' | 'twister' | 'tomb';
  element: string;
}

export const WIND_MOVES: Record<string, WindSpec> = {
  Gust: { kind: 'gust', element: 'Flying' },
  Twister: { kind: 'twister', element: 'Dragon' },
  // A plain (not cel-shaded) whirl of sand: the tornado's outer shell alone, in Ground's colours.
  'Sand Tomb': { kind: 'tomb', element: 'Ground' },
};

export function windFor(moveName: string | null | undefined): WindSpec | null {
  return (moveName && WIND_MOVES[moveName]) || null;
}
