/**
 * Dev sweep (not part of the game): checkMorph over every evolution, Mega
 * Evolution / Primal Reversion, and form change in the roster.
 */
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { getSpecies } from '../../shared/index.ts';
import { checkMorph, type MorphCheck } from './evoCheck.ts';

const CHAINS = [
  ['Bulbasaur', 'Ivysaur', 'Venusaur'], ['Charmander', 'Charmeleon', 'Charizard'], ['Squirtle', 'Wartortle', 'Blastoise'], ['Weedle', 'Kakuna', 'Beedrill'],
  ['Pidgey', 'Pidgeotto', 'Pidgeot'], ['Ekans', 'Arbok'], ['Pichu', 'Pikachu', 'Raichu'], ['Cleffa', 'Clefairy', 'Clefable'], ['Igglybuff', 'Jigglypuff', 'Wigglytuff'],
  ['Zubat', 'Golbat', 'Crobat'], ['Meowth', 'Persian'], ['Galarian Meowth', 'Perrserker'], ['Mankey', 'Primeape'], ['Abra', 'Kadabra', 'Alakazam'],
  ['Machop', 'Machoke', 'Machamp'], ['Bellsprout', 'Weepinbell', 'Victreebel'], ['Slowpoke', 'Slowbro'], ['Slowpoke', 'Slowking'],
  ['Galarian Slowpoke', 'Galarian Slowbro'], ['Galarian Slowpoke', 'Galarian Slowking'], ['Galarian Farfetch’d', 'Sirfetch’d'],
  ['Gastly', 'Haunter', 'Gengar'], ['Onix', 'Steelix'], ['Cubone', 'Marowak'], ['Staryu', 'Starmie'], ['Mime Jr.', 'Mr. Mime'], ['Mime Jr.', 'Galarian Mr. Mime', 'Mr. Rime'],
  ['Scyther', 'Scizor'], ['Magikarp', 'Gyarados'], ['Eevee', 'Vaporeon'], ['Eevee', 'Jolteon'], ['Eevee', 'Flareon'], ['Eevee', 'Espeon'], ['Eevee', 'Umbreon'],
  ['Eevee', 'Leafeon'], ['Eevee', 'Glaceon'], ['Eevee', 'Sylveon'], ['Porygon', 'Porygon2', 'Porygon-Z'], ['Dratini', 'Dragonair', 'Dragonite'],
  ['Chikorita', 'Bayleef', 'Meganium'], ['Totodile', 'Croconaw', 'Feraligatr'], ['Spinarak', 'Ariados'], ['Mareep', 'Flaaffy', 'Ampharos'], ['Houndour', 'Houndoom'],
  ['Larvitar', 'Pupitar', 'Tyranitar'], ['Treecko', 'Grovyle', 'Sceptile'], ['Torchic', 'Combusken', 'Blaziken'], ['Mudkip', 'Marshtomp', 'Swampert'],
  ['Ralts', 'Kirlia', 'Gardevoir'], ['Kirlia', 'Gallade'], ['Aron', 'Lairon', 'Aggron'], ['Meditite', 'Medicham'], ['Electrike', 'Manectric'], ['Budew', 'Roselia', 'Roserade'],
  ['Gulpin', 'Swalot'], ['Carvanha', 'Sharpedo'], ['Numel', 'Camerupt'], ['Spoink', 'Grumpig'], ['Swablu', 'Altaria'], ['Feebas', 'Milotic'], ['Shuppet', 'Banette'],
  ['Chingling', 'Chimecho'], ['Snorunt', 'Glalie'], ['Snorunt', 'Froslass'], ['Bagon', 'Shelgon', 'Salamence'], ['Beldum', 'Metang', 'Metagross'],
  ['Starly', 'Staravia', 'Staraptor'], ['Buneary', 'Lopunny'], ['Gible', 'Gabite', 'Garchomp'], ['Riolu', 'Lucario'], ['Hippopotas', 'Hippowdon'], ['Snover', 'Abomasnow'],
  ['Tepig', 'Pignite', 'Emboar'], ['Patrat', 'Watchog'], ['Purrloin', 'Liepard'], ['Pansage', 'Simisage'], ['Pansear', 'Simisear'], ['Panpour', 'Simipour'], ['Munna', 'Musharna'],
  ['Drilbur', 'Excadrill'], ['Venipede', 'Whirlipede', 'Scolipede'], ['Sandile', 'Krokorok', 'Krookodile'], ['Scraggy', 'Scrafty'], ['Yamask', 'Cofagrigus'],
  ['Galarian Yamask', 'Runerigus'], ['Trubbish', 'Garbodor'], ['Vanillite', 'Vanillish', 'Vanilluxe'], ['Foongus', 'Amoonguss'], ['Tynamo', 'Eelektrik', 'Eelektross'],
  ['Litwick', 'Lampent', 'Chandelure'], ['Golett', 'Golurk'], ['Phantump', 'Trevenant'], ['Litleo', 'Pyroar'], ['Scatterbug', 'Spewpa', 'Vivillon'], ['Skrelp', 'Dragalge'],
  ['Bunnelby', 'Diggersby'], ['Flabébé', 'Floette', 'Florges'], ['Noibat', 'Noivern'], ['Fennekin', 'Braixen', 'Delphox'], ['Chespin', 'Quilladin', 'Chesnaught'],
  ['Froakie', 'Frogadier', 'Greninja'], ['Inkay', 'Malamar'], ['Skiddo', 'Gogoat'], ['Pancham', 'Pangoro'], ['Helioptile', 'Heliolisk'], ['Espurr', 'Meowstic'],
  ['Pumpkaboo', 'Gourgeist'], ['Tyrunt', 'Tyrantrum'], ['Amaura', 'Aurorus'], ['Swirlix', 'Slurpuff'], ['Honedge', 'Doublade', 'Aegislash'], ['Binacle', 'Barbaracle'],
  ['Bergmite', 'Avalugg'], ['Bergmite', 'Hisuian Avalugg'], ['Fletchling', 'Fletchinder', 'Talonflame'], ['Clauncher', 'Clawitzer'], ['Spritzee', 'Aromatisse'],
  ['Goomy', 'Sliggoo', 'Goodra'], ['Goomy', 'Hisuian Sliggoo', 'Hisuian Goodra'], ['Sandygast', 'Palossand'], ['Crabrawler', 'Crabominable'], ['Wimpod', 'Golisopod'],
  ['Meltan', 'Melmetal'], ['Nickit', 'Thievul'], ['Rookidee', 'Corvisquire', 'Corviknight'], ['Toxel', 'Toxtricity'], ['Clobbopus', 'Grapploct'],
];
const MEGAS = ['Mega Venusaur', 'Mega Charizard X', 'Mega Charizard Y', 'Mega Blastoise', 'Mega Beedrill', 'Mega Pidgeot', 'Mega Raichu X', 'Mega Raichu Y',
  'Mega Clefable', 'Mega Alakazam', 'Mega Victreebel', 'Mega Slowbro', 'Mega Gengar', 'Mega Kangaskhan', 'Mega Starmie', 'Mega Pinsir', 'Mega Gyarados',
  'Mega Aerodactyl', 'Mega Dragonite', 'Mega Mewtwo X', 'Mega Mewtwo Y', 'Mega Meganium', 'Mega Feraligatr', 'Mega Ampharos', 'Mega Steelix', 'Mega Scizor',
  'Mega Heracross', 'Mega Skarmory', 'Mega Houndoom', 'Mega Tyranitar', 'Mega Sceptile', 'Mega Blaziken', 'Mega Swampert', 'Mega Gardevoir', 'Mega Sableye',
  'Mega Mawile', 'Mega Aggron', 'Mega Medicham', 'Mega Manectric', 'Mega Sharpedo', 'Mega Camerupt', 'Mega Altaria', 'Mega Banette', 'Mega Chimecho',
  'Mega Absol', 'Mega Absol Z', 'Mega Glalie', 'Mega Salamence', 'Mega Metagross', 'Mega Latias', 'Mega Latios', 'Primal Kyogre', 'Primal Groudon',
  'Mega Rayquaza', 'Mega Staraptor', 'Mega Lopunny', 'Mega Garchomp', 'Mega Garchomp Z', 'Mega Lucario', 'Mega Lucario Z', 'Mega Abomasnow', 'Mega Gallade',
  'Mega Froslass', 'Mega Heatran', 'Mega Darkrai', 'Mega Emboar', 'Mega Excadrill', 'Mega Audino', 'Mega Scolipede', 'Mega Scrafty', 'Mega Eelektross',
  'Mega Chandelure', 'Mega Golurk', 'Mega Pyroar', 'Mega Dragalge', 'Mega Floette', 'Mega Delphox', 'Mega Chesnaught', 'Mega Greninja', 'Mega Malamar',
  'Mega Meowstic', 'Mega Barbaracle', 'Mega Hawlucha', 'Mega Zygarde', 'Mega Diancie', 'Mega Drampa', 'Mega Crabominable', 'Mega Golisopod', 'Mega Magearna',
  'Mega Magearna (Original Color)', 'Mega Zeraora', 'Mega Falinks'];
const FORMS = [['Zygarde 10%', 'Zygarde 50%'], ['Zygarde 50%', 'Zygarde Complete'], ['Zygarde 10%', 'Zygarde Complete'], ['Hoopa Confined', 'Hoopa Unbound']];

export function sweepPairs(): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (const c of CHAINS) for (let i = 0; i + 1 < c.length; i++) out.push([c[i], c[i + 1], 'evo']);
  for (const m of MEGAS) {
    const base = m.replace(/^(Mega|Primal) /, '').replace(/ (X|Y|Z)$/, '').replace(/ \(Original Color\)$/, '');
    out.push([base === 'Zygarde' ? 'Zygarde Complete' : base, m, 'mega']);
    if (m.startsWith('Primal')) out.push([m, base, 'form']);
  }
  for (const [x, y] of FORMS) out.push([x, y, 'form'], [y, x, 'form']);
  return out;
}

export interface SweepResult extends Partial<MorphCheck> { from: string; to: string; kind: string; error?: string }

/** Run the sweep (results pushed as they come: `into`). */
export async function sweep(factory: { createPokemon: (s: never, p: number) => Promise<TransformNode>; remove: (n: TransformNode) => void },
  at: Vector3, into: SweepResult[], pairs = sweepPairs()): Promise<void> {
  for (const [from, to, kind] of pairs) {
    try {
      const a = await factory.createPokemon(getSpecies(from) as never, 1);
      const b = await factory.createPokemon(getSpecies(to) as never, 1);
      for (const n of [a, b]) { n.position.copyFrom(at); n.rotation.y = 0; }
      b.setEnabled(false);
      await new Promise((r) => setTimeout(r, 20));
      try { into.push({ from, to, kind, ...checkMorph(factory, a, b) }); } finally { factory.remove(a); factory.remove(b); }
    } catch (e) {
      into.push({ from, to, kind, error: String(e).slice(0, 160) });
    }
  }
}
