/** Stat-stage system. Faithful port of hex_battle.py lines ~144-155. */

import { STAT_STAGE_MIN, STAT_STAGE_MAX, STAT_STAGE_NAMES } from './constants.ts';
import type { StatName } from './enums.ts';

export type StatStages = Record<StatName, number>;

/** Gen 3+ stat-stage multiplier. */
export function statStageMultiplier(stage: number): number {
  const s = Math.max(STAT_STAGE_MIN, Math.min(STAT_STAGE_MAX, stage));
  if (s >= 0) return (2 + s) / 2.0;
  return 2.0 / (2 + Math.abs(s));
}

/** Clamp `current + delta` into the legal stage range. */
export function clampStatStage(current: number, delta: number): number {
  return Math.max(STAT_STAGE_MIN, Math.min(STAT_STAGE_MAX, current + delta));
}

export function defaultStatStages(): StatStages {
  const stages = {} as StatStages;
  for (const name of STAT_STAGE_NAMES) stages[name] = 0;
  return stages;
}
