import { MoveCategory, PokemonType, StatName, TerrainType } from '../core/Enums';
import { MoveDefinition, MoveRegistry } from '../core/MoveDefinition';

const moves: MoveDefinition[] = [
  // === ELECTRIC ===
  {
    id: 'thunderbolt', name: 'Thunderbolt', category: MoveCategory.Special,
    type: PokemonType.Electric, basePower: 90, minRange: 1, maxRange: 3,
    requiresLoS: true, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  {
    id: 'volt_tackle', name: 'Volt Tackle', category: MoveCategory.Physical,
    type: PokemonType.Electric, basePower: 120, minRange: 1, maxRange: 1,
    requiresLoS: false, bypassesLoS: false, alwaysHits: false, needsMomentum: true,
    quickPriority: false, aoeRadius: 0, recoilFraction: 1 / 3, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  {
    id: 'thunder_wave', name: 'Thunder Wave', category: MoveCategory.Status,
    type: PokemonType.Electric, basePower: 0, minRange: 1, maxRange: 2,
    requiresLoS: false, bypassesLoS: false, alwaysHits: true, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [], inflictsStatus: 'paralyzed',
  },
  // === NORMAL ===
  {
    id: 'quick_attack', name: 'Quick Attack', category: MoveCategory.Physical,
    type: PokemonType.Normal, basePower: 40, minRange: 1, maxRange: 1,
    requiresLoS: false, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: true, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  {
    id: 'hyper_beam', name: 'Hyper Beam', category: MoveCategory.Special,
    type: PokemonType.Normal, basePower: 150, minRange: 1, maxRange: 4,
    requiresLoS: true, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: true,
    selfDebuffs: [], selfBuffs: [],
  },
  {
    id: 'double_edge', name: 'Double-Edge', category: MoveCategory.Physical,
    type: PokemonType.Normal, basePower: 120, minRange: 1, maxRange: 1,
    requiresLoS: false, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 1 / 3, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  // === FIRE ===
  {
    id: 'flamethrower', name: 'Flamethrower', category: MoveCategory.Special,
    type: PokemonType.Fire, basePower: 90, minRange: 1, maxRange: 3,
    requiresLoS: true, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  {
    id: 'flare_blitz', name: 'Flare Blitz', category: MoveCategory.Physical,
    type: PokemonType.Fire, basePower: 120, minRange: 1, maxRange: 1,
    requiresLoS: false, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 1 / 3, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  {
    id: 'will_o_wisp', name: "Will-O-Wisp", category: MoveCategory.Status,
    type: PokemonType.Fire, basePower: 0, minRange: 1, maxRange: 3,
    requiresLoS: false, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [], inflictsStatus: 'burned',
  },
  {
    id: 'fire_blast', name: 'Fire Blast', category: MoveCategory.Special,
    type: PokemonType.Fire, basePower: 110, minRange: 1, maxRange: 3,
    requiresLoS: true, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 1, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  // === GHOST ===
  {
    id: 'shadow_ball', name: 'Shadow Ball', category: MoveCategory.Special,
    type: PokemonType.Ghost, basePower: 80, minRange: 1, maxRange: 4,
    requiresLoS: false, bypassesLoS: true, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  {
    id: 'shadow_sneak', name: 'Shadow Sneak', category: MoveCategory.Physical,
    type: PokemonType.Ghost, basePower: 40, minRange: 1, maxRange: 1,
    requiresLoS: false, bypassesLoS: true, alwaysHits: false, needsMomentum: false,
    quickPriority: true, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  {
    id: 'perish_trap', name: 'Perish Trap', category: MoveCategory.Terrain,
    type: PokemonType.Ghost, basePower: 0, minRange: 0, maxRange: 0,
    requiresLoS: false, bypassesLoS: false, alwaysHits: true, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
    terrainType: TerrainType.PerishTrap, terrainDuration: 3,
  },
  // === FIGHTING ===
  {
    id: 'close_combat', name: 'Close Combat', category: MoveCategory.Physical,
    type: PokemonType.Fighting, basePower: 120, minRange: 1, maxRange: 1,
    requiresLoS: false, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [{ stat: StatName.Defense, delta: -1 }, { stat: StatName.SpDef, delta: -1 }],
    selfBuffs: [],
  },
  {
    id: 'aura_sphere', name: 'Aura Sphere', category: MoveCategory.Special,
    type: PokemonType.Fighting, basePower: 80, minRange: 1, maxRange: 4,
    requiresLoS: false, bypassesLoS: false, alwaysHits: true, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  {
    id: 'mach_punch', name: 'Mach Punch', category: MoveCategory.Physical,
    type: PokemonType.Fighting, basePower: 40, minRange: 1, maxRange: 1,
    requiresLoS: false, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: true, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  // === PSYCHIC ===
  {
    id: 'psychic', name: 'Psychic', category: MoveCategory.Special,
    type: PokemonType.Psychic, basePower: 90, minRange: 1, maxRange: 3,
    requiresLoS: false, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  {
    id: 'calm_mind', name: 'Calm Mind', category: MoveCategory.Status,
    type: PokemonType.Psychic, basePower: 0, minRange: 0, maxRange: 0,
    requiresLoS: false, bypassesLoS: false, alwaysHits: true, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [{ stat: StatName.SpAtk, delta: 1 }, { stat: StatName.SpDef, delta: 1 }],
  },
  {
    id: 'moonblast', name: 'Moonblast', category: MoveCategory.Special,
    type: PokemonType.Fairy, basePower: 95, minRange: 1, maxRange: 3,
    requiresLoS: false, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  // === POISON ===
  {
    id: 'toxic', name: 'Toxic', category: MoveCategory.Status,
    type: PokemonType.Poison, basePower: 0, minRange: 1, maxRange: 2,
    requiresLoS: false, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [], inflictsStatus: 'poisoned',
  },
  {
    id: 'sludge_bomb', name: 'Sludge Bomb', category: MoveCategory.Special,
    type: PokemonType.Poison, basePower: 90, minRange: 1, maxRange: 2,
    requiresLoS: false, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  // === ICE ===
  {
    id: 'ice_beam', name: 'Ice Beam', category: MoveCategory.Special,
    type: PokemonType.Ice, basePower: 90, minRange: 1, maxRange: 3,
    requiresLoS: true, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  {
    id: 'blizzard', name: 'Blizzard', category: MoveCategory.Special,
    type: PokemonType.Ice, basePower: 110, minRange: 1, maxRange: 4,
    requiresLoS: false, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 1, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  // === DARK ===
  {
    id: 'sucker_punch', name: 'Sucker Punch', category: MoveCategory.Physical,
    type: PokemonType.Dark, basePower: 70, minRange: 1, maxRange: 1,
    requiresLoS: false, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: true, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  {
    id: 'night_slash', name: 'Night Slash', category: MoveCategory.Physical,
    type: PokemonType.Dark, basePower: 70, minRange: 1, maxRange: 2,
    requiresLoS: false, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  {
    id: 'nasty_plot', name: 'Nasty Plot', category: MoveCategory.Status,
    type: PokemonType.Dark, basePower: 0, minRange: 0, maxRange: 0,
    requiresLoS: false, bypassesLoS: false, alwaysHits: true, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [{ stat: StatName.SpAtk, delta: 2 }],
  },
  // === ROCK ===
  {
    id: 'stone_edge', name: 'Stone Edge', category: MoveCategory.Physical,
    type: PokemonType.Rock, basePower: 100, minRange: 1, maxRange: 2,
    requiresLoS: false, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  {
    id: 'rock_slide', name: 'Rock Slide', category: MoveCategory.Physical,
    type: PokemonType.Rock, basePower: 75, minRange: 1, maxRange: 2,
    requiresLoS: false, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 1, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  // === STEEL ===
  {
    id: 'iron_tail', name: 'Iron Tail', category: MoveCategory.Physical,
    type: PokemonType.Steel, basePower: 100, minRange: 1, maxRange: 1,
    requiresLoS: false, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  {
    id: 'flash_cannon', name: 'Flash Cannon', category: MoveCategory.Special,
    type: PokemonType.Steel, basePower: 80, minRange: 1, maxRange: 3,
    requiresLoS: true, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  {
    id: 'bullet_punch', name: 'Bullet Punch', category: MoveCategory.Physical,
    type: PokemonType.Steel, basePower: 40, minRange: 1, maxRange: 1,
    requiresLoS: false, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: true, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  // === SWORDS DANCE / BOOST ===
  {
    id: 'swords_dance', name: 'Swords Dance', category: MoveCategory.Status,
    type: PokemonType.Normal, basePower: 0, minRange: 0, maxRange: 0,
    requiresLoS: false, bypassesLoS: false, alwaysHits: true, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [{ stat: StatName.Attack, delta: 2 }],
  },
  // === TERRAIN SETTERS ===
  {
    id: 'slow_zone', name: 'Slow Zone', category: MoveCategory.Terrain,
    type: PokemonType.Psychic, basePower: 0, minRange: 0, maxRange: 3,
    requiresLoS: false, bypassesLoS: false, alwaysHits: true, needsMomentum: false,
    quickPriority: false, aoeRadius: 2, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
    terrainType: TerrainType.SlowZone, terrainDuration: 3,
  },
  {
    id: 'burn_zone', name: 'Burn Zone', category: MoveCategory.Terrain,
    type: PokemonType.Fire, basePower: 0, minRange: 0, maxRange: 3,
    requiresLoS: false, bypassesLoS: false, alwaysHits: true, needsMomentum: false,
    quickPriority: false, aoeRadius: 2, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
    terrainType: TerrainType.BurnZone, terrainDuration: 3,
  },
  {
    id: 'electric_zone', name: 'Electric Zone', category: MoveCategory.Terrain,
    type: PokemonType.Electric, basePower: 0, minRange: 0, maxRange: 3,
    requiresLoS: false, bypassesLoS: false, alwaysHits: true, needsMomentum: false,
    quickPriority: false, aoeRadius: 2, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
    terrainType: TerrainType.ElectricZone, terrainDuration: 3,
  },
  {
    id: 'rain_dance', name: 'Rain Dance', category: MoveCategory.Terrain,
    type: PokemonType.Water, basePower: 0, minRange: 0, maxRange: 0,
    requiresLoS: false, bypassesLoS: false, alwaysHits: true, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
    terrainType: TerrainType.RainZone, terrainDuration: 5,
  },
  {
    id: 'sunny_day', name: 'Sunny Day', category: MoveCategory.Terrain,
    type: PokemonType.Fire, basePower: 0, minRange: 0, maxRange: 0,
    requiresLoS: false, bypassesLoS: false, alwaysHits: true, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
    terrainType: TerrainType.SunnyZone, terrainDuration: 5,
  },
  // === WATER ===
  {
    id: 'surf', name: 'Surf', category: MoveCategory.Special,
    type: PokemonType.Water, basePower: 90, minRange: 1, maxRange: 2,
    requiresLoS: false, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 1, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  {
    id: 'hydro_pump', name: 'Hydro Pump', category: MoveCategory.Special,
    type: PokemonType.Water, basePower: 110, minRange: 1, maxRange: 3,
    requiresLoS: true, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  // === DRAGON ===
  {
    id: 'dragon_pulse', name: 'Dragon Pulse', category: MoveCategory.Special,
    type: PokemonType.Dragon, basePower: 85, minRange: 1, maxRange: 3,
    requiresLoS: false, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  // === MIST VEIL ===
  {
    id: 'mist_veil', name: 'Mist Veil', category: MoveCategory.Terrain,
    type: PokemonType.Ice, basePower: 0, minRange: 0, maxRange: 0,
    requiresLoS: false, bypassesLoS: false, alwaysHits: true, needsMomentum: false,
    quickPriority: false, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
    terrainType: TerrainType.MistVeil, terrainDuration: 3,
  },
  // === GROUND ===
  {
    id: 'earthquake', name: 'Earthquake', category: MoveCategory.Physical,
    type: PokemonType.Ground, basePower: 100, minRange: 1, maxRange: 1,
    requiresLoS: false, bypassesLoS: true, alwaysHits: false, needsMomentum: false,
    quickPriority: false, aoeRadius: 1, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
  {
    id: 'extremespeed', name: 'ExtremeSpeed', category: MoveCategory.Physical,
    type: PokemonType.Normal, basePower: 80, minRange: 1, maxRange: 2,
    requiresLoS: false, bypassesLoS: false, alwaysHits: false, needsMomentum: false,
    quickPriority: true, aoeRadius: 0, recoilFraction: 0, skipTurnOnHit: false,
    selfDebuffs: [], selfBuffs: [],
  },
];

export function initMoveData(): void {
  for (const move of moves) {
    MoveRegistry.set(move.id, move);
  }
}
