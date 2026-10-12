// audio's public face (docs/architecture.md, "Audio"). The engine (system.ts: the bus graph, the
// engines, the cues and their patches, the radio, the music, the soundscape and the spoken barks)
// is a lazy chunk, off the first-load JavaScript (docs/engineering.md, the first-load budget): no
// sound can play before the start tap anyway. `createAudio` returns a stand-in at once and fetches
// the engine straight away, as the menu comes up, so it is in long before the first race.
// - Settings made before it loads (volumes, tuning, stations, the region, the road, this device's
//   cuts, the engine sounds) reach it in the order they were made.
// - `prepare()` makes the AudioContext before the start tap, suspended: creating it is the tap's
//   biggest cost (about 400 of its 408 ms of click handling on the dev machine, polish K), and a
//   context may be made without a gesture; only starting to run needs one.
// - `resume()` inside the start tap resumes that context there, in the tap's user activation (it
//   makes the context itself when `prepare()` did not or could not), then hands it to the engine
//   once it is in; it resolves once the engine has resumed too.
// - Per-frame calls (`frame`, `update`, `onEvents`) before then play nothing, and `inspect()`
//   reports the settings' bus targets and whether a voice could speak, as the engine would.
// The tuning declarations (tuning.ts) and the station tables (stations.ts) load at boot.
import { stationsForRegion, type RadioStation } from './stations';
import type { AudioInspect, AudioOptions, AudioSystem } from './system';
import { busTargets, DEFAULT_VOLUMES, RADIO_FIRST_STATION, VOICE_DEFAULTS, type Volumes } from './tuning';

export {
  radioKeyAction,
  AUDIO_TUNING,
  busTargets,
  DEFAULT_VOLUMES,
  DUCK_DEFAULTS,
  ENGINE_FEEL_DEFAULTS,
  ENGINE_LEVELS,
  RADIO_FIRST_STATION,
  RADIO_OFF,
  RADIO_SCORE,
  SLOWMO_DEFAULTS,
  VOICE_DEFAULTS,
} from './tuning';
export type { Volumes } from './tuning';
export { stationsForRegion, stationsFromTable, stationTrackRef } from './stations';
export type { RadioStation, RadioTrack, RadioVetoFlag } from './stations';
export type { AudioInspect, AudioOptions, AudioSystem } from './system';
export type { BarkVoiceState } from './bark-voices';
export type { CueId } from './cues';
export type { EngineProfile, EngineSoundSpec } from './engine-patch';
export type { NowPlaying, RadioBand } from './radio';

type Engine = typeof import('./system');

export type AudioObservedState = AudioContextState | 'none';
export type AudioSuspendLeaseResult =
  | { readonly kind: 'acquired'; readonly lease: AudioSuspendLease }
  | {
      readonly kind: 'refused';
      readonly reason: 'aborted' | 'suspend-failed' | 'observation-failed' | 'not-suspended';
      readonly observedState: AudioObservedState | null;
    };
export interface AudioSuspendLease {
  readonly state: 'held' | 'released';
  readonly wasRunningIntent: boolean;
  readonly observedState: 'none' | 'suspended' | 'closed';
  release(): void;
}
const quietState = (state: AudioObservedState): state is AudioSuspendLease['observedState'] =>
  state === 'none' || state === 'suspended' || state === 'closed';

/** The audio system as the game holds it: the engine's face, plus the stand-in's `prepare()`. */
export interface AudioFace extends AudioSystem {
  /**
   * Makes the AudioContext now, suspended, so the start tap only has to `resume()` it. Call it
   * when the start screen is up, outside the tap. A device that refuses is left to the tap.
   */
  prepare(): void;
  acquireSuspendLease(options: { readonly signal: AbortSignal }): Promise<AudioSuspendLeaseResult>;
}

/**
 * The audio system: a stand-in now, the engine (system.ts) once its lazy chunk is in. `load`
 * fetches the chunk (tests pass their own); a failed fetch is tried again at the next `resume()`.
 */
export function createAudio(
  opts: AudioOptions = {},
  load: () => Promise<Engine> = () => import('./system'),
): AudioFace {
  const createContext = opts.createContext ?? (() => new AudioContext());
  let engine: AudioSystem | null = null;
  // A published engine can precede its graph: the start tap's context still belongs to the face.
  let engineContext: { used: boolean } | null = null;
  /** The context the start tap made before the engine was in; the engine is built on it. */
  let tapContext: AudioContext | null = null;
  /** Settings made before the engine loaded, replayed onto it in order. */
  const pending: ((a: AudioSystem) => void)[] = [];
  let runningIntent = false;
  let intentGeneration = 0;
  let loadGeneration = 0;
  const intentRetirements = new Set<() => void>();
  // What inspect() reports before the engine loads (the same rules as system.ts).
  // The engine's own defaults (system.ts), for `inspect()` before it loads.
  let volumes: Volumes = { ...DEFAULT_VOLUMES };
  let muted = false;
  let voiceGain: number = VOICE_DEFAULTS.gain;
  let radioChoice: number = RADIO_FIRST_STATION;
  // The stations and region as the engine will have them (system.ts's own defaults), so ui/ can find
  // the saved station at boot.
  let stations: readonly RadioStation[] = opts.stations ?? [];
  let region: string | null = null;

  interface LoadAttempt {
    generation: number;
    promise: Promise<AudioSystem | null>;
    invalidate(): void;
    reconciling: boolean;
  }
  let loading: LoadAttempt | null = null;
  const warn = () => console.warn('audio: native audio operation failed');
  const observed = (): AudioObservedState => {
    if (opts.offline) return 'none';
    const state = engine?.state() ?? 'none';
    return state !== 'none' ? state : (tapContext?.state ?? 'none');
  };
  const suspendNative = (): Promise<void> => {
    if (engine) {
      const native = engine.suspendForLease();
      if (!engineContext?.used && !opts.offline && tapContext?.state === 'running') {
        return Promise.all([native, tapContext.suspend()]).then(() => undefined);
      }
      return native;
    }
    if (!opts.offline && tapContext?.state === 'running') return tapContext.suspend();
    return Promise.resolve();
  };
  // Native work cannot be cancelled. Completion must repair the current intent, not its old owner.
  const reconcile = (): Promise<void> => {
    const generation = intentGeneration;
    let native: Promise<void>;
    try {
      native = runningIntent
        ? engine
          ? engine.resume()
          : !opts.offline && tapContext
            ? tapContext.resume()
            : Promise.resolve()
        : suspendNative();
    } catch {
      warn();
      return Promise.resolve();
    }
    return native.then(
      () => {
        if (generation !== intentGeneration) void reconcile();
      },
      () => {
        warn();
        if (generation !== intentGeneration) void reconcile();
      },
    );
  };
  const changeIntent = (running: boolean) => {
    runningIntent = running;
    intentGeneration++;
    for (const retire of [...intentRetirements]) retire();
    if (loading?.reconciling) {
      const retired = loading;
      loading = null;
      retired.invalidate();
    }
  };
  const fetchEngine = (): Promise<AudioSystem | null> => {
    if (engine) return Promise.resolve(engine);
    if (loading) return loading.promise;
    let invalidate!: () => void;
    const invalidated = new Promise<null>((resolve) => {
      invalidate = () => resolve(null);
    });
    const attempt: LoadAttempt = {
      generation: ++loadGeneration,
      promise: Promise.resolve(null),
      invalidate,
      reconciling: false,
    };
    loading = attempt;
    const work = async (): Promise<AudioSystem | null> => {
      try {
        const m = await load();
        if (loading !== attempt || attempt.generation !== loadGeneration) return null;
        const context = { used: false };
        const a = m.createAudio({
          ...opts,
          radioKeys: null,
          createContext: () => {
            context.used = true;
            return (tapContext ??= createContext());
          },
        });
        let cursor = 0;
        const replay = () => {
          while (cursor < pending.length) pending[cursor++]!(a);
        };
        replay();
        const intent = intentGeneration;
        if (!runningIntent) {
          attempt.reconciling = true;
          const native = a.suspendForLease();
          // Both handlers remain attached after invalidation, even if native never settles.
          const stopped = native.then(
            () => {
              if (loading !== attempt || intent !== intentGeneration) void reconcile();
              return true;
            },
            () => {
              warn();
              return false;
            },
          );
          if (!(await Promise.race([stopped, invalidated]))) return null;
          if (!quietState(a.state())) throw new Error('candidate is not quiet');
        }
        if (loading !== attempt || intent !== intentGeneration || attempt.generation !== loadGeneration)
          return null;
        replay();
        // A configuration callback may reenter ordinary audio work.
        if (loading !== attempt || intent !== intentGeneration) return null;
        engine = a;
        engineContext = context;
        pending.splice(0, cursor);
        return a;
      } catch {
        console.warn('audio: the sound engine did not load');
        return null;
      } finally {
        if (loading === attempt) loading = null;
      }
    };
    attempt.promise = work();
    return attempt.promise;
  };
  void fetchEngine();

  /** Calls the engine now, or keeps the call for when it loads. */
  const set = (call: (a: AudioSystem) => void) => {
    if (engine) call(engine);
    else pending.push(call);
  };

  /** inspect() before the engine is in: nothing plays, the radio's stations are still loading. */
  const standIn = (): AudioInspect => {
    const targets = busTargets(volumes, muted);
    const level = Math.max(0, voiceGain);
    return {
      state: tapContext?.state ?? 'none',
      busTargets: targets,
      activeVoices: 0,
      lastCues: [],
      playerEngineHz: 0,
      playerEngineLevel: 0,
      engineFeel: { rpm: 0, load: 0, level: 1, shifts: 0, revs: 0, pops: 0 },
      otherEngines: [],
      otherEngineVoices: [],
      sputters: 0,
      runawayBell: null,
      sirenLevel: 0,
      musicPlaying: false,
      slowmo: { active: false, lowpassHz: 0, musicLevel: 1, pitch: 1 },
      windLevel: 0,
      squealLevel: 0,
      soundscape: {
        region: null,
        rain: 0,
        beds: { crowd: 0, gust: 0, falls: 0, city: 0, awnings: 0 },
        active: 0,
        played: [],
      },
      radio: {
        choice: radioChoice,
        tunedTo: 'pending',
        stations: stationsForRegion(stations, region).map((st) => st.id),
        nowPlaying: null,
        history: [],
        pirate: { on: false, station: null },
        rider: { station: null, phase: 'off', lines: [] },
        airing: false,
      },
      duckLevel: 1,
      voice: {
        playing: null,
        played: [],
        silent: [],
        on: !muted && targets.voices > 0 && level > 0,
        level,
        fxLevel: 1,
      },
    };
  };

  return {
    prepare() {
      if (opts.offline || runningIntent || tapContext) return;
      try {
        tapContext = createContext();
      } catch (err) {
        // No audio device (or a refused context) at boot: the start tap tries again, as before.
        console.warn('audio: the context could not be made before the start tap', err);
      }
    },
    resume() {
      changeIntent(true);
      if (engine) return reconcile();
      let tap: Promise<void> = Promise.resolve();
      if (!opts.offline) {
        // Inside the tap's user activation, before any await: the browser lets it start here.
        tapContext ??= createContext();
        if (tapContext.state !== 'running') tap = tapContext.resume();
      }
      const generation = intentGeneration;
      const loaded = fetchEngine();
      const tapped = tap.then(() => {
        if (generation !== intentGeneration) void reconcile();
      }, warn);
      return Promise.all([tapped, loaded]).then(async ([, a]) => {
        if (generation !== intentGeneration) return;
        // An invalidated attempt is followed by its replacement, never its abandoned suspend.
        if (!a && loading && runningIntent) await loading.promise;
        if (runningIntent && engine) await reconcile();
      });
    },
    setVolumes(v, mute) {
      volumes = v;
      muted = mute;
      set((a) => a.setVolumes(v, mute));
    },
    update(player) {
      engine?.update(player);
    },
    frame(snapshot, playerId) {
      engine?.frame(snapshot, playerId);
    },
    onEvents(events, snapshot) {
      engine?.onEvents(events, snapshot);
    },
    setParam(id, value) {
      if (id === 'audio.voiceGain') voiceGain = value;
      if (id === 'audio.radio') radioChoice = Math.round(value);
      set((a) => a.setParam(id, value));
    },
    setEngineSounds(byRider) {
      set((a) => a.setEngineSounds(byRider));
    },
    suspend() {
      changeIntent(false);
      void reconcile();
    },
    suspendForLease: suspendNative,
    acquireSuspendLease({ signal }) {
      const wasRunningIntent = runningIntent;
      changeIntent(false);
      const generation = intentGeneration;
      const restore = () => {
        if (intentGeneration !== generation) return;
        changeIntent(wasRunningIntent);
        void reconcile();
        if (runningIntent && !engine) {
          const restored = intentGeneration;
          void fetchEngine().then(() => {
            if (restored === intentGeneration && runningIntent && engine) void reconcile();
          });
        }
      };
      return new Promise<AudioSuspendLeaseResult>((resolve) => {
        let settled = false;
        const refuse = (
          reason: Extract<AudioSuspendLeaseResult, { kind: 'refused' }>['reason'],
          observedState: AudioObservedState | null = null,
        ) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', abort);
          intentRetirements.delete(abort);
          restore();
          resolve(Object.freeze({ kind: 'refused', reason, observedState }));
        };
        const abort = () => refuse('aborted');
        signal.addEventListener('abort', abort, { once: true });
        intentRetirements.add(abort);
        if (signal.aborted) {
          abort();
          return;
        }
        let native: Promise<void>;
        try {
          native = suspendNative();
        } catch {
          refuse('suspend-failed');
          return;
        }
        void native.then(
          () => {
            if (settled || intentGeneration !== generation) {
              void reconcile();
              refuse('aborted');
              return;
            }
            let state: AudioObservedState;
            try {
              state = observed();
            } catch {
              refuse('observation-failed');
              return;
            }
            if (intentGeneration !== generation || signal.aborted) {
              refuse('aborted');
              return;
            }
            if (!quietState(state)) {
              refuse('not-suspended', state);
              return;
            }
            settled = true;
            signal.removeEventListener('abort', abort);
            intentRetirements.delete(abort);
            let released = false;
            const lease: AudioSuspendLease = Object.freeze({
              get state() {
                return released ? ('released' as const) : ('held' as const);
              },
              wasRunningIntent,
              observedState: state,
              release() {
                if (released) return;
                released = true;
                restore();
              },
            });
            resolve(Object.freeze({ kind: 'acquired', lease }));
          },
          () => refuse('suspend-failed'),
        );
      });
    },
    state: observed,
    inspect: () => engine?.inspect() ?? standIn(),
    setStations(list) {
      stations = list;
      set((a) => a.setStations(list));
    },
    setRegion(regionId) {
      region = regionId;
      set((a) => a.setRegion(regionId));
    },
    setRoad(road, wet) {
      set((a) => a.setRoad(road, wet));
    },
    setRadioCut(refs) {
      set((a) => a.setRadioCut(refs));
    },
    cutPlayingTrack: (raceId, tick) => engine?.cutPlayingTrack(raceId, tick) ?? null,
    nextRadio() {
      engine?.nextRadio();
    },
    skipTrack() {
      engine?.skipTrack();
    },
    duck() {
      engine?.duck();
    },
    countdownBeat(n) {
      engine?.countdownBeat(n);
    },
    say: (contentRef) => engine?.say(contentRef) ?? Promise.resolve(false),
  };
}
