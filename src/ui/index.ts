// ui: DOM screens over the canvas (docs/architecture.md, "Rendering": DOM UI is not drawn in
// WebGL). ui-1 (docs/milestones/M1.md): the start screen with a controls card; the menu with Race,
// Settings (four volumes, mute, the left-handed mirror) and the build id in the footer; the HUD
// (speed, position, your health, your target's health) placed from the layout record; the touch
// visuals (stick ring, attack and brake buttons); the pause screen (resume, restart, quit, copy
// debug report, save debug file, and the build id that opens the tuning panel on a long-press);
// results (place and prize, or Busted and the fine); and the look of the rotate-your-phone screen
// (platform/ creates and toggles `#rotate-screen` after the start tap; ui only restyles it).
// ui-2 (docs/milestones/M2.md): the tabbed settings screen drawn from settings.ts, the full pause
// menu (resume, restart, quit, controls and HUD, the tuning panel when enabled, copy debug report)
// and the resume card after a reload (ui draws it and reports the tap; app/ does the rest).
// ui/tuning and ui/narrative belong to their own lanes. ui never writes sim state: everything it
// changes leaves through the callbacks app/ injects.
import {
  placeElement,
  type EntitySnapshot,
  type LayoutElement,
  type OnCopyReport,
  type SimSnapshot,
  type TouchLayout,
} from '../sim/api';
import { DEFAULT_SETTINGS, sanitiseSettings, type Settings } from '../save';
import type { TuningRegistry } from '../tuning';
import {
  buildIdFromStamp,
  formatSpeed,
  healthFraction,
  ordinal,
  resultText,
  riderCount,
  targetOf,
  type RaceResult,
} from './format';
import { hudStyle } from './placement';
import {
  applySettingsChange,
  settingPersists,
  settingValue,
  visibleSettings,
  type SettingId,
  type SettingsChange,
} from './settings';
import { createSettingsScreen, SETTINGS_CSS } from './settings-screen';
import { createNarrative, type Narrative } from './narrative';
import { createTuningPanel, type TuningPanel } from './tuning';

export { ordinal, resultText, formatSpeed } from './format';
export type { RaceResult } from './format';
export { HUD_ELEMENTS, hudStyle } from './placement';
export { applySettingsChange, SETTINGS, settingValue } from './settings';
export type { SettingId, SettingsChange, SettingValue } from './settings';
// The barks' tuning declarations (narrative-1), for app/'s collected list.
export { BARK_TUNING } from './narrative';

export type Screen = 'start' | 'menu' | 'settings' | 'race' | 'results';

export interface UiCallbacks {
  /** The start tap. Called inside the pointer event, so platform calls keep user activation. */
  onStartTap(): void;
  /** Race from the menu, or "Race again" from the results. */
  onRace(): void;
  onBackToMenu(): void;
  onCopyReport: OnCopyReport;
  /** The pause screen opened (Esc, the pause button, or app/ calling `pause()`). */
  onPause?: () => void;
  /** Resume from the pause screen. */
  onResume?: () => void;
  /** Restart the race from the pause screen. The button is hidden until this is wired. */
  onRestart?: () => void;
  /** Quit to the menu from the pause screen; falls back to onBackToMenu. */
  onQuit?: () => void;
  /**
   * A settings change: app/ saves it and applies it. The record carries the M2 fields too
   * (save-2's fields); settings that feed SimConfig apply at the next race start or restart.
   */
  onSettingsChange?: (settings: Settings) => void;
  /** "Save debug file" (dev-3). The button is hidden until this is wired. */
  onSaveDebugFile?: () => Promise<void>;
}

export interface GameUi {
  show(screen: Screen): void;
  /** Skeleton form of the HUD update; `updateRace` also fills the health bars. */
  updateHud(player: EntitySnapshot | null, riders: number, units: 'mph' | 'kmh'): void;
  /** The HUD from a whole snapshot: speed, position among riders, your health and your target's. */
  updateRace(snapshot: SimSnapshot, playerId: number, units: 'mph' | 'kmh'): void;
  showResults(result: RaceResult): void;
  /** Opens the pause screen over the race (lifecycle auto-pause lands here too). */
  pause(): void;
  readonly paused: boolean;
  /** The full-screen surface input/ listens on for touches. */
  readonly touchSurface: HTMLElement;
  setLayout(layout: TouchLayout): void;
  notice(text: string): void;
  /**
   * The resume card after a reload mid-race (ui-2): "Resume race" or "Start over". The choice is
   * reported inside the tap, so app/ can run the Start-tap sequence with user activation.
   */
  showResumeCard(onChoice: (choice: 'resume' | 'startOver') => void): void;
  /** A spinner with a line of text over everything (the resume fast-forward), or null to hide it. */
  setBusy(text: string | null): void;
  readonly settings: Readonly<Settings>;
  readonly tuningPanel: TuningPanel;
  readonly narrative: Narrative;
}

export interface UiOptions {
  stampText: string;
  layout: TouchLayout;
  tuning: TuningRegistry;
  callbacks: UiCallbacks;
  /** The loaded settings record; defaults when absent. */
  settings?: Settings;
  /**
   * The settings whose effect app/ has wired. Each appears on the settings screen once the saved
   * record keeps it too; units and the tuning entry need no wiring. `?settings=all` in the page
   * address previews every setting, wired or not (for agents and layout tests).
   */
  liveSettings?: readonly SettingId[];
}

/** Long-press length for the build id (docs/architecture.md, "The gesture"). */
export const LONG_PRESS_MS = 500;
/** How far the stick knob travels, in CSS pixels (visual only; input/ owns the real range). */
const STICK_RING_PX = 60;
/** Touches this close to the edge belong to the phone's back gesture (input/ ignores them too). */
const EDGE_PX = 24;

const CSS = `
#ui { position: fixed; inset: 0; pointer-events: none; font: 600 16px/1.3 system-ui, sans-serif; color: #fff;
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
#ui button, #ui input, #ui label { pointer-events: auto; font: inherit; }
#ui .screen { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 10px; text-align: center; background: rgb(20 10 40 / 50%); z-index: 2;
  padding: 8px max(16px, env(safe-area-inset-right)) 8px max(16px, env(safe-area-inset-left)); box-sizing: border-box; }
#ui .screen[hidden], #ui [hidden] { display: none !important; }
#ui .title { font-size: 32px; font-weight: 900; letter-spacing: 0.04em; text-transform: uppercase;
  background: #111; color: #f2ead8; padding: 2px 14px; transform: rotate(-1.5deg); box-shadow: 4px 4px 0 #e0543a; }
#ui .big, #ui .small { cursor: pointer; font-family: ui-monospace, 'Courier New', monospace; font-weight: 800;
  color: #111; background: #f2ead8; border: 3px solid #111; box-shadow: 3px 3px 0 #111; }
#ui .big { font-size: 22px; min-height: 52px; padding: 8px 34px; background: #f5c542; }
#ui .small { font-size: 15px; min-height: 44px; padding: 6px 16px; }
#ui .big:active, #ui .small:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 #111; }
#ui .row { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
#ui .card { max-width: min(560px, 92vw); font: 500 13px/1.4 ui-monospace, 'Courier New', monospace; background: #000a;
  padding: 8px 12px; border: 1px dashed #fff8; text-align: left; box-sizing: border-box; }
#ui .card b { color: #f5c542; }
#ui .footer { position: absolute; bottom: 6px; left: 0; right: 0; font: 500 12px ui-monospace, monospace; opacity: 0.8; }
#start-screen { pointer-events: auto; cursor: pointer; }
#start-controls { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 18px; }
#hud-speed, #hud-position, #hud-health, #hud-target { position: absolute; padding: 4px 10px; background: #0008;
  border-radius: 4px; white-space: nowrap; }
#hud-speed, #hud-position { font-size: 22px; font-weight: 800; }
#hud-health, #hud-target { font: 700 12px ui-monospace, monospace; }
.hud-bar { width: 130px; height: 9px; margin-top: 3px; background: #fff3; border: 1px solid #fff9; }
.hud-bar > div { height: 100%; width: 100%; background: #f5c542; }
#hud-target .hud-bar > div { background: #e0543a; }
#hud-target .hud-name { display: block; max-width: 130px; overflow: hidden; text-overflow: ellipsis; }
#hud-pause { position: absolute; top: 8px; right: max(8px, env(safe-area-inset-right)); width: 48px; height: 44px;
  pointer-events: auto; font: 900 16px ui-monospace, monospace; color: #fff; background: #0008;
  border: 2px solid #fffa; border-radius: 6px; cursor: pointer; }
#hud-pause.mirrored { right: auto; left: max(8px, env(safe-area-inset-left)); }
#touch-surface { position: absolute; inset: 0; touch-action: none; }
#touch-surface[hidden] { display: none; }
.touch-button { position: absolute; border: 3px solid #fff; border-radius: 50%; background: #0004;
  display: flex; align-items: center; justify-content: center; font: 800 14px ui-monospace, monospace;
  pointer-events: none; box-sizing: border-box; }
#touch-stick-ring { position: absolute; width: ${STICK_RING_PX * 2}px; height: ${STICK_RING_PX * 2}px;
  margin: -${STICK_RING_PX}px 0 0 -${STICK_RING_PX}px; border: 3px solid #fffc; border-radius: 50%;
  background: #0003; pointer-events: none; box-sizing: border-box; }
#touch-stick-knob { position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; margin: -22px 0 0 -22px;
  border-radius: 50%; background: #fffa; }
${SETTINGS_CSS}
#pause-screen { background: rgb(10 5 20 / 70%); pointer-events: auto; }
#resume-card { pointer-events: auto; background: rgb(10 5 20 / 85%); }
#busy { pointer-events: auto; background: rgb(10 5 20 / 85%); z-index: 5; }
#busy::before { content: ''; width: 36px; height: 36px; border: 5px solid #f2ead8; border-top-color: #f5c542;
  border-radius: 50%; animation: tb-spin 0.9s linear infinite; }
@keyframes tb-spin { to { transform: rotate(360deg); } }
.touch-button .kick-hint { display: block; font: 700 10px ui-monospace, monospace; opacity: 0.9; }
.touch-button { flex-direction: column; }
#pause-build { font: 500 12px ui-monospace, monospace; padding: 10px 14px; opacity: 0.75; pointer-events: auto;
  touch-action: none; }
#rotate-screen { flex-direction: column; gap: 18px; background: #140a28 !important; color: #f2ead8 !important;
  font: 900 22px/1.3 system-ui, sans-serif !important; text-transform: uppercase; letter-spacing: 0.04em; }
#rotate-screen::before { content: ''; width: 44px; height: 76px; border: 4px solid #f2ead8; border-radius: 8px;
  animation: tb-rotate 2.2s ease-in-out infinite; }
@keyframes tb-rotate { 0%, 30% { transform: rotate(0deg); } 60%, 100% { transform: rotate(-90deg); } }
#ui .notice { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); }
#build-stamp.in-race { display: none; }
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node: HTMLElementTagNameMap[K] = document.createElement(tag);
  Object.assign(node, props);
  node.append(...kids);
  return node;
}

function button(id: string, cls: 'big' | 'small', text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', { id, className: cls, textContent: text, type: 'button' });
  b.addEventListener('click', onClick);
  return b;
}

/** A labelled bar; returns the wrapper, the label and the fill. */
function healthWidget(id: string, label: string) {
  const name = el('span', { className: 'hud-name', textContent: label });
  const fill = el('div');
  const bar = el('div', { className: 'hud-bar' }, fill);
  return { root: el('div', { id }, name, bar), name, fill };
}

export function createUi(host: HTMLElement, opts: UiOptions): GameUi {
  const cb = opts.callbacks;
  const style = el('style', { textContent: CSS });
  document.head.append(style);
  const root = el('div', { id: 'ui' });
  const stamp = el('div', { id: 'build-stamp', textContent: opts.stampText });
  const buildId = buildIdFromStamp(opts.stampText);
  let settings: Settings = opts.settings
    ? { ...opts.settings, volumes: { ...opts.settings.volumes } }
    : { ...DEFAULT_SETTINGS, volumes: { ...DEFAULT_SETTINGS.volumes } };
  let layout: TouchLayout = opts.layout;
  let current: Screen = 'start';
  let paused = false;

  // ---- Start screen ------------------------------------------------------------------------
  const controlsCard = el(
    'div',
    { id: 'start-controls', className: 'card' },
    el('div', {}, el('b', { textContent: 'Keys' })),
    el('div', {}, el('b', { textContent: 'Touch' })),
    el('div', { textContent: 'W / Up ride · S / Down brake' }),
    el('div', { textContent: 'Left thumb: drag up to ride' }),
    el('div', { textContent: 'A / D steer · J hit · K kick' }),
    el('div', { textContent: 'Sideways to steer, lift to coast' }),
    el('div', { textContent: 'Esc pause' }),
    el('div', { textContent: 'HIT to punch, swipe down on it to kick' }),
  );
  const start = el(
    'div',
    { id: 'start-screen', className: 'screen' },
    el('div', { className: 'title', textContent: 'throttlebrawl' }),
    el('div', { className: 'big', textContent: 'Tap to start' }),
    controlsCard,
  );
  start.addEventListener('click', () => cb.onStartTap());

  // ---- Menu --------------------------------------------------------------------------------
  const menu = el(
    'div',
    { id: 'menu', className: 'screen', hidden: true },
    el('div', { className: 'title', textContent: 'throttlebrawl' }),
    button('menu-race', 'big', 'Race', () => cb.onRace()),
    el(
      'div',
      { className: 'row' },
      button('menu-settings', 'small', 'Settings', () => show('settings')),
      button('menu-copy-report', 'small', 'Copy debug report', () => void cb.onCopyReport()),
    ),
    el('div', { id: 'menu-build', className: 'footer', textContent: `build ${buildId}` }),
  );

  // ---- Settings ----------------------------------------------------------------------------
  const change = (c: SettingsChange) => {
    const next = applySettingsChange(settings, c);
    const mirrorChanged = next.mirror !== settings.mirror;
    settings = next;
    if (mirrorChanged) {
      layout = { ...layout, mirror: next.mirror };
      placeAll();
    }
    settingsScreen.sync(settings);
    syncPauseEntries();
    cb.onSettingsChange?.(next);
  };
  const preview = (() => {
    try {
      return new URLSearchParams(window.location.search).get('settings') === 'all';
    } catch {
      return false;
    }
  })();
  const settingsScreen = createSettingsScreen({
    onChange: change,
    onBack: () => closeSettings(),
  });
  settingsScreen.setVisible(
    visibleSettings({
      live: opts.liveSettings ?? [],
      persists: (id) => settingPersists(id, sanitiseSettings),
      preview,
    }),
  );
  settingsScreen.sync(settings);
  /** Back from the settings screen: to the pause menu when it was opened there, else the menu. */
  const closeSettings = () => {
    if (settingsScreen.context === 'pause' && paused) {
      settingsScreen.root.hidden = true;
      pauseScreen.hidden = false;
    } else show('menu');
  };

  // ---- HUD ---------------------------------------------------------------------------------
  const speed = el('div', { id: 'hud-speed' });
  const position = el('div', { id: 'hud-position' });
  const selfHealth = healthWidget('hud-health', 'YOU');
  const targetHealth = healthWidget('hud-target', '');
  const pauseButton = el('button', { id: 'hud-pause', type: 'button', textContent: 'II' });
  pauseButton.setAttribute('aria-label', 'Pause');
  pauseButton.addEventListener('click', () => pause());
  const hud = el(
    'div',
    { id: 'hud', hidden: true },
    speed,
    position,
    selfHealth.root,
    targetHealth.root,
    pauseButton,
  );
  const hudPieces: Record<string, HTMLElement> = {
    speedometer: speed,
    position,
    'health-self': selfHealth.root,
    'health-target': targetHealth.root,
  };
  let targetShown = false;

  // ---- Touch visuals -----------------------------------------------------------------------
  const touchSurface = el('div', { id: 'touch-surface', hidden: true });
  const touchButtons: HTMLElement[] = [];
  const knob = el('div', { id: 'touch-stick-knob' });
  const ring = el('div', { id: 'touch-stick-ring', hidden: true }, knob);
  touchSurface.append(ring);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const screenSize = () => ({
    w: touchSurface.clientWidth || window.innerWidth,
    h: touchSurface.clientHeight || window.innerHeight,
  });
  const elementOf = (name: string): LayoutElement | undefined =>
    layout.elements.find((e) => e.element === name && e.visible);

  const placeAll = () => {
    const { w, h } = screenSize();
    const unit = Math.min(w, h);
    for (const [name, node] of Object.entries(hudPieces)) {
      const e = elementOf(name);
      const hide = !e || (e.touchOnly && !coarse) || (name === 'health-target' && !targetShown);
      node.hidden = !!hide;
      if (e) Object.assign(node.style, hudStyle(e, unit, layout.mirror));
    }
    // The pause button sits in the top corner away from the position readout, and mirrors with it.
    pauseButton.classList.toggle('mirrored', layout.mirror);
    for (const b of touchButtons.splice(0)) b.remove();
    if (!coarse) return;
    for (const e of layout.elements) {
      if (!e.visible || (e.element !== 'touch-attack' && e.element !== 'touch-brake')) continue;
      const r = placeElement(e, w, h, layout.mirror);
      const b = el('div', {
        id: e.element,
        className: 'touch-button',
        textContent: e.element === 'touch-attack' ? 'HIT' : 'BRAKE',
      });
      // Playtest 1: "Can't kick". The attack button says how to kick (swipe down on it).
      if (e.element === 'touch-attack')
        b.append(el('span', { className: 'kick-hint', textContent: '▼ KICK' }));
      Object.assign(b.style, {
        left: `${r.x}px`,
        top: `${r.y}px`,
        width: `${r.w}px`,
        height: `${r.h}px`,
        opacity: String(e.opacity),
      });
      touchSurface.append(b);
      touchButtons.push(b);
    }
  };
  window.addEventListener('resize', placeAll);

  // The stick ring: drawn where the left thumb lands inside the stick zone, the knob follows it.
  let stickPointer: number | null = null;
  let stickOrigin = { x: 0, y: 0 };
  const localPoint = (e: PointerEvent) => {
    const box = touchSurface.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top, w: box.width, h: box.height };
  };
  touchSurface.addEventListener('pointerdown', (e) => {
    if (stickPointer !== null) return;
    const p = localPoint(e);
    if (p.x < EDGE_PX || p.x > p.w - EDGE_PX) return;
    const zone = elementOf('touch-stick-zone');
    if (!zone) return;
    const inButton = ['touch-attack', 'touch-brake'].some((name) => {
      const b = elementOf(name);
      if (!b) return false;
      const r = placeElement(b, p.w, p.h, layout.mirror);
      return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    });
    const z = placeElement(zone, p.w, p.h, layout.mirror);
    if (inButton || p.x < z.x || p.x > z.x + z.w || p.y < z.y || p.y > z.y + z.h) return;
    stickPointer = e.pointerId;
    stickOrigin = { x: p.x, y: p.y };
    Object.assign(ring.style, { left: `${p.x}px`, top: `${p.y}px` });
    knob.style.transform = '';
    ring.hidden = false;
  });
  touchSurface.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickPointer) return;
    const p = localPoint(e);
    let dx = p.x - stickOrigin.x;
    let dy = p.y - stickOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RING_PX) {
      dx = (dx / len) * STICK_RING_PX;
      dy = (dy / len) * STICK_RING_PX;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  });
  const stickUp = (e: PointerEvent) => {
    if (e.pointerId !== stickPointer) return;
    stickPointer = null;
    ring.hidden = true;
  };
  touchSurface.addEventListener('pointerup', stickUp);
  touchSurface.addEventListener('pointercancel', stickUp);

  // ---- Pause -------------------------------------------------------------------------------
  // The decided entries (docs/product-spec.md, "UX and menus"), each tagged `data-entry`: resume,
  // restart, quit, controls and HUD, the tuning panel (only when the setting is on) and copy debug
  // report ("save debug file" rides in the report's row, dev-3).
  const entry = (b: HTMLButtonElement, name: string) => {
    b.dataset['entry'] = name;
    return b;
  };
  const pauseBuild = el('div', { id: 'pause-build', textContent: `build ${buildId}` });
  const restartButton = entry(
    button('pause-restart', 'small', 'Restart', () => {
      closePause();
      cb.onRestart?.();
    }),
    'restart',
  );
  restartButton.hidden = !cb.onRestart;
  const saveFileButton = button('pause-save-file', 'small', 'Save debug file', () => {
    void cb.onSaveDebugFile?.();
  });
  saveFileButton.hidden = !cb.onSaveDebugFile;
  // Controls and HUD: the controls settings for now (the HUD editor is M3).
  const controlsButton = entry(
    button('pause-controls', 'small', 'Controls and HUD', () => {
      pauseScreen.hidden = true;
      settingsScreen.sync(settings);
      settingsScreen.open('pause', 'controls');
    }),
    'controls',
  );
  const tuningButton = entry(
    button('pause-tuning', 'small', 'Tuning panel', () => tuningPanel.toggle(true)),
    'tuning',
  );
  const syncPauseEntries = () => {
    tuningButton.hidden = settingValue(settings, 'showTuningPanel') !== true;
  };
  const pauseScreen = el(
    'div',
    { id: 'pause-screen', className: 'screen', hidden: true },
    el('div', { className: 'title', textContent: 'Paused' }),
    entry(
      button('pause-resume', 'big', 'Resume', () => resume()),
      'resume',
    ),
    el(
      'div',
      { className: 'row' },
      restartButton,
      entry(
        button('pause-quit', 'small', 'Quit to menu', () => {
          closePause();
          (cb.onQuit ?? cb.onBackToMenu)();
        }),
        'quit',
      ),
      controlsButton,
      tuningButton,
    ),
    el(
      'div',
      { className: 'row' },
      entry(
        button('pause-copy-report', 'small', 'Copy debug report', () => void cb.onCopyReport()),
        'report',
      ),
      saveFileButton,
    ),
    pauseBuild,
  );
  syncPauseEntries();
  // The tuning panel hides behind a long-press on the build id, or a three-finger tap.
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelPress = () => {
    if (pressTimer !== null) clearTimeout(pressTimer);
    pressTimer = null;
  };
  pauseBuild.addEventListener('pointerdown', () => {
    cancelPress();
    pressTimer = setTimeout(() => {
      pressTimer = null;
      tuningPanel.toggle(true);
    }, LONG_PRESS_MS);
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
    pauseBuild.addEventListener(type, cancelPress);
  }
  pauseBuild.addEventListener('contextmenu', (e) => e.preventDefault());
  const pauseTouches = new Set<number>();
  pauseScreen.addEventListener('pointerdown', (e) => {
    pauseTouches.add(e.pointerId);
    if (pauseTouches.size >= 3) tuningPanel.toggle(true);
  });
  for (const type of ['pointerup', 'pointercancel'] as const) {
    pauseScreen.addEventListener(type, (e) => pauseTouches.delete(e.pointerId));
  }

  const closePause = () => {
    paused = false;
    pauseScreen.hidden = true;
    if (current === 'race') settingsScreen.root.hidden = true;
    pauseTouches.clear();
    cancelPress();
    touchSurface.hidden = current !== 'race';
  };
  function pause() {
    if (current !== 'race' || paused) return;
    paused = true;
    pauseScreen.hidden = false;
    touchSurface.hidden = true; // taps on the pause screen never reach input/
    stickPointer = null;
    ring.hidden = true;
    cb.onPause?.();
  }
  function resume() {
    if (!paused) return;
    closePause();
    cb.onResume?.();
  }

  // ---- Results -----------------------------------------------------------------------------
  const resultPlace = el('div', { id: 'results-place', className: 'title' });
  const resultPrize = el('div', { id: 'results-prize', className: 'card' });
  const results = el(
    'div',
    { id: 'results', className: 'screen', hidden: true },
    resultPlace,
    resultPrize,
    el(
      'div',
      { className: 'row' },
      button('results-menu', 'big', 'Back to menu', () => cb.onBackToMenu()),
      button('results-race', 'small', 'Race again', () => cb.onRace()),
    ),
  );

  const noticeBox = el('div', { className: 'card notice', hidden: true });

  // ---- The resume card and the busy spinner --------------------------------------------------
  let resumeChoice: ((choice: 'resume' | 'startOver') => void) | null = null;
  const choose = (choice: 'resume' | 'startOver') => {
    const report = resumeChoice;
    resumeChoice = null;
    resumeCard.hidden = true;
    report?.(choice);
  };
  const resumeCard = el(
    'div',
    { id: 'resume-card', className: 'screen', hidden: true },
    el('div', { className: 'title', textContent: 'Race in progress' }),
    el('div', { className: 'card', textContent: 'You left mid-race. Pick up where you were?' }),
    el(
      'div',
      { className: 'row' },
      button('resume-race', 'big', 'Resume race', () => choose('resume')),
      button('resume-start-over', 'small', 'Start over', () => choose('startOver')),
    ),
  );
  const busyText = el('div', { id: 'busy-text' });
  const busy = el('div', { id: 'busy', className: 'screen', hidden: true }, busyText);

  root.append(
    touchSurface,
    hud,
    start,
    menu,
    settingsScreen.root,
    results,
    pauseScreen,
    resumeCard,
    busy,
    noticeBox,
  );
  host.append(root, stamp);
  const tuningPanel = createTuningPanel(root, opts.tuning);
  const narrative = createNarrative();

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || e.repeat) return;
    if (current === 'race') {
      if (!settingsScreen.root.hidden) closeSettings();
      else if (paused) resume();
      else pause();
    } else if (current === 'settings') show('menu');
  });

  const screens: Record<Screen, HTMLElement[]> = {
    start: [start],
    menu: [menu],
    settings: [settingsScreen.root],
    race: [hud, touchSurface],
    results: [results],
  };

  function show(screen: Screen) {
    current = screen;
    for (const [name, els] of Object.entries(screens)) for (const e of els) e.hidden = name !== screen;
    if (paused) closePause();
    stamp.classList.toggle('in-race', screen === 'race');
    if (screen === 'settings') {
      settingsScreen.sync(settings);
      settingsScreen.open('menu');
    }
    if (screen === 'race') {
      targetShown = false;
      placeAll();
    }
  }

  const setText = (node: HTMLElement, text: string) => {
    if (node.textContent !== text) node.textContent = text;
  };
  const setFill = (fill: HTMLElement, fraction: number) => {
    const w = `${Math.round(fraction * 1000) / 10}%`;
    if (fill.style.width !== w) fill.style.width = w;
  };

  const updateHud = (player: EntitySnapshot | null, riders: number, units: 'mph' | 'kmh') => {
    if (!player) return;
    setText(speed, formatSpeed(player.speed, units));
    setText(position, `${ordinal(player.place)} / ${riders}`);
    setFill(selfHealth.fill, healthFraction(player.health, player.healthMax));
  };

  return {
    show,
    updateHud,
    updateRace(snapshot, playerId, units) {
      const player = snapshot.entities[playerId] ?? null;
      updateHud(player, riderCount(snapshot), units);
      const target = targetOf(snapshot, player);
      const shown = !!target && !!elementOf('health-target');
      if (shown !== targetShown) {
        targetShown = shown;
        targetHealth.root.hidden = !shown;
      }
      if (target) {
        setText(targetHealth.name, target.name || target.contentId);
        setFill(targetHealth.fill, healthFraction(target.health, target.healthMax));
      }
    },
    showResults(r) {
      const t = resultText(r);
      resultPlace.textContent = t.headline;
      resultPrize.textContent = t.detail;
      results.classList.toggle('busted', t.busted);
    },
    pause,
    get paused() {
      return paused;
    },
    touchSurface,
    setLayout(l) {
      layout = l;
      placeAll();
    },
    notice(text) {
      noticeBox.textContent = text;
      noticeBox.hidden = false;
      setTimeout(() => (noticeBox.hidden = true), 4000);
    },
    showResumeCard(onChoice) {
      resumeChoice = onChoice;
      resumeCard.hidden = false;
    },
    setBusy(text) {
      busyText.textContent = text ?? '';
      busy.hidden = text === null;
    },
    get settings() {
      return settings;
    },
    tuningPanel,
    narrative,
  };
}
