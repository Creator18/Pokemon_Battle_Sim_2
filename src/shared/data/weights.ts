/**
 * Main-series weight (kg) and height (m) per species (raw/weights.json, from Pokémon Showdown's public Pokédex), and
 * who is light enough to double jump.
 *
 * Light enough: both its weight (≤ LIGHT_KG) and its model's size (its rest pose's box, ≤ LIGHT_VOLUME m³) say so.
 * Where the two disagree, JUMP_CALLS decides (a call made by hand, species by species); a species with no call yet
 * goes by its weight.
 */
import weightData from './raw/weights.json' with { type: 'json' };

const SPECIES = (weightData as { species: Record<string, { kg: number; m: number }> }).species;

/** Light by weight: this many kg or less. */
export const LIGHT_KG = 50;
/** Light by size: its model's rest-pose box this many m³ or less. */
export const LIGHT_VOLUME = 2;

/** Weight and size disagreeing: decided by hand (true: it double jumps). */
export const JUMP_CALLS: Record<string, boolean> = {};

/** Its main-series weight (kg), if known. */
export function weightOf(name: string): number | undefined { return SPECIES[name]?.kg; }

/** Whether it is light enough to double jump, given its model's rest-pose box (m³). */
export function canDoubleJump(name: string, volume: number): boolean {
  const kg = weightOf(name);
  const byWeight = kg !== undefined ? kg <= LIGHT_KG : volume <= LIGHT_VOLUME;
  const bySize = volume <= LIGHT_VOLUME;
  if (byWeight === bySize) return byWeight;
  return JUMP_CALLS[name] ?? byWeight;
}
