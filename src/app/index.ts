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
import { createAudio, type EngineSoundSpec } from '../audio';
import {
  createFollowCamera,
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
  lookup,
  packClosure,
  packOf,
  packSubset,
  type ContentRegistry,
} from '../content';
import { createHaptics, createInput, type ActionState } from '../input';
import {
  APP_ID,
  installOffer,
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
import { configFromHeader, createInputRecorder, createReplayController, decodeReplay } from '../replay';
import {
  audioVolumes,
  createProfileStore,
  createSettingsStore,
  PROFILE_VERSION,
  settingsAssists,
  type FrameRateCap,
  type Profile,
  type RaceWeather,
  type StorageLike,
} from '../save';
import { browserControlDevice, controlOptionsOf, liveControlSettings } from './controls';
import { engineSoundsFor } from './engine-sounds';
import { createCountdown } from './countdown';
import { createLookFallback } from './look-fallback';
import {
  createSim,
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
import { createUi, finishShotHudOn } from '../ui';
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
import { clearLoadRetry, failureOf, offerLoadRetry } from './load-retry';
import { createLoop } from './loop';
import { menuRaceSetup, raceOptionsView } from './race-options';
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
import { createRaceSeeds, type SeedSource } from './seed';
import { reloadLosesNothing, transition, type AppEvent, type AppState } from './states';
import {
  createSeenPoll,
  landingLineFor,
  landingLineItem,
  producerAskItem,
  producerThanksItem,
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
}

export type TickDriver = (snapshot: SimSnapshot, actions: ActionState) => void;

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
  readonly build: AppBuild;
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

function safeStorage(): StorageLike | null {
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
 */
export function loadBootContent(): Promise<void> {
  return loadBaseRoads();
}

export function createApp(opts: AppOptions): AppHandle {
  const { build } = opts;
  let state: AppState = 'boot';
  // A fresh seed per race unless one is fixed (playtest 1c item 2); the seed goes into SimConfig,
  // so the recording's header carries it and replay and resume reproduce the race.
  const seeds = createRaceSeeds(opts.seed, opts.seedSource);

  // Content: every pack the build carries (base whole; a region pack's road data is fetched the
  // first time a race there starts), the regions the menu offers, and the race's event.
  const library = createPackLibrary({ includeDrafts: build.channel !== 'prod' });
  let registry = library.registry();
  const regions = regionChoices(registry);
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
  // The career (run W-R): the profile record beside the settings, and every region's career map.
  const profileStore = createProfileStore({ keyPrefix: APP_ID, build: build.id, storage: safeStorage() });
  let profile: Profile = profileStore.load();
  const saveProfile = (next: Profile) => {
    profile = next;
    profileStore.save(next);
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
  renderer.setLook(settings.look);
  // Quality tiers and dynamic resolution (roadmap M5): `auto` starts on the tier this device settled
  // on last time; the governor judges each drawn frame's interval (in the loop's render, below).
  const quality = createQualityGovernor({
    setting: settings.qualityTier,
    autoTier: loadAutoTier(safeStorage(), APP_ID),
  });
  const applyQuality = (q: { tier: QualityTierId; scale: number }) => {
    if (qualityOn()) renderer.setQuality(q.tier, q.scale);
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
  /** The poll for the signs and billboards in view ("recently seen", the veto's list). */
  const seenPoll = createSeenPoll();
  /**
   * Shows the race's region: its road with the road files as set dressing (rails, ramp stripes),
   * its signs and billboards (minus this device's cuts), its time of day and palette.
   */
  const showRegion = (timeOfDay: string = String(event.timeOfDay), weather: RaceWeather = 'local') => {
    // Run W-T: a career race shows the region's receipts on its boards, so they key the cache too.
    const receipts = careerRace && C ? JSON.stringify(profile.receipts.at(-1) ?? null) : '';
    if (
      shownRoad === stream.road &&
      shownTime === timeOfDay &&
      shownReceipts === receipts &&
      shownWeather === weather &&
      shownEvent === eventId
    )
      return;
    shownRoad = stream.road;
    shownTime = timeOfDay;
    shownReceipts = receipts;
    shownWeather = weather;
    shownEvent = eventId;
    const regionKey = regionKeyOf(registry, eventId);
    const roadPack = packOf(
      networkKeyOf(registry, routeKeyOf(registry, eventId, settings.raceLength, route)),
    );
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
    renderer.setRoad(stream.road, env, shown.dressing, shown.catalog);
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
    const choices = routeChoices(registry, eventId);
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

  const newSim = (seed: number): Sim => {
    const config = buildSimConfig(registry, stream, {
      seed,
      eventId,
      // The settings that feed SimConfig (M2 save-2 and ui-2; wired in the integration round). Each
      // applies at the next race start or restart, never mid-race, and lands in the replay header.
      // A career race runs its map node's length; free play the Race length setting.
      length: careerRace?.length ?? settings.raceLength,
      // The career's bike rides a career race (the garage, run W-R); a menu race rides the bike its
      // options picked, else the garage's, and takes their light, field, law and traffic (playtest 4,
      // P4-12 and P4-13: app/race-options.ts; every pick lands in this config or the replay header).
      // The grudges ride career races only (grudges outside a career are "light persistence, later"
      // [decided]).
      ...(careerRace
        ? profile.bikes.current
          ? { playerBike: profile.bikes.current }
          : {}
        : menuRaceSetup(registry, settings.raceOptions, profile.bikes)),
      ...(careerRace ? { grudges: profile.grudges } : {}),
      // The career's field level (the rivals' and cops' bikes and strength) and the season's remix.
      ...(careerRace?.level ? { fieldLevel: careerRace.level } : {}),
      ...(careerRace?.patch ? { eventPatch: careerRace.patch } : {}),
      // The road picked on the menu: a real road instead of the length's route (the replay header
      // records it as event.routeId).
      ...(route ? { route } : {}),
      difficulty: settings.difficulty,
      assists: [settingsAssists(settings)],
      speedMultiplier: settings.speedMultiplier,
      slowMo: settings.slowMo,
      // W-Q: a free-play race draws its rivals from the region's whole cast and its time of day from
      // the region's list, by the seed; a career race keeps its event's own field and time.
      freePlay: !careerRace,
      // The sim's values plus the difficulty scales, read once at race start (app-3).
      tuning: { ...tuning.simValues(), ...raceStartValues(tuning.decls, (id) => tuning.get(id)) },
    });
    playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
    renderer.setTrafficTypes(config.trafficTypes);
    renderer.setRiderLooks(riderLooks(config));
    // The garage's paint on the player's bike (run W-R's garage; the seam from the rider-models lane).
    // The bike that rides wears the garage's paint for it (none on a bike the garage has not painted).
    const ridden = config.riders[playerId]?.bike.contentId ?? null;
    renderer.setPlayerPaint(
      C ? C.currentPaintHex(defs, { ...profile, bikes: { ...profile.bikes, current: ridden } }) : null,
    );
    // The roadside scenery scatters from the race's seed (playtest 1c item 2).
    renderer.setSceneSeed(seed);
    audio.setEngineSounds(engineSounds(config));
    return createSim(config);
  };
  // The attract scene: the grid, before anyone moves.
  curr = newSim(seeds.next()).snapshot();
  showRegion();

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
      // After the tap's own steps: Restart and Race again pass through the menu on their way back
      // into a race, and must not reload there.
      if (staleBuild)
        queueMicrotask(() => {
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
  const syncRunning = () => {
    if (holds.size > 0 || ui.paused) {
      loop.pause();
      audio.suspend();
      return;
    }
    loop.resume();
    if (state !== 'boot' && state !== 'tapToStart') void audio.resume();
  };
  const hold = (reason: 'hidden' | 'context', on: boolean) => {
    if (on) holds.add(reason);
    else holds.delete(reason);
    syncRunning();
  };
  const unpause = syncRunning;
  const ui = createUi(opts.host, {
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
      onCareer: () => void careerReady.then(() => openCareer()),
      // Menu first (playtest 4, P4-5): until the career has started the menu says "Start career".
      careerStarted: () => careerStarted(profile),
      // The menu race's options (playtest 4, P4-12 and P4-13) for the region picked on the menu (its
      // event, even before its road data is in) and the road picked there.
      // Install as an app (roadmap M5): the menu offers it only while the browser does.
      install: installOffer(),
      raceOptions: () => {
        const at = pickedChoice()?.eventId ?? eventId;
        return raceOptionsView(registry, at, at === eventId ? route : null, profile.bikes, settings.units);
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
          const m = await careerReady;
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
          const m = await careerReady;
          if (!m) return 'The career did not load. Reload the page and try again.';
          const r = await m.decodeExportCode(code);
          if (r.kind === 'newer') return 'That code comes from a newer build. Nothing changed.';
          if (r.kind !== 'ok') return `That code did not load: ${r.reason}.`;
          // The career it replaces is kept as a backup code, so loading one never loses another.
          const replaced = profile.history.length > 0;
          saveProfile(await m.restoreCareer(defs, profile, r.profile, build.id, new Date().toISOString()));
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
      onCopyReport: opts.callbacks.onCopyReport,
      ...(opts.callbacks.onSaveDebugFile ? { onSaveDebugFile: opts.callbacks.onSaveDebugFile } : {}),
      onPause: () => {
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
        unpause();
        // A career race restarts its own map node (the abandoned try pays nothing and records nothing).
        const c = careerRace;
        if (c && state === 'race') {
          startCareerRace(c.def, c.node);
          return;
        }
        if (go('back')) handle.startRace();
      },
      onQuit: () => {
        unpause();
        if (careerRace && state === 'race') quitCareerRace();
        else handle.backToMenu();
      },
      onSettingsChange: (next) => {
        settings = next;
        settingsStore.save(next);
        audio.setVolumes(audioVolumes(next), next.mute);
        input.setLayout({ ...layout, mirror: next.mirror || hud.mirror });
        input.setOptions(controlOptionsOf(next));
        renderer.setLook(next.look);
        const q = quality.setSetting(next.qualityTier);
        if (q) {
          drawnTier = q.tier;
          applyQuality(q);
        }
        applyShake(next);
        audio.setRadioCut(radioCut(next));
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
    if (careerRace) {
      settleCareerRace(false);
      return;
    }
    ui.showResults(
      raceResult(curr, playerId, outcome, {
        id: event.id,
        name: event.name,
        byPlaceCash: event.rewards.byPlaceCash,
      }),
    );
    ui.show('results');
  };

  const lookWatch = createLookFallback();
  const stepMs: number[] = [];
  // The race-start countdown: a beat is a second of loop steps; GO stays up for 0.8 s of race.
  const countdown = createCountdown(Math.round(1 / SIM_DT), Math.round(0.8 / SIM_DT));
  // The view key (C) or gamepad button: the camera's next view (camera-3). Not a race input. It
  // becomes the saved View, so the settings row shows it and a pick there takes effect; it works
  // on the grid too.
  const cycleViewOnPress = () => {
    if (input.lastActions().cycleCamera) ui.syncLive({ view: VIEW_MODES.indexOf(camera.cycleView()) });
    // The pad's pause button (2026-10-05; the keyboard's pause keys are ui's own): the pause screen.
    if (input.lastActions().pause) ui.pause();
  };
  const step = () => {
    if (!race) return;
    for (const change of pendingTuning.splice(0)) {
      race.applyParam(change.id, change.value);
      recorder.recordParam(race.tick, change.id, change.value);
    }
    // The countdown (playtest 4, P4-11): a held step is not a sim step. The sim waits at tick 0 for
    // everyone, nothing is recorded, and what the player pressed is read and dropped.
    const grid = countdown.step();
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
    }
    // The wheelie's band, every step (null while none): the buzz when it turns high is a swing.
    input.onMoves(curr.moves);
    if (tick % 60 === 0) recorder.checkpoint(tick, race.hash());
    outcome.note(events, playerId, tick);
    noteCareer(events, tick);
    stepListener?.(curr, events);
    const careerDone = careerRace?.doneTick ?? null;
    if (
      resultsDue(outcome, tick, race.isOver()) ||
      (careerDone !== null && tick >= careerDone + RESULTS_BEAT_TICKS)
    ) {
      recorder.finish(tick, race.hash());
      finishRace();
    }
  };

  const loop = createLoop(
    {
      stepping: () => state === 'race',
      step,
      shouldRunFrame: () => frameGate.shouldRun(),
      render(alpha, dt) {
        const me = curr ? interpolateEntity(state === 'race' ? prev : null, curr, alpha, playerId) : null;
        let pose: CameraPose | null = attractPose;
        if (me && state === 'race') {
          // The low chase cam reads the road (look-ahead), the rider's mode and auto-target (framing
          // bias) and the other riders' positions (camera-1).
          const at = curr?.entities[playerId];
          // Playtest 3's moves (the drift's slip and the wheelie's angle) lean the camera in too.
          pose = camera.update(
            {
              ...me,
              mode: at?.mode,
              targetId: at?.targetId,
              road: at?.road,
              drift: at?.drift,
              wheelie: at?.wheelie,
            },
            dt,
            {
              entities: curr?.entities,
              // The held look-back action (camera-1's lookBack: L, or the pad's R1).
              lookBack: input.lastActions().lookBack,
              // The view's shape: a wide phone-landscape view gets a higher camera (playtest 1 item 11).
              aspect: viewAspect(),
            },
          );
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
        if (pose) renderer.render(state === 'race' ? prev : null, curr, alpha, pose);
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
            renderer.setQuality(q.tier, q.scale);
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
    onHidden: () => {
      if (state === 'race') ui.pause();
      hold('hidden', true);
    },
    onShown: () => hold('hidden', false),
  });
  // Offline play (roadmap M5): a production build's worker caches the whole build once the page
  // has loaded, so a loaded game plays with the network off; and the watch for a build the host no
  // longer serves, which reloads to the current one when that loses nothing.
  staleBuild = startOffline(build.id, () => reloadLosesNothing(state));
  staleBuild?.onWaiting(offerUpdate);
  // A lost WebGL context holds the game until the renderer has rebuilt the scene (render-1).
  renderer.onContextChange((lost) => hold('context', lost));
  window.addEventListener('resize', () => renderer.resize());

  // The region picker (playtest 1c): a pick fetches that region's road data in the background,
  // and the menu's backdrop shows its road once loaded; Race starts there.
  let loadingRoads = false;
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
    // A race keeps the key it started under (its packs' roads were all in before it started).
    if (state === 'race') return;
    hashes = raceHashes(eventId);
    replayKey = appReplayKey(build, hashes.sim);
    offerRoutes();
  };
  /** The packs a race in this region reads (its pack and base) whose road data is not in yet. */
  const roadsMissing = (choice: RegionChoice): string[] =>
    packClosure(registry, choice.packId).filter((id) => !library.hasRoads(id));
  /**
   * Fetches the road data a race in a region needs (its pack's, and the Keys' real roads, which
   * every region's content hash covers through base), with a busy line; false (and a notice) when
   * it fails.
   */
  const loadRegion = async (choice: RegionChoice): Promise<boolean> => {
    loadingRoads = true;
    ui.setBusy(`Loading ${choice.name}`);
    try {
      await Promise.all(roadsMissing(choice).map((id) => library.loadRoads(id)));
      roadsArrived(library.registry());
      return true;
    } catch (err) {
      console.warn('region road data did not load', err);
      // Retry goes on to the race the player asked for (the picked region, fetched again).
      offerLoadRetry(ui, choice.name, () => handle.startRace(), failureOf(err, Date.now()));
      return false;
    } finally {
      loadingRoads = false;
      ui.setBusy(null);
    }
  };
  /** The menu backdrop follows the pick: the grid on that region's road. */
  const showPicked = () => {
    const choice = pickedChoice();
    if (!choice || state === 'race' || !library.hasRoads(choice.packId)) return;
    useEvent(choice.eventId);
    // Offered again even when the event did not change (back to a region before another's road
    // data arrived), so the picker never stays empty.
    offerRoutes();
    showRegion();
    curr = newSim(seeds.next()).snapshot();
    prev = null;
  };
  /** Fetches the picked region's road data in the background; says so, with Retry, if it fails. */
  const loadPicked = (choice: RegionChoice) =>
    void library.loadRoads(choice.packId).then(
      (reg) => {
        roadsArrived(reg);
        showPicked();
      },
      (err: unknown) => {
        console.warn('region road data did not load', err);
        // Only for the region still picked: a pick made since has its own load and its own say.
        if (pickedChoice()?.id === choice.id)
          offerLoadRetry(
            ui,
            choice.name,
            () => {
              if (pickedChoice()?.id === choice.id) loadPicked(choice);
            },
            failureOf(err, Date.now()),
          );
      },
    );
  const pickRegion = (id: string) => {
    const choice = regions.find((r) => r.id === id);
    if (!choice) return;
    clearLoadRetry(ui);
    // The routes on offer are the new region's, once its road data is in.
    if (choice.eventId !== eventId) ui.setRoutes([], null);
    if (library.hasRoads(choice.packId)) showPicked();
    else loadPicked(choice);
  };
  /**
   * The route picker (the maintainer, 2026-10-01: "Yes, add as routes"): a real road, or null for
   * the region's own road. The menu backdrop follows the pick; Race races it.
   */
  const pickRoute = (id: string | null) => {
    if (id === route) return;
    route = id;
    if (state === 'race') return;
    stream = streams.forEvent(registry, eventId, settings.raceLength, route);
    showRegion();
    curr = newSim(seeds.next()).snapshot();
    prev = null;
  };
  // The boot region's routes (the Keys: the causeway road, then the real Bahia Honda stretch once
  // its road data is in). The Keys' real roads are not in the first-load bundle (run W-P): they are
  // fetched now, in the background, so the picker offers them and a race starts without a wait.
  offerRoutes();
  const loadKeysRoads = () =>
    void library.loadRoads('base').then(roadsArrived, (err: unknown) => {
      // Said on the menu with Retry (Race also fetches them again, with a busy line, if it must).
      console.warn('the Keys real-road data did not load', err);
      offerLoadRetry(ui, "The Keys' real roads", loadKeysRoads, failureOf(err, Date.now()));
    });
  if (!library.hasRoads('base')) loadKeysRoads();

  // ---- The career flow (run W-R) ----------------------------------------------------------------
  const careerReady: Promise<CareerFlow | null> = import('./career-flow').then(
    (m) => {
      C = m;
      defs = m.careerDefs(registry);
      careerRegion ||= defs[0]?.regionId ?? '';
      return m;
    },
    (err: unknown) => {
      console.warn('the career did not load', err);
      return null;
    },
  );

  /** Starts a race and its recording at the current event and route, at `lengthId`. */
  function launchRace(lengthId: string): boolean {
    stream = streams.forEvent(registry, eventId, lengthId, route);
    if (!go('race')) return false;
    // W-Q: a free-play race's light is drawn by its seed, or picked in its options with its weather
    // (playtest 4, P4-12); a career race keeps its event's own.
    const seed = seeds.next();
    const options = careerRace ? null : settings.raceOptions;
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
    );
    race = newSim(seed);
    pendingTuning.length = 0;
    countdown.begin(countdownOn());
    // The full header (the SimConfig as plain data), so a saved debug file replays on its own, and a
    // menu race's picks beside it (playtest 4, P4-12).
    recorder.beginRace(race, replayKey, options ? { ...options } : undefined);
    outcome = createOutcome();
    finishShot = null;
    lookWatch.reset();
    seenPoll.reset();
    lastLandingRef = null;
    input.onMoves(null);
    prev = null;
    curr = race.snapshot();
    recent = [];
    const me = curr.entities[playerId];
    if (me) camera.snap(me, { aspect: viewAspect() });
    input.calibrateTilt(); // the phone's angle now is straight ahead
    ui.show('race');
    return true;
  }

  /**
   * Starts (or restarts) a career race at a map node: its region's road data first (with a busy
   * line), then the race with the node's length, the career's bike and grudges, and the race log
   * that watches the event's rules.
   */
  function startCareerRace(def: CareerDef, node: CareerNode): void {
    const m = C;
    if (loadingRoads || !m) return;
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
    if (missing.length > 0) {
      loadingRoads = true;
      ui.setBusy(`Loading ${def.regionName}`);
      void Promise.all(missing.map((id) => library.loadRoads(id)))
        .then(
          () => {
            roadsArrived(library.registry());
            return true;
          },
          (err: unknown) => {
            console.warn('career road data did not load', err);
            offerLoadRetry(ui, def.regionName, () => startCareerRace(def, node), failureOf(err, Date.now()));
            return false;
          },
        )
        .then((ok) => {
          loadingRoads = false;
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

  /** One step of a career race: its rules, its prompts, the objective line, an early end. */
  function noteCareer(events: readonly SimEvent[], tick: number): void {
    const c = careerRace;
    if (!c?.log || !curr) return;
    c.log.note(events, curr);
    const prompt = c.onboarding.note(events, curr, playerId);
    if (prompt) ui.career.prompt(prompt.text);
    const s = c.log.status();
    if (s.headline !== c.headline) {
      c.headline = s.headline;
      ui.career.setObjective(s.headline);
    }
    if (s.endNow && c.doneTick === null) c.doneTick = tick;
    noteAsk(c, events);
  }

  /**
   * The producer's one ask in a career race (run W-S): asked once the player is ASK_AT_FRACTION
   * along the route, then judged from that moment by its own race log; a prompt when it is met.
   */
  function noteAsk(c: NonNullable<typeof careerRace>, events: readonly SimEvent[]): void {
    const m = C;
    const me = curr?.entities[playerId];
    if (!m || !c.ask || !curr || !me) return;
    if (!c.askLog) {
      const length = curr.race.routeLength;
      if (curr.race.over || me.finished || length <= 0 || me.progress < m.ASK_AT_FRACTION * length) return;
      c.askLog = m.createRaceLog({
        playerId,
        rules: { kind: 'classic-race' },
        objectives: [m.askObjective(c.ask)],
        routeId: '',
        roadIds: [],
      });
      ui.ticker.push(producerAskItem(c.ask));
    }
    c.askLog.note(events, curr);
    if (!c.askMet && c.askLog.status().objectives[0]?.met === true) {
      c.askMet = true;
      ui.ticker.push(producerThanksItem(c.ask));
    }
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
    careerRace = null;
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
    const settled = m.settleRace(profile, {
      reg: registry,
      def: c.def,
      node: c.node,
      plan: c.plan,
      status,
      tally,
      quit,
      build: build.id,
      at: new Date().toISOString(),
    });
    saveProfile({
      ...settled.profile,
      oncePerCareer: m.withPromptsSeen(settled.profile.oncePerCareer, c.onboarding.shown()),
    });
    if (quit) return;
    pendingTeaser = m.teaserView(defs, settled.report);
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
  }

  /** The pause menu's Quit in a career race: it counts as a quit (no cash), then the map. */
  function quitCareerRace(): void {
    if (!go('back')) return;
    race = null;
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
    if (missing.length > 0)
      void Promise.all(missing.map((id) => library.loadRoads(id))).then(
        () => {
          roadsArrived(library.registry());
          if (careerRegion === def.regionId && state !== 'race') drawCareer();
        },
        () => undefined, // the list still works; Ride fetches again and says so if it fails
      );
  }

  /**
   * The Start Season button (playtest 3, round 2: "Season 2+ with a harder field and remixed
   * events"): once every region boss of this season has fallen, the next season starts with a seed
   * drawn now and saved with it. It resets the maps, so only the player's tap starts it.
   */
  function startNextSeason(): void {
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
    const m = C ?? (await careerReady);
    if (!m || state === 'race') return 'The career did not load. Reload the page and try again.';
    const made = await m.startNewCareer(defs, profile, build.id, new Date().toISOString());
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
    if (!r.ok) {
      ui.career.message(r.reason);
      return;
    }
    saveProfile(r.profile);
    drawCareer();
  }

  const handle: AppHandle = {
    build,
    state: () => state,
    snapshot: () => curr,
    recentEvents: () => recent,
    playerId: () => playerId,
    setTickDriver(driver) {
      input.setDriver(driver ? (a) => (curr ? driver(curr, a) : undefined) : null);
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
      void runStartTap(() => audio.resume());
      go('tapped');
      // Menu first (playtest 4, P4-5): the first tap of a new device lands on the menu, where
      // "Start career" is the obvious next tap; a race starts only from a button.
      ui.show('menu');
    },
    startRace() {
      if (transition(state, 'race') === null || loadingRoads) return;
      // The menu's Race is free play.
      careerRace = null;
      ui.career.setObjective(null);
      // The race runs in the region picked on the menu. A region pack's road data is fetched the
      // first time (docs/content-packs.md, "Region packs at runtime"); the race starts after.
      // The Keys' real roads too (run W-P): fetched at boot and almost always in by now. Every
      // race's content hash covers them (through base), so a race waits for them rather than start
      // under a replay key that moves when they arrive.
      const choice = pickedChoice() ?? regions.find((r) => r.eventId === eventId);
      if (choice && roadsMissing(choice).length > 0) {
        void loadRegion(choice).then((ok) => {
          if (ok) handle.startRace();
        });
        return;
      }
      if (choice) useEvent(choice.eventId);
      // The chosen race length's route (the settings' Race length; an id the event lacks means its
      // standard length), or the real road picked on the menu.
      launchRace(settings.raceLength);
    },
    backToMenu() {
      if (!go('back')) return;
      race = null;
      // A career race left this way is abandoned: it records nothing.
      careerRace = null;
      ui.career.setObjective(null);
      ui.show('menu');
    },
    career: () => ({
      profile,
      racing: careerRace ? { region: careerRace.def.regionId, node: careerRace.node.id } : null,
      status: careerRace?.log?.status() ?? null,
    }),
    rideCareer(region, node) {
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
    roadQueries: () => race?.config.route ?? null,
    getReplayAndSettings: () => ({
      replay: recorder.current(),
      settings: settingsStore.record() ?? settings,
    }),
    replayFile: () => recorder.file(),
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
      if (testFlagOn()) loop.setLockstep(steps);
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

  go('booted');
  ui.show('start');
  loop.start();
  return handle;
}
