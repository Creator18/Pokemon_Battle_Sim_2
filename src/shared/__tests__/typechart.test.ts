import { describe, it, expect } from 'vitest';
import { getTypeEffectiveness } from '../core/typechart.ts';

describe('type chart', () => {
  it('Ghost is immune to Normal and Fighting', () => {
    expect(getTypeEffectiveness('Normal', ['Ghost'])).toBe(0);
    expect(getTypeEffectiveness('Fighting', ['Ghost'])).toBe(0);
  });

  it('Ground is immune to Electric', () => {
    expect(getTypeEffectiveness('Electric', ['Ground'])).toBe(0);
  });

  it('Fairy is immune to Dragon', () => {
    expect(getTypeEffectiveness('Dragon', ['Fairy'])).toBe(0);
  });

  it('Steel is immune to Poison', () => {
    expect(getTypeEffectiveness('Poison', ['Steel'])).toBe(0);
  });

  it('multiplies across dual types (Electric vs Fire/Flying = 2x)', () => {
    // Electric: Fire 1.0, Flying 2.0
    expect(getTypeEffectiveness('Electric', ['Fire', 'Flying'])).toBe(2);
  });

  it('super/not-very effective', () => {
    expect(getTypeEffectiveness('Fire', ['Grass'])).toBe(2);
    expect(getTypeEffectiveness('Fire', ['Water'])).toBe(0.5);
    // Fighting vs Psychic/Fairy (Gardevoir): 0.5 * 0.5 = 0.25
    expect(getTypeEffectiveness('Fighting', ['Psychic', 'Fairy'])).toBe(0.25);
  });
});
