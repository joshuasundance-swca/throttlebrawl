// A tab left on a build the host no longer serves (docs/engineering.md, "Deploy: game Space and
// staging Space", Offline). Each deploy replaces every file on the game's host and renames every
// content-hashed file (the build id lives in the entry chunk), so an open tab of the older build
// meets 404s for whatever it fetches next: map and pack data, models, kits and lazy chunks alike;
// and a worker installing while the deploy lands fails its all-or-nothing install, which leaves a
// first visit with no worker and no cache (playtest 4 run A fix batch's live check, new mustFix 2:
// San Francisco's 4 map files answered 404 and nothing reloaded; offline, the tab lost its
// landmarks, road chunks, kits and models, and an offline relaunch failed).
//
// The page then asks the host which build it serves now (the worker file names it in its cache
// name, scripts/service-worker.mjs) and, when that is another build, reloads to it once:
// - at once when a reload loses nothing (the menus); mid-race never, and not while a result is on
//   screen (punch item 1: the reload threw the player off a race to the start screen). The race
//   finishes on what it has loaded: its road data is in before it starts, and models, kits and
//   landmarks fall back to stand-ins. app/ calls `settle` after each change of screen, so the
//   reload happens on the way back to the menu, and offers it on the result screen meanwhile;
// - once per build (session storage), so a page that comes back on the same build never loops;
// - never with the network off, and never where it cannot remember that it did.
// The reloaded page is the new build, so its worker installs that build whole.
//
// Like offline-worker.ts it imports nothing: the page and the worker must share no chunk.

/** The session key that remembers a reload: the build the page reloaded from (#584's key). */
export const STALE_BUILD_KEY = 'throttlebrawl:stale-chunk-reload';
/** offline-worker.ts's CACHE_PREFIX (a unit test holds them equal; importing it would share a chunk). */
export const WORKER_CACHE_PREFIX = 'offline-';
/** The worker file beside the page; platform/index.ts's SERVICE_WORKER_FILE. */
const WORKER_FILE = 'sw.js';
/** The content-hashed files of a build: every name changes at a deploy. */
const BUILD_DIR = 'assets/';
/** The answers that mean the host has no such file. */
const GONE = new Set([404, 410]);

/** What the recovery needs from the page; the real one or a test's stand-in. */
export interface StaleBuildPage {
  /** Receives Vite's `vite:preloadError`, fired when a lazy chunk's import fails. */
  win: EventTarget;
  /** The page's folder, which its build's files sit under, ending in `/`. */
  scope: string;
  online(): boolean;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  reload(): void;
  /** The network (the question to the host goes past any HTTP cache). */
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /** Whether a reload loses nothing now: false mid-race and while a result is on screen (app/). */
  canReload(): boolean;
}

export interface StaleBuild {
  /** A fetch's answer: a build file the host no longer has (404 or 410) is a sign of a deploy. */
  answered(url: string, status: number): void;
  /** The offline worker's install failed (a sign of a deploy while it ran). */
  installFailed(): void;
  /** A reload that waited happens now if it may (app/ calls this after every change of screen). */
  settle(): void;
  /** True while the host serves another build and the reload waits for the race or its result. */
  waiting(): boolean;
  /** Reloads at once (the player's tap on the offer); false when it cannot. */
  reloadNow(): boolean;
  /** Called once when a reload starts waiting, so app/ can say so on the result screen. */
  onWaiting(cb: () => void): void;
  /** Resolves once every sign so far has been checked (for tests; nothing waits on the clock). */
  idle(): Promise<void>;
}

/** The build a worker file caches, from its config's cache name; null for anything else. */
export function hostBuildOf(worker: string): string | null {
  const prefix = WORKER_CACHE_PREFIX.replace(/[-]/g, '\\-');
  return new RegExp(`"cache":"${prefix}([^"]+)-[0-9a-f]{12}"`).exec(worker)?.[1] ?? null;
}

export function recoverStaleBuild(page: StaleBuildPage, buildId: string): StaleBuild {
  /** The host serves another build (found once, it stays found). */
  let stale = false;
  let reloaded = false;
  let probe: Promise<void> | null = null;
  let checks: Promise<void> = Promise.resolve();
  const waiters: (() => void)[] = [];
  let told = false;

  /** Whether this page reloaded from its build already (or cannot remember: then never). */
  const spent = (): boolean => {
    if (reloaded || !page.storage) return true;
    try {
      return page.storage.getItem(STALE_BUILD_KEY) === buildId;
    } catch {
      return true;
    }
  };

  const reload = (): boolean => {
    if (!stale || spent() || !page.online()) return false;
    try {
      page.storage?.setItem(STALE_BUILD_KEY, buildId);
    } catch {
      return false;
    }
    reloaded = true;
    page.reload();
    return true;
  };

  const settle = () => {
    if (stale && page.canReload()) reload();
  };

  /** Asks the host for its worker file; a build other than this page's means a deploy landed. */
  const ask = async () => {
    const res = await page.fetch(new URL(WORKER_FILE, page.scope).href, { cache: 'no-store' });
    const host = res.ok ? hostBuildOf(await res.text()) : null;
    if (host === null || host === buildId) return;
    stale = true;
    settle();
    if (!reloaded && !told) {
      told = true;
      for (const cb of waiters) cb();
    }
  };

  /** A sign: check it unless the answer is already known, used, or the network is off. */
  const suspect = () => {
    if (stale) return settle();
    if (probe || spent() || !page.online()) return;
    const asking = ask()
      .catch(() => undefined) // unreachable host: no reload; the next sign asks again
      .finally(() => {
        probe = null;
      });
    probe = asking;
    checks = checks.then(() => asking);
  };

  page.win.addEventListener('vite:preloadError', suspect);
  const buildDir = new URL(BUILD_DIR, page.scope).href;

  return {
    answered(url, status) {
      if (GONE.has(status) && url.startsWith(buildDir)) suspect();
    },
    installFailed: suspect,
    settle,
    waiting: () => stale && !reloaded && !spent(),
    reloadNow: reload,
    onWaiting: (cb) => void waiters.push(cb),
    async idle() {
      let seen: Promise<void> | null = null;
      while (seen !== checks) {
        seen = checks;
        await seen;
      }
    },
  };
}
