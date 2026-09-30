import { describe, expect, it } from 'vitest';
import { createPlatform, type PlatformEnv } from './index';

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
  missing?: ('fullscreen' | 'lock' | 'tilt')[];
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
  return { env, calls, rotate, styles, audio, setFullscreen, setHidden, setPortrait, doc, win };
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
