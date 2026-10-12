import { describe, expect, it, vi } from 'vitest';
import { createPlatform, wakeLockRequester, type PlatformEnv } from './index';

// docs/milestones/wake-lease.md, Automated acceptance 1–8. Native active counts below
// verify our independent calls, not a browser's physical screen lock.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function native() {
  const callbacks: (() => void)[] = [];
  const control = {
    value: false as boolean | undefined,
    read: null as (() => boolean | undefined) | null,
    registration: null as (() => void) | null,
    release: null as (() => Promise<void>) | null,
    event() {
      for (const cb of callbacks) cb();
    },
  };
  const handle = {
    get released() {
      return control.read ? control.read() : control.value;
    },
    release: vi.fn(() => {
      if (control.release) return control.release();
      control.value = true;
      control.event();
      return Promise.resolve();
    }),
    onRelease: vi.fn((cb: () => void) => {
      callbacks.push(cb);
      control.registration?.();
    }),
  };
  return { control, handle };
}

function setup() {
  const doc = new EventTarget();
  const win = new EventTarget();
  const state = { hidden: false, fullscreen: false, portrait: false };
  const handles: ReturnType<typeof native>[] = [];
  const env: PlatformEnv = {
    doc,
    win,
    requestFullscreen: () => {
      state.fullscreen = true;
      doc.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    },
    isFullscreen: () => state.fullscreen,
    lockLandscape: () => Promise.resolve(),
    requestTiltPermission: null,
    requestWakeLock: vi.fn(() => {
      const n = native();
      handles.push(n);
      return Promise.resolve(n.handle);
    }),
    isPortrait: () => state.portrait,
    isTouchDevice: () => true,
    isHidden: () => state.hidden,
    showRotate: vi.fn(),
    injectStyle: vi.fn(() => () => {}),
  };
  const platform = createPlatform(env);
  const hidden = (on: boolean) => {
    state.hidden = on;
    doc.dispatchEvent(new Event('visibilitychange'));
  };
  const acquire = (onLost = vi.fn(), controller = new AbortController()) =>
    platform.acquireWakeLease({ signal: controller.signal, onLost });
  const active = () => handles.filter((n) => n.control.value === false).length;
  return { env, doc, win, state, handles, platform, hidden, acquire, active };
}

async function held(promise: ReturnType<ReturnType<typeof setup>['acquire']>) {
  const result = await promise;
  expect(result.kind).toBe('acquired');
  if (result.kind !== 'acquired') throw new Error('positive control did not acquire');
  return result.lease;
}

describe('owned screen wake leases', () => {
  it('publishes a held lease without a lifecycle subscriber or fullscreen', async () => {
    const m = setup();
    const loss = vi.fn();
    const lease = await held(m.acquire(loss));
    expect(lease.state).toBe('held');
    expect(m.platform.wakeLockHeld()).toBe(true);
    lease.release();
    lease.release();
    expect(lease.state).toBe('released');
    expect(m.handles[0]!.handle.release).toHaveBeenCalledTimes(1);
    expect(m.platform.wakeLockHeld()).toBe(false);
    expect(loss).not.toHaveBeenCalled();
  });

  it('orders preflight refusals and installs no owner or request', async () => {
    const m = setup();
    const controller = new AbortController();
    controller.abort();
    m.env.requestWakeLock = null;
    m.state.hidden = true;
    expect(await m.acquire(vi.fn(), controller)).toEqual({ kind: 'refused', reason: 'cancelled' });
    expect(await m.acquire()).toEqual({ kind: 'refused', reason: 'unsupported' });
    const request = vi.fn(() => Promise.resolve(native().handle));
    m.env.requestWakeLock = request;
    expect(await m.acquire()).toEqual({ kind: 'refused', reason: 'unavailable' });
    m.state.hidden = false;
    m.win.dispatchEvent(new Event('pagehide'));
    expect(await m.acquire()).toEqual({ kind: 'refused', reason: 'unavailable' });
    expect(request).not.toHaveBeenCalled();
    m.win.dispatchEvent(new Event('pageshow'));
    await held(m.acquire());
    expect(request).toHaveBeenCalledTimes(1);
  });

  for (const throwing of [true, false]) {
    it(`contains requester ${throwing ? 'throws' : 'rejections'} without retry`, async () => {
      const m = setup();
      const request = vi.fn(() => {
        if (throwing) throw new Error('request');
        return Promise.reject(new Error('request'));
      });
      m.env.requestWakeLock = request;
      expect(await m.acquire()).toEqual({ kind: 'refused', reason: 'request-failed' });
      expect(request).toHaveBeenCalledTimes(1);
      expect(m.platform.wakeLockHeld()).toBe(false);
    });
  }

  for (const mode of [
    'unknown',
    'released',
    'registration-throw',
    'getter-throw',
    'registration-loss',
    'recheck-loss',
  ] as const) {
    it(`refuses ${mode} before publication with exact unused cleanup`, async () => {
      const m = setup();
      const n = native();
      const loss = vi.fn();
      if (mode === 'unknown') n.control.value = undefined;
      if (mode === 'released') n.control.value = true;
      if (mode === 'registration-throw')
        n.control.registration = () => {
          throw new Error('observe');
        };
      if (mode === 'getter-throw')
        n.control.read = () => {
          throw new Error('read');
        };
      if (mode === 'registration-loss') n.control.registration = () => n.control.event();
      if (mode === 'recheck-loss') {
        let reads = 0;
        n.control.read = () => (++reads === 1 ? false : true);
      }
      m.env.requestWakeLock = () => Promise.resolve(n.handle);
      const reason =
        mode === 'unknown'
          ? 'unobservable'
          : mode.includes('throw')
            ? 'observation-failed'
            : 'already-released';
      expect(await m.acquire(loss)).toEqual({ kind: 'refused', reason });
      expect(n.handle.onRelease).toHaveBeenCalledTimes(1);
      expect(n.handle.release).toHaveBeenCalledTimes(reason === 'already-released' ? 0 : 1);
      expect(loss).not.toHaveBeenCalled();
      expect(() => m.platform.wakeLockHeld()).not.toThrow();
    });
  }

  for (const ordinaryFirst of [true, false]) {
    for (const abortA of [true, false]) {
      it(`keeps A/B/ordinary independent (ordinary first ${ordinaryFirst}, abort A ${abortA})`, async () => {
        const m = setup();
        const aController = new AbortController();
        if (ordinaryFirst) {
          m.platform.keepAwake(true);
          await Promise.resolve();
          await Promise.resolve();
        }
        const a = await held(m.acquire(vi.fn(), aController));
        const b = await held(m.acquire());
        if (!ordinaryFirst) {
          m.platform.keepAwake(true);
          await Promise.resolve();
          await Promise.resolve();
        }
        expect(m.active()).toBe(3);
        if (abortA) aController.abort();
        else a.release();
        expect(a.state).toBe('released');
        expect(b.state).toBe('held');
        expect(m.active()).toBe(2);
        m.platform.keepAwake(false);
        expect(m.active()).toBe(1);
        expect(b.state).toBe('held');
        expect(m.platform.wakeLockHeld()).toBe(true);
        b.release();
        expect(m.active()).toBe(0);
        expect(m.platform.wakeLockHeld()).toBe(false);
      });
    }
  }

  it('settles an aborted hanging request before fulfillment and retires the late handle once', async () => {
    const m = setup();
    const b = await held(m.acquire());
    m.platform.keepAwake(true);
    await Promise.resolve();
    await Promise.resolve();
    const request = deferred<ReturnType<typeof native>['handle']>();
    m.env.requestWakeLock = () => request.promise;
    const controller = new AbortController();
    const loss = vi.fn();
    const pending = m.acquire(loss, controller);
    controller.abort();
    expect(await pending).toEqual({ kind: 'refused', reason: 'cancelled' });
    const late = native();
    request.resolve(late.handle);
    await request.promise;
    await Promise.resolve();
    expect(late.handle.release).toHaveBeenCalledTimes(1);
    late.control.event();
    controller.abort();
    expect(late.handle.release).toHaveBeenCalledTimes(1);
    expect(loss).not.toHaveBeenCalled();
    expect(b.state).toBe('held');
    expect(m.active()).toBe(2);
  });

  it('permanently refuses pending requests across hide/show and pagehide/pageshow', async () => {
    for (const pagehide of [false, true]) {
      const m = setup();
      const request = deferred<ReturnType<typeof native>['handle']>();
      m.env.requestWakeLock = () => request.promise;
      const loss = vi.fn();
      const pending = m.acquire(loss);
      if (pagehide) m.win.dispatchEvent(new Event('pagehide'));
      else m.hidden(true);
      expect(await pending).toEqual({ kind: 'refused', reason: 'unavailable' });
      if (pagehide) m.win.dispatchEvent(new Event('pageshow'));
      else m.hidden(false);
      const late = native();
      request.resolve(late.handle);
      await request.promise;
      await Promise.resolve();
      expect(late.handle.release).toHaveBeenCalledTimes(1);
      expect(loss).not.toHaveBeenCalled();
      expect(m.platform.wakeLockHeld()).toBe(false);
    }
  });

  it('handles published loss before its consumer continuation and property before event once', async () => {
    const m = setup();
    const loss = vi.fn();
    const n = native();
    const request = deferred<typeof n.handle>();
    m.env.requestWakeLock = () => request.promise;
    const acquired = m.acquire(loss);
    request.resolve(n.handle);
    await request.promise; // PLATFORM has published; the result consumer has not resumed.
    n.control.value = true;
    n.control.event();
    const lease = await held(acquired);
    expect(lease.state).toBe('lost');
    expect(loss).toHaveBeenCalledExactlyOnceWith({ reason: 'native-release' });
    lease.release();
    n.control.event();
    expect(lease.state).toBe('lost');
    expect(loss).toHaveBeenCalledTimes(1);

    const other = setup();
    const otherLoss = vi.fn();
    const b = await held(other.acquire(otherLoss));
    other.handles[0]!.control.value = true;
    expect(b.state).toBe('lost');
    other.handles[0]!.control.event();
    expect(otherLoss).toHaveBeenCalledExactlyOnceWith({ reason: 'native-release' });
  });

  for (const diagnostic of [false, true]) {
    for (const unknown of [false, true]) {
      it(`contains ${unknown ? 'unknown' : 'throwing'} live observation via ${diagnostic ? 'diagnostic' : 'state'}`, async () => {
        const m = setup();
        const loss = vi.fn();
        const lease = await held(m.acquire(loss));
        const n = m.handles[0]!;
        n.control.release = () => new Promise(() => {});
        if (unknown) n.control.value = undefined;
        else
          n.control.read = () => {
            throw new Error('native read');
          };
        if (diagnostic) expect(m.platform.wakeLockHeld()).toBe(false);
        expect(lease.state).toBe('lost');
        expect(loss).toHaveBeenCalledExactlyOnceWith({ reason: 'observation-failed' });
        expect(n.handle.release).toHaveBeenCalledTimes(1);
        n.control.read = () => false;
        expect(m.platform.wakeLockHeld()).toBe(true); // unresolved native retirement survived
        n.control.event();
        expect(m.platform.wakeLockHeld()).toBe(false);
        expect(lease.state).toBe('lost');
        expect(loss).toHaveBeenCalledTimes(1);
      });
    }
  }

  it('uses minimal construction listeners and preserves ordinary return retry without guards', async () => {
    const m = setup();
    const styles = vi.spyOn(m.env, 'injectStyle');
    expect(m.env.requestWakeLock).not.toHaveBeenCalled();
    expect(styles).not.toHaveBeenCalled();
    const guard = new Event('contextmenu', { cancelable: true });
    m.doc.dispatchEvent(guard);
    expect(guard.defaultPrevented).toBe(false);
    m.win.dispatchEvent(new Event('pagehide'));
    expect(await m.acquire()).toEqual({ kind: 'refused', reason: 'unavailable' });
    m.win.dispatchEvent(new Event('pageshow'));
    const loss = vi.fn();
    const lease = await held(m.acquire(loss));
    m.platform.keepAwake(true);
    await Promise.resolve();
    await Promise.resolve();
    m.hidden(true);
    expect(lease.state).toBe('lost');
    m.hidden(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(lease.state).toBe('lost');
    expect(m.active()).toBe(1);
    expect(loss).toHaveBeenCalledExactlyOnceWith({ reason: 'visibility' });
  });

  it('does not report additional held state on an intermittently failed diagnostic read', async () => {
    const m = setup();
    const loss = vi.fn();
    const lease = await held(m.acquire(loss));
    const n = m.handles[0]!;
    let reads = 0;
    n.control.release = () => new Promise(() => {});
    n.control.read = () => {
      if (++reads === 1) throw new Error('first read failed');
      return false;
    };
    expect(m.platform.wakeLockHeld()).toBe(false);
    expect(lease.state).toBe('lost');
    expect(loss).toHaveBeenCalledExactlyOnceWith({ reason: 'observation-failed' });
    expect(m.platform.wakeLockHeld()).toBe(true); // a later call can observe unresolved retirement
  });

  it('detaches refused observation owners and retains unknown native cleanup until confirmed', async () => {
    for (const throwing of [false, true]) {
      const m = setup();
      const n = native();
      const controller = new AbortController();
      const removed = vi.spyOn(controller.signal, 'removeEventListener');
      const loss = vi.fn();
      n.control.value = undefined;
      n.control.release = () => new Promise(() => {});
      if (throwing)
        n.control.registration = () => {
          throw new Error('registration');
        };
      m.env.requestWakeLock = () => Promise.resolve(n.handle);
      expect(await m.acquire(loss, controller)).toEqual({
        kind: 'refused',
        reason: throwing ? 'observation-failed' : 'unobservable',
      });
      expect(removed).toHaveBeenCalledTimes(1);
      expect(n.handle.release).toHaveBeenCalledTimes(1);
      expect(m.platform.wakeLockHeld()).toBe(false);
      n.control.value = false;
      expect(m.platform.wakeLockHeld()).toBe(true);
      controller.abort();
      n.control.event();
      expect(loss).not.toHaveBeenCalled();
      expect(m.platform.wakeLockHeld()).toBe(false);
      expect(n.handle.release).toHaveBeenCalledTimes(1);
    }
  });

  it('settles cancellation that occurs synchronously inside the native requester', async () => {
    const m = setup();
    const controller = new AbortController();
    const n = native();
    m.env.requestWakeLock = () => {
      controller.abort();
      return Promise.resolve(n.handle);
    };
    const loss = vi.fn();
    expect(await m.acquire(loss, controller)).toEqual({ kind: 'refused', reason: 'cancelled' });
    expect(n.handle.release).toHaveBeenCalledTimes(1);
    expect(loss).not.toHaveBeenCalled();
  });

  it('refuses a throwing final qualification read and skips renewed qualification after terminal state', async () => {
    const m = setup();
    const n = native();
    let reads = 0;
    n.control.read = () => {
      if (++reads === 2) throw new Error('final read');
      return false;
    };
    m.env.requestWakeLock = () => Promise.resolve(n.handle);
    expect(await m.acquire()).toEqual({ kind: 'refused', reason: 'observation-failed' });
    expect(n.handle.release).toHaveBeenCalledTimes(1);
    const other = setup();
    const lease = await held(other.acquire());
    lease.release();
    other.handles[0]!.control.read = () => {
      throw new Error('terminal getter must not requalify');
    };
    expect(lease.state).toBe('released');
  });

  it('ends leases on existing fullscreen/rotate and overlapping pause boundaries', async () => {
    const m = setup();
    const log: string[] = [];
    m.platform.watchLifecycle({ onHidden: (r) => log.push(r), onShown: () => log.push('shown') });
    await m.platform.runStartTap(() => Promise.resolve());
    const loss = vi.fn();
    const lease = await held(m.acquire(loss));
    m.state.fullscreen = false;
    m.doc.dispatchEvent(new Event('fullscreenchange'));
    expect(lease.state).toBe('lost');
    expect(loss).toHaveBeenCalledExactlyOnceWith({ reason: 'fullscreen' });
    m.state.portrait = true;
    m.win.dispatchEvent(new Event('resize'));
    m.win.dispatchEvent(new Event('keydown')); // fullscreen clears, rotate remains
    expect(await m.acquire()).toEqual({ kind: 'refused', reason: 'unavailable' });
    expect(log).toEqual(['fullscreen']);
    m.state.portrait = false;
    m.win.dispatchEvent(new Event('resize'));
    const rotateLoss = vi.fn();
    const other = await held(m.acquire(rotateLoss));
    m.state.portrait = true;
    m.win.dispatchEvent(new Event('resize'));
    expect(other.state).toBe('lost');
    expect(rotateLoss).toHaveBeenCalledExactlyOnceWith({ reason: 'rotate' });
  });

  it('invalidates the whole batch before reentrant callbacks and contains callback errors', async () => {
    const m = setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const controller = new AbortController();
    const aLoss = vi.fn(() => {
      expect(b.state).toBe('lost');
      controller.abort();
      b.release();
      throw new Error('owner callback');
    });
    const a = await held(m.acquire(aLoss));
    const bLoss = vi.fn();
    const b = await held(m.acquire(bLoss, controller));
    const watcher = vi.fn();
    m.platform.watchLifecycle({ onHidden: watcher, onShown: () => {} });
    m.platform.keepAwake(true);
    await Promise.resolve();
    await Promise.resolve();
    m.win.dispatchEvent(new Event('pagehide'));
    expect(a.state).toBe('lost');
    expect(b.state).toBe('lost');
    expect(m.active()).toBe(0);
    expect(aLoss).toHaveBeenCalledTimes(1);
    expect(bLoss).toHaveBeenCalledExactlyOnceWith({ reason: 'pagehide' });
    expect(watcher).toHaveBeenCalledExactlyOnceWith('pagehide');
    expect(error).toHaveBeenCalledTimes(1);
    m.win.dispatchEvent(new Event('pagehide'));
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('removes each terminal abort listener and never retains an owner in late native callbacks', async () => {
    const m = setup();
    const aController = new AbortController();
    const bController = new AbortController();
    const aRemove = vi.spyOn(aController.signal, 'removeEventListener');
    const bRemove = vi.spyOn(bController.signal, 'removeEventListener');
    const aLoss = vi.fn();
    const bLoss = vi.fn();
    const a = await held(m.acquire(aLoss, aController));
    const b = await held(m.acquire(bLoss, bController));
    a.release();
    expect(aRemove).toHaveBeenCalledTimes(1);
    expect(bRemove).not.toHaveBeenCalled();
    expect(b.state).toBe('held');
    m.hidden(true);
    expect(bRemove).toHaveBeenCalledTimes(1);
    aController.abort();
    bController.abort();
    for (const n of m.handles) n.control.event();
    expect(aLoss).not.toHaveBeenCalled();
    expect(bLoss).toHaveBeenCalledTimes(1);
  });

  for (const outcome of ['throw', 'reject', 'hang'] as const) {
    it(`contains native release ${outcome} and retains truthful retirement without retry`, async () => {
      const m = setup();
      const controller = new AbortController();
      const loss = vi.fn();
      const lease = await held(m.acquire(loss, controller));
      const n = m.handles[0]!;
      n.control.release = () => {
        if (outcome === 'throw') throw new Error('release');
        if (outcome === 'reject') return Promise.reject(new Error('release'));
        return new Promise(() => {});
      };
      controller.abort();
      expect(lease.state).toBe('released');
      await Promise.resolve();
      expect(m.platform.wakeLockHeld()).toBe(true);
      n.control.value = undefined;
      expect(m.platform.wakeLockHeld()).toBe(false);
      n.control.value = false;
      expect(m.platform.wakeLockHeld()).toBe(true);
      lease.release();
      controller.abort();
      expect(n.handle.release).toHaveBeenCalledTimes(1);
      expect(loss).not.toHaveBeenCalled();
      n.control.value = true;
      expect(m.platform.wakeLockHeld()).toBe(false);
      n.control.value = false;
      expect(m.platform.wakeLockHeld()).toBe(false); // positive retirement is final
    });
  }

  it('adapts the native live released getter and installs a once release observer', async () => {
    const sentinel = Object.assign(new EventTarget(), {
      released: false,
      release: vi.fn(() => Promise.resolve()),
    });
    const listener = vi.spyOn(sentinel, 'addEventListener');
    const request = wakeLockRequester({ wakeLock: { request: () => Promise.resolve(sentinel) } })!;
    const handle = await request();
    expect(handle.released).toBe(false);
    sentinel.released = true;
    expect(handle.released).toBe(true);
    const loss = vi.fn();
    handle.onRelease(loss);
    expect(listener).toHaveBeenCalledWith('release', expect.any(Function), { once: true });
    sentinel.dispatchEvent(new Event('release'));
    sentinel.dispatchEvent(new Event('release'));
    expect(loss).toHaveBeenCalledTimes(1);
  });
});
