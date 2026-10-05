// save: the versioned settings record (docs/architecture.md, "Save format"; docs/milestones/M1.md,
// save-1). Every storage read and write is wrapped; a broken storage falls back to memory with a
// one-time notice; a record newer than the build is refused and kept. After the first successful
// save the store asks the browser for persistent storage. No profile and no export code until M4.
//
// save-2 (docs/milestones/M2.md) adds the M2 settings. Every one is an additive field with a
// default, so `version` stays 1: a missing field takes its default on read, an M1-era build still
// loads an M2 record (it ignores the new fields), and a bump waits for a rename or a change of
// meaning and M4's migration runner. Fields this build does not know (written by a later additive
// build) are carried through its load and save untouched, so a rollback deploy loses nothing.
import {
  checkHeader,
  DEFAULT_DIFFICULTY,
  isDifficultyPreset,
  wrapRecord,
  type DifficultyPreset,
  type VersionedRecord,
} from '../core';

export const SETTINGS_FORMAT = 'settings';
export const SETTINGS_VERSION = 1;

/** Steering assist strength; the same ids as the sim's `SimSteerAssist` (riders-4). */
export type SteerAssistSetting = 'off' | 'light' | 'strong';
/** Steering method (the product spec's settings): thumb, tilt, or both added together. */
export type SteeringMethod = 'thumb' | 'tilt' | 'both';
/** Throttle: scaled drag on the stick, or auto-throttle (an assist the sim applies per slot). */
export type ThrottleMode = 'scaled' | 'auto';
/** Frame-rate cap as a divisor of the measured display refresh: full, half or a third. */
export type FrameRateCap = 'full' | 'half' | 'third';
/**
 * The look (playtest 1b item 6: styles as settings, [decided]): render/'s look ids. `classic` is the
 * M1 look; `kodak` is "Ink + 1960s film"; playtest 1c item 5 adds `wasteland` ("Sun-bleached
 * wasteland") and `brush` ("Kodachrome brush"). Render only: it never feeds SimConfig. Additive:
 * the version stays 1, and an id this build doesn't know sanitises to the default.
 *
 * The default is `kodak` from run W-O (maintainer, 2026-10-01: "ink+60s but may change later").
 * A record that already holds a look keeps it, so no migration: a record without one (a new
 * device) starts on Ink + 60s film. Every record this build writes holds the look, so a Classic
 * picked before the change stays Classic.
 */
export type LookSetting = 'classic' | 'kodak' | 'wasteland' | 'brush';
export const LOOK_SETTINGS: readonly LookSetting[] = ['classic', 'kodak', 'wasteland', 'brush'];
/**
 * The view (camera-3's base framings, playtest 1c integration): the low chase cam, the far chase
 * cam, or the helmet cam; camera/'s `camera.mode` 0, 1 and 2. Presentation only.
 */
export type ViewSetting = 'chase' | 'far' | 'helmet';
export const VIEW_SETTINGS: readonly ViewSetting[] = ['chase', 'far', 'helmet'];
/**
 * What the race plays (radio-1): the score, a station (the region's first; the pause menu's radio
 * panel and the R key switch between them) or nothing. Presentation only. A station by default
 * (playtest 2, 2026-10-02: "There should be different stations and music in different regions"),
 * so each region's race starts on that region's own sound; the score sounds the same everywhere.
 */
export type RadioSetting = 'score' | 'station' | 'off';
export const RADIO_SETTINGS: readonly RadioSetting[] = ['score', 'station', 'off'];

/**
 * The menu race's options (playtest 4, P4-12 and P4-13: "Maybe Races from main menu should have
 * options?"; "To change bike for main menu races you have to go into career garage"). They apply to
 * the menu's Race only, never to a career race, and are remembered between races here. Difficulty and
 * the race length are the record's own `difficulty` and `raceLength`, which the options screen shows
 * too; the region and the road are the menu's pickers. Each default changes nothing, so a record
 * without the field races as before. Additive: the version stays 1. [default]
 */
export interface RaceOptions {
  /**
   * The race type (P4-12's "other race & challenge types" is [open]: the maintainer wants to compare
   * first). Only `race` exists; the field is the seam a new type fills, and the screen shows the row
   * once there are two.
   */
  kind: RaceKind;
  /** A bike (qualified id, `base:superbike-1000`), or null for the career garage's bike. */
  bike: string | null;
  /** One of the region's times of day (`golden-hour`), or null for a draw by the seed, as before. */
  timeOfDay: string | null;
  /** The region's own weather, always dry, or rain. Render only: it never reaches the sim. */
  weather: RaceWeather;
  /** How many rivals ride (0 to MAX_RACE_RIVALS), or null for the event's own count. */
  rivals: number | null;
  /** The law rides (the event's cops) or stays home. */
  cops: boolean;
  /** How busy the road is, as a scale on the `traffic.density` slider. */
  traffic: RaceTraffic;
}
export type RaceKind = 'race';
export const RACE_KINDS: readonly RaceKind[] = ['race'];
export type RaceWeather = 'local' | 'dry' | 'rain';
export const RACE_WEATHER: readonly RaceWeather[] = ['local', 'dry', 'rain'];
export type RaceTraffic = 'none' | 'light' | 'usual' | 'heavy';
export const RACE_TRAFFIC: readonly RaceTraffic[] = ['none', 'light', 'usual', 'heavy'];
/** The most rivals a menu race may field (a grid of four rows behind the player). [default] */
export const MAX_RACE_RIVALS = 7;
export const DEFAULT_RACE_OPTIONS: Readonly<RaceOptions> = Object.freeze({
  kind: 'race',
  bike: null,
  timeOfDay: null,
  weather: 'local',
  rivals: null,
  cops: true,
  traffic: 'usual',
});

/** One "cut this" flag from the in-game veto (docs/architecture.md, "In-game veto"). */
export interface VetoFlag {
  /** `<packId>:<type>/<entryId>#<itemId>`. */
  contentRef: string;
  raceId: string;
  tick: number;
}

export interface Settings {
  /**
   * Bus volumes, 0..1. `voices` is the spoken barks' volume (run W-O's "voiceVolume": the audio
   * lane's contract name, read through `voiceSettings`), default 0.8.
   */
  volumes: { master: number; music: number; effects: number; voices: number };
  mute: boolean;
  /**
   * Spoken barks on or off (run W-O, maintainer 2026-10-01: "add a Voices volume and an off switch").
   * Off silences the voices bus and keeps the slider's level. Additive: the version stays 1.
   */
  voicesOn: boolean;
  /** Left-handed mirror of the touch layout. */
  mirror: boolean;
  /** Tuning preset id; `registry` means the parameter registry's defaults. */
  tuningPreset: string;
  units: 'mph' | 'kmh';
  // ---- M2 (save-2). Fields feeding SimConfig apply at the next race start. ----
  difficulty: DifficultyPreset;
  /** Assists for this device's player; auto-throttle is `throttle: 'auto'`. */
  assists: { steer: SteerAssistSetting };
  /** The lower-overall-speed multiplier, in (0, 1]; 1 is full speed. */
  speedMultiplier: number;
  /** The event length id (`short`, `standard`, `long`); an id the event lacks means its first. */
  raceLength: string;
  steering: SteeringMethod;
  /** Tilt sensitivity multiplier, 0.25..4. */
  tiltSensitivity: number;
  throttle: ThrottleMode;
  /** Pulling the stick back also brakes. */
  pullBackBrake: boolean;
  haptics: boolean;
  /** The takedown slow motion. */
  slowMo: boolean;
  reduceShake: boolean;
  frameRateCap: FrameRateCap;
  /** The look; applies at once. */
  look: LookSetting;
  /**
   * The player said "No thanks" to the slow-frames offer to switch to the Classic look (run W-O), so
   * it is never offered again. Not a settings row: ui's own record field.
   */
  lookFallbackDismissed: boolean;
  /** Shows the tuning panel entry in the pause menu. */
  showTuningPanel: boolean;
  /**
   * The style cash pop-ups and the live style meter in the race (playtest 1c). On by default; off
   * hides them both, and the results screen still counts the cash. ui-only; never feeds SimConfig.
   */
  stylePopups: boolean;
  /** The camera view; applies at once. */
  view: ViewSetting;
  /** The score, a station or off; applies at once. */
  radio: RadioSetting;
  /**
   * The station last played (run W-P, W-O's mustFix): its id (`keys-surf`), so a reload tunes the
   * same station when the race's region offers it, not only "a station". Kept while the radio is on
   * the score or off, so Station returns to it. null before any station played.
   */
  radioStation: string | null;
  /**
   * The radio default this record was written under (playtest 2): 'station' from this build on.
   * Its absence marks a record from before, which `migrateRadio` moves off the old default.
   */
  radioDefault: RadioSetting;
  /**
   * The Effects level this record was written under as the default (playtest 4, P4-18): 0.7 from this
   * build on. Its absence marks a record from before, which `migrateEffects` moves off a saved 0.9, the
   * old default, once. Not a settings row.
   */
  effectsDefault: number;
  /**
   * Gamepad remaps: action id → control tokens (such as `button3`), in input/'s vocabulary. Only
   * remapped actions are listed; an empty object means input/'s default bindings.
   */
  gamepadBindings: Record<string, string[]>;
  /** The last build whose what's-new card this device saw; null before the first launch. */
  lastSeenBuild: string | null;
  /** Local "cut this" flags, one per content reference, oldest first. */
  vetoes: VetoFlag[];
  /** The menu race's options (playtest 4, P4-12 and P4-13); they feed the next menu race. */
  raceOptions: RaceOptions;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  // Effects 70% since playtest 4 (P4-18, the maintainer: "Effects are too loud by default compared to
  // the other audio"), from 90%: the music, effects, voices ladder. Only a default: a level a device
  // has saved loads as it was saved (sanitiseSettings below fills in only a missing one), except a
  // saved 90%, the old default, which `migrateEffects` moves here once (`effectsDefault` below).
  volumes: { master: 0.8, music: 0.6, effects: 0.7, voices: 0.8 },
  mute: false,
  voicesOn: true,
  mirror: false,
  tuningPreset: 'registry',
  units: 'mph',
  difficulty: DEFAULT_DIFFICULTY,
  // The M2 containers are frozen: spreading the defaults shares them, so nothing may push into them.
  assists: Object.freeze({ steer: 'off' as const }),
  speedMultiplier: 1,
  raceLength: 'standard',
  steering: 'thumb',
  tiltSensitivity: 1,
  throttle: 'scaled',
  pullBackBrake: false,
  haptics: true,
  slowMo: true,
  reduceShake: false,
  frameRateCap: 'full',
  look: 'kodak',
  lookFallbackDismissed: false,
  showTuningPanel: false,
  stylePopups: true,
  view: 'chase',
  radio: 'station',
  radioStation: null,
  radioDefault: 'station',
  effectsDefault: 0.7,
  gamepadBindings: Object.freeze({}),
  lastSeenBuild: null,
  vetoes: Object.freeze([]) as unknown as VetoFlag[],
  raceOptions: DEFAULT_RACE_OPTIONS,
};

/** The Effects default before playtest 4: the one saved level `migrateEffects` moves. */
const OLD_DEFAULT_EFFECTS = 0.9;
/** Upper bound on stored vetoes, so a runaway record cannot fill storage. */
export const MAX_VETOES = 1000;
const MAX_BINDING_ACTIONS = 32;
const MAX_TOKENS_PER_ACTION = 8;
const TILT_MIN = 0.25;
const TILT_MAX = 4;

export const NOTICE_UNAVAILABLE = 'Settings will not be saved on this device.';
export const NOTICE_NEWER = 'Settings come from a newer build; using defaults and keeping them untouched.';

/** The subset of the Web Storage API the store uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SettingsStore {
  /** The saved settings, sanitised, or the defaults. Never throws. */
  load(): Settings;
  /** True when the record reached device storage; false when it is kept in memory only. */
  save(settings: Settings): boolean;
  /** The plain-words notice when storage is unavailable or a record was refused, if any. */
  readonly notice: string | null;
  /** The notice, once per session: later calls return null (the one-time notice). */
  takeNotice(): string | null;
  /** The last record read or written, for the debug file. */
  record(): VersionedRecord<'settings', Settings> | null;
}

export interface SettingsStoreOptions {
  /** Name-neutral key prefix: platform's app id. */
  keyPrefix: string;
  build: string;
  storage: StorageLike | null;
  now?: () => string;
  /** Asks the browser to keep storage (`navigator.storage.persist`); defaults to the real one. */
  persist?: () => Promise<boolean>;
}

/** The storage key: name-neutral, derived from the app id. */
export function settingsKey(keyPrefix: string): string {
  return `${keyPrefix}:settings`;
}

const unit = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback;
const text = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;

const ACTION_ID = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const LENGTH_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

function sanitiseBindings(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let n = 0;
  for (const [action, tokens] of Object.entries(obj(v))) {
    if (n >= MAX_BINDING_ACTIONS || !ACTION_ID.test(action) || !Array.isArray(tokens)) continue;
    const kept = tokens
      .map((t) => text(t, 32))
      .filter((t): t is string => t !== null)
      .slice(0, MAX_TOKENS_PER_ACTION);
    if (kept.length === 0) continue;
    out[action] = kept;
    n++;
  }
  return out;
}

function sanitiseVeto(v: unknown): VetoFlag | null {
  const f = obj(v);
  const contentRef = text(f['contentRef'], 256);
  const raceId = text(f['raceId'], 64);
  const tick = f['tick'];
  if (contentRef === null || raceId === null) return null;
  if (typeof tick !== 'number' || !Number.isSafeInteger(tick) || tick < 0) return null;
  return { contentRef, raceId, tick };
}

function sanitiseVetoes(v: unknown): VetoFlag[] {
  if (!Array.isArray(v)) return [];
  const out: VetoFlag[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    if (out.length >= MAX_VETOES) break;
    const flag = sanitiseVeto(item);
    if (flag === null || seen.has(flag.contentRef)) continue;
    seen.add(flag.contentRef);
    out.push(flag);
  }
  return out;
}

const CONTENT_REF = /^[a-z0-9][a-z0-9-]{0,63}:[a-z0-9][a-z0-9-]{0,63}$/;
const TIME_ID = /^[a-z][a-z0-9-]{0,31}$/;

/** The menu race's options with each bad field at its default (a missing record: all defaults). */
export function sanitiseRaceOptions(data: unknown): RaceOptions {
  const d = obj(data);
  const def = DEFAULT_RACE_OPTIONS;
  const bike = d['bike'];
  const time = d['timeOfDay'];
  const rivals = d['rivals'];
  return {
    kind: oneOf(d['kind'], RACE_KINDS, def.kind),
    bike: typeof bike === 'string' && CONTENT_REF.test(bike) ? bike : def.bike,
    timeOfDay: typeof time === 'string' && TIME_ID.test(time) ? time : def.timeOfDay,
    weather: oneOf(d['weather'], RACE_WEATHER, def.weather),
    rivals:
      typeof rivals === 'number' && Number.isInteger(rivals) && rivals >= 0 && rivals <= MAX_RACE_RIVALS
        ? rivals
        : def.rivals,
    cops: bool(d['cops'], def.cops),
    traffic: oneOf(d['traffic'], RACE_TRAFFIC, def.traffic),
  };
}

/** Keeps each well-formed field and defaults the rest, so a bad value never reaches audio or input. */
/**
 * Pre-playtest-2 records (playtest 2, 2026-10-02: "There should be different stations and music in
 * different regions"): the score was the default then, and every record kept it, so a record on the
 * score that never played a station was never really chosen. Loading one moves it to today's
 * default, the region's station. A record that played a station and then went back to the score
 * keeps the score, and a record this build wrote (it carries `radioDefault`) is never touched, so
 * picking the score always sticks.
 */
function migrateRadio(s: Settings, raw: unknown): Settings {
  const old = obj(raw)['radioDefault'] === undefined;
  return old && s.radio === 'score' && s.radioStation === null ? { ...s, radio: DEFAULT_SETTINGS.radio } : s;
}

/**
 * Playtest 4 (P4-18, the maintainer: "Effects are too loud by default compared to the other audio"):
 * the default Effects level went from 90% to 70%. The record is saved whole (dismissing the what's-new
 * card saves it), so nearly every device that has played holds the old default as if it were a choice,
 * and the new default would reach only new devices. Loading a record from before (no `effectsDefault`)
 * with Effects at exactly 0.9 moves it to today's default; any other saved level is a choice and stays.
 * A record this build wrote carries `effectsDefault`, so it is never touched, and a 90% picked
 * afterwards sticks. It runs on the load and not on storage: the record is rewritten (with the marker)
 * by the next save, and until then the same load gives the same answer.
 */
function migrateEffects(s: Settings, raw: unknown): Settings {
  const old = obj(raw)['effectsDefault'] === undefined;
  return old && s.volumes.effects === OLD_DEFAULT_EFFECTS
    ? { ...s, volumes: { ...s.volumes, effects: DEFAULT_SETTINGS.volumes.effects } }
    : s;
}

export function sanitiseSettings(data: unknown): Settings {
  const d = obj(data);
  const v = obj(d['volumes']);
  const def = DEFAULT_SETTINGS;
  const preset = d['tuningPreset'];
  const units = d['units'];
  const speed = d['speedMultiplier'];
  const tilt = d['tiltSensitivity'];
  const length = d['raceLength'];
  const difficulty = d['difficulty'];
  return {
    volumes: {
      master: unit(v['master'], def.volumes.master),
      music: unit(v['music'], def.volumes.music),
      effects: unit(v['effects'], def.volumes.effects),
      voices: unit(v['voices'], def.volumes.voices),
    },
    mute: bool(d['mute'], def.mute),
    voicesOn: bool(d['voicesOn'], def.voicesOn),
    mirror: bool(d['mirror'], def.mirror),
    tuningPreset: typeof preset === 'string' && preset.length > 0 ? preset : def.tuningPreset,
    units: units === 'mph' || units === 'kmh' ? units : def.units,
    difficulty: isDifficultyPreset(difficulty) ? difficulty : def.difficulty,
    assists: { steer: oneOf(obj(d['assists'])['steer'], ['off', 'light', 'strong'], def.assists.steer) },
    speedMultiplier:
      typeof speed === 'number' && Number.isFinite(speed) && speed > 0 && speed <= 1
        ? speed
        : def.speedMultiplier,
    raceLength: typeof length === 'string' && LENGTH_ID.test(length) ? length : def.raceLength,
    steering: oneOf(d['steering'], ['thumb', 'tilt', 'both'], def.steering),
    tiltSensitivity:
      typeof tilt === 'number' && Number.isFinite(tilt)
        ? Math.min(TILT_MAX, Math.max(TILT_MIN, tilt))
        : def.tiltSensitivity,
    throttle: oneOf(d['throttle'], ['scaled', 'auto'], def.throttle),
    pullBackBrake: bool(d['pullBackBrake'], def.pullBackBrake),
    haptics: bool(d['haptics'], def.haptics),
    slowMo: bool(d['slowMo'], def.slowMo),
    reduceShake: bool(d['reduceShake'], def.reduceShake),
    frameRateCap: oneOf(d['frameRateCap'], ['full', 'half', 'third'], def.frameRateCap),
    look: oneOf(d['look'], LOOK_SETTINGS, def.look),
    lookFallbackDismissed: bool(d['lookFallbackDismissed'], def.lookFallbackDismissed),
    showTuningPanel: bool(d['showTuningPanel'], def.showTuningPanel),
    stylePopups: bool(d['stylePopups'], def.stylePopups),
    view: oneOf(d['view'], VIEW_SETTINGS, def.view),
    radio: oneOf(d['radio'], RADIO_SETTINGS, def.radio),
    radioDefault: oneOf(d['radioDefault'], RADIO_SETTINGS, def.radioDefault),
    effectsDefault: unit(d['effectsDefault'], def.effectsDefault),
    radioStation: text(d['radioStation'], 64) ?? def.radioStation,
    gamepadBindings: sanitiseBindings(d['gamepadBindings']),
    lastSeenBuild: text(d['lastSeenBuild'], 64) ?? def.lastSeenBuild,
    vetoes: sanitiseVetoes(d['vetoes']),
    raceOptions: sanitiseRaceOptions(d['raceOptions']),
  };
}

/** Adds a "cut this" flag, once per content reference; returns a new record (the input is kept). */
export function withVeto(s: Readonly<Settings>, flag: VetoFlag): Settings {
  const clean = sanitiseVeto(flag);
  const vetoes = [...s.vetoes];
  if (clean && vetoes.length < MAX_VETOES && !vetoes.some((f) => f.contentRef === clean.contentRef)) {
    vetoes.push(clean);
  }
  return { ...s, vetoes };
}

/** The voices settings under the names the audio lane's contract uses (run W-O). */
export function voiceSettings(s: Readonly<Settings>): { voiceVolume: number; voicesOn: boolean } {
  return { voiceVolume: s.volumes.voices, voicesOn: s.voicesOn };
}

/** The bus volumes audio is handed: the voices bus is silent while voices are off. */
export function audioVolumes(s: Readonly<Settings>): Settings['volumes'] {
  return { ...s.volumes, voices: s.voicesOn ? s.volumes.voices : 0 };
}

/** This device's player assists in the sim's per-slot shape (`SimAssists`), for buildSimConfig. */
export function settingsAssists(s: Readonly<Settings>): { steer: SteerAssistSetting; autoThrottle: boolean } {
  return { steer: s.assists.steer, autoThrottle: s.throttle === 'auto' };
}

const KNOWN_FIELDS = new Set(Object.keys(DEFAULT_SETTINGS));

/** The stored fields this build does not know, to write back untouched (rollback safety). */
function unknownFields(data: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj(data))) if (!KNOWN_FIELDS.has(k)) out[k] = v;
  return out;
}

function browserPersist(): Promise<boolean> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  return storage && typeof storage.persist === 'function' ? storage.persist() : Promise.resolve(false);
}

export function createSettingsStore(opts: SettingsStoreOptions): SettingsStore {
  const key = settingsKey(opts.keyPrefix);
  const now = opts.now ?? (() => new Date().toISOString());
  const persist = opts.persist ?? browserPersist;
  // This session's record when it could not reach storage; it wins over storage on load.
  let memory: string | null = null;
  let usable = opts.storage !== null;
  let refused = false;
  let persistAsked = false;
  let notice: string | null = usable ? null : NOTICE_UNAVAILABLE;
  let noticeTaken = false;
  let last: VersionedRecord<'settings', Settings> | null = null;
  // Fields from the stored record that this build does not know; written back on save.
  let extras: Record<string, unknown> = {};

  // One notice per session: the first problem is the one the player hears about.
  const warn = (text: string) => {
    notice ??= text;
  };
  const unavailable = () => {
    usable = false;
    warn(NOTICE_UNAVAILABLE);
  };

  const read = (): string | null => {
    if (memory !== null) return memory;
    if (!usable || !opts.storage) return null;
    try {
      return opts.storage.getItem(key);
    } catch {
      unavailable();
      return null;
    }
  };

  const askPersist = () => {
    if (persistAsked) return;
    persistAsked = true;
    try {
      void persist().catch(() => false);
    } catch {
      // No storage manager: the export code (M4) is the backup.
    }
  };

  return {
    get notice() {
      return notice;
    },
    takeNotice() {
      if (noticeTaken || notice === null) return null;
      noticeTaken = true;
      return notice;
    },
    load() {
      const text = read();
      if (!text) return sanitiseSettings({});
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return sanitiseSettings({});
      }
      const header = checkHeader(raw, SETTINGS_FORMAT, SETTINGS_VERSION);
      if (header.kind === 'newer') {
        refused = true;
        warn(NOTICE_NEWER);
        return sanitiseSettings({});
      }
      if (header.kind !== 'ok') return sanitiseSettings({});
      const rec = raw as VersionedRecord<'settings', unknown>;
      const settings = migrateEffects(migrateRadio(sanitiseSettings(rec.data), rec.data), rec.data);
      extras = unknownFields(rec.data);
      last = { ...rec, format: SETTINGS_FORMAT, data: settings };
      return settings;
    },
    save(settings: Settings) {
      const clean = sanitiseSettings(settings);
      last = wrapRecord(SETTINGS_FORMAT, SETTINGS_VERSION, opts.build, clean, now());
      // Unknown fields first, so a known field is always this build's value.
      const text = JSON.stringify({ ...last, data: { ...extras, ...clean } });
      // Never overwrite a record from a newer build: keep this session's settings in memory.
      if (refused || !usable || !opts.storage) {
        memory = text;
        return false;
      }
      try {
        opts.storage.setItem(key, text);
      } catch {
        unavailable();
        memory = text;
        return false;
      }
      askPersist();
      return true;
    },
    record: () => last,
  };
}

// The career profile record (W-Q contracts): src/save/profile.ts.
export * from './profile';
// The export code (run W-R): src/save/export-code.ts, a lazy chunk off the first-load JavaScript.
// Only the career's backups and the export and import buttons use it, and both are async anyway.
export type { ExportBundle, ImportResult } from './export-code';
type ExportCode = typeof import('./export-code');
const exportCode = (): Promise<ExportCode> => import('./export-code');
/** The export code for a bundle (export-code.ts, fetched on first use). */
export const encodeExportCode: ExportCode['encodeExportCode'] = async (bundle, opts) =>
  (await exportCode()).encodeExportCode(bundle, opts);
/** Reads an export code (export-code.ts, fetched on first use). */
export const decodeExportCode: ExportCode['decodeExportCode'] = async (code) =>
  (await exportCode()).decodeExportCode(code);
