/** Which moves are wind/tornado effects (WindFx), and how. */

export interface WindSpec {
  /** Both grow out of the ground on the target: 'gust' small and brief, 'twister' big and held. */
  kind: 'gust' | 'twister';
  element: string;
}

export const WIND_MOVES: Record<string, WindSpec> = {
  Gust: { kind: 'gust', element: 'Flying' },
  Twister: { kind: 'twister', element: 'Dragon' },
};

export function windFor(moveName: string | null | undefined): WindSpec | null {
  return (moveName && WIND_MOVES[moveName]) || null;
}
