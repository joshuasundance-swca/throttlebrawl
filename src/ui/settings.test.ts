import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitiseSettings } from '../save';
import {
  ALWAYS_LIVE,
  applySettingsChange,
  lastSeenPersists,
  nonDefaultValue,
  SETTINGS,
  settingDefault,
  settingPersists,
  settingValue,
  visibleSettings,
  type SettingId,
} from './settings';

// ui-2 (docs/milestones/M2.md): every M2 setting in one place. The table is the settings screen;
// the record, its field names and its defaults are save-2's.

describe('the M2 settings table', () => {
  const ids = SETTINGS.map((s) => s.id);

  it('lists every setting M2 names, each once', () => {
    for (const id of [
      'units',
      'difficulty',
      'assists.steer',
      'speedMultiplier',
      'raceLength',
      'steering',
      'tiltSensitivity',
      'throttle',
      'pullBackBrake',
      'haptics',
      'slowMo',
      'reduceShake',
      'frameRateCap',
      'showTuningPanel',
    ] satisfies SettingId[]) {
      expect(ids).toContain(id);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('marks exactly the settings that feed SimConfig as "applies next race"', () => {
    const next = SETTINGS.filter((s) => s.nextRace).map((s) => s.id);
    expect(next.sort()).toEqual(['assists.steer', 'difficulty', 'raceLength', 'slowMo', 'speedMultiplier']);
  });

  it("takes save-2's defaults, and each default is one of the choices on offer", () => {
    const s = DEFAULT_SETTINGS;
    expect(settingValue(s, 'difficulty')).toBe('normal');
    expect(settingValue(s, 'slowMo')).toBe(true);
    expect(settingValue(s, 'speedMultiplier')).toBe(1);
    expect(settingValue(s, 'frameRateCap')).toBe('full');
    expect(settingValue(s, 'showTuningPanel')).toBe(false);
    expect(settingValue(s, 'assists.steer')).toBe('off');
    expect(settingValue(s, 'units')).toBe('mph');
    for (const def of SETTINGS) {
      const d = settingDefault(def.id);
      if (def.kind === 'toggle') expect(typeof d, def.id).toBe('boolean');
      else
        expect(
          def.options?.map((o) => o.value),
          def.id,
        ).toContain(d);
    }
  });

  it('gives every setting a non-default value that the record keeps (the non-default test rule)', () => {
    for (const def of SETTINGS) {
      const v = nonDefaultValue(def);
      expect(v, def.id).not.toBe(settingDefault(def.id));
      const next = applySettingsChange(DEFAULT_SETTINGS, { kind: 'set', id: def.id, value: v });
      expect(settingValue(next, def.id), def.id).toBe(v);
      // Every choice survives save/'s sanitiser: nothing on offer is silently dropped on reload.
      for (const o of def.options ?? []) {
        const set = applySettingsChange(DEFAULT_SETTINGS, { kind: 'set', id: def.id, value: o.value });
        expect(settingValue(sanitiseSettings(set), def.id), `${def.id} = ${String(o.value)}`).toBe(o.value);
      }
    }
  });

  it('offers a lower speed from 1 down to 0.6, never a speed-up (riders-4)', () => {
    const speed = SETTINGS.find((s) => s.id === 'speedMultiplier');
    const values = (speed?.options ?? []).map((o) => o.value as number);
    expect(values.length).toBeGreaterThanOrEqual(3);
    for (const v of values) expect(v > 0 && v <= 1).toBe(true);
    expect(Math.min(...values)).toBe(0.6);
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

  it('writes the nested steering assist without touching the frozen default', () => {
    const strong = applySettingsChange(DEFAULT_SETTINGS, {
      kind: 'set',
      id: 'assists.steer',
      value: 'strong',
    });
    expect(strong.assists.steer).toBe('strong');
    expect(strong.assists).not.toBe(DEFAULT_SETTINGS.assists);
    expect(DEFAULT_SETTINGS.assists.steer).toBe('off');
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
});

describe('which settings the screen shows', () => {
  it('detects whether the saved record keeps a field', () => {
    expect(settingPersists('units', sanitiseSettings)).toBe(true);
    expect(settingPersists('assists.steer', sanitiseSettings)).toBe(true);
    expect(settingPersists('difficulty', () => sanitiseSettings({}))).toBe(false);
    expect(lastSeenPersists(sanitiseSettings)).toBe(true);
    expect(lastSeenPersists(() => sanitiseSettings({}))).toBe(false);
  });

  it('shows a setting only when its effect is wired and the record keeps it', () => {
    const shown = visibleSettings({ live: ['difficulty'], persists: () => true, preview: false });
    expect(shown).toContain('difficulty');
    expect(shown).toContain('units'); // wired since M1
    expect(shown).toContain('showTuningPanel'); // ui's own effect
    expect(shown).not.toContain('haptics'); // not wired yet
    const unsaved = visibleSettings({
      live: ['difficulty'],
      persists: (id) => id === 'units',
      preview: false,
    });
    expect(unsaved).toEqual(['units']);
    expect(ALWAYS_LIVE).toEqual(['units', 'showTuningPanel']);
  });

  it('shows everything in preview mode', () => {
    const all = visibleSettings({ live: [], persists: () => false, preview: true });
    expect(all).toEqual(SETTINGS.map((s) => s.id));
  });
});
