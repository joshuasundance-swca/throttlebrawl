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
  CareerDef,
  CareerNode,
  EventPlan,
  GarageResult,
  Onboarding,
  RaceLog,
  RaceStatus,
} from '../career';
import { createAudio, type EngineSoundSpec } from '../audio';
import { createFollowCamera, VIEW_MODES, type CameraMode, type CameraPose, type ViewMode } from '../camera';
import {
  assetIndex,
  contentHashes,
  createPackLibrary,
  lookup,
  packClosure,
  packOf,
  packSubset,
  type ContentRegistry,
} from '../content';
import { createHaptics, createInput, type ActionState } from '../input';
import { APP_ID, runStartTap, watchLifecycle } from '../platform';
import { createRenderer, interpolateEntity, type LookEnv } from '../render';
import { configFromHeader, createInputRecorder, createReplayController, decodeReplay } from '../replay';
import {
  audioVolumes,
  createProfileStore,
  createSettingsStore,
  PROFILE_VERSION,
  settingsAssists,
  type FrameRateCap,
  type Profile,
  type StorageLike,
} from '../save';
import { browserControlDevice, controlOptionsOf, liveControlSettings } from './controls';
import { createLookFallback } from './look-fallback';
import {
  createSim,
  SIM_DT,
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
import { createUi } from '../ui';
import {
  buildSimConfig,
  DEFAULT_EVENT,
  eventKey,
  networkKeyOf,
  qualifyIn,
  raceStartValues,
  raceTimeOfDay,
} from './config';
import { createLoop } from './loop';
import { appReplayKey } from './replay-key';
import type { CareerFlow } from './career-flow';
import { createOutcome, raceResult, RESULTS_BEAT_TICKS, resultsDue } from './results';
import {
  boardCatalog,
  createStreamCache,
  narrativeSettingOf,
  racePalette,
  raceRadio,
  regionChoices,
  regionKeyOf,
  routeChoices,
  routeKeyOf,
  type RegionChoice,
} from './regions';
import { roadsForHeader } from './resume';
import { createRaceSeeds, type SeedSource } from './seed';
import { transition, type AppEvent, type AppState } from './states';
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
  /** The loop draws one animation frame in every `frameDivisor`. */
  display: { frameDivisor: number };
  radio: { region: string | null; stations: string[]; tunedTo: string };
  /** The look render draws now (`classic`, `kodak`, ...). */
  look: string;
  /** The gains audio's buses aim for (0..1 after the taper): the voices bus is 0 while voices are off. */
  audio: {
    busTargets: { master: number; music: number; effects: number; voices: number };
    /** Whether audio would speak a bark now (not muted, and the voices bus up: Voices on, slider up). */
    voicesOn: boolean;
  };
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
 * The race-first start (docs/content-packs.md, "Career": `firstRun`): a device whose career has not
 * started goes from the start tap straight into the career's first race. Under the test flag only
 * when a spec asks (`window.__raceFirst = true`), so the specs that expect the menu still get it.
 */
function raceFirstOn(): boolean {
  const w = window as Window & { __GAME_TEST__?: boolean; __raceFirst?: unknown };
  return w.__GAME_TEST__ !== true || w.__raceFirst === true;
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
    log: RaceLog | null;
    onboarding: Onboarding;
    /** The tick its rules decided the event early (a hunt at its count, an escape), or null. */
    doneTick: number | null;
    headline: string;
  } | null = null;
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
  /** The canvas's width over its height, as the renderer's camera uses it. */
  const viewAspect = () => opts.canvas.clientWidth / Math.max(1, opts.canvas.clientHeight);
  const camera = createFollowCamera({ road: stream.road });
  let attractPose: CameraPose | null = null;
  /** The network the renderer and camera show, so a race in the same region rebuilds nothing. */
  let shownRoad: unknown = null;
  /** The time of day shown: the event's on the menu, the race's own in a free-play race (W-Q). */
  let shownTime = '';
  /**
   * Shows the race's region: its road with the road files as set dressing (rails, ramp stripes),
   * its signs and billboards (minus this device's cuts), its time of day and palette.
   */
  const showRegion = (timeOfDay: string = String(event.timeOfDay)) => {
    if (shownRoad === stream.road && shownTime === timeOfDay) return;
    shownRoad = stream.road;
    shownTime = timeOfDay;
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
    const env: LookEnv & { palette: Record<string, string> } = {
      timeOfDay,
      palette: racePalette(registry, regionKey, timeOfDay),
    };
    renderer.setRoad(stream.road, env, dressing, boardCatalog(registry, regionKey, vetoed));
    camera.setRoad(stream.road);
    // The regional soundscape reads the road's scenery tags (bridges, water, cable lines, forest).
    audio.setRoad(stream.road);
    attractPose = null;
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
   * Each rider's engine patch, from its bike file (audio keys them by rider content id), plus the
   * bike class the rider is drawn on (`look.bikeClass`), whose voice audio prefers (playtest 2:
   * "a voice per bike").
   */
  const engineSounds = (config: SimConfig): Record<string, EngineSoundSpec> => {
    const out: Record<string, EngineSoundSpec> = {};
    for (const r of config.riders) {
      const bike = registry.bikes[r.bike.contentId];
      const look = (registry.riders[r.contentId] as { look?: { bikeClass?: unknown } } | undefined)?.look;
      const bikeClass = typeof look?.bikeClass === 'string' ? look.bikeClass : undefined;
      if (bike) out[r.contentId] = bikeClass ? { ...bike.engineSound, bikeClass } : bike.engineSound;
    }
    return out;
  };

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
      // The career's bike rides every race (the garage, run W-R); its grudges ride career races
      // only (grudges outside a career are "light persistence, later" [decided]).
      ...(profile.bikes.current ? { playerBike: profile.bikes.current } : {}),
      ...(careerRace ? { grudges: profile.grudges } : {}),
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
    // The roadside scenery scatters from the race's seed (playtest 1c item 2).
    renderer.setSceneSeed(seed);
    audio.setEngineSounds(engineSounds(config));
    return createSim(config);
  };
  // The attract scene: the grid, before anyone moves.
  curr = newSim(seeds.next()).snapshot();
  showRegion();

  const go = (e: AppEvent) => {
    const next = transition(state, e);
    if (next) state = next;
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
      'slowMo',
      'reduceShake',
      'frameRateCap',
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
          saveProfile(m.startCareer(defs, r.profile));
          openCareer(careerRegion, 'garage');
          return `Loaded: $${r.profile.cash}, ${r.profile.history.length} races. Your settings stay this device's.`;
        },
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
      onPause: syncRunning,
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
  // Reduce screen shake [decided]: no shake and no hit jolt (camera-2's setShakeAmount 0). [default]
  let shakeAmount = 1;
  function applyShake(s: typeof settings) {
    shakeAmount = s.reduceShake ? 0 : 1;
    camera.setShakeAmount(shakeAmount);
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
  const step = () => {
    if (!race) return;
    for (const change of pendingTuning.splice(0)) {
      race.applyParam(change.id, change.value);
      recorder.recordParam(race.tick, change.id, change.value);
    }
    const tick = race.tick;
    const cmd = input.sample(SIM_DT);
    recorder.record(tick, [cmd]);
    // The view key (C) or gamepad button: the camera's next view (camera-3). Not a race input. It
    // becomes the saved View, so the settings row shows it and a pick there takes effect.
    if (input.lastActions().cycleCamera) ui.syncLive({ view: VIEW_MODES.indexOf(camera.cycleView()) });
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
    }
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
          pose = camera.update({ ...me, mode: at?.mode, targetId: at?.targetId, road: at?.road }, dt, {
            entities: curr?.entities,
            // The held look-back action (camera-1's lookBack: L, or the pad's R1).
            lookBack: input.lastActions().lookBack,
            // The view's shape: a wide phone-landscape view gets a higher camera (playtest 1 item 11).
            aspect: viewAspect(),
          });
        } else if (me && !attractPose) pose = attractPose = camera.snap(me, { aspect: viewAspect() });
        if (pose) renderer.render(state === 'race' ? prev : null, curr, alpha, pose);
        // The engines (yours and the nearest riders'), the siren, horns and the music (audio-1).
        audio.frame(state === 'race' ? curr : null, playerId);
        // The whole-snapshot HUD: speed, "1st / N" among the racers (not the traffic), your health
        // and your target's.
        if (state === 'race' && curr) ui.updateRace(curr, playerId, settings.units);
        // The look fallback (run W-O): frames that stay slow on an ink look bring up ui's offer to
        // switch to Classic, once a race, unless the player said no before.
        const racing = state === 'race' && !ui.paused && holds.size === 0;
        const inkLook = settings.look !== 'classic' && !settings.lookFallbackDismissed && lookWatchOn();
        if (lookWatch.frame(dt * 1000, { racing, inkLook, divisor: frameDivisor() })) ui.offerClassicLook();
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
      ui.notice(`${choice.name} did not load. Check the connection and tap Race again.`);
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
  const pickRegion = (id: string) => {
    const choice = regions.find((r) => r.id === id);
    if (!choice) return;
    // The routes on offer are the new region's, once its road data is in.
    if (choice.eventId !== eventId) ui.setRoutes([], null);
    if (library.hasRoads(choice.packId)) showPicked();
    else
      void library.loadRoads(choice.packId).then(
        (reg) => {
          roadsArrived(reg);
          showPicked();
        },
        () => undefined, // Race tries again and says so if it fails
      );
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
  if (!library.hasRoads('base'))
    void library.loadRoads('base').then(roadsArrived, (err: unknown) => {
      // Race fetches them again, with a busy line and a notice if that fails too.
      console.warn('the Keys real-road data did not load', err);
    });

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
    // W-Q: a free-play race's light is drawn by its seed; a career race keeps its event's own.
    const seed = seeds.next();
    showRegion(raceTimeOfDay(registry, eventId, seed, !careerRace));
    race = newSim(seed);
    pendingTuning.length = 0;
    // The full header (the SimConfig as plain data), so a saved debug file replays on its own.
    recorder.beginRace(race, replayKey);
    outcome = createOutcome();
    lookWatch.reset();
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
            ui.notice(`${def.regionName} did not load. Check the connection and try again.`);
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
    const plan = m.eventPlan(registry, node.event);
    const length = m.nodeLength(plan, node);
    careerRace = {
      def,
      node,
      plan,
      length: length?.id ?? null,
      log: null,
      onboarding: m.createOnboarding(profile.oncePerCareer),
      doneTick: null,
      headline: '',
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
  }

  /** Settles the career race into the profile (and saves it); the results screen unless it was a quit. */
  function settleCareerRace(quit: boolean): void {
    const c = careerRace;
    const m = C;
    careerRace = null;
    ui.career.setObjective(null);
    if (!c?.log || !m) return;
    const status = c.log.status();
    const tally = c.log.tally();
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
    ui.career.showResults(
      m.resultView(registry, c.def, c.plan, status, settled.report, tally.place, tally.racers, profile),
    );
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
    ui.career.showMap(
      C.mapView(registry, defs, profile, careerRegion),
      C.garageView(registry, defs, profile, settings.units),
      tab,
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
    tap() {
      if (state !== 'tapToStart') return;
      void runStartTap(() => audio.resume());
      go('tapped');
      ui.show('menu');
      // Race-first (docs/content-packs.md, "Career"): a career that has not started begins with its
      // first race, the prompts teaching as they become relevant; the menu is only behind it.
      if (careerStarted(profile) || !raceFirstOn()) return;
      const raceFirst = () => {
        const first = C?.firstRace(defs);
        if (!C || !first || careerStarted(profile) || state !== 'menu') return;
        saveProfile(C.startCareer(defs, profile));
        startCareerRace(first.def, first.node);
      };
      if (C) raceFirst();
      else {
        ui.setBusy('Loading');
        void careerReady.then(() => {
          ui.setBusy(null);
          raceFirst();
        });
      }
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
    contentHashes: () => hashes,
    replayKey: () => replayKey,
    presentation() {
      // The stations audio itself offers now (its own region filter applied), and what it plays.
      const mix = audio.inspect();
      const r = mix.radio;
      return {
        camera: { view: camera.view, mode: camera.mode, shake: shakeAmount },
        display: { frameDivisor: frameDivisor() },
        radio: { region: radio.region, stations: r.stations, tunedTo: r.tunedTo },
        look: renderer.look,
        audio: { busTargets: mix.busTargets, voicesOn: mix.voice.on },
      };
    },
  };

  go('booted');
  ui.show('start');
  loop.start();
  return handle;
}
