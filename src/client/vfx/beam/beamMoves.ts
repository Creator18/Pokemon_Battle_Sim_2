/**
 * Which moves are beams, and in which colours. They all share BeamFx's
 * format; Flamethrower is a fire beam that billows all along. Moonblast is
 * NOT a beam (its own effect is to come). Psychic, Water Pulse and Dark Pulse
 * are sonar pulses (PulseFx).
 */

import { auraGlow } from '../auraPalette.ts';
import type { BeamPalette } from './BeamFx.ts';

export interface BeamSpec {
  /** The type whose aura colours it wears (auraPalette.auraGlow). */
  element: string;
  /** Its own colours, over the type's. */
  palette?: BeamPalette;
  /** Its noise bursts all along the column, past its starting egg (flame billowing: Flamethrower). */
  burstAlong?: boolean;
  /** How thick it is (1 = as the others). */
  thickness?: number;
}

/** A type's beam colours with the darker and lighter swapped: its fill as the heavy noise, its outline as the body. */
function swapped(element: string): BeamPalette {
  const [, , line, fill] = auraGlow(element);
  return { skin: fill, body: line };
}

export const BEAM_MOVES: Record<string, BeamSpec> = {
  'Dragon Pulse': { element: 'Dragon' },
  'Hyper Beam': { element: 'Normal' },
  'Ice Beam': { element: 'Ice' },
  'Aurora Beam': { element: 'Ice' },
  'Solar Beam': { element: 'Grass' },
  'Flash Cannon': { element: 'Steel' },
  'Psybeam': { element: 'Psychic' },
  'Signal Beam': { element: 'Bug' },
  'Charge Beam': { element: 'Electric' },
  'Hydro Pump': { element: 'Water' },
  'Hydro Cannon': { element: 'Water' },
  'Steel Beam': { element: 'Steel' },
  // A fire beam, billowing all along.
  'Flamethrower': { element: 'Fire', burstAlong: true },
  // Dragon Pulse's colours, billowing as Flamethrower does.
  'Dragon Rage': { element: 'Dragon', burstAlong: true, thickness: 0.65 },
  'Meteor Beam': { element: 'Rock', palette: swapped('Rock') },
  // Ghost's colours swapped: purple noise over a black body.
  'Moongeist Beam': { element: 'Ghost', palette: swapped('Ghost') },
  // Black noise over white.
  'Light of Ruin': { element: 'Fairy', palette: { skin: [0.03, 0.03, 0.04], body: [0.92, 0.92, 0.95] } },
};

export function beamFor(moveName: string | null | undefined): BeamSpec | null {
  return (moveName && BEAM_MOVES[moveName]) || null;
}
