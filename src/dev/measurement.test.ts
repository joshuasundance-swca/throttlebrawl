import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppDrawnFrame, AppHandle, AppMeasurementRequest, AppMeasurementStart } from '../app';
import { measurementConsumer, measurementReport } from './measurement';
import { createBot } from './bot';
import { pageErrors } from './report/errors';
import { buildDebugFile, parseDebugFile, type ReportData } from './report/summary';
import * as soak from './perf/soak-frames';

const botDrives = vi.hoisted(() => [] as ReturnType<typeof vi.fn>[]);
vi.mock('./bot', () => ({
  createBot: vi.fn(() => {
    const drive = vi.fn();
    botDrives.push(drive);
    return { drive };
  }),
}));

function fixture() {
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  let phase = 'running';
  let listener: (event: unknown) => void = () => {};
  let frame: (sample: Readonly<AppDrawnFrame>) => void = () => {};
  let frameError: (error: unknown) => void = () => {};
  let endResolve: (end: unknown) => void = () => {};
  const detach = vi.fn();
  const terminalDetach = vi.fn();
  const runtime = () => ({ phase, quality: { tier: 'low', pixelRatio: 1 }, wake: 'released' });
  const session = {
    committedAtMs: 0,
    scene: { seed: 123 },
    workload: { audio: { policy: 'omitted' } },
    inspect: runtime,
    ended: new Promise((resolve) => {
      endResolve = resolve;
    }),
    subscribe: vi.fn((fn: (event: unknown) => void, _onError: (error: unknown) => void) => {
      listener = fn;
      return terminalDetach;
    }),
    stop: vi.fn((reason: string) => {
      phase = 'ended';
      const end = {
        kind: 'stopped',
        reason,
        endedAtMs: clock,
        repeats: [],
        restored: { logical: 'menu', visible: 'restored' },
      };
      listener({ kind: 'ended', end });
      endResolve(end);
    }),
  };
  const app = {
    build: { id: 'test', channel: 'dev', branch: 'test' },
    playerId: vi.fn(() => 0),
    roadQueries: vi.fn(() => ({})),
    beginMeasurement: vi.fn((_request: AppMeasurementRequest): Promise<AppMeasurementStart> =>
      Promise.resolve({ kind: 'started', session } as unknown as AppMeasurementStart),
    ),
    rendererStats: vi.fn(() => ({
      width: 100,
      height: 50,
      pixelRatio: 1,
      drawCalls: 7,
      triangles: 90,
      renderer: 'CPU observation',
    })),
    subscribeFrames: vi.fn(
      (fn: (frame: Readonly<AppDrawnFrame>) => void, onError: (error: unknown) => void) => {
        frame = fn;
        frameError = onError;
        return detach;
      },
    ),
  };
  return {
    app: app as unknown as AppHandle,
    raw: app,
    session,
    detach,
    terminalDetach,
    setClock: (value: number) => {
      clock = value;
    },
    emit: (timestampMs: number, epoch = 1, eligible = true) => {
      clock = timestampMs;
      frame({ timestampMs, epoch, eligible });
    },
    phase: (value: string) => {
      phase = value;
    },
    error: () => frameError(Error('listener failure')),
    terminal: (end: unknown) => {
      phase = 'ended';
      listener({ kind: 'ended', end });
      endResolve(end);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('DEV measurement consumer', () => {
  it('contains a non-validation collector feed failure through the exact feed-failed stop path', async () => {
    const collector = soak.createSoakFrameCollector();
    vi.spyOn(soak, 'createSoakFrameCollector').mockImplementation(() => ({
      ...collector,
      record: () => {
        throw Error('feed failure');
      },
    }));
    const f = fixture();
    const c = measurementConsumer(f.app);
    await c.start();
    f.emit(0);
    expect(f.session.stop).toHaveBeenCalledExactlyOnceWith('collector-feed-failed');
    c.dispose();
  });
  it('disposal reentry preserves a replacement attempt that starts during terminal delivery', async () => {
    const f = fixture();
    const c = measurementConsumer(f.app);
    await c.start();
    const g = fixture();
    const originalStop = f.session.stop.getMockImplementation()!;
    const replacement: { promise: Promise<void> | null } = { promise: null };
    f.session.stop.mockImplementation((reason) => {
      originalStop(reason);
      f.raw.beginMeasurement.mockImplementation(g.raw.beginMeasurement);
      f.raw.subscribeFrames.mockImplementation(g.raw.subscribeFrames);
      replacement.promise = c.start();
    });
    c.dispose();
    if (!replacement.promise) throw Error('expected replacement attempt');
    await replacement.promise;
    expect(c.progress().phase).toBe('running');
    g.emit(0);
    g.emit(20);
    const r = measurementReport(f.app)!;
    if (r.kind !== 'running') throw Error('expected replacement running');
    expect(r.collector.eligibleMs).toBe(20);
    expect(g.detach).not.toHaveBeenCalled();
    c.dispose();
  });
  it('contains preparation exceptions without fabricated session/timing and keeps the ordinary error log', async () => {
    const f = fixture();
    f.raw.beginMeasurement.mockImplementation(() => Promise.reject(Error('preparation sentinel')));
    const c = measurementConsumer(f.app);
    await c.start();
    expect(measurementReport(f.app)).toEqual({
      kind: 'failed-before-start',
      message: 'Could not prepare frame measurement.',
    });
    expect(pageErrors().list().at(-1)?.message).toContain('preparation sentinel');
    expect(f.raw.subscribeFrames).not.toHaveBeenCalled();
    c.dispose();
  });
  it('handles synchronous feed callbacks that end before the unsubscribe handle is assigned', async () => {
    const f = fixture();
    f.raw.subscribeFrames.mockImplementation((fn) => {
      fn({ timestampMs: -1, epoch: 1, eligible: true });
      return f.detach;
    });
    const c = measurementConsumer(f.app);
    await c.start();
    expect(f.session.stop).toHaveBeenCalledExactlyOnceWith('collector-bad-timestamp');
    expect(f.detach).toHaveBeenCalledTimes(1);
    expect(c.progress().phase).toBe('idle');
    c.dispose();
  });

  it('handles synchronous subscription errors that terminate before its handle is assigned', async () => {
    const f = fixture();
    // Paired onError is part of the real runtime subscription contract.
    f.session.subscribe.mockImplementation((_fn, onError) => {
      onError(Error('prime failed'));
      return f.terminalDetach;
    });
    const c = measurementConsumer(f.app);
    await c.start();
    await Promise.resolve();
    expect(f.session.stop).toHaveBeenCalledExactlyOnceWith('collector-feed-failed');
    expect(f.terminalDetach).toHaveBeenCalledTimes(1);
    expect(f.raw.subscribeFrames).not.toHaveBeenCalled();
    c.dispose();
  });
  it('uses commit rather than delayed begin settlement to schedule its wall deadline', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.setClock(1_100_000);
    const c = measurementConsumer(f.app);
    await c.start();
    f.setClock(1_200_000);
    vi.advanceTimersByTime(100_000);
    expect(f.session.stop).toHaveBeenCalledExactlyOnceWith('collector-deadline');
    c.dispose();
  });

  it('deadline wins a target tie and ordinary progress reads never sort a report', async () => {
    const f = fixture();
    const c = measurementConsumer(f.app);
    await c.start();
    const sort = vi.spyOn(Array.prototype, 'sort');
    f.emit(300_000);
    f.emit(400_000);
    c.progress();
    expect(sort).not.toHaveBeenCalled();
    f.emit(1_200_000);
    expect(f.session.stop).toHaveBeenCalledExactlyOnceWith('collector-deadline');
    const r = measurementReport(f.app)!;
    if (r.kind !== 'ended') throw Error('expected ended');
    expect(r.collector.eligibleMs).toBe(100_000);
    c.dispose();
  });

  it('retains the preceding draw on a stats getter failure without replacing it from the restored menu', async () => {
    const f = fixture();
    const c = measurementConsumer(f.app);
    await c.start();
    f.emit(10);
    f.raw.rendererStats.mockImplementation(() => {
      throw Error('read failed');
    });
    f.emit(20);
    expect(f.session.stop).toHaveBeenCalledExactlyOnceWith('collector-feed-failed');
    const r = measurementReport(f.app)!;
    if (r.kind !== 'ended') throw Error('expected ended');
    expect(r.lastMeasurementRender?.timestampMs).toBe(10);
    expect(r.collector.lastTimestampMs).toBe(10);
    c.dispose();
  });
  it('creates a fresh repeat bot with captured player zero/road and returns its exact drive closure', async () => {
    const f = fixture();
    const c = measurementConsumer(f.app);
    await c.start();
    const request = f.raw.beginMeasurement.mock.calls[0]![0];
    const created = vi.mocked(createBot);
    created.mockClear();
    botDrives.length = 0;
    const roads = [{ tag: 0 }, { tag: 1 }, { tag: 2 }];
    for (let index = 0; index < roads.length; index++) {
      f.raw.roadQueries.mockReturnValue(roads[index]!);
      const driver = request.driverForRepeat({ index });
      f.raw.playerId.mockReturnValue(9);
      f.raw.roadQueries.mockReturnValue({});
      const snapshot = {} as Parameters<typeof driver>[0];
      const actions = {} as Parameters<typeof driver>[1];
      driver(snapshot, actions);
      expect(botDrives[index]).toHaveBeenCalledExactlyOnceWith(snapshot, 0, roads[index], actions);
      f.raw.playerId.mockReturnValue(0);
    }
    expect(created).toHaveBeenCalledTimes(3);
    expect(f.raw.playerId).toHaveBeenCalledTimes(3);
    expect(f.raw.roadQueries).toHaveBeenCalledTimes(3);
    c.dispose();
  });

  it('retains canonical overflow at a million intervals without shortening the target', async () => {
    const f = fixture();
    const c = measurementConsumer(f.app);
    await c.start();
    for (let i = 0; i <= 1_000_001; i++) f.emit(i / 2);
    expect(f.session.stop).toHaveBeenCalledExactlyOnceWith('collector-overflow');
    const r = measurementReport(f.app)!;
    if (r.kind !== 'ended') throw Error('expected ended');
    expect(r.collector.distribution.samples).toBe(1_000_000);
    expect(r.collector.incompleteReason).toBe('retention-overflow');
    expect(r.collector.targetEligibleMs).toBe(900_000);
    c.dispose();
  });

  it('retains exact partial interruption, restoration and runtime terminal timing despite later delivery', async () => {
    const f = fixture();
    const c = measurementConsumer(f.app);
    await c.start();
    f.emit(0);
    f.emit(10);
    f.setClock(1000);
    f.terminal({
      kind: 'failed',
      reason: 'context-lost',
      endedAtMs: 40,
      repeats: [{ index: 0, finalTick: 12, reason: 'session-ended' }],
      restored: { logical: 'menu', visible: 'blocked-context' },
    });
    const r = measurementReport(f.app)!;
    if (r.kind !== 'ended') throw Error('expected ended');
    expect(r.wallMs).toBe(40);
    expect(r.end.restored.visible).toBe('blocked-context');
    expect(r.collector.observedSpanMs).toBe(10);
    expect(r.collector.cancellationReason).toBe('failed:context-lost');
    expect(r.runtime.phase).toBe('ended');
    expect(r.lastMeasurementRender?.timestampMs).toBe(10);
    expect(r.end.repeats[0]?.finalTick).toBe(12);
    c.dispose();
  });

  it('contains listener error and keeps stale callbacks inert after an independently updating replacement', async () => {
    const f = fixture();
    const c = measurementConsumer(f.app);
    await c.start();
    f.error();
    expect(f.session.stop).toHaveBeenCalledExactlyOnceWith('collector-feed-failed');
    const oldFrame = f.raw.subscribeFrames.mock.calls[0]![0];
    const g = fixture();
    f.raw.beginMeasurement.mockImplementation(g.raw.beginMeasurement);
    f.raw.subscribeFrames.mockImplementation(g.raw.subscribeFrames);
    await c.start();
    g.emit(0);
    g.emit(20);
    const before = measurementReport(f.app)!;
    oldFrame({ timestampMs: 100, epoch: 1, eligible: true });
    expect(measurementReport(f.app)).toEqual(before);
    c.dispose();
  });

  it('handles synchronous already-ended priming with no feed or active deadline and exact end time', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.phase('ended');
    f.setClock(500);
    const end = {
      kind: 'failed',
      reason: 'driver-factory-failed',
      endedAtMs: 30,
      repeats: [],
      restored: { logical: 'menu', visible: 'draw-failed' },
    };
    f.session.subscribe.mockImplementation((fn) => {
      fn({ kind: 'ended', end });
      return f.terminalDetach;
    });
    const c = measurementConsumer(f.app);
    await c.start();
    const r = measurementReport(f.app)!;
    if (r.kind !== 'ended') throw Error('expected ended');
    expect(r.wallMs).toBe(30);
    expect(r.lastMeasurementRender).toBeNull();
    expect(f.raw.subscribeFrames).not.toHaveBeenCalled();
    expect(f.terminalDetach).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    c.dispose();
  });

  it('reserves before synchronous cancellation and retires late started results without replacing a newer outcome', async () => {
    const f = fixture();
    let resolve: (value: unknown) => void = () => {};
    f.raw.beginMeasurement.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const c = measurementConsumer(f.app);
    const first = c.start();
    const signal = f.raw.beginMeasurement.mock.calls[0]![0].signal;
    c.cancel();
    c.cancel();
    expect(signal.aborted).toBe(true);
    f.raw.beginMeasurement.mockImplementation(() =>
      Promise.resolve({
        kind: 'refused',
        reason: 'not-menu',
        sceneRefusal: null,
        wakeRefusal: null,
        audioRefusal: null,
      } as AppMeasurementStart),
    );
    await c.start();
    const replacement = measurementReport(f.app);
    resolve({ kind: 'started', session: f.session });
    await first;
    expect(f.session.stop).toHaveBeenCalledExactlyOnceWith('caller-cancelled');
    expect(measurementReport(f.app)).toEqual(replacement);
    expect(f.raw.subscribeFrames).not.toHaveBeenCalled();
    c.dispose();
  });
  it('reserves exactly one attempt and reaches the canonical full target with exact samples', async () => {
    const f = fixture();
    const c = measurementConsumer(f.app);
    expect(measurementReport(f.app)).toBeUndefined();
    const pending = c.start();
    void c.start();
    await pending;
    expect(f.raw.beginMeasurement).toHaveBeenCalledTimes(1);
    f.emit(0);
    f.emit(900_001);
    expect(f.session.stop).toHaveBeenCalledExactlyOnceWith('collector-target');
    const report = measurementReport(f.app)!;
    expect(report.kind).toBe('ended');
    if (report.kind !== 'ended') throw Error('expected ended');
    expect(report.collector.eligibleMs).toBe(900_001);
    expect(report.collector.overrunMs).toBe(1);
    expect(report.wallMs).toBe(900_001);
    expect(Object.isFrozen(report.collector.minutes)).toBe(true);
    const data: ReportData = {
      takenAt: '2026-10-11T00:00:00.000Z',
      build: report.build,
      replayKey: 'test',
      hashes: { sim: 'test', full: 'test' },
      renderer: f.raw.rendererStats(),
      device: 'test browser',
      state: 'menu',
      tick: null,
      settings: {},
      tuningDefaults: {},
      replay: { retained: 'normal replay' },
      frame: { samples: 0, p50: 0, p95: 0, max: 0 },
      step: { samples: 0, p50: 0, p95: 0, max: 0 },
      heapMB: null,
      errors: [],
      events: [],
      measurement: report,
    };
    const file = buildDebugFile(data);
    const json = file.split('\n').find((line) => line.startsWith('measurement JSON '))!;
    expect(JSON.parse(json.slice('measurement JSON '.length))).toEqual(report);
    expect(parseDebugFile(file).replay).toEqual(data.replay);
    expect(f.detach).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it('uses an independent absolute deadline even with zero frames and rearms an early timer', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const c = measurementConsumer(f.app);
    await c.start();
    vi.advanceTimersByTime(1_200_000);
    expect(f.session.stop).not.toHaveBeenCalled();
    f.setClock(1_200_000);
    vi.advanceTimersByTime(1_200_000);
    expect(f.session.stop).toHaveBeenCalledExactlyOnceWith('collector-deadline');
    c.dispose();
  });

  it('captures a deadline frame before stopping, without feeding the expired sample', async () => {
    const f = fixture();
    const c = measurementConsumer(f.app);
    await c.start();
    f.emit(0);
    f.emit(300_000, 2, false);
    f.emit(1_200_000);
    f.raw.rendererStats.mockReturnValue({
      width: 4,
      height: 4,
      pixelRatio: 3,
      drawCalls: 999,
      triangles: 999,
      renderer: 'menu',
    });
    const r = measurementReport(f.app)!;
    expect(r.kind).toBe('ended');
    if (r.kind !== 'ended') throw Error('expected ended');
    expect(r.end.reason).toBe('collector-deadline');
    expect(r.lastMeasurementRender?.drawCalls).toBe(7);
    expect(r.lastMeasurementRender?.timestampMs).toBe(1_200_000);
    expect(r.collector.lastTimestampMs).toBe(300_000);
    c.dispose();
  });

  it('preserves early slow samples beyond 600 intervals and excludes epoch/ineligible gaps', async () => {
    const f = fixture();
    const c = measurementConsumer(f.app);
    await c.start();
    f.emit(0);
    f.emit(100);
    for (let t = 101; t <= 800; t++) f.emit(t);
    f.emit(900, 2);
    f.emit(1000, 2, false);
    f.emit(1100, 2);
    f.emit(1101, 2);
    c.cancel();
    const r = measurementReport(f.app)!;
    if (r.kind !== 'ended') throw Error('expected ended');
    expect(r.collector.distribution.maxMs).toBe(100);
    expect(r.collector.distribution.samples).toBe(702);
    expect(r.collector.excludedObservedMs).toBe(300);
    c.dispose();
  });

  it.each([
    ['timestamp', 'collector-bad-timestamp'],
    ['stats', 'collector-feed-failed'],
  ])('contains %s failure and stops once', async (mode, reason) => {
    const f = fixture();
    const c = measurementConsumer(f.app);
    await c.start();
    if (mode === 'stats')
      f.raw.rendererStats.mockImplementation(() => {
        throw Error('stats unavailable');
      });
    f.emit(mode === 'timestamp' ? -1 : 1);
    f.emit(2);
    c.cancel();
    expect(f.session.stop).toHaveBeenCalledExactlyOnceWith(reason);
    c.dispose();
  });

  it('exports running partial data freshly frozen without stopping and ignores non-running frames', async () => {
    const f = fixture();
    const c = measurementConsumer(f.app);
    await c.start();
    f.emit(0);
    f.emit(10);
    const a = measurementReport(f.app);
    const b = measurementReport(f.app);
    expect(a).not.toBe(b);
    expect(a?.kind).toBe('running');
    expect(f.session.stop).not.toHaveBeenCalled();
    f.phase('ending');
    f.emit(40);
    f.phase('running');
    c.cancel();
    const r = measurementReport(f.app)!;
    if (r.kind !== 'ended') throw Error('expected ended');
    expect(r.collector.eligibleMs).toBe(10);
    c.dispose();
  });
});
