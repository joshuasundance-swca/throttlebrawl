import { describe, expect, it, vi } from 'vitest';
import {
  createFrameObservation,
  nextFrameEpoch,
  type AppDrawnFrame,
  type FrameContext,
} from './frame-observation';
import { createCountdown } from './countdown';
import { lockstepSteps } from './loop';

function rig() {
  const context: FrameContext = {
    state: 'race',
    race: true,
    snapshot: true,
    tickZero: false,
    uiPaused: false,
    loopPaused: false,
    hidden: false,
    contextHold: false,
    loading: false,
    visible: true,
    contextLost: false,
    countdown: false,
    lockstep: null,
  };
  const feed = createFrameObservation(() => ({ ...context }));
  const seen: Readonly<AppDrawnFrame>[] = [];
  feed.subscribe(
    (f) => seen.push(f),
    (e) => {
      throw e;
    },
  );
  const draw = (now = 100, synthetic = false, hasPose = true, render = () => {}) =>
    feed.draw(now, synthetic, hasPose, render);
  return { context, feed, seen, draw };
}

describe('actual frame observation', () => {
  it('fails explicitly at epoch exhaustion instead of wrapping or emitting an unsafe identity', () => {
    expect(nextFrameEpoch(0)).toBe(1);
    expect(nextFrameEpoch(Number.MAX_SAFE_INTEGER - 1)).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => nextFrameEpoch(Number.MAX_SAFE_INTEGER)).toThrow('epoch exhausted');
  });
  it('emits immediately after one logical renderer invocation returns, using the raw timestamp', () => {
    const { feed, draw } = rig();
    const order: string[] = [];
    feed.subscribe((frame) => {
      order.push('sample');
      expect(frame.timestampMs).toBe(812.5);
    }, vi.fn());
    draw(812.5, false, true, () => {
      order.push('scene', 'post-quad');
    });
    order.push('audio');
    expect(order).toEqual(['scene', 'post-quad', 'sample', 'audio']);
  });

  it.each(['missing pose', 'lost before', 'lost during', 'render throw'] as const)(
    'does not emit on %s, invalidates continuity, and preserves render exceptions',
    (reason) => {
      const { context, draw, seen, feed } = rig();
      draw();
      const epoch = seen[0]!.epoch;
      if (reason === 'lost before') context.contextLost = true;
      const error = new Error('renderer failed');
      const render = vi.fn(() => {
        if (reason === 'lost during') context.contextLost = true;
        if (reason === 'render throw') throw error;
      });
      const attempt = () => draw(200, false, reason !== 'missing pose', render);
      if (reason === 'render throw') expect(attempt).toThrow(error);
      else attempt();
      expect(seen).toHaveLength(1);
      expect(render).toHaveBeenCalledTimes(reason === 'missing pose' ? 0 : 1);
      context.contextLost = false;
      feed.refresh();
      draw(300);
      expect(seen[1]!.epoch).toBeGreaterThan(epoch);
    },
  );

  it.each([
    ['state', 'menu'],
    ['state', 'results'],
    ['race', false],
    ['snapshot', false],
    ['tickZero', true],
    ['uiPaused', true],
    ['loopPaused', true],
    ['hidden', true],
    ['contextHold', true],
    ['loading', true],
    ['visible', false],
    ['countdown', true],
    ['lockstep', 8],
  ] as const)('excludes %s=%s while completing backdrop draws', (key, value) => {
    const { context, draw, seen } = rig();
    Object.assign(context, { [key]: value });
    draw();
    expect(seen[0]!.eligible).toBe(false);
  });

  it('keeps the last held countdown frame ineligible until the first actual sim tick', () => {
    const { context, draw, feed, seen } = rig();
    const countdown = createCountdown(1, 1);
    countdown.begin(true);
    context.tickZero = true;
    context.countdown = countdown.holding;
    feed.refresh();
    for (let i = 0; i < 3; i++) {
      expect(countdown.step().hold).toBe(true);
      context.countdown = countdown.holding;
      feed.refresh();
      draw(i);
    }
    expect(context.countdown).toBe(false);
    expect(seen.every((f) => !f.eligible)).toBe(true);
    expect(countdown.step().hold).toBe(false);
    context.tickZero = false;
    feed.refresh();
    draw(4);
    expect(seen[3]!.eligible).toBe(true);
  });

  it.each([
    'uiPaused',
    'loopPaused',
    'hidden',
    'contextHold',
    'loading',
    'visible',
    'countdown',
    'tickZero',
  ] as const)('remembers between-frame %s interruptions, even false-to-false eligibility', (key) => {
    const { context, draw, seen, feed } = rig();
    context.state = 'menu';
    draw();
    const before = seen[0]!.epoch;
    const initial = context[key];
    context[key] = !initial;
    feed.refresh();
    feed.refresh(); // duplicate hold or no-op sync
    context[key] = initial;
    feed.refresh();
    draw(200);
    expect(seen[1]!.epoch).toBeGreaterThan(before);
    draw(300);
    expect(seen[2]!.epoch).toBe(seen[1]!.epoch);
    feed.invalidate(); // identical scene, fresh race
    draw(400);
    expect(seen[3]!.epoch).toBeGreaterThan(seen[2]!.epoch);
  });

  it('separates normalized live lockstep from historical synthetic hand-back', () => {
    const { context, feed, draw, seen } = rig();
    const set = (steps: number | null) => {
      context.lockstep = lockstepSteps(steps);
      feed.refresh();
    };
    draw();
    set(8.9);
    draw(200, true);
    set(8.1);
    draw(300, true);
    expect(seen[2]!.epoch).toBe(seen[1]!.epoch);
    set(null); // the final fast-forward step hands ownership back
    draw(400, true);
    expect(seen[3]!.epoch).toBeGreaterThan(seen[2]!.epoch);
    expect(seen[3]!.eligible).toBe(false);
    feed.refresh();
    draw(500);
    expect(seen[4]!.eligible).toBe(true);
    expect(seen[4]!.epoch).toBe(seen[3]!.epoch);
    set(NaN);
    draw(600);
    expect(seen[5]!.epoch).toBe(seen[4]!.epoch);
  });

  it('uses distinct registration tokens and idempotent owner-only unsubscribe', () => {
    const { context } = rig();
    const feed = createFrameObservation(() => ({ ...context }));
    const listener = vi.fn();
    const first = feed.subscribe(listener, vi.fn());
    const second = feed.subscribe(listener, vi.fn());
    expect(listener).not.toHaveBeenCalled();
    feed.draw(1, false, true, () => {});
    expect(listener).toHaveBeenCalledTimes(2);
    first();
    first();
    feed.draw(2, false, true, () => {});
    expect(listener).toHaveBeenCalledTimes(3);
    second();
    feed.draw(3, false, true, () => {});
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('freezes one original sample, skips removed entries and delays additions during dispatch', () => {
    const { context, feed, draw } = rig();
    const next = vi.fn();
    const removed = vi.fn();
    const samples: Readonly<AppDrawnFrame>[] = [];
    let remove = () => {};
    feed.subscribe((f) => {
      samples.push(f);
      expect(Object.isFrozen(f)).toBe(true);
      expect(() => Object.assign(f, { eligible: false })).toThrow();
      context.uiPaused = true;
      feed.refresh();
      remove();
      feed.subscribe(next, vi.fn());
    }, vi.fn());
    remove = feed.subscribe(removed, vi.fn());
    feed.subscribe((f) => samples.push(f), vi.fn());
    draw();
    expect(samples[0]).toBe(samples[1]);
    expect(samples[1]!.eligible).toBe(true);
    expect(removed).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    draw(200);
    expect(next).toHaveBeenCalledTimes(1);
    expect(samples[3]!.eligible).toBe(false);
  });

  it('detaches failures before error notification, isolates throwing callbacks, and keeps delivering', () => {
    const { feed, draw } = rig();
    const render = vi.fn();
    const bad = vi.fn(() => {
      throw new Error('listener');
    });
    const error = vi.fn(() => {
      draw(101);
      throw new Error('owner');
    });
    const survivor = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      feed.subscribe(bad, error);
      feed.subscribe(survivor, vi.fn());
      draw(100, false, true, render);
      draw(200, false, true, render);
      expect(bad).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(survivor).toHaveBeenCalledTimes(3);
      expect(render).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('creates no sample when unsubscribed and retains the instance epoch when re-subscribed', () => {
    const { context } = rig();
    const feed = createFrameObservation(() => ({ ...context }));
    const freeze = vi.spyOn(Object, 'freeze');
    try {
      feed.draw(1, false, true, () => {});
      expect(freeze).not.toHaveBeenCalled();
      const first = vi.fn();
      const off = feed.subscribe(first, vi.fn());
      feed.draw(2, false, true, () => {});
      const epoch = (first.mock.calls[0]![0] as AppDrawnFrame).epoch;
      off();
      context.hidden = true;
      feed.refresh();
      context.hidden = false;
      feed.refresh();
      const later = vi.fn();
      feed.subscribe(later, vi.fn());
      feed.draw(3, false, true, () => {});
      expect((later.mock.calls[0]![0] as AppDrawnFrame).epoch).toBeGreaterThan(epoch);
    } finally {
      freeze.mockRestore();
    }
  });
});
