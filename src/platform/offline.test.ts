import { describe, expect, it } from 'vitest';
import {
  createInstallOffer,
  registerOfflineWorker,
  reloadOnStaleChunk,
  SERVICE_WORKER_FILE,
  STALE_CHUNK_KEY,
} from './index';

// Installing as an app and the offline worker's registration (roadmap M5, launch polish; the
// maintainer: "Offline definitely preferable"). The install offer never nags: the browser's own
// automatic banner is held back, and its prompt opens only from the player's tap on the menu's
// Install button, which shows only while the browser offers an install. The worker is registered
// after the page has loaded, so its download never competes with the first screen.

/** A `beforeinstallprompt` event as Chrome fires it, recording what the page did with it. */
function installEvent(outcome: 'accepted' | 'dismissed') {
  const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: string }>;
    prompted: number;
  };
  e.prompted = 0;
  e.prompt = () => {
    e.prompted++;
    return Promise.resolve();
  };
  e.userChoice = Promise.resolve({ outcome });
  return e;
}

describe('the install offer', () => {
  it('is not offered until the browser offers an install, and never prompts by itself', () => {
    const win = new EventTarget();
    const offer = createInstallOffer(win);
    expect(offer.available()).toBe(false);
    const e = installEvent('accepted');
    win.dispatchEvent(e);
    // The browser's own banner is held back (it would cover the game); the menu offers it instead.
    expect(e.defaultPrevented).toBe(true);
    expect(offer.available()).toBe(true);
    expect(e.prompted).toBe(0);
  });

  it("opens the browser's prompt once from a tap, inside the tap, then stops offering it", async () => {
    const win = new EventTarget();
    const offer = createInstallOffer(win);
    const seen: boolean[] = [];
    offer.onChange(() => seen.push(offer.available()));
    const e = installEvent('dismissed');
    win.dispatchEvent(e);
    const answer = offer.prompt();
    // Synchronous: the prompt needs the tap's user activation, which an await would lose.
    expect(e.prompted).toBe(1);
    expect(offer.available()).toBe(false);
    expect(await answer).toBe('dismissed');
    expect(seen).toEqual([true, false]);
    // A second tap with nothing offered does nothing.
    expect(await offer.prompt()).toBe('unavailable');
    expect(e.prompted).toBe(1);
  });

  it('stops offering once the game is installed', () => {
    const win = new EventTarget();
    const offer = createInstallOffer(win);
    win.dispatchEvent(installEvent('accepted'));
    win.dispatchEvent(new Event('appinstalled'));
    expect(offer.available()).toBe(false);
  });
});

describe('the offline worker registration', () => {
  type Registered = { url: string; scope: string | undefined };
  const navWith = (registered: Registered[], fail = false) => ({
    serviceWorker: {
      register: (url: string, opts?: { scope?: string }) => {
        registered.push({ url, scope: opts?.scope });
        return fail ? Promise.reject(new Error('blocked')) : Promise.resolve({});
      },
    },
  });

  it('registers the worker beside the page, scoped to its folder, once the page has loaded', () => {
    const registered: Registered[] = [];
    const win = new EventTarget();
    void registerOfflineWorker(navWith(registered), win, false);
    expect(registered).toEqual([]);
    win.dispatchEvent(new Event('load'));
    win.dispatchEvent(new Event('load'));
    expect(registered).toEqual([{ url: `./${SERVICE_WORKER_FILE}`, scope: './' }]);
  });

  it('registers at once on a page that has already loaded', () => {
    const registered: Registered[] = [];
    void registerOfflineWorker(navWith(registered), new EventTarget(), true);
    expect(registered).toHaveLength(1);
  });

  it('does nothing where there are no service workers, and swallows a refused registration', async () => {
    expect(() => registerOfflineWorker({}, new EventTarget(), true)).not.toThrow();
    const registered: Registered[] = [];
    const done = registerOfflineWorker(navWith(registered, true), new EventTarget(), true);
    await expect(done).resolves.toBe(false);
  });
});

describe('a lazy chunk that will not load', () => {
  // Playtest 4 run A's live check, mustFix 2: once a deploy has replaced the build, the open tab's
  // lazy chunks (the landmarks) answer 404, so the import fails. The page reloads to the build the
  // host serves now, once per build, so a chunk that keeps failing never loops.
  function page(opts: { online?: boolean; storage?: 'ok' | 'none' | 'throws' } = {}) {
    const win = new EventTarget();
    const store = new Map<string, string>();
    const throwing = {
      getItem: (): string | null => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
    };
    const working = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const storage = opts.storage === 'none' ? null : opts.storage === 'throws' ? throwing : working;
    let reloads = 0;
    return {
      store,
      // What Vite's import helper fires when a lazy chunk's import fails.
      fail: () => win.dispatchEvent(new Event('vite:preloadError', { cancelable: true })),
      reloads: () => reloads,
      env: { win, online: () => opts.online ?? true, storage, reload: () => void reloads++ },
    };
  }

  it('reloads once to the current build, and never again from the same build', () => {
    const p = page();
    reloadOnStaleChunk(p.env, 'ed1d8b0');
    expect(p.reloads()).toBe(0);
    p.fail();
    expect(p.reloads()).toBe(1);
    expect(p.store.get(STALE_CHUNK_KEY)).toBe('ed1d8b0');

    // The reload landed on the same build (the host had not changed after all): no second reload.
    const again = page();
    again.store.set(STALE_CHUNK_KEY, 'ed1d8b0');
    reloadOnStaleChunk(again.env, 'ed1d8b0');
    again.fail();
    again.fail();
    expect(again.reloads()).toBe(0);

    // The reload landed on the newer build: a later failure there may reload once more.
    const newer = page();
    newer.store.set(STALE_CHUNK_KEY, 'ed1d8b0');
    reloadOnStaleChunk(newer.env, '3f6a825');
    newer.fail();
    expect(newer.reloads()).toBe(1);
  });

  it('does not reload with the network off, or where it cannot remember it did', () => {
    for (const p of [page({ online: false }), page({ storage: 'none' }), page({ storage: 'throws' })]) {
      reloadOnStaleChunk(p.env, 'ed1d8b0');
      p.fail();
      expect(p.reloads()).toBe(0);
    }
  });
});
