// save: the versioned settings record (docs/architecture.md, "Save format"). Every storage read
// and write is wrapped, a broken storage falls back to memory with a one-time notice, and a record
// newer than the build is refused and kept. save-1 owns this folder after app-1.
import { checkHeader, wrapRecord, type VersionedRecord } from '../core';

export const SETTINGS_FORMAT = 'settings';
export const SETTINGS_VERSION = 1;

export interface Settings {
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

/** The subset of the Web Storage API the store uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SettingsStore {
  load(): Settings;
  save(settings: Settings): boolean;
  /** A one-time plain-words notice when storage is unavailable or a record was refused. */
  readonly notice: string | null;
  /** The last record read or written, for the debug file. */
  record(): VersionedRecord<'settings', Settings> | null;
}

export interface SettingsStoreOptions {
  /** Name-neutral key prefix: platform's app id. */
  keyPrefix: string;
  build: string;
  storage: StorageLike | null;
  now?: () => string;
}

function merge(data: unknown): Settings {
  const d = (typeof data === 'object' && data ? data : {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...d,
    volumes: { ...DEFAULT_SETTINGS.volumes, ...(d.volumes ?? {}) },
  };
}

export function createSettingsStore(opts: SettingsStoreOptions): SettingsStore {
  const key = `${opts.keyPrefix}:settings`;
  const now = opts.now ?? (() => new Date().toISOString());
  let memory: string | null = null;
  let usable = opts.storage !== null;
  let refused = false;
  let notice: string | null = usable ? null : 'Settings will not be saved on this device.';
  let last: VersionedRecord<'settings', Settings> | null = null;

  const read = (): string | null => {
    if (!usable || !opts.storage) return memory;
    try {
      return opts.storage.getItem(key);
    } catch {
      usable = false;
      notice ??= 'Settings will not be saved on this device.';
      return memory;
    }
  };

  return {
    get notice() {
      return notice;
    },
    load() {
      const text = read();
      if (!text) return merge({});
      try {
        const raw: unknown = JSON.parse(text);
        const header = checkHeader(raw, SETTINGS_FORMAT, SETTINGS_VERSION);
        if (header.kind === 'newer') {
          refused = true;
          notice ??= 'Settings come from a newer build; using defaults and keeping them untouched.';
          return merge({});
        }
        if (header.kind !== 'ok') return merge({});
        last = raw as VersionedRecord<'settings', Settings>;
        return merge(last.data);
      } catch {
        return merge({});
      }
    },
    save(settings: Settings) {
      if (refused) return false; // never overwrite a record from a newer build
      last = wrapRecord(SETTINGS_FORMAT, SETTINGS_VERSION, opts.build, settings, now());
      const text = JSON.stringify(last);
      if (!usable || !opts.storage) {
        memory = text;
        return false;
      }
      try {
        opts.storage.setItem(key, text);
        return true;
      } catch {
        usable = false;
        memory = text;
        notice ??= 'Settings will not be saved on this device.';
        return false;
      }
    },
    record: () => last,
  };
}
