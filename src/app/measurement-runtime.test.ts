import { describe, expect, it, vi } from 'vitest';
import { createMeasurementRuntime } from './measurement-runtime';
import type { AppMeasurementEvent, TickDriver } from './index';
import type { MeasurementSceneResult } from './measurement-scene';
import type { WakeLeaseResult } from '../platform';
import type { AudioSuspendLeaseResult } from '../audio';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  const order: string[] = [];
  const scene = { kind: 'ready', config: {}, stream: {}, scene: { seed: 7 } } as unknown as Extract<
    MeasurementSceneResult,
    { kind: 'ready' }
  >;
  const wake = { state: 'held' as const, release: vi.fn(() => order.push('wake-release')) };
  const audio = {
    state: 'held' as const,
    observedState: 'none' as const,
    wasRunningIntent: true,
    release: vi.fn(() => order.push('audio-release')),
  };
  const host = {
    preflight: vi.fn(() => null),
    prepare: vi.fn(() => Promise.resolve(scene)),
    acquireWake: vi.fn((): Promise<WakeLeaseResult> => Promise.resolve({ kind: 'acquired', lease: wake })),
    acquireAudio: vi.fn((): Promise<AudioSuspendLeaseResult> =>
      Promise.resolve({ kind: 'acquired', lease: audio }),
    ),
    audioState: vi.fn((): import('../audio').AudioObservedState => 'none'),
    current: vi.fn(() => true),
    commit: vi.fn(),
    invalidate: vi.fn(() => order.push('epoch')),
    restore: vi.fn(() => {
      order.push('restore');
      return { logical: 'menu' as const, visible: 'restored' as const };
    }),
    quality: () => ({ setting: 'auto' as const, tier: 'high' as const, scale: 1, pixelRatio: 1 }),
  };
  const runtime = createMeasurementRuntime(host);
  host.commit.mockImplementation(() => {
    if (runtime.factory(0)) runtime.repeatStart();
  });
  const controller = new AbortController();
  const driver = vi.fn();
  const begin = async (factory: () => TickDriver = () => driver) => {
    const result = await runtime.begin({ signal: controller.signal, driverForRepeat: factory });
    if (result.kind !== 'started') throw new Error(result.reason);
    return result.session;
  };
  return { runtime, host, controller, begin, order, audio, wake };
}

describe('measurement ownership', () => {
  it.each([
    ['wake', 'abort'],
    ['wake', 'supersede'],
    ['audio', 'abort'],
    ['audio', 'supersede'],
  ] as const)(
    'retires hung %s on %s and releases its late lease without affecting a new owner',
    async (stage, cause) => {
      const f = fixture();
      const entered = deferred<void>();
      const late = deferred<WakeLeaseResult & AudioSuspendLeaseResult>();
      const lateLease = {
        state: 'held' as const,
        observedState: 'none' as const,
        wasRunningIntent: true,
        release: vi.fn(),
      };
      const acquire = () => {
        entered.resolve();
        return late.promise;
      };
      if (stage === 'wake') f.host.acquireWake.mockImplementationOnce(acquire);
      else f.host.acquireAudio.mockImplementationOnce(acquire);
      const factory = vi.fn(() => vi.fn());
      const pending = f.runtime.begin({ signal: f.controller.signal, driverForRepeat: factory });
      await entered.promise;
      expect(f.runtime.owned).toBe(true);
      expect(f.host.commit).not.toHaveBeenCalled();
      const delivery = vi.fn();
      if (cause === 'abort') f.controller.abort();
      else f.runtime.action('ordinary', delivery);
      expect(await pending).toMatchObject({
        kind: 'refused',
        reason: cause === 'abort' ? 'aborted' : 'superseded-before-start',
      });
      expect(delivery).toHaveBeenCalledTimes(cause === 'abort' ? 0 : 1);
      expect(f.runtime.owned).toBe(false);
      expect(factory).not.toHaveBeenCalled();
      expect(f.wake.release).toHaveBeenCalledTimes(stage === 'audio' ? 1 : 0);
      const next = await f.runtime.begin({ signal: new AbortController().signal, driverForRepeat: factory });
      expect(next.kind).toBe('started');
      if (next.kind !== 'started') throw new Error(next.reason);
      const events = vi.fn();
      next.session.subscribe(events, vi.fn());
      events.mockClear();
      late.resolve({ kind: 'acquired', lease: lateLease });
      await late.promise;
      expect(lateLease.release).toHaveBeenCalledTimes(1);
      expect(f.host.commit).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenCalledTimes(1);
      expect(events).not.toHaveBeenCalled();
      expect(next.session.inspect().phase).toBe('running');
      next.session.stop('collector-target');
      expect(await next.session.ended).toMatchObject({ kind: 'stopped' });
      expect(lateLease.release).toHaveBeenCalledTimes(1);
    },
  );

  it('refuses an acquired wake already lost and releases it without acquiring audio', async () => {
    const f = fixture();
    const release = vi.fn();
    f.host.acquireWake.mockResolvedValueOnce({ kind: 'acquired', lease: { state: 'lost', release } });
    expect(
      await f.runtime.begin({ signal: f.controller.signal, driverForRepeat: () => vi.fn() }),
    ).toMatchObject({ reason: 'wake-lost-before-start' });
    expect(release).toHaveBeenCalledTimes(1);
    expect(f.host.acquireAudio).not.toHaveBeenCalled();
    expect(f.host.commit).not.toHaveBeenCalled();
    expect(f.runtime.owned).toBe(false);
    const session = await f.begin();
    expect(f.host.commit).toHaveBeenCalledTimes(1);
    session.stop('collector-target');
  });

  it('refuses a held wake lost while audio acquisition awaits and releases both unpublished leases', async () => {
    const f = fixture();
    let wakeState: 'held' | 'lost' = 'held';
    const release = vi.fn();
    f.host.acquireWake.mockResolvedValueOnce({
      kind: 'acquired',
      lease: {
        get state() {
          return wakeState;
        },
        release,
      },
    });
    const entered = deferred<void>();
    const audio = deferred<AudioSuspendLeaseResult>();
    f.host.acquireAudio.mockImplementationOnce(() => {
      entered.resolve();
      return audio.promise;
    });
    const pending = f.runtime.begin({ signal: f.controller.signal, driverForRepeat: () => vi.fn() });
    await entered.promise;
    expect(wakeState).toBe('held');
    wakeState = 'lost';
    audio.resolve({ kind: 'acquired', lease: f.audio });
    expect(await pending).toMatchObject({ reason: 'wake-lost-before-start' });
    expect(release).toHaveBeenCalledTimes(1);
    expect(f.audio.release).toHaveBeenCalledTimes(1);
    expect(f.host.commit).not.toHaveBeenCalled();
    const session = await f.begin();
    expect(f.host.commit).toHaveBeenCalledTimes(1);
    session.stop('collector-target');
  });

  it.each(['scene', 'wake'] as const)(
    'rejects the original unexpected %s exception and permits a following start',
    async (stage) => {
      const f = fixture();
      const error = new Error(stage);
      if (stage === 'scene')
        f.host.prepare.mockImplementationOnce(() => {
          throw error;
        });
      else f.host.acquireWake.mockRejectedValueOnce(error);
      await expect(
        f.runtime.begin({ signal: f.controller.signal, driverForRepeat: () => vi.fn() }),
      ).rejects.toBe(error);
      expect(f.runtime.owned).toBe(false);
      expect(f.host.commit).not.toHaveBeenCalled();
      const session = await f.begin();
      expect(f.host.commit).toHaveBeenCalledTimes(1);
      session.stop('collector-target');
    },
  );

  it.each(['throw', 'reject', 'refuse'] as const)(
    'maps audio %s to exact nested refusal and releases the unpublished wake',
    async (mode) => {
      const f = fixture();
      const nested = {
        kind: 'refused' as const,
        reason: 'not-suspended' as const,
        observedState: 'running' as const,
      };
      if (mode === 'throw')
        f.host.acquireAudio.mockImplementationOnce(() => {
          throw new Error('audio');
        });
      else if (mode === 'reject') f.host.acquireAudio.mockRejectedValueOnce(new Error('audio'));
      else f.host.acquireAudio.mockResolvedValueOnce(nested);
      const result = await f.runtime.begin({ signal: f.controller.signal, driverForRepeat: () => vi.fn() });
      expect(result).toEqual({
        kind: 'refused',
        reason: 'audio-suspend-refused',
        sceneRefusal: null,
        wakeRefusal: null,
        audioRefusal:
          mode === 'refuse' ? nested : { kind: 'refused', reason: 'suspend-failed', observedState: null },
      });
      if (result.kind !== 'refused') throw new Error('Expected refusal');
      expect(Object.isFrozen(result.audioRefusal)).toBe(true);
      expect(f.wake.release).toHaveBeenCalledTimes(1);
      expect(f.host.commit).not.toHaveBeenCalled();
      const session = await f.begin();
      expect(f.host.commit).toHaveBeenCalledTimes(1);
      session.stop('collector-target');
    },
  );

  it('contains a throwing onError, removes its listener, and continues sibling publication', async () => {
    const f = fixture();
    const session = await f.begin();
    const listenerError = new Error('listener');
    const callbackError = new Error('onError');
    const listener = vi.fn((event: AppMeasurementEvent) => {
      if (event.kind === 'repeat-end') throw listenerError;
    });
    const onError = vi.fn(() => {
      throw callbackError;
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      session.subscribe(listener, onError);
      const sibling = vi.fn<(event: AppMeasurementEvent) => void>();
      session.subscribe(sibling, vi.fn());
      sibling.mockClear();
      expect(() => f.runtime.repeatEnd('finished')).not.toThrow();
      expect(onError).toHaveBeenCalledExactlyOnceWith(listenerError);
      expect(log).toHaveBeenCalledExactlyOnceWith('Measurement error callback failed', callbackError);
      expect(sibling).toHaveBeenCalledTimes(1);
      expect(session.inspect().phase).toBe('running');
      const calls = listener.mock.calls.length;
      if (f.runtime.factory(1)) f.runtime.repeatStart();
      session.stop('collector-target');
      await session.ended;
      expect(listener).toHaveBeenCalledTimes(calls);
      expect(sibling.mock.calls.map(([event]) => event.kind)).toEqual([
        'repeat-end',
        'repeat-start',
        'repeat-end',
        'ended',
      ]);
    } finally {
      log.mockRestore();
    }
  });

  it('primes reentrant terminal subscribers after outer publication with the same frozen end', async () => {
    const f = fixture();
    const session = await f.begin();
    const order: string[] = [];
    const ends: unknown[] = [];
    session.subscribe((event) => {
      if (event.kind === 'repeat-end') {
        order.push('first:repeat-end');
        session.subscribe((prime) => {
          order.push(`from-repeat:${prime.kind}`);
          if (prime.kind === 'ended') ends.push(prime.end);
        }, vi.fn());
        session.stop('caller-cancelled');
      } else if (event.kind === 'ended') {
        order.push('first:ended');
        ends.push(event.end);
        session.subscribe((prime) => {
          order.push(`from-ended:${prime.kind}`);
          if (prime.kind === 'ended') ends.push(prime.end);
        }, vi.fn());
      }
    }, vi.fn());
    session.subscribe((event) => {
      if (event.kind === 'ended') {
        order.push('sibling:ended');
        ends.push(event.end);
      }
    }, vi.fn());
    void session.ended.then(() => order.push('promise'));
    f.runtime.repeatEnd('finished');
    const end = await session.ended;
    expect(order).toEqual([
      'first:repeat-end',
      'first:ended',
      'sibling:ended',
      'from-repeat:ended',
      'from-ended:ended',
      'promise',
    ]);
    expect(ends).toHaveLength(4);
    for (const evidence of ends) expect(evidence).toBe(end);
    expect(Object.isFrozen(end)).toBe(true);
    expect(f.host.restore).toHaveBeenCalledTimes(1);
    session.stop('collector-target');
    const post = vi.fn();
    const remove = session.subscribe(post, vi.fn());
    remove();
    remove();
    expect(post).toHaveBeenCalledExactlyOnceWith({ kind: 'ended', end });
    expect(f.host.restore).toHaveBeenCalledTimes(1);
  });

  it('settles a cancelled hung preparation before delivering one ordinary action', async () => {
    const order: string[] = [];
    const runtime = createMeasurementRuntime({
      preflight: () => null,
      prepare: () => new Promise(() => {}),
      acquireWake: vi.fn(),
      acquireAudio: vi.fn(),
      audioState: () => 'none',
      current: () => true,
      commit: vi.fn(),
      restore: vi.fn(),
      invalidate: vi.fn(),
      quality: () => ({ setting: 'auto', tier: 'high', scale: 1, pixelRatio: 1 }),
    });
    const pending = runtime.begin({ signal: new AbortController().signal, driverForRepeat: () => vi.fn() });
    void pending.then(() => order.push('settled'));
    runtime.action('ordinary', () => order.push('delivery'));
    expect(await pending).toMatchObject({ kind: 'refused', reason: 'superseded-before-start' });
    expect(order).toEqual(['delivery', 'settled']);
    expect(runtime.owned).toBe(false);
  });

  it('reserves before awaiting and refuses duplicate or already aborted requests', async () => {
    const prepare = vi.fn(() => new Promise<never>(() => {}));
    const runtime = createMeasurementRuntime({
      preflight: () => null,
      prepare,
      acquireWake: vi.fn(),
      acquireAudio: vi.fn(),
      audioState: () => 'none',
      current: () => true,
      commit: vi.fn(),
      restore: vi.fn(),
      invalidate: vi.fn(),
      quality: () => ({ setting: 'auto', tier: 'high', scale: 1, pixelRatio: 1 }),
    });
    const controller = new AbortController();
    const request = { signal: controller.signal, driverForRepeat: () => vi.fn() };
    const pending = runtime.begin(request);
    expect(await runtime.begin(request)).toMatchObject({ reason: 'owner-busy' });
    controller.abort();
    expect(await pending).toMatchObject({ reason: 'aborted' });
    expect(await runtime.begin(request)).toMatchObject({ reason: 'aborted' });
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it.each([
    'collector-target',
    'collector-deadline',
    'collector-bad-timestamp',
    'collector-overflow',
    'collector-feed-failed',
    'caller-cancelled',
  ] as const)(
    'latches stopped evidence once for %s before restoration and shares the event/promise object',
    async (reason) => {
      const f = fixture();
      const session = await f.begin();
      const events: AppMeasurementEvent[] = [];
      session.subscribe((event) => {
        events.push(event);
        f.order.push(event.kind);
      }, vi.fn());
      f.runtime.progress(42, false);
      session.stop(reason);
      session.stop('caller-cancelled');
      f.controller.abort();
      const end = await session.ended;
      expect(end).toMatchObject({
        kind: 'stopped',
        reason,
        repeats: [{ index: 0, finalTick: 42, reason: 'session-ended' }],
      });
      expect(events.map((e) => e.kind)).toEqual(['repeat-start', 'repeat-end', 'ended']);
      expect((events[2] as Extract<AppMeasurementEvent, { kind: 'ended' }>).end).toBe(end);
      expect(f.host.restore).toHaveBeenCalledTimes(1);
      expect(f.audio.release).toHaveBeenCalledTimes(1);
      expect(f.wake.release).toHaveBeenCalledTimes(1);
      expect(f.order.indexOf('restore')).toBeLessThan(f.order.indexOf('ended'));
      expect(Object.isFrozen(end.repeats[0])).toBe(true);
      expect(session.inspect().phase).toBe('ended');
    },
  );
  it.each(['manual-pause', 'back', 'quit'] as const)(
    'consumes active %s without ordinary delivery',
    async (action) => {
      const f = fixture();
      const session = await f.begin();
      const delivery = vi.fn();
      f.runtime.action(action, delivery);
      expect((await session.ended).reason).toBe(action);
      expect(delivery).not.toHaveBeenCalled();
    },
  );
  it('drains raw controls and restores before one explicit action, including throwing delivery', async () => {
    const f = fixture();
    const session = await f.begin();
    const raw = vi.fn();
    f.runtime.action('raw', raw);
    expect(raw).not.toHaveBeenCalled();
    const error = new Error('ordinary action');
    expect(() =>
      f.runtime.action('ordinary', () => {
        expect(f.host.restore).toHaveBeenCalledTimes(1);
        expect(f.audio.release).toHaveBeenCalledTimes(1);
        throw error;
      }),
    ).toThrow(error);
    expect(await session.ended).toMatchObject({ reason: 'superseded' });
  });
  it.each([
    'driver-factory-failed',
    'driver-failed',
    'draw-failed',
    'hidden',
    'pagehide',
    'fullscreen',
    'rotate',
    'context-lost',
    'wake-lost',
    'wake-observation-failed',
    'synthetic-clock',
    'scene-drift',
    'driver-conflict',
    'action-gate-failed',
  ] as const)('shares cleanup for failed %s', async (reason) => {
    const f = fixture();
    const session = await f.begin();
    f.runtime.fail(reason);
    f.runtime.fail('hidden');
    expect(await session.ended).toMatchObject({ kind: 'failed', reason });
    expect(f.host.restore).toHaveBeenCalledTimes(1);
  });
  it('quiet commit observes actual state; running or throwing observations refuse and release leases', async () => {
    for (const observed of ['running', 'throw'] as const) {
      const f = fixture();
      f.host.audioState.mockImplementation(() => {
        if (observed === 'throw') throw new Error('observe');
        return 'running';
      });
      expect(
        await f.runtime.begin({ signal: f.controller.signal, driverForRepeat: () => vi.fn() }),
      ).toMatchObject({
        reason: 'audio-suspend-refused',
        audioRefusal: { reason: observed === 'throw' ? 'observation-failed' : 'not-suspended' },
      });
      expect(f.host.commit).not.toHaveBeenCalled();
      expect(f.audio.release).toHaveBeenCalledTimes(1);
      expect(f.wake.release).toHaveBeenCalledTimes(1);
    }
  });
  it('records raw commit and terminal time before callbacks, excluding preparation', async () => {
    const f = fixture();
    let now = 100;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    f.host.commit.mockImplementation(() => {
      now = 200;
      if (f.runtime.factory(0)) f.runtime.repeatStart();
    });
    try {
      const session = await f.begin();
      expect(session.committedAtMs).toBe(100);
      session.subscribe(() => {
        now += 100;
      }, vi.fn());
      now = 400;
      f.host.restore.mockImplementation(() => {
        now = 900;
        return { logical: 'menu', visible: 'restored' };
      });
      session.stop('collector-target');
      const end = await session.ended;
      expect(end.endedAtMs).toBe(400);
      expect(session.committedAtMs).toBe(100);
      const primed = vi.fn();
      session.subscribe(primed, vi.fn());
      expect(primed.mock.calls[0]![0]).toMatchObject({ kind: 'ended', end: { endedAtMs: 400 } });
    } finally {
      clock.mockRestore();
    }
  });
  it('fresh factories and ordered repeats stop reentrantly before the next factory', async () => {
    const f = fixture();
    const factory = vi.fn(() => vi.fn());
    const session = await f.begin(factory);
    const events: string[] = [];
    session.subscribe((event) => {
      events.push(event.kind);
      if (event.kind === 'repeat-end') session.stop('caller-cancelled');
    }, vi.fn());
    f.runtime.repeatEnd('finished');
    const current = f.runtime.current();
    if (current()) f.runtime.factory(1);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['repeat-start', 'repeat-end', 'ended']);
    expect((await session.ended).repeats).toEqual([{ index: 0, finalTick: 0, reason: 'finished' }]);
  });
  it('independent listener tokens survive removals and errors; new subscriptions prime only after publication', async () => {
    const f = fixture();
    const session = await f.begin();
    const calls: string[] = [];
    let removeSibling = () => {};
    session.subscribe((event) => {
      if (event.kind !== 'repeat-end') return;
      calls.push('first');
      removeSibling();
      session.subscribe((e) => calls.push(`new:${e.kind}`), vi.fn());
    }, vi.fn());
    removeSibling = session.subscribe((e) => {
      if (e.kind === 'repeat-end') calls.push('removed');
    }, vi.fn());
    const error = new Error('listener'),
      onError = vi.fn();
    session.subscribe((e) => {
      if (e.kind === 'repeat-end') throw error;
    }, onError);
    const duplicate = vi.fn();
    session.subscribe(duplicate, vi.fn());
    const removeOne = session.subscribe(duplicate, vi.fn());
    removeOne();
    removeOne();
    duplicate.mockClear();
    f.runtime.repeatEnd('finished');
    expect(calls).toEqual(['first']);
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(duplicate).toHaveBeenCalledTimes(1);
    if (f.runtime.factory(1)) f.runtime.repeatStart();
    expect(calls).toContain('new:repeat-start');
    session.stop('collector-target');
  });
  it('an internal gate exception rejects pending ownership before propagating and performs no delivery', async () => {
    const f = fixture();
    f.host.prepare.mockImplementation(() => new Promise(() => {}));
    const pending = f.runtime.begin({ signal: f.controller.signal, driverForRepeat: () => vi.fn() });
    const error = new Error('gate');
    const delivery = vi.fn();
    const rejected = expect(pending).rejects.toBe(error);
    expect(() =>
      f.runtime.action('ordinary', delivery, () => {
        throw error;
      }),
    ).toThrow(error);
    await rejected;
    expect(delivery).not.toHaveBeenCalled();
    expect(f.runtime.owned).toBe(false);
  });
  it('an active internal gate exception cleans up and publishes failure before propagating, without delivery', async () => {
    const f = fixture();
    const session = await f.begin();
    const delivery = vi.fn(),
      ended = vi.fn();
    session.subscribe((event) => {
      if (event.kind === 'ended') ended(event);
    }, vi.fn());
    const error = new Error('gate');
    expect(() =>
      f.runtime.action('ordinary', delivery, () => {
        throw error;
      }),
    ).toThrow(error);
    expect(f.host.restore).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(delivery).not.toHaveBeenCalled();
    expect(await session.ended).toMatchObject({ kind: 'failed', reason: 'action-gate-failed' });
  });
});
