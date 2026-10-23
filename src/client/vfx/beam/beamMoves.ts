/**
 * Which moves are beams, and in which colours. They all share BeamFx's
 * format; Flamethrower is a fire beam that billows all along. Moonblast is
 * NOT a beam (it is a ball: ballMoves). Psychic, Water Pulse and Dark Pulse
 * are sonar pulses (PulseFx).
 */
import { auraGlow } from '../auraPalette.ts';
import type { BeamPalette } from './BeamFx.ts';
import type { BallColours } from './ballMoves.ts';

export interface BeamSpec {
  /** The type whose aura colours it wears (auraPalette.auraGlow). */
  element: string;
  /** Its own colours, over the type's. */
  palette?: BeamPalette;
  /** Its noise bursts all along the column, past its starting egg (flame billowing: Flamethrower). */
  burstAlong?: boolean;
  /** How thick it is (1 = as the others). */
  thickness?: number;
  /** A bolt from the beam's starting egg, in place of its column (BeamShot.bolt). */
  bolt?: boolean;
  /** A bolt straight off the body: no egg (Thunderbolt in a clash; BeamShot.eggless). */
  eggless?: boolean;
  /** A ball attack in a clash: it flies in and becomes its half of the clash's ball (RecipeFactory.clashBall). */
  ball?: BallColours | true;
  /** A tornado ball (BallSpec.tornado): its half of the clash's ball the moving tornado's half, not the noise. */
  tornado?: boolean;
  /**
   * A pulse attack in a clash (RecipeFactory.clashPulse): it keeps pulsing,
   * each pulse bursting against the other's half of the ball (it has no half
   * of its own); `scale` its rings' (PulseSpec.scale).
   */
  pulse?: { scale?: number };
}

/** A type's beam colours with the darker and lighter swapped: its fill as the heavy noise, its outline as the body. */
function swapped(element: string): BeamPalette {
  const [, , line, fill] = auraGlow(element);
  return { skin: fill, body: line };
}

export const BEAM_MOVES: Record<string, BeamSpec> = {
  'Dragon Pulse': { element: 'Dragon' },
  'Hyper Beam': { element: 'Normal' },
  // An icy thunderbolt, out of a beam's starting egg.
  'Ice Beam': { element: 'Ice', bolt: true },
  'Aurora Beam': { element: 'Ice' },
  'Solar Beam': { element: 'Grass' },
  'Flash Cannon': { element: 'Steel' },
  // A psychic bolt, out of a beam's starting egg (as Ice Beam).
  'Psybeam': { element: 'Psychic', bolt: true },
  'Signal Beam': { element: 'Bug' },
  'Charge Beam': { element: 'Electric' },
  'Hydro Pump': { element: 'Water' },
  'Hydro Cannon': { element: 'Water' },
  'Steel Beam': { element: 'Steel' },
  // A fire beam, billowing all along.
  'Flamethrower': { element: 'Fire', burstAlong: true },
  // Flamethrower's billowing flame in fire and psychic together: its torn
  // skin in fire red and psychic pink, round a hot pink-orange body.
  'Mystical Fire': { element: 'Fire', burstAlong: true, palette: { skin: [1.0, 0.3, 0.06], body: [1.0, 0.5, 0.72],
    skins: [[1.0, 0.3, 0.06], [0.92, 0.16, 0.58], [1.0, 0.6, 0.2]] } },
  // Dragon Pulse's colours, billowing as Flamethrower does.
  'Dragon Rage': { element: 'Dragon', burstAlong: true, thickness: 0.65 },
  'Meteor Beam': { element: 'Rock', palette: swapped('Rock') },
  // Ghost's colours swapped: purple noise over a black body.
  'Moongeist Beam': { element: 'Ghost', palette: swapped('Ghost') },
  // White (Normal's) under a heavy noise of fire, electricity and ice together.
  'Tri Attack': { element: 'Normal', palette: { skin: [1.0, 0.18, 0.03], body: [0.96, 0.96, 0.96], skins: [
    [1.0, 0.18, 0.03], // fire (its outline red)
    [1.0, 0.56, 0.02], // electricity (its amber glow)
    [0.2, 0.65, 0.95], // ice (its outline blue)
  ] } },
  // Black noise over white.
  'Light of Ruin': { element: 'Fairy', palette: { skin: [0.03, 0.03, 0.04], body: [0.92, 0.92, 0.95] } },
  // Mega Zygarde's: a pink heavy noise over a purple light noise.
  'Nihil Light': { element: 'Dragon', palette: { skin: [1.0, 0.25, 0.65], body: [0.55, 0.2, 0.95] } },
};

export function beamFor(moveName: string | null | undefined): BeamSpec | null {
  return (moveName && BEAM_MOVES[moveName]) || null;
}
