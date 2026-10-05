import { describe, expect, it } from 'vitest';
import m1Fixture from './fixtures/settings-v1-m1.json';
import {
  createSettingsStore,
  DEFAULT_SETTINGS,
  sanitiseSettings,
  type Settings,
  type StorageLike,
} from './index';

// Playtest 4, P4-18 (the maintainer: "Effects are too loud by default compared to the other audio").
// The default Effects level went from 90% to 70%. Only the default moved: a level a device has
// already saved is loaded as it was saved, whatever it is, the old default of 90% included.

const OLD_DEFAULT_EFFECTS = 0.9;

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: StorageLike = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
  return { storage, data };
}

const store = (storage: StorageLike) =>
  createSettingsStore({
    keyPrefix: 'app',
    build: 'abc1234',
    storage,
    now: () => '2026-10-05T00:00:00.000Z',
    persist: () => Promise.resolve(true),
  });

/** A record this build saved with these volumes, as a device that has changed some setting holds it. */
const saved = (effects: number): Settings => ({
  ...DEFAULT_SETTINGS,
  volumes: { ...DEFAULT_SETTINGS.volumes, effects },
});

describe('the default mix', () => {
  it('is master 80%, music 60%, effects 70% and voices 80%: effects sit between the music and the voices', () => {
    expect(DEFAULT_SETTINGS.volumes).toEqual({ master: 0.8, music: 0.6, effects: 0.7, voices: 0.8 });
    const v = DEFAULT_SETTINGS.volumes;
    expect(v.music).toBeLessThan(v.effects);
    expect(v.effects).toBeLessThan(v.voices);
  });

  it('is what a device with nothing saved loads, with a store and without one', () => {
    const empty = memoryStorage();
    expect(store(empty.storage).load().volumes).toEqual(DEFAULT_SETTINGS.volumes);
    expect(store(empty.storage).load().volumes.effects).toBe(0.7);
    expect(sanitiseSettings({}).volumes.effects).toBe(0.7);
    expect(sanitiseSettings(undefined).volumes.effects).toBe(0.7);
    expect(createSettingsStore({ keyPrefix: 'app', build: 'x', storage: null }).load().volumes.effects).toBe(
      0.7,
    );
  });

  it('leaves an effects level the device saved as it was saved, the old default of 90% included', () => {
    for (const effects of [0, 0.3, OLD_DEFAULT_EFFECTS, 1]) {
      const { storage } = memoryStorage();
      expect(store(storage).save(saved(effects))).toBe(true);
      // A later session: a fresh store over the same storage.
      const loaded = store(storage).load();
      expect(loaded.volumes.effects, `saved at ${effects}`).toBe(effects);
      expect(loaded.volumes.music).toBe(DEFAULT_SETTINGS.volumes.music);
    }
  });

  it('leaves the M1-era record its own effects level, and fills a missing one with the new default', () => {
    expect(sanitiseSettings(m1Fixture.data).volumes.effects).toBe(m1Fixture.data.volumes.effects);
    expect(m1Fixture.data.volumes.effects).not.toBe(DEFAULT_SETTINGS.volumes.effects);
    // A record with no effects level takes the default for that one level only.
    const partial = sanitiseSettings({ volumes: { master: 0.5, music: 0.2, voices: 0.4 } }).volumes;
    expect(partial).toEqual({ master: 0.5, music: 0.2, effects: 0.7, voices: 0.4 });
  });

  it('a saved record is never rewritten by loading it (the saved 90% stays in storage)', () => {
    const { storage, data } = memoryStorage();
    store(storage).save(saved(OLD_DEFAULT_EFFECTS));
    const before = data.get('app:settings');
    expect(store(storage).load().volumes.effects).toBe(OLD_DEFAULT_EFFECTS);
    expect(data.get('app:settings')).toBe(before);
  });
});
