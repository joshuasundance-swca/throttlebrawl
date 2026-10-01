// The view key (docs/milestones/M3.md, camera-3): one key press steps the camera to its next view.
// The camera reads no browser global (boundaries.test.ts), so the caller hands it the event
// target, which app/ does with the window. The gamepad binding and the remappable key map are the
// input lane's (a `cycleCamera` action next to `lookBack`); until then this is the key. [default]

/** C for camera: unused by the product spec's key map (WASD, arrows, J, U, O, K, L, Space). */
export const CAMERA_VIEW_KEY = 'KeyC';

interface KeyLike {
  code?: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  target?: unknown;
}

const EDITABLE = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** A key typed into a text field, or held for a shortcut, is not a camera change. */
function typing(e: KeyLike): boolean {
  const t = e.target as { tagName?: unknown; isContentEditable?: unknown } | null | undefined;
  if (!t || typeof t !== 'object') return false;
  return (
    (typeof t.tagName === 'string' && EDITABLE.has(t.tagName.toUpperCase())) || t.isContentEditable === true
  );
}

/**
 * Cycles `camera`'s view on each fresh press of `code` arriving at `target`. Returns the unbind.
 */
export function bindViewKey(
  target: EventTarget,
  camera: { cycleView(): unknown },
  code: string = CAMERA_VIEW_KEY,
): () => void {
  const onKey = (ev: Event): void => {
    const e = ev as Event & KeyLike;
    if (e.code !== code || e.repeat || e.ctrlKey || e.altKey || e.metaKey || typing(e)) return;
    camera.cycleView();
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
