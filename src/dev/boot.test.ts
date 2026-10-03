// dev/boot.ts: the stand-in test handle the page shows until dev/'s lazy chunk is in. A spec's
// setter called before the real handle exists must reach it, in order, exactly once; reads answer
// undefined (the specs read with `?.` and poll), and are never replayed.
import { describe, expect, it } from 'vitest';
import { createPendingHandle, QUEUED_CALLS } from './boot';

describe('the pending test handle', () => {
  it('queues the setters and replays them on the real handle, in order, once', () => {
    const pending = createPendingHandle();
    const stub = pending.stub as Record<string, (...a: unknown[]) => unknown>;
    expect(stub['setSeed']?.(3)).toBeUndefined();
    expect(stub['snapshot']?.()).toBeUndefined();
    expect(stub['state']?.()).toBeUndefined();
    stub['setBot']?.(true);
    stub['tap']?.();

    const calls: string[] = [];
    const real = {
      seed: 1,
      setSeed(seed: number) {
        this.seed = seed;
        calls.push(`setSeed ${seed}`);
      },
      setBot: (on: boolean) => calls.push(`setBot ${on}`),
      tap: () => calls.push('tap'),
      snapshot: () => calls.push('snapshot'),
      state: () => calls.push('state'),
    };
    pending.flush(real);
    expect(calls).toEqual(['setSeed 3', 'setBot true', 'tap']);
    expect(real.seed).toBe(3);

    // Flushed once: a second flush replays nothing.
    pending.flush(real);
    expect(calls).toHaveLength(3);
  });

  it('queues exactly the calls that change something', () => {
    expect([...QUEUED_CALLS].sort()).toEqual(['setBot', 'setSeed', 'startRace', 'tap']);
  });
});
