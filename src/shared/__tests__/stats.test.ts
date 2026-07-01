import { describe, it, expect } from 'vitest';
import { statStageMultiplier, clampStatStage } from '../core/stats.ts';
import { momentumMultiplier } from '../moves/damage.ts';

describe('stat stages', () => {
  it('multiplier at each stage', () => {
    expect(statStageMultiplier(0)).toBe(1);
    expect(statStageMultiplier(1)).toBe(1.5);
    expect(statStageMultiplier(2)).toBe(2);
    expect(statStageMultiplier(6)).toBe(4);
    expect(statStageMultiplier(-1)).toBeCloseTo(2 / 3, 6);
    expect(statStageMultiplier(-6)).toBe(0.25);
  });

  it('clamps to [-6, 6]', () => {
    expect(clampStatStage(5, 3)).toBe(6);
    expect(clampStatStage(-5, -3)).toBe(-6);
    expect(clampStatStage(0, 2)).toBe(2);
  });
});

describe('momentum', () => {
  it('1 + 0.1 per straight tile, capped at 1.5', () => {
    expect(momentumMultiplier(0)).toBe(1);
    expect(momentumMultiplier(3)).toBeCloseTo(1.3, 6);
    expect(momentumMultiplier(5)).toBe(1.5);
    expect(momentumMultiplier(10)).toBe(1.5);
  });
});
