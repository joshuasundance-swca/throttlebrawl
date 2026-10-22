// app: boot, the loop, the state machine and the wiring of every module (docs/architecture.md,
// "Ownership table"). Capabilities the module map does not draw travel as plain callbacks typed in
// core (reached through sim/api): main.ts injects onCopyReport; app wires resumeAudio (audio ->
// platform), recordTuningChange (tuning -> replay and the sim), packIndex (content -> assets), and
// hands rendererStats, roadQueries and getReplayAndSettings to dev/ through the AppHandle. main.ts
// may also inject onSaveDebugFile (dev-3's "save debug file"); the AppHandle's replayFile() and
// checkReplay() let dev/ carry and verify the recording without importing replay/.
// app-2 owns this folder after app-1.
import { createAssetManifest, datasetIndex } from '../assets';
import type {
  AskDef,
  CareerDef,
  CareerNode,
  EventPlan,
  GarageResult,
  GigDef,
  ObjectiveStatus,
  Onboarding,
  RaceLog,
  RaceStatus,
  RivalText,
} from '../career';
import { createAudio, radioKeyAction, type AudioSuspendLeaseResult, type EngineSoundSpec } from '../audio';
import type { WakeLease, WakeLeaseResult } from '../platform';
import type { QualitySetting, RendererPresentationRecipe, RendererPresentationToken } from '../render';
import type { MeasurementSceneResult } from './measurement-scene';
import {
  createFollowCamera,
  loadReplayCamera,
  nearestFocus,
  shotFociOf,
  shotPose,
  SHOT_EASE_TICKS,
  SHOT_REACH_M,
  VIEW_MODES,
  type CameraMode,
  type CameraPose,
  type ShotFocus,
  type ViewMode,
} from '../camera';
import {
  assetIndex,
  contentHashes,
  createPackLibrary,
  loadBaseRoads,
  loadChunk,
  lookup,
  packClosure,
  packOf,
  packSubset,
  type ContentRegistry,
} from '../content';
import { createHaptics, createInput, keyMapFromBindings, type ActionState } from '../input';
import {
  APP_ID,
  acquireWakeLease,
  installOffer,
  keepAwake,
  paceBuildFetches,
  runStartTap,
  startOffline,
  watchLifecycle,
  type StaleBuild,
} from '../platform';
import {
  createQualityGovernor,
  createRenderer,
  interpolateEntity,
  loadAutoTier,
  riderLookOf,
  type BoardItem,
  type LookEnv,
  type QualityTierId,
  type RiderRigCounts,
  saveAutoTier,
} from '../render';
import {
  configFromHeader,
  createInputRecorder,
  createReplayController,
  decodeReplay,
  encodeReplay,
  recordingKey,
  type Recording,
} from '../replay';
import {
  audioVolumes,
  createProfileStore,
  createSettingsStore,
  PROFILE_VERSION,
  profileKey,
  sanitiseProfile,
  settingsAssists,
  type FrameRateCap,
  type Profile,
  type RaceWeather,
  type Settings,
} from '../save';
import { cameraTargetOf } from './camera-target';
import { browserControlDevice, controlOptionsOf, liveControlSettings } from './controls';
import { engineSoundsFor } from './engine-sounds';
import { createCountdown } from './countdown';
import { createLookFallback } from './look-fallback';
import {
  createSim,
  loadSimSteps,
  loadStructurePlanners,
  SIM_DT,
  type EventPatch,
  type FieldLevel,
  type GetReplayAndSettings,
  type OnCopyReport,
  type RendererStatsFn,
  type RoadQueriesFn,
  type Sim,
  type SimConfig,
  type SimEvent,
  type SimSnapshot,
  type TouchLayout,
} from '../sim/api';
import {
  createFrameGate,
  createPresetStore,
  createTuningRegistry,
  FRAME_DIVISOR_ID,
  REGISTRY_PRESET_ID,
  resolvePreset,
} from '../tuning';
import { createUi, finishShotHudOn, type ReplayAction } from '../ui';
import type { ReplayViewer } from './replay-viewer';
import { createReplayControls, replayKeyAction } from './replay-controls';
import {
  buildSimConfig,
  DEFAULT_EVENT,
  eventKey,
  networkKeyOf,
  qualifyIn,
  raceStartValues,
  raceTimeOfDay,
  withEventPatch,
} from './config';
import { motionAmounts, osPrefersReducedMotion } from './motion';
import { clearLoadRetry, failureOf, offerLoadRetry, routesNoteView, type LoadFailure } from './load-retry';
import { createLoop } from './loop';
import { createFrameObservation } from './frame-observation';
export type { AppDrawnFrame } from './frame-observation';
import type { AppDrawnFrame } from './frame-observation';
import { createRaceWakeSync } from './race-wake';
import { raceOptionsView } from './race-options';
import {
  huntMinimum,
  quickPlayEvent,
  quickPlayEvents,
  quickPlayObjective,
  quickPlaySetup,
} from './quick-play-events';
import { appReplayKey } from './replay-key';
import type { CareerFlow } from './career-flow';
import { createOutcome, raceResult, RESULTS_BEAT_TICKS, resultsDue } from './results';
import {
  boardCatalog,
  createStreamCache,
  narrativeSettingOf,
  raceRadio,
  raceSky,
  regionChoices,
  regionKeyOf,
  routeChoices,
  routeKeyOf,
  type RegionChoice,
} from './regions';
import { boardSpots, spotOn, withIncidentSites, withReceiptBoards } from './receipt-boards';
import { roadsForHeader } from './resume';
import { noteCareerProgress } from './race-progress';
import type { SavedRaceContext, SavedRaceEnvelope, SavedRaceRead, SavedRaceStore } from './saved-race';
import { createRaceSeeds, cryptoSeed, type SeedSource } from './seed';
import { reloadLosesNothing, transition, type AppEvent, type AppState } from './states';
import {
  createOutOfBounds,
  createSeenPoll,
  landingLineFor,
  landingLineItem,
  outOfBoundsLineFor,
  producerAskItem,
  producerThanksItem,
  resetOutOfBounds,
} from './ticker-feed';
import { APP_TUNING, presentationOwner } from './tuning';

export { createHeadlessRace } from './headless';
export type { HeadlessOptions, HeadlessRace } from './headless';
export {
  buildSimConfig,
  DEFAULT_EVENT,
  eventKey,
  qualifyIn,
  raceRouteKey,
  realRoutes,
  streamForEvent,
  streamForRoute,
} from './config';
export {
  boardCatalog,
  createStreamCache,
  racePalette,
  raceRadio,
  raceSky,
  regionChoices,
  regionKeyOf,
  routeChoices,
  routeKeyOf,
} from './regions';
export type { RaceRadio, RegionChoice, RouteChoice, StreamCache } from './regions';
export { resumeFromRecording, roadsForHeader } from './resume';
export type { ResumeResult, RoadsFor } from './resume';
export { planFrame, MAX_FRAME_S, MAX_STEPS_PER_FRAME } from './loop';
export { transition } from './states';
export type { AppState, AppEvent } from './states';
export { APP_TUNING } from './tuning';
export { createRaceSeeds, cryptoSeed } from './seed';
export type { RaceSeeds, SeedSource } from './seed';
export type { ActionState } from '../input';
export type * from './measurement-scene';

export interface AppBuild {
  id: string;
  channel: 'prod' | 'staging' | 'dev';
  branch: string;
  /** The sim chunk's code hash, the replay key's code part (absent or a placeholder in dev). */
  simCodeHash?: string;
}

/** Callbacks from the composition root (src/main.ts). */
export interface AppCallbacks {
  onCopyReport: OnCopyReport;
  /** Optional menu diagnostic; a delayed load must recheck this menu intent. */
  onMeasureFrames?: (stillCurrent: () => boolean) => Promise<void>;
  /** The pause screen's "save debug file" (dev-3). The button stays hidden without it. */
  onSaveDebugFile?: () => Promise<void>;
}

/** What replaying a recording against a fresh sim found (`AppHandle.checkReplay`). */
export interface ReplayCheck {
  /** Ticks stepped. */
  ticks: number;
  /** State hashes compared (every 60 ticks, plus the end once the race finished). */
  checked: number;
  /** The first checkpoint whose hash differs, or null when every hash matched. */
  desync: { tick: number; expected: number; actual: number } | null;
  /** The recording's replay key equals this build's. */
  keyMatches: boolean;
}

export interface AppOptions {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  build: AppBuild;
  callbacks: AppCallbacks;
  /**
   * A fixed race seed: every race uses it, so a test run repeats (the test flag passes 1). Left
   * out, each new race draws a fresh seed from `seedSource` (playtest 1c item 2).
   */
  seed?: number;
  /** Where a fresh race seed comes from when no seed is fixed (default: crypto random). */
  seedSource?: SeedSource;
  measurementSeedSource?: SeedSource;
}

export type TickDriver = (snapshot: SimSnapshot, actions: ActionState) => void;

type AppDeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly AppDeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: AppDeepReadonly<T[K]> }
      : T;

export type AppMeasurementScene = Extract<MeasurementSceneResult, { kind: 'ready' }>['scene'];

export interface AppMeasurementRepeatRequest {
  readonly index: number;
}

export interface AppMeasurementRequest {
  readonly signal: AbortSignal;
  readonly driverForRepeat: (repeat: Readonly<AppMeasurementRepeatRequest>) => TickDriver;
}

export type AppMeasurementRefusalReason =
  | 'aborted'
  | 'owner-busy'
  | 'not-menu'
  | 'wrong-ui-screen'
  | 'ui-paused'
  | 'normal-load-pending'
  | 'normal-launch-pending'
  | 'lifecycle-held'
  | 'renderer-context-lost'
  | 'lockstep-active'
  | 'superseded-before-start'
  | 'scene-refused'
  | 'wake-refused'
  | 'wake-lost-before-start'
  | 'audio-suspend-refused';

export interface AppMeasurementRefusal {
  readonly kind: 'refused';
  readonly reason: AppMeasurementRefusalReason;
  readonly sceneRefusal: AppDeepReadonly<Extract<MeasurementSceneResult, { kind: 'refused' }>> | null;
  readonly wakeRefusal: AppDeepReadonly<Extract<WakeLeaseResult, { kind: 'refused' }>> | null;
  readonly audioRefusal: AppDeepReadonly<Extract<AudioSuspendLeaseResult, { kind: 'refused' }>> | null;
}

export type AppMeasurementStopReason =
  | 'collector-target'
  | 'collector-deadline'
  | 'collector-bad-timestamp'
  | 'collector-overflow'
  | 'collector-feed-failed'
  | 'caller-cancelled';

export interface AppMeasurementRepeat {
  readonly index: number;
  readonly finalTick: number;
  readonly reason: 'finished' | 'busted' | 'session-ended';
}

export interface AppMeasurementRestoration {
  /** The ordinary state immediately before a superseding action is delivered. */
  readonly logical: 'menu';
  /**
   * 'restored' means reset + receipt application + one CPU renderer call completed.
   * It makes no GPU-completion or screen-presentation claim.
   */
  readonly visible: 'restored' | 'blocked-context' | 'draw-failed';
}

export interface AppMeasurementWorkload {
  readonly simulation: 'qualified-default-isolated-repeat';
  readonly replay: {
    readonly policy: 'omitted';
    readonly normalRecorder: 'untouched';
  };
  readonly audio: {
    readonly policy: 'omitted';
    readonly normalAudioPolicy: 'suspend-if-running';
    readonly commitEvidence: 'no-context-or-suspended-or-closed';
  };
  readonly graphics: {
    readonly policy: 'retain-current-setting';
    readonly governor: 'separate-fresh-windows';
    readonly frameDivisor: 1;
  };
}

export interface AppMeasurementRuntime {
  readonly phase: 'running' | 'ending' | 'ended';
  readonly repeatIndex: number;
  readonly tick: number;
  readonly countdown: boolean;
  readonly divisor: 1;
  readonly quality: {
    readonly setting: QualitySetting;
    readonly tier: QualityTierId;
    readonly scale: number;
    readonly pixelRatio: number;
  };
  readonly wake: WakeLease['state'];
}

export type AppMeasurementEnd =
  | {
      readonly kind: 'stopped';
      readonly reason: AppMeasurementStopReason;
      readonly endedAtMs: number;
      readonly repeats: readonly AppDeepReadonly<AppMeasurementRepeat>[];
      readonly restored: AppDeepReadonly<AppMeasurementRestoration>;
    }
  | {
      readonly kind: 'cancelled';
      readonly reason: 'signal' | 'manual-pause' | 'back' | 'quit' | 'superseded';
      readonly endedAtMs: number;
      readonly repeats: readonly AppDeepReadonly<AppMeasurementRepeat>[];
      readonly restored: AppDeepReadonly<AppMeasurementRestoration>;
    }
  | {
      readonly kind: 'failed';
      readonly reason:
        | 'hidden'
        | 'pagehide'
        | 'fullscreen'
        | 'rotate'
        | 'context-lost'
        | 'wake-lost'
        | 'wake-observation-failed'
        | 'synthetic-clock'
        | 'scene-drift'
        | 'driver-conflict'
        | 'action-gate-failed'
        | 'driver-factory-failed'
        | 'driver-failed'
        | 'draw-failed';
      readonly endedAtMs: number;
      readonly repeats: readonly AppDeepReadonly<AppMeasurementRepeat>[];
      readonly restored: AppDeepReadonly<AppMeasurementRestoration>;
    };

export type AppMeasurementEvent =
  | { readonly kind: 'repeat-start'; readonly index: number }
  | {
      readonly kind: 'repeat-end';
      readonly repeat: AppDeepReadonly<AppMeasurementRepeat>;
    }
  | {
      readonly kind: 'ended';
      readonly end: AppDeepReadonly<AppMeasurementEnd>;
    };

export interface AppMeasurementSession {
  readonly committedAtMs: number;
  readonly scene: AppMeasurementScene;
  readonly workload: AppDeepReadonly<AppMeasurementWorkload>;
  readonly ended: Promise<AppDeepReadonly<AppMeasurementEnd>>;
  inspect(): AppDeepReadonly<AppMeasurementRuntime>;
  subscribe(
    listener: (event: AppDeepReadonly<AppMeasurementEvent>) => void,
    onError: (error: unknown) => void,
  ): () => void;
  stop(reason: AppMeasurementStopReason): void;
}

export type AppMeasurementStart =
  AppMeasurementRefusal | { readonly kind: 'started'; readonly session: AppMeasurementSession };

export interface FrameStats {
  samples: number;
  p50: number;
  p95: number;
  max: number;
}

/**
 * What the presentation modules are doing (the integration round): the camera's chosen view and
 * the framing it shows, and the radio's region and stations. Read-only, for tests and dev/.
 */
export interface AppPresentation {
  /** `shake` is the reduce-shake amount app handed the camera (1 full, 0 none). */
  camera: { view: ViewMode; mode: CameraMode; shake: number };
  /**
   * The loop draws one animation frame in every `frameDivisor`. `quality` is the Graphics setting,
   * the tier and resolution scale drawn now, and the pixel ratio the scene draws at.
   */
  display: {
    frameDivisor: number;
    quality: { setting: string; tier: QualityTierId; scale: number; pixelRatio: number; on: boolean };
  };
  /**
   * Reduce motion as app handed it on (M5's a11y-1): `camera` is the camera's motion amount (1 full
   * lean roll and FOV kick, 0 softened), `calm` whether the picture's flashes and the HUD's
   * animations are calmed.
   */
  motion: { camera: number; calm: boolean };
  radio: { region: string | null; stations: string[]; tunedTo: string };
  /** The look render draws now (`classic`, `kodak`, ...). */
  look: string;
  /** The gains audio's buses aim for (0..1 after the taper): the voices bus is 0 while voices are off. */
  audio: {
    busTargets: { master: number; music: number; effects: number; voices: number };
    /** Whether audio would speak a bark now (not muted, and the voices bus up: Voices on, slider up). */
    voicesOn: boolean;
  };
  /** The real riders (run W-R): rigs built and drawn, triangles, models loaded or failed; null before
   * their code has loaded. */
  riders: RiderRigCounts | null;
}

/** What dev/ and main.ts may use. Read-only views plus the bot's driver hook. */
export interface AppHandle {
  beginMeasurement(request: AppMeasurementRequest): Promise<AppMeasurementStart>;
  readonly build: AppBuild;
  subscribeFrames(
    onFrame: (frame: Readonly<AppDrawnFrame>) => void,
    onError: (error: unknown) => void,
  ): () => void;
  state(): AppState;
  snapshot(): SimSnapshot | null;
  /** The last ~300 events, oldest first. */
  recentEvents(): readonly SimEvent[];
  playerId(): number;
  /** A driver that writes the action state once per sim tick from that tick's snapshot (the bot). */
  setTickDriver(driver: TickDriver | null): void;
  /** Called after every sim step with the new snapshot (the test handle's checks). */
  onStep(listener: ((snapshot: SimSnapshot, events: readonly SimEvent[]) => void) | null): void;
  setSeed(seed: number): void;
  /**
   * The time of day a free-play race of the menu's event draws with this seed (raceTimeOfDay), so a
   * browser test can pick its seed by the light it needs instead of pinning a lucky one.
   */
  freePlayTimeOfDay(seed: number): string;
  tap(): void;
  startRace(): void;
  backToMenu(): void;
  /** The career (run W-R): the profile, the career race in progress and its rules' status. */
  career(): {
    profile: Profile;
    racing: { region: string; node: string } | null;
    status: RaceStatus | null;
  };
  /** Starts a career race at a map node (tests and dev/); false when there is no such node. */
  rideCareer(region: string, node: string): boolean;
  /** Opens the career screen on a region (tests and dev/). */
  openCareer(region?: string): void;
  rendererStats: RendererStatsFn;
  roadQueries: RoadQueriesFn;
  getReplayAndSettings: GetReplayAndSettings;
  /** The last race's recording as the run-length-encoded replay file (plain JSON), or null. */
  replayFile(): unknown;
  /** Replays a replay file (parsed JSON) against a fresh sim of this build and compares hashes. */
  checkReplay(file: unknown): ReplayCheck;
  /** The viewer's own simulation, separate from the finished race (read-only dev/test evidence). */
  replayPlayback(): {
    tick: number;
    durationTicks: number;
    checked: number;
    complete: boolean;
    playing: boolean;
    mode: string;
  } | null;
  frameStats(): FrameStats;
  /** Wall-clock time of each of the last ~600 sim steps, ms (dev/perf's sim step timer). */
  stepTimes(): readonly number[];
  /**
   * The loop's lockstep (app/loop.ts; docs/architecture.md, "Testing seams"): n sim steps every
   * frame whatever the wall time, or null for real time. Only under the test flag; a no-op otherwise.
   */
  setLockstep(steps: number | null): void;
  lockstep(): number | null;
  contentHashes(): { sim: string; full: string };
  replayKey(): string;
  /** The camera's view and the radio's region and stations (tests and dev/). */
  presentation(): AppPresentation;
}

/**
 * The look fallback's watch runs in production always; under the test flag only when a spec asks
 * (`window.__lookFallbackWatch = true`). A software-rendered CI runner draws the ink look slowly
 * enough to bring the offer up in any long race, over other specs' checks (PR #232's first CI run).
 */
function lookWatchOn(): boolean {
  const w = window as Window & { __GAME_TEST__?: boolean; __lookFallbackWatch?: unknown };
  return w.__GAME_TEST__ !== true || w.__lookFallbackWatch === true;
}

/** The browser specs' test flag (Playwright's init script sets it before the page loads). */
function testFlagOn(): boolean {
  return (window as Window & { __GAME_TEST__?: boolean }).__GAME_TEST__ === true;
}

/**
 * The browser specs' forced slow frames (docs/architecture.md, "Testing seams"): with the test flag
 * set, `window.__slowFrameMs = 60` makes every rendered frame take at least that long (a busy wait),
 * so the look fallback's watch sees real slow frames through the real loop. 0 otherwise.
 */
function testSlowFrameMs(): number {
  const w = window as Window & { __GAME_TEST__?: boolean; __slowFrameMs?: unknown };
  if (w.__GAME_TEST__ !== true) return 0;
  const ms = w.__slowFrameMs;
  return typeof ms === 'number' && ms > 0 ? Math.min(ms, 500) : 0;
}

/**
 * The race-start countdown (playtest 4, P4-11): every race holds at the grid for 3, 2, 1, GO. Under
 * the test flag only when a spec asks (`window.__countdown = true`), so the specs that ride a race
 * from its first tick still do, and the one that checks the countdown does not wait out three seconds
 * of every race it starts.
 */
function countdownOn(): boolean {
  const w = window as Window & { __GAME_TEST__?: boolean; __countdown?: unknown };
  return w.__GAME_TEST__ !== true || w.__countdown === true;
}

/**
 * The newer-build offer on a result screen (ui `offerReload`): under the test flag, `window.__reloadOffer
 * = true` makes the result screen show it as if a deploy had landed mid-race, so a spec can measure
 * where the card sits on every result screen without a service worker or a simulated deploy. Its
 * Reload now does nothing. Never true in production (the flag needs `__GAME_TEST__`).
 */
function testReloadOffer(): boolean {
  const w = window as Window & { __GAME_TEST__?: boolean; __reloadOffer?: unknown };
  return w.__GAME_TEST__ === true && w.__reloadOffer === true;
}

/**
 * Quality tiers and dynamic resolution (roadmap M5; render/quality.ts) run in production always; under
 * the test flag only when a spec asks (`window.__dynamicResolution = true`), so the browser specs and
 * the perf check draw the `high` tier at full resolution whatever the runner's speed, and their draw
 * calls, triangles and screenshots never depend on it.
 */
function qualityOn(): boolean {
  const w = window as Window & { __GAME_TEST__?: boolean; __dynamicResolution?: unknown };
  return w.__GAME_TEST__ !== true || w.__dynamicResolution === true;
}

/** The settings' Frame rate as the loop's divisor. */
const FRAME_CAP_DIVISOR: Readonly<Record<FrameRateCap, number>> = { full: 1, half: 2, third: 3 };

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

function safeStorage(): Storage | null {
  try {
    const s = window.localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

/**
 * What the first screen needs before `createApp`: the Keys' hand-made road data, which ships as
 * JSON files beside the build instead of in the first-load JavaScript (run W-S), for the default
 * race and the menu's backdrop. main.ts awaits it; a failed fetch rejects and can be tried again.
 * The page's fetch goes to platform/'s loader first, so these 37 files get its rules too: no pacing
 * until the host asks, its waits, the retry and the offline caches' read (polish batch O's check,
 * punch item 3).
 */
export function loadBootContent(): Promise<void> {
  paceBuildFetches();
  return loadBaseRoads();
}

export function createApp(opts: AppOptions): AppHandle {
  const { build } = opts;
  let state: AppState = 'boot';
  let normalGeneration = 0;
  let normalContentGeneration = 0;
  let deliveryDepth = 0;
  let normalPose: CameraPose | null = null;
  type ReplayWatch = {
    abort: AbortController;
    screen: 'results' | 'careerResults';
    recipe: RendererPresentationRecipe;
    input: { release(): void };
    runtime: ReplayViewer | null;
    controls: ReturnType<typeof createReplayControls>;
    pose: CameraPose | null;
    alpha: number;
    preparing: boolean;
    interrupted: boolean;
    ground: ((x: number, z: number) => number | null) | null;
  };
  let replayWatch: ReplayWatch | null = null;
  let retireNormal = () => {};
  let measurement: ReturnType<typeof import('./measurement-runtime').createMeasurementRuntime> | null = null;
  let pendingMeasurement: {
    signal: AbortSignal;
    abort: () => void;
    generation: number;
    resolve: (start: AppMeasurementStart) => void;
    reject: (error: unknown) => void;
  } | null = null;
  const measurementRefusal = (reason: AppMeasurementRefusalReason): AppMeasurementRefusal =>
    Object.freeze({ kind: 'refused', reason, sceneRefusal: null, wakeRefusal: null, audioRefusal: null });
  const retireMeasurementEntry = (reason: AppMeasurementRefusalReason) => {
    const pending = pendingMeasurement;
    if (!pending) return;
    pendingMeasurement = null;
    pending.signal.removeEventListener('abort', pending.abort);
    pending.resolve(measurementRefusal(reason));
  };
  const actionGate = (action: import('./measurement-runtime').MeasurementAction, deliver: () => void) => {
    if (replayWatch) return;
    const prepareDelivery = () => {
      if (deliveryDepth === 0) {
        normalGeneration++;
        retireNormal();
        retireMeasurementEntry('superseded-before-start');
      }
    };
    const once = () => {
      deliveryDepth++;
      try {
        deliver();
      } finally {
        deliveryDepth--;
      }
    };
    if (measurement?.intercepted) measurement.action(action, once, prepareDelivery);
    else {
      // Raw controls do not replace an ordinary navigation or pending race launch.
      if (action !== 'raw') prepareDelivery();
      else retireMeasurementEntry('superseded-before-start');
      once();
    }
  };
  const captureNormal = () => {
    const generation = normalGeneration;
    return () => generation === normalGeneration && !measurement?.intercepted && !replayWatch;
  };
  // Background road requests survive menu navigation. Their pending ownership blocks
  // measurement entry; a measurement preparation still retires their content era.
  const captureNormalContent = () => {
    const generation = normalContentGeneration;
    return () => generation === normalContentGeneration && !measurement?.intercepted && !replayWatch;
  };
  // A fresh seed per race unless one is fixed (playtest 1c item 2); the seed goes into SimConfig,
  // so the recording's header carries it and replay and resume reproduce the race.
  const seeds = createRaceSeeds(opts.seed, opts.seedSource);

  // Content: every pack the build carries (base whole; a region pack's road data is fetched the
  // first time a race there starts), the regions the menu offers, and the race's event.
  const library = createPackLibrary({ includeDrafts: build.channel !== 'prod' });
  let registry = library.registry();
  const regions = regionChoices(registry).filter((r) => quickPlayEvents(registry, r.id).length > 0);
  const streams = createStreamCache();
  /** The race's content hashes: its own packs only, so the Keys' replay key never moves. */
  const raceHashes = (id: string) => contentHashes(packSubset(registry, packClosure(registry, packOf(id))));
  let eventId = eventKey(DEFAULT_EVENT);
  /**
   * The route picked on the menu (the maintainer, 2026-10-01: "Yes, add as routes"): a real road's
   * qualified route id, or null for the event's own road at the Race length setting. It resets to
   * null whenever the event (the region) changes, and lands in the replay header with the seed.
   */
  let route: string | null = null;
  let stream = streams.forEvent(registry, eventId);
  let event = lookup(registry.events, eventId);
  let hashes = raceHashes(eventId);
  let replayKey = appReplayKey(build, hashes.sim);
  const hudId = registry.packs[0]?.defaults.hud ?? 'classic';
  const hud = lookup(registry.hudLayouts, hudId);
  // The asset manifest: the renderer loads the Blender models through it (playtest 1c item 4), and
  // the big dataset files the build baked in (assets.lock.json, run W-Q) load through it by id too.
  const assets = createAssetManifest(() => [...assetIndex(registry), ...datasetIndex()]);

  // Settings, tuning and replay.
  const settingsStore = createSettingsStore({ keyPrefix: APP_ID, build: build.id, storage: safeStorage() });
  let settings = settingsStore.load();
  let quickSettings: Settings | null = null;
  let quickLog: RaceLog | null = null;
  let quickDone: number | null = null;
  let quickRetry: { eventId: string; route: string | null; settings: Settings } | null = null;
  // The career (run W-R): the profile record beside the settings, and every region's career map.
  let profileStore = createProfileStore({ keyPrefix: APP_ID, build: build.id, storage: safeStorage() });
  let profile: Profile = profileStore.load();
  const saveProfile = (next: Profile) => {
    if (attemptOwner?.terminal && !attemptOwner.settled) return false;
    profile = next;
    return profileStore.save(next);
  };
  /** A career has started once it owns a bike or has played a race (as src/career/ says). */
  const careerStarted = (p: Profile) => p.bikes.owned.length > 0 || p.history.length > 0;
  /**
   * The career's code and screens are a lazy chunk (the first-load JavaScript budget): fetched as
   * the game boots, like the tuning panel, and in long before a tap needs them. Until it is in,
   * `C` is null and the career waits for it.
   */
  let C: CareerFlow | null = null;
  let defs: CareerDef[] = [];
  /** A career race in progress: its map node, its rules' log and its prompts; null in free play. */
  let careerRace: {
    def: CareerDef;
    node: CareerNode;
    plan: EventPlan;
    length: string | null;
    /**
     * What the career's season and tier make of this race (playtest 3): the remix patch (null in
     * Season 1) and the field level (null with no starting bike to measure by). Both go into
     * buildSimConfig, so a restart and a replay header carry them.
     */
    patch: EventPatch | null;
    level: FieldLevel | null;
    log: RaceLog | null;
    onboarding: Onboarding;
    /** The tick its rules decided the event early (a hunt at its count, an escape), or null. */
    doneTick: number | null;
    headline: string;
    /**
     * The stream's quiet frame (run W-S; interview, 2026-10-02: "A quiet frame"): the producer's one
     * ask, judged by its own log from the moment it is asked, and the region's side gig (judged
     * silently from the race's tally at the end).
     */
    ask: AskDef | null;
    askLog: RaceLog | null;
    askMet: boolean;
    gig: GigDef | null;
  } | null = null;
  /** The rival texts after the last career race, shown on the map until the next one (run W-S). */
  let lastTexts: readonly RivalText[] = [];
  /** The region the career screen shows (bare id). */
  let careerRegion = '';
  /** A boss's teaser waiting for the results screen to be left. */
  let pendingTeaser: ReturnType<CareerFlow['teaserView']> = null;
  const layout: TouchLayout = { id: hud.id, mirror: settings.mirror || hud.mirror, elements: hud.elements };
  const recorder = createInputRecorder();
  const raceStorage = safeStorage();
  let recovery: typeof import('./race-recovery') | null = null;
  let recoveryResolved = false;
  let savedStore: SavedRaceStore | null = null;
  let savedRead: SavedRaceRead | null = null;
  let recoveryLocked = false;
  let initialAttemptRaw: string | null = null;
  let recoveryBusy = false;
  let savedTick: number | null = null;
  let staleReplayKey: string | null = null;
  let fastForward: { ticks: number; ms: number } | null = null;
  let saveNoticeShown = false;
  let recoveredTerminal: Recording | null = null;
  let attemptOwner: {
    sim: Sim;
    token: object;
    context: SavedRaceContext;
    canPersist: boolean;
    terminal?: Extract<SavedRaceEnvelope, { phase: 'pending-result' }>;
    settled: boolean;
  } | null = null;
  // Empty-slot boot stays cheap: no decoding or lazy-module wait before the ordinary Start tap.
  // A nonempty slot gets precedence over both pointer and keyboard Start until classified.
  try {
    initialAttemptRaw = raceStorage?.getItem(recordingKey(APP_ID)) ?? null;
    recoveryLocked = initialAttemptRaw !== null;
  } catch {
    /* Unknown storage leaves the menu usable; the store will keep writes disabled. */
  }
  const pendingTuning: { id: string; value: number }[] = [];
  // Every module's declarations (app/tuning.ts); the shipped preset (pack.json `defaults.tuning`)
  // under the device's saved one; exported presets carry this build's id.
  const shippedId = registry.packs[0]?.defaults.tuning ?? REGISTRY_PRESET_ID;
  const shippedPreset = resolvePreset(
    (id) => registry.tuningPresets[id.includes(':') ? id : `base:${id}`],
    shippedId,
  );
  const tuning = createTuningRegistry(
    APP_TUNING,
    (id, value) => {
      // A sim-affecting change mid-race: applied between steps and recorded at that tick.
      if (race) pendingTuning.push({ id, value });
    },
    {
      store: createPresetStore({ storage: safeStorage(), keyPrefix: APP_ID, build: build.id }),
      shippedPreset,
      build: build.id,
    },
  );
  // The frame-rate cap: the loop runs one animation frame in every `display.frameDivisor`.
  // The settings' Frame rate (full, half, a third) sets a floor under the panel's divisor.
  const frameDivisor = () => Math.max(tuning.get(FRAME_DIVISOR_ID), FRAME_CAP_DIVISOR[settings.frameRateCap]);
  const frameGate = createFrameGate(frameDivisor);

  // Presentation. The renderer gets the road files as set dressing (rails, ramp stripes).
  const renderer = createRenderer(opts.canvas, { assets });
  // The look (playtest 1b item 6): render only, applied at once and never part of SimConfig.
  let presentationToken: RendererPresentationToken | null = null;
  let presentationRecipe: RendererPresentationRecipe | null = null;
  let presentationConfig: Pick<
    RendererPresentationRecipe,
    'trafficTypes' | 'riderLooks' | 'playerPaint' | 'sceneSeed'
  > | null = null;
  let presentationRoad: Pick<RendererPresentationRecipe, 'road' | 'env' | 'dressing' | 'boards'> | null =
    null;
  const applyCompletePresentation = () => {
    if (!presentationConfig || !presentationRoad) return;
    presentationRecipe = {
      ...presentationRoad,
      ...presentationConfig,
      look: settings.look,
      quality: qualityOn() ? { ...quality.state } : { tier: 'high', scale: 1 },
    };
    presentationToken = renderer.applyPresentation(presentationRecipe, { reset: 'preserve' });
  };
  // Quality tiers and dynamic resolution (roadmap M5): `auto` starts on the tier this device settled
  // on last time; the governor judges each drawn frame's interval (in the loop's render, below).
  const quality = createQualityGovernor({
    setting: settings.qualityTier,
    autoTier: loadAutoTier(safeStorage(), APP_ID),
  });
  const applyQuality = (q: { tier: QualityTierId; scale: number }) => {
    if (qualityOn() && presentationToken) renderer.setPresentationQuality(presentationToken, q.tier, q.scale);
  };
  applyQuality(quality.state);
  let drawnTier = quality.state.tier;
  /** The canvas's width over its height, as the renderer's camera uses it. */
  const viewAspect = () => opts.canvas.clientWidth / Math.max(1, opts.canvas.clientHeight);
  const camera = createFollowCamera({ road: stream.road });
  let attractPose: CameraPose | null = null;
  /**
   * The finish shot (playtest 4, run C: a landmark by the line is too tall for the chase view): the landmarks of
   * the road that ask for it, and, once the player has finished within reach of one, the chase pose the camera
   * holds and the tick it began. Render only; the sim and the replay never read it.
   */
  let shotFoci: ShotFocus[] = [];
  let finishShot: { held: CameraPose; focus: ShotFocus; from: number } | null = null;
  /** The network the renderer and camera show, so a race in the same region rebuilds nothing. */
  let shownRoad: unknown = null;
  /** The time of day shown: the event's on the menu, the race's own in a free-play race (W-Q). */
  let shownTime = '';
  /** The receipts the boards were drawn with ('' outside a career race). */
  let shownReceipts = '';
  /** The weather shown: the menu race's pick (playtest 4, P4-12), else the region's own. */
  let shownWeather: RaceWeather = 'local';
  /** The event shown: its own weather is part of the sky (`raceSky`), so two events on one road differ. */
  let shownEvent = '';
  /**
   * The region's landing one-liners (playtest 3: they ride the top ticker, never the renderer's
   * overlay, which gets an empty pool). The last one shown, so it is not picked twice running.
   */
  let landingPool: readonly BoardItem[] = [];
  let lastLandingRef: string | null = null;
  /** Whether the player's fall out of bounds is being waited out (the line is said once a fall). */
  const outOfBounds = createOutOfBounds();
  /** The poll for the signs and billboards in view ("recently seen", the veto's list). */
  const seenPoll = createSeenPoll();
  /**
   * Shows the race's region: its road with the road files as set dressing (rails, ramp stripes),
   * its signs and billboards (minus this device's cuts), its time of day and palette.
   */
  const showRegion = (
    timeOfDay: string = String(event.timeOfDay),
    weather: RaceWeather = 'local',
    lengthId = settings.raceLength,
  ) => {
    // Run W-T: a career race shows the region's receipts on its boards, so they key the cache too.
    const receipts = careerRace && C ? JSON.stringify(profile.receipts.at(-1) ?? null) : '';
    if (
      shownRoad === stream.road &&
      shownTime === timeOfDay &&
      shownReceipts === receipts &&
      shownWeather === weather &&
      shownEvent === eventId
    ) {
      applyCompletePresentation();
      return;
    }
    shownRoad = stream.road;
    shownTime = timeOfDay;
    shownReceipts = receipts;
    shownWeather = weather;
    shownEvent = eventId;
    const regionKey = regionKeyOf(registry, eventId);
    const roadPack = packOf(networkKeyOf(registry, routeKeyOf(registry, eventId, lengthId, route)));
    const dressing = Object.fromEntries(
      stream.road.edges.map((e) => [e.id, lookup(registry.roads, qualifyIn(roadPack, e.id))]),
    );
    const vetoed = new Set(settings.vetoes.map((v) => v.contentRef));
    // `palette` is the region's colours (docs/content-packs.md, "Region packs at runtime",
    // Palette), which the renderer reads over the look's own (#205).
    // The weather is the menu race's pick (playtest 4, P4-12), else the event's own, else the light's
    // (`raceSky`): render only, so a dry race has neither the drizzle nor the rain on the helmet.
    const sky = raceSky(registry, eventId, timeOfDay, weather);
    const env: LookEnv & { palette: Record<string, string> } = {
      timeOfDay,
      palette: sky.palette,
      ...(sky.weather ? { weather: sky.weather } : {}),
    };
    // A world that keeps receipts (run W-T): in a career race, the boards nearest where a rival went
    // into a vehicle, or you were busted, say so.
    const boards =
      careerRace && C
        ? C.receiptBoards(
            registry,
            careerRace.def,
            profile.receipts,
            boardSpots(stream.road, dressing),
            spotOn(stream.road),
            vetoed,
          )
        : [];
    const regionBoards = boardCatalog(registry, regionKey, vetoed);
    landingPool = regionBoards.pools?.landing ?? [];
    const withBoards = withReceiptBoards(dressing, regionBoards, boards);
    // Run W-U: a bust also leaves an incident site (cones round an "INCIDENT SITE #n" placard) at
    // the very spot, on any road of the race.
    const onRace = new Set(stream.road.edges.map((e) => e.id));
    const sites =
      careerRace && C
        ? C.incidentSites(registry, careerRace.def, profile.receipts, (r) => onRace.has(r), vetoed)
        : [];
    const shown = withIncidentSites(stream.road, withBoards.dressing, withBoards.catalog, sites);
    presentationRoad = { road: stream.road, env, dressing: shown.dressing, boards: shown.catalog };
    applyCompletePresentation();
    camera.setRoad(stream.road);
    // The regional soundscape reads the road's scenery tags (bridges, water, cable lines, forest).
    audio.setRoad(stream.road, sky.wet);
    attractPose = null;
    // The landmarks of this road that ask for the finish shot (the camera's, never the sim's).
    shotFoci = shotFociOf(stream.road);
    finishShot = null;
    tuneRadio();
  };
  /** Makes `id` (a qualified event) the race's event; its pack's road data must be loaded. */
  const useEvent = (id: string) => {
    if (id === eventId) return;
    eventId = id;
    // A route belongs to its region: a new event starts on its own road.
    route = null;
    stream = streams.forEvent(registry, eventId, settings.raceLength);
    event = lookup(registry.events, eventId);
    hashes = raceHashes(eventId);
    replayKey = appReplayKey(build, hashes.sim);
    offerRoutes();
  };
  /**
   * The menu's route picker: the event's own road, then the real roads its region carries (once
   * the region's road data is in), the picked one kept while it is still offered.
   */
  const offerRoutes = () => {
    const choices = routeChoices(registry, eventId).filter(
      (c) => (event.kind !== 'takedown-hunt' && event.kind !== 'grudge-match') || c.id === null,
    );
    if (route && !choices.some((c) => c.id === route)) route = null;
    ui.setRoutes(
      choices.map((c) => ({ id: c.id, name: c.name, blurb: c.blurb })),
      route,
    );
  };
  const audio = createAudio();
  // The voices off switch (run W-O) silences the voices bus; the Voices slider keeps its level.
  audio.setVolumes(audioVolumes(settings), settings.mute);
  // The radio (M4 radio-1 head start): this device's cut tracks never play, and each race's region
  // picks its stations (the base pack's while a region has none of its own).
  const radioCut = (s: typeof settings) => s.vetoes.map((v) => v.contentRef);
  audio.setRadioCut(radioCut(settings));
  let radio = raceRadio(registry, regionKeyOf(registry, eventId));
  let radioRegion: string | null = null;
  /** Set once ui exists: re-tunes the saved station when a new region offers it (run W-P). */
  let retuneSavedRadio: (() => void) | null = null;
  const tuneRadio = () => {
    const regionKey = regionKeyOf(registry, eventId);
    if (regionKey === radioRegion) return;
    radioRegion = regionKey;
    radio = raceRadio(registry, regionKey);
    audio.setStations(radio.stations);
    audio.setRegion(radio.region);
    retuneSavedRadio?.();
  };
  tuneRadio();
  /**
   * Each rider's engine patch (audio keys them by rider content id): its drawn bike class's voice
   * from the base pack, else its bike file's own (./engine-sounds.ts; playtest 2: "a voice per bike").
   */
  const engineSounds = (config: SimConfig): Record<string, EngineSoundSpec> =>
    engineSoundsFor(registry, config.riders);

  /**
   * The models each rider draws with (run W-R; interview, 2026-10-02: "Real models now"): its own
   * rider model, and the bike its pack file's `look` names (render's `riderLookOf`).
   */
  const riderLooks = (config: SimConfig) =>
    config.riders.map((r) =>
      riderLookOf({
        contentId: r.contentId,
        role: r.role,
        bikeId: r.bike.contentId,
        look: (registry.riders[r.contentId] as { look?: unknown } | undefined)?.look,
      }),
    );

  let race: Sim | null = null;
  let prev: SimSnapshot | null = null;
  let curr: SimSnapshot | null = null;
  let recent: SimEvent[] = [];
  let playerId = 0;
  let stepListener: ((s: SimSnapshot, e: readonly SimEvent[]) => void) | null = null;
  let normalDriver: TickDriver | null = null;
  let normalInputDriver: ((actions: ActionState) => void) | null = null;
  let driverOwner: object | null = null;
  let diagnostic: {
    scene: Extract<MeasurementSceneResult, { kind: 'ready' }>;
    sim: Sim;
    prev: SimSnapshot | null;
    curr: SimSnapshot;
    playerId: number;
    camera: ReturnType<typeof createFollowCamera>;
    countdown: ReturnType<typeof createCountdown>;
    governor: ReturnType<typeof createQualityGovernor>;
    token: RendererPresentationToken;
    driver: TickDriver | null;
    index: number;
    owner: object;
  } | null = null;
  let measurementShield: HTMLElement | null = null;

  const newSim = (seed: number): Sim => {
    const pickedSettings = !careerRace && quickSettings ? quickSettings : settings;
    const raceTuning = { ...tuning.simValues(), ...raceStartValues(tuning.decls, (id) => tuning.get(id)) };
    const config = buildSimConfig(registry, stream, {
      seed,
      eventId,
      // The settings that feed SimConfig (M2 save-2 and ui-2; wired in the integration round). Each
      // applies at the next race start or restart, never mid-race, and lands in the replay header.
      // A career race runs its map node's length; free play the Race length setting.
      length: careerRace?.length ?? pickedSettings.raceLength,
      // The career's bike rides a career race (the garage, run W-R); a menu race rides the bike its
      // options picked, else the garage's, and takes their light, field, law and traffic (playtest 4,
      // P4-12 and P4-13: app/race-options.ts; every pick lands in this config or the replay header).
      // The grudges ride career races only (grudges outside a career are "light persistence, later"
      // [decided]).
      ...(careerRace
        ? profile.bikes.current
          ? { playerBike: profile.bikes.current }
          : {}
        : quickPlaySetup(
            registry,
            eventId,
            pickedSettings.raceOptions,
            profile.bikes,
            pickedSettings.quickPlayField ?? 'open',
            seed,
            pickedSettings.difficulty,
            raceTuning,
          )),
      ...(careerRace ? { grudges: profile.grudges } : {}),
      // The career's field level (the rivals' and cops' bikes and strength) and the season's remix.
      ...(careerRace?.level ? { fieldLevel: careerRace.level } : {}),
      ...(careerRace?.patch ? { eventPatch: careerRace.patch } : {}),
      // The road picked on the menu: a real road instead of the length's route (the replay header
      // records it as event.routeId).
      ...(route ? { route } : {}),
      difficulty: pickedSettings.difficulty,
      assists: [settingsAssists(pickedSettings)],
      speedMultiplier: pickedSettings.speedMultiplier,
      slowMo: pickedSettings.slowMo,
      // W-Q: a free-play race draws its rivals from the region's whole cast and its time of day from
      // the region's list, by the seed; a career race keeps its event's own field and time.
      ...(careerRace ? { freePlay: false } : {}),
      // The sim's values plus the difficulty scales, read once at race start (app-3).
      ...(careerRace ? { tuning: raceTuning } : {}),
    });
    playerId = config.riders.findIndex((r) => r.controller.kind === 'player');

    // The garage's paint on the player's bike (run W-R's garage; the seam from the rider-models lane).
    // The bike that rides wears the garage's paint for it (none on a bike the garage has not painted).
    const ridden = config.riders[playerId]?.bike.contentId ?? null;
    presentationConfig = {
      trafficTypes: config.trafficTypes,
      riderLooks: riderLooks(config),
      playerPaint: C
        ? C.currentPaintHex(defs, { ...profile, bikes: { ...profile.bikes, current: ridden } })
        : null,
      sceneSeed: seed,
    };
    // The roadside scenery scatters from the race's seed (playtest 1c item 2).

    audio.setEngineSounds(engineSounds(config));
    return createSim(config);
  };
  // The attract scene: the grid, before anyone moves.
  curr = newSim(seeds.next()).snapshot();
  showRegion();
  type MenuReceipt = {
    recipe: RendererPresentationRecipe;
    prev: SimSnapshot | null;
    curr: SimSnapshot;
    playerId: number;
    recent: readonly SimEvent[];
    pose: CameraPose;
  };
  let menuReceipt: MenuReceipt | null = null;
  const rememberMenu = () => {
    if (!curr || !presentationRecipe) return;
    const me = interpolateEntity(null, curr, 0, playerId);
    if (!me) return;
    attractPose ??= camera.snap(me, { aspect: viewAspect() });
    if (!attractPose) return;
    menuReceipt = { recipe: presentationRecipe, prev: null, curr, playerId, recent, pose: attractPose };
  };
  rememberMenu();

  // A build the host no longer serves (platform/stale-build.ts; playtest 4 run A fix check, new
  // mustFix 2 and punch item 1): the page reloads to the current build only when that loses nothing.
  // A race finishes on what it has loaded; a reload found mid-race waits, and the result screen says
  // so and offers it, so the result stays on screen until the player leaves it or taps Reload.
  let staleBuild: StaleBuild | null = null;
  const offerUpdate = () => {
    const watch = staleBuild;
    const forced = testReloadOffer();
    ui.offerReload(
      state !== 'results'
        ? null
        : forced
          ? () => undefined
          : watch?.waiting()
            ? () => void watch.reloadNow()
            : null,
    );
  };
  const go = (e: AppEvent) => {
    const next = transition(state, e);
    if (next) {
      state = next;
      if (state !== 'race') preparingGrid = null;
      frames.refresh();
      // A launch acquires only after its new snapshot and screen are ready; exits release now.
      if (state !== 'race') syncWake();
      // After the tap's own steps: Restart and Race again pass through the menu on their way back
      // into a race, and must not reload there.
      const current = captureNormal();
      if (staleBuild)
        queueMicrotask(() => {
          if (!current()) return;
          staleBuild?.settle();
          offerUpdate();
        });
    }
    return next !== null;
  };

  // What holds the game still: the pause screen (ui.paused), a hidden page, a lost WebGL context.
  // The loop and the sound run only when nothing holds them. A hidden page mid-race opens the pause
  // screen too, so coming back always lands behind the pause menu (docs/architecture.md, "Fixed
  // timestep and the loop": "a resume always lands behind the pause menu, never straight back into
  // a race").
  const holds = new Set<'hidden' | 'context'>();
  let loadingRoads = false;
  let pendingLoad: object | null = null;
  let pendingLaunch: object | null = null;
  const normalLoads = new Set<object>();
  const raceWake = createRaceWakeSync(keepAwake);
  const syncWake = () => raceWake(state, ui.paused, holds.size > 0);
  const syncRunning = () => {
    syncWake();
    if (holds.size > 0 || ui.paused) {
      loop.pause();
      frames.refresh();
      if (!replayWatch) audio.suspend();
      return;
    }
    loop.resume();
    frames.refresh();
    if (!replayWatch && !measurement?.owned && state !== 'boot' && state !== 'tapToStart')
      void audio.resume();
  };
  const hold = (reason: 'hidden' | 'context', on: boolean) => {
    if (on) holds.add(reason);
    else holds.delete(reason);
    syncRunning();
  };
  const unpause = syncRunning;
  const ui = createUi(opts.host, {
    actionGate,
    captureNormal,
    stampText: `throttlebrawl · ${build.channel} · ${build.branch} · ${build.id}`,
    layout,
    tuning,
    settings,
    // The control settings input-2 wired (#106); input itself is made after the ui, below, so the
    // vibration check asks input's haptics the same question on a throwaway (no side effects).
    liveSettings: [
      ...liveControlSettings(browserControlDevice(createHaptics().supported)),
      'look',
      // The race settings that feed SimConfig, and the two display ones (the integration round).
      'difficulty',
      'raceLength',
      'speedMultiplier',
      'assists.steer',
      // Playtest 4, P4-8: Arcade or Free, through settingsAssists into the slot's SimAssists.
      'steerStyle',
      'slowMo',
      'reduceShake',
      'reduceMotion',
      'frameRateCap',
      // Graphics (roadmap M5): Auto or a pinned quality tier, applied at once.
      'qualityTier',
      // The voices off switch (run W-O): the voices bus volume, above.
      'voicesOn',
    ],
    // The menu's region picker (#160): every carried region with an event, the Keys picked.
    regions: regions.map((r) => ({ id: r.id, name: r.name, ...(r.blurb ? { blurb: r.blurb } : {}) })),
    region: regionKeyOf(registry, eventId),
    // Every carried pack's bark sets, riders and bikes: a region race's locals talk too.
    barkContent: { barkSets: registry.barkSets, riders: registry.riders, bikes: registry.bikes },
    callbacks: {
      onRegionChange: (id) => pickRegion(id),
      onRouteChange: (id) => pickRoute(id),
      onStartTap: () => handle.tap(),
      onRace: () => handle.startRace(),
      ...(opts.callbacks.onMeasureFrames
        ? {
            onMeasureFrames: () => {
              const current = captureNormal();
              void opts.callbacks.onMeasureFrames!(
                () => current() && state === 'menu' && ui.screen() === 'menu',
              );
            },
          }
        : {}),
      onCareer: () => {
        const current = captureNormal();
        void careerReady.then(() => {
          if (current()) openCareer();
        });
      },
      // Menu first (playtest 4, P4-5): until the career has started the menu says "Start career".
      careerStarted: () => careerStarted(profile),
      // The menu race's options (playtest 4, P4-12 and P4-13) for the region picked on the menu (its
      // event, even before its road data is in) and the road picked there.
      // Install as an app (roadmap M5): the menu offers it only while the browser does.
      install: installOffer(),
      raceOptions: () => {
        const region = pickedChoice()?.id ?? regionKeyOf(registry, eventId);
        const chosen = quickPlayEvent(registry, region, settings.quickPlayKind ?? 'race');
        const at = chosen?.eventId ?? eventId;
        const view = raceOptionsView(registry, at, route, profile.bikes, settings.units);
        const e = registry.events[at]!;
        if (e.kind === 'grudge-match' || (e.kind === 'takedown-hunt' && Array.isArray(e.rules?.['targets'])))
          view.rivals = [];
        else if (e.kind === 'takedown-hunt')
          view.rivals = view.rivals.filter((c) => c.value === null || c.value >= huntMinimum(registry, at));
        return {
          ...view,
          kinds: quickPlayEvents(registry, region).map((c) => ({ value: c.kind, label: c.label })),
          objective: quickPlayObjective(registry, at),
          lawRequired: e.kind === 'cop-escape',
        };
      },
      career: {
        onRegion: (id) => openCareer(id),
        onRide: (nodeId) => {
          const def = C?.careerOf(defs, careerRegion);
          const node = def ? C?.nodeOf(def, nodeId) : null;
          if (def && node) startCareerRace(def, node);
        },
        onBack: () => ui.show('menu'),
        onBuyBike: (key) => C && garageAct(C.buyBike(registry, defs, profile, key)),
        onRideBike: (key) => C && garageAct(C.rideBike(profile, key)),
        onBuyPaint: (id) => C && garageAct(C.buyPaint(defs, profile, id)),
        onPaint: (id) => C && garageAct(C.paintBike(profile, profile.bikes.current, id)),
        onExport: async () => {
          if (!ordinaryAllowed()) return '';
          const current = captureNormal();
          const m = await careerReady;
          if (!current()) return '';
          if (!m) return '';
          if (!profileStore.record()) profileStore.save(profile);
          const rec = profileStore.record() ?? {
            format: 'profile' as const,
            version: PROFILE_VERSION,
            build: build.id,
            savedAt: new Date().toISOString(),
            data: profile,
          };
          return m.encodeExportCode({ profile: rec, settings: settingsStore.record() });
        },
        onImport: async (code) => {
          if (!ordinaryAllowed()) return 'Save or abandon the waiting result first.';
          const current = captureNormal();
          const m = await careerReady;
          if (!current()) return '';
          if (!m) return 'The career did not load. Reload the page and try again.';
          const r = await m.decodeExportCode(code);
          if (!current()) return '';
          if (r.kind === 'newer') return 'That code comes from a newer build. Nothing changed.';
          if (r.kind !== 'ok') return `That code did not load: ${r.reason}.`;
          // The career it replaces is kept as a backup code, so loading one never loses another.
          const replaced = profile.history.length > 0;
          const restored = await m.restoreCareer(
            defs,
            profile,
            r.profile,
            build.id,
            new Date().toISOString(),
          );
          if (!current()) return '';
          if (!ordinaryAllowed()) return 'Save or abandon the waiting result first.';
          saveProfile(restored);
          lastTexts = [];
          pendingTeaser = null;
          openCareer(careerRegion, 'garage');
          return (
            `Loaded: $${r.profile.cash}, ${r.profile.history.length} races. Your settings stay this device's.` +
            (replaced ? ' The career it replaced is kept as a backup code.' : '')
          );
        },
        onStartSeason: () => startNextSeason(),
        onNewCareer: () => startOver(),
        onRetry: () => {
          if (teaserFirst()) return;
          const def = C?.careerOf(defs, careerRegion);
          const last = profile.history.at(-1);
          const node = def && last?.node ? C?.nodeOf(def, last.node) : null;
          if (def && node) startCareerRace(def, node);
          else openCareer();
        },
        onMap: () => {
          if (!teaserFirst()) openCareer();
        },
        onNext: () => {
          if (teaserFirst()) return;
          const def = C?.careerOf(defs, careerRegion);
          const node = def ? C?.nextNodeOf(def, profile) : null;
          if (def && node) startCareerRace(def, node);
          else openCareer();
        },
        onNextRegion: (id) => openCareer(id),
      },
      onBackToMenu: () => handle.backToMenu(),
      onWatchReplay: () => void watchReplay(),
      onReplayAction: replayAction,
      onCopyReport: opts.callbacks.onCopyReport,
      ...(opts.callbacks.onSaveDebugFile ? { onSaveDebugFile: opts.callbacks.onSaveDebugFile } : {}),
      onPause: () => {
        flushAttempt();
        syncRunning();
        showPauseMap();
      },
      // The pause menu's radio panel (radio-1's follow-up): what plays, the next song, and "cut
      // this" on the song (its flag goes into the settings record through ui).
      radio: {
        state: () => audio.inspect().radio,
        skip: () => audio.skipTrack(),
        cut: () => audio.cutPlayingTrack(race ? `seed-${race.config.seed}` : '', race?.tick ?? 0),
      },
      onResume: unpause,
      onRestart: () => {
        if (!ordinaryAllowed() || !abandonOrdinaryAttempt()) return;
        // A career race restarts its own map node (the abandoned try pays nothing and records nothing).
        const c = careerRace;
        if (c && state === 'race') {
          go('back');
          startCareerRace(c.def, c.node);
          syncRunning();
          return;
        }
        if (go('back')) handle.startRace();
        syncRunning();
      },
      onQuit: () => {
        if (careerRace && state === 'race') quitCareerRace();
        else handle.backToMenu();
        syncRunning();
      },
      onSettingsChange: (next) => {
        const changedKind = next.quickPlayKind !== settings.quickPlayKind;
        const changedLook = next.look !== settings.look;
        settings = next;
        settingsStore.save(next);
        audio.setVolumes(audioVolumes(next), next.mute);
        input.setLayout({ ...layout, mirror: next.mirror || hud.mirror });
        input.setOptions(controlOptionsOf(next));
        if (changedLook) applyCompletePresentation();
        if (state === 'menu') rememberMenu();
        const q = quality.setSetting(next.qualityTier);
        if (q) {
          drawnTier = q.tier;
          applyQuality(q);
        }
        applyShake(next);
        audio.setRadioCut(radioCut(next));
        if (changedKind && state !== 'race' && ordinaryAllowed()) showPicked();
      },
    },
  });
  retuneSavedRadio = () => ui.applySavedRadio();
  if (settingsStore.notice) ui.notice(settingsStore.notice);
  // A career record from a newer build is kept untouched; one that cannot be stored says so.
  else if (profileStore.notice) ui.notice(profileStore.notice);
  // Touch, keyboard, the gamepad and (when chosen) tilt; haptics answer the player's events (input-2).
  const input = createInput({
    keys: window,
    surface: ui.touchSurface,
    layout,
    controls: controlOptionsOf(settings),
  });

  function replayPads(): readonly (Gamepad | null)[] {
    try {
      return typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    } catch {
      return [];
    }
  }
  function offerReplay(): void {
    const recording = recoveredTerminal ?? recorder.current();
    ui.setReplayAvailable(
      state === 'results' &&
        !!recording?.end &&
        !recoveryLocked &&
        !recoveryBusy &&
        !(attemptOwner?.terminal && !attemptOwner.settled),
    );
  }
  function restoreReplay(watching: ReplayWatch): void {
    if (replayWatch !== watching) return;
    replayWatch = null;
    watching.abort.abort();
    if (!watching.runtime) watching.input.release();
    try {
      presentationRecipe = watching.recipe;
      presentationToken = renderer.applyPresentation(watching.recipe, { reset: 'replay-boundary' });
    } finally {
      go('return');
      ui.show(watching.screen);
      syncRunning();
      frames.invalidate();
    }
  }
  function replayAction(action: ReplayAction): void {
    const watching = replayWatch;
    if (!watching) return;
    if (action === 'return') {
      if (watching.runtime) watching.runtime.dispose();
      else restoreReplay(watching);
    } else if (action === 'toggle') watching.runtime?.toggle();
    else if (action === 'camera') watching.runtime?.cycleCamera();
    else void watching.runtime?.restart();
  }
  async function watchReplay(): Promise<void> {
    const screen = ui.screen();
    const recording = recoveredTerminal ?? recorder.current();
    if (
      replayWatch ||
      state !== 'results' ||
      (screen !== 'results' && screen !== 'careerResults') ||
      !ordinaryAllowed() ||
      !recording?.end ||
      !presentationRecipe ||
      !curr ||
      !race ||
      pendingMeasurement ||
      measurement?.owned ||
      normalLoads.size > 0
    )
      return;
    const inputLease = input.acquireSuspendLease();
    if (!go('watch')) {
      inputLease.release();
      return;
    }
    const watching: ReplayWatch = {
      abort: new AbortController(),
      screen,
      recipe: presentationRecipe,
      input: inputLease,
      runtime: null,
      controls: createReplayControls(replayPads()),
      pose: null,
      alpha: 1,
      preparing: true,
      interrupted: false,
      ground: null,
    };
    replayWatch = watching;
    ui.updateReplay({ status: 'loading', camera: 'trackside', elapsedSeconds: 0, durationSeconds: 0 });
    ui.show('replay');
    const current = () => replayWatch === watching && !watching.abort.signal.aborted;
    try {
      const [owner, playback, cameras] = await Promise.all([
        loadChunk('replay viewer', () => import('./replay-viewer')),
        loadChunk('replay playback', () => import('./replay-playback')),
        loadReplayCamera(),
      ]);
      if (!current()) return;
      if (!owner || !playback) throw new Error('Replay code unavailable');
      const runtime = owner.createReplayViewer({
        acquireInput: () => inputLease,
        acquireAudio: (signal) => audio.acquireSuspendLease({ signal }),
        acquireWake: acquireWakeLease,
        held: () => holds.size > 0 || renderer.contextLost || document.visibilityState !== 'visible',
        prepare(signal) {
          if (!current() || signal.aborted) throw new Error('Replay entry retired');
          const session = playback.createReplayPlayback({
            recording,
            expectedReplayKey: appReplayKey(build, raceHashes(recording.header.eventId).sim),
            roadsFor: roadsForHeader(registry, streams),
            createSimulation: createSim,
          });
          const camera = cameras.createReplayCamera({ road: session.sim.config.road });
          camera.setMotionAmount(motionNow.camera);
          return Promise.resolve({ playback: session, camera });
        },
        commit() {
          if (!current()) throw new Error('Replay entry retired');
          presentationToken = renderer.applyPresentation(watching.recipe, { reset: 'replay-boundary' });
          // Highest known land is conservative under overhead decks; an unsafe cinematic then
          // falls back to follow. Unknown ground remains unknown, never a clearance proof.
          watching.ground = (x, z) => renderer.groundHeightAt(x, z, Infinity);
          watching.preparing = true;
          if (watching.interrupted) {
            runtime.pause();
            watching.interrupted = false;
          }
        },
        restore: () => restoreReplay(watching),
        show: (view) => {
          if (current()) ui.updateReplay(view);
        },
        resetClock: () => {
          loop.pause();
          syncRunning();
        },
        invalidatePose: () => {
          watching.pose = null;
        },
        entryFailed: () => ui.notice('The replay could not start. Your result is unchanged.'),
      });
      watching.runtime = runtime;
      await runtime.start();
    } catch {
      if (!current()) return;
      if (watching.runtime) watching.runtime.dispose();
      else restoreReplay(watching);
      ui.notice('The replay could not start. Your result is unchanged.');
    }
  }

  // Presentation-only tuning (camera, audio, input thresholds, barks, visuals) applies at once; sim values
  // go through the recorder above. Boot values (a shipped or saved preset) are pushed once here.
  // Routed by id prefix: each module owns its prefix, and barks refuse ids they do not declare.
  const applyPresentationParam = (id: string, value: number) => {
    const owner = presentationOwner(id);
    if (owner === 'camera') camera.setParam(id, value);
    else if (owner === 'audio') audio.setParam(id, value);
    else if (owner === 'input') input.setParam(id, value);
    else if (owner === 'barks') ui.narrative.setParam(id, value);
    else if (owner === 'render') renderer.setParam(id, value);
  };
  // Reduce screen shake [decided]: no shake and no hit jolt (camera-2's setShakeAmount 0). Reduce motion
  // (M5's a11y-1) takes the shake with it, softens the chase cameras' roll and FOV kick, and calms the
  // flashes (app/motion.ts). [default]
  let shakeAmount = 1;
  let motionNow = { camera: 1, calm: false };
  function applyShake(s: typeof settings) {
    const amounts = motionAmounts(s, osPrefersReducedMotion());
    shakeAmount = amounts.shake;
    motionNow = { camera: amounts.motion, calm: amounts.calm };
    camera.setShakeAmount(amounts.shake);
    camera.setMotionAmount(amounts.motion);
    renderer.setReduceMotion(amounts.calm);
    ui.setReduceMotion(amounts.calm);
  }
  applyShake(settings);
  tuning.onChange(applyPresentationParam);
  for (const d of tuning.decls) if (!d.affectsSim) applyPresentationParam(d.id, tuning.get(d.id));

  // The player's own finish or bust (app/results.ts): results, or "Busted" and the fine.
  let outcome = createOutcome();
  const finishRace = () => {
    if (!race || !curr || !go('finished')) return;
    const owner = attemptOwner;
    if (owner?.sim === race && !owner.terminal && recovery) {
      const recording = recorder.file();
      if (recording?.end) {
        owner.terminal = {
          format: 'saved-race',
          version: recovery.SAVED_RACE_VERSION,
          logicVersion: recovery.RESUME_LOGIC_VERSION,
          phase: 'pending-result',
          recording,
          context: owner.context,
          savedHash: race.hash(),
          result: { build: build.id, at: new Date().toISOString() },
        };
        const written = owner.canPersist ? savedStore?.save(owner.terminal) : undefined;
        if (written?.ok) savedTick = written.tick;
      }
    }
    if (careerRace) {
      settleCareerRace(false);
      return;
    }
    ui.showResults({
      ...raceResult(curr, playerId, outcome, {
        id: event.id,
        name: event.name,
        byPlaceCash: event.rewards.byPlaceCash,
      }),
      ...(quickLog && event.kind !== 'classic-race'
        ? { objectiveState: quickLog.status().state, objective: quickLog.status().headline }
        : {}),
    });
    ui.show('results');
    if (owner) {
      owner.settled = true;
      if (owner.canPersist && !forgetOwnedSlot()) {
        recoveryLocked = true;
        savedRead = savedStore?.read() ?? null;
        ui.notice('This result is complete, but its saved attempt could not be removed.');
      }
    }
    offerReplay();
  };

  const lookWatch = createLookFallback();
  const stepMs: number[] = [];
  // The race-start countdown: a beat is a second of loop steps; GO stays up for 0.8 s of race.
  const countdown = createCountdown(Math.round(1 / SIM_DT), Math.round(0.8 / SIM_DT));
  // The ordinary countdown waits for its own grid's first completed CPU draw. Key the hold to
  // the sim so a draw interrupted by a restart cannot release the replacement race.
  let preparingGrid: Sim | null = null;
  const frames = createFrameObservation(() => ({
    state,
    measurementLive: measurement?.running === true,
    race: diagnostic !== null || race !== null,
    snapshot: diagnostic?.curr !== undefined || curr !== null,
    tickZero: (diagnostic?.curr ?? curr)?.tick === 0,
    uiPaused: ui.paused,
    loopPaused: loop.paused,
    hidden: holds.has('hidden'),
    contextHold: holds.has('context'),
    loading: loadingRoads,
    visible: document.visibilityState === 'visible',
    contextLost: renderer.contextLost,
    countdown:
      diagnostic?.countdown.holding ?? ((preparingGrid === race && race !== null) || countdown.holding),
    lockstep: loop.lockstep,
  }));
  // The view key (C) or gamepad button: the camera's next view (camera-3). Not a race input. It
  // becomes the saved View, so the settings row shows it and a pick there takes effect; it works
  // on the grid too.
  const cycleViewOnPress = () => {
    if (input.lastActions().cycleCamera) ui.syncLive({ view: VIEW_MODES.indexOf(camera.cycleView()) });
    // The pad's pause button (2026-10-05; the keyboard's pause keys are ui's own): the pause screen.
    if (input.lastActions().pause) ui.pause();
  };
  const step = () => {
    if (replayWatch) {
      if (!replayWatch.preparing && renderer.physicalWorldReady?.() !== false) {
        const viewer = replayWatch.runtime;
        const session = viewer?.prepared?.playback;
        const before = session?.curr.tick;
        viewer?.step();
        if (session && session.curr.tick !== before) renderer.pushEvents(session.sim.events());
      }
      return;
    }
    if (measurement?.running) {
      const d = diagnostic;
      const current = measurement.current();
      if (!d) return;
      if (driverOwner !== d.owner || loop.lockstep !== null) {
        measurement.fail('driver-conflict');
        return;
      }
      if (renderer.physicalWorldReady?.() === false) {
        input.sample(SIM_DT);
        if (input.lastActions().pause) measurement.action('manual-pause', () => {});
        return;
      }
      const grid = d.countdown.step();
      measurement.progress(d.curr.tick, d.countdown.holding);
      const cmd = input.sample(SIM_DT);
      if (!current() || diagnostic !== d) return;
      if (input.lastActions().pause) {
        measurement.action('manual-pause', () => {});
        return;
      }
      if (grid.hold) {
        frames.refresh();
        return;
      }
      d.sim.step([cmd]);
      d.prev = d.curr;
      d.curr = d.sim.snapshot();
      measurement.progress(d.curr.tick, d.countdown.holding);
      frames.refresh();
      const events = d.sim.events();
      d.camera.onEvents(events);
      renderer.pushEvents(events);
      const player = d.curr.entities[d.playerId];
      const busted = events.some((e) => e.type === 'bust' && e.target === d.playerId);
      if (d.sim.isOver() || player?.finished || busted) {
        measurement.repeatEnd(busted ? 'busted' : 'finished');
        if (!current() || diagnostic !== d) return;
        startMeasurementRepeat(d.index + 1);
      }
      return;
    }
    if (measurement?.owned) return;
    if (!race) return;
    if (renderer.physicalWorldReady?.() === false) {
      input.sample(SIM_DT);
      cycleViewOnPress();
      return;
    }
    if (preparingGrid === race) {
      input.sample(SIM_DT);
      cycleViewOnPress();
      return;
    }
    for (const change of pendingTuning.splice(0)) {
      race.applyParam(change.id, change.value);
      recorder.recordParam(race.tick, change.id, change.value);
    }
    // The countdown (playtest 4, P4-11): a held step is not a sim step. The sim waits at tick 0 for
    // everyone, nothing is recorded, and what the player pressed is read and dropped.
    const grid = countdown.step();
    frames.refresh();
    if (grid.beat !== null) audio.countdownBeat(grid.beat);
    if (grid.show !== undefined) ui.setCountdown(grid.show);
    if (grid.hold) {
      input.sample(SIM_DT);
      cycleViewOnPress();
      return;
    }
    const tick = race.tick;
    const cmd = input.sample(SIM_DT);
    recorder.record(tick, [cmd]);
    cycleViewOnPress();
    const t0 = performance.now();
    race.step([cmd]);
    stepMs.push(performance.now() - t0);
    if (stepMs.length > 600) stepMs.shift();
    prev = curr;
    curr = race.snapshot();
    frames.refresh();
    const events = race.events();
    if (events.length) {
      recent = recent.concat(events).slice(-300);
      ui.narrative.onEvents(events, {
        snapshot: curr,
        seed: race.config.seed,
        setting: narrativeSettingOf(registry, eventId),
      });
      camera.onEvents(events);
      audio.onEvents(events, curr);
      renderer.pushEvents(events);
      input.onEvents(events, playerId);
      noteLanding(events);
      noteOutOfBounds(events);
    }
    // The wheelie's band, every step (null while none): the buzz when it turns high is a swing.
    input.onMoves(curr.moves);
    if (tick % 60 === 0) recorder.checkpoint(tick, race.hash());
    outcome.note(events, playerId, tick);
    noteCareer(events, tick);
    if (quickLog) {
      quickLog.note(events, curr);
      const status = quickLog.status();
      ui.career.setObjective(status.headline);
      if (status.endNow && quickDone === null) quickDone = tick;
    }
    stepListener?.(curr, events);
    const careerDone = careerRace?.doneTick ?? null;
    if (
      resultsDue(outcome, tick, race.isOver()) ||
      (careerDone !== null && tick >= careerDone + RESULTS_BEAT_TICKS) ||
      (quickDone !== null && tick >= quickDone + RESULTS_BEAT_TICKS)
    ) {
      recorder.finish(tick, race.hash());
      finishRace();
    } else if (race.tick % 300 === 0) flushAttempt();
  };

  const loop = createLoop(
    {
      stepping: () =>
        replayWatch
          ? replayWatch.runtime?.playing === true
          : measurement?.running === true || state === 'race',
      step,
      shouldRunFrame: () => measurement?.running === true || frameGate.shouldRun(),
      render(alpha, dt, timestampMs, synthetic) {
        const watching = replayWatch;
        if (watching) {
          for (const action of watching.controls.poll(replayPads())) {
            if (replayWatch !== watching) break;
            replayAction(action);
          }
          if (replayWatch !== watching) return;
          const viewer = watching.runtime;
          const prepared = viewer?.prepared;
          if (!prepared) {
            if (normalPose) renderer.render(null, curr, 1, normalPose);
            return;
          }
          const p = prepared.playback;
          if (viewer.playing || !watching.pose) {
            watching.alpha = viewer.playing ? alpha : 1;
            const me = interpolateEntity(p.prev, p.curr, watching.alpha, p.playerId);
            if (me)
              watching.pose = prepared.camera.pose(
                cameraTargetOf(me, p.curr.entities[p.playerId]),
                (Math.max(0, p.curr.tick - 1) + watching.alpha) * SIM_DT,
                viewer.mode,
                {
                  entities: p.curr.entities,
                  aspect: viewAspect(),
                  structures: renderer.structures(),
                  ...(watching.ground ? { groundHeightAt: watching.ground } : {}),
                },
              );
          }
          frames.draw(timestampMs, synthetic, watching.pose !== null, () => {
            if (watching.pose) renderer.render(p.prev, p.curr, watching.alpha, watching.pose);
          });
          if (watching.pose && !renderer.contextLost && renderer.physicalWorldReady?.() !== false)
            watching.preparing = false;
          return;
        }
        if (measurement?.running) {
          const d = diagnostic;
          const current = measurement.current();
          if (!d) return;
          if (synthetic) {
            measurement.fail('synthetic-clock');
            return;
          }
          if (
            !preparationIntent ||
            preparationIntent.generation !== normalGeneration ||
            preparationIntent.region !== ui.region ||
            preparationIntent.route !== route ||
            ui.screen() !== 'menu'
          ) {
            measurement.fail('scene-drift');
            return;
          }
          const me = interpolateEntity(d.prev, d.curr, alpha, d.playerId);
          const pose = me
            ? d.camera.update(cameraTargetOf(me, d.curr.entities[d.playerId]), dt, {
                entities: d.curr.entities,
                aspect: viewAspect(),
                structures: renderer.structures(),
              })
            : null;
          try {
            frames.draw(timestampMs, synthetic, pose !== null, () => {
              if (pose) renderer.render(d.prev, d.curr, alpha, pose);
            });
          } catch {
            if (current() && diagnostic === d) measurement.fail('draw-failed');
            return;
          }
          if (!current() || diagnostic !== d) return;
          const q = d.governor.frame(dt * 1000, {
            racing: !d.countdown.holding && d.curr.tick > 0,
            divisor: 1,
          });
          if (q) renderer.setPresentationQuality(d.token, q.tier, q.scale);
          return;
        }
        if (measurement?.owned) return;
        const normalAtDraw = normalGeneration;
        const me = curr ? interpolateEntity(state === 'race' ? prev : null, curr, alpha, playerId) : null;
        const gridAtDraw =
          state === 'race' && preparingGrid === race && me && !renderer.contextLost ? race : null;
        let pose: CameraPose | null = attractPose;
        if (me && state === 'race') {
          // The low chase cam reads the road (look-ahead), the rider's mode and auto-target (framing
          // bias) and the other riders' positions (camera-1).
          const at = curr?.entities[playerId];
          // Playtest 3's moves (the drift's slip and the wheelie's angle) lean the camera in too.
          pose = camera.update(cameraTargetOf(me, at), dt, {
            entities: curr?.entities,
            // The held look-back action (camera-1's lookBack: L, or the pad's R1).
            lookBack: input.lastActions().lookBack,
            // The view's shape: a wide phone-landscape view gets a higher camera (playtest 1 item 11).
            aspect: viewAspect(),
            // The race's structures plan, as the renderer read it: the eye stays out of the buildings and off the
            // road far below a roof (the physical world, 2026-10-06; camera/solids.ts).
            structures: renderer.structures(),
          });
          // The finish shot: past the line (never a bust), a landmark within reach is framed whole.
          if (shotFoci.length > 0 && outcome.doneTick !== null && !outcome.bust && race) {
            if (!finishShot) {
              const focus = nearestFocus(shotFoci, me.x, me.z, SHOT_REACH_M);
              if (focus) finishShot = { held: pose, focus, from: outcome.doneTick };
            }
            if (finishShot)
              pose = shotPose(
                finishShot.held,
                finishShot.focus,
                viewAspect(),
                (race.tick - finishShot.from) / SHOT_EASE_TICKS,
              );
          }
        } else if (me && !attractPose) pose = attractPose = camera.snap(me, { aspect: viewAspect() });
        // While the shot frames the landmark the HUD and the touch buttons are hidden (the results bring the screen back).
        ui.setFinishShot(finishShotHudOn(state, finishShot));
        frames.draw(timestampMs, synthetic, pose !== null, () => {
          if (pose) normalPose = pose;
          if (pose) renderer.render(state === 'race' ? prev : null, curr, alpha, pose);
        });
        if (normalAtDraw !== normalGeneration || measurement?.owned) return;
        if (
          gridAtDraw !== null &&
          gridAtDraw === race &&
          gridAtDraw === preparingGrid &&
          pose !== null &&
          !renderer.contextLost &&
          !ui.paused &&
          !loop.paused &&
          holds.size === 0 &&
          document.visibilityState === 'visible'
        ) {
          preparingGrid = null;
          frames.refresh();
        }
        // The engines (yours and the nearest riders'), the siren, horns and the music (audio-1).
        audio.frame(state === 'race' ? curr : null, playerId);
        // The whole-snapshot HUD: speed, "1st / N" among the racers (not the traffic), your health
        // and your target's.
        if (state === 'race' && curr) ui.updateRace(curr, playerId, settings.units);
        // The signs and billboards in view, every 30 frames of a race, into the veto's "recently seen".
        if (state === 'race' && !ui.paused) {
          for (const seen of seenPoll.frame(() => renderer.visibleContent())) ui.narrative.noteSeen(seen);
        }
        // The look fallback (run W-O): frames that stay slow on an ink look bring up ui's offer to
        // switch to Classic, once a race, unless the player said no before.
        const racing = state === 'race' && !ui.paused && holds.size === 0;
        const inkLook = settings.look !== 'classic' && !settings.lookFallbackDismissed && lookWatchOn();
        if (lookWatch.frame(dt * 1000, { racing, inkLook, divisor: frameDivisor() })) {
          // The offer is ui's toast (one tap to Classic, or "No thanks"); the strip does not repeat it.
          ui.offerClassicLook();
        }
        // Dynamic resolution and `auto`'s tier: this frame's interval against the display's budget.
        if (qualityOn()) {
          const q = quality.frame(dt * 1000, { racing, divisor: frameDivisor() });
          if (q) {
            // `auto`'s tier is kept per device for the next race; a resolution step is not stored.
            if (settings.qualityTier === 'auto' && q.tier !== drawnTier)
              saveAutoTier(safeStorage(), APP_ID, q.tier);
            drawnTier = q.tier;
            if (presentationToken) renderer.setPresentationQuality(presentationToken, q.tier, q.scale);
          }
        }
        const slowMs = testSlowFrameMs();
        if (slowMs > 0) {
          const until = performance.now() + slowMs;
          while (performance.now() < until) {
            // the forced slow frame
          }
        }
      },
    },
    SIM_DT,
  );

  watchLifecycle({
    // An app switch, a screen lock, a lost fullscreen or the rotate screen: mid-race the pause
    // screen opens, so the player comes back to it and resumes by choice.
    onHidden: (reason) => {
      if (replayWatch && !replayWatch.runtime) replayWatch.interrupted = true;
      replayWatch?.runtime?.pause();
      retireMeasurementEntry('superseded-before-start');
      if (measurement?.owned) measurement.fail(reason === 'visibility' ? 'hidden' : reason);
      flushAttempt();
      if (state === 'race') ui.pause();
      hold('hidden', true);
    },
    onShown: () => hold('hidden', false),
  });
  retireNormal = () => {
    pendingLaunch = null;
    if (pendingLoad) {
      pendingLoad = null;
      loadingRoads = false;
      frames.refresh();
      ui.setBusy(null);
    }
  };
  // Offline play (roadmap M5): a production build's worker caches the whole build once the page
  // has loaded, so a loaded game plays with the network off; and the watch for a build the host no
  // longer serves, which reloads to the current one when that loses nothing.
  staleBuild = startOffline(
    build.id,
    () => !pendingMeasurement && !measurement?.owned && reloadLosesNothing(state),
  );
  staleBuild?.onWaiting(offerUpdate);
  // A lost WebGL context holds the game until the renderer has rebuilt the scene (render-1).
  renderer.onContextChange((lost) => {
    if (lost && replayWatch && !replayWatch.runtime) replayWatch.interrupted = true;
    if (lost) replayWatch?.runtime?.pause();
    if (lost) retireMeasurementEntry('superseded-before-start');
    if (lost && measurement?.owned) measurement.fail('context-lost');
    hold('context', lost);
  });
  window.addEventListener('resize', () => renderer.resize());

  // The region picker (playtest 1c): a pick fetches that region's road data in the background,
  // and the menu's backdrop shows its road once loaded; Race starts there.
  /** A build whose files are gone (a 404 or 410): the did-not-load card's Reload, for the newest build. */
  const reloadPage = () => window.location.reload();
  const pickedChoice = (): RegionChoice | undefined => {
    const picked = ui.region;
    return picked ? regions.find((r) => r.id === picked) : undefined;
  };
  /**
   * Road data arrived (a region's, or the Keys' real roads, run W-P): the registry now holds it, so
   * the race's content hashes and replay key are recomputed (a pack's hash covers its road data) and
   * the route picker offers the real roads that came in.
   */
  const roadsArrived = (reg: ContentRegistry) => {
    registry = reg;
    clearLoadRetry(ui);
    sayPickedRoads();
    // A race keeps the key it started under (its packs' roads were all in before it started).
    if (state === 'race') return;
    hashes = raceHashes(eventId);
    replayKey = appReplayKey(build, hashes.sim);
    offerRoutes();
  };
  /**
   * The word in the route row's place while the picked region's roads are not in (polish batch E's
   * check, punch item 1: once the did-not-load card had gone with its screen, the menu showed the pick
   * with no route row and no word). It follows the picked region's last load: loading, or why it did
   * not load; gone once its roads are in.
   */
  let pickLoad: { id: string; state: LoadFailure | 'loading' } | null = null;
  const sayPickedRoads = (choice?: RegionChoice, state?: LoadFailure | 'loading') => {
    if (choice && state) pickLoad = { id: choice.id, state };
    const picked = pickedChoice();
    if (!picked || library.hasRoads(picked.packId)) pickLoad = null;
    if (!picked || pickLoad?.id !== picked.id) ui.setRoutesNote(null);
    else {
      // A missing build's word carries the Reload button; inside the host's wait it counts the wait down.
      const word = routesNoteView(picked.name, pickLoad.state, reloadPage);
      ui.setRoutesNote(word.text, word.action);
    }
  };
  /** The packs a race in this region reads (its pack and base) whose road data is not in yet. */
  const roadsMissing = (choice: RegionChoice): string[] =>
    packClosure(registry, choice.packId).filter((id) => !library.hasRoads(id));
  /**
   * The physical world's planners (the structures the sim meets: its buildings, landmarks and roofs; one
   * lazy chunk, never in the first load), fetched in the background with the Keys' real roads; a race waits
   * for them as it waits for its roads, since its world is planned from them as it starts. The systems' steps
   * (the sim's step chunk, lane U3: the menu's grid needs none of it) come with them, the same way.
   */
  let plannersIn = false;
  let plannersLoading: Promise<void> | null = null;
  const loadPlanners = (): Promise<void> =>
    (plannersLoading ??= Promise.all([loadStructurePlanners(), loadSimSteps()]).then(
      () => {
        plannersIn = true;
      },
      (err: unknown) => {
        // Tried again by the next race (a dropped connection on the phone).
        plannersLoading = null;
        throw err;
      },
    ));
  /**
   * Fetches the road data a race in a region needs (its pack's, and the Keys' real roads, which
   * every region's content hash covers through base), with a busy line; false (and a notice) when
   * it fails.
   */
  const loadRegion = async (choice: RegionChoice): Promise<boolean> => {
    const current = captureNormal();
    const loadOwner = {};
    pendingLoad = loadOwner;
    loadingRoads = true;
    frames.refresh();
    ui.setBusy(`Loading ${choice.name}`);
    if (!library.hasRoads(choice.packId)) sayPickedRoads(choice, 'loading');
    try {
      await Promise.all([...roadsMissing(choice).map((id) => library.loadRoads(id)), loadPlanners()]);
      if (!current() || pendingLoad !== loadOwner) return false;
      roadsArrived(library.registry());
      return true;
    } catch (err) {
      if (!current() || pendingLoad !== loadOwner) return false;
      console.warn('region road data did not load', err);
      const failure = failureOf(err, Date.now());
      // Retry goes on to the race the player asked for (the picked region, fetched again).
      offerLoadRetry(ui, choice.name, () => handle.startRace(), failure, reloadPage);
      sayPickedRoads(choice, failure);
      return false;
    } finally {
      if (pendingLoad === loadOwner) {
        pendingLoad = null;
        loadingRoads = false;
        frames.refresh();
        if (current()) ui.setBusy(null);
      }
    }
  };
  /** The menu backdrop follows the pick: the grid on that region's road. */
  const showPicked = () => {
    const choice = pickedChoice();
    if (!choice || state === 'race' || !library.hasRoads(choice.packId)) return;
    useEvent(
      quickPlayEvent(registry, choice.id, settings.quickPlayKind ?? 'race')?.eventId ?? choice.eventId,
    );
    // Offered again even when the event did not change (back to a region before another's road
    // data arrived), so the picker never stays empty.
    offerRoutes();
    curr = newSim(seeds.next()).snapshot();
    prev = null;
    showRegion();
    rememberMenu();
    frames.refresh();
    frames.invalidate();
  };
  /** Fetches the picked region's road data in the background; says so, with Retry, if it fails. */
  const loadPicked = (choice: RegionChoice) => {
    const current = captureNormalContent();
    const loadOwner = {};
    normalLoads.add(loadOwner);
    void library
      .loadRoads(choice.packId)
      .then(
        (reg) => {
          if (!current() || pickedChoice()?.id !== choice.id) return;
          roadsArrived(reg);
          showPicked();
        },
        (err: unknown) => {
          if (!current()) return;
          console.warn('region road data did not load', err);
          // Only for the region still picked: a pick made since has its own load and its own say.
          if (pickedChoice()?.id !== choice.id) return;
          const failure = failureOf(err, Date.now());
          offerLoadRetry(
            ui,
            choice.name,
            () => {
              if (pickedChoice()?.id === choice.id) loadPicked(choice);
            },
            failure,
            reloadPage,
          );
          sayPickedRoads(choice, failure);
        },
      )
      .finally(() => normalLoads.delete(loadOwner));
  };
  const pickRegion = (id: string) => {
    if (!ordinaryAllowed()) return;
    const choice = regions.find((r) => r.id === id);
    if (!choice) return;
    clearLoadRetry(ui);
    // The routes on offer are the new region's, once its road data is in.
    if (choice.eventId !== eventId) ui.setRoutes([], null);
    if (library.hasRoads(choice.packId)) {
      roadsArrived(library.registry());
      sayPickedRoads();
      showPicked();
    } else {
      sayPickedRoads(choice, 'loading');
      loadPicked(choice);
    }
  };
  /**
   * The route picker (the maintainer, 2026-10-01: "Yes, add as routes"): a real road, or null for
   * the region's own road. The menu backdrop follows the pick; Race races it.
   */
  const pickRoute = (id: string | null) => {
    if (!ordinaryAllowed()) return;
    if (id && (event.kind === 'takedown-hunt' || event.kind === 'grudge-match')) return;
    if (id === route) return;
    route = id;
    if (state === 'race') return;
    stream = streams.forEvent(registry, eventId, settings.raceLength, route);
    curr = newSim(seeds.next()).snapshot();
    prev = null;
    showRegion();
    rememberMenu();
    frames.refresh();
    frames.invalidate();
  };
  // The boot region's routes (the Keys: the causeway road, then the real Bahia Honda stretch once
  // its road data is in). The Keys' real roads are not in the first-load bundle (run W-P): they are
  // fetched now, in the background, so the picker offers them and a race starts without a wait.
  offerRoutes();
  // The Keys' own region (base's), whose route row waits on these roads too.
  const keysChoice = regions.find((r) => r.packId === 'base');
  const loadKeysRoads = () => {
    const current = captureNormalContent();
    const loadOwner = {};
    normalLoads.add(loadOwner);
    sayPickedRoads(keysChoice, 'loading');
    void library
      .loadRoads('base')
      .then(
        (reg) => {
          if (current() && pickedChoice()?.packId === 'base') roadsArrived(reg);
        },
        (err: unknown) => {
          if (!current() || pickedChoice()?.packId !== 'base') return;
          // Said on the menu with Retry (Race also fetches them again, with a busy line, if it must).
          console.warn('the Keys real-road data did not load', err);
          const failure = failureOf(err, Date.now());
          offerLoadRetry(ui, "The Keys' real roads", loadKeysRoads, failure, reloadPage);
          sayPickedRoads(keysChoice, failure);
        },
      )
      .finally(() => normalLoads.delete(loadOwner));
  };
  if (!library.hasRoads('base')) loadKeysRoads();
  // The physical world's planners, in the background too (a race that finds them missing fetches them
  // again, with a busy line).
  void loadPlanners().catch((err: unknown) => console.warn('the world planners did not load', err));

  // ---- The career flow (run W-R) ----------------------------------------------------------------
  const careerReady: Promise<CareerFlow | null> = import('./career-flow').then(
    (m) => {
      C = m;
      defs = m.careerDefs(registry);
      careerRegion ||= m.returningCareerRegion(defs, profile) ?? defs[0]?.regionId ?? '';
      return m;
    },
    (err: unknown) => {
      console.warn('the career did not load', err);
      return null;
    },
  );

  const recoveryReady = import('./race-recovery').then(
    (m) => {
      recovery = m;
      recoveryResolved = true;
      savedStore = m.createSavedRaceStore({ keyPrefix: APP_ID, storage: raceStorage });
      classifySavedAttempt();
      return m;
    },
    () => {
      recoveryResolved = true;
      ui.notice('Race recovery did not load. Playing is available; reload to try recovery again.');
      if (recoveryLocked) offerRecoveryLoadFailure();
      return null;
    },
  );

  function offerRecoveryLoadFailure(): void {
    try {
      initialAttemptRaw = raceStorage?.getItem(recordingKey(APP_ID)) ?? initialAttemptRaw;
    } catch {
      /* Retain the last observed text; unknown storage never authorizes removal. */
    }
    const expected = initialAttemptRaw;
    ui.showResumeCard((choice) => {
      activateRecoveryChoice();
      if (choice === 'resume') {
        reloadPage();
        return;
      }
      try {
        if (!raceStorage) throw new Error('Storage unavailable');
        if (raceStorage.getItem(recordingKey(APP_ID)) !== expected) throw new Error('Saved race changed');
        raceStorage.removeItem(recordingKey(APP_ID));
        if (raceStorage.getItem(recordingKey(APP_ID)) !== null) throw new Error('Removal failed');
        recoveryLocked = false;
        ui.show('menu');
      } catch {
        ui.notice('The saved race could not be removed. Reload the page to try again.');
        offerRecoveryLoadFailure();
      }
    }, 'retry-load');
  }

  function ordinaryAllowed(): boolean {
    if (replayWatch) return false;
    if (!attemptOwner && savedRead?.kind === 'blocked' && state !== 'race') classifySavedAttempt();
    if (recoveryLocked || recoveryBusy) {
      if (!recoveryBusy) offerSavedAttempt(attemptOwner?.settled ? 'unavailable' : undefined);
      return false;
    }
    if (attemptOwner?.terminal && !attemptOwner.settled) {
      offerFailedResult();
      return false;
    }
    return true;
  }

  function classifySavedAttempt(): void {
    if (!savedStore || attemptOwner || measurement?.owned) return;
    savedRead = savedStore.read();
    if (savedRead.kind === 'saved') savedTick = savedRead.envelope.recording.inputs.ticks;
    if (savedRead.kind === 'refused') staleReplayKey = savedRead.replayKey ?? null;
    recoveryLocked = savedRead.kind === 'saved' || savedRead.kind === 'refused';
    if (savedRead.kind === 'blocked')
      ui.notice('Race storage could not be read. Playing is available, but this race cannot be saved.');
    if (recoveryLocked) offerSavedAttempt();
  }

  function activateRecoveryChoice(): void {
    // Keep native activation in the original click/keyboard delivery, before lazy content awaits.
    void runStartTap(() => audio.resume());
    if (state === 'tapToStart') go('tapped');
    ui.show('menu');
  }

  function offerSavedAttempt(kind?: 'unavailable' | 'retry-load', detail?: string): void {
    if (!savedStore) {
      if (recoveryResolved && recoveryLocked) offerRecoveryLoadFailure();
      return;
    }
    const read = savedRead;
    if ((!read || read.kind === 'empty' || read.kind === 'blocked') && !recoveryLocked) return;
    const view = kind ?? (read?.kind === 'saved' ? read.envelope.phase : 'unavailable');
    ui.showResumeCard(
      (choice) => {
        activateRecoveryChoice();
        if (choice === 'startOver') {
          const discarded = attemptOwner?.context;
          const failedAward = attemptOwner?.terminal && !attemptOwner.settled;
          if (!forgetOwnedSlot()) {
            recoveryLocked = true;
            offerSavedAttempt(
              'unavailable',
              'The saved race could not be removed. Its data is still on this device.',
            );
            return;
          }
          if (failedAward) restorePersistedProfile(discarded);
          attemptOwner = null;
          recoveryLocked = false;
          savedRead = { kind: 'empty' };
          savedTick = null;
          if (state === 'race' || state === 'results') go('back');
          race = null;
          careerRace = null;
          quickLog = null;
          quickDone = null;
          ui.career.setObjective(null);
          ui.show('menu');
          frames.refresh();
        } else if (read?.kind === 'saved') void restoreSavedAttempt(read);
      },
      view,
      detail ?? (read?.kind === 'refused' ? 'Its data is still on this device.' : undefined),
    );
  }

  function ownOrdinaryAttempt(): void {
    const m = recovery;
    const file = recorder.current();
    if (!m || !savedStore || !C || !race || !file || recoveryLocked || measurement?.owned) return;
    let context: SavedRaceContext;
    if (careerRace) {
      let guard: string | null = null;
      try {
        guard = raceStorage?.getItem(profileKey(APP_ID)) ?? null;
      } catch {
        /* Keep unknown data. */
      }
      const frozen = guard === null ? null : m.profileFromGuard(guard);
      if (!guard || !frozen || m.canonicalJson(frozen) !== m.canonicalJson(sanitiseProfile(profile))) {
        ui.notice('This race cannot be recovered because career progress has not reached device storage.');
        return;
      }
      const original = {
        kind: 'career' as const,
        eventId,
        careerKey: careerRace.def.key,
        nodeId: careerRace.node.id,
        regionId: careerRace.def.regionId,
        length: careerRace.length,
        profileGuard: guard,
      };
      const derived = m.recoveryCareer(C, registry, defs, original, file.header);
      context = { ...original, contextKey: derived.key };
    } else {
      const original = {
        kind: 'quick' as const,
        eventId,
        route,
        settings: structuredClone(quickSettings ?? settings),
      };
      context = { ...original, contextKey: m.quickRecoveryKey(C, registry, original) };
    }
    attemptOwner = { sim: race, token: {}, context, canPersist: savedRead?.kind === 'empty', settled: false };
    saveNoticeShown = false;
  }

  function flushAttempt(owner = attemptOwner): void {
    if (
      !owner ||
      owner !== attemptOwner ||
      owner.token !== attemptOwner.token ||
      owner.sim !== race ||
      owner.terminal ||
      state !== 'race' ||
      measurement?.owned ||
      !recovery ||
      !savedStore ||
      !owner.canPersist
    )
      return;
    const recording = recorder.file();
    if (!recording || recording.inputs.ticks === 0) return;
    const written = savedStore.save({
      format: 'saved-race',
      version: recovery.SAVED_RACE_VERSION,
      logicVersion: recovery.RESUME_LOGIC_VERSION,
      phase: 'riding',
      recording,
      context: owner.context,
      savedHash: owner.sim.hash(),
    });
    if (written.ok) savedTick = written.tick;
    else if (!saveNoticeShown) {
      saveNoticeShown = true;
      ui.notice('Race progress could not be saved. Playing can continue; a reload may lose recent progress.');
    }
  }

  function abandonOrdinaryAttempt(): boolean {
    if (!attemptOwner) return true;
    if (attemptOwner.canPersist && !forgetOwnedSlot()) {
      recoveryLocked = true;
      if (state === 'race') ui.pause();
      ui.notice('The saved race could not be removed. Retry before starting another race.');
      offerSavedAttempt('unavailable', 'The saved race could not be removed. Try discarding it again.');
      return false;
    }
    attemptOwner = null;
    savedTick = null;
    return true;
  }

  function forgetOwnedSlot(): boolean {
    if (!savedStore) return false;
    if (!savedStore.clear()) {
      const fresh = savedStore.read();
      if (fresh.kind !== 'blocked') savedRead = fresh;
      if (fresh.kind !== 'empty') return false;
    }
    savedRead = { kind: 'empty' };
    savedTick = null;
    return true;
  }

  function restorePersistedProfile(fallback?: SavedRaceContext): void {
    profileStore = createProfileStore({ keyPrefix: APP_ID, build: build.id, storage: raceStorage });
    profile = profileStore.load();
    // A blocked fresh read must not turn abandonment into a blank in-memory career. The new
    // store still holds writes disabled, while the last supported starting record stays usable.
    if (!profileStore.record() && profileStore.notice && fallback?.kind === 'career')
      profile = recovery?.profileFromGuard(fallback.profileGuard) ?? profile;
  }

  function offerFailedResult(kind: 'save-failed' | 'unavailable' = 'save-failed', detail?: string): void {
    const context = attemptOwner?.context;
    ui.showResumeCard(
      (choice) => {
        activateRecoveryChoice();
        if (choice === 'resume') {
          settleCareerRace(false);
        } else if (abandonOrdinaryAttempt()) {
          restorePersistedProfile(context);
          careerRace = null;
          race = null;
          go('back');
          ui.show('menu');
          frames.refresh();
        } else offerFailedResult(kind, detail);
      },
      kind,
      detail,
    );
  }

  async function restoreSavedAttempt(read: Extract<SavedRaceRead, { kind: 'saved' }>): Promise<void> {
    const m = recovery;
    if (!m || !savedStore || recoveryBusy || measurement?.owned) return;
    recoveryBusy = true;
    ui.setBusy('Recovering your race');
    const current = captureNormal();
    const loadOwner = {};
    pendingLaunch = loadOwner;
    let failureKind: 'retry-load' | 'unavailable' = 'retry-load';
    try {
      const flow = C ?? (await careerReady);
      if (!flow) throw new Error('Career rules did not load');
      const attempt = read.envelope;
      const missing = packClosure(registry, packOf(attempt.context.eventId)).filter(
        (id) => !library.hasRoads(id),
      );
      await Promise.all([...missing.map((id) => library.loadRoads(id)), loadPlanners()]);
      if (!current()) return;
      roadsArrived(library.registry());
      failureKind = 'unavailable';
      if (attempt.recording.header.replayKey !== appReplayKey(build, raceHashes(attempt.context.eventId).sim))
        throw new Error('The simulation or event content has changed');
      const context = attempt.context;
      const career =
        context.kind === 'career'
          ? m.recoveryCareer(flow, registry, defs, context, attempt.recording.header)
          : null;
      const contextKey =
        context.kind === 'career' ? career!.key : m.quickRecoveryKey(flow, registry, context);
      if (contextKey !== context.contextKey) throw new Error('The race rules or rewards have changed');
      if (context.kind === 'career') {
        let actual: string | null;
        try {
          actual = raceStorage?.getItem(profileKey(APP_ID)) ?? null;
        } catch {
          failureKind = 'retry-load';
          throw new Error('Career storage could not be read');
        }
        if (actual !== context.profileGuard)
          throw new Error('Career progress has changed since this race was saved');
      }
      const cfg = attempt.recording.header.config!;
      const originalPlayer = cfg.riders.findIndex((r) => r.controller.kind === 'player');
      let historicalCareer: typeof careerRace = null;
      if (career) {
        historicalCareer = {
          def: career.def,
          node: career.node,
          plan: career.setup.plan,
          length: context.kind === 'career' ? context.length : null,
          patch: career.setup.patch,
          level: career.setup.fieldLevel,
          log: flow.createRaceLog({
            playerId: originalPlayer,
            rules: career.setup.plan.rules,
            objectives: career.setup.plan.objectives,
            routeId: flow.bare(cfg.event.routeId ?? ''),
            roadIds: roadsForHeader(registry, streams)(attempt.recording.header).road.edges.map((e) => e.id),
            secrets: career.def.secrets,
          }),
          onboarding: flow.createOnboarding(career.starting.oncePerCareer),
          doneTick: null,
          headline: '',
          ask: career.ask,
          askLog: null,
          askMet: false,
          gig: career.gig,
        };
      }
      const plan = flow.eventPlan(registry, context.eventId);
      const historicalQuick =
        context.kind === 'quick'
          ? flow.createRaceLog({
              playerId: originalPlayer,
              rules: plan.rules,
              objectives: plan.objectives,
              routeId: cfg.event.routeId ?? '',
              roadIds: roadsForHeader(
                registry,
                streams,
              )(attempt.recording.header).road.edges.map((e) => e.id),
            })
          : null;
      const historicalOutcome = createOutcome();
      let historicalQuickDone: number | null = null;
      let due = false;
      const started = performance.now();
      const restored = m.reconstructSavedRace(
        attempt,
        roadsForHeader(registry, streams),
        (events, snap, tick) => {
          historicalOutcome.note(events, originalPlayer, tick);
          if (historicalCareer)
            noteCareerProgress(flow, historicalCareer, events, snap, originalPlayer, tick);
          if (historicalQuick) {
            historicalQuick.note(events, snap);
            if (historicalQuick.status().endNow && historicalQuickDone === null) historicalQuickDone = tick;
          }
          const careerDone = historicalCareer?.doneTick ?? null;
          due =
            resultsDue(historicalOutcome, tick, snap.race.over) ||
            (careerDone !== null && tick >= careerDone + RESULTS_BEAT_TICKS) ||
            (historicalQuickDone !== null && tick >= historicalQuickDone + RESULTS_BEAT_TICKS);
        },
      );
      if ((attempt.phase === 'pending-result') !== due)
        throw new Error('The saved race phase does not match its result');
      if (!current() || !savedStore.adopt(read.raw)) {
        if (savedStore.read().kind === 'blocked') failureKind = 'retry-load';
        throw new Error('The saved race changed while loading');
      }
      if (!go('race')) throw new Error('The race screen is unavailable');
      race = restored.sim;
      playerId = originalPlayer;
      careerRace = historicalCareer;
      if (career) {
        profile = career.starting;
        careerRegion = career.def.regionId;
      }
      quickSettings = context.kind === 'quick' ? structuredClone(context.settings) : null;
      quickRetry =
        context.kind === 'quick'
          ? { eventId: context.eventId, route: context.route, settings: quickSettings! }
          : null;
      quickLog = historicalQuick;
      quickDone = historicalQuickDone;
      outcome = historicalOutcome;
      useEvent(context.eventId);
      // Recovery's event and menu pick must agree after returning from the race too.
      ui.setRegions(regions, regionKeyOf(registry, context.eventId));
      route = context.kind === 'quick' ? context.route : null;
      offerRoutes();
      stream = streams.forEvent(registry, eventId, cfg.event.lengthId, cfg.event.routeId);
      attemptOwner = {
        sim: race,
        token: {},
        context,
        canPersist: true,
        settled: false,
        ...(attempt.phase === 'pending-result' ? { terminal: attempt } : {}),
      };
      if (attempt.phase === 'riding') recorder.resume(restored.recording);
      recoveredTerminal = attempt.phase === 'pending-result' ? restored.recording : null;
      savedTick = restored.ticks;
      fastForward = { ticks: restored.ticks, ms: performance.now() - started };
      recoveryLocked = false;
      pendingTuning.length = 0;
      countdown.begin(false);
      ui.setCountdown(null);
      presentationConfig = {
        trafficTypes: race.config.trafficTypes,
        riderLooks: riderLooks(race.config),
        playerPaint: flow.currentPaintHex(defs, {
          ...profile,
          bikes: { ...profile.bikes, current: race.config.riders[originalPlayer]?.bike.contentId ?? null },
        }),
        sceneSeed: race.config.seed,
      };
      audio.setEngineSounds(engineSounds(race.config));
      showRegion(
        raceTimeOfDay(
          registry,
          eventId,
          race.config.seed,
          !careerRace,
          careerRace?.patch ? withEventPatch(event, careerRace.patch) : undefined,
          quickSettings?.raceOptions.timeOfDay,
        ),
        quickSettings?.raceOptions.weather,
        cfg.event.lengthId,
      );
      finishShot = null;
      lookWatch.reset();
      seenPoll.reset();
      lastLandingRef = null;
      resetOutOfBounds(outOfBounds);
      input.onMoves(null);
      prev = null;
      curr = race.snapshot();
      recent = [];
      const me = curr.entities[playerId];
      if (me) camera.snap(me, { aspect: viewAspect() });
      ui.career.setObjective(careerRace?.headline ?? quickLog?.status().headline ?? null);
      ui.show('race');
      ui.pause();
      frames.refresh();
      frames.invalidate();
      if (attempt.phase === 'pending-result') finishRace();
    } catch {
      staleReplayKey = read.envelope.recording.header.replayKey;
      recoveryLocked = true;
      offerSavedAttempt(
        failureKind,
        failureKind === 'unavailable'
          ? 'The saved race cannot be recovered exactly. Its data is still on this device.'
          : 'The required race content did not load. Try again when it is available.',
      );
    } finally {
      recoveryBusy = false;
      if (pendingLaunch === loadOwner) pendingLaunch = null;
      ui.setBusy(null);
      if (!current() && recoveryLocked)
        offerSavedAttempt('retry-load', 'Recovery was interrupted. Try again.');
    }
  }

  /** Starts a race and its recording at the current event and route, at `lengthId`. */
  function launchRace(lengthId: string): boolean {
    ui.setReplayAvailable(false);
    stream = streams.forEvent(registry, eventId, lengthId, route);
    if (!go('race')) return false;
    // W-Q: a free-play race's light is drawn by its seed, or picked in its options with its weather
    // (playtest 4, P4-12); a career race keeps its event's own.
    const seed = seeds.next();
    const options = careerRace ? null : (quickSettings ?? settings).raceOptions;
    race = newSim(seed);
    showRegion(
      raceTimeOfDay(
        registry,
        eventId,
        seed,
        !careerRace,
        careerRace?.patch ? withEventPatch(event, careerRace.patch) : undefined,
        options?.timeOfDay,
      ),
      options?.weather,
      lengthId,
    );
    pendingTuning.length = 0;
    countdown.begin(countdownOn());
    preparingGrid = countdown.holding ? race : null;
    // The full header (the SimConfig as plain data), so a saved debug file replays on its own, and a
    // menu race's picks beside it (playtest 4, P4-12).
    attemptOwner = null;
    recoveredTerminal = null;
    recorder.beginRace(race, replayKey, options ? { ...options } : undefined);
    outcome = createOutcome();
    finishShot = null;
    lookWatch.reset();
    seenPoll.reset();
    lastLandingRef = null;
    resetOutOfBounds(outOfBounds);
    input.onMoves(null);
    prev = null;
    curr = race.snapshot();
    recent = [];
    const me = curr.entities[playerId];
    if (me) camera.snap(me, { aspect: viewAspect() });
    input.calibrateTilt(); // the phone's angle now is straight ahead
    ui.show('race');
    syncRunning();
    frames.refresh();
    frames.invalidate();
    return true;
  }

  /**
   * Starts (or restarts) a career race at a map node: its region's road data first (with a busy
   * line), then the race with the node's length, the career's bike and grudges, and the race log
   * that watches the event's rules.
   */
  function startCareerRace(def: CareerDef, node: CareerNode): void {
    const m = C;
    if (loadingRoads || !m || !ordinaryAllowed()) return;
    if (!recoveryResolved) {
      const current = captureNormal();
      void recoveryReady.then(() => {
        if (current()) startCareerRace(def, node);
      });
      return;
    }
    quickLog = null;
    quickDone = null;
    quickSettings = null;
    // The one gate of every career ride (Ride, Next, Race it again, restart, dev hooks): a shut
    // region or a locked node never starts, whatever button asked (playtest 3, regions in order).
    const refusal = m.rideLock(registry, defs, profile, def, node);
    if (refusal !== null) {
      ui.notice(refusal);
      return;
    }
    if (state === 'race' || state === 'results') go('back');
    if (transition(state, 'race') === null) return;
    const missing = packClosure(registry, packOf(node.event)).filter((id) => !library.hasRoads(id));
    // Its roads, and the planners its world is planned from (loadPlanners).
    if (missing.length > 0 || !plannersIn) {
      const current = captureNormal();
      const loadOwner = {};
      pendingLoad = loadOwner;
      pendingLaunch = loadOwner;
      loadingRoads = true;
      frames.refresh();
      ui.setBusy(`Loading ${def.regionName}`);
      void Promise.all([...missing.map((id) => library.loadRoads(id)), loadPlanners()])
        .then(
          () => {
            if (!current() || pendingLoad !== loadOwner) return false;
            roadsArrived(library.registry());
            return true;
          },
          (err: unknown) => {
            if (!current() || pendingLoad !== loadOwner) return false;
            console.warn('career road data did not load', err);
            offerLoadRetry(
              ui,
              def.regionName,
              () => startCareerRace(def, node),
              failureOf(err, Date.now()),
              reloadPage,
            );
            return false;
          },
        )
        .then((ok) => {
          if (pendingLoad !== loadOwner) return;
          pendingLoad = null;
          if (pendingLaunch === loadOwner) pendingLaunch = null;
          loadingRoads = false;
          if (!current()) return;
          frames.refresh();
          ui.setBusy(null);
          if (ok) startCareerRace(def, node);
        });
      return;
    }
    careerRegion = def.regionId;
    // This season's race: the remix patch, the plan with it applied, the length, the field level.
    const { patch, plan, length, fieldLevel: level } = m.careerRaceSetup(registry, defs, profile, def, node);
    careerRace = {
      def,
      node,
      plan,
      length: length?.id ?? null,
      patch,
      level,
      log: null,
      onboarding: m.createOnboarding(profile.oncePerCareer),
      doneTick: null,
      headline: '',
      ask: null,
      askLog: null,
      askMet: false,
      gig: null,
    };
    useEvent(node.event);
    route = null;
    if (!launchRace(length?.id ?? settings.raceLength) || !race) {
      careerRace = null;
      return;
    }
    careerRace.log = m.createRaceLog({
      playerId,
      rules: plan.rules,
      objectives: plan.objectives,
      routeId: m.bare(length?.route ?? ''),
      roadIds: race.config.road.edges.map((e) => e.id),
      secrets: def.secrets,
    });
    careerRace.headline = careerRace.log.status().headline;
    ui.career.setObjective(careerRace.headline);
    // The show: no producer on a career's very first race (its prompts teach the controls).
    const extra = m.raceShow(registry, def, plan, profile, race.config.seed);
    careerRace.ask = profile.history.length > 0 ? extra.ask : null;
    careerRace.gig = extra.gig;
    ownOrdinaryAttempt();
  }

  /**
   * The player's landing that paid puts one of the region's one-liners on the top ticker. It is
   * vetoable, so it is noted as seen, and a line cut on this device is out of the pool at once.
   */
  function noteLanding(events: readonly SimEvent[]): void {
    if (landingPool.length === 0) return;
    const cut = new Set(settings.vetoes.map((v) => v.contentRef));
    const pool = landingPool.filter((p) => !cut.has(p.ref));
    const pick = landingLineFor(events, playerId, pool, lastLandingRef);
    if (!pick || !race) return;
    lastLandingRef = pick.item.ref;
    const item = landingLineItem(pick.item, pick.tick, `seed-${race.config.seed}`);
    ui.ticker.push(item);
    ui.narrative.noteSeen({ contentRef: pick.item.ref, kind: 'sign', label: item.text, tick: pick.tick });
  }

  /**
   * The player's fall out of bounds onto ground, or off a low drop onto it, reads as one plain line on the top
   * ticker (the physical world, 2026-10-06; ticker-feed.ts `outOfBoundsLineFor`): a `system` line in the strip's
   * own slot, so it is never over a control. A splash into water and a high drop have their own presentation.
   */
  function noteOutOfBounds(events: readonly SimEvent[]): void {
    const line = outOfBoundsLineFor(events, playerId, outOfBounds);
    if (line) ui.ticker.push(line);
  }

  /** One step of a career race: its rules, its prompts, the objective line, an early end. */
  function noteCareer(events: readonly SimEvent[], tick: number): void {
    const c = careerRace;
    if (!c || !curr || !C) return;
    const notices = noteCareerProgress(C, c, events, curr, playerId, tick);
    if (notices.prompt) ui.career.prompt(notices.prompt.text);
    if (notices.headline !== null) ui.career.setObjective(notices.headline);
    if (notices.ask) ui.ticker.push(producerAskItem(notices.ask));
    if (notices.thanks) ui.ticker.push(producerThanksItem(notices.thanks));
  }

  /**
   * The pause screen's network map (interview, 2026-10-02: "Maybe just map on pause"), in a career
   * race only: in free play its height pushed the keyboard legend and the "cut this" list off a
   * phone's pause screen (CI on #372).
   */
  function showPauseMap(): void {
    const me = curr?.entities[playerId];
    const roadId = me ? race?.config.road.edges[me.road.edge]?.id : undefined;
    if (!C || !careerRace || !race || !me || !roadId || state !== 'race') {
      ui.career.showPauseMap(null);
      return;
    }
    ui.career.showPauseMap(
      C.pauseMapView(registry, defs, profile, regionKeyOf(registry, eventId), roadId, me.road.s),
    );
  }

  /** Settles the career race into the profile (and saves it); the results screen unless it was a quit. */
  function settleCareerRace(quit: boolean): void {
    const c = careerRace;
    const m = C;
    ui.career.setObjective(null);
    if (!c?.log || !m) return;
    const tally = c.log.tally();
    // The producer's ask and the side gig ride as bonus objectives, so the ledger pays them (run W-S).
    const extras: ObjectiveStatus[] = [];
    const asked = c.askLog?.status().objectives[0];
    if (asked) extras.push({ ...asked, label: m.ASK_LABEL, met: asked.met === true });
    if (c.gig && !quit) extras.push(m.gigStatus(c.gig, tally));
    const base = c.log.status();
    const status: RaceStatus = { ...base, objectives: [...base.objectives, ...extras] };
    const owner = attemptOwner?.sim === race ? attemptOwner : null;
    const terminal = !quit ? owner?.terminal : undefined;
    const result = terminal?.result ?? { build: build.id, at: new Date().toISOString() };
    const ridden = race?.config.riders[playerId]?.bike.contentId;
    const calculate = (starting: Profile) => {
      const awarded = m.settleRace(starting, {
        reg: registry,
        def: c.def,
        node: c.node,
        plan: c.plan,
        status,
        tally,
        quit,
        build: result.build,
        at: result.at,
        ...(ridden ? { bike: ridden } : {}),
      });
      return {
        ...awarded,
        profile: {
          ...awarded.profile,
          oncePerCareer: m.withPromptsSeen(awarded.profile.oncePerCareer, c.onboarding.shown()),
        },
      };
    };
    const guarded = terminal?.context.kind === 'career' && recovery ? terminal.context : null;
    let persisted: boolean;
    let settled: ReturnType<typeof calculate>;
    if (guarded && recovery) {
      const committed = recovery.commitFrozenProfile({
        storage: raceStorage,
        keyPrefix: APP_ID,
        profileGuard: guarded.profileGuard,
        result,
        settle: calculate,
      });
      if (committed.kind === 'changed' || committed.kind === 'invalid') {
        offerFailedResult('unavailable', 'Career progress has changed. This result cannot be applied again.');
        return;
      }
      const starting = recovery.profileFromGuard(guarded.profileGuard);
      if (!starting) {
        offerFailedResult('unavailable');
        return;
      }
      settled = committed.settled ?? calculate(starting);
      if (committed.store) profileStore = committed.store;
      profile = settled.profile;
      persisted = committed.kind === 'saved';
      if (persisted && owner) {
        owner.settled = true;
        if (owner.canPersist && !forgetOwnedSlot()) {
          recoveryLocked = true;
          savedRead = savedStore?.read() ?? null;
          ui.notice('The result was saved, but its old attempt could not be removed.');
        }
      }
    } else {
      settled = calculate(profile);
      persisted = saveProfile(settled.profile);
      if (!persisted) ui.notice('This result is kept in memory. Career progress could not be saved.');
    }
    if (persisted || !guarded) careerRace = null;
    if (quit) return;
    pendingTeaser = persisted ? m.teaserView(defs, settled.report) : null;
    // Who beat the player home: the rivals ahead in the finish order (all finishers when not home).
    const ahead: string[] = [];
    if (curr) {
      for (const id of curr.race.finishOrder) {
        if (id === playerId) break;
        const e = curr.entities[id];
        if (e && e.kind === 'rider' && e.faction !== 'law') ahead.push(e.contentId);
      }
    }
    const shown = m.showResult(
      registry,
      defs,
      c.def,
      c.plan,
      settled.report,
      tally,
      ahead,
      profile,
      c.plan.timeOfDay.replace(/-/g, ' '),
    );
    lastTexts = shown.texts;
    ui.career.showResults({
      ...m.resultView(
        registry,
        c.def,
        c.plan,
        status,
        settled.report,
        tally.place,
        tally.racers,
        profile,
        defs,
      ),
      paper: shown.paper,
      texts: shown.texts,
    });
    ui.show('careerResults');
    if (guarded && !persisted) offerFailedResult();
    offerReplay();
  }

  /** The pause menu's Quit in a career race: it counts as a quit (no cash), then the map. */
  function quitCareerRace(): void {
    if (!ordinaryAllowed() || !abandonOrdinaryAttempt()) return;
    if (!go('back')) return;
    race = null;
    frames.refresh();
    settleCareerRace(true);
    openCareer();
  }

  /**
   * After a boss, any way off the results screen plays the next region's teaser first (once).
   * True when it did.
   */
  function teaserFirst(): boolean {
    const t = pendingTeaser;
    if (!t) return false;
    pendingTeaser = null;
    if (state === 'results') go('back');
    ui.career.showTeaser(t);
    ui.show('teaser');
    return true;
  }

  /** Draws the career screen for the region it shows. */
  function drawCareer(tab?: 'map' | 'garage'): void {
    if (!C) return;
    const view = C.mapView(registry, defs, profile, careerRegion);
    ui.career.showMap(
      view,
      C.garageView(registry, defs, profile, settings.units),
      tab,
      C.showMapView(registry, defs, profile, view, lastTexts),
    );
  }

  /**
   * The career screen (the menu's Career button, the results' Map, the teaser): a career that has
   * not started starts here. The map draws from the region's road data, fetched when it is not in.
   */
  function openCareer(region?: string, tab?: 'map' | 'garage'): void {
    if (!ordinaryAllowed()) return;
    const current = captureNormal();
    const contentCurrent = captureNormalContent();
    const m = C;
    if (state === 'race' || !m) return;
    if (state === 'results') go('back');
    if (!careerStarted(profile)) saveProfile(m.startCareer(defs, profile));
    const def = m.careerOf(defs, region ?? careerRegion) ?? defs[0];
    if (!def) return;
    careerRegion = def.regionId;
    drawCareer(tab);
    ui.show('career');
    const missing = packClosure(registry, def.pack).filter((id) => !library.hasRoads(id));
    if (missing.length > 0) {
      const loadOwner = {};
      normalLoads.add(loadOwner);
      void Promise.all(missing.map((id) => library.loadRoads(id)))
        .then(
          () => {
            // A menu action can retire this screen without retiring its successful road load.
            // Accept the content first; only the still-current screen may update the presentation.
            if (!contentCurrent()) return;
            registry = library.registry();
            if (!current()) return;
            roadsArrived(registry);
            if (careerRegion === def.regionId && state !== 'race') drawCareer();
          },
          () => undefined, // the list still works; Ride fetches again and says so if it fails
        )
        .finally(() => normalLoads.delete(loadOwner));
    }
  }

  /**
   * The Start Season button (playtest 3, round 2: "Season 2+ with a harder field and remixed
   * events"): once every region boss of this season has fallen, the next season starts with a seed
   * drawn now and saved with it. It resets the maps, so only the player's tap starts it.
   */
  function startNextSeason(): void {
    if (!ordinaryAllowed()) return;
    const m = C;
    if (!m || state === 'race') return;
    const next = m.startSeason(defs, profile, seeds.next());
    if (next === profile) {
      ui.career.message('The next season opens once every region boss has fallen.');
      return;
    }
    saveProfile(next);
    lastTexts = [];
    pendingTeaser = null;
    careerRegion = defs[0]?.regionId ?? careerRegion;
    openCareer(careerRegion, 'map');
    ui.career.message(`${m.seasonLabel(next.season)} starts. Your garage and cash came with you.`);
  }

  /**
   * The New career button (playtest 3, round 3: "a 'New career' button that keeps the old save as
   * a backup code"): the old career is kept as an export code in the save (the garage lists it, and
   * Load brings it back) and a fresh career starts in the Keys. Resolves to the line to show.
   */
  async function startOver(): Promise<string> {
    if (!ordinaryAllowed()) return 'Save or abandon the waiting result first.';
    const current = captureNormal();
    const m = C ?? (await careerReady);
    if (!current()) return '';
    if (!m || state === 'race') return 'The career did not load. Reload the page and try again.';
    const made = await m.startNewCareer(defs, profile, build.id, new Date().toISOString());
    if (!current()) return '';
    if (!made.kept) return 'There is nothing to start over yet: ride a race first.';
    saveProfile(made.profile);
    lastTexts = [];
    pendingTeaser = null;
    careerRegion = defs[0]?.regionId ?? careerRegion;
    openCareer(careerRegion, 'map');
    return 'A new career. The old one is kept as a backup code in the garage.';
  }

  /** A garage action's result: saved and redrawn, or its reason shown. */
  function garageAct(r: GarageResult): void {
    if (!ordinaryAllowed()) return;
    if (!r.ok) {
      ui.career.message(r.reason);
      return;
    }
    saveProfile(r.profile);
    drawCareer();
  }

  let preparationIntent: { generation: number; region: string; route: string | null } | null = null;
  const startMeasurementRepeat = (index: number) => {
    const d = diagnostic;
    if (!d || !measurement?.running) return;
    const current = measurement.current();
    d.sim = createSim(d.scene.config);
    d.prev = null;
    d.curr = d.sim.snapshot();
    d.index = index;
    d.countdown.begin(countdownOn());
    measurement.progress(0, d.countdown.holding);
    frames.invalidate();
    d.driver = measurement.factory(index);
    if (!current() || diagnostic !== d || !d.driver) return;
    driverOwner = d.owner;
    input.setDriver((actions) => {
      if (!current() || diagnostic !== d || !d.driver) return;
      try {
        d.driver(d.curr, actions);
      } catch {
        if (current() && diagnostic === d) measurement?.fail('driver-failed');
      }
    });
    if (!current()) return;
    measurement.repeatStart();
  };
  const measurementPreflight = (): AppMeasurementRefusalReason | null => {
    if (recoveryBusy || recoveryLocked || (attemptOwner?.terminal && !attemptOwner.settled))
      return 'normal-launch-pending';
    if (state !== 'menu') return 'not-menu';
    if (ui.screen() !== 'menu') return 'wrong-ui-screen';
    if (ui.paused) return 'ui-paused';
    if (holds.size > 0 || document.visibilityState !== 'visible') return 'lifecycle-held';
    if (renderer.contextLost) return 'renderer-context-lost';
    if (loadingRoads || pendingLoad || normalLoads.size > 0) return 'normal-load-pending';
    if (pendingLaunch) return 'normal-launch-pending';
    if (loop.lockstep !== null) return 'lockstep-active';
    return null;
  };
  const makeMeasurementRuntime = (
    createRuntime: typeof import('./measurement-runtime').createMeasurementRuntime,
  ) =>
    createRuntime({
      preflight: measurementPreflight,
      async prepare(signal) {
        normalGeneration++;
        normalContentGeneration++;
        const region = ui.region ?? regionKeyOf(registry, eventId);
        preparationIntent = { generation: normalGeneration, region, route };
        const selected = {
          regionId: region,
          routeId: route,
          seed: (opts.measurementSeedSource ?? cryptoSeed)() >>> 0,
          garage: { ...profile.bikes, owned: [...profile.bikes.owned] },
          bike: settings.raceOptions.bike,
          timeOfDay: settings.raceOptions.timeOfDay,
          weather: settings.raceOptions.weather,
        };
        const classic = quickPlayEvent(registry, region, 'race');
        const missing = classic
          ? packClosure(registry, packOf(classic.eventId)).filter((id) => !library.hasRoads(id))
          : [];
        const [sceneCode] = await Promise.all([
          loadChunk('measurement scene', () => import('./measurement-scene')),
          ...missing.map((id) => library.loadRoads(id)),
          loadPlanners(),
        ]);
        // Only immutable content caches were filled. Selection and normal registry stay parked.
        if (signal.aborted) throw new Error('Measurement preparation retired');
        if (!sceneCode) throw new Error('Measurement scene code unavailable');
        return sceneCode.resolveMeasurementScene(library.registry(), selected);
      },
      acquireWake: acquireWakeLease,
      acquireAudio: (options) => audio.acquireSuspendLease(options),
      audioState: () => audio.state(),
      current: () =>
        preparationIntent !== null &&
        preparationIntent.generation === normalGeneration &&
        preparationIntent.region === ui.region &&
        preparationIntent.route === route &&
        state === 'menu' &&
        ui.screen() === 'menu' &&
        !ui.paused &&
        holds.size === 0 &&
        !renderer.contextLost &&
        document.visibilityState === 'visible' &&
        loop.lockstep === null,
      invalidate: () => frames.invalidate(),
      quality: () => ({
        setting: settings.qualityTier,
        ...(diagnostic?.governor.state ?? quality.state),
        pixelRatio: renderer.stats().pixelRatio,
      }),
      commit(scene) {
        if (!menuReceipt) throw new Error('Menu receipt missing');
        const reg = library.registry();
        const roadPack = packOf(scene.scene.route.networkId);
        const dressing = Object.fromEntries(
          scene.stream.road.edges.map((e) => [e.id, lookup(reg.roads, qualifyIn(roadPack, e.id))]),
        );
        const sky = scene.scene.weather.sky;
        const governor = createQualityGovernor({
          setting: settings.qualityTier,
          autoTier: quality.state.tier,
        });
        const token = renderer.applyPresentation(
          {
            road: scene.stream.road,
            env: {
              timeOfDay: scene.scene.light.actualId,
              palette: sky.palette,
              ...(sky.weather ? { weather: sky.weather } : {}),
            },
            dressing,
            boards: boardCatalog(
              reg,
              scene.scene.regionId,
              new Set(settings.vetoes.map((v) => v.contentRef)),
            ),
            trafficTypes: scene.config.trafficTypes,
            riderLooks: scene.config.riders.map((r) =>
              riderLookOf({
                contentId: r.contentId,
                role: r.role,
                bikeId: r.bike.contentId,
                look: (reg.riders[r.contentId] as { look?: unknown } | undefined)?.look,
              }),
            ),
            playerPaint: null,
            sceneSeed: scene.scene.seed,
            look: settings.look,
            quality: { ...governor.state },
          },
          { reset: 'preserve' },
        );
        const sim = createSim(scene.config);
        if (typeof document.createElement === 'function') {
          measurementShield = document.createElement('div');
          measurementShield.id = 'measurement-input-shield';
          measurementShield.style.cssText =
            'position:absolute;inset:0;z-index:45;pointer-events:auto;touch-action:none';
          for (const kind of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'])
            measurementShield.addEventListener(kind, (event) => {
              event.preventDefault();
              event.stopImmediatePropagation();
            });
          opts.host.append(measurementShield);
        }
        const diagnosticCamera = createFollowCamera({ road: scene.stream.road });
        diagnosticCamera.setShakeAmount(shakeAmount);
        diagnosticCamera.setMotionAmount(motionNow.camera);
        diagnostic = {
          scene,
          sim,
          prev: null,
          curr: sim.snapshot(),
          playerId: scene.config.riders.findIndex((r) => r.controller.kind === 'player'),
          camera: diagnosticCamera,
          countdown: createCountdown(Math.round(1 / SIM_DT), Math.round(0.8 / SIM_DT)),
          governor,
          token,
          driver: null,
          index: 0,
          owner: {},
        };
        startMeasurementRepeat(0);
      },
      restore() {
        const d = diagnostic;
        diagnostic = null;
        measurementShield?.remove();
        measurementShield = null;
        preparationIntent = null;
        if (d && driverOwner === d.owner) {
          driverOwner = null;
          input.setDriver(normalInputDriver);
        }
        const saved = menuReceipt;
        if (!saved) return { logical: 'menu', visible: 'draw-failed' };
        presentationRecipe = { ...saved.recipe, quality: { ...quality.state } };
        presentationToken = renderer.applyPresentation(presentationRecipe, { reset: 'measurement-to-menu' });
        renderer.setPresentationQuality(presentationToken, quality.state.tier, quality.state.scale);
        if (renderer.contextLost) return { logical: 'menu', visible: 'blocked-context' };
        renderer.render(saved.prev, saved.curr, 0, saved.pose);
        return { logical: 'menu', visible: 'restored' };
      },
    });
  const beginMeasurement = (request: AppMeasurementRequest): Promise<AppMeasurementStart> => {
    if (request.signal.aborted) return Promise.resolve(measurementRefusal('aborted'));
    if (pendingMeasurement) return Promise.resolve(measurementRefusal('owner-busy'));
    if (measurement) return measurement.begin(request);
    const reason = measurementPreflight();
    if (reason) return Promise.resolve(measurementRefusal(reason));
    return new Promise((resolve, reject) => {
      const pending = {
        signal: request.signal,
        abort: () => retireMeasurementEntry('aborted'),
        generation: normalGeneration,
        resolve,
        reject,
      };
      pendingMeasurement = pending;
      request.signal.addEventListener('abort', pending.abort, { once: true });
      if (request.signal.aborted) {
        pending.abort();
        return;
      }
      void loadChunk('measurement runtime', () => import('./measurement-runtime')).then(
        (module) => {
          if (pendingMeasurement !== pending) return;
          if (pending.generation !== normalGeneration) {
            retireMeasurementEntry('superseded-before-start');
            return;
          }
          pendingMeasurement = null;
          request.signal.removeEventListener('abort', pending.abort);
          if (!module) {
            reject(new Error('Measurement runtime code unavailable'));
            return;
          }
          try {
            measurement = makeMeasurementRuntime(module.createMeasurementRuntime);
            void measurement.begin(request).then(resolve, reject);
          } catch (error) {
            reject(
              error instanceof Error
                ? error
                : new Error('Measurement runtime setup failed', { cause: error }),
            );
          }
        },
        (error: unknown) => {
          if (pendingMeasurement !== pending) return;
          pendingMeasurement = null;
          request.signal.removeEventListener('abort', pending.abort);
          reject(
            error instanceof Error ? error : new Error('Measurement runtime load failed', { cause: error }),
          );
        },
      );
    });
  };
  const handle: AppHandle & {
    resumeInfo: () => {
      savedReplayKey: string | null;
      savedTick: number | null;
      staleReplayKey: string | null;
      fastForward: { ticks: number; ms: number } | null;
    };
  } = {
    resumeInfo: () => ({
      savedReplayKey:
        savedTick === null
          ? null
          : (recorder.current()?.header.replayKey ??
            recoveredTerminal?.header.replayKey ??
            (savedRead?.kind === 'saved' ? savedRead.envelope.recording.header.replayKey : null)),
      savedTick,
      staleReplayKey,
      fastForward,
    }),
    beginMeasurement,
    build,
    subscribeFrames: (onFrame, onError) => frames.subscribe(onFrame, onError),
    state: () => state,
    snapshot: () => curr,
    recentEvents: () => recent,
    playerId: () => diagnostic?.playerId ?? playerId,
    setTickDriver(driver) {
      normalDriver = driver;
      driverOwner = null;
      const captured = normalDriver;
      normalInputDriver = captured ? (a) => (curr ? captured(curr, a) : undefined) : null;
      input.setDriver(normalInputDriver);
    },
    onStep(listener) {
      stepListener = listener;
    },
    setSeed(s) {
      seeds.fix(s);
    },
    freePlayTimeOfDay: (s) =>
      raceTimeOfDay(registry, eventId, s, true, undefined, settings.raceOptions.timeOfDay),
    tap() {
      if (state !== 'tapToStart') return;
      if (recoveryLocked) {
        offerSavedAttempt();
        return;
      }
      void runStartTap(() => audio.resume());
      go('tapped');
      // Menu first (playtest 4, P4-5): the first tap of a new device lands on the menu, where
      // "Start career" is the obvious next tap; a race starts only from a button.
      ui.show('menu');
    },
    startRace() {
      if (!ordinaryAllowed()) return;
      if (transition(state, 'race') === null || loadingRoads) return;
      roadsArrived(library.registry());
      if (!C || !recoveryResolved) {
        const current = captureNormal();
        const launchOwner = {};
        pendingLaunch = launchOwner;
        void Promise.all([careerReady, recoveryReady]).then(([m]) => {
          if (pendingLaunch !== launchOwner) return;
          pendingLaunch = null;
          if (m && current()) handle.startRace();
        });
        return;
      }
      const retry = state === 'results' ? quickRetry : null;
      // The menu's Race is free play.
      careerRace = null;
      quickLog = null;
      quickDone = null;
      quickSettings = retry?.settings ?? { ...settings, raceOptions: { ...settings.raceOptions } };
      ui.career.setObjective(null);
      // The race runs in the region picked on the menu. A region pack's road data is fetched the
      // first time (docs/content-packs.md, "Region packs at runtime"); the race starts after.
      // The Keys' real roads too (run W-P): fetched at boot and almost always in by now. Every
      // race's content hash covers them (through base), so a race waits for them rather than start
      // under a replay key that moves when they arrive.
      const choice = pickedChoice() ?? regions.find((r) => r.eventId === eventId);
      if (choice && (roadsMissing(choice).length > 0 || !plannersIn)) {
        const current = captureNormal();
        const launchOwner = {};
        pendingLaunch = launchOwner;
        void loadRegion(choice).then((ok) => {
          if (pendingLaunch !== launchOwner) return;
          pendingLaunch = null;
          if (ok && current()) handle.startRace();
        });
        return;
      }
      if (retry) {
        useEvent(retry.eventId);
        route = retry.route;
      } else if (choice) {
        const chosen = quickPlayEvent(registry, choice.id, settings.quickPlayKind ?? 'race');
        if (!chosen) {
          ui.notice('This region has no available Quick Play events.');
          return;
        }
        useEvent(chosen.eventId);
      }
      // The chosen race length's route (the settings' Race length; an id the event lacks means its
      // standard length), or the real road picked on the menu.
      if (!launchRace(quickSettings.raceLength) || !race) return;
      quickRetry = { eventId, route, settings: quickSettings };
      const plan = C.eventPlan(registry, eventId);
      quickLog = C.createRaceLog({
        playerId,
        rules: plan.rules,
        objectives: plan.objectives,
        routeId: race.config.event.routeId ?? '',
        roadIds: race.config.road.edges.map((e) => e.id),
      });
      ui.career.setObjective(quickLog.status().headline);
      ownOrdinaryAttempt();
    },
    backToMenu() {
      if (!ordinaryAllowed() || !abandonOrdinaryAttempt()) return;
      if (!go('back')) return;
      race = null;
      frames.refresh();
      // A career race left this way is abandoned: it records nothing.
      careerRace = null;
      quickLog = null;
      quickDone = null;
      quickSettings = null;
      ui.career.setObjective(null);
      ui.show('menu');
      rememberMenu();
    },
    career: () => ({
      profile,
      racing: careerRace ? { region: careerRace.def.regionId, node: careerRace.node.id } : null,
      status: careerRace?.log?.status() ?? null,
    }),
    rideCareer(region, node) {
      if (!ordinaryAllowed()) return false;
      const m = C;
      const def = m?.careerOf(defs, region);
      const n = def ? m?.nodeOf(def, node) : null;
      if (!m || !def || !n) return false;
      if (!careerStarted(profile)) saveProfile(m.startCareer(defs, profile));
      if (m.rideLock(registry, defs, profile, def, n) !== null) return false;
      startCareerRace(def, n);
      return true;
    },
    openCareer: (region) => openCareer(region),
    rendererStats: () => renderer.stats(),
    roadQueries: () => diagnostic?.scene.config.route ?? race?.config.route ?? null,
    getReplayAndSettings: () => ({
      replay: recoveredTerminal ?? recorder.current(),
      settings: settingsStore.record() ?? settings,
    }),
    replayFile: () => (recoveredTerminal ? encodeReplay(recoveredTerminal) : recorder.file()),
    replayPlayback: () => {
      const viewer = replayWatch?.runtime;
      const p = viewer?.prepared?.playback;
      return p
        ? {
            tick: p.curr.tick,
            durationTicks: p.durationTicks,
            checked: p.checked,
            complete: p.complete,
            playing: viewer.playing,
            mode: viewer.mode,
          }
        : null;
    },
    checkReplay(file) {
      const rec = decodeReplay(file);
      // The road and route handles come from the recording's own event and route, in any region
      // whose road data this session has loaded.
      const { road, route } = roadsForHeader(registry, streams)(rec.header);
      const sim = createSim(configFromHeader(rec.header, road, route));
      const result = createReplayController(rec).run(sim);
      const key = eventKey(rec.header.eventId || DEFAULT_EVENT);
      return {
        ticks: result.ticks,
        checked: result.checked,
        desync: result.desync,
        keyMatches: rec.header.replayKey === appReplayKey(build, raceHashes(key).sim),
      };
    },
    frameStats() {
      const times = [...loop.frameTimes()].sort((a, b) => a - b);
      return {
        samples: times.length,
        p50: percentile(times, 0.5),
        p95: percentile(times, 0.95),
        max: times[times.length - 1] ?? 0,
      };
    },
    stepTimes: () => stepMs,
    setLockstep(steps) {
      // A test seam: the handle reaches pages only behind the test flag (main.ts, dev/).
      if (testFlagOn()) {
        loop.setLockstep(steps);
        frames.refresh();
      }
    },
    lockstep: () => loop.lockstep,
    contentHashes: () => hashes,
    replayKey: () => replayKey,
    presentation() {
      // The stations audio itself offers now (its own region filter applied), and what it plays.
      const mix = audio.inspect();
      const r = mix.radio;
      return {
        camera: { view: camera.view, mode: camera.mode, shake: shakeAmount },
        display: {
          frameDivisor: frameDivisor(),
          quality: {
            setting: settings.qualityTier,
            ...quality.state,
            pixelRatio: renderer.stats().pixelRatio,
            on: qualityOn(),
          },
        },
        motion: motionNow,
        radio: { region: radio.region, stations: r.stations, tunedTo: r.tunedTo },
        look: renderer.look,
        audio: { busTargets: mix.busTargets, voicesOn: mix.voice.on },
        riders: renderer.riders(),
      };
    },
  };

  // Public mutators enter the same complete-delivery gate used by the UI handlers.
  for (const key of [
    'setTickDriver',
    'onStep',
    'setSeed',
    'tap',
    'startRace',
    'backToMenu',
    'rideCareer',
    'openCareer',
    'setLockstep',
  ] as const) {
    const original = handle[key].bind(handle);
    Object.defineProperty(handle, key, {
      value: (...args: unknown[]) => {
        let result: unknown;
        actionGate(key === 'backToMenu' ? 'back' : 'ordinary', () => {
          result = Reflect.apply(original, handle, args);
        });
        return result;
      },
    });
  }
  window.addEventListener(
    'keydown',
    (event) => {
      if (replayWatch) {
        if (event.code === 'Tab') return;
        const button =
          typeof Element !== 'undefined' &&
          event.target instanceof Element &&
          event.target.closest('#replay button');
        if (button && (event.code === 'Enter' || event.code === 'Space')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const action = replayKeyAction(event.code, event.repeat);
        if (action) replayAction(action);
        return;
      }
      const radioAction = radioKeyAction(event);
      if (radioAction) {
        event.preventDefault();
        event.stopImmediatePropagation();
        actionGate('raw', () => {
          if (radioAction === 'next') audio.nextRadio();
          else audio.skipTrack();
          ui.syncLive();
        });
        return;
      }
      if (!pendingMeasurement && !measurement?.intercepted) return;
      const pauseKey =
        event.code === 'Escape' || keyMapFromBindings(settings.keyBindings).pause.includes(event.code);
      if (measurement?.running || event.code === 'Backquote' || pauseKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        actionGate(event.code === 'Escape' ? 'back' : pauseKey ? 'manual-pause' : 'raw', () => {
          if (pauseKey) ui.pause();
          else if (event.code === 'Backquote') ui.tuningPanel.toggle();
        });
      }
    },
    { capture: true },
  );

  go('booted');
  ui.show('start');
  loop.start();
  // The sound's context is made here, once the start screen has painted, and not in the start tap:
  // making it is the tap's biggest cost (about 400 of its 408 ms of click handling on the dev
  // machine), and only starting it needs the tap's gesture (audio/index.ts, `prepare`). A page that
  // never paints (a hidden tab) leaves it to the tap, as before.
  if (typeof requestAnimationFrame === 'function')
    requestAnimationFrame(() => setTimeout(() => audio.prepare(), 0));
  return handle;
}
