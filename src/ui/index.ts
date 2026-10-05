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
// (moved out of the middle of the screen, smaller and merged, by playtest 1c; and in playtest 3 into
// the top ticker with the barks and the takedown names, one line at a time).
// ui/tuning and ui/narrative belong to their own lanes. ui never writes sim state: everything it
// changes leaves through the callbacks app/ injects.
import {
  placeElement,
  placeTouchButtons,
  type EntitySnapshot,
  type LayoutElement,
  type OnCopyReport,
  type Rect,
  type SimSnapshot,
  type TouchLayout,
} from '../sim/api';
import type { ContentRegistry } from '../content';
import { DEFAULT_SETTINGS, sanitiseSettings, VIEW_SETTINGS, withVeto, type Settings } from '../save';
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
import {
  applyTopPlan,
  bikeZoneBox,
  HUD_SIZE,
  hudTextScale,
  layoutTop,
  lookAheadBox,
  placedBox,
  readSafe,
  scaledElement,
  settleLifts,
  type Box,
} from './hud-layout';
import {
  createDriftMeter,
  DRIFT_LOST,
  driftOutcome,
  GAUGE,
  gaugeBlockers,
  gaugeView,
  meterLine,
  placeGauge,
  restBase,
  type GaugeBlockers,
} from './moves-meter';
import { pickStampSpot } from './stamp';
import { COUNTDOWN_CSS, createCountdownView } from './countdown-view';
import { careerButtonText, MENU_FIRST_CSS, START_HERE_CLASS } from './menu-first';
import { hudStyle } from './placement';
import { ROOT_FONT_PCT, textScaleOf } from './text-size';
import {
  applySettingsChange,
  lastSeenPersists,
  settingPersists,
  settingValue,
  TUNED_SETTINGS,
  tunedLive,
  visibleSettings,
  type SettingId,
  type SettingsChange,
} from './settings';
import { createSettingsScreen, SETTINGS_CSS } from './settings-screen';
import { CHANGELOG_CSS, createChangelogScreen, createWhatsNewCard } from './changelog-screen';
import { createRaceTally, createStyleMeter, type StylePop } from './race-feed';
import { popItem, type TickerItem } from './ticker';
import { createTickerUi, TICKER_CSS } from './ticker-view';
import { REDUCE_MOTION_CSS } from './reduce-motion';
import { HUD_TUNING, hudParam } from './hud-tuning';
import {
  playingStation,
  RADIO_FIRST_STATION,
  radioChoiceFor,
  radioSettingOf,
  type RadioSource,
} from './radio-panel';
import { parseChangelog, sameBuild, whatsNewSince, type ChangelogNote, type WhatsNew } from './whats-new';
import { createNarrative, type Narrative } from './narrative';
import type { TuningPanel } from './tuning';
import { keyLegend } from '../input';
import { cleanRegions, pickRegion, sameRegion, type RegionOption } from './regions';
import { createRoutePicker, ROUTE_PICKER_CSS, type RouteOption } from './routes';
import { raceOptionRows, stepRaceOption, type RaceOptionId, type RaceOptionsView } from './race-options';
import type { RaceOptionsScreen } from './race-options-view';
import type { HeatBadge } from './heat-badge';
import type { CareerCallbacks, CareerScreens } from './career-screen';
import type { RadioPanel } from './radio-panel-view';
import type { WheelieGauge } from './moves-gauge';

export { ordinal, resultText, formatSpeed } from './format';
export { DEFAULT_REGION, sameRegion } from './regions';
export type { RegionOption } from './regions';
export type { RouteOption } from './routes';
export type { RaceResult } from './format';
export type { OptionChoice, RaceOptionsView } from './race-options';
export type {
  CareerCallbacks,
  CareerResultView,
  CareerScreens,
  CareerShowView,
  GarageBikeRow,
  GaragePaintRow,
  GarageView,
  TeaserView,
} from './career-screen';
export type { GigCard } from './career-show';
export { HUD_ELEMENTS, hudStyle } from './placement';
export { applySettingsChange, SETTINGS, settingValue } from './settings';
export type { SettingId, SettingsChange, SettingValue } from './settings';
// The barks' tuning declarations (narrative-1), for app/'s collected list.
export { BARK_TUNING } from './narrative';
// The HUD's own sliders (the live style meter), for app/'s collected list; ui reads them itself.
export { HUD_TUNING };
export type { RadioSource, RadioState } from './radio-panel';

export type Screen =
  | 'start'
  | 'menu'
  | 'settings'
  | 'race'
  | 'results'
  | 'changelog'
  // The menu race's options (playtest 4, P4-12 and P4-13).
  | 'raceOptions'
  // The career (run W-R): its map and garage, its results, the next region's teaser.
  | 'career'
  | 'careerResults'
  | 'teaser';

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
  /**
   * The menu's route picker changed (the maintainer, 2026-10-01: "Yes, add as routes"): a
   * real road's route id, or null for the region's own road. `GameUi.route` reads the same pick.
   */
  onRouteChange?: (routeId: string | null) => void;
  /**
   * The radio, for the pause menu's station panel (radio-1's follow-up): app/ passes
   * `{ state: () => audio.inspect().radio, skip: () => audio.skipTrack(), cut: () =>
   * audio.cutPlayingTrack(raceId, tick) }`. The panel is hidden until this is wired. ui tunes
   * through the `audio.radio` slider, and a cut song's flag goes into the settings record.
   */
  radio?: RadioSource;
  /** The menu's Career button (run W-R). The button is hidden until this is wired. */
  onCareer?: () => void;
  /**
   * Whether the career has started on this device (app/'s profile). Until it has, the menu's career
   * button reads "Start career" and is drawn as the first tap (playtest 4, P4-5: menu first). Asked
   * each time the menu shows.
   */
  careerStarted?: () => boolean;
  /** The career screens' taps (run W-R); app/ builds their views and acts on them. */
  career?: CareerCallbacks;
  /**
   * The menu race's options (playtest 4, P4-12 and P4-13): what app/ offers for the next menu race at
   * the region and road the menu has picked, asked each time the options screen opens. The picks
   * themselves are the settings record's `raceOptions` (plus its difficulty and race length), saved
   * through onSettingsChange. The menu's Options button is hidden until this is wired.
   */
  raceOptions?: () => RaceOptionsView;
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
  /**
   * Reduce motion for the interface (M5's a11y-1): the HUD's animations and fades stop while it is on
   * (the Reduce motion setting, or the phone's own preference). Sets `data-motion` on the root.
   */
  setReduceMotion(on: boolean): void;
  notice(text: string): void;
  /**
   * The race-start countdown's number (playtest 4, P4-11): "3", "2", "1" or "GO" in the middle of
   * the race screen; null hides it. Any change of screen clears it.
   */
  setCountdown(text: string | null): void;
  /**
   * The slow-frames offer (run W-O): app/ calls it when the frames stay slow on an ink look. A
   * non-blocking note at the top of the race offers a one-tap switch to the Classic look, or "No
   * thanks", which the record remembers (the offer never comes back). Unanswered, it fades after
   * `LOOK_OFFER_MS` and the pause menu carries it for the rest of the race. False (and nothing shown)
   * when the player said no before, or the look is already Classic.
   */
  offerClassicLook(): boolean;
  /**
   * The resume card after a reload mid-race (ui-2): "Resume race" or "Start over". The choice is
   * reported inside the tap, so app/ can run the Start-tap sequence with user activation.
   */
  showResumeCard(onChoice: (choice: 'resume' | 'startOver') => void): void;
  /** A spinner with a line of text over everything (the resume fast-forward), or null to hide it. */
  setBusy(text: string | null): void;
  readonly settings: Readonly<Settings>;
  /** The tuning panel (a lazy chunk: the panel's own element is not exposed). */
  readonly tuningPanel: Pick<TuningPanel, 'toggle' | 'open' | 'refreshHz'>;
  readonly narrative: Narrative;
  /**
   * The top ticker (playtest 3, the maintainer: "The black and white text pop-ups block the actual
   * game"): every in-race text pop-up is one line at a time along the top edge. ui feeds it the
   * barks, the style chips, the takedown names and the live style meter itself; app/ pushes the rest
   * (producer asks, landing lines, notes) as items of their class (ticker.ts).
   */
  readonly ticker: { push(item: TickerItem): void };
  /**
   * The menu's region picker (playtest 1c): the regions to offer, from app/'s region registry, and
   * the one to show as picked (the Keys when left out). The picker hides while the list is empty.
   */
  setRegions(regions: readonly RegionOption[], picked?: string | null): void;
  /** The picked region's id, as app/ spelled it, or null while no region is offered. */
  readonly region: string | null;
  /**
   * The menu's route picker, under the regions: the picked region's routes (its own road first,
   * then its real roads by name) and the one to show as picked (its own road when left out). The
   * picker hides while there is one road or none.
   */
  setRoutes(routes: readonly RouteOption[], picked?: string | null): void;
  /** The picked route's id, or null for the region's own road. */
  readonly route: string | null;
  /**
   * A view or radio change made outside the settings rows (the C key, the pad's d-pad up, the R
   * key) becomes the saved setting, so the row shows the live choice and picking another one takes
   * effect (the integration skeptic's mustFix 1). `view` is the camera's view index (0 chase, 1 far,
   * 2 helmet); the radio is read from the radio source. app/ calls it after a view key or pad
   * press; ui calls it itself when the pause menu or the settings screen opens.
   */
  syncLive(live?: { view?: number }): void;
  /**
   * The race's region changed the radio's stations (run W-P): tunes the saved station again when
   * the new region offers it. app/ calls it after handing audio the region's stations.
   */
  applySavedRadio(): void;
  /**
   * The career's screens and race overlays (run W-R): app/ fills them; `show` switches to them. A
   * lazy chunk, like the tuning panel: calls made before it arrives are applied when it does.
   */
  readonly career: CareerUi;
}

/** The career screens' methods (their elements stay inside ui). */
export type CareerUi = Omit<CareerScreens, 'map' | 'results' | 'teaser' | 'overlays' | 'pauseMap'>;

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
  /**
   * The content the barks read (app/'s registry: every carried pack's bark sets, riders and
   * bikes), so a region race's locals talk too. The base pack's when left out.
   */
  barkContent?: Pick<ContentRegistry, 'barkSets' | 'riders' | 'bikes'>;
}

/** Long-press length for the build id (docs/architecture.md, "The gesture"). */
export const LONG_PRESS_MS = 500;
/** How far the stick knob travels, in CSS pixels (visual only; input/ owns the real range). */
const STICK_RING_PX = 60;
/** The wheelie button shows its hint word from this wide, CSS px (9 px type: 7 letters fit). [default] */
const WHEELIE_HINT_MIN_PX = 48;
/** Touches this close to the edge belong to the phone's back gesture (input/ ignores them too). */
const EDGE_PX = 24;
/** How long the slow-frames offer stays up in the race, unanswered, before it fades (ms). [default] */
export const LOOK_OFFER_MS = 12_000;

const CSS = `
#ui { position: fixed; inset: 0; pointer-events: none; font: 600 1rem/1.3 system-ui, sans-serif; color: #fff;
  --hl-safe-t: env(safe-area-inset-top, 0px); --hl-safe-r: env(safe-area-inset-right, 0px);
  --hl-safe-b: env(safe-area-inset-bottom, 0px); --hl-safe-l: env(safe-area-inset-left, 0px);
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
#ui button, #ui input, #ui label { pointer-events: auto; font: inherit; }
#ui .screen { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
  justify-content: safe center; overflow-y: auto; gap: 10px; text-align: center; background: rgb(20 10 40 / 50%); z-index: 2;
  padding: 8px max(16px, env(safe-area-inset-right)) 8px max(16px, env(safe-area-inset-left)); box-sizing: border-box; }
#ui .screen[hidden], #ui [hidden] { display: none !important; }
#ui .title { font-size: 2rem; font-weight: 900; letter-spacing: 0.04em; text-transform: uppercase;
  background: #111; color: #f2ead8; padding: 2px 14px; transform: rotate(-1.5deg); box-shadow: 4px 4px 0 #e0543a; }
#ui .big, #ui .small { cursor: pointer; font-family: ui-monospace, 'Courier New', monospace; font-weight: 800;
  color: #111; background: #f2ead8; border: 3px solid #111; box-shadow: 3px 3px 0 #111; }
#ui .big { font-size: 1.375rem; min-height: 52px; padding: 8px 34px; background: #f5c542; }
#ui .small { font-size: 0.9375rem; min-height: 44px; padding: 6px 16px; }
#ui .big:active, #ui .small:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 #111; }
#ui .row { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
#ui .card { max-width: min(560px, 92vw); font: 500 0.8125rem/1.4 ui-monospace, 'Courier New', monospace; background: #000a;
  padding: 8px 12px; border: 1px dashed #fff8; text-align: left; box-sizing: border-box; }
#ui .card b { color: #f5c542; }
#ui .footer { position: absolute; bottom: 6px; left: 0; right: 0; font: 500 0.75rem ui-monospace, monospace; opacity: 0.8; }
#start-screen { pointer-events: auto; cursor: pointer; }
#region-picker { display: flex; flex-direction: column; align-items: center; gap: 6px; max-width: min(560px, 92vw); }
#region-picker .region-label { font: 800 0.75rem ui-monospace, 'Courier New', monospace; letter-spacing: 0.12em;
  text-transform: uppercase; background: #111; color: #f2ead8; padding: 1px 8px; transform: rotate(1deg); }
#region-picker .row { gap: 10px; }
#region-picker .region { font-size: 0.9375rem; }
#region-picker .region[aria-checked='true'] { background: #111; color: #f5c542; box-shadow: 3px 3px 0 #e0543a;
  transform: rotate(-1deg); }
#region-picker .region-blurb { font: italic 500 0.8125rem/1.3 ui-monospace, 'Courier New', monospace; color: #f2ead8;
  text-shadow: 1px 1px 0 #111; max-width: 100%; }
/* A short phone held sideways (568x320, 640x360): the menu was taller than the screen, so Settings
   sat below it (playtest 3, wave B's check F1). Short screens get a tighter menu: smaller title,
   buttons and chips (still 40 px or more to touch), one-line labels, a blurb clipped to two lines, and
   the what's-new card stacked under the menu instead of beside it (it would squeeze the region chips
   into a column), so the controls come first and the card is a scroll away. The screen also scrolls,
   which keeps a taller state reachable. The footer's build id keeps the bottom 22 px, and gives way to
   the card (the stamp carries the build id then). [default] */
@media (orientation: landscape) and (max-height: 380px) {
  #ui #menu { justify-content: safe center; overflow-y: auto; padding-top: 4px; padding-bottom: 22px; }
  #ui #menu > * { flex-shrink: 0; }
  #ui #menu.with-news { flex-direction: column; gap: 6px; }
  #ui #menu.with-news .footer { display: none; }
  #ui #menu .menu-main { gap: 3px; }
  #ui #menu .title { font-size: 1.25rem; padding: 1px 12px; }
  #ui #menu .big { font-size: 1.25rem; min-height: 42px; padding: 4px 28px; }
  #ui #menu .small { font-size: 0.8125rem; min-height: 40px; padding: 2px 12px; }
  #ui #menu #region-picker, #ui #menu #route-picker { gap: 2px; }
  #ui #menu #region-picker .row { gap: 6px; }
  #ui #menu #route-picker .route-row { gap: 6px; padding: 2px 4px 3px; }
  #ui #menu .region-label, #ui #menu .route-label { font-size: 0.6875rem; line-height: 0.8125rem; }
  #ui #menu .region-blurb, #ui #menu .route-blurb { font-size: 0.6875rem; line-height: 1.2; display: -webkit-box;
    -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
  #ui #menu #region-picker.route-picked .region-blurb { display: none; }
  #ui #menu #whats-new { width: min(560px, 100%); }
}
#start-controls { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 18px; }
#hud-speed, #hud-position, #hud-health, #hud-target { position: absolute; padding: 4px 10px; background: #0008;
  border-radius: 4px; white-space: nowrap; }
#hud-speed, #hud-position { font-size: 22px; font-weight: 800; }
#hud-health, #hud-target { font: 700 12px ui-monospace, monospace; width: 150px; box-sizing: border-box; }
.hud-bar { width: 130px; height: 9px; margin-top: 3px; background: #fff3; border: 1px solid #fff9; }
.hud-bar > div { height: 100%; width: 100%; background: #f5c542; }
#hud-target .hud-bar > div { background: #e0543a; }
#hud-target .hud-name { display: block; max-width: 130px; overflow: hidden; text-overflow: ellipsis; }
#hud-pause { position: absolute; top: 8px; right: max(8px, env(safe-area-inset-right)); width: 48px; height: 44px;
  pointer-events: auto; font: 900 1rem ui-monospace, monospace; color: #fff; background: #0008;
  border: 2px solid #fffa; border-radius: 6px; cursor: pointer; }
#hud-pause.mirrored { right: auto; left: max(8px, env(safe-area-inset-left)); }
#touch-surface { position: absolute; inset: 0; touch-action: none; }
#touch-surface[hidden] { display: none; }
.touch-button { position: absolute; border: 3px solid #fff; border-radius: 50%; background: #0004;
  display: flex; align-items: center; justify-content: center; font: 800 0.875rem ui-monospace, monospace;
  pointer-events: none; box-sizing: border-box; flex-direction: column; line-height: 1.1; }
.touch-hint { font: 700 10px ui-monospace, monospace; opacity: 0.85; }
.touch-small { font-size: 16px; }
.touch-small .touch-hint { font-size: 9px; }
#touch-stick-ring { position: absolute; width: ${STICK_RING_PX * 2}px; height: ${STICK_RING_PX * 2}px;
  margin: -${STICK_RING_PX}px 0 0 -${STICK_RING_PX}px; border: 3px solid #fffc; border-radius: 50%;
  background: #0003; pointer-events: none; box-sizing: border-box; }
#touch-stick-knob { position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; margin: -22px 0 0 -22px;
  border-radius: 50%; background: #fffa; }
${SETTINGS_CSS}
${CHANGELOG_CSS}
${TICKER_CSS}
${REDUCE_MOTION_CSS}
#results-tally { font: 800 0.9375rem ui-monospace, monospace; }
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
  /* The menu scrolls in its column when it is taller than the screen (the largest Text size on a
     640 x 360 phone put "Paused" 40 px above the top), as the cards beside it do. [default] */
  #pause-main { grid-column: 1; grid-row: 1; gap: 8px; max-height: 100%; overflow-y: auto; }
  #pause-main > * { flex-shrink: 0; }
  #pause-build { grid-column: 1; grid-row: 2; }
  #pause-cards { grid-column: 2; grid-row: 1 / 3; max-height: 100%; overflow-y: auto; gap: 8px; }
  /* Playtest 4's wheelie key made the legend 15 rows: one size down here keeps the open legend and
     the first "cut this" row on a 412 px high phone at once (they were 20 px short). [default] */
  #pause-keys .keys-grid { grid-template-rows: none; grid-template-columns: repeat(2, auto); grid-auto-flow: row;
    font-size: 0.75rem; line-height: 1.3; gap: 1px 14px; }
}
#resume-card { pointer-events: auto; background: rgb(10 5 20 / 85%); }
#busy { pointer-events: auto; background: rgb(10 5 20 / 85%); z-index: 5; }
#busy::before { content: ''; width: 36px; height: 36px; border: 5px solid #f2ead8; border-top-color: #f5c542;
  border-radius: 50%; animation: tb-spin 0.9s linear infinite; }
@keyframes tb-spin { to { transform: rotate(360deg); } }
#pause-build { font: 500 0.75rem ui-monospace, monospace; padding: 10px 14px; opacity: 0.75; pointer-events: auto;
  touch-action: none; }
#rotate-screen { flex-direction: column; gap: 18px; background: #140a28 !important; color: #f2ead8 !important;
  font: 900 1.375rem/1.3 system-ui, sans-serif !important; text-transform: uppercase; letter-spacing: 0.04em; }
#rotate-screen::before { content: ''; width: 44px; height: 76px; border: 4px solid #f2ead8; border-radius: 8px;
  animation: tb-rotate 2.2s ease-in-out infinite; }
@keyframes tb-rotate { 0%, 30% { transform: rotate(0deg); } 60%, 100% { transform: rotate(-90deg); } }
#ui .notice { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); }
/* The slow-frames offer (run W-O): above every layer; its buttons take touches only on themselves.
   Playtest 3's HUD rule (2026-10-03): nothing covers the road ahead (the middle half across, 25-65 %
   down) or another HUD piece. ui/hud-layout.ts settles where it goes and sets --hl-toast-* on #ui: on
   a screen wide enough for the ticker to sit inline it is the column under the position badge (the
   objective and the heat badge hold the other side), and on a narrow one it takes the ticker
   strip's slot, and the strip steps aside while it is up (its items keep their time). [default] */
#ui #look-offer { position: absolute; top: var(--hl-toast-y, calc(max(8px, env(safe-area-inset-top)) + 52px));
  left: var(--hl-toast-x, 12px); width: var(--hl-toast-w, max-content); max-width: var(--hl-toast-mw, 92vw);
  transform: translateX(var(--hl-toast-t, 0px)); z-index: 1; display: flex; flex-direction: column; gap: 4px;
  pointer-events: none; padding: 4px 8px; }
#ui .look-offer-text { font: 700 0.8125rem/1.3 system-ui, sans-serif; color: #f2ead8; }
#ui .look-offer .row { justify-content: flex-start; gap: 6px; }
#ui .look-offer .small { min-height: 40px; padding: 4px 8px; font-size: 0.8125rem; pointer-events: auto; }
/* The race's copy keeps the Normal size at every Text size: in the near column (148 px across on a
   640 x 360 phone) the larger words and buttons wrapped into a card 183 px tall, down onto the health
   bars. The pause menu's copy of the offer (#pause-look-offer) grows with the setting. [default] */
#ui #look-offer .look-offer-text, #ui #look-offer .small { font-size: 13px; }
#ui .look-offer .look-offer-classic { background: #f5c542; }
#ui[data-top='stacked']:has(> #look-offer:not([hidden])) #hud-ticker { visibility: hidden; }
#build-stamp.in-race { display: none; }
#build-stamp { pointer-events: none; font-size: 0.6875rem; line-height: 1.2; padding: 2px 6px; box-sizing: border-box;
  max-width: calc(100vw - 16px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)); }
#build-stamp.at-right { left: auto; right: max(8px, env(safe-area-inset-right)); text-align: right; }
#build-stamp.yield { display: none; }
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

type TickerSeamWindow = Window & {
  __GAME_TEST__?: boolean;
  __uiTicker?: (items: readonly TickerItem[], hold?: boolean) => void;
  __uiTickerQuiet?: boolean;
};

/**
 * The browser specs' ticker seam (docs/architecture.md, "Testing seams"), only when the test flag
 * is set before the page loads: `window.__uiTicker(items, hold = true)` drops what the strip shows
 * and shows these items instead, holding the first up (so a bark or a chip from the live race cannot
 * displace it while a spec measures it); `window.__uiTicker([])` clears it. And `__uiTickerQuiet`,
 * set by the spec's init script, mutes everything but the live style meter and a paid run's landing.
 * It writes no sim state.
 */
function installTickerSeam(replace: (items: readonly TickerItem[], hold?: boolean) => void): void {
  const w = window as TickerSeamWindow;
  if (w.__GAME_TEST__ === true) w.__uiTicker = replace;
}
const tickerQuiet = (): boolean => {
  const w = window as TickerSeamWindow;
  return w.__GAME_TEST__ === true && w.__uiTickerQuiet === true;
};

/**
 * The browser specs' stand-in radio (docs/architecture.md, "Testing seams"), only when the test
 * flag is set before the page loads: `window.__uiRadioSource`, set by the spec's init script, so the
 * pause menu's radio panel can be laid out and driven on its own. When planted it replaces app/'s
 * radio (wired since the integration round); a spec that plants none gets the real one.
 */
function testRadioSource(): RadioSource | null {
  const w = window as Window & { __GAME_TEST__?: boolean; __uiRadioSource?: RadioSource };
  return w.__GAME_TEST__ === true ? (w.__uiRadioSource ?? null) : null;
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
  const style = el('style', { textContent: CSS + ROUTE_PICKER_CSS + COUNTDOWN_CSS + MENU_FIRST_CSS });
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
  // The route picker (the maintainer, 2026-10-01: "Yes, add as routes"), under the regions. A real
  // road's blurb takes the region blurb's place, so one line of blurb shows at a time.
  const routePicker = createRoutePicker(
    (id, text, onClick) => button(id, 'small', text, onClick),
    (id) => cb.onRouteChange?.(id),
    (realRoadShown) => regionPicker.classList.toggle('route-picked', realRoadShown),
  );

  // ---- Menu --------------------------------------------------------------------------------
  // The what's-new card sits beside the menu (ui-3), so the Race button stays where it was.
  const whatsNewCard = createWhatsNewCard({
    onOpenChangelog: () => show('changelog'),
    onHide: () => menu.classList.remove('with-news'),
  });
  // The first run's first tap (playtest 4, P4-5): "Start career" until the career has started.
  const careerButton = button('menu-career', 'big', careerButtonText(false), () => cb.onCareer?.());
  const syncCareerButton = () => {
    const started = cb.careerStarted?.() ?? true;
    careerButton.textContent = careerButtonText(started);
    careerButton.classList.toggle(START_HERE_CLASS, !started);
  };
  syncCareerButton();
  const menu = el(
    'div',
    { id: 'menu', className: 'screen', hidden: true },
    el(
      'div',
      { className: 'menu-main' },
      el('div', { className: 'title', textContent: 'throttlebrawl' }),
      regionPicker,
      routePicker.root,
      el(
        'div',
        { className: 'row' },
        ...(cb.onCareer ? [careerButton] : []),
        button('menu-race', 'big', 'Race', () => cb.onRace()),
        // The menu race's options (playtest 4, P4-12 and P4-13), beside the Race they set up. Small, so
        // Start career stays the first big tap (P4-5).
        ...(cb.raceOptions ? [button('menu-options', 'small', 'Options', () => show('raceOptions'))] : []),
      ),
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
  // The view and the radio apply through their presentation sliders (camera.mode, audio.radio),
  // which app/ routes to camera/ and audio/ by the id's prefix. They apply at once and at boot.
  // A spec's planted stand-in wins over app/'s radio, so the layout spec drives a known playlist.
  const radioSource: RadioSource | null = testRadioSource() ?? cb.radio ?? null;
  const tuned = (id: 'view' | 'radio') => {
    const param = TUNED_SETTINGS[id];
    return param && opts.tuning.decl(param) ? param : null;
  };
  const applyView = () => {
    const param = tuned('view');
    if (param) opts.tuning.set(param, Math.max(0, VIEW_SETTINGS.indexOf(settings.view)));
  };
  /** Tunes the radio to a slider value, first catching the slider up with the R key's choice. */
  const tuneRadio = (choice: number) => {
    const param = tuned('radio');
    if (!param) return;
    const actual = radioSource?.state().choice;
    if (actual !== undefined && opts.tuning.get(param) !== actual) opts.tuning.set(param, actual);
    opts.tuning.set(param, choice);
    radioSource?.tune?.(choice);
  };
  /**
   * The radio setting: tunes when the radio is not on that kind, or (run W-P, W-O's mustFix) when it
   * plays another station than the saved one and the race's region offers the saved one.
   */
  const applyRadio = () => {
    const param = tuned('radio');
    if (!param) return;
    const live = radioSource?.state();
    const actual = live?.choice ?? opts.tuning.get(param);
    const want = radioChoiceFor(settings.radio, settings.radioStation, live?.stations ?? []);
    const offered = settings.radioStation !== null && (live?.stations ?? []).includes(settings.radioStation);
    const otherStation = settings.radio === 'station' && offered && Math.round(actual) !== want;
    if (radioSettingOf(actual) !== settings.radio || otherStation) tuneRadio(want);
  };
  const change = (c: SettingsChange) => {
    const next = applySettingsChange(settings, c);
    const mirrorChanged = next.mirror !== settings.mirror;
    const textChanged = next.textSize !== settings.textSize;
    // A pick in the View or Radio row always applies, even when it equals the saved value: the
    // live choice may have moved without the row (mustFix 1). Both are no-ops when already live.
    const picked = c.kind === 'set' ? c.id : null;
    const viewChanged = next.view !== settings.view || picked === 'view';
    const radioChanged = next.radio !== settings.radio || picked === 'radio';
    settings = next;
    if (mirrorChanged) {
      layout = { ...layout, mirror: next.mirror };
      placeAll();
    }
    if (textChanged) applyTextSize(true);
    if (viewChanged) applyView();
    if (radioChanged) applyRadio();
    settingsScreen.sync(settings);
    syncPauseEntries();
    cb.onSettingsChange?.(next);
  };
  /**
   * Catches the saved view and radio up with the live ones (GameUi.syncLive): the sliders follow
   * what already plays and shows, so nothing is re-applied, and the new record is saved.
   */
  const syncLive = (live: { view?: number } = {}) => {
    let next = settings;
    const view = live.view === undefined ? undefined : VIEW_SETTINGS[live.view];
    if (view && view !== next.view)
      next = applySettingsChange(next, { kind: 'set', id: 'view', value: view });
    const choice = radioSource?.state().choice;
    const radioParam = tuned('radio');
    if (choice !== undefined && radioParam) {
      // The slider follows the R key's choice (a station to another station keeps the setting).
      opts.tuning.set(radioParam, choice);
      const kind = radioSettingOf(choice);
      if (kind !== next.radio) next = applySettingsChange(next, { kind: 'set', id: 'radio', value: kind });
      // The exact station too (run W-P), kept while the score or off plays.
      const station = radioSource ? playingStation(radioSource.state()) : null;
      if (station !== null && station !== next.radioStation) next = { ...next, radioStation: station };
    }
    if (next === settings) return;
    settings = next;
    applyView();
    settingsScreen.sync(settings);
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
      live: [...(opts.liveSettings ?? []), ...tunedLive((id) => !!opts.tuning.decl(id))],
      persists: (id) => settingPersists(id, sanitiseSettings),
      preview,
    }),
  );
  settingsScreen.sync(settings);
  // The saved view and radio, at boot: app/ pushes every presentation value to its module next.
  applyView();
  applyRadio();
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
  // Playtest 2's heat meter (interview, 2026-10-02): a badge at the top centre, only while hot. It
  // loads the first time a race gets hot (a lazy chunk, off the first-load JavaScript budget).
  let heatBadge: HeatBadge | null = null;
  let heatBadgeLoading = false;
  const updateHeat = (law: SimSnapshot['law']) => {
    if (heatBadge) heatBadge.update(law);
    else if (!heatBadgeLoading && law && (law.heat > 0 || law.tier > 0)) {
      heatBadgeLoading = true;
      void import('./heat-badge').then((m) => {
        const style = document.createElement('style');
        style.textContent = m.HEAT_BADGE_CSS;
        document.head.append(style);
        heatBadge = m.createHeatBadge();
        hud.insertBefore(heatBadge.root, pauseButton);
      });
    }
  };
  // The race-start countdown's number (playtest 4, P4-11), small and beside the road ahead, never in it.
  const countdownView = createCountdownView();
  const pauseButton = el('button', { id: 'hud-pause', type: 'button', textContent: 'II' });
  pauseButton.setAttribute('aria-label', 'Pause');
  pauseButton.addEventListener('click', () => pause());
  // Playtest 3's wheelie gauge (T6.3): the one new widget, beside the floating stick, only while a
  // wheelie is up. ui/moves-meter.ts says where it stands (the layout's settle rule) and what it shows.
  // Its DOM and styles (moves-gauge.ts) are a lazy chunk, fetched now, in long before a race starts.
  let wheelieGauge: WheelieGauge | null = null;
  const hud = el(
    'div',
    { id: 'hud', hidden: true },
    speed,
    position,
    selfHealth.root,
    targetHealth.root,
    countdownView.root,
    pauseButton,
  );
  const hudPieces: Record<string, HTMLElement> = {
    speedometer: speed,
    position,
    'health-self': selfHealth.root,
    'health-target': targetHealth.root,
  };
  let targetShown = false;
  void import('./moves-gauge').then((m) => {
    style.textContent += m.movesMeterCss(GAUGE);
    wheelieGauge = m.createWheelieGauge();
    pauseButton.before(wheelieGauge.root);
    placeGaugeNow();
  });

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
  // The Text size setting (ui/text-size.ts): the HUD's text widgets draw `textScale` times as large,
  // as boxes (the record's own scale), so their bars and padding keep their proportions and every
  // box the layout settles (hud-layout.ts) is the size the widget paints.
  let textScale = 1;
  /**
   * Sets the factor everything draws with and the page's root size to match: menus, the ticker, the
   * objective and the heat badge size their type in rem, and the root is a percentage of the
   * browser's own default size, so a larger browser setting still counts. In a race the HUD's factor
   * is capped by the screen's height (`hudTextScale`), so a short phone keeps its road ahead clear.
   */
  const syncTextScale = (screenH: number) => {
    const size = textScaleOf(settings.textSize);
    textScale = current === 'race' ? hudTextScale(size, screenH) : size;
    const pct = textScale === 1 ? '' : `${Math.round(ROOT_FONT_PCT * textScale)}%`;
    if (document.documentElement.style.fontSize !== pct) document.documentElement.style.fontSize = pct;
    if (root.dataset['text'] !== settings.textSize) root.dataset['text'] = settings.textSize;
  };
  /** The Text size changed (or the screen did): draws it, and settles the HUD again when asked. */
  const applyTextSize = (settle: boolean) => {
    syncTextScale(window.innerHeight);
    if (!settle) return;
    placeAll();
    queueStampCheck();
  };
  applyTextSize(false);
  const TEXT_WIDGETS: readonly string[] = ['position', 'speedometer', 'health-self', 'health-target'];
  const elementOf = (name: string): LayoutElement | undefined => {
    const e = layout.elements.find((x) => x.element === name && x.visible);
    return e && TEXT_WIDGETS.includes(name) ? scaledElement(e, textScale) : e;
  };
  /** The touch buttons the record shows, each with its box as core settles it (input/ hit-tests these). */
  const touchButtonList = (w: number, h: number): { e: LayoutElement; r: Rect }[] => {
    const placed = placeTouchButtons(layout, w, h);
    const boxes: Record<string, Rect | null> = {
      'touch-attack': placed.attack,
      'touch-brake': placed.brake,
      'touch-wheelie': placed.wheelie,
    };
    return layout.elements.flatMap((e) => {
      const r = e.visible ? boxes[e.element] : null;
      return r ? [{ e, r }] : [];
    });
  };

  let gaugeBlock: GaugeBlockers | null = null;
  const placeAll = () => {
    const { w, h } = screenSize();
    syncTextScale(h);
    const unit = Math.min(w, h);
    // The touch buttons' boxes first: the text widgets settle off them (ui/hud-layout.ts, rule 6).
    // core settles the wheelie button off the other two (playtest 4); input/ hit-tests the same boxes.
    const touchRects = touchButtonList(w, h);
    const buttonBoxes = coarse
      ? touchRects.map(({ r }) => ({ left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h }))
      : [];
    // The top layout (ui/hud-layout.ts): the ticker, the slow-frames offer, the objective and the heat
    // badge take their slots from where the record puts the position badge and the rival's bar, which
    // moves off the position badge on a narrow screen. Slots are reserved whether shown or not.
    const inTopRow = (name: string, size: readonly [number, number]) => {
      const e = elementOf(name);
      return e && e.anchor.startsWith('top') ? placedBox(e, w, h, layout.mirror, size) : null;
    };
    const top = layoutTop({
      w,
      h,
      safe: readSafe(root),
      mirror: layout.mirror,
      position: inTopRow('position', HUD_SIZE.position),
      target: inTopRow('health-target', HUD_SIZE.health),
      textScale,
    });
    applyTopPlan(root, top, w);
    const bottomTexts = (['speedometer', 'health-self'] as const).flatMap((name) => {
      const e = elementOf(name);
      const size = name === 'speedometer' ? HUD_SIZE.speed : HUD_SIZE.health;
      return e && e.anchor.startsWith('bottom')
        ? [{ name, box: placedBox(e, w, h, layout.mirror, size) }]
        : [];
    });
    const lifts = settleLifts(bottomTexts, buttonBoxes);
    // The wheelie gauge keeps off everything placed here (T6.3): the top slots, the touch buttons and
    // the text widgets as lifted.
    gaugeBlock = gaugeBlockers({
      plan: top,
      position: inTopRow('position', HUD_SIZE.position),
      target: inTopRow('health-target', HUD_SIZE.health),
      buttons: buttonBoxes,
      text: bottomTexts.map(({ name, box }) => ({
        ...box,
        top: box.top - (lifts[name] ?? 0),
        bottom: box.bottom - (lifts[name] ?? 0),
      })),
    });
    placeGaugeNow();
    for (const [name, node] of Object.entries(hudPieces)) {
      const e = elementOf(name);
      const hide = !e || (e.touchOnly && !coarse) || (name === 'health-target' && !targetShown);
      node.hidden = !!hide;
      if (!e) continue;
      let placed = e;
      let mirror = layout.mirror;
      const lift = lifts[name] ?? 0;
      if (lift > 0) placed = { ...e, offset: [e.offset[0], e.offset[1] + lift / unit] };
      if (name === 'health-target' && top.target) {
        // Displaced off the position badge: it tops the column under the top row, on the pause button's side.
        const right = !layout.mirror;
        placed = {
          ...e,
          anchor: right ? 'top-right' : 'top-left',
          offset: [(right ? w - top.target.right : top.target.left) / unit, top.target.top / unit],
        };
        mirror = false;
      }
      Object.assign(node.style, hudStyle(placed, unit, mirror));
    }
    // The pause button sits in the top corner away from the position readout, and mirrors with it.
    pauseButton.classList.toggle('mirrored', layout.mirror);
    // The free stretch of the bottom band, between what stands in each bottom corner (the speed
    // readout's slot, the touch buttons): a very short screen lets the career prompt use all of it.
    let bandL = 0;
    let bandR = 0;
    const speedSlot = elementOf('speedometer');
    const corner: Box[] = [
      ...buttonBoxes,
      ...(speedSlot && speedSlot.anchor.startsWith('bottom')
        ? [placedBox(speedSlot, w, h, layout.mirror, HUD_SIZE.speed)]
        : []),
    ];
    for (const b of corner) {
      if ((b.left + b.right) / 2 < w / 2) bandL = Math.max(bandL, b.right);
      else bandR = Math.max(bandR, w - b.left);
    }
    root.style.setProperty('--prompt-l', `${Math.ceil(bandL)}px`);
    root.style.setProperty('--prompt-r', `${Math.ceil(bandR)}px`);
    for (const b of touchButtons.splice(0)) b.remove();
    // How far the touch buttons reach in from their side and up from the bottom (CSS px): the
    // pieces centred low between the bottom corners (the career prompt, the slow-frames toast) keep
    // inside them (the live check after #430: the in-air prompt ran under BRAKE). [default]
    let reach = 0;
    let rise = 0;
    const setReach = () => {
      root.style.setProperty('--touch-reach', `${Math.ceil(reach)}px`);
      root.style.setProperty('--touch-rise', `${Math.ceil(rise)}px`);
    };
    if (!coarse) {
      setReach();
      return;
    }
    for (const { e, r } of touchRects) {
      reach = Math.max(reach, r.x + r.w / 2 > w / 2 ? w - r.x : r.x + r.w);
      rise = Math.max(rise, h - r.y);
      const label = e.element === 'touch-attack' ? 'HIT' : e.element === 'touch-brake' ? 'BRAKE' : '▲';
      const b = el('div', { id: e.element, className: 'touch-button', textContent: label });
      // The kick hint (playtest 1, 2026-09-30: "Can't kick"): swipe down on the button to kick.
      if (e.element === 'touch-attack')
        b.append(el('span', { className: 'touch-hint', id: 'touch-kick-hint', textContent: '▼ kick' }));
      // Playtest 4's wheelie button: hold to lift the front, let go to drop it.
      // The hint word shows where the button is big enough to hold it (it shrinks on a 16:9 phone).
      if (e.element === 'touch-wheelie') {
        b.classList.add('touch-small');
        if (r.w >= WHEELIE_HINT_MIN_PX)
          b.append(el('span', { className: 'touch-hint', textContent: 'wheelie' }));
      }
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
    setReach();
  };
  window.addEventListener('resize', placeAll);

  // The stick ring: drawn where the left thumb lands inside the stick zone, the knob follows it.
  let stickPointer: number | null = null;
  let stickOrigin = { x: 0, y: 0 };
  // The gauge stands beside the ring while a thumb is down, and at the stick's resting spot otherwise
  // (a keyboard or gamepad rider's wheelie, and the layout check). Called from placeAll too.
  function placeGaugeNow() {
    if (!gaugeBlock) return;
    const { w, h } = screenSize();
    const zoneEl = elementOf('touch-stick-zone');
    const z = zoneEl ? placeElement(zoneEl, w, h, layout.mirror) : null;
    const zone: Box = z
      ? { left: z.x, top: z.y, right: z.x + z.w, bottom: z.y + z.h }
      : { left: 0, top: 0, right: 0.9 * Math.min(w, h), bottom: h };
    const spot = placeGauge({
      w,
      h,
      base: stickPointer !== null ? stickOrigin : restBase(zone, layout.mirror),
      mirror: layout.mirror,
      blockers: gaugeBlock,
      look: lookAheadBox(w, h),
      bike: bikeZoneBox(w, h),
      ringPx: STICK_RING_PX,
    });
    wheelieGauge?.place(spot?.box ?? null);
  }
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
    const inButton = touchButtonList(p.w, p.h).some(
      ({ r }) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h,
    );
    const z = placeElement(zone, p.w, p.h, layout.mirror);
    if (inButton || p.x < z.x || p.x > z.x + z.w || p.y < z.y || p.y > z.y + z.h) return;
    stickPointer = e.pointerId;
    stickOrigin = { x: p.x, y: p.y };
    Object.assign(ring.style, { left: `${p.x}px`, top: `${p.y}px` });
    knob.style.transform = '';
    ring.hidden = false;
    placeGaugeNow();
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
    placeGaugeNow();
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
      syncLive();
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
  // The radio panel (radio-1's follow-up): what plays, the next station, the next song and "cut
  // this" on the song. A station picked here becomes the saved radio choice. The panel is a lazy
  // chunk (radio-panel-view.ts, off the first-load JavaScript), fetched now, so it is in long before
  // a race can be paused; it slots in above the keyboard legend.
  let radioPanel: RadioPanel | null = null;
  void import('./radio-panel-view').then((m) => {
    style.textContent += m.RADIO_PANEL_CSS;
    radioPanel = m.createRadioPanel({
      tune: (choice) => {
        tuneRadio(choice);
        // The exact station is saved first (run W-P), so the kind's apply below keeps it.
        const stations = radioSource?.state().stations ?? [];
        const station =
          radioSettingOf(choice) === 'station'
            ? (stations[Math.round(choice) - RADIO_FIRST_STATION] ?? null)
            : null;
        const stationChanged = station !== null && station !== settings.radioStation;
        if (stationChanged) settings = { ...settings, radioStation: station };
        const kind = radioSettingOf(choice);
        if (kind !== settings.radio) change({ kind: 'set', id: 'radio', value: kind });
        else if (stationChanged) cb.onSettingsChange?.(settings);
      },
      onCut: (flag) => {
        settings = withVeto(settings, flag);
        cb.onSettingsChange?.(settings);
      },
    });
    radioPanel.setSource(radioSource);
    pauseKeys.before(radioPanel.root);
  });
  let radioTimer: ReturnType<typeof setInterval> | null = null;
  // The legend and the "recently seen" list (mounted below, once the narrative exists) share a
  // column, so on a short phone screen neither pushes the other off it (playtest 1c item 8). The
  // radio panel heads it: small, and the thing most often wanted mid-race.
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
    if (radioTimer !== null) clearInterval(radioTimer);
    radioTimer = null;
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
    // The slow-frames offer moves into the pause menu's cards (#pause-look-offer) for the rest of
    // the race, so the toast does not show through the pause screen.
    hideLookOffer();
    // The R key may have retuned the radio mid-race: the saved choice follows it.
    syncLive();
    // The radio's song and station can change while the panel is up (a station loading in).
    if (radioSource) {
      radioPanel?.refresh();
      radioTimer ??= setInterval(() => radioPanel?.refresh(), 500);
    }
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
  // The top ticker (playtest 3, the maintainer: "The black and white text pop-ups block the actual
  // game"; interview round 1 [decided]: "Top ticker strip": one line at a time along the top edge,
  // fading fast, the road kept clear, takedown names flashing briefly and small). Every in-race text
  // pop-up is an item in it: the barks (narrative/ shows them through `ticker.surface`), the style
  // chips ("NEAR MISS ×3 +$75", repeats merge), the takedown names and the live style meter (playtest
  // 1c, [decided]: "I'd like to also watch oncoming go up and up as you ride"; the sim computes the
  // meter's cash exactly as the award, #192, so when a run pays, its line lands on that cash). The
  // style pop-ups setting hides the chips and the meter (the tally still counts the cash).
  const ticker = createTickerUi({
    host: hud,
    nameMs: () => hudParam(opts.tuning, 'hud.tickerNameS') * 1000,
    quiet: tickerQuiet,
  });
  installTickerSeam((items, hold) => ticker.replace(items, hold));
  const meter = createStyleMeter();
  const driftMeter = createDriftMeter();
  const clearTicker = () => {
    meter.reset();
    driftMeter.reset();
    ticker.clear();
  };
  /** One frame of the ticker, from the player's run in progress, this frame's pop-ups and the moves. */
  const stepTicker = (
    run: EntitySnapshot['styleRun'],
    pops: readonly StylePop[],
    moves: SimSnapshot['moves'],
  ) => {
    ticker.setStyleEnabled(settings.stylePopups);
    ticker.setLook(settings.look);
    const step = meter.update(run, hudParam(opts.tuning, 'hud.meterShowAfterS'));
    const drift = driftMeter.update(moves);
    // The run stopped: if it paid, its pop-up is in this frame's feed (the sim emits the award on
    // the stretch's last tick, the same step whose snapshot first shows no run) and lands on the
    // meter's line; a run that never paid just goes. The drift chain ends the same way: it banks
    // (a `drift` pop in this frame's feed lands on its line) or a wipeout emptied it, which the
    // strip shows as DRIFT LOST (T6.3, the critic's C7: it "empties visibly on a wipeout").
    const ended = step.ended;
    let landing = !!ended && ended.qualifies && pops.some((p) => p.kind === ended.kind);
    const outcome = driftOutcome(drift, pops);
    let driftLanding = outcome === 'banked';
    if (outcome === 'lost') {
      ticker.push({ cls: 'style', text: DRIFT_LOST.text, kind: DRIFT_LOST.kind, cash: null });
    }
    ticker.meter(meterLine(drift, step.shown));
    const landMs = Math.round(hudParam(opts.tuning, 'hud.meterLandS') * 1000);
    for (const pop of pops) {
      let lands: boolean;
      if (pop.kind === 'drift') {
        lands = driftLanding;
        driftLanding = false;
      } else {
        lands = landing && pop.kind === ended?.kind;
        if (lands) landing = false;
      }
      ticker.push(popItem(pop, lands, landMs));
    }
    ticker.update(performance.now(), paused);
  };

  // ---- The slow-frames offer (run W-O) --------------------------------------------------------
  // The same card twice: a toast over the race, and a note in the pause menu's cards while the offer
  // stands. "Switch to Classic" sets the look (the Display tab's Look row follows); "No thanks" is
  // remembered in the record, so the offer never returns.
  const lookOfferCard = (id: string) => {
    const card = el(
      'div',
      { id, className: 'card look-offer', hidden: true },
      el('div', {
        className: 'look-offer-text',
        // Short enough for one line in the top slot on a small phone held sideways.
        textContent: 'Running slow? Classic is lighter.',
      }),
      el(
        'div',
        { className: 'row' },
        button(`${id}-classic`, 'small', 'Switch to Classic', () => answerLookOffer('classic')),
        button(`${id}-dismiss`, 'small', 'No thanks', () => answerLookOffer('dismiss')),
      ),
    );
    card.querySelector(`#${id}-classic`)?.classList.add('look-offer-classic');
    card.setAttribute('role', 'status');
    return card;
  };
  const lookOffer = lookOfferCard('look-offer');
  const pauseLookOffer = lookOfferCard('pause-look-offer');
  pauseCards.prepend(pauseLookOffer);
  let lookOfferTimer: ReturnType<typeof setTimeout> | null = null;
  const hideLookOffer = () => {
    if (lookOfferTimer !== null) clearTimeout(lookOfferTimer);
    lookOfferTimer = null;
    lookOffer.hidden = true;
  };
  const clearLookOffer = () => {
    hideLookOffer();
    pauseLookOffer.hidden = true;
  };
  function answerLookOffer(answer: 'classic' | 'dismiss') {
    clearLookOffer();
    if (answer === 'classic') change({ kind: 'set', id: 'look', value: 'classic' });
    else {
      settings = { ...settings, lookFallbackDismissed: true };
      cb.onSettingsChange?.(settings);
    }
  }
  const offerClassicLook = (): boolean => {
    if (settings.lookFallbackDismissed || settings.look === 'classic' || current !== 'race') return false;
    pauseLookOffer.hidden = false;
    // While paused only the pause menu's note shows it.
    lookOffer.hidden = paused;
    if (lookOfferTimer !== null) clearTimeout(lookOfferTimer);
    lookOfferTimer = setTimeout(hideLookOffer, LOOK_OFFER_MS);
    return true;
  };

  root.append(
    lookOffer,
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
  // The tuning panel (ui/tuning) is a lazy chunk, fetched as the game boots rather than in the
  // first-load bundle. A request to open it before the chunk arrives is kept and applied then.
  let realPanel: TuningPanel | null = null;
  let pendingOpen: boolean | null = null;
  void import('./tuning').then((m) => {
    realPanel = m.createTuningPanel(root, opts.tuning);
    if (pendingOpen !== null) realPanel.toggle(pendingOpen);
    pendingOpen = null;
  });
  const tuningPanel: GameUi['tuningPanel'] = {
    toggle(open) {
      if (realPanel) realPanel.toggle(open);
      else pendingOpen = open ?? !(pendingOpen ?? false);
    },
    get open() {
      return realPanel?.open ?? false;
    },
    get refreshHz() {
      return realPanel?.refreshHz ?? null;
    },
  };
  // narrative-2's "cut this": a cut goes into the settings record (the debug report lists it), and
  // the ticker's long-press ignores presses in the stick and attack zones mid-race.
  const barks = createNarrative({
    surface: ticker.surface,
    ...(opts.barkContent
      ? {
          barkSets: opts.barkContent.barkSets,
          riders: opts.barkContent.riders,
          bikes: opts.barkContent.bikes,
        }
      : {}),
    vetoed: settings.vetoes.map((v) => v.contentRef),
    onVeto: (flag) => {
      settings = withVeto(settings, flag);
      cb.onSettingsChange?.(settings);
    },
    inControlZone: (x, y) => {
      if (current !== 'race' || paused) return false;
      const box = touchSurface.getBoundingClientRect();
      const [px, py] = [x - box.left, y - box.top];
      const hit = (r: Rect) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
      const zone = elementOf('touch-stick-zone');
      if (zone && hit(placeElement(zone, box.width, box.height, layout.mirror))) return true;
      // The touch buttons (the wheelie button is held by design: a hold there is never a veto press).
      return touchButtonList(box.width, box.height).some(({ r }) => hit(r));
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

  // The R key retunes the radio inside audio/ (its own window listener, registered before this
  // one): the saved choice follows at once, not only when pause or settings opens (polish-1
  // follow-up). Checked after every key, since ui does not own the binding; a no-op unless the
  // radio's kind (score, station, off) changed.
  window.addEventListener('keydown', () => {
    if (radioSource) queueMicrotask(() => syncLive());
  });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || e.repeat) return;
    if (current === 'race') {
      if (!settingsScreen.root.hidden) closeSettings();
      else if (paused) resume();
      else pause();
    } else if (current === 'settings' || current === 'raceOptions') show('menu');
  });

  const screens: Record<Screen, HTMLElement[]> = {
    start: [start],
    menu: [menu],
    settings: [settingsScreen.root],
    race: [hud, touchSurface],
    results: [results],
    changelog: [changelogScreen.root],
    // Filled when the options screen's lazy chunk arrives (below).
    raceOptions: [],
    // Filled when the career's lazy chunk arrives (below).
    career: [],
    careerResults: [],
    teaser: [],
  };

  // The career (run W-R): a lazy chunk (the first-load JavaScript budget), fetched as the game
  // boots. Its screens go beside the others, its prompt and objective on the HUD; calls made before
  // it arrives wait for it.
  let realCareer: CareerScreens | null = null;
  const careerCalls: ((c: CareerScreens) => void)[] = [];
  const withCareer = (f: (c: CareerScreens) => void) => {
    if (realCareer) f(realCareer);
    else careerCalls.push(f);
  };
  const noop = () => undefined;
  void import('./career-screen').then((m) => {
    style.textContent += m.CAREER_CSS;
    const c = m.createCareerScreens(
      cb.career ?? {
        onRegion: noop,
        onRide: noop,
        onBack: () => show('menu'),
        onBuyBike: noop,
        onRideBike: noop,
        onBuyPaint: noop,
        onPaint: noop,
        onExport: () => Promise.resolve(''),
        onImport: () => Promise.resolve(''),
        onStartSeason: noop,
        onNewCareer: () => Promise.resolve(''),
        onRetry: noop,
        onMap: noop,
        onNext: noop,
        onNextRegion: noop,
      },
      (id, cls, text, onClick) => button(id, cls, text, onClick),
    );
    hud.append(c.overlays);
    // The pause screen's network map heads its cards (interview, 2026-10-02: "Maybe just map on pause").
    pauseCards.prepend(c.pauseMap);
    // Under the pause screen, the busy line and the notices, like the other screens.
    settingsScreen.root.before(c.map, c.results, c.teaser);
    screens.career.push(c.map);
    screens.careerResults.push(c.results);
    screens.teaser.push(c.teaser);
    c.map.hidden = current !== 'career';
    c.results.hidden = current !== 'careerResults';
    c.teaser.hidden = current !== 'teaser';
    realCareer = c;
    for (const f of careerCalls.splice(0)) f(c);
  });
  // The menu race's options (playtest 4, P4-12 and P4-13): a lazy chunk too, fetched as the game
  // boots. Each step is a new settings record, saved like a settings row, so the picks are
  // remembered between races; app/ reads them at the next menu race.
  let raceOptionsScreen: RaceOptionsScreen | null = null;
  let raceView: RaceOptionsView | null = null;
  const drawRaceOptions = () => {
    if (!raceOptionsScreen || !raceView) return;
    raceOptionsScreen.draw(raceOptionRows(raceView, settings), raceView.where);
  };
  const stepRaceOptions = (id: RaceOptionId, dir: 1 | -1) => {
    if (!raceView) return;
    const next = stepRaceOption(raceView, settings, id, dir);
    settings = next;
    settingsScreen.sync(settings);
    cb.onSettingsChange?.(next);
    drawRaceOptions();
  };
  if (cb.raceOptions)
    void import('./race-options-view').then((m) => {
      style.textContent += m.RACE_OPTIONS_CSS;
      const screen = m.createRaceOptionsScreen((id, cls, text, onClick) => button(id, cls, text, onClick), {
        onStep: stepRaceOptions,
        onBack: () => show('menu'),
        onRace: () => cb.onRace(),
      });
      settingsScreen.root.before(screen.root);
      screens.raceOptions.push(screen.root);
      screen.root.hidden = current !== 'raceOptions';
      raceOptionsScreen = screen;
      drawRaceOptions();
    });
  const career: CareerUi = {
    showMap: (v, g, t, s) => withCareer((c) => c.showMap(v, g, t, s)),
    showPauseMap: (v) => withCareer((c) => c.showPauseMap(v)),
    showResults: (r) => withCareer((c) => c.showResults(r)),
    showTeaser: (t) => withCareer((c) => c.showTeaser(t)),
    prompt: (t) => withCareer((c) => c.prompt(t)),
    setObjective: (t) => withCareer((c) => c.setObjective(t)),
    message: (t) => withCareer((c) => c.message(t)),
  };

  // The build stamp never covers a control (F1): it is a small label in a bottom corner, it never
  // takes a tap, and it steps to the other corner (or hides) when a control is under it. The menu's
  // and the pause screen's footers carry the build id too. Re-checked when a screen changes, the
  // window resizes, or a screen's content changes (a tab, the career map arriving).
  const STAMP_AVOIDS = 'button, input, select, textarea, label, summary, a, .footer, .setting-label, output';
  const boxOf = (r: DOMRect): Box => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  const STAMP_TEXT_SCREENS = [
    // The menu's words too: the title, the blurbs and the what's-new card (wave C's check: at 568x320
    // the stamp sat over the card's first line).
    '#menu:not([hidden]) *',
    '#race-options:not([hidden]) *',
    '#career:not([hidden]) *',
    '#career-results:not([hidden]) *',
    '#career-teaser:not([hidden]) *',
  ].join(', ');
  let stampQueued = false;
  const keepStampClear = () => {
    stampQueued = false;
    stamp.classList.remove('at-right', 'yield');
    if (current === 'race') return;
    const leftBox = boxOf(stamp.getBoundingClientRect());
    stamp.classList.add('at-right');
    const rightBox = boxOf(stamp.getBoundingClientRect());
    stamp.classList.remove('at-right');
    const controls: Box[] = [];
    for (const e of root.querySelectorAll<HTMLElement>(STAMP_AVOIDS)) {
      if (e.getClientRects().length === 0 || getComputedStyle(e).visibility === 'hidden') continue;
      if (e.classList.contains('footer')) {
        // A footer's box spans the screen; only its words are in the way.
        const words = document.createRange();
        words.selectNodeContents(e);
        controls.push(boxOf(words.getBoundingClientRect()));
      } else controls.push(boxOf(e.getBoundingClientRect()));
    }
    // The career screens scroll and are mostly words in cards, not controls: their words count too
    // (playtest 3, wave B's check: the stamp sat over a side-gig card's last line and a tier's LOCKED
    // header). Each line of text is its own box, so a card's blank corner never blocks the stamp.
    for (const e of root.querySelectorAll<HTMLElement>(STAMP_TEXT_SCREENS)) {
      if (e.getClientRects().length === 0 || getComputedStyle(e).visibility === 'hidden') continue;
      for (const n of e.childNodes) {
        if (n.nodeType !== Node.TEXT_NODE || (n.textContent ?? '').trim() === '') continue;
        const words = document.createRange();
        words.selectNodeContents(n);
        for (const r of words.getClientRects()) controls.push(boxOf(r));
      }
    }
    const spot = pickStampSpot({ left: leftBox, right: rightBox }, controls);
    if (spot === 'right') stamp.classList.add('at-right');
    else if (spot === 'hidden') stamp.classList.add('yield');
  };
  const queueStampCheck = () => {
    if (stampQueued || current === 'race') return;
    stampQueued = true;
    requestAnimationFrame(keepStampClear);
  };
  window.addEventListener('resize', queueStampCheck);
  // A scrolling screen (the career's) moves its words under the stamp without changing the DOM.
  root.addEventListener('scroll', queueStampCheck, { capture: true, passive: true });
  new MutationObserver(queueStampCheck).observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden', 'class'],
  });

  function show(screen: Screen) {
    current = screen;
    syncTextScale(window.innerHeight);
    for (const [name, els] of Object.entries(screens)) for (const e of els) e.hidden = name !== screen;
    if (paused) closePause();
    stamp.classList.toggle('in-race', screen === 'race');
    queueStampCheck();
    if (screen === 'settings') {
      syncLive();
      settingsScreen.sync(settings);
      settingsScreen.open('menu');
    }
    // A new race (or leaving one) starts the offer over; app/'s watch offers again if it must.
    clearLookOffer();
    countdownView.set(null);
    if (screen === 'race') {
      targetShown = false;
      tally.reset();
      tallyPlayer = -1;
      clearTicker();
      heatBadge?.reset();
      placeAll();
    }
    // The gauge shows only in a race, and only while a wheelie is up (updateRace draws it).
    if (screen !== 'race') wheelieGauge?.update(gaugeView(null, 0));
    if (screen === 'menu') {
      syncCareerButton();
      checkNews();
      offerNews();
    }
    if (screen === 'changelog') void loadChangelog().then((notes) => changelogScreen.setNotes(notes));
    // The choices follow the region and the road the menu has picked, and the garage.
    if (screen === 'raceOptions') {
      raceView = cb.raceOptions?.() ?? null;
      drawRaceOptions();
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
      updateHeat(snapshot.law);
      tallyPlayer = playerId;
      tally.noteSnapshotTally(player?.styleTally);
      stepTicker(player?.styleRun, tally.takePopups(), snapshot.moves);
      wheelieGauge?.update(gaugeView(snapshot.moves, player?.wheelie));
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
    offerClassicLook,
    setReduceMotion(on) {
      root.dataset['motion'] = on ? 'reduced' : 'full';
    },
    notice(text) {
      noticeBox.textContent = text;
      noticeBox.hidden = false;
      setTimeout(() => (noticeBox.hidden = true), 4000);
    },
    setCountdown: (text) => countdownView.set(text),
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
    ticker: { push: (item) => ticker.push(item) },
    setRegions,
    get region() {
      return region;
    },
    setRoutes: (routes, picked) => routePicker.set(routes, picked),
    get route() {
      return routePicker.route;
    },
    syncLive,
    applySavedRadio: applyRadio,
    career,
  };
}
