import { describe, expect, it } from 'vitest';
import { createSettingsStore, sanitiseSettings, SETTINGS_VERSION } from './index';

describe('Quick Play field choice is an additive device setting', () => {
  it('keeps open competition for old records and invalid values', () => {
    for (const quickPlayField of [undefined, null, 'future', 1, true]) {
      expect(sanitiseSettings({ quickPlayField }).quickPlayField).toBe('open');
    }
    expect(SETTINGS_VERSION).toBe(1);
  });

  it('remembers matched competition across an actual settings save and reload', () => {
    const data = new Map<string, string>();
    const options = {
      keyPrefix: 'game',
      build: 'test',
      storage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => {
          data.set(key, value);
        },
      },
      persist: () => Promise.resolve(false),
    };
    const first = createSettingsStore(options);
    const settings = sanitiseSettings({ quickPlayField: 'matched' });
    expect(first.save(settings)).toBe(true);
    expect(createSettingsStore(options).load().quickPlayField).toBe('matched');
    expect(createSettingsStore(options).load().raceOptions).toEqual(settings.raceOptions);
  });
});
