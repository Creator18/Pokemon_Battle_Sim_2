/**
 * Which moves are lightning (LightningFx), and how:
 * - bolt: a thick bolt from the attacker to the target (Thunderbolt);
 * - thunder: an even thicker bolt out of the sky onto the target (Thunder);
 * - discharge: the attacker earths into the tiles round it and bolts the target (Discharge);
 * - spark: thin bolts at the target (Thunder Wave, Electro Web).
 * Every Electric aura also earths body-to-ground strokes (RecipeFactory.aura).
 */

export interface LightningSpec {
  kind: 'bolt' | 'thunder' | 'discharge' | 'spark';
  /** It missed (Thunder): the bolts fall, but none on the target. */
  miss?: boolean;
}

export const LIGHTNING_MOVES: Record<string, LightningSpec> = {
  Thunderbolt: { kind: 'bolt' },
  Thunder: { kind: 'thunder' },
  Discharge: { kind: 'discharge' },
  'Thunder Wave': { kind: 'spark' },
  'Electro Web': { kind: 'spark' },
};

export function lightningFor(moveName: string | null | undefined): LightningSpec | null {
  return (moveName && LIGHTNING_MOVES[moveName]) || null;
}
