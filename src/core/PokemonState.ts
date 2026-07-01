import { StatName, StatusCondition, PokemonType } from './Enums';
import { GameConstants } from './GameConstants';

export interface SpeciesDefinition {
  id: string;
  name: string;
  types: PokemonType[];
  baseHp: number;
  attack: number;
  defense: number;
  spAtk: number;
  spDef: number;
  speed: number;
  canPassThrough: boolean;
  movePool: string[];
}

export interface DeclarationPayload {
  moveId: string;
  targetTile: { x: number; y: number };
  movePath: { x: number; y: number }[];
  actFirst: boolean;
}

function calcHp(base: number, level: number): number {
  return Math.floor((2 * base * level) / 100) + level + 10;
}

function calcStat(base: number, level: number): number {
  return Math.floor((2 * base * level) / 100) + 5;
}

export class PokemonState {
  playerId: number;
  name: string;
  types: PokemonType[];
  level: number = 50;
  maxHp: number;
  currentHp: number;
  attack: number;
  defense: number;
  spAtk: number;
  spDef: number;
  speed: number;
  tile: { x: number; y: number };
  isAlive: boolean = true;
  statStages: Map<StatName, number> = new Map();
  cooldowns: Map<string, number> = new Map();
  status: Set<StatusCondition> = new Set();
  canPassThrough: boolean = false;
  perishCountdown: number = -1;
  declaration: DeclarationPayload | null = null;
  prevTile: { x: number; y: number } | null = null;
  movePool: string[];

  constructor(
    data: SpeciesDefinition,
    playerId: number,
    startTile: { x: number; y: number }
  ) {
    this.playerId = playerId;
    this.name = data.name;
    this.types = [...data.types];
    this.canPassThrough = data.canPassThrough;
    this.movePool = [...data.movePool];
    this.tile = { ...startTile };

    // Level-50 stat formula
    this.maxHp = calcHp(data.baseHp, this.level);
    this.currentHp = this.maxHp;
    this.attack = calcStat(data.attack, this.level);
    this.defense = calcStat(data.defense, this.level);
    this.spAtk = calcStat(data.spAtk, this.level);
    this.spDef = calcStat(data.spDef, this.level);
    this.speed = calcStat(data.speed, this.level);
  }

  getStageMult(stat: StatName): number {
    const stage = this.statStages.get(stat) ?? 0;
    if (stage >= 0) return (2 + stage) / 2;
    return 2 / (2 - stage);
  }

  getEffectiveStat(stat: StatName): number {
    const base = this.getBaseStat(stat);
    return Math.max(1, Math.floor(base * this.getStageMult(stat)));
  }

  private getBaseStat(stat: StatName): number {
    switch (stat) {
      case StatName.Attack: return this.attack;
      case StatName.Defense: return this.defense;
      case StatName.SpAtk: return this.spAtk;
      case StatName.SpDef: return this.spDef;
      case StatName.Speed: return this.speed;
    }
  }

  calcMomentum(): number {
    if (!this.prevTile) return 1.0;
    // Moved in a straight line = momentum bonus
    const dx = this.tile.x - this.prevTile.x;
    const dy = this.tile.y - this.prevTile.y;
    const dist = Math.abs(dx) + Math.abs(dy);
    if (dist >= 1) return GameConstants.MomentumBonus;
    return 1.0;
  }

  applyStageChange(stat: StatName, delta: number): void {
    const current = this.statStages.get(stat) ?? 0;
    this.statStages.set(stat, Math.max(-6, Math.min(6, current + delta)));
  }

  takeDamage(amount: number): void {
    this.currentHp = Math.max(0, this.currentHp - amount);
    if (this.currentHp === 0) this.isAlive = false;
  }

  heal(amount: number): void {
    this.currentHp = Math.min(this.maxHp, this.currentHp + amount);
  }

  getMoveRange(): number {
    return Math.max(1, GameConstants.BaseRange(this.speed));
  }
}
