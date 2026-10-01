import { describe, expect, it } from 'vitest';
import { createSettingsStore, DEFAULT_SETTINGS, SETTINGS_VERSION, type StorageLike } from './index';

// Run W-O, item 1 (maintainer, 2026-10-01: "ink+60s but may change later"): Ink + 60s film is the
// default look for a new save; a save that holds a look keeps it. No migration: the look field is
// additive, and every record a look-era build wrote holds the look.

function store(initial?: unknown) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set('app:settings', JSON.stringify(initial));
  const storage: StorageLike = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
  return createSettingsStore({
    keyPrefix: 'app',
    build: 'wo',
    storage,
    persist: () => Promise.resolve(true),
  });
}
const record = (data: Record<string, unknown>) => ({
  format: 'settings',
  version: SETTINGS_VERSION,
  build: 'a826e02',
  savedAt: '2026-10-01T12:00:00.000Z',
  data,
});

describe('the default look', () => {
  it('is Ink + 60s film for a new device', () => {
    expect(DEFAULT_SETTINGS.look).toBe('kodak');
    expect(store().load().look).toBe('kodak');
  });

  it('keeps the look a save already holds, Classic included', () => {
    for (const look of ['classic', 'kodak', 'wasteland', 'brush'] as const) {
      expect(store(record({ look, units: 'kmh' })).load().look, look).toBe(look);
    }
  });

  it('gives a save from before the look setting (no look field) the new default', () => {
    expect(store(record({ units: 'kmh', mute: true })).load()).toMatchObject({ look: 'kodak', units: 'kmh' });
  });

  it('has the slow-frames offer not yet dismissed, and keeps a dismiss', () => {
    expect(DEFAULT_SETTINGS.lookFallbackDismissed).toBe(false);
    const s = store();
    s.save({ ...s.load(), lookFallbackDismissed: true });
    expect(s.load().lookFallbackDismissed).toBe(true);
  });
});
