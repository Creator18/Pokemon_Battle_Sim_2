/**
 * Each move's own accuracy, as the main series has it (%) — here, how fast the move travels once it's launched (a
 * dexterity: Fire Blast's 85 flies at 85% of the speed a sure move does). Only the moves below 100 are listed; anything
 * else, its data's figure, else 100. Its user's accuracy stage then quickens or slows it further (Fighter.paceOf).
 */
import { getMove } from '../../shared/index.ts';

const ACCURACY: Record<string, number> = {
  'Fire Blast': 85, 'Hydro Pump': 80, 'Focus Blast': 70, 'Stone Edge': 80, 'Thunder': 70, 'Hypnosis': 60, 'Head Smash': 80,
  'Iron Tail': 75, 'Play Rough': 90, 'Fire Fang': 95, 'Ice Fang': 95, 'Dragon Rush': 75, 'Sky Attack': 90, 'Fleur Cannon': 90,
  'Hyper Beam': 90, 'Giga Impact': 90, 'Take Down': 85, 'Meteor Beam': 90, 'Electro Web': 95, 'Fire Spin': 85, 'Sand Tomb': 85,
  'Whirlpool': 85, 'Steel Beam': 95, 'Roar of Time': 90, 'Eternabeam': 90, 'Hydro Cannon': 90, 'Light of Ruin': 90,
  'Air Slash': 95, 'Charge Beam': 90, 'Thunder Wave': 90, 'Metal Sound': 85,
};

/** A move's accuracy (0..1): how fast it travels, of a sure move's speed. */
export function moveAccuracy(move: string | null | undefined): number {
  if (!move) return 1;
  const a = ACCURACY[move] ?? getMove(move)?.accuracy ?? 100;
  return Math.max(0.3, Math.min(1, a / 100));
}
