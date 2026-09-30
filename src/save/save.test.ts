import { describe, expect, it } from 'vitest';
import {
  createSettingsStore,
  DEFAULT_SETTINGS,
  SETTINGS_FORMAT,
  SETTINGS_VERSION,
  settingsKey,
  type Settings,
  type StorageLike,
} from './index';

// save-1 acceptance (docs/milestones/M1.md): storage that throws still boots with defaults, and a
// record newer than the build is refused and kept. Plus the envelope, the name-neutral key, the
// one-time notice, field sanitising and the persistent-storage request.

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: StorageLike = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
  return { storage, data };
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError: storage disabled');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

const opts = (storage: StorageLike | null, extra = {}) => ({
  keyPrefix: 'app',
  build: 'abc1234',
  storage,
  now: () => '2026-09-30T00:00:00.000Z',
  persist: () => Promise.resolve(true),
  ...extra,
});

const custom: Settings = {
  ...DEFAULT_SETTINGS,
  volumes: { master: 0.5, music: 0.1, effects: 0.2, voices: 0.3 },
  mute: true,
  mirror: true,
  tuningPreset: 'base:floaty',
  units: 'kmh',
};

describe('the settings record', () => {
  it('survives a reload inside the versioned envelope under a name-neutral key', () => {
    const { storage, data } = memoryStorage();
    expect(createSettingsStore(opts(storage)).save(custom)).toBe(true);
    expect(settingsKey('app')).toBe('app:settings');
    const stored = JSON.parse(data.get('app:settings') ?? 'null') as Record<string, unknown>;
    expect(stored).toEqual({
      format: SETTINGS_FORMAT,
      version: SETTINGS_VERSION,
      build: 'abc1234',
      savedAt: '2026-09-30T00:00:00.000Z',
      data: custom,
    });
    expect(createSettingsStore(opts(storage)).load()).toEqual(custom);
  });

  it('boots with defaults when storage throws, keeps settings in memory and says so once', () => {
    const store = createSettingsStore(opts(throwing));
    expect(store.load()).toEqual(DEFAULT_SETTINGS);
    expect(store.save(custom)).toBe(false);
    expect(store.load()).toEqual(custom); // the in-memory fallback
    expect(store.notice).toMatch(/not be saved/);
    expect(store.takeNotice()).toMatch(/not be saved/);
    expect(store.takeNotice()).toBeNull();
  });

  it('boots with defaults when storage is missing altogether', () => {
    const store = createSettingsStore(opts(null));
    expect(store.load()).toEqual(DEFAULT_SETTINGS);
    expect(store.takeNotice()).toMatch(/not be saved/);
  });

  it('falls back to memory when only writing fails', () => {
    const { storage } = memoryStorage();
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const store = createSettingsStore(opts(storage));
    expect(store.save(custom)).toBe(false);
    expect(store.load()).toEqual(custom);
    expect(store.takeNotice()).toMatch(/not be saved/);
  });

  it('refuses a record from a newer build and keeps it untouched', () => {
    const newer = JSON.stringify({
      format: SETTINGS_FORMAT,
      version: SETTINGS_VERSION + 1,
      build: 'fffffff',
      savedAt: '2027-01-01T00:00:00.000Z',
      data: { volumes: { master: 0.1 }, futureField: 42 },
    });
    const { storage, data } = memoryStorage({ 'app:settings': newer });
    const store = createSettingsStore(opts(storage));
    expect(store.load()).toEqual(DEFAULT_SETTINGS);
    expect(store.takeNotice()).toMatch(/newer/);
    expect(store.save(custom)).toBe(false);
    expect(data.get('app:settings')).toBe(newer);
    // The game still keeps this session's changes in memory.
    expect(store.load()).toEqual(custom);
  });

  it('treats a corrupt or foreign record as absent', () => {
    for (const text of [
      '{not json',
      '"a string"',
      JSON.stringify({ format: 'profile', version: 1, data: {} }),
    ]) {
      const { storage } = memoryStorage({ 'app:settings': text });
      expect(createSettingsStore(opts(storage)).load()).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('sanitises each field, keeping good values and defaulting bad ones', () => {
    const record = {
      format: SETTINGS_FORMAT,
      version: 1,
      build: 'x',
      savedAt: 'y',
      data: {
        volumes: { master: 2, music: -1, effects: 'loud', voices: 0.25 },
        mute: 'yes',
        mirror: true,
        tuningPreset: 7,
        units: 'furlongs',
      },
    };
    const { storage } = memoryStorage({ 'app:settings': JSON.stringify(record) });
    expect(createSettingsStore(opts(storage)).load()).toEqual({
      ...DEFAULT_SETTINGS,
      volumes: { master: 1, music: 0, effects: DEFAULT_SETTINGS.volumes.effects, voices: 0.25 },
      mute: DEFAULT_SETTINGS.mute,
      mirror: true,
      tuningPreset: DEFAULT_SETTINGS.tuningPreset,
      units: DEFAULT_SETTINGS.units,
    });
  });

  it('asks for persistent storage once, after the first successful save', async () => {
    let asked = 0;
    const { storage } = memoryStorage();
    const store = createSettingsStore(
      opts(storage, {
        persist: () => {
          asked++;
          return Promise.resolve(true);
        },
      }),
    );
    store.load();
    expect(asked).toBe(0);
    store.save(custom);
    store.save(custom);
    await Promise.resolve();
    expect(asked).toBe(1);
  });

  it('never throws when the persistence request fails', () => {
    const { storage } = memoryStorage();
    const store = createSettingsStore(
      opts(storage, {
        persist: () => {
          throw new Error('no storage manager');
        },
      }),
    );
    expect(store.save(custom)).toBe(true);
  });

  it('keeps the last record for the debug file', () => {
    const { storage } = memoryStorage();
    const store = createSettingsStore(opts(storage));
    expect(store.record()).toBeNull();
    store.save(custom);
    expect(store.record()?.data).toEqual(custom);
  });
});
