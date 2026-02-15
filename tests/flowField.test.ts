import { describe, expect, it } from 'vitest';
import { computeWakeDecay } from '../src/core/flowField';

describe('flowField wake decay', () => {
  it('is zero upstream', () => {
    expect(computeWakeDecay(-0.1, 0.2, 1)).toBe(0);
    expect(computeWakeDecay(0, 0.2, 1)).toBe(0);
  });

  it('decays downstream and laterally', () => {
    const near = computeWakeDecay(0.5, 0.1, 1);
    const farDownstream = computeWakeDecay(4, 0.1, 1);
    const farLateral = computeWakeDecay(0.5, 2.2, 1);
    expect(near).toBeGreaterThan(farDownstream);
    expect(near).toBeGreaterThan(farLateral);
  });
});
