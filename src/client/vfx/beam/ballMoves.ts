/**
 * Which moves are ball attacks (BallFx), and in which colours. A ball wears
 * its type's aura colours unless the move gives its own.
 */
import type { RGB } from '../auraPalette.ts';

export interface BallColours {
  /** The heavy noise: the strand network orbiting the ball. */
  heavy: RGB;
  /** The light noise: the thin bright rings further out. */
  light: RGB;
  /** The rest: the sphere itself (core and body). */
  fill: RGB;
}

export interface BallSpec {
  /** The type whose aura colours it wears (auraPalette.auraGlow). */
  element: string;
  /** Its own colours, over the type's. */
  colours?: BallColours;
  /** Its noise the Flying coat's tornado spheres, two at a slant, round a stable white core that grows inside them (BallShot.noise). */
  tornado?: boolean;
  /** Its burst on the target a sphere of flame (FireFx.FireSphere) instead of its noise swelling out (Fire Blast). */
  burst?: 'fire';
  /** Not a ball at all: Flamethrower's starting egg, small, shot round-end first (EmberFx) — quick to throw. */
  ember?: boolean;
}

export const BALL_MOVES: Record<string, BallSpec> = {
  'Shadow Ball': { element: 'Ghost' },
  // Flamethrower's starting egg, small, shot at the foe — its round end leading, its tail streaming back.
  'Ember': { element: 'Fire', ember: true },
  'Aeroblast': { element: 'Flying', tornado: true },
  'Moonblast': { element: 'Fairy', tornado: true },
  'Fire Blast': { element: 'Fire', tornado: true, burst: 'fire' },
  'Focus Blast': { element: 'Fighting' },
  // Lucario's aura: a white sphere in a dark-blue network, light-blue rings.
  'Aura Sphere': { element: 'Fighting', colours: { heavy: [0.04, 0.12, 0.55], light: [0.45, 0.78, 1.0], fill: [1, 1, 1] }, tornado: true },
};

export function ballFor(moveName: string | null | undefined): BallSpec | null {
  return (moveName && BALL_MOVES[moveName]) || null;
}
