import { describe, expect, it } from 'vitest';
import { botAttackRun } from './attacks';

// The in-page attack runs' mechanics: they respect the tick cap and stop at the first landed hit.
// Whether a given seed connects is the browser race's aggregate question, not asserted here.
describe('dev/handle: botAttackRun', () => {
  it('stops at the tick cap', () => {
    const run = botAttackRun(1, { maxTicks: 120 });
    expect(run.ticks).toBeLessThanOrEqual(120);
    expect(run.seed).toBe(1);
  });

  it('stops at the first landed hit, or runs to the cap', () => {
    const runs = [1, 2].map((seed) => botAttackRun(seed, { includeDrafts: true, maxTicks: 1800 }));
    console.log(`[examined] ${JSON.stringify(runs)}`);
    for (const r of runs) {
      if (r.hits > 0) {
        expect(r.hits).toBe(1);
        expect(r.attackStarts).toBeGreaterThan(0);
        expect(r.attackPresses).toBeGreaterThan(0);
      } else expect(r.over || r.ticks === 1800).toBe(true);
    }
  }, 30_000);
});
