import { MoveCategory, PokemonType, StatName, TerrainType } from './Enums';
import { MoveDefinition } from './MoveDefinition';
import { PokemonState } from './PokemonState';
import { getCombinedEffectiveness } from './TypeChart';

export interface DamageResult {
  damage: number;
  typeMultiplier: number;
  isCrit: boolean;
  isSTAB: boolean;
  recoil: number;
}

export function calculateDamage(
  attacker: PokemonState,
  defender: PokemonState,
  move: MoveDefinition,
  activeTerrain: Map<string, { type: TerrainType; turnsLeft: number }>,
  forceCrit = false
): DamageResult {
  if (move.category === MoveCategory.Status || move.category === MoveCategory.Terrain) {
    return { damage: 0, typeMultiplier: 1, isCrit: false, isSTAB: false, recoil: 0 };
  }

  const isCrit = forceCrit || Math.random() < 1 / 24;

  // Pick atk/def stats
  const isPhysical = move.category === MoveCategory.Physical;
  let atkStat: number;
  let defStat: number;

  if (isCrit) {
    // Crit bypasses negative attack stages on attacker and positive defense stages on defender
    const atkStage = attacker.statStages.get(isPhysical ? StatName.Attack : StatName.SpAtk) ?? 0;
    const defStage = defender.statStages.get(isPhysical ? StatName.Defense : StatName.SpDef) ?? 0;
    const effectiveAtkStage = Math.max(0, atkStage);
    const effectiveDefStage = Math.min(0, defStage);
    const atkBase = isPhysical ? attacker.attack : attacker.spAtk;
    const defBase = isPhysical ? defender.defense : defender.spDef;
    atkStat = Math.max(1, Math.floor(atkBase * stageMult(effectiveAtkStage)));
    defStat = Math.max(1, Math.floor(defBase * stageMult(effectiveDefStage)));
  } else {
    atkStat = attacker.getEffectiveStat(isPhysical ? StatName.Attack : StatName.SpAtk);
    defStat = defender.getEffectiveStat(isPhysical ? StatName.Defense : StatName.SpDef);
  }

  // Type effectiveness
  const typeEff = getCombinedEffectiveness(move.type, defender.types);

  // STAB
  const isSTAB = attacker.types.includes(move.type);
  const stabMult = isSTAB ? 1.5 : 1.0;

  // Crit multiplier
  const critMult = isCrit ? 1.5 : 1.0;

  // Momentum
  const momentum = move.needsMomentum ? attacker.calcMomentum() : 1.0;

  // Weather / terrain modifiers
  let weatherMult = 1.0;
  for (const [, t] of activeTerrain) {
    if (t.type === TerrainType.SunnyZone) {
      if (move.type === PokemonType.Fire) weatherMult *= 1.5;
      if (move.type === PokemonType.Water) weatherMult *= 0.5;
    } else if (t.type === TerrainType.RainZone) {
      if (move.type === PokemonType.Water) weatherMult *= 1.5;
      if (move.type === PokemonType.Fire) weatherMult *= 0.5;
    }
  }

  // Random roll 85–100%
  const roll = 0.85 + Math.random() * 0.15;

  // Main formula: damage = (basePower * (atk/def) * typeEff * STAB * crit * momentum * weather * roll) * level_scale
  // Level 50 standard formula approximation
  const levelFactor = (2 * 50) / 5 + 2;
  const rawDamage =
    (levelFactor * move.basePower * (atkStat / defStat)) / 50 + 2;
  const damage = Math.max(
    1,
    Math.floor(rawDamage * typeEff * stabMult * critMult * momentum * weatherMult * roll)
  );

  const recoil = move.recoilFraction > 0 ? Math.max(1, Math.floor(damage * move.recoilFraction)) : 0;

  return { damage, typeMultiplier: typeEff, isCrit, isSTAB, recoil };
}

function stageMult(stage: number): number {
  if (stage >= 0) return (2 + stage) / 2;
  return 2 / (2 - stage);
}
