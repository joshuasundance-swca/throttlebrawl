import { describe, expect, it } from 'vitest';
import { average, parseLog } from './timings.mjs';

describe('timing table averages', () => {
  it('retains positive short whole-file measurements from the sim reporter', () => {
    const measured = parseLog(
      [
        'file-time tests/sim/furniture-falls.test.ts: 0.02 s (collect 0.02 s, tests 0.01 s)',
        'file-time tests/sim/furniture-credit.test.ts: 0.03 s (collect 0.02 s, tests 0.01 s)',
      ].join('\n'),
    );
    expect(average([measured.sim])).toEqual({
      'tests/sim/furniture-credit.test.ts': 0.03,
      'tests/sim/furniture-falls.test.ts': 0.02,
    });
  });

  it('keeps the measured mean for tiny files, a real zero, and ordinary tenth-second rounding', () => {
    expect(
      average([
        { short: 0.02, zero: 0, ordinary: 12.34, onlyFirst: 2.26 },
        { short: 0.03, zero: 0, ordinary: 12.38 },
      ]),
    ).toEqual({ onlyFirst: 2.3, ordinary: 12.4, short: 0.025, zero: 0 });
    expect(average([])).toEqual({});
  });
});
