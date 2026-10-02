// audio: one AudioContext, created or resumed on the start tap, and the bus graph (docs/
// architecture.md, "Audio"): sources -> music, effects, voices -> master -> light limiter ->
// ceiling (M2) -> destination. audio-1 (M1.md) fills it in: the synthesized engine for the player and, cheaper,
// for nearby riders with distance and Doppler; synthesized cues for punch, kick, hit, miss and
// crash, played the moment their event arrives (the hit-stop tick); the oncoming-traffic horn and
// the cop's siren as telegraphs; a crude original music loop; and a cap on voices.
//
// audio-2 (M2.md, the mix) adds cues for the M2 events (takedown, slow motion, rail, splash,
// respawn, style cash, the steal glint, wobbles and close passes), crashes layered by impact, the
// slow-motion treatment (slowmo.ts: effects pitched down and low-passed, music ducked) and the
// fuller sixteen-bar score. Every feel number is a presentation tuning slider below.
//
// radio-1 (M4.md, a head start): surf and rockabilly stations from the pack's `stations/`, with
// code-made tracks (radio-compose.ts writes them, radio-synth.ts plays them, radio.ts runs the
// station). For now the station is picked with the R key (Shift+R skips a track) or the
// `audio.radio` tuning slider; the pause menu's station panel is ui-4's. The music ducks under
// crashes (and under barks, when the bark's owner calls `duck()`).
//
// Spoken barks (the maintainer, 2026-10-01: "Voices go in"; bark-voices.ts): when a bark's
// subtitle shows (the bubble's `throttlebrawl:bark` event on the window), its clip plays on the
// voices bus and the music ducks a little under it. The Voices slider is the voices bus and the
// Voices switch silences it (the settings record's `volumes.voices` and `voicesOn`, handed in through
// `setVolumes`); with the bus silent or the sound muted no clip is fetched or played. This device's
// cuts (`setRadioCut`, which carries every veto) apply at once.
//
// Wiring (app/): `frame(snapshot, playerId)` once per rendered frame drives everything placed in
// the world; `onEvents(events)` after each sim step plays the cues. The skeleton's
// `update(player)` still works and drives the player's engine and the music alone.
import type { EntitySnapshot, SimEvent, SimSnapshot, TuningParamDecl } from '../sim/api';
import {
  BARK_SHOWN_EVENT,
  BARK_VOICE_EVENT,
  createBarkVoices,
  type BarkVoiceOptions,
  type BarkVoices,
  type BarkVoiceState,
} from './bark-voices';
import { CUE_PATCHES, createSirenVoice, type SirenVoice } from './cue-patches';
import { createCeiling } from './ceiling';
import { cueForEvent, type CueId } from './cues';
import { createSlowmoTreatment, SLOWMO_DEFAULTS, type SlowmoTreatment } from './slowmo';
import {
  createEngineVoice,
  resolveEngineProfile,
  type EngineSoundSpec,
  type EngineVoice,
} from './engine-patch';
import { createEngineFeel, ENGINE_FEEL_DEFAULTS, type FeelOutput } from './engine-feel';
import { createMusic, type MusicLoop } from './music';
import {
  createRadioPlayer,
  cutFlag,
  stationsForRegion,
  type NowPlaying,
  type RadioPlayer,
  type RadioStation,
  type RadioVetoFlag,
} from './radio';
import { distance, distanceGain, dopplerFactor, moving, panFor } from './spatial';
import { findHonks, findSiren, HORN_DEFAULTS } from './telegraphs';
import { VoicePool, type PoolEntry } from './voices';
import { createWindVoice, WIND_DEFAULTS, type WindVoice } from './wind';

export { ENGINE_BY_CLASS, ENGINE_PRESETS, resolveEngineProfile } from './engine-patch';
export { ENGINE_FEEL_DEFAULTS } from './engine-feel';
export type { EngineProfile, EngineSoundSpec } from './engine-patch';
export { CUE_IDS, EVENT_CUES } from './cues';
export { SLOWMO_DEFAULTS } from './slowmo';
export type { CueId } from './cues';
export { BARK_SHOWN_EVENT, BARK_VOICE_EVENT, barkClipPath } from './bark-voices';
export type { BarkVoiceState } from './bark-voices';
export { RADIO_PRESETS } from './radio-compose';
export { stationsForRegion, stationsFromTable, stationTrackRef } from './radio';
export type { NowPlaying, RadioStation, RadioTrack, RadioVetoFlag } from './radio';

/** `audio.radio` values below the stations: 0 = off, 1 = the original score, 2+ = the stations. */
export const RADIO_OFF = 0;
export const RADIO_SCORE = 1;
/**
 * The region's first station: what a race plays by default (playtest 2, 2026-10-02: "There should
 * be different stations and music in different regions"), as the settings record's Radio default.
 */
export const RADIO_FIRST_STATION = 2;
/** The music ducks under these cues (the crash family), [default]. */
const DUCK_CUES: ReadonlySet<CueId> = new Set(['crash', 'takedown', 'railClang', 'splash']);
export const DUCK_DEFAULTS = { level: 0.4, holdS: 0.9 } as const;
/**
 * Spoken barks [default]. The music dips a little under a voice (not as far as under a crash), the
 * effects (engine, wind, hits) dip a touch, and a clip plays at twice the level it was made, under
 * the voices bus (the Voices slider). Measured offline (tests/e2e/audio-voices.spec.ts): at these
 * values a line sits above a flat-out engine at the default settings; at gain 1 with no effects dip
 * it sat about 4 dB under it.
 */
export const VOICE_DEFAULTS = { duck: 0.7, fxDuck: 0.75, gain: 2 } as const;
/**
 * Engine levels on the effects bus, before the `audio.engineGain` slider [default]. Playtest 2
 * (2026-10-02: "Engine monotonous and maybe too loud", then "Richer and quieter"): measured offline
 * at the default volumes (tests/e2e/audio-mix.spec.ts), the player's engine flat out sat about
 * 15 dB over the music at 0.5; at 0.15 it sits about 4.5 dB over it, and a cruising engine about
 * level with it. Other riders' engines are a little louder than yours up close, so a rival passing
 * is heard.
 */
export const ENGINE_LEVELS = { player: 0.15, other: 0.16, pops: 1 } as const;

/** Presentation-only tuning (applies at once, never recorded; docs/architecture.md, "Tuning"). */
export const AUDIO_TUNING: readonly TuningParamDecl[] = [
  {
    id: 'audio.engineGain',
    group: 'audio',
    label: 'Engine level',
    default: 1,
    min: 0,
    max: 4, // 3.3 is the level before playtest 2
    step: 0.05,
    unit: '',
    affectsSim: false,
  },
  // Playtest 2 ("Richer and quieter"): the decel pops and the gear-shift feel (engine-feel.ts).
  {
    id: 'audio.enginePops',
    group: 'audio',
    label: 'Engine: decel pops (0 = off)',
    default: ENGINE_LEVELS.pops,
    min: 0,
    max: 2,
    step: 0.1,
    unit: '',
    affectsSim: false,
  },
  {
    id: 'audio.shiftFloorRpm',
    group: 'audio',
    label: 'Engine: heard rpm after an upshift',
    default: ENGINE_FEEL_DEFAULTS.shiftFloorRpm,
    min: 1200,
    max: 9000,
    step: 100,
    unit: 'rpm',
    affectsSim: false,
  },
  {
    id: 'audio.cueGain',
    group: 'audio',
    label: 'Hit and cue level',
    default: 1,
    min: 0,
    max: 2,
    step: 0.05,
    unit: '',
    affectsSim: false,
  },
  {
    id: 'audio.maxVoices',
    group: 'audio',
    label: 'Voice cap',
    default: 32,
    min: 4,
    max: 64,
    step: 1,
    unit: '',
    affectsSim: false,
  },
  {
    id: 'audio.dopplerScale',
    group: 'audio',
    label: 'Doppler',
    default: 1,
    min: 0,
    max: 2,
    step: 0.1,
    unit: '',
    affectsSim: false,
  },
  {
    id: 'audio.hornRangeM',
    group: 'audio',
    label: 'Horn range (0 = off)',
    default: HORN_DEFAULTS.rangeM,
    min: 0,
    max: 150,
    step: 5,
    unit: 'm',
    affectsSim: false,
  },
  {
    id: 'audio.hornLaneHalfWidthM',
    group: 'audio',
    label: 'Horn: your line half-width',
    default: HORN_DEFAULTS.laneHalfWidthM,
    min: 0.5,
    max: 4,
    step: 0.1,
    unit: 'm',
    affectsSim: false,
  },
  {
    id: 'audio.slowmoLowpassHz',
    group: 'audio',
    label: 'Slow motion: effects low-pass',
    default: SLOWMO_DEFAULTS.lowpassHz,
    min: 200,
    max: 20000,
    step: 50,
    unit: 'Hz',
    affectsSim: false,
  },
  {
    id: 'audio.slowmoPitchSemis',
    group: 'audio',
    label: 'Slow motion: pitch',
    default: SLOWMO_DEFAULTS.pitchSemis,
    min: -12,
    max: 0,
    step: 0.5,
    unit: 'st',
    affectsSim: false,
  },
  {
    id: 'audio.slowmoMusicDuck',
    group: 'audio',
    label: 'Slow motion: music level',
    default: SLOWMO_DEFAULTS.musicDuck,
    min: 0,
    max: 1,
    step: 0.05,
    unit: '',
    affectsSim: false,
  },
  {
    id: 'audio.crashImpactScale',
    group: 'audio',
    label: 'Crash size from impact',
    default: 1,
    min: 0,
    max: 2,
    step: 0.1,
    unit: '',
    affectsSim: false,
  },
  // radio-1: the station, the song length and the duck. Each is a slider, [default].
  {
    id: 'audio.radio',
    group: 'audio',
    label: 'Radio (0 off, 1 score, 2+ stations; R key)',
    default: RADIO_FIRST_STATION,
    min: 0,
    max: 6,
    step: 1,
    unit: '',
    affectsSim: false,
  },
  {
    id: 'audio.radioLoops',
    group: 'audio',
    label: 'Radio: loops per song',
    default: 3,
    min: 1,
    max: 8,
    step: 1,
    unit: '',
    affectsSim: false,
  },
  {
    id: 'audio.radioFx',
    group: 'audio',
    label: 'Radio: spring reverb and slapback',
    default: 1,
    min: 0,
    max: 2,
    step: 0.1,
    unit: '',
    affectsSim: false,
  },
  {
    id: 'audio.duckLevel',
    group: 'audio',
    label: 'Music under crashes and barks (1 = no duck)',
    default: DUCK_DEFAULTS.level,
    min: 0,
    max: 1,
    step: 0.05,
    unit: '',
    affectsSim: false,
  },
  {
    id: 'audio.duckHoldS',
    group: 'audio',
    label: 'Music duck: hold',
    default: DUCK_DEFAULTS.holdS,
    min: 0,
    max: 3,
    step: 0.1,
    unit: 's',
    affectsSim: false,
  },
  // Spoken barks (the maintainer, 2026-10-01): the clip level and the music under a voice.
  {
    id: 'audio.voiceGain',
    group: 'audio',
    label: 'Bark voice level',
    default: VOICE_DEFAULTS.gain,
    min: 0,
    max: 2,
    step: 0.05,
    unit: '',
    affectsSim: false,
  },
  {
    id: 'audio.voiceDuck',
    group: 'audio',
    label: 'Music under a bark voice (1 = no duck)',
    default: VOICE_DEFAULTS.duck,
    min: 0,
    max: 1,
    step: 0.05,
    unit: '',
    affectsSim: false,
  },
  {
    id: 'audio.voiceFxDuck',
    group: 'audio',
    label: 'Engine and effects under a bark voice (1 = no dip)',
    default: VOICE_DEFAULTS.fxDuck,
    min: 0,
    max: 1,
    step: 0.05,
    unit: '',
    affectsSim: false,
  },
  // Playtest 1 item 10 (speed cues): the wind rises with your speed (wind.ts).
  {
    id: 'audio.windGain',
    group: 'audio',
    label: 'Wind level (0 = off)',
    default: WIND_DEFAULTS.gain,
    min: 0,
    max: 1,
    step: 0.05,
    unit: '',
    affectsSim: false,
  },
  {
    id: 'audio.windFromMps',
    group: 'audio',
    label: 'Wind: starts at',
    default: WIND_DEFAULTS.fromMps,
    min: 0,
    max: 40,
    step: 1,
    unit: 'm/s',
    affectsSim: false,
  },
  {
    id: 'audio.windFullMps',
    group: 'audio',
    label: 'Wind: full at',
    default: WIND_DEFAULTS.fullMps,
    min: 10,
    max: 80,
    step: 1,
    unit: 'm/s',
    affectsSim: false,
  },
];

export interface Volumes {
  master: number;
  music: number;
  effects: number;
  voices: number;
}

/**
 * Gains the buses aim for. Sliders are 0..1 with a squared taper, so the middle of a slider
 * sounds like the middle; mute silences master and leaves the bus settings alone.
 */
export function busTargets(v: Volumes, mute: boolean): Volumes {
  const taper = (x: number) => {
    const c = Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
    return c * c;
  };
  return {
    master: mute ? 0 : taper(v.master),
    music: taper(v.music),
    effects: taper(v.effects),
    voices: taper(v.voices),
  };
}

export interface AudioInspect {
  state: 'none' | AudioContextState;
  busTargets: Volumes;
  activeVoices: number;
  /** The most recent cues played (up to 32), with their start times on the audio clock. */
  lastCues: { cue: CueId; at: number }[];
  playerEngineHz: number;
  playerEngineLevel: number;
  /** The engine's feel on the last frame (engine-feel.ts) and its counts this session. */
  engineFeel: { rpm: number; load: number; level: number; shifts: number; revs: number; pops: number };
  /** Entity ids of the other riders whose engines are playing. */
  otherEngines: number[];
  /** Each of those engines' voice (its preset) and where it sits, left (-1) to right (1). */
  otherEngineVoices: { id: number; preset: string; pan: number }[];
  sirenLevel: number;
  musicPlaying: boolean;
  /** The slow-motion treatment: whether it is on, and what the bus filter and music duck aim for. */
  slowmo: { active: boolean; lowpassHz: number; musicLevel: number; pitch: number };
  /** The level the wind aims for (0 = silent). */
  windLevel: number;
  /** The radio: the `audio.radio` choice, the station list in switch order, and what plays. */
  radio: {
    choice: number;
    /** 'off', 'score', 'pending' (stations loading), or the station's id. */
    tunedTo: string;
    stations: string[];
    nowPlaying: NowPlaying | null;
    /** Track references started this session, oldest first. */
    history: string[];
  };
  /** The level the music duck aims for (1 = not ducked). */
  duckLevel: number;
  /** Spoken barks: what speaks now and what spoke, whether voices can be heard, the clip level. */
  voice: BarkVoiceState & { on: boolean; level: number; fxLevel: number };
}

export interface AudioSystem {
  /** Creates or resumes the context; call inside the start tap's user activation. */
  resume(): Promise<void>;
  /** The four bus gains follow the settings; mute silences master. */
  setVolumes(v: Volumes, mute: boolean): void;
  /** Skeleton path: drives only the player's engine and the music. `null` = not racing. */
  update(player: Pick<EntitySnapshot, 'rpm' | 'throttle' | 'speed'> | null): void;
  /** Once per rendered frame: engines, telegraphs, hit-stop ducking and music. `null` = not racing. */
  frame(snapshot: SimSnapshot | null, playerId: number): void;
  /** After each sim step: plays the cue of each event now, so a hit lands on its hit-stop tick. */
  onEvents(events: readonly SimEvent[], snapshot?: SimSnapshot | null): void;
  /** Presentation tuning (AUDIO_TUNING ids); unknown ids are ignored. */
  setParam(id: string, value: number): void;
  /** Engine sounds by rider content id (from each rider's bike's `engineSound`). */
  setEngineSounds(byRider: Readonly<Record<string, EngineSoundSpec>>): void;
  /** Stops sound while paused (the context is suspended, not closed). */
  suspend(): void;
  readonly state: () => 'none' | AudioContextState;
  /** What the mixer is doing, for tests and the debug report. */
  inspect(): AudioInspect;
  /** The stations to choose from (the registry's, via `stationsFromTable`); else the base pack's. */
  setStations(stations: readonly RadioStation[]): void;
  /** The race's region: its stations are the regional ones plus the genre ones. null = all. */
  setRegion(regionId: string | null): void;
  /** Radio tracks cut on this device (the settings record's veto refs): never played. */
  setRadioCut(refs: readonly string[]): void;
  /**
   * "Cut this" on the playing radio track: skips it now and returns the flag for the settings
   * record (`{contentRef, raceId, tick}`), or null when no station track is playing.
   */
  cutPlayingTrack(raceId: string, tick: number): RadioVetoFlag | null;
  /** The next radio choice (score, each station, off, then round again), as the R key does. */
  nextRadio(): void;
  /** The next track on the station playing now. */
  skipTrack(): void;
  /** Ducks the music for a moment, as for a bark (crashes duck it themselves). */
  duck(): void;
  /**
   * A bark's subtitle showed: speak its line (`<pack>:bark-set/<set>#<line>`). The bubble's
   * `throttlebrawl:bark` event calls this; resolves true when the clip started.
   */
  say(contentRef: string): Promise<boolean>;
}

export interface AudioOptions {
  /** Makes the context; tests pass a fake. */
  createContext?: () => AudioContext;
  /**
   * The context is an OfflineAudioContext driven by a test render: treat it as live while its
   * rendering is suspended, and never call its `resume()` from `resume()`.
   */
  offline?: boolean;
  /** Where the radio keys are listened for; the window by default, null for none (tests). */
  radioKeys?: EventTarget | null;
  /** Seeds the stations' track order; random per session when left out. */
  radioSeed?: number;
  /** Stations up front; otherwise the base pack's are loaded the first time a station is picked. */
  stations?: readonly RadioStation[];
  /** Where the bark subtitle's event is listened for; the window by default, null for none. */
  barkEvents?: EventTarget | null;
  /** A bark line's clip URL (tests and harnesses); the build's bundled clips by default. */
  barkClipUrl?: BarkVoiceOptions['clipUrl'];
  /** Fetches a clip's bytes (tests); `fetch` by default. */
  barkFetch?: BarkVoiceOptions['fetchBytes'];
}

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  buses: { music: GainNode; effects: GainNode; voices: GainNode };
  /** Every effects source feeds `slowmo.fxIn`; the music feeds `slowmo.musicIn`. */
  slowmo: SlowmoTreatment;
  /** Both the score and the radio feed this duck, which feeds `slowmo.musicIn`. */
  duck: GainNode;
  music: MusicLoop;
  radio: RadioPlayer;
  /** Spoken barks, through `voiceLevel` (the `audio.voiceGain` slider) into the voices bus. */
  barks: BarkVoices;
  voiceLevel: GainNode;
}

interface Held<T> {
  voice: T;
  entry: PoolEntry;
  contentId: string;
}

/** Priorities in the voice pool (cues are 45..105, see cues.ts). */
const PRIORITY = { playerEngine: 200, siren: 90, otherEngine: 30 } as const;
const OTHER_ENGINES_MAX = 5;
const OTHER_ENGINES_RANGE_M = 150;

export function createAudio(opts: AudioOptions = {}): AudioSystem {
  const createContext = opts.createContext ?? (() => new AudioContext());
  let graph: Graph | null = null;
  let volumes: Volumes = { master: 0.8, music: 0.6, effects: 0.9, voices: 0.9 };
  let muted = false;
  const params = {
    engineGain: 1,
    enginePops: ENGINE_LEVELS.pops as number,
    cueGain: 1,
    maxVoices: 32,
    dopplerScale: 1,
    hornRangeM: HORN_DEFAULTS.rangeM,
    hornLaneHalfWidthM: HORN_DEFAULTS.laneHalfWidthM,
    slowmoLowpassHz: SLOWMO_DEFAULTS.lowpassHz,
    slowmoPitchSemis: SLOWMO_DEFAULTS.pitchSemis,
    slowmoMusicDuck: SLOWMO_DEFAULTS.musicDuck,
    crashImpactScale: 1,
    windGain: WIND_DEFAULTS.gain as number,
    windFromMps: WIND_DEFAULTS.fromMps as number,
    windFullMps: WIND_DEFAULTS.fullMps as number,
    radio: RADIO_FIRST_STATION as number,
    radioLoops: 3,
    radioFx: 1,
    duckLevel: DUCK_DEFAULTS.level as number,
    duckHoldS: DUCK_DEFAULTS.holdS as number,
    voiceGain: VOICE_DEFAULTS.gain as number,
    voiceDuck: VOICE_DEFAULTS.duck as number,
    voiceFxDuck: VOICE_DEFAULTS.fxDuck as number,
  };
  /** The clip level under the voices bus (the `audio.voiceGain` slider). */
  const voiceLevel = () => Math.max(0, params.voiceGain);
  /** Voices can be heard: not muted, the voices bus (Voices on, its slider up) and the clip level. */
  const voicesAudible = () => !muted && busTargets(volumes, muted).voices > 0 && voiceLevel() > 0;
  /** Every veto reference on this device (radio tracks and bark lines alike). */
  let cutRefs: string[] = [];
  // The radio: stations (null until loaded), the race's region, and this device's cuts.
  let allStations: RadioStation[] | null = opts.stations ? [...opts.stations] : null;
  let loadingStations = false;
  let regionId: string | null = null;
  let radioCut: string[] = [];
  const radioSeed = opts.radioSeed ?? Math.floor(Math.random() * 0xffffffff);
  let duckTarget = 1;
  /** The effects level the last voice dipped to (1 = never dipped). */
  let voiceFxTarget = 1;
  const windParams = () => ({
    gain: params.windGain,
    fromMps: params.windFromMps,
    fullMps: params.windFullMps,
  });
  /** The wind's voice, made on the first racing frame (outside the voice pool, like the music). */
  let wind: WindVoice | null = null;
  const slowmoParams = () => ({
    lowpassHz: params.slowmoLowpassHz,
    pitchSemis: params.slowmoPitchSemis,
    musicDuck: params.slowmoMusicDuck,
  });
  /** Slow motion as the events last said, for snapshots that do not carry `slowmo`. */
  let slowmoByEvents = false;
  let engineSounds: Readonly<Record<string, EngineSoundSpec>> = {};
  const pool = new VoicePool(params.maxVoices);
  let playerEngine: Held<EngineVoice> | null = null;
  const feel = createEngineFeel();
  let lastFeel: FeelOutput | null = null;
  const feelCounts = { shifts: 0, revs: 0, pops: 0 };
  const others = new Map<number, Held<EngineVoice>>();
  const otherPan = new Map<number, number>();
  let siren: Held<SirenVoice> | null = null;
  const lastHonk = new Map<number, number>();
  const lastCues: { cue: CueId; at: number }[] = [];
  let lastSnap: SimSnapshot | null = null;
  let lastPlayerId = 0;

  const applyVolumes = () => {
    if (!graph) return;
    const t = graph.ctx.currentTime;
    const g = busTargets(volumes, muted);
    graph.master.gain.setTargetAtTime(g.master, t, 0.02);
    graph.buses.music.gain.setTargetAtTime(g.music, t, 0.02);
    graph.buses.effects.gain.setTargetAtTime(g.effects, t, 0.02);
    graph.buses.voices.gain.setTargetAtTime(g.voices, t, 0.02);
    // Voices switched off (or muted) mid-line: the line stops.
    if (!voicesAudible()) graph.barks.stop();
  };

  const build = (): Graph => {
    const ctx = createContext();
    // A light limiter so crashes do not clip on phone speakers.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    // The ceiling after it guarantees a pile-up saturates instead of clipping (ceiling.ts).
    limiter.connect(createCeiling(ctx, ctx.destination));
    // Every gain starts at its setting, so the first frame has no swell from the defaults.
    const start = busTargets(volumes, muted);
    const master = ctx.createGain();
    master.gain.value = start.master;
    master.connect(limiter);
    const bus = (level: number) => {
      const g = ctx.createGain();
      g.gain.value = level;
      g.connect(master);
      return g;
    };
    const buses = { music: bus(start.music), effects: bus(start.effects), voices: bus(start.voices) };
    // The effects dip a little under a spoken bark (fxDuck), so the line carries over the engine.
    const fxDuck = ctx.createGain();
    fxDuck.gain.value = 1;
    fxDuck.connect(buses.effects);
    const slowmo = createSlowmoTreatment(ctx, fxDuck, buses.music, slowmoParams());
    const duck = ctx.createGain();
    duck.gain.value = 1;
    duck.connect(slowmo.musicIn);
    const radio = createRadioPlayer(ctx, duck, {
      seed: radioSeed,
      loopsPerTrack: () => params.radioLoops,
    });
    const level = ctx.createGain();
    level.gain.value = voiceLevel();
    level.connect(buses.voices);
    const barks = createBarkVoices(ctx, level, {
      ...(opts.barkClipUrl ? { clipUrl: opts.barkClipUrl } : {}),
      ...(opts.barkFetch ? { fetchBytes: opts.barkFetch } : {}),
      onStart: (durationS, contentRef) => {
        if (graph) {
          duckTo(graph, params.voiceDuck, durationS + 0.15, true);
          const t = ctx.currentTime;
          const fx = Math.min(1, Math.max(0, params.voiceFxDuck));
          fxDuck.gain.cancelScheduledValues(t);
          fxDuck.gain.setTargetAtTime(fx, t, 0.03);
          fxDuck.gain.setTargetAtTime(1, t + durationS, 0.2);
          voiceFxTarget = fx;
        }
        // The subtitle stays up while its voice speaks (bubble.ts listens).
        if (typeof CustomEvent !== 'undefined') {
          barkEvents?.dispatchEvent(new CustomEvent(BARK_VOICE_EVENT, { detail: { contentRef, durationS } }));
        }
      },
    });
    barks.setCut(cutRefs);
    return {
      ctx,
      master,
      buses,
      slowmo,
      duck,
      music: createMusic(ctx, duck),
      radio,
      barks,
      voiceLevel: level,
    };
  };

  // --- The radio ----------------------------------------------------------------------------

  /** The stations of the race's region, in switch order (empty until loaded). */
  const regionStations = (): RadioStation[] => stationsForRegion(allStations ?? [], regionId);

  /** What `audio.radio` tunes to now: 'off', 'score', a station, or 'pending' (stations loading). */
  const tuned = (): 'off' | 'score' | 'pending' | RadioStation => {
    const c = Math.round(params.radio);
    if (c === RADIO_SCORE) return 'score';
    if (c < RADIO_SCORE) return 'off';
    if (!allStations) return 'pending';
    // Past the last station is off.
    return regionStations()[c - 2] ?? 'off';
  };

  /** Points the radio player at the tuned station (the score and off need no player). */
  const retune = () => {
    const t = tuned();
    if (t === 'pending') ensureStations();
    const want = typeof t === 'object' ? t : null;
    const g = graph;
    if (!g) return;
    const cur = g.radio.station();
    if (want?.id !== cur?.id || want?.packId !== cur?.packId) g.radio.select(want);
  };

  /** Loads the base pack's stations once (only when a station is first picked). */
  function ensureStations() {
    if (allStations || loadingStations) return;
    loadingStations = true;
    import('./radio-base')
      .then((m) => {
        allStations ??= m.baseStations();
      })
      .catch(() => {
        allStations ??= [];
      })
      .finally(() => {
        loadingStations = false;
        retune();
      });
  }

  /** The score or the radio, by the tuned choice; both stay silent when not racing. */
  const pumpMusic = (g: Graph, now: number, racing: boolean, intensity: number) => {
    const t = tuned();
    g.music.pump(now, racing && t === 'score', intensity);
    g.radio.pump(now, racing && typeof t === 'object');
  };

  /** When the current duck lets go, on the audio clock. */
  let duckUntil = 0;
  /**
   * Dips the music to `level` for `holdS`, then lets it back up. A gentle duck (a voice) never
   * lifts a deeper one still holding (a crash); it only extends the hold.
   */
  const duckTo = (g: Graph, level: number, holdS: number, gentle = false) => {
    const now = g.ctx.currentTime;
    const want = Math.min(1, Math.max(0, level));
    const holding = gentle && now < duckUntil;
    const target = holding ? Math.min(duckTarget, want) : want;
    const until = Math.max(holding ? duckUntil : 0, now + Math.max(0, holdS));
    duckTarget = target;
    duckUntil = until;
    g.duck.gain.cancelScheduledValues(now);
    g.duck.gain.setTargetAtTime(target, now, 0.03);
    g.duck.gain.setTargetAtTime(1, until, 0.35);
  };
  const duckNow = (g: Graph) => duckTo(g, params.duckLevel, params.duckHoldS);

  const nextRadio = () => {
    const n = (allStations ? regionStations().length : 2) + 2;
    const c = Math.round(params.radio);
    // Score, each station, off, and round again.
    params.radio = c === RADIO_OFF ? RADIO_SCORE : c + 1 >= n ? RADIO_OFF : c + 1;
    retune();
  };

  const keys =
    opts.radioKeys === undefined ? (typeof window === 'undefined' ? null : window) : opts.radioKeys;
  keys?.addEventListener('keydown', (ev) => {
    const e = ev as KeyboardEvent;
    if (e.code !== 'KeyR' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as { tagName?: string } | null;
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT') return;
    if (e.shiftKey) graph?.radio.skip();
    else nextRadio();
  });

  const live = (): Graph | null => (graph && (opts.offline || graph.ctx.state === 'running') ? graph : null);

  /** Speaks a bark line when its subtitle shows: only while the sound runs and Voices are on. */
  const say = (contentRef: string): Promise<boolean> => {
    const g = live();
    if (!g || !voicesAudible()) return Promise.resolve(false);
    return g.barks.say(contentRef);
  };
  const barkEvents =
    opts.barkEvents === undefined ? (typeof window === 'undefined' ? null : window) : opts.barkEvents;
  barkEvents?.addEventListener(BARK_SHOWN_EVENT, (ev) => {
    const ref = (ev as CustomEvent<{ contentRef?: unknown }>).detail?.contentRef;
    if (typeof ref === 'string') void say(ref);
  });
  const applyVoiceLevel = () => {
    if (!graph) return;
    const level = voiceLevel();
    graph.voiceLevel.gain.setTargetAtTime(level, graph.ctx.currentTime, 0.02);
    if (!voicesAudible()) graph.barks.stop();
  };

  /** Registers a long-lived voice in the pool; if it is ever stolen, `onLost` forgets it. */
  const hold = <T extends { stop(): void }>(
    priority: number,
    voice: T,
    onLost: () => void,
  ): PoolEntry | null =>
    pool.add(priority, {
      stop: () => {
        voice.stop();
        onLost();
      },
    });

  const dropPlayerEngine = () => {
    if (!playerEngine) return;
    pool.release(playerEngine.entry);
    playerEngine.voice.stop();
    playerEngine = null;
  };
  const dropOther = (id: number) => {
    const h = others.get(id);
    if (!h) return;
    pool.release(h.entry);
    h.voice.stop();
    others.delete(id);
    otherPan.delete(id);
  };
  const dropSiren = () => {
    if (!siren) return;
    pool.release(siren.entry);
    siren.voice.stop();
    siren = null;
  };

  const engineFor = (g: Graph, contentId: string): Held<EngineVoice> | null => {
    if (playerEngine && playerEngine.contentId === contentId) return playerEngine;
    dropPlayerEngine();
    const voice = createEngineVoice(
      g.ctx,
      g.slowmo.fxIn,
      resolveEngineProfile(engineSounds[contentId]),
      'full',
    );
    const held: Held<EngineVoice> = { voice, contentId, entry: null as unknown as PoolEntry };
    const entry = hold(PRIORITY.playerEngine, voice, () => {
      if (playerEngine === held) playerEngine = null;
    });
    if (!entry) return null;
    held.entry = entry;
    return (playerEngine = held);
  };

  const drivePlayer = (
    g: Graph,
    me: Pick<EntitySnapshot, 'rpm' | 'throttle'> &
      Partial<Pick<EntitySnapshot, 'mode' | 'contentId' | 'gear'>>,
    hitStop: boolean,
  ) => {
    const held = engineFor(g, me.contentId ?? 'player');
    if (!held) return;
    const down = me.mode === 'Tumble' || me.mode === 'OnFoot';
    const now = g.ctx.currentTime;
    // Gears, revs and pops (engine-feel.ts); a hit-stop holds the engine where it is.
    const f =
      hitStop && lastFeel
        ? { ...lastFeel, pops: [] }
        : feel.step({ t: now, rpm: me.rpm, gear: me.gear ?? 0, throttle: me.throttle, down });
    lastFeel = f;
    if (f.shift) feelCounts.shifts++;
    if (f.rev) feelCounts.revs++;
    held.voice.set({ rpm: f.rpm, throttle: f.load });
    held.voice.setLevel(
      ENGINE_LEVELS.player * params.engineGain * f.level * (down ? 0.3 : 1) * (hitStop ? 0.3 : 1),
    );
    held.voice.setDoppler(g.slowmo.pitch());
    if (params.enginePops > 0) {
      for (const pop of f.pops) {
        held.voice.pop(now + pop.delayS, pop.size * params.enginePops);
        feelCounts.pops++;
      }
    }
  };

  const silenceScene = (g: Graph) => {
    slowmoByEvents = false;
    g.slowmo.set(false);
    playerEngine?.voice.setLevel(0);
    wind?.set(0, windParams());
    for (const id of [...others.keys()]) dropOther(id);
    dropSiren();
    // Out of the race (the menus), nobody is talking.
    g.barks.stop();
    pumpMusic(g, g.ctx.currentTime, false, 0);
  };

  /** Cues that mark the slow motion's edges play at their own pitch. */
  const UNPITCHED: ReadonlySet<CueId> = new Set(['slowIn', 'slowOut']);

  const playCue = (g: Graph, cue: CueId, priority: number, gain: number, impact = 1) => {
    const level = gain * params.cueGain;
    if (level <= 0.001) return;
    const at = g.ctx.currentTime;
    const pitch = UNPITCHED.has(cue) ? 1 : g.slowmo.pitch();
    const playing = CUE_PATCHES[cue](g.ctx, g.slowmo.fxIn, at, level, { impact, pitch });
    const entry = pool.add(priority, playing);
    if (!entry) return;
    playing.onEnded(() => pool.release(entry));
    lastCues.push({ cue, at });
    if (lastCues.length > 32) lastCues.shift();
  };

  const findEntity = (snap: SimSnapshot, id: number): EntitySnapshot | null => {
    const e = snap.entities[id];
    return e && e.id === id ? e : (snap.entities.find((x) => x.id === id) ?? null);
  };

  const scene = (g: Graph, snap: SimSnapshot, me: EntitySnapshot) => {
    const now = g.ctx.currentTime;
    const hitStop = snap.timeScale === 0;
    // The snapshot's slow motion is the truth when it carries it (after a resume, too).
    if (snap.slowmo) slowmoByEvents = snap.slowmo.active;
    g.slowmo.set(slowmoByEvents);
    const pitch = g.slowmo.pitch();
    drivePlayer(g, me, hitStop);
    // The wind: your speed, heard. Off while you tumble or run, and ducked in a hit-stop.
    wind ??= createWindVoice(g.ctx, g.slowmo.fxIn);
    const down = me.mode === 'Tumble' || me.mode === 'OnFoot';
    wind.set(me.speed, windParams(), down ? 0 : hitStop ? 0.3 : 1);
    const listener = moving(me);

    // Other riders' engines: the nearest few, cheaper patch, distance and Doppler.
    const near = snap.entities
      .filter((e) => e.kind === 'rider' && e.id !== me.id && e.mode !== 'Tumble' && e.mode !== 'OnFoot')
      .map((e) => ({ e, d: distance(me, e) }))
      .filter((x) => x.d < OTHER_ENGINES_RANGE_M)
      .sort((a, b) => a.d - b.d)
      .slice(0, OTHER_ENGINES_MAX);
    const keep = new Set(near.map((x) => x.e.id));
    for (const id of [...others.keys()]) if (!keep.has(id)) dropOther(id);
    for (const { e, d } of near) {
      let held = others.get(e.id);
      if (held && held.contentId !== e.contentId) {
        dropOther(e.id);
        held = undefined;
      }
      if (!held) {
        const voice = createEngineVoice(
          g.ctx,
          g.slowmo.fxIn,
          resolveEngineProfile(engineSounds[e.contentId]),
          'lite',
        );
        const id = e.id;
        const h: Held<EngineVoice> = { voice, contentId: e.contentId, entry: null as unknown as PoolEntry };
        const entry = hold(PRIORITY.otherEngine, voice, () => {
          if (others.get(id) === h) others.delete(id);
        });
        if (!entry) continue;
        h.entry = entry;
        others.set(id, (held = h));
      }
      held.voice.set({ rpm: e.rpm, throttle: e.throttle });
      held.voice.setLevel(ENGINE_LEVELS.other * params.engineGain * distanceGain(d) * (hitStop ? 0.3 : 1));
      held.voice.setDoppler(pitch * dopplerFactor(listener, moving(e), params.dopplerScale));
      // Passing riders sit left or right of you (0.8 at most, so neither ear goes silent).
      const pan = 0.8 * panFor(me, e);
      held.voice.setPan(pan);
      otherPan.set(e.id, pan);
    }

    // The siren while the cop is near.
    const cop = findSiren(me, snap.entities);
    if (cop) {
      if (!siren) {
        const voice = createSirenVoice(g.ctx, g.slowmo.fxIn);
        const h: Held<SirenVoice> = { voice, contentId: cop.contentId, entry: null as unknown as PoolEntry };
        const entry = hold(PRIORITY.siren, voice, () => {
          if (siren === h) siren = null;
        });
        if (entry) {
          h.entry = entry;
          siren = h;
        }
      }
      if (siren) {
        siren.voice.setLevel(0.45 * params.cueGain * distanceGain(distance(me, cop), 12, 250));
        siren.voice.setDoppler(pitch * dopplerFactor(listener, moving(cop), params.dopplerScale));
      }
    } else dropSiren();

    // Oncoming traffic honks once as it closes in your line.
    if (params.hornRangeM > 0) {
      const honks = findHonks(me, snap.entities, now, lastHonk, {
        ...HORN_DEFAULTS,
        rangeM: params.hornRangeM,
        laneHalfWidthM: params.hornLaneHalfWidthM,
      });
      for (const h of honks) {
        playCue(g, h.truck ? 'truckHorn' : 'horn', h.truck ? 62 : 60, distanceGain(h.distanceM, 25, 220));
      }
    }

    // Music: the score's lead comes in with speed (the radio just plays).
    pumpMusic(g, now, true, 0.35 + 0.65 * Math.min(1, Math.max(0, me.speed / 35)));
  };

  return {
    async resume() {
      if (!graph) {
        graph = build();
        graph.radio.setCut(radioCut);
        graph.radio.setFx(params.radioFx);
        retune();
      }
      applyVolumes();
      if (!opts.offline && graph.ctx.state !== 'running') await graph.ctx.resume();
    },
    setVolumes(v, mute) {
      volumes = v;
      muted = mute;
      applyVolumes();
    },
    update(player) {
      const g = live();
      if (!g) return;
      if (!player) {
        silenceScene(g);
        return;
      }
      drivePlayer(g, { ...player, contentId: playerEngine?.contentId ?? 'player' }, false);
      pumpMusic(g, g.ctx.currentTime, true, 0.35 + 0.65 * Math.min(1, Math.max(0, player.speed / 35)));
    },
    frame(snapshot, playerId) {
      lastSnap = snapshot;
      lastPlayerId = playerId;
      const g = live();
      if (!g) return;
      const me = snapshot ? findEntity(snapshot, playerId) : null;
      if (!snapshot || !me) {
        silenceScene(g);
        return;
      }
      scene(g, snapshot, me);
    },
    onEvents(events, snapshot) {
      const g = live();
      if (!g) return;
      const snap = snapshot ?? lastSnap;
      const me = snap ? findEntity(snap, lastPlayerId) : null;
      for (const e of events) {
        // The slow motion starts on its event's tick, before the next frame's snapshot says so.
        if (e.type === 'slowmoStart' || e.type === 'slowmoEnd') {
          slowmoByEvents = e.type === 'slowmoStart';
          g.slowmo.set(slowmoByEvents);
        }
        const src = snap ? findEntity(snap, e.actor) : null;
        const choice = cueForEvent(e, lastPlayerId, src ? src.speed : null);
        if (!choice) continue;
        let gain = 1;
        if (!choice.playerInvolved && snap && me) {
          gain = src ? distanceGain(distance(me, src), 8, 180) : 0.6;
        }
        const impact = Math.min(1, choice.impact * params.crashImpactScale);
        playCue(g, choice.cue, choice.priority, gain, impact);
        // The music ducks under a crash you are in or can clearly hear.
        if (DUCK_CUES.has(choice.cue) && (choice.playerInvolved || gain >= 0.5)) duckNow(g);
      }
    },
    setParam(id, value) {
      if (!Number.isFinite(value)) return;
      switch (id) {
        case 'audio.engineGain':
          params.engineGain = value;
          break;
        case 'audio.cueGain':
          params.cueGain = value;
          break;
        case 'audio.enginePops':
          params.enginePops = Math.max(0, value);
          break;
        case 'audio.shiftFloorRpm':
          feel.setParams({ shiftFloorRpm: value });
          break;
        case 'audio.maxVoices':
          params.maxVoices = value;
          pool.setMax(value);
          break;
        case 'audio.dopplerScale':
          params.dopplerScale = value;
          break;
        case 'audio.hornRangeM':
          params.hornRangeM = value;
          break;
        case 'audio.hornLaneHalfWidthM':
          params.hornLaneHalfWidthM = value;
          break;
        case 'audio.slowmoLowpassHz':
          params.slowmoLowpassHz = value;
          graph?.slowmo.setParams(slowmoParams());
          break;
        case 'audio.slowmoPitchSemis':
          params.slowmoPitchSemis = value;
          graph?.slowmo.setParams(slowmoParams());
          break;
        case 'audio.slowmoMusicDuck':
          params.slowmoMusicDuck = value;
          graph?.slowmo.setParams(slowmoParams());
          break;
        case 'audio.crashImpactScale':
          params.crashImpactScale = value;
          break;
        case 'audio.windGain':
          params.windGain = value;
          break;
        case 'audio.windFromMps':
          params.windFromMps = value;
          break;
        case 'audio.windFullMps':
          params.windFullMps = value;
          break;
        case 'audio.radio':
          params.radio = Math.round(value);
          retune();
          break;
        case 'audio.radioLoops':
          params.radioLoops = Math.max(1, Math.round(value));
          break;
        case 'audio.radioFx':
          params.radioFx = value;
          graph?.radio.setFx(value);
          break;
        case 'audio.duckLevel':
          params.duckLevel = value;
          break;
        case 'audio.duckHoldS':
          params.duckHoldS = value;
          break;
        case 'audio.voiceGain':
          params.voiceGain = value;
          applyVoiceLevel();
          break;
        case 'audio.voiceFxDuck':
          params.voiceFxDuck = value;
          break;
        case 'audio.voiceDuck':
          params.voiceDuck = value;
          break;
      }
    },
    setEngineSounds(byRider) {
      engineSounds = byRider;
      // Rebuilt with the new profile on the next frame.
      dropPlayerEngine();
      for (const id of [...others.keys()]) dropOther(id);
    },
    suspend() {
      if (graph && graph.ctx.state === 'running') void graph.ctx.suspend();
    },
    state: () => graph?.ctx.state ?? 'none',
    inspect: () => ({
      state: graph?.ctx.state ?? 'none',
      busTargets: busTargets(volumes, muted),
      activeVoices: pool.size,
      lastCues: lastCues.slice(),
      playerEngineHz: playerEngine?.voice.hz() ?? 0,
      playerEngineLevel: playerEngine?.voice.level() ?? 0,
      engineFeel: {
        rpm: lastFeel?.rpm ?? 0,
        load: lastFeel?.load ?? 0,
        level: lastFeel?.level ?? 1,
        ...feelCounts,
      },
      otherEngines: [...others.keys()].sort((a, b) => a - b),
      otherEngineVoices: [...others.entries()]
        .sort(([a], [b]) => a - b)
        .map(([id, h]) => ({ id, preset: h.voice.profile.preset, pan: otherPan.get(id) ?? 0 })),
      sirenLevel: siren?.voice.level() ?? 0,
      musicPlaying: graph?.music.playing() ?? false,
      slowmo: {
        active: graph?.slowmo.active() ?? false,
        lowpassHz: graph?.slowmo.lowpassTarget() ?? 0,
        musicLevel: graph?.slowmo.musicTarget() ?? 1,
        pitch: graph?.slowmo.pitch() ?? 1,
      },
      windLevel: wind?.level() ?? 0,
      radio: {
        choice: Math.round(params.radio),
        tunedTo: ((t) => (typeof t === 'object' ? t.id : t))(tuned()),
        stations: regionStations().map((st) => st.id),
        nowPlaying: graph?.radio.nowPlaying() ?? null,
        history: [...(graph?.radio.history() ?? [])],
      },
      duckLevel: duckTarget,
      voice: {
        ...(graph?.barks.state() ?? { playing: null, played: [], silent: [] }),
        on: voicesAudible(),
        level: voiceLevel(),
        fxLevel: voiceFxTarget,
      },
    }),
    setStations(stations) {
      allStations = [...stations];
      retune();
    },
    setRegion(id) {
      regionId = id;
      retune();
    },
    setRadioCut(refs) {
      // Every veto on this device arrives here: radio tracks and bark lines alike. A cut line's
      // voice never plays again, and stops now if it is speaking.
      radioCut = [...refs];
      cutRefs = [...refs];
      graph?.radio.setCut(radioCut);
      graph?.barks.setCut(cutRefs);
    },
    cutPlayingTrack(raceId, tick) {
      const playing = graph?.radio.nowPlaying();
      if (!playing) return null;
      radioCut = [...radioCut, playing.ref];
      graph?.radio.setCut(radioCut);
      return cutFlag(playing.ref, raceId, tick);
    },
    nextRadio,
    skipTrack() {
      graph?.radio.skip();
    },
    duck() {
      const g = live();
      if (g) duckNow(g);
    },
    say,
  };
}
