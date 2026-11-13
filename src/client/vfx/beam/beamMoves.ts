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
  /** Out of a clash, the whole beam one long egg, broad and round at the target (BeamShot.eggBeam: Flamethrower). */
  eggBeam?: boolean;
  /** Its end ball only while this says so (BeamShot.endBall: its front on a target). */
  endBall?: () => boolean;
  /** How far it reaches (world units) where range matters (the platformer); unset: a long beam. */
  range?: number;
  /** How thick it is (1 = as the others). */
  thickness?: number;
  /** A bolt from the beam's starting egg, in place of its column (BeamShot.bolt). */
  bolt?: boolean;
  /** A bolt: who it is on now (struck by it), its end run into that one's body (none: out to its front). */
  onto?: () => import('@babylonjs/core/Meshes/transformNode').TransformNode | null;
  /** Its end exactly on its target point — not stopped short where a body's surface would be (BeamShot.exactTarget). */
  exactTarget?: boolean;
  /** A bolt straight off the body: no egg (Thunderbolt in a clash; BeamShot.eggless). */
  eggless?: boolean;
  /**
   * A bolt drawn as its user's aura, as Thunderbolt's is (eggless bolts always are): its user wearing its type's aura
   * as it fires, the bolt, its starting egg and its half of a clash's ball all painted by that aura (Ice Beam).
   */
  auraBolt?: boolean;
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
  /**
   * Which beam it is: 1 (the default) the layered beam — core, body and torn
   * skin, swirled; 2 the aura beam — its white core alone, rimmed in its
   * type's spiking aura outline, rings of stars streaming along it (BeamFx:
   * OUTLINE, RINGS). Both charge, launch and release alike.
   */
  style?: 1 | 2;
  /** Its half of a clash's ball in the other beam's style (Ice Beam: beam 2's egg, beam 1's clash ball). Unset: as `style`. */
  clashStyle?: 1 | 2;
  /** Beam 2's outline: 'cel' (default) a flat band in its type's outline colour; 'soft' a glow, fading out to its edge. */
  outline?: 'cel' | 'soft';
}

/** A type's beam colours with the darker and lighter swapped: its fill as the heavy noise, its outline as the body. */
function swapped(element: string): BeamPalette {
  const [, , line, fill] = auraGlow(element);
  return { skin: fill, body: line };
}

export const BEAM_MOVES: Record<string, BeamSpec> = {
  // Beam 2, the aura beam (its outlined white core, its spikes, rings of stars and bands): Dragon Pulse, Hyper Beam,
  // Solar Beam, Flash Cannon, Steel Beam.
  'Dragon Pulse': { element: 'Dragon', style: 2 },
  'Hyper Beam': { element: 'Normal', style: 2 },
  // An icy thunderbolt, out of a beam's starting egg.
  // (Built as Thunderbolt is — drawn as its user's Ice aura — out of beam 2's starting egg, small: thickness.)
  'Ice Beam': { element: 'Ice', bolt: true, style: 2, auraBolt: true, thickness: 0.25 },
  'Aurora Beam': { element: 'Ice' },
  'Solar Beam': { element: 'Grass', style: 2 },
  'Flash Cannon': { element: 'Steel', style: 2 },
  // A psychic bolt, built as Ice Beam is: drawn as its user's Psychic aura, out of beam 2's starting egg, small.
  'Psybeam': { element: 'Psychic', bolt: true, style: 2, auraBolt: true, thickness: 0.25 },
  'Signal Beam': { element: 'Bug' },
  'Charge Beam': { element: 'Electric' },
  'Hydro Pump': { element: 'Water' },
  'Hydro Cannon': { element: 'Water' },
  'Steel Beam': { element: 'Steel', style: 2 },
  // A fire beam, billowing all along.
  'Flamethrower': { element: 'Fire', burstAlong: true, eggBeam: true, range: 6 },
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
  // Roar of Time (Dialga's): beam 2 in Dialga's colours — a deep steel-navy outline and rings round a pale steel-cyan
  // core (its body's blue, its chest's glow).
  'Roar of Time': { element: 'Dragon', style: 2, palette: { skin: [0.06, 0.13, 0.4], body: [0.55, 0.8, 1.0] } },
  // Photon Geyser (Necrozma's): beam 2 in Ultra Necrozma's colours — a deep amber-gold outline and rings round a pale
  // gold-white core (its golden body, its blazing light).
  'Photon Geyser': { element: 'Psychic', style: 2, palette: { skin: [0.62, 0.34, 0.0], body: [1.0, 0.86, 0.32] } },
  // Core Enforcer (Zygarde's): beam 2 in Zygarde's colours, from its model — its near-black body as the outline and
  // rings, its acid lime-green round a lime-white core.
  'Core Enforcer': { element: 'Dragon', style: 2, palette: { skin: [0.05, 0.05, 0.04], body: [0.45, 0.85, 0.1] } },
  // Fleur Cannon (Magearna's): beam 2 in Mega Magearna's colours, from its model — its crimson as the outline and
  // rings round a gold-white core (its gold trim).
  'Fleur Cannon': { element: 'Fairy', style: 2, palette: { skin: [0.55, 0.03, 0.07], body: [0.95, 0.76, 0.21] } },
  // Eternabeam (Eternatus's): beam 2 in Eternatus's colours — its dark violet body as the outline and rings round its
  // glowing crimson core (set outright: drawn from the red, it would come out pink).
  'Eternabeam': { element: 'Dragon', style: 2, palette: { skin: [0.16, 0.03, 0.24], body: [0.9, 0.08, 0.18], core: [0.78, 0.02, 0.06] } },
  // Electro Shot (Archaludon's): beam 2 in Archaludon's colours — its dark steel-navy plates as the outline and rings
  // round the electric yellow of its glowing seams (set outright, so it stays yellow).
  'Electro Shot': { element: 'Electric', style: 2, palette: { skin: [0.1, 0.14, 0.26], body: [1.0, 0.86, 0.18], core: [0.98, 0.84, 0.12] } },
  // Dragon Energy (Regidrago's): beam 2 in Regidrago's black and red — a black outline and rings round a deep red core
  // (set outright, so it stays red).
  'Dragon Energy': { element: 'Dragon', style: 2, palette: { skin: [0.03, 0.02, 0.02], body: [0.85, 0.06, 0.08], core: [0.78, 0.03, 0.05] } },
};

export function beamFor(moveName: string | null | undefined): BeamSpec | null {
  return (moveName && BEAM_MOVES[moveName]) || null;
}
