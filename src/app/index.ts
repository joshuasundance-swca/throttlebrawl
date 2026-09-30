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
import { assetIndex, contentHashes, loadBasePack, lookup } from '../content';
import { createHaptics, createInput, type ActionState } from '../input';
import { APP_ID, runStartTap, watchLifecycle } from '../platform';
import { createRenderer, interpolateEntity } from '../render';
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
import { buildSimConfig, DEFAULT_EVENT, raceStartValues, streamForEvent } from './config';
import { createLoop } from './loop';
import { appReplayKey } from './replay-key';
import { createOutcome, raceResult, resultsDue } from './results';
import { transition, type AppEvent, type AppState } from './states';
import { APP_TUNING, presentationOwner } from './tuning';

export { createHeadlessRace } from './headless';
export type { HeadlessOptions, HeadlessRace } from './headless';
export { buildSimConfig, DEFAULT_EVENT, streamForEvent } from './config';
export { resumeFromRecording, roadsForHeader } from './resume';
export type { ResumeResult, RoadsFor } from './resume';
export { planFrame, MAX_FRAME_S, MAX_STEPS_PER_FRAME } from './loop';
export { transition } from './states';
export type { AppState, AppEvent } from './states';
export { APP_TUNING } from './tuning';
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
  /** Race seed; a fixed seed makes a test run repeatable. */
  seed?: number;
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
  let seed = opts.seed ?? 1;

  // Content, the region, and the layout record.
  const registry = loadBasePack({ includeDrafts: build.channel !== 'prod' });
  const hashes = contentHashes(registry);
  const replayKey = appReplayKey(build, hashes.sim);
  const stream = streamForEvent(registry, DEFAULT_EVENT);
  const event = lookup(registry.events, DEFAULT_EVENT);
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
  const dressing = Object.fromEntries(stream.road.edges.map((e) => [e.id, lookup(registry.roads, e.id)]));
  renderer.setRoad(stream.road, { timeOfDay: event.timeOfDay }, dressing);
  const camera = createFollowCamera({ road: stream.road });
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

  const newSim = (): Sim => {
    const config = buildSimConfig(registry, stream, {
      seed,
      eventId: DEFAULT_EVENT,
      // The sim's values plus the difficulty scales, read once at race start (app-3).
      tuning: { ...tuning.simValues(), ...raceStartValues(tuning.decls, (id) => tuning.get(id)) },
    });
    playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
    renderer.setTrafficTypes(config.trafficTypes);
    audio.setEngineSounds(engineSounds(config));
    return createSim(config);
  };
  // The attract scene: the grid, before anyone moves.
  curr = newSim().snapshot();

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
    liveSettings: liveControlSettings(browserControlDevice(createHaptics().supported)),
    callbacks: {
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

  let attractPose: CameraPose | null = null;
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
          });
        } else if (me && !attractPose) pose = attractPose = camera.snap(me);
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
      seed = s >>> 0;
    },
    tap() {
      if (state !== 'tapToStart') return;
      void runStartTap(() => audio.resume());
      go('tapped');
      ui.show('menu');
    },
    startRace() {
      if (!go('race')) return;
      race = newSim();
      pendingTuning.length = 0;
      // The full header (the SimConfig as plain data), so a saved debug file replays on its own.
      recorder.beginRace(race, replayKey);
      outcome = createOutcome();
      prev = null;
      curr = race.snapshot();
      recent = [];
      const me = curr.entities[playerId];
      if (me) camera.snap(me);
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
      // M1 has one event and one region, so the road and route handles are this build's.
      const base = buildSimConfig(registry, stream, { seed: rec.header.seed, eventId: DEFAULT_EVENT });
      const sim = createSim(configFromHeader(rec.header, base.road, base.route));
      const result = createReplayController(rec).run(sim);
      return {
        ticks: result.ticks,
        checked: result.checked,
        desync: result.desync,
        keyMatches: rec.header.replayKey === replayKey,
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
