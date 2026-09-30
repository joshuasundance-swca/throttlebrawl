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

/** One "cut this" flag from the in-game veto (docs/architecture.md, "In-game veto"). */
export interface VetoFlag {
  /** `<packId>:<type>/<entryId>#<itemId>`. */
  contentRef: string;
  raceId: string;
  tick: number;
}

export interface Settings {
  /** Bus volumes, 0..1. */
  volumes: { master: number; music: number; effects: number; voices: number };
  mute: boolean;
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
  /** Shows the tuning panel entry in the pause menu. */
  showTuningPanel: boolean;
  /**
   * Gamepad remaps: action id → control tokens (such as `button3`), in input/'s vocabulary. Only
   * remapped actions are listed; an empty object means input/'s default bindings.
   */
  gamepadBindings: Record<string, string[]>;
  /** The last build whose what's-new card this device saw; null before the first launch. */
  lastSeenBuild: string | null;
  /** Local "cut this" flags, one per content reference, oldest first. */
  vetoes: VetoFlag[];
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  volumes: { master: 0.8, music: 0.6, effects: 0.9, voices: 0.9 },
  mute: false,
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
  showTuningPanel: false,
  gamepadBindings: Object.freeze({}),
  lastSeenBuild: null,
  vetoes: Object.freeze([]) as unknown as VetoFlag[],
};

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

/** Keeps each well-formed field and defaults the rest, so a bad value never reaches audio or input. */
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
    showTuningPanel: bool(d['showTuningPanel'], def.showTuningPanel),
    gamepadBindings: sanitiseBindings(d['gamepadBindings']),
    lastSeenBuild: text(d['lastSeenBuild'], 64) ?? def.lastSeenBuild,
    vetoes: sanitiseVetoes(d['vetoes']),
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
      const settings = sanitiseSettings(rec.data);
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
