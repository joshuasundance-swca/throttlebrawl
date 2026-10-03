/// <reference types="vite/client" />
// The determinism run (2026-10-03), R5 and R6: the seeded tests' isolation profile and the seed
// search. No races run here.
// - The guard: `ISOLATED` (tests/sim/batch.ts) names every tuning declaration marked `system: true`,
//   and nothing else, each at a value that really changes it. A lane that adds a world system and
//   marks its switch, but leaves it out of the profile, fails here. Without that, the new system
//   would quietly reshuffle every isolated test's races.
// - firstSeed: the search is in order, stops at the first seed that qualifies, reports a range
//   where none does, and refuses an unbounded range.
import { describe, expect, it } from 'vitest';
import { ALL_TUNING } from '../../tools/packs/tuning';
import { FIRST_SEED_MAX, firstSeed, ISOLATED, seedRange } from './batch';

describe('the isolation profile for seeded tests (R5)', () => {
  const systems = ALL_TUNING.filter((d) => d.system === true);

  it('names every world-system switch (system: true), and only those', () => {
    process.stdout.write(
      `[isolation] ${ALL_TUNING.length} declarations examined, ${systems.length} marked system: ` +
        `${systems.map((d) => `${d.id} ${ISOLATED[d.id] ?? 'MISSING'}`).join(', ')}\n`,
    );
    expect(systems.length).toBeGreaterThan(0);
    const missing = systems.filter((d) => !(d.id in ISOLATED)).map((d) => d.id);
    expect(missing, 'marked system: true but missing from ISOLATED in tests/sim/batch.ts').toEqual([]);
    const marked = new Set(systems.map((d) => d.id));
    const extra = Object.keys(ISOLATED).filter((id) => !marked.has(id));
    expect(extra, 'in ISOLATED but not a declaration marked system: true').toEqual([]);
  });

  it.each(systems.map((d) => [d.id, d] as const))(
    '%s: the isolated value lies in its range and differs from the default',
    (id, d) => {
      const v = ISOLATED[id];
      expect(v).toBeTypeOf('number');
      expect(v).toBeGreaterThanOrEqual(d.min);
      expect(v).toBeLessThanOrEqual(d.max);
      expect(v).not.toBe(d.default);
    },
  );
});

describe('firstSeed: the first seed whose race has the precondition (R6)', () => {
  it('tries seeds in order and stops at the first that qualifies', () => {
    const ran: number[] = [];
    const found = firstSeed(
      'unit',
      seedRange(1, 10),
      (seed) => {
        ran.push(seed);
        return seed * seed;
      },
      (sq) => sq > 20,
    );
    expect(found.seed).toBe(5);
    expect(found.result).toBe(25);
    expect(ran).toEqual([1, 2, 3, 4, 5]);
    expect(found.tried.map((t) => t.seed)).toEqual([1, 2, 3, 4, 5]);
    expect(found.summary).toBe('unit: seed 5 (tried seeds 1 to 5)');
  });

  it('reports the whole range when no seed qualifies', () => {
    const found = firstSeed(
      'never',
      seedRange(3, 6),
      (seed) => seed,
      () => false,
    );
    expect(found.seed).toBeNull();
    expect(found.result).toBeNull();
    expect(found.tried).toHaveLength(4);
    expect(found.summary).toBe('never: none of seeds 3 to 6 qualifies');
  });

  it('refuses an empty or unbounded range', () => {
    expect(() =>
      firstSeed(
        'empty',
        [],
        (s) => s,
        () => true,
      ),
    ).toThrow();
    expect(() =>
      firstSeed(
        'huge',
        seedRange(1, FIRST_SEED_MAX + 1),
        (s) => s,
        () => true,
      ),
    ).toThrow();
  });
});
