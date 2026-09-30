import { describe, expect, it } from 'vitest';
import { createPlatform, type PlatformEnv, wakeLockRequester } from './index';

// platform-1 acceptance (docs/milestones/M1.md): with mocked APIs the start-tap sequence runs in
// order inside one tap and survives any single call being rejected; the lock is re-applied on
// every fullscreen change; a failed lock on a portrait phone shows the rotate screen; hiding the
// page pauses exactly once. The browser halves are tests/e2e/platform-*.spec.ts.

type Step = 'fullscreen' | 'lock' | 'tilt' | 'audio';

interface MockOptions {
  reject?: Step;
  /** Throw synchronously instead of returning a rejected promise. */
  throwSync?: boolean;
  portrait?: boolean;
  touch?: boolean;
  missing?: ('fullscreen' | 'lock' | 'tilt' | 'wakeLock')[];
  /** The wake-lock request rejects (as it does on a hidden page or with battery saver on). */
  wakeLockRejects?: boolean;
}

/** A mocked Screen Wake Lock: each request makes a sentinel the test can inspect or release. */
interface MockSentinel {
  released: boolean;
  /** The browser releasing the lock on its own (the page was hidden). */
  lose(): void;
}

function mockEnv(opts: MockOptions = {}) {
  const calls: string[] = [];
  const doc = new EventTarget();
  const win = new EventTarget();
  const rotate: boolean[] = [];
  const styles: string[] = [];
  const state = { fullscreen: false, hidden: false, portrait: opts.portrait ?? false };
  const fail = (step: Step): Promise<never> => {
    if (opts.throwSync) throw new Error(`${step} threw`);
    return Promise.reject(new Error(`${step} rejected`));
  };
  const missing = new Set(opts.missing ?? []);
  const sentinels: MockSentinel[] = [];
  /** Resolvers for requests the test holds open, to test a release that races the request. */
  const heldRequests: (() => void)[] = [];
  const wake = { hold: false };
  const env: PlatformEnv = {
    doc,
    win,
    requestFullscreen: missing.has('fullscreen')
      ? null
      : () => {
          calls.push('fullscreen');
          if (opts.reject === 'fullscreen') return fail('fullscreen');
          return Promise.resolve().then(() => {
            state.fullscreen = true;
            doc.dispatchEvent(new Event('fullscreenchange'));
          });
        },
    isFullscreen: () => state.fullscreen,
    lockLandscape: missing.has('lock')
      ? null
      : () => {
          calls.push('lock');
          if (opts.reject === 'lock') return fail('lock');
          // As on Android Chrome: the lock needs fullscreen first.
          return state.fullscreen ? Promise.resolve() : Promise.reject(new Error('not fullscreen'));
        },
    requestTiltPermission: missing.has('tilt')
      ? null
      : () => {
          calls.push('tilt');
          if (opts.reject === 'tilt') return fail('tilt');
          return Promise.resolve('granted');
        },
    requestWakeLock: missing.has('wakeLock')
      ? null
      : () => {
          calls.push('wakeLock');
          if (opts.wakeLockRejects) return Promise.reject(new Error('NotAllowedError'));
          let onRelease: (() => void) | null = null;
          const s: MockSentinel = {
            released: false,
            lose() {
              if (s.released) return;
              s.released = true;
              onRelease?.();
            },
          };
          sentinels.push(s);
          const handle = {
            release: () => {
              calls.push('wakeRelease');
              s.lose();
              return Promise.resolve();
            },
            onRelease: (cb: () => void) => {
              onRelease = cb;
            },
          };
          if (!wake.hold) return Promise.resolve(handle);
          return new Promise((resolve) => heldRequests.push(() => resolve(handle)));
        },
    isPortrait: () => state.portrait,
    isTouchDevice: () => opts.touch ?? true,
    isHidden: () => state.hidden,
    showRotate: (need) => rotate.push(need),
    injectStyle: (css) => {
      styles.push(css);
      return () => styles.splice(styles.indexOf(css), 1);
    },
  };
  const audio = () => {
    calls.push('audio');
    if (opts.reject === 'audio') return fail('audio');
    return Promise.resolve();
  };
  const setFullscreen = (on: boolean) => {
    state.fullscreen = on;
    doc.dispatchEvent(new Event('fullscreenchange'));
  };
  const setHidden = (on: boolean) => {
    state.hidden = on;
    doc.dispatchEvent(new Event('visibilitychange'));
  };
  const setPortrait = (on: boolean) => {
    state.portrait = on;
    win.dispatchEvent(new Event('resize'));
  };
  return {
    env,
    calls,
    rotate,
    styles,
    audio,
    setFullscreen,
    setHidden,
    setPortrait,
    doc,
    win,
    sentinels,
    heldRequests,
    wake,
  };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('the start-tap sequence', () => {
  it('makes every call in order, synchronously inside the tap', async () => {
    const m = mockEnv();
    const p = createPlatform(m.env).runStartTap(m.audio);
    // Nothing awaited yet: every call has already been made within the tap's activation.
    expect(m.calls).toEqual(['fullscreen', 'lock', 'tilt', 'audio']);
    const result = await p;
    expect(result).toEqual({ fullscreen: true, orientationLocked: true, tilt: 'granted', audio: true });
    // The first lock ran before fullscreen and failed; the re-lock on fullscreen change held.
    expect(m.calls.filter((c) => c === 'lock').length).toBeGreaterThanOrEqual(2);
  });

  for (const step of ['fullscreen', 'lock', 'tilt', 'audio'] as const) {
    for (const throwSync of [false, true]) {
      it(`survives the ${step} call ${throwSync ? 'throwing' : 'rejecting'}`, async () => {
        const m = mockEnv({ reject: step, throwSync });
        const result = await createPlatform(m.env).runStartTap(m.audio);
        expect(m.calls.slice(0, 4)).toEqual(['fullscreen', 'lock', 'tilt', 'audio']);
        expect(result.fullscreen).toBe(step !== 'fullscreen');
        // Without fullscreen the lock cannot hold either.
        expect(result.orientationLocked).toBe(step !== 'fullscreen' && step !== 'lock');
        expect(result.tilt).toBe(step === 'tilt' ? 'denied' : 'granted');
        expect(result.audio).toBe(step !== 'audio');
      });
    }
  }

  it('skips APIs the browser does not have', async () => {
    const m = mockEnv({ missing: ['fullscreen', 'lock', 'tilt'] });
    const result = await createPlatform(m.env).runStartTap(m.audio);
    expect(m.calls).toEqual(['audio']);
    expect(result).toEqual({ fullscreen: false, orientationLocked: false, tilt: 'not-needed', audio: true });
  });

  it('re-locks the orientation whenever fullscreen comes back', async () => {
    const m = mockEnv();
    await createPlatform(m.env).runStartTap(m.audio);
    const before = m.calls.filter((c) => c === 'lock').length;
    m.setFullscreen(false);
    m.setFullscreen(true);
    await flush();
    expect(m.calls.filter((c) => c === 'lock').length).toBe(before + 1);
  });
});

describe('the rotate-your-phone trigger', () => {
  it('shows the rotate screen when the lock fails on a portrait phone, and hides it once turned', async () => {
    const m = mockEnv({ reject: 'lock', portrait: true });
    const platform = createPlatform(m.env);
    await platform.runStartTap(m.audio);
    expect(m.rotate).toEqual([true]);
    expect(platform.rotateNeeded()).toBe(true);
    m.setPortrait(false);
    expect(m.rotate).toEqual([true, false]);
  });

  it('stays off before the start tap, in landscape, and without a touch screen', async () => {
    const early = mockEnv({ portrait: true });
    const p = createPlatform(early.env);
    early.setPortrait(true);
    expect(early.rotate).toEqual([]);
    await p.runStartTap(early.audio);
    expect(early.rotate).toEqual([true]);

    const landscape = mockEnv({ reject: 'lock', portrait: false });
    await createPlatform(landscape.env).runStartTap(landscape.audio);
    expect(landscape.rotate).toEqual([]);

    const desktop = mockEnv({ reject: 'lock', portrait: true, touch: false });
    await createPlatform(desktop.env).runStartTap(desktop.audio);
    expect(desktop.rotate).toEqual([]);
  });
});

describe('lifecycle', () => {
  const watch = (m: ReturnType<typeof mockEnv>) => {
    const log: string[] = [];
    const platform = createPlatform(m.env);
    const stop = platform.watchLifecycle({
      onHidden: (reason) => log.push(`hidden:${reason}`),
      onShown: () => log.push('shown'),
    });
    return { log, platform, stop };
  };

  it('pauses exactly once when the page hides, however many signals arrive', () => {
    const m = mockEnv();
    const { log } = watch(m);
    m.setHidden(true);
    m.win.dispatchEvent(new Event('pagehide'));
    m.setHidden(true);
    expect(log).toEqual(['hidden:visibility']);
    m.win.dispatchEvent(new Event('pageshow'));
    m.setHidden(false);
    expect(log).toEqual(['hidden:visibility', 'shown']);
  });

  it('pauses on a lost fullscreen and resumes on the next tap, re-entering fullscreen on touch', async () => {
    const m = mockEnv();
    const { log, platform } = watch(m);
    await platform.runStartTap(m.audio);
    const fullscreenCalls = m.calls.filter((c) => c === 'fullscreen').length;
    m.setFullscreen(false);
    expect(log).toEqual(['hidden:fullscreen']);
    // Coming back from an app switch is not enough: fullscreen is still gone.
    m.setHidden(true);
    m.setHidden(false);
    expect(log).toEqual(['hidden:fullscreen']);
    m.win.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerType: 'touch' }));
    expect(log).toEqual(['hidden:fullscreen', 'shown']);
    expect(m.calls.filter((c) => c === 'fullscreen').length).toBe(fullscreenCalls + 1);
  });

  it('resumes on a key press without forcing fullscreen back', async () => {
    const m = mockEnv({ touch: false });
    const { log, platform } = watch(m);
    await platform.runStartTap(m.audio);
    m.setFullscreen(false);
    const fullscreenCalls = m.calls.filter((c) => c === 'fullscreen').length;
    m.win.dispatchEvent(new Event('keydown'));
    expect(log).toEqual(['hidden:fullscreen', 'shown']);
    expect(m.calls.filter((c) => c === 'fullscreen').length).toBe(fullscreenCalls);
  });

  it('pauses while the rotate screen is up', async () => {
    const m = mockEnv({ portrait: false });
    const { log, platform } = watch(m);
    await platform.runStartTap(m.audio);
    m.setFullscreen(false); // the lock is released with fullscreen
    m.win.dispatchEvent(new Event('keydown'));
    log.length = 0;
    m.setPortrait(true);
    expect(log).toEqual(['hidden:rotate']);
    m.setPortrait(false);
    expect(log).toEqual(['hidden:rotate', 'shown']);
  });

  it('stops listening when asked', () => {
    const m = mockEnv();
    const { log, stop } = watch(m);
    stop();
    m.setHidden(true);
    expect(log).toEqual([]);
  });
});

// platform-2 acceptance (docs/milestones/M2.md): a mocked wake lock is requested when a race
// starts and released on pause; it is re-requested when the page comes back while a race still
// wants it, released in menus, and never throws where the browser has no lock.
describe('the screen wake lock', () => {
  const held = (m: ReturnType<typeof mockEnv>) => m.sentinels.filter((s) => !s.released).length;

  it('is requested when a race starts and released on pause', async () => {
    const m = mockEnv();
    const platform = createPlatform(m.env);
    // app/'s wiring: a race keeps the screen awake; the pause that platform raises releases it.
    platform.watchLifecycle({ onHidden: () => platform.keepAwake(false), onShown: () => {} });
    platform.keepAwake(true);
    await flush();
    expect(m.calls.filter((c) => c === 'wakeLock')).toHaveLength(1);
    expect(platform.wakeLockHeld()).toBe(true);
    expect(held(m)).toBe(1);

    m.win.dispatchEvent(new Event('pagehide'));
    await flush();
    expect(m.calls).toContain('wakeRelease');
    expect(platform.wakeLockHeld()).toBe(false);
    expect(held(m)).toBe(0);
  });

  it('asks once however often the race says so, and releases in menus', async () => {
    const m = mockEnv();
    const platform = createPlatform(m.env);
    platform.keepAwake(true);
    platform.keepAwake(true);
    await flush();
    platform.keepAwake(true);
    await flush();
    expect(m.calls.filter((c) => c === 'wakeLock')).toHaveLength(1);
    platform.keepAwake(false);
    await flush();
    expect(held(m)).toBe(0);
    expect(platform.wakeLockHeld()).toBe(false);
  });

  it('is re-requested when the page comes back while a race still wants it', async () => {
    const m = mockEnv();
    const platform = createPlatform(m.env);
    platform.watchLifecycle({ onHidden: () => {}, onShown: () => {} });
    platform.keepAwake(true);
    await flush();
    // The browser drops the lock itself when the page hides.
    m.sentinels[0]?.lose();
    m.setHidden(true);
    await flush();
    expect(platform.wakeLockHeld()).toBe(false);
    m.setHidden(false);
    await flush();
    expect(m.calls.filter((c) => c === 'wakeLock')).toHaveLength(2);
    expect(platform.wakeLockHeld()).toBe(true);
  });

  it('is re-requested on visible even when nothing watches the lifecycle', async () => {
    const m = mockEnv();
    const platform = createPlatform(m.env);
    m.setHidden(true);
    platform.keepAwake(true);
    await flush();
    // A hidden page cannot hold the lock, so it waits for the page to come back.
    expect(m.calls.filter((c) => c === 'wakeLock')).toHaveLength(0);
    m.setHidden(false);
    await flush();
    expect(m.calls.filter((c) => c === 'wakeLock')).toHaveLength(1);
    expect(platform.wakeLockHeld()).toBe(true);
  });

  it('is not re-requested after the pause menu took over', async () => {
    const m = mockEnv();
    const platform = createPlatform(m.env);
    platform.watchLifecycle({ onHidden: () => platform.keepAwake(false), onShown: () => {} });
    platform.keepAwake(true);
    await flush();
    m.setHidden(true);
    m.setHidden(false);
    await flush();
    expect(m.calls.filter((c) => c === 'wakeLock')).toHaveLength(1);
    expect(platform.wakeLockHeld()).toBe(false);
  });

  it('lets go while any pause reason stands, and takes it back when the last clears', async () => {
    const m = mockEnv();
    const platform = createPlatform(m.env);
    platform.watchLifecycle({ onHidden: () => {}, onShown: () => {} });
    await platform.runStartTap(m.audio);
    platform.keepAwake(true);
    await flush();
    expect(platform.wakeLockHeld()).toBe(true);
    m.setFullscreen(false);
    await flush();
    expect(platform.wakeLockHeld()).toBe(false);
    m.win.dispatchEvent(new Event('keydown'));
    await flush();
    expect(platform.wakeLockHeld()).toBe(true);
    expect(m.calls.filter((c) => c === 'wakeLock')).toHaveLength(2);
  });

  it('releases a lock that arrives after the race stopped wanting it', async () => {
    const m = mockEnv();
    m.wake.hold = true;
    const platform = createPlatform(m.env);
    platform.keepAwake(true);
    platform.keepAwake(false);
    for (const resolve of m.heldRequests) resolve();
    await flush();
    expect(m.calls.filter((c) => c === 'wakeLock')).toHaveLength(1);
    expect(held(m)).toBe(0);
    expect(platform.wakeLockHeld()).toBe(false);
  });

  it('does not chase a lock the browser takes back on a visible page', async () => {
    const m = mockEnv();
    const platform = createPlatform(m.env);
    platform.keepAwake(true);
    await flush();
    m.sentinels[0]?.lose();
    await flush();
    expect(platform.wakeLockHeld()).toBe(false);
    expect(m.calls.filter((c) => c === 'wakeLock')).toHaveLength(1);
  });

  it('never throws where the browser has no lock or refuses it', async () => {
    const none = mockEnv({ missing: ['wakeLock'] });
    const a = createPlatform(none.env);
    a.keepAwake(true);
    await flush();
    expect(a.wakeLockHeld()).toBe(false);
    a.keepAwake(false);

    const refused = mockEnv({ wakeLockRejects: true });
    const b = createPlatform(refused.env);
    b.keepAwake(true);
    await flush();
    expect(b.wakeLockHeld()).toBe(false);
    // One refusal is not a retry loop; the next return to the page tries again.
    expect(refused.calls.filter((c) => c === 'wakeLock')).toHaveLength(1);
    refused.setHidden(true);
    refused.setHidden(false);
    await flush();
    expect(refused.calls.filter((c) => c === 'wakeLock')).toHaveLength(2);
  });
});

describe('the browser wake-lock adapter', () => {
  it('asks navigator.wakeLock for the screen and reports the release event once', async () => {
    const types: string[] = [];
    const sentinel = Object.assign(new EventTarget(), {
      release() {
        sentinel.dispatchEvent(new Event('release'));
        return Promise.resolve();
      },
    });
    const request = wakeLockRequester({
      wakeLock: {
        request: (type: 'screen') => {
          types.push(type);
          return Promise.resolve(sentinel);
        },
      },
    });
    expect(request).not.toBeNull();
    const handle = await request!();
    let released = 0;
    handle.onRelease(() => released++);
    await handle.release();
    sentinel.dispatchEvent(new Event('release'));
    expect(types).toEqual(['screen']);
    expect(released).toBe(1);
  });

  it('is null where the browser has no wake lock', () => {
    expect(wakeLockRequester({})).toBeNull();
    expect(wakeLockRequester(undefined)).toBeNull();
  });
});

describe('page guards', () => {
  it('blocks the long-press menu and text selection, and sets the scroll and safe-area styles', () => {
    const m = mockEnv();
    const stop = createPlatform(m.env).watchLifecycle({ onHidden: () => {}, onShown: () => {} });
    for (const type of ['contextmenu', 'selectstart', 'gesturestart']) {
      const e = new Event(type, { cancelable: true });
      m.doc.dispatchEvent(e);
      expect(e.defaultPrevented, type).toBe(true);
    }
    const css = m.styles.join('\n');
    expect(css).toContain('overscroll-behavior: none');
    expect(css).toContain('-webkit-touch-callout: none');
    expect(css).toContain('user-select: none');
    expect(css).toContain('env(safe-area-inset-left');
    stop();
    expect(m.styles).toEqual([]);
    const after = new Event('contextmenu', { cancelable: true });
    m.doc.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});
