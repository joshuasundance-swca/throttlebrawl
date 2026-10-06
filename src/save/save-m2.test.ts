import { describe, expect, it } from 'vitest';
import m1Fixture from './fixtures/settings-v1-m1.json';
import {
  createSettingsStore as createM1EraStore,
  DEFAULT_SETTINGS as M1_DEFAULTS,
} from './fixtures/m1-era-store';
import {
  createSettingsStore,
  DEFAULT_SETTINGS,
  MAX_VETOES,
  SETTINGS_FORMAT,
  SETTINGS_VERSION,
  sanitiseSettings,
  settingsAssists,
  withVeto,
  type Settings,
  type StorageLike,
} from './index';

// save-2 acceptance (docs/milestones/M2.md): an M1 settings record loads with M2 defaults filled
// in; an M2 record loads on an M1-era build without refusal; a record with a `version` newer than
// the build understands is still refused and kept. Plus: every M2 field survives a reload with a
// non-default value (the cross-lane "non-default test" rule), each field is sanitised on its own,
// and fields this build does not know survive its load-and-save (rollback safety).

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: StorageLike = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
  return { storage, data };
}

const opts = (storage: StorageLike | null, build = 'm2build') => ({
  keyPrefix: 'app',
  build,
  storage,
  now: () => '2026-09-30T12:00:00.000Z',
  persist: () => Promise.resolve(true),
});

/** Every M2 field at a non-default value; the M1 fields too. */
const m2Custom: Settings = {
  volumes: { master: 0.5, music: 0.1, effects: 0.2, voices: 0.3 },
  mute: true,
  voicesOn: false,
  mirror: true,
  tuningPreset: 'base:floaty',
  units: 'kmh',
  difficulty: 'hard',
  assists: { steer: 'strong' },
  steerStyle: 'free',
  speedMultiplier: 0.8,
  raceLength: 'long',
  steering: 'both',
  tiltSensitivity: 1.5,
  throttle: 'auto',
  pullBackBrake: true,
  haptics: false,
  slowMo: false,
  reduceShake: true,
  reduceMotion: true,
  textSize: 'largest',
  frameRateCap: 'half',
  look: 'brush',
  lookFallbackDismissed: true,
  showTuningPanel: true,
  stylePopups: false,
  view: 'helmet',
  radio: 'off',
  radioStation: 'keys-surf',
  // A record written under the old default (the field itself is new in playtest 2).
  radioDefault: 'score',
  // Playtest 4 (P4-18): the Effects default this record was written under (0.9 is the old one).
  effectsDefault: 0.9,
  gamepadBindings: { kick: ['button3'], lookBack: ['button5', 'button7'] },
  lastSeenBuild: 'f630c3c',
  vetoes: [{ contentRef: 'base:barks/rival-taunts#line-3', raceId: 'race-1', tick: 1234 }],
  // Playtest 4 (P4-12, P4-13): the menu race's options (see save-race-options.test.ts).
  raceOptions: {
    kind: 'race',
    bike: 'base:superbike-1000',
    timeOfDay: 'dusk',
    weather: 'rain',
    rivals: 2,
    cops: false,
    traffic: 'light',
  },
};

const M2_FIELDS = [
  'difficulty',
  'assists',
  'speedMultiplier',
  'raceLength',
  'steering',
  'tiltSensitivity',
  'throttle',
  'pullBackBrake',
  'haptics',
  'slowMo',
  'reduceShake',
  // Playtest 4 run B (B13, M5's a11y-1): reduce motion, and the text size.
  'reduceMotion',
  'textSize',
  'frameRateCap',
  'look',
  'showTuningPanel',
  'stylePopups',
  'view',
  'radio',
  'gamepadBindings',
  'lastSeenBuild',
  'vetoes',
  // Run W-O (maintainer, 2026-10-01): the voices off switch, and the look fallback's "No thanks".
  'voicesOn',
  'lookFallbackDismissed',
  // Run W-P (W-O's mustFix): the exact station, not only "a station".
  'radioStation',
  // Playtest 2 (2026-10-02): which radio default the record was written under.
  'radioDefault',
  // Playtest 4 (P4-18): which Effects default the record was written under (see save-mix.test.ts).
  'effectsDefault',
  // Playtest 4 (P4-12, P4-13): the menu race's options.
  'raceOptions',
  // Playtest 4 (P4-8): the steering style, Arcade or Free.
  'steerStyle',
] as const;

describe('the M2 settings record', () => {
  it('keeps version 1: every M2 field is additive with a default', () => {
    expect(SETTINGS_VERSION).toBe(1);
  });

  it('has a non-default test value for every M2 field (so the round trip below covers them all)', () => {
    for (const f of M2_FIELDS) expect(m2Custom[f], f).not.toEqual(DEFAULT_SETTINGS[f]);
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual(Object.keys(m2Custom).sort());
  });

  it('defaults: Normal, no assists, full speed, thumb, scaled throttle, haptics and slow motion on', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      difficulty: 'normal',
      assists: { steer: 'off' },
      speedMultiplier: 1,
      raceLength: 'standard',
      steering: 'thumb',
      tiltSensitivity: 1,
      throttle: 'scaled',
      pullBackBrake: false,
      haptics: true,
      slowMo: true,
      reduceShake: false,
      reduceMotion: false,
      textSize: 'normal',
      frameRateCap: 'full',
      // Run W-O (maintainer, 2026-10-01): "ink+60s but may change later".
      look: 'kodak',
      showTuningPanel: false,
      stylePopups: true,
      view: 'chase',
      // Playtest 2, 2026-10-02: "There should be different stations and music in different
      // regions": a race starts on its region's own station.
      radio: 'station',
      radioDefault: 'station',
      // Playtest 4 (P4-18): Effects start at 70%, the music, effects, voices ladder.
      effectsDefault: 0.7,
      gamepadBindings: {},
      lastSeenBuild: null,
      vetoes: [],
    });
  });

  it('loads an M1 record (as the M1 build wrote it) with M2 defaults filled in', () => {
    const { storage, data } = memoryStorage({ 'app:settings': JSON.stringify(m1Fixture) });
    const store = createSettingsStore(opts(storage));
    const loaded = store.load();
    expect(loaded).toEqual({ ...DEFAULT_SETTINGS, ...m1Fixture.data });
    for (const f of M2_FIELDS) expect(loaded[f], f).toEqual(DEFAULT_SETTINGS[f]);
    expect(store.takeNotice()).toBeNull();
    // Loading never rewrites the record: it stays exactly as the M1 build left it.
    expect(data.get('app:settings')).toBe(JSON.stringify(m1Fixture));
  });

  it('round-trips a non-default value for every M2 field through a reload', () => {
    const { storage } = memoryStorage();
    expect(createSettingsStore(opts(storage)).save(m2Custom)).toBe(true);
    expect(createSettingsStore(opts(storage)).load()).toEqual(m2Custom);
  });

  it('writes an M2 record that an M1-era build loads without refusal', () => {
    const { storage, data } = memoryStorage();
    createSettingsStore(opts(storage)).save(m2Custom);
    const written = data.get('app:settings');
    expect(JSON.parse(written ?? 'null')).toMatchObject({ format: SETTINGS_FORMAT, version: 1 });

    const m1 = createM1EraStore(opts(storage, 'ba04a47'));
    expect(m1.load()).toEqual({
      volumes: m2Custom.volumes,
      mute: m2Custom.mute,
      mirror: m2Custom.mirror,
      tuningPreset: m2Custom.tuningPreset,
      units: m2Custom.units,
    });
    expect(m1.notice).toBeNull();
    expect(m1.takeNotice()).toBeNull();
    // Not refused: the M1-era store still writes to storage.
    expect(m1.save({ ...M1_DEFAULTS, units: 'kmh' })).toBe(true);
  });

  it('still refuses and keeps a record whose version is newer than the build understands', () => {
    const newer = JSON.stringify({
      format: SETTINGS_FORMAT,
      version: SETTINGS_VERSION + 1,
      build: 'fffffff',
      savedAt: '2027-01-01T00:00:00.000Z',
      data: { ...m2Custom, renamedField: 'x' },
    });
    const { storage, data } = memoryStorage({ 'app:settings': newer });
    const store = createSettingsStore(opts(storage));
    expect(store.load()).toEqual(DEFAULT_SETTINGS);
    expect(store.takeNotice()).toMatch(/newer/);
    expect(store.save(m2Custom)).toBe(false);
    expect(data.get('app:settings')).toBe(newer);
    expect(store.load()).toEqual(m2Custom); // this session's changes live in memory
  });

  it('keeps fields a newer additive build wrote across this build’s load and save', () => {
    const later = {
      format: SETTINGS_FORMAT,
      version: 1,
      build: 'later01',
      savedAt: '2026-12-01T00:00:00.000Z',
      data: { ...m2Custom, hudLayout: { preset: 'minimal' }, dashTheme: 'chrome' },
    };
    const { storage, data } = memoryStorage({ 'app:settings': JSON.stringify(later) });
    const store = createSettingsStore(opts(storage));
    const loaded = store.load();
    expect(loaded).toEqual(m2Custom); // the typed record never carries unknown fields
    store.save({ ...loaded, units: 'mph' });
    const saved = JSON.parse(data.get('app:settings') ?? 'null') as { data: Record<string, unknown> };
    expect(saved.data['hudLayout']).toEqual({ preset: 'minimal' });
    expect(saved.data['dashTheme']).toBe('chrome');
    expect(saved.data['units']).toBe('mph');
    // A known field is always this build's sanitised value, never the stale stored one.
    expect(saved.data['difficulty']).toBe('hard');
  });

  it('sanitises each M2 field on its own, keeping good values and defaulting bad ones', () => {
    const bad = sanitiseSettings({
      difficulty: 'nightmare',
      assists: { steer: 'max' },
      steerStyle: 'sideways',
      speedMultiplier: 1.5,
      raceLength: 'Very Long!',
      steering: 'feet',
      tiltSensitivity: Number.NaN,
      throttle: 'cruise',
      pullBackBrake: 'yes',
      haptics: 0,
      slowMo: null,
      reduceShake: 'on',
      reduceMotion: 'on',
      textSize: 'huge',
      frameRateCap: 'quarter',
      look: 'sepia',
      showTuningPanel: 1,
      stylePopups: 'off',
      view: 'drone',
      radio: 'keys-surf',
      gamepadBindings: ['button3'],
      lastSeenBuild: 42,
      vetoes: 'all of them',
      voicesOn: 'off',
      lookFallbackDismissed: 'yes',
      radioStation: 42,
    });
    for (const f of M2_FIELDS) expect(bad[f], f).toEqual(DEFAULT_SETTINGS[f]);

    for (const m of [0, -0.5, Number.POSITIVE_INFINITY, '0.8']) {
      expect(sanitiseSettings({ speedMultiplier: m }).speedMultiplier).toBe(1);
    }
    expect(sanitiseSettings({ speedMultiplier: 0.6 }).speedMultiplier).toBe(0.6);
    expect(sanitiseSettings({ tiltSensitivity: 99 }).tiltSensitivity).toBe(4);
    expect(sanitiseSettings({ tiltSensitivity: 0.01 }).tiltSensitivity).toBe(0.25);
    expect(sanitiseSettings({ assists: { steer: 'light' } }).assists).toEqual({ steer: 'light' });
    expect(sanitiseSettings({ lastSeenBuild: '' }).lastSeenBuild).toBeNull();
    expect(sanitiseSettings({ lastSeenBuild: 'abc1234' }).lastSeenBuild).toBe('abc1234');
    // The look (playtest 1b item 6): every playable look round-trips, anything else is the default
    // (Ink + 60s film since run W-O).
    expect(sanitiseSettings({ look: 'kodak' }).look).toBe('kodak');
    expect(sanitiseSettings({ look: 'classic' }).look).toBe('classic');
    expect(sanitiseSettings({ look: 'KODAK' }).look).toBe('kodak');
    // Playtest 1c item 5: the two newer looks round-trip too.
    expect(sanitiseSettings({ look: 'wasteland' }).look).toBe('wasteland');
    expect(sanitiseSettings({ look: 'brush' }).look).toBe('brush');
    expect(sanitiseSettings({ look: 'rust' }).look).toBe('kodak');
    // The view and the radio (playtest 1c integration): every offered value round-trips.
    for (const v of ['chase', 'far', 'helmet'] as const) expect(sanitiseSettings({ view: v }).view).toBe(v);
    for (const r of ['score', 'station', 'off'] as const)
      expect(sanitiseSettings({ radio: r }).radio).toBe(r);
    expect(sanitiseSettings({ view: 2 }).view).toBe('chase');
    expect(sanitiseSettings({ radio: 'OFF' }).radio).toBe('station');
    // The exact station (run W-P): a station id round-trips; empty, overlong or not text is null.
    expect(sanitiseSettings({ radioStation: 'keys-surf' }).radioStation).toBe('keys-surf');
    for (const bad of ['', 'x'.repeat(65), 7, null, ['keys-surf']])
      expect(sanitiseSettings({ radioStation: bad }).radioStation).toBeNull();
  });

  it('keeps each well-formed binding and veto, dropping only the broken ones', () => {
    const s = sanitiseSettings({
      gamepadBindings: {
        kick: ['button3', 7, ''],
        attack: 'button0',
        lookBack: [],
        'no spaces': ['button1'],
        throttle: ['button7'],
      },
      vetoes: [
        { contentRef: 'base:barks/a#1', raceId: 'r1', tick: 10 },
        { contentRef: '', raceId: 'r1', tick: 10 },
        { contentRef: 'base:billboards/b#2', raceId: 'r2', tick: -1 },
        { contentRef: 'base:billboards/b#3', raceId: 'r2', tick: 2.5 },
        { contentRef: 'base:billboards/b#4', raceId: 'r3', tick: 0 },
        { contentRef: 'base:barks/a#1', raceId: 'r9', tick: 99 },
        null,
      ],
    });
    expect(s.gamepadBindings).toEqual({ kick: ['button3'], throttle: ['button7'] });
    expect(s.vetoes).toEqual([
      { contentRef: 'base:barks/a#1', raceId: 'r1', tick: 10 },
      { contentRef: 'base:billboards/b#4', raceId: 'r3', tick: 0 },
    ]);
  });

  it('bounds the veto list so a runaway record cannot fill storage', () => {
    const many = Array.from({ length: MAX_VETOES + 5 }, (_, i) => ({
      contentRef: `base:barks/x#${i}`,
      raceId: 'r',
      tick: i,
    }));
    expect(sanitiseSettings({ vetoes: many }).vetoes).toHaveLength(MAX_VETOES);
  });

  it('adds a veto once per content reference, without touching the input', () => {
    const flag = { contentRef: 'base:barks/rival-taunts#line-9', raceId: 'race-2', tick: 600 };
    const once = withVeto(DEFAULT_SETTINGS, flag);
    expect(once.vetoes).toEqual([flag]);
    expect(DEFAULT_SETTINGS.vetoes).toEqual([]);
    // Spreads of the defaults share these containers, so they are frozen.
    expect(Object.isFrozen(DEFAULT_SETTINGS.vetoes)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.gamepadBindings)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.assists)).toBe(true);
    const twice = withVeto(once, { ...flag, raceId: 'race-3', tick: 5 });
    expect(twice.vetoes).toEqual([flag]);
    expect(withVeto(once, { ...flag, contentRef: '' }).vetoes).toEqual([flag]);
  });

  it('moves a pre-playtest-2 record off the old score default, and never a choice made since', () => {
    // Playtest 2, 2026-10-02: "There should be different stations and music in different regions".
    const record = (data: Record<string, unknown>) => ({
      format: SETTINGS_FORMAT,
      version: SETTINGS_VERSION,
      build: 'old',
      savedAt: '2026-10-01T00:00:00.000Z',
      data,
    });
    const loadOf = (data: Record<string, unknown>) =>
      createSettingsStore(
        opts(memoryStorage({ 'app:settings': JSON.stringify(record(data)) }).storage),
      ).load();
    // An old record on the score that never played a station: the score was only the old default.
    expect(loadOf({ radio: 'score', radioStation: null }).radio).toBe('station');
    expect(loadOf({ radio: 'score' }).radio).toBe('station');
    // An old record that played a station and went back to the score chose it: kept.
    expect(loadOf({ radio: 'score', radioStation: 'keys-surf' }).radio).toBe('score');
    // Off and Station are choices too.
    expect(loadOf({ radio: 'off' }).radio).toBe('off');
    expect(loadOf({ radio: 'station', radioStation: 'pnw-salal' }).radio).toBe('station');
    // A record this build wrote keeps the score even before any station played: a pick sticks.
    const { storage } = memoryStorage();
    const store = createSettingsStore(opts(storage));
    store.save({ ...DEFAULT_SETTINGS, radio: 'score' });
    expect(createSettingsStore(opts(storage)).load().radio).toBe('score');
    // The marker is plain data: sanitising alone never migrates (the settings screen's probe).
    expect(sanitiseSettings({ radio: 'score' }).radio).toBe('score');
  });

  it('maps the assists, throttle and steering style settings to the sim slot assists shape', () => {
    // The style is always written (playtest 4, P4-8), so the replay header records it.
    expect(settingsAssists(DEFAULT_SETTINGS)).toEqual({
      steer: 'off',
      autoThrottle: false,
      steerStyle: 'arcade',
    });
    expect(settingsAssists(m2Custom)).toEqual({ steer: 'strong', autoThrottle: true, steerStyle: 'free' });
  });
});
