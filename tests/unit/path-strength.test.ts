import { describe, it, expect } from 'vitest';
import { pathStrength } from '@/components/graph/path-chain';

/**
 * The badge that replaced "cost 5.9".
 *
 * Every case below is a REAL measurement from the corpus, not a made-up
 * number, because the whole point of the thresholds is that they correspond
 * to something a person would recognize: sharing a director is a strong claim
 * and sharing a theme is a thin one.
 */
describe('path strength', () => {
  it.each([
    ['Arrival → Villeneuve → Blade Runner 2049', 5.92, 2, 'Strong'],
    ['Dune → Villeneuve → Sicario', 5.61, 2, 'Strong'],
    ['Dune → Josh Brolin → Sicario', 7.55, 2, 'Strong'],
    ['Arrival → similar → Dastmalchian → BR2049', 18.41, 3, 'Moderate'],
    ['Dune → Revenge → Sicario', 16.35, 2, 'Faint'],
    ['The Office → … → Ted Lasso', 19.03, 2, 'Faint'],
  ])('%s reads as %s', (_label, cost, steps, want) => {
    expect(pathStrength(cost, steps).label).toBe(want);
  });

  it('does not punish a longer path for merely being longer', () => {
    // The defect the raw number had: cost is a SUM, so three good hops
    // outscored two mediocre ones and looked worse.
    const threeGood = pathStrength(9, 3); // 3.0 per hop
    const twoWeak = pathStrength(17, 2); // 8.5 per hop
    expect(threeGood.label).toBe('Strong');
    expect(twoWeak.label).toBe('Faint');
  });

  it('never returns undefined, whatever the cost', () => {
    for (const c of [0, 1, 50, 1000]) expect(pathStrength(c, 1).label).toBeTruthy();
    expect(pathStrength(5, 0).label).toBeTruthy();
  });
});
