import { describe, expect, it } from 'vitest';
import {
  createInstallOffer,
  registerOfflineWorker,
  SERVICE_WORKER_FILE,
  watchFetches,
  watchInstall,
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

describe('the watch on the worker install', () => {
  // Playtest 4 run A fix check, new mustFix 2b: an install a deploy failed left the first visit with
  // no worker, and nothing told the page. `register` resolves before the install runs, so the page
  // watches the installing worker turn redundant.
  /** A worker that moves through the given states. */
  function worker() {
    const w = Object.assign(new EventTarget(), { state: 'installing' });
    return {
      w,
      go: (...states: string[]) => {
        for (const s of states) {
          w.state = s;
          w.dispatchEvent(new Event('statechange'));
        }
      },
    };
  }

  it('reports an install that turns redundant before it installed, once per worker', () => {
    const first = worker();
    const reg = Object.assign(new EventTarget(), { installing: first.w });
    let failed = 0;
    watchInstall(reg, () => failed++);
    first.go('redundant');
    expect(failed).toBe(1);
    // A later install (the browser's own retry) is watched too, and tracked once however announced.
    const second = worker();
    reg.installing = second.w;
    reg.dispatchEvent(new Event('updatefound'));
    reg.dispatchEvent(new Event('updatefound'));
    second.go('redundant');
    expect(failed).toBe(2);
  });

  it('says nothing of an install that worked, even once a newer worker replaces it', () => {
    const ok = worker();
    let failed = 0;
    watchInstall(Object.assign(new EventTarget(), { installing: ok.w }), () => failed++);
    ok.go('installed', 'activating', 'activated', 'redundant');
    expect(failed).toBe(0);
  });

  it('is handed the registration by the page, and only when there is one', async () => {
    const w = worker();
    const reg = Object.assign(new EventTarget(), { installing: w.w });
    let failed = 0;
    const nav = { serviceWorker: { register: () => Promise.resolve(reg) } };
    await expect(registerOfflineWorker(nav, new EventTarget(), true, () => failed++)).resolves.toBe(true);
    w.go('redundant');
    expect(failed).toBe(1);
    // A browser that hands back something else (or a test stand-in) is not watched, and nothing throws.
    const plain = { serviceWorker: { register: () => Promise.resolve({}) } };
    await expect(registerOfflineWorker(plain, new EventTarget(), true, () => failed++)).resolves.toBe(true);
  });
});

describe("the watch on the page's fetches", () => {
  // Playtest 4 run A fix check, new mustFix 2a: San Francisco's map files are plain fetches, so a 404
  // from them fired nothing (#584 heard only lazy chunks). Every fetch's answer is now reported.
  it('reports each answer with its absolute address and passes it on untouched', async () => {
    const answers: Response[] = [];
    const win = {
      fetch: ((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const res = new Response('x', { status: url.includes('gone') ? 404 : 200 });
        answers.push(res);
        return Promise.resolve(res);
      }) as typeof fetch,
    };
    const seen: string[] = [];
    const inner = watchFetches(win, 'https://game.example/sub/index.html', (url, status) =>
      seen.push(`${status} ${url}`),
    );
    const a = await win.fetch('assets/osm-sf-gone-C3.json');
    const b = await win.fetch(new URL('https://game.example/sub/assets/rider-K9.glb'));
    const c = await win.fetch(new Request('https://game.example/sub/assets/kit-gone-Q1.js'));
    expect([a, b, c]).toEqual(answers);
    expect(a).toBe(answers[0]);
    expect(seen).toEqual([
      '404 https://game.example/sub/assets/osm-sf-gone-C3.json',
      '200 https://game.example/sub/assets/rider-K9.glb',
      '404 https://game.example/sub/assets/kit-gone-Q1.js',
    ]);
    // The unwrapped fetch (the stale-build question to the host) reports nothing.
    await inner('assets/gone.json');
    expect(seen).toHaveLength(3);
  });

  it('reports nothing for a request that fails (offline), and still fails it', async () => {
    const win = { fetch: (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch };
    const seen: string[] = [];
    watchFetches(win, 'https://game.example/sub/', (url) => seen.push(url));
    await expect(win.fetch('assets/a.json')).rejects.toThrow(/Failed to fetch/);
    expect(seen).toEqual([]);
  });
});
