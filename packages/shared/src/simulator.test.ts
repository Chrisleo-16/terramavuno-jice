import {describe, expect, it} from 'vitest';
import {simulateClimateAction} from './simulator.js';
describe('climate action simulator', () => {
  it('compares six fully-budgeted options and labels them simulated', () => {
    const result = simulateClimateAction({county:'Makueni',budgetKes:10_000_000,objective:'drought-resilience',horizonYears:3});
    expect(result).toHaveLength(6);
    expect(result.every(x => x.allocatedKes === 10_000_000 && x.label === 'SIMULATED BENCHMARK')).toBe(true);
    expect(result.some(x => x.kind === 'blended')).toBe(true);
  });
  it('rejects non-positive budgets', () => expect(() => simulateClimateAction({county:'Kitui',budgetKes:0,objective:'water-security',horizonYears:2})).toThrow());
});
