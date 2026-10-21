import { describe, expect, it } from 'vitest';
import { memoCases, qualifyingCases } from './case-results';

interface Pair {
  seed: number;
  off: { t0: number; holder: number; swings: number; closeS: number };
  on: { t0: number; holder: number; swings: number; closeS: number };
}
const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
const pair = (seed: number): Pair => ({
  seed,
  off: { t0: [3, 7, 11].includes(seed) ? -1 : 1200, holder: seed % 4, swings: seed % 3, closeS: seed / 2 },
  on: { t0: [3, 7, 11].includes(seed) ? -1 : 1200, holder: seed % 4, swings: seed % 2, closeS: seed / 3 },
});
function totals(pairs: readonly Pair[]) {
  return pairs.reduce(
    (r, p) => ({
      examined: r.examined + 1,
      swingsOff: r.swingsOff + p.off.swings,
      swingsOn: r.swingsOn + p.on.swings,
      closeOff: r.closeOff + p.off.closeS,
      closeOn: r.closeOn + p.on.closeS,
    }),
    { examined: 0, swingsOff: 0, swingsOn: 0, closeOff: 0, closeOn: 0 },
  );
}
// Literal former ordered-selection/aggregation rule over cheap complete-pair fixtures.
function former() {
  const selected: Pair[] = [];
  const attempted: number[] = [];
  let examined = 0;
  let swingsOff = 0;
  let swingsOn = 0;
  let closeOff = 0;
  let closeOn = 0;
  for (const seed of seeds) {
    if (examined >= 16) break;
    const p = pair(seed);
    attempted.push(seed);
    expect(p.on.t0).toBe(p.off.t0);
    expect(p.on.holder).toBe(p.off.holder);
    if (p.off.t0 < 0) continue;
    examined++;
    swingsOff += p.off.swings;
    swingsOn += p.on.swings;
    closeOff += p.off.closeS;
    closeOn += p.on.closeS;
    selected.push(p);
  }
  return { selected, attempted, total: { examined, swingsOff, swingsOn, closeOff, closeOn } };
}
describe('bounded soak case collection', () => {
  it('matches the former ordered first16 selection and pooled arithmetic, without unused pairs', () => {
    const attempted: number[] = [];
    const c = qualifyingCases(
      seeds,
      16,
      (seed) => {
        attempted.push(seed);
        return pair(seed);
      },
      (p) => p.off.t0 >= 0,
    );
    for (const _slot of seeds) c.advance();
    expect(c.results()).toEqual(former().selected);
    expect(totals(c.results())).toEqual(former().total);
    expect(attempted).toEqual(former().attempted);
    expect(attempted).not.toContain(20);
    expect(c.complete()).toEqual(c.results());
    expect(attempted).toEqual(former().attempted);
  });
  it('a later named slot still advances the earliest required pair, and standalone aggregate completes', () => {
    const attempted: number[] = [];
    const c = qualifyingCases(
      seeds,
      16,
      (seed) => {
        attempted.push(seed);
        return pair(seed);
      },
      (p) => p.off.t0 >= 0,
    );
    const slots = seeds.map(() => () => c.advance());
    slots[15]!();
    expect(attempted).toEqual([1]);
    expect(() => c.results()).toThrow(/missing/i);
    expect(c.complete()).toEqual(former().selected);
    expect(attempted).toEqual(former().attempted);
    const alone: number[] = [];
    const aggregate = qualifyingCases(
      seeds,
      16,
      (seed) => {
        alone.push(seed);
        return pair(seed);
      },
      (p) => p.off.t0 >= 0,
    );
    expect(aggregate.complete()).toEqual(former().selected);
    expect(alone).toEqual(former().attempted);
  });
  it('preserves exhausted-pool shortfall instead of inventing qualifying results', () => {
    const c = qualifyingCases(seeds, 16, pair, () => false);
    expect(c.complete()).toEqual([]);
    expect(c.results()).toEqual([]);
  });
  it('never drops a failed complete pair or retries it during aggregation', () => {
    const attempted: number[] = [];
    const fault = new Error('off/on holder mismatch');
    const c = qualifyingCases(
      seeds,
      16,
      (seed) => {
        attempted.push(seed);
        if (seed === 2) throw fault;
        return pair(seed);
      },
      (p) => p.off.t0 >= 0,
    );
    c.advance();
    expect(() => c.advance()).toThrow(fault);
    expect(() => c.complete()).toThrow(fault);
    expect(() => c.results()).toThrow(fault);
    expect(attempted).toEqual([1, 2]);
  });
  it('memoizes each required route, preserves global aggregation and can run aggregate alone', () => {
    const cases = ['short', 'standard', 'real-a', 'real-b'];
    const attempted: string[] = [];
    const values = [0, 2, 1, 3];
    const c = memoCases(cases, (key) => {
      attempted.push(key);
      return { held: values[cases.indexOf(key)]!, down: [] as string[] };
    });
    c.get('real-b');
    expect(() => c.results()).toThrow(/missing/i);
    const rows = c.complete();
    expect(rows.map((r) => r.held)).toEqual(values);
    expect(rows.reduce((n, r) => n + r.held, 0)).toBe(6);
    expect(rows.flatMap((r) => r.down)).toEqual([]);
    expect(attempted).toEqual(['real-b', 'short', 'standard', 'real-a']);
    c.complete();
    expect(attempted).toHaveLength(4);
    const alone: string[] = [];
    expect(
      memoCases(cases, (key) => {
        alone.push(key);
        return key;
      }).complete(),
    ).toEqual(cases);
    expect(alone).toEqual(cases);
  });
  it('rejects missing route output and retains failed route errors for the aggregate', () => {
    const missing = memoCases(['a'], () => undefined);
    expect(() => missing.get('a')).toThrow(/missing/i);
    expect(() => missing.complete()).toThrow(/missing/i);
    const failure = new Error('required route failed');
    let calls = 0;
    const failed = memoCases(['a', 'b'], (key) => {
      calls++;
      if (key === 'b') throw failure;
      return key;
    });
    failed.get('a');
    expect(() => failed.get('b')).toThrow(failure);
    expect(() => failed.complete()).toThrow(failure);
    expect(() => failed.results()).toThrow(failure);
    expect(calls).toBe(2);
    expect(() => failed.get('unknown')).toThrow(/unknown/i);
  });
});
