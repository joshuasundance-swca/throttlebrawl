import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type AppDrawnFrame, type AppHandle } from './index';
import type { createUi } from '../ui';
import type { LifecycleCallbacks } from '../platform';
import { createPackLibrary } from '../content';
import { careerDefs } from './career-flow';

const boundary = vi.hoisted(() => ({
  ui: { paused: false, region: 'base:florida-keys' },
  callbacks: null as Parameters<typeof createUi>[1]['callbacks'] | null,
  lifecycle: null as LifecycleCallbacks | null,
  context: null as ((lost: boolean) => void) | null,
  lost: false,
  pose: true,
  render: vi.fn(),
  audioFrame: vi.fn(),
  driver: vi.fn(),
  missingRoads: false,
  roadWait: null as Promise<void> | null,
}));

vi.mock('../content', async (original) => {
  const module = await original<typeof import('../content')>();
  return {
    ...module,
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
          if (key === 'career' || key === 'narrative' || key === 'ticker') return surface();
          if (key === 'pause')
            return () => {
              target.paused = true;
              options.callbacks.onPause!();
            };
          return noop;
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
            if (key === 'onContextChange')
              return (cb: (lost: boolean) => void) => {
                boundary.context = cb;
              };
            if (key === 'render') return boundary.render;
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
          if (key === 'sample') return () => ({ steer: 0, throttle: 0, brake: 0, flags: 0 });
          if (key === 'lastActions') return () => ({});
          if (key === 'setDriver') return boundary.driver;
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
    boundary.lost = false;
    boundary.pose = true;
    boundary.missingRoads = false;
    boundary.roadWait = null;
    boundary.render.mockReset();
    boundary.audioFrame.mockReset();
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

  it('observes countdown release and the first sim step through the real app step hook', () => {
    (window as Window & { __countdown?: boolean }).__countdown = true;
    app.tap();
    app.startRace();
    app.setLockstep(180);
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
});
