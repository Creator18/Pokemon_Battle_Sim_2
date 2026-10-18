/**
 * Which moves leave slash marks (SlashFx), and in which colours. A claw
 * rakes three marks; a blade or a slash cuts one longer one (user). Only the
 * contact (physical) ones are here: they cut in front of the striker as its
 * blow lands. The ranged slashes (Air Slash, Air Cutter, Secret Sword,
 * Tachyon Cutter…) would need a cut that flies — not yet.
 */

export interface ClawSpec {
  /** The type whose colours the marks wear (auraPalette.auraGlow; Dragon keeps the source's lavender). */
  element: string;
  /** 3: a claw's rake; 1: a blade's single, longer cut. */
  marks: 1 | 3;
}

const claw = (element: string): ClawSpec => ({ element, marks: 3 });
const blade = (element: string): ClawSpec => ({ element, marks: 1 });

export const CLAW_MOVES: Record<string, ClawSpec> = {
  // Claws: three marks.
  Scratch: claw('Normal'),
  'Fury Swipes': claw('Normal'),
  'Metal Claw': claw('Steel'),
  'Crush Claw': claw('Normal'),
  'Dragon Claw': claw('Dragon'),
  'Shadow Claw': claw('Ghost'),
  'Dire Claw': claw('Poison'),
  // Slashes and blades: one longer mark.
  Cut: blade('Normal'),
  Slash: blade('Normal'),
  'Fury Cutter': blade('Bug'),
  'False Swipe': blade('Normal'),
  'Night Slash': blade('Dark'),
  'Psycho Cut': blade('Psychic'),
  'X-Scissor': blade('Bug'),
  'Cross Poison': blade('Poison'),
  'Leaf Blade': blade('Grass'),
  'Sacred Sword': blade('Fighting'),
  'Razor Shell': blade('Water'),
  'Solar Blade': blade('Grass'),
  'Behemoth Blade': blade('Steel'),
  'Stone Axe': blade('Rock'),
  'Ceaseless Edge': blade('Dark'),
  'Aqua Cutter': blade('Water'),
  'Kowtow Cleave': blade('Dark'),
  'Bitter Blade': blade('Fire'),
  Psyblade: blade('Psychic'),
  'Mighty Cleave': blade('Rock'),
};

export function clawFor(moveName: string | null | undefined): ClawSpec | null {
  return (moveName && CLAW_MOVES[moveName]) || null;
}
