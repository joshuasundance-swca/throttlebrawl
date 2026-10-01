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
// ui-3: the "what's new since you last played" card beside the menu, the changelog page (both from
// dist/changelog.json), the results screen's takedowns and style tally, and the style pop-ups
// (moved out of the middle of the screen, smaller and merged, by playtest 1c).
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
import { DEFAULT_SETTINGS, sanitiseSettings, withVeto, type Settings } from '../save';
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
  lastSeenPersists,
  settingPersists,
  settingValue,
  visibleSettings,
  type SettingId,
  type SettingsChange,
} from './settings';
import { createSettingsScreen, SETTINGS_CSS } from './settings-screen';
import { CHANGELOG_CSS, createChangelogScreen, createWhatsNewCard } from './changelog-screen';
import {
  createPopStack,
  createRaceTally,
  popCash,
  popLabel,
  type PopEntry,
  type StylePop,
} from './race-feed';
import { parseChangelog, sameBuild, whatsNewSince, type ChangelogNote, type WhatsNew } from './whats-new';
import { createNarrative, type Narrative } from './narrative';
import { createTuningPanel, type TuningPanel } from './tuning';
import { keyLegend } from '../input';
import { cleanRegions, pickRegion, sameRegion, type RegionOption } from './regions';

export { ordinal, resultText, formatSpeed } from './format';
export { DEFAULT_REGION, sameRegion } from './regions';
export type { RegionOption } from './regions';
export type { RaceResult } from './format';
export { HUD_ELEMENTS, hudStyle } from './placement';
export { applySettingsChange, SETTINGS, settingValue } from './settings';
export type { SettingId, SettingsChange, SettingValue } from './settings';
// The barks' tuning declarations (narrative-1), for app/'s collected list.
export { BARK_TUNING } from './narrative';

export type Screen = 'start' | 'menu' | 'settings' | 'race' | 'results' | 'changelog';

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
  /**
   * The menu's region picker changed (playtest 1c). app/ starts the next race there; `GameUi.region`
   * reads the same pick at any time.
   */
  onRegionChange?: (regionId: string) => void;
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
  /**
   * The menu's region picker (playtest 1c): the regions to offer, from app/'s region registry, and
   * the one to show as picked (the Keys when left out). The picker hides while the list is empty.
   */
  setRegions(regions: readonly RegionOption[], picked?: string | null): void;
  /** The picked region's id, as app/ spelled it, or null while no region is offered. */
  readonly region: string | null;
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
  /** The regions for the menu's picker (app/'s region registry); none hides the picker. */
  regions?: readonly RegionOption[];
  /** The region shown as picked at boot; the Keys when left out or not in the list. */
  region?: string | null;
}

/** Long-press length for the build id (docs/architecture.md, "The gesture"). */
export const LONG_PRESS_MS = 500;
/** How far the stick knob travels, in CSS pixels (visual only; input/ owns the real range). */
const STICK_RING_PX = 60;
/** Touches this close to the edge belong to the phone's back gesture (input/ ignores them too). */
const EDGE_PX = 24;
/**
 * The style pop-ups (playtest 1c, 2026-09-30 [decided]: "get in the way of seeing what's ahead").
 * At most this many chips, each up this long, a fade included; a repeat of a kind already up
 * restarts its time. [default]
 */
const POP_MAX = 3;
const POP_DWELL_MS = 1100;
/** The stack starts this far below the position badge's top edge: the badge's height plus a gap. */
const POP_BELOW_BADGE_PX = 44;
/** Space kept under the bark bubble, its speech tail included, when the stack must move below it. */
const POP_BUBBLE_GAP_PX = 15;

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
#region-picker { display: flex; flex-direction: column; align-items: center; gap: 6px; max-width: min(560px, 92vw); }
#region-picker .region-label { font: 800 12px ui-monospace, 'Courier New', monospace; letter-spacing: 0.12em;
  text-transform: uppercase; background: #111; color: #f2ead8; padding: 1px 8px; transform: rotate(1deg); }
#region-picker .row { gap: 10px; }
#region-picker .region { font-size: 15px; }
#region-picker .region[aria-checked='true'] { background: #111; color: #f5c542; box-shadow: 3px 3px 0 #e0543a;
  transform: rotate(-1deg); }
#region-picker .region-blurb { font: italic 500 13px/1.3 ui-monospace, 'Courier New', monospace; color: #f2ead8;
  text-shadow: 1px 1px 0 #111; max-width: 100%; }
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
  pointer-events: none; box-sizing: border-box; flex-direction: column; line-height: 1.1; }
.touch-hint { font: 700 10px ui-monospace, monospace; opacity: 0.85; }
#touch-stick-ring { position: absolute; width: ${STICK_RING_PX * 2}px; height: ${STICK_RING_PX * 2}px;
  margin: -${STICK_RING_PX}px 0 0 -${STICK_RING_PX}px; border: 3px solid #fffc; border-radius: 50%;
  background: #0003; pointer-events: none; box-sizing: border-box; }
#touch-stick-knob { position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; margin: -22px 0 0 -22px;
  border-radius: 50%; background: #fffa; }
${SETTINGS_CSS}
${CHANGELOG_CSS}
#style-popups { position: absolute; display: flex; flex-direction: column; align-items: flex-start; gap: 4px;
  pointer-events: none; transition: top 0.12s ease-out; }
#style-popups.mirrored { align-items: flex-end; }
.style-pop { display: flex; flex-direction: column; align-items: flex-start; padding: 2px 5px 3px 4px;
  background: rgb(10 5 20 / 55%); border-left: 3px solid #f5c542; border-radius: 3px; max-width: 100%;
  box-sizing: border-box; animation: tb-pop ${POP_DWELL_MS}ms ease-out forwards; }
#style-popups.mirrored .style-pop { align-items: flex-end; text-align: right; border-left: 0;
  border-right: 3px solid #f5c542; padding: 2px 4px 3px 5px; animation-name: tb-pop-mirrored; }
.pop-label { font: 800 10px/1.2 ui-monospace, 'Courier New', monospace; color: #f2ead8; }
.pop-cash { font: 900 15px/1.15 ui-monospace, 'Courier New', monospace; color: #f5c542; white-space: nowrap; }
.pop-cash:empty { display: none; }
@keyframes tb-pop { 0% { opacity: 0; transform: translateX(-6px); } 10% { opacity: 1; transform: none; }
  75% { opacity: 1; } 100% { opacity: 0; } }
@keyframes tb-pop-mirrored { 0% { opacity: 0; transform: translateX(6px); } 10% { opacity: 1; transform: none; }
  75% { opacity: 1; } 100% { opacity: 0; } }
#results-tally { font: 800 15px ui-monospace, monospace; }
#pause-screen { background: rgb(10 5 20 / 70%); pointer-events: auto; }
/* Playtest 1c item 8: on a phone the open keyboard legend pushed the "cut this" list off the screen.
   The menu (#pause-main) and the two cards (#pause-cards: the legend and the recently-seen list) are
   blocks that never shrink; a tall screen stacks them and scrolls when it must, and a short
   landscape phone puts the cards in their own scrolling column beside the menu. [default] */
#ui #pause-screen { justify-content: safe center; overflow-y: auto; }
#pause-screen > * { flex-shrink: 0; }
#pause-main, #pause-cards { display: flex; flex-direction: column; align-items: center; gap: 10px; }
#pause-cards { width: min(560px, 100%); }
#ui #pause-cards > * { width: 100%; max-width: 100%; max-height: none; box-sizing: border-box; flex-shrink: 0; }
#pause-keys { padding: 4px 12px; }
#pause-keys summary { cursor: pointer; font-weight: 800; }
#pause-keys .keys-grid { display: grid; grid-template-rows: repeat(4, auto); grid-auto-flow: column; gap: 2px 18px;
  margin-top: 4px; }
@media (max-width: 560px) {
  #pause-keys .keys-grid { grid-template-rows: none; grid-template-columns: repeat(2, auto); grid-auto-flow: row; }
}
@media (orientation: landscape) and (max-height: 520px) {
  #ui #pause-screen { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto; gap: 2px 16px; align-items: center; justify-items: center;
    overflow: hidden; }
  #pause-main { grid-column: 1; grid-row: 1; gap: 8px; }
  #pause-build { grid-column: 1; grid-row: 2; }
  #pause-cards { grid-column: 2; grid-row: 1 / 3; max-height: 100%; overflow-y: auto; gap: 8px; }
  #pause-keys .keys-grid { grid-template-rows: none; grid-template-columns: repeat(2, auto); grid-auto-flow: row; }
}
#resume-card { pointer-events: auto; background: rgb(10 5 20 / 85%); }
#busy { pointer-events: auto; background: rgb(10 5 20 / 85%); z-index: 5; }
#busy::before { content: ''; width: 36px; height: 36px; border: 5px solid #f2ead8; border-top-color: #f5c542;
  border-radius: 50%; animation: tb-spin 0.9s linear infinite; }
@keyframes tb-spin { to { transform: rotate(360deg); } }
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

/** A style event as the browser specs feed it: the kind and its cash. */
interface StyleFeedPop {
  kind: string;
  points?: number;
}
type StyleFeedWindow = Window & {
  __GAME_TEST__?: boolean;
  __uiStyleFeed?: (pops: readonly StyleFeedPop[]) => void;
};

/**
 * The browser specs' style feed (docs/architecture.md, "Testing seams"), only when the test flag
 * is set before the page loads: `window.__uiStyleFeed([{kind: 'nearMiss', points: 25}])` raises
 * the player's style pop-ups through the same tally the sim's events go through, so the pop-up
 * layout can be checked without waiting for a near miss. It writes no sim state.
 */
function installStyleFeed(feed: (pops: readonly StyleFeedPop[]) => void): void {
  const w = window as StyleFeedWindow;
  if (w.__GAME_TEST__ === true) w.__uiStyleFeed = feed;
}

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

  // ---- The region picker (playtest 1c) -------------------------------------------------------
  // Above the Race button: one zine-style chip per region app/ offers, the Keys picked by default,
  // and the picked region's one-line blurb. Race starts the race in the picked region.
  let regions: RegionOption[] = [];
  let region: string | null = null;
  const regionRow = el('div', { className: 'row' });
  regionRow.setAttribute('role', 'radiogroup');
  regionRow.setAttribute('aria-label', 'Region');
  const regionBlurb = el('div', { className: 'region-blurb', hidden: true });
  const regionPicker = el(
    'div',
    { id: 'region-picker', hidden: true },
    el('div', { className: 'region-label', textContent: 'Ride where' }),
    regionRow,
    regionBlurb,
  );
  const drawRegions = () => {
    regionPicker.hidden = regions.length === 0;
    regionRow.replaceChildren(
      ...regions.map((o) => {
        const b = button(`region-${o.id.replace(/[^a-z0-9-]/gi, '-')}`, 'small', o.name, () =>
          tapRegion(o.id),
        );
        b.classList.add('region');
        b.dataset['region'] = o.id;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(o.id === region));
        return b;
      }),
    );
    const picked = regions.find((o) => o.id === region);
    regionBlurb.textContent = picked?.blurb ?? '';
    regionBlurb.hidden = !picked?.blurb;
  };
  const tapRegion = (id: string) => {
    if (id === region) return;
    region = id;
    drawRegions();
    cb.onRegionChange?.(id);
  };
  const setRegions = (list: readonly RegionOption[], picked?: string | null) => {
    regions = cleanRegions(list);
    // Keep the current pick across a refreshed list unless app/ names one.
    const keep = picked ?? (region && regions.some((o) => sameRegion(o.id, region ?? '')) ? region : null);
    region = pickRegion(regions, keep);
    drawRegions();
  };
  setRegions(opts.regions ?? [], opts.region ?? null);

  // ---- Menu --------------------------------------------------------------------------------
  // The what's-new card sits beside the menu (ui-3), so the Race button stays where it was.
  const whatsNewCard = createWhatsNewCard({
    onOpenChangelog: () => show('changelog'),
    onHide: () => menu.classList.remove('with-news'),
  });
  const menu = el(
    'div',
    { id: 'menu', className: 'screen', hidden: true },
    el(
      'div',
      { className: 'menu-main' },
      el('div', { className: 'title', textContent: 'throttlebrawl' }),
      regionPicker,
      button('menu-race', 'big', 'Race', () => cb.onRace()),
      el(
        'div',
        { className: 'row' },
        button('menu-settings', 'small', 'Settings', () => show('settings')),
        button('menu-changelog', 'small', "What's new", () => show('changelog')),
        button('menu-copy-report', 'small', 'Copy debug report', () => void cb.onCopyReport()),
      ),
    ),
    whatsNewCard.root,
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
    placePopups(unit);
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
      // The kick hint (playtest 1, 2026-09-30: "Can't kick"): swipe down on the button to kick.
      if (e.element === 'touch-attack')
        b.append(el('span', { className: 'touch-hint', id: 'touch-kick-hint', textContent: '▼ kick' }));
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
  // The keyboard legend (playtest 1, 2026-09-30: "idk how to kick on the laptop"): on the pause
  // screen only, never on the in-race HUD [decided] ("don't clutter the in-game HUD"). Open where
  // the pointer is fine (a laptop), folded on a touch screen, where it is one line.
  const keyRows = [...keyLegend(), { keys: 'Esc', action: 'pause' }, { keys: '`', action: 'tuning panel' }];
  const pauseKeys = el(
    'details',
    { id: 'pause-keys', className: 'card', open: !coarse },
    el('summary', { textContent: 'Keyboard' }),
    el(
      'div',
      { className: 'keys-grid' },
      ...keyRows.map((r) => el('div', {}, el('b', { textContent: r.keys }), ` ${r.action}`)),
    ),
  );
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
  // The legend and the "recently seen" list (mounted below, once the narrative exists) share a
  // column, so on a short phone screen neither pushes the other off it (playtest 1c item 8).
  const pauseCards = el('div', { id: 'pause-cards' }, pauseKeys);
  const pauseScreen = el(
    'div',
    { id: 'pause-screen', className: 'screen', hidden: true },
    el(
      'div',
      { id: 'pause-main' },
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
    ),
    pauseCards,
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
  const resultTally = el('div', { id: 'results-tally', hidden: true });
  const results = el(
    'div',
    { id: 'results', className: 'screen', hidden: true },
    resultPlace,
    resultPrize,
    resultTally,
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

  // ---- The changelog page, the what's-new check and the style pop-ups (ui-3) -----------------
  const changelogScreen = createChangelogScreen({ onBack: () => show('menu') });
  let changelog: Promise<ChangelogNote[] | null> | null = null;
  /** dist/changelog.json, fetched once; null when it is missing (a dev server) or unreadable. */
  const loadChangelog = () =>
    (changelog ??= fetch('changelog.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: unknown) => (d === null ? null : parseChangelog(d)))
      .catch(() => null));
  // The card needs the record to keep the last build seen, or it would greet every launch.
  const newsAllowed = lastSeenPersists(sanitiseSettings) && buildId.length > 0;
  let newsChecked = false;
  let pendingNews: WhatsNew | null = null;
  const markSeen = () => {
    if (settings.lastSeenBuild !== buildId) change({ kind: 'seen', build: buildId });
  };
  const offerNews = () => {
    if (!pendingNews || current !== 'menu') return;
    whatsNewCard.show(pendingNews);
    menu.classList.add('with-news');
    pendingNews = null;
    markSeen(); // seen once it is on screen
  };
  const checkNews = () => {
    if (newsChecked || !newsAllowed) return;
    newsChecked = true;
    const seen = settings.lastSeenBuild;
    if (!seen) {
      pendingNews = { kind: 'welcome' };
      offerNews();
      return;
    }
    if (sameBuild(seen, buildId)) return;
    void loadChangelog().then((notes) => {
      if (!notes) return; // unreadable: try again next launch, and keep the old mark
      const w = whatsNewSince(notes, seen);
      if (w.kind === 'none') markSeen();
      else {
        pendingNews = w;
        offerNews();
      }
    });
  };

  const tally = createRaceTally();
  let tallyPlayer = -1;
  installStyleFeed((pops) =>
    tally.onEvents(
      pops.map((p) => ({ tick: 0, type: 'style', actor: tallyPlayer, data: { ...p } })),
      tallyPlayer,
    ),
  );
  // The style pop-ups (playtest 1c, 2026-09-30 [decided]: "get in the way of seeing what's ahead.
  // Maybe they could be less intrusive and/or less centered"). A small stack of chips under the
  // position badge, on its side of the screen (so it follows the left-handed mirror), well outside
  // the middle of the road where traffic comes from. Each chip is a small word over its cash, on a
  // see-through ground, up about a second; a repeat of a kind adds to its chip ("NEAR MISS ×3").
  // Where the bark bubble reaches the stack (a narrow screen, a long line), the stack moves below
  // it, and goes home once its chips are gone.
  const popups = el('div', { id: 'style-popups' });
  hud.append(popups);
  const popStack = createPopStack(POP_MAX);
  interface PopView {
    root: HTMLElement;
    label: HTMLElement;
    cash: HTMLElement;
    timer: ReturnType<typeof setTimeout> | null;
  }
  const popViews = new Map<PopEntry, PopView>();
  let popHomeTop = 0;
  let popTop = 0;
  let bubbleEl: HTMLElement | null = null;
  let bubbleKey = '';
  const setPopTop = (top: number) => {
    if (top === popTop) return;
    popTop = top;
    popups.style.top = `${top}px`;
  };
  function placePopups(unit: number) {
    const badge = elementOf('position');
    const across = badge?.anchor.split('-')[1] ?? 'left';
    const right = (across === 'right') !== layout.mirror;
    const ox = Math.round((badge?.offset[0] ?? 0.03) * unit);
    const oy = badge?.anchor.startsWith('top') ? badge.offset[1] : 0.03;
    const edge = `max(${ox}px, env(safe-area-inset-${right ? 'right' : 'left'}))`;
    popups.classList.toggle('mirrored', right);
    popups.style.left = right ? '' : edge;
    popups.style.right = right ? edge : '';
    // Never past the outer quarter of the width, whatever the words: on a narrow screen a long
    // label wraps instead of reaching into the middle of the road.
    popups.style.maxWidth = `calc(25vw - ${edge})`;
    popHomeTop = Math.round(oy * unit + POP_BELOW_BADGE_PX);
    bubbleKey = '';
    setPopTop(popHomeTop);
  }
  const dropPop = (entry: PopEntry) => {
    const view = popViews.get(entry);
    if (view?.timer) clearTimeout(view.timer);
    view?.root.remove();
    popViews.delete(entry);
    popStack.remove(entry);
  };
  const clearPops = () => {
    for (const entry of [...popViews.keys()]) dropPop(entry);
    popStack.clear();
    bubbleKey = '';
    setPopTop(popHomeTop);
  };
  const popUp = (pop: StylePop) => {
    const { entry, merged, dropped } = popStack.add(pop);
    for (const d of dropped) dropPop(d);
    let view = popViews.get(entry);
    if (!view) {
      const label = el('span', { className: 'pop-label' });
      const cash = el('span', { className: 'pop-cash' });
      view = { root: el('div', { className: 'style-pop' }, label, cash), label, cash, timer: null };
      popups.append(view.root);
      popViews.set(entry, view);
    } else if (merged) {
      // Restart the fade, so a run of near misses keeps its chip up.
      view.root.style.animation = 'none';
      void view.root.offsetWidth;
      view.root.style.animation = '';
    }
    view.label.textContent = popLabel(entry);
    view.cash.textContent = popCash(entry);
    if (view.timer) clearTimeout(view.timer);
    view.timer = setTimeout(() => dropPop(entry), POP_DWELL_MS);
  };
  /**
   * Keeps the stack off the bark bubble. Measured only when the chips or the bubble's line change
   * (reading its text needs no layout); with no chips up the stack goes home.
   */
  const keepPopsOffBubble = () => {
    if (popViews.size === 0) {
      bubbleKey = '';
      setPopTop(popHomeTop);
      return;
    }
    bubbleEl ??= document.getElementById('bark-bubble');
    const up = !!bubbleEl && !bubbleEl.hidden;
    const key = up && bubbleEl ? `${popViews.size}|${bubbleEl.textContent ?? ''}` : '';
    if (key === bubbleKey) return;
    bubbleKey = key;
    if (!up || !bubbleEl) return; // the bubble went: stay put until the chips are gone
    const b = bubbleEl.getBoundingClientRect();
    const s = popups.getBoundingClientRect();
    const across = s.left < b.right && b.left < s.right;
    const down = popHomeTop < b.bottom + POP_BUBBLE_GAP_PX && b.top < popHomeTop + s.height;
    setPopTop(across && down ? Math.ceil(b.bottom + POP_BUBBLE_GAP_PX) : Math.max(popTop, popHomeTop));
  };

  root.append(
    touchSurface,
    hud,
    start,
    menu,
    settingsScreen.root,
    changelogScreen.root,
    results,
    pauseScreen,
    resumeCard,
    busy,
    noticeBox,
  );
  host.append(root, stamp);
  const tuningPanel = createTuningPanel(root, opts.tuning);
  // narrative-2's "cut this": a cut goes into the settings record (the debug report lists it), and
  // the bubble's long-press ignores presses in the stick and attack zones mid-race.
  const barks = createNarrative({
    vetoed: settings.vetoes.map((v) => v.contentRef),
    onVeto: (flag) => {
      settings = withVeto(settings, flag);
      cb.onSettingsChange?.(settings);
    },
    inControlZone: (x, y) => {
      if (current !== 'race' || paused) return false;
      const box = touchSurface.getBoundingClientRect();
      const [px, py] = [x - box.left, y - box.top];
      return layout.elements.some((e) => {
        if (!e.visible || (e.element !== 'touch-stick-zone' && e.element !== 'touch-attack')) return false;
        const r = placeElement(e, box.width, box.height, layout.mirror);
        return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
      });
    },
  });
  // app/ hands every step's events to the narrative; ui reads the same feed for the style pop-ups
  // and the results tally (ui-3), so they need no wiring of their own.
  const narrative: Narrative = {
    ...barks,
    onEvents(events, context) {
      if (current === 'race') {
        const me =
          tallyPlayer >= 0 ? tallyPlayer : (context?.snapshot.entities.find((e) => e.slot === 0)?.id ?? -1);
        tally.onEvents(events, me);
      }
      barks.onEvents(events, context);
    },
  };
  narrative.mountRecentlySeen(pauseCards);

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
    changelog: [changelogScreen.root],
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
      tally.reset();
      tallyPlayer = -1;
      clearPops();
      placeAll();
    }
    if (screen === 'menu') {
      checkNews();
      offerNews();
    }
    if (screen === 'changelog') void loadChangelog().then((notes) => changelogScreen.setNotes(notes));
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
      tallyPlayer = playerId;
      tally.noteSnapshotTally(player?.styleTally);
      for (const pop of tally.takePopups()) popUp(pop);
      keepPopsOffBubble();
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
      // The tally is ui's own count unless app/ sends one (combat-4 counts takedowns in the sim).
      const t = resultText({
        ...r,
        takedowns: r.takedowns ?? tally.takedowns,
        styleCash: r.styleCash ?? tally.styleCash,
      });
      resultPlace.textContent = t.headline;
      resultPrize.textContent = t.detail;
      resultTally.textContent = t.tally ?? '';
      resultTally.hidden = t.tally === null;
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
    setRegions,
    get region() {
      return region;
    },
  };
}
