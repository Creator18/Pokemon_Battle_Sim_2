/**
 * A species' body shape, as the games' Pokédex gives it (one of 14: upright —
 * a biped with a tail —, humanoid, quadruped, arms, legs, wings, …; PokeAPI's
 * pokemon-shape). Its forms (Mega, regional, Primal, …) share it.
 */
import data from '../../shared/data/raw/bodyShapes.json';

const SHAPES = (data as { shapes: Record<string, string> }).shapes;

/** The Pokédex's slug for a species' name: its form dropped (Mega X, Galarian, Zygarde 50%, Hoopa Unbound, …). */
function slug(name: string): string {
  return name
    .replace(/^(Mega|Primal|Alolan|Galarian|Hisuian|Paldean)\s+/, '')
    .replace(/\s+([XYZ]|\d+%|Complete|Confined|Unbound|\(.*\))$/, '')
    .toLowerCase()
    .replace(/[’'�]/g, '')
    .replace(/♀/g, '-f').replace(/♂/g, '-m').replace(/é/g, 'e')
    .replace(/[.:]/g, '').trim().replace(/\s+/g, '-');
}

/** Its body shape, or null if the Pokédex doesn't say. */
export function bodyShape(name: string): string | null {
  return SHAPES[slug(name)] ?? null;
}
