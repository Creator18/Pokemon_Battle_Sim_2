/**
 * Each species' moves: the four it would normally have (from what it learns — by level, TM or tutor — among the moves
 * built here), in its kit's four slots: ranged, close, mobility, control. A slot it has nothing for is left empty.
 *
 * (To come: a Pokémon's moves picked from a pool it remembers, unlocked by its stars — four at a time; the menu for
 * picking them later. These are its natural four meanwhile.)
 */
import type { MoveKit } from './Fighter.ts';
import { DEFAULT_KIT } from './Fighter.ts';

export const NATURAL_KITS: Record<string, MoveKit> = {
  // Kanto's starters.
  Bulbasaur: { ranged: 'Solar Beam', close: 'Take Down' },
  Ivysaur: { ranged: 'Solar Beam', close: 'Take Down' },
  Charmander: { ranged: 'Flamethrower', close: 'Slash', control: 'Detect' },
  Charmeleon: { ranged: 'Flamethrower', close: 'Slash', mobility: 'Quick Attack', control: 'Detect' },
  Squirtle: { ranged: 'Hydro Pump', close: 'Iron Tail', mobility: 'Aqua Jet', control: 'Detect' },
  Wartortle: { ranged: 'Hydro Pump', close: 'Iron Tail', mobility: 'Aqua Jet', control: 'Detect' },
  Pikachu: { ranged: 'Thunderbolt', close: 'Iron Tail', mobility: 'Quick Attack', control: 'Detect' },
  Pichu: { ranged: 'Thunderbolt', mobility: 'Quick Attack', control: 'Detect' },
  // Route 1's.
  Pidgey: { close: 'Aerial Ace', mobility: 'Quick Attack', control: 'Detect' },
  Pidgeotto: { close: 'Aerial Ace', mobility: 'Quick Attack', control: 'Detect' },
  Pidgeot: { ranged: 'Hyper Beam', close: 'Brave Bird', mobility: 'Quick Attack', control: 'Detect' },
  Spinarak: { ranged: 'Signal Beam', close: 'X-Scissor', control: 'Sucker Punch' },
  Bellsprout: { ranged: 'Solar Beam', control: 'Sucker Punch' },
  Charizard: { ranged: 'Flamethrower', close: 'Dragon Claw', mobility: 'Quick Attack', control: 'Detect' },
  Dragonite: { ranged: 'Dragon Pulse', close: 'Outrage', mobility: 'Extreme Speed', control: 'Detect' },
};

/** Its natural moves (NATURAL_KITS), or a stand-in. */
export function kitFor(species: string): MoveKit {
  return NATURAL_KITS[species] ?? DEFAULT_KIT;
}

/**
 * Wild ones that don't wait to be struck: they attack whoever comes near (unusually aggressive — a Spinarak's ambush, a
 * wild Charizard, a Dragonite). The rest only fight back.
 */
export const AGGRESSIVE = new Set(['Spinarak', 'Charizard', 'Dragonite']);
