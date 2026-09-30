// app: boot, the loop, the state machine and the wiring of every module (docs/architecture.md,
// "Ownership table"). Capabilities the module map does not draw travel as plain callbacks typed in
// core (reached through sim/api): main.ts injects onCopyReport; app wires resumeAudio (audio ->
// platform), recordTuningChange (tuning -> replay and the sim), packIndex (content -> assets), and
// hands rendererStats, roadQueries and getReplayAndSettings to dev/ through the AppHandle.
// app-2 owns this folder after app-1.
import { createAssetManifest } from '../assets';
import { createAudio } from '../audio';
import { CAMERA_TUNING, createFollowCamera, type CameraPose } from '../camera';
import { assetIndex, contentHashes, loadBasePack, lookup } from '../content';
import { createInput, type ActionState } from '../input';
import { APP_ID, runStartTap, watchLifecycle } from '../platform';
import { createRenderer, interpolateEntity } from '../render';
import { createInputRecorder, REPLAY_FORMAT_VERSION } from '../replay';
import { createSettingsStore, type StorageLike } from '../save';
import {
  createSim,
  SIM_DT,
  SIM_TUNING,
  type GetReplayAndSettings,
  type OnCopyReport,
  type RendererStatsFn,
  type RoadQueriesFn,
  type Sim,
  type SimEvent,
  type SimSnapshot,
  type TouchLayout,
} from '../sim/api';
import { createTuningRegistry } from '../tuning';
import { createUi } from '../ui';
import { AUDIO_TUNING } from '../audio';
import { buildSimConfig, DEFAULT_EVENT, streamForEvent } from './config';
import { createLoop } from './loop';
import { transition, type AppEvent, type AppState } from './states';

export { createHeadlessRace } from './headless';
export type { HeadlessRace } from './headless';
export { buildSimConfig, DEFAULT_EVENT } from './config';
export { planFrame, MAX_FRAME_S, MAX_STEPS_PER_FRAME } from './loop';
export { transition } from './states';
export type { AppState, AppEvent } from './states';
export type { ActionState } from '../input';

export interface AppBuild {
  id: string;
  channel: 'prod' | 'staging' | 'dev';
  branch: string;
}

/** Callbacks from the composition root (src/main.ts). */
export interface AppCallbacks {
  onCopyReport: OnCopyReport;
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
  frameStats(): FrameStats;
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
  const replayKey = `${build.id}+${hashes.sim}`;
  const stream = streamForEvent(registry, DEFAULT_EVENT);
  const event = lookup(registry.events, DEFAULT_EVENT);
  const hudId = registry.packs[0]?.defaults.hud ?? 'classic';
  const hud = lookup(registry.hudLayouts, hudId);
  createAssetManifest(() => assetIndex(registry));

  // Settings, tuning and replay.
  const settingsStore = createSettingsStore({ keyPrefix: APP_ID, build: build.id, storage: safeStorage() });
  const settings = settingsStore.load();
  const layout: TouchLayout = { id: hud.id, mirror: settings.mirror || hud.mirror, elements: hud.elements };
  const recorder = createInputRecorder();
  const pendingTuning: { id: string; value: number }[] = [];
  const tuning = createTuningRegistry([...SIM_TUNING, ...CAMERA_TUNING, ...AUDIO_TUNING], (id, value) => {
    // A sim-affecting change mid-race: applied between steps and recorded at that tick.
    if (race) pendingTuning.push({ id, value });
  });

  // Presentation.
  const renderer = createRenderer(opts.canvas);
  renderer.setRoad(stream.road, { timeOfDay: event.timeOfDay });
  const camera = createFollowCamera();
  tuning.onChange((id, value) => camera.setParam(id, value));
  const audio = createAudio();
  audio.setVolumes(settings.volumes, settings.mute);

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
      tuning: tuning.simValues(),
    });
    playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
    return createSim(config);
  };
  // The attract scene: the grid, before anyone moves.
  curr = newSim().snapshot();

  const go = (e: AppEvent) => {
    const next = transition(state, e);
    if (next) state = next;
    return next !== null;
  };

  const ui = createUi(opts.host, {
    stampText: `throttlebrawl · ${build.channel} · ${build.branch} · ${build.id}`,
    layout,
    tuning,
    callbacks: {
      onStartTap: () => handle.tap(),
      onRace: () => handle.startRace(),
      onBackToMenu: () => handle.backToMenu(),
      onCopyReport: opts.callbacks.onCopyReport,
    },
  });
  if (settingsStore.notice) ui.notice(settingsStore.notice);
  const input = createInput({ keys: window, surface: ui.touchSurface, layout });

  const finishRace = () => {
    if (!race || !curr || !go('finished')) return;
    const me = curr.entities[playerId];
    const order = curr.race.finishOrder;
    const place = me ? (order.includes(playerId) ? order.indexOf(playerId) + 1 : me.place) : 0;
    ui.showResults({
      place,
      of: curr.entities.filter((e) => e.kind === 'rider').length,
      prizeCash: event.rewards.byPlaceCash[place - 1] ?? 0,
      eventName: event.name ?? event.id,
    });
    ui.show('results');
  };

  const step = () => {
    if (!race) return;
    for (const change of pendingTuning.splice(0)) {
      race.applyParam(change.id, change.value);
      recorder.recordParam(race.tick, change.id, change.value);
    }
    const tick = race.tick;
    const cmd = input.sample(SIM_DT);
    recorder.record(tick, [cmd]);
    race.step([cmd]);
    prev = curr;
    curr = race.snapshot();
    const events = race.events();
    if (events.length) {
      recent = recent.concat(events).slice(-300);
      ui.narrative.onEvents(events, { snapshot: curr, seed: race.config.seed });
    }
    if (tick % 60 === 0) recorder.checkpoint(tick, race.hash());
    stepListener?.(curr, events);
    if (race.isOver()) finishRace();
  };

  let attractPose: CameraPose | null = null;
  const loop = createLoop(
    {
      stepping: () => state === 'race',
      step,
      render(alpha, dt) {
        const me = curr ? interpolateEntity(state === 'race' ? prev : null, curr, alpha, playerId) : null;
        let pose: CameraPose | null = attractPose;
        if (me && state === 'race') pose = camera.update(me, dt);
        else if (me && !attractPose) pose = attractPose = camera.snap(me);
        if (pose) renderer.render(state === 'race' ? prev : null, curr, alpha, pose);
        const player = curr?.entities[playerId] ?? null;
        audio.update(state === 'race' ? player : null);
        // "1st / N" counts the racers, not the traffic.
        const racers = curr ? curr.entities.filter((e) => e.kind === 'rider').length : 0;
        if (state === 'race') ui.updateHud(player, racers, settings.units);
      },
    },
    SIM_DT,
  );

  watchLifecycle({
    onHidden: () => {
      loop.pause();
      audio.suspend();
    },
    // ui-1's pause screen will catch this; until then the race resumes where it stopped.
    onShown: () => {
      loop.resume();
      if (state !== 'boot' && state !== 'tapToStart') void audio.resume();
    },
  });
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
      recorder.begin({
        formatVersion: REPLAY_FORMAT_VERSION,
        replayKey,
        seed,
        eventId: race.config.event.contentId,
        tuning: { ...race.config.tuning },
      });
      prev = null;
      curr = race.snapshot();
      recent = [];
      const me = curr.entities[playerId];
      if (me) camera.snap(me);
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
    frameStats() {
      const times = [...loop.frameTimes()].sort((a, b) => a - b);
      return {
        samples: times.length,
        p50: percentile(times, 0.5),
        p95: percentile(times, 0.95),
        max: times[times.length - 1] ?? 0,
      };
    },
    contentHashes: () => hashes,
    replayKey: () => replayKey,
  };

  go('booted');
  ui.show('start');
  loop.start();
  return handle;
}
