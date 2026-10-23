import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type AppDrawnFrame, type AppHandle } from './index';
import type { createUi } from '../ui';
import type { LifecycleCallbacks } from '../platform';
import { createPackLibrary } from '../content';
import { careerDefs } from './career-flow';
import { regionChoices } from './regions';
import { DEFAULT_SETTINGS } from '../save';
import type { Recording } from '../replay';

const boundary = vi.hoisted(() => ({
  ui: { paused: false, region: 'base:florida-keys', screen: 'start' },
  callbacks: null as Parameters<typeof createUi>[1]['callbacks'] | null,
  lifecycle: null as LifecycleCallbacks | null,
  context: null as ((lost: boolean) => void) | null,
  lost: false,
  pose: true,
  worldReady: true,
  missingRiders: false,
  render: vi.fn(),
  audioFrame: vi.fn(),
  countdownBeat: vi.fn(),
  inputSample: vi.fn(),
  inputLease: vi.fn(),
  driver: vi.fn(),
  activeDriver: null as ((actions: import('../input').ActionState) => void) | null,
  receipt: vi.fn(
    (
      _recipe: import('../render').RendererPresentationRecipe,
      _options: import('../render').RendererPresentationOptions,
    ) => ({}),
  ),
  quality: vi.fn(),
  audioState: 'none',
  audioAcquire: vi.fn(),
  rawPause: false,
  rawCamera: false,
  audioLease: vi.fn(),
  wakeLease: vi.fn(),
  syncLive: vi.fn(),
  retune: vi.fn(),
  suspension: null as Promise<import('../audio').AudioSuspendLeaseResult> | null,
  finishMeasurementStep: false,
  finishNormalStep: false,
  bustMeasurementStep: false,
  simConfigs: [] as import('../sim/api').SimConfig[],
  recorderCalls: [] as string[],
  uiWrite: vi.fn(),
  wakeLoss: null as Parameters<typeof import('../platform').acquireWakeLease>[0]['onLost'] | null,
  missingRoads: false,
  roadWait: null as Promise<void> | null,
  chunkWait: null as Promise<void> | null,
  chunkMissing: false,
  runtimeWait: null as Promise<void> | null,
  runtimeMissing: false,
  chunkRequests: [] as string[],
}));

vi.mock('../sim/api', async (original) => {
  const module = await original<typeof import('../sim/api')>();
  return {
    ...module,
    createSim: (config: import('../sim/api').SimConfig) => {
      boundary.simConfigs.push(config);
      const sim = module.createSim(config);
      const player = config.riders.findIndex((r) => r.controller.kind === 'player');
      return new Proxy(sim, {
        get(target, key) {
          if (key === 'snapshot')
            return () => {
              const snapshot = target.snapshot();
              if (boundary.missingRiders) return { ...snapshot, entities: [] };
              if (config.seed !== 2 || !boundary.finishMeasurementStep || target.tick === 0) return snapshot;
              return {
                ...snapshot,
                entities: snapshot.entities.map((e, i) => (i === player ? { ...e, finished: true } : e)),
              };
            };
          if (key === 'events')
            return () =>
              config.seed === 2 && boundary.bustMeasurementStep && target.tick > 0
                ? [{ type: 'bust', tick: target.tick, target: player, data: { fineCash: 3 } }]
                : target.events();
          if (key === 'isOver')
            return () =>
              (config.seed !== 2 && boundary.finishNormalStep && target.tick > 0) || target.isOver();
          return key in target
            ? (Reflect.get(target, key) as (typeof target)[keyof typeof target])
            : undefined;
        },
      });
    },
  };
});
vi.mock('../replay', async (original) => {
  const module = await original<typeof import('../replay')>();
  return {
    ...module,
    createInputRecorder: () => {
      const recorder = module.createInputRecorder();
      return new Proxy(recorder, {
        get(target, key) {
          const value =
            key in target ? (Reflect.get(target, key) as (typeof target)[keyof typeof target]) : undefined;
          if (typeof value !== 'function' || ['current', 'file'].includes(String(key))) return value;
          return (...args: unknown[]) => {
            boundary.recorderCalls.push(String(key));
            const result: unknown = Reflect.apply(value, target, args);
            return result;
          };
        },
      });
    },
  };
});

vi.mock('../content', async (original) => {
  const module = await original<typeof import('../content')>();
  return {
    ...module,
    loadChunk: async <T>(name: string, load: () => Promise<T>, env?: import('../content').ChunkEnv) => {
      boundary.chunkRequests.push(name);
      if (name === 'measurement runtime') {
        await boundary.runtimeWait;
        if (boundary.runtimeMissing) return null;
      }
      await boundary.chunkWait;
      return boundary.chunkMissing && name === 'measurement scene' ? null : module.loadChunk(name, load, env);
    },
    createPackLibrary: (options: Parameters<typeof module.createPackLibrary>[0]) => {
      const library = module.createPackLibrary(options);
      return {
        ...library,
        hasRoads: () => !boundary.missingRoads,
        loadRoads: async () => {
          await boundary.roadWait;
          return library.registry();
        },
      };
    },
  };
});

vi.mock('../ui', async (original) => {
  const module = await original<typeof import('../ui')>();
  const noop = () => {};
  const surface = () => new Proxy({}, { get: () => noop });
  return {
    ...module,
    createUi: (_host: unknown, options: Parameters<typeof createUi>[1]) => {
      boundary.callbacks = options.callbacks;
      return new Proxy(boundary.ui, {
        get(target, key) {
          if (key === 'paused') return target.paused;
          if (key === 'region') return target.region;
          if (key === 'screen') return () => target.screen;
          if (key === 'show')
            return (screen: string) => {
              target.screen = screen;
            };
          if (key === 'syncLive') return boundary.syncLive;
          if (key === 'career' || key === 'narrative' || key === 'ticker') return surface();
          if (key === 'pause')
            return () => {
              target.paused = true;
              options.callbacks.onPause!();
            };
          return (...args: unknown[]) => {
            boundary.uiWrite(key, ...args);
          };
        },
      });
    },
  };
});
vi.mock('../render', async (original) => {
  const module = await original<typeof import('../render')>();
  return {
    ...module,
    createRenderer: () =>
      new Proxy(
        {},
        {
          get(_target, key) {
            if (key === 'contextLost') return boundary.lost;
            if (key === 'physicalWorldReady') return () => boundary.worldReady;
            if (key === 'onContextChange')
              return (cb: (lost: boolean) => void) => {
                boundary.context = cb;
              };
            if (key === 'render') return boundary.render;
            if (key === 'applyPresentation') return boundary.receipt;
            if (key === 'setPresentationQuality') return boundary.quality;
            if (key === 'stats') return () => ({ pixelRatio: 1 });
            if (key === 'structures') return () => null;
            if (key === 'visibleContent') return () => [];
            return () => {};
          },
        },
      ),
  };
});
vi.mock('../camera', async (original) => {
  const module = await original<typeof import('../camera')>();
  return {
    ...module,
    createFollowCamera: () =>
      new Proxy(
        {},
        {
          get(_target, key) {
            if (key === 'snap' || key === 'update') return () => (boundary.pose ? {} : null);
            return () => {};
          },
        },
      ),
  };
});
vi.mock('../audio', async (original) => ({
  ...(await original<typeof import('../audio')>()),
  createAudio: () =>
    new Proxy(
      {},
      {
        get(_target, key) {
          if (key === 'frame') return boundary.audioFrame;
          if (key === 'countdownBeat') return boundary.countdownBeat;
          if (key === 'state') return () => boundary.audioState;
          if (key === 'nextRadio' || key === 'skipTrack') return boundary.retune;
          if (key === 'acquireSuspendLease')
            return () => {
              boundary.audioAcquire();
              return (
                boundary.suspension ??
                Promise.resolve({
                  kind: 'acquired',
                  lease: {
                    state: 'held',
                    wasRunningIntent: false,
                    observedState: 'none',
                    release: boundary.audioLease,
                  },
                })
              );
            };
          if (key === 'resume') return () => Promise.resolve();
          return () => {};
        },
      },
    ),
}));
vi.mock('../input', async (original) => ({
  ...(await original<typeof import('../input')>()),
  createHaptics: () => ({ supported: false }),
  createInput: () =>
    new Proxy(
      {},
      {
        get(_target, key) {
          if (key === 'acquireSuspendLease') return () => ({ release: boundary.inputLease });
          if (key === 'sample')
            return () => {
              boundary.inputSample();
              boundary.activeDriver?.({
                steer: 0,
                throttle: 0,
                brake: 0,
                attack: false,
                attackSide: 0,
                kick: false,
                wheelie: false,
                lookBack: false,
                skipRunBack: false,
              });
              return { steer: 0, throttle: 0, brake: 0, flags: 0 };
            };
          if (key === 'lastActions')
            return () => ({ pause: boundary.rawPause, cycleCamera: boundary.rawCamera });
          if (key === 'setDriver')
            return (driver: typeof boundary.activeDriver) => {
              boundary.activeDriver = driver;
              boundary.driver(driver);
            };
          return () => {};
        },
      },
    ),
}));
vi.mock('../platform', async (original) => {
  const module = await original<typeof import('../platform')>();
  return {
    ...module,
    keepAwake: () => {},
    acquireWakeLease: (options: Parameters<typeof module.acquireWakeLease>[0]) => {
      boundary.wakeLoss = options.onLost;
      return Promise.resolve({ kind: 'acquired', lease: { state: 'held', release: boundary.wakeLease } });
    },
    installOffer: () => null,
    runStartTap: () => Promise.resolve(),
    startOffline: () => null,
    watchLifecycle: (cb: LifecycleCallbacks) => {
      boundary.lifecycle = cb;
    },
  };
});

describe('AppHandle actual render wiring', () => {
  let queue: FrameRequestCallback[];
  let app: AppHandle;
  let seen: Readonly<AppDrawnFrame>[];
  let now: number;
  let visible: { visibilityState: string };
  const frame = (delta = 20) => {
    now += delta;
    const callback = queue.shift();
    if (!callback) throw new Error('app loop stopped');
    callback(now);
    return seen.at(-1)!;
  };
  const pause = (on: boolean) => {
    boundary.ui.paused = on;
    if (on) boundary.callbacks!.onPause!();
    else boundary.callbacks!.onResume!();
  };
  const context = (lost: boolean) => {
    boundary.lost = lost;
    boundary.context!(lost);
  };

  beforeEach(async () => {
    queue = [];
    now = 0;
    seen = [];
    boundary.ui.paused = false;
    boundary.ui.screen = 'start';
    boundary.ui.region = 'base:florida-keys';
    boundary.activeDriver = null;
    boundary.audioState = 'none';
    boundary.audioAcquire.mockClear();
    boundary.rawPause = false;
    boundary.rawCamera = false;
    boundary.suspension = null;
    boundary.finishMeasurementStep = false;
    boundary.finishNormalStep = false;
    boundary.bustMeasurementStep = false;
    boundary.simConfigs = [];
    boundary.recorderCalls = [];
    boundary.uiWrite.mockClear();
    boundary.receipt.mockClear();
    boundary.quality.mockClear();
    boundary.audioLease.mockClear();
    boundary.wakeLease.mockClear();
    boundary.retune.mockClear();
    boundary.syncLive.mockClear();
    boundary.lost = false;
    boundary.pose = true;
    boundary.worldReady = true;
    boundary.missingRiders = false;
    boundary.missingRoads = false;
    boundary.roadWait = null;
    boundary.chunkWait = null;
    boundary.chunkMissing = false;
    boundary.runtimeWait = null;
    boundary.runtimeMissing = false;
    boundary.chunkRequests = [];
    boundary.wakeLoss = null;
    boundary.render.mockReset();
    boundary.audioFrame.mockReset();
    boundary.countdownBeat.mockReset();
    boundary.inputSample.mockReset();
    boundary.inputLease.mockReset();
    boundary.driver.mockReset();
    visible = { visibilityState: 'visible' };
    vi.stubGlobal('document', visible);
    vi.stubGlobal('window', Object.assign(new EventTarget(), { __GAME_TEST__: true }));
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      queue.push(cb);
      return queue.length;
    });
    app = createApp({
      host: {} as HTMLElement,
      canvas: { clientWidth: 800, clientHeight: 450 } as HTMLCanvasElement,
      build: { id: 'unit', channel: 'dev', branch: 'unit' },
      seed: 1,
      measurementSeedSource: () => 2,
      callbacks: { onCopyReport: async () => {} },
    });
    app.subscribeFrames(
      (sample) => seen.push(sample),
      (e) => {
        throw e;
      },
    );
    await vi.dynamicImportSettled();
    // createApp also queues deferred audio preparation; remove that separate boot callback.
    queue.splice(1, 1);
  });
  afterEach(() => {
    queue = [];
    vi.unstubAllGlobals();
  });

  it('boot road completion still offers routes after tapping into the menu', async () => {
    boundary.missingRoads = true;
    let resolve!: () => void;
    boundary.roadWait = new Promise<void>((done) => {
      resolve = done;
    });
    app = createApp({
      host: {} as HTMLElement,
      canvas: { clientWidth: 800, clientHeight: 450 } as HTMLCanvasElement,
      build: { id: 'unit', channel: 'dev', branch: 'unit' },
      seed: 1,
      measurementSeedSource: () => 2,
      callbacks: { onCopyReport: async () => {} },
    });
    app.tap();
    boundary.uiWrite.mockClear();
    boundary.missingRoads = false;
    resolve();
    await vi.dynamicImportSettled();
    expect(app.state()).toBe('menu');
    expect(boundary.uiWrite.mock.calls.some(([key]) => key === 'setRoutes')).toBe(true);
  });

  it('audio settings leave the road presentation intact; a changed look still applies', () => {
    app.tap();
    boundary.receipt.mockClear();
    const next = { ...DEFAULT_SETTINGS, mute: !DEFAULT_SETTINGS.mute };
    boundary.callbacks!.onSettingsChange!(next);
    expect(boundary.receipt).not.toHaveBeenCalled();
    boundary.callbacks!.onSettingsChange!({ ...next, look: 'classic' });
    expect(boundary.receipt).toHaveBeenCalledTimes(1);
    expect(boundary.receipt.mock.calls[0]![0].look).toBe('classic');
  });

  it('ordinary radio input cannot cancel a foreground race load', async () => {
    app.tap();
    boundary.missingRoads = true;
    let resolve!: () => void;
    boundary.roadWait = new Promise<void>((done) => {
      resolve = done;
    });
    app.startRace();
    window.dispatchEvent(
      Object.assign(new Event('keydown'), {
        code: 'KeyR',
        shiftKey: false,
        repeat: false,
      }),
    );
    expect(boundary.retune).toHaveBeenCalledTimes(1);
    expect(boundary.syncLive).toHaveBeenCalledTimes(1);
    boundary.missingRoads = false;
    resolve();
    await vi.dynamicImportSettled();
    expect(app.state()).toBe('race');
  });

  it('navigation does not hide a pending background load from measurement preflight', async () => {
    boundary.missingRoads = true;
    let resolve!: () => void;
    boundary.roadWait = new Promise<void>((done) => {
      resolve = done;
    });
    app = createApp({
      host: {} as HTMLElement,
      canvas: { clientWidth: 800, clientHeight: 450 } as HTMLCanvasElement,
      build: { id: 'unit', channel: 'dev', branch: 'unit' },
      seed: 1,
      measurementSeedSource: () => 2,
      callbacks: { onCopyReport: async () => {} },
    });
    app.tap();
    const pending = begin();
    boundary.missingRoads = false;
    resolve();
    expect(await pending).toMatchObject({ reason: 'normal-load-pending' });
    expect(boundary.audioAcquire).not.toHaveBeenCalled();
    await vi.dynamicImportSettled();
    const ready = await begin();
    if (ready.kind !== 'started') throw new Error(ready.reason);
    ready.session.stop('caller-cancelled');
  });

  it('a superseded region load cannot redraw the selected region or consume its seed', async () => {
    app.tap();
    const choices = regionChoices(createPackLibrary({ includeDrafts: true }).registry());
    const other = choices.find((choice) => choice.id !== boundary.ui.region)!;
    expect(other).toBeDefined();
    boundary.ui.region = other.id;
    boundary.missingRoads = true;
    let resolve!: () => void;
    boundary.roadWait = new Promise<void>((done) => {
      resolve = done;
    });
    boundary.callbacks!.onRegionChange!(other.id);
    boundary.ui.region = 'base:florida-keys';
    boundary.missingRoads = false;
    boundary.callbacks!.onRegionChange!(boundary.ui.region);
    const snapshot = app.snapshot();
    const sims = boundary.simConfigs.length;
    const receipts = boundary.receipt.mock.calls.length;
    boundary.uiWrite.mockClear();
    resolve();
    await vi.dynamicImportSettled();
    expect(app.snapshot()).toBe(snapshot);
    expect(boundary.simConfigs).toHaveLength(sims);
    expect(boundary.receipt.mock.calls).toHaveLength(receipts);
    expect(boundary.uiWrite).not.toHaveBeenCalled();
  });

  it('a boot road load cannot change notices or routes after selecting another region', async () => {
    boundary.missingRoads = true;
    let resolve!: () => void;
    boundary.roadWait = new Promise<void>((done) => {
      resolve = done;
    });
    app = createApp({
      host: {} as HTMLElement,
      canvas: { clientWidth: 800, clientHeight: 450 } as HTMLCanvasElement,
      build: { id: 'unit', channel: 'dev', branch: 'unit' },
      seed: 1,
      callbacks: { onCopyReport: async () => {} },
    });
    app.tap();
    // This fixture has no storage. Let independent boot classification publish its notice
    // while the road request is still held; the following zero-write check isolates that request.
    await vi.dynamicImportSettled();
    expect(boundary.uiWrite).toHaveBeenCalledWith('notice', expect.stringContaining('Race storage'));
    const other = regionChoices(createPackLibrary({ includeDrafts: true }).registry()).find(
      (choice) => choice.id !== boundary.ui.region,
    )!;
    expect(other).toBeDefined();
    boundary.ui.region = other.id;
    boundary.missingRoads = false;
    boundary.uiWrite.mockClear();
    resolve();
    await vi.dynamicImportSettled();
    expect(boundary.uiWrite).not.toHaveBeenCalled();
  });

  it.each(['direct', 'logical post-pass'] as const)(
    'observes %s rendering exactly once before audio; no pose/context/throw produce no sample',
    (path) => {
      const order: string[] = [];
      const calls = path === 'direct' ? ['scene'] : ['scene', 'post-quad'];
      boundary.render.mockImplementation(() => order.push(...calls));
      boundary.audioFrame.mockImplementation(() => order.push('audio'));
      app.subscribeFrames(() => order.push('sample'), vi.fn());
      frame();
      expect(order).toEqual([...calls, 'sample', 'audio']);
      expect(seen).toHaveLength(1);
      // A race calculates a fresh pose every draw, unlike the cached menu attract pose.
      app.tap();
      app.startRace();
      boundary.pose = false;
      frame();
      expect(seen).toHaveLength(1);
      boundary.pose = true;
      context(true);
      frame();
      expect(seen).toHaveLength(1);
      context(false);
      const error = new Error('scene failed');
      boundary.render.mockImplementationOnce(() => {
        throw error;
      });
      expect(() => frame()).toThrow(error);
      expect(seen).toHaveLength(1);
    },
  );

  it('tracks real race, zero-step, pause, hidden, context, identical restart and menu transitions', () => {
    expect(frame().eligible).toBe(false);
    app.tap();
    app.startRace();
    // First draw enters tick zero; a subsequent real sim step qualifies.
    expect(frame(0).eligible).toBe(false);
    expect(frame().eligible).toBe(true);
    const start = seen.at(-1)!;
    expect(frame(0).epoch).toBe(start.epoch);
    expect(seen.at(-1)!.eligible).toBe(true);
    pause(true);
    pause(false); // interruption wholly between observations
    expect(frame().epoch).toBeGreaterThan(start.epoch);
    const stable = seen.at(-1)!.epoch;
    boundary.callbacks!.onResume!();
    expect(frame().epoch).toBe(stable);
    visible.visibilityState = 'hidden';
    boundary.lifecycle!.onHidden('visibility');
    boundary.lifecycle!.onHidden('visibility');
    visible.visibilityState = 'visible';
    boundary.lifecycle!.onShown();
    expect(frame().eligible).toBe(false); // shown cannot override auto-pause
    pause(false);
    const restored = frame();
    context(true);
    context(false);
    const afterContext = frame();
    expect(afterContext.eligible).toBe(true);
    expect(afterContext.epoch).toBeGreaterThan(restored.epoch);
    boundary.callbacks!.onRestart!();
    expect(frame(0).epoch).toBeGreaterThan(afterContext.epoch);
    expect(frame().eligible).toBe(true);
    app.backToMenu();
    expect(frame().eligible).toBe(false);
  });

  it('normalizes lockstep, keeps final hand-back synthetic, and preserves the existing hooks', () => {
    app.tap();
    app.startRace();
    frame();
    frame();
    const driver = vi.fn();
    app.setTickDriver(driver);
    const steps = vi.fn(() => app.setLockstep(null));
    app.onStep(steps);
    const epoch = seen.at(-1)!.epoch;
    app.setLockstep(8.9);
    app.setLockstep(8.1);
    const final = frame();
    expect(final.eligible).toBe(false);
    expect(final.epoch).toBeGreaterThan(epoch);
    expect(app.lockstep()).toBeNull();
    expect(steps).toHaveBeenCalledTimes(1);
    expect(boundary.driver).toHaveBeenCalledTimes(1);
    expect(frame(0).eligible).toBe(true);
    expect(seen.at(-1)!.epoch).toBe(final.epoch);
  });

  it('reads initial document-hidden status even without a lifecycle callback', () => {
    app.tap();
    app.startRace();
    visible.visibilityState = 'hidden';
    expect(frame().eligible).toBe(false);
    const hiddenEpoch = seen.at(-1)!.epoch;
    visible.visibilityState = 'visible';
    expect(frame().eligible).toBe(true);
    expect(seen.at(-1)!.epoch).toBeGreaterThan(hiddenEpoch);
  });

  it('draws the current grid before the first countdown beat, dropping preparation input', () => {
    (window as Window & { __countdown?: boolean }).__countdown = true;
    app.tap();
    app.startRace();
    const order: string[] = [];
    boundary.render.mockImplementation(() => order.push('draw'));
    boundary.countdownBeat.mockImplementation((beat: number) => order.push(String(beat)));
    boundary.recorderCalls = [];
    app.setLockstep(180);
    frame();
    expect(order).toEqual(['draw']);
    expect(app.snapshot()!.tick).toBe(0);
    expect(boundary.inputSample).toHaveBeenCalled();
    expect(boundary.recorderCalls).toEqual([]);
    expect(seen.at(-1)!.eligible).toBe(false);
    frame();
    expect(order).toEqual(['draw', '3', '2', '1', 'draw']);
    expect(app.snapshot()!.tick).toBe(0);
    expect(boundary.uiWrite).toHaveBeenCalledWith('setCountdown', 'GO');
    app.setLockstep(1);
    frame();
    expect(app.snapshot()!.tick).toBe(1);
    expect(boundary.recorderCalls).toContain('record');
    expect(boundary.countdownBeat.mock.calls).toEqual([[3], [2], [1]]);
    expect(app.checkReplay(app.replayFile())).toMatchObject({ ticks: 1, desync: null, keyMatches: true });
  });

  it('observes countdown release and the first sim step through the real app step hook', () => {
    (window as Window & { __countdown?: boolean }).__countdown = true;
    app.tap();
    app.startRace();
    app.setLockstep(180);
    frame(); // prepare the grid, even when lockstep requests an entire countdown
    expect(app.snapshot()!.tick).toBe(0);
    expect(boundary.countdownBeat).not.toHaveBeenCalled();
    frame(); // the entire countdown, no simulation tick
    expect(app.snapshot()!.tick).toBe(0);
    expect(seen.at(-1)!.eligible).toBe(false);
    app.setLockstep(null);
    expect(frame(0).eligible).toBe(false); // GO is shown, still tick zero
    const heldEpoch = seen.at(-1)!.epoch;
    expect(frame().eligible).toBe(true);
    expect(app.snapshot()!.tick).toBeGreaterThan(0);
    expect(seen.at(-1)!.epoch).toBeGreaterThan(heldEpoch);
  });

  it.each(['pose', 'context', 'pause', 'hidden'] as const)(
    'does not release grid preparation while blocked by %s',
    (blocked) => {
      (window as Window & { __countdown?: boolean }).__countdown = true;
      app.tap();
      app.startRace();
      app.setLockstep(180);
      if (blocked === 'pose') boundary.pose = false;
      if (blocked === 'context') context(true);
      if (blocked === 'pause') pause(true);
      if (blocked === 'hidden') {
        visible.visibilityState = 'hidden';
        boundary.lifecycle!.onHidden('visibility');
      }
      frame();
      frame();
      expect(app.snapshot()!.tick).toBe(0);
      expect(boundary.countdownBeat).not.toHaveBeenCalled();
      expect(boundary.recorderCalls).not.toContain('record');
      boundary.pose = true;
      if (blocked === 'context') context(false);
      if (blocked === 'hidden') {
        visible.visibilityState = 'visible';
        boundary.lifecycle!.onShown();
      }
      pause(false);
      frame();
      expect(boundary.countdownBeat).not.toHaveBeenCalled();
      frame();
      expect(boundary.countdownBeat.mock.calls).toEqual([[3], [2], [1]]);
      expect(app.snapshot()!.tick).toBe(0);
    },
  );

  it('a failed grid draw cannot release preparation before a successful draw', () => {
    (window as Window & { __countdown?: boolean }).__countdown = true;
    app.tap();
    app.startRace();
    app.setLockstep(180);
    boundary.render.mockImplementationOnce(() => {
      throw new Error('grid draw failed');
    });
    const retry = queue[0]!;
    expect(() => frame()).toThrow('grid draw failed');
    expect(boundary.countdownBeat).not.toHaveBeenCalled();
    expect(app.snapshot()!.tick).toBe(0);
    // Retry the same loop callback explicitly; a thrown renderer does not schedule another RAF.
    queue.push(retry);
    frame();
    expect(boundary.countdownBeat).not.toHaveBeenCalled();
    frame();
    expect(boundary.countdownBeat.mock.calls).toEqual([[3], [2], [1]]);
  });

  it('a cached menu pose cannot prepare a race without a current rider to frame', () => {
    (window as Window & { __countdown?: boolean }).__countdown = true;
    app.tap();
    frame(); // the menu has a usable cached pose
    boundary.missingRiders = true;
    app.startRace();
    app.setLockstep(180);
    frame();
    frame();
    expect(app.snapshot()!.entities).toEqual([]);
    expect(app.snapshot()!.tick).toBe(0);
    expect(boundary.countdownBeat).not.toHaveBeenCalled();
    boundary.missingRiders = false;
    boundary.callbacks!.onRestart!();
    frame();
    expect(boundary.countdownBeat).not.toHaveBeenCalled();
    frame();
    expect(boundary.countdownBeat.mock.calls).toEqual([[3], [2], [1]]);
  });

  it('pauses a prepared countdown without restarting or repeating its beats', () => {
    (window as Window & { __countdown?: boolean }).__countdown = true;
    app.tap();
    app.startRace();
    app.setLockstep(60);
    frame();
    frame();
    expect(boundary.countdownBeat.mock.calls).toEqual([[3]]);
    pause(true);
    frame();
    expect(boundary.countdownBeat.mock.calls).toEqual([[3]]);
    pause(false);
    frame();
    frame();
    expect(boundary.countdownBeat.mock.calls).toEqual([[3], [2], [1]]);
    expect(boundary.uiWrite.mock.calls.filter(([key]) => key === 'setCountdown')).toEqual([
      ['setCountdown', '3'],
      ['setCountdown', '2'],
      ['setCountdown', '1'],
      ['setCountdown', 'GO'],
    ]);
    expect(app.snapshot()!.tick).toBe(0);
    app.setLockstep(1);
    frame();
    expect(app.snapshot()!.tick).toBe(1);
    expect(boundary.countdownBeat.mock.calls).toEqual([[3], [2], [1]]);
  });

  it.each(['renderer', 'subscriber', 'menu'] as const)(
    'a grid draw interrupted by %s cannot prepare a replacement race',
    (interruption) => {
      (window as Window & { __countdown?: boolean }).__countdown = true;
      app.tap();
      app.startRace();
      const abandoned = app.snapshot();
      app.setLockstep(1);
      const replace = () => {
        if (interruption === 'menu') {
          app.backToMenu();
          app.startRace();
        } else boundary.callbacks!.onRestart!();
      };
      if (interruption === 'renderer') boundary.render.mockImplementationOnce(replace);
      else {
        const off = app.subscribeFrames(() => {
          off();
          replace();
        }, vi.fn());
      }
      frame();
      expect(app.snapshot()).not.toBe(abandoned);
      expect(boundary.countdownBeat).not.toHaveBeenCalled();
      frame();
      expect(boundary.countdownBeat).not.toHaveBeenCalled();
      frame();
      expect(boundary.countdownBeat.mock.calls).toEqual([[3]]);
      expect(app.snapshot()!.tick).toBe(0);
    },
  );

  it('keeps countdown-disabled launches advancing before their first usable pose', () => {
    app.tap();
    app.startRace();
    boundary.pose = false;
    app.setLockstep(1);
    frame();
    expect(app.snapshot()!.tick).toBe(1);
    expect(boundary.countdownBeat).not.toHaveBeenCalled();
    expect(boundary.recorderCalls).toContain('record');
  });

  it.each([false, true])(
    'waits for physical scenery before simulation or countdown (countdown=%s)',
    (enabled) => {
      (window as Window & { __countdown?: boolean }).__countdown = enabled;
      boundary.worldReady = false;
      app.tap();
      app.startRace();
      app.setLockstep(180);
      frame();
      frame();
      expect(app.snapshot()!.tick).toBe(0);
      expect(boundary.countdownBeat).not.toHaveBeenCalled();
      expect(boundary.recorderCalls).not.toContain('record');
      boundary.worldReady = true;
      frame();
      frame();
      expect(app.snapshot()!.tick).toBeGreaterThan(0);
    },
  );

  it.each(['free play', 'career'] as const)(
    'refreshes both foreground loading assignments for %s failures',
    async (kind) => {
      app.tap();
      frame();
      const before = seen.at(-1)!.epoch;
      let reject: (error: Error) => void = () => {};
      boundary.roadWait = new Promise<void>((_resolve, fail) => {
        reject = fail;
      });
      boundary.missingRoads = true;
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        if (kind === 'free play') app.startRace();
        else {
          const defs = careerDefs(createPackLibrary({ includeDrafts: true }).registry());
          const def = defs[0]!;
          expect(app.rideCareer(def.regionId, def.nodes[0]!.id)).toBe(true);
        }
        frame();
        const loadingEpoch = seen.at(-1)!.epoch;
        expect(loadingEpoch).toBeGreaterThan(before);
        reject(new Error('road request failed'));
        await vi.dynamicImportSettled();
        frame();
        expect(seen.at(-1)!.eligible).toBe(false);
        expect(seen.at(-1)!.epoch).toBeGreaterThan(loadingEpoch);
        expect(warning).toHaveBeenCalled();
      } finally {
        warning.mockRestore();
      }
    },
  );

  it.each(['free play', 'career'] as const)(
    'refreshes foreground loading completion before %s launch',
    async (kind) => {
      app.tap();
      frame();
      let resolve: () => void = () => {};
      boundary.roadWait = new Promise<void>((done) => {
        resolve = done;
      });
      boundary.missingRoads = true;
      if (kind === 'free play') app.startRace();
      else {
        const def = careerDefs(createPackLibrary({ includeDrafts: true }).registry())[0]!;
        expect(app.rideCareer(def.regionId, def.nodes[0]!.id)).toBe(true);
      }
      const loading = frame();
      expect(loading.eligible).toBe(false);
      boundary.missingRoads = false;
      resolve();
      await vi.dynamicImportSettled();
      expect(app.state()).toBe('race');
      const first = frame();
      expect(first.epoch).toBeGreaterThan(loading.epoch);
      expect(frame().eligible).toBe(true);
    },
  );

  const begin = () =>
    app.beginMeasurement({ signal: new AbortController().signal, driverForRepeat: () => vi.fn() });
  it('guards lazy measurement opening by exact menu screen and captured normal generation', async () => {
    const open = vi.fn();
    const toolApp = createApp({
      host: {} as HTMLElement,
      canvas: { clientWidth: 800, clientHeight: 450 } as HTMLCanvasElement,
      build: { id: 'tool-unit', channel: 'dev', branch: 'unit' },
      seed: 1,
      callbacks: { onCopyReport: async () => {}, onMeasureFrames: open },
    });
    await vi.dynamicImportSettled();
    toolApp.tap();
    expect(boundary.callbacks!.onMeasureFrames).toBeTypeOf('function');
    boundary.callbacks!.onMeasureFrames!();
    const first = open.mock.calls[0]![0] as () => boolean;
    expect(first()).toBe(true);
    boundary.ui.screen = 'settings';
    expect(first()).toBe(false);
    boundary.ui.screen = 'menu';
    toolApp.setSeed(3);
    expect(first()).toBe(false);
    boundary.callbacks!.onMeasureFrames!();
    expect((open.mock.calls[1]![0] as () => boolean)()).toBe(true);
  });
  it('restores the actual menu draw inputs after an ordinary race left interpolation history', async () => {
    app.tap();
    app.startRace();
    frame(0);
    frame();
    frame();
    expect(boundary.render.mock.calls.at(-1)![0]).not.toBeNull();
    app.backToMenu();
    frame(0);
    const baseline = boundary.render.mock.calls.at(-1)!;
    expect(baseline[0]).toBeNull();
    expect(baseline[1]).toBe(app.snapshot());
    const started = await begin();
    if (started.kind !== 'started') throw new Error(started.reason);
    started.session.stop('caller-cancelled');
    await started.session.ended;
    const restored = boundary.render.mock.calls.at(-1)!;
    expect(restored[0]).toBe(baseline[0]);
    expect(restored[1]).toBe(baseline[1]);
    expect(restored[3]).toBe(baseline[3]);
  });
  it('refuses before menu, starts from a menu before its first RAF, and restores one actual menu draw', async () => {
    expect(await begin()).toMatchObject({ reason: 'not-menu' });
    app.tap();
    const normal = app.snapshot();
    const initialRecipe = boundary.receipt.mock.calls.at(-1)![0];
    const result = await begin();
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.kind).toBe('started');
    if (result.kind !== 'started') throw new Error('menu refused');
    expect(app.state()).toBe('menu');
    expect(app.snapshot()).toBe(normal);
    expect(result.session.workload.graphics.frameDivisor).toBe(1);
    const draws = boundary.render.mock.calls.length;
    result.session.stop('collector-target');
    const end = await result.session.ended;
    expect(end).toMatchObject({
      kind: 'stopped',
      reason: 'collector-target',
      restored: { visible: 'restored' },
    });
    expect(boundary.render.mock.calls.length).toBe(draws + 1);
    expect(boundary.receipt.mock.calls.at(-1)).toEqual([initialRecipe, { reset: 'measurement-to-menu' }]);
    expect(boundary.audioLease).toHaveBeenCalledTimes(1);
    expect(boundary.wakeLease).toHaveBeenCalledTimes(1);
  });
  it.each(['settings', 'raceOptions', 'career', 'careerResults', 'results'])(
    'requires exact menu UI screen: %s',
    async (screen) => {
      app.tap();
      boundary.ui.screen = screen;
      expect(await begin()).toMatchObject({ reason: 'wrong-ui-screen' });
      expect(boundary.audioLease).not.toHaveBeenCalled();
    },
  );
  it.each([
    'visibility',
    'pagehide',
    'fullscreen',
    'rotate',
    'native-release',
    'observation-failed',
  ] as const)('maps loss-first wake evidence: %s', async (reason) => {
    app.tap();
    const started = await begin();
    if (started.kind !== 'started') throw new Error(started.reason);
    boundary.wakeLoss!({ reason });
    boundary.lifecycle!.onHidden(
      reason === 'native-release' || reason === 'observation-failed' ? 'visibility' : reason,
    );
    const mapped = {
      visibility: 'hidden',
      pagehide: 'pagehide',
      fullscreen: 'fullscreen',
      rotate: 'rotate',
      'native-release': 'wake-lost',
      'observation-failed': 'wake-observation-failed',
    };
    expect(await started.session.ended).toMatchObject({ kind: 'failed', reason: mapped[reason] });
  });
  it('frame-subscriber stop returns before any ordinary audio tail or diagnostic quality tail', async () => {
    app.tap();
    const started = await begin();
    if (started.kind !== 'started') throw new Error(started.reason);
    const stop = vi.fn(() => started.session.stop('collector-target'));
    app.subscribeFrames(stop, vi.fn());
    boundary.audioFrame.mockClear();
    boundary.quality.mockClear();
    frame();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(boundary.audioFrame).not.toHaveBeenCalled();
    // Only restoration reinstates the normal tier; the retired measurement governor cannot write.
    expect(boundary.quality).toHaveBeenCalledTimes(1);
    expect((await started.session.ended).kind).toBe('stopped');
  });
  it('factory failure resolves a started session with no repeat-start and one terminal result', async () => {
    app.tap();
    const result = await app.beginMeasurement({
      signal: new AbortController().signal,
      driverForRepeat: () => {
        throw new Error('factory');
      },
    });
    if (result.kind !== 'started') throw new Error(result.reason);
    expect(await result.session.ended).toMatchObject({ reason: 'driver-factory-failed', repeats: [] });
  });
  it('superseding foreign driver is delivered after restoration and wins the slot', async () => {
    app.tap();
    const result = await begin();
    if (result.kind !== 'started') throw new Error(result.reason);
    const foreign = vi.fn();
    app.setTickDriver(foreign);
    expect(await result.session.ended).toMatchObject({ reason: 'superseded' });
    app.startRace();
    frame();
    frame();
    expect(foreign).toHaveBeenCalled();
  });
  it.each(['finished', 'busted'] as const)(
    'repeats %s privately with fresh factories, same config/seed and parked normal recorder/state',
    async (outcome) => {
      app.tap();
      const normal = {
        snapshot: app.snapshot(),
        recent: app.recentEvents(),
        career: app.career().profile,
        road: app.roadQueries(),
        replay: app.getReplayAndSettings().replay,
        replayFile: app.replayFile(),
        hashes: app.contentHashes(),
        key: app.replayKey(),
      };
      const serialized = JSON.stringify(normal);
      const indices: number[] = [];
      const routes: unknown[] = [];
      const drivers: unknown[] = [];
      const result = await app.beginMeasurement({
        signal: new AbortController().signal,
        driverForRepeat: ({ index }) => {
          indices.push(index);
          routes.push(app.roadQueries());
          const driver = vi.fn();
          drivers.push(driver);
          return driver;
        },
      });
      if (result.kind !== 'started') throw new Error(result.reason);
      boundary.uiWrite.mockClear();
      boundary.audioFrame.mockClear();
      boundary.recorderCalls = [];
      boundary.finishMeasurementStep = outcome === 'finished';
      boundary.bustMeasurementStep = outcome === 'busted';
      const events: string[] = [];
      result.session.subscribe((e) => events.push(e.kind), vi.fn());
      frame();
      frame();
      frame();
      expect(indices.slice(0, 3)).toEqual([0, 1, 2]);
      expect(new Set(drivers).size).toBe(drivers.length);
      expect(routes.every((r) => r === routes[0])).toBe(true);
      const configs = boundary.simConfigs.filter((c) => c.seed === 2);
      expect(configs.length).toBeGreaterThanOrEqual(3);
      expect(configs.every((c) => c === configs[0])).toBe(true);
      expect(boundary.recorderCalls).toEqual([]);
      expect(boundary.audioFrame).not.toHaveBeenCalled();
      expect(boundary.uiWrite).not.toHaveBeenCalled();
      expect(app.snapshot()).toBe(normal.snapshot);
      expect(app.recentEvents()).toBe(normal.recent);
      expect(app.career().profile).toBe(normal.career);
      expect(app.getReplayAndSettings().replay).toBe(normal.replay);
      expect(app.contentHashes()).toBe(normal.hashes);
      expect(app.replayKey()).toBe(normal.key);
      expect(JSON.stringify(normal)).toBe(serialized);
      result.session.stop('collector-target');
      const end = await result.session.ended;
      expect(end.repeats[0]?.reason).toBe(outcome);
      expect(events.slice(0, 5)).toEqual([
        'repeat-start',
        'repeat-end',
        'repeat-start',
        'repeat-end',
        'repeat-start',
      ]);
      app.startRace();
      frame();
      frame();
      expect(boundary.recorderCalls).toContain('beginRace');
      expect(app.snapshot()).not.toBe(normal.snapshot);
    },
  );
  it('R delivery cancels a hung audio preparation then retunes and synchronizes once; active R is consumed', async () => {
    app.tap();
    boundary.suspension = new Promise(() => {});
    const pending = begin();
    await vi.dynamicImportSettled();
    expect(boundary.audioAcquire).toHaveBeenCalledTimes(1);
    const press = () =>
      window.dispatchEvent(
        Object.assign(new Event('keydown'), { code: 'KeyR', shiftKey: false, repeat: false }),
      );
    press();
    expect(await pending).toMatchObject({ reason: 'superseded-before-start' });
    expect(boundary.retune).toHaveBeenCalledTimes(1);
    expect(boundary.syncLive).toHaveBeenCalledTimes(1);
    boundary.suspension = null;
    const result = await begin();
    if (result.kind !== 'started') throw new Error(result.reason);
    press();
    await Promise.resolve();
    expect(boundary.retune).toHaveBeenCalledTimes(1);
    expect(boundary.syncLive).toHaveBeenCalledTimes(1);
    expect(result.session.inspect().phase).toBe('running');
    result.session.stop('caller-cancelled');
    press();
    expect(boundary.retune).toHaveBeenCalledTimes(2);
    expect(boundary.syncLive).toHaveBeenCalledTimes(2);
  });
  it('a driver that stops its own session cannot advance the sim or leak an exception through RAF', async () => {
    app.tap();
    let session: import('./index').AppMeasurementSession | null = null;
    const result = await app.beginMeasurement({
      signal: new AbortController().signal,
      driverForRepeat: () => () => {
        session?.stop('caller-cancelled');
      },
    });
    if (result.kind !== 'started') throw new Error(result.reason);
    session = result.session;
    frame(0); // Establish the loop's clock; the following explicit interval permits one sim step.
    expect(() => frame()).not.toThrow();
    expect((await session.ended).repeats[0]?.finalTick).toBe(0);
  });
  it.each(['paused', 'hidden', 'lost-context', 'lockstep', 'aborted'] as const)(
    'strict entry refuses %s without installing or suspending',
    async (control) => {
      app.tap();
      const normal = app.snapshot();
      const controller = new AbortController();
      const reasons = {
        paused: 'ui-paused',
        hidden: 'lifecycle-held',
        'lost-context': 'renderer-context-lost',
        lockstep: 'lockstep-active',
        aborted: 'aborted',
      };
      if (control === 'paused') boundary.ui.paused = true;
      if (control === 'hidden') visible.visibilityState = 'hidden';
      if (control === 'lost-context') boundary.lost = true;
      if (control === 'lockstep') app.setLockstep(1);
      if (control === 'aborted') controller.abort();
      expect(
        await app.beginMeasurement({ signal: controller.signal, driverForRepeat: () => vi.fn() }),
      ).toMatchObject({ reason: reasons[control] });
      expect(app.snapshot()).toBe(normal);
      expect(boundary.audioAcquire).not.toHaveBeenCalled();
    },
  );
  it('held diagnostic code aborts promptly; late fulfillment cannot overwrite a following ordinary race', async () => {
    app.tap();
    let resolve!: () => void;
    boundary.chunkWait = new Promise<void>((done) => {
      resolve = done;
    });
    const controller = new AbortController();
    let settled = false;
    const pending = app.beginMeasurement({ signal: controller.signal, driverForRepeat: () => vi.fn() });
    void pending.then(() => {
      settled = true;
    });
    await vi.dynamicImportSettled();
    expect(settled).toBe(false);
    expect(boundary.audioAcquire).not.toHaveBeenCalled();
    controller.abort();
    expect(await pending).toMatchObject({ reason: 'aborted' });
    app.startRace();
    const current = app.snapshot(),
      receipts = boundary.receipt.mock.calls.length;
    resolve();
    await vi.dynamicImportSettled();
    expect(app.snapshot()).toBe(current);
    expect(boundary.receipt.mock.calls.length).toBe(receipts);
    expect(app.state()).toBe('race');
  });
  it('a held runtime import keeps one entry owner, and abort settles without waiting for the import', async () => {
    app.tap();
    let release!: () => void;
    boundary.runtimeWait = new Promise<void>((done) => {
      release = done;
    });
    const controller = new AbortController();
    const first = app.beginMeasurement({ signal: controller.signal, driverForRepeat: () => vi.fn() });
    expect(boundary.chunkRequests).toContain('measurement runtime');
    expect(boundary.chunkRequests).not.toContain('measurement scene');
    const second = await begin();
    expect(second).toMatchObject({ reason: 'owner-busy' });
    expect(Object.isFrozen(second)).toBe(true);
    expect(boundary.audioAcquire).not.toHaveBeenCalled();
    controller.abort();
    expect(await first).toMatchObject({ reason: 'aborted' });
    expect(boundary.wakeLoss).toBeNull();
    release();
    await vi.dynamicImportSettled();
    expect(boundary.audioAcquire).not.toHaveBeenCalled();
    expect(boundary.driver).not.toHaveBeenCalled();
  });
  it('ordinary navigation supersedes a held runtime import and stale fulfillment leaves the race alone', async () => {
    app.tap();
    let release!: () => void;
    boundary.runtimeWait = new Promise<void>((done) => {
      release = done;
    });
    const first = begin();
    expect(boundary.chunkRequests).toContain('measurement runtime');
    expect(boundary.chunkRequests).not.toContain('measurement scene');
    app.startRace();
    expect(await first).toMatchObject({ reason: 'superseded-before-start' });
    const current = app.snapshot();
    const receipts = boundary.receipt.mock.calls.length;
    release();
    await vi.dynamicImportSettled();
    expect(app.state()).toBe('race');
    expect(app.snapshot()).toBe(current);
    expect(boundary.receipt.mock.calls.length).toBe(receipts);
    expect(boundary.audioAcquire).not.toHaveBeenCalled();
    expect(boundary.wakeLoss).toBeNull();
    expect(boundary.driver).not.toHaveBeenCalled();
  });
  it.each(['hidden', 'lost-context'] as const)(
    'a %s hold retires a held runtime entry before its import resolves',
    async (holdKind) => {
      app.tap();
      let release!: () => void;
      boundary.runtimeWait = new Promise<void>((done) => {
        release = done;
      });
      const pending = begin();
      if (holdKind === 'hidden') boundary.lifecycle!.onHidden('visibility');
      else context(true);
      expect(await pending).toMatchObject({ reason: 'superseded-before-start' });
      release();
      await vi.dynamicImportSettled();
      expect(boundary.audioAcquire).not.toHaveBeenCalled();
      expect(boundary.wakeLoss).toBeNull();
    },
  );
  it('an unavailable runtime import reports preparation failure and permits retry', async () => {
    app.tap();
    boundary.runtimeMissing = true;
    await expect(begin()).rejects.toThrow('Measurement runtime code unavailable');
    expect(boundary.audioAcquire).not.toHaveBeenCalled();
    boundary.runtimeMissing = false;
    const next = await begin();
    expect(next.kind).toBe('started');
    if (next.kind === 'started') {
      next.session.stop('collector-target');
      await next.session.ended;
    }
  });
  it('unavailable diagnostic code releases ownership and permits a subsequent measurement', async () => {
    app.tap();
    const normal = app.snapshot();
    boundary.chunkMissing = true;
    await expect(begin()).rejects.toThrow('Measurement scene code unavailable');
    expect(app.snapshot()).toBe(normal);
    expect(boundary.audioAcquire).not.toHaveBeenCalled();
    boundary.chunkMissing = false;
    const next = await begin();
    expect(next.kind).toBe('started');
    if (next.kind === 'started') {
      next.session.stop('collector-target');
      await next.session.ended;
    }
  });
  it('held content preparation aborts promptly; late fulfillment cannot overwrite a following ordinary race', async () => {
    app.tap();
    boundary.missingRoads = true;
    let resolve!: () => void;
    boundary.roadWait = new Promise<void>((done) => {
      resolve = done;
    });
    const controller = new AbortController();
    const pending = app.beginMeasurement({ signal: controller.signal, driverForRepeat: () => vi.fn() });
    const normal = app.snapshot();
    controller.abort();
    expect(await pending).toMatchObject({ reason: 'aborted' });
    expect(app.snapshot()).toBe(normal);
    expect(boundary.audioAcquire).not.toHaveBeenCalled();
    boundary.missingRoads = false;
    boundary.roadWait = null;
    app.startRace();
    const current = app.snapshot(),
      receipts = boundary.receipt.mock.calls.length;
    resolve();
    await vi.dynamicImportSettled();
    expect(app.snapshot()).toBe(current);
    expect(boundary.receipt.mock.calls.length).toBe(receipts);
    expect(app.state()).toBe('race');
  });
  it('factory signal cancellation cannot install a driver or publish a repeat', async () => {
    app.tap();
    const controller = new AbortController();
    boundary.driver.mockClear();
    const result = await app.beginMeasurement({
      signal: controller.signal,
      driverForRepeat: () => {
        controller.abort();
        return vi.fn();
      },
    });
    if (result.kind !== 'started') throw new Error(result.reason);
    expect(await result.session.ended).toMatchObject({ reason: 'signal', repeats: [] });
    expect(boundary.driver).not.toHaveBeenCalled();
  });
  it('raw camera is discarded while device pause enters the exact terminal path', async () => {
    app.tap();
    const result = await begin();
    if (result.kind !== 'started') throw new Error(result.reason);
    frame(0);
    boundary.rawCamera = true;
    boundary.syncLive.mockClear();
    frame();
    expect(boundary.syncLive).not.toHaveBeenCalled();
    expect(result.session.inspect().phase).toBe('running');
    boundary.rawPause = true;
    frame();
    expect(await result.session.ended).toMatchObject({ reason: 'manual-pause' });
    expect(boundary.ui.paused).toBe(false);
  });
  it('a completed normal replay, including its end marker, stays byte-identical through repeats and stop', async () => {
    app.tap();
    app.startRace();
    frame(0);
    boundary.finishNormalStep = true;
    frame();
    expect(app.state()).toBe('results');
    const normal = app.getReplayAndSettings().replay;
    expect(normal).toHaveProperty('end', expect.anything());
    const before = JSON.stringify(app.replayFile());
    app.backToMenu();
    boundary.finishNormalStep = false;
    const result = await begin();
    if (result.kind !== 'started') throw new Error(result.reason);
    boundary.recorderCalls = [];
    boundary.finishMeasurementStep = true;
    frame();
    frame();
    result.session.stop('collector-target');
    await result.session.ended;
    expect(app.getReplayAndSettings().replay).toBe(normal);
    expect(JSON.stringify(app.replayFile())).toBe(before);
    expect(boundary.recorderCalls).toEqual([]);
    app.startRace();
    expect(app.getReplayAndSettings().replay).not.toBe(normal);
  });
  it('watches a finished race independently, pauses across lifecycle changes and returns its exact result', async () => {
    app.tap();
    app.startRace();
    frame(0);
    boundary.finishNormalStep = true;
    frame();
    expect(app.state()).toBe('results');
    const normal = app.getReplayAndSettings().replay;
    const before = JSON.stringify(app.replayFile());
    const profile = app.career().profile;
    boundary.recorderCalls = [];
    boundary.inputSample.mockClear();
    boundary.audioFrame.mockClear();
    boundary.callbacks!.onWatchReplay();
    await vi.dynamicImportSettled();
    expect(app.state()).toBe('replay');
    expect(boundary.ui.screen).toBe('replay');
    expect(app.replayPlayback()).toMatchObject({ tick: 0, complete: false, playing: true });
    boundary.callbacks!.onReplayAction('toggle');
    boundary.lifecycle!.onHidden('visibility');
    boundary.lifecycle!.onShown();
    frame(9000);
    expect(app.replayPlayback()).toMatchObject({ tick: 0, playing: false });
    app.startRace();
    app.backToMenu();
    expect(app.state()).toBe('replay');
    boundary.callbacks!.onReplayAction('camera');
    expect(app.replayPlayback()?.mode).toBe('orbit');
    boundary.callbacks!.onReplayAction('toggle');
    frame(0);
    frame(20);
    expect(app.replayPlayback()).toMatchObject({ complete: true, playing: false });
    expect(boundary.render.mock.calls.at(-1)?.[2]).toBe(1);
    expect(boundary.inputSample).not.toHaveBeenCalled();
    expect(boundary.audioFrame).not.toHaveBeenCalled();
    expect(boundary.recorderCalls).toEqual([]);
    boundary.callbacks!.onReplayAction('restart');
    await vi.dynamicImportSettled();
    expect(app.replayPlayback()).toMatchObject({ tick: 0, complete: false, playing: true });
    boundary.callbacks!.onReplayAction('return');
    expect(app.state()).toBe('results');
    expect(boundary.ui.screen).toBe('results');
    expect(app.replayPlayback()).toBeNull();
    expect(app.getReplayAndSettings().replay).toBe(normal);
    expect(JSON.stringify(app.replayFile())).toBe(before);
    expect(app.career().profile).toBe(profile);
    expect(boundary.inputLease).toHaveBeenCalledOnce();
    expect(boundary.audioLease).toHaveBeenCalledOnce();
  });

  it('rejects a wrong-key viewer before constructing a new sim, retaining the result', async () => {
    app.tap();
    app.startRace();
    frame(0);
    boundary.finishNormalStep = true;
    frame();
    const recording = app.getReplayAndSettings().replay as Recording | null;
    if (!recording) throw new Error('finished recording missing');
    recording.header.replayKey = 'wrong-key';
    const sims = boundary.simConfigs.length;
    boundary.callbacks!.onWatchReplay();
    await vi.dynamicImportSettled();
    expect(boundary.simConfigs).toHaveLength(sims);
    expect(app.state()).toBe('results');
    expect(boundary.ui.screen).toBe('results');
    expect(app.replayPlayback()).toBeNull();
    expect(boundary.inputLease).toHaveBeenCalledOnce();
  });

  it('measurement has an independent seed draw and leaves the next normal draw equal to a no-measurement control', async () => {
    const make = (normalSeed: () => number, measureSeed: () => number) =>
      createApp({
        host: {} as HTMLElement,
        canvas: { clientWidth: 800, clientHeight: 450 } as HTMLCanvasElement,
        build: { id: 'seed-unit', channel: 'dev', branch: 'unit' },
        callbacks: { onCopyReport: async () => {} },
        seedSource: normalSeed,
        measurementSeedSource: measureSeed,
      });
    const makeSource = () => {
      let n = 90;
      return vi.fn(() => ++n);
    };
    const source = makeSource(),
      controlSource = makeSource(),
      independent = vi.fn(() => 2);
    const measured = make(source, independent);
    await vi.dynamicImportSettled();
    measured.tap();
    const control = make(
      controlSource,
      vi.fn(() => 77),
    );
    await vi.dynamicImportSettled();
    control.tap();
    const count = source.mock.calls.length;
    const result = await measured.beginMeasurement({
      signal: new AbortController().signal,
      driverForRepeat: () => vi.fn(),
    });
    if (result.kind !== 'started') throw new Error(result.reason);
    result.session.stop('caller-cancelled');
    await result.session.ended;
    expect(source.mock.calls.length).toBe(count);
    expect(independent).toHaveBeenCalledTimes(1);
    measured.startRace();
    const measuredSeed = boundary.simConfigs.at(-1)!.seed;
    control.startRace();
    const controlSeed = boundary.simConfigs.at(-1)!.seed;
    expect(measuredSeed).toBe(controlSeed);
    expect(source.mock.calls.length).toBe(count + 1);
  });
});
