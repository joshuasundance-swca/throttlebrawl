import { describe, expect, it } from 'vitest';
import { hasSuccessfulMainGate } from './main-acceptance.mjs';

const gate = { name: 'gate', status: 'completed', conclusion: 'success' };

describe('main acceptance is its actual completed gate, not workflow completion', () => {
  it('recognizes the accepted production path alongside its skipped suite', () => {
    expect(
      hasSuccessfulMainGate([
        { name: 'suite', status: 'completed', conclusion: 'skipped' },
        { name: 'prod build (tree already tested)', status: 'completed', conclusion: 'success' },
        gate,
      ]),
    ).toBe(true);
  });

  it('does not accept a routing-only successful workflow or skipped gate', () => {
    expect(
      hasSuccessfulMainGate([
        { name: 'superseded main', status: 'completed', conclusion: 'success' },
        { ...gate, conclusion: 'skipped' },
      ]),
    ).toBe(false);
    expect(hasSuccessfulMainGate([{ name: 'superseded main', conclusion: 'success' }])).toBe(false);
  });

  it.each(['failure', 'cancelled', 'timed_out', 'neutral', '', null])(
    'rejects an unfinished or non-successful acceptance (%s)',
    (conclusion) => {
      expect(hasSuccessfulMainGate([{ ...gate, conclusion }])).toBe(false);
    },
  );

  it('requires the exact acceptance job and its completed state', () => {
    for (const name of ['quick', 'suite / gate', 'gate ', 'Gate'])
      expect(hasSuccessfulMainGate([{ ...gate, name }]), name).toBe(false);
    expect(hasSuccessfulMainGate([{ ...gate, status: 'in_progress' }])).toBe(false);
  });

  it('rejects missing, malformed and ambiguous gate listings', () => {
    for (const jobs of [null, undefined, {}, [], [null], [gate, null], [gate, gate]])
      expect(hasSuccessfulMainGate(jobs)).toBe(false);
  });
});
