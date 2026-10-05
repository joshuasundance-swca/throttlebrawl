// Audio's tuning declarations and the light numbers they read (docs/architecture.md, "Tuning"). The
// tuning registry gathers AUDIO_TUNING at boot (app/tuning.ts), so this file rides in the first-load
// JavaScript; the engine that plays the sound (system.ts, with its patches, the cues, the radio and
// the music) is a lazy chunk that index.ts fetches as the menu comes up (the first-load budget).
// Keep this file free of runtime imports: whatever it imports comes back into the first load.
import type { TuningParamDecl } from '../sim/api';
import type { HornOptions } from './telegraphs';
import type { SlowmoParams } from './slowmo';

export const ENGINE_FEEL_DEFAULTS = {
  /** The heard rpm above first gear runs from this to redline. */
  shiftFloorRpm: 6000,
  idleRpm: 1200,
  redlineRpm: 10000,
  /** The clutch dip: level multiplier and how long it lasts. */
  shiftDip: 0.45,
  shiftDipS: 0.09,
  /** A downshift's blip, in rpm, fading over `blipS`. */
  downBlipRpm: 1500,
  blipS: 0.22,
  /** A throttle snap (rise per second) that flares, and the flare's size and length. */
  revRisePerS: 3,
  revRpm: 1400,
  revS: 0.25,
  /** Pops: a throttle shut from above `popFrom` to below `popTo` above `popMinRpm`. */
  popFrom: 0.55,
  popTo: 0.15,
  popMinRpm: 5000,
  /** A burst's length and its count range. */
  popBurstS: 0.7,
  popBurstMin: 3,
  popBurstMax: 6,
  /** Coasting at high revs with the throttle shut: pops per second. */
  coastPopsPerS: 1.5,
} as const;

export const HORN_DEFAULTS: HornOptions = { rangeM: 70, laneHalfWidthM: 1.8, cooldownS: 4 };

export const SLOWMO_DEFAULTS: SlowmoParams = {
  lowpassHz: 900,
  pitchSemis: -5,
  musicDuck: 0.35,
  glideS: 0.06,
};

export const WIND_DEFAULTS = {
  /** Peak level at full speed (0 = off). */
  gain: 0.3,
  /** Speed where the wind starts, m/s. */
  fromMps: 10,
  /** Speed where it is full, m/s (the starter bike's top speed is about 45 m/s). */
  fullMps: 45,
  /** The band's centre at the start and at full speed, Hz. */
  lowHz: 320,
  highHz: 1500,
} as const;

/**
 * The drift's tyre squeal, a continuous voice (cue-patches.ts, createSquealVoice): band-passed noise
 * from 1.8 to 3.0 kHz with its level following the slip (moves spec §4.4). `gain` is the peak at
 * full slip, the `audio.squealGain` slider [default]; `fullRad` is the slip that is full (the drift's
 * own cap, 34 degrees) and below `deadRad` a bike is just riding. `loHz`..`hiHz` is the band's
 * centre from a light slip to a full one.
 */
export const SQUEAL = { gain: 0.22, fullRad: 0.6, deadRad: 0.04, loHz: 1800, hiHz: 3000 } as const;

/** `audio.radio` values below the stations: 0 = off, 1 = the original score, 2+ = the stations. */
export const RADIO_OFF = 0;
export const RADIO_SCORE = 1;
/**
 * The region's first station: what a race plays by default (playtest 2, 2026-10-02: "There should
 * be different stations and music in different regions"), as the settings record's Radio default.
 */
export const RADIO_FIRST_STATION = 2;
/**
 * What a keydown does to the radio: R tunes the next choice, Shift+R skips the track; nothing with
 * another modifier, on a held key's repeats, or while typing in a field.
 */
export function radioKeyAction(ev: Event): 'next' | 'skip' | null {
  const e = ev as KeyboardEvent;
  if (e.code !== 'KeyR' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return null;
  const target = e.target as { tagName?: string } | null;
  if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT')
    return null;
  return e.shiftKey ? 'skip' : 'next';
}
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
 * 15 dB over the music at 0.5; at 0.15 it sat about 4.5 dB over it, and a cruising engine about
 * level with it. Other riders' engines are a little louder than yours up close, so a rival passing
 * is heard. Playtest 4 then took the default Effects level down 4.4 dB (`DEFAULT_VOLUMES`), which
 * puts the engine flat out about level with the music; these levels did not change.
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
  // Run W-Q: each region's own sounds under the engine (soundscape.ts): Keys bridge joints and gulls,
  // PNW rain on the helmet and log-truck engine brakes, SF foghorn and cable-car bells.
  {
    id: 'audio.soundscape',
    group: 'audio',
    label: 'Regional sounds (0 = off)',
    default: 1,
    min: 0,
    max: 2,
    step: 0.05,
    unit: '',
    affectsSim: false,
  },
  // Playtest 3 (the drift, "a first class experience"): the tyre squeal while the bike slides.
  {
    id: 'audio.squealGain',
    group: 'audio',
    label: 'Drift squeal level (0 = off)',
    default: SQUEAL.gain,
    min: 0,
    max: 1,
    step: 0.02,
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
 * The levels audio starts at, until app/ hands it the settings record's volumes at boot (the record's
 * own defaults are save/'s `DEFAULT_SETTINGS.volumes`, and src/app/default-mix.test.ts holds the
 * buses they share equal). Playtest 4 (P4-18, the maintainer: "Effects are too loud by default
 * compared to the other audio") [default]: Effects went from 90% to 70%. With the squared taper that
 * is the effects bus at 0.49 of full instead of 0.81, 4.4 dB lower: from 7.0 dB over the music bus
 * (and 2.0 dB over the voices bus) to 2.7 dB over the music bus and 2.3 dB under the voices bus, so
 * the ladder is music, effects, voices. Only the default moved; a level a device has saved is kept.
 * Voices start at 90% here and at 80% in the record, which hands over its own at boot.
 */
export const DEFAULT_VOLUMES: Readonly<Volumes> = Object.freeze({
  master: 0.8,
  music: 0.6,
  effects: 0.7,
  voices: 0.9,
});

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
