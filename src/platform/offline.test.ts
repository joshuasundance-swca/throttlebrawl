import { describe, expect, it } from 'vitest';
import { createInstallOffer, registerOfflineWorker, SERVICE_WORKER_FILE } from './index';

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
