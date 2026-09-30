// save: the versioned settings record (docs/architecture.md, "Save format"; docs/milestones/M1.md,
// save-1). Every storage read and write is wrapped; a broken storage falls back to memory with a
// one-time notice; a record newer than the build is refused and kept. After the first successful
// save the store asks the browser for persistent storage. No profile and no export code until M4.
import { checkHeader, wrapRecord, type VersionedRecord } from '../core';

export const SETTINGS_FORMAT = 'settings';
export const SETTINGS_VERSION = 1;

export interface Settings {
  /** Bus volumes, 0..1. */
  volumes: { master: number; music: number; effects: number; voices: number };
  mute: boolean;
  /** Left-handed mirror of the touch layout. */
  mirror: boolean;
  /** Tuning preset id; `registry` means the parameter registry's defaults. */
  tuningPreset: string;
  units: 'mph' | 'kmh';
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  volumes: { master: 0.8, music: 0.6, effects: 0.9, voices: 0.9 },
  mute: false,
  mirror: false,
  tuningPreset: 'registry',
  units: 'mph',
};

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

/** Keeps each well-formed field and defaults the rest, so a bad value never reaches audio or input. */
export function sanitiseSettings(data: unknown): Settings {
  const d = obj(data);
  const v = obj(d['volumes']);
  const def = DEFAULT_SETTINGS;
  const preset = d['tuningPreset'];
  const units = d['units'];
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
  };
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
      last = { ...rec, format: SETTINGS_FORMAT, data: settings };
      return settings;
    },
    save(settings: Settings) {
      last = wrapRecord(SETTINGS_FORMAT, SETTINGS_VERSION, opts.build, sanitiseSettings(settings), now());
      const text = JSON.stringify(last);
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
