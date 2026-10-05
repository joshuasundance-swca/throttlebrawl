import { describe, expect, it } from 'vitest';
import m1Fixture from './fixtures/settings-v1-m1.json';
import {
  createSettingsStore,
  DEFAULT_SETTINGS,
  SETTINGS_FORMAT,
  SETTINGS_VERSION,
  sanitiseSettings,
  type Settings,
  type StorageLike,
} from './index';

// Playtest 4, P4-18 (the maintainer: "Effects are too loud by default compared to the other audio").
// The default Effects level went from 90% to 70%. Only the default moved: a level a device has
// already saved is loaded as it was saved, whatever it is, with ONE exception: a saved Effects level
// of exactly 90% (the old default, which nearly every device holds, because the settings record is
// saved whole) moves to the new default once, on its first load. The record then carries
// `effectsDefault`, so a 90% chosen afterwards is a choice and is left alone.

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

  it('leaves an effects level the device saved as it was saved, a 90% this build saved included', () => {
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

  it('a saved record is never rewritten by loading it (a 90% this build saved stays in storage)', () => {
    const { storage, data } = memoryStorage();
    store(storage).save(saved(OLD_DEFAULT_EFFECTS));
    const before = data.get('app:settings');
    expect(store(storage).load().volumes.effects).toBe(OLD_DEFAULT_EFFECTS);
    expect(data.get('app:settings')).toBe(before);
  });
});

/** A settings record as the build before this change left it: the volumes, and no `effectsDefault`. */
const oldRecord = (volumes: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: SETTINGS_FORMAT,
    version: SETTINGS_VERSION,
    build: 'before',
    savedAt: '2026-10-04T00:00:00.000Z',
    data: { volumes, mute: false, units: 'kmh', ...extra },
  });

/** The settings record as it sits in storage, for the fields these tests read. */
const stored = (data: Map<string, string>) =>
  JSON.parse(data.get('app:settings') ?? 'null') as {
    data: { effectsDefault?: number; volumes: { effects: number } };
  };

describe('the one-time move of a saved 90% Effects level to the new default', () => {
  const others = { master: 0.5, music: 0.2, voices: 0.4 };

  it('loads a stored record with no marker and Effects at 90% as 70%, the other volumes unchanged', () => {
    const { storage } = memoryStorage({
      'app:settings': oldRecord({ ...others, effects: OLD_DEFAULT_EFFECTS }),
    });
    const loaded = store(storage).load();
    expect(loaded.volumes).toEqual({ ...others, effects: DEFAULT_SETTINGS.volumes.effects });
    expect(loaded.volumes.effects).toBe(0.7);
    // The rest of the record is as it was (the units choice, here).
    expect(loaded.units).toBe('kmh');
  });

  it('leaves every other saved Effects level as it was (including a missing one)', () => {
    for (const effects of [0, 0.3, 0.7, 0.85, 0.95, 1]) {
      const { storage } = memoryStorage({ 'app:settings': oldRecord({ ...others, effects }) });
      const loaded = store(storage).load();
      expect(loaded.volumes, `saved at ${effects}`).toEqual({ ...others, effects });
    }
    const missing = memoryStorage({ 'app:settings': oldRecord(others) });
    expect(store(missing.storage).load().volumes).toEqual({ ...others, effects: 0.7 });
  });

  it('moves it once: after the save, a 90% chosen again is kept by every later load', () => {
    const { storage, data } = memoryStorage({
      'app:settings': oldRecord({ ...others, effects: OLD_DEFAULT_EFFECTS }),
    });
    // The first session on this build: the load moves it, and the first save (the what's-new card's,
    // or any settings change) writes the marker.
    const first = store(storage);
    const loaded = first.load();
    expect(loaded.volumes.effects).toBe(0.7);
    expect(first.save(loaded)).toBe(true);
    // Still 70% on the next load, and the marker is in storage now.
    expect(store(storage).load().volumes.effects).toBe(0.7);
    // The player drags Effects back up to 90%: a choice. It sticks through a fresh load and another.
    const chosen = { ...loaded, volumes: { ...loaded.volumes, effects: OLD_DEFAULT_EFFECTS } };
    expect(store(storage).save(chosen)).toBe(true);
    const later = store(storage).load();
    expect(later.volumes).toEqual({ ...others, effects: OLD_DEFAULT_EFFECTS });
    expect(store(storage).load().volumes.effects).toBe(OLD_DEFAULT_EFFECTS);
    expect(stored(data).data.volumes.effects).toBe(OLD_DEFAULT_EFFECTS);
  });

  it('a record this build saves carries effectsDefault 0.7, whatever level Effects is at', () => {
    for (const effects of [0.3, 0.7, OLD_DEFAULT_EFFECTS]) {
      const { storage, data } = memoryStorage();
      store(storage).save(saved(effects));
      const written = stored(data);
      expect(written.data.effectsDefault, `effects ${effects}`).toBe(0.7);
      expect(written.data.volumes.effects).toBe(effects);
    }
    expect(DEFAULT_SETTINGS.effectsDefault).toBe(0.7);
    // A record that is only partly there (no volumes at all) is also stamped when it is next saved.
    const { storage, data } = memoryStorage({ 'app:settings': oldRecord({}) });
    const s = store(storage);
    s.save(s.load());
    expect(stored(data).data.effectsDefault).toBe(0.7);
  });

  it('keeps a 90% in a record that carries the marker, and sanitising alone never moves it', () => {
    const marked = memoryStorage({
      'app:settings': oldRecord({ ...others, effects: OLD_DEFAULT_EFFECTS }, { effectsDefault: 0.7 }),
    });
    expect(store(marked.storage).load().volumes.effects).toBe(OLD_DEFAULT_EFFECTS);
    // The marker is plain data: the settings screen's probe (sanitiseSettings) never migrates.
    expect(sanitiseSettings({ volumes: { effects: OLD_DEFAULT_EFFECTS } }).volumes.effects).toBe(
      OLD_DEFAULT_EFFECTS,
    );
    // A level that merely rounds near 90% is not the old default and is left alone.
    for (const effects of [0.9000001, 0.8999999, 0.89, 0.91]) {
      const near = memoryStorage({ 'app:settings': oldRecord({ ...others, effects }) });
      expect(store(near.storage).load().volumes.effects, `${effects}`).toBe(effects);
    }
  });
});
