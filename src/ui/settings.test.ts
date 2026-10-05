import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitiseSettings } from '../save';
import {
  ALWAYS_LIVE,
  applySettingsChange,
  lastSeenPersists,
  nonDefaultValue,
  SETTINGS,
  settingDef,
  settingDefault,
  settingPersists,
  settingValue,
  tunedLive,
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

  it('offers the voices on/off switch on the Sound tab, on by default, kept by the record', () => {
    // Run W-O (maintainer, 2026-10-01): a Voices volume (the Voices slider) and an off switch.
    const def = SETTINGS.find((d) => d.id === 'voicesOn');
    expect(def?.tab).toBe('sound');
    expect(def?.kind).toBe('toggle');
    expect(def?.nextRace).toBeUndefined();
    expect(settingValue(DEFAULT_SETTINGS, 'voicesOn')).toBe(true);
    expect(nonDefaultValue(settingDef('voicesOn'))).toBe(false);
    expect(settingPersists('voicesOn', sanitiseSettings)).toBe(true);
    expect(
      applySettingsChange(DEFAULT_SETTINGS, { kind: 'set', id: 'voicesOn', value: false }).voicesOn,
    ).toBe(false);
    // Shown once app/ wires it, like any other setting.
    const shown = (live: SettingId[]) =>
      visibleSettings({ live, persists: () => true, preview: false }).includes('voicesOn');
    expect(shown([])).toBe(false);
    expect(shown(['voicesOn'])).toBe(true);
  });

  it('offers the look on the Display tab: Ink + 60s film by default, Classic in the switch, applied at once', () => {
    // Playtest 1b item 6: styles as settings [decided]; render only, so never "applies next race".
    const def = SETTINGS.find((d) => d.id === 'look');
    expect(def?.tab).toBe('display');
    expect(def?.nextRace).toBeUndefined();
    expect(def?.options?.map((o) => o.value)).toEqual(['classic', 'kodak', 'wasteland', 'brush']);
    // Playtest 1c item 5: the two newer looks, by the names the maintainer was shown.
    expect(def?.options?.map((o) => o.label)).toEqual([
      'Classic',
      'Ink + 60s film',
      'Sun-bleached wasteland',
      'Kodachrome brush',
    ]);
    // Run W-O (maintainer, 2026-10-01: "ink+60s but may change later").
    expect(settingValue(DEFAULT_SETTINGS, 'look')).toBe('kodak');
    expect(settingPersists('look', sanitiseSettings)).toBe(true);
  });

  it('marks exactly the settings that feed SimConfig as "applies next race"', () => {
    const next = SETTINGS.filter((s) => s.nextRace).map((s) => s.id);
    expect(next.sort()).toEqual([
      'assists.steer',
      'difficulty',
      'raceLength',
      'slowMo',
      'speedMultiplier',
      'steerStyle',
    ]);
  });

  it('offers the steering style on the Race tab: Arcade by default, Free in the switch, kept by the record', () => {
    // Playtest 4, P4-8: today's guided model under its honest name, and an opt-in Free style.
    const def = settingDef('steerStyle');
    expect(def.tab).toBe('race');
    expect(def.nextRace).toBe(true);
    expect(def.options?.map((o) => o.label)).toEqual(['Arcade', 'Free']);
    expect(settingValue(DEFAULT_SETTINGS, 'steerStyle')).toBe('arcade');
    expect(nonDefaultValue(def)).toBe('free');
    expect(settingPersists('steerStyle', sanitiseSettings)).toBe(true);
    expect(
      applySettingsChange(DEFAULT_SETTINGS, { kind: 'set', id: 'steerStyle', value: 'free' }).steerStyle,
    ).toBe('free');
    // It is not the steering assist: changing one leaves the other.
    expect(
      applySettingsChange(DEFAULT_SETTINGS, { kind: 'set', id: 'steerStyle', value: 'free' }).assists,
    ).toEqual(DEFAULT_SETTINGS.assists);
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
    expect(shown).toContain('stylePopups'); // ui's own effect (playtest 1c)
    expect(shown).not.toContain('haptics'); // not wired yet
    const unsaved = visibleSettings({
      live: ['difficulty'],
      persists: (id) => id === 'units',
      preview: false,
    });
    expect(unsaved).toEqual(['units']);
    expect(ALWAYS_LIVE).toEqual(['units', 'showTuningPanel', 'stylePopups']);
  });

  it('shows the view and the radio once the registry declares their sliders (ui applies them)', () => {
    expect(tunedLive(() => false)).toEqual([]);
    expect(tunedLive((id) => id === 'camera.mode')).toEqual(['view']);
    expect(tunedLive((id) => id === 'camera.mode' || id === 'audio.radio').sort()).toEqual(['radio', 'view']);
    expect(settingPersists('view', sanitiseSettings)).toBe(true);
    expect(settingPersists('radio', sanitiseSettings)).toBe(true);
  });

  it('shows everything in preview mode', () => {
    const all = visibleSettings({ live: [], persists: () => false, preview: true });
    expect(all).toEqual(SETTINGS.map((s) => s.id));
  });
});
