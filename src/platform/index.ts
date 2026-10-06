// platform: the start-tap sequence, the rotate-your-phone trigger, every lifecycle listener, the
// page guards, the screen wake lock, the offline worker's registration, the install offer and the
// app-id constant (docs/architecture.md, "Input" and
// "Fixed timestep and the loop"; docs/milestones/M1.md, platform-1; docs/milestones/M2.md,
// platform-2). platform/ may import only core/, so audio arrives as
// the injected `resumeAudio` callback. The browser APIs sit behind `PlatformEnv`, so the unit
// tests drive the same code with mocks.
import type { ResumeAudio } from '../core';
import { retryingFetch } from './retry-fetch';
import { recoverStaleBuild, type StaleBuild } from './stale-build';

/**
 * The one place the app id appears. Storage keys, export prefixes and format strings derive from
 * it or are name-neutral, because the game's name is a codename (a rename is this line plus a
 * one-time storage-key migration).
 */
export const APP_ID = 'mbrawl';

/** The browser surface platform/ touches. `browserEnv()` is the real one; tests pass mocks. */
export interface PlatformEnv {
  /** Fires visibilitychange, fullscreenchange, contextmenu, selectstart and gesturestart. */
  doc: EventTarget;
  /** Fires pagehide, pageshow, resize, orientationchange, pointerdown and keydown. */
  win: EventTarget;
  /** Fullscreen with the browser's navigation UI hidden; null where the browser has none. */
  requestFullscreen: (() => Promise<void>) | null;
  isFullscreen(): boolean;
  /** Locks the screen to landscape; null where the browser has no lock. */
  lockLandscape: (() => Promise<void>) | null;
  /** The tilt permission prompt, where the browser has one (iOS); null elsewhere. */
  requestTiltPermission: (() => Promise<string>) | null;
  /** The Screen Wake Lock (`navigator.wakeLock.request('screen')`); null where there is none. */
  requestWakeLock: (() => Promise<WakeLockHandle>) | null;
  isPortrait(): boolean;
  /** A phone or tablet: the only devices the rotate screen is for. */
  isTouchDevice(): boolean;
  isHidden(): boolean;
  /** Shows or hides the rotate-your-phone screen. */
  showRotate(need: boolean): void;
  /** Adds a style sheet; returns a function that removes it. */
  injectStyle(css: string): () => void;
}

/** A held screen wake lock: the browser's `WakeLockSentinel`, reduced to what platform/ uses. */
export interface WakeLockHandle {
  release(): Promise<void>;
  /** Called once when the lock ends, whether released by us or dropped by the browser. */
  onRelease(cb: () => void): void;
}

export interface StartTapResult {
  fullscreen: boolean;
  orientationLocked: boolean;
  /** The tilt permission answer, or 'not-needed' where the browser asks for none. */
  tilt: string;
  audio: boolean;
}

/** Why the game paused. The race resumes only once every reason has cleared. */
export type PauseReason = 'visibility' | 'pagehide' | 'fullscreen' | 'rotate';

export interface LifecycleCallbacks {
  onHidden: (reason: PauseReason) => void;
  onShown: () => void;
}

export interface Platform {
  runStartTap(resumeAudio: ResumeAudio): Promise<StartTapResult>;
  watchLifecycle(cb: LifecycleCallbacks): () => void;
  rotateNeeded(): boolean;
  /**
   * Whether a race wants the screen kept on. The lock is held only while this is on, the page is
   * visible and no pause reason stands; it is re-requested when those hold again (the browser
   * drops it whenever the page hides). app/ turns it on when a race runs and off on pause and in
   * menus, so a pad-only or tilt-only ride with no touches does not let the screen time out.
   */
  keepAwake(on: boolean): void;
  /** Whether a wake lock is held right now (for the debug report and the M5 soak). */
  wakeLockHeld(): boolean;
}

/** How long the tap's result waits for a lock that never settles (some browsers hold it). */
const LOCK_WAIT_MS = 3000;

/** Runs a call that may be missing, throw synchronously or reject; never throws itself. */
function attempt<T>(fn: (() => Promise<T>) | null): Promise<{ ok: true; value: T } | { ok: false }> {
  if (!fn) return Promise.resolve({ ok: false });
  try {
    return fn().then(
      (value) => ({ ok: true as const, value }),
      () => ({ ok: false as const }),
    );
  } catch {
    return Promise.resolve({ ok: false });
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    void p.then((v) => {
      clearTimeout(timer);
      resolve(v);
    });
  });
}

/**
 * The guards against the phone's own gestures: no pull-to-refresh, no long-press menu or callout,
 * no text selection, no pinch on iOS, and the safe-area insets as CSS variables for the HUD.
 */
export const GUARD_CSS = `html, body {
  overscroll-behavior: none;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}
:root {
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
}`;

export function createPlatform(env: PlatformEnv): Platform {
  // Pause reasons; onHidden fires when the first one arrives, onShown when the last one clears.
  const reasons = new Set<PauseReason>();
  const watchers = new Set<LifecycleCallbacks>();
  let armed = false; // the rotate screen only after the start tap
  let rotate = false;
  let wasFullscreen = env.isFullscreen();
  let keeperInstalled = false;

  // The screen wake lock: wanted by a running race, held only while nothing pauses the game.
  let wantAwake = false;
  let sentinel: WakeLockHandle | null = null;
  let requesting = false;
  let wakeWatchInstalled = false;
  const shouldHold = () => wantAwake && reasons.size === 0 && !env.isHidden();
  const syncWake = () => {
    if (!shouldHold()) {
      if (sentinel) {
        const s = sentinel;
        sentinel = null;
        void attempt(() => s.release());
      }
      return;
    }
    if (sentinel || requesting || !env.requestWakeLock) return;
    requesting = true;
    void attempt(env.requestWakeLock).then((r) => {
      requesting = false;
      if (!r.ok) return; // refused (hidden, battery saver): the next return to the page retries
      const s = r.value;
      s.onRelease(() => {
        if (sentinel === s) sentinel = null;
      });
      // The race may have stopped wanting it while the request was in flight.
      if (!shouldHold()) void attempt(() => s.release());
      else sentinel = s;
    });
  };

  const pause = (reason: PauseReason) => {
    if (reasons.has(reason)) return;
    const first = reasons.size === 0;
    reasons.add(reason);
    if (first) for (const w of watchers) w.onHidden(reason);
    syncWake();
  };
  const clear = (reason: PauseReason) => {
    if (!reasons.delete(reason) || reasons.size > 0) return;
    for (const w of watchers) w.onShown();
    syncWake();
  };

  const lock = () => attempt(env.lockLandscape).then((r) => r.ok);

  const updateRotate = () => {
    const need = armed && env.isTouchDevice() && env.isPortrait();
    if (need === rotate) return;
    rotate = need;
    env.showRotate(need);
    if (need) pause('rotate');
    else clear('rotate');
  };

  // Installed by the first start tap: re-lock on every fullscreen change (the lock is released
  // when fullscreen ends), track a lost fullscreen as a pause, and watch the viewport's shape.
  const onFullscreenChange = () => {
    const now = env.isFullscreen();
    if (now) {
      void lock();
      clear('fullscreen');
    } else if (wasFullscreen && watchers.size > 0) {
      pause('fullscreen');
    }
    wasFullscreen = now;
    updateRotate();
  };
  const installKeeper = () => {
    if (keeperInstalled) return;
    keeperInstalled = true;
    env.doc.addEventListener('fullscreenchange', onFullscreenChange);
    env.win.addEventListener('resize', updateRotate);
    env.win.addEventListener('orientationchange', updateRotate);
  };

  const platform: Platform = {
    async runStartTap(resumeAudio) {
      installKeeper();
      // Every call starts synchronously, in order, before the first await, so each one sees the
      // tap's user activation. The first lock usually fails (no fullscreen yet); the
      // fullscreenchange listener re-locks as soon as fullscreen arrives.
      const fullscreen = attempt(env.requestFullscreen);
      const firstLock = lock();
      const tilt = env.requestTiltPermission
        ? attempt(env.requestTiltPermission).then((r) => (r.ok ? r.value : 'denied'))
        : Promise.resolve('not-needed');
      const audio = attempt(resumeAudio);
      armed = true;

      const fs = (await fullscreen).ok;
      let locked = await withTimeout(firstLock, LOCK_WAIT_MS, false);
      if (!locked && fs) locked = await withTimeout(lock(), LOCK_WAIT_MS, false);
      updateRotate();
      return { fullscreen: fs, orientationLocked: locked, tilt: await tilt, audio: (await audio).ok };
    },

    watchLifecycle(cb) {
      watchers.add(cb);
      installKeeper();
      if (env.isHidden()) reasons.add('visibility');
      const onVisibility = () => (env.isHidden() ? pause('visibility') : clear('visibility'));
      const onPageHide = () => pause('pagehide');
      const onPageShow = () => clear('pagehide');
      // A lost fullscreen (the Android back gesture, Esc) clears on the next tap or key press.
      // A touch re-enters fullscreen with that tap's activation; a keyboard player keeps the window.
      const onGesture = (e: Event) => {
        if (!reasons.has('fullscreen')) return;
        if ((e as Partial<PointerEvent>).pointerType === 'touch') void attempt(env.requestFullscreen);
        clear('fullscreen');
      };
      const block = (e: Event) => e.preventDefault();
      const removeStyle = env.injectStyle(GUARD_CSS);
      env.doc.addEventListener('visibilitychange', onVisibility);
      env.win.addEventListener('pagehide', onPageHide);
      env.win.addEventListener('pageshow', onPageShow);
      env.win.addEventListener('pointerdown', onGesture, { capture: true });
      env.win.addEventListener('keydown', onGesture, { capture: true });
      for (const type of ['contextmenu', 'selectstart', 'gesturestart'])
        env.doc.addEventListener(type, block);
      return () => {
        watchers.delete(cb);
        removeStyle();
        env.doc.removeEventListener('visibilitychange', onVisibility);
        env.win.removeEventListener('pagehide', onPageHide);
        env.win.removeEventListener('pageshow', onPageShow);
        env.win.removeEventListener('pointerdown', onGesture, { capture: true });
        env.win.removeEventListener('keydown', onGesture, { capture: true });
        for (const type of ['contextmenu', 'selectstart', 'gesturestart'])
          env.doc.removeEventListener(type, block);
      };
    },

    rotateNeeded: () => rotate,

    keepAwake(on) {
      if (!wakeWatchInstalled) {
        // The lock is re-requested on every return to the page, lifecycle watcher or not.
        wakeWatchInstalled = true;
        env.doc.addEventListener('visibilitychange', syncWake);
      }
      wantAwake = on;
      syncWake();
    },

    wakeLockHeld: () => sentinel !== null,
  };
  return platform;
}

/** The plain rotate screen. ui/ may restyle `#rotate-screen`; platform/ only toggles it. */
function showRotateScreen(need: boolean): void {
  let el = document.getElementById('rotate-screen');
  if (!el && need) {
    el = document.createElement('div');
    el.id = 'rotate-screen';
    el.setAttribute('role', 'alert');
    el.textContent = 'Turn your phone sideways to ride.';
    Object.assign(el.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '1000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      background: '#291450',
      color: '#fff',
      font: '600 22px/1.3 system-ui, sans-serif',
      textAlign: 'center',
    });
    document.body.append(el);
  }
  if (el) {
    // The inline display would override the hidden attribute's own display: none.
    el.hidden = !need;
    el.style.display = need ? 'flex' : 'none';
  }
  document.documentElement.dataset['rotate'] = need ? 'needed' : 'ok';
}

/** The part of `navigator` the wake lock needs; the real one or a test's stand-in. */
interface WakeLockNavigator {
  wakeLock?: {
    request(type: 'screen'): Promise<EventTarget & { release(): Promise<void> }>;
  };
}

/**
 * Adapts `navigator.wakeLock` (Chrome 84 and later on desktop and Android) to `WakeLockHandle`;
 * null where the browser has none.
 */
export function wakeLockRequester(
  nav: WakeLockNavigator | undefined,
): (() => Promise<WakeLockHandle>) | null {
  const api = nav?.wakeLock;
  if (!api || typeof api.request !== 'function') return null;
  return () =>
    api.request('screen').then((s) => ({
      release: () => s.release(),
      onRelease: (cb) => s.addEventListener('release', () => cb(), { once: true }),
    }));
}

/** The real browser, read lazily so importing platform/ has no side effects. */
export function browserEnv(): PlatformEnv {
  const media = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;
  const orientation = (typeof screen !== 'undefined' ? screen.orientation : undefined) as
    { lock?: (o: string) => Promise<void> } | undefined;
  const tilt = (typeof DeviceOrientationEvent !== 'undefined'
    ? DeviceOrientationEvent
    : undefined) as unknown as { requestPermission?: () => Promise<string> } | undefined;
  const lock = orientation?.lock?.bind(orientation);
  const askTilt = tilt?.requestPermission?.bind(tilt);
  const root = document.documentElement;
  return {
    doc: document,
    win: window,
    requestFullscreen:
      typeof root.requestFullscreen === 'function'
        ? () => root.requestFullscreen({ navigationUI: 'hide' })
        : null,
    isFullscreen: () => document.fullscreenElement != null,
    lockLandscape: lock ? () => lock('landscape') : null,
    requestTiltPermission: askTilt ? () => askTilt() : null,
    requestWakeLock: wakeLockRequester(typeof navigator !== 'undefined' ? navigator : undefined),
    isPortrait: () => media('(orientation: portrait)'),
    isTouchDevice: () => media('(pointer: coarse)'),
    isHidden: () => document.visibilityState === 'hidden',
    showRotate: showRotateScreen,
    injectStyle(css) {
      const el = document.createElement('style');
      el.dataset['platform'] = 'guards';
      el.textContent = css;
      document.head.append(el);
      return () => el.remove();
    },
  };
}

let shared: Platform | null = null;
/** The page's one platform instance, so the start tap and the lifecycle share their state. */
function page(): Platform {
  shared ??= createPlatform(browserEnv());
  return shared;
}

/**
 * The start-tap sequence, in order, inside one user activation: fullscreen (navigation UI
 * hidden), the landscape lock (re-applied on every fullscreen change), the tilt permission where
 * the browser asks for one (for M2), then audio. Any single step may fail without stopping the
 * rest. After the tap, a portrait phone shows the rotate screen and pauses until turned.
 */
export function runStartTap(resumeAudio: ResumeAudio): Promise<StartTapResult> {
  return page().runStartTap(resumeAudio);
}

/**
 * Every page-level listener lives here: visibilitychange, pagehide and pageshow, a lost
 * fullscreen and the rotate screen, so a hidden page pauses exactly once. It also installs the
 * page guards (no pull-to-refresh, long-press menu or text selection; safe-area variables).
 * Returns a function that removes all of it.
 */
export function watchLifecycle(cb: LifecycleCallbacks): () => void {
  return page().watchLifecycle(cb);
}

/**
 * Keeps the screen on while a race runs (the Screen Wake Lock): on when the race starts or
 * resumes, off on pause and in menus. Re-requested whenever the page comes back while still on;
 * a browser without the API simply never holds it.
 */
export function keepAwake(on: boolean): void {
  page().keepAwake(on);
}

/** Whether the screen wake lock is held right now. */
export function wakeLockHeld(): boolean {
  return page().wakeLockHeld();
}

// ---- Offline play and installing as an app (roadmap M5, launch polish) ----------------------
// The maintainer: "Offline definitely preferable". The worker (sw.ts, its policy offline-worker.ts)
// caches the whole build once the page has loaded, so a loaded game plays with the network off;
// public/manifest.webmanifest makes the game installable. docs/engineering.md, "Deploy", Offline.

/** The worker's file, beside index.html (scripts/service-worker.mjs writes it). */
export const SERVICE_WORKER_FILE = 'sw.js';

/** A service worker, reduced to what the install watch reads. */
interface WorkerLike extends EventTarget {
  readonly state: string;
}
/** A service worker registration, reduced to what the install watch reads. */
interface RegistrationLike extends EventTarget {
  readonly installing: WorkerLike | null;
}

/** The part of `navigator` the registration needs; the real one or a test's stand-in. */
interface WorkerNavigator {
  serviceWorker?: { register(url: string, opts?: { scope?: string }): Promise<unknown> };
}

/**
 * Calls `onFailed` once for each worker of this registration whose install fails (it turns
 * redundant before it ever installed); a worker that installed and was later replaced is not a
 * failure. The browser gives no other sign: `register` resolves before the install has run.
 */
export function watchInstall(reg: RegistrationLike, onFailed: () => void): void {
  const seen = new WeakSet<WorkerLike>();
  const track = (w: WorkerLike | null) => {
    if (!w || seen.has(w)) return;
    seen.add(w);
    let installed = false;
    w.addEventListener('statechange', () => {
      if (w.state === 'installed' || w.state === 'activating' || w.state === 'activated') installed = true;
      else if (w.state === 'redundant' && !installed) onFailed();
    });
  };
  track(reg.installing);
  reg.addEventListener('updatefound', () => track(reg.installing));
}

/**
 * Registers the offline worker, scoped to the page's folder, once the page has loaded (`loaded`
 * says it already has), so its downloads never compete with the first screen. Resolves true once
 * registered; false where there are no service workers or the browser refused (a test browser that
 * blocks them, a private window). Never throws and logs nothing: the game plays the same online.
 * `onInstallFailed` hears of each install that fails (a deploy landing while it ran).
 */
export function registerOfflineWorker(
  nav: WorkerNavigator,
  win: EventTarget,
  loaded: boolean,
  onInstallFailed?: () => void,
): Promise<boolean> {
  const sw = nav.serviceWorker;
  if (!sw || typeof sw.register !== 'function') return Promise.resolve(false);
  const register = () =>
    sw.register(`./${SERVICE_WORKER_FILE}`, { scope: './' }).then(
      (reg) => {
        if (onInstallFailed && reg instanceof EventTarget && 'installing' in reg)
          watchInstall(reg as RegistrationLike, onInstallFailed);
        return true;
      },
      () => false,
    );
  if (loaded) return register();
  return new Promise((resolve) => win.addEventListener('load', () => resolve(register()), { once: true }));
}

export { recoverStaleBuild, STALE_BUILD_KEY, type StaleBuild, type StaleBuildPage } from './stale-build';
export {
  RETRY_AFTER_CAP_MS,
  RETRY_DELAYS_MS,
  retryAfterMsOf,
  retryingFetch,
  type RetryEnv,
} from './retry-fetch';

/** The page's `fetch`, as the stale-build watch wraps it. */
interface FetchingWindow {
  fetch: typeof fetch;
}

/**
 * Passes every answer the page's `fetch` gets to `onAnswer` (its absolute URL and status) and
 * returns it untouched, so a build file the host no longer serves is noticed whoever fetched it:
 * content/'s map and pack data, assets/' models and kits, audio/'s voices. A request that fails
 * (offline) is not an answer. Returns the unwrapped `fetch`.
 */
export function watchFetches(
  win: FetchingWindow,
  base: string,
  onAnswer: (url: string, status: number) => void,
): typeof fetch {
  const inner = win.fetch.bind(win);
  win.fetch = (input, init) =>
    inner(input, init).then((res) => {
      try {
        const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        onAnswer(new URL(raw, base).href, res.status);
      } catch {
        // an address it cannot read is not a build file
      }
      return res;
    });
  return inner;
}

/** Session storage, or null where the browser refuses it. */
function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The game's own offline worker, in a production build only (a dev server's modules change on every
 * save and must never be cached), and the watch for a build the host no longer serves
 * (stale-build.ts): a lazy chunk that fails, a build file that answers 404, an install that fails.
 * `buildId` is this build's stamp id; `canReload` is app/'s answer to "does a reload lose nothing
 * now" (false mid-race and on a result). Returns the watch, which app/ tells of every change of
 * screen; null outside a production build.
 */
export function startOffline(buildId: string, canReload: () => boolean): StaleBuild | null {
  if (!import.meta.env.PROD || typeof window === 'undefined') return null;
  const scope = new URL('./', document.baseURI).href;
  let stale: StaleBuild | null = null;
  // Inside the watch, so it hears only the final answer of a build file: a 429 or 500 that a retry
  // cured is no sign of a deploy, and a 404 or 410 is never retried (retry-fetch.ts).
  window.fetch = retryingFetch(window.fetch.bind(window), {
    scope,
    online: () => navigator.onLine,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  });
  const net = watchFetches(window, document.baseURI, (url, status) => stale?.answered(url, status));
  stale = recoverStaleBuild(
    {
      win: window,
      scope,
      online: () => navigator.onLine,
      storage: sessionStore(),
      reload: () => window.location.reload(),
      fetch: net,
      canReload,
    },
    buildId,
  );
  const watch = stale;
  void registerOfflineWorker(navigator, window, document.readyState === 'complete', () =>
    watch.installFailed(),
  );
  return stale;
}

/** Chrome's `beforeinstallprompt` event: the browser offering to install the page as an app. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  userChoice?: Promise<{ outcome: string }>;
}

/** What the menu's Install button reads and taps (ui's `InstallSource` has the same shape). */
export interface InstallOffer {
  /** Whether the browser offers an install right now. */
  available(): boolean;
  /**
   * The browser's install prompt, opened inside the caller's tap (it needs the tap's activation).
   * Resolves to the player's answer, or 'unavailable' when nothing is offered.
   */
  prompt(): Promise<'accepted' | 'dismissed' | 'unavailable'>;
  /** Called whenever `available()` may have changed. */
  onChange(cb: () => void): void;
}

/**
 * The install offer, which never nags: the browser's own automatic install banner is held back (it
 * would pop over the game), and the offer waits for the player to tap the menu's Install button.
 * Browsers without the event (iOS Safari, Firefox) still install from their own menus.
 */
export function createInstallOffer(win: EventTarget): InstallOffer {
  let held: InstallPromptEvent | null = null;
  const watchers: (() => void)[] = [];
  const changed = () => {
    for (const cb of watchers) cb();
  };
  win.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    held = e as InstallPromptEvent;
    changed();
  });
  win.addEventListener('appinstalled', () => {
    held = null;
    changed();
  });
  return {
    available: () => held !== null,
    prompt() {
      const e = held;
      if (!e) return Promise.resolve('unavailable');
      // An offer prompts once; the browser offers again later if the player said no.
      held = null;
      let shown: Promise<unknown>;
      try {
        shown = e.prompt();
      } catch (err) {
        shown = Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }
      changed();
      return shown
        .then(() => e.userChoice)
        .then(
          (c) => (c?.outcome === 'accepted' ? 'accepted' : 'dismissed'),
          () => 'dismissed' as const,
        );
    },
    onChange: (cb) => void watchers.push(cb),
  };
}

let sharedOffer: InstallOffer | null = null;
/** The page's one install offer, listening from the first call (app/ makes it at boot). */
export function installOffer(): InstallOffer {
  sharedOffer ??= createInstallOffer(window);
  return sharedOffer;
}
