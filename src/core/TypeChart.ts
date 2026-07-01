import { PokemonType } from './Enums';

// Gen 6 type chart: effectiveness[attacking][defending] = multiplier
// 0 = immune, 0.5 = not very effective, 1 = normal, 2 = super effective

type EffRow = Partial<Record<PokemonType, number>>;

const chart: Partial<Record<PokemonType, EffRow>> = {
  [PokemonType.Normal]: {
    [PokemonType.Rock]: 0.5,
    [PokemonType.Ghost]: 0,
    [PokemonType.Steel]: 0.5,
  },
  [PokemonType.Fire]: {
    [PokemonType.Fire]: 0.5,
    [PokemonType.Water]: 0.5,
    [PokemonType.Grass]: 2,
    [PokemonType.Ice]: 2,
    [PokemonType.Bug]: 2,
    [PokemonType.Rock]: 0.5,
    [PokemonType.Dragon]: 0.5,
    [PokemonType.Steel]: 2,
  },
  [PokemonType.Water]: {
    [PokemonType.Fire]: 2,
    [PokemonType.Water]: 0.5,
    [PokemonType.Grass]: 0.5,
    [PokemonType.Ground]: 2,
    [PokemonType.Rock]: 2,
    [PokemonType.Dragon]: 0.5,
  },
  [PokemonType.Electric]: {
    [PokemonType.Water]: 2,
    [PokemonType.Electric]: 0.5,
    [PokemonType.Grass]: 0.5,
    [PokemonType.Ground]: 0,
    [PokemonType.Flying]: 2,
    [PokemonType.Dragon]: 0.5,
  },
  [PokemonType.Grass]: {
    [PokemonType.Fire]: 0.5,
    [PokemonType.Water]: 2,
    [PokemonType.Grass]: 0.5,
    [PokemonType.Poison]: 0.5,
    [PokemonType.Ground]: 2,
    [PokemonType.Flying]: 0.5,
    [PokemonType.Bug]: 0.5,
    [PokemonType.Rock]: 2,
    [PokemonType.Dragon]: 0.5,
    [PokemonType.Steel]: 0.5,
  },
  [PokemonType.Ice]: {
    [PokemonType.Fire]: 0.5,
    [PokemonType.Water]: 0.5,
    [PokemonType.Grass]: 2,
    [PokemonType.Ice]: 0.5,
    [PokemonType.Ground]: 2,
    [PokemonType.Flying]: 2,
    [PokemonType.Dragon]: 2,
    [PokemonType.Steel]: 0.5,
  },
  [PokemonType.Fighting]: {
    [PokemonType.Normal]: 2,
    [PokemonType.Ice]: 2,
    [PokemonType.Poison]: 0.5,
    [PokemonType.Flying]: 0.5,
    [PokemonType.Psychic]: 0.5,
    [PokemonType.Bug]: 0.5,
    [PokemonType.Rock]: 2,
    [PokemonType.Ghost]: 0,
    [PokemonType.Dark]: 2,
    [PokemonType.Steel]: 2,
    [PokemonType.Fairy]: 0.5,
  },
  [PokemonType.Poison]: {
    [PokemonType.Grass]: 2,
    [PokemonType.Poison]: 0.5,
    [PokemonType.Ground]: 0.5,
    [PokemonType.Rock]: 0.5,
    [PokemonType.Ghost]: 0.5,
    [PokemonType.Steel]: 0,
    [PokemonType.Fairy]: 2,
  },
  [PokemonType.Ground]: {
    [PokemonType.Fire]: 2,
    [PokemonType.Electric]: 2,
    [PokemonType.Grass]: 0.5,
    [PokemonType.Poison]: 2,
    [PokemonType.Flying]: 0,
    [PokemonType.Bug]: 0.5,
    [PokemonType.Rock]: 2,
    [PokemonType.Steel]: 2,
  },
  [PokemonType.Flying]: {
    [PokemonType.Electric]: 0.5,
    [PokemonType.Grass]: 2,
    [PokemonType.Fighting]: 2,
    [PokemonType.Bug]: 2,
    [PokemonType.Rock]: 0.5,
    [PokemonType.Steel]: 0.5,
  },
  [PokemonType.Psychic]: {
    [PokemonType.Fighting]: 2,
    [PokemonType.Poison]: 2,
    [PokemonType.Psychic]: 0.5,
    [PokemonType.Dark]: 0,
    [PokemonType.Steel]: 0.5,
  },
  [PokemonType.Bug]: {
    [PokemonType.Fire]: 0.5,
    [PokemonType.Grass]: 2,
    [PokemonType.Fighting]: 0.5,
    [PokemonType.Poison]: 0.5,
    [PokemonType.Flying]: 0.5,
    [PokemonType.Psychic]: 2,
    [PokemonType.Ghost]: 0.5,
    [PokemonType.Dark]: 2,
    [PokemonType.Steel]: 0.5,
    [PokemonType.Fairy]: 0.5,
  },
  [PokemonType.Rock]: {
    [PokemonType.Fire]: 2,
    [PokemonType.Ice]: 2,
    [PokemonType.Fighting]: 0.5,
    [PokemonType.Ground]: 0.5,
    [PokemonType.Flying]: 2,
    [PokemonType.Bug]: 2,
    [PokemonType.Steel]: 0.5,
  },
  [PokemonType.Ghost]: {
    [PokemonType.Normal]: 0,
    [PokemonType.Psychic]: 2,
    [PokemonType.Ghost]: 2,
    [PokemonType.Dark]: 0.5,
  },
  [PokemonType.Dragon]: {
    [PokemonType.Dragon]: 2,
    [PokemonType.Steel]: 0.5,
    [PokemonType.Fairy]: 0,
  },
  [PokemonType.Dark]: {
    [PokemonType.Fighting]: 0.5,
    [PokemonType.Psychic]: 2,
    [PokemonType.Ghost]: 2,
    [PokemonType.Dark]: 0.5,
    [PokemonType.Fairy]: 0.5,
  },
  [PokemonType.Steel]: {
    [PokemonType.Fire]: 0.5,
    [PokemonType.Water]: 0.5,
    [PokemonType.Electric]: 0.5,
    [PokemonType.Ice]: 2,
    [PokemonType.Rock]: 2,
    [PokemonType.Steel]: 0.5,
    [PokemonType.Fairy]: 2,
  },
  [PokemonType.Fairy]: {
    [PokemonType.Fire]: 0.5,
    [PokemonType.Fighting]: 2,
    [PokemonType.Poison]: 0.5,
    [PokemonType.Dragon]: 2,
    [PokemonType.Dark]: 2,
    [PokemonType.Steel]: 0.5,
  },
};

export function getTypeEffectiveness(attacking: PokemonType, defending: PokemonType): number {
  const row = chart[attacking];
  if (!row) return 1;
  const val = row[defending];
  return val === undefined ? 1 : val;
}

export function getCombinedEffectiveness(attackType: PokemonType, defenderTypes: PokemonType[]): number {
  return defenderTypes.reduce((mult, dt) => mult * getTypeEffectiveness(attackType, dt), 1);
}
