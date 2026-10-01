// app: boot, the loop, the state machine and the wiring of every module (docs/architecture.md,
// "Ownership table"). Capabilities the module map does not draw travel as plain callbacks typed in
// core (reached through sim/api): main.ts injects onCopyReport; app wires resumeAudio (audio ->
// platform), recordTuningChange (tuning -> replay and the sim), packIndex (content -> assets), and
// hands rendererStats, roadQueries and getReplayAndSettings to dev/ through the AppHandle. main.ts
// may also inject onSaveDebugFile (dev-3's "save debug file"); the AppHandle's replayFile() and
// checkReplay() let dev/ carry and verify the recording without importing replay/.
// app-2 owns this folder after app-1.
import { createAssetManifest } from '../assets';
import { createAudio, type EngineSoundSpec } from '../audio';
import { createFollowCamera, type CameraPose } from '../camera';
import {
  assetIndex,
  contentHashes,
  createPackLibrary,
  lookup,
  packClosure,
  packOf,
  packSubset,
} from '../content';
import { createHaptics, createInput, type ActionState } from '../input';
import { APP_ID, runStartTap, watchLifecycle } from '../platform';
import { createRenderer, interpolateEntity, type LookEnv } from '../render';
import { configFromHeader, createInputRecorder, createReplayController, decodeReplay } from '../replay';
import { createSettingsStore, type StorageLike } from '../save';
import { browserControlDevice, controlOptionsOf, liveControlSettings } from './controls';
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
import { buildSimConfig, DEFAULT_EVENT, eventKey, networkKeyOf, qualifyIn, raceStartValues } from './config';
import { createLoop } from './loop';
import { appReplayKey } from './replay-key';
import { createOutcome, raceResult, resultsDue } from './results';
import {
  boardCatalog,
  createStreamCache,
  racePalette,
  regionChoices,
  regionKeyOf,
  routeKeyOf,
  type RegionChoice,
} from './regions';
import { roadsForHeader } from './resume';
import { createRaceSeeds, type SeedSource } from './seed';
import { transition, type AppEvent, type AppState } from './states';
import { APP_TUNING, presentationOwner } from './tuning';

export { createHeadlessRace } from './headless';
export type { HeadlessOptions, HeadlessRace } from './headless';
export { buildSimConfig, DEFAULT_EVENT, eventKey, qualifyIn, streamForEvent, streamForRoute } from './config';
export {
  boardCatalog,
  createStreamCache,
  racePalette,
  regionChoices,
  regionKeyOf,
  routeKeyOf,
} from './regions';
export type { RegionChoice, StreamCache } from './regions';
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
}

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
  let stream = streams.forEvent(registry, eventId);
  let event = lookup(registry.events, eventId);
  let hashes = raceHashes(eventId);
  let replayKey = appReplayKey(build, hashes.sim);
  const hudId = registry.packs[0]?.defaults.hud ?? 'classic';
  const hud = lookup(registry.hudLayouts, hudId);
  createAssetManifest(() => assetIndex(registry));

  // Settings, tuning and replay.
  const settingsStore = createSettingsStore({ keyPrefix: APP_ID, build: build.id, storage: safeStorage() });
  let settings = settingsStore.load();
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
  const frameGate = createFrameGate(() => tuning.get(FRAME_DIVISOR_ID));

  // Presentation. The renderer gets the road files as set dressing (rails, ramp stripes).
  const renderer = createRenderer(opts.canvas);
  // The look (playtest 1b item 6): render only, applied at once and never part of SimConfig.
  renderer.setLook(settings.look);
  /** The canvas's width over its height, as the renderer's camera uses it. */
  const viewAspect = () => opts.canvas.clientWidth / Math.max(1, opts.canvas.clientHeight);
  const camera = createFollowCamera({ road: stream.road });
  let attractPose: CameraPose | null = null;
  /** The network the renderer and camera show, so a race in the same region rebuilds nothing. */
  let shownRoad: unknown = null;
  /**
   * Shows the race's region: its road with the road files as set dressing (rails, ramp stripes),
   * its signs and billboards (minus this device's cuts), its time of day and palette.
   */
  const showRegion = () => {
    if (shownRoad === stream.road) return;
    shownRoad = stream.road;
    const regionKey = regionKeyOf(registry, eventId);
    const roadPack = packOf(networkKeyOf(registry, routeKeyOf(registry, eventId)));
    const dressing = Object.fromEntries(
      stream.road.edges.map((e) => [e.id, lookup(registry.roads, qualifyIn(roadPack, e.id))]),
    );
    const vetoed = new Set(settings.vetoes.map((v) => v.contentRef));
    // `palette` waits for the render lane to read it (docs/content-packs.md, "Region packs at
    // runtime", Palette); until then the renderer ignores it and draws the look's own palette.
    const env: LookEnv & { palette: Record<string, string> } = {
      timeOfDay: event.timeOfDay,
      palette: racePalette(registry, regionKey, event.timeOfDay),
    };
    renderer.setRoad(stream.road, env, dressing, boardCatalog(registry, regionKey, vetoed));
    camera.setRoad(stream.road);
    attractPose = null;
  };
  /** Makes `id` (a qualified event) the race's event; its pack's road data must be loaded. */
  const useEvent = (id: string) => {
    if (id === eventId) return;
    eventId = id;
    stream = streams.forEvent(registry, eventId);
    event = lookup(registry.events, eventId);
    hashes = raceHashes(eventId);
    replayKey = appReplayKey(build, hashes.sim);
  };
  const audio = createAudio();
  audio.setVolumes(settings.volumes, settings.mute);
  /** Each rider's engine patch, from its bike file (audio keys them by rider content id). */
  const engineSounds = (config: SimConfig): Record<string, EngineSoundSpec> => {
    const out: Record<string, EngineSoundSpec> = {};
    for (const r of config.riders) {
      const bike = registry.bikes[r.bike.contentId];
      if (bike) out[r.contentId] = bike.engineSound;
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
      // The sim's values plus the difficulty scales, read once at race start (app-3).
      tuning: { ...tuning.simValues(), ...raceStartValues(tuning.decls, (id) => tuning.get(id)) },
    });
    playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
    renderer.setTrafficTypes(config.trafficTypes);
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
    liveSettings: [...liveControlSettings(browserControlDevice(createHaptics().supported)), 'look'],
    // The menu's region picker (#160): every carried region with an event, the Keys picked.
    regions: regions.map((r) => ({ id: r.id, name: r.name, ...(r.blurb ? { blurb: r.blurb } : {}) })),
    region: regionKeyOf(registry, eventId),
    callbacks: {
      onRegionChange: (id) => pickRegion(id),
      onStartTap: () => handle.tap(),
      onRace: () => handle.startRace(),
      onBackToMenu: () => handle.backToMenu(),
      onCopyReport: opts.callbacks.onCopyReport,
      ...(opts.callbacks.onSaveDebugFile ? { onSaveDebugFile: opts.callbacks.onSaveDebugFile } : {}),
      onPause: syncRunning,
      onResume: unpause,
      onRestart: () => {
        unpause();
        if (go('back')) handle.startRace();
      },
      onQuit: () => {
        unpause();
        handle.backToMenu();
      },
      onSettingsChange: (next) => {
        settings = next;
        settingsStore.save(next);
        audio.setVolumes(next.volumes, next.mute);
        input.setLayout({ ...layout, mirror: next.mirror || hud.mirror });
        input.setOptions(controlOptionsOf(next));
        renderer.setLook(next.look);
      },
    },
  });
  if (settingsStore.notice) ui.notice(settingsStore.notice);
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
  tuning.onChange(applyPresentationParam);
  for (const d of tuning.decls) if (!d.affectsSim) applyPresentationParam(d.id, tuning.get(d.id));

  // The player's own finish or bust (app/results.ts): results, or "Busted" and the fine.
  let outcome = createOutcome();
  const finishRace = () => {
    if (!race || !curr || !go('finished')) return;
    ui.showResults(
      raceResult(curr, playerId, outcome, {
        id: event.id,
        name: event.name,
        byPlaceCash: event.rewards.byPlaceCash,
      }),
    );
    ui.show('results');
  };

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
    const t0 = performance.now();
    race.step([cmd]);
    stepMs.push(performance.now() - t0);
    if (stepMs.length > 600) stepMs.shift();
    prev = curr;
    curr = race.snapshot();
    const events = race.events();
    if (events.length) {
      recent = recent.concat(events).slice(-300);
      ui.narrative.onEvents(events, { snapshot: curr, seed: race.config.seed });
      camera.onEvents(events);
      audio.onEvents(events, curr);
      renderer.pushEvents(events);
      input.onEvents(events, playerId);
    }
    if (tick % 60 === 0) recorder.checkpoint(tick, race.hash());
    outcome.note(events, playerId, tick);
    stepListener?.(curr, events);
    if (resultsDue(outcome, tick, race.isOver())) {
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
  /** Fetches a region pack's road data, with a busy line; false (and a notice) when it fails. */
  const loadRegion = async (choice: RegionChoice): Promise<boolean> => {
    loadingRoads = true;
    ui.setBusy(`Loading ${choice.name}`);
    try {
      registry = await library.loadRoads(choice.packId);
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
    showRegion();
    curr = newSim(seeds.next()).snapshot();
    prev = null;
  };
  const pickRegion = (id: string) => {
    const choice = regions.find((r) => r.id === id);
    if (!choice) return;
    if (library.hasRoads(choice.packId)) showPicked();
    else
      void library.loadRoads(choice.packId).then(
        (reg) => {
          registry = reg;
          showPicked();
        },
        () => undefined, // Race tries again and says so if it fails
      );
  };

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
    },
    startRace() {
      if (transition(state, 'race') === null || loadingRoads) return;
      // The race runs in the region picked on the menu. A region pack's road data is fetched the
      // first time (docs/content-packs.md, "Region packs at runtime"); the race starts after.
      const choice = pickedChoice();
      if (choice && !library.hasRoads(choice.packId)) {
        void loadRegion(choice).then((ok) => {
          if (ok) handle.startRace();
        });
        return;
      }
      if (choice) useEvent(choice.eventId);
      showRegion();
      if (!go('race')) return;
      race = newSim(seeds.next());
      pendingTuning.length = 0;
      // The full header (the SimConfig as plain data), so a saved debug file replays on its own.
      recorder.beginRace(race, replayKey);
      outcome = createOutcome();
      prev = null;
      curr = race.snapshot();
      recent = [];
      const me = curr.entities[playerId];
      if (me) camera.snap(me, { aspect: viewAspect() });
      input.calibrateTilt(); // the phone's angle now is straight ahead
      ui.show('race');
    },
    backToMenu() {
      if (!go('back')) return;
      race = null;
      ui.show('menu');
    },
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
  };

  go('booted');
  ui.show('start');
  loop.start();
  return handle;
}
