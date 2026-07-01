export const GameConstants = {
  GridRadius: 4,         // 61 tiles total
  HexSize: 1.2,
  SpeedRangeDivisor: 20,
  AttackFirstCooldown: 2,
  MoveFirstCooldown: 1,
  VoltTackleRecoilBase: 1 / 3,
  BurnZoneDamageRatio: 1 / 8,
  IceDamageRatio: 0.06,
  MomentumBonus: 1.5,
  BaseRange: (speed: number) => Math.floor(speed / 20),
} as const;
