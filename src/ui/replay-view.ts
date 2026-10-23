/** Replay presentation only. App owns playback, verification and restoring the result screen. */
export type ReplayAction = 'toggle' | 'restart' | 'camera' | 'return';
export interface ReplayViewState {
  status: 'loading' | 'playing' | 'paused' | 'complete' | 'failed';
  camera: 'trackside' | 'orbit';
  elapsedSeconds: number;
  durationSeconds: number;
  message?: string;
}

export interface ReplayView {
  readonly root: HTMLElement;
  update(view: ReplayViewState): void;
  focus(): void;
}

const STATUS: Record<ReplayViewState['status'], string> = {
  loading: 'Loading replay…',
  playing: 'Playing',
  paused: 'Paused',
  complete: 'Replay complete',
  failed: 'Replay could not finish',
};
const time = (seconds: number) => {
  const n = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

export function createReplayView(onAction: (action: ReplayAction) => void): ReplayView {
  const make = (tag: 'div' | 'section' | 'p', id: string, text = '') => {
    const node = document.createElement(tag);
    node.id = id;
    node.textContent = text;
    return node;
  };
  // These actions deliberately bypass the normal UI gate: playback owns its own state.
  const button = (action: ReplayAction, text: string) => {
    const node = document.createElement('button');
    node.id = `replay-${action}`;
    node.type = 'button';
    node.className = 'small';
    node.textContent = text;
    node.addEventListener('click', () => {
      if (!node.disabled) onAction(action);
    });
    return node;
  };
  const status = make('div', 'replay-status');
  status.setAttribute('role', 'status');
  const clock = make('div', 'replay-time');
  const silent = make('div', 'replay-silent', 'Silent replay');
  const message = make('p', 'replay-message');
  const toggle = button('toggle', 'Play');
  const restart = button('restart', 'Restart');
  const camera = button('camera', 'Camera: Trackside');
  const back = button('return', 'Return to results');
  const info = make('div', 'replay-info');
  info.append(status, clock, silent);
  const actions = make('div', 'replay-actions');
  actions.append(toggle, restart, camera, back);
  const panel = make('section', 'replay-panel');
  panel.setAttribute('aria-label', 'Replay controls');
  panel.append(info, message, actions);
  const root = make('div', 'replay');
  root.className = 'screen';
  root.hidden = true;
  root.append(panel);
  const setText = (node: HTMLElement, text: string) => {
    if (node.textContent !== text) node.textContent = text;
  };
  const update = (view: ReplayViewState) => {
    // A frame update must not re-announce an unchanged playback status to a screen reader.
    setText(status, STATUS[view.status]);
    setText(clock, `${time(view.elapsedSeconds)} / ${time(view.durationSeconds)}`);
    setText(toggle, view.status === 'playing' ? 'Pause' : 'Play');
    toggle.disabled = view.status !== 'playing' && view.status !== 'paused';
    restart.disabled = view.status === 'loading';
    camera.disabled = view.status === 'loading' || view.status === 'failed';
    setText(camera, `Camera: ${view.camera === 'orbit' ? 'Orbit' : 'Trackside'}`);
    setText(message, view.message ?? '');
    message.hidden = !view.message;
  };
  update({ status: 'loading', camera: 'trackside', elapsedSeconds: 0, durationSeconds: 0 });
  return { root, update, focus: () => back.focus({ preventScroll: true }) };
}

export const REPLAY_CSS = `
#ui #replay { background: transparent; justify-content: flex-end; overflow: hidden;
  padding: max(8px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right))
    max(8px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)); }
#replay-panel { pointer-events: auto; width: min(760px, 100%); max-height: 48%; min-height: 0;
  overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; box-sizing: border-box;
  background: #111e; color: #f2ead8; border: 1px solid #f2ead8; padding: 6px 8px; }
#replay-info { display: flex; justify-content: center; flex-wrap: wrap; align-items: baseline;
  gap: 2px 12px; font: 700 0.8125rem/1.3 ui-monospace, monospace; overflow-wrap: anywhere; }
#replay-status { color: #f5c542; }
#replay-time { font-variant-numeric: tabular-nums; }
#replay-silent { font-weight: 500; }
#replay-message { margin: 4px 0; font: 500 0.8125rem/1.3 system-ui, sans-serif;
  overflow-wrap: anywhere; text-align: left; }
#replay-actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 6px; padding: 4px 0; }
#ui #replay-actions button { flex: 1 1 auto; min-height: 44px; min-width: 44px; max-width: 100%;
  padding: 6px 10px; font-size: 0.875rem; white-space: normal; overflow-wrap: anywhere; }
#ui #replay-actions button:focus-visible { outline: 3px solid #f5c542; outline-offset: 2px; }
#ui #replay-actions button:disabled { opacity: 0.55; cursor: default; }
/* The follow view keeps the rider low in the centre. On a short landscape screen a bottom
   panel hides that rider; place the controls beside the scene instead. */
@media (orientation: landscape) and (max-height: 440px) {
  #ui #replay { justify-content: center; align-items: flex-end; }
  #replay-panel { width: min(240px, 40vw); max-height: 100%; }
  #replay-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  #replay-camera, #replay-return { grid-column: 1 / -1; }
  #ui #replay-actions button { padding-inline: 6px; }
}
`;
