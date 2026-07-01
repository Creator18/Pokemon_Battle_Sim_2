export enum MoveCategory { Physical, Special, Status, Terrain }

export enum GamePhase { Waiting, Selection, Declaration, Resolution, EndOfTurn, GameOver }

export enum TerrainType {
  None,
  SlowZone,
  PoisonTrap,
  BurnZone,
  IceZone,
  ResonanceField,
  PerishTrap,
  MistVeil,
  SunnyZone,
  RainZone,
  ElectricZone,
  PsychicZone,
  SteelZone,
}

export enum HighlightType { None, MoveRange, AttackRange, Path, AoE }

export enum StatName { Attack, Defense, SpAtk, SpDef, Speed }

export enum StatusCondition { None, Taunted, Flinched, Hypnotized, Paralyzed, Burned }

export enum PokemonType {
  Normal,
  Fire,
  Water,
  Electric,
  Grass,
  Ice,
  Fighting,
  Poison,
  Ground,
  Flying,
  Psychic,
  Bug,
  Rock,
  Ghost,
  Dragon,
  Dark,
  Steel,
  Fairy,
}
