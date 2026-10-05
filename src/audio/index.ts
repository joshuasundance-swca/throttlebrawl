// audio's public face (docs/architecture.md, "Audio"). The engine (system.ts: the bus graph, the
// engines, the cues and their patches, the radio, the music, the soundscape and the spoken barks)
// is a lazy chunk, off the first-load JavaScript (docs/engineering.md, the first-load budget): no
// sound can play before the start tap anyway. `createAudio` returns a stand-in at once and fetches
// the engine straight away, as the menu comes up, so it is in long before the first race.
// - Settings made before it loads (volumes, tuning, stations, the region, the road, this device's
//   cuts, the engine sounds) reach it in the order they were made.
// - `resume()` inside the start tap creates the AudioContext and resumes it there, in the tap's
//   user activation, then hands that context to the engine once it is in; it resolves once the
//   engine has resumed too.
// - Per-frame calls (`frame`, `update`, `onEvents`) before then play nothing, and `inspect()`
//   reports the settings' bus targets and whether a voice could speak, as the engine would.
// The tuning declarations (tuning.ts) and the station tables (stations.ts) load at boot.
import { stationsForRegion, type RadioStation } from './stations';
import type { AudioInspect, AudioOptions, AudioSystem } from './system';
import {
  busTargets,
  DEFAULT_VOLUMES,
  RADIO_FIRST_STATION,
  radioKeyAction,
  VOICE_DEFAULTS,
  type Volumes,
} from './tuning';

export {
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

/**
 * The audio system: a stand-in now, the engine (system.ts) once its lazy chunk is in. `load`
 * fetches the chunk (tests pass their own); a failed fetch is tried again at the next `resume()`.
 */
export function createAudio(
  opts: AudioOptions = {},
  load: () => Promise<Engine> = () => import('./system'),
): AudioSystem {
  const createContext = opts.createContext ?? (() => new AudioContext());
  let engine: AudioSystem | null = null;
  /** The context the start tap made before the engine was in; the engine is built on it. */
  let tapContext: AudioContext | null = null;
  /** Settings made before the engine loaded, replayed onto it in order. */
  const pending: ((a: AudioSystem) => void)[] = [];
  let resumed = false;
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

  let loading: Promise<AudioSystem | null> | null = null;
  const fetchEngine = (): Promise<AudioSystem | null> => {
    loading ??= load().then(
      (m) => {
        // The stand-in listens for the R key (below), so the engine does not.
        const a = m.createAudio({
          ...opts,
          radioKeys: null,
          createContext: () => tapContext ?? createContext(),
        });
        for (const set of pending.splice(0)) set(a);
        engine = a;
        return a;
      },
      (err: unknown) => {
        // A dropped connection on the phone: silent for now, fetched again at the next resume().
        console.warn('audio: the sound engine did not load', err);
        loading = null;
        return null;
      },
    );
    return loading;
  };
  void fetchEngine();

  // The R key, listened for from now, not from when the engine loads: ui/ saves the radio choice
  // from its own keydown listener, added after this one, and it must see the choice the key made.
  const keys =
    opts.radioKeys === undefined ? (typeof window === 'undefined' ? null : window) : opts.radioKeys;
  keys?.addEventListener('keydown', (ev) => {
    const action = radioKeyAction(ev);
    if (action === 'skip') engine?.skipTrack();
    else if (action === 'next') engine?.nextRadio();
  });

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
      soundscape: { region: null, rain: 0, active: 0, played: [] },
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
    resume() {
      if (engine) return engine.resume();
      resumed = true;
      let tap: Promise<void> = Promise.resolve();
      if (!opts.offline) {
        // Inside the tap's user activation, before any await: the browser lets it start here.
        tapContext ??= createContext();
        if (tapContext.state !== 'running') tap = tapContext.resume();
      }
      return Promise.all([tap, fetchEngine()]).then(([, a]) => (a && resumed ? a.resume() : undefined));
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
      if (engine) engine.suspend();
      else {
        resumed = false;
        if (tapContext?.state === 'running') void tapContext.suspend();
      }
    },
    state: () => engine?.state() ?? tapContext?.state ?? 'none',
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
