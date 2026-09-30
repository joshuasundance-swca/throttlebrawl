// platform: the start-tap sequence, the rotate-your-phone trigger, every lifecycle listener, the
// page guards and the app-id constant (docs/architecture.md, "Input" and "Fixed timestep and the
// loop"; docs/milestones/M1.md, platform-1). platform/ may import only core/, so audio arrives as
// the injected `resumeAudio` callback. The browser APIs sit behind `PlatformEnv`, so the unit
// tests drive the same code with mocks.
import type { ResumeAudio } from '../core';

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
  isPortrait(): boolean;
  /** A phone or tablet: the only devices the rotate screen is for. */
  isTouchDevice(): boolean;
  isHidden(): boolean;
  /** Shows or hides the rotate-your-phone screen. */
  showRotate(need: boolean): void;
  /** Adds a style sheet; returns a function that removes it. */
  injectStyle(css: string): () => void;
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

  const pause = (reason: PauseReason) => {
    if (reasons.has(reason)) return;
    const first = reasons.size === 0;
    reasons.add(reason);
    if (first) for (const w of watchers) w.onHidden(reason);
  };
  const clear = (reason: PauseReason) => {
    if (!reasons.delete(reason) || reasons.size > 0) return;
    for (const w of watchers) w.onShown();
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
