import { describe, expect, it } from 'vitest';
import { createSettingsStore, sanitiseSettings, SETTINGS_VERSION } from './index';

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
    const options = { storage, build: 'test' };
    const store = createSettingsStore(options);
    store.save(sanitiseSettings({ raceOptions: { kind } }));
    expect(store.record()?.version).toBe(SETTINGS_VERSION);
    expect(createSettingsStore(options).load().raceOptions.kind).toBe(kind);
  });

  it.each([undefined, null, 'removed-event', 42])('defaults absent or invalid kind %s to Race', (kind) => {
    expect(sanitiseSettings({ raceOptions: { kind } }).raceOptions.kind).toBe('race');
    expect(SETTINGS_VERSION).toBe(1);
  });
});
