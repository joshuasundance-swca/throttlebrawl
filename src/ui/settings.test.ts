import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitiseSettings } from '../save';
import {
  ALWAYS_LIVE,
  applySettingsChange,
  nonDefaultValue,
  SETTINGS,
  settingPersists,
  settingValue,
  visibleSettings,
  type SettingId,
} from './settings';

// ui-2 (docs/milestones/M2.md): every M2 setting in one place. The table is the settings screen.

describe('the M2 settings table', () => {
  const ids = SETTINGS.map((s) => s.id);

  it('lists every setting M2 names, each once', () => {
    for (const id of [
      'units',
      'difficulty',
      'steerAssist',
      'speedMultiplier',
      'raceLength',
      'steering',
      'throttle',
      'pullBackBrake',
      'haptics',
      'slowMo',
      'screenShake',
      'frameCap',
      'showTuning',
    ] satisfies SettingId[]) {
      expect(ids).toContain(id);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('marks exactly the settings that feed SimConfig as "applies next race"', () => {
    const next = SETTINGS.filter((s) => s.nextRace).map((s) => s.id);
    expect(next.sort()).toEqual(['difficulty', 'raceLength', 'slowMo', 'speedMultiplier', 'steerAssist']);
  });

  it('has the decided defaults: Normal, slow motion on, full speed, smooth frame rate, tuning hidden', () => {
    const s = DEFAULT_SETTINGS;
    expect(settingValue(s, 'difficulty')).toBe('normal');
    expect(settingValue(s, 'slowMo')).toBe(true);
    expect(settingValue(s, 'speedMultiplier')).toBe(1);
    expect(settingValue(s, 'frameCap')).toBe('full');
    expect(settingValue(s, 'showTuning')).toBe(false);
    expect(settingValue(s, 'units')).toBe('mph');
  });

  it('gives every setting a non-default value (the non-default test rule)', () => {
    for (const def of SETTINGS) {
      const v = nonDefaultValue(def);
      expect(v, def.id).not.toBe(def.default);
      const next = applySettingsChange(DEFAULT_SETTINGS, { kind: 'set', id: def.id, value: v });
      expect(settingValue(next, def.id), def.id).toBe(v);
    }
  });

  it('offers a lower speed that is a multiplier in (0, 1], never a speed-up', () => {
    const speed = SETTINGS.find((s) => s.id === 'speedMultiplier');
    const values = (speed?.options ?? []).map((o) => o.value as number);
    expect(values.length).toBeGreaterThanOrEqual(3);
    for (const v of values) expect(v > 0 && v <= 1).toBe(true);
    expect(Math.min(...values)).toBe(0.7);
  });
});

describe('settings changes', () => {
  it('sets a choice only to one of its options, and a toggle only to a boolean', () => {
    const hard = applySettingsChange(DEFAULT_SETTINGS, { kind: 'set', id: 'difficulty', value: 'hard' });
    expect(settingValue(hard, 'difficulty')).toBe('hard');
    const bogus = applySettingsChange(hard, { kind: 'set', id: 'difficulty', value: 'nightmare' });
    expect(settingValue(bogus, 'difficulty')).toBe('hard');
    const notBool = applySettingsChange(hard, { kind: 'set', id: 'slowMo', value: 'yes' });
    expect(settingValue(notBool, 'slowMo')).toBe(true);
    expect(settingValue(DEFAULT_SETTINGS, 'difficulty')).toBe('normal'); // never mutated
  });

  it('keeps the M1 fields and changes units through the same path', () => {
    const kmh = applySettingsChange(DEFAULT_SETTINGS, { kind: 'set', id: 'units', value: 'kmh' });
    expect(kmh.units).toBe('kmh');
    expect(kmh.volumes).toEqual(DEFAULT_SETTINGS.volumes);
    expect(kmh.volumes).not.toBe(DEFAULT_SETTINGS.volumes);
  });

  it('records the last build seen, for the what-is-new card', () => {
    const s = applySettingsChange(DEFAULT_SETTINGS, { kind: 'seen', build: 'abc1234' });
    expect(s.lastSeenBuild).toBe('abc1234');
  });

  it('still sets volumes, mute and the mirror (M1)', () => {
    const s = applySettingsChange(DEFAULT_SETTINGS, { kind: 'volume', bus: 'master', value: 1.7 });
    expect(s.volumes.master).toBe(1);
    expect(applySettingsChange(s, { kind: 'mute', value: true }).mute).toBe(true);
    expect(applySettingsChange(s, { kind: 'mirror', value: true }).mirror).toBe(true);
  });
});

describe('which settings the screen shows', () => {
  const keepAll = (d: unknown) => d as ReturnType<typeof sanitiseSettings>;

  it('detects whether the saved record keeps a field', () => {
    expect(settingPersists('units', sanitiseSettings)).toBe(true);
    expect(settingPersists('difficulty', keepAll)).toBe(true);
    expect(settingPersists('difficulty', () => sanitiseSettings({}))).toBe(false);
  });

  it('shows a setting only when its effect is wired and the record keeps it', () => {
    const shown = visibleSettings({ live: ['difficulty'], persists: () => true, preview: false });
    expect(shown).toContain('difficulty');
    expect(shown).toContain('units'); // wired since M1
    expect(shown).toContain('showTuning'); // ui's own effect
    expect(shown).not.toContain('haptics'); // not wired yet
    const unsaved = visibleSettings({
      live: ['difficulty'],
      persists: (id) => id === 'units',
      preview: false,
    });
    expect(unsaved).toEqual(['units']);
    expect(ALWAYS_LIVE).toEqual(['units', 'showTuning']);
  });

  it('shows everything in preview mode', () => {
    const all = visibleSettings({ live: [], persists: () => false, preview: true });
    expect(all).toEqual(SETTINGS.map((s) => s.id));
  });
});
