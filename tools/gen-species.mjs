// Generate src/shared/data/raw/pokemon.json for every species with a model
// in the Legends Z-A archives. Run from the repo: `node tools/gen-species.mjs`.
//
//  • which species: every pmDDDD (1–649, see NATIONAL_MAX) in ZA-Poke.zip / ZA-PokeDLC.zip (the folder
//    above this repo, or $POKEMON_ARCHIVES); its base form is _00_00 when
//    there is one, else its lowest form.
//  • names, types, base stats, genus: PokéAPI, fetched once and cached in
//    tools/.pokeapi-cache.json. IDs PokéAPI doesn't know are skipped.
//  • HP: inflated as the hand-made six are (≈ base + 50, to the nearest 5, at least 100).
//  • movepool: 2 terrain, 2 status, 2 ranged, 2 physical from the moves the
//    engine has, preferring the species' types (type-themed lists), then
//    generic fallbacks; status leans to its stronger attacking stat.
//  • huge (every legendary, or real height ≥ HUGE_HEIGHT m; minus NOT_HUGE):
//    stands on a triangle of three tiles.
//  • the hand-tuned six are kept exactly as they are.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const archives = process.env.POKEMON_ARCHIVES || path.resolve(repo, '..');
const OUT = path.join(repo, 'src/shared/data/raw/pokemon.json');
const CACHE = path.join(here, '.pokeapi-cache.json');

// ── forms with a model ──
const forms = new Map(); // dex -> [form ids]
for (const z of ['ZA-Poke.zip', 'ZA-PokeDLC.zip']) {
  const list = execFileSync('unzip', ['-Z1', path.join(archives, z)], { maxBuffer: 1 << 28 }).toString();
  for (const m of list.matchAll(/(pm(\d{4})_(\d{2})_(\d{2}))\.trmdl/g)) {
    const dex = Number(m[2]);
    if (!forms.has(dex)) forms.set(dex, new Set());
    forms.get(dex).add(m[1]);
  }
}
const baseForm = (dex) => {
  const f = [...forms.get(dex)].sort();
  return f.find((x) => x.endsWith('_00_00')) || f[0];
};

// ── PokéAPI, cached ──
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
async function getJson(url) {
  // Pokémon entries cached before heights were kept are fetched again.
  const stale = (url.includes('/pokemon/') && cache[url] && (cache[url].height === undefined || cache[url].id === undefined))
    || (url.includes('/pokemon-species/') && cache[url] && (cache[url].legendary === undefined || cache[url].id === undefined));
  if (cache[url] !== undefined && !stale) return cache[url];
  const r = await fetch(url);
  const v = r.ok ? await r.json() : null;
  cache[url] = v ? slim(url, v) : null;
  return cache[url];
}
function slim(url, v) {
  if (url.includes('/pokemon-species/')) {
    return {
      name: (v.names.find((n) => n.language.name === 'en') || {}).name || v.name,
      genus: (v.genera.find((g) => g.language.name === 'en') || {}).genus || '',
      legendary: v.is_legendary === true,
      id: v.id,
    };
  }
  return {
    types: v.types.sort((a, b) => a.slot - b.slot).map((t) => t.type.name[0].toUpperCase() + t.type.name.slice(1)),
    stats: Object.fromEntries(v.stats.map((s) => [s.stat.name, s.base_stat])),
    height: v.height / 10, // metres
    id: v.id,
  };
}
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

// ── moves the engine has ──
const MOVES = {
  terrain: ['Electro Web', 'Will-O-Wisp', 'Misty Terrain', 'Toxic Spikes', 'Sunny Day', 'Rain Dance', 'Smokescreen Field', 'Perish Trap', 'Hail'],
  status: ['Calm Mind', 'Swords Dance', 'Nasty Plot', 'Hypnosis', 'Pain Split', 'Destiny Bond', 'Taunt', 'Thunder Wave', 'Metal Sound'],
  ranged: ['Gust', 'Twister', 'Dragon Pulse', 'Thunderbolt', 'Thunder', 'Shadow Ball', 'Flamethrower', 'Psychic', 'Moonblast', 'Aura Sphere', 'Sludge Bomb', 'Air Slash', 'Dark Pulse', 'Focus Blast', 'Hex', 'Discharge',
    'Hyper Beam', 'Ice Beam', 'Aurora Beam', 'Solar Beam', 'Flash Cannon', 'Psybeam', 'Signal Beam', 'Charge Beam', 'Hydro Pump', 'Hydro Cannon', 'Steel Beam', 'Meteor Beam', 'Moongeist Beam', 'Light of Ruin', 'Tri Attack'],
  physical: ['Quick Attack', 'Iron Tail', 'Volt Tackle', 'Close Combat', 'Extreme Speed', 'Shadow Sneak', 'Sucker Punch', 'Night Slash', 'Psycho Cut', 'Fire Fang', 'Dragon Claw', 'Earthquake'],
};
/** Type-themed preferences across all categories (picked from in order). */
const THEME = {
  Normal: ['Hyper Beam', 'Tri Attack', 'Quick Attack', 'Swords Dance', 'Smokescreen Field', 'Pain Split', 'Air Slash'],
  Fire: ['Flamethrower', 'Fire Fang', 'Will-O-Wisp', 'Sunny Day'],
  Water: ['Hydro Pump', 'Rain Dance', 'Hail', 'Calm Mind', 'Iron Tail'],
  Electric: ['Thunderbolt', 'Discharge', 'Charge Beam', 'Electro Web', 'Thunder Wave', 'Rain Dance', 'Quick Attack'],
  Grass: ['Solar Beam', 'Sunny Day', 'Sludge Bomb', 'Swords Dance', 'Toxic Spikes', 'Night Slash'],
  Ice: ['Ice Beam', 'Aurora Beam', 'Hail', 'Rain Dance', 'Calm Mind', 'Iron Tail'],
  Fighting: ['Close Combat', 'Aura Sphere', 'Focus Blast', 'Swords Dance', 'Taunt'],
  Poison: ['Sludge Bomb', 'Toxic Spikes', 'Sucker Punch', 'Nasty Plot'],
  Ground: ['Earthquake', 'Smokescreen Field', 'Iron Tail', 'Swords Dance', 'Sunny Day', 'Close Combat'],
  Flying: ['Air Slash', 'Gust', 'Quick Attack', 'Smokescreen Field', 'Swords Dance'],
  Psychic: ['Psychic', 'Psybeam', 'Psycho Cut', 'Calm Mind', 'Hypnosis', 'Misty Terrain'],
  Bug: ['Signal Beam', 'Swords Dance', 'Sludge Bomb', 'Night Slash', 'Toxic Spikes', 'Air Slash'],
  Rock: ['Meteor Beam', 'Iron Tail', 'Smokescreen Field', 'Swords Dance', 'Sunny Day'],
  Ghost: ['Shadow Ball', 'Moongeist Beam', 'Hex', 'Shadow Sneak', 'Will-O-Wisp', 'Destiny Bond', 'Perish Trap'],
  Dragon: ['Dragon Claw', 'Dragon Pulse', 'Twister','Swords Dance', 'Flamethrower', 'Rain Dance'],
  Dark: ['Dark Pulse', 'Night Slash', 'Sucker Punch', 'Nasty Plot', 'Taunt', 'Perish Trap'],
  Steel: ['Flash Cannon', 'Steel Beam', 'Iron Tail', 'Metal Sound', 'Swords Dance', 'Focus Blast'],
  Fairy: ['Moonblast', 'Light of Ruin', 'Misty Terrain', 'Calm Mind', 'Psychic'],
};
const FALLBACK = {
  terrain: ['Smokescreen Field', 'Rain Dance', 'Sunny Day', 'Misty Terrain'],
  status: ['Taunt', 'Pain Split', 'Thunder Wave'],
  ranged: ['Air Slash', 'Focus Blast', 'Dark Pulse', 'Shadow Ball', 'Psychic'],
  physical: ['Quick Attack', 'Iron Tail', 'Night Slash', 'Close Combat'],
};
/** Signature moves, first in a species' order (by name; Megas included). The hand-tuned six are left alone. */
const SIGNATURE = Object.fromEntries([
  // Hydro Cannon: the final Water starters'.
  ...['Feraligatr', 'Swampert', 'Empoleon', 'Samurott', 'Greninja', 'Primarina', 'Inteleon', 'Quaquaval',
    'Mega Blastoise', 'Mega Feraligatr', 'Mega Swampert', 'Mega Greninja'].map((n) => [n, ['Hydro Cannon']]),
]);
function movepool(types, stats, name = '') {
  const cat = Object.fromEntries(Object.entries(MOVES).flatMap(([c, ms]) => ms.map((m) => [m, c])));
  const pick = { terrain: [], status: [], ranged: [], physical: [] };
  const physicalLean = stats.attack >= stats['special-attack'];
  const status0 = physicalLean ? ['Swords Dance'] : ['Calm Mind', 'Nasty Plot'];
  const order = [...(SIGNATURE[name] || []), ...types.flatMap((t) => THEME[t] || []), ...status0];
  // The strong special Electric types call down Thunder (in place of Discharge).
  if (types.includes('Electric') && stats['special-attack'] >= 95) order.unshift('Thunder');
  const add = (m) => { const c = cat[m]; if (c && pick[c].length < 2 && !pick[c].includes(m)) pick[c].push(m); };
  for (const m of order) add(m);
  for (const c of Object.keys(pick)) for (const m of FALLBACK[c]) add(m);
  return pick;
}

/** Real height (m) from which a Pokémon is huge: it stands on three tiles. */
const HUGE_HEIGHT = 3.5;
/** Tall (or legendary) but not huge on the board (by request). */
const NOT_HUGE = new Set(['Arbok', 'Milotic', 'Dragonair', 'Mewtwo', 'Latias', 'Latios']);
// Still to apply when the Gen 6+ models are mapped (not in the roster yet):
// Zygarde is huge (legendary — already covered), but its 25% form is not;
// Hoopa Unbound is huge but
// Hoopa Confined is not (Hoopa is mythical, so the Unbound form needs it set).


const inflate = (hp) => Math.max(100, Math.round((hp + 50) / 5) * 5);

// ── build ──
const existing = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const keep = new Map(existing.pokemon.filter((p) => p.hand_tuned !== false).slice(0, 6).map((p) => [p.sprite_id, p]));
// Model folders up to 649 (Gen 1–5) are numbered by the National Dex. Above
// that Z-A uses its own internal numbering for Gen 6–9 models, which does not
// match the National Dex (pm0722 is not Rowlet; heights confirm it), so those
// stay out until we have the game's model-number table.
const NATIONAL_MAX = 649;
// ── what to build: one entry per pickable Pokémon ──
// Folders 1–649: the folder is the national number. Folders 701–981: Z-A's
// internal Gen 6–8 numbering, mapped by tools/za-internal-ids.txt. Folders
// above that (and 0, 9999) are unmapped and skipped.
const NAME_FIX = { nagandel: 'naganadel', hattena: 'hatenna', nicket: 'nickit', chewtie: 'chewtle', toxitricity: 'toxtricity' };
const slug = (name) => {
  const s = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[:.'’]/g, '').trim().replace(/\s+/g, '-');
  return NAME_FIX[s] || s;
};
const internal = new Map();
for (const line of fs.readFileSync(path.join(here, 'za-internal-ids.txt'), 'utf8').split('\n')) {
  const m = line.match(/^(\d+) - (.+)$/);
  if (m) internal.set(Number(m[1]), m[2].trim());
}
/** Species whose forms are separate picks: [model form, PokéAPI pokemon, display name, huge]. */
const FORM_PICKS = {
  770: [['pm0770_11_00', 'zygarde-10', 'Zygarde 10%', false],
        ['pm0770_12_00', 'zygarde-50', 'Zygarde 50%', true],
        ['pm0770_13_00', 'zygarde-complete', 'Zygarde Complete', true]],
  774: [['pm0774_11_00', 'hoopa', 'Hoopa Confined', false],
        ['pm0774_12_00', 'hoopa-unbound', 'Hoopa Unbound', true]],
};
const entries = [];
for (const folder of [...forms.keys()].sort((a, b) => a - b)) {
  if (folder >= 1 && folder <= NATIONAL_MAX) {
    entries.push({ folder, form: baseForm(folder), species: String(folder), pokemon: null });
  } else if (FORM_PICKS[folder]) {
    for (const [form, poke, name, huge] of FORM_PICKS[folder]) {
      if (forms.get(folder).has(form)) entries.push({ folder, form, species: slug(internal.get(folder)), pokemon: poke, name, huge });
    }
  } else if (internal.has(folder)) {
    entries.push({ folder, form: baseForm(folder), species: slug(internal.get(folder)), pokemon: null });
  }
}
// ── Mega and regional forms: their own picks ──
//   _51 / _52  Mega (two for some: X/Y, or a Z-A "Z" Mega)
//   _00_31     Galarian      _00_41  Hisuian
// A form whose base is already its species' only model (Sirfetch'd is
// Galarian) is not added twice.
const XY = new Set([6, 150, 26]); //   second Mega is "Y"
const Z = new Set([359, 445, 448]); // second Mega is "Z"
const formEntries = [];
for (const [folder, set] of [...forms].sort((a, b) => a[0] - b[0])) {
  const base = folder <= NATIONAL_MAX ? String(folder) : internal.has(folder) ? slug(internal.get(folder)) : null;
  if (!base) continue;
  const baseForm0 = baseForm(folder);
  for (const form of [...set].sort()) {
    if (form === baseForm0) continue;
    const [, , a, b] = form.match(/^pm(\d{4})_(\d{2})_(\d{2})$/);
    let kind = null;
    if (a === '51' || a === '52') kind = 'mega';
    else if (a === '00' && b === '31') kind = 'galar';
    else if (a === '00' && b === '41') kind = 'hisui';
    if (!kind) continue;
    formEntries.push({ folder, form, species: base, kind, second: a === '52', hasSecond: set.has(form.replace('_51_', '_52_')) && a === '51' });
  }
}
entries.push(...formEntries.map((f) => ({ ...f, isForm: true })));

const unmapped = [...forms.keys()].filter((d) => !(d >= 1 && d <= NATIONAL_MAX) && !internal.has(d) && !FORM_PICKS[d]);

const skipped = [];
const estimated = [];
const built = await pool(entries, 8, async (e) => {
  if (e.isForm) return buildForm(e);
  if (e.folder <= NATIONAL_MAX && keep.has(e.folder)) return { ...keep.get(e.folder) }; // the original six
  const s = await getJson(`https://pokeapi.co/api/v2/pokemon-species/${e.species}`);
  if (!s) { skipped.push(`${e.folder} (${e.species})`); return null; }
  const p = await getJson(`https://pokeapi.co/api/v2/pokemon/${e.pokemon ?? s.id}`);
  if (!p) { skipped.push(`${e.folder} (${e.pokemon})`); return null; }
  const st = p.stats;
  const name = e.name ?? s.name;
  const mp = movepool(p.types, st, name);
  const huge = e.huge ?? ((s.legendary || p.height >= HUGE_HEIGHT) && !NOT_HUGE.has(name));
  return {
    name,
    types: p.types,
    hp: st.hp, inflated_hp: inflate(st.hp),
    attack: st.attack, defense: st.defense, sp_atk: st['special-attack'], sp_def: st['special-defense'], speed: st.speed,
    level: 50,
    can_pass_through: false,
    // The draft sprite (PokéAPI's id: the national number, or a form's 10xxx id).
    sprite_id: p.id,
    // The model, whenever it isn't simply pm<national>_00_00.
    ...(e.form === `pm${String(p.id).padStart(4, '0')}_00_00` ? {} : { model_id: e.form }),
    ...(huge ? { huge: true } : {}),
    description: s.genus ? `The ${s.genus}.` : '',
    compatible_terrain: mp.terrain, compatible_status: mp.status,
    compatible_ranged: mp.ranged, compatible_physical: mp.physical,
  };
});
fs.writeFileSync(CACHE, JSON.stringify(cache));

/** A Mega or regional form: PokéAPI's form when it has one, else estimated from the base. */
async function buildForm(e) {
  const s = await getJson(`https://pokeapi.co/api/v2/pokemon-species/${e.species}`);
  if (!s) { skipped.push(`${e.form} (${e.species})`); return null; }
  const baseP = await getJson(`https://pokeapi.co/api/v2/pokemon/${s.id}`);
  const sl = slug(s.name);
  let suffix, label;
  if (e.kind === 'mega') {
    const which = !(e.second || e.hasSecond) ? '' : XY.has(s.id) ? (e.second ? 'y' : 'x') : Z.has(s.id) ? (e.second ? 'z' : '') : (e.second ? '2' : '');
    suffix = which ? `mega-${which}` : 'mega';
    label = `Mega ${s.name}${which ? ' ' + which.toUpperCase() : ''}`;
  } else if (e.kind === 'galar') { suffix = 'galar'; label = `Galarian ${s.name}`; }
  else { suffix = 'hisui'; label = `Hisuian ${s.name}`; }
  // Where PokéAPI names a form its own way.
  const SPECIAL = {
    'kyogre-mega': ['kyogre-primal', 'Primal Kyogre'], 'groudon-mega': ['groudon-primal', 'Primal Groudon'],
    'meowstic-mega': ['meowstic-male-mega', null],
    'magearna-mega-2': ['magearna-original-mega', 'Mega Magearna (Original Color)'],
  };
  let apiName = `${sl}-${suffix}`;
  const sp = SPECIAL[apiName];
  if (sp) { apiName = sp[0]; if (sp[1]) label = sp[1]; }
  let p = await getJson(`https://pokeapi.co/api/v2/pokemon/${apiName}`);
  let est = false;
  if (!p && baseP) {
    if (e.kind !== 'mega') { skipped.push(`${e.form} (${sl}-${suffix})`); return null; }
    // Not in PokéAPI yet (a new Z-A Mega): same HP and types, +100 base
    // points over the other stats, weighted toward its strengths.
    const st = { ...baseP.stats };
    const keys = ['attack', 'defense', 'special-attack', 'special-defense', 'speed'];
    const tot = keys.reduce((a, k) => a + st[k], 0);
    for (const k of keys) st[k] = Math.round(st[k] + (100 * st[k]) / tot);
    p = { ...baseP, stats: st, id: baseP.id };
    est = true;
    estimated.push(label);
  }
  if (!p) { skipped.push(e.form); return null; }
  const st = p.stats;
  const mp = movepool(p.types, st, label);
  const baseName = s.name;
  const huge = !NOT_HUGE.has(baseName) && !NOT_HUGE.has(label) && (s.legendary || p.height >= HUGE_HEIGHT || (baseP && baseP.height >= HUGE_HEIGHT));
  return {
    name: label,
    types: p.types,
    hp: st.hp, inflated_hp: inflate(st.hp),
    attack: st.attack, defense: st.defense, sp_atk: st['special-attack'], sp_def: st['special-defense'], speed: st.speed,
    level: 50,
    can_pass_through: false,
    sprite_id: p.id,
    model_id: e.form,
    ...(huge ? { huge: true } : {}),
    form_of: baseName,
    base_sprite_id: s.id,
    ...(est ? { stats_estimated: true } : {}),
    description: (s.genus ? `The ${s.genus}.` : '') + (est ? ' (Stats estimated: a new Mega.)' : ''),
    compatible_terrain: mp.terrain, compatible_status: mp.status,
    compatible_ranged: mp.ranged, compatible_physical: mp.physical,
  };
}
const pokemon = built.filter(Boolean);
existing._meta.species_count = pokemon.length;
fs.writeFileSync(OUT, JSON.stringify({ _meta: existing._meta, pokemon }, null, 1) + '\n');
console.log(`estimated Megas (${estimated.length}): ${estimated.join(', ')}`);
console.log(`species: ${pokemon.length} (kept ${keep.size} hand-tuned); not found in PokéAPI: ${skipped.join(', ') || 'none'}; unmapped folders: ${unmapped.join(', ') || 'none'}`);
