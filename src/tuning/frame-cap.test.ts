import { describe, expect, it } from 'vitest';
import { createFrameGate, frameCapOptions, measureRefreshHz } from './frame-cap';

describe('refresh-rate measurement', () => {
  it('takes the median frame interval and snaps to a common panel rate', () => {
    expect(measureRefreshHz([16.6, 16.7, 16.8, 33.4, 16.7])).toBe(60);
    expect(measureRefreshHz([11.1, 11.2, 11.0, 11.1, 22.3])).toBe(90);
    expect(measureRefreshHz([8.3, 8.4, 8.3])).toBe(120);
    expect(measureRefreshHz([13.3, 13.4, 13.3])).toBe(75);
  });

  it('rounds an uncommon rate instead of snapping it far away, and needs samples', () => {
    expect(measureRefreshHz([17.9, 17.9, 17.9])).toBe(56);
    expect(measureRefreshHz([])).toBeNull();
    expect(measureRefreshHz([0, -1, Number.NaN])).toBeNull();
  });
});

describe('frame-rate cap options', () => {
  it('offers only divisors of the refresh rate, labelled by what they do', () => {
    expect(frameCapOptions(90)).toEqual([
      { divisor: 1, fps: 90, label: 'every frame' },
      { divisor: 2, fps: 45, label: 'every 2nd frame' },
      { divisor: 3, fps: 30, label: 'every 3rd frame' },
    ]);
    expect(frameCapOptions(60).map((o) => o.fps)).toEqual([60, 30, 20]);
    expect(frameCapOptions(null).map((o) => o.fps)).toEqual([null, null, null]);
  });
});

describe('frame gate', () => {
  const run = (gate: { shouldRun(): boolean }, n: number) =>
    Array.from({ length: n }, () => (gate.shouldRun() ? 1 : 0)).join('');

  it('runs every frame, every 2nd or every 3rd', () => {
    let divisor = 1;
    const gate = createFrameGate(() => divisor);
    expect(run(gate, 4)).toBe('1111');
    divisor = 2;
    expect(run(gate, 6)).toBe('101010');
    divisor = 3;
    expect(run(gate, 7)).toBe('1001001');
  });

  it('treats a bad divisor as full rate, and never skips more than two in three', () => {
    for (const bad of [0, -2, Number.NaN, 1.5, 9]) {
      const gate = createFrameGate(() => bad);
      expect(run(gate, 3)).toBe(bad === 9 ? '100' : '111');
    }
  });
});
