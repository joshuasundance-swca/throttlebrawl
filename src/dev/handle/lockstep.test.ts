import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SimSnapshot } from '../../sim/api';
import { createFastForward, FAST_FORWARD_TICKS, SETTLE_TICKS } from './lockstep';

// The fast-forward drives the loop's lockstep: on at many ticks a frame, then handed back the
// moment its condition holds (the loop reads the count before every step, app/loop.test.ts).
describe('dev/handle: fast-forward', () => {
  const snap = (tick: number) => ({ tick }) as SimSnapshot;
  afterEach(() => vi.restoreAllMocks());

  it('sets the fast lockstep, then hands back to the settle lockstep on the first step the condition holds', () => {
    const set: (number | null)[] = [];
    const ff = createFastForward((n) => set.push(n));
    ff.start((s) => s.tick >= 3);
    expect(ff.active).toBe(true);
    expect(set).toEqual([FAST_FORWARD_TICKS]);
    for (const t of [1, 2]) ff.step(snap(t));
    expect(set).toEqual([FAST_FORWARD_TICKS]);
    ff.step(snap(3));
    expect(set).toEqual([FAST_FORWARD_TICKS, SETTLE_TICKS]);
    expect(ff.active).toBe(false);
    ff.step(snap(4)); // done: later steps change nothing
    expect(set).toHaveLength(2);
  });

  it('takes its own speeds, and null hands back to real time', () => {
    const set: (number | null)[] = [];
    const ff = createFastForward((n) => set.push(n));
    ff.start((s) => s.tick === 1, { perFrame: 60, then: null });
    ff.step(snap(1));
    expect(set).toEqual([60, null]);
  });

  it('cancel drops it without touching the loop', () => {
    const set: (number | null)[] = [];
    const ff = createFastForward((n) => set.push(n));
    ff.start(() => false);
    ff.cancel();
    ff.step(snap(1));
    expect(ff.active).toBe(false);
    expect(set).toEqual([FAST_FORWARD_TICKS]);
  });

  it('stops, and says so as an error, when its condition throws', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const set: (number | null)[] = [];
    const ff = createFastForward((n) => set.push(n));
    ff.start(() => {
      throw new Error('broken check');
    });
    ff.step(snap(1));
    expect(ff.active).toBe(false);
    expect(set).toEqual([FAST_FORWARD_TICKS, SETTLE_TICKS]);
    expect(errors).toHaveBeenCalledOnce();
  });
});
