// platform: the start-tap sequence, lifecycle listeners and the app-id constant
// (docs/architecture.md, "Input" and "Fixed timestep and the loop"). platform-1 owns this folder
// after app-1 and adds the rotate screen trigger, the re-lock on fullscreen change and the guards.
import type { ResumeAudio } from '../core';

/**
 * The one place the app id appears. Storage keys, export prefixes and format strings derive from
 * it or are name-neutral, because the game's name is a codename (a rename is this line plus a
 * one-time storage-key migration).
 */
export const APP_ID = 'mbrawl';

export interface StartTapResult {
  fullscreen: boolean;
  orientationLocked: boolean;
  audio: boolean;
}

interface OrientationWithLock {
  lock?: (orientation: string) => Promise<void>;
}

/**
 * The start-tap sequence, in order, inside one user activation: fullscreen (navigation UI
 * hidden), landscape lock, tilt permission where the browser asks for one, then audio. Any single
 * step may fail without stopping the rest.
 */
export async function runStartTap(resumeAudio: ResumeAudio, root: HTMLElement = document.documentElement) {
  const result: StartTapResult = { fullscreen: false, orientationLocked: false, audio: false };
  // Each call starts synchronously, before any await, so all of them see the tap's activation.
  const fullscreen = root.requestFullscreen
    ? root.requestFullscreen({ navigationUI: 'hide' }).then(
        () => true,
        () => false,
      )
    : Promise.resolve(false);
  const orientation = screen.orientation as unknown as OrientationWithLock | undefined;
  const lock = fullscreen.then((ok) =>
    ok && orientation?.lock
      ? orientation.lock('landscape').then(
          () => true,
          () => false,
        )
      : false,
  );
  const tilt = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> })
    .requestPermission;
  const tiltAsked = tilt ? tilt().catch(() => 'denied') : Promise.resolve('not-needed');
  const audio = resumeAudio().then(
    () => true,
    () => false,
  );
  [result.fullscreen, result.orientationLocked, result.audio] = await Promise.all([fullscreen, lock, audio]);
  await tiltAsked;
  return result;
}

export interface LifecycleCallbacks {
  onHidden: () => void;
  onShown: () => void;
}

/**
 * Every lifecycle listener lives here (visibilitychange, pagehide, a lost fullscreen), so a
 * hidden page pauses exactly once. Returns a function that removes the listeners.
 */
export function watchLifecycle(cb: LifecycleCallbacks): () => void {
  let hidden = document.visibilityState === 'hidden';
  const hide = () => {
    if (hidden) return;
    hidden = true;
    cb.onHidden();
  };
  const show = () => {
    if (!hidden) return;
    hidden = false;
    cb.onShown();
  };
  const onVisibility = () => (document.visibilityState === 'hidden' ? hide() : show());
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', hide);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', hide);
  };
}
