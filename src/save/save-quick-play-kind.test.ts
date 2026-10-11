import { describe, expect, it } from 'vitest';
import { createSettingsStore, sanitiseSettings, SETTINGS_VERSION } from './index';
import { createSettingsStore as createPriorStore } from './fixtures/pre-quick-play-kind-store';

describe('Quick Play event kind remains a version-one device setting', () => {
  it.each(['hunt', 'escape', 'grudge'])('keeps %s through save and reload', (kind) => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    };
    const options = { keyPrefix: 'game', storage, build: 'test', persist: () => Promise.resolve(false) };
    const store = createSettingsStore(options);
    store.save(sanitiseSettings({ quickPlayKind: kind }));
    expect(store.record()?.version).toBe(SETTINGS_VERSION);
    expect(createSettingsStore(options).load().quickPlayKind).toBe(kind);
    const old = createPriorStore(options);
    const oldSettings = old.load();
    expect(oldSettings.raceOptions.kind).toBe('race');
    expect(old.save({ ...oldSettings, units: 'kmh' })).toBe(true);
    expect(createSettingsStore(options).load().quickPlayKind).toBe(kind);
  });

  it.each([undefined, null, 'removed-event', 42])('defaults absent or invalid kind %s to Race', (kind) => {
    expect(sanitiseSettings({ quickPlayKind: kind }).quickPlayKind).toBe('race');
    expect(SETTINGS_VERSION).toBe(1);
  });
});
