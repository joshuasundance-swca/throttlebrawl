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

  it('with until takedown, runs past the first hit and stops at the first bot takedown', () => {
    const run = botAttackRun(8, { includeDrafts: true, maxTicks: 4000, until: 'takedown' });
    console.log(`[examined] ${JSON.stringify(run)}`);
    if (run.takedowns > 0) {
      expect(run.takedowns).toBe(1);
      expect(['health', 'traffic', 'scenery']).toContain(run.takedownKind);
      expect(run.hits).toBeGreaterThan(0); // a takedown is credited to a landed hit
    } else {
      expect(run.takedownKind).toBeNull();
      expect(run.over || run.ticks === 4000).toBe(true);
    }
  }, 60_000);

  it('with until shortcut, stops at the bot’s first tick on the boat-ramp cut (seed 2 takes it)', () => {
    const run = botAttackRun(2, { includeDrafts: true, maxTicks: 3600, until: 'shortcut' });
    console.log(`[examined] ${JSON.stringify(run)}`);
    expect(run.shortcutTicks).toBe(1);
    expect(run.ticks).toBeLessThan(3600);
  }, 60_000);
});
